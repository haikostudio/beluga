import React from 'react';
import { REQUETE_ANIMATIONS_REDUITES } from '@haikodev/shared';

/**
 * « JE PRÉFÈRE MOINS D'ANIMATIONS », lu depuis le code.
 *
 * Presque toutes les animations de l'application se coupent seules : la feuille
 * de style porte une règle `prefers-reduced-motion` et rien n'a besoin de le
 * savoir. Une IMAGE ANIMÉE, elle, ne s'arrête par aucune règle CSS — le
 * navigateur la joue en boucle quoi qu'on écrive autour. C'est le seul motif
 * pour lequel la préférence remonte jusqu'au code : le personnage qui pioche
 * est alors remplacé par son image fixe (`gesteDuPersonnage`).
 *
 * La réponse est reposée quand elle change, comme pour le survol : le réglage
 * se modifie sans recharger la page.
 */
export function useAnimationsReduites(): boolean {
  const [reduites, setReduites] = React.useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia?.(REQUETE_ANIMATIONS_REDUITES).matches === true,
  );
  React.useEffect(() => {
    const requete = window.matchMedia?.(REQUETE_ANIMATIONS_REDUITES);
    if (!requete) return;
    const suivre = () => setReduites(requete.matches);
    suivre();
    requete.addEventListener('change', suivre);
    return () => requete.removeEventListener('change', suivre);
  }, []);
  return reduites;
}
