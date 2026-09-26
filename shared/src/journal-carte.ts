import { z } from 'zod';
import { delaiOutilMoteurMs, estUneConsigneAuMoteur } from './attente-question.js';
import { JALON_TOUR_ARRETE, JALON_TOUR_EN_PAUSE, JALON_TOUR_NON_PARTI } from './issue-de-tour.js';

/**
 * LE JOURNAL D'UNE CARTE — UN SEUL DOCUMENT, TOUTE SA VIE.
 *
 * Ce qu'un agent a réellement fait ne se lisait qu'en morceaux, et chaque
 * morceau mourait avec son tour : les étapes (`RunStep`) et la liste de tâches
 * (`TodoItem`) vivent sur UN message, les ouvertures de mémoire
 * (`ConsultationMemoire`) sur UNE photographie de contexte, et le cadrage —
 * porté par un AUTRE agent que l'exécution — n'était relié à rien. Une carte
 * reprise trois fois laissait donc trois traces séparées, dont aucune ne
 * racontait l'histoire complète.
 *
 * Le journal renverse cela : UNE liste ordonnée, attachée à la CARTE et non à
 * un tour, où chaque phase (cadrage, recadrage, exécution, rapport) AJOUTE ses
 * requêtes et ses points de travail. Rien n'y est jamais remplacé ni réordonné
 * — on n'ajoute qu'à la fin. C'est ce document qui se sert d'un bloc à
 * l'interface, sous forme de ligne de temps.
 *
 * CE FICHIER NE TOUCHE NI BASE NI DISQUE : il ne dit que la FORME du journal et
 * les règles qui la tiennent (phases, bornes de taille, ordre, résumé). Le
 * travail réel vit dans `server/src/journal-carte.ts`, l'écran dans
 * `web/src/components/journal-carte.tsx`.
 */

/**
 * LES QUATRE PHASES DE LA VIE D'UNE CARTE, dans leur ordre naturel.
 *
 * `cadrage` est le premier passage de l'agent léger qui écrit le besoin ;
 * `recadrage` est TOUT passage de cadrage ultérieur — une carte déjà exécutée
 * qu'on rediscute n'est plus en train de naître ; `execution` est le travail de
 * l'agent complet ; `rapport` est le dernier mot rendu, celui qui referme le
 * tour. Une carte peut repasser plusieurs fois par `execution` et `rapport` :
 * la liste ne se réordonne pas pour autant, elle s'allonge.
 */
export const PHASES_JOURNAL = ['cadrage', 'recadrage', 'execution', 'rapport'] as const;
export const PhaseJournal = z.enum(PHASES_JOURNAL);
export type PhaseJournal = z.infer<typeof PhaseJournal>;

/**
 * TROIS NATURES D'ENTRÉE, PAS UNE DE PLUS.
 *
 * `requete` : un appel d'outil réellement exécuté — outil du démon passé par le
 * pont (`project_memory`, `coffre_fort`, `ask_user`…) comme outil propre au
 * moteur (lecture de fichier, commande, modification). Elle se déplie : outil,
 * paramètres, résultat, durée.
 * `point` : un point de travail — une ligne de la liste de tâches que l'agent
 * s'annonce, avec son état et ses données.
 * `jalon` : le repère qui marque un moment de la vie de la carte (un tour qui
 * part, une réponse rendue, une carte qui change de colonne). C'est lui qui
 * donne sa charpente à la ligne de temps.
 */
export const NATURES_JOURNAL = ['requete', 'point', 'jalon'] as const;
export const NatureJournal = z.enum(NATURES_JOURNAL);
export type NatureJournal = z.infer<typeof NatureJournal>;

/**
 * LES BORNES DE TAILLE. Le journal est PERMANENT : il survit à la carte, à ses
 * reprises et à la purge des vieux contextes. Un résultat d'outil peut peser
 * des centaines de milliers de signes (une lecture de fichier entier) et il ne
 * s'agit pas de gonfler la base sans fin. On garde donc le DÉBUT du texte, la
 * part la plus informative, et l'on DIT en clair ce qui a été coupé — jamais un
 * texte tronqué en silence, qui ferait croire à un résultat complet.
 */
export const PLAFOND_RESULTAT = 8000;
export const PLAFOND_PARAMS = 2000;

/**
 * Coupe un texte à sa borne en DISANT ce qui manque. Un texte vide reste vide :
 * un outil qui n'a rien rendu ne doit pas paraître avoir été coupé.
 */
export function bornerTexte(texte: string, plafond: number): string {
  if (texte.length <= plafond) return texte;
  const retire = texte.length - plafond;
  return `${texte.slice(0, plafond)}\n\n[… ${retire} signes de plus, non conservés dans le journal]`;
}

