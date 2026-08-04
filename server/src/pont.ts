/**
 * Registre des passages du pont d'outils, agent par agent.
 *
 * Le pont s'annonce en démarrant (`/internal/pont`) et le démon note combien
 * d'outils il a servis (`/internal/tools`). À la fin du tour, `runtime` relit
 * cette trace : sans elle, un tour entier a pu se faire SANS outil du projet
 * pendant que la réponse affirmait avoir lu la mémoire.
 */
import { PassageDuPont } from '@haikodev/shared';

const passages = new Map<string, { demarre: boolean; outils: number | null }>();

/** Le pont d'un agent vient de démarrer. */
export function pontDemarre(agentId: string): void {
  const vu = passages.get(agentId);
  passages.set(agentId, { demarre: true, outils: vu?.outils ?? null });
}

/** Le moteur a demandé la liste d'outils : on retient combien sont partis. */
export function pontAServiLesOutils(agentId: string, outils: number): void {
  const vu = passages.get(agentId);
  passages.set(agentId, { demarre: true, outils: Math.max(vu?.outils ?? 0, outils) });
}

/** Au DÉPART d'un tour : la trace du tour précédent ne prouve rien pour celui-ci. */
export function oublierLePont(agentId: string): void {
  passages.delete(agentId);
}

/** À la FIN d'un tour : ce que le pont a fait, puis la trace est rendue. */
export function passageDuPont(agentId: string): PassageDuPont {
  const vu = passages.get(agentId);
  passages.delete(agentId);
  return vu ?? null;
}
