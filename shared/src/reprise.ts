import { COLUMN_KEYS, ColumnKey } from './columns.js';

/**
 * Retrouver l'endroit quitté.
 *
 * Trois repères sont retenus dans la table des préférences (côté serveur,
 * jamais dans le navigateur, voir [[projet-actif]]) : la colonne du tableau
 * qu'on regardait, la carte ouverte, et l'onglet du téléphone. Chacun se
 * relit avec méfiance : une colonne renommée, une carte supprimée ou un
 * onglet disparu ne doivent jamais bloquer l'ouverture.
 *
 * Les décisions vivent ici, sans réseau ni base : elles se testent seules.
 */

/** Colonne du tableau regardée, retenue projet par projet. */
export const cleColonneTableau = (projectId: string): string => `board.column.${projectId}`;

/** Carte ouverte dans le tiroir, retenue projet par projet. */
export const cleCarteOuverte = (projectId: string): string => `card.open.${projectId}`;

/** Onglet du bas sur téléphone. */
export const CLE_ONGLET_MOBILE = 'mobile.view';

/**
 * La colonne à retrouver. Le réglage enregistré peut nommer une colonne qui
 * n'existe plus : on rend alors null, et l'appelant garde son comportement
 * habituel (« Planifié » sur téléphone).
 */
export function colonneAReprendre(memorise: unknown): ColumnKey | null {
  return typeof memorise === 'string' && (COLUMN_KEYS as readonly string[]).includes(memorise)
    ? (memorise as ColumnKey)
    : null;
}

/** Le strict minimum dont la reprise d'une carte a besoin. */
export interface CarteReprenable {
  id: string;
  projectId: string;
}

/**
 * La carte à rouvrir. Elle doit exister ENCORE et appartenir au projet
 * affiché : une carte supprimée, ou celle d'un autre projet, laisse le tiroir
 * fermé sans le moindre message.
 */
export function carteAReprendre(
  memorise: unknown,
  cartes: CarteReprenable[],
  projectId: string | null,
): string | null {
  if (typeof memorise !== 'string' || !projectId) return null;
  const carte = cartes.find((c) => c.id === memorise);
  return carte && carte.projectId === projectId ? carte.id : null;
}

/**
 * L'onglet à retrouver, parmi ceux qui existent VRAIMENT aujourd'hui : la
 * barre du bas change avec le temps, et un onglet retiré ne doit pas ouvrir
 * l'application sur du vide.
 */
export function ongletAReprendre<T extends string>(memorise: unknown, autorises: readonly T[], defaut: T): T {
  return typeof memorise === 'string' && (autorises as readonly string[]).includes(memorise)
    ? (memorise as T)
    : defaut;
}
