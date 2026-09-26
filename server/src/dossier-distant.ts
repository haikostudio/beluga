/**
 * CE DOSSIER EST-IL SERVI PAR LE RÉSEAU ?
 *
 * Dix-sept des vingt-deux projets actifs ont leur dépôt sur un montage
 * `fuse.sshfs` (Hetzner Storage Box) : `/root/projeta-saas`, `/root/formations`,
 * `/root/la-roma`… Toute commande git qui parcourt l'arbre y paie une latence
 * réseau par fichier SUIVI — `git status --porcelain` dépasse les trois
 * minutes sur projeta-saas (37 127 fichiers) alors qu'il rend la main en une
 * seconde sur les dépôts posés sur `/dev/sda1` (`/root/beluga`, `/root/peitho`…).
 *
 * Un plafond de commande ne se mesure donc PAS en valeur unique : il se mesure
 * au TYPE DU SYSTÈME DE FICHIERS qui porte le dépôt. La règle pure
 * (`lireLesMontages`, `typeDuSystemeDeFichiers`, `estSystemeDeFichiersDistant`)
 * vit dans `shared/` ; ici on lit `/proc/mounts` et l'on garde la réponse : les
 * montages ne changent pas en cours de publication. `BELUGA_DEPOT_DISTANT=1`
 * force la réponse, c'est ce qui permet aux tests de la rejouer sans stockage
 * distant.
 */

import fs from 'node:fs';
import { estSystemeDeFichiersDistant, lireLesMontages, type MontageDuSysteme } from '@beluga/shared';

/** Les montages de la machine, relus au plus une fois par minute. */
let montagesEnCache: { a: number; liste: MontageDuSysteme[] } | undefined;
const FRAICHEUR_DES_MONTAGES_MS = 60_000;

function montages(): MontageDuSysteme[] {
  const maintenant = Date.now();
  if (montagesEnCache && maintenant - montagesEnCache.a < FRAICHEUR_DES_MONTAGES_MS) return montagesEnCache.liste;
  let liste: MontageDuSysteme[] = [];
  try {
    liste = lireLesMontages(fs.readFileSync('/proc/mounts', 'utf8'));
  } catch {
    liste = [];
  }
  montagesEnCache = { a: maintenant, liste };
  return liste;
}

/** Ce dossier est-il servi par le réseau (sshfs, nfs, cifs…) ? */
