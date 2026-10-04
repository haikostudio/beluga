import {
  type JugementsDeCarte,
  type DossierAJuger,
  type DocumentAJuger,
  type FamilleDErreur,
  type GenreCarte,
  type NiveauProposable,
  type QuestionDuJuge,
  type ReponseDuJuge,
  FICHES_DES_USAGES,
  type TraceDeJugement,
  type UsageDuJuge,
  bilanDesTraces,
  clesPertinentes,
  familleDeReponse,
  indicationDeNature,
  niveauPropose,
  questionComprehension,
  questionDoublon,
  questionFamilleDErreur,
  questionGenreDeCarte,
  questionNatureDeLaDemande,
  questionNiveauDeCarte,
  questionNiveauDeLAssistant,
  questionUrgence,
  questionsDePertinence,
  questionsProposition,
  signatureDuDossier,
  tronquer,
  MODELE_LAYA,
  PERTINENCE_MAX,
  SEUIL_DOUBLON,
  SEUIL_LAYA,
  DELAI_LAYA_MS,
  usageAllume,
  reponseDepuisLaya,
  verdictComprehension,
  verdictInteret,
  verdictUrgence,
  SEUILS,
  REGLAGES_DES_USAGES,
  type ReglageDUsage,
} from '@beluga/shared';
import crypto from 'node:crypto';
import { interrogerLaya, layaPret } from './laya.js';
import { etatDeLaNuit, type EtatDeLaNuit } from './laya-nuit.js';
import { getDb } from './db.js';
import { getSettings } from './store.js';

/**
 * LE JUGE RAPIDE — le chemin d'appel, et lui seul.
 *
 * Une SEULE brique par laquelle passent tous les jugements, et un SEUL juge :
 * Laya, le modèle de décision posé sur cette machine (`server/src/laya.ts`).
 * Rien ne part sur le réseau, rien n'est facturé, aucune clé n'est lue. Les
 * garde-fous communs ne sont pas négociables :
 *
 *  1. UN DÉLAI, tenu par `interrogerLaya` lui-même — un par usage, et les
 *     appels passent un par un sur la machine. Un usage « express » (sur le
 *     chemin d'un tour) n'attend jamais un modèle qui dort.
 *  2. UN REPLI SYSTÉMATIQUE : tout échec — usage éteint, modèle absent, lent,
 *     peu sûr de lui, réponse hors liste — rend `undefined`. AUCUNE exception
 *     ne remonte : une fonction d'ici ne peut pas faire échouer un lancement,
 *     une fin de tour ni une nuit d'analyse.
 *  3. UN PLAFOND sur ce qui est posé : de quoi juger, jamais le dépôt.
 *
 * L'ACTIVATION est la PRÉSENCE de Laya sur la machine (`layaPret`), puis
 * l'interrupteur de chaque usage. `scripts/verif-jugement-rapide.mjs` prouve
 * qu'aucune requête réseau ne part.
 *
 * Les règles pures (questions, seuils, lecture des verdicts, tri) vivent dans
 * `shared/src/jugement-rapide.ts`, la lecture des réponses de Laya dans
 * `shared/src/laya.ts` — testables sans modèle.
 */

/* ------------------------------------------------------------------ */
/* L'ACTIVATION                                                        */
/* ------------------------------------------------------------------ */

/** Le juge est-il allumé ? Autrement dit : Laya est-il posé sur cette machine ? */
export function jugeAllume(): boolean {
  try {
    return layaPret();
  } catch {
    return false;
  }
}

/** Cet usage-là est-il allumé ? Éteindre l'un n'éteint jamais les autres. */
export function usageDuJugeAllume(usage: UsageDuJuge): boolean {
  const reglages = getSettings();
  return usageAllume(usage, reglages.jugeEteints, reglages.jugeAllumes);
}

/* ------------------------------------------------------------------ */
/* LA TRACE                                                            */
/* ------------------------------------------------------------------ */

