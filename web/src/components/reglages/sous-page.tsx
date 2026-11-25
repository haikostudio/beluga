/*
 * UNE SOUS-PAGE DANS UNE PAGE DE RÉGLAGES (carte « Liaison d'ordinateur simplifiée », 22/11/2026 ; refaite par la
 * carte « Fiche d'accès, nom Fishflow et session unique », 25/11/2026, maquette #98ddf).
 *
 * Une page de la fenêtre des réglages peut ouvrir un ENFANT au même endroit (la fiche d'une personne, la page d'un
 * ordinateur, le parcours « Ajouter ce Mac »). Elle le PUBLIE ici, et la fenêtre (settings-view.tsx) en tire :
 *  - sur ordinateur : l'entête de la page (titre et phrase de la rubrique) devient un RETOUR « ‹ Accès » vers le
 *    volet précédent. La colonne de gauche NE CHANGE PAS : aucun sommaire de la sous-page n'y est posé (décision de
 *    l'utilisateur du 25/11/2026 — « le sous-menu avec ses options qui ne servent à rien ») ;
 *  - sur téléphone : la flèche de la barre d'en-tête remonte à la liste de la page (jamais une barre de retour dans
 *    la page elle-même) ;
 *  - partout : la zone qui défile repart TOUT EN HAUT quand une sous-page s'ouvre, change ou se ferme (`cle`).
 * Les gestes passent par une référence : publier ne relance pas un rendu de la fenêtre à chaque rendu de la page.
 * Publiée et retirée AVANT la peinture (effets de mise en page) : l'entête change dans la même image que la page.
 */
import * as React from 'react';

export interface SousPageDeReglages {
  /** L'identité de la sous-page (un compte, un ordinateur) : la changer ramène la page en haut, pas un renommage. */
  cle: string;
  /** Le libellé du retour (« Accès », « Vos ordinateurs »). */
  retour: string;
  onRetour: () => void;
  /** Le titre de la sous-page (nom de la personne, de l'ordinateur) : dans la barre d'en-tête sur téléphone. */
  titre?: string;
}

type Publier = (s: SousPageDeReglages | null) => void;
const ContexteSousPage = React.createContext<Publier | null>(null);

export const FournisseurDeSousPage = ContexteSousPage.Provider;

/**
 * Publie la sous-page tant que le composant vit (`null` : aucune). Rend `true` quand une fenêtre des réglages l'accueille
 * (sinon la page garde son propre retour).
 */
export function useSousPageDeReglages(s: SousPageDeReglages | null): boolean {
  const publier = React.useContext(ContexteSousPage);
  const gestes = React.useRef(s);
  gestes.current = s;
  const cle = s ? JSON.stringify([s.cle, s.retour, s.titre ?? '']) : '';
  React.useLayoutEffect(() => {
    if (!publier) return;
    const actuelle = gestes.current;
    publier(actuelle ? { ...actuelle, onRetour: () => gestes.current?.onRetour() } : null);
  }, [publier, cle]);
  React.useLayoutEffect(() => {
    if (!publier) return;
    return () => {
      publier(null);
    };
  }, [publier]);
  return !!publier;
}
