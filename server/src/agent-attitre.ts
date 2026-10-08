/**
 * LES AGENTS ATTITRÉS — les agents DE VOLET : celui d'une création du Studio,
 * celui de l'atelier Marketing, celui d'une surveillance de site et celui des
 * sauvegardes. Ils ne livrent aucun code, leur carte n'a ni branche ni copie de
 * travail, et leur conversation vit dans LEUR écran, pas sur le tableau.
 *
 * Un message écrit dans le chat du Studio partait pourtant par la règle des
 * cartes ordinaires : sous une carte « déjà en ligne » il ouvrait une NOUVELLE
 * carte, sous une carte « À déployer » il rouvrait un cadrage (capture #c201,
 * 06.10.2026). Le même jour, le volet Surveillance d'InVia ouvrait la carte
 * 43a2796b au lieu de répondre : sa carte avait été emportée par une
 * publication. Un seul prédicat sert toutes ces exemptions, pour tous les
 * agents de volet (`estAgentDeVolet`, partagé avec le champ d'écriture).
 */
import { estAgentDeVolet } from '@beluga/shared';
import { estAgentMarketing } from './marketing.js';
import { estAgentStudio } from './studio.js';
import * as store from './store.js';

export function estAgentAttitre(agentId: string | null | undefined): boolean {
  if (!agentId) return false;
  if (estAgentMarketing(agentId) || estAgentStudio(agentId)) return true;
  const agent = store.getAgent(agentId);
  return estAgentDeVolet(agent, agent?.cardId ? store.getCard(agent.cardId) : null);
}
