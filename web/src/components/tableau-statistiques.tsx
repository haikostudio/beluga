import * as React from 'react';
import { EyeOff, GripVertical, LayoutGrid, RotateCcw } from 'lucide-react';
import { deplacerLeBloc, dispositionDesBlocs, type DispositionDesBlocs } from '@beluga/shared';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui';
import { usePointerDrag, type DropTarget } from '@/lib/dnd';
import { usePref } from '@/lib/prefs';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE TABLEAU DE BORD À BLOCS du service Statistiques (demande du 28/09/2026).
 *
 * Chaque graphique est un BLOC : il se déplace (poignée, avec le seul glisser
 * de l'application, `usePointerDrag`), se masque, et se réaffiche depuis le
 * menu « Blocs », qui rétablit aussi la disposition d'origine. La disposition
 * est une PRÉFÉRENCE en base (`usePref`) : la même sur tous les appareils et
 * pour tous les sites, une par onglet. Un bloc indisponible (suivi anonyme)
 * reste à sa place et dit pourquoi.
 *
 * LA BARRE D'OUTILS (demande du 28/09/2026) : une seule bande pleine largeur
 * sous les onglets — `entete` à gauche (les objectifs du Parcours), puis les
 * `outils` (bouton de l'agent, choix des dates), puis « Blocs », TOUJOURS le
 * plus à droite, même quand la bande passe à la ligne sur téléphone. `avant`
 * se pose entre la barre et les blocs (les chiffres du Parcours).
 */

export interface BlocDuTableau {
  id: string;
  titre: string;
  /** Pleine largeur (courbes, flux) ou une demi-colonne sur grand écran. */
  large?: boolean;
  rendu: () => React.ReactNode;
}

export function TableauDeBlocs({
  onglet,
  blocs,
  entete,
  outils,
  avant,
}: {
  onglet: string;
  blocs: BlocDuTableau[];
  entete?: React.ReactNode;
  outils?: React.ReactNode;
  avant?: React.ReactNode;
}) {
  const ids = blocs.map((b) => b.id);
  const [gardee, garder] = usePref<DispositionDesBlocs | null>(`statistiques.blocs.${onglet}`, null);
  const disposition = dispositionDesBlocs(ids, gardee);
  const parId = new Map(blocs.map((b) => [b.id, b]));
  const visibles = disposition.ordre.filter((id) => !disposition.masques.includes(id));

  const resolve = React.useCallback((element: Element, y: number): DropTarget | null => {
    const place = element.closest('[data-stats-bloc-place]');
    const id = place?.getAttribute('data-stats-bloc-place');
    if (!place || !id) return null;
    const r = place.getBoundingClientRect();
    return { id, kind: 'bloc', position: y < r.top + r.height / 2 ? 'before' : 'after' };
  }, []);
  const deposer = React.useCallback(
    (item: { id: string }, cible: DropTarget | null) => {
      if (!cible || cible.position === 'inside') return;
      garder({ ...disposition, ordre: deplacerLeBloc(disposition.ordre, item.id, cible.id, cible.position) });
    },
    [disposition.ordre.join('|'), disposition.masques.join('|')],
  );
  const { dragging, target, start } = usePointerDrag({ resolve, onDrop: deposer, holdMs: 250 });

  const basculer = (id: string) => {
    const masques = disposition.masques.includes(id) ? disposition.masques.filter((x) => x !== id) : [...disposition.masques, id];
    garder({ ...disposition, masques });
  };

  return (
    <div className="flex flex-col gap-3" data-stats-tableau={onglet}>
      {/* Le groupe de droite garde « Blocs » en dernier : sur téléphone, l'entête prend sa ligne et le groupe passe dessous, calé à droite. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-bloc px-3 py-2" data-stats-barre={onglet}>
        {entete ? <div className="min-w-0 flex-1 basis-60">{entete}</div> : null}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2 [&_[role=group]]:bg-surface/60" data-stats-outils>
          {outils}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="shrink-0" data-stats-blocs-menu>
                <LayoutGrid className="h-3.5 w-3.5" />
                {t('Blocs')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[60vh] overflow-y-auto">
              <DropdownMenuLabel>{t('Afficher')}</DropdownMenuLabel>
              {disposition.ordre.map((id) => {
                const visible = !disposition.masques.includes(id);
                return (
                  <DropdownMenuItem
                    key={id}
                    onSelect={(e) => {
                      e.preventDefault();
                      basculer(id);
                    }}
                    data-stats-blocs-choix={id}
                    data-visible={visible ? 'oui' : 'non'}
                  >
                    <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border', visible ? 'border-accent bg-accent text-[10px] text-accent-fg' : 'border-faint')}>
                      {visible ? '✓' : ''}
                    </span>
                    <span className="truncate">{parId.get(id)?.titre ?? id}</span>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => garder(null)} data-stats-blocs-retablir>
                <RotateCcw className="h-3.5 w-3.5" />
                {t('Rétablir la disposition')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {avant}
      {visibles.length ? (
        <div className="grid gap-2 sm:grid-cols-2" data-stats-blocs={visibles.join(',')}>
          {visibles.map((id) => {
            const bloc = parId.get(id)!;
            const vise = target?.id === id ? target.position : null;
            return (
              <div
                key={id}
                className={cn(
                  // Seule la rangée du titre garde la place des deux boutons du coin : le graphique, lui, prend toute la largeur. Le bloc s'étire à la hauteur de sa rangée.
                  'group relative min-w-0 [&>*:first-child]:h-full [&_[data-stats-titre]]:pr-16',
                  bloc.large && 'sm:col-span-2',
                  dragging?.id === id && 'opacity-40',
                )}
                data-stats-bloc-place={id}
              >
                {bloc.rendu()}
                {vise === 'before' ? <div aria-hidden className="absolute inset-x-0 -top-1.5 h-0.5 rounded-full bg-accent" /> : null}
                {vise === 'after' ? <div aria-hidden className="absolute inset-x-0 -bottom-1.5 h-0.5 rounded-full bg-accent" /> : null}
                <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 max-sm:opacity-100">
                  <button
                    type="button"
                    aria-label="Masquer le bloc"
                    title={t('Masquer')}
                    className="flex h-6 w-6 items-center justify-center rounded-sm text-faint hover:bg-raised hover:text-text"
                    onClick={() => basculer(id)}
                    data-stats-bloc-masquer={id}
                  >
                    <EyeOff className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Déplacer le bloc"
                    title={t('Glisser pour déplacer')}
                    className="flex h-6 w-6 cursor-grab touch-none items-center justify-center rounded-sm text-faint hover:bg-raised hover:text-text"
                    onPointerDown={(e) => start(e, { id, kind: 'bloc', label: bloc.titre })}
                    data-stats-bloc-poignee={id}
                  >
                    <GripVertical className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-md bg-bloc px-3 py-2.5 text-[12.5px] text-faint">{t('Tous les blocs sont masqués : rouvrez-les depuis le menu « Blocs ».')}</p>
      )}
    </div>
  );
}
