import * as React from 'react';
import { usePref } from '@/lib/prefs';
import { cn } from '@/lib/utils';

/**
 * Une poignée pour élargir ou rétrécir un panneau. La largeur choisie est
 * mémorisée : on retrouve sa mise en page en rouvrant l'application.
 */
export function useResizable(key: string, defaults: { initial: number; min: number; max: number }) {
  // La largeur est enregistrée EN BASE : même mise en page sur tous les écrans.
  const [stored, store] = usePref<number>(`width.${key}`, defaults.initial);
  const width = Math.min(defaults.max, Math.max(defaults.min, stored || defaults.initial));
  const [live, setLive] = React.useState<number | null>(null);
  const setWidth = (value: number | ((c: number) => number)) =>
    setLive((current) => (typeof value === 'function' ? value(current ?? width) : value));

  const dragging = React.useRef<{ startX: number; startWidth: number; side: 'left' | 'right' } | null>(null);

  React.useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragging.current;
      if (!drag) return;
      event.preventDefault();
      const delta = event.clientX - drag.startX;
      const raw = drag.side === 'left' ? drag.startWidth + delta : drag.startWidth - delta;
      setWidth(Math.min(defaults.max, Math.max(defaults.min, Math.round(raw))));
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setLive((current) => {
        if (current !== null) store(current);
        return current;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [defaults.max, defaults.min, store]);

  const start = (event: React.PointerEvent, side: 'left' | 'right') => {
    dragging.current = { startX: event.clientX, startWidth: live ?? width, side };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const reset = () => {
    setLive(defaults.initial);
    store(defaults.initial);
  };

  return { width: live ?? width, start, reset };
}

export function ResizeHandle({
  onPointerDown,
  onDoubleClick,
  className,
}: {
  onPointerDown: (event: React.PointerEvent) => void;
  onDoubleClick?: () => void;
  className?: string;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      title="Glisser pour redimensionner · double-clic pour revenir à la largeur d'origine"
      className={cn('group relative w-1 shrink-0 cursor-col-resize touch-none select-none', className)}
    >
      {/*
       * Au repos, un trait FIN comme toutes les autres bordures : une barre
       * épaisse en permanence coupait la page en trois. Il s'épaissit au
       * survol, dans la largeur déjà réservée — la mise en page ne bouge donc
       * pas d'un pixel quand la souris passe.
       */}
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-all duration-150 group-hover:w-[3px] group-hover:bg-muted" />
      {/* Zone d'attrape plus large que le trait, pour viser sans effort. */}
      <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
    </div>
  );
}
