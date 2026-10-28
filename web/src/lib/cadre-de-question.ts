import * as React from 'react';

/**
 * LE CADRE JAUNE D'UNE QUESTION EST PORTÉ PAR LE PANNEAU QUI LA CONTIENT.
 *
 * Partout où une question attend une réponse, un trait jaune la distingue
 * (`.cadre-de-question`, demande du 25/10/2026). Dans le panneau « Une
 * décision attend », posé au-dessus de la barre d'écriture, ce trait entoure
 * désormais le PANNEAU entier (titre compris), et la question qu'il contient
 * n'en porte plus (demande du 27/10/2026, capture #f4a2 : « le cadre jaune doit
 * être autour du composant, pas du cadre intérieur »). Ailleurs — fil, feuille
 * du bas, questions préparées de la carte — la bulle garde le sien.
 */
export const CadreDuPanneau = React.createContext(false);

/** La classe du cadre jaune d'une bulle de question, sauf si un panneau le porte déjà. */
export function useClasseDuCadreDeQuestion(): string | undefined {
  return React.useContext(CadreDuPanneau) ? undefined : 'cadre-de-question';
}
