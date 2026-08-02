import * as React from 'react';
import { BookOpen, Check, ChevronRight, Circle, CircleDot, Loader2 } from 'lucide-react';
import { RunStep, TodoItem } from '@haikodev/shared';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/**
 * Le premier repère de chaque réponse (PLAN §26) : l'agent a relu la mémoire du
 * projet AVANT de répondre. Un clic déplie ce qu'il avait sous les yeux — le
 * texte vient du projet, il n'est pas recopié sous chaque message.
 */
export function MemoryNote({ step, projectId }: { step: RunStep; projectId?: string }) {
  const [open, setOpen] = React.useState(false);
  const state = useApp();
  const texte = projectId ? state.memory[projectId] : undefined;
  const vide = step.state === 'skipped';

  React.useEffect(() => {
    if (open && projectId && texte === undefined) client.send({ type: 'memory.get', projectId });
  }, [open, projectId, texte]);

  const ouvrable = !vide && !!projectId;

  return (
    <div className="mb-2 overflow-hidden rounded-md border border-border bg-surface/60">
      <button
        type="button"
        disabled={!ouvrable}
        onClick={() => setOpen((value) => !value)}
        className={cn('flex w-full items-center gap-2 px-2.5 py-1.5 text-left', ouvrable && 'hover:bg-raised')}
      >
        <BookOpen className={cn('h-3 w-3 shrink-0', vide ? 'text-faint' : 'text-accent')} />
        <span className="flex-1 truncate text-[13.5px] text-muted">{step.label}</span>
        {ouvrable ? (
          <ChevronRight className={cn('h-3 w-3 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
        ) : null}
      </button>
      {open ? (
        <div className="mx-2 mb-2">
          <p className="px-1 pb-1 text-[12px] text-faint">La mémoire du projet, telle qu'elle est aujourd'hui :</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-raised p-2 text-[12.5px] leading-relaxed text-muted">
            {texte ?? 'Lecture…'}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/**
 * La liste de tâches annoncée par l'agent, cochée en direct. Elle dit ce qu'il
 * VA faire ; les étapes, elles, racontent ce qu'il a fait. Les deux se lisent
 * l'une sous l'autre, dans cet ordre.
 */
export function TodoList({ todos, streaming }: { todos?: TodoItem[]; streaming: boolean }) {
  const [open, setOpen] = React.useState(true);
  // Un message enregistré avant cette version n'a pas de liste : rien à montrer.
  if (!todos?.length) return null;

  const faites = todos.filter((t) => t.state === 'done').length;
  const encours = todos.find((t) => t.state === 'running');
  const tout = faites === todos.length;

  return (
    <div className="mb-2 overflow-hidden rounded-md border border-border bg-surface/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-raised"
      >
        {tout ? (
          <Check className="h-3 w-3 shrink-0 text-success" />
        ) : streaming ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted" />
        ) : (
          <CircleDot className="h-3 w-3 shrink-0 text-faint" />
        )}
        <span className="flex-1 truncate text-[13.5px] text-muted">
          Liste des tâches — {faites}/{todos.length} faite{faites > 1 ? 's' : ''}
          {encours && streaming ? ` · ${encours.label}` : ''}
        </span>
        <ChevronRight className={cn('h-3 w-3 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
      </button>

      {open ? (
        <ul className="space-y-0.5 border-t border-border px-2 py-1.5">
          {todos.map((todo, index) => (
            <li key={`${index}-${todo.label}`} className="flex items-start gap-2 px-1 py-1">
              <span className="mt-[3px] shrink-0">
                {todo.state === 'done' ? (
                  <Check className="h-3 w-3 text-success" />
                ) : todo.state === 'running' ? (
                  streaming ? (
                    <Loader2 className="h-3 w-3 animate-spin text-accent" />
                  ) : (
                    <CircleDot className="h-3 w-3 text-accent" />
                  )
                ) : (
                  <Circle className="h-3 w-3 text-faint" />
                )}
              </span>
              <span
                className={cn(
                  'flex-1 text-[13.5px] leading-snug',
                  todo.state === 'done'
                    ? 'text-faint line-through'
                    : todo.state === 'running'
                      ? 'font-medium text-text'
                      : 'text-muted',
                )}
              >
                {todo.label}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
