/**
 * L'OFFRE HÉBERGÉE, CÔTÉ DÉMON : la règle pure vit dans `shared/src/offre-hebergee.ts`.
 * Ici, on lit seulement l'environnement du démon, à chaque appel — pour que les
 * essais la posent sans relancer quoi que ce soit, et qu'une variable absente
 * laisse la machine « sur son propre serveur ». Les deux noms de la marque
 * (`BELUGA_OFFRE`, `BELUGA_HEBERGE`) sont lus : voir la règle pure.
 */
import { estMachineHebergee } from '@beluga/shared';

/** Cette machine est-elle sur l'offre hébergée ? Faux partout où rien n'est déclaré. */
export function machineHebergee(): boolean {
  return estMachineHebergee(process.env);
}
