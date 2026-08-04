/**
 * CE QUI MÉRITE D'INTERROMPRE — et ce qui ne le mérite pas.
 *
 * Une notification sort de l'application : elle allume un téléphone, souvent
 * loin du bureau. Elle ne se justifie donc que si elle appelle une décision ou
 * annonce une fin. Tout le reste (charge machine, amorçage d'une fenêtre de
 * quota, liste de tâches cochée en cours de route) se voit très bien DANS
 * l'application, quand on l'ouvre.
 *
 * Quatre règles vivent ici, et nulle part ailleurs :
 *  1. quel motif interrompt, et à quelle famille de réglage il appartient ;
 *  2. l'IMAGE que porte l'alerte, pour qu'on la reconnaisse sans la lire ;
 *  3. l'IDENTITÉ d'un événement, pour que deux endroits du code qui décrivent
 *     la même chose ne fassent qu'une seule alerte ;
 *  4. le résumé d'un groupe : il NOMME les éléments au lieu d'un compte muet.
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

/** Le motif REEL de l'alerte : plus fin que la famille, c'est lui qui décide. */
export type MotifNotification =
  | 'tache-terminee'
  | 'travail-sans-carte'
  | 'tache-echec'
  | 'decision-attendue'
  | 'publication-terminee'
  | 'publication-echec'
  | 'redemarrage-serveur'
  | 'quota-seuil'
  | 'quota-surconsommation'
  | 'quota-emballement'
  | 'liste-taches'
  | 'charge-machine'
  | 'amorcage-impossible'
  | 'fenetre-bientot-finie'
  | 'point-du-jour';

interface RegleMotif {
  /** La famille de réglage : c'est elle que l'utilisateur active ou coupe. */
  famille: FamilleNotification;
  /** Sortir de l'application, ou non. */
  interrompt: boolean;
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
 * SEPT motifs interrompent, pas un de plus. Chacun annonce une fin, un échec
 * ou une décision à prendre — c'est-à-dire quelque chose qu'on ne peut pas
 * découvrir plus tard sans dommage. Tout le reste attend qu'on ouvre
 * l'application.
 */
export const MOTIFS: Record<MotifNotification, RegleMotif> = {
  // Ce qui interrompt : une fin, un échec, une décision attendue, un manque.
  'tache-terminee': { famille: 'done', interrompt: true, sujet: 'fin-de-travail', icone: 'termine' },
  'travail-sans-carte': { famille: 'done', interrompt: true, sujet: 'fin-de-travail', icone: 'termine' },
  'tache-echec': { famille: 'failed', interrompt: true, sujet: 'echec', icone: 'erreur' },
  'decision-attendue': { famille: 'waiting', interrompt: true, sujet: 'decision', icone: 'attention' },
  'publication-terminee': { famille: 'deploy', interrompt: true, sujet: 'publication', icone: 'publication' },
  // Une publication qui tombe se dit aussi fort qu'une qui aboutit : sans elle,
  // on croit son travail en ligne alors que rien n'est parti. Sujet à part, pour
  // qu'un échec ne soit jamais avalé par la réussite du même lot.
  'publication-echec': { famille: 'deploy', interrompt: true, sujet: 'publication-echec', icone: 'erreur' },
  // Le serveur qui repart coupe les conversations ouvertes quelques secondes :
  // le dire évite de croire à une panne.
  'redemarrage-serveur': { famille: 'systeme', interrompt: true, sujet: 'redemarrage', icone: 'redemarrage' },
  'quota-seuil': { famille: 'quota', interrompt: true, sujet: 'quota', icone: 'quota' },

  // Ce qui ne sort plus de l'application. Le sujet reste renseigné : « liste de
  // tâches cochée » parle de la MÊME fin de travail que « tâche terminée »,
  // c'était là le doublon d'origine.
  //
  // La surconsommation et l'emballement disent tous deux la même chose que les
  // paliers 70 % / 90 % — que le quota descend vite — mais sans palier franchi :
  // trois alertes pour un seul quota faisaient du bruit. Elles restent dans
  // l'application, où la courbe les montre bien mieux.
  'quota-surconsommation': { famille: 'quota', interrompt: false, sujet: 'quota', icone: 'quota' },
  'quota-emballement': { famille: 'quota', interrompt: false, sujet: 'quota', icone: 'quota' },
  'liste-taches': { famille: 'done', interrompt: false, sujet: 'fin-de-travail', icone: 'termine' },
  'charge-machine': { famille: 'capacity', interrompt: false, sujet: 'charge', icone: 'attention' },
  'amorcage-impossible': { famille: 'quota', interrompt: false, sujet: 'amorcage', icone: 'quota' },
  'fenetre-bientot-finie': { famille: 'quota', interrompt: false, sujet: 'quota', icone: 'quota' },
  'point-du-jour': { famille: 'waiting', interrompt: false, sujet: 'point-du-jour', icone: 'attention' },
};

export function interrompt(motif: MotifNotification): boolean {
  return MOTIFS[motif].interrompt;
}

export function familleDuMotif(motif: MotifNotification): FamilleNotification {
  return MOTIFS[motif].famille;
}

export function iconeDuMotif(motif: MotifNotification): IconeNotification {
  return MOTIFS[motif].icone;
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
  const franchis = etat?.resetsAt === resetsAt ? [...(etat.franchis ?? [])] : [];
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
): { titre: string; corps: string } {
  const noms = elements.map((element) => (element ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const nombre = Math.max(noms.length, elements.length, 1);
  return {
    titre: titreNotification(PLURIELS[famille](nombre), projet),
    corps: couperTexte(noms.join(' · '), LONGUEUR_CORPS),
  };
}
