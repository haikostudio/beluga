/**
 * LE RESPONSABLE CRÉATIF, CÔTÉ DÉMON (carte 2 sur 5 du chantier « Beluga
 * Creative Studio », 24/10/2026) : l'outil « production », servi au cadrage ET
 * à la tâche d'une carte dont la caméra est allumée.
 *
 * Il écrit la chaîne d'écriture — brief, directions, scénario, storyboard,
 * plans — dans la mémoire de production du socle (`production_elements`), EN
 * TEXTE et SANS AUCUNE DÉPENSE : aucune action n'appelle un service payant (la
 * fabrication reste à « realiser », réservé à la tâche, derrière le devis par
 * lot). Les règles sont pures (`shared/src/responsable-creatif.ts`) :
 *
 *  - une étape ne s'écrit qu'après l'accord sur la précédente ;
 *  - « soumettre » pose la question d'accord ; la réponse s'écrit DÈS LE CLIC
 *    (`trancherLAccordDEtape`, appelé par `question.answer`), pas au prochain
 *    appel de l'agent : le suivi à droite la montre aussitôt ;
 *  - le brief se complète par UN formulaire de 3 à 5 questions, sans jamais
 *    reposer une question dont le brief a la réponse ;
 *  - une retouche écrit une nouvelle version ; revenir à une version en écrit
 *    une autre avec l'ancien contenu, sans rien effacer.
 *
 * Architecture : `docs/mecaniques/creative-studio.md`.
 */

import {
  AgentQuestion,
  CHAMPS_DU_BRIEF,
  LIBELLES_ARRETS_DU_DIRECTEUR,
  PREFIXE_DES_PIECES_RECUES,
  arretAccorde,
  arretDeLEtape,
  arretLu,
  etapesDeLArret,
  plafondDeFabrication,
  piecesAFournirManquantes,
  plansSurCapaciteAbsente,
  questionDAccordDArret,
  segmentDeChemin,
  type ArretDuDirecteur,
  GENRE_DE_L_ETAPE_D_ECRITURE,
  LIBELLES_ETAPES_D_ECRITURE,
  QUESTIONS_DU_FORMULAIRE_MAX,
  QUESTIONS_DU_FORMULAIRE_MIN,
  SOURCES_DU_BRIEF,
  briefCorrige,
  briefEnMarkdown,
  champDuBrief,
  champsDuBrief,
  cleDElement,
  directionChoisie,
  elementsCourants,
  etapeDEcritureDuGenre,
  etapeSuivantePermise,
  etapeValideeParLaReponse,
  etapesEnAval,
  etatDeLEtapeDEcriture,
  fusionnerLeBrief,
  notesDuBrief,
  piecesDeLEtape,
  questionsDuFormulaire,
  resumeDeLaProduction,
  retourAVersion,
  texteSansAttente,
  typesDeMediaDeLaRealisation,
  versionsDeLaCle,
  ETAPES_D_ECRITURE,
  type Card,
  type ChampRempli,
  type ElementDeProduction,
  type EtapeDEcriture,
  type GenreDElement,
  type QuestionDuFormulaire,
  type SourceDuBrief,
} from '@beluga/shared';
import { changerLEtatDesElements, elementsDeLaCarte, noterUnElement, noterUnEvenement, noterUneApprobation } from './production.js';
import { actionCatalogue, actionEsquisse, actionExemples, actionStyle, actionStyles, actionType, actionVoixEssai } from './production-du-directeur.js';
import * as store from './store.js';
import { bus } from './bus.js';

export interface ContexteProduction {
  agentId: string;
  projectId: string;
  cardId?: string;
}

export interface ResultatProduction {
  ok: boolean;
  text: string;
  question?: AgentQuestion;
}

export const REFUS_PRODUCTION_HORS_CAMERA =
  'L’outil « production » ne sert que sur une carte dont l’utilisateur a allumé la caméra (mode réalisation).';

/** L'outil n'est servi qu'au cadrage et à la tâche d'une carte caméra allumée. */
export function estAgentDeProduction(agentId: string): boolean {
  const agent = store.getAgent(agentId);
  if (!agent?.cardId || (agent.role !== 'cadrage' && agent.role !== 'task')) return false;
  return !!store.getCard(agent.cardId)?.parcours?.realisationSouhaitee;
}

function typesDeLaCarte(card: Card) {
  return typesDeMediaDeLaRealisation(card.realisation);
}

/** L'état de la production d'une carte, en texte : ce que l'agent relit à chaque reprise. */
export function resumeDeProductionDeLaCarte(card: Card): string {
  const elements = elementsDeLaCarte(card.id);
  if (!elements.length) return '';
  return resumeDeLaProduction(elements, typesDeLaCarte(card));
}

/* ------------------------------------------------------------------ */
/* Écrire une pièce                                                     */
/* ------------------------------------------------------------------ */

/**
 * RETOUCHER INVALIDE L'AVAL : une nouvelle version d'une étape remet « à
 * proposer » les pièces validées ou soumises des étapes qui la suivent. Rend
 * les étapes touchées, pour le dire à l'utilisateur.
 */
function invaliderLAval(card: Card, etape: EtapeDEcriture): EtapeDEcriture[] {
  const elements = elementsDeLaCarte(card.id);
  const touchees: EtapeDEcriture[] = [];
  for (const aval of etapesEnAval(etape, typesDeLaCarte(card))) {
    const ids = piecesDeLEtape(elements, aval)
      .filter((p) => p.etat === 'valide' || p.etat === 'a-valider')
      .map((p) => p.id);
    if (changerLEtatDesElements(ids, 'propose', ['valide', 'a-valider'])) touchees.push(aval);
  }
  if (touchees.length) noterUnEvenement(card.id, 'aval.invalide', { depuis: etape, etapes: touchees });
  return touchees;
}

