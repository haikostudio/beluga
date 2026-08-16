/**
 * « Cette carte partirait bien vers 2 h. »
 *
 * Une carte posée dans « Planifié » ne dit rien du BON MOMENT pour la lancer.
 * L'utilisateur qui en a cinq devant lui doit deviner laquelle part maintenant
 * et laquelle attendra la nuit — alors que le démon, lui, connaît déjà les trois
 * choses qui décident : le quota du moteur, les heures creuses réglées, et le
 * CREUX RÉELLEMENT MESURÉ sur l'historique de consommation.
 *
 * Ce fichier est la règle qui recoupe ces trois choses. Trois principes tiennent
 * tout, et ils viennent chacun d'une leçon déjà apprise ailleurs :
 *
 *   - AUCUN MOTEUR N'EST APPELÉ. La suggestion se calcule à partir de ce que le
 *     démon a déjà en mémoire ; elle ne coûte pas un jeton, ni au moment de la
 *     proposition, ni ensuite. C'est la contrainte explicite de la demande.
 *
 *   - ON NE GARDE PAS UNE DATE, ON GARDE UNE FENÊTRE. Une date figée en base
 *     serait périmée le lendemain — même piège que la phrase de
 *     `depart-programme.ts`, qui dirait encore « demain » trois jours plus tard.
 *     La carte porte une PLAGE HORAIRE (« entre 1 h et 5 h ») et de quoi la
 *     justifier ; le prochain moment réel se recalcule à chaque affichage.
 *
 *   - ET RIEN DE CE QUI EST GARDÉ NE DÉPEND DE L'HEURE OÙ ON L'A CALCULÉ. Une
 *     carte créée en pleine nuit ne doit pas répéter « c'est le bon moment »
 *     tout l'après-midi suivant : « on est dedans » est une question posée à
 *     l'AFFICHAGE, jamais une réponse écrite en base.
 *
 * La règle est pure : ni base, ni disque, ni horloge cachée — l'instant est
 * toujours passé en argument. Elle CONSEILLE et ne décide de rien : rien n'est
 * lancé, rien n'est programmé, aucune carte ne bouge. Seul un geste de
 * l'utilisateur transforme le conseil en `scheduling.departPrevu`.
 */

import { momentDeDepart } from './depart-programme.js';
import { TRANCHES_JOURNEE } from './quota.js';

/* ------------------------------------------------------------------ */
/* Ce que la carte porte                                               */
/* ------------------------------------------------------------------ */

/**
 * D'où vient la plage conseillée :
 *   - « creux-mesure » : la plage la plus calme CONSTATÉE sur les relevés ;
 *   - « heures-creuses » : la plage réglée dans les paramètres, faute de mesure.
 */
export type SourceDuCreneau = 'creux-mesure' | 'heures-creuses';

/** Le créneau conseillé, tel qu'il est gardé sur la carte. */
export interface CreneauConseille {
  source: SourceDuCreneau;
  /** Heure d'ouverture de la plage, de 0 à 23. */
  heureDebut: number;
  /** Heure de fermeture, EXCLUE (minuit s'écrit 0). */
  heureFin: number;
  /**
   * La carte est LOURDE : l'ordonnanceur la retient de toute façon hors heures
   * creuses (`checkGates`, `server/src/scheduler.ts`). Le conseil n'est alors
   * plus une économie facultative, c'est ce qui va se passer.
   */
  lourde?: boolean;
  /**
   * Le moteur était à SEC au calcul, et voici quand sa fenêtre se remet à zéro.
   * Une fois cet instant passé, il est simplement IGNORÉ — c'est ce qui empêche
   * une carte vieille d'une semaine d'annoncer pour toujours une reprise de
   * quota qui a eu lieu depuis longtemps.
   */
  pasAvant?: number;
}

/* ------------------------------------------------------------------ */
/* Le creux mesuré                                                     */
/* ------------------------------------------------------------------ */

/**
 * En dessous de ce rapport à la moyenne, une heure se dit calme. Le miroir de
 * `SEUIL_TRANCHE_CHARGEE` : entre les deux, la journée est trop régulière pour
 * qu'on nomme un creux plutôt qu'un autre.
 */
export const SEUIL_TRANCHE_CALME = 0.8;

/**
 * Une plage conseillée ne dépasse pas ces heures. Au-delà, elle n'apprend plus
 * rien : « entre 19 h et 11 h » ne se retient pas, alors que « entre 1 h et
 * 5 h » se lit d'un coup.
 */
export const PLAGE_CALME_LARGEUR_MAX = 6;

