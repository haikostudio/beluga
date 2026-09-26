import * as React from 'react';
import {
  CLE_DISPOSITION_TABLEAU,
  autreDisposition,
  dispositionDuTableau,
  dispositionValide,
  type DispositionTableau,
} from '@beluga/shared';
import { useTelephone } from '@/lib/telephone';

/**
 * LE CHOIX « LIGNES / COLONNES » DU TABLEAU, PARTAGÉ entre le bouton du
 * bandeau du haut (qui le pose) et le tableau (qui le lit). Retenu sur
 * l'APPAREIL, dans le stockage du navigateur, et lu de façon SYNCHRONE au
 * chargement du module : le premier affichage est déjà le bon, sans flash.
 * Même patron que `etat-vocal.ts` : un module, un ensemble d'écouteurs,
 * `useSyncExternalStore` — jamais le magasin général.
 */

function lireStockage(): DispositionTableau | null {
  try {
    return dispositionValide(window.localStorage.getItem(CLE_DISPOSITION_TABLEAU));
  } catch {
    return null;
  }
}

let choix: DispositionTableau | null = typeof window === 'undefined' ? null : lireStockage();
const ecouteurs = new Set<() => void>();

function abonner(prevenir: () => void): () => void {
  ecouteurs.add(prevenir);
  return () => ecouteurs.delete(prevenir);
}

function lireChoix(): DispositionTableau | null {
  return choix;
}

function poserChoix(valeur: DispositionTableau): void {
  choix = valeur;
  try {
    window.localStorage.setItem(CLE_DISPOSITION_TABLEAU, valeur);
  } catch {
    /* Stockage refusé (navigation privée) : le choix vaut pour la session. */
  }
  for (const prevenir of ecouteurs) prevenir();
}

/** La disposition affichée, et le geste qui bascule vers l'autre. */
export function useDispositionTableau(): {
  disposition: DispositionTableau;
  basculer: () => void;
} {
  const retenu = React.useSyncExternalStore(abonner, lireChoix, lireChoix);
  const telephone = useTelephone();
  const disposition = dispositionDuTableau(retenu, telephone);
  const basculer = React.useCallback(() => poserChoix(autreDisposition(disposition)), [disposition]);
  return { disposition, basculer };
}
