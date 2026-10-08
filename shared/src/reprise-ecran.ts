/**
 * LES ÉCRANS QUI SE RELISENT APRÈS UNE COUPURE.
 *
 * Le Studio et le Marketing ne se rechargent que sur un signal « ça a changé »
 * (événements `studio`, `marketing`), qui fait avancer un numéro de version
 * dans l'état du client. Un signal émis pendant une coupure du canal est perdu,
 * et rien ne le renvoie : un agent qui finissait une vidéo laissait l'écran sur
 * l'ancienne version (création cre3de7e25f64, 08/10/2026).
 *
 * À CHAQUE RECONNEXION (jamais à la toute première connexion), le client avance
 * donc tous ces numéros d'un cran : chaque écran ouvert relit ses données. La
 * création ouverte n'a pas de numéro tant qu'aucun signal ne l'a nommée : elle
 * lit en plus `reprise`, qui avance à chaque reconnexion.
 */
export function numerosApresReprise(
  studio: Readonly<Record<string, number>>,
  marketing: Readonly<Record<string, number>>,
  projets: readonly string[],
): { studioVersions: Record<string, number>; marketingVersions: Record<string, number> } {
  const studioVersions: Record<string, number> = {};
  for (const cle of new Set([...Object.keys(studio), '*', 'reprise', 'bibliotheque'])) studioVersions[cle] = (studio[cle] ?? 0) + 1;
  const marketingVersions: Record<string, number> = {};
  for (const cle of new Set([...Object.keys(marketing), ...projets])) marketingVersions[cle] = (marketing[cle] ?? 0) + 1;
  return { studioVersions, marketingVersions };
}
