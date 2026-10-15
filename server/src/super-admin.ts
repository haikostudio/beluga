/**
 * LE SUPER ADMINISTRATEUR, CÔTÉ DÉMON.
 *
 * La règle pure vit dans `shared/src/studio-reserve.ts`. Ici, on ne fait que
 * lire la désignation dans l'environnement du démon : relue à chaque appel,
 * pour que les essais la posent sans relancer quoi que ce soit, et pour qu'une
 * variable absente ne désigne personne.
 */
import {
  VARIABLE_SUPER_ADMIN,
  estSuperAdministrateur,
  identifiantsSuperAdmin,
  type CompteUtilisateur,
} from '@beluga/shared';

/** Ce compte peut-il se servir du Studio ? Faux pour tout autre compte, et partout où rien n'est désigné. */
export function compteEstSuperAdministrateur(compte: Pick<CompteUtilisateur, 'role' | 'actif' | 'identifiant'> | null | undefined): boolean {
  return estSuperAdministrateur(compte, identifiantsSuperAdmin(process.env[VARIABLE_SUPER_ADMIN]));
}
