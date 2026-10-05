import * as React from 'react';
import { Archive, ArrowRight, ChevronsRight, CircleDot, EllipsisVertical, FolderInput, RotateCcw, Trash2 } from 'lucide-react';
import {
  COLUMN_KEYS,
  COLUMN_LABELS,
  Card,
  ColumnKey,
  canMove,
  avanceDEtape,
  colonneDeReprise,
  gesteDuDepot,
  libelleDeReprise,
  peutRedevenirNonLue,
} from '@beluga/shared';
import {
  Button,
  ConfirmDialog,
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
import { libelleAvance, useAvancerEtapes } from '@/components/etape-suivante';
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
}: {
  card: Card;
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
  /* LE CRAN D'AVANCE, EN TÊTE DU MENU. C'est le déplacement qui revient le plus
     souvent : le proposer d'abord évite d'aller le chercher dans la liste
     « Déplacer vers », où il se confond avec les retours en arrière. */
  const { avancer, dialogue: dialogueAvance } = useAvancerEtapes();
  const avance = avanceDEtape({ colonne: card.column, agentActif });

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
  // « Archivé » et la colonne de reprise ont déjà leur ligne au-dessus quand
  // elles servent : les répéter dans les destinations n'ajouterait rien.
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
          {ancrage === 'bouton' ? (
            <Button size="sm" variant="ghost" className="-mr-1 shrink-0 px-2" aria-label="Autres actions">
              <EllipsisVertical className="h-4 w-4" />
            </Button>
          ) : (
            // Un point d'ancrage sans surface : le menu sort du coin haut-droit
            // de la carte, sans rien ajouter à ce qu'on lit.
            <span aria-hidden className="pointer-events-none absolute right-1 top-1 block h-0 w-0" />
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
          {avance.possible ? (
            <DropdownMenuItem
              data-menu-etape-suivante=""
              onSelect={() => avancer([{ card, agentActif }])}
            >
              <ChevronsRight className="h-3.5 w-3.5" />
              {libelleAvance(avance)}
            </DropdownMenuItem>
          ) : null}

          {reprise ? (
            <DropdownMenuItem
              data-sortir-archive={card.column === 'archived' ? card.id : undefined}
              onSelect={() => client.moveCard(card, reprise)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {`${libelleDeReprise(card.column)} → ${t(COLUMN_LABELS[reprise])}`}
            </DropdownMenuItem>
          ) : null}

          {nonLuPossible ? (
            <DropdownMenuItem
              data-menu-non-lu={card.id}
              onSelect={() => client.send({ type: 'card.unread', cardId: card.id })}
            >
              <CircleDot className="h-3.5 w-3.5 text-termine" />
              {t('Marquer comme non lu')}
            </DropdownMenuItem>
          ) : null}

          {archivable ? (
            <DropdownMenuItem onSelect={() => client.moveCard(card, 'archived')}>
              <Archive className="h-3.5 w-3.5" />  {t('Archiver la carte')}
</DropdownMenuItem>
          ) : null}

          {departPossible.possible && destinations.length ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-menu-changer-de-projet="">
                <FolderInput className="h-3.5 w-3.5" />
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
          ) : (
            <DropdownMenuItem
              data-menu-changer-de-projet=""
              disabled
              title={departPossible.raison ?? t('Aucun autre projet où déplacer cette carte.')}
            >
              <FolderInput className="h-3.5 w-3.5" />
              <span className="flex-1">{t('Déplacer vers un autre projet')}</span>
            </DropdownMenuItem>
          )}

          <DropdownMenuItem
            className="text-danger data-[highlighted]:text-danger"
            onSelect={() => setConfirmSuppression(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />  {t('Supprimer la carte')}
</DropdownMenuItem>

          {cibles.length ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t('Déplacer vers')}</DropdownMenuLabel>
              {cibles.map((column) => (
                <DropdownMenuItem key={column} onSelect={() => deplacerVers(column)}>
                  <ArrowRight className="h-3.5 w-3.5 text-faint" /> {t(COLUMN_LABELS[column])}
                </DropdownMenuItem>
              ))}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {dialogueAvance}

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
