import * as React from 'react';
import { Archive, ArrowRightLeft, Check, CircleDot, EllipsisVertical, FolderInput, PencilLine, Trash2 } from '@/components/ui/icones';
import {
  COLUMN_KEYS,
  COLUMN_LABELS,
  Card,
  ColumnKey,
  canMove,
  colonneDeReprise,
  gesteDuDepot,
  peutRedevenirNonLue,
} from '@beluga/shared';
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  PromptDialog,
} from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { destinationsDeCarte, verdictDeDepart } from '@/lib/deplacement-de-projet';
import {
  BrancheDeListe,
  IconeDeProjet,
  LISTE_DE_MENU,
  RETRAIT_MEMBRE_DE_MENU,
  largeurIconeDeProjet,
} from '@/components/pastille-projet';
import { cn } from '@/lib/utils';

/**
 * Le menu des gestes rares d'une carte : rouvrir, archiver, supprimer, et le
 * déplacement vers une autre colonne. Les cibles proposées passent par
 * `canMove` ET par `gesteDuDepot` — on ne propose jamais un déplacement qui
 * serait refusé au clic, et un déplacement qui DÉPENSE (lancer la tâche,
 * demander le plan) demande d'abord confirmation, exactement comme le dépôt à
 * la souris sur le tableau.
 *
 * Le même menu sert à deux endroits : le tiroir d'une carte, où il s'ouvre au
 * bouton à trois points, et le tableau, où il s'ouvre à l'appui long. D'où le
 * point d'ancrage escamotable : sur le tableau, la carte n'affiche aucun
 * bouton, elle reste aussi légère qu'avant.
 */