function ecrirePiece(
  card: Card,
  e: { genre: GenreDElement; cle?: string; titre: string; contenu: string; parent?: string | null; auteur?: string; etat?: 'propose' | 'valide' },
): { element: ElementDeProduction; aval: EtapeDEcriture[] } {
  const element = noterUnElement({ cardId: card.id, projectId: card.projectId, genre: e.genre, cle: e.cle, titre: e.titre, contenu: e.contenu, etat: e.etat ?? 'propose', parent: e.parent ?? null, auteur: e.auteur });
  const etape = etapeDEcritureDuGenre(e.genre);
  return { element, aval: etape ? invaliderLAval(card, etape) : [] };
}

function phraseDeLAval(aval: readonly EtapeDEcriture[]): string {
  return aval.length
    ? ` ATTENTION : cette retouche invalide ${aval.map((x) => `« ${LIBELLES_ETAPES_D_ECRITURE[x]} »`).join(', ')}, à faire revalider — dis-le à l’utilisateur en une phrase.`
    : '';
}

/** Une liste de pièces passée par l'agent : titre et contenu obligatoires, clé facultative. */
function lirePieces(brut: unknown): { cle?: string; titre: string; contenu: string; parent?: string; image?: string }[] {
  if (!Array.isArray(brut)) return [];
  return brut
    .map((x: any) => ({
      cle: typeof x?.cle === 'string' && x.cle.trim() ? x.cle.trim() : undefined,
      titre: String(x?.titre ?? '').trim(),
      contenu: String(x?.contenu ?? '').trim(),
      parent: typeof x?.scene === 'string' && x.scene.trim() ? x.scene.trim() : typeof x?.parent === 'string' && x.parent.trim() ? x.parent.trim() : undefined,
      image: typeof x?.image === 'string' && x.image.trim() ? x.image.trim() : undefined,
    }))
    .filter((x) => x.titre && x.contenu);
}

/**
 * CE QUE LE DIRECTEUR SAIT RÉELLEMENT FABRIQUER : les capacités des services
 * branchés, lues dans le catalogue (`realisation.ts`). Remplaçable par les
 * tests, qui n'ont aucun service branché.
 */
let lireLesCapacitesBranchees: () => Promise<string[]> = async () => {
  const { capacitesDuDirecteur } = await import('./realisation.js');
  return capacitesDuDirecteur();
};
export function remplacerLesCapacitesBranchees(fn: () => Promise<string[]>): void {
  lireLesCapacitesBranchees = fn;
}

/** Écrit une étape entière (directions, scènes, plans), après avoir vérifié l'accord sur l'idée. */
async function ecrireLEtape(card: Card, etape: EtapeDEcriture, pieces: ReturnType<typeof lirePieces>, prefixe: string, borne: { min: number; max: number }): Promise<ResultatProduction> {
  const types = typesDeLaCarte(card);
  const permis = etapeSuivantePermise(etape, elementsDeLaCarte(card.id), types);
  if (!permis.ok) return { ok: false, text: `Refusé : ${permis.raison}` };
  if (pieces.length < borne.min || pieces.length > borne.max) {
    return { ok: false, text: `Il faut entre ${borne.min} et ${borne.max} pièces dans la liste (chacune avec « titre » et « contenu »).` };
  }
  /* UN PLAN NE S'APPUIE JAMAIS SUR UN OUTIL ABSENT : chaque plan déclare sa capacité, et elle doit être branchée. */
  if (etape === 'plans') {
    const branchees = await lireLesCapacitesBranchees();
    const absents = plansSurCapaciteAbsente(pieces, branchees);
    if (absents.length) {
      return {
        ok: false,
        text: `Refusé : ${absents
          .map((p) => (p.capacite ? `« ${p.titre} » demande « ${p.capacite} », qu’aucun service branché ne sait fabriquer` : `« ${p.titre} » ne dit pas sa capacité`))
          .join(' ; ')}. Chaque plan porte une ligne « Capacité : <capacité> » parmi celles réellement branchées : ${branchees.length ? branchees.join(', ') : 'AUCUNE pour l’instant'} — ou « Capacité : montage » pour ce qui se fait au montage sans rien générer (capture réelle, titre, incrustation). Récris le plan avec ce qui existe (par exemple une image animée et une voix synchronisée à la place d’un présentateur), ou dis franchement à l’utilisateur ce qui est impossible.`,
      };
    }
  }
  const genre = GENRE_DE_L_ETAPE_D_ECRITURE[etape];
  const ecrites: ElementDeProduction[] = [];
  let aval: EtapeDEcriture[] = [];
  pieces.forEach((p, i) => {
    const r = ecrirePiece(card, { genre, cle: p.cle ?? `${prefixe}-${i + 1}`, titre: p.titre, contenu: p.contenu, parent: p.parent ?? null });
    ecrites.push(r.element);
    aval = [...new Set([...aval, ...r.aval])];
  });
  const suite =
    etape === 'direction'
      ? 'Fais choisir une direction avec « soumettre » (étape « idee ») si le choix appartient à l’utilisateur ; sinon continue le brief.'
      : etape === 'plans'
        ? 'Le découpage est écrit : quand le brief est complet, invite l’utilisateur à cliquer « Passer aux esquisses » sous le champ d’écriture — c’est son geste, jamais le tien.'
        : 'Continue le brief sans t’arrêter : tout l’écrit se fait avant « Passer aux esquisses ».';
  return {
    ok: true,
    text: `${LIBELLES_ETAPES_D_ECRITURE[etape]} écrit : ${ecrites.map((e) => `« ${e.titre} » (clé « ${e.cle} », v${e.version})`).join(', ')}. Les pièces paraissent dans le suivi à droite. ${suite}${phraseDeLAval(aval)}`,
  };
}