/**
 * La plage la plus CALME de la journée : l'heure la plus basse du profil,
 * élargie de proche en proche tant que la voisine reste elle aussi sous le
 * seuil, en tournant sur le cadran — une plage qui enjambe minuit reste une
 * seule plage.
 *
 * Rend `null` sans profil et sur une journée plate : conseiller une heure au
 * hasard serait pire que se taire, la plage réglée prend alors le relais.
 *
 * On ne juge que le profil d'une JOURNÉE type (vingt-quatre poids) : le profil
 * de semaine en compte quarante-huit et mêlerait deux régimes dans une même
 * phrase.
 */
export function plageLaPlusCalme(
  profil: number[] | null | undefined,
): { debut: number; fin: number } | null {
  if (!profil || profil.length !== TRANCHES_JOURNEE) return null;

  let creux = 0;
  for (let h = 1; h < TRANCHES_JOURNEE; h++) if (profil[h] < profil[creux]) creux = h;
  if (profil[creux] > SEUIL_TRANCHE_CALME) return null;

  const dedans = [creux];
  let gauche = creux;
  let droite = creux;
  while (dedans.length < PLAGE_CALME_LARGEUR_MAX) {
    const avant = (gauche + TRANCHES_JOURNEE - 1) % TRANCHES_JOURNEE;
    const apres = (droite + 1) % TRANCHES_JOURNEE;
    const prendAvant = !dedans.includes(avant) && profil[avant] <= SEUIL_TRANCHE_CALME;
    const prendApres = !dedans.includes(apres) && profil[apres] <= SEUIL_TRANCHE_CALME;
    if (!prendAvant && !prendApres) break;
    // Le voisin le plus calme d'abord : la plage grandit par où elle est creuse.
    if (prendAvant && (!prendApres || profil[avant] <= profil[apres])) {
      dedans.push(avant);
      gauche = avant;
    } else {
      dedans.push(apres);
      droite = apres;
    }
  }

  return { debut: gauche, fin: (droite + 1) % TRANCHES_JOURNEE };
}

/**
 * Une heure tombe-t-elle dans une plage qui peut enjamber minuit ?
 *
 * Une plage dont le début rejoint la fin est VIDE, jamais pleine : c'est déjà
 * la lecture d'`isOffPeak` (`server/src/scheduler.ts`), et les deux ne doivent
 * pas se contredire — sans quoi la carte conseillerait de partir maintenant
 * pendant que l'ordonnanceur la retiendrait.
 */
export function dansLaPlage(heure: number, debut: number, fin: number): boolean {
  if (debut === fin) return false;
  return debut < fin ? heure >= debut && heure < fin : heure >= debut || heure < fin;
}

/* ------------------------------------------------------------------ */
/* Le calcul                                                           */
/* ------------------------------------------------------------------ */

/** Ce qu'il faut savoir d'un compte pour ce calcul, et rien de plus. */
export interface QuotaDuMoteur {
  /** Le compte a-t-il encore de la marge ? */
  disponible: boolean;
  /** Quand sa fenêtre se remet à zéro, si on le sait. */
  reprendA?: number;
}

export interface EntreeDuCreneau {
  maintenant: number;
  /** Les heures creuses réglées dans les paramètres (`offPeakStart`/`offPeakEnd`). */
  heuresCreuses: { debut: number; fin: number };
  /** Le profil MESURÉ d'une journée type (24 poids), ou rien quand il manque. */
  profil?: number[] | null;
  /** Les comptes du moteur de CETTE carte. Une liste vide = rien à opposer. */
  quotas?: QuotaDuMoteur[];
  /** La durée machine prévue de la carte, quand elle est déjà chiffrée. */
  ampleurSecondes?: number;
  /** Au-delà, la carte est LOURDE et l'ordonnanceur la retient hors heures creuses. */
  seuilLourdSecondes: number;
}

/**
 * Le créneau conseillé pour cette carte. Trois questions, dans cet ordre :
 *
 *   1. quelle est la plage calme — MESURÉE d'abord, réglée à défaut ;
 *   2. la carte est-elle LOURDE ? Alors le conseil décrit ce que
 *      l'ordonnanceur fera de toute façon, et non une simple économie ;
 *   3. le moteur est-il à sec ? Alors rien ne part avant sa reprise.
 *
 * « Sommes-nous déjà dans la plage ? » ne se pose PAS ici : c'est une question
 * d'affichage, elle se repose à chaque lecture.
 */