export function MenuCarte({
  card,
  ancrage = 'bouton',
  open,
  onOpenChange,
  apresSuppression,
  agentActif,
  enTete,
  enPied,
  sansNonLu = false,
  declencheur,
}: {
  card: Card;
  /**
   * « MARQUER COMME NON LU » EST DÉJÀ DANS LA COLONNE DE GAUCHE (la page d'une
   * tâche, sur ordinateur) : le menu ne garde alors que les déplacements et la
   * suppression.
   */
  sansNonLu?: boolean;
  /** Des entrées posées EN TÊTE du menu (le groupe « Cet agent » de la page d'une carte). */
  enTete?: React.ReactNode;
  /** Des entrées posées EN PIED du menu (le groupe « Ce projet » de la page d'une carte). */
  enPied?: React.ReactNode;
  /** Le bouton qui ouvre le menu, quand ce n'est pas celui d'origine. */
  declencheur?: React.ReactElement;
  /** « bouton » : les trois points se voient. « invisible » : ouverture au geste. */
  ancrage?: 'bouton' | 'invisible';
  open?: boolean;
  onOpenChange?: (ouvert: boolean) => void;
  /** Appelé une fois la carte réellement supprimée (referme son tiroir). */
  apresSuppression?: () => void;
  /** Un agent travaille-t-il sur cette carte ? Un cran d'avance lui est fermé. */
  agentActif?: boolean;
}) {
  const state = useApp();
  const [confirmSuppression, setConfirmSuppression] = React.useState(false);
  /* RENOMMER, depuis le clic droit de la liste des agents (demande du 30/10/2026). */
  const [renommage, setRenommage] = React.useState(false);
  /* Le déplacement qui engage une dépense : on le NOMME avant de le faire. */
  const [depotAConfirmer, setDepotAConfirmer] = React.useState<{
    colonne: ColumnKey;
    titre: string;
    question: string;
  } | null>(null);

  /* Un seul chemin pour les cibles du menu : ce qui dépense passe par la
     fenêtre, le reste part directement. */
  const deplacerVers = (colonne: ColumnKey) => {
    const geste = gesteDuDepot(card.column, colonne);
    if (geste.depense) {
      setDepotAConfirmer({
        colonne,
        titre: geste.titre ?? t('Confirmer ce geste ?'),
        question: geste.question ?? '',
      });
      return;
    }
    void client.moveCard(card, colonne);
  };
  /*
   * Le menu invisible (celui du tableau) s'ouvre en plein geste : au doigt, le
   * relever compte comme un geste au-dehors ; à la souris, l'enfoncement du
   * bouton DROIT qui l'a ouvert se produit hors de la surcouche et Radix le lit
   * de même. On ignore donc ce qui se passe dehors pendant la demi-seconde qui
   * suit l'ouverture. L'horodatage est posé SYNCHRONEMENT à l'ouverture (via
   * `changerOuverture`), pas dans un effet différé : sinon les événements du
   * même geste passeraient avant que la marque ne soit écrite, et le garde-fou
   * arriverait trop tard.
   */
  const ouvertA = React.useRef(0);
  const changerOuverture = (ouvert: boolean) => {
    if (ouvert) ouvertA.current = Date.now();
    onOpenChange?.(ouvert);
  };

  /*
   * Sortir une carte d'une fin de parcours est un geste HUMAIN, et il n'y en a
   * qu'un : « Archivé » ramène en « Planifié » (la colonne où naît une carte :
   * rien n'y démarre sans un geste, donc personne n'autorise une dépense sans
   * le savoir),
   * « En production » ramène en « À déployer », « À déployer » en « Terminé ».
   * Toujours l'étape juste avant. La règle est partagée avec le bouton du
   * tiroir : `colonneDeReprise`.
   */
  const reprise = colonneDeReprise(card.column);
  /* « MARQUER COMME NON LU » rallume la pastille bleue d'un rendu déjà
     consulté — et seulement là où elle a un sens : la même règle que le démon
     (`peutRedevenirNonLue`), donc jamais un geste refusé au clic. */
  const nonLuPossible = peutRedevenirNonLue({ colonne: card.column, renduA: card.renduA, luA: card.lastReadAt });
  const archivable = card.column !== 'archived' && canMove('user', card.column, 'archived').allowed;
  /* UN GESTE OFFERT DOIT ÊTRE UN GESTE QUI ABOUTIT : la liste lit la MÊME règle
     que le dépôt à la souris (`gesteDuDepot`), et non une liste recopiée. Ce
     que le serveur refuserait — « Travail » → « Rapport » — ne s'affiche pas. */
  const cibles = COLUMN_KEYS.filter(
    (column) =>
      column !== card.column &&
      column !== 'archived' &&
      column !== reprise &&
      canMove('user', card.column, column).allowed &&
      gesteDuDepot(card.column, column).effet !== 'refuser',
  );

  /*
   * CHANGER DE PROJET. L'entrée reste TOUJOURS visible — éteinte avec son motif
   * quand le départ est impossible : une carte qui a déjà travaillé emporterait
   * sinon sa branche et sa copie de travail loin de leur dépôt. La liste et le
   * verdict viennent du même endroit que le dépôt à la souris
   * (`@/lib/deplacement-de-projet`), qui lit lui-même la règle du serveur.
   */
  const departPossible = verdictDeDepart(state, card, { agentActif });
  const destinations = React.useMemo(
    () => (departPossible.possible ? destinationsDeCarte(state, card, { agentActif }) : []),
    [state.projects, state.groups, state.agents, card, agentActif, departPossible.possible],
  );
  const changerDeProjet = async (projetId: string, nomDuProjet: string) => {
    try {
      await client.call({ type: 'card.deplacerVersProjet', id: card.id, projectId: projetId });
      client.pushToast('success', t('« {v0} » est passée dans {v1}.', { v0: card.title, v1: nomDuProjet }));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Déplacement refusé'));
    }
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={changerOuverture}>
        <DropdownMenuTrigger asChild>
          {declencheur ? (
            declencheur
          ) : ancrage === 'bouton' ? (
            <Button size="sm" variant="ghost" className="-mr-1 shrink-0 px-2" aria-label="Autres actions" title={t('Autres actions')}>
              <EllipsisVertical className="h-4 w-4" />
            </Button>
          ) : (
            // Un point d’ancrage sans surface : le menu sort SOUS le coin droit (comme sous les trois points du survol)
            // de la carte, sans rien ajouter à ce qu'on lit.
            <span aria-hidden className="pointer-events-none absolute bottom-0 right-1 block h-0 w-0" />
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          onInteractOutside={(event) => {
            if (ancrage !== 'invisible') return;
            // Le clic droit qui OUVRE ce menu à la souris tombe hors de la
            // surcouche : Radix le lit comme un geste au-dehors et refermerait
            // le menu à peine ouvert. On ignore donc le bouton droit, en plus
            // de la demi-seconde qui suit l'ouverture (le doigt qui se lève).
            const source = (event.detail as { originalEvent?: Event }).originalEvent;
            const boutonDroit =
              (source && 'button' in source && (source as MouseEvent).button === 2) ||
              source?.type === 'contextmenu';
            if (boutonDroit || Date.now() - ouvertA.current < 600) event.preventDefault();
          }}
        >
          {enTete}
          {/*
           * LE MENU D'UNE CARTE, EN TROIS GROUPES (carte « Extension, rapport SEO-GEO et menus », 21/11/2026 : « les
           * menus contextuels […] il faut les revoir pour simplifier ») — le même au clic droit, à l'appui long et aux
           * trois points du survol :
           *   1. la carte elle-même : marquer comme non lu, renommer ;
           *   2. où elle va : son statut, un autre projet (seulement s'il en existe un où elle peut aller — plus
           *      d'entrée éteinte qu'on ne peut pas choisir), les archives ;
           *   3. la détruire : supprimer, seul, en rouge, toujours en dernier après un trait.
           */}
          {nonLuPossible && !sansNonLu ? (
            <DropdownMenuItem
              data-menu-non-lu={card.id}
              onSelect={() => client.send({ type: 'card.unread', cardId: card.id })}
            >
              <CircleDot className="text-termine" />
              {t('Marquer comme non lu')}
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuItem data-menu-renommer={card.id} onSelect={() => setRenommage(true)}>
            <PencilLine className="text-muted" />
            {t('Renommer')}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* LE STATUT EN UNE LIGNE (13/11/2026, maquette #16ff3) : la colonne actuelle, puis toutes les colonnes en
              sous-menu. Une colonne refusée au clic est éteinte avec son motif ; ce qui dépense demande d'abord
              confirmation, comme le dépôt à la souris. Sortir d'« Archivé » ou d'« À déployer » reste un GESTE
              HUMAIN : ce sous-menu en est un. */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-menu-statut={card.column}>
              <ArrowRightLeft className="text-muted" />
              <span className="flex-1">{t('Statut : {v0}', { v0: t(COLUMN_LABELS[card.column]) })}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {COLUMN_KEYS.map((column) => {
                const actuelle = column === card.column;
                const possible =
                  actuelle || column === reprise || (column === 'archived' ? archivable : cibles.includes(column));
                return (
                  <DropdownMenuItem
                    key={column}
                    data-passer-en={actuelle ? undefined : column}
                    data-statut-actuel={actuelle ? '' : undefined}
                    data-sortir-archive={card.column === 'archived' && column === reprise ? card.id : undefined}
                    disabled={!possible}
                    title={possible ? undefined : t('Ce passage n’est pas possible depuis « {v0} ».', { v0: t(COLUMN_LABELS[card.column]) })}
                    className={cn(actuelle && 'text-teinte data-[highlighted]:text-teinte')}
                    onSelect={() => {
                      if (actuelle) return;
                      if (column === 'archived' || column === reprise) void client.moveCard(card, column);
                      else deplacerVers(column);
                    }}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      {actuelle ? <Check className="h-4 w-4" /> : null}
                    </span>
                    {t(COLUMN_LABELS[column])}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* CHANGER DE PROJET n'apparaît que s'il y a un projet où aller : une entrée éteinte qu'on ne peut pas choisir
              encombrait le menu (photo de la revue du 21/11/2026). Le motif reste lisible dans la page de la carte. */}
          {departPossible.possible && destinations.length ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-menu-changer-de-projet="">
                <FolderInput className="text-muted" />
                <span className="flex-1">{t('Déplacer vers un autre projet')}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {destinations.map(({ projet, groupe, verdict, parentId, premier, dernier }) => (
                  <DropdownMenuItem
                    key={projet.id}
                    data-projet-destination={projet.id}
                    data-membre-de={parentId}
                    disabled={!verdict.possible}
                    title={verdict.possible ? undefined : verdict.raison}
                    onSelect={() => {
                      if (verdict.possible) void changerDeProjet(projet.id, projet.name);
                    }}
                    /* Hauteur FIXE : la branche d'un membre se cale dessus. */
                    className={cn('relative h-8 shrink-0', parentId && RETRAIT_MEMBRE_DE_MENU)}
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
                    <IconeDeProjet projet={projet} projets={state.projects} fond="hsl(var(--surface))" />
                    <span className="flex-1 truncate">{projet.name}</span>
                    {groupe ? <span className="shrink-0 text-[11px] text-faint">{groupe.name}</span> : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}

          {archivable ? (
            <DropdownMenuItem data-menu-archiver-carte={card.id} onSelect={() => client.moveCard(card, 'archived')}>
              <Archive className="text-muted" />
              {t('Archiver la carte')}
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator />

          <DropdownMenuItem danger data-menu-supprimer-carte={card.id} onSelect={() => setConfirmSuppression(true)}>
            <Trash2 />
            {t('Supprimer la carte')}
          </DropdownMenuItem>
          {enPied}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={!!depotAConfirmer}
        title={depotAConfirmer ? t(depotAConfirmer.titre) : ''}
        description={depotAConfirmer ? `« ${card.title} » — ${depotAConfirmer.question}` : ''}
        confirmLabel={t('Continuer')}
        onConfirm={async () => {
          if (depotAConfirmer) await client.moveCard(card, depotAConfirmer.colonne);
        }}
        onClose={() => setDepotAConfirmer(null)}
      />

      <PromptDialog
        open={renommage}
        title={t('Renommer l’agent')}
        defaultValue={card.title}
        confirmLabel={t('Renommer')}
        onConfirm={(titre) => {
          const propre = titre.trim();
          if (!propre || propre === card.title) return;
          void client
            .call({ type: 'card.update', id: card.id, patch: { title: propre, titreProvisoire: false } })
            .catch((err: any) => client.pushToast('error', err?.message ?? t('Renommage refusé')));
        }}
        onClose={() => setRenommage(false)}
      />

      <ConfirmDialog
        open={confirmSuppression}
        title={t('Supprimer « {v0} » ?', { v0: card.title })}
        description={t('La carte et sa conversation partent définitivement. Le travail déjà fait dans le projet, lui, reste.')}
        confirmLabel={t('Supprimer la carte')}
        danger
        onConfirm={async () => {
          await client.call({ type: 'card.delete', id: card.id });
          apresSuppression?.();
        }}
        onClose={() => setConfirmSuppression(false)}
      />
    </>
  );
}
