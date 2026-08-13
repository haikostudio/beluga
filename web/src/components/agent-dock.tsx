import * as React from 'react';
import { AlertCircle, Check, GripVertical, Info, TriangleAlert, X } from 'lucide-react';
import { heureEtDate } from '@haikodev/shared';
import { Pile, type ElementDePile } from '@/components/pile';
import { usePref } from '@/lib/prefs';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/**
 * La pile des messages courts, en bas à droite. Elle n'interrompt jamais ce
 * que vous êtes en train de faire ; les erreurs, elles, attendent d'être
 * lues.
 *
 * Les vignettes d'agents, elles, ne vivent plus ici : elles se rejoignent
 * par un bouton au pied de la colonne de gauche (`PileAgentsColonne`,
 * `web/src/components/sidebar.tsx`), en panneau flottant au survol.
 */

export function AgentDock() {
  const state = useApp();
  // La pile est déplaçable si elle gêne, et sa position est mémorisée.
  const [stored, storeOffset] = usePref<{ x: number; y: number }>('dock', { x: 0, y: 0 });
  const [live, setLive] = React.useState<{ x: number; y: number } | null>(null);
  const offset = live ?? stored;
  const setOffset = (value: { x: number; y: number } | ((c: { x: number; y: number }) => { x: number; y: number })) =>
    setLive((current) => (typeof value === 'function' ? value(current ?? offset) : value));
  const dragRef = React.useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  // Le plus récent en tête : c'est lui qui se pose devant.
  const messages = React.useMemo(() => [...state.toasts].reverse(), [state.toasts]);

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

  const elementsMessages: ElementDePile[] = messages.map((toast) => ({
    id: toast.id,
    classe: cn(
      'flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-[13.5px] shadow-lg',
      toast.level === 'error'
        ? 'border-danger/40 bg-surface text-danger'
        : toast.level === 'warning'
          ? 'border-warning/40 bg-surface text-warning'
          : toast.level === 'success'
            ? 'border-success/40 bg-surface text-success'
            : 'border-border bg-surface text-muted',
    ),
    contenu: (
      <>
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
          {/* Un compte rendu de lot nomme ses cartes ligne à ligne : les
              retours à la ligne doivent tenir. */}
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
          title="Retirer ce message"
          // La croix reste atteignable au doigt : sa cible fait 32 px de côté,
          // la marge négative rendant au message sa taille.
          className="-m-[11px] flex shrink-0 items-center justify-center p-[11px] opacity-60 hover:opacity-100"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </>
    ),
  }));

  return (
    <div
      data-bloc="dock"
      // Sur téléphone, le menu du bas flotte au ras de l'écran : le bloc part
      // donc plus haut pour ne pas se poser dessus. Sur ordinateur, où aucun
      // menu du bas n'existe, il reste collé au coin.
      className="pointer-events-none fixed bottom-14 right-2 z-40 flex w-[248px] flex-col items-end gap-1.5 sm:bottom-3 sm:right-3"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      {/* Messages courts, empilés en profondeur : le plus récent devant, les
          autres qui dépassent de quelques pixels. La pile se déploie au survol
          à la souris, à l'appui au doigt — sans ce relais, les messages du
          dessous resteraient inatteignables sur un écran tactile. */}
      <Pile nom="messages" mot="message" attributRang="data-message-pile" elements={elementsMessages} />

      {/* La poignée ferme le bloc, tout en bas : ce qu'on lit — les messages —
          passe devant ce qui sert à ranger. */}
      {messages.length ? (
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
        </div>
      ) : null}
    </div>
  );
}
