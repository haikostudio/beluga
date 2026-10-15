/**
 * UN MOT DE PASSE TIRÉ AU HASARD, long et sans signe ambigu.
 *
 * Le bouton « Générer » des champs où l'on CRÉE un mot de passe (création du
 * compte principal, nouveau mot de passe du profil) le remplit dans la saisie
 * ET dans la confirmation, puis les montre en clair pour qu'on le note.
 *
 * - Le hasard vient de `crypto.getRandomValues` (navigateur comme Node 22),
 *   jamais de `Math.random`.
 * - L'alphabet écarte ce qui se confond à la lecture ou à la recopie :
 *   0/O/o, 1/l/I, 5/S, 2/Z, et les symboles qu'un clavier étranger cache.
 * - Chaque famille est présente (minuscule, majuscule, chiffre, symbole) : un
 *   service qui l'exige ne refuse pas ce qu'on lui a proposé.
 * - Le tirage est SANS BIAIS : une valeur qui tomberait dans la part incomplète
 *   du dernier tour est rejetée et retirée.
 *
 * La page de bienvenue, servie par le démon avant l'application, réécrit la
 * même règle en JavaScript en ligne (`server/src/page-installation.ts`).
 */

export const FAMILLES_DU_MOT_DE_PASSE = [
  'abcdefghijkmnpqrstuvwxyz',
  'ABCDEFGHJKLMNPQRTUVWXY',
  '346789',
  '-_.!@#%+=',
] as const;

export const LONGUEUR_DU_MOT_DE_PASSE = 20;

/** Un entier tiré uniformément dans [0, borne). */
function entierAuHasard(borne: number, octets: (tableau: Uint32Array) => Uint32Array): number {
  const plafond = Math.floor(0x1_0000_0000 / borne) * borne;
  const tableau = new Uint32Array(1);
  for (;;) {
    const valeur = octets(tableau)[0];
    if (valeur < plafond) return valeur % borne;
  }
}

/**
 * Le mot de passe. `octets` remplace la source de hasard dans les tests ; une
 * longueur sous le nombre de familles est relevée à ce nombre.
 */
export function genererMotDePasse(
  longueur: number = LONGUEUR_DU_MOT_DE_PASSE,
  octets: (tableau: Uint32Array) => Uint32Array = (tableau) => globalThis.crypto.getRandomValues(tableau),
): string {
  const taille = Math.max(Math.floor(longueur), FAMILLES_DU_MOT_DE_PASSE.length);
  const tous = FAMILLES_DU_MOT_DE_PASSE.join('');
  const signes = FAMILLES_DU_MOT_DE_PASSE.map((famille) => famille[entierAuHasard(famille.length, octets)]);
  while (signes.length < taille) signes.push(tous[entierAuHasard(tous.length, octets)]);
  // Mélange de Fisher-Yates : les familles garanties ne restent pas en tête.
  for (let i = signes.length - 1; i > 0; i -= 1) {
    const j = entierAuHasard(i + 1, octets);
    [signes[i], signes[j]] = [signes[j], signes[i]];
  }
  return signes.join('');
}
