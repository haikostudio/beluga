import fs from 'node:fs';
import path from 'node:path';
import {
  GENRE_SOURCE_COMPETENCE,
  PORTEE_DES_COMPETENCES,
  PORTEE_GLOBALE,
  communeEtendue,
  competencesValidees,
  correspondanceAvecNuance,
  correspondanceDeLaCompetence,
  REPONSE_PAS_UTILE,
  REPONSE_UTILISER,
  etatApresReponse,
  ficheServieAuProjet,
  ficheProposableAuCadrage,
  nuancesDeLaCommune,
  nomDeCompetenceDeLUnite,
  questionDeCompetence,
  quandSenServir,
  rattacherLesNuances,
  retenirLesPropositions,
  retenirParLeTri,
  demandePourLeTri,
  ordreDesCompetencesProches,
  texteDeFichePourLeTri,
  PRESELECTION_DU_TRI,
  PROPOSITIONS_PAR_CARTE_MAX,
  PROPOSITIONS_PAR_RECHERCHE_MAX,
  texteDIssueDesPropositions,
  texteDesCompetencesValidees,
  titreLisibleDeCompetence,
  type AgentQuestion,
  type Card,
  type Competence,
  type CompetenceProposee,
  CONSIGNE_DES_FICHES_PROTEGEES,
} from '@beluga/shared';
import { ouvrirLaFicheProtegee } from './lot-competences-clients.js';
import { bus } from './bus.js';
import { compter, listerCompetences } from './competences.js';
import { chercherUnitesMelees, proximitesParLeSens, unitesDeLaSource } from './connaissances.js';
import { garderLesPertinents } from './jugement-rapide.js';
import { log } from './logger.js';
import { noterParLeTri } from './vectoriseur.js';
import * as store from './store.js';

/**
 * LES COMPÉTENCES PROPOSÉES PAR BELUGA AU CADRAGE — retenues d'office.
 *
 * Les règles (plafonds, tri, textes) vivent dans
 * `shared/src/proposition-competence.ts`. Ici : chercher, écrire les fiches
 * trouvées sur la carte DÉJÀ À L'ÉTAT « utilisee », et laisser l'utilisateur en
 * écarter une d'une croix tant que la carte n'est pas lancée.
 *
 * LE POINT D'ENTRÉE EST LE GESTE « memoire chercher » DU CADRAGE, que le démon
 * impose déjà à chaque tour (verrou d'analyse). Sa réponse n'est PLUS retenue
 * (décision de l'utilisateur, 08.10.2026) : elle part aussitôt, avec la liste
 * des compétences retenues, et le cadrage continue sans attendre un clic.
 */

/** La recherche et le juge ne font jamais attendre un cadrage plus que cela : sans résultat, rien n'est proposé. */
const DELAI_DE_RECHERCHE_MS = 12_000;
/**
 * Le tri par le modèle qui lit, au cadrage : ~2 à 4 s pour 24 fiches une fois chargé (jusqu'à 7 s sur un serveur
 * chargé), ~3 à 8 s de chargement à froid. Il prend au plus ce temps, et jamais plus que ce qui reste avant
 * `DELAI_DE_RECHERCHE_MS` moins une seconde : la saillance seule décide alors — et le modèle, chargé
 * entre-temps, sert la fois suivante.
 */
const DELAI_DU_TRI_AU_CADRAGE_MS = 9_000;

/** Le dernier tour (message) où l'on a cherché pour cette carte : UNE recherche de compétences par tour. */
const dernierTourCherche = new Map<string, string>();
/** Les cartes dont la recherche est en vol : deux appels simultanés n'en posent pas deux séries. */
const enVol = new Set<string>();

export interface CompetenceAProposer {
  nom: string;
  titre: string;
  correspondance: string;
  chemin: string;
  score: number;
}

