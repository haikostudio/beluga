#!/usr/bin/env node
/**
 * TIRE UN CODE D'INSTALLATION NEUF, et l'affiche.
 *
 * Une installation neuve attend que son propriétaire crée le premier compte
 * dans le navigateur, derrière un code à usage unique. Ce code ne s'affiche
 * qu'une fois, à la fin de l'installation : ce script en tire un autre, qui
 * REMPLACE le précédent. Il se lance SUR LE SERVEUR, sous le compte du
 * service — il faut déjà avoir la main sur la machine pour s'en servir.
 *
 *   node scripts/code-installation.mjs            → le code, et rien d'autre
 *   node scripts/code-installation.mjs --phrase   → le code dans une phrase
 *   node scripts/code-installation.mjs --lien     → le lien prêt à cliquer
 *
 * LE LIEN porte le code dans l'adresse (`…/?installation=<code>`) : ouvert dans
 * un navigateur, il mène droit à la création du compte, sans rien recopier.
 * L'adresse est celle que l'installation connaît (`BELUGA_ADRESSE_PUBLIQUE`,
 * sinon ses réglages) ; faute d'adresse, le code seul est rendu.
 *
 * Dès qu'un administrateur existe, il n'y a plus de code : le script le dit et
 * rend le code de sortie 3. Un mot de passe oublié se refait avec
 * `node scripts/set-credentials.mjs`.
 */
import { openDb } from '../server/dist/db.js';
import { renouvelerLeCodeDInstallation } from '../server/dist/installation.js';
import { getSettings } from '../server/dist/store.js';

openDb();
const code = renouvelerLeCodeDInstallation();
if (!code) {
  console.error("Cette installation a déjà son compte principal : il n'y a plus de code d'installation.");
  process.exit(3);
}
if (process.argv.includes('--lien')) {
  const adresse = String(process.env.BELUGA_ADRESSE_PUBLIQUE || getSettings().installation?.adressePublique || '').replace(/\/+$/, '');
  console.log(adresse ? `${adresse}/?installation=${code}` : code);
} else {
  console.log(process.argv.includes('--phrase') ? `Code d'installation : ${code}` : code);
}
process.exit(0);
