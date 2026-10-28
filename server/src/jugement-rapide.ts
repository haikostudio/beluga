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
  questionUrgence,
  questionsDePertinence,
  questionsProposition,
  signatureDuDossier,
  tronquer,
  PERTINENCE_MAX,
  SEUIL_DOUBLON,
  SEUIL_JUGE,
  DELAI_JUGE_MS,
  ENDPOINT_JUGE,
  REPRISES_JUGE,
  type EtatDeLaCle,
  type LectureDuJuge,
  adresseDuJuge as adresseDansLesFiches,
  cleDuJuge as cleDansLesFiches,
  comprehensionParRegles,
  construireLaDemande,
  etatDepuisLeCode,
  ficheDuJuge,
  lireLaReponse,
  meriteUneReprise,
  reponseRetenue,
  usageAllume,
  verdictComprehension,
  verdictInteret,
  verdictUrgence,
  SEUILS,
  REGLAGES_DES_USAGES,
  type ReglageDUsage,
} from '@beluga/shared';
import crypto from 'node:crypto';
import { listerAcces } from './coffre-fort.js';
import { getDb } from './db.js';
import { log } from './logger.js';
import { getSettings } from './store.js';

/**
 * LE JUGE RAPIDE — le chemin d'appel, et lui seul.
 *
 * Une SEULE brique par laquelle passent tous les jugements, et un SEUL juge :
 * Jev, le modèle de décision de TypeSafe, appelé par son API. Rien ne se charge
 * sur cette machine. Les garde-fous communs ne sont pas négociables :
 *
 *  1. UN DÉLAI COURT (`DELAI_JUGE_MS`, ou celui de l'usage), tenu par un
 *     `AbortController`.
 *  2. UNE SEULE REPRISE, et seulement sur un à-coup (réseau, 429, 5xx).
 *  3. UN REPLI SYSTÉMATIQUE : tout échec — usage éteint, clé absente ou
 *     refusée, service lent ou en panne, réponse peu sûre ou hors liste — rend
 *     `undefined`. AUCUNE exception ne remonte : une fonction d'ici ne peut pas
 *     faire échouer un lancement, une fin de tour ni une nuit d'analyse.
 *  4. UN PLAFOND sur ce qui part : de quoi juger, jamais le dépôt.
 *
 * L'ACTIVATION est la PRÉSENCE d'une fiche TypeSafe au coffre-fort, puis
 * l'interrupteur de chaque usage. Sans fiche, AUCUNE requête ne part.
 * L'adresse lue sur la fiche permet aux contrôles de viser un faux serveur
 * (`scripts/verif-jugement-rapide.mjs`).
 *
 * Les règles pures (questions, seuils, lecture des réponses, note par règles)
 * vivent dans `shared/src/jugement-rapide.ts` — testables sans réseau.
 */

/* ------------------------------------------------------------------ */
/* L'ACTIVATION                                                        */
/* ------------------------------------------------------------------ */

/** La clé rangée au coffre, ou rien. Rien = le juge est éteint. */
export function cleDuJuge(): string | undefined {
  try {
    return cleDansLesFiches(listerAcces());
  } catch (err) {
    log.warn(`juge rapide : coffre illisible (${(err as Error).message})`);
    return undefined;
  }
}

/** L'adresse du service, telle que la fiche du coffre la donne. */
export function adresseDuJuge(): string {
  try {
    return adresseDansLesFiches(listerAcces());
  } catch {
    return ENDPOINT_JUGE;
  }
}

/** Le juge est-il allumé ? La question ne coûte qu'une lecture du coffre. */
export function jugeAllume(): boolean {
  return Boolean(cleDuJuge());
}

