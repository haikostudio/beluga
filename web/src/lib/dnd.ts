import * as React from 'react';

/**
 * Glissement au pointeur, pas le glisser-déposer natif du navigateur.
 * Le natif dépend d'événements que chaque navigateur interprète à sa façon, ne
 * marche pas au doigt, et son image fantôme empêche d'afficher un vrai aperçu.
 * Ici, on suit le pointeur : l'aperçu se place exactement là où on pointe, sur
 * ordinateur comme sur téléphone.
 */

export interface DragItem {
  id: string;
  kind: string;
  label: string;
}

export interface DropTarget {
  /** Identifiant de l'élément survolé. */
  id: string;
  kind: string;
  /** Au-dessus ou en dessous de cet élément, ou à l'intérieur (conteneur). */
  position: 'before' | 'after' | 'inside';
}

interface Options {
  /** Lit la cible sous le pointeur ; rend null si l'endroit n'accepte rien. */
  resolve: (element: Element, y: number) => DropTarget | null;
  /** Appelé au relâchement, avec la dernière cible valide. */
  onDrop: (item: DragItem, target: DropTarget | null) => void;
}

export function usePointerDrag({ resolve, onDrop }: Options) {
  const [dragging, setDragging] = React.useState<DragItem | null>(null);
  const [target, setTarget] = React.useState<DropTarget | null>(null);
  const [pointer, setPointer] = React.useState<{ x: number; y: number } | null>(null);

  const state = React.useRef<{ item: DragItem; started: boolean; originY: number } | null>(null);
  const targetRef = React.useRef<DropTarget | null>(null);

  React.useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = state.current;
      if (!current) return;

      // Quelques pixels avant de considérer que c'est un glissement : sinon un
      // simple clic déclencherait un déplacement.
      if (!current.started) {
        if (Math.abs(event.clientY - current.originY) < 5) return;
        current.started = true;
        setDragging(current.item);
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
      }

      event.preventDefault();
      setPointer({ x: event.clientX, y: event.clientY });

      const sous = document.elementFromPoint(event.clientX, event.clientY);
      const trouve = sous ? resolve(sous, event.clientY) : null;
      const valide = trouve && trouve.id !== current.item.id ? trouve : null;
      targetRef.current = valide;
      setTarget(valide);
    };

    const up = () => {
      const current = state.current;
      state.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setPointer(null);
      if (!current?.started) {
        setDragging(null);
        setTarget(null);
        return;
      }
      const cible = targetRef.current;
      setDragging(null);
      setTarget(null);
      targetRef.current = null;
      onDrop(current.item, cible);
    };

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [resolve, onDrop]);

  const start = (event: React.PointerEvent, item: DragItem) => {
    // Seul le bouton principal démarre un glissement.
    if (event.button !== 0) return;
    state.current = { item, started: false, originY: event.clientY };
  };

  return { dragging, target, pointer, start };
}