interface LigneTrace {
  id: number;
  usage_cle: string;
  question: string;
  reponse: string;
  confiance: number | null;
  latence_ms: number;
  suite: string;
  issue: string;
  jetons_entree: number;
  jetons_sortie: number;
  card_id: string | null;
  project_id: string | null;
  at: number;
}

function depuisLaLigne(ligne: LigneTrace): TraceDeJugement {
  return {
    id: ligne.id,
    usage: ligne.usage_cle,
    question: ligne.question,
    reponse: ligne.reponse,
    confiance: ligne.confiance,
    latenceMs: ligne.latence_ms,
    suite: ligne.suite,
    issue: ligne.issue === 'repondu' ? 'repondu' : 'echec',
    jetonsEntree: ligne.jetons_entree,
    jetonsSortie: ligne.jetons_sortie,
    cardId: ligne.card_id,
    projectId: ligne.project_id,
    at: ligne.at,
  };
}

/** Les derniers jugements rendus, le plus récent d'abord. */
export function listerLesTraces(limite = 100, usage?: string): TraceDeJugement[] {
  try {
    const lignes = usage
      ? (getDb()
          .prepare('SELECT * FROM jugement_traces WHERE usage_cle = ? ORDER BY at DESC, id DESC LIMIT ?')
          .all(usage, limite) as LigneTrace[])
      : (getDb()
          .prepare('SELECT * FROM jugement_traces ORDER BY at DESC, id DESC LIMIT ?')
          .all(limite) as LigneTrace[]);
    return lignes.map(depuisLaLigne);
  } catch {
    return [];
  }
}

/**
 * ÉCRIRE UNE TRACE NE PEUT PAS FAIRE TOMBER UN JUGEMENT. Une base verrouillée
 * ou une table absente (base partielle d'un contrôle) se tait : la trace est un
 * outil de relecture, pas une condition de fonctionnement.
 */
function tracer(trace: Omit<TraceDeJugement, 'id'>): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO jugement_traces
           (usage_cle, question, reponse, confiance, latence_ms, suite, issue, jetons_entree, jetons_sortie, card_id, project_id, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        trace.usage,
        trace.question,
        trace.reponse,
        trace.confiance ?? null,
        trace.latenceMs,
        trace.suite,
        trace.issue,
        trace.jetonsEntree,
        trace.jetonsSortie,
        trace.cardId ?? null,
        trace.projectId ?? null,
        trace.at,
      );
  } catch {
    // Voir le commentaire ci-dessus : une trace perdue ne casse rien.
  }
}

/** La suite donnée au dernier jugement d'un usage : ce que l'application a décidé. */
function noterLaSuite(usage: string, suite: string): void {
  try {
    getDb()
      .prepare(
        `UPDATE jugement_traces SET suite = ?
           WHERE id = (SELECT id FROM jugement_traces WHERE usage_cle = ? ORDER BY id DESC LIMIT 1)`,
      )
      .run(suite, usage);
  } catch {
    // Idem : la relecture perd une phrase, le produit ne perd rien.
  }
}

/* ------------------------------------------------------------------ */
/* L'APPEL, AVEC SES GARDE-FOUS                                        */
/* ------------------------------------------------------------------ */

export interface ContexteDuJugement {
  usage: UsageDuJuge;
  cardId?: string;
  projectId?: string;
  /** Ce que l'application fera du verdict, en une phrase, pour la trace. */
  suite?: string;
}

/** La force d'un verdict, pour la trace : probabilité, confiance ou note. */
function forceDuVerdict(reponses: Record<string, ReponseDuJuge>): number | undefined {
  const premiere = Object.values(reponses)[0];
  if (!premiere) return undefined;
  if (premiere.type === 'noul') return premiere.noul;
  if (premiere.type === 'choice') return premiere.confidence;
  return premiere.confidence;
}