export function creneauDeLancement(entree: EntreeDuCreneau): CreneauConseille {
  const { maintenant, heuresCreuses, profil, quotas, ampleurSecondes, seuilLourdSecondes } = entree;

  const calme = plageLaPlusCalme(profil);
  const plage = calme ?? { debut: heuresCreuses.debut, fin: heuresCreuses.fin };

  /*
   * Un moteur DONT ON CONNAÎT LES COMPTES et dont aucun n'a de marge est à sec.
   * Une liste vide ne veut pas dire « épuisé » : Cursor ne publie aucun quota,
   * et un relevé pas encore arrivé n'est pas un refus.
   */
  const aSec = !!quotas?.length && quotas.every((q) => !q.disponible);
  const reprise = aSec
    ? (quotas ?? [])
        .map((q) => q.reprendA)
        .filter((v): v is number => typeof v === 'number' && v > maintenant)
        .sort((a, b) => a - b)[0]
    : undefined;

  return {
    source: calme ? 'creux-mesure' : 'heures-creuses',
    heureDebut: plage.debut,
    heureFin: plage.fin,
    ...((ampleurSecondes ?? 0) >= seuilLourdSecondes ? { lourde: true } : {}),
    ...(reprise ? { pasAvant: reprise } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Le moment réel, recalculé à chaque affichage                        */
/* ------------------------------------------------------------------ */

/**
 * Le prochain instant où ce créneau s'ouvre, à partir de maintenant. C'est LUI
 * qu'un clic recopie dans `scheduling.departPrevu` — d'où le fait qu'il tombe
 * pile à l'heure ronde, minutes et secondes remises à zéro.
 *
 * Un `pasAvant` déjà passé n'a plus rien à retenir : il est ignoré.
 */
export function momentDuCreneau(creneau: CreneauConseille, maintenant: number): number {
  const plancher =
    creneau.pasAvant && creneau.pasAvant > maintenant ? creneau.pasAvant : maintenant;
  const ici = new Date(plancher);
  const aujourdhui = new Date(
    ici.getFullYear(),
    ici.getMonth(),
    ici.getDate(),
    creneau.heureDebut,
    0,
    0,
    0,
  ).getTime();
  if (aujourdhui >= plancher) return aujourdhui;
  return new Date(
    ici.getFullYear(),
    ici.getMonth(),
    ici.getDate() + 1,
    creneau.heureDebut,
    0,
    0,
    0,
  ).getTime();
}

/** « entre 1 h et 5 h » — la plage, dite comme on la lirait à voix haute. */
export function plageEnClair(creneau: CreneauConseille): string {
  return `entre ${creneau.heureDebut} h et ${creneau.heureFin} h`;
}

/**
 * Sommes-nous DANS le créneau en ce moment ? La question se repose à chaque
 * affichage, jamais au calcul : c'est elle qui empêche une carte créée à 2 h de
 * répéter « c'est le bon moment » tout l'après-midi.
 *
 * Un quota encore à sec l'emporte : l'heure a beau être calme, rien ne partira.
 */
export function creneauOuvert(creneau: CreneauConseille, maintenant: number): boolean {
  if (creneau.pasAvant && creneau.pasAvant > maintenant) return false;
  return dansLaPlage(new Date(maintenant).getHours(), creneau.heureDebut, creneau.heureFin);
}

/**
 * La phrase portée par la carte. Elle se RECALCULE à chaque affichage — la
 * carte ne garde que la plage et ses raisons, jamais le texte.
 */
export function phraseDuCreneau(creneau: CreneauConseille, maintenant: number): string {
  const plage = plageEnClair(creneau);
  const pourquoi =
    creneau.source === 'creux-mesure'
      ? `la plage la plus calme mesurée sur vos quotas (${plage})`
      : `les heures creuses réglées (${plage})`;

  if (creneau.pasAvant && creneau.pasAvant > maintenant) {
    return `Lancement conseillé ${momentDeDepart(momentDuCreneau(creneau, maintenant), maintenant)} — le quota de ce moteur est épuisé et reprend ${momentDeDepart(creneau.pasAvant, maintenant)}.`;
  }

  if (creneauOuvert(creneau, maintenant)) {
    return `Bon moment pour la lancer : on est dans ${pourquoi}.`;
  }

  const quand = momentDeDepart(momentDuCreneau(creneau, maintenant), maintenant);
  return creneau.lourde
    ? `Lancement conseillé ${quand} — tâche lourde, l'ordonnanceur l'y retiendra de toute façon (${plage}).`
    : `Lancement conseillé ${quand} — ${pourquoi}. Rien n'empêche de la lancer avant.`;
}

/**
 * La mention affichée sur la carte du tableau et dans son tiroir. Elle se tait
 * partout où le conseil n'a plus de sens : hors des colonnes qui précèdent le
 * travail, sans créneau, sur une carte suspendue — et surtout dès qu'une DATE
 * de départ est posée, car la carte a alors une réponse ferme et le conseil
 * n'aurait plus qu'à la contredire.
 */
export function mentionCreneauConseille(
  carte: {
    column: string;
    scheduling?: { suspendu?: boolean; departPrevu?: number; creneauConseille?: CreneauConseille };
  },
  maintenant: number,
): string | null {
  if (carte.column !== 'todo' && carte.column !== 'planned') return null;
  if (carte.scheduling?.suspendu) return null;
  if (carte.scheduling?.departPrevu) return null;
  const creneau = carte.scheduling?.creneauConseille;
  if (!creneau) return null;
  return phraseDuCreneau(creneau, maintenant);
}
