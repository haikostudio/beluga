import * as React from 'react';
import { DUREE_SECOUSSE_MS, PERIODE_SECOUSSE_CARTE_MS } from '@beluga/shared';

/**
 * LA SECOUSSE RÉPÉTÉE — ce qui attend un geste de vous se rappelle à vous tant
 * que l'attente dure.
 *
 * La ligne d'un projet (`useSecousse`, colonne de gauche) ne bouge qu'UNE fois,
 * à l'arrivée d'une nouvelle. Une carte ou un bouton qui attend, eux, se
 * secouent toutes les `periode` millisecondes, et la première fois peu après
 * que l'attente commence. Rend `true` pendant la courte fenêtre où la classe
 * `animate-secousse` doit être posée ; le réglage « réduire les animations »
 * coupe l'animation elle-même (styles.css), rien à faire ici.
 *
 * Une minuterie PAR élément, posée seulement tant qu'il est actif : une carte
 * qui n'attend rien ne coûte aucun rendu.
 */
export function useSecousseRepetee(actif: boolean, periode = PERIODE_SECOUSSE_CARTE_MS): boolean {
  const [secoue, setSecoue] = React.useState(false);

  React.useEffect(() => {
    if (!actif) return;
    let minuteries: number[] = [];
    const jouer = () => {
      minuteries.forEach((m) => window.clearTimeout(m));
      // La classe est retirée avant d'être reposée : l'animation rejoue.
      setSecoue(false);
      minuteries = [
        window.setTimeout(() => setSecoue(true), 20),
        window.setTimeout(() => setSecoue(false), DUREE_SECOUSSE_MS),
      ];
    };
    const premiere = window.setTimeout(jouer, 400);
    const boucle = window.setInterval(jouer, periode);
    return () => {
      window.clearTimeout(premiere);
      window.clearInterval(boucle);
      minuteries.forEach((m) => window.clearTimeout(m));
      setSecoue(false);
    };
  }, [actif, periode]);

  return secoue;
}
