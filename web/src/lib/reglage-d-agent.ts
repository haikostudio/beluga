import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import type { RunChoix } from '@/components/run-selectors';

/**
 * LE GESTE QUI ÉCRIT UN RÉGLAGE SUR UN AGENT SANS CARTE (l'assistant, la
 * surveillance, le dépannage…) — un seul, partagé par la bande de réglages de
 * l'assistant (`reglages-assistant.tsx`) et par le bouton posé dans la barre
 * d'écriture (`bouton-reglages-agent.tsx`).
 *
 * Un seul champ part à la fois : le démon tranche la cascade (changer de
 * moteur redonne le modèle par défaut de ce moteur). Choisir un moteur, un
 * modèle ou une réflexion à la main FIGE le modèle de l'assistant (le démon
 * bascule le mode) ; un simple changement de compte ne le fige pas.
 */
export const EVENEMENT_AGENT_FIGE = 'beluga:agent-fige';

export function runDUnReglage(patch: RunChoix): RunChoix {
  return patch.engine
    ? { engine: patch.engine }
    : { model: patch.model, thinking: patch.thinking, account: patch.account };
}

/** Un réglage de compte seul (ni modèle ni réflexion) ne fige rien. */
export function figeLeModele(run: RunChoix): boolean {
  return !(run.account !== undefined && !run.model && !run.thinking);
}

/** Écrit le réglage ; rend `true` quand il a été pris, `false` s'il a été refusé (un message l'a dit). */
export async function appliquerUnReglageDAgent(agentId: string, patch: RunChoix): Promise<boolean> {
  const run = runDUnReglage(patch);
  try {
    await client.call({ type: 'agent.config', agentId, run });
  } catch (err: any) {
    client.pushToast('error', err?.message ?? t('réglage impossible'));
    return false;
  }
  if (figeLeModele(run) && typeof window !== 'undefined') {
    // Une bande de réglages ouverte ailleurs affiche aussitôt « Modèle fixe ».
    window.dispatchEvent(new CustomEvent(EVENEMENT_AGENT_FIGE, { detail: { agentId } }));
  }
  return true;
}