/** Une entrée du journal — une requête, un point de travail ou un jalon. */
export const EntreeJournal = z.object({
  id: z.string(),
  /** La carte dont ce journal raconte la vie. */
  cardId: z.string(),
  /**
   * Le RANG dans la liste, croissant et sans trou : c'est lui qui fait l'ordre,
   * jamais l'horodatage. Deux entrées écrites dans la même milliseconde — cas
   * courant quand un outil répond tout de suite — resteraient sinon
   * interchangeables, et la ligne de temps se remélangerait à chaque lecture.
   */
  rang: z.number().int().nonnegative(),
  phase: PhaseJournal,
  nature: NatureJournal,
  at: z.number(),
  /** L'agent qui a produit l'entrée, et son rôle : le cadrage n'est pas l'exécution. */
  agentId: z.string().optional(),
  agentRole: z.string().optional(),
  /**
   * Le tour au sein duquel l'entrée est née (l'identifiant du message porteur).
   * Il permet de replier la ligne de temps par tour sans rien recalculer.
   */
  tourId: z.string().optional(),
  /** Ce que l'entrée dit en une ligne : nom d'outil, libellé de tâche, ou moment. */
  libelle: z.string().default(''),
  /**
   * UNE ENTRÉE QUE RIEN N'A ENCORE ÉCRIT : l'écho local d'une demande, posé par
   * l'écran à l'instant du clic pour que le fil bouge. Elle se LIT dans le flux,
   * mais aucun point de la barre ne s'en sert pour avancer : l'état d'un point
   * se lit dans ce que la carte a ÉCRIT, jamais dans ce qu'un écran espère
   * (`pointsDuParcours`, `shared/src/parcours-en-points.ts`). Jamais enregistrée.
   */
  provisoire: z.boolean().optional(),

  /* ---- Ce qui n'appartient qu'aux requêtes ---- */
  /** Le nom de l'outil appelé, tel que le moteur l'a demandé. */
  outil: z.string().optional(),
  /** Les paramètres, en JSON lisible, bornés. */
  params: z.string().optional(),
  /** Le TEXTE EXACT rendu, borné — jamais un résumé. */
  resultat: z.string().optional(),
  /** Un refus reste une étape du parcours : on le garde, marqué comme tel. */
  reussie: z.boolean().optional(),
  /** Durée de l'appel en millisecondes, quand elle a pu être mesurée. */
  dureeMs: z.number().optional(),

  /* ---- Ce qui n'appartient qu'aux points de travail ---- */
  /** L'état de la ligne de tâche, repris tel quel du moteur. */
  etat: z.string().optional(),
  /** Les données que le point porte, en JSON lisible. */
  donnees: z.string().optional(),
});
export type EntreeJournal = z.infer<typeof EntreeJournal>;

/**
 * LE DOCUMENT ENTIER, tel qu'il voyage du démon à l'écran : un seul objet, une
 * seule liste, du premier mot du cadrage au dernier du rapport.
 */
export const JournalDeCarte = z.object({
  cardId: z.string(),
  entrees: z.array(EntreeJournal).default([]),
  /** Ce que le journal pèse en base, pour le dire sans avoir à compter à l'écran. */
  signes: z.number().nonnegative().default(0),
});
export type JournalDeCarte = z.infer<typeof JournalDeCarte>;

/**
 * DE QUELLE PHASE RELÈVE UN TOUR.
 *
 * Le rôle de l'agent suffit presque : `cadrage` cadre, tout le reste exécute.
 * La seule nuance est le RECADRAGE — un agent de cadrage qui reprend une carte
 * ayant déjà travaillé. On le reconnaît à ce que le journal contient DÉJÀ de
 * l'exécution : rien d'autre n'est nécessaire, et surtout pas l'état de la
 * carte, qui peut avoir été déplacé à la main entre-temps.
 */
export function phaseDuTour(role: string | undefined, aDejaExecute: boolean): PhaseJournal {
  if (role === 'cadrage') return aDejaExecute ? 'recadrage' : 'cadrage';
  return 'execution';
}

/** Le journal porte-t-il déjà une trace d'exécution ? */
export function aDejaExecute(entrees: readonly Pick<EntreeJournal, 'phase'>[]): boolean {
  return entrees.some((e) => e.phase === 'execution' || e.phase === 'rapport');
}

/**
 * L'ORDRE DE LECTURE : par rang croissant, point final. On trie une copie —
 * la liste reçue n'est jamais retournée sur place.
 */
export function ordonnerJournal(entrees: readonly EntreeJournal[]): EntreeJournal[] {
  return [...entrees].sort((a, b) => a.rang - b.rang);
}

/**
 * CETTE LIGNE ARRIVE-T-ELLE APRÈS UN TROU ?
 *
 * Les rangs d'une carte se suivent sans jamais sauter ni resservir : le démon
 * pose le maximum connu plus un (`prochainRang`, `server/src/journal-carte.ts`),
 * et aucune ligne n'est jamais retirée — l'allègement vide un texte, pas une
 * ligne. Une entrée qui arrive au-delà du dernier rang connu plus un dit donc
 * que des lignes se sont perdues en route : un canal mort pendant la veille d'un
 * téléphone, et le plan v3 d'une carte n'est jamais arrivé à l'écran (#88b9,
 * 11.09.2026). L'écran redemande alors le journal entier, au lieu d'allonger
 * une liste trouée qui aurait l'air complète.
 */
export function journalATrou(connues: readonly Pick<EntreeJournal, 'rang'>[], arrivee: Pick<EntreeJournal, 'rang'>): boolean {
  const dernier = connues.reduce((haut, entree) => Math.max(haut, entree.rang), -1);
  return arrivee.rang > dernier + 1;
}

/**
 * UNE LIGNE REÇUE REJOINT LA LISTE AFFICHÉE — NEUVE OU ENRICHIE.
 *
 * L'écran n'acceptait que du NOUVEAU : une ligne dont l'identifiant était déjà
 * connu était écartée comme doublon. Or une ligne du journal peut être
 * COMPLÉTÉE après coup — la synthèse écrite au début d'un tour rejoint le jalon
 * « Demande » déjà affiché (`completerDonneesDuJournal`). La mise à jour était
 * donc perdue, et le résultat n'apparaissait qu'au prochain rechargement de la
 * page. Une ligne connue est désormais REMPLACÉE à sa place ; une ligne neuve
 * s'ajoute. Le tri par rang tient dans les deux cas.
 */
