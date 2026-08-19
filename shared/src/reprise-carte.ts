import type { ColumnKey } from './columns.js';
import { RAISON_COUPE_EN_VOL, RAISON_TRACE_INCONNUE } from './carte-interrompue.js';
import {
  RAISON_MOTEUR_INJOIGNABLE,
  RAISON_PANNE_MOTEUR,
  RAISON_SANS_MODIFICATION,
  RAISON_SUSPENDU,
  RAISON_TOUR_SANS_ISSUE,
} from './suivi-colonne.js';

/**
 * UNE CARTE INTERROMPUE SE REPREND — ELLE NE REPART PAS DE ZÉRO.
 *
 * Une carte coupée par un problème — serveur redémarré, moteur tombé, quota
 * atteint, tour terminé sans issue — revient dans « Planifié » à côté des cartes
 * qui n'ont JAMAIS été lancées. Le bouton disait la même chose pour les deux
 * (« Lancer maintenant ») et faisait la même chose : un agent neuf, un fil neuf,
 * tout le travail refait depuis le début — repayé, et parfois défait.
 *
 * Trois manques, un seul sujet :
 *
 *   1. RIEN NE DISAIT que la carte avait déjà travaillé. Les compteurs
 *      (`attempts`, `restarts`) le savaient, l'écran non ;
 *   2. LE TOUR REPARTAIT À NEUF. Les étapes déjà faites n'étaient nulle part
 *      dans la demande envoyée au moteur, qui recommençait tout ;
 *   3. LE TRAVAIL DÉJÀ ÉCRIT ne comptait pas : une carte reprise qui n'avait
 *      plus rien à changer s'entendait dire « aucun fichier n'a changé », alors
 *      que son code était bel et bien là (`codeDejaEnregistre`, posé seulement
 *      par un tour qui avait pu ranger sa carte — donc jamais par un tour coupé).
 *
 * Les règles pures vivent ici : reconnaître la reprise, la NOMMER sur le bouton
 * et sur la carte, et écrire la consigne qui fait repartir l'agent là où il
 * s'était arrêté. Le démon, lui, garde la branche, la copie de travail et le fil
 * du moteur (`server/src/scheduler.ts`, `server/src/dossier-de-carte.ts`).
 */

/* ------------------------------------------------------------------ */
/* 1. Reconnaître une reprise                                           */
/* ------------------------------------------------------------------ */

/**
 * D'OÙ VIENT LA REPRISE. On le lit sur la phrase que la carte porte déjà
 * (`waitingReason`) : chaque chemin d'interruption en écrit une, et c'est la
 * seule trace qui survive au tour.
 */
export type OrigineDeReprise =
  /** Le serveur s'est arrêté pendant le travail. */
  | 'coupure'
  /** Le moteur n'a pas répondu au lancement. */
  | 'moteur'
  /** Le fournisseur du moteur est tombé en panne et n'a pas repris. */
  | 'panne'
  /** Le tour s'est terminé sans jamais ranger la carte. */
  | 'sans-issue'
  /** Le tour a répondu sans rien changer au dépôt. */
  | 'sans-modification'
  /** Le dépôt n'a pas pu être consulté : pas de trace, pas de clôture. */
  | 'sans-trace'
  /** L'agent a été suspendu à la main. */
  | 'suspension'
  /** Elle a déjà tourné, sans qu'on sache dire pourquoi elle est revenue. */
  | 'relance';

/** Ce qu'il faut savoir d'une carte pour dire si elle se REPREND. */
export interface CarteAReprendre {
  column: ColumnKey;
  scheduling?: {
    attempts?: number;
    restarts?: number;
    waitingReason?: string;
  };
  /** Du code a déjà été enregistré pour cette carte, à un tour précédent. */
  codeDejaEnregistre?: boolean;
}

