/*
 * UNE SOUS-PAGE DANS UNE PAGE DE RÉGLAGES (carte « Liaison d'ordinateur simplifiée », 22/11/2026, maquette #a0549).
 *
 * Une page de la fenêtre des réglages peut ouvrir un ENFANT au même endroit (la page d'un ordinateur, le parcours
 * « Ajouter ce Mac »). Elle le PUBLIE ici, et la fenêtre (settings-view.tsx) en tire :
 *  - sur ordinateur, quand la sous-page a un SOMMAIRE : la colonne de gauche devient ce sommaire (« ‹ Vos
 *    ordinateurs », le nom en petites capitales, un bouton par partie, la partie lue surlignée) à la place des pages
 *    de la rubrique ;
 *  - sur téléphone : la flèche de la barre d'en-tête remonte à la liste de la page (jamais une barre de retour dans
 *    la page elle-même).
 * Les gestes passent par une référence : publier ne relance pas un rendu de la fenêtre à chaque rendu de la page.
 * Publiée et retirée AVANT la peinture (effets de mise en page) : la colonne change dans la même image que la page.
 */
import * as React from 'react';

export interface PartieDeSommaire {
  cle: string;
  titre: string;
  icone?: React.ComponentType<{ className?: string }>;
}

export interface SousPageDeReglages {
  /** Le libellé du retour (« Vos ordinateurs »). */
  retour: string;
  onRetour: () => void;
  /** Le titre de la sous-page (nom de l'ordinateur) : en tête du sommaire, et dans la barre d'en-tête sur téléphone. */
  titre?: string;
  /** Les parties de la sous-page : sans elles, la colonne de gauche ne change pas (sur ordinateur). */
  parties?: PartieDeSommaire[];
  active?: string | null;
  onAller?: (cle: string) => void;
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
  const cle = s ? JSON.stringify([s.retour, s.titre ?? '', (s.parties ?? []).map((p) => [p.cle, p.titre]), s.active ?? '']) : '';
  React.useLayoutEffect(() => {
    if (!publier) return;
    const actuelle = gestes.current;
    publier(
      actuelle
        ? {
            ...actuelle,
            onRetour: () => gestes.current?.onRetour(),
            onAller: actuelle.onAller ? (c: string) => gestes.current?.onAller?.(c) : undefined,
          }
        : null,
    );
  }, [publier, cle]);
  React.useLayoutEffect(() => {
    if (!publier) return;
    return () => {
      publier(null);
    };
  }, [publier]);
  return !!publier;
}
