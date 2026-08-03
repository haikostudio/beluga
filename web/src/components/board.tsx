import * as React from 'react';
import { Plus, Rocket, Clock, AlertTriangle, Loader2 } from 'lucide-react';
import { COLUMN_KEYS, COLUMN_LABELS, Card, ColumnKey, canMove } from '@haikodev/shared';
import { Badge, Button, Dot, Input, Textarea, Tooltip } from '@/components/ui';
import { client } from '@/lib/client';
import { DragItem, DropTarget, usePointerDrag } from '@/lib/dnd';
import { useApp } from '@/lib/use-app';
import { cn, relativeTime } from '@/lib/utils';
import { DeployPanel } from '@/components/deploy-panel';

export function Board({
  projectId,
  onOpenCard,
}: {
  projectId: string;
  onOpenCard: (cardId: string) => void;
}) {
  const state = useApp();

  const cards = React.useMemo(
    () =>
      Object.values(state.cards)
        .filter((card) => card.projectId === projectId)
        // Un seul ordre de tri : le plus récent en premier (PLAN §16).
        .sort((a, b) => b.position - a.position),
    [state.cards, projectId],
  );

  const byColumn = (column: ColumnKey) => cards.filter((card) => card.column === column);

  // Sur téléphone, une seule colonne tient à l'écran : on commence sur
  // « À faire », sinon on ouvre le tableau sur des notes souvent vides.
  const rail = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (window.innerWidth >= 640) return;
    const cible = rail.current?.querySelector<HTMLElement>('[data-column="todo"]');
    if (cible) rail.current!.scrollLeft = cible.offsetLeft - 12;
  }, [projectId]);

  /*
   * Le déplacement se fait AU POINTEUR, jamais avec le glisser-déposer natif :
   * le natif ignore le doigt. Au doigt, il faut un appui maintenu, sinon on ne
   * pourrait plus faire défiler le tableau en partant d'une carte.
   */
  const resolve = React.useCallback((element: Element): DropTarget | null => {
    const colonne = element.closest('[data-column]')?.getAttribute('data-column');
    return colonne ? { id: colonne, kind: 'column', position: 'inside' } : null;
  }, []);

  const deposer = React.useCallback((item: DragItem, cible: DropTarget | null) => {
    if (!cible) return;
    const card = client.getSnapshot().cards[item.id];
    const column = cible.id as ColumnKey;
    if (!card || card.column === column) return;
    const decision = canMove('user', card.column, column);
    if (!decision.allowed) {
      client.pushToast('error', decision.reason ?? 'déplacement refusé');
      return;
    }
    void client.moveCard(card, column);
  }, []);

  const { dragging, target, pointer, start } = usePointerDrag({ resolve, onDrop: deposer, holdMs: 260 });
  const carteTiree = dragging ? cards.find((card) => card.id === dragging.id) : null;
  const over = (target?.id ?? null) as ColumnKey | null;

  // Le tableau suit : en approchant du bord, les colonnes défilent toutes seules.
  React.useEffect(() => {
    if (!dragging || !pointer) return;
    const zone = 70;
    const timer = window.setInterval(() => {
      const node = rail.current;
      if (!node) return;
      const boite = node.getBoundingClientRect();
      if (pointer.x < boite.left + zone) node.scrollLeft -= 14;
      else if (pointer.x > boite.right - zone) node.scrollLeft += 14;
    }, 16);
    return () => window.clearInterval(timer);
  }, [dragging, pointer]);

  return (
    <div ref={rail} className="flex h-full min-h-0 gap-2.5 overflow-x-auto px-3 py-3 snap-columns">
      {COLUMN_KEYS.map((column) => {
        const columnCards = byColumn(column);
        const allowed = !carteTiree || canMove('user', carteTiree.column, column).allowed;
        return (
          <div
            key={column}
            data-column={column}
            className={cn(
              'flex w-[268px] shrink-0 flex-col rounded-lg border bg-surface/70 transition-colors',
              over === column && allowed ? 'border-muted bg-surface' : 'border-border/60',
              carteTiree && !allowed && 'opacity-40',
            )}
          >
            <div className="relative flex items-center gap-1.5 border-b border-border/50 px-2 py-1.5">
              <h2 className="text-[13px] font-medium uppercase tracking-wide text-faint">{COLUMN_LABELS[column]}</h2>
              <span className="text-[12.5px] text-faint">{columnCards.length}</span>
              {column === 'todo' || column === 'notes' ? (
                <ComposerInline projectId={projectId} column={column} />
              ) : null}
            </div>

            {column === 'to_deploy' ? <DeployPanel projectId={projectId} cards={columnCards} /> : null}

            <div className="flex-1 space-y-1.5 overflow-y-auto p-1.5">
              {columnCards.map((card) => (
                <CardTile
                  key={card.id}
                  card={card}
                  onOpen={() => onOpenCard(card.id)}
                  onPointerDown={(event) => start(event, { id: card.id, kind: 'card', label: card.title })}
                  dimmed={dragging?.id === card.id}
                />
              ))}
              {!columnCards.length ? (
                <p className="px-1.5 py-3 text-[13px] text-faint">
                  {column === 'notes'
                    ? 'Idées en vrac.'
                    : column === 'todo'
                      ? 'Rien à faire pour l’instant.'
                      : column === 'validated'
                        ? 'Glissez ici pour autoriser la dépense.'
                        : '—'}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}

      {/*
        L'aperçu suit le doigt. Il garde EXACTEMENT la largeur d'une carte dans
        sa colonne : au doigt, un aperçu qui rétrécit donne l'impression que la
        carte a changé de taille en route.
      */}
      {dragging && pointer ? (
        <div
          className="pointer-events-none fixed z-50 w-[254px] rounded-md border border-muted bg-raised px-2.5 py-2 text-[14px] font-medium leading-snug text-text shadow-2xl"
          style={{ left: pointer.x + 12, top: pointer.y - 18 }}
        >
          {dragging.label}
        </div>
      ) : null}
    </div>
  );
}

function ComposerInline({ projectId, column }: { projectId: string; column: ColumnKey }) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const data = await client.call<{ card: Card }>({
        type: 'card.create',
        projectId,
        title: title.trim(),
        description: description.trim() || undefined,
      });
      // Une carte naît toujours dans « À faire » : pour une note, on la déplace
      // ensuite — c'est le seul chemin autorisé par le serveur.
      if (column === 'notes' && data?.card) {
        await client.call({ type: 'card.move', id: data.card.id, column: 'notes' });
      }
      setTitle('');
      setDescription('');
      setOpen(false);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'création impossible');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Tooltip label={column === 'notes' ? 'Nouvelle note' : 'Nouvelle tâche'}>
        <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => setOpen(true)}>
          <Plus className="h-3 w-3" />
        </Button>
      </Tooltip>
    );
  }

  return (
    <div className="absolute left-0 right-0 top-0 z-20 rounded-md border border-border bg-raised p-2 shadow-xl">
      <Input
        autoFocus
        value={title}
        placeholder={column === 'notes' ? 'Titre de la note…' : 'Titre de la tâche…'}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void create();
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      <Textarea
        value={description}
        placeholder="Description (facultative)…"
        rows={3}
        className="mt-1.5"
        onChange={(event) => setDescription(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void create();
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button variant="default" size="sm" disabled={!title.trim() || busy} onClick={create}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {column === 'notes' ? 'Ajouter la note' : 'Ajouter la tâche'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

export function CardTile({
  card,
  onOpen,
  onPointerDown,
  dimmed,
}: {
  card: Card;
  onOpen: () => void;
  onPointerDown?: (event: React.PointerEvent) => void;
  dimmed?: boolean;
}) {
  const state = useApp();
  const agent = card.agentId ? state.agents[card.agentId] : null;
  const running = agent?.status === 'running';
  const waiting = card.scheduling?.waitingReason;
  const estimateFailed = card.estimate?.failed;
  // Entre la validation et le chiffrage, la carte doit montrer qu'il se passe
  // quelque chose — sinon on croit que rien ne démarre.
  const analysing = card.column === 'validated' && !card.estimate;
  const analyseEnCours = Object.values(state.agents).some(
    (a) => a.cardId === card.id && a.role === 'analysis' && a.status === 'running',
  );

  /*
   * L'état en cours ne s'affiche PAS dans le corps de la carte : il sort par le
   * bas, comme une étiquette glissée derrière, sur un fond un peu plus clair.
   */
  const statut =
    analysing || analyseEnCours
      ? // Le sujet suffit : la roue qui tourne dit déjà que c'est en cours.
        { icon: <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" />, texte: 'Chiffrage du travail…', ton: 'text-muted' }
      : waiting
        ? { icon: <Clock className="h-2.5 w-2.5 shrink-0" />, texte: waiting, ton: 'text-warning' }
        : estimateFailed
          ? {
              icon: <AlertTriangle className="h-2.5 w-2.5 shrink-0" />,
              texte: card.estimate?.failureReason ?? 'analyse sans chiffres',
              ton: 'text-danger',
            }
          : null;

  return (
    <div className={cn('relative', dimmed && 'opacity-40')}>
      <article
        onPointerDown={onPointerDown}
        onClick={onOpen}
        className={cn(
          'relative z-10 cursor-pointer touch-manipulation select-none rounded-md border border-border bg-raised px-2.5 py-2 transition-colors hover:border-faint',
          statut && 'rounded-b-none',
        )}
      >
        {/*
         * Le badge « en ligne » est le premier repère à voir : il prend sa
         * propre ligne AU-DESSUS du titre, au lieu de se perdre au milieu des
         * repères techniques du pied.
         */}
        {card.deployedAt ? (
          <div className="mb-1 flex">
            <Tooltip label={`En ligne depuis le ${new Date(card.deployedAt).toLocaleString('fr-CH')}`}>
              <Badge tone="success">
                <Rocket className="h-2.5 w-2.5" /> en ligne
              </Badge>
            </Tooltip>
          </div>
        ) : null}

        <div className="flex items-start gap-1.5">
          <h3 className="min-w-0 flex-1 text-[14px] font-medium leading-snug text-text">{card.title}</h3>
          {/* Le voyant est à DROITE, au bout de la ligne du titre. */}
          {running || analysing || analyseEnCours ? (
            <Loader2 className="mt-[3px] h-3 w-3 shrink-0 animate-spin text-success" />
          ) : (
            <Dot
              tone={
                agent?.status === 'failed'
                  ? 'failed'
                  : waiting
                    ? 'waiting'
                    : card.deployedAt
                      ? 'done'
                      : 'idle'
              }
            />
          )}
        </div>

        {card.labels.length || card.billing ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {card.labels.slice(0, 3).map((label) => (
              <Badge key={label}>{label}</Badge>
            ))}
            {card.billing ? <Badge tone="success">déjà facturée</Badge> : null}
          </div>
        ) : null}

        {/*
         * Le pied ne porte plus que l'ancienneté. Les repères techniques
         * (durée prévue, durée réalisée, heures facturables, branche) n'aident
         * pas à décider d'un coup d'œil : ils vivent dans le tiroir de la
         * carte, onglets Détails et GitHub.
         */}
        <div className="mt-1.5 text-[12px] text-faint">{relativeTime(card.updatedAt)}</div>
      </article>

      {statut ? (
        <div
          onClick={onOpen}
          className={cn(
            // Toute la largeur de la carte, sur UNE ligne, sans marge latérale.
            // Le petit espace en haut laisse voir l'ombre portée, qui donne
            // l'impression que la carte recouvre la bande.
            'relative -mt-1 cursor-pointer overflow-hidden rounded-b-md bg-border/30 px-2.5 pb-1.5 pt-2 text-[12.5px] leading-none',
            'shadow-[inset_0_7px_6px_-6px_rgba(0,0,0,0.75)]',
            statut.ton,
          )}
        >
          <span className="flex items-center gap-1">
            {statut.icon}
            <span className="min-w-0 flex-1 truncate">{statut.texte}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
