import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAUSES_NOMMEES_MAX,
  causesDeConstruction,
  consigneDeReparationConstruction,
  detailDEchecConstruction,
  phraseDEchecConstruction,
} from '@haikodev/shared';
import { REPARATIONS_MAX } from '../deploy.js';

/* ------------------------------------------------------------------ */
/* Une construction cassée est réparée, comme un conflit                */
/* ------------------------------------------------------------------ */

/*
 * La publication avait deux secours — le conflit de fusion et les contrôles
 * tombés — et un trou : l'étape « Construction ». Un `npm run build` en échec
 * jetait « La construction a échoué » et tout s'arrêtait, même quand la cause
 * n'avait rien à voir avec le code (fichier temporaire illisible sur
 * haiko-compta : `EACCES: permission denied, open '…/.tmp/tsconfig.node…'`).
 *
 * Le refus, lui, ne bouge pas : au bout de `REPARATIONS_MAX` passes, rien n'est
 * mis en ligne — mais le message NOMME ce qui bloque encore.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.resolve(ICI, '../../src/deploy.ts'), 'utf8');

const SORTIE_EACCES = [
  '> haiko-compta@1.0.0 build',
  '> tsc -b && vite build',
  '',
  'node_modules/.tmp/tsconfig.node.tsbuildinfo',
  "error during build:",
  "EACCES: permission denied, open '/root/haiko-compta/node_modules/.tmp/tsconfig.node.tsbuildinfo'",
  '    at Object.openSync (node:fs:600:3)',
  'npm ERR! code 1',
].join('\n');

/* --- La règle pure : nommer la cause -------------------------------- */

test('la cause d’une construction cassée est relevée dans la sortie', () => {
  const causes = causesDeConstruction(SORTIE_EACCES);
  assert.ok(
    causes.some((c) => c.includes('EACCES: permission denied')),
    'le fichier illisible doit être nommé',
  );
});

test('une même erreur répétée n’est nommée qu’une fois', () => {
  const sortie = [SORTIE_EACCES, SORTIE_EACCES].join('\n');
  const causes = causesDeConstruction(sortie);
  const eacces = causes.filter((c) => c.includes('EACCES'));
  assert.equal(eacces.length, 1);
});

test('un outil absent et une erreur de type sont reconnus aussi', () => {
  assert.ok(causesDeConstruction('sh: 1: tsc: not found').length >= 1);
  const ts = causesDeConstruction("src/a.ts(12,3): error TS2345: Argument of type 'x' is not assignable.");
  assert.ok(ts.some((c) => c.includes('error TS2345')));
});

test('la phrase d’échec nomme la cause, et ne met toujours rien en ligne', () => {
  const phrase = phraseDEchecConstruction(SORTIE_EACCES);
  assert.match(phrase, /EACCES: permission denied/);
  assert.match(phrase, /Rien n’est mis en ligne/);
});

test('sans cause reconnue, la phrase reste générique — jamais un blanc', () => {
  const phrase = phraseDEchecConstruction('construction interrompue, sortie illisible');
  assert.equal(phrase, 'La construction a échoué : rien n’est mis en ligne.');
});

test('le détail pose les causes EN TÊTE, avant la fin de la sortie brute', () => {
  const detail = detailDEchecConstruction(SORTIE_EACCES);
  const tete = detail.indexOf('Ce qui a cassé la construction');
  const brut = detail.indexOf('Fin de la sortie');
  assert.ok(tete !== -1 && brut !== -1 && tete < brut);
});

test('on ne nomme jamais plus de CAUSES_NOMMEES_MAX causes dans le détail', () => {
  const sortie = Array.from({ length: 12 }, (_, i) => `error TS${1000 + i}: souci numéro ${i}`).join('\n');
  const detail = detailDEchecConstruction(sortie);
  const nommees = detail.split('\n').filter((l) => l.startsWith('- error TS'));
  assert.equal(nommees.length, CAUSES_NOMMEES_MAX);
  assert.match(detail, /et \d+ autres/);
});

/* --- Le branchement dans la publication ----------------------------- */

