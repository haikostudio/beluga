/**
 * LA BASE RÉELLEMENT SERVIE, RÉSOLUE COMME LE DÉMON LA RÉSOUT.
 *
 * Deux pièges, et les deux ont déjà coûté un diagnostic faux :
 *
 *  1. LE DOSSIER. Un script lancé depuis une COPIE DE TRAVAIL de carte
 *     (`.worktrees/<carte>`) a sous les pieds un `data/` vide : la requête rend
 *     « 0 ligne » exactement comme une donnée absente, et la conclusion est
 *     l'inverse de la vérité. On remonte donc au dépôt PRINCIPAL, lu dans le
 *     marqueur `.git` de la copie — sans lancer git.
 *  2. LE FICHIER. La base s'appelle `beluga.db` (`cheminDeLaBase`,
 *     `server/src/config.ts`) : aucun autre nom n'est cherché.
 *
 * `BELUGA_DATA` l'emporte sur tout, comme pour le démon.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Le dépôt d'où part ce script — le principal, jamais la copie de carte. */
export function depotPrincipal() {
  const ici = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const marqueur = path.join(ici, '.git');
  try {
    if (!fs.statSync(marqueur).isFile()) return ici;
    // « gitdir: /root/beluga/.git/worktrees/<carte> » → « /root/beluga »
    const gitdir = /gitdir:\s*(.+)/.exec(fs.readFileSync(marqueur, 'utf8'))?.[1]?.trim();
    if (!gitdir) return ici;
    const principal = path.resolve(gitdir, '..', '..', '..');
    return fs.existsSync(path.join(principal, '.git')) ? principal : ici;
  } catch {
    return ici;
  }
}

function pleine(fichier) {
  try {
    return fs.statSync(fichier).size > 0;
  } catch {
    return false;
  }
}

/** Le dossier de données réellement servi. */
export function dossierDeDonnees() {
  const impose = process.env.BELUGA_DATA?.trim();
  return impose || path.join(depotPrincipal(), 'data');
}

/** Le chemin COMPLET de la base servie — à recopier dans tout rapport. */
export function cheminDeLaBaseServie() {
  const dossier = dossierDeDonnees();
  return path.join(dossier, 'beluga.db');
}
