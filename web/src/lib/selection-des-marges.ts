import type React from 'react';

/*
 * UN CLIC DANS LE VIDE D'UN FIL NE SÉLECTIONNE RIEN (23/11/2026, capture #1ad2).
 *
 * Un double ou triple clic, ou un glisser, parti des marges d'une conversation (de part et d'autre de la colonne, entre
 * deux messages) sélectionnait d'un coup le paragraphe ou le message le plus proche : une surbrillance grise dont on ne
 * comprenait pas l'origine. Ici, un appui qui ne tombe NI sur du texte NI sur un élément interactif ne démarre aucune
 * sélection, et efface celle qui traînait. Partir du texte lui-même — glisser, double clic sur un mot, triple clic sur
 * un paragraphe — sélectionne et se copie comme avant (« un texte affiché se copie à la souris »).
 */

const INTERACTIF =
  'a, button, input, textarea, select, label, summary, img, video, canvas, svg, [contenteditable=""], [contenteditable="true"], [role="button"], [role="slider"], [draggable="true"]';

/** Le point (x, y) tombe-t-il sur un caractère affiché ? */
function surDuTexte(x: number, y: number): boolean {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let noeud: Node | null = null;
  let decalage = 0;
  if (typeof document.caretRangeFromPoint === 'function') {
    const plage = document.caretRangeFromPoint(x, y);
    noeud = plage?.startContainer ?? null;
    decalage = plage?.startOffset ?? 0;
  } else if (typeof doc.caretPositionFromPoint === 'function') {
    const position = doc.caretPositionFromPoint(x, y);
    noeud = position?.offsetNode ?? null;
    decalage = position?.offset ?? 0;
  }
  if (!noeud || noeud.nodeType !== Node.TEXT_NODE) return false;
  const longueur = (noeud as Text).length;
  const plage = document.createRange();
  // Le caret tombe ENTRE deux caractères : on regarde celui d'avant et celui d'après.
  for (const rang of [decalage - 1, decalage]) {
    if (rang < 0 || rang >= longueur) continue;
    plage.setStart(noeud, rang);
    plage.setEnd(noeud, rang + 1);
    for (const rect of Array.from(plage.getClientRects())) {
      if (x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 1 && y <= rect.bottom + 1) return true;
    }
  }
  return false;
}

/** À poser en `onMouseDown` sur la zone qui défile d'un fil de conversation. */
export function retenirLaSelectionDesMarges(event: React.MouseEvent<HTMLElement>): void {
  if (event.button !== 0 || event.shiftKey) return;
  const cible = event.target as Element | null;
  if (!cible || cible.closest(INTERACTIF)) return;
  if (surDuTexte(event.clientX, event.clientY)) return;
  // Un clic simple dans le vide efface la sélection qui traînait, comme avant ; il n'en démarre simplement plus.
  if (event.detail <= 1) window.getSelection()?.removeAllRanges();
  event.preventDefault();
}
