import * as React from 'react';
import { Archive, ArrowRight, MoreVertical, RotateCcw, Trash2 } from 'lucide-react';
import { COLUMN_KEYS, COLUMN_LABELS, Card, canMove, colonneDeReprise, libelleDeReprise } from '@haikodev/shared';
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui';
import { client } from '@/lib/client';

/**
 * Le menu des gestes rares d'une carte : rouvrir, archiver, supprimer, et le
 * déplacement vers une autre colonne. Les cibles proposées passent par
 * `canMove` — on ne propose jamais un déplacement qui serait refusé au clic.
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
}: {
  card: Card;
  /** « bouton » : les trois points se voient. « invisible » : ouverture au geste. */
  ancrage?: 'bouton' | 'invisible';
  open?: boolean;
  onOpenChange?: (ouvert: boolean) => void;
  /** Appelé une fois la carte réellement supprimée (referme son tiroir). */
  apresSuppression?: () => void;
}) {
  const [confirmSuppression, setConfirmSuppression] = React.useState(false);

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
   * qu'un : « Archivé » ramène en « À faire » (elle repassera par la
   * validation, donc personne n'autorise une dépense sans le savoir),
   * « En production » ramène en « À déployer », « À déployer » en « Terminé ».
   * Toujours l'étape juste avant. La règle est partagée avec le bouton du
   * tiroir : `colonneDeReprise`.
   */
  const reprise = colonneDeReprise(card.column);
  const archivable = card.column !== 'archived' && canMove('user', card.column, 'archived').allowed;
  // « Archivé » et la colonne de reprise ont déjà leur ligne au-dessus quand
  // elles servent : les répéter dans les destinations n'ajouterait rien.
  const cibles = COLUMN_KEYS.filter(
    (column) =>
      column !== card.column &&
      column !== 'archived' &&
      column !== reprise &&
      canMove('user', card.column, column).allowed,
  );

  return (
    <>
      <DropdownMenu open={open} onOpenChange={changerOuverture}>
        <DropdownMenuTrigger asChild>
          {ancrage === 'bouton' ? (
            <Button size="sm" variant="ghost" className="-mr-1 shrink-0 px-2" aria-label="Autres actions">
              <MoreVertical className="h-4 w-4" />
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
          {reprise ? (
            <DropdownMenuItem onSelect={() => client.moveCard(card, reprise)}>
              <RotateCcw className="h-3.5 w-3.5" />
              {`${libelleDeReprise(card.column)} → ${COLUMN_LABELS[reprise]}`}
            </DropdownMenuItem>
          ) : null}

          {archivable ? (
            <DropdownMenuItem onSelect={() => client.moveCard(card, 'archived')}>
              <Archive className="h-3.5 w-3.5" /> Archiver la carte
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuItem
            className="text-danger data-[highlighted]:text-danger"
            onSelect={() => setConfirmSuppression(true)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Supprimer la carte
          </DropdownMenuItem>

          {cibles.length ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Déplacer vers</DropdownMenuLabel>
              {cibles.map((column) => (
                <DropdownMenuItem key={column} onSelect={() => client.moveCard(card, column)}>
                  <ArrowRight className="h-3.5 w-3.5 text-faint" /> {COLUMN_LABELS[column]}
                </DropdownMenuItem>
              ))}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmSuppression}
        title={`Supprimer « ${card.title} » ?`}
        description="La carte et sa conversation partent définitivement. Le travail déjà fait dans le projet, lui, reste."
        confirmLabel="Supprimer la carte"
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
