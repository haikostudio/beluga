import * as React from 'react';
import { avancementDeLaCarte, type Agent } from '@beluga/shared';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { InfoTravail } from '@/components/info-travail';
import { BarreProgression } from '@/components/barre-progression';
import { dureeLisible } from '@/components/arret-agent';

/**
 * LA BARRE DE TRAVAIL SOUS UNE CARTE, ÉCRITE UNE SEULE FOIS.
 *
 * Elle sort par le bas de la carte, comme une étiquette glissée derrière
 * (`-mt-1`, `bg-bandeau-etape`, l'ombre intérieure en haut) : le témoin animé,
 * l'étape en cours (`agent.etapeEnCours`), le compte des étapes et le temps
 * écoulé — les mêmes données que la barre au-dessus du composeur
 * (`InfoTravail`) — puis la barre fine collée au bas, au chiffre de la tête de
 * « En cours » (`avancementDeLaCarte`). La carte du tableau (`CardTile`) et
 * l'agent sans carte de la page « Tableaux de bord » (`VignetteAgent`) la
 * posent TOUTES LES DEUX : aucune copie qui dériverait.
 *
 * Le tic d'une seconde vit ICI, pas dans la carte : seul ce bandeau se
 * redessine chaque seconde, et il n'existe que tant que l'agent travaille —
 * l'appelant ne le pose que dans ce cas.
 *
 * Sans bouton d'arrêt : la pastille est trop étroite, et le geste d'arrêt a sa
 * place ailleurs (le tiroir de la carte, la tête de la vignette).
 */
export function BandeauTravail({
  agent,
  onClick,
  className,
  ...attributs
}: {
  agent: Agent;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  const [, forcer] = React.useState(0);
  React.useEffect(() => {
    const timer = window.setInterval(() => forcer((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const temps = agent.startedAt ? dureeLisible(Math.round((Date.now() - agent.startedAt) / 1000)) : null;
  const avancement = agent.todos && agent.todos.total > 0 ? agent.todos : null;
  const { 'data-barre-carte': barreCarte, ...autres } = attributs;
  return (
    <div
      onClick={onClick}
      className={cn(
        // Resserré (px-1.5 au lieu de px-2.5) : l'icône colle au bord gauche,
        // la pastille de temps au bord droit, et le nom de l'étape gagne la
        // place ainsi rendue.
        'relative -mt-1 flex shrink-0 cursor-pointer items-center gap-1 overflow-hidden rounded-b-md bg-bandeau-etape px-1.5 pb-1.5 pt-2 text-[12.5px] leading-none',
        'shadow-[inset_0_7px_6px_-6px_rgba(0,0,0,0.75)]',
        className,
      )}
      {...autres}
    >
      {/* `alterner` : le compte des étapes et le chronomètre tournent l'un
          après l'autre plutôt que de se concaténer. */}
      <InfoTravail quoi={agent.etapeEnCours ?? t('Réflexion en cours…')} avancement={avancement} temps={temps} alterner />
      {/* LA BARRE FINE, posée en absolu : elle suit l'arrondi sans ajouter un
          pixel de hauteur ; sans liste d'étapes, elle défile. */}
      <BarreProgression
        className="absolute inset-x-0 bottom-0"
        pourcent={avancementDeLaCarte(agent.todos)?.pourcent ?? null}
        data-barre-carte={barreCarte}
      />
    </div>
  );
}