export function fusionnerEntreeJournal<T extends Pick<EntreeJournal, 'id' | 'rang'>>(
  connues: readonly T[],
  arrivee: T,
): T[] {
  const index = connues.findIndex((entree) => entree.id === arrivee.id);
  const suivante = index >= 0 ? [...connues] : [...connues, arrivee];
  if (index >= 0) suivante[index] = arrivee;
  return suivante.sort((a, b) => a.rang - b.rang);
}

/**
 * LES OUTILS QU'ON NE JOURNALISE PAS. Un appel qui ne fait que RELIRE l'état du
 * journal ou de la liste de tâches se rappellerait lui-même à l'infini : on
 * l'écarte. Tout le reste entre, y compris les refus.
 */
const OUTILS_SANS_TRACE = new Set(['journal_carte']);

export function outilJournalise(nom: string): boolean {
  return !OUTILS_SANS_TRACE.has(nom);
}

/**
 * MET EN JSON LISIBLE ce qu'un outil a reçu comme paramètres, borné. Un objet
 * illisible (référence circulaire, valeur non sérialisable) ne fait pas tomber
 * l'appel : on écrit ce qu'on a pu, et l'on dit que la mise en forme a échoué.
 */
export function paramsLisibles(args: unknown): string {
  if (args === undefined || args === null) return '';
  try {
    const texte = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
    return bornerTexte(texte ?? '', PLAFOND_PARAMS);
  } catch {
    return '[paramètres illisibles]';
  }
}

/* ------------------------------------------------------------------ */
/* LE FLUX VERTICAL : UN GENRE D'ACTION PAR ÉVÉNEMENT                   */
/* ------------------------------------------------------------------ */

/**
 * LE GENRE D'ACTION D'UNE ENTRÉE — CE QUI DÉCIDE SON ICÔNE SUR LE FLUX.
 *
 * La ligne de temps se lit d'abord AVEC LES YEUX : une colonne de ronds tous
 * identiques ne raconte rien, et il faut lire chaque libellé pour savoir si
 * l'agent lisait un fichier, lançait une commande ou posait une question. Le
 * genre est donc calculé ICI, en règle pure, à partir de ce que l'entrée porte
 * réellement (nature, outil, libellé) — jamais deviné dans le composant, où
 * personne ne pourrait le tester.
 *
 * `outil` reste le refuge : un outil inconnu se dessine en outil, il ne
 * disparaît pas du flux.
 */
export const GENRES_ACTION = [
  'demande',
  'depart',
  'plan',
  'memoire',
  'lecture',
  'ecriture',
  'commande',
  'recherche',
  'question',
  'web',
  'outil',
  'point',
  'reponse',
  'comprehension',
  'note',
  'incident',
] as const;
export type GenreAction = (typeof GENRES_ACTION)[number];

/** Les libellés de jalon que le démon écrit, et le genre de chacun. */
/**
 * LE LIBELLÉ DU JALON « PLAN PROPOSÉ », écrit UNE fois.
 *
 * C'est un repère TECHNIQUE, pas un texte affiché : le démon l'écrit dans le
 * journal, l'écran le reconnaît. Recopié en clair des deux côtés, il passait
 * pour du français écrit en dur — et une retouche d'un seul côté aurait cassé
 * le rapprochement sans que rien ne le dise.
 */
export const JALON_PLAN_PROPOSE = 'Plan proposé';

/**
 * LE JALON QUI OUVRE UN TOUR : il porte le moteur, le modèle et la réflexion
 * retenus, et c'est lui qui nourrit le point des paramètres du parcours
 * (`reglagesDuTour`). Repère TECHNIQUE, comme celui du plan : écrit par le
 * démon, reconnu par l'écran, jamais recopié en clair des deux côtés.
 */
export const JALON_TOUR_LANCE = 'Tour lancé';

/**
 * LE JALON « COMPRÉHENSION », écrit par l'outil `rendre_comprehension` du
 * cadrage : ce que l'agent a compris de la demande, dans ses mots, à la fin
 * de chaque tour. Repère TECHNIQUE comme les deux autres.
 */
export const JALON_COMPREHENSION = 'Compréhension';

/**
 * LE JALON « PLAN DEMANDÉ », écrit par le démon sur le clic « Générer le
 * plan » : la demande n'est pas un message de l'utilisateur, elle n'a donc pas
 * de bulle — mais elle a bien eu lieu, et le parcours le dit.
 */
export const JALON_PLAN_DEMANDE = 'Plan demandé';

/**
 * LE JALON D'UNE CARTE ÉCARTÉE DU LOT. La publication l'écrit dans le journal
 * de la carte quand sa branche n'a pas pu être fusionnée : le texte du jalon
 * (`resultat`) nomme les fichiers en conflit et la carte du lot heurtée
 * (`mentionDeLEcartement`, `fusion-du-lot.ts`). C'est un INCIDENT dans la
 * ligne de temps de la carte — le même canal que « Tour interrompu », pas un
 * nouveau champ.
 */
export const JALON_ECARTEE_DU_LOT = 'Écartée de la publication';

/**
 * LE JALON DU RATTRAPAGE : l'agent de la carte écartée est relancé, après la
 * publication, pour réconcilier sa branche avec ce qui vient d'être mis en
 * ligne (`shared/src/rattrapage-ecartee.ts`). Il suit « Écartée de la
 * publication » dans la ligne de temps, et dit s'il vient de la fin de
 * publication ou du bouton « Réconcilier ».
 */
