/**
 * LE MARKDOWN EN LIGNE DES BULLES (`web/src/lib/markdown.tsx`) : gras, code,
 * liens et italique.
 *
 * L'ITALIQUE PAR SOULIGNÉS NE S'OUVRE QU'EN BORDURE DE MOT, comme le veut
 * CommonMark : `userspsy_language_tmp` reste un nom de colonne, jamais
 * « userspsy » suivi de « language » en italique. Un souligné collé à une lettre
 * ou à un chiffre, d'un côté ou de l'autre, n'est qu'un caractère.
 */
export const MOTIF_MARKDOWN_EN_LIGNE =
  /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|(?<![\p{L}\p{N}_])_(?!\s)[^_\n]+?(?<!\s)_(?![\p{L}\p{N}_]))/gu;
