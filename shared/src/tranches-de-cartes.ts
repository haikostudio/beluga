/**
 * LE TABLEAU NE REÇOIT QUE CE QU'IL MONTRE : LES CARTES PAR TRANCHES, ET LES
 * AGENTS QUI LES PORTENT.
 *
 * À l'ouverture d'un projet, le démon envoyait TOUTES ses cartes et TOUS ses
 * agents depuis toujours. Sur le projet le plus ancien de ce serveur : 810
 * cartes archivées (2,7 Mo, chacune avec sa description, son chiffrage, ses
 * plans) et 1 470 agents terminés (4 Mo de résumés de continuité) — sept
 * mégaoctets à télécharger avant la première carte, une trentaine de secondes
 * sur un téléphone (`scripts/mesure-premier-affichage.mjs`).
 *
 * Or l'écran ne pose qu'un PAQUET de vingt cartes par colonne (`CARTES_PAR
 * _PAQUET`, `shared/src/paquets-de-cartes.ts`) et ne se sert, des agents, que
 * de ceux qui travaillent ou qui portent une carte visible. Le premier envoi
 * ne descend donc plus que la PREMIÈRE TRANCHE de chaque colonne avec le TOTAL
 * réel, et la suite se demande au fil du défilement (`cards.tranche`). Les
 * agents suivent leurs cartes ; le fil d'une carte (`card.conversation`)
 * apporte les siens à l'ouverture.
 *
 * Ces règles ne lisent ni base ni réseau : elles se testent seules.
 */
import { CARTES_PAR_PAQUET } from './paquets-de-cartes.js';
import { FRAICHEUR_AGENT_MS } from './premier-envoi.js';

/** Combien de cartes par colonne partent d'un coup : un paquet de l'écran, exactement. */
export const CARTES_PAR_TRANCHE = CARTES_PAR_PAQUET;

/** Le total réel de chaque colonne, tel que le démon le compte. */
export type TotauxParColonne = Record<string, number>;

/** Le strict minimum d'une carte pour ces règles. */
export interface CarteDeTranche {
  id: string;
  column: string;
  position: number;
}

/** Le strict minimum d'un agent pour ces règles. */
export interface AgentDeTranche {
  id: string;
  cardId?: string;
  status: string;
  endedAt?: number;
  updatedAt?: number;
}

/**
 * LA PREMIÈRE TRANCHE DE CHAQUE COLONNE, ET LE TOTAL DE CHACUNE. Les cartes
 * sont prises dans l'ordre reçu — celui du tableau, de la plus haute à la plus
 * basse position — et rien n'est reclassé.
 */
export function premiereTranche<C extends CarteDeTranche>(
  cartes: readonly C[],
  parColonne = CARTES_PAR_TRANCHE,
): { cartes: C[]; totaux: TotauxParColonne } {
  const totaux: TotauxParColonne = {};
  const gardees: C[] = [];
  for (const carte of cartes) {
    const deja = totaux[carte.column] ?? 0;
    totaux[carte.column] = deja + 1;
    if (deja < parColonne) gardees.push(carte);
  }
  return { cartes: gardees, totaux };
}

/**
 * LES AGENTS UTILES AU TABLEAU : ceux qui travaillent (l'indicateur qui
 * pioche, le pourcentage de la colonne), ceux qui portent une carte ENVOYÉE
 * (son état, son avancement), et ceux qui viennent de finir (la pile de la
 * colonne de gauche). Un agent terminé depuis des semaines sur une carte
 * archivée qui n'est pas à l'écran n'a rien à y faire — il viendra avec sa
 * tranche, ou avec le fil de sa carte.
 */
export function agentUtileAuTableau(
  agent: AgentDeTranche,
  cartesEnvoyees: ReadonlySet<string>,
  maintenant: number,
): boolean {
  if (agent.status === 'running' || agent.status === 'starting') return true;
  if (agent.cardId && cartesEnvoyees.has(agent.cardId)) return true;
  const fin = agent.endedAt ?? agent.updatedAt;
  return !!fin && maintenant - fin < FRAICHEUR_AGENT_MS;
}

export function agentsUtilesAuTableau<A extends AgentDeTranche>(
  agents: readonly A[],
  cartesEnvoyees: ReadonlySet<string>,
  maintenant: number,
): A[] {
  return agents.filter((agent) => agentUtileAuTableau(agent, cartesEnvoyees, maintenant));
}

/**
 * UN AGENT TEL QUE L'ÉCRAN LE LIT. Le RÉSUMÉ DE CONTINUITÉ d'un agent — le
 * texte qui lui permet de reprendre après une compression de contexte — pèse
 * jusqu'à vingt-cinq kilo-octets par agent, et aucun écran ne l'affiche : il
 * n'existe que pour le moteur. Il ne part donc plus.
 */
export function agentPourLEcran<A extends { context?: { continuitySummary?: string } | null }>(agent: A): A {
  if (!agent.context || agent.context.continuitySummary === undefined) return agent;
  const { continuitySummary: _resume, ...contexte } = agent.context;
  return { ...agent, context: contexte };
}

/**
 * LE TOTAL D'UNE COLONNE SUIT LES CARTES QUI BOUGENT. Le démon ne renvoie le
 * compte qu'avec l'instantané ; entre deux, l'écran tient les totaux à jour
 * lui-même sur ce qu'il reçoit : une carte qui change de colonne, qui naît,
 * ou qui disparaît. Une colonne inconnue compte pour zéro, et jamais en dessous.
 */
export function totauxApresChangement(
  totaux: TotauxParColonne,
  avant: string | undefined,
  apres: string | undefined,
): TotauxParColonne {
  if (avant === apres) return totaux;
  const suite = { ...totaux };
  if (avant !== undefined) suite[avant] = Math.max(0, (suite[avant] ?? 0) - 1);
  if (apres !== undefined) suite[apres] = (suite[apres] ?? 0) + 1;
  return suite;
}

/**
 * D'OÙ REPREND LA TRANCHE SUIVANTE : sous la carte la plus basse déjà reçue
 * dans cette colonne. C'est une position, pas un rang : une carte créée ou
 * déplacée entre deux tranches ne décale rien, et rien n'est reçu deux fois.
 */
export function positionDeReprise(cartesDeLaColonne: readonly { position: number }[]): number | undefined {
  if (!cartesDeLaColonne.length) return undefined;
  return cartesDeLaColonne.reduce((bas, carte) => Math.min(bas, carte.position), Number.POSITIVE_INFINITY);
}

/** Reste-t-il, sur le démon, des cartes que l'écran n'a pas encore reçues ? */
export function resteSurLeServeur(recues: number, total: number | undefined): boolean {
  return (total ?? 0) > recues;
}
