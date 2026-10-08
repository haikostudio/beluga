import * as React from 'react';
import { Check, ListChecks, Loader2, X } from 'lucide-react';
import type { TodoItem } from '@beluga/shared';
import { useSeconde } from '@/lib/horloge';
import { t } from '@/lib/langue';
import { cn, duration } from '@/lib/utils';

/**
 * L'AVANCEMENT DE LA CRÉATION — la liste de tâches de l'agent du Studio, posée
 * DANS LE FIL de sa conversation (exception à DEC-058, décidée pour le Studio
 * seul : ailleurs, la liste reste le repère compact collé au champ de saisie).
 *
 * C'est le plan que l'agent s'est donné : d'abord « cerner la demande » (ses
 * questions), puis une ligne par scène, les voix, les sous-titres, la relecture.
 * Les lignes se cochent en direct, au rythme des listes que le moteur renvoie
 * (`message.upsert`) ; le compte « n/N » et la barre disent où en est la vidéo.
 */
export function AvancementDeCreation({ todos, busy }: { todos: TodoItem[]; busy: boolean }) {
  useSeconde(busy && todos.some((todo) => todo.state === 'running'));
  if (!todos.length) return null;
  const faites = todos.filter((todo) => todo.state === 'done').length;
  const fini = faites === todos.length;
  const maintenant = Date.now();
  return (
    <section
      className="rounded-lg bg-bloc px-3 py-2.5"
      data-studio-avancement
      data-faites={faites}
      data-total={todos.length}
      aria-label="Plan de la création"
    >
      <header className="flex items-center gap-2">
        <ListChecks className={cn('h-3.5 w-3.5 shrink-0', fini ? 'text-termine' : 'text-en-cours')} />
        <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text">{t('Plan de la création')}</h3>
        <span className="shrink-0 text-[12px] tabular-nums text-muted">
          {faites}/{todos.length}
        </span>
      </header>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raised" aria-hidden>
        <div className={cn('h-full transition-all duration-500', fini ? 'bg-termine' : 'bg-en-cours')} style={{ width: `${Math.round((faites / todos.length) * 100)}%` }} />
      </div>
      <ol className="mt-2 flex flex-col gap-1">
        {todos.map((todo, i) => (
          <li key={`${i}-${todo.label}`} className="flex items-start gap-2 text-[12.5px]" data-etat={todo.state}>
            <span className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center">
              {todo.state === 'done' ? (
                <Check className="h-3.5 w-3.5 text-termine" />
              ) : todo.state === 'running' ? (
                busy ? (
                  <Loader2 className="h-3 w-3 animate-spin text-en-cours" />
                ) : (
                  <span className="h-2.5 w-2.5 rounded-full bg-en-cours" />
                )
              ) : todo.state === 'unfinished' ? (
                <X className="h-3 w-3 text-faint" />
              ) : (
                <span className="h-2.5 w-2.5 rounded-full border border-faint" />
              )}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 leading-snug',
                todo.state === 'done' ? 'text-muted line-through decoration-faint/60' : todo.state === 'running' ? 'font-medium text-text' : 'text-faint',
              )}
            >
              {todo.label}
            </span>
            {todo.state === 'unfinished' ? (
              <span className="shrink-0 text-[11.5px] text-faint">{t('non faite')}</span>
            ) : todo.startedAt && (todo.state === 'running' || todo.endedAt) ? (
              <span className="shrink-0 text-[11.5px] tabular-nums text-faint">{duration(((todo.endedAt ?? maintenant) - todo.startedAt) / 1000)}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
