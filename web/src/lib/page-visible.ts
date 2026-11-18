import * as React from 'react';

/**
 * LA PAGE EST-ELLE À L'ÉCRAN ? Suivi de `document.visibilityState` (et de `pageshow` / `pagehide`, que Safari émet
 * seul au retour d'arrière-plan). Sert au module de voix : le micro d'attente ne vit que page visible.
 */
function lire(): boolean {
  return typeof document === 'undefined' ? true : document.visibilityState !== 'hidden';
}

function abonner(prevenir: () => void): () => void {
  document.addEventListener('visibilitychange', prevenir);
  window.addEventListener('pageshow', prevenir);
  window.addEventListener('pagehide', prevenir);
  return () => {
    document.removeEventListener('visibilitychange', prevenir);
    window.removeEventListener('pageshow', prevenir);
    window.removeEventListener('pagehide', prevenir);
  };
}

export function usePageVisible(): boolean {
  return React.useSyncExternalStore(abonner, lire, () => true);
}
