import * as React from 'react';
import { Archive, ArrowRight, MoreVertical, RotateCcw, Trash2 } from 'lucide-react';
import { COLUMN_KEYS, COLUMN_LABELS, Card, canMove, colonneDeReprise } from '@haikodev/shared';
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
   * Le menu de l'appui long s'ouvre alors que le doigt est ENCORE POSÉ : le
   * relever compte comme un geste au-dehors et le refermerait aussitôt. On
   * ignore donc ce qui se passe dehors pendant la demi-seconde qui suit
   * l'ouverture — le temps que le doigt se lève.
   */
  const ouvertA = React.useRef(0);
  React.useEffect(() => {
    if (open) ouvertA.current = Date.now();
  }, [open]);

  /*
   * Sortir une carte d'une fin de parcours est un geste HUMAIN, et il n'y en a
   * qu'un : « Archivé » ramène en « À faire » (elle repassera par la
   * validation, donc personne n'autorise une dépense sans le savoir),
   * « À déployer » ramène en « Terminé ». La règle est partagée avec le bouton
   * du tiroir : `colonneDeReprise`.
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
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
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
            if (ancrage === 'invisible' && Date.now() - ouvertA.current < 600) event.preventDefault();
          }}
        >
          {reprise ? (
            <DropdownMenuItem onSelect={() => client.moveCard(card, reprise)}>
              <RotateCcw className="h-3.5 w-3.5" />
              {card.column === 'archived'
                ? `Sortir de l’archive → ${COLUMN_LABELS[reprise]}`
                : `Retirer du lot à publier → ${COLUMN_LABELS[reprise]}`}
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