/**
 * LES PROPOSITIONS, TRIÉES PAR LE MODÈLE QUI LIT (carte 71e1006a, 14/11/2026). La présélection (fusion des rangs
 * du sens et de la mêlée, `ordreDesCompetencesProches`) passe au modèle de tri ; ce qu'il note nettement est
 * proposé d'abord (`retenirParLeTri`), puis la saillance d'avant (`retenirLesPropositions`) complète jusqu'au
 * plafond — les deux signaux se rattrapent : le tri trouve ce qui ne se détachait pas par le sens (abonnés qui
 * résilient, parcours d'inscription), la saillance garde ce que le tri note mal (« faire un devis »). Sans note
 * (modèle absent, trop lent, en panne), la saillance seule décide, comme avant.
 */
async function retenirAvecLeTri<T extends { nom: string; proximite: number; rang: number; bibliotheque: boolean; fiche: Competence }>(
  texte: string,
  sujets: readonly T[],
  dejaProposees: readonly string[],
  delaiMs: number,
): Promise<T[]> {
  const saillantes = retenirLesPropositions(sujets, dejaProposees);
  const place = Math.min(PROPOSITIONS_PAR_RECHERCHE_MAX, PROPOSITIONS_PAR_CARTE_MAX - new Set(dejaProposees).size);
  if (place <= 0) return saillantes;
  const parSens = [...sujets].sort((a, b) => b.proximite - a.proximite);
  const parNom = new Map(sujets.map((s) => [s.nom, s] as const));
  const aTrier = ordreDesCompetencesProches(
    parSens.map((s, i) => ({ nom: s.nom, rangSens: i, rangMele: Number.isFinite(s.rang) ? s.rang : undefined })),
  )
    .slice(0, PRESELECTION_DU_TRI)
    .map((nom) => parNom.get(nom)!);
  const notes = await noterParLeTri(
    demandePourLeTri(texte),
    aTrier.map((s) => texteDeFichePourLeTri({ titre: titreLisibleDeCompetence(s.nom), quandSenServir: quandSenServir(s.fiche), themes: s.fiche.themes })),
    delaiMs,
  );
  if (!notes) return saillantes;
  const parLeTri = retenirParLeTri(
    aTrier.map((s, i) => ({ ...s, note: notes[i]! })),
    dejaProposees,
    place,
  );
  const retenues = new Map<string, T>(parLeTri.map((s) => [s.nom, parNom.get(s.nom)!]));
  for (const s of saillantes) if (retenues.size < place && !retenues.has(s.nom)) retenues.set(s.nom, s);
  return [...retenues.values()];
}

/**
 * CE QUE BELUGA PROPOSERAIT POUR CETTE DEMANDE. Les deux recherches de la
 * mémoire — la mêlée (mots + sens) et la proximité brute par le sens —,
 * restreintes aux unités de compétence du classeur global ; seules comptent les
 * fiches EN SERVICE et servies à CE projet, bibliothèques comprises — sauf celles
 * laissées au jugement de l'agent d'exécution (`ficheProposableAuCadrage`). La règle
 * (`retenirLesPropositions`) ne garde que celles qui se DÉTACHENT de la foule
 * et que les deux recherches classent en tête ; le juge rapide, s'il est allumé,
 * écarte encore le hors sujet.
 */
