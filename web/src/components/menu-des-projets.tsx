import * as React from 'react';
import { Check, Search, Waypoints } from 'lucide-react';
import { filtrerProjetsParNom, projetsDansLOrdreDeLaColonne, projetsEnArbre } from '@beluga/shared';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input } from '@/components/ui';
import {
  BrancheDeListe,
  IconeDeProjet,
  LISTE_DE_MENU,
  RETRAIT_MEMBRE_DE_MENU,
  largeurIconeDeProjet,
} from '@/components/pastille-projet';
import { IndicateursDeProjet } from '@/components/indicateurs-de-projet';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * CHANGER DE PROJET DEPUIS LE FIL D'ARIANE — une LISTE DÉROULANTE, ouverte sous
 * le cran qu'on a touché (demande du 11/10/2026 : « on doit pouvoir sélectionner
 * un autre projet directement depuis le fil d'Ariane, ça doit ouvrir en
 * drop-down »).
 *
 * UNE SEULE LISTE, sous le NOM DU PROJET comme sous le NOM DE SON GROUPE
 * (demande du 12/10/2026 : « on doit pouvoir sélectionner l'ensemble des
 * autres groupes de projets, naviguer dans l'intégrité des projets, même si on
 * est dans Beluga ») : tous les projets de tous les groupes, dans l'ordre de la
 * colonne de gauche (`projetsDansLOrdreDeLaColonne`), sous le nom de leur
 * groupe, « Tableaux de bord » en tête et un champ de recherche fixe. Le
 * groupe d'où l'on vient n'est plus une impasse qui ne montre que ses
 * propres projets. À l'ouverture, la liste se centre sur le projet courant.
 * Les membres d'un projet réuni sont en retrait, reliés à lui par une branche
 * (`projetsEnArbre`, posé APRÈS la recherche).
 *
 * Choisir fait EXACTEMENT le geste de la colonne : le projet devient celui
 * qu'on regarde et le centre revient à son tableau. La fenêtre « Changer de
 * projet » (`TiroirProjets`) reste derrière la loupe de la colonne ; les deux
 * listes portent les mêmes repères de ligne (`data-ligne-tiroir-projets`).
 *
 * Le champ arrête la propagation des touches (sauf Échap, qui ferme) : sinon
 * la recherche par lettre du menu lui vole la frappe. Il ne prend le curseur
 * d'office que sur ordinateur — sur téléphone, le clavier couvrirait la liste.
 */