/** Le plafond, en signes, de l'état recopié dans une trace. */
const PLAFOND_ETAT_TRACE = 3000;

/**
 * L'ÉTAT, RÉDUIT POUR LA TRACE — AVANT d'être sérialisé.
 *
 * Couper le JSON final au signe près laissait une trace illisible (accolade
 * ouverte, chaîne tronquée en plein mot). On réduit donc chaque TEXTE de
 * l'état, puis on sérialise : la trace reste un JSON valide, que l'écran et un
 * humain relisent tels quels.
 */
function etatPourLaTrace(etat: unknown, plafond = PLAFOND_ETAT_TRACE): unknown {
  if (typeof etat === 'string') return tronquer(etat, plafond);
  if (Array.isArray(etat)) {
    const part = Math.max(200, Math.floor(plafond / Math.max(1, etat.length)));
    return etat.map((element) => etatPourLaTrace(element, part));
  }
  if (etat && typeof etat === 'object') {
    const entrees = Object.entries(etat as Record<string, unknown>);
    const part = Math.max(200, Math.floor(plafond / Math.max(1, entrees.length)));
    return Object.fromEntries(entrees.map(([cle, valeur]) => [cle, etatPourLaTrace(valeur, part)]));
  }
  return etat;
}

/** La question telle que la trace la garde : un JSON valide, état réduit. */
function questionPourLaTrace(etat: unknown, questions: Record<string, QuestionDuJuge>): string {
  return JSON.stringify({ state: etatPourLaTrace(etat), model: MODELE_LAYA, questions });
}

/**
 * JUGER ICI, SANS RÉSEAU ET SANS FACTURE.
 *
 * Toutes les questions d'un jugement partent en UN passage : Laya les lit
 * ensemble sur le même état. TOUT OU RIEN par défaut — si une seule question
 * reste sans réponse exploitable (confiance sous le seuil, valeur hors liste),
 * on rend un MOTIF d'échec, jamais un verdict à moitié rendu. Un usage
 * `partiel` (la pertinence, une question par document) garde au contraire les
 * réponses sûres et laisse les autres de côté.
 */
async function jugerEnLocal(
  etat: unknown,
  questions: Record<string, QuestionDuJuge>,
  reglage: ReglageDUsage = {},
): Promise<{ reponses: Record<string, ReponseDuJuge> } | { motif: string }> {
  if (!layaPret()) return { motif: 'Laya n’est pas installé sur cette machine' };
  if (!Object.keys(questions).length) return { motif: 'aucune question posée' };
  const brutes = await interrogerLaya({
    etat,
    questions,
    delaiMs: reglage.delaiMs ?? DELAI_LAYA_MS,
    express: reglage.express,
  });
  if (!brutes) {
    return {
      motif: reglage.express
        ? 'Laya n’a pas répondu à temps (modèle en cours de chargement, ou file occupée)'
        : 'aucune réponse de Laya (délai, mémoire trop juste ou modèle indisponible)',
    };
  }
  const reponses: Record<string, ReponseDuJuge> = {};
  for (const [cle, question] of Object.entries(questions)) {
    const reponse = reponseDepuisLaya(question, brutes[cle], reglage.seuil ?? SEUIL_LAYA);
    if (reponse) reponses[cle] = reponse;
    else if (!reglage.partiel) {
      const brute = brutes[cle];
      return {
        motif: `question « ${cle} » : réponse « ${brute?.choice ?? brute?.score ?? brute?.noul ?? '—'} » sous le seuil ou hors liste`,
      };
    }
  }
  if (!Object.keys(reponses).length) return { motif: 'aucune réponse assez sûre' };
  return { reponses };
}

/**
 * UN APPEL, UN VERDICT — OU RIEN.
 *
 * Rend les réponses de Laya, ou `undefined` si quoi que ce soit s'est mal
 * passé. Ne lance JAMAIS : chaque appelant a son chemin « pas de réponse =
 * comportement d'avant », et ce contrat doit tenir même sur une panne.
 */
