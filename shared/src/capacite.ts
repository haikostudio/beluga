/**
 * Lire la capacité de la machine SANS mentir sur la couleur.
 *
 * La barre affichée suivait la charge processeur, plafonnée à cent : sur ce
 * serveur, qui héberge déjà Paseo et une dizaine de serveurs de projets, cette
 * charge frôle en permanence le nombre de cœurs. La barre était donc rouge et
 * pleine pendant qu'il restait quatorze places libres — exactement le contraire
 * de ce qu'elle devait dire.
 *
 * Ce qui compte pour l'utilisateur, c'est la PLACE QUI RESTE : la barre montre
 * désormais l'occupation des places d'agents, et rien d'autre.
 *
 * Le frein processeur s'était pourtant glissé DERRIÈRE cette barre : une charge
 * d'une minute au-dessus de 200 % ramenait les places à zéro, et l'écran
 * annonçait « Plus aucun agent ne peut démarrer · 3 en cours · plafond 15 » —
 * une phrase qui se contredit elle-même. Deux règles en sortent :
 *
 *   1. la charge RETENUE est celle qui DURE (le plus petit de l'instant et de
 *      la moyenne de quinze minutes) : une pointe passagère — une construction
 *      npm, un redémarrage de projet — ne gèle plus le tableau ;
 *   2. un frein de charge ne se déguise JAMAIS en manque de place : il porte sa
 *      propre phrase et sa propre cause.
 *
 * La règle vit ici, sans réseau ni base : elle se teste seule.
 */

export interface EtatCapacite {
  /** Agents qui tournent en ce moment, TOUS RÔLES confondus. */
  runningAgents: number;
  /** Agents qui pourraient encore démarrer tout de suite. */
  slotsFree: number;
  /** Les départs sont suspendus (saturation mémoire ou pause manuelle). */
  paused?: boolean;
  /** La charge processeur ralentit les départs : la cause, en clair. */
  freinCharge?: string;
}

/** Part des places occupées, en pour cent : zéro quand tout est libre. */
export function tauxOccupation(etat: EtatCapacite): number {
  if (etat.paused) return 100;
  const total = etat.runningAgents + etat.slotsFree;
  // Aucune place, aucun agent : la machine ne peut rien lancer, c'est plein.
  if (total <= 0) return 100;
  return Math.round((etat.runningAgents / total) * 100);
}

export type TonCapacite = 'libre' | 'tendu' | 'sature';

/**
 * Le ton de la barre. Il ne dépend QUE de la place restante : c'est la seule
 * question à laquelle la barre répond.
 */
export function tonCapacite(etat: EtatCapacite): TonCapacite {
  if (etat.paused || etat.slotsFree <= 0) return 'sature';
  // Un frein de charge tend la barre, il ne la remplit pas : il reste de la place.
  if (etat.freinCharge) return 'tendu';
  return etat.slotsFree <= 2 ? 'tendu' : 'libre';
}

/** La phrase du gros titre, accord compris. */
export function phraseCapacite(etat: EtatCapacite): string {
  if (etat.paused) return 'Départs suspendus';
  if (etat.slotsFree <= 0) return 'Plus aucun agent ne peut démarrer';
  // La charge ne se dit jamais en places : elle se dit pour ce qu'elle est.
  if (etat.freinCharge) return 'Départs ralentis : la machine est chargée';
  return etat.slotsFree === 1
    ? 'Un agent peut encore démarrer'
    : `${etat.slotsFree} agents peuvent encore démarrer`;
}

/* ------------------------------------------------------------------ */
/* Le frein processeur                                                 */
/* ------------------------------------------------------------------ */

/** Au-delà, on limite le nombre de départs simultanés. */
export const SEUIL_FREIN_PCT = 170;
/** Au-delà, un seul agent à la fois. */
export const SEUIL_FREIN_SERRE_PCT = 240;
/** Au-delà, plus aucun départ : la file d'attente processeur est réelle. */
export const SEUIL_ARRET_PCT = 320;

export interface ChargeMachine {
  /** Charge de la dernière minute, en % des cœurs. */
  instantPct: number;
  /** Charge moyenne des quinze dernières minutes, en % des cœurs. */
  soutenuePct: number;
}

/**
 * La charge RETENUE pour freiner : la plus petite des deux.
 *
 * Une pointe d'une minute ne dit rien d'une machine saturée — sur ce serveur,
 * qui héberge Paseo et une dizaine de serveurs de projets, elle passe 200 % dès
 * qu'une construction démarre. Une charge qui DURE, elle, se voit sur les deux.
 */
export function chargeRetenue(charge: ChargeMachine): number {
  const instant = Number.isFinite(charge.instantPct) ? charge.instantPct : 0;
  const soutenue = Number.isFinite(charge.soutenuePct) ? charge.soutenuePct : 0;
  return Math.max(0, Math.min(instant, soutenue));
}

export interface FreinDeCharge {
  /** Départs simultanés tolérés ; `null` quand la charge ne freine rien. */
  placesMax: number | null;
  /** La cause, écrite pour l'utilisateur. */
  raison?: string;
}

/** Ce que la charge processeur autorise, et pourquoi. */
export function freinDeCharge(charge: ChargeMachine): FreinDeCharge {
  const retenue = Math.round(chargeRetenue(charge));
  if (retenue >= SEUIL_ARRET_PCT) {
    return {
      placesMax: 0,
      raison: `Machine réellement surchargée (${retenue} % des cœurs depuis un quart d'heure) : les départs attendent qu'elle se calme.`,
    };
  }
  if (retenue >= SEUIL_FREIN_SERRE_PCT) {
    return {
      placesMax: 1,
      raison: `Machine très chargée (${retenue} % des cœurs depuis un quart d'heure) : un seul agent démarre à la fois.`,
    };
  }
  if (retenue >= SEUIL_FREIN_PCT) {
    return {
      placesMax: 3,
      raison: `Machine chargée (${retenue} % des cœurs depuis un quart d'heure) : les départs sont espacés.`,
    };
  }
  return { placesMax: null };
}

/* ------------------------------------------------------------------ */
/* Ce que l'utilisateur compte, lui                                    */
/* ------------------------------------------------------------------ */

/**
 * « 3 en cours » alors que le tableau n'affiche que deux tâches : le compte
 * mélangeait les tâches et les agents de service (chef d'orchestre, analyse de
 * nuit, publication), qui ne paraissent sur aucune carte. On dit donc les deux.
 */
export function detailDesAgents(etat: { runningAgents: number; runningTasks?: number }): string {
  const total = Math.max(0, Math.round(etat.runningAgents));
  const taches = etat.runningTasks === undefined ? undefined : Math.max(0, Math.round(etat.runningTasks));
  if (taches === undefined || taches > total) return `${total} en cours`;
  const autres = total - taches;
  const motTaches = taches === 1 ? '1 tâche' : `${taches} tâches`;
  if (autres <= 0) return `${motTaches} en cours`;
  const motAutres = autres === 1 ? '1 agent de service' : `${autres} agents de service`;
  return `${motTaches} en cours · ${motAutres}`;
}

/** Part de la mémoire utilisée, en pour cent. */
export function partMemoire(usedMb: number, totalMb: number): number {
  if (!totalMb) return 0;
  return Math.round((usedMb / totalMb) * 100);
}
