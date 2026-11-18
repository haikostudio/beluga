/**
 * LE MARKDOWN EN LIGNE DES BULLES (`web/src/lib/markdown.tsx`) : gras, code,
 * liens et italique.
 *
 * L'ITALIQUE PAR SOULIGNÉS NE S'OUVRE QU'EN BORDURE DE MOT, comme le veut
 * CommonMark : `userspsy_language_tmp` reste un nom de colonne, jamais
 * « userspsy » suivi de « language » en italique. Un souligné collé à une lettre
 * ou à un chiffre, d'un côté ou de l'autre, n'est qu'un caractère.
 *
 * L'ITALIQUE PAR ÉTOILE SIMPLE (`*à revoir*`, 11/11/2026 — capture #4d55 : les agents l'écrivent ainsi, et
 * l'étoile restait à l'écran) suit la même règle : elle s'ouvre collée au mot qu'elle habille et en bordure
 * de mot ; `3 * 4 * 5` et `*args` restent du texte. Le gras (`**…**`) est essayé AVANT elle.
 */
export const MOTIF_MARKDOWN_EN_LIGNE =
  /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|(?<![\p{L}\p{N}_])_(?!\s)[^_\n]+?(?<!\s)_(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}*])\*(?![\s*])[^*\n]+?(?<![\s*])\*(?![\p{L}\p{N}*]))/gu;
