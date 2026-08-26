import * as React from 'react';
import { MODE_SIMPLIFIE_ATTRIBUT, MODE_SIMPLIFIE_CLE } from '@haikodev/shared';
import { readPref, usePref } from './prefs';

/**
 * LE MODE SIMPLIFIÉ, CÔTÉ ÉCRAN.
 *
 * La règle — ce qui est technique, ce qui ne l'est pas — vit dans
 * `shared/src/mode-simplifie.ts`. Ici on ne fait que deux choses : lire le
 * réglage et le poser sur la page.
 *
 * Le réglage suit le chemin du THÈME et de la LANGUE : il vit EN BASE
 * (`usePref`), donc il se retrouve sur le téléphone comme sur l'ordinateur.
 * Aucun repère local, et c'est voulu : contrairement au thème, l'oublier une
 * demi-seconde au premier affichage ne fait pas clignoter l'écran — au pire un
 * chiffre paraît puis s'efface.
 *
 * IL S'APPLIQUE SANS RECHARGER. Chaque écran appelle `useEstSimplifie()`
 * pendant son rendu ; le magasin général prévient tout l'arbre dès que la
 * préférence change, et l'affichage suit dans la foulée.
 */

/** Le réglage et son interrupteur. Éteint tant que personne ne l'a allumé. */
export function useModeSimplifie(): [boolean, (valeur: boolean) => void] {
  return usePref<boolean>(MODE_SIMPLIFIE_CLE, false);
}

/** La même réponse, en lecture seule — pour un écran qui ne fait que masquer. */
export function useEstSimplifie(): boolean {
  return useModeSimplifie()[0];
}

/** Lecture ponctuelle, hors composant. */
export function modeSimplifieActif(): boolean {
  return readPref<boolean>(MODE_SIMPLIFIE_CLE, false);
}

/**
 * POSER LE REPÈRE SUR LA RACINE DU DOCUMENT, depuis l'application elle-même et
 * nulle part ailleurs. Il ne cache rien à lui seul : il rend l'état LISIBLE
 * pour une feuille de style et pour un contrôle dans un vrai navigateur, qui ne
 * peuvent pas interroger React.
 */
export function useModeSimplifieApplique(): boolean {
  const actif = useEstSimplifie();
  React.useEffect(() => {
    const racine = document.documentElement;
    if (actif) racine.setAttribute(MODE_SIMPLIFIE_ATTRIBUT, '');
    else racine.removeAttribute(MODE_SIMPLIFIE_ATTRIBUT);
  }, [actif]);
  return actif;
}
