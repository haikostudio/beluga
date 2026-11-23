import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dependancesDeclarees, dependancesAbsentes, recitDePoseDesDependances } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* Une dépendance déclarée mais jamais installée déclenche l'installation */
/* ------------------------------------------------------------------ */

/*
 * Le 10/09/2026, une carte a ajouté `yazl` et `yauzl` au serveur. Fusionnées,
 * elles n'étaient pas dans `node_modules` ; `tsc` étant là, la publication
 * n'installait rien, et la compilation tombait sur « Cannot find module ».
 */

test('les noms déclarés couvrent dépendances ordinaires et de développement, sans doublon', () => {
  const noms = dependancesDeclarees([
    { dependencies: { yazl: '^3.3.1', zod: '^3' }, devDependencies: { '@types/yazl': '^3.3.1' } },
    { dependencies: { zod: '^3' } },
    null,
    'pas un manifeste',
    { peerDependencies: { react: '*' } },
  ]);
  assert.deepEqual(noms, ['@types/yazl', 'yazl', 'zod']);
});

test('seules les dépendances sans dossier installé sont rendues', () => {
  const presentes = new Set(['zod', 'typescript']);
  const absentes = dependancesAbsentes(
    [{ dependencies: { zod: '^3', yazl: '^3', yauzl: '^3' }, devDependencies: { typescript: '^5' } }],
    (nom) => presentes.has(nom),
  );
  assert.deepEqual(absentes, ['yauzl', 'yazl']);
});

test('tout installé : rien à poser', () => {
  assert.deepEqual(dependancesAbsentes([{ dependencies: { zod: '^3' } }], () => true), []);
});

test('le récit nomme les dépendances et dit l’issue', () => {
  assert.match(recitDePoseDesDependances(['yazl', 'yauzl'], true), /yazl, yauzl.*installées/);
  assert.match(recitDePoseDesDependances(['yazl'], false), /yazl.*a échoué/);
});

test('la publication installe aussi quand une dépendance déclarée manque', () => {
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const SOURCE = fs.readFileSync(path.resolve(ici, '../../src/deploy.ts'), 'utf8');
  const debut = SOURCE.indexOf('async function poserLesOutilsDeConstruction');
  assert.notEqual(debut, -1);
  const corps = SOURCE.slice(debut, SOURCE.indexOf('\n}\n', debut));
  assert.match(corps, /const absentes = dependancesNonInstallees\(cwd\);/);
  assert.match(corps, /if \(!manquants\.length && !absentes\.length\) return natif;/);
});
