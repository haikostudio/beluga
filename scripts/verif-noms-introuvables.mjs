#!/usr/bin/env node
/**
 * AUCUN NOM INTROUVABLE DANS L'INTERFACE.
 *
 * `vite build` ne TYPE PAS le code : il transpile. Un identifiant qui n'existe
 * nulle part (import supprimé par une fusion, composant renommé, aide effacée)
 * passe donc la construction sans un mot, part en ligne, et n'explose qu'AU
 * MOMENT DE L'AFFICHAGE — sur le téléphone de l'utilisateur, en « Liste des
 * projets n'a pas pu s'afficher ». C'est exactement ce qui est arrivé au volet
 * des projets : un bloc de surveillance ressuscité par une fusion appelait
 * `PanneauALaDemande`, dont l'import avait été retiré.
 *
 *   node scripts/verif-noms-introuvables.mjs
 *
 * On ne juge QUE cette famille d'erreurs — TS2304 « Cannot find name » et
 * TS2552 « Cannot find name … Did you mean … ». Les autres refus du typage
 * (variantes de boutons, formes de messages) sont réels mais anciens et sans
 * effet à l'affichage : les inclure ferait un contrôle rouge en permanence,
 * donc un contrôle qu'on n'ouvre plus. Ici, rouge = la page tombe.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où l'on PART : dans une copie de travail, c'est elle qu'on juge. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let sortie = '';
try {
  execFileSync('npx', ['tsc', '--noEmit', '-p', 'web'], { cwd: RACINE, encoding: 'utf8', stdio: 'pipe' });
} catch (erreur) {
  sortie = `${erreur.stdout ?? ''}${erreur.stderr ?? ''}`;
}

const fautifs = sortie
  .split('\n')
  .filter((ligne) => /error TS(2304|2552):/.test(ligne))
  .map((ligne) => ligne.trim());

if (!fautifs.length) {
  console.log('0 nom introuvable dans web/src — aucune page ne tombera là-dessus.');
  process.exit(0);
}

console.error(`${fautifs.length} nom(s) introuvable(s) — la zone qui les affiche TOMBERA :\n`);
for (const ligne of fautifs) console.error(`  ${ligne}`);
console.error('\nChaque ligne est un plantage d’affichage garanti : import manquant, ou reste de fusion à retirer.');
process.exit(1);
