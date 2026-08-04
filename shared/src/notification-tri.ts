/**
 * CE QUI MÉRITE D'INTERROMPRE — et ce qui ne le mérite pas.
 *
 * Une notification sort de l'application : elle allume un téléphone, souvent
 * loin du bureau. Elle ne se justifie donc que si elle appelle une décision ou
 * annonce une fin. Tout le reste (charge machine, amorçage d'une fenêtre de
 * quota, liste de tâches cochée en cours de route) se voit très bien DANS
 * l'application, quand on l'ouvre.
 *
 * Trois règles vivent ici, et nulle part ailleurs :
 *  1. quel motif interrompt, et à quelle famille de réglage il appartient ;
 *  2. l'IDENTITÉ d'un événement, pour que deux endroits du code qui décrivent
 *     la même chose ne fassent qu'une seule alerte ;
 *  3. le résumé d'un groupe : il NOMME les éléments au lieu d'un compte muet.
 *
 * Règles pures : aucune base, aucun disque — donc rejouables telles quelles.
 */

import { LONGUEUR_CORPS, couperTexte, titreNotification } from './notification.js';

/** Les familles, telles que les réglages d'activation les connaissent déjà. */
export type FamilleNotification = 'done' | 'failed' | 'waiting' | 'deploy' | 'proposal' | 'capacity' | 'quota';

/** Le motif REEL de l'alerte : plus fin que la famille, c'est lui qui décide. */
export type MotifNotification =
  | 'tache-terminee'
  | 'travail-sans-carte'
  | 'tache-echec'
  | 'decision-attendue'
  | 'publication-terminee'
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
}

export const MOTIFS: Record<MotifNotification, RegleMotif> = {
  // Ce qui interrompt : une fin, un échec, une décision attendue, un manque.
  'tache-terminee': { famille: 'done', interrompt: true, sujet: 'fin-de-travail' },
  'travail-sans-carte': { famille: 'done', interrompt: true, sujet: 'fin-de-travail' },
  'tache-echec': { famille: 'failed', interrompt: true, sujet: 'echec' },
  'decision-attendue': { famille: 'waiting', interrompt: true, sujet: 'decision' },
  'publication-terminee': { famille: 'deploy', interrompt: true, sujet: 'publication' },
  'quota-seuil': { famille: 'quota', interrompt: true, sujet: 'quota' },
  'quota-surconsommation': { famille: 'quota', interrompt: true, sujet: 'quota' },
  // Un emballement soudain est une alerte à part entière : il appelle un geste
  // tout de suite, avant que la prévision de fin de semaine n'ait basculé.
  'quota-emballement': { famille: 'quota', interrompt: true, sujet: 'quota' },

  // Ce qui ne sort plus de l'application. Le sujet reste renseigné : « liste de
  // tâches cochée » parle de la MÊME fin de travail que « tâche terminée »,
  // c'était là le doublon d'origine.
  'liste-taches': { famille: 'done', interrompt: false, sujet: 'fin-de-travail' },
  'charge-machine': { famille: 'capacity', interrompt: false, sujet: 'charge' },
  'amorcage-impossible': { famille: 'quota', interrompt: false, sujet: 'amorcage' },
  'fenetre-bientot-finie': { famille: 'quota', interrompt: false, sujet: 'quota' },
  'point-du-jour': { famille: 'waiting', interrompt: false, sujet: 'point-du-jour' },
};

export function interrompt(motif: MotifNotification): boolean {
  return MOTIFS[motif].interrompt;
}

export function familleDuMotif(motif: MotifNotification): FamilleNotification {
  return MOTIFS[motif].famille;
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
  deploy: (n) => `${n} publications terminées`,
  proposal: (n) => `${n} tâches proposées — à confirmer`,
  capacity: (n) => `${n} alertes de charge`,
  quota: (n) => `${n} alertes de quota`,
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
