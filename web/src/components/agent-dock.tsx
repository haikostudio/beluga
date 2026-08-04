import * as React from 'react';
import { AlertCircle, Bot, Check, ChevronUp, GripVertical, Info, TriangleAlert, X } from 'lucide-react';
import {
  PILE_DUREE,
  hauteurDeLaPile,
  heureEtDate,
  placeDansLaPile,
  resteDeLaPile,
} from '@haikodev/shared';
import { Badge, Button, Dot } from '@/components/ui';
import { usePref } from '@/lib/prefs';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn, elapsed } from '@/lib/utils';

/**
 * La pile de vignettes en bas à droite (PLAN §28) et, au même endroit, les
 * messages courts. Ils n'interrompent jamais ce que vous êtes en train de faire ;
 * les erreurs, elles, attendent d'être lues.
 */
export function AgentDock({ onOpenAgent }: { onOpenAgent: (agentId: string) => void }) {
  const state = useApp();
  const [collapsed, setCollapsed] = React.useState(false);
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
  const [, force] = React.useReducer((value: number) => value + 1, 0);
  // La pile est déplaçable si elle gêne, et sa position est mémorisée (§28).
  const [stored, storeOffset] = usePref<{ x: number; y: number }>('dock', { x: 0, y: 0 });
  const [live, setLive] = React.useState<{ x: number; y: number } | null>(null);
  const offset = live ?? stored;
  const setOffset = (value: { x: number; y: number } | ((c: { x: number; y: number }) => { x: number; y: number })) =>
    setLive((current) => (typeof value === 'function' ? value(current ?? offset) : value));
  const dragRef = React.useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  // « Tout effacer » reste annulable quelques secondes.
  const [undo, setUndo] = React.useState<Set<string> | null>(null);
  // Les messages s'empilent, le plus récent devant ; la pile s'ouvre au survol.
  const [pileOuverte, setPileOuverte] = React.useState(false);
  const [hauteurs, setHauteurs] = React.useState<Record<string, number>>({});
  // Le plus récent en tête : c'est lui qui se pose devant.
  const messages = React.useMemo(() => [...state.toasts].reverse(), [state.toasts]);
  const mesures = messages.map((message) => hauteurs[message.id] ?? 0);
  // La géométrie de la pile a besoin de la hauteur RÉELLE de chaque message :
  // un compte rendu de lot tient sur cinq lignes, une erreur sur une seule.
  const mesurer = (id: string) => (element: HTMLDivElement | null) => {
    if (!element) return;
    const hauteur = element.offsetHeight;
    setHauteurs((current) => (current[id] === hauteur ? current : { ...current, [id]: hauteur }));
  };

  React.useEffect(() => {
    const timer = setInterval(force, 5000);
    return () => clearInterval(timer);
  }, []);

  React.useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setOffset({
        x: Math.min(0, drag.baseX + (event.clientX - drag.startX)),
        y: Math.min(0, drag.baseY + (event.clientY - drag.startY)),
      });
    };
    const up = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setLive((current) => {
        if (current) storeOffset(current);
        return current;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  const clearAll = (ids: string[]) => {
    const previous = new Set(dismissed);
    setDismissed(new Set([...dismissed, ...ids]));
    setUndo(previous);
    window.setTimeout(() => setUndo(null), 6000);
  };

  const agents = Object.values(state.agents)
    .filter((agent) => {
      if (dismissed.has(agent.id)) return false;
      if (agent.status === 'running') return true;
      // Un agent qui finit reste un instant avec sa mention « terminé ».
      return !!agent.endedAt && Date.now() - agent.endedAt < 60000 && agent.role !== 'analysis';
    })
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

  return (
    <div
      className="pointer-events-none fixed bottom-2 right-2 z-40 flex w-[248px] flex-col items-end gap-1.5 sm:bottom-3 sm:right-3"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      {/* Messages courts, empilés en profondeur : le plus récent devant, les
          autres qui dépassent de quelques pixels. Au survol, la pile s'ouvre. */}
      {messages.length ? (
        <div className="pointer-events-auto w-full" data-pile="messages">
          <div
            className="relative w-full transition-[height] ease-out"
            style={{ height: hauteurDeLaPile(mesures, pileOuverte) || undefined, transitionDuration: `${PILE_DUREE}ms` }}
            onMouseEnter={() => setPileOuverte(true)}
            onMouseLeave={() => setPileOuverte(false)}
            // Sans survol — au doigt — un appui ouvre et referme la pile.
            onClick={() => setPileOuverte((ouverte) => !ouverte)}
          >
            {messages.map((toast, index) => {
              const place = placeDansLaPile(index, mesures, pileOuverte);
              return (
                <div
                  key={toast.id}
                  ref={mesurer(toast.id)}
                  data-message-pile={index}
                  style={{
                    transform: `translateY(${place.decalage}px) scale(${place.echelle})`,
                    // Les bas alignés : c'est le liseré du dessous qu'on montre.
                    transformOrigin: 'bottom center',
                    opacity: place.opacite,
                    zIndex: place.profondeur,
                    pointerEvents: place.visible ? undefined : 'none',
                    transitionDuration: `${PILE_DUREE}ms`,
                  }}
                  className={cn(
                    'absolute inset-x-0 top-0 flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-[13.5px] shadow-lg',
                    'animate-fade-in transition-[transform,opacity] ease-out',
                    toast.level === 'error'
                      ? 'border-danger/40 bg-surface text-danger'
                      : toast.level === 'warning'
                        ? 'border-warning/40 bg-surface text-warning'
                        : toast.level === 'success'
                          ? 'border-success/40 bg-surface text-success'
                          : 'border-border bg-surface text-muted',
                  )}
                >
                  <span className="mt-0.5 shrink-0">
                    {toast.level === 'error' ? (
                      <AlertCircle className="h-3 w-3" />
                    ) : toast.level === 'warning' ? (
                      <TriangleAlert className="h-3 w-3" />
                    ) : toast.level === 'success' ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Info className="h-3 w-3" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    {/* Un compte rendu de lot nomme ses cartes ligne à ligne :
                        les retours à la ligne doivent tenir. */}
                    <span className="block whitespace-pre-line leading-snug">{toast.text}</span>
                    <span className="mt-0.5 block text-[11.5px] text-faint" data-heure-message>
                      {heureEtDate(toast.at)}
                    </span>
                  </span>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      client.dismissToast(toast.id);
                    }}
                    className="shrink-0 opacity-60 hover:opacity-100"
                    title="Retirer ce message"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              );
            })}
          </div>
          {!pileOuverte && resteDeLaPile(messages.length) ? (
            <p data-reste="messages" className="pointer-events-none pr-1 pt-1 text-right text-[11.5px] text-faint">
              {resteDeLaPile(messages.length)}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Vignettes d'agents */}
      {agents.length ? (
        collapsed ? (
          <button
            onClick={() => setCollapsed(false)}
            className="pointer-events-auto flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13.5px] text-muted shadow-lg hover:text-text"
          >
            <Dot tone="running" pulse />
            {agents.length} agent{agents.length > 1 ? 's' : ''} en cours
            <ChevronUp className="h-3 w-3" />
          </button>
        ) : (
          <div className="pointer-events-auto w-full space-y-1" data-vignettes="agents">
            {agents.slice(0, 6).map((agent) => {
              const project = state.projects.find((p) => p.id === agent.projectId);
              const running = agent.status === 'running';
              return (
                <div
                  key={agent.id}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 shadow-lg"
                >
                  <Bot className={cn('h-3 w-3 shrink-0', running ? 'text-success' : 'text-faint')} />
                  <button onClick={() => onOpenAgent(agent.id)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-[13px] text-text">{agent.title}</p>
                    <p className="truncate text-[11.5px] text-faint">
                      {project?.name} · {agent.run.engine} ·{' '}
                      {running ? elapsed(agent.startedAt) : agent.status === 'failed' ? 'échec' : 'terminé'}
                    </p>
                  </button>
                  {running ? <Dot tone="running" pulse /> : null}
                  <button
                    onClick={() =>
                      setDismissed((current) => {
                        const next = new Set(current);
                        next.add(agent.id);
                        return next;
                      })
                    }
                    className="shrink-0 text-faint hover:text-text"
                    title="Retirer la vignette (l'agent continue)"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )
      ) : null}

      {/* Les commandes ferment le bloc, tout en bas : ce qu'on lit — messages
          puis vignettes — passe devant ce qui sert à ranger. */}
      {agents.length && !collapsed ? (
        <div className="pointer-events-auto flex items-center justify-end gap-1" data-commandes="pile">
          <button
            onPointerDown={(event) => {
              dragRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                baseX: offset.x,
                baseY: offset.y,
              };
            }}
            title="Déplacer la pile"
            className="cursor-grab rounded border border-border bg-surface px-1 py-0.5 text-faint hover:text-text active:cursor-grabbing"
          >
            <GripVertical className="h-2.5 w-2.5" />
          </button>
          {undo ? (
            <button
              onClick={() => {
                setDismissed(undo);
                setUndo(null);
              }}
              className="rounded border border-border bg-surface px-1.5 py-0.5 text-[11.5px] text-text"
            >
              Annuler
            </button>
          ) : null}
          <button
            onClick={() => setCollapsed(true)}
            className="rounded border border-border bg-surface px-1.5 py-0.5 text-[11.5px] text-faint hover:text-text"
          >
            Replier
          </button>
          <button
            onClick={() => clearAll(agents.map((a) => a.id))}
            className="rounded border border-border bg-surface px-1.5 py-0.5 text-[11.5px] text-faint hover:text-text"
          >
            Tout effacer
          </button>
        </div>
      ) : null}
    </div>
  );
}
