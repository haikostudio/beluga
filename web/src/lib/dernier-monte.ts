import * as React from 'react';

/*
 * LE DERNIER MONTÉ RÉPOND (24/10/2026). Les gestes de publication vivent à
 * deux endroits à la fois : le tableau du projet, et la page d'une carte posée
 * PAR-DESSUS lui (le tableau reste monté dessous). Une demande venue d'ailleurs
 * — cloche, vignette de dépannage, menu des agents — ne doit ouvrir qu'UN
 * volet : celui de l'écran du dessus, c'est-à-dire le dernier monté pour cette
 * clé. Quand la page de la carte se referme, la main revient au tableau.
 */
const piles = new Map<string, symbol[]>();
const abonnes = new Set<() => void>();
const prevenir = () => abonnes.forEach((f) => f());

/** Vrai pour la seule instance montée en dernier sous cette clé. */
export function useDernierMonte(cle: string): boolean {
  const jeton = React.useRef<symbol>(Symbol(cle)).current;
  React.useEffect(() => {
    const pile = piles.get(cle) ?? [];
    pile.push(jeton);
    piles.set(cle, pile);
    prevenir();
    return () => {
      const reste = (piles.get(cle) ?? []).filter((j) => j !== jeton);
      if (reste.length) piles.set(cle, reste);
      else piles.delete(cle);
      prevenir();
    };
  }, [cle, jeton]);
  return React.useSyncExternalStore(
    (f) => {
      abonnes.add(f);
      return () => abonnes.delete(f);
    },
    () => {
      const pile = piles.get(cle);
      return !!pile && pile[pile.length - 1] === jeton;
    },
    () => false,
  );
}
