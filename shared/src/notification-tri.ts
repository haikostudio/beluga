/**
 * TROIS MOTIFS ALERTENT, PAS UN DE PLUS — et la règle vaut pour les DEUX
 * canaux.
 *
 * Une alerte n'a de valeur que si elle veut toujours dire la même chose. On
 * n'en garde donc que trois genres :
 *
 *  - « attente »  : un agent a besoin de l'utilisateur (question, décision) ;
 *  - « termine »  : un agent a mené sa tâche au bout ;
 *  - « erreur »   : quelque chose a cassé, ou bloque le travail (quota épuisé,
 *                   identifiant refusé, agent interrompu).
 *
 * Tout le reste — étapes intermédiaires, changements d'état, avancements,
 * confirmations d'un geste que l'utilisateur vient lui-même de déclencher — ne
 * déclenche plus rien. L'information n'est pas perdue pour autant : elle reste
 * là où elle se lit déjà (la cloche du bandeau, le tableau, le déroulé de la
 * colonne de publication, le volet des quotas, la conversation). On coupe
 * l'alerte, pas la trace.
 *
 * LES DEUX CANAUX SUIVENT CETTE SEULE RÈGLE : la notification POUSSÉE sur le
 * téléphone (`server/src/notify.ts`) et le message passager affiché dans
 * l'application (`pushToast`, `web/src/lib/client.ts`) appellent tous deux
 * `genreDeLAlerte` / `genreDuMessage` — il n'y a rien à maintenir deux fois.
 *
 * Cinq règles vivent ici, et nulle part ailleurs :
 *  1. quel GENRE porte chaque motif — donc s'il alerte —, et à quelle famille
 *     de réglage il appartient ;
 *  2. l'IMAGE que porte l'alerte, pour qu'on la reconnaisse sans la lire ;
 *  3. l'IDENTITÉ d'un événement, pour que deux endroits du code qui décrivent
 *     la même chose ne fassent qu'une seule alerte ;
 *  4. le résumé d'un groupe : il NOMME les éléments au lieu d'un compte muet ;
 *  5. le sort d'un message de l'application qui n'annonce aucun motif : son
 *     NIVEAU tranche (un refus se dit, une réussite se tait).
 *
 * Règles pures : aucune base, aucun disque — donc rejouables telles quelles.
 */

import { LONGUEUR_CORPS, couperTexte, titreNotification } from './notification.js';

/** Les familles, telles que les réglages d'activation les connaissent déjà. */
export type FamilleNotification =
  | 'done'
  | 'failed'
  | 'waiting'
  | 'deploy'
  | 'proposal'
  | 'capacity'
  | 'quota'
  | 'systeme';

/**
 * LES TROIS GENRES QUI ALERTENT, et eux seuls. Un motif qui n'entre dans aucun
 * des trois ne notifie plus — ni sur le téléphone, ni à l'écran.
 */
export type GenreDAlerte = 'attente' | 'termine' | 'erreur';

/** Le motif REEL de l'alerte : plus fin que la famille, c'est lui qui décide. */
export type MotifNotification =
  | 'tache-terminee'
  | 'travail-sans-carte'
  | 'tache-echec'
  | 'decision-attendue'
  | 'publication-terminee'
  | 'publication-echec'
  | 'publication-en-retard'
  | 'redemarrage-serveur'
  | 'quota-seuil'
  | 'quota-surconsommation'
  | 'quota-emballement'
  | 'liste-taches'
  | 'charge-machine'
  | 'amorcage-impossible'
  | 'compte-sature'
  | 'jeton-claude-bloque'
  | 'fenetre-bientot-finie'
  | 'point-du-jour'
  | 'agent-interrompu'
  | 'geste-lent'
  | 'site-indisponible';

interface RegleMotif {
  /** La famille de réglage : c'est elle que l'utilisateur active ou coupe. */
  famille: FamilleNotification;
  /**
   * Le GENRE de l'alerte, ou `null` quand ce motif n'alerte plus du tout.
   * C'est le seul champ qui décide : trois genres alertent, le reste se tait.
   */
  genre: GenreDAlerte | null;
  /**
   * Ce motif ne naît QUE dans le navigateur : il n'a donc aucune image à
   * traduire côté service worker, qui ne voit passer que les alertes poussées.
   */
  dansLApplication?: true;
  /**
   * Le SUJET de l'événement. Deux motifs de même sujet parlant du même objet
   * sont le même événement : le second se tait.
   */
  sujet: string;
  /** L'image portée par l'alerte : on reconnaît le genre avant de lire. */
  icone: IconeNotification;
}

