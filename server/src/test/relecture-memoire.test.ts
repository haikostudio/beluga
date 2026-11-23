import assert from 'node:assert/strict';
import test from 'node:test';
import { cheminsCites, verdictMecanique } from '@beluga/shared';

test('les chemins cités se lisent dans le texte, sans doublon ni suffixe de ligne', () => {
  const texte =
    'Voir `server/src/connaissances.ts:218` puis web/src/components/memoire-classeurs.tsx. Et encore server/src/connaissances.ts, ' +
    'le contrôle `scripts/verif-ecran-connaissances.mjs`, une adresse https://exemple.com/server/x.ts et un motif server/src/*.ts.';
  assert.deepEqual(cheminsCites(texte), [
    'server/src/connaissances.ts',
    'web/src/components/memoire-classeurs.tsx',
    'scripts/verif-ecran-connaissances.mjs',
  ]);
  assert.deepEqual(cheminsCites('Rien à citer ici.'), []);
});

test('le verdict mécanique ne retire qu’une unité de projet dont TOUS les fichiers ont disparu, jamais une P0 ni une du global', () => {
  const existe = (c: string) => c.startsWith('server/');
  const dossierExiste = (d: string) => d === 'server' || d === 'web';
  assert.equal(verdictMecanique({ chemins: [], existe, dossierExiste }), 'indecidable');
  assert.equal(verdictMecanique({ chemins: ['server/a.ts', 'server/b.ts'], existe, dossierExiste }), 'juste');
  assert.equal(verdictMecanique({ chemins: ['web/a.tsx'], existe, dossierExiste }), 'obsolete');
  assert.equal(verdictMecanique({ chemins: ['web/a.tsx'], existe, dossierExiste, importance: 'P0' }), 'indecidable');
  assert.equal(verdictMecanique({ chemins: ['web/a.tsx'], existe, dossierExiste, retraitPermis: false }), 'indecidable');
  // Un chemin relatif à autre chose (le dossier d'une compétence) ne prouve rien.
  assert.equal(verdictMecanique({ chemins: ['scripts/build_index.py'], existe, dossierExiste }), 'indecidable');
  assert.equal(verdictMecanique({ chemins: ['server/a.ts', 'web/a.tsx'], existe, dossierExiste }), 'indecidable');
});