export async function interroger(
  etat: unknown,
  questions: Record<string, QuestionDuJuge>,
  ctx: ContexteDuJugement,
): Promise<Record<string, ReponseDuJuge> | undefined> {
  // LA PORTE — l'usage est-il allumé ? Éteint, Laya n'est même pas sollicité.
  if (!usageDuJugeAllume(ctx.usage)) return undefined;

  const depart = Date.now();
  let issue: { reponses: Record<string, ReponseDuJuge> } | { motif: string };
  try {
    issue = await jugerEnLocal(etat, questions, REGLAGES_DES_USAGES[ctx.usage]);
  } catch (err) {
    issue = { motif: (err as Error)?.message || 'erreur inattendue' };
  }

  if ('reponses' in issue) {
    tracer({
      usage: ctx.usage,
      question: questionPourLaTrace(etat, questions),
      reponse: JSON.stringify(issue.reponses),
      confiance: forceDuVerdict(issue.reponses) ?? null,
      latenceMs: Date.now() - depart,
      suite: ctx.suite ?? '',
      issue: 'repondu',
      /* Aucun jeton facturé : le modèle tourne sur cette machine. */
      jetonsEntree: 0,
      jetonsSortie: 0,
      cardId: ctx.cardId,
      projectId: ctx.projectId,
      at: Date.now(),
    });
    return issue.reponses;
  }

  tracer({
    usage: ctx.usage,
    question: questionPourLaTrace(etat, questions),
    reponse: tronquer(issue.motif, 300),
    confiance: null,
    latenceMs: Date.now() - depart,
    suite: 'repli : comportement d’avant, rien n’est bloqué',
    issue: 'echec',
    jetonsEntree: 0,
    jetonsSortie: 0,
    cardId: ctx.cardId,
    projectId: ctx.projectId,
    at: Date.now(),
  });
  return undefined;
}

/* ------------------------------------------------------------------ */
/* LES TROIS JUGEMENTS                                                 */
/* ------------------------------------------------------------------ */

/** L'empreinte d'un texte : rejuger deux fois la même chose ne sert à rien. */
export function empreinte(texte: string): string {
  return crypto.createHash('sha1').update(texte).digest('hex').slice(0, 16);
}

/**
 * 1. CE QUI A ÉTÉ COMPRIS SUFFIT-IL À LANCER LE TRAVAIL ?
 *
 * LE SEUL JUGEMENT QUI SE LIT À L'ÉCRAN, et il ne s'y lit qu'en BARRES. Il
 * porte sur le DOSSIER RÉEL transmis à celui qui exécutera — le texte compris,
 * les hypothèses assumées, la découpe technique préparée — jamais sur le champ
 * « description » de la carte, qui n'est qu'un résumé et souvent vide.
 *
 * Rendu `undefined` = pas d'indicateur du tout, et le lancement se comporte
 * exactement comme avant. Un verdict à une barre n'empêche JAMAIS de lancer.
 */
export async function jugerLaComprehension(
  carte: { id: string; projectId: string },
  dossier: DossierAJuger,
): Promise<JugementsDeCarte['comprehension']> {
  const reponses = await interroger(dossier, questionComprehension(), {
    usage: 'comprehension-carte',
    cardId: carte.id,
    projectId: carte.projectId,
    suite: 'indicateur à trois barres dans la barre d’écriture ; le lancement reste possible',
  });
  const verdict = verdictComprehension(reponses?.score, reponses?.motif, Date.now());
  if (!verdict) return undefined;
  return { ...verdict, empreinte: empreinte(signatureDuDossier(dossier)) };
}

/**
 * 2. QUE VAUT CETTE PROPOSITION DE LA NUIT ?
 *
 * Deux notes — le gain, l'ampleur — d'où un rang. La nuit continue de ne faire
 * que PROPOSER : le rang change l'ORDRE, jamais le fait de proposer.
 */
