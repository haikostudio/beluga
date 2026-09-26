/**
 * LA DISPOSITION DU TABLEAU : en RANGÉES (les quatre étapes empilées, chacune
 * pleine largeur, cartes alignées de gauche à droite) ou en COLONNES (les
 * quatre étapes côte à côte, cartes empilées de haut en bas, défilement
 * horizontal colonne par colonne).
 *
 * Par défaut, le téléphone lit des colonnes — une colonne tient l'écran et se
 * pousse du doigt — et l'ordinateur des rangées. Un bouton du bandeau du haut
 * bascule de l'une à l'autre ; ce choix est retenu SUR L'APPAREIL (stockage
 * du navigateur), jamais en base : un téléphone et un ordinateur n'ont pas à
 * partager la même disposition.
 *
 * La règle vit ici, sans stockage ni écran : elle se teste seule.
 */

export type DispositionTableau = 'lignes' | 'colonnes';

/** La clé du stockage du navigateur où l'appareil retient son choix. */
export const CLE_DISPOSITION_TABLEAU = 'beluga.disposition-tableau';

/** Une valeur relue du stockage : seules les deux dispositions connues passent. */
export function dispositionValide(brut: unknown): DispositionTableau | null {
  return brut === 'lignes' || brut === 'colonnes' ? brut : null;
}

/**
 * La disposition RÉELLEMENT affichée : le choix retenu sur l'appareil s'il y
 * en a un, sinon le défaut de la largeur d'écran.
 */
export function dispositionDuTableau(choix: unknown, telephone: boolean): DispositionTableau {
  return dispositionValide(choix) ?? (telephone ? 'colonnes' : 'lignes');
}

/** L'autre disposition : ce que pose le bouton de bascule. */
export function autreDisposition(disposition: DispositionTableau): DispositionTableau {
  return disposition === 'lignes' ? 'colonnes' : 'lignes';
}
