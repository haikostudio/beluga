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

/* ------------------------------------------------------------------ */
/* La pression mémoire, swap compris                                   */
/* ------------------------------------------------------------------ */

/** Au-delà, la mémoire vive est trop pleine pour lancer un agent de plus. */
export const SEUIL_PAUSE_MEM_PCT = 94;
/**
 * Au-delà, le fichier d'échange est presque plein.
 *
 * C'est LE signe qui précède la mise à mort d'un processus par le noyau : la
 * mémoire vive peut n'être qu'à 75 % pendant que le swap est saturé, parce que
 * les pages froides y ont déjà été poussées. On ne regardait que la mémoire
 * vive, donc rien ne suspendait les départs juste avant que le démon soit tué.
 */
export const SEUIL_PAUSE_SWAP_PCT = 85;
/**
 * En dessous, un fichier d'échange plein ne veut RIEN dire.
 *
 * Le swap est un réservoir de pages FROIDES : sur une machine qui héberge une
 * dizaine de services dormants, il se remplit jusqu'à 100 % et y reste, sans
 * que la machine soit gênée le moins du monde. Le seul cas dangereux est le
 * swap plein PENDANT que la mémoire vive est elle aussi tendue : là, le noyau
 * n'a plus où pousser les pages et tue un processus. On exige donc les deux.
 */
export const SEUIL_MEM_TENDUE_PCT = 80;

/**
 * L'ALERTE DE SURCHARGE a des seuils FIXÉS PAR LE SYSTÈME, plus un réglage :
 * c'est le démon qui connaît la limite de la machine et qui prévient. Une
 * charge au-delà de `SEUIL_ALERTE_CHARGE_PCT` pendant `DUREE_ALERTE_MINUTES`
 * déclenche UNE alerte ; la même durée vaut pour la mémoire et les tâches.
 */
export const SEUIL_ALERTE_CHARGE_PCT = 90;
export const DUREE_ALERTE_MINUTES = 10;

/**
 * Au-delà, la mémoire vive est assez tendue pour PRÉVENIR, sans rien suspendre.
 *
 * Le blocage arrive à `SEUIL_PAUSE_MEM_PCT` (94 %). On alerte avant, pour que la
 * suspension des départs ne soit jamais une surprise.
 */
export const SEUIL_ALERTE_MEM_PCT = 85;

/**
 * Au-delà, le fichier d'échange TRAVAILLE vraiment, en kilo-octets par seconde.
 *
 * C'est cette mesure-là, et non le remplissage, qui dit qu'une machine rame :
 * des pages qui font l'aller-retour entre le disque et la mémoire vive freinent
 * tout. Un mégaoctet par seconde soutenu est déjà un système qui se débat ; en
 * dessous, ce sont des pages froides qu'on range une fois pour toutes.
 */
export const SEUIL_ECHANGE_ACTIF_KO_S = 1024;

/** Ce que fait le fichier d'échange, en un mot. */
export type EtatDeLEchange = 'absent' | 'repos' | 'range' | 'actif';

/**
 * L'état du fichier d'échange : son REMPLISSAGE ne suffit pas, son DÉBIT décide.
 *
 * - `absent` : la machine n'a pas de fichier d'échange.
 * - `repos` : presque vide, rien ne bouge.
 * - `range` : rempli, mais silencieux — des pages froides, aucune gêne.
 * - `actif` : des pages font l'aller-retour, la machine rame pour de bon.
 */
export function etatDeLEchange(pct?: number, debitKoS?: number): EtatDeLEchange {
  if (pct === undefined || !Number.isFinite(pct)) return 'absent';
  const debit = debitKoS !== undefined && Number.isFinite(debitKoS) ? debitKoS : 0;
  if (debit > SEUIL_ECHANGE_ACTIF_KO_S) return 'actif';
  if (pct >= 20) return 'range';
  return 'repos';
}

/** L'état du fichier d'échange, écrit pour l'utilisateur. */
export function phraseDeLEchange(etat: EtatDeLEchange): string {
  switch (etat) {
    case 'absent':
      return 'aucun fichier d’échange';
    case 'actif':
      return 'des pages font l’aller-retour : la machine rame';
    case 'range':
      return 'rempli de pages froides, au repos';
    default:
      return 'au repos';
  }
}

export interface PressionMemoire {
  /** Les départs doivent-ils être suspendus ? */
  suspendre: boolean;
  /** La cause, écrite pour l'utilisateur. */
  raison?: string;
}

/**
 * Faut-il suspendre les départs ? La mémoire vive ET le fichier d'échange.
 *
 * `swapPct` vaut `undefined` quand la machine n'a pas de fichier d'échange :
 * la mémoire vive décide alors seule.
 */
