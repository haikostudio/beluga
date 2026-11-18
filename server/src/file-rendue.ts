import { textesRendusParLaFile } from '@beluga/shared';
import { bus } from './bus.js';
import * as store from './store.js';

/**
 * VIDER LA FILE D'UN AGENT SANS JETER CE QUE L'UTILISATEUR A TAPÉ (04/11/2026).
 *
 * Arrêter, mettre en pause, ranger une carte : chaque geste qui coupe un agent
 * vide sa file AVANT la coupe (« L'arrêt vide la file AVANT de couper »). Mais
 * un message humain qui attendait n'est pas un déchet : il revient au champ
 * d'écriture de son agent, avec la raison, comme le fait « Suspendre »
 * (DEC-372). Les demandes internes (relance, reprise de quota) tombent.
 * Rend le nombre de demandes retirées.
 */
export function viderLaFileEnRendant(agentId: string, raison: string): number {
  const textes = textesRendusParLaFile(store.listQueue(agentId));
  const vides = store.clearQueue(agentId);
  if (!vides) return 0;
  bus.emit({ type: 'queue.etat', agentId, queue: [] });
  if (textes.length) bus.emit({ type: 'queue.rendue', agentId, textes, raison });
  return vides;
}