export const JALON_RATTRAPAGE_APRES_ECARTEMENT = 'Rattrapage après écartement';

/**
 * LE JALON D'UNE PHRASE DE PASSAGE : ce que l'agent écrit ENTRE deux actions
 * (« Je vérifie… », « Première cause trouvée… »). Le démon coupe le texte du
 * tour à chaque action (`shared/src/texte-du-tour.ts`) : chaque morceau clos
 * par une action s'écrit ici, à sa place parmi les actions, et se lit dans
 * « Réflexions » — plus en tête de la réponse ni du compte rendu. Son texte
 * est dans `resultat`.
 */
export const JALON_NOTE_DE_L_AGENT = 'Note de l’agent';

const GENRE_PAR_JALON: Record<string, GenreAction> = {
  Demande: 'demande',
  [JALON_TOUR_LANCE]: 'depart',
  [JALON_PLAN_PROPOSE]: 'plan',
  [JALON_PLAN_DEMANDE]: 'plan',
  [JALON_COMPREHENSION]: 'comprehension',
  'Réponse rendue': 'reponse',
  [JALON_NOTE_DE_L_AGENT]: 'note',
  'Tour interrompu': 'incident',
  /*
   * TROIS FINS DE TOUR QUI NE SONT PAS DES INCIDENTS (`issue-de-tour.ts`) :
   * une PAUSE de quota (la relève a sa propre route, souvent automatique), un
   * moteur JAMAIS PARTI (la carte repart d'elle-même) et un arrêt DEMANDÉ à la
   * main. Les compter comme des pannes peignait l'étape « Rapport » en rouge
   * et faisait relancer à la main un travail qui repartait tout seul.
   */
  [JALON_TOUR_EN_PAUSE]: 'point',
  [JALON_TOUR_NON_PARTI]: 'point',
  [JALON_TOUR_ARRETE]: 'point',
  [JALON_ECARTEE_DU_LOT]: 'incident',
  [JALON_RATTRAPAGE_APRES_ECARTEMENT]: 'point',
};

/**
 * LES FAMILLES D'OUTILS, RECONNUES SUR LE NOM SEUL ET EN ENTIER.
 *
 * Les motifs sont ANCRÉS. Ils cherchaient auparavant leur mot n'importe où dans
 * « nom de l'outil + libellé », et une commande `cat docs/memoire/…` passait
 * donc pour une lecture de la mémoire du projet : son résultat s'affichait en
 * markdown, titres énormes compris, au lieu de la sortie alignée d'un terminal.
 * Un nom d'outil est un mot entier, jamais un morceau de chemin.
 */
const FAMILLES_OUTIL: { motif: RegExp; genre: GenreAction }[] = [
  { motif: /^(?:mcp__[a-z0-9_]+__)?(?:todowrite|taskcreate|taskupdate)$/i, genre: 'plan' },
  { motif: /^(?:mcp__[a-z0-9_]+__)?(?:project_memory|remember|competences|memoire|memory)$/i, genre: 'memoire' },
  { motif: /^(?:mcp__[a-z0-9_]+__)?(?:ask_user|question)$/i, genre: 'question' },
  { motif: /^(?:websearch|webfetch|fetch|curl)$/i, genre: 'web' },
  { motif: /^(?:grep|glob|search|find|codebase_search)$/i, genre: 'recherche' },
  { motif: /^(?:bash|shell|commande|command|terminal|exec|run_terminal_cmd)$/i, genre: 'commande' },
  { motif: /^(?:write|edit|multiedit|notebookedit|patch|apply_patch)$/i, genre: 'ecriture' },
  { motif: /^(?:read|lecture|cat|open|notebookread)$/i, genre: 'lecture' },
];

/**
 * LES ÉTIQUETTES QUE LE MOTEUR ÉCRIT, quand le nom brut de l'outil manque.
 *
 * Les entrées d'AVANT (et les moteurs qui n'annoncent qu'une étape lisible) ne
 * portent au journal que le libellé français fabriqué par `humanStep`
 * (`server/src/engines/types.ts`) : « Commande : npm test », « Lecture de
 * web/src/app.tsx ». On le reconnaît donc à son DÉBUT, qui est le seul endroit
 * stable — la suite est un chemin ou une ligne de commande, où tous les mots
 * peuvent apparaître.
 *
 * L'ORDRE COMPTE : « Lecture de la mémoire du projet » est de la mémoire avant
 * d'être une lecture.
 */
