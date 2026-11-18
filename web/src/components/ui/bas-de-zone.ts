import * as React from 'react';

/**
 * UNE BARRE COLLÉE TOUCHE LE VRAI BAS DE LA ZONE QUI DÉFILE (capture #d4b1 du 04/11/2026 pour la barre d'une question,
 * capture #7e81 du 18/11/2026 pour le pied des tableaux : « pourquoi le footer est décalé du bord ? »).
 *
 * Un `sticky bottom-0` respecte le retrait intérieur bas de la zone qui défile (`pb-6`, `sm:pb-20` sur l'accueil d'un
 * projet) : la barre s'arrêtait 24 à 80 px au-dessus du bord, et les lignes défilaient visibles dans cet interstice.
 * On rend ce retrait en décalage négatif : collée, la barre touche le bord, et rien ne passe plus sous elle. Le retrait
 * reste dans la zone (il garde la place du bouton vocal en fin de défilement) ; il est RELU à chaque changement de
 * taille de la zone, car il change avec la largeur (`sm:`).
 *
 * `cible` : la barre (une référence si elle ne change jamais de nœud, sinon le nœud lui-même, posé par une référence
 * de rappel). Rend le décalage à poser en `style.bottom` (0 : rien à poser).
 */
export function useBasDeLaZoneQuiDefile(cible: React.RefObject<HTMLElement | null> | HTMLElement | null): number {
  const [bas, setBas] = React.useState(0);
  const posee = cible && 'current' in cible ? null : cible;
  React.useLayoutEffect(() => {
    const element = cible && 'current' in cible ? cible.current : cible;
    if (!element) return;
    let zone: HTMLElement | null = element.parentElement;
    while (zone && zone !== document.body && !/(auto|scroll)/.test(getComputedStyle(zone).overflowY)) zone = zone.parentElement;
    if (!zone || zone === document.body) return;
    const laZone = zone;
    const mesurer = () => {
      const retrait = parseFloat(getComputedStyle(laZone).paddingBottom) || 0;
      setBas(retrait > 0 ? -retrait : 0);
    };
    mesurer();
    const observateur = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(mesurer) : null;
    observateur?.observe(laZone);
    return () => observateur?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posee ?? cible]);
  return bas;
}
