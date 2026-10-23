import * as React from 'react';
import { etiquetteDuRun, type RunConfig } from '@beluga/shared';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { IconeMoteur } from '@/components/icone-moteur';

/**
 * AVEC QUOI L'AGENT TRAVAILLE : le logo du moteur, puis « modèle · niveau »
 * (`etiquetteDuRun`, shared/src/catalogue-modeles.ts). Posée dans chaque
 * témoin de travail (`InfoTravail`) : carte du tableau, vignette d'un agent
 * sans carte, décroché au-dessus du champ d'écriture.
 *
 * `complet` écrit aussi le NOM du moteur (là où la place le permet) ; sinon
 * le logo le dit, et la bulle au survol porte la ligne entière.
 *
 * Ne lit QUE le catalogue des moteurs dans le magasin : la carte ne se
 * redessine pas à chaque événement de l'application.
 */
export function EtiquetteDuModele({
  run,
  complet = false,
  className,
}: {
  run: Pick<RunConfig, 'engine' | 'model' | 'thinking'> | undefined;
  complet?: boolean;
  className?: string;
}) {
  const engines = React.useSyncExternalStore(client.subscribe, () => client.lireEtat().engines);
  const etiquette = React.useMemo(() => etiquetteDuRun(engines, run), [engines, run?.engine, run?.model, run?.thinking]);
  if (!etiquette || !run) return null;
  const visible = complet ? etiquette.texte : [etiquette.modele ?? etiquette.moteur, etiquette.niveau].filter(Boolean).join(' · ');
  return (
    <span
      data-etiquette-modele={etiquette.texte}
      title={etiquette.texte}
      className={cn('flex min-w-0 shrink items-center gap-1 text-[11px] leading-none text-faint', className)}
    >
      <IconeMoteur engine={run.engine} />
      <span className="truncate">{visible}</span>
    </span>
  );
}