/** La fiche du coffre qui porte la clé, pour que l'écran sache laquelle corriger. */
export function ficheDuJugeAuCoffre(): { id: string; nom: string } | undefined {
  try {
    const fiche = ficheDuJuge(listerAcces());
    return fiche ? { id: fiche.id, nom: fiche.nom } : undefined;
  } catch {
    return undefined;
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
  return JSON.stringify({ ...construireLaDemande(etatPourLaTrace(etat), questions) });
}

type IssueDuJugement =
  | { reponses: Record<string, ReponseDuJuge>; jetonsEntree: number; jetonsSortie: number }
  | { motif: string; jetonsEntree?: number; jetonsSortie?: number };

/**
 * DEMANDER À JEV.
 *
 * Toutes les questions d'un jugement partent en UN appel : Jev les lit
 * ensemble sur le même état. TOUT OU RIEN par défaut — si une seule question
 * reste sans réponse exploitable (confiance sous le seuil, valeur hors liste),
 * on rend un MOTIF d'échec, jamais un verdict à moitié rendu. Un usage
 * `partiel` (la pertinence, une question par document) garde au contraire les
 * réponses sûres et laisse les autres de côté.
 */
async function jugerParJev(
  etat: unknown,
  questions: Record<string, QuestionDuJuge>,
  reglage: ReglageDUsage = {},
): Promise<IssueDuJugement> {
  if (!Object.keys(questions).length) return { motif: 'aucune question posée' };
  const cle = cleDuJuge();
  if (!cle) return { motif: 'aucune clé TypeSafe au coffre-fort : le juge est éteint' };
  const adresse = adresseDuJuge();
  const corps = JSON.stringify(construireLaDemande(etat, questions));
  const delai = reglage.delaiMs ?? DELAI_JUGE_MS;
  let motif = 'aucune réponse';
  let lu: LectureDuJuge | undefined;

  for (let essai = 0; essai <= REPRISES_JUGE && !lu; essai += 1) {
    const stop = new AbortController();
    const minuterie = setTimeout(() => stop.abort(), delai);
    try {
      const reponse = await fetch(adresse, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
        body: corps,
        signal: stop.signal,
      });
      if (!reponse.ok) {
        const texte = await reponse.text().catch(() => '');
        motif = `HTTP ${reponse.status} ${texte.slice(0, 300)}`.trim();
        // Une clé refusée ne se retente pas : la seconde tentative serait refusée aussi.
        if (!meriteUneReprise(reponse.status)) break;
        continue;
      }
      lu = lireLaReponse(await reponse.json().catch(() => null));
      if (!lu) {
        motif = 'réponse illisible';
        break;
      }
    } catch (err) {
      motif = stop.signal.aborted ? `délai de ${delai} ms dépassé` : (err as Error).message;
      // Un délai dépassé ne se retente pas : on doublerait l'attente pour rien.
      if (stop.signal.aborted) break;
    } finally {
      clearTimeout(minuterie);
    }
  }
  if (!lu) return { motif };

  const jetons = { jetonsEntree: lu.jetonsEntree, jetonsSortie: lu.jetonsSortie };
  const reponses: Record<string, ReponseDuJuge> = {};
  for (const [cleQuestion, question] of Object.entries(questions)) {
    const brute = lu.reponses[cleQuestion];
    const reponse = reponseRetenue(question, brute, reglage.seuil ?? SEUIL_JUGE);
    if (reponse) reponses[cleQuestion] = reponse;
    else if (!reglage.partiel) {
      const valeur =
        brute?.type === 'choice' ? brute.choice : brute?.type === 'score' ? brute.score : brute?.type === 'noul' ? brute.noul : '—';
      return { motif: `question « ${cleQuestion} » : réponse « ${valeur} » sous le seuil ou hors liste`, ...jetons };
    }
  }
  if (!Object.keys(reponses).length) return { motif: 'aucune réponse assez sûre', ...jetons };
  return { reponses, ...jetons };
}

/**
 * UN APPEL, UN VERDICT — OU RIEN.
 *
 * Rend les réponses de Jev, ou `undefined` si quoi que ce soit s'est mal
 * passé. Ne lance JAMAIS : chaque appelant a son chemin « pas de réponse =
 * comportement d'avant », et ce contrat doit tenir même sur une panne.
 */
export async function interroger(
  etat: unknown,
  questions: Record<string, QuestionDuJuge>,
  ctx: ContexteDuJugement,
): Promise<Record<string, ReponseDuJuge> | undefined> {
  // LA PORTE — l'usage est-il allumé ? Éteint, on ne lit même pas le coffre.
  if (!usageDuJugeAllume(ctx.usage)) return undefined;

  const depart = Date.now();
  let issue: IssueDuJugement;
  try {
    issue = await jugerParJev(etat, questions, REGLAGES_DES_USAGES[ctx.usage]);
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
      jetonsEntree: issue.jetonsEntree,
      jetonsSortie: issue.jetonsSortie,
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
    /* Une réponse jugée trop peu sûre a quand même été facturée : on la compte. */
    jetonsEntree: issue.jetonsEntree ?? 0,
    jetonsSortie: issue.jetonsSortie ?? 0,
    cardId: ctx.cardId,
    projectId: ctx.projectId,
    at: Date.now(),
  });
  return undefined;
}

