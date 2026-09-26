import React from 'react';

/**
 * Sommes-nous sur un écran de téléphone ? Plusieurs endroits de l'interface s'y
 * épurent — le tiroir d'une carte replie ses tags, le volet des tâches démarre
 * replié, le tableau se coiffe d'une rangée d'onglets. Un seul seuil pour tous :
 * 640 px, la limite `sm` de l'interface.
 */
export const REQUETE_TELEPHONE = '(max-width: 639px)';

/** Réponse d'un coup, sans suivi — pour un choix initial (pas dans le rendu). */
export function estTelephone(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(REQUETE_TELEPHONE).matches;
}

/**
 * La même question, mais SUIVIE : elle se repose quand la largeur change
 * (rotation, fenêtre redimensionnée), et le composant se redessine.
 */
export function useTelephone(): boolean {
  const [telephone, setTelephone] = React.useState(() => estTelephone());
  React.useEffect(() => {
    const media = window.matchMedia(REQUETE_TELEPHONE);
    const suivre = () => setTelephone(media.matches);
    suivre();
    media.addEventListener('change', suivre);
    return () => media.removeEventListener('change', suivre);
  }, []);
  return telephone;
}