test('une construction en échec appelle un agent de publication, jusqu’à REPARATIONS_MAX passes', () => {
  assert.match(SOURCE, /async function reparerLaConstruction\(/, 'la construction a son agent de secours');
  assert.match(
    SOURCE,
    /for \(let passe = 1; !build\.ok && passe <= REPARATIONS_MAX; passe\+\+\)/,
    'même nombre de passes que les contrôles',
  );
  assert.match(SOURCE, /const repare = await reparer\(projectId, cwd, commande, build\.out, passe\)/);
  // Une passe qui n'a même pas pu lancer son agent ne se rejoue pas indéfiniment.
  assert.match(SOURCE, /if \(!repare\.tente\) break;/);
  assert.ok(REPARATIONS_MAX >= 1 && REPARATIONS_MAX <= 5);
});

test('l’agent de réparation n’a pas le droit de désactiver la construction', () => {
  const consigne = consigneDeReparationConstruction('npm run build', SORTIE_EACCES, 1, REPARATIONS_MAX);
  assert.match(consigne, /Ne désactive JAMAIS la construction/);
  assert.match(consigne, /Ne publie pas, ne redémarre rien/);
  assert.match(consigne, /jamais `git add -A`/, 'le dossier du projet est partagé');
  assert.match(consigne, /passe 1 sur 2/, 'l’agent sait combien de passes il reste');
  assert.match(consigne, /EACCES: permission denied/, 'la cause est NOMMÉE à l’agent');
  assert.match(consigne, /npm run build/, 'la commande qui échoue est nommée');
});

test('la publication passe toujours par l’agent, jamais par la réparation d’essai', () => {
  const debut = SOURCE.indexOf('async function reparerLaConstruction');
  assert.notEqual(debut, -1);
  const corps = SOURCE.slice(debut, SOURCE.indexOf('\n}\n', debut));
  // Le rôle « deploy » est posé par la fabrique commune, qui choisit AUSSI le
  // moteur : c'est elle qui garantit qu'aucun secours ne part sur un compte à sec.
  assert.match(corps, /await agentDePublication\(/, 'le secours passe par la fabrique de publication');
  assert.match(SOURCE, /async function agentDePublication\([\s\S]*?role: 'deploy'/, 'la fabrique pose le rôle « deploy »');
  assert.match(corps, /consigneDeReparationConstruction\(commande, sortie, passe, REPARATIONS_MAX\)/);
  assert.match(SOURCE, /reparer = reparerLaConstruction/, 'la réparation par défaut est le vrai agent');
});

test('les TROIS endroits qui construisent passent par la réparation', () => {
  const appels = SOURCE.match(/await construireAvecReparation\(/g) ?? [];
  assert.equal(appels.length, 3, 'HaikoDev lui-même, un projet ordinaire, ET une cible SSH/FTP de mise en production');
  assert.equal(
    (SOURCE.match(/runCommand\(cwd, 'npm run build'/g) ?? []).length,
    0,
    'plus aucune construction lancée sans secours',
  );
});

test('le refus final ne s’assouplit pas : il nomme la cause et arrête tout', () => {
  assert.equal((SOURCE.match(/if \(!build\.ok\) throw new Error\(build\.phrase\);/g) ?? []).length, 3);
  assert.match(SOURCE, /detailDEchecConstruction\(build\.out\)/);
});

test('la sortie de la construction est gardée ENTIÈRE pendant le travail', () => {
  const debut = SOURCE.indexOf('async function construireAvecReparation');
  assert.notEqual(debut, -1);
  const corps = SOURCE.slice(debut, SOURCE.indexOf('\n}\n', debut));
  for (const appel of corps.match(/runCommand\([^;]*?\)/gs) ?? []) {
    assert.match(appel, /Infinity/, 'les causes sont écrites au MILIEU de la sortie, pas à la fin');
  }
});

test('la pose des outils de construction n’a pas bougé', () => {
  assert.match(SOURCE, /const pose = await poserLesOutilsDeConstruction\(cwd\);/);
  assert.match(SOURCE, /construireAvecReparation\(project\.id, cwd, 'npm run build', pose\)/);
});
