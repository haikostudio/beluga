/**
 * LES POINTS DE COULEUR D'UN CHOIX (demande du 29/10/2026, capture #b2e5).
 *
 * Une question qui propose des COULEURS (« vert franc / rouge vif », « bleu
 * nuit ») se lisait en mots seuls : on choisissait une teinte sans la voir.
 * Chaque option d'`ask_user` peut désormais porter « couleurs » : une à quatre
 * teintes, dessinées en petits points ronds devant le libellé.
 *
 * C'est une exception de CONTENU à la palette monochrome + violet (MEM-4699) :
 * ces points montrent la couleur PROPOSÉE, pas l'habillage de l'application.
 *
 * Seul le format « #rrggbb » passe (l'abrégé « #rgb » est déplié) : une valeur
 * mal formée est ignorée en silence, elle ne casse jamais l'affichage.
 */

/** Combien de points une option porte au plus. */
export const COULEURS_PAR_OPTION_MAX = 4;

/** Une teinte « #rrggbb » en minuscules, ou rien. */
export function couleurValide(valeur: unknown): string | undefined {
  if (typeof valeur !== 'string') return undefined;
  const brut = valeur.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(brut)) return brut;
  if (/^#[0-9a-f]{3}$/.test(brut)) return `#${brut[1]}${brut[1]}${brut[2]}${brut[2]}${brut[3]}${brut[3]}`;
  return undefined;
}

/** Les teintes valides d'une option (1 à 4), ou rien quand aucune ne tient. */
export function couleursDOption(valeur: unknown): string[] | undefined {
  const liste = Array.isArray(valeur) ? valeur : typeof valeur === 'string' ? [valeur] : [];
  const gardees = liste.map(couleurValide).filter((c): c is string => !!c).slice(0, COULEURS_PAR_OPTION_MAX);
  return gardees.length ? gardees : undefined;
}
