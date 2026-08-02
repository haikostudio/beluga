import * as React from 'react';
import { Check, ChevronRight, Circle, Loader2, X, MinusCircle } from 'lucide-react';
import { RunStep } from '@haikodev/shared';
import { cn, duration } from '@/lib/utils';

/**
 * La liste d'exécution en direct (PLAN §26). Même affichage quel que soit le
 * moteur : le serveur traduit tout dans un format unique.
 * Quand l'agent a fini, elle se replie en une ligne de bilan.
 */
export function Steps({ steps, streaming }: { steps: RunStep[]; streaming: boolean }) {
  const [open, setOpen] = React.useState(streaming);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    // Pendant le travail on déroule, à la fin on replie — sans écraser un
    // choix explicite de l'utilisateur pendant qu'il regarde.
    setOpen(streaming);
  }, [streaming]);

  if (!steps.length) return null;

  const done = steps.filter((s) => s.state === 'done').length;
  const failed = steps.filter((s) => s.state === 'failed').length;
  const skipped = steps.filter((s) => s.state === 'skipped').length;
  const running = steps.find((s) => s.state === 'running');

  const summary = streaming
    ? (running?.label ?? 'préparation…')
    : `${done} étape${done > 1 ? 's' : ''} terminée${done > 1 ? 's' : ''}${failed ? `, ${failed} en échec` : ''}${
        skipped ? `, ${skipped} ignorée${skipped > 1 ? 's' : ''}` : ''
      }`;

  return (
    <div className="mb-2 overflow-hidden rounded-md border border-border bg-surface/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        {streaming ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted" />
        ) : failed ? (
          <X className="h-3 w-3 shrink-0 text-danger" />
        ) : (
          <Check className="h-3 w-3 shrink-0 text-success" />
        )}
        <span className="flex-1 truncate text-[13.5px] text-muted">{summary}</span>
        <ChevronRight className={cn('h-3 w-3 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
      </button>

      {open ? (
        <ul className="space-y-0.5 border-t border-border px-2 py-1.5">
          {steps.map((step) => {
            const isOpen = expanded.has(step.id);
            return (
              <li key={step.id}>
                <button
                  type="button"
                  disabled={!step.detail}
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      next.has(step.id) ? next.delete(step.id) : next.add(step.id);
                      return next;
                    })
                  }
                  className={cn(
                    'flex w-full items-start gap-2 rounded px-1 py-1 text-left',
                    step.detail && 'hover:bg-raised',
                  )}
                >
                  <span className="mt-[3px] shrink-0">
                    {step.state === 'running' ? (
                      <Loader2 className="h-3 w-3 animate-spin text-muted" />
                    ) : step.state === 'done' ? (
                      <Check className="h-3 w-3 text-success" />
                    ) : step.state === 'failed' ? (
                      <X className="h-3 w-3 text-danger" />
                    ) : step.state === 'skipped' ? (
                      <MinusCircle className="h-3 w-3 text-faint" />
                    ) : (
                      <Circle className="h-3 w-3 text-faint" />
                    )}
                  </span>
                  <span
                    className={cn(
                      'flex-1 text-[13.5px] leading-snug',
                      step.state === 'done' ? 'text-muted' : step.state === 'failed' ? 'text-danger' : 'text-text',
                    )}
                  >
                    {step.label}
                  </span>
                  {step.startedAt && step.endedAt ? (
                    <span className="mt-0.5 shrink-0 text-[12px] text-faint">
                      {duration((step.endedAt - step.startedAt) / 1000)}
                    </span>
                  ) : null}
                </button>
                {isOpen && step.detail ? (
                  <pre className="mx-1 mb-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-raised p-2 text-[12.5px] leading-relaxed text-muted">
                    {step.detail}
                  </pre>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
