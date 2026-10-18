import * as React from 'react';
import { Check, ChevronRight, KanbanSquare, Pin, PinOff, Search } from 'lucide-react';
import {
  CLE_EPINGLES_DE_PROJETS,
  CLE_OUVERTURES_DE_PROJETS,
  basculerEpingle,
  epinglesValides,
  filtrerProjetsParNom,
  ouverturesValides,
  projetsEnArbre,
  projetsParDerniereOuverture,
  projetsRecents,
} from '@beluga/shared';
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
import { usePref } from '@/lib/prefs';
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
 * (demande du 12/10/2026) : tous les projets de tous les groupes, sous le nom
 * de leur groupe, et un champ de recherche fixe. À l'ouverture, la liste se
 * centre sur le projet courant. Les membres d'un projet réuni sont en retrait,
 * reliés à lui par une branche (`projetsEnArbre`, posé APRÈS la recherche).
 *
 * CE QUE LA DEMANDE DU 15/10/2026 Y A CHANGÉ :
 *  - EN TÊTE, « Plan de travail » remplace « Tableaux de bord » : il ouvre
 *    directement le tableau de cartes du projet qu'on regarde — ou, depuis la
 *    page des tableaux de bord, du dernier projet utilisé. Les tableaux de bord
 *    restent atteignables par le premier cran du fil d'Ariane.
 *  - JUSTE DESSOUS, « Récents » : les projets ÉPINGLÉS, puis les cinq derniers
 *    projets ouverts (`projetsRecents`). Ils restent AUSSI dans leur groupe ;
 *    leurs lignes portent `data-ligne-recent`, jamais un second
 *    `data-ligne-tiroir-projets` (les contrôles et le centrage lisent ce
 *    repère). Masquée pendant une recherche.
 *  - LA LISTE SUIT LA DERNIÈRE OUVERTURE (`projetsParDerniereOuverture`) :
 *    groupes et projets, du plus récent au plus ancien. La colonne de gauche,
 *    elle, garde son ordre manuel (sauf bascule de tri, `sidebar.tsx`).
 *  - CHAQUE GROUPE SE REPLIE d'un clic sur son nom : le MÊME réglage que la
 *    colonne de gauche (`sidebar.collapsed`). Une recherche l'ignore.
 *  - UNE ÉPINGLE sur chaque ligne (au survol, toujours visible au toucher) :
 *    elle épingle ou désépingle sans ouvrir le projet ni fermer la liste.
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
  /** La page « Tableaux de bord » est à l'écran : aucun projet n'y est marqué courant. */
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
  /* LES PRÉFÉRENCES vivent en base, comme le reste : le repli est celui de la
     colonne de gauche, la dernière ouverture est écrite par `setActiveProject`. */
  const [replies, setReplies] = usePref<string[]>('sidebar.collapsed', []);
  const [epinglesBrutes, setEpingles] = usePref<string[]>(CLE_EPINGLES_DE_PROJETS, []);
  const ouvertLe = React.useMemo(
    () => ouverturesValides(state.prefs[CLE_OUVERTURES_DE_PROJETS]),
    [state.prefs[CLE_OUVERTURES_DE_PROJETS]],
  );
  const epingles = React.useMemo(() => epinglesValides(epinglesBrutes), [epinglesBrutes]);

  const liste = React.useMemo(
    () => projetsParDerniereOuverture(state.projects, state.groups, ouvertLe),
    [state.projects, state.groups, ouvertLe],
  );
  const recherche = filtre.trim() !== '';
  const projets = React.useMemo(() => filtrerProjetsParNom(liste, filtre), [liste, filtre]);
  /* UN GROUPE REPLIÉ CACHE SES PROJETS — sauf pendant une recherche, qui parcourt tout. */
  const visibles = React.useMemo(
    () =>
      recherche
        ? projets
        : projets.filter((p) => {
            const groupe = groupeDe(p);
            return !groupe || !replies.includes(groupe);
          }),
    [projets, recherche, replies, groupeDe],
  );
  const lignes = React.useMemo(() => projetsEnArbre(visibles), [visibles]);
  const lignesParId = React.useMemo(() => new Map(lignes.map((ligne) => [ligne.projet.id, ligne])), [lignes]);
  /* Les groupes à intituler : tous ceux qui ont un projet dans la liste filtrée,
     repliés compris — c'est leur intertitre qui les rouvre. */
  const recents = React.useMemo(
    () => (recherche ? [] : projetsRecents(state.projects, ouvertLe, epingles)),
    [state.projects, ouvertLe, epingles, recherche],
  );

  /* « PLAN DE TRAVAIL » : le tableau du projet qu'on regarde, sinon du dernier
     projet utilisé. Sans projet connu, la ligne n'existe pas. */
  const cibleDuPlan = projetCourantId ?? state.activeProjectId ?? undefined;
  const projetDuPlan = state.projects.find((p) => p.id === cibleDuPlan && !p.archived);
  const libellePlan = t('Plan de travail');
  const planVisible = !!projetDuPlan && filtrerProjetsParNom([{ name: libellePlan }], filtre).length > 0;

  const choisir = (projectId: string) => {
    client.setActiveProject(projectId);
    onOuvrirVue('projet');
  };
  const basculerLeGroupe = (groupe: string) =>
    setReplies(replies.includes(groupe) ? replies.filter((g) => g !== groupe) : [...replies, groupe]);

  /** Le projet courant : celui de la tâche ouverte, sinon le projet actif — rien sur les tableaux de bord. */
  const courant = surTableauxDeBord ? undefined : (projetCourantId ?? state.activeProjectId ?? undefined);

  /* L'ÉPINGLE : ni le projet ne s'ouvre, ni la liste ne se ferme, ni le champ
     de recherche ne perd le curseur. Les trois événements d'appui sont retenus
     avant que la ligne qui la porte (un item du menu) ne les voie. */
  const epingle = (id: string, nom: string) => {
    const posee = epingles.includes(id);
    const Icone = posee ? PinOff : Pin;
    const retenir = (event: React.SyntheticEvent) => event.stopPropagation();
    return (
      <button
        type="button"
        tabIndex={-1}
        data-epingler-projet={id}
        aria-pressed={posee}
        aria-label={posee ? `Désépingler ${nom}` : `Épingler ${nom}`}
        title={posee ? t('Désépingler') : t('Épingler')}
        onPointerDown={(event) => {
          retenir(event);
          event.preventDefault();
        }}
        onPointerUp={retenir}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          retenir(event);
          event.preventDefault();
          setEpingles(basculerEpingle(epingles, id));
        }}
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint transition-opacity hover:bg-raised hover:text-text',
          posee ? 'opacity-100 text-teinte' : 'survol:opacity-0 group-hover/ligne:survol:opacity-100',
        )}
      >
        <Icone className="h-3 w-3" />
      </button>
    );
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
                if (projets.length + (planVisible ? 1 : 0) !== 1) return;
                event.preventDefault();
                if (planVisible && projetDuPlan) choisir(projetDuPlan.id);
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
        {planVisible && projetDuPlan ? (
          <DropdownMenuItem
            data-ligne-tiroir-projets="plan-de-travail"
            onSelect={() => choisir(projetDuPlan.id)}
            className="h-8 shrink-0"
          >
            <KanbanSquare className="h-[15px] w-[15px] shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">{libellePlan}</span>
          </DropdownMenuItem>
        ) : null}
        {recents.length ? (
          <>
            <p data-groupe-du-menu="recents" className="px-2 pb-1 pt-2.5 text-[11.5px] text-faint">
              {t('Récents')}
            </p>
            {recents.map((projet) => (
              <DropdownMenuItem
                key={projet.id}
                data-ligne-recent={projet.id}
                onSelect={() => choisir(projet.id)}
                className={cn(
                  'group/ligne h-8 shrink-0',
                  projet.id === courant && 'bg-raised text-teinte',
                )}
              >
                <IconeDeProjet projet={projet} projets={state.projects} fond="hsl(var(--surface))" />
                <span className="min-w-0 flex-1 truncate">{projet.name}</span>
                {epingle(projet.id, projet.name)}
                {projet.id === courant ? <Check className="h-3.5 w-3.5 shrink-0 text-teinte" /> : null}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        {/* On parcourt TOUS les projets filtrés : l'intertitre d'un groupe replié
            doit rester, c'est lui qui le rouvre — sans lui, un groupe replié
            n'aurait plus aucune ligne où se dérouler. */}
        {projets.map((vu) => {
          const ligneVisible = lignesParId.get(vu.id);
          const projet = ligneVisible?.projet ?? vu;
          const { parentId, premier, dernier } = ligneVisible ?? { parentId: undefined, premier: false, dernier: false };
          const ouvert = projet.id === courant;
          /* LE NOM DU GROUPE coiffe ses projets, dans la liste complète seulement.
             Un membre suit toujours son projet réuni : jamais de titre entre eux. */
          const groupe = groupeDe(projet);
          const nomDuGroupe =
            groupe && groupe !== groupePrecedent ? state.groups.find((g) => g.id === groupe)?.name : undefined;
          groupePrecedent = groupe;
          return (
            <React.Fragment key={projet.id}>
              {nomDuGroupe && groupe ? (
                <GroupeDuMenu
                  id={groupe}
                  nom={nomDuGroupe}
                  replie={!recherche && replies.includes(groupe)}
                  contientLeCourant={!!courant && state.projects.some((p) => p.id === courant && groupeDe(p) === groupe)}
                  onBasculer={() => basculerLeGroupe(groupe)}
                />
              ) : null}
              {ligneVisible ? (
              <DropdownMenuItem
                data-ligne-tiroir-projets={projet.id}
                data-membre-de={parentId}
                aria-current={ouvert ? 'true' : undefined}
                onSelect={() => choisir(projet.id)}
                /* Hauteur FIXE : la branche d'un membre se cale dessus. */
                className={cn(
                  'group/ligne relative h-8 shrink-0',
                  ouvert && 'bg-raised text-teinte',
                  parentId && RETRAIT_MEMBRE_DE_MENU,
                )}
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
                {epingle(projet.id, projet.name)}
                {/* À DROITE : ce qui travaille et ce qui attend sur ce projet,
                    puis la coche du projet courant, toujours en dernier. */}
                <IndicateursDeProjet projectId={projet.id} />
                {ouvert ? <Check className="h-3.5 w-3.5 shrink-0 text-teinte" /> : null}
              </DropdownMenuItem>
              ) : null}
            </React.Fragment>
          );
        })}
        {!planVisible && !recents.length && !lignes.length ? (
          <p data-tiroir-projets-vide className="px-2 py-1.5 text-[12.5px] text-faint">
            {t('Aucun projet ne correspond à cette recherche.')}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * L'INTERTITRE D'UN GROUPE, qui se replie d'un clic : une flèche et le nom, le
 * MÊME réglage que la colonne de gauche. Un bouton ordinaire — pas un item du
 * menu : cliquer ne ferme pas la liste. L'appui ne prend pas le focus, pour que
 * le champ de recherche garde le curseur.
 */
function GroupeDuMenu({
  id,
  nom,
  replie,
  contientLeCourant,
  onBasculer,
}: {
  id: string;
  nom: string;
  replie: boolean;
  contientLeCourant: boolean;
  onBasculer: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      data-groupe-du-menu={id}
      aria-expanded={!replie}
      title={replie ? t('Déplier le groupe') : t('Replier le groupe')}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        onBasculer();
      }}
      className={cn(
        'flex w-full items-center gap-1 rounded-md px-2 pb-1 pt-2.5 text-left text-[11.5px] transition-colors hover:text-text',
        replie && contientLeCourant ? 'text-teinte' : 'text-faint',
      )}
    >
      <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', !replie && 'rotate-90')} />
      <span className="min-w-0 flex-1 truncate">{nom}</span>
    </button>
  );
}