/* ------------------------------------------------------------------ */
/* Le brief                                                             */
/* ------------------------------------------------------------------ */

function briefCourant(card: Card): ElementDeProduction | null {
  return elementsCourants(elementsDeLaCarte(card.id)).find((e) => e.genre === 'brief') ?? null;
}

function lireChamps(brut: unknown): { champs: ChampRempli[]; inconnus: string[] } {
  const champs: ChampRempli[] = [];
  const inconnus: string[] = [];
  if (!Array.isArray(brut)) return { champs, inconnus };
  for (const x of brut as any[]) {
    const champ = champDuBrief(x?.champ);
    const valeur = String(x?.valeur ?? '').trim();
    if (!champ) {
      if (x?.champ) inconnus.push(String(x.champ));
      continue;
    }
    if (!valeur) continue;
    const source = (SOURCES_DU_BRIEF as readonly string[]).includes(x?.source) ? (x.source as SourceDuBrief) : 'deduit';
    champs.push({ champ, valeur: valeur.slice(0, 600), source });
  }
  return { champs, inconnus };
}

function actionBrief(card: Card, args: Record<string, unknown>): ResultatProduction {
  const { champs, inconnus } = lireChamps(args.champs);
  const notes = typeof args.notes === 'string' ? args.notes : undefined;
  if (!champs.length && notes === undefined) {
    return { ok: false, text: `Il faut « champs » : une liste de { champ, valeur, source } (champs : ${CHAMPS_DU_BRIEF.join(', ')} ; source : demande, reponse ou deduit).` };
  }
  const avant = briefCourant(card);
  const fusion = fusionnerLeBrief(champsDuBrief(avant?.contenu), champs);
  const contenu = briefEnMarkdown(fusion, notes ?? notesDuBrief(avant?.contenu));
  if (avant && avant.contenu === contenu) return { ok: true, text: `Le brief n’a pas changé (v${avant.version}, ${avant.etat}).` };
  const { element, aval } = ecrirePiece(card, { genre: 'brief', cle: 'brief', titre: 'Brief', contenu });
  const manquent = CHAMPS_DU_BRIEF.filter((c) => !fusion.some((f) => f.champ === c));
  return {
    ok: true,
    text: `Brief écrit (v${element.version}) : ${fusion.length} champ(s) rempli(s).${inconnus.length ? ` Champs inconnus ignorés : ${inconnus.join(', ')}.` : ''} Champs encore vides : ${manquent.join(', ') || 'aucun'}. ${
      element.version === 1 || etatDeLEtapeDEcriture(elementsDeLaCarte(card.id), 'brief') !== 'valide'
        ? 'Complète ce qui manque et compte vraiment par UN « formulaire » (3 à 5 questions), puis « soumettre » l’étape « brief ».'
        : ''
    }${phraseDeLAval(aval)}`,
  };
}

function actionFormulaire(card: Card, args: Record<string, unknown>): ResultatProduction {
  const brut = Array.isArray(args.questions) ? (args.questions as any[]) : [];
  const lues: Omit<QuestionDuFormulaire, 'id'>[] = brut.map((q) => ({
    champ: champDuBrief(q?.champ) ?? undefined,
    question: String(q?.question ?? '').trim().slice(0, 240),
    description: typeof q?.description === 'string' && q.description.trim() ? q.description.trim().slice(0, 600) : undefined,
    kind: q?.kind === 'multiple' ? 'multiple' : 'single',
    options: Array.isArray(q?.options)
      ? q.options
          .map((o: any) => ({
            label: String(o?.label ?? o ?? '').trim().slice(0, 160),
            description: typeof o?.description === 'string' && o.description.trim() ? o.description.trim().slice(0, 300) : undefined,
          }))
          .filter((o: { label: string }) => o.label)
      : [],
  }));
  if (lues.length > QUESTIONS_DU_FORMULAIRE_MAX) {
    return { ok: false, text: `Un formulaire porte ${QUESTIONS_DU_FORMULAIRE_MIN} à ${QUESTIONS_DU_FORMULAIRE_MAX} questions : garde celles qui comptent vraiment.` };
  }
  const connus = champsDuBrief(briefCourant(card)?.contenu);
  const { posees, ecartees } = questionsDuFormulaire(lues, connus);
  const deja = ecartees.length ? ` Écartées parce que le brief y répond déjà : ${ecartees.map((x) => `« ${x.question} » (${x.champ} : ${x.valeur})`).join(' ; ')}.` : '';
  if (!posees.length) {
    return { ok: false, text: `Aucune question à poser.${deja || ' Il faut « questions » : 3 à 5 { champ, question, options }.'} Continue avec ce que dit le brief.` };
  }
  const question = AgentQuestion.parse({
    id: store.newId(),
    question: 'Quelques questions pour compléter le brief',
    description: typeof args.description === 'string' && args.description.trim() ? args.description.trim().slice(0, 600) : 'Répondez à ce qui vous parle : un choix suggéré ou vos propres mots. Une question laissée vide sera reprise plus tard.',
    kind: 'text',
    options: [],
    allowFreeText: true,
    formulaire: { questions: posees },
  });
  noterUnEvenement(card.id, 'brief.formulaire', { questions: posees.length, ecartees: ecartees.length });
  return { ok: true, text: `${texteSansAttente()}${deja}`, question };
}

/* ------------------------------------------------------------------ */
/* L'accord                                                             */
/* ------------------------------------------------------------------ */