/**
 * Les six images possibles. Elles ne suivent pas la famille de réglage mais le
 * GENRE de nouvelle : une publication en échec est un échec, pas une
 * publication réussie en plus pâle.
 */
export type IconeNotification = 'termine' | 'attention' | 'erreur' | 'publication' | 'quota' | 'redemarrage';

/**
 * TROIS GENRES, et le motif qui n'en porte aucun se tait. L'ICÔNE, elle, ne
 * bouge pas : elle suit toujours le genre de nouvelle (une publication garde
 * son image de publication), et changer une image serait changer le contenu du
 * message — ce que cette règle ne fait pas.
 */
export const MOTIFS: Record<MotifNotification, RegleMotif> = {
  /* --- « termine » : un agent a mené sa tâche au bout ------------------ */
  'tache-terminee': { famille: 'done', genre: 'termine', sujet: 'fin-de-travail', icone: 'termine' },
  'travail-sans-carte': { famille: 'done', genre: 'termine', sujet: 'fin-de-travail', icone: 'termine' },
  /*
   * La publication est LONGUE et menée par un agent : sa fin est bien une tâche
   * finie, pas la confirmation instantanée d'un clic. On l'annonce donc encore —
   * c'est le seul geste de l'utilisateur dont on ne voit pas le bout tout de
   * suite.
   */
  'publication-terminee': { famille: 'deploy', genre: 'termine', sujet: 'publication', icone: 'publication' },

  /* --- « attente » : un agent a besoin de l'utilisateur --------------- */
  'decision-attendue': { famille: 'waiting', genre: 'attente', sujet: 'decision', icone: 'attention' },

  /* --- « erreur » : cassé, ou bloqué ---------------------------------- */
  'tache-echec': { famille: 'failed', genre: 'erreur', sujet: 'echec', icone: 'erreur' },
  // Une publication qui tombe se dit aussi fort qu'une qui aboutit : sans elle,
  // on croit son travail en ligne alors que rien n'est parti. Sujet à part, pour
  // qu'un échec ne soit jamais avalé par la réussite du même lot.
  'publication-echec': { famille: 'deploy', genre: 'erreur', sujet: 'publication-echec', icone: 'erreur' },
  /*
   * UNE ÉTAPE QUI TRAÎNE PRÉVIENT TOUT DE SUITE, sans attendre qu'un dépanneur
   * parte. Un blocage EST une erreur au sens de cette règle — comme un compte à
   * sa limite ou un geste sans réponse : le travail n'avance plus. Or c'est
   * précisément le moment où l'on veut être averti, puisque le but est de ne
   * plus jamais avoir à venir surveiller une publication soi-même. Sujet à
   * part, pour qu'un retard ne soit jamais avalé par l'échec ou la réussite du
   * même lot ; icône du BLOCAGE, pas de la publication.
   */
  'publication-en-retard': { famille: 'deploy', genre: 'erreur', sujet: 'publication-retard', icone: 'erreur' },
  /*
   * UN BLOCAGE EST UNE ERREUR. Un compte dont la limite est atteinte et un
   * amorçage refusé trois fois de suite (identifiant qui ne répond plus)
   * empêchent le travail d'avancer : ils alertent, une seule fois chacun, leur
   * appelant les gardant déjà d'insister. Leur icône reste celle du quota — on
   * ne touche ni au texte ni à la couleur du message.
   */
  'compte-sature': { famille: 'quota', genre: 'erreur', sujet: 'compte-sature', icone: 'quota' },
  'jeton-claude-bloque': { famille: 'quota', genre: 'erreur', sujet: 'jeton-bloque', icone: 'quota' },
  'amorcage-impossible': { famille: 'quota', genre: 'erreur', sujet: 'amorcage', icone: 'quota' },
  /*
   * Un agent coupé d'autorité (arrêt de secours) est un travail interrompu : la
   * règle du projet veut qu'un arrêt DISE toujours ce qu'il a fait. Il ne naît
   * que dans l'application, jamais en push.
   */
  'agent-interrompu': {
    famille: 'failed',
    genre: 'erreur',
    sujet: 'agent-interrompu',
    icone: 'erreur',
    dansLApplication: true,
  },
  /*
   * Un geste resté sans réponse plus de dix secondes : l'application est
   * bloquée, et c'est justement ce qu'on ne peut pas lire ailleurs. Né dans le
   * navigateur (voir `EVENEMENT_ATTENTE_LONGUE`), jamais poussé.
   */
  'geste-lent': {
    famille: 'systeme',
    genre: 'erreur',
    sujet: 'geste-lent',
    icone: 'attention',
    dansLApplication: true,
  },

  /*
   * UN SITE SURVEILLÉ QUI TOMBE est une panne, et personne d'autre ne la
   * verra : c'est exactement le genre de nouvelle qu'on veut recevoir loin de
   * son écran. Elle ne part qu'à la BASCULE (`shared/src/surveillance.ts`), donc
   * une fois par chute, jamais à chaque tournée. Sujet à part, pour qu'une
   * panne de site ne soit jamais avalée par l'échec d'une tâche. Le
   * RÉTABLISSEMENT, lui, ne pousse rien : il se lit sur la pastille qui
   * s'éteint et sur le bandeau de la fenêtre — c'est un retour à la normale,
   * pas une interruption.
   */
  'site-indisponible': { famille: 'systeme', genre: 'erreur', sujet: 'site-indisponible', icone: 'erreur' },

  /* --- CE QUI N'ALERTE PLUS ------------------------------------------- */
  /*
   * Chacun se lit encore là où on le cherche déjà. Le sujet reste renseigné :
   * « liste de tâches cochée » parle de la MÊME fin de travail que « tâche
   * terminée », c'était là le doublon d'origine.
   */
  // Le serveur qui repart : un changement d'état. Le bouton « Redémarrage
  // requis » et le voyant de liaison le disent, sans réveiller personne.
  'redemarrage-serveur': { famille: 'systeme', genre: null, sujet: 'redemarrage', icone: 'redemarrage' },
  // Les paliers 70 % / 90 % sont un AVANCEMENT : le volet des quotas le montre
  // bien mieux. Ce qui bloque vraiment — la limite atteinte — alerte, plus haut.
  'quota-seuil': { famille: 'quota', genre: null, sujet: 'quota', icone: 'quota' },
  'quota-surconsommation': { famille: 'quota', genre: null, sujet: 'quota', icone: 'quota' },
  'quota-emballement': { famille: 'quota', genre: null, sujet: 'quota', icone: 'quota' },
  'fenetre-bientot-finie': { famille: 'quota', genre: null, sujet: 'quota', icone: 'quota' },
  // Une liste cochée en cours de route n'est pas une tâche finie : le repère des
  // tâches, collé au champ de saisie, la montre en permanence.
  'liste-taches': { famille: 'done', genre: null, sujet: 'fin-de-travail', icone: 'termine' },
  // La jauge « Capacité du système » dit la charge, avec sa cause.
  'charge-machine': { famille: 'capacity', genre: null, sujet: 'charge', icone: 'attention' },
  'point-du-jour': { famille: 'waiting', genre: null, sujet: 'point-du-jour', icone: 'attention' },
};

