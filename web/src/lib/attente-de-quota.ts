import { useMemo } from 'react';
import { cartesEnAttenteDeQuota, type Card } from '@beluga/shared';
import { useApp } from './use-app';

/**
 * LA CARTE ATTEND-ELLE UN QUOTA ? Demande retombée en file faute de compte, ou
 * tour coupé par la limite dont la reprise est encore ouverte — la règle vit
 * dans `shared/src/attente-de-quota.ts`. Lu par le badge en haut à droite des
 * cartes (« Tableaux de bord » et tableau d'un projet).
 */
export function useAttendUnQuota(card: Pick<Card, 'id' | 'agentId'>): boolean {
  const { agents, queues, decisions } = useApp();
  return useMemo(
    () =>
      cartesEnAttenteDeQuota({
        agents: Object.values(agents),
        cartes: [card],
        files: queues,
        decisions,
      }).has(card.id),
    [agents, queues, decisions, card.id, card.agentId],
  );
}
