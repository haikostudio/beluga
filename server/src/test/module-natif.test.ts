import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODULE_NATIF,
  moduleNatifMalCompile,
  commandeDEssaiDuModuleNatif,
  commandeDeRecompilation,
  recitDeRecompilation,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Un module natif venu d'un autre Node est reconnu, puis recompilé     */
/* ------------------------------------------------------------------ */

/*
 * Le 14/08/2026, un binaire `better-sqlite3` compilé pour un autre Node est
 * arrivé dans `node_modules` : 87 contrôles sont tombés d'un coup, et la
 * publication n'en a nommé que cinq — tous dans le code des cartes, où il n'y
 * avait rien à réparer. La panne se reconnaît à son message, et la
 * réparation ne peut PAS reprendre un binaire tout fait.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.resolve(ICI, '../../src/deploy.ts'), 'utf8');

const MESSAGE_REEL = [
  "The module '/root/haikodev/node_modules/better-sqlite3/build/Release/better_sqlite3.node'",
  'was compiled against a different Node.js version using',
  'NODE_MODULE_VERSION 137. This version of Node.js requires',
  'NODE_MODULE_VERSION 127. Please try re-compiling or re-installing',
  'the module (for instance, using `npm rebuild` or `npm install`).',
].join('\n');

test('le message d’un binaire compilé pour un autre Node est reconnu', () => {
  assert.equal(moduleNatifMalCompile(MESSAGE_REEL), true);
  assert.equal(moduleNatifMalCompile('code: ERR_DLOPEN_FAILED\nbetter_sqlite3.node'), true);
});

test('un échec ordinaire n’est PAS pris pour un module natif cassé', () => {
  assert.equal(moduleNatifMalCompile(''), false);
  assert.equal(moduleNatifMalCompile('not ok 12 - la carte attend la validation'), false);
  assert.equal(moduleNatifMalCompile('Error: Cannot find module ./db.js'), false);
  // Un `.node` cité sans échec de chargement ne suffit pas.
  assert.equal(moduleNatifMalCompile('build/Release/better_sqlite3.node'), false);
});

test('la réparation recompile depuis les SOURCES, jamais un binaire tout fait', () => {
  const commande = commandeDeRecompilation();
  assert.match(commande, /npm rebuild/);
  assert.match(commande, /--build-from-source/);
  assert.match(commande, new RegExp(MODULE_NATIF));
  // L'essai ne fait qu'ouvrir le module : rien à écrire, rien à installer.
  assert.match(commandeDEssaiDuModuleNatif(), /^node -e "require\('better-sqlite3'\)"$/);
});

test('l’issue de la réparation est DITE, réussie comme échouée', () => {
  assert.match(recitDeRecompilation(true), /recompilée depuis ses sources/);
  assert.match(recitDeRecompilation(false), /recompilation a échoué/);
  assert.notEqual(recitDeRecompilation(true), recitDeRecompilation(false));
});

test('la publication essaie le module natif AVANT de construire', () => {
  assert.match(SOURCE, /const natif = await reparerLeModuleNatif\(cwd\);/);
  // On ne recompile que sur un vrai refus de chargement, jamais d'office.
  assert.match(SOURCE, /if \(essai\.ok \|\| !moduleNatifMalCompile\(essai\.out\)\) return '';/);
});
