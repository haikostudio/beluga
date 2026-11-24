/**
 * LA TÊTE D'UNE SOUS-PAGE À LA LARGEUR DE SON CONTENU (cadrage du 24/11/2026, maquette #93cf : « aligne et dimensionne
 * le contenu sur la base des autres services pour que les titres et colonnes soient alignés »).
 *
 * Une sous-page dont le corps tient dans la colonne étroite des pages (`CLASSE_LARGEUR_DE_CONTENU`, 820 px) — la fiche
 * d'une demande de la Messagerie — le dit par `useTeteDansLaColonneDeContenu()` : la ligne du titre de la page de
 * service (`fenetre-de-service.tsx`) se resserre sur la même colonne, et le titre, ses gestes et le corps partagent
 * les mêmes bords. Sans ce signal, la tête garde la colonne large du service.
 *
 * UN MODULE À PART, SANS RIEN DEDANS : la porte des clients (`espace/porte-client.tsx`, chargée seule sur
 * le domaine public des clients) emploie la même fiche ; importer la page de service pour ce seul signal lui ferait télécharger
 * tout l'habillage de l'administration.
 */
import * as React from 'react';

export const SignalTeteEtroite = React.createContext<((presente: boolean) => void) | null>(null);

export function useTeteDansLaColonneDeContenu(actif = true): void {
  const signaler = React.useContext(SignalTeteEtroite);
  React.useLayoutEffect(() => {
    if (!actif || !signaler) return;
    signaler(true);
    return () => signaler(false);
  }, [actif, signaler]);
}
