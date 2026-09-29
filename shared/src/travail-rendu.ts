/**
 * « Un agent a fini, et personne n'a encore consulté ce qu'il a rendu. »
 *
 * UNE SEULE RÈGLE, LUE PARTOUT : la pastille bleue de la carte, le compteur
 * posé sur l'icône du projet, la cloche et le nombre de l'application
 * installée. Elle ne regardait que le DERNIER agent d'une carte, et seulement
 * un agent d'exécution : une compréhension ou un plan rendus n'allumaient
 * rien. Toute fin de tour réussie compte désormais — cadrage, plan, travail —,
 * parce que le démon ÉCRIT sur la carte l'instant de ce rendu (`Card.renduA`,
 * posé à chaque passage d'un agent de la carte à « to_deploy »).
 *
 * La règle vit ici, sans base ni réseau : elle se teste seule.
 */

/** Les colonnes où un rendu non consulté se signale : de « Demande » à « À déployer ». */
const COLONNES_QUI_SE_SIGNALENT = ['planned', 'running', 'to_deploy'];

export interface CarteRendue {
  cardId: string;
  projectId: string;
  /** Colonne de la carte : une carte archivée ne réclame plus rien. */
  colonne?: string;
  /** L'instant du dernier tour d'agent RÉUSSI de la carte (`Card.renduA`). */
  renduA?: number;
  /** Quand la carte a été consultée pour la dernière fois (`Card.lastReadAt`). */
  luA?: number;
}

/**
 * L'instant du dernier rendu d'une carte. `renduA` fait foi ; une carte d'avant
 * ce champ se rabat sur son agent retenu, s'il a fini proprement — jamais sur
 * un agent arrêté ou en échec, qui n'a rien rendu.
 */
export function instantDuRendu(
  carte: { renduA?: number },
  agentHerite?: { status?: string; endedAt?: number } | null,
): number | undefined {
  if (carte.renduA) return carte.renduA;
  if (agentHerite?.status === 'done' && agentHerite.endedAt) return agentHerite.endedAt;
  return undefined;
}

/**
 * Une carte a-t-elle un rendu PAS ENCORE CONSULTÉ ?
 *
 * La consultation doit être POSTÉRIEURE au rendu : ouvrir la carte avant que
 * l'agent ait fini n'éteint rien. Une carte archivée ne compte jamais.
 */
export function carteNonLue(entree: Pick<CarteRendue, 'colonne' | 'renduA' | 'luA'>): boolean {
  if (entree.colonne !== undefined && !COLONNES_QUI_SE_SIGNALENT.includes(entree.colonne)) return false;
  const rendu = entree.renduA ?? 0;
  if (!rendu) return false;
  return rendu > (entree.luA ?? 0);
}

/**
 * « Marquer comme non lu » a-t-il un sens pour cette carte ? Il faut un rendu
 * à rallumer, dans une colonne qui se signale, et une carte DÉJÀ lue : sinon
 * le geste ne changerait rien à l'écran. Le menu de la carte et le démon
 * lisent cette même règle.
 */
export function peutRedevenirNonLue(entree: Pick<CarteRendue, 'colonne' | 'renduA' | 'luA'>): boolean {
  if (entree.colonne !== undefined && !COLONNES_QUI_SE_SIGNALENT.includes(entree.colonne)) return false;
  if (!entree.renduA) return false;
  return !carteNonLue(entree);
}

/** Combien de cartes non consultées par projet — le compteur de l'icône du projet. */
export function rendusParProjet(entrees: CarteRendue[]): Record<string, number> {
  const compte: Record<string, number> = {};
  for (const entree of entrees) {
    if (!carteNonLue(entree)) continue;
    compte[entree.projectId] = (compte[entree.projectId] ?? 0) + 1;
  }
  return compte;
}

/**
 * LA CARTE QUE LE BADGE BLEU D'UN PROJET OUVRE. Le badge comptait des cartes
 * non consultées sans mener à aucune : une carte posée par un agent du démon
 * (l'atelier marketing, la nuit) restait introuvable. Un clic ouvre la plus
 * RÉCEMMENT rendue — la même règle que le compteur (`carteNonLue`), donc
 * jamais une archive. `null` quand il n'y en a aucune.
 */
export function carteNonLueLaPlusRecente(
  entrees: Pick<CarteRendue, 'cardId' | 'colonne' | 'renduA' | 'luA'>[],
): string | null {
  let meilleure: { cardId: string; renduA: number } | null = null;
  for (const entree of entrees) {
    if (!carteNonLue(entree)) continue;
    const renduA = entree.renduA ?? 0;
    if (!meilleure || renduA > meilleure.renduA) meilleure = { cardId: entree.cardId, renduA };
  }
  return meilleure?.cardId ?? null;
}

/**
 * Le compte d'un groupe replié : la somme de ses projets. Sans cela, refermer
 * un groupe cacherait précisément l'information qu'on veut voir.
 */
export function rendusDuGroupe(membres: string[], parProjet: Record<string, number>): number {
  return membres.reduce((total, id) => total + (parProjet[id] ?? 0), 0);
}

/** Le total, tous projets confondus : la cloche et l'application installée. */
export function totalDesRendus(parProjet: Record<string, number>): number {
  return Object.values(parProjet).reduce((total, n) => total + n, 0);
}

/** Le texte minuscule du compteur : au-delà de neuf, « 9+ ». */
export function texteDuCompteur(n: number): string {
  return n > 9 ? '9+' : String(n);
}

/* ------------------------------------------------------------------ */
/* L'icône d'étape                                                     */
/* ------------------------------------------------------------------ */

/**
 * L'ÉTAPE LA PLUS AVANCÉE QU'UNE CARTE A RÉELLEMENT VÉCUE. Elle ne dépend
 * JAMAIS de la lecture : consulter la carte éteint la pastille, pas l'icône.
 * L'ancienne icône « plan disponible » était un geste attendu, éteint à
 * l'ouverture (`attente-de-geste.ts`) — d'où sa disparition.
 */
export type EtapeDeCarte = 'comprehension' | 'plan' | 'rapport';

export interface CarteEtape {
  colonne: string;
  doneAt?: number;
  parcours?: { comprehension?: unknown; plans?: unknown[] };
}

export function etapeDeCarte(carte: CarteEtape): EtapeDeCarte | null {
  if (!COLONNES_QUI_SE_SIGNALENT.includes(carte.colonne)) return null;
  // Le rapport : la carte a rendu son travail (elle est dans « À déployer », ou l'a été).
  if (carte.colonne === 'to_deploy' || carte.doneAt) return 'rapport';
  if (carte.parcours?.plans?.length) return 'plan';
  if (carte.parcours?.comprehension) return 'comprehension';
  return null;
}

export const TEXTE_DE_L_ETAPE: Record<EtapeDeCarte, string> = {
  comprehension: 'Compréhension rendue',
  plan: 'Plan disponible',
  rapport: 'Rapport rendu',
};
