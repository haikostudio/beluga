import * as React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { Agent } from '@beluga/shared';
import { Button } from '@/components/ui';
import { RunSelectors, type RunChoix } from '@/components/run-selectors';
import { appliquerUnReglageDAgent } from '@/lib/reglage-d-agent';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';

/**
 * LE BOUTON DE RÉGLAGES D'UNE CONVERSATION SANS CARTE, posé dans la barre
 * d'écriture, juste à droite du trombone (demande du 15/10/2026). Il ouvre le
 * même menu que partout (moteur, modèle, réflexion, compte — `RunSelectors`),
 * ancré à son bouton : jamais une page.
 *
 * L'assistant garde en plus sa bande du haut (mode, plafond) et le Studio son
 * propre bouton : deux accès au même réglage, voulu. Une carte a le sien
 * (`MenuDesReglagesDeLaCarte`, `chat.tsx`) — ce composant ne s'y pose pas.
 */
export function BoutonReglagesAgent({ agent }: { agent: Agent }) {
  const state = useApp();
  return (
    <RunSelectors
      engines={state.engines}
      choix={agent.run as RunChoix | undefined}
      comptes={state.quotas}
      onSelect={(patch) => void appliquerUnReglageDAgent(agent.id, patch)}
      declencheur={
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          title={t('Configuration de l’agent')}
          aria-label="Configuration de l’agent"
          data-raccourci-reglages-agent
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </Button>
      }
    />
  );
}