const ETIQUETTES_D_ETAPE: { motif: RegExp; genre: GenreAction }[] = [
  { motif: /^Mise à jour du plan/i, genre: 'plan' },
  { motif: /^(?:Mémoire du projet|Lecture de la mémoire)/i, genre: 'memoire' },
  { motif: /^Question/i, genre: 'question' },
  { motif: /^Consultation du web/i, genre: 'web' },
  /* CHERCHER UN OUTIL N'EST PAS CHERCHER DANS LE PROJET. `ToolSearch` porte le
     libellé « Recherche d’un outil » (`noms-outils.ts`) : pris par le motif
     ci-dessous, il devenait une recherche, et le récit affichait « Recherche
     dans le projet — select:mcp__beluga__rendre_plan ». Il se range donc en
     outil, AVANT que la recherche ne l'attrape. */
  { motif: /^Recherche d[’']un outil/i, genre: 'outil' },
  { motif: /^Recherche/i, genre: 'recherche' },
  { motif: /^(?:Commande|Lancement des tests|Construction du projet|Enregistrement et sauvegarde)/i, genre: 'commande' },
  { motif: /^(?:Écriture de|Modification de )/i, genre: 'ecriture' },
  { motif: /^(?:Lecture de|Capture)/i, genre: 'lecture' },
];

export function genreDAction(entree: Pick<EntreeJournal, 'nature' | 'outil' | 'libelle' | 'reussie'>): GenreAction {
  if (entree.nature === 'point') return 'point';
  if (entree.nature === 'jalon') {
    const connu = GENRE_PAR_JALON[entree.libelle ?? ''];
    if (connu) return connu;
    return entree.reussie === false ? 'incident' : 'depart';
  }
  /* LE NOM BRUT D'ABORD : c'est le seul repère sûr. */
  const nom = (entree.outil ?? '').trim();
  for (const famille of FAMILLES_OUTIL) {
    if (famille.motif.test(nom)) return famille.genre;
  }
  /* …puis l'étiquette française, pour les entrées qui n'ont que celle-là. Le
     nom est réessayé ici : sur une vieille entrée, il EST l'étiquette. */
  for (const forme of ETIQUETTES_D_ETAPE) {
    if (forme.motif.test(entree.libelle ?? '') || forme.motif.test(nom)) return forme.genre;
  }
  /* L'outil reste le refuge : un outil inconnu se dessine en outil, il ne
     disparaît pas du flux. */
  return 'outil';
}

/* ------------------------------------------------------------------ */
/* LE DERNIER POINT DU FLUX : LA RÉPONSE, SELON SON GABARIT             */
/* ------------------------------------------------------------------ */

/**
 * LA DERNIÈRE RÉPONSE RENDUE, s'il y en a une. C'est le point qui referme le
 * flux : le jalon de phase `rapport` le plus récent qui porte un texte.
 */
/**
 * LE LIBELLÉ DU JALON « PLAN PROPOSÉ », écrit UNE fois.
 *
 * C'est un repère TECHNIQUE, pas un texte affiché : le démon l'écrit dans le
 * journal, l'écran le reconnaît. Recopié en clair des deux côtés, il passait
 * pour du français écrit en dur — et une retouche d'un seul côté aurait cassé
 * le rapprochement sans que rien ne le dise.
 */
/**
 * LES TOURS QUI ONT RENDU UN PLAN.
 *
 * Un tour de cadrage qui rend un plan écrit DEUX entrées portant le même
 * texte : le jalon « Plan proposé » et le jalon « Réponse rendue ». L'écran a
 * donc besoin de savoir, pour chaque tour, si sa réponse porte un plan —
 * pour n'afficher le plan qu'À LA DEMANDE et ne pas le redire deux fois.
 *
 * Règle pure : ni base, ni disque. Elle rend l'ensemble des identifiants de
 * tour concernés ; un tour sans identifiant ne peut pas être rapproché, il est
 * simplement absent.
 */
export function toursAvecPlan(entrees: readonly EntreeJournal[]): Set<string> {
  const tours = new Set<string>();
  for (const entree of entrees) {
    if (entree.nature === 'jalon' && entree.libelle === JALON_PLAN_PROPOSE && entree.tourId) {
      tours.add(entree.tourId);
    }
  }
  return tours;
}

/**
 * LE MONTAGE DU FLUX : LA SUITE D'ÉVÉNEMENTS QUE L'ÉCRAN DESSINE.
 *
 * Le parcours d'une carte n'est pas une simple liste d'entrées : il porte les
 * repères de phase, les réponses finales rendues à leur place dans le temps, le
 * plan proposé — et, depuis que les commandes s'enchaînent par dizaines, des
 * SUITES DE COMMANDES repliées en un seul bloc.
 *
 * Tout cela se décidait dans le composant. C'est une règle : elle vit donc ici,
 * sans base ni disque, et se teste seule.
 *
 * LE REGROUPEMENT SUIT LA CONTINUITÉ, RIEN D'AUTRE. Deux commandes ne se
 * réunissent que si elles se suivent VRAIMENT : la moindre autre étape entre
 * elles — une lecture, un point de travail, un changement de phase — coupe la
 * suite en deux. On ne rassemble jamais des commandes éloignées sous prétexte
 * qu'elles se ressemblent : le flux raconte le temps, et l'ordre du temps ne se
 * réécrit pas.
 */
export type EvenementDuFlux =
  | { sorte: 'phase'; cle: string; phase: PhaseJournal; at: number }
  | { sorte: 'entree'; cle: string; entree: EntreeJournal }
  | { sorte: 'commandes'; cle: string; entrees: EntreeJournal[] }
  | { sorte: 'reponse'; cle: string; entree: EntreeJournal; dernier: boolean; porteUnPlan: boolean }
  | { sorte: 'plan'; cle: string; entree: EntreeJournal }
  /**
   * CE QUE L'AGENT DE CADRAGE A COMPRIS, rendu par l'outil `rendre_comprehension`
   * et posé en jalon : c'est le point que le vibe codeur vient lire, il reste
   * donc au premier niveau du flux, jamais replié sous le travail.
   */
  | { sorte: 'comprehension'; cle: string; entree: EntreeJournal; dernier: boolean }
  /**
   * LE TRAVAIL DE L'AGENT, REPLIÉ EN UN SEUL POINT.
   *
   * Entre deux moments qui comptent, le parcours alignait tout ce que l'agent
   * avait fait : « Tour lancé », « Commande : … », les lectures, les points
   * de la liste de tâches, les ouvertures de mémoire. Ce sont des ACTIONS DE
   * MACHINE, pas des moments du parcours de la carte : elles noyaient la seule
   * chose qu'on vient lire, ce qui a été rendu. Elles se rangent donc sous un
   * point repliable, fermé au départ — rien n'est retiré, tout se rouvre, et
   * l'interrupteur « Détails techniques » l'ouvre d'office.
   *
   * CELA VAUT POUR LE CADRAGE COMME POUR L'EXÉCUTION : le cadrage se lisait en
   * huit temps dessinés d'après les outils appelés, une timeline que l'écran
   * relisait dans le texte. Le parcours ne se déduit plus de rien : les
   * moments du cadrage sont ses JALONS — la demande, la compréhension rendue,
   * le plan rendu —, et le reste est du travail de machine.
   *
   * Ce qui RÉCLAME LES YEUX en sort : une question posée, un refus, un échec
   * gardent leur ligne dans le flux.
   */
  | { sorte: 'travail'; cle: string; at: number; entrees: EntreeJournal[] };

/**
 * À PARTIR DE COMBIEN DE COMMANDES QUI SE SUIVENT ON REGROUPE. Deux : c'est le
 * moment où la répétition commence à noyer le reste. Une commande seule garde
 * sa ligne, comme n'importe quelle autre étape.
 */
export const SEUIL_GROUPE_COMMANDES = 2;

/** Le temps total d'une suite de commandes, quand chacune a été chronométrée. */
export function dureeDuGroupe(entrees: readonly EntreeJournal[]): number | undefined {
  const connues = entrees.filter((e) => e.dureeMs !== undefined);
  if (!connues.length) return undefined;
  return connues.reduce((total, e) => total + (e.dureeMs ?? 0), 0);
}

/** Ce jalon est-il LA COMPRÉHENSION rendue par le cadrage ? */
function estUneComprehension(entree: EntreeJournal): boolean {
  return entree.nature === 'jalon' && entree.libelle === JALON_COMPREHENSION;
}

/** Ce jalon est-il LE PLAN proposé par le cadrage ? */
function estUnPlanPropose(entree: EntreeJournal): boolean {
  return entree.nature === 'jalon' && entree.libelle === JALON_PLAN_PROPOSE;
}

/** Ce jalon est-il LA RÉPONSE FINALE d'un tour — celle qui referme le flux ? */
function estUneReponseFinale(entree: EntreeJournal): boolean {
  return (
    entree.phase === 'rapport' &&
    entree.nature === 'jalon' &&
    !!entree.resultat &&
    !estUnPlanPropose(entree)
  );
}

export function montageDuFlux(
  entrees: readonly EntreeJournal[],
  options?: {
    /** La réponse la plus récente : c'est la seule ouverte d'office. */
    reponseId?: string;
    /** La compréhension la plus récente : la seule ouverte d'office. */
    comprehensionId?: string;
    /** Les tours dont la réponse porte un plan (`toursAvecPlan`). */
    toursDePlan?: ReadonlySet<string>;
    /** À partir de combien de commandes consécutives on regroupe. */
    seuil?: number;
    /**
     * LE CONTENU D'UN BLOC DE TRAVAIL SE MONTE AVEC LA MÊME RÈGLE, sans quoi
     * il se replierait à l'infini dans lui-même.
     */
    sansBlocDeTravail?: boolean;
  },
): EvenementDuFlux[] {
  const toursDePlan = options?.toursDePlan ?? new Set<string>();
  const seuil = options?.seuil ?? SEUIL_GROUPE_COMMANDES;
  const evenements: EvenementDuFlux[] = [];
  let phaseCourante: PhaseJournal | undefined;
  /* La suite de commandes en train de se former. Elle est versée dans le flux
     dès qu'autre chose survient — et c'est ce qui garantit la continuité. */
  let suite: EntreeJournal[] = [];
  /* Le travail de l'agent en train de se former : il se replie en UN point. */
  let travail: EntreeJournal[] = [];

  const verser = () => {
    if (!suite.length) return;
    if (suite.length >= seuil) {
      evenements.push({ sorte: 'commandes', cle: `commandes-${suite[0].id}`, entrees: suite });
    } else {
      for (const entree of suite) evenements.push({ sorte: 'entree', cle: entree.id, entree });
    }
    suite = [];
  };

  /** Referme la plage de travail courante et pose son point repliable. */
  const verserLeTravail = () => {
    if (!travail.length) return;
    const premier = travail[0];
    evenements.push({ sorte: 'travail', cle: `travail-${premier.id}`, at: premier.at, entrees: travail });
    travail = [];
  };

  for (const entree of entrees) {
    if (entree.phase !== phaseCourante) {
      verser();
      verserLeTravail();
      phaseCourante = entree.phase;
      /* LE REPÈRE « RAPPORT » NE DIT RIEN QUE LA RÉPONSE NE DISE MIEUX. Il se
         posait juste au-dessus du point « Réponse finale », avec la même
         heure : deux titres l'un sur l'autre, dont le premier ne s'ouvrait sur
         rien. La réponse finale EST le premier niveau du flux à cet endroit —
         le repère ne paraît donc que si ce qui ouvre la phase n'est ni la
         réponse ni le plan. Le cadrage et l'exécution, eux, ouvrent toujours
         sur leur repère : c'est lui que la frise du parcours vient viser. */
      const referme = entree.phase === 'rapport' && (estUneReponseFinale(entree) || estUnPlanPropose(entree));
      if (!referme) {
        evenements.push({ sorte: 'phase', cle: `phase-${entree.id}`, phase: entree.phase, at: entree.at });
      }
    }

    /* LE PLAN PASSE EN PREMIER : il porte le texte du tour, comme la réponse,
       et serait pris pour elle s'il était écrit sous la phase du rapport. */
    if (estUnPlanPropose(entree)) {
      verser();
      verserLeTravail();
      evenements.push({ sorte: 'plan', cle: entree.id, entree });
      continue;
    }

    /* LA COMPRÉHENSION RENDUE est un moment du parcours : elle garde sa ligne. */
    if (estUneComprehension(entree)) {
      verser();
      verserLeTravail();
      evenements.push({ sorte: 'comprehension', cle: entree.id, entree, dernier: entree.id === options?.comprehensionId });
      continue;
    }

    /* UNE RÉPONSE FINALE RESTE À SA PLACE DANS LE TEMPS : elle se pose APRÈS
       le travail qui l'a produite, jamais tout au fond. */
    if (estUneReponseFinale(entree)) {
      verser();
      verserLeTravail();
      evenements.push({
        sorte: 'reponse',
        cle: entree.id,
        entree,
        dernier: entree.id === options?.reponseId,
        porteUnPlan: !!entree.tourId && toursDePlan.has(entree.tourId),
      });
      continue;
    }

    /* CE QUE L'AGENT FAIT SE RANGE SOUS SON POINT DE TRAVAIL — cadrage comme
       exécution — sauf ce qui réclame les yeux, qui garde sa ligne dans le flux. */
    if (!options?.sansBlocDeTravail && !reclameLesYeux(entree)) {
      verser();
      travail.push(entree);
      continue;
    }
    verserLeTravail();

    if (genreDAction(entree) === 'commande') {
      suite.push(entree);
      continue;
    }

    verser();
    evenements.push({ sorte: 'entree', cle: entree.id, entree });
  }
  verser();
  verserLeTravail();
  return evenements;
}

/**
 * CETTE ENTRÉE DOIT-ELLE RESTER VISIBLE DANS LE FLUX ?
 *
 * Une question posée attend une réponse, un refus ou un échec explique ce qui
 * s'est passé : les replier sous « Travail de l'agent » reviendrait à les
 * cacher. Tout le reste — lectures, écritures, commandes, points de la liste
 * de tâches — est une action de machine, et se replie.
 */
function reclameLesYeux(entree: EntreeJournal): boolean {
  if (entree.reussie === false) return true;
  const genre = genreDAction(entree);
  if (genre === 'question' || genre === 'incident') return true;
  /* LES JALONS QUI RACONTENT LE PARCOURS restent au premier niveau : la demande
     de l'utilisateur, la demande de plan. Le départ d'un tour, lui, est de la
     machine. */
  if (entree.nature === 'jalon') return genre === 'demande' || entree.libelle === JALON_PLAN_DEMANDE;
  return false;
}

/* ------------------------------------------------------------------ */
/* UN APPEL D'OUTIL NE S'ÉCRIT QU'UNE FOIS DANS LE PARCOURS            */
/* ------------------------------------------------------------------ */

/**
 * LE NOM NU D'UN OUTIL : sans son préfixe de pont (`mcp__beluga__ask_user`
 * devient `ask_user`). C'est ce nom-là qui rapproche les deux traces d'un même
 * appel, l'une écrite par le pont, l'autre par l'étape du moteur.
 */
export function nomNuDOutil(nom: string | undefined): string {
  if (!nom) return '';
  const sansPont = nom.replace(/^mcp__[a-z0-9_]+__/i, '');
  return sansPont.trim().toLowerCase();
}

/**
 * UN MÊME APPEL D'OUTIL, DEUX FOIS DANS LE PARCOURS — ET IL N'EN RESTE QU'UN.
 *
 * Le même appel était journalisé DEUX FOIS, par deux chemins qui s'ignorent :
 * le pont d'outils l'écrit sous son nom brut (« ask_user ») avec ses
 * paramètres et son texte exact ; l'étape du moteur le réécrit sous son
 * étiquette française (« Outil ask_user », « Modification d'une carte ») avec
 * sa durée. On lisait donc la même question posée deux fois, l'une sous
 * l'autre, avec deux réponses différentes — et l'on ne savait plus laquelle
 * était la vraie.
 *
 * Les deux traces sont RÉUNIES en une seule ligne : le libellé le plus lisible
 * (l'étiquette, jamais le nom nu de l'outil), les paramètres et le texte les
 * plus complets, la durée mesurée, et l'échec s'il y en a eu un.
 *
 * LA FUSION NE PORTE QUE SUR DES TRACES QUI SE SUIVENT, dans le même tour et
 * pour le même outil : deux appels séparés par autre chose racontent deux
 * moments, et le parcours raconte le temps.
 *
 * Règle pure : ni base, ni disque. Le JSON intégral, lui, garde les entrées
 * telles qu'elles ont été écrites — c'est la trace, elle ne se réécrit pas.
 */
export function fusionnerLesAppelsEnDouble(entrees: readonly EntreeJournal[]): EntreeJournal[] {
  const ordonnees = ordonnerJournal(entrees);
  const sortie: EntreeJournal[] = [];
  for (const entree of ordonnees) {
    const avant = sortie[sortie.length - 1];
    if (avant && memeAppel(avant, entree)) {
      sortie[sortie.length - 1] = reunirDeuxTraces(avant, entree);
      continue;
    }
    sortie.push(entree);
  }
  return sortie;
}

/**
 * QUI A ÉCRIT CETTE TRACE — LE PONT D'OUTILS, OU L'ÉTAPE DU MOTEUR ?
 *
 * C'est le seul repère sûr, et il se lit sur l'entrée elle-même : le pont écrit
 * le NOM BRUT de l'outil en libellé comme en outil (« ask_user » / « ask_user »),
 * l'étape du moteur pose son étiquette française par-dessus (« Question posée »,
 * « Modification d'une carte »). Deux traces du MÊME chemin racontent donc deux
 * appels différents et ne se réunissent jamais.
 */
function provenanceDeLaTrace(entree: EntreeJournal): 'pont' | 'etape' {
  const etiquette = (entree.libelle ?? '').trim();
  if (!etiquette) return 'pont';
  return nomNuDOutil(etiquette) === nomNuDOutil(entree.outil) ? 'pont' : 'etape';
}

/** Ces deux traces racontent-elles le MÊME appel d'outil ? */
function memeAppel(a: EntreeJournal, b: EntreeJournal): boolean {
  if (a.nature !== 'requete' || b.nature !== 'requete') return false;
  if ((a.tourId ?? '') !== (b.tourId ?? '')) return false;
  const nomA = nomNuDOutil(a.outil);
  const nomB = nomNuDOutil(b.outil);
  if (!nomA || nomA !== nomB) return false;
  /*
   * DEUX APPELS VOLONTAIRES DU MÊME OUTIL RESTENT DEUX LIGNES. Ce n'est PLUS
   * une affaire de secondes : deux commandes lancées coup sur coup s'écrivent
   * toutes deux par le moteur, et se réunir les faisait disparaître l'une dans
   * l'autre. Ce qui prouve un même appel, c'est que les DEUX chemins l'aient
   * écrit — le pont une fois, le moteur une fois — et qu'aucune autre requête
   * ne se soit glissée entre les deux (la fusion ne regarde que des traces qui
   * se suivent).
   */
  if (provenanceDeLaTrace(a) === provenanceDeLaTrace(b)) return false;
  /*
   * …ET UNE QUESTION ATTEND SA RÉPONSE AUSSI LONGTEMPS QU'IL LE FAUT. Le pont
   * écrit sa trace à la SECONDE OÙ LA QUESTION EST POSÉE, l'étape du moteur
   * quand la réponse arrive : entre les deux, il y a le temps que l'utilisateur
   * a mis à répondre. Une fenêtre d'une minute laissait donc s'échapper toute
   * question répondue plus tard — et la même question se lisait DEUX FOIS,
   * l'une portant la consigne rendue à l'agent, l'autre la vraie réponse. La
   * borne est celle d'un appel d'outil : au-delà, le moteur a coupé.
   */
  return Math.abs(b.at - a.at) <= FENETRE_MEME_APPEL;
}

/**
 * L'ÉCART MAXIMAL ENTRE LES DEUX TRACES D'UN MÊME APPEL (le pont, puis l'étape).
 * C'est la durée qu'un appel d'outil peut tenir sans être coupé par le moteur
 * (`delaiOutilMoteurMs`) : une question attendue une demi-heure entre dedans.
 */
const FENETRE_MEME_APPEL = delaiOutilMoteurMs();

/** Le plus complet des deux textes : un vide ne remplace jamais un plein. */
function lePlusComplet(a: string | undefined, b: string | undefined): string | undefined {
  const gauche = a ?? '';
  const droite = b ?? '';
  if (!gauche) return b;
  if (!droite) return a;
  return droite.length > gauche.length ? b : a;
}

/**
 * LE TEXTE RENDU QUI DIT VRAIMENT QUELQUE CHOSE.
 *
 * Le plus long gagnait, ce qui suffit partout SAUF pour une question : le pont
 * y écrit une consigne adressée au moteur (« ARRÊTE-TOI ICI… »), plus longue
 * qu'un « Oui » choisi par l'utilisateur. La consigne cède donc toujours devant
 * un vrai texte, et ne survit que si l'autre trace n'a rien à dire.
 */
function leResultatQuiDitQuelqueChose(a: string | undefined, b: string | undefined): string | undefined {
  const consigneA = estUneConsigneAuMoteur(a);
  const consigneB = estUneConsigneAuMoteur(b);
  if (consigneA && !consigneB) return b?.trim() ? b : a;
  if (consigneB && !consigneA) return a?.trim() ? a : b;
  return lePlusComplet(a, b);
}

/** Réunit deux traces d'un même appel en gardant ce que chacune apporte. */
function reunirDeuxTraces(a: EntreeJournal, b: EntreeJournal): EntreeJournal {
  const nom = nomNuDOutil(a.outil);
  /* LE LIBELLÉ LE PLUS PARLANT GAGNE : « Modification d'une carte » dit ce qui
     s'est passé, « board_update_card » ne dit que par quel outil. */
  const etiquettes = [a.libelle, b.libelle].filter((l) => l && nomNuDOutil(l) !== nom);
  const durees = [a.dureeMs, b.dureeMs].filter((d): d is number => d !== undefined);
  return {
    ...a,
    libelle: etiquettes[0] || a.libelle || b.libelle,
    outil: a.outil || b.outil,
    params: lePlusComplet(a.params, b.params),
    resultat: leResultatQuiDitQuelqueChose(a.resultat, b.resultat),
    reussie: a.reussie === false || b.reussie === false ? false : (a.reussie ?? b.reussie),
    dureeMs: durees.length ? Math.max(...durees) : undefined,
  };
}