export async function noterUneProposition(
  proposition: { titre: string; description: string },
  ctx: { projectId?: string },
): Promise<JugementsDeCarte['interet']> {
  const reponses = await interroger(
    { titre: tronquer(proposition.titre, 300), description: tronquer(proposition.description, 3000) },
    questionsProposition(),
    {
      usage: 'tri-propositions',
      projectId: ctx.projectId,
      suite: 'ordre des propositions de la nuit ; aucune n’est retirée',
    },
  );
  return verdictInteret(reponses?.gain, reponses?.ampleur, Date.now());
}

/**
 * 3. CETTE DEMANDE ENTRANTE PRESSE-T-ELLE ?
 *
 * Sert à ORDONNER ce qui attend. Ne lance rien toute seule et ne saute aucune
 * validation existante.
 */
export async function jugerLUrgence(
  demande: { titre: string; description: string; origine: string },
  ctx: { cardId?: string; projectId?: string },
): Promise<JugementsDeCarte['urgence']> {
  const reponses = await interroger(
    {
      titre: tronquer(demande.titre, 300),
      description: tronquer(demande.description, 3000),
      arriveePar: demande.origine,
    },
    questionUrgence(),
    {
      usage: 'urgence-demande',
      cardId: ctx.cardId,
      projectId: ctx.projectId,
      suite: 'ordre de traitement ; aucun lancement, aucune validation sautée',
    },
  );
  return verdictUrgence(reponses?.urgente, Date.now());
}

/**
 * 4. QUEL GENRE DE TRAVAIL, POUR UNE CARTE AUTOMATIQUE ? (DEC-248)
 *
 * Programmation avancée ou administratif, pour choisir le moteur d'une carte
 * proposée par l'analyse. Rend « indetermine » sur tout échec :
 * `moteurDuTriAutomatique` retombe alors sur son moteur par défaut. Jamais
 * appelé sur une carte réglée à la main — cette garde vit chez l'appelant
 * (`reglagesProposes`, `server/src/tools.ts`).
 */
export async function classerLeGenreDeLaCarte(
  titre: string,
  description: string,
  ctx: { projectId?: string } = {},
): Promise<GenreCarte> {
  const reponses = await interroger(
    { titre: tronquer(titre, 300), description: tronquer(description, 2500) },
    questionGenreDeCarte(),
    { usage: 'genre-carte-auto', projectId: ctx.projectId, suite: 'moteur de la carte automatique (Claude / GPT)' },
  );
  const genre = reponses?.genre;
  if (genre?.type !== 'choice') return 'indetermine';
  return genre.choice === 'programmation_avancee' || genre.choice === 'administratif' ? genre.choice : 'indetermine';
}

/**
 * 5. D'OÙ VIENT CETTE ERREUR QU'AUCUN MOTIF NE RECONNAÎT ?
 *
 * Panne extérieure ou défaut de l'application : de quoi afficher une phrase
 * simple au lieu du message brut. Rien = la phrase honnête « erreur inattendue ».
 */
export async function classerLaFamilleDeLErreur(brut: string): Promise<FamilleDErreur | undefined> {
  const reponses = await interroger(tronquer(brut, 2000), questionFamilleDErreur(), {
    usage: 'famille-erreur',
    suite: 'phrase simple affichée à la place du message technique',
  });
  return familleDeReponse(reponses?.famille);
}

/**
 * 6. QUEL NIVEAU PROPOSER POUR CETTE CARTE ?
 *
 * Une SUGGESTION rendue à l'agent qui prépare la carte : elle ne remplace
 * jamais un niveau déjà posé (DEC-213) et reste sous le plancher et le plafond
 * automatiques (`shared/src/niveau-agent.ts`).
 */