export async function competencesAProposer(
  demande: string,
  projet: { id: string; name: string },
  cardId?: string,
  dejaProposees: readonly string[] = [],
): Promise<CompetenceAProposer[]> {
  const debut = Date.now();
  const texte = demande.trim().slice(0, 1500);
  if (!texte) return [];
  const fiches = new Map<string, Competence>(
    listerCompetences()
      .filter((fiche) => ficheServieAuProjet(fiche, projet.name) && ficheProposableAuCadrage(fiche))
      .map((fiche) => [fiche.nom, fiche]),
  );
  if (!fiches.size) return [];

  const visee = { portees: [PORTEE_GLOBALE], types: ['operation' as const] };
  const [melees, proximites] = await Promise.all([
    chercherUnitesMelees(texte, { projectId: projet.id, ...visee, limite: 40 }),
    proximitesParLeSens(texte, visee),
  ]);
  // Sans mesure par le sens (vectoriseur absent ou trop lent), on ne sait pas : rien n'est proposé.
  if (!proximites.size) return [];

  /* La place de chaque fiche parmi les COMPÉTENCES de la recherche mêlée. */
  const rangs = new Map<string, number>();
  for (const { unite } of melees) {
    const nom = nomDeCompetenceDeLUnite(unite);
    if (nom && fiches.has(nom) && !rangs.has(nom)) rangs.set(nom, rangs.size);
  }
  /* LA FOULE : toutes les fiches servies au projet, avec leur proximité brute. */
  const candidates: { nom: string; proximite: number; rang: number; bibliotheque: boolean; fiche: Competence }[] = [];
  const vues = new Set<string>();
  for (const unite of unitesDeLaSource(PORTEE_DES_COMPETENCES, GENRE_SOURCE_COMPETENCE)) {
    const nom = nomDeCompetenceDeLUnite(unite);
    const fiche = nom ? fiches.get(nom) : undefined;
    const proximite = proximites.get(unite.id);
    if (!fiche || proximite === undefined || vues.has(fiche.nom)) continue;
    vues.add(fiche.nom);
    candidates.push({
      nom: fiche.nom,
      proximite,
      rang: rangs.get(fiche.nom) ?? Number.POSITIVE_INFINITY,
      // Une fiche de bibliothèque (P3) part avec un handicap dans la mêlée : son rang est jugé à part.
      bibliotheque: Boolean(fiche.bibliotheque),
      fiche,
    });
  }
  /* UN SUJET, UN ENCADRÉ : la nuance propre se fond dans sa commune (`rattacherLesNuances`). */
  const servies = [...fiches.values()];
  const sujets = rattacherLesNuances(candidates, (nom) => {
    const fiche = fiches.get(nom);
    return fiche ? communeEtendue(fiche, servies)?.nom : undefined;
  });
  const delaiDuTri = Math.min(DELAI_DU_TRI_AU_CADRAGE_MS, DELAI_DE_RECHERCHE_MS - 1_000 - (Date.now() - debut));
  const saillantes = await retenirAvecLeTri(texte, sujets, dejaProposees, delaiDuTri);
  if (!saillantes.length) return [];
  // Le juge rapide, quand son usage est allumé, écarte encore le franchement hors sujet ; sans avis, tout passe.
  const jugees = await garderLesPertinents(
    texte,
    saillantes,
    { cle: (c) => c.nom, texte: (c) => `${c.nom} : ${quandSenServir(c.fiche)}` },
    { usage: 'pertinence-competences', cardId, projectId: projet.id },
  );
  return jugees.map((c) => ({
    nom: c.nom,
    titre: titreLisibleDeCompetence(c.nom),
    correspondance: correspondanceAvecNuance(correspondanceDeLaCompetence(quandSenServir(c.fiche)), projet.name, c.nuances),
    chemin: c.fiche.fichier,
    score: c.proximite,
  }));
}

/** La même recherche, bornée dans le temps et sans jamais d'exception : un échec ne propose rien. */
async function chercherSansBloquer(
  demande: string,
  projet: { id: string; name: string },
  cardId: string,
  deja: readonly string[],
): Promise<CompetenceAProposer[]> {
  let minuterie: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      competencesAProposer(demande, projet, cardId, deja),
      new Promise<CompetenceAProposer[]>((resolve) => {
        minuterie = setTimeout(() => resolve([]), DELAI_DE_RECHERCHE_MS);
        minuterie.unref?.();
      }),
    ]);
  } catch (err) {
    log.warn(`compétences à proposer : recherche abandonnée — ${(err as Error).message}`);
    return [];
  } finally {
    if (minuterie) clearTimeout(minuterie);
  }
}

function ecrireSurLaCarte(cardId: string, modifier: (avant: CompetenceProposee[]) => CompetenceProposee[]): Card | null {
  const card = store.getCard(cardId);
  if (!card) return null;
  const avant = card.parcours?.competencesProposees ?? [];
  const apres = modifier(avant);
  const ecrite = store.saveCard({ ...card, parcours: { ...card.parcours, plans: card.parcours?.plans ?? [], competencesProposees: apres } });
  bus.emit({ type: 'card.upsert', card: ecrite });
  return ecrite;
}

