import * as React from 'react';
import { SlidersHorizontal } from '@/components/ui/icones';
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
 * DANS LE VOLET DE L'ASSISTANT, il monte dans l'ENTÊTE, juste à gauche de la croix (carte « Mode voix Jarvis dans le
 * champ d'écriture », 17/11/2026) : `dansLEntete`, et le `Chat` de l'assistant ne le pose plus dans le champ
 * (`sansReglagesDuChamp`). Les autres conversations sans carte le gardent dans le champ.
 *
 * L'assistant garde en plus sa bande du haut (mode, plafond) et le Studio son
 * propre bouton : deux accès au même réglage, voulu. Une carte a le sien
 * (`MenuDesReglagesDeLaCarte`, `chat.tsx`) — ce composant ne s'y pose pas.
 */
export function BoutonReglagesAgent({ agent, dansLEntete }: { agent: Agent; /** Posé dans l'entête du volet de l'assistant, à gauche de la croix : sa taille, menu aligné à droite. */ dansLEntete?: boolean }) {
  const state = useApp();
  return (
    <RunSelectors
      engines={state.engines}
      choix={agent.run as RunChoix | undefined}
      comptes={state.quotas}
      onSelect={(patch) => void appliquerUnReglageDAgent(agent.id, patch)}
      aligne={dansLEntete ? 'end' : 'start'}
      declencheur={
        <Button
          variant="ghost"
          size="icon"
          className={dansLEntete ? 'h-[34px] w-[34px] shrink-0 text-muted sm:h-7 sm:w-7' : 'shrink-0'}
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
