import * as React from 'react';

/**
 * L'heure qui avance, à la minute, pour TOUT l'écran.
 *
 * Certains repères ne dépendent pas d'un changement d'état mais du simple temps
 * qui passe : « tour terminé sans suite depuis 3 h » doit apparaître même si
 * rien n'arrive du serveur. Sans horloge, la mention n'aurait été calculée
 * qu'au prochain rendu — c'est-à-dire au prochain événement, peut-être jamais.
 *
 * Un SEUL intervalle pour toute la page, partagé par abonnement : vingt cartes
 * à l'écran ne font pas vingt minuteries. Il ne tourne que tant qu'au moins un
 * composant écoute, et s'arrête tout seul ensuite.
 */

const PAS = 60_000;

let minuterie: number | null = null;
const abonnes = new Set<(at: number) => void>();

function battre(): void {
  const at = Date.now();
  for (const abonne of abonnes) abonne(at);
}

function abonner(abonne: (at: number) => void): () => void {
  abonnes.add(abonne);
  if (minuterie === null) minuterie = window.setInterval(battre, PAS);
  return () => {
    abonnes.delete(abonne);
    if (abonnes.size === 0 && minuterie !== null) {
      window.clearInterval(minuterie);
      minuterie = null;
    }
  };
}

/** L'heure courante, rafraîchie chaque minute. */
export function useMinute(): number {
  const [maintenant, setMaintenant] = React.useState(() => Date.now());
  React.useEffect(() => abonner(setMaintenant), []);
  return maintenant;
}
