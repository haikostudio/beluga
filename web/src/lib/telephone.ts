import React from 'react';

/**
 * Sommes-nous sur un écran de téléphone ? Plusieurs endroits de l'interface s'y
 * épurent — le tiroir d'une carte replie ses tags, le volet des tâches démarre
 * replié, le tableau se coiffe d'une rangée d'onglets. Un seul seuil pour tous :
 * 640 px, la limite `sm` de l'interface.
 */
export const REQUETE_TELEPHONE = '(max-width: 639px)';

/**
 * Téléphone OU tablette : tout ce qui tient sous 1024 px, la limite `lg`. C'est
 * la largeur, pas le pointeur, qui décide (demande du 15/10/2026 : « tablette »
 * = de 640 à 1023 px) ; la double entête de la page d'une tâche s'y affiche.
 */
export const REQUETE_TABLETTE_OU_TELEPHONE = '(max-width: 1023px)';

/** La même question que `useTelephone`, au seuil de la tablette : suivie, elle se repose au redimensionnement. */
export function useTabletteOuTelephone(): boolean {
  const lire = () => typeof window !== 'undefined' && window.matchMedia(REQUETE_TABLETTE_OU_TELEPHONE).matches;
  const [petit, setPetit] = React.useState(lire);
  React.useEffect(() => {
    const media = window.matchMedia(REQUETE_TABLETTE_OU_TELEPHONE);
    const suivre = () => setPetit(media.matches);
    suivre();
    media.addEventListener('change', suivre);
    return () => media.removeEventListener('change', suivre);
  }, []);
  return petit;
}

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