/** Les images clés désignées par l'agent : des pièces jointes d'image (aperçus ou médias de la carte). */
function imagesDesignees(brut: unknown, projectId?: string): string[] {
  const ids = Array.isArray(brut) ? brut : typeof brut === 'string' ? brut.split(',') : brut && typeof brut === 'object' ? Object.values(brut) : [];
  /* Un alias (« #8dba ») vaut l'identifiant : la pièce est relue en base (`pieceJointeDesignee`). */
  const lus = ids.map((x) => String(x ?? '').trim().replace(/^#/, '')).filter(Boolean).map((x) => store.pieceJointeDesignee(x, projectId)?.id ?? x);
  return [...new Set(lus)].slice(0, 24);
}

function actionSoumettre(card: Card, args: Record<string, unknown>): ResultatProduction {
  const arret = arretLu(args.etape ?? args.arret);
  if (!arret) return { ok: false, text: 'Il faut « etape » : un des trois arrêts — idee, images-cles ou rendu.' };
  const types = typesDeLaCarte(card);
  const elements = elementsDeLaCarte(card.id);
  const resume = typeof args.resume === 'string' ? args.resume.slice(0, 600) : undefined;

  if (arret === 'idee') {
    if (arretAccorde('idee', elements, types)) return { ok: true, text: 'L’idée est DÉJÀ accordée : ne redemande pas, écris la suite jusqu’à l’arrêt « images-cles ».' };
    const etapes = etapesDeLArret('idee', types);
    for (const etape of etapes) {
      if (etatDeLEtapeDEcriture(elements, etape) === 'vide') return { ok: false, text: `L’idée n’est pas complète : « ${LIBELLES_ETAPES_D_ECRITURE[etape]} » n’a encore aucune pièce.` };
    }
    const brief = piecesDeLEtape(elements, 'brief');
    const directions = etapes.includes('direction') ? piecesDeLEtape(elements, 'direction').filter((p) => p.etat !== 'refuse') : [];
    if (etapes.includes('direction') && directions.length < 2) {
      return { ok: false, text: 'Une idée se choisit parmi DEUX ou TROIS directions : écris-en au moins deux avec « concept ».' };
    }
    const images: Record<string, string> = {};
    if (args.images && typeof args.images === 'object' && !Array.isArray(args.images)) {
      for (const [cle, piece] of Object.entries(args.images as Record<string, unknown>)) {
        const jointe = store.pieceJointeDesignee(piece, card.projectId);
        if (jointe?.mime?.startsWith('image/')) images[cleDElement(cle, 'concept')] = jointe.id;
      }
    }
    const soumises = [...brief, ...directions];
    const forme = questionDAccordDArret({ arret, directions, resume, images });
    changerLEtatDesElements(soumises.map((p) => p.id), 'a-valider', ['propose', 'refuse', 'a-valider', 'valide']);
    return poserLAccord(card, arret, soumises.map((p) => p.id), forme);
  }

  /* PLUS D'ARRÊT DE PRIX NI DE FILM (26/10/2026) : l'utilisateur avance par le bouton du bas, chaque génération a son propre bouton à prix. */
  if (arret === 'images-cles' || arret === 'rendu') {
    return {
      ok: false,
      text:
        arret === 'images-cles'
          ? 'Refusé : il n’y a plus d’arrêt « images clés et prix » ni d’accord global. Au brief, invite l’utilisateur à cliquer « Passer aux esquisses » ; aux esquisses, chaque génération part par son propre lot à prix (« realiser » action « devis » puis « lot »).'
          : 'Refusé : il n’y a plus d’arrêt « film monté ». Le montage se fait dans le studio de la carte, et l’utilisateur passe lui-même au téléchargement par le bouton du bas.',
    };
  }

  if (arret === 'images-cles') {
    if (!arretAccorde('idee', elements, types)) return { ok: false, text: 'Refusé : l’idée n’a pas encore l’accord de l’utilisateur — soumets d’abord l’arrêt « idee ».' };
    if (card.parcours?.fabricationAccordeeA && arretAccorde('images-cles', elements, types)) {
      return { ok: true, text: 'La fabrication est DÉJÀ accordée : ne redemande pas, termine ton tour — elle part d’elle-même.' };
    }
    const etapes = etapesDeLArret('images-cles', types);
    for (const etape of etapes) {
      if (etatDeLEtapeDEcriture(elements, etape) === 'vide') return { ok: false, text: `L’arrêt « images-cles » n’est pas prêt : « ${LIBELLES_ETAPES_D_ECRITURE[etape]} » n’a encore aucune pièce.` };
    }
    const manquantes = piecesAFournirManquantes(champsDuBrief(briefCourant(card)?.contenu), elements);
    if (manquantes.length) {
      return { ok: false, text: `Refusé : il manque encore ${manquantes.map((m) => `« ${m} »`).join(', ')}. Si l’utilisateur les a DÉJÀ jointes (à un message, une réponse, ou parmi ce que tu as vu), note chacune toi-même avec l’action « piece_recue » (son identifiant ou son alias « #xxxx » suffit) ; sinon demande-les avec « ask_user ». Rien ne se fabrique sans elles.` };
    }
    if (card.parcours?.realisationSouhaitee && card.realisation && !card.realisation.termineA) {
      return { ok: false, text: 'Refusé : le cahier de réalisation n’est pas encore terminé. Écris-le en entier avec « cahier_de_realisation » et « termine » = vrai, puis soumets l’arrêt « images-cles ».' };
    }
    const prix = Number(String(args.prix ?? '').replace(',', '.'));
    if (!Number.isFinite(prix) || prix < 0 || String(args.prix ?? '').trim() === '') {
      return { ok: false, text: 'Il faut « prix » : le prix total du film en dollars, tiré du devis prévisionnel plan par plan (prix publiés). Il fixe le plafond : prix + 30 % de marge pour réparer les pannes.' };
    }
    const pieces = etapes.flatMap((e) => piecesDeLEtape(elements, e));
    const images = imagesDesignees(args.images, card.projectId);
    /* LA VOIX D'ESSAI s'écoute dans la question : son accord vaut validation des textes (décision du 26/10/2026). */
    const voixJointe = args.voix ? store.pieceJointeDesignee(args.voix, card.projectId) : null;
    if (args.voix && !voixJointe?.mime?.startsWith('audio/')) return { ok: false, text: `« voix » doit être l’identifiant d’une pièce jointe SON de ce projet (rendue par « voix_essai ») : « ${String(args.voix)} » n’en est pas une.` };
    const forme = questionDAccordDArret({ arret, pieces: piecesDeLEtape(elements, 'plans'), resume, prix, plafond: plafondDeFabrication(prix), ...(voixJointe ? { voix: voixJointe.id } : {}) });
    changerLEtatDesElements(pieces.map((p) => p.id), 'a-valider', ['propose', 'refuse', 'a-valider', 'valide']);
    return poserLAccord(card, arret, pieces.map((p) => p.id), forme, { prix: Math.round(prix * 100) / 100, ...(images.length ? { images } : {}) });
  }

  /* L'ARRÊT 3 : le film monté, joint et lisible depuis la question. */
  const film = store.pieceJointeDesignee(args.film ?? args.media, card.projectId)?.id ?? '';
  if (!film) {
    return { ok: false, text: 'Il faut « film » : l’identifiant de la pièce jointe du film monté (rendu par « realiser » action « ajouter »).' };
  }
  const forme = questionDAccordDArret({ arret, resume, film });
  noterLeFilm(card.id, { filmSoumisA: Date.now(), filmValideA: undefined });
  return poserLAccord(card, arret, [], forme, { images: [film] });
}

/**
 * LE FILM SUR LA CARTE (`realisation.filmSoumisA` / `filmValideA`) : c'est ce
 * que lisent l'étape « Film monté » de la barre et du volet, et le bouton
 * « Valider le film » puis « Terminer » (`etapesDuMedia`, `boutonDuMedia`).
 */
function noterLeFilm(cardId: string, champs: { filmSoumisA?: number; filmValideA?: number }): void {
  const card = store.getCard(cardId);
  if (!card?.realisation) return;
  const ecrite = store.saveCard({ ...card, realisation: { ...card.realisation, ...champs } });
  bus.emit({ type: 'card.upsert', card: ecrite });
}

function poserLAccord(
  card: Card,
  arret: ArretDuDirecteur,
  elements: string[],
  forme: ReturnType<typeof questionDAccordDArret>,
  enPlus: { prix?: number; images?: string[] } = {},
): ResultatProduction {
  const question = AgentQuestion.parse({
    id: store.newId(),
    question: forme.question,
    description: forme.description,
    kind: 'single',
    options: forme.options.map((o, i) => ({ id: `o${i}`, ...o })),
    allowFreeText: true,
    accord: { cardId: card.id, etape: arret, elements, ...enPlus },
  });
  noterUnEvenement(card.id, 'arret.soumis', { arret, pieces: elements.length, ...(enPlus.prix !== undefined ? { prix: enPlus.prix } : {}) });
  return { ok: true, text: texteSansAttente(), question };
}

/**
 * LA RÉPONSE À UNE DEMANDE D'ACCORD, écrite DÈS LE CLIC (`question.answer`).
 *  - IDÉE : la direction choisie et le brief passent « validés », les autres
 *    directions « écartées » ; « proposer d'autres directions » les écarte
 *    toutes ; toute autre réponse rend l'idée à retoucher.
 *  - IMAGES CLÉS : « Valider et lancer » valide scénario, storyboard et plans,
 *    fixe le budget (prix accordé + marge de réparation), verse les images clés
 *    au suivi et pose `fabricationAccordeeA` — le geste de lancement.
 *  - RENDU : noté ; la suite (export ou retouche) revient à l'agent.
 * Les anciennes questions (une par étape) restent tranchées comme avant. Une
 * pièce retouchée entre-temps (version remplacée) n'est jamais rouverte.
 */
export function trancherLAccordDEtape(
  question: Pick<AgentQuestion, 'accord'>,
  reponse: string,
): { etape: string; valide: boolean; fabrication?: boolean } | null {
  const accord = question.accord;
  if (!accord) return null;
  const card = store.getCard(accord.cardId);
  if (!card) return null;
  const elements = elementsDeLaCarte(card.id).filter((e) => accord.elements.includes(e.id));
  let valide: boolean;
  let fabrication = false;
  if (accord.etape === 'idee') {
    const directions = elements.filter((e) => e.genre === 'concept');
    const briefs = elements.filter((e) => e.genre === 'brief');
    if (directions.length) {
      const choisie = directionChoisie(reponse, directions.filter((e) => e.etat === 'a-valider'));
      valide = !!choisie;
      if (choisie) {
        changerLEtatDesElements([choisie.id, ...briefs.map((b) => b.id)], 'valide', ['a-valider']);
        changerLEtatDesElements(directions.filter((e) => e.id !== choisie.id).map((e) => e.id), 'refuse', ['a-valider']);
      } else {
        const autres = /^\s*aucune/i.test(reponse);
        changerLEtatDesElements(directions.map((e) => e.id), autres ? 'refuse' : 'propose', ['a-valider']);
        changerLEtatDesElements(briefs.map((b) => b.id), 'propose', ['a-valider']);
      }
    } else {
      valide = etapeValideeParLaReponse(reponse);
      changerLEtatDesElements(elements.map((e) => e.id), valide ? 'valide' : 'propose', ['a-valider']);
    }
  } else if (accord.etape === 'images-cles') {
    /* UNE QUESTION D'AVANT LE 26/10/2026 encore ouverte : elle valide l'écrit, ne lance plus rien (chaque génération a son bouton à prix). */
    valide = etapeValideeParLaReponse(reponse);
    changerLEtatDesElements(elements.map((e) => e.id), valide ? 'valide' : 'propose', ['a-valider']);
  } else if (accord.etape === 'rendu') {
    valide = etapeValideeParLaReponse(reponse);
    /* Validé : l'export final part, « Terminer » suivra. Retouché : le film revient au montage. */
    noterLeFilm(card.id, valide ? { filmValideA: Date.now() } : { filmSoumisA: undefined });
  } else if (accord.etape === 'direction') {
    const choisie = directionChoisie(reponse, elements.filter((e) => e.etat === 'a-valider'));
    valide = !!choisie;
    if (choisie) changerLEtatDesElements([choisie.id], 'valide', ['a-valider']);
    changerLEtatDesElements(
      elements.filter((e) => e.id !== choisie?.id).map((e) => e.id),
      'refuse',
      ['a-valider'],
    );
  } else {
    valide = etapeValideeParLaReponse(reponse);
    changerLEtatDesElements(
      elements.map((e) => e.id),
      valide ? 'valide' : 'propose',
      ['a-valider'],
    );
  }
  noterUneApprobation(card.id, 'etape', accord.etape, valide ? 'valide' : 'refuse', reponse);
  noterUnEvenement(card.id, valide ? 'etape.validee' : 'etape.retouche', { etape: accord.etape });
  return { etape: accord.etape, valide, ...(fabrication ? { fabrication } : {}) };
}

/* ------------------------------------------------------------------ */
/* Les versions                                                         */
/* ------------------------------------------------------------------ */

/**
 * REVENIR À UNE VERSION : écrit la version suivante avec le contenu de
 * l'ancienne, sans rien effacer. Idempotent (`retourAVersion`) : un double
 * clic n'écrit qu'une version. La pièce redevient « à proposer » : l'étape se
 * fera revalider, et l'aval est invalidé comme pour toute retouche.
 */
export function revenirAVersionDeLaCarte(
  cardId: string,
  cle: string,
  version: number,
  auteur: 'agent' | 'utilisateur',
): { ok: true; element: ElementDeProduction; deja: boolean; aval: EtapeDEcriture[] } | { ok: false; raison: string } {
  const card = store.getCard(cardId);
  if (!card) return { ok: false, raison: 'carte introuvable' };
  const verdict = retourAVersion(versionsDeLaCle(elementsDeLaCarte(cardId), cle), version);
  if (verdict.verdict === 'introuvable') return { ok: false, raison: `aucune version ${version} pour « ${cle} »` };
  if (verdict.verdict === 'deja') return { ok: true, element: verdict.courante, deja: true, aval: [] };
  const { element, aval } = ecrirePiece(card, {
    genre: verdict.cible.genre,
    cle: verdict.cible.cle,
    titre: verdict.cible.titre,
    contenu: verdict.cible.contenu,
    parent: verdict.cible.parent,
    auteur,
  });
  noterUnEvenement(cardId, 'version.retour', { cle, depuis: version, version: element.version, auteur });
  return { ok: true, element, deja: false, aval };
}

/**
 * CORRIGER UNE PIÈCE À LA MAIN, depuis le suivi (`production.modifier`,
 * 25/10/2026) : une NOUVELLE version signée « utilisateur », l'ancienne gardée.
 * Idempotent (même titre, même contenu : rien d'écrit). `depuisVersion` est la
 * version que l'utilisateur avait sous les yeux en ouvrant l'édition : si
 * l'agent en a écrit une autre entre-temps, on refuse (`conflit`) plutôt que
 * d'écraser son travail sans le dire — l'écran propose alors d'enregistrer
 * quand même. Une pièce VALIDÉE corrigée par l'utilisateur le reste (c'est lui
 * qui valide) ; toute autre redevient « à proposer ». L'aval est invalidé comme
 * pour toute retouche. Un brief est remis en forme relisible (`briefCorrige`).
 */
export function modifierUnePieceDeLaCarte(
  cardId: string,
  cle: string,
  e: { titre?: string; contenu: string; depuisVersion?: number },
): { ok: true; element: ElementDeProduction; deja: boolean; aval: EtapeDEcriture[] } | { ok: false; raison: string; conflit?: number } {
  const card = store.getCard(cardId);
  if (!card) return { ok: false, raison: 'carte introuvable' };
  const courante = elementsCourants(elementsDeLaCarte(cardId)).find((x) => x.cle === cle);
  if (!courante) return { ok: false, raison: `aucune pièce « ${cle} »` };
  if (e.depuisVersion !== undefined && e.depuisVersion !== courante.version) {
    return { ok: false, raison: `la pièce a changé pendant la correction (v${courante.version})`, conflit: courante.version };
  }
  const brut = String(e.contenu ?? '').trim();
  if (!brut) return { ok: false, raison: 'le texte est vide' };
  const contenu = courante.genre === 'brief' ? briefCorrige(brut) : brut;
  const titre = String(e.titre ?? '').trim() || courante.titre;
  if (contenu === courante.contenu && titre === courante.titre) return { ok: true, element: courante, deja: true, aval: [] };
  const { element, aval } = ecrirePiece(card, {
    genre: courante.genre,
    cle,
    titre,
    contenu,
    parent: courante.parent,
    auteur: 'utilisateur',
    etat: courante.etat === 'valide' ? 'valide' : 'propose',
  });
  noterUnEvenement(cardId, 'piece.corrigee', { cle, depuis: courante.version, version: element.version, auteur: 'utilisateur', aval });
  return { ok: true, element, deja: false, aval };
}

/**
 * RETENIR UNE AUTRE DIRECTION APRÈS COUP (`production.choisirDirection`,
 * 25/10/2026) : depuis la feuille « Archives » du suivi, une piste
 * écartée est reprise. Elle passe « validée », l'ancienne « écartée » ; le
 * brief reste validé ; l'aval (scénario, storyboard, plans) est à revalider,
 * comme pour une correction à la main. Idempotent : la piste déjà retenue
 * n'écrit rien (double clic).
 *
 * SANS DIRECTION RETENUE (le brief réécrit l'a remise « à proposer ») : une
 * piste ÉCARTÉE se reprend aussi, elle repasse « à proposer » à côté des
 * autres — rien d'autre ne bouge, le choix se refait dans la question
 * d'accord. Une piste déjà en lice n'écrit rien ; une direction soumise
 * (« à valider ») se choisit dans la question d'accord, pas ici.
 */
export function choisirUneAutreDirection(
  cardId: string,
  cle: string,
): { ok: true; deja: boolean; aval: EtapeDEcriture[] } | { ok: false; raison: string } {
  const card = store.getCard(cardId);
  if (!card) return { ok: false, raison: 'carte introuvable' };
  const directions = elementsCourants(elementsDeLaCarte(cardId)).filter((e) => e.genre === 'concept');
  const cible = directions.find((e) => e.cle === cle);
  if (!cible) return { ok: false, raison: `aucune direction « ${cle} »` };
  const retenue = directions.find((e) => e.etat === 'valide');
  if (!retenue) {
    if (cible.etat === 'propose') return { ok: true, deja: true, aval: [] };
    if (cible.etat !== 'refuse') return { ok: false, raison: 'aucune direction n’est encore retenue : le choix se fait dans la question d’accord' };
    changerLEtatDesElements([cible.id], 'propose', ['refuse']);
    noterUnEvenement(cardId, 'direction.changee', { depuis: null, vers: cible.cle, aval: [] });
    return { ok: true, deja: false, aval: [] };
  }
  if (retenue.id === cible.id) return { ok: true, deja: true, aval: [] };
  if (cible.etat !== 'refuse' && cible.etat !== 'propose') return { ok: false, raison: `la direction « ${cle} » n’est pas une piste à reprendre` };
  changerLEtatDesElements([cible.id], 'valide', ['refuse', 'propose']);
  changerLEtatDesElements([retenue.id], 'refuse', ['valide']);
  const etape = etapeDEcritureDuGenre('concept');
  const aval = etape ? invaliderLAval(card, etape) : [];
  noterUneApprobation(cardId, 'etape', 'direction', 'valide', `direction reprise depuis le suivi : ${cible.titre}`);
  noterUnEvenement(cardId, 'direction.changee', { depuis: retenue.cle, vers: cible.cle, aval });
  return { ok: true, deja: false, aval };
}

/* ------------------------------------------------------------------ */
/* L'outil                                                              */
/* ------------------------------------------------------------------ */

export async function production(ctx: ContexteProduction, args: Record<string, unknown>): Promise<ResultatProduction> {
  const card = ctx.cardId ? store.getCard(ctx.cardId) : null;
  if (!card?.parcours?.realisationSouhaitee) return { ok: false, text: REFUS_PRODUCTION_HORS_CAMERA };
  const action = String(args.action ?? 'etat');
  const types = typesDeLaCarte(card);

  switch (action) {
    case 'etat':
      return { ok: true, text: resumeDeLaProduction(elementsDeLaCarte(card.id), types) };

    case 'brief':
      return actionBrief(card, args);

    case 'formulaire':
      return actionFormulaire(card, args);

    case 'concept':
      return await ecrireLEtape(card, 'direction', lirePieces(args.directions ?? args.pieces), 'direction', { min: 2, max: 3 });

    case 'script': {
      const pieces = lirePieces(args.pieces ?? [{ cle: args.cle, titre: args.titre ?? 'Scénario', contenu: args.contenu }]);
      return await ecrireLEtape(card, 'scenario', pieces.map((p) => ({ ...p, cle: p.cle ?? 'scenario' })), 'scenario', { min: 1, max: 1 });
    }

    case 'storyboard':
      return await ecrireLEtape(card, 'storyboard', lirePieces(args.scenes ?? args.pieces), 'scene', { min: 1, max: 40 });

    case 'plans':
      return await ecrireLEtape(card, 'plans', lirePieces(args.plans ?? args.pieces), 'plan', { min: 1, max: 80 });

    case 'modifier':
    case 'modifier_plan': {
      const cle = String(args.cle ?? '').trim();
      const contenu = String(args.contenu ?? '').trim();
      const courante = elementsCourants(elementsDeLaCarte(card.id)).find((e) => e.cle === cle);
      if (!courante) return { ok: false, text: `Aucune pièce de clé « ${cle} » : l’action « etat » liste les clés.` };
      if (!contenu) return { ok: false, text: 'Il faut « contenu » : le texte entier de la nouvelle version.' };
      const etape = etapeDEcritureDuGenre(courante.genre);
      if (etape) {
        const permis = etapeSuivantePermise(etape, elementsDeLaCarte(card.id), types);
        if (!permis.ok) return { ok: false, text: `Refusé : ${permis.raison}` };
      }
      const { element, aval } = ecrirePiece(card, {
        genre: courante.genre,
        cle,
        titre: String(args.titre ?? '').trim() || courante.titre,
        contenu,
        parent: courante.parent,
      });
      return {
        ok: true,
        text: `« ${element.titre} » retouché : v${element.version} écrite, v${courante.version} gardée (l’utilisateur peut y revenir depuis le suivi).${etape === 'direction' ? ' Fais rechoisir la direction avec « soumettre » (étape « idee ») si le choix lui revient.' : ''} Si ce plan a déjà été fabriqué, refais-le par un nouveau « devis » puis un « lot » à prix : rien ne part sans le clic de l’utilisateur.${phraseDeLAval(aval)}`,
      };
    }

    case 'lire': {
      const cle = String(args.cle ?? '').trim();
      const piece = elementsCourants(elementsDeLaCarte(card.id)).find((e) => e.cle === cle);
      if (!piece) return { ok: false, text: `Aucune pièce de clé « ${cle} » : l’action « etat » liste les clés.` };
      return {
        ok: true,
        text: `« ${piece.titre} » (clé « ${piece.cle} », v${piece.version}, ${piece.etat}${piece.auteur === 'utilisateur' ? ', corrigée par l’utilisateur' : ''}) :\n${piece.contenu}`,
      };
    }

    case 'versions': {
      const cle = String(args.cle ?? '').trim();
      const versions = versionsDeLaCle(elementsDeLaCarte(card.id), cle);
      if (!versions.length) return { ok: false, text: `Aucune pièce de clé « ${cle} ».` };
      return {
        ok: true,
        text: versions
          .map((v, i) => `- v${v.version}${i === 0 ? ' (en cours)' : ''} — ${v.etat}${v.auteur ? `, par ${v.auteur}` : ''} — « ${v.titre} » : ${v.contenu.replace(/\s+/g, ' ').slice(0, 160)}`)
          .join('\n'),
      };
    }

    case 'revenir_a_version': {
      const cle = String(args.cle ?? '').trim();
      const version = Number(args.version);
      if (!cle || !Number.isInteger(version)) return { ok: false, text: 'Il faut « cle » et « version » (un numéro).' };
      const r = revenirAVersionDeLaCarte(card.id, cle, version, 'agent');
      if (!r.ok) return { ok: false, text: `Impossible : ${r.raison}.` };
      if (r.deja) return { ok: true, text: `La version en cours de « ${cle} » a déjà ce contenu (v${r.element.version}) : rien à écrire.` };
      return { ok: true, text: `« ${cle} » revient au contenu de la v${version} : v${r.element.version} écrite, rien n’est effacé. Soumets de nouveau l’arrêt concerné quand il est prêt.${phraseDeLAval(r.aval)}` };
    }

    case 'soumettre':
      return actionSoumettre(card, args);

    case 'type':
      return actionType(card, args);

    case 'styles':
      return await actionStyles(card, ctx);

    case 'style':
      return actionStyle(card, args);

    case 'catalogue':
      return actionCatalogue(args);

    case 'exemples':
      return actionExemples(args);

    case 'esquisse':
      return await actionEsquisse(card, ctx, args);

    case 'voix_essai':
      return await actionVoixEssai(card, ctx, args);

    case 'piece_recue': {
      /* UNE PIÈCE FOURNIE PAR L'UTILISATEUR (photo, logo, voix…), jointe à sa réponse : notée au suivi, elle lève l'attente de l'arrêt 2. */
      const nom = String(args.nom ?? args.titre ?? '').trim().slice(0, 120);
      const piece = String(args.piece ?? args.fichier ?? '').trim().replace(/^#/, '');
      if (!nom || !piece) return { ok: false, text: 'Il faut « nom » (la pièce, telle que le brief la nomme) et « piece » (l’identifiant de la pièce jointe reçue).' };
      /* L'IDENTIFIANT OU L'ALIAS (« #8dba ») d'une pièce DÉJÀ ARRIVÉE — jointe à
         un message, à une réponse, vue par l'agent — suffit : l'agent la note
         lui-même, jamais en redemandant à l'utilisateur de la rejoindre. */
      const jointe = store.pieceJointeDesignee(piece, card.projectId);
      if (!jointe) return { ok: false, text: `Aucune pièce jointe « ${piece} » dans ce projet. Donne l’identifiant ou l’alias (« #8dba ») d’une pièce déjà reçue — celles que tu as vues dans la conversation ; ne demande à l’utilisateur de la joindre que si elle n’est jamais arrivée.` };
      const element = noterUnElement({
        cardId: card.id,
        projectId: card.projectId,
        genre: 'reference',
        cle: `${PREFIXE_DES_PIECES_RECUES}${segmentDeChemin(nom, 'piece')}`,
        titre: nom,
        contenu: `Pièce fournie par l’utilisateur : ${nom}\nPièce jointe : ${jointe.id} (${jointe.name})`,
        etat: 'valide',
        parent: null,
      });
      const manquantes = piecesAFournirManquantes(champsDuBrief(briefCourant(card)?.contenu), elementsDeLaCarte(card.id));
      return { ok: true, text: `« ${element.titre} » reçue et notée au suivi. ${manquantes.length ? `Encore attendu : ${manquantes.join(' ; ')}.` : 'Toutes les pièces à fournir sont là.'}` };
    }

    default:
      return {
        ok: false,
        text: 'Action inconnue. Actions : etat, lire, type, styles, style, catalogue, exemples, brief, formulaire, concept, script, storyboard, plans, esquisse, voix_essai, soumettre (arrêts idee, images-cles, rendu), piece_recue, modifier, versions, revenir_a_version.',
      };
  }
}

/**
 * « PASSER AUX ESQUISSES » VAUT ACCORD SUR L'ÉCRIT DU BRIEF (26/10/2026) : le
 * brief, le scénario, le storyboard et les plans courants passent « validés »
 * (la direction aussi quand une seule reste en lice) ; une retouche écrite
 * ensuite les fera revalider, comme toute retouche d'une étape validée.
 */
export function validerLEcritDuBrief(cardId: string): number {
  const courants = elementsCourants(elementsDeLaCarte(cardId)).filter((e) => e.etat === 'propose' || e.etat === 'a-valider');
  const enLice = courants.filter((e) => e.genre === 'concept');
  const ids = courants.filter((e) => ['brief', 'script', 'scene', 'plan'].includes(e.genre) || (e.genre === 'concept' && enLice.length === 1)).map((e) => e.id);
  const n = changerLEtatDesElements(ids, 'valide', ['propose', 'a-valider']);
  if (n) noterUnEvenement(cardId, 'brief.valide', { pieces: n });
  return n;
}