/**
 * TESTER LA CLÉ, SUR-LE-CHAMP : acceptée, refusée, injoignable — ou absente
 * quand rien n'est rangé. L'appel est un jugement trivial : quelques dizaines
 * de jetons.
 */
export async function testerLaCle(): Promise<{ etat: EtatDeLaCle; detail?: string }> {
  const cle = cleDuJuge();
  if (!cle) return { etat: 'absente' };
  const stop = new AbortController();
  const minuterie = setTimeout(() => stop.abort(), DELAI_JUGE_MS);
  try {
    const reponse = await fetch(adresseDuJuge(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        construireLaDemande('Un essai de connexion, sans autre contenu.', {
          essai: {
            type: 'noul',
            instructions: 'Ce texte est-il un essai de connexion ?',
            criteria: { true: 'C’est un essai', false: 'Ce n’est pas un essai' },
          },
        }),
      ),
      signal: stop.signal,
    });
    const etat = etatDepuisLeCode(reponse.status);
    if (etat === 'acceptee') return { etat };
    const texte = await reponse.text().catch(() => '');
    return { etat, detail: `HTTP ${reponse.status} ${texte.slice(0, 200)}`.trim() };
  } catch (err) {
    return {
      etat: 'injoignable',
      detail: stop.signal.aborted ? `aucune réponse en ${DELAI_JUGE_MS} ms` : (err as Error).message,
    };
  } finally {
    clearTimeout(minuterie);
  }
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
 * QUAND JEV SE TAIT — clé absente, panne, délai, confiance sous le palier —,
 * la note vient des RÈGLES (`comprehensionParRegles`) : une compréhension
 * rendue n'est jamais laissée sans barres. L'interrupteur de l'usage reste la
 * seule façon d'éteindre la jauge. Un verdict à une barre n'empêche JAMAIS de
 * lancer.
 */
export async function jugerLaComprehension(
  carte: { id: string; projectId: string },
  dossier: DossierAJuger,
): Promise<JugementsDeCarte['comprehension']> {
  if (!usageDuJugeAllume('comprehension-carte')) return undefined;
  const reponses = await interroger(dossier, questionComprehension(), {
    usage: 'comprehension-carte',
    cardId: carte.id,
    projectId: carte.projectId,
    suite: 'indicateur à trois barres dans la barre d’écriture ; le lancement reste possible',
  });
  const verdict = verdictComprehension(reponses?.score, reponses?.motif, Date.now()) ?? comprehensionParRegles(dossier, Date.now());
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
 * 7. CE PREMIER MESSAGE EST-IL UNE QUESTION OU UN TRAVAIL ?
 *
 * Rend une INDICATION à glisser dans la demande du cadrage — le cadrage garde
 * la décision (règle « Un tour de cadrage a DEUX fins »). Délai court :
 * si Jev traîne, rien.
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
 * proches) : Jev ne compare que des paires. Rend la première carte jugée
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

/* ------------------------------------------------------------------ */
/* CE QUE L'ÉCRAN DES RÉGLAGES LIT                                     */
/* ------------------------------------------------------------------ */

export interface EtatDuJuge {
  /** Une clé TypeSafe est-elle rangée au coffre ? C'est CELA, l'interrupteur général. */
  allume: boolean;
  /** La fiche du coffre qui porte la clé, pour la corriger depuis l'écran. */
  fiche?: { id: string; nom: string };
  /** Les usages, avec leur interrupteur. */
  usages: { cle: string; titre: string; explication: string; allume: boolean }[];
  /** Les dernières traces et leur bilan : de quoi juger le juge. */
  traces: TraceDeJugement[];
  bilan: ReturnType<typeof bilanDesTraces>;
}

/** Tout ce que l'écran du juge affiche, en une seule lecture. */
export function etatDuJuge(limiteDesTraces = 50): EtatDuJuge {
  const { jugeEteints: eteints, jugeAllumes: allumes } = getSettings();
  const traces = listerLesTraces(limiteDesTraces);
  return {
    allume: jugeAllume(),
    fiche: ficheDuJugeAuCoffre(),
    usages: FICHES_DES_USAGES.map((fiche) => ({
      cle: fiche.cle,
      titre: fiche.titre,
      explication: fiche.explication,
      allume: usageAllume(fiche.cle, eteints, allumes),
    })),
    traces,
    bilan: bilanDesTraces(traces),
  };
}