export interface PropositionsRetenues {
  /** Les lignes à attacher au message du tour, une par compétence — nées répondues « Utiliser ». */
  questions: AgentQuestion[];
  /** Le résultat de mémoire, suivi des compétences retenues : rendu tel quel à l'agent. */
  texte: string;
}

/**
 * LE CADRAGE VIENT DE CHERCHER DANS LA MÉMOIRE : Beluga a-t-il des compétences
 * à proposer ? Les fiches trouvées s'écrivent sur la carte à l'état
 * « utilisee » et partiront avec l'agent d'exécution, sauf si l'utilisateur les
 * écarte avant le lancement (`ecarterLaCompetence`). Rend `null` quand il n'y a
 * rien à faire — pas un cadrage, personne devant l'écran
 * (`questionsInterdites`), déjà cherché dans ce tour, rien de pertinent,
 * plafond atteint.
 */
export async function proposerAuCadrage(entree: {
  agent: { id: string; role: string; cardId?: string; projectId: string };
  /** Le tour vivant de l'agent : son message, et s'il interdit les questions. */
  tour?: { messageId?: string; questionsInterdites?: boolean };
  /** Ce que l'agent a cherché dans la mémoire. */
  mots: string;
  texteMemoire: string;
  /** La recherche à employer — celle du démon par défaut ; les tests en donnent une à eux. */
  chercher?: typeof chercherSansBloquer;
}): Promise<PropositionsRetenues | null> {
  const { agent, tour } = entree;
  if (agent.role !== 'cadrage' || !agent.cardId) return null;
  // Sans tour vivant ou sans personne devant l'écran (nuit, analyse) : rien n'est retenu à sa place.
  if (!tour?.messageId || tour.questionsInterdites) return null;
  const cardId = agent.cardId;
  if (enVol.has(cardId) || dernierTourCherche.get(cardId) === tour.messageId) return null;

  const card = store.getCard(cardId);
  const projet = store.getProject(agent.projectId);
  if (!card || !projet) return null;
  const deja = (card.parcours?.competencesProposees ?? []).map((p) => p.nom);

  enVol.add(cardId);
  dernierTourCherche.set(cardId, tour.messageId);
  let trouvees: CompetenceAProposer[];
  try {
    trouvees = await (entree.chercher ?? chercherSansBloquer)(
      [card.title, card.description, entree.mots].filter(Boolean).join('\n'),
      { id: projet.id, name: projet.name },
      cardId,
      deja,
    );
  } finally {
    enVol.delete(cardId);
  }
  if (!trouvees.length) return null;

  const maintenant = Date.now();
  const questions = trouvees.map(
    (trouvee) =>
      ({ ...questionDeCompetence(store.newId(), trouvee), answer: REPONSE_UTILISER, answeredAt: maintenant }) as AgentQuestion,
  );
  ecrireSurLaCarte(cardId, (avant) => [
    ...avant,
    ...trouvees.map((trouvee, rang) => ({
      nom: trouvee.nom,
      titre: trouvee.titre,
      correspondance: trouvee.correspondance,
      questionId: questions[rang]!.id,
      agentId: agent.id,
      etat: 'utilisee' as const,
      proposeeLe: maintenant,
      trancheeLe: maintenant,
    })),
  ]);
  for (const trouvee of trouvees) compter(trouvee.nom, 'proposee');
  log.info(`compétences retenues au cadrage de la carte ${cardId} : ${trouvees.map((t) => t.nom).join(', ')}`);
  return {
    questions,
    texte: texteDIssueDesPropositions(
      entree.texteMemoire,
      trouvees.map((t) => ({ nom: t.nom, etat: 'utilisee' as const, chemin: t.chemin })),
    ),
  };
}