/** Le genre d'un motif, ou `null` s'il n'alerte plus. */
export function genreDeLAlerte(motif: MotifNotification): GenreDAlerte | null {
  return MOTIFS[motif].genre;
}

/** Ce motif sort-il de l'application ? Vrai pour les trois genres, faux sinon. */
export function interrompt(motif: MotifNotification): boolean {
  return MOTIFS[motif].genre !== null && !MOTIFS[motif].dansLApplication;
}

/** Ce motif mérite-t-il d'être DIT, sur l'un ou l'autre canal ? */
export function alerte(motif: MotifNotification): boolean {
  return MOTIFS[motif].genre !== null;
}

/* ------------------------------------------------------------------ */
/* Le second canal : les messages passagers de l'application            */
/* ------------------------------------------------------------------ */

/** Le niveau d'un message passager, tel que l'application le connaît déjà. */
export type NiveauMessage = 'info' | 'success' | 'warning' | 'error';

/**
 * LE MÊME JUGE POUR LE SECOND CANAL. Un message passager annonce rarement son
 * motif : la plupart accompagnent un geste (un projet renommé, des réglages
 * enregistrés, une étape de publication franchie). Son NIVEAU tranche alors :
 *
 *  - « error » et « warning » disent un REFUS ou un BLOCAGE — donc une erreur,
 *    et le geste refusé n'a aucun autre endroit où se lire (le bouton, lui, ne
 *    fait que revenir à son état initial) ;
 *  - « info » et « success » confirment un geste réussi ou une étape franchie :
 *    ils se taisent. Le bouton qui passe en attente puis en coche le dit déjà.
 *
 * Un message qui NOMME son motif est jugé sur lui, jamais sur son niveau : la
 * fin d'une tâche reste dite même en « success », une étape de publication se
 * tait même en « info ».
 */
