import test from 'node:test';
import assert from 'node:assert/strict';
import { fichiersEnConflit } from '../deploy.js';

/* ------------------------------------------------------------------ */
/* Prévoir les conflits avant de cliquer sur « Tout déployer »         */
/* ------------------------------------------------------------------ */

/** Ce que git répond vraiment, relevé sur un dépôt d'essai le 03/08/2026. */
const SORTIE_CONFLIT = [
  'ca4e5094401321037d6b85e2bef5a874f3003566',
  'web/src/styles.css',
  'MEMOIRE.md',
  '',
  'Auto-merging web/src/styles.css',
  'CONFLICT (content): Merge conflict in web/src/styles.css',
].join('\n');

test('les fichiers en conflit sont lus, sans l arbre ni le récit de la fusion', () => {
  assert.deepEqual(fichiersEnConflit(SORTIE_CONFLIT), ['web/src/styles.css', 'MEMOIRE.md']);
});

test('le récit de la fusion ne passe jamais pour un nom de fichier', () => {
  const fichiers = fichiersEnConflit(SORTIE_CONFLIT);
  assert.ok(
    !fichiers.some((fichier) => fichier.startsWith('CONFLICT') || fichier.startsWith('Auto-merging')),
    'une ligne de récit prise pour un fichier afficherait n importe quoi dans la colonne',
  );
});

test('une fusion sans conflit ne nomme aucun fichier', () => {
  assert.deepEqual(fichiersEnConflit('e99bb79851059eaba62b46d2c800cdd742b08ba5\n'), []);
});

test('une sortie vide ne fait pas tomber la prévision', () => {
  assert.deepEqual(fichiersEnConflit(''), []);
});