/** La carte a-t-elle déjà quitté le cadrage ? Une compétence ne s'y écarte plus. */
function carteLancee(card: Card): boolean {
  return card.column !== 'planned' || store.agentsDeLaCarte(card.id).some((a) => a.role === 'task');
}

/**
 * LA CROIX D'UNE COMPÉTENCE RETENUE : elle passe à « ecartee » et ne partira pas
 * avec l'agent d'exécution. Refusé une fois la carte lancée — l'agent a déjà
 * reçu son mode d'emploi, le retirer de l'écran ferait mentir la carte.
 */
export function ecarterLaCompetence(entree: { messageId: string; questionId: string }): { already?: true; ok?: true } {
  const message = store.getMessage(entree.messageId);
  if (!message) throw new Error('message introuvable');
  const question = message.questions.find((q) => q.id === entree.questionId);
  if (!question?.competence) throw new Error('compétence introuvable');
  const cardId = store.getAgent(message.agentId)?.cardId;
  const card = cardId ? store.getCard(cardId) : null;
  if (!card) throw new Error('carte introuvable');
  if (carteLancee(card)) throw new Error('la carte est lancée : ses compétences ne changent plus');
  if (question.answer === REPONSE_PAS_UTILE) return { already: true };

  let touchee: CompetenceProposee | undefined;
  ecrireSurLaCarte(card.id, (avant) =>
    avant.map((p) => {
      if (p.questionId !== entree.questionId || p.etat === 'ecartee') return p;
      touchee = { ...p, etat: 'ecartee', trancheeLe: Date.now() };
      return touchee;
    }),
  );
  const frais = store.saveMessage({
    ...message,
    questions: message.questions.map((q) =>
      q.id === entree.questionId ? { ...q, answer: REPONSE_PAS_UTILE, cancelled: false, answeredAt: Date.now() } : q,
    ),
  });
  bus.emit({ type: 'message.upsert', message: frais });
  if (touchee) compter(touchee.nom, 'refusee');
  return { ok: true };
}

/**
 * UN ANCIEN ENCADRÉ RESTÉ OUVERT (posé avant la retenue d'office) EST TRANCHÉ
 * OU FERMÉ. La décision s'écrit sur la carte — c'est elle qui fait foi au
 * lancement. Plus aucune attente n'est retenue, il n'y a rien à rendre.
 */
export function trancherLaCompetence(entree: { agentId: string; questionId: string; reponse?: string }): boolean {
  const cardId = store.getAgent(entree.agentId)?.cardId;
  if (!cardId) return false;
  const etat = etatApresReponse(entree.reponse);
  let touchee: CompetenceProposee | undefined;
  ecrireSurLaCarte(cardId, (avant) =>
    avant.map((p) => {
      if (p.questionId !== entree.questionId || p.etat !== 'proposee') return p;
      touchee = { ...p, etat, trancheeLe: Date.now() };
      return touchee;
    }),
  );
  // Un encadré FERMÉ sans réponse n'est pas un refus de la fiche : il ne pèse pas sur son compteur.
  if (touchee && entree.reponse !== undefined && etat === 'ecartee') compter(touchee.nom, 'refusee');
  return !!touchee;
}

/**
 * LE MODE D'EMPLOI D'UNE COMPÉTENCE, pour la fenêtre ouverte d'un clic sur son
 * nom. Le nom est cherché DANS LE POOL : jamais un chemin reçu de l'écran.
 */
export function lireLaCompetence(nom: string): { nom: string; titre: string; description: string; corps: string; protegee?: true } {
  const fiche = listerCompetences().find((f) => f.nom === nom);
  if (!fiche) throw new Error('compétence introuvable');
  /* UNE FICHE PROTÉGÉE NE S'AFFICHE JAMAIS : son nom et sa ligne, rien d'autre. */
  if (fiche.protegee) {
    return {
      nom: fiche.nom,
      titre: titreLisibleDeCompetence(fiche.nom),
      description: fiche.description,
      corps: 'Compétence protégée : son contenu n’est pas affiché. Les agents s’en servent pour vos cartes.',
      protegee: true,
    };
  }
  const texte = fs.readFileSync(fiche.fichier, 'utf8');
  // Le corps sans son frontmatter : la description est rendue à part.
  const corps = texte.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  return { nom: fiche.nom, titre: titreLisibleDeCompetence(fiche.nom), description: fiche.description, corps };
}

