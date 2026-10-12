import * as React from 'react';
import { EyeOff, GripVertical, LayoutGrid, RotateCcw } from 'lucide-react';
import { deplacerLeBloc, dispositionDesBlocs, type DispositionDesBlocs } from '@beluga/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui';
import { usePointerDrag, type DropTarget } from '@/lib/dnd';
import { usePref } from '@/lib/prefs';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
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
 * plus à droite. `avant` se pose entre la barre et les blocs (les chiffres du
 * Parcours).
 *
 * SUR TÉLÉPHONE, « BLOCS » REJOINT LE MENU À TROIS POINTS DE LA PAGE (demande du
 * 11/10/2026 : trois rangées s'empilaient sous la barre d'en-tête). Le tableau
 * DÉCLARE ses blocs à la page (`FournirLeMenuDesBlocs`), qui pose leurs lignes
 * dans son menu (`LignesDesBlocs`) ; la barre ne garde que `entete` et
 * `outils`, et disparaît quand elle n'a plus rien à porter. La disposition est
 * une préférence : le menu et le tableau la lisent au même endroit.
 */

export interface BlocDuTableau {
  id: string;
  titre: string;
  /** Pleine largeur (courbes, flux) ou une demi-colonne sur grand écran. */
  large?: boolean;
  rendu: () => React.ReactNode;
}

/** Les blocs du tableau affiché, tels que le menu de la page les liste. */
export interface BlocsDeLaPage {
  onglet: string;
  blocs: { id: string; titre: string }[];
}
const DeclarerLesBlocs = React.createContext<((blocs: BlocsDeLaPage | null) => void) | null>(null);
/** La page qui porte le menu à trois points reçoit ici les blocs du tableau affiché. */
export const FournirLeMenuDesBlocs = DeclarerLesBlocs.Provider;

/** La disposition retenue d'un onglet, et les deux gestes qui la changent. */
function useDispositionDesBlocs(onglet: string, ids: string[]) {
  const [gardee, garder] = usePref<DispositionDesBlocs | null>(`statistiques.blocs.${onglet}`, null);
  const disposition = dispositionDesBlocs(ids, gardee);
  const basculer = (id: string) => {
    const masques = disposition.masques.includes(id) ? disposition.masques.filter((x) => x !== id) : [...disposition.masques, id];
    garder({ ...disposition, masques });
  };
  return { disposition, garder, basculer };
}

/** Les lignes du menu « Blocs » : une case par bloc, puis le retour à la disposition d'origine. */
function ChoixDesBlocs({ onglet, blocs }: BlocsDeLaPage) {
  const { disposition, garder, basculer } = useDispositionDesBlocs(onglet, blocs.map((b) => b.id));
  const titres = new Map(blocs.map((b) => [b.id, b.titre]));
  return (
    <>
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
            <span className="truncate">{titres.get(id) ?? id}</span>
          </DropdownMenuItem>
        );
      })}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => garder(null)} data-stats-blocs-retablir>
        <RotateCcw className="h-3.5 w-3.5" />
        {t('Rétablir la disposition')}
      </DropdownMenuItem>
    </>
  );
}

/**
 * « BLOCS », EN LIGNE DU MENU À TROIS POINTS DE LA PAGE (téléphone) : elle
 * déplie la même liste que le bouton d'ordinateur. Rien tant qu'aucun tableau
 * n'a déclaré ses blocs.
 */
export function LignesDesBlocs({ declares }: { declares: BlocsDeLaPage | null }) {
  if (!declares?.blocs.length) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2.5 rounded-lg px-2.5 py-2 text-text" data-stats-blocs-menu>
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted">
          <LayoutGrid className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 truncate">{t('Blocs')}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[60vh]">
        <ChoixDesBlocs onglet={declares.onglet} blocs={declares.blocs} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
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
  const { disposition, garder, basculer } = useDispositionDesBlocs(onglet, ids);
  const parId = new Map(blocs.map((b) => [b.id, b]));
  /* SUR TÉLÉPHONE, « BLOCS » VIT DANS LE MENU DE LA PAGE : le tableau lui
     déclare ses blocs, par leur identité et leur titre seulement — une liste
     comparée par son texte, pour ne pas redessiner la page à chaque rendu. */
  const declarer = React.useContext(DeclarerLesBlocs);
  const dansLeMenuDeLaPage = useTelephone() && !!declarer;
  const declaration = JSON.stringify(blocs.map((b) => ({ id: b.id, titre: b.titre })));
  React.useEffect(() => {
    if (!dansLeMenuDeLaPage || !declarer) return;
    declarer({ onglet, blocs: JSON.parse(declaration) as BlocsDeLaPage['blocs'] });
    return () => declarer(null);
  }, [dansLeMenuDeLaPage, declarer, onglet, declaration]);
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

  return (
    <div className="flex flex-col gap-3" data-stats-tableau={onglet}>
      {/* Le groupe de droite garde « Blocs » en dernier. Sur téléphone, la
          barre ne porte plus que l'entête et les outils — et rien du tout
          quand elle n'en a pas (l'Audience). */}
      {dansLeMenuDeLaPage && !entete && !outils ? null : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-bloc px-3 py-2" data-stats-barre={onglet}>
          {entete ? <div className="min-w-0 flex-1 basis-60">{entete}</div> : null}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2 [&_[role=group]]:bg-surface/60" data-stats-outils>
            {outils}
            {dansLeMenuDeLaPage ? null : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="shrink-0" data-stats-blocs-menu>
                    <LayoutGrid className="h-3.5 w-3.5" />
                    {t('Blocs')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-[60vh] overflow-y-auto">
                  <ChoixDesBlocs onglet={onglet} blocs={blocs.map((b) => ({ id: b.id, titre: b.titre }))} />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      )}
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
