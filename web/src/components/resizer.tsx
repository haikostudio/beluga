import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Une poignée pour élargir ou rétrécir un panneau. La largeur choisie est
 * mémorisée : on retrouve sa mise en page en rouvrant l'application.
 */
export function useResizable(key: string, defaults: { initial: number; min: number; max: number }) {
  const storageKey = `haikodev.width.${key}`;

  const [width, setWidth] = React.useState<number>(() => {
    const stored = Number(localStorage.getItem(storageKey));
    if (!Number.isFinite(stored) || stored <= 0) return defaults.initial;
    return Math.min(defaults.max, Math.max(defaults.min, stored));
  });

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
      setWidth((current) => {
        localStorage.setItem(storageKey, String(current));
        return current;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [defaults.max, defaults.min, storageKey]);

  const start = (event: React.PointerEvent, side: 'left' | 'right') => {
    dragging.current = { startX: event.clientX, startWidth: width, side };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const reset = () => {
    setWidth(defaults.initial);
    localStorage.setItem(storageKey, String(defaults.initial));
  };

  return { width, start, reset };
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
      className={cn(
        'group relative w-1 shrink-0 cursor-col-resize touch-none select-none bg-border/40 transition-colors hover:bg-muted',
        className,
      )}
    >
      {/* Zone d'attrape plus large que le trait, pour viser sans effort. */}
      <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
    </div>
  );
}