export function MenuDesProjets({
  declencheur,
  surTableauxDeBord = false,
  projetCourantId,
  onOuvrirVue,
}: {
  /** Le cran du fil d'Ariane : il devient le bouton qui ouvre la liste. */
  declencheur: React.ReactElement;
  /** La page « Tableaux de bord » est à l'écran : c'est SA ligne qui est marquée. */
  surTableauxDeBord?: boolean;
  /**
   * LE PROJET QU'ON REGARDE, quand ce n'est pas le projet actif de
   * l'application : le fil d'une tâche ouverte depuis les tableaux de bord
   * (le projet actif reste alors l'ancien) coche le projet de SA tâche.
   */
  projetCourantId?: string;
  onOuvrirVue: (vue: 'en-route' | 'projet') => void;
}) {
  const state = useApp();
  const telephone = useTelephone();
  const [filtre, setFiltre] = React.useState('');
  // Le menu donne d'abord le curseur à son panneau (au montage, après les
  // enfants) : on le reprend à l'image suivante. C'est aussi à ce moment que
  // la liste, longue de tous les groupes, se centre sur le projet courant.
  const prendreLeCurseur = React.useCallback(
    (el: HTMLInputElement | null) => {
      if (!el) return;
      requestAnimationFrame(() => {
        if (!telephone) el.focus({ preventScroll: true });
        el.closest('[data-menu-des-projets]')
          ?.querySelector('[aria-current="true"]')
          ?.scrollIntoView({ block: 'center' });
      });
    },
    [telephone],
  );

  /** Le groupe d'un projet : le sien, ou celui du projet réuni qui le porte. */
  const groupeDe = React.useCallback(
    (projet: { groupId?: string; regroupementId?: string }) =>
      projet.groupId ??
      (projet.regroupementId ? state.projects.find((p) => p.id === projet.regroupementId)?.groupId : undefined),
    [state.projects],
  );
  const liste = React.useMemo(
    () => projetsDansLOrdreDeLaColonne(state.projects, state.groups),
    [state.projects, state.groups],
  );
  const projets = React.useMemo(() => filtrerProjetsParNom(liste, filtre), [liste, filtre]);
  const lignes = React.useMemo(() => projetsEnArbre(projets), [projets]);
  const libelleTableaux = t('Tableaux de bord');
  const tableauxVisibles = filtrerProjetsParNom([{ name: libelleTableaux }], filtre).length > 0;

  const choisir = (projectId: string) => {
    client.setActiveProject(projectId);
    onOuvrirVue('projet');
  };

  let groupePrecedent: string | undefined;
  return (
    <DropdownMenu onOpenChange={(ouvert) => !ouvert && setFiltre('')}>
      <DropdownMenuTrigger asChild>{declencheur}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[min(70vh,560px)] sm:w-72"
        data-menu-des-projets="tous"
        data-tiroir-projets
      >
        <div className="sticky top-0 z-10 bg-surface pb-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <Input
              ref={prendreLeCurseur}
              data-recherche-tiroir-projets
              value={filtre}
              onChange={(event) => setFiltre(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') return;
                event.stopPropagation();
                if (event.key !== 'Enter') return;
                if (projets.length + (tableauxVisibles ? 1 : 0) !== 1) return;
                event.preventDefault();
                if (tableauxVisibles) onOuvrirVue('en-route');
                else choisir(projets[0].id);
                // Le menu ne sait pas qu'on a choisi au clavier : on le referme comme lui.
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              }}
              placeholder={t('Chercher un projet…')}
              aria-label="Chercher un projet"
              className="h-8 pl-7"
            />
          </div>
        </div>
        {tableauxVisibles ? (
          <DropdownMenuItem
            data-ligne-tiroir-projets="en-route"
            aria-current={surTableauxDeBord ? 'true' : undefined}
            onSelect={() => onOuvrirVue('en-route')}
            className={cn('h-8 shrink-0', surTableauxDeBord && 'bg-raised text-teinte')}
          >
            <Waypoints className="h-[15px] w-[15px] shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">{libelleTableaux}</span>
            {surTableauxDeBord ? <Check className="h-3.5 w-3.5 shrink-0 text-teinte" /> : null}
          </DropdownMenuItem>
        ) : null}
        {lignes.map(({ projet, parentId, premier, dernier }) => {
          const ouvert = !surTableauxDeBord && projet.id === (projetCourantId ?? state.activeProjectId);
          /* LE NOM DU GROUPE coiffe ses projets, dans la liste complète seulement.
             Un membre suit toujours son projet réuni : jamais de titre entre eux. */
          const groupe = groupeDe(projet);
          const nomDuGroupe =
            groupe && groupe !== groupePrecedent ? state.groups.find((g) => g.id === groupe)?.name : undefined;
          groupePrecedent = groupe;
          return (
            <React.Fragment key={projet.id}>
              {nomDuGroupe ? (
                <p data-groupe-du-menu={groupe} className="px-2 pb-1 pt-2.5 text-[11.5px] text-faint">
                  {nomDuGroupe}
                </p>
              ) : null}
              <DropdownMenuItem
                data-ligne-tiroir-projets={projet.id}
                data-membre-de={parentId}
                aria-current={ouvert ? 'true' : undefined}
                onSelect={() => choisir(projet.id)}
                /* Hauteur FIXE : la branche d'un membre se cale dessus. */
                className={cn('relative h-8 shrink-0', ouvert && 'bg-raised text-teinte', parentId && RETRAIT_MEMBRE_DE_MENU)}
              >
                {parentId ? (
                  <BrancheDeListe
                    premier={premier}
                    dernier={dernier}
                    largeurParent={largeurIconeDeProjet(
                      state.projects.find((p) => p.id === parentId),
                      state.projects,
                    )}
                    geometrie={LISTE_DE_MENU}
                  />
                ) : null}
                {/* Un projet réuni montre la pile des icônes de ses membres, comme la colonne. */}
                <IconeDeProjet projet={projet} projets={state.projects} fond="hsl(var(--surface))" />
                <span className="min-w-0 flex-1 truncate">{projet.name}</span>
                {/* À DROITE : ce qui travaille et ce qui attend sur ce projet,
                    puis la coche du projet courant, toujours en dernier. */}
                <IndicateursDeProjet projectId={projet.id} />
                {ouvert ? <Check className="h-3.5 w-3.5 shrink-0 text-teinte" /> : null}
              </DropdownMenuItem>
            </React.Fragment>
          );
        })}
        {!tableauxVisibles && !lignes.length ? (
          <p data-tiroir-projets-vide className="px-2 py-1.5 text-[12.5px] text-faint">
            {t('Aucun projet ne correspond à cette recherche.')}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
