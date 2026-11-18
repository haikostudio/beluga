/* ------------------------------------------------------------------------- *
 * LE RANGEMENT PAR DERNIÈRE OUVERTURE (colonne de gauche, en bascule).
 *
 * `ouvertLe` est la préférence `projets.ouvertLe` : { identifiant : horodatage
 * en ms }. Rien n'y est écrit par ces règles, et le rang manuel
 * (`rank`) n'est jamais touché : il ne sert que de départage — aux égalités et
 * aux projets jamais ouverts, qui viennent après tous les autres.
 * ------------------------------------------------------------------------- */

/** Les préférences (en base, jamais dans le navigateur) que lisent ces règles. */
export const CLE_OUVERTURES_DE_PROJETS = 'projets.ouvertLe';
/** La colonne de gauche suit la dernière ouverture au lieu de l'ordre manuel (bascule, éteinte par défaut). */
export const CLE_TRI_PAR_OUVERTURE = 'sidebar.triParOuverture';

/** Quand chaque projet a été ouvert pour la dernière fois (ms). */
export type OuverturesDeProjets = Readonly<Record<string, number | undefined>>;

/** Combien d'ouvertures la préférence garde : les plus récentes. */
export const OUVERTURES_RETENUES = 60;


/** L'ouverture la plus récente d'un lot d'identifiants (0 : jamais ouvert). */
function ouvertureLaPlusRecente(ids: readonly string[], ouvertLe: OuverturesDeProjets): number {
  let plus = 0;
  for (const id of ids) {
    const quand = ouvertLe[id];
    if (typeof quand === 'number' && quand > plus) plus = quand;
  }
  return plus;
}

/**
 * Range des ÉLÉMENTS (projets, groupes, blocs) du plus récemment ouvert au plus
 * ancien. `lire` donne les identifiants que l'élément porte (ses membres, pour
 * un groupe) et son rang manuel, qui départage. L'ordre reçu fait foi à rang
 * égal : le tri est stable.
 */
export function ordonnerParDerniereOuverture<T>(
  elements: readonly T[],
  ouvertLe: OuverturesDeProjets,
  lire: (element: T) => { ids: readonly string[]; rang?: number },
): T[] {
  return elements
    .map((element, index) => {
      const { ids, rang } = lire(element);
      return { element, index, ouverture: ouvertureLaPlusRecente(ids, ouvertLe), rang: rang ?? 1000 };
    })
    .sort((a, b) => b.ouverture - a.ouverture || a.rang - b.rang || a.index - b.index)
    .map((ligne) => ligne.element);
}

/**
 * Note qu'un projet vient d'être ouvert. Rend LA MÊME référence quand rien ne
 * change (le projet est déjà le plus récent) : l'appelant n'écrit alors rien.
 * Au-delà de `OUVERTURES_RETENUES`, les plus anciennes sortent.
 */
export function noterOuverture(
  ouvertLe: OuverturesDeProjets,
  id: string,
  maintenant: number,
): OuverturesDeProjets {
  const dernier = Math.max(0, ...Object.values(ouvertLe).map((q) => (typeof q === 'number' ? q : 0)));
  if (ouvertLe[id] !== undefined && ouvertLe[id] === dernier) return ouvertLe;
  const suivant: Record<string, number> = {};
  for (const [cle, quand] of Object.entries(ouvertLe)) if (typeof quand === 'number') suivant[cle] = quand;
  suivant[id] = Math.max(maintenant, dernier + 1);
  const gardes = Object.entries(suivant)
    .sort((a, b) => b[1] - a[1])
    .slice(0, OUVERTURES_RETENUES);
  return Object.fromEntries(gardes);
}

/** Lit la préférence `projets.ouvertLe` telle qu'elle est en base, sans jamais jeter. */
export function ouverturesValides(valeur: unknown): Record<string, number> {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return {};
  const sortie: Record<string, number> = {};
  for (const [cle, quand] of Object.entries(valeur as Record<string, unknown>)) {
    if (typeof quand === 'number' && Number.isFinite(quand) && quand > 0) sortie[cle] = quand;
  }
  return sortie;
}
