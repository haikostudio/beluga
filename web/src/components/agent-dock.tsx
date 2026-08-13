import * as React from 'react';
import { Bot, ChevronUp, GripVertical, UploadCloud, X } from 'lucide-react';
import { Dot } from '@/components/ui';
import { Pile, type ElementDePile } from '@/components/pile';
import { usePref } from '@/lib/prefs';
import { useApp } from '@/lib/use-app';
import { cn, elapsed } from '@/lib/utils';

/**
 * La pile de vignettes d'agents en bas à droite (PLAN §28). Elle n'interrompt
 * jamais ce que vous êtes en train de faire.
 *
 * Les messages d'information passagers vivaient ici aussi ; ils sont désormais
 * en haut au centre (`Toasts`, `web/src/components/toasts.tsx`), en liste
 * plate avec leur propre compte à rebours — un empilement en profondeur ne
 * convient qu'aux vignettes, qu'on retrouve une à une en cliquant dessus.
 *
 * La pile des vignettes s'empile en profondeur (`Pile`,
 * `web/src/components/pile.tsx`) : la plus récente devant, trois visibles, le
 * reste compté.
 */

export function AgentDock({ onOpenAgent }: { onOpenAgent: (agentId: string) => void }) {
  const state = useApp();
  // Repliée ou dépliée : l'état survit au rechargement (§28).
  const [collapsed, setCollapsed] = usePref<boolean>('dock-collapsed', false);
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

  // La sélection ne change pas : les six agents les plus récents, le plus
  // récent devant — c'est l'AFFICHAGE qui s'empile désormais.
  const elementsAgents: ElementDePile[] = agents.slice(0, 6).map((agent) => {
    const project = state.projects.find((p) => p.id === agent.projectId);
    const running = agent.status === 'running';
    return {
      id: agent.id,
      classe: 'flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 shadow-lg',
      contenu: (
        <>
          {/* Un agent de PUBLICATION porte l'icône réseau/envoi, violette et
              clignotante tant qu'il tourne — le même signe que la ligne de
              projet, jamais confondu avec un travail ordinaire. */}
          {agent.role === 'deploy' ? (
            <UploadCloud
              className={cn(
                'h-3 w-3 shrink-0',
                running ? 'text-publie animate-pulse-soft motion-reduce:animate-none' : 'text-faint',
              )}
            />
          ) : (
            <Bot className={cn('h-3 w-3 shrink-0', running ? 'text-en-cours' : 'text-faint')} />
          )}
          <button
            onClick={(event) => {
              event.stopPropagation();
              onOpenAgent(agent.id);
            }}
            className="min-w-0 flex-1 text-left"
          >
            <p className="truncate text-[13px] text-text">{agent.title}</p>
            <p className="truncate text-[11.5px] text-faint">
              {project?.name} · {agent.run.engine} ·{' '}
              {running ? elapsed(agent.startedAt) : agent.status === 'failed' ? 'échec' : 'terminé'}
            </p>
          </button>
          {running ? <Dot tone="running" pulse /> : null}
          <button
            onClick={(event) => {
              event.stopPropagation();
              setDismissed((current) => {
                const next = new Set(current);
                next.add(agent.id);
                return next;
              });
            }}
            // Même cible de 32 px que la croix d'un message : une fois la pile
            // ouverte, elle doit se toucher au doigt.
            className="-m-[11px] flex shrink-0 items-center justify-center p-[11px] text-faint hover:text-text"
            title="Retirer la vignette (l'agent continue)"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </>
      ),
    };
  });

  return (
    <div
      data-bloc="dock"
      // Sur téléphone, le menu du bas flotte au ras de l'écran : le bloc part
      // donc plus haut pour ne pas se poser dessus. Sur ordinateur, où aucun
      // menu du bas n'existe, il reste collé au coin.
      className="pointer-events-none fixed bottom-14 right-2 z-40 flex w-[248px] flex-col items-end gap-1.5 sm:bottom-3 sm:right-3"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      {/* Vignettes d'agents, empilées en profondeur : la plus récente devant,
          les autres qui dépassent de quelques pixels. La pile se déploie au
          survol à la souris, à l'appui au doigt — sans ce relais, les
          vignettes du dessous resteraient inatteignables sur un écran
          tactile. */}
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
          <Pile
            nom="agents"
            mot="agent"
            attributRang="data-vignette-pile"
            attributsSupplementaires={{ 'data-vignettes': 'agents' }}
            elements={elementsAgents}
          />
        )
      ) : null}

      {/* Les commandes ferment le bloc, tout en bas : ce qu'on lit — les
          vignettes — passe devant ce qui sert à ranger. */}
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