export async function proposerUnNiveau(
  carte: { titre: string; description: string },
  ctx: { cardId?: string; projectId?: string },
): Promise<NiveauProposable | undefined> {
  const reponses = await interroger(
    { titre: tronquer(carte.titre, 300), description: tronquer(carte.description, 3000) },
    questionNiveauDeCarte(),
    { usage: 'niveau-carte', cardId: ctx.cardId, projectId: ctx.projectId, suite: 'niveau suggéré à l’agent ; rien n’est écrit sur la carte' },
  );
  return niveauPropose(reponses?.niveau);
}

/**
 * 6 bis. QUEL NIVEAU POUR CE MESSAGE À L'ASSISTANT DU ROBOT ?
 *
 * Express : si Laya dort ou doute, rien — l'appelant retombe sur « standard »
 * (`niveauDuTourDeLAssistant`). Le verdict reste sous le plafond réglé et ne
 * touche jamais un modèle posé à la main.
 */
export async function jugerLeNiveauDeLAssistant(texte: string): Promise<NiveauProposable | undefined> {
  if (!texte.trim()) return undefined;
  const reponses = await interroger(tronquer(texte, 2500), questionNiveauDeLAssistant(), {
    usage: 'niveau-assistant',
    suite: 'modèle de l’assistant pour ce message ; plafonné, repli standard',
  });
  return niveauPropose(reponses?.niveau);
}

/**
 * 7. CE PREMIER MESSAGE EST-IL UNE QUESTION OU UN TRAVAIL ?
 *
 * Rend une INDICATION à glisser dans la demande du cadrage — le cadrage garde
 * la décision (règle « Un tour de cadrage a DEUX fins »). Express : si Laya
 * dort, rien, tout de suite.
 */
export async function indiquerLaNatureDeLaDemande(
  texte: string,
  ctx: { cardId?: string; projectId?: string },
): Promise<string> {
  if (!texte.trim()) return '';
  const reponses = await interroger(tronquer(texte, 2500), questionNatureDeLaDemande(), {
    usage: 'nature-demande',
    cardId: ctx.cardId,
    projectId: ctx.projectId,
    suite: 'indication glissée dans la demande du cadrage ; la décision lui reste',
  });
  return indicationDeNature(reponses?.nature);
}

/**
 * 8. CETTE CARTE PROPOSÉE DOUBLE-T-ELLE UNE CARTE OUVERTE ?
 *
 * Les candidates sont déjà PRÉSÉLECTIONNÉES par l'appelant (quelques cartes
 * proches) : Laya ne compare que des paires. Rend la première carte jugée
 * faire le même travail au-dessus de `SEUIL_DOUBLON`, ou rien.
 */
export async function chercherUnDoublon<T extends { id: string; title: string; description: string }>(
  proposee: { titre: string; description: string },
  candidates: readonly T[],
  ctx: { projectId?: string },
): Promise<T | undefined> {
  for (const carte of candidates.slice(0, 3)) {
    const reponses = await interroger(
      {
        proposee: { titre: tronquer(proposee.titre, 300), description: tronquer(proposee.description, 1200) },
        existante: { titre: tronquer(carte.title, 300), description: tronquer(carte.description, 1200) },
      },
      questionDoublon(),
      { usage: 'doublon-carte', cardId: carte.id, projectId: ctx.projectId, suite: 'proposition automatique refusée si doublon' },
    );
    const doublon = reponses?.doublon;
    if (doublon?.type === 'noul' && doublon.noul >= SEUIL_DOUBLON) return carte;
  }
  return undefined;
}

/**
 * 9. PARMI CES DOCUMENTS, LESQUELS SERVENT CETTE DEMANDE ?
 *
 * Rend les clés à GARDER, ou `undefined` quand le juge n'a rien dit — et
 * l'appelant garde alors tout. Les documents sont jugés par paquets de
 * `PERTINENCE_MAX`, en un passage chacun.
 */