export function genreDuMessage(niveau: NiveauMessage, motif?: string): GenreDAlerte | null {
  const regle = motif ? MOTIFS[motif as MotifNotification] : undefined;
  if (regle) return regle.genre;
  return niveau === 'error' || niveau === 'warning' ? 'erreur' : null;
}

/** Ce message doit-il s'afficher ? */
export function messageAlerte(niveau: NiveauMessage, motif?: string): boolean {
  return genreDuMessage(niveau, motif) !== null;
}

export function familleDuMotif(motif: MotifNotification): FamilleNotification {
  return MOTIFS[motif].famille;
}

export function iconeDuMotif(motif: MotifNotification): IconeNotification {
  return MOTIFS[motif].icone;
}

/**
 * L'EMOJI du genre, posé en tête du titre. Sur un téléphone, le système impose
 * souvent l'icône de l'application et ignore l'image de la notification web :
 * l'emoji, lui, vit DANS le texte et s'affiche toujours. Il suit le même genre
 * que l'image (`IconeNotification`), pour qu'image et emoji ne se contredisent
 * jamais.
 */
const EMOJIS: Record<IconeNotification, string> = {
  termine: '✅',
  attention: '⚠️',
  erreur: '⛔',
  publication: '🚀',
  quota: '📊',
  redemarrage: '🔄',
};

/**
 * L'emoji d'une alerte, à partir du motif. Un motif inconnu — serveur plus
 * récent que l'application — ne met aucun emoji plutôt qu'un caractère au
 * hasard.
 */
export function emojiDuMotif(motif?: string): string {
  const regle = motif ? MOTIFS[motif as MotifNotification] : undefined;
  return regle ? EMOJIS[regle.icone] : '';
}

/** Où vivent les images, côté navigateur. Le service worker suit la même règle. */
export function cheminIcone(icone: IconeNotification): string {
  return `/notif/${icone}.png`;
}

/** L'icône de l'application : le repli, pour qu'aucune alerte ne parte sans image. */
export const IMAGE_PAR_DEFAUT = '/icon-192.png';

/**
 * L'image d'une alerte, à partir du motif qui a voyagé avec elle. Un motif
 * inconnu — une version du serveur plus récente que l'application installée —
 * retombe sur l'icône de l'application plutôt que sur un carré vide.
 */
export function imageDeLAlerte(motif?: string): string {
  const regle = motif ? MOTIFS[motif as MotifNotification] : undefined;
  return regle ? cheminIcone(regle.icone) : IMAGE_PAR_DEFAUT;
}

/**
 * L'identité d'un événement : son sujet, et l'objet dont il parle (une carte,
 * un compte, une publication). Deux appels qui rendent la même clé sont le même
 * événement, quel que soit l'endroit du code d'où ils viennent.
 */
export function cleEvenement(motif: MotifNotification, reference: string): string {
  return `${MOTIFS[motif].sujet}:${(reference ?? '').trim()}`;
}

/**
 * Un événement reste « déjà dit » pendant dix minutes. Assez long pour couvrir
 * la fin d'un tour d'agent et la clôture de sa carte, assez court pour qu'une
 * carte relancée le lendemain se signale à nouveau.
 */
export const MEMOIRE_EVENEMENT_MS = 10 * 60 * 1000;

/**
 * Rend `true` si l'événement a DÉJÀ été annoncé (il faut alors se taire), et
 * `false` s'il est nouveau — auquel cas il est inscrit. La carte des événements
 * vus est passée par l'appelant : la règle reste sans état à elle.
 */
