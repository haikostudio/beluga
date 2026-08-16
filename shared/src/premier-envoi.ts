/**
 * CE QUI PART À LA TOUTE PREMIÈRE SECONDE.
 *
 * Le tableau restait de longues secondes sur ses silhouettes grises : rien ne
 * peut s'afficher tant que l'événement `ready` n'est pas arrivé, et cet
 * événement traînait derrière lui bien plus que ce que l'écran demande.
 *
 * Deux excès, tous deux mesurés :
 *
 *  - les AGENTS de tous les projets depuis toujours (1 115 agents, 807 Ko sur
 *    ce serveur) alors que l'écran ne se sert, hors du projet ouvert, que de
 *    ceux qui TRAVAILLENT en ce moment — le pourcentage de la colonne de
 *    gauche, la pile d'agents, le compteur du bandeau. Les agents du projet
 *    affiché arrivent de toute façon avec ses cartes (`project.snapshot`) ;
 *  - les DÉCISIONS déjà tranchées (708 entrées, 236 Ko), que l'interface jette
 *    aussitôt : tout ce qui les lit passe par `decisionsOuvertes`.
 *
 * Les règles vivent ici, sans base ni réseau : elles se testent seules.
 */
import { DecisionAttendue, decisionsOuvertes } from './decision-attendue.js';

/**
 * Combien de temps un agent TERMINÉ reste utile au premier envoi. La pile
 * d'agents de la colonne de gauche garde une minute la mention « terminé » ;
 * on prend large — une heure — pour qu'aucun affichage ne dépende d'un délai
 * réglé ailleurs.
 */
export const FRAICHEUR_AGENT_MS = 60 * 60 * 1000;

/** Le strict minimum dont la règle a besoin pour juger un agent. */
export interface AgentDuPremierEnvoi {
  projectId: string;
  status: string;
  endedAt?: number;
  updatedAt?: number;
}

/**
 * Cet agent doit-il partir dans le premier envoi ?
 *
 * Oui s'il travaille (« starting » compte, comme partout ailleurs), s'il vient
 * de finir, ou s'il appartient au projet qu'on va ouvrir — ce dernier cas rend
 * l'envoi identique à ce qu'il était pour le tableau affiché.
 */
export function agentUtileAuLancement(
  agent: AgentDuPremierEnvoi,
  projetOuvert: string | null | undefined,
  maintenant: number,
): boolean {
  if (agent.status === 'running' || agent.status === 'starting') return true;
  if (projetOuvert && agent.projectId === projetOuvert) return true;
  const fin = agent.endedAt ?? agent.updatedAt;
  return !!fin && maintenant - fin < FRAICHEUR_AGENT_MS;
}

/** Les agents du premier envoi, dans l'ordre reçu. */
export function agentsDuPremierEnvoi<T extends AgentDuPremierEnvoi>(
  agents: T[],
  projetOuvert: string | null | undefined,
  maintenant: number,
): T[] {
  return agents.filter((agent) => agentUtileAuLancement(agent, projetOuvert, maintenant));
}

/**
 * Les décisions à envoyer : celles qui attendent encore. Le COMPTE par projet,
 * lui, ne bouge pas — il se calcule sur la liste entière, côté serveur, avant
 * ce tri.
 */
export function decisionsDuPremierEnvoi(decisions: DecisionAttendue[]): DecisionAttendue[] {
  return decisionsOuvertes(decisions);
}
