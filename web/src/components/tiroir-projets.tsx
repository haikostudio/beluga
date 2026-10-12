import * as React from 'react';
import { Check, Search, Waypoints } from 'lucide-react';
import { filtrerProjetsParNom, projetsDansLOrdreDeLaColonne, projetsEnArbre } from '@beluga/shared';
import { Dialog, DialogContentLibre, DialogHeader, DialogTitle, Input, ZoneDefilement } from '@/components/ui';
import {
  BrancheDeListe,
  IconeDeProjet,
  LISTE_DE_TIROIR,
  RETRAIT_MEMBRE_DE_TIROIR,
  largeurIconeDeProjet,
} from '@/components/pastille-projet';
import { IndicateursDeProjet } from '@/components/indicateurs-de-projet';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE TIROIR DE CHANGEMENT DE PROJET — ouvert par un clic sur le NOM en haut
 * (`data-titre-bandeau`, `quota-bar.tsx`), sur téléphone comme sur ordinateur.
 *
 * Passer d'un projet à l'autre demandait d'ouvrir la colonne de gauche (un
 * panneau entier sur téléphone). Ici, une seule liste : « Tableaux de bord »
 * en tête, puis les projets de la colonne DANS SON ORDRE
 * (`projetsDansLOrdreDeLaColonne`), chacun avec son icône — sans les projets
 * mis de côté. Un champ de recherche FIXE, hors de la zone qui défile, filtre
 * par nom, sans accents ni majuscules (`filtrerProjetsParNom`). Les membres d'un
 * projet réuni, qui le suivent déjà, sont en retrait et reliés à lui par une
 * branche (`projetsEnArbre`, posé APRÈS la recherche : un membre trouvé sans son
 * projet réuni reste une ligne seule).
 *
 * Choisir fait EXACTEMENT le geste de la colonne de gauche : le projet devient
 * celui qu'on regarde (`client.setActiveProject`) et le centre revient au
 * tableau (`onOuvrirVue('projet')`) ; « Tableaux de bord » ouvre la page de
 * tous les projets. Puis le tiroir se referme.
 *
 * Comme le volet « Nouvel agent », le champ ne prend le curseur que sur grand
 * écran : sur téléphone, le clavier cacherait la liste dès l'ouverture. Entrée
 * choisit la ligne quand il n'en reste qu'une.
 */
export function TiroirProjets({
  open,
  onClose,
  surTableauxDeBord,
  onOuvrirVue,
}: {
  open: boolean;
  onClose: () => void;
  /** La page « Tableaux de bord » est à l'écran : c'est SA ligne qui est marquée. */
  surTableauxDeBord: boolean;
  onOuvrirVue: (vue: 'en-route' | 'projet') => void;
}) {
  const state = useApp();
  const [filtre, setFiltre] = React.useState('');
  const champRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setFiltre('');
    // Après le focus initial du tiroir, sinon il reprendrait la main.
    const focus = window.matchMedia('(min-width: 640px)').matches
      ? window.setTimeout(() => champRef.current?.focus(), 60)
      : undefined;
    return () => window.clearTimeout(focus);
  }, [open]);

  const liste = React.useMemo(
    () => projetsDansLOrdreDeLaColonne(state.projects, state.groups),
    [state.projects, state.groups],
  );
  const projets = React.useMemo(() => filtrerProjetsParNom(liste, filtre), [liste, filtre]);
  const lignes = React.useMemo(() => projetsEnArbre(projets), [projets]);
  const libelleTableaux = t('Tableaux de bord');
  const tableauxVisibles = filtrerProjetsParNom([{ name: libelleTableaux }], filtre).length > 0;

  const ouvrirLesTableaux = () => {
    onOuvrirVue('en-route');
    onClose();
  };
  const choisir = (projectId: string) => {
    client.setActiveProject(projectId);
    onOuvrirVue('projet');
    onClose();
  };

  const classeLigne =
    'flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] text-text transition-colors hover:bg-raised';

  return (
    /* UNE FENÊTRE DE RECHERCHE, au milieu de l'écran : on y passe deux secondes,
       ce n'est pas une page. */
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContentLibre className="h-[min(560px,80dvh)] sm:w-[min(520px,100%)]">
      <div data-tiroir-projets className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle className="min-w-0 truncate">{t('Changer de projet')}</DialogTitle>
        </DialogHeader>
        <div className="relative mx-4 mb-2 shrink-0">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
          <Input
            ref={champRef}
            data-recherche-tiroir-projets
            value={filtre}
            onChange={(event) => setFiltre(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              const lignes = projets.length + (tableauxVisibles ? 1 : 0);
              if (lignes !== 1) return;
              event.preventDefault();
              if (tableauxVisibles) ouvrirLesTableaux();
              else choisir(projets[0].id);
            }}
            placeholder={t('Chercher un projet…')}
            className="pl-7"
          />
        </div>
        {/* Une hauteur plancher : la feuille ne rétrécit pas d'un bond à chaque
            lettre tapée dans la recherche. */}
        <ZoneDefilement className="min-h-0 px-2 pb-3">
          {tableauxVisibles || projets.length ? (
            <ul className="flex flex-col gap-0.5">
              {tableauxVisibles ? (
                <li>
                  <button
                    type="button"
                    data-ligne-tiroir-projets="en-route"
                    aria-current={surTableauxDeBord ? 'true' : undefined}
                    onClick={ouvrirLesTableaux}
                    className={cn(classeLigne, surTableauxDeBord && 'bg-raised text-teinte')}
                  >
                    <Waypoints className="h-[15px] w-[15px] shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate">{libelleTableaux}</span>
                    {surTableauxDeBord ? <Check className="h-3.5 w-3.5 shrink-0 text-teinte" /> : null}
                  </button>
                </li>
              ) : null}
              {lignes.map(({ projet, parentId, premier, dernier }) => {
                const ouvert = !surTableauxDeBord && projet.id === state.activeProjectId;
                return (
                  <li key={projet.id} className="relative" data-membre-de={parentId}>
                    {parentId ? (
                      <BrancheDeListe
                        premier={premier}
                        dernier={dernier}
                        largeurParent={largeurIconeDeProjet(
                          state.projects.find((p) => p.id === parentId),
                          state.projects,
                        )}
                        geometrie={LISTE_DE_TIROIR}
                      />
                    ) : null}
                    <button
                      type="button"
                      data-ligne-tiroir-projets={projet.id}
                      aria-current={ouvert ? 'true' : undefined}
                      onClick={() => choisir(projet.id)}
                      className={cn(classeLigne, ouvert && 'bg-raised text-teinte', parentId && RETRAIT_MEMBRE_DE_TIROIR)}
                    >
                      {/* Un projet réuni montre la pile des icônes de ses membres, comme la colonne. */}
                      <IconeDeProjet projet={projet} projets={state.projects} fond="hsl(var(--surface))" />
                      <span className="min-w-0 flex-1 truncate">{projet.name}</span>
                      <IndicateursDeProjet projectId={projet.id} />
                      {ouvert ? <Check className="h-3.5 w-3.5 shrink-0 text-teinte" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p data-tiroir-projets-vide className="px-2 py-4 text-[13px] text-faint">
              {t('Aucun projet ne correspond à cette recherche.')}
            </p>
          )}
        </ZoneDefilement>
      </div>
      </DialogContentLibre>
    </Dialog>
  );
}