export function pressionMemoire(memPct: number, swapPct?: number): PressionMemoire {
  const mem = Number.isFinite(memPct) ? memPct : 0;
  if (mem > SEUIL_PAUSE_MEM_PCT) {
    return {
      suspendre: true,
      raison: `Mémoire presque pleine (${Math.round(mem)} %) : les nouveaux départs sont suspendus`,
    };
  }
  const swap = swapPct !== undefined && Number.isFinite(swapPct) ? swapPct : undefined;
  // Le fichier d'échange plein ne suspend QUE si la mémoire vive est elle aussi
  // tendue : seul ce couple annonce la mise à mort d'un processus. Plein seul,
  // il ne décrit qu'une machine qui a rangé ses pages froides.
  if (swap !== undefined && swap > SEUIL_PAUSE_SWAP_PCT && mem > SEUIL_MEM_TENDUE_PCT) {
    return {
      suspendre: true,
      raison:
        `Fichier d'échange presque plein (${Math.round(swap)} %) avec une mémoire vive à ` +
        `${Math.round(mem)} % : la machine est au bord de tuer un processus, les nouveaux ` +
        `départs sont suspendus`,
    };
  }
  return { suspendre: false };
}

/* ------------------------------------------------------------------ */
/* La pression sur le PLAFOND DE TÂCHES du service                     */
/* ------------------------------------------------------------------ */

/**
 * LE VERROU QUI NE SE COMPTAIT PAS EN OCTETS.
 *
 * Le 08.09.2026, une publication est tombée sur « sh: 1: Cannot fork » pendant
 * que la jauge annonçait de la place : la mémoire vive avait encore de quoi
 * lancer un agent, mais le service tournait sous `TasksMax=512` et en occupait
 * déjà 286. Un cgroup plein refuse tout `fork` de plus — compilateur, moteur,
 * navigateur de contrôle — et ce refus ne ressemble en rien à un manque de
 * mémoire : il arrive net, à mémoire large.
 *
 * On compte donc les TÂCHES autant que les octets. La part est celle du cgroup
 * du service lui-même (`pids.current` / `pids.max`), pas celle du noyau, qui en
 * autorise cent fois plus et ne dit donc rien de ce qui bloque.
 */

/** Au-delà de cette part du plafond de tâches, les départs sont suspendus. */
export const SEUIL_PAUSE_TACHES_PCT = 85;

/**
 * Au-delà, le plafond de tâches est assez proche pour PRÉVENIR, sans rien
 * suspendre — comme `SEUIL_ALERTE_MEM_PCT` le fait pour la mémoire vive.
 */
export const SEUIL_ALERTE_TACHES_PCT = 70;

/** Ce qu'un agent coûte en tâches tant qu'aucune mesure ne le dit. */
export const TACHES_PAR_AGENT = 40;

/** Part du plafond de tâches déjà occupée, en pour cent. */
export function partDesTaches(courant?: number, plafond?: number): number | undefined {
  if (courant === undefined || plafond === undefined) return undefined;
  if (!Number.isFinite(courant) || !Number.isFinite(plafond) || plafond <= 0) return undefined;
  return Math.round((courant / plafond) * 100);
}

/**
 * Faut-il suspendre les départs faute de TÂCHES disponibles ?
 *
 * `undefined` des deux côtés (machine sans cgroup, plafond « max ») ne suspend
 * rien : on ne devine pas un verrou qu'on n'a pas lu.
 */
export function pressionDesTaches(courant?: number, plafond?: number): PressionMemoire {
  const part = partDesTaches(courant, plafond);
  if (part === undefined) return { suspendre: false };
  if (part < SEUIL_PAUSE_TACHES_PCT) return { suspendre: false };
  return {
    suspendre: true,
    raison:
      `Le service a presque atteint son plafond de tâches (${courant} sur ${plafond}, ${part} %) : ` +
      `la machine refuserait de lancer un programme de plus, les nouveaux départs sont suspendus`,
  };
}

/** Combien d'agents le plafond de tâches laisse encore partir, à `TACHES_PAR_AGENT` près. */
export function placesSelonLesTaches(courant?: number, plafond?: number, parAgent = TACHES_PAR_AGENT): number | null {
  if (courant === undefined || plafond === undefined) return null;
  if (!Number.isFinite(courant) || !Number.isFinite(plafond) || plafond <= 0) return null;
  const cout = Math.max(1, Math.round(parAgent));
  // La réserve du seuil de suspension est gardée devant : on ne remplit jamais
  // le cgroup jusqu'à la dernière tâche.
  const utilisable = Math.floor((plafond * SEUIL_PAUSE_TACHES_PCT) / 100) - courant;
  return Math.max(0, Math.floor(utilisable / cout));
}

