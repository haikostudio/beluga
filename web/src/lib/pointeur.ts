import React from 'react';
import { REQUETE_SURVOL } from '@beluga/shared';

/**
 * Le pointeur du moment sait-il survoler ? La question se pose sur la CAPACITÉ
 * du pointeur, jamais sur la largeur de l'écran — une tablette large n'a pas
 * plus de survol qu'un téléphone. Elle est reposée quand la réponse change :
 * brancher une souris rend le survol, la débrancher le reprend.
 */
export function useSurvol(): boolean {
  const [survol, setSurvol] = React.useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia(REQUETE_SURVOL).matches,
  );
  React.useEffect(() => {
    const requete = window.matchMedia(REQUETE_SURVOL);
    const suivre = () => setSurvol(requete.matches);
    suivre();
    requete.addEventListener('change', suivre);
    return () => requete.removeEventListener('change', suivre);
  }, []);
  return survol;
}
