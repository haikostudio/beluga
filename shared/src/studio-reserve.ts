/**
 * LE STUDIO EST RÉSERVÉ AU SUPER ADMINISTRATEUR.
 *
 * Deux rôles seulement existent (`RoleCompte` : administrateur, client), et
 * chaque installation de Beluga a son propre administrateur : le rôle ne
 * distingue donc pas le développeur de l'outil de ceux qui l'installent. Le
 * super administrateur est désigné PAR L'ENVIRONNEMENT DU DÉMON — jamais depuis
 * un écran, jamais dans le code publié — par l'identifiant de son compte.
 * Liste vide (le cas de toute autre installation) : personne, donc le Studio
 * n'y paraît jamais.
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

/** Cette commande du protocole appartient-elle au Studio ? Toutes se nomment « studio.… ». */
export function commandeDuStudio(type: string): boolean {
  return type.startsWith('studio.');
}

/** Cet événement diffusé appartient-il au Studio (`studio`, `studio.navigateur`) ? */
export function evenementDuStudio(type: string): boolean {
  return type === 'studio' || type.startsWith('studio.');
}

/** Cette route `/api/` appartient-elle au Studio ? */
export function routeApiDuStudio(route: string): boolean {
  return route === '/api/studio' || route.startsWith('/api/studio/');
}

/**
 * LE SERVICE D'UNE CARTE, VU PAR CE COMPTE : la carte d'un agent de volet
 * « Studio » se montre comme une carte ordinaire (ni badge, ni renvoi vers un
 * écran fermé) quand le Studio ne lui est pas ouvert.
 */
export function serviceVisible<S extends string>(service: S | null, studioOuvert: boolean): S | null {
  return service === 'studio' && !studioOuvert ? null : service;
}
