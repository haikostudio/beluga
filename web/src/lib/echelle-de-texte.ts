/**
 * L'ÉCHELLE DE TEXTE UNIQUE (décision de l'utilisateur du 03/11/2026 : « c'est quoi cette liberté quant à la taille
 * des polices ? ») — cinq crans, et aucun autre dans les pages des services :
 *
 *  - `TITRE_DE_PAGE` (18 px) : le nom de la page, en tête de son contenu ;
 *  - `TITRE_DE_SECTION` (14 px) : le titre d'un bloc ;
 *  - `TEXTE_COURANT` (13 px) : le texte, ET les titres des lignes d'un tableau — jamais plus gros que le texte ;
 *  - `TEXTE_SECONDAIRE` (12 px) : ce qui accompagne (date, détail, sous-titre) ;
 *  - `LEGENDE` (11 px) : les étiquettes, les compteurs, les en-têtes de colonnes.
 *
 * Contrôle : `scripts/verif-interface-maison.mjs` mesure dans le navigateur qu'aucun titre de ligne de tableau ne
 * dépasse la taille du texte courant.
 */
export const TITRE_DE_PAGE = 'text-[18px] font-semibold leading-tight tracking-tight';
export const TITRE_DE_SECTION = 'text-[14px] font-semibold';
export const TEXTE_COURANT = 'text-[13px]';
export const TEXTE_SECONDAIRE = 'text-[12px]';
export const LEGENDE = 'text-[11px]';
/** La taille maximale (px) d'un titre de ligne de tableau : celle du texte courant. */
export const TAILLE_MAX_TITRE_DE_LIGNE = 13;