const ORIGINES: { raison: string; origine: OrigineDeReprise }[] = [
  { raison: RAISON_COUPE_EN_VOL, origine: 'coupure' },
  { raison: RAISON_MOTEUR_INJOIGNABLE, origine: 'moteur' },
  { raison: RAISON_PANNE_MOTEUR, origine: 'panne' },
  { raison: RAISON_TOUR_SANS_ISSUE, origine: 'sans-issue' },
  { raison: RAISON_SANS_MODIFICATION, origine: 'sans-modification' },
  { raison: RAISON_TRACE_INCONNUE, origine: 'sans-trace' },
  { raison: RAISON_SUSPENDU, origine: 'suspension' },
];

/**
 * Cette carte a-t-elle DÉJÀ été lancée puis rendue à la file ? C'est la seule
 * question qui distingue une reprise d'un premier départ.
 *
 * Deux compteurs suffisent et ne mentent pas : `attempts` monte à chaque
 * lancement réel (`startCard`), `restarts` à chaque interruption rattrapée. Le
 * drapeau `codeDejaEnregistre` s'y ajoute pour les cartes dont le code est déjà
 * livré. Hors de « Planifié », la question ne se pose pas : ni « En cours » ni
 * une fin de parcours n'affichent de bouton de lancement.
 */
export function carteSeReprend(carte: CarteAReprendre): boolean {
  if (carte.column !== 'planned') return false;
  return (
    (carte.scheduling?.attempts ?? 0) > 0 ||
    (carte.scheduling?.restarts ?? 0) > 0 ||
    !!carte.codeDejaEnregistre
  );
}

/** Pourquoi la carte est revenue en file. `null` quand ce n'est pas une reprise. */
export function origineDeReprise(carte: CarteAReprendre): OrigineDeReprise | null {
  if (!carteSeReprend(carte)) return null;
  const raison = carte.scheduling?.waitingReason?.trim();
  if (raison) {
    const connue = ORIGINES.find((o) => o.raison === raison);
    if (connue) return connue.origine;
  }
  // Une carte qui porte des reprises sans phrase reconnue a bien été coupée :
  // c'est le compteur qui l'atteste, pas le texte.
  if ((carte.scheduling?.restarts ?? 0) > 0) return 'coupure';
  return 'relance';
}

/* ------------------------------------------------------------------ */
/* 2. Le dire : le bouton et la carte                                   */
/* ------------------------------------------------------------------ */

export const LIBELLE_LANCER = 'Lancer maintenant';
export const LIBELLE_REPRENDRE = 'Reprendre';

/**
 * Ce que dit le bouton de lancement. Deux mots seulement, mais ce sont eux qui
 * disent à l'utilisateur qu'il ne repaie pas le travail déjà fait.
 */
export function libelleDeLancement(carte: CarteAReprendre): string {
  return carteSeReprend(carte) ? LIBELLE_REPRENDRE : LIBELLE_LANCER;
}

/** Le pied de la colonne « Planifié », quand toutes ses cartes se reprennent. */
export function libelleDuLotDeLancement(cartes: CarteAReprendre[]): string {
  const liste = cartes ?? [];
  if (!liste.length) return 'Tout lancer';
  return liste.every((carte) => carteSeReprend(carte)) ? 'Tout reprendre' : 'Tout lancer';
}

const MENTIONS: Record<OrigineDeReprise, string> = {
  coupure: 'Reprise : travail interrompu par un arrêt du serveur, ce qui était fait est gardé.',
  moteur: 'Reprise : le moteur n’avait pas répondu, ce qui était fait est gardé.',
  panne: 'Reprise : le moteur du fournisseur était en panne, ce qui était fait est gardé.',
  'sans-issue': 'Reprise : le tour s’était terminé sans ranger la carte, ce qui était fait est gardé.',
  'sans-modification': 'Reprise : le tour précédent n’avait rien changé, ce qui était fait est gardé.',
  'sans-trace': 'Reprise : le dépôt n’avait pas pu être consulté, ce qui était fait est gardé.',
  suspension: 'Reprise : agent suspendu à la main, ce qui était fait est gardé.',
  relance: 'Reprise : cette carte a déjà travaillé, ce qui était fait est gardé.',
};

/**
 * La phrase portée par la carte : elle dit d'un coup d'œil qu'on REPREND, et
 * non qu'on recommence. `null` sur une carte jamais lancée.
 */
