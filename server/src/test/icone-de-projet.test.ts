import assert from 'node:assert/strict';
import test from 'node:test';
import { classerIconesDuDepot, meilleureIconeDuDepot } from '@haikodev/shared';

test('un favicon rangé dans public/ passe devant un logo', () => {
  const choisi = meilleureIconeDuDepot(['public/logo.svg', 'public/favicon.svg']);
  assert.equal(choisi, 'public/favicon.svg');
});

test('le favicon de la racine est trouvé (site sans dossier public)', () => {
  assert.equal(meilleureIconeDuDepot(['favicon.ico', 'README.md']), 'favicon.ico');
});

test('les images d’interface ne sont jamais prises pour l’icône du site', () => {
  const chemins = [
    'user/assets/imgs/icon-folder.png',
    'user/assets/imgs/icon-file@2x.png',
    'src/components/icon-phone.png',
  ];
  assert.deepEqual(classerIconesDuDepot(chemins), []);
  assert.equal(meilleureIconeDuDepot(chemins), null);
});

test('rien dans node_modules, .git, dist ou .output', () => {
  const chemins = [
    'node_modules/une-lib/favicon.ico',
    '.git/favicon.png',
    'dist/favicon.svg',
    'web/.output/public/favicon.svg',
  ];
  assert.deepEqual(classerIconesDuDepot(chemins), []);
});

test('une taille proche de 128 px l’emporte sur un 16 px ou un 512 px', () => {
  const classement = classerIconesDuDepot([
    'public/favicon-16x16.png',
    'public/favicon-512x512.png',
    'public/favicon-96x96.png',
  ]);
  assert.equal(classement[0], 'public/favicon-96x96.png');
});

test('le SVG passe devant le PNG et l’ICO, à nom égal', () => {
  const classement = classerIconesDuDepot(['public/favicon.ico', 'public/favicon.png', 'public/favicon.svg']);
  assert.deepEqual(classement, ['public/favicon.svg', 'public/favicon.png', 'public/favicon.ico']);
});

test('un dépôt sans aucune icône ne rend rien : l’écran garde ses initiales', () => {
  assert.equal(meilleureIconeDuDepot(['README.md', 'src/index.ts', 'docs/plan.md']), null);
});

test('les dossiers d’icônes usuels des vrais projets sont couverts', () => {
  assert.equal(meilleureIconeDuDepot(['web/public/icon-192.png']), 'web/public/icon-192.png');
  assert.equal(meilleureIconeDuDepot(['public/favicon/favicon.ico']), 'public/favicon/favicon.ico');
  assert.equal(meilleureIconeDuDepot(['frontend/public/icons/icon-180.png']), 'frontend/public/icons/icon-180.png');
  assert.equal(meilleureIconeDuDepot(['src/app/favicon.ico']), 'src/app/favicon.ico');
});

test('un logo reste retenu quand le dépôt n’a que ça', () => {
  assert.equal(meilleureIconeDuDepot(['public/logo.svg']), 'public/logo.svg');
});