/**
 * Y a-t-il assez de place DEVANT une construction pour la lancer ?
 *
 * Une compilation ouvre des dizaines de processus d'un coup (`tsc`, `vite`,
 * `npm`, leurs enfants) : la lancer sur un cgroup déjà tendu, c'est la faire
 * tomber sur « Cannot fork » au milieu, et prendre ce refus pour un code qui ne
 * compile pas. On exige donc une réserve avant de partir.
 */
export const TACHES_RESERVEES_CONSTRUCTION = 60;
/** Et autant de mégaoctets libres devant elle. */
export const MEMOIRE_RESERVEE_CONSTRUCTION_MB = 400;

export interface PlaceDeConstruction {
  /** La construction peut-elle partir tout de suite ? */
  possible: boolean;
  /** Ce qui manque, écrit pour l'utilisateur. */
  raison?: string;
}

export function placeDeConstruction(etat: {
  tachesCourantes?: number;
  tachesMax?: number;
  memLibreMb?: number;
}): PlaceDeConstruction {
  const { tachesCourantes, tachesMax, memLibreMb } = etat;
  if (tachesCourantes !== undefined && tachesMax !== undefined && tachesMax > 0) {
    const libres = tachesMax - tachesCourantes;
    if (libres < TACHES_RESERVEES_CONSTRUCTION) {
      return {
        possible: false,
        raison:
          `Il ne reste que ${Math.max(0, libres)} tâches sous le plafond du service (${tachesCourantes} sur ` +
          `${tachesMax}) : une construction en ouvre bien plus, elle attend que la place revienne`,
      };
    }
  }
  if (memLibreMb !== undefined && Number.isFinite(memLibreMb) && memLibreMb < MEMOIRE_RESERVEE_CONSTRUCTION_MB) {
    return {
      possible: false,
      raison:
        `Il ne reste que ${Math.round(memLibreMb)} Mo de mémoire libre : une construction en demande davantage, ` +
        `elle attend que la place revienne`,
    };
  }
  return { possible: true };
}


/* La place dans la TABLE DES PROCESSUS                                */
/* ------------------------------------------------------------------ */

/**
 * LA MÉMOIRE N'EST PAS LA SEULE CHOSE QUI MANQUE QUAND « CANNOT FORK ».
 *
 * Une machine peut avoir de la mémoire libre et refuser quand même de lancer le
 * moindre programme : le noyau borne le nombre de fils d'exécution par compte
 * (`ulimit -u`) et pour la machine entière (`threads-max`). Atteinte, cette
 * borne rend `EAGAIN` — « Cannot fork » — et c'est exactement ce qui tue un
 * pont d'outils AVANT qu'il ait dit un mot : le tour part alors sans mémoire du
 * projet, sans écriture de mémoire et sans geste de tableau, et personne ne
 * sait pourquoi.
 *
 * On la MESURE donc, comme la mémoire vive, et on suspend les départs AVANT de
 * heurter le mur, au lieu de laisser un lancement échouer sans cause lisible.
 */
export const SEUIL_PAUSE_FILS_PCT = 85;

/**
 * Au-delà, on PRÉVIENT sans rien suspendre — le même écart qu'entre l'alerte
 * mémoire (85 %) et sa suspension (94 %).
 */
export const SEUIL_ALERTE_FILS_PCT = 70;

export interface PressionDeProcessus {
  /** Les départs doivent-ils être suspendus ? */
  suspendre: boolean;
  /** La cause, écrite pour l'utilisateur. */
  raison?: string;
  /** Part de la table déjà occupée, en pour cent. */
  partPct: number;
}

/**
 * Reste-t-il de la place dans la table des processus ?
 *
 * `plafond` vaut 0 ou moins quand la machine ne dit pas sa limite : on ne
 * suspend alors rien — inventer un mur serait pire que de ne pas en voir.
 */
export function pressionDeProcessus(fils: number, plafond: number): PressionDeProcessus {
  const utilises = Number.isFinite(fils) ? Math.max(0, fils) : 0;
  const max = Number.isFinite(plafond) ? Math.max(0, plafond) : 0;
  if (max <= 0) return { suspendre: false, partPct: 0 };
  const partPct = Math.round((utilises / max) * 100);
  if (partPct >= SEUIL_PAUSE_FILS_PCT) {
    return {
      suspendre: true,
      partPct,
      raison:
        `Table des processus presque pleine (${partPct} % — ${utilises} fils d'exécution sur ${max}) : ` +
        'la machine ne peut plus lancer de programme, les nouveaux départs attendent',
    };
  }
  return { suspendre: false, partPct };
}
