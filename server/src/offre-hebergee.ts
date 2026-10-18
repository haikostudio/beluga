/**
 * L'OFFRE HÉBERGÉE, CÔTÉ DÉMON : la règle pure vit dans `shared/src/offre-hebergee.ts`.
 * Ici, on lit seulement l'environnement du démon, à chaque appel — pour que les
 * essais la posent sans relancer quoi que ce soit, et qu'une variable absente
 * laisse la machine « sur son propre serveur ».
 */
import { VARIABLE_OFFRE, estOffreHebergee } from '@beluga/shared';

/** Cette machine est-elle sur l'offre hébergée ? Faux partout où rien n'est déclaré. */
export function machineHebergee(): boolean {
  return estOffreHebergee(process.env[VARIABLE_OFFRE]);
}
