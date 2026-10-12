#!/usr/bin/env node
/**
 * REDONNE UN MOT DE PASSE À UN COMPTE ADMINISTRATEUR — ou en crée un.
 *
 *   node scripts/set-credentials.mjs                           → le premier administrateur, mot de passe tiré au hasard
 *   node scripts/set-credentials.mjs <identifiant>             → ce compte, mot de passe tiré au hasard
 *   node scripts/set-credentials.mjs <identifiant> <mot de passe>
 *
 * Un identifiant qui n'existe pas encore devient un NOUVEL administrateur. Les
 * sessions du compte touché sont fermées. Le mot de passe s'affiche UNE fois :
 * il n'est gardé nulle part en clair.
 *
 * Se lance SUR LE SERVEUR, sous le compte du service. Sur une installation
 * neuve, le premier compte se crée plutôt dans le navigateur, avec le code
 * d'installation (`node scripts/code-installation.mjs`).
 */
import { openDb } from '../server/dist/db.js';
import {
  compteParIdentifiant,
  creerCompte,
  fermerLesSessions,
  listerComptes,
  reinitialiserLeMotDePasse,
} from '../server/dist/comptes.js';

openDb();
const [identifiantDonne, motDePasseDonne] = process.argv.slice(2);

try {
  const vise = identifiantDonne
    ? compteParIdentifiant(identifiantDonne)
    : (listerComptes().find((compte) => compte.role === 'admin' && compte.actif) ?? null);

  if (vise) {
    if (vise.role !== 'admin') throw new Error(`« ${vise.identifiant} » n'est pas un compte administrateur.`);
    const motDePasse = reinitialiserLeMotDePasse(vise.id, motDePasseDonne || undefined);
    fermerLesSessions(vise.id);
    console.log(JSON.stringify({ username: vise.identifiant, password: motDePasse, cree: false }, null, 2));
  } else {
    if (!identifiantDonne) throw new Error('Aucun administrateur : donnez un identifiant pour en créer un.');
    const cree = creerCompte(
      { identifiant: identifiantDonne, role: 'admin', nomAffiche: identifiantDonne, motDePasse: motDePasseDonne || undefined },
      [],
    );
    console.log(JSON.stringify({ username: cree.compte.identifiant, password: cree.motDePasse, cree: true }, null, 2));
  }
  process.exit(0);
} catch (erreur) {
  console.error(erreur?.message ?? String(erreur));
  process.exit(1);
}