export function evenementDejaVu(
  vus: Map<string, number>,
  cle: string,
  maintenant: number,
  dureeMs = MEMOIRE_EVENEMENT_MS,
): boolean {
  // Ménage au passage : sans cela la carte grossirait sans fin.
  for (const [ancienne, quand] of vus) {
    if (maintenant - quand > dureeMs) vus.delete(ancienne);
  }
  const depuis = vus.get(cle);
  // L'inscription NE se rafraîchit PAS : sinon un événement qui se répète en
  // boucle resterait muet pour toujours.
  if (depuis !== undefined && maintenant - depuis <= dureeMs) return true;
  vus.set(cle, maintenant);
  return false;
}

/* ------------------------------------------------------------------ */
/* Les seuils du quota de la semaine                                    */
/* ------------------------------------------------------------------ */

/** Deux paliers seulement : de quoi s'organiser, puis de quoi s'inquiéter. */
export const SEUILS_SEMAINE = [70, 90];

export interface EtatSeuilsSemaine {
  /** La fenêtre hebdomadaire à laquelle se rapportent les seuils déjà annoncés. */
  resetsAt?: number;
  franchis?: number[];
}

/**
 * Deux échéances qui ne diffèrent que de quelques minutes décrivent la MÊME
 * fenêtre. Côté Codex, `resetsAt` est recalculé en relatif à chaque lecture
 * (heure actuelle + secondes restantes) : il dérive de quelques secondes sans
 * que la fenêtre ait bougé. Une comparaison stricte y voyait à chaque fois une
 * fenêtre neuve. Un vrai changement de fenêtre, lui, écarte les deux échéances
 * de plusieurs jours : la tolérance ne les confond jamais.
 */
export const TOLERANCE_FENETRE_MS = 10 * 60_000;

export function memeFenetre(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return Math.abs(a - b) <= TOLERANCE_FENETRE_MS;
}

/**
 * Un franchissement s'annonce UNE seule fois par fenêtre. Passer de 60 à 95 %
 * d'un coup ne fait pas deux alertes : le palier le plus haut est annoncé, les
 * deux sont marqués comme dits. Une nouvelle fenêtre remet tout à zéro.
 */
export function franchissementSemaine(
  etat: EtatSeuilsSemaine | undefined,
  consommePct: number | undefined,
  resetsAt: number | undefined,
): { seuil: number; etat: EtatSeuilsSemaine } | null {
  if (!resetsAt || consommePct === undefined || !Number.isFinite(consommePct)) return null;
  const franchis = memeFenetre(etat?.resetsAt, resetsAt) ? [...(etat!.franchis ?? [])] : [];
  const atteints = SEUILS_SEMAINE.filter((seuil) => consommePct >= seuil && !franchis.includes(seuil));
  if (!atteints.length) return null;
  return {
    seuil: Math.max(...atteints),
    etat: { resetsAt, franchis: [...franchis, ...atteints].sort((a, b) => a - b) },
  };
}

/* ------------------------------------------------------------------ */
/* Le résumé d'un groupe                                                */
/* ------------------------------------------------------------------ */

const PLURIELS: Record<FamilleNotification, (n: number) => string> = {
  done: (n) => `${n} tâches terminées`,
  failed: (n) => `${n} tâches en échec`,
  waiting: (n) => `${n} décisions attendent`,
  // « terminées » serait faux dès qu'un échec est du lot : le corps nomme, lui.
  deploy: (n) => `${n} publications`,
  proposal: (n) => `${n} tâches proposées — à confirmer`,
  capacity: (n) => `${n} alertes de charge`,
  quota: (n) => `${n} alertes de quota`,
  systeme: (n) => `${n} redémarrages du serveur`,
};

/**
 * Plusieurs événements de la même famille en quatre secondes ne font qu'une
 * alerte — mais elle DIT lesquels. Un compte tout seul (« 3 alertes de quota »)
 * oblige à ouvrir l'application pour savoir de quoi il s'agit : le corps
 * énumère donc les éléments, séparés par un point médian.
 */
export function resumeGroupe(
  famille: FamilleNotification,
  elements: string[],
  projet?: string,
  emoji?: string,
): { titre: string; corps: string } {
  const noms = elements.map((element) => (element ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const nombre = Math.max(noms.length, elements.length, 1);
  return {
    titre: titreNotification(PLURIELS[famille](nombre), projet, emoji),
    corps: couperTexte(noms.join(' · '), LONGUEUR_CORPS),
  };
}