/**
 * LE BLOC DU BRIEFING D'EXÉCUTION : le mode d'emploi ENTIER de chaque
 * compétence que l'utilisateur a validée au cadrage. Une fiche disparue du pool
 * depuis (archivée, renommée) est simplement absente. Chaque fiche remise est
 * comptée comme SERVIE — c'est bien ici qu'elle arrive sous les yeux de l'agent.
 */
export function briefingDesCompetencesValidees(
  card: (Pick<Card, 'parcours'> & { projectId?: string }) | null | undefined,
  agentId?: string,
): string {
  const validees = competencesValidees(card?.parcours?.competencesProposees);
  if (!validees.length) return '';
  const pool = listerCompetences();
  const parNom = new Map(pool.map((fiche) => [fiche.nom, fiche]));
  const projet = card?.projectId ? store.getProject(card.projectId)?.name : undefined;
  const lire = (fiche: Competence) => {
    try {
      /*
       * UNE FICHE PROTÉGÉE est ouverte pour CET agent, le temps de son tour :
       * son texte ne part PAS dans le briefing (que l'écran montre en bulles),
       * seul son chemin, avec la consigne de ne jamais la recopier.
       */
      if (fiche.protegee) {
        if (!agentId) return undefined;
        const ouverte = ouvrirLaFicheProtegee(path.dirname(fiche.dossier), path.basename(fiche.dossier), agentId);
        if (!ouverte) return undefined;
        compter(fiche.nom, 'servie');
        return {
          nom: fiche.nom,
          chemin: ouverte.fichier,
          texte: `${CONSIGNE_DES_FICHES_PROTEGEES}\n\nLis son mode d'emploi dans le fichier ci-dessus (ouvert pour ce tour seulement) et suis-le.`,
        };
      }
      const texte = fs.readFileSync(fiche.fichier, 'utf8');
      compter(fiche.nom, 'servie');
      return { nom: fiche.nom, chemin: fiche.fichier, texte };
    } catch (err) {
      log.warn(`compétence validée « ${fiche.nom} » illisible au lancement : ${(err as Error).message}`);
      return undefined;
    }
  };
  /*
   * LA COMMUNE D'ABORD, ENTIÈRE, PUIS LA NUANCE DU PROJET. Une commune validée
   * emporte les fiches propres au projet qui l'étendent ; une fiche propre
   * validée seule (proposée avant que sa commune existe) fait venir sa commune
   * devant elle. Aucune fiche n'est servie deux fois.
   */
  const deja = new Set<string>();
  const fiches: { nom: string; chemin: string; texte: string; nuances: { nom: string; chemin: string; texte: string }[] }[] = [];
  for (const validee of validees) {
    const fiche = parNom.get(validee.nom);
    if (!fiche || deja.has(fiche.nom)) continue;
    const principale = communeEtendue(fiche, pool) ?? fiche;
    if (deja.has(principale.nom)) continue;
    const nuances = principale === fiche ? nuancesDeLaCommune(principale, pool, projet) : [fiche];
    const lue = lire(principale);
    deja.add(principale.nom);
    if (!lue) continue;
    const nuancesLues = nuances
      .filter((nuance) => !deja.has(nuance.nom))
      .map((nuance) => {
        deja.add(nuance.nom);
        return lire(nuance);
      })
      .filter((n): n is NonNullable<typeof n> => !!n);
    fiches.push({ ...lue, nuances: nuancesLues });
  }
  return texteDesCompetencesValidees(fiches, projet);
}

/** Pour les tests : repartir d'un registre vide. */
export function oublierToutesLesSeries(): void {
  dernierTourCherche.clear();
  enVol.clear();
}
