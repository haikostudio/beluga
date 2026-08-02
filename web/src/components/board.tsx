import * as React from 'react';
import { Plus, Rocket, Clock, AlertTriangle, Bot, CircleDollarSign, GitBranch, Loader2 } from 'lucide-react';
import { COLUMN_KEYS, COLUMN_LABELS, Card, ColumnKey, canMove } from '@haikodev/shared';
import { Badge, Button, Dot, Input, Textarea, Tooltip } from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn, duration, relativeTime } from '@/lib/utils';
import { DeployPanel } from '@/components/deploy-panel';

export function Board({
  projectId,
  onOpenCard,
}: {
  projectId: string;
  onOpenCard: (cardId: string) => void;
}) {
  const state = useApp();
  const [dragging, setDragging] = React.useState<Card | null>(null);
  const [over, setOver] = React.useState<ColumnKey | null>(null);

  const cards = React.useMemo(
    () =>
      Object.values(state.cards)
        .filter((card) => card.projectId === projectId)
        // Un seul ordre de tri : le plus récent en premier (PLAN §16).
        .sort((a, b) => b.position - a.position),
    [state.cards, projectId],
  );

  const byColumn = (column: ColumnKey) => cards.filter((card) => card.column === column);

  const drop = (column: ColumnKey) => {
    setOver(null);
    const card = dragging;
    setDragging(null);
    if (!card || card.column === column) return;
    const decision = canMove('user', card.column, column);
    if (!decision.allowed) {
      client.pushToast('error', decision.reason ?? 'déplacement refusé');
      return;
    }
    void client.moveCard(card, column);
  };

  return (
    <div className="flex h-full min-h-0 gap-2.5 overflow-x-auto px-3 py-3 snap-columns">
      {COLUMN_KEYS.map((column) => {
        const columnCards = byColumn(column);
        const allowed = !dragging || canMove('user', dragging.column, column).allowed;
        return (
          <div
            key={column}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(column);
            }}
            onDragLeave={() => setOver((current) => (current === column ? null : current))}
            onDrop={() => drop(column)}
            className={cn(
              'flex w-[268px] shrink-0 flex-col rounded-lg border bg-surface/70 transition-colors',
              over === column && allowed ? 'border-muted bg-surface' : 'border-border/60',
              dragging && !allowed && 'opacity-40',
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
                  onDragStart={() => setDragging(card)}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
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
  onDragStart,
  onDragEnd,
}: {
  card: Card;
  onOpen: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const state = useApp();
  const agent = card.agentId ? state.agents[card.agentId] : null;
  const running = agent?.status === 'running';
  const waiting = card.scheduling?.waitingReason;
  const estimateFailed = card.estimate?.failed;

  const gap =
    card.estimate?.machineSeconds && card.consumption?.machineSeconds
      ? {
          planned: card.estimate.machineSeconds,
          real: card.consumption.machineSeconds,
        }
      : null;

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className="cursor-pointer rounded-md border border-border bg-raised px-2.5 py-2 transition-colors hover:border-faint"
    >
      <div className="flex items-start gap-1.5">
        {running ? (
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
        <h3 className="min-w-0 flex-1 text-[14px] font-medium leading-snug text-text">{card.title}</h3>
        {card.origin === 'agent' ? (
          <Tooltip label="Créée par le chef d'orchestre">
            <Bot className="mt-0.5 h-3 w-3 shrink-0 text-faint" />
          </Tooltip>
        ) : null}
      </div>

      {card.labels.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {card.labels.slice(0, 3).map((label) => (
            <Badge key={label}>{label}</Badge>
          ))}
        </div>
      ) : null}

      {waiting ? (
        <p className="mt-1.5 flex items-start gap-1 text-[12.5px] leading-snug text-warning">
          <Clock className="mt-[1px] h-2.5 w-2.5 shrink-0" />
          {waiting}
        </p>
      ) : null}

      {estimateFailed ? (
        <p className="mt-1.5 flex items-start gap-1 text-[12.5px] leading-snug text-danger">
          <AlertTriangle className="mt-[1px] h-2.5 w-2.5 shrink-0" />
          {card.estimate?.failureReason ?? 'analyse sans chiffres'}
        </p>
      ) : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
        {card.estimate?.machineSeconds ? (
          <Tooltip label="Durée machine annoncée par l'analyse">
            <span className="inline-flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {duration(card.estimate.machineSeconds)}
            </span>
          </Tooltip>
        ) : null}

        {gap ? (
          <Tooltip label="Annoncé contre réalisé — sans jugement, juste le fait">
            <span className={cn(gap.real > gap.planned * 1.3 ? 'text-warning' : 'text-faint')}>
              réalisé {duration(gap.real)}
            </span>
          </Tooltip>
        ) : null}

        {card.estimate?.seniorHours ? (
          <Tooltip label="Heures qu'un développeur senior facturerait">
            <span className="inline-flex items-center gap-0.5">
              <CircleDollarSign className="h-2.5 w-2.5" />
              {card.estimate.seniorHours} h
            </span>
          </Tooltip>
        ) : null}

        {card.billing ? (
          <Badge tone="success">déjà facturée</Badge>
        ) : null}

        {card.github?.branch ? (
          <Tooltip label={card.github.branch}>
            <span className="inline-flex items-center gap-0.5">
              <GitBranch className="h-2.5 w-2.5" />
              {card.github.prNumber ? `#${card.github.prNumber}` : 'branche'}
            </span>
          </Tooltip>
        ) : null}

        {card.deployedAt ? (
          <Tooltip label={`En ligne depuis le ${new Date(card.deployedAt).toLocaleString('fr-CH')}`}>
            <Badge tone="success">
              <Rocket className="h-2.5 w-2.5" /> en ligne
            </Badge>
          </Tooltip>
        ) : null}

        <span className="ml-auto">{relativeTime(card.updatedAt)}</span>
      </div>
    </article>
  );
}
