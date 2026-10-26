import * as React from 'react';
import { Layers } from 'lucide-react';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LA PILE DE CARTES D'UNE DEMANDE COMMUNE — partagée par la page « Tableaux de
 * bord » (familles mère + filles, `pilesEnRoute`) et par le tableau d'un projet
 * (une SUITE d'étapes sous sa carte globale, `shared/src/suite-de-cartes.ts`).
 * Le même geste partout : la carte du dessus, un clic qui déplie les autres
 * dessous, un appui dehors ou Échap qui rempile.
 */

/** Ce que chaque carte reçoit pour ouvrir son menu (`gesteDuMenu`). */
export interface GesteDuMenu {
  menuOuvert: boolean;
  onMenuChange: (ouvert: boolean) => void;
  onPointerDown: (event: React.PointerEvent) => void;
}

/** La durée du dépliage et du rempilage d'une pile. */
const DUREE_PILE_MS = 260;

/**
 * UNE PILE : les cartes d'une demande commune, la mère au-dessus (demande de
 * l'utilisateur, 25.09.2026). Une pile d'UNE carte est rendue telle quelle.
 *
 * REPLIÉE, seule la carte du dessus se voit, deux bords décalés derrière elle
 * et le nombre de cartes en pied. Un VOILE transparent la couvre : le premier
 * clic (ou Entrée) DÉPLIE la pile au lieu d'ouvrir la tâche du dessus. Le clic
 * droit et l'appui long passent au travers vers le menu de la carte du dessus.
 *
 * DÉPLIÉE, les cartes se posent l'une sous l'autre (hauteur et glissement
 * animés, coupés quand le système demande moins d'animations) et chacune ouvre
 * sa tâche. Un appui HORS de la pile, ou Échap, la rempile. L'état vit dans le
 * composant : un rechargement repart toujours replié.
 */
export function PileDeCartes<T extends { id: string }>({
  pile,
  rendre,
  menu,
}: {
  pile: { cle: string; cartes: readonly T[] };
  rendre: (card: T) => React.ReactNode;
  menu: (card: T) => GesteDuMenu;
}) {
  const [ouverte, setOuverte] = React.useState(false);
  // Les cartes du dessous restent montées le temps du rempilage animé.
  const [montees, setMontees] = React.useState(false);
  const [etalee, setEtalee] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const seule = pile.cartes.length < 2;

  React.useEffect(() => {
    if (ouverte) {
      setMontees(true);
      // Une image plus tard : la hauteur part de zéro, la transition joue.
      const image = requestAnimationFrame(() => requestAnimationFrame(() => setEtalee(true)));
      return () => cancelAnimationFrame(image);
    }
    setEtalee(false);
    const minuteur = window.setTimeout(() => setMontees(false), DUREE_PILE_MS);
    return () => window.clearTimeout(minuteur);
  }, [ouverte]);

  React.useEffect(() => {
    if (!ouverte) return;
    const dehors = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOuverte(false);
    };
    const echap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOuverte(false);
    };
    document.addEventListener('pointerdown', dehors, true);
    document.addEventListener('keydown', echap);
    return () => {
      document.removeEventListener('pointerdown', dehors, true);
      document.removeEventListener('keydown', echap);
    };
  }, [ouverte]);

  if (seule) return <>{pile.cartes.map(rendre)}</>;

  const [dessus, ...dessous] = pile.cartes;
  const menuDuDessus = menu(dessus);
  return (
    <div
      ref={ref}
      className={cn('relative flex min-w-0 flex-col', !ouverte && 'mb-1.5')}
      data-pile-en-route={pile.cle}
      data-pile-ouverte={ouverte ? 'true' : 'false'}
      data-nombre-pile={pile.cartes.length}
    >
      <div className="relative isolate flex min-w-0 flex-col">
        {/* Les bords des cartes du dessous, décalés derrière celle du dessus. */}
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 -z-10 transition-opacity duration-200 motion-reduce:transition-none',
            ouverte ? 'opacity-0' : 'opacity-100',
          )}
        >
          <div className="absolute inset-x-4 -bottom-2.5 top-3 rounded-md border border-border bg-raised opacity-60" />
          <div className="absolute inset-x-2 -bottom-[5px] top-1.5 rounded-md border border-border bg-raised" />
        </div>
        {rendre(dessus)}
        {/* Le nombre de cartes, en pied de la carte du dessus, sur les bords du dessous. */}
        <span
          className={cn(
            'pointer-events-none absolute -bottom-2.5 right-3 z-40 flex items-center gap-1 rounded-full border border-border bg-raised px-1.5 py-px text-[11px] tabular-nums text-muted transition-opacity duration-200 motion-reduce:transition-none',
            ouverte ? 'opacity-0' : 'opacity-100',
          )}
          data-compte-pile={pile.cle}
        >
          <Layers className="h-3 w-3" />
          {pile.cartes.length}
        </span>
      </div>

      {!ouverte ? (
        <div
          role="button"
          tabIndex={0}
          aria-label={`Deplier les ${pile.cartes.length} cartes de cette demande`}
          title={t('Déplier les {n} cartes de cette demande', { n: pile.cartes.length })}
          data-masque-pile={pile.cle}
          className="absolute inset-0 z-30 cursor-pointer rounded-md"
          onClick={(event) => {
            event.stopPropagation();
            setOuverte(true);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            setOuverte(true);
          }}
          // Le menu de la carte du dessus reste à portée : appui long au doigt…
          onPointerDown={menuDuDessus.onPointerDown}
          // … et clic droit à la souris, son relâchement avalé comme sur la carte.
          onContextMenu={(event) => {
            event.preventDefault();
            const avaler = (relache: PointerEvent) => {
              if (relache.button === 2) relache.stopPropagation();
            };
            document.addEventListener('pointerup', avaler, { capture: true, once: true });
            menuDuDessus.onMenuChange(true);
          }}
        />
      ) : null}

      {montees ? (
        <div
          className={cn(
            'grid transition-[grid-template-rows] ease-out motion-reduce:transition-none',
            etalee ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          )}
          style={{ transitionDuration: `${DUREE_PILE_MS}ms` }}
          data-dessous-pile={pile.cle}
        >
          <div className="min-h-0 overflow-hidden">
            {/* L'ÉCART SOUS LA MÈRE EST COURT (8 px en tout) : 4 px au-dessus
                du bloc, 4 px de marge haute dedans. Deux marges de 12 px s'y
                additionnaient, et les filles semblaient détachées de leur mère.
                Les côtés, le bas et l'écart entre filles gardent 12 px. */}
            <div className="pt-1">
              <div className="bloc-sous-cartes flex flex-col gap-3 rounded-lg px-3 pb-3 pt-1" data-bloc-sous-cartes={pile.cle}>
                {dessous.map((card, i) => (
                  <div
                    key={card.id}
                    className={cn(
                      'flex min-w-0 flex-col transition-[transform,opacity] ease-out motion-reduce:transition-none',
                      etalee ? 'translate-y-0 opacity-100' : '-translate-y-6 opacity-0',
                    )}
                    style={{ transitionDuration: `${DUREE_PILE_MS}ms`, transitionDelay: etalee ? `${i * 40}ms` : '0ms' }}
                  >
                    {rendre(card)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
