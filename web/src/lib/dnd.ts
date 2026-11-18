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
  /** Lit la cible sous le pointeur (x servant aux rangées horizontales) ; rend null si l'endroit n'accepte rien. */
  resolve: (element: Element, y: number, x: number) => DropTarget | null;
  /** Appelé au relâchement, avec la dernière cible valide. */
  onDrop: (item: DragItem, target: DropTarget | null) => void;
  /**
   * Au doigt, le glissement ne démarre qu'après un appui maintenu : sinon on ne
   * pourrait plus faire défiler la page en partant d'un élément déplaçable.
   * À la souris, il démarre au premier mouvement.
   */
  holdMs?: number;
  /**
   * L'appui long, comme sur téléphone : on garde le doigt SANS bouger et un
   * menu s'ouvre. Bouger avant l'échéance en fait un glissement — c'est le
   * partage naturel entre les deux gestes, jamais une question de durée.
   */
  onLongPress?: (item: DragItem) => void;
  /** Délai de l'appui long, mesuré depuis la pose du doigt. */
  longPressMs?: number;
  /**
   * Ce geste-ci a-t-il un appui long ? Absent : toujours. Refusé (la souris, ou une poignée qui n'a pas de
   * menu), le geste reste un pur glissement : tenir sans bouger ne l'annule pas.
   */
  appuiLongPermis?: (item: DragItem, pointerType: string) => boolean;
  /** Échap pendant le geste : rien n'est déposé. */
  onAbandon?: (item: DragItem) => void;
  /**
   * LES ZONES QUI DÉFILENT SEULES QUAND LE POINTEUR ATTEINT LEUR BORD, sans rien
   * lâcher (facultatif, le tableau ne s'en sert pas) : plus il est près du bord,
   * plus elles vont vite, et la cible est relue à chaque image, pointeur immobile compris.
   */
  defilementAuBord?: () => (HTMLElement | null)[];
}

/**
 * La bande sensible au bord d'une zone, et la vitesse au plus près du bord (pixels par
 * image). Plus étroite et plus lente en hauteur : une rangée fait 44 px, et celle du bas
 * doit rester atteignable sans que la zone défile sous la main.
 */
const BORD_EN_LARGEUR = { bande: 48, vitesse: 16 };
const BORD_EN_HAUTEUR = { bande: 24, vitesse: 6 };

function vitesseAuBord(depuisDebut: number, depuisFin: number, { bande, vitesse }: { bande: number; vitesse: number }): number {
  if (depuisDebut < bande) return -vitesse * Math.min(1, (bande - depuisDebut) / bande);
  if (depuisFin < bande) return vitesse * Math.min(1, (bande - depuisFin) / bande);
  return 0;
}

