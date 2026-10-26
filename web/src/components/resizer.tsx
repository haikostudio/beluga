import * as React from 'react';
import { usePref } from '@/lib/prefs';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * Une poignée pour élargir ou rétrécir un panneau. La taille choisie est
 * mémorisée : on retrouve sa mise en page en rouvrant l'application.
 *
 * `axe` 'x' (défaut) règle une LARGEUR, 'y' une HAUTEUR. Le côté donné à `start`
 * dit où est le panneau PAR RAPPORT à la poignée : 'left' / 'top' = le panneau
 * est avant elle (tirer vers la droite / le bas l'agrandit), 'right' / 'bottom'
 * = il est après (tirer vers la gauche / le haut l'agrandit).
 */
export function useResizable(
  key: string,
  defaults: { initial: number; min: number; max: number; axe?: 'x' | 'y' },
) {
  const vertical = defaults.axe === 'y';
  // La taille est enregistrée EN BASE : même mise en page sur tous les écrans.
  const [stored, store] = usePref<number>(`${vertical ? 'height' : 'width'}.${key}`, defaults.initial);
  const width = Math.min(defaults.max, Math.max(defaults.min, stored || defaults.initial));
  const [live, setLive] = React.useState<number | null>(null);
  const setWidth = (value: number | ((c: number) => number)) =>
    setLive((current) => (typeof value === 'function' ? value(current ?? width) : value));

  const dragging = React.useRef<{ start: number; startSize: number; side: 'left' | 'right' | 'top' | 'bottom' } | null>(null);

  React.useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragging.current;
      if (!drag) return;
      event.preventDefault();
      const delta = (vertical ? event.clientY : event.clientX) - drag.start;
      const avant = drag.side === 'left' || drag.side === 'top';
      const raw = avant ? drag.startSize + delta : drag.startSize - delta;
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
  }, [defaults.max, defaults.min, store, vertical]);

  const start = (event: React.PointerEvent, side: 'left' | 'right' | 'top' | 'bottom') => {
    dragging.current = { start: vertical ? event.clientY : event.clientX, startSize: live ?? width, side };
    document.body.style.cursor = vertical ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const reset = () => {
    setLive(defaults.initial);
    store(defaults.initial);
  };

  return { width: live ?? width, size: live ?? width, start, reset };
}

export function ResizeHandle({
  onPointerDown,
  onDoubleClick,
  className,
  cacheAuRepos = false,
  ...reste
}: {
  onPointerDown: (event: React.PointerEvent) => void;
  onDoubleClick?: () => void;
  className?: string;
  /**
   * LE TRAIT NE PARAÎT QU'AU SURVOL : entre la colonne des projets et la zone
   * principale, deux fonds se touchent déjà — un trait permanent y referait la
   * bordure que la refonte a retirée.
   */
  cacheAuRepos?: boolean;
  'data-studio-poignee'?: string;
  'data-conversation-poignee'?: string;
  'data-document-poignee'?: string;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      {...reste}
      title={t('Glisser pour redimensionner · double-clic pour revenir à la largeur d\'origine')}
      className={cn('group relative w-1 shrink-0 cursor-col-resize touch-none select-none', className)}
    >
      {/*
       * LE SEUL TRAIT ENTRE DEUX ZONES : elles se distinguent par leurs
       * fonds, la poignée seule se dessine. Un trait d'UN pixel qui S'ESTOMPE
       * À SES DEUX BOUTS (transparent en haut et en bas) : il dit « ici se
       * règle la largeur » sans refermer un cadre autour des panneaux. Il suit
       * `--faint`, à mi-force au repos — `--border` ne dessine presque rien
       * dans cette palette.
       *
       * Au survol et pendant le glisser, il se marque : pleine force et trois
       * pixels, toujours en GRIS (l'interface est monochrome, plus d'orange).
       * L'épaississement se fait dans la largeur déjà réservée, autour de la
       * même colonne de pixels : la mise en page ne bouge pas, et le trait
       * tombe toujours sur un pixel ENTIER (centré au demi-pixel, il bavait
       * sur deux).
       */}
      <span
        className={cn(
          'absolute inset-y-0 left-[2px] w-px bg-gradient-to-b from-transparent via-faint to-transparent transition-all duration-150 group-hover:left-px group-hover:w-[3px] group-hover:opacity-100 group-active:left-px group-active:w-[3px] group-active:opacity-100',
          cacheAuRepos ? 'opacity-0' : 'opacity-50',
        )}
      />
      {/* Zone d'attrape plus large que le trait, pour viser sans effort. */}
      <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
    </div>
  );
}