export function mentionDeReprise(carte: CarteAReprendre): string | null {
  const origine = origineDeReprise(carte);
  return origine ? MENTIONS[origine] : null;
}

/**
 * La même chose en trois mots, pour la carte du tableau, où la place manque et
 * où la cause de l'interruption est déjà écrite juste au-dessus.
 */
export const MENTION_REPRISE_COURTE = 'Reprise : ce qui est fait est gardé.';

/* ------------------------------------------------------------------ */
/* 3. Repartir là où on s'était arrêté                                  */
/* ------------------------------------------------------------------ */

/**
 * Une étape de la liste de tâches du tour coupé — les mêmes états que partout
 * ailleurs dans HaikoDev (`TodoItem.state`), pour n'avoir rien à traduire.
 */
export interface EtapeDeReprise {
  label: string;
  /** Faite, en cours au moment de la coupure, à faire, ou restée en plan. */
  etat: 'todo' | 'running' | 'done' | 'unfinished';
}

export interface EntreeDeReprise {
  origine: OrigineDeReprise;
  /** La phrase déjà écrite sur la carte, reprise telle quelle. */
  raison?: string;
  branche?: string;
  dossier?: string;
  etapes?: EtapeDeReprise[];
  /** Du code de cette carte est déjà enregistré sur sa branche. */
  codeDejaEnregistre?: boolean;
}

const ETAPES_CITEES = 20;

/**
 * LA CONSIGNE DE REPRISE — le bloc posé en tête de la demande d'un tour repris.
 *
 * Elle ne raconte pas l'incident, elle dit trois choses utiles : ce qui est
 * déjà fait (à ne pas refaire), ce qui reste, et que le travail écrit est
 * toujours là — même branche, même dossier. Sans elle, l'agent repartait de la
 * description de la carte, donc du début.
 */
export function consigneDeReprise(entree: EntreeDeReprise): string {
  const lignes: string[] = [
    'REPRISE D’UNE TÂCHE INTERROMPUE — tu repars EXACTEMENT là où tu t’étais arrêté.',
  ];

  lignes.push(
    entree.raison?.trim()
      ? `Ce qui s’est passé : ${entree.raison.trim()}`
      : `Ce qui s’est passé : ${MENTIONS[entree.origine]}`,
  );

  if (entree.branche || entree.dossier) {
    lignes.push(
      `Rien n’a bougé de ton côté : même carte, même branche « ${entree.branche ?? 'de la carte'} », même dossier « ${entree.dossier ?? 'de travail'} ».`,
    );
  }
  if (entree.codeDejaEnregistre) {
    lignes.push(
      'Le travail que tu avais déjà écrit est ENREGISTRÉ sur la branche de la carte : il ne se réécrit pas, il se continue.',
    );
  }

  const etapes = (entree.etapes ?? []).slice(0, ETAPES_CITEES);
  const faites = etapes.filter((e) => e.etat === 'done');
  const restantes = etapes.filter((e) => e.etat !== 'done');
  if (faites.length) {
    lignes.push('ÉTAPES DÉJÀ FAITES — ne les refais pas, ne les relis pas :');
    for (const etape of faites) lignes.push(`- ${etape.label}`);
  }
  if (restantes.length) {
    lignes.push('ÉTAPES QUI RESTENT — c’est par là que tu reprends :');
    for (const etape of restantes) {
      const coupee = etape.etat === 'running' || etape.etat === 'unfinished';
      lignes.push(`- ${etape.label}${coupee ? ' (commencée, coupée en route)' : ''}`);
    }
  }
  if (!etapes.length) {
    lignes.push(
      'Aucune liste d’étapes n’a survécu au tour coupé : commence par CONSTATER ce qui est déjà fait dans le dossier et le dépôt de la carte, puis continue — ne recommence pas ce qui est déjà là.',
    );
  }

  lignes.push(
    'Va au bout de ce qui reste, puis enregistre et sauvegarde (commit + push). Ne publie pas.',
  );
  return lignes.join('\n');
}