export async function documentsPertinents(
  demande: string,
  documents: readonly DocumentAJuger[],
  ctx: { usage: 'pertinence-competences' | 'pertinence-memoire'; cardId?: string; projectId?: string },
): Promise<Set<string> | undefined> {
  if (!demande.trim() || !documents.length) return undefined;
  const gardees = new Set<string>();
  let juge = false;
  for (let i = 0; i < documents.length; i += PERTINENCE_MAX) {
    const paquet = documents.slice(i, i + PERTINENCE_MAX);
    const reponses = await interroger(tronquer(demande, 1500), questionsDePertinence(paquet), {
      usage: ctx.usage,
      cardId: ctx.cardId,
      projectId: ctx.projectId,
      suite: 'documents hors sujet écartés ; les incertains sont gardés',
    });
    if (reponses) juge = true;
    for (const cle of clesPertinentes(paquet, reponses)) gardees.add(cle);
  }
  return juge ? gardees : undefined;
}

/**
 * GARDER CE QUI SERT LA DEMANDE, SANS JAMAIS TOUCHER À L'INTOUCHABLE.
 *
 * Le geste commun du tri de la mémoire et des modes d'emploi : les éléments
 * `intouchable` (une règle P0, « À ne jamais supposer ») passent toujours et ne
 * sont même pas montrés au juge ; les autres sont jugés, et seuls ceux qu'il
 * dit franchement hors sujet tombent. Sans avis, la liste revient ENTIÈRE, dans
 * son ordre.
 */
export async function garderLesPertinents<T>(
  demande: string,
  elements: readonly T[],
  lire: { cle: (e: T) => string; texte: (e: T) => string; intouchable?: (e: T) => boolean },
  ctx: { usage: 'pertinence-competences' | 'pertinence-memoire'; cardId?: string; projectId?: string },
): Promise<T[]> {
  const aJuger = elements.filter((e) => !lire.intouchable?.(e));
  if (!aJuger.length) return [...elements];
  const gardees = await documentsPertinents(
    demande,
    aJuger.map((e) => ({ cle: lire.cle(e), texte: lire.texte(e) })),
    ctx,
  );
  if (!gardees) return [...elements];
  return elements.filter((e) => lire.intouchable?.(e) || gardees.has(lire.cle(e)));
}

/** Noter après coup ce qui a été décidé d'un verdict — pour relire les traces. */
export function suiteDuJugement(usage: UsageDuJuge, suite: string): void {
  noterLaSuite(usage, suite);
}

/* ------------------------------------------------------------------ */
/* CE QUE L'ÉCRAN DES RÉGLAGES LIT                                     */
/* ------------------------------------------------------------------ */

export interface EtatDuJuge {
  /** Laya est-il installé ? C'est CELA, l'interrupteur général. */
  allume: boolean;
  /** Les usages, avec leur interrupteur. */
  usages: { cle: string; titre: string; explication: string; allume: boolean }[];
  /** Les dernières traces et leur bilan : de quoi juger le juge. */
  traces: TraceDeJugement[];
  bilan: ReturnType<typeof bilanDesTraces>;
  /** L'entraînement de nuit : la version en service, et le compte rendu de la dernière nuit. */
  nuit: EtatDeLaNuit;
}

/** Tout ce que l'écran du juge affiche, en une seule lecture. */
export function etatDuJuge(limiteDesTraces = 50): EtatDuJuge {
  const { jugeEteints: eteints, jugeAllumes: allumes } = getSettings();
  const traces = listerLesTraces(limiteDesTraces);
  return {
    allume: jugeAllume(),
    usages: FICHES_DES_USAGES.map((fiche) => ({
      cle: fiche.cle,
      titre: fiche.titre,
      explication: fiche.explication,
      allume: usageAllume(fiche.cle, eteints, allumes),
    })),
    traces,
    bilan: bilanDesTraces(traces),
    nuit: etatDeLaNuit(),
  };
}
