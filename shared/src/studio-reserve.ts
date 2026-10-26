/**
 * LE SUPER ADMINISTRATEUR (le Studio, qu'il gardait, est retiré depuis le
 * 26/10/2026 ; le drapeau `studioOuvert` envoyé à l'écran le désigne encore).
 *
 * Deux rôles seulement existent (`RoleCompte` : administrateur, client), et
 * chaque installation de Beluga a son propre administrateur : le rôle ne
 * distingue donc pas le développeur de l'outil de ceux qui l'installent. Le
 * super administrateur est désigné PAR L'ENVIRONNEMENT DU DÉMON — jamais depuis
 * un écran, jamais dans le code publié — par l'identifiant de son compte.
 * Liste vide (le cas de toute autre installation) : personne.
 *
 * Le droit est PAR COMPTE : deux administrateurs d'une même machine n'ont pas
 * le même résultat. Un seul prédicat le porte, côté serveur comme côté écran.
 */

/** La variable du démon qui nomme les comptes super administrateurs (identifiants séparés par des virgules). */
export const VARIABLE_SUPER_ADMIN = 'BELUGA_SUPER_ADMIN';

/** Les identifiants désignés, lus dans une valeur brute d'environnement. */
export function identifiantsSuperAdmin(brut: string | undefined | null): string[] {
  return (brut ?? '')
    .split(/[,;\s]+/)
    .map((identifiant) => identifiant.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Ce compte est-il super administrateur ? Vrai seulement pour un administrateur
 * ACTIF dont l'identifiant figure dans la liste désignée.
 */
export function estSuperAdministrateur(
  compte: { role: string; actif: boolean; identifiant: string } | null | undefined,
  designes: readonly string[],
): boolean {
  if (!compte || compte.role !== 'admin' || !compte.actif) return false;
  return designes.includes(compte.identifiant.trim().toLowerCase());
}