export function usePointerDrag({ resolve, onDrop, holdMs = 0, onLongPress, longPressMs = 520, appuiLongPermis, onAbandon, defilementAuBord }: Options) {
  const [dragging, setDragging] = React.useState<DragItem | null>(null);
  const [target, setTarget] = React.useState<DropTarget | null>(null);
  const [pointer, setPointer] = React.useState<{ x: number; y: number } | null>(null);

  const state = React.useRef<{
    item: DragItem;
    started: boolean;
    originX: number;
    originY: number;
    /** Vrai tant que l'appui maintenu n'a pas abouti (doigt uniquement). */
    attenteAppui: boolean;
    minuteur?: number;
    /** Minuteur de l'appui long : annulé dès que le pointeur bouge. */
    minuteurLong?: number;
  } | null>(null);
  const targetRef = React.useRef<DropTarget | null>(null);
  const dernierPoint = React.useRef<{ x: number; y: number } | null>(null);
  const zonesDeBord = React.useRef(defilementAuBord);
  zonesDeBord.current = defilementAuBord;
  const surAbandon = React.useRef(onAbandon);
  surAbandon.current = onAbandon;

  React.useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = state.current;
      if (!current) return;

      const ecart = Math.max(
        Math.abs(event.clientX - current.originX),
        Math.abs(event.clientY - current.originY),
      );

      // Bouger, c'est vouloir déplacer : l'appui long ne s'ouvrira plus.
      if (current.minuteurLong && ecart > 6) {
        window.clearTimeout(current.minuteurLong);
        current.minuteurLong = undefined;
      }

      // Doigt : bouger avant la fin de l'appui maintenu = on voulait défiler.
      if (current.attenteAppui) {
        if (ecart > 8) {
          window.clearTimeout(current.minuteur);
          window.clearTimeout(current.minuteurLong);
          state.current = null;
        }
        return;
      }

      // Quelques pixels avant de considérer que c'est un glissement : sinon un
      // simple clic déclencherait un déplacement.
      if (!current.started) {
        if (ecart < 5) return;
        current.started = true;
        setDragging(current.item);
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
      }

      event.preventDefault();
      dernierPoint.current = { x: event.clientX, y: event.clientY };
      setPointer({ x: event.clientX, y: event.clientY });

      const sous = document.elementFromPoint(event.clientX, event.clientY);
      const trouve = sous ? resolve(sous, event.clientY, event.clientX) : null;
      const valide = trouve && trouve.id !== current.item.id ? trouve : null;
      targetRef.current = valide;
      setTarget(valide);
    };

    const up = () => {
      const current = state.current;
      if (current?.minuteur) window.clearTimeout(current.minuteur);
      if (current?.minuteurLong) window.clearTimeout(current.minuteurLong);
      state.current = null;
      dernierPoint.current = null;
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

    // Pendant un glissement au doigt, on empêche la page de défiler sous lui.
    // L'appui maintenu compte déjà : une fois la carte décrochée, le premier
    // millimètre parcouru doit la suivre, pas faire glisser le tableau.
    const touche = (event: TouchEvent) => {
      if (state.current && !state.current.attenteAppui) event.preventDefault();
    };

    const clavier = (event: KeyboardEvent) => {
      const current = state.current;
      if (event.key !== 'Escape' || !current?.started) return;
      event.preventDefault();
      event.stopPropagation();
      state.current = null;
      dernierPoint.current = null;
      targetRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setPointer(null);
      setDragging(null);
      setTarget(null);
      surAbandon.current?.(current.item);
    };

    /* LE DÉFILEMENT AU BORD : la boucle tourne seulement pendant un geste. */
    let image = 0;
    const defiler = () => {
      image = requestAnimationFrame(defiler);
      const current = state.current;
      const point = dernierPoint.current;
      const zones = zonesDeBord.current?.();
      if (!current?.started || !point || !zones?.length) return;
      let bouge = false;
      for (const zone of zones) {
        if (!zone) continue;
        const r = zone.getBoundingClientRect();
        if (point.x < r.left - 8 || point.x > r.right + 8 || point.y < r.top - 8 || point.y > r.bottom + 8) continue;
        const dx = zone.scrollWidth > zone.clientWidth ? vitesseAuBord(point.x - r.left, r.right - point.x, BORD_EN_LARGEUR) : 0;
        /* Un haut collé couvre le début de la zone : sa bande sensible commence dessous, et le survoler ne fait rien défiler. */
        const marge = Number(zone.dataset.margeDeBord) || 0;
        const dy = zone.scrollHeight > zone.clientHeight && point.y >= r.top + marge ? vitesseAuBord(point.y - r.top - marge, r.bottom - point.y, BORD_EN_HAUTEUR) : 0;
        const avantX = zone.scrollLeft;
        const avantY = zone.scrollTop;
        if (dx) zone.scrollLeft += dx;
        if (dy) zone.scrollTop += dy;
        if (zone.scrollLeft !== avantX || zone.scrollTop !== avantY) bouge = true;
      }
      if (!bouge) return;
      /* Ce qui est sous le pointeur a changé sans qu'il bouge : on relit la cible, et l'écran se redessine. */
      setPointer({ ...point });
      const sous = document.elementFromPoint(point.x, point.y);
      const trouve = sous ? resolve(sous, point.y, point.x) : null;
      const valide = trouve && trouve.id !== current.item.id ? trouve : null;
      targetRef.current = valide;
      setTarget(valide);
    };
    if (defilementAuBord) image = requestAnimationFrame(defiler);

    window.addEventListener('keydown', clavier, true);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('touchmove', touche, { passive: false });
    return () => {
      cancelAnimationFrame(image);
      window.removeEventListener('keydown', clavier, true);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('touchmove', touche);
    };
  }, [resolve, onDrop, !!defilementAuBord]);

  const start = (event: React.PointerEvent, item: DragItem) => {
    // Seul le bouton principal démarre un glissement.
    if (event.button !== 0) return;
    const doigt = event.pointerType !== 'mouse' && holdMs > 0;
    const appuiLong = onLongPress && (!appuiLongPermis || appuiLongPermis(item, event.pointerType)) ? onLongPress : undefined;
    const entree = {
      item,
      started: false,
      originX: event.clientX,
      originY: event.clientY,
      attenteAppui: doigt,
      minuteur: undefined as number | undefined,
      minuteurLong: undefined as number | undefined,
    };
    if (doigt) {
      entree.minuteur = window.setTimeout(() => {
        if (state.current !== entree) return;
        entree.attenteAppui = false;
        // Petite vibration : on sent que la carte s'est décrochée.
        navigator.vibrate?.(10);
        // Avec un appui long à servir, la carte est décrochée mais son aperçu
        // n'apparaît qu'au premier mouvement : sinon il surgirait une demi-
        // seconde avant le menu, puis disparaîtrait.
        if (appuiLong) return;
        entree.started = true;
        setDragging(entree.item);
        setPointer({ x: entree.originX, y: entree.originY });
      }, holdMs);
    }
    if (appuiLong) {
      entree.minuteurLong = window.setTimeout(() => {
        if (state.current !== entree || entree.started) return;
        window.clearTimeout(entree.minuteur);
        state.current = null;
        navigator.vibrate?.(14);
        appuiLong(item);
      }, longPressMs);
    }
    state.current = entree;
  };

  return { dragging, target, pointer, start };
}
