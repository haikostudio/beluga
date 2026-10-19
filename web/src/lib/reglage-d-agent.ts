import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import type { RunChoix } from '@/components/run-selectors';

/**
 * LE GESTE QUI ÉCRIT UN RÉGLAGE SUR UN AGENT SANS CARTE (l'assistant, la
 * surveillance, le dépannage…), posé par le bouton de la barre d'écriture
 * (`bouton-reglages-agent.tsx`).
 *
 * Un seul champ part à la fois : le démon tranche la cascade (changer de
 * moteur redonne le modèle par défaut de ce moteur).
 */

export function runDUnReglage(patch: RunChoix): RunChoix {
  return patch.engine
    ? { engine: patch.engine }
    : { model: patch.model, thinking: patch.thinking, account: patch.account };
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
  return true;
}
