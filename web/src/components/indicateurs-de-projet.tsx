import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { activiteDeProjet, type IconeDAttention } from '@beluga/shared';
import { RepereAttention } from '@/components/repere-attention';
import { Tooltip } from '@/components/ui';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * CE QUI SE PASSE SUR UN PROJET, À DROITE DE SA LIGNE dans une liste de choix
 * (demande du 12/10/2026 : « dans les dropdown, à droite, les indicateurs :
 * combien de tâches sont en cours, et l'icône relative à une question, ou
 * autre »).
 *
 * DEUX REPÈRES, DANS CET ORDRE : le nombre de tâches en cours (la roue orange
 * qui tourne et son chiffre, absents à zéro), puis la nature de ce qui attend
 * l'utilisateur — bulle pour une question, chemin pour un plan, triangle pour
 * une décision ou un blocage. Le calcul est celui de la colonne de gauche
 * (`activiteDeProjet`, `shared/src/activite-de-projet.ts`), le dessin celui de
 * la cloche et de la colonne (`RepereAttention`) : aucune liste ne peut dire
 * autre chose qu'elles.
 *
 * LES REPÈRES NE SONT PAS CLIQUABLES : le clic sur la ligne change de projet,
 * et un bouton ne se pose pas dans un bouton ni dans une ligne de menu. Un
 * projet réuni ne totalise pas ses membres, listés dessous avec les leurs.
 *
 * Rien à droite quand rien ne se passe : la ligne reste nue.
 */
export function IndicateursDeProjet({ projectId, className }: { projectId: string; className?: string }) {
  const state = useApp();
  const { enCours, attente } = React.useMemo(
    () => activiteDeProjet(projectId, Object.values(state.agents), state.decisions),
    [projectId, state.agents, state.decisions],
  );
  if (!enCours && !attente) return null;
  return (
    <span className={cn('flex shrink-0 items-center gap-1.5', className)} data-indicateurs-de-projet={projectId}>
      {enCours ? <RepereEnCours compte={enCours} /> : null}
      {attente ? <RepereAttente icone={attente} /> : null}
    </span>
  );
}

function RepereEnCours({ compte }: { compte: number }) {
  const libelle = compte > 1 ? t('{n} agents au travail', { n: compte }) : t('Un agent au travail');
  return (
    <Tooltip label={libelle}>
      <span
        className="flex shrink-0 items-center gap-0.5 text-en-cours"
        data-indicateur-en-cours={compte}
        aria-label={libelle}
      >
        <Loader2 className="h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none" />
        <span className="text-[11px] leading-none tabular-nums">{compte}</span>
      </span>
    </Tooltip>
  );
}

function RepereAttente({ icone }: { icone: IconeDAttention }) {
  const libelle =
    icone === 'message'
      ? t('Une question attend votre réponse')
      : icone === 'plan'
        ? t('Un plan attend votre geste')
        : t('Une décision attend votre geste');
  return <RepereAttention compte={1} icone={icone} libelle={libelle} />;
}
