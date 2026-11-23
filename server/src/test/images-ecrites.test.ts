import test from 'node:test';
import assert from 'node:assert/strict';
import { cheminsDImages } from '@beluga/shared';

test('les chemins d’image se retrouvent dans une commande, dans leur ordre, sans doublon', () => {
  const rendu = cheminsDImages(
    'node verif.mjs --out=/tmp/essai/accueil.png && cp /tmp/essai/accueil.png data/vue.JPG',
    'Capture écrite : "/tmp/essai/liste.webp".',
  );
  assert.deepEqual(rendu, ['/tmp/essai/accueil.png', 'data/vue.JPG', '/tmp/essai/liste.webp']);
});

test('ce qui n’est pas une capture est écarté', () => {
  const rendu = cheminsDImages(
    'ls node_modules/x/logo.png .git/objects/a.png dist/b.png /tmp/*.png $DIR/c.png https://site.fr/d.png src/index.ts',
  );
  assert.deepEqual(rendu, []);
});

test('une entrée vide ou absente ne casse rien', () => {
  assert.deepEqual(cheminsDImages(undefined, null, ''), []);
});

test('une image suivie par le dépôt et inchangée n’est pas une capture ; retouchée, elle l’est', async () => {
  const { cheminsDuStatutGit, cheminsSeparesParNul, imageDuDepotInchangee } = await import('@beluga/shared');
  const suivis = cheminsSeparesParNul('public/icone.png\0docs/captures/boite.png\0src/a.ts\0');
  const modifies = cheminsDuStatutGit(' M public/icone.png\0?? essai/nouvelle.png\0R  docs/neuve.png\0docs/vieille.png\0');
  const depot = { suivis, modifies };
  assert.equal(imageDuDepotInchangee('docs/captures/boite.png', depot), true);
  assert.equal(imageDuDepotInchangee('./docs/captures/boite.png', depot), true);
  assert.equal(imageDuDepotInchangee('public/icone.png', depot), false, 'retouchée par l’agent');
  assert.equal(imageDuDepotInchangee('essai/nouvelle.png', depot), false, 'hors du dépôt');
  assert.ok(modifies.has('docs/vieille.png') && modifies.has('docs/neuve.png'), 'un renommage compte ses deux chemins');
});

test('le nettoyage ne retire que les images du dépôt qu’aucune étape n’a regardées', async () => {
  const { piecesDuDepotARetirer } = await import('@beluga/shared');
  const pieces = new Map([
    ['a', { id: 'a', sha: 'S-icone', name: 'icone.png', mime: 'image/png' }],
    ['b', { id: 'b', sha: 'S-boite', name: 'boite.png', mime: 'image/png' }],
    ['c', { id: 'c', sha: 'S-vraie', name: 'accueil.png', mime: 'image/png' }],
    ['d', { id: 'd', sha: 'S-doc', name: 'notes.pdf', mime: 'application/pdf' }],
    ['e', { id: 'e', sha: 'S-regardee', name: 'liste.png', mime: 'image/png' }],
  ]);
  const message = {
    attachments: ['a', 'b', 'c', 'd', 'e', 'inconnue'],
    steps: [{ capture: '/tmp/x/boite.png' }, { capture: '/w/liste.png', capturePiece: 'e' }],
  };
  const depot = new Set(['S-icone', 'S-boite', 'S-doc', 'S-regardee']);
  assert.deepEqual(piecesDuDepotARetirer(message, pieces, depot), ['a']);
  assert.deepEqual(piecesDuDepotARetirer({ attachments: [] }, pieces, depot), []);
});

test('les vidéos et les sons écrits par une commande se retrouvent aussi dans son texte', () => {
  assert.deepEqual(cheminsDImages('ffmpeg -i in.wav -y out/rendu.mp4 && cp voix.mp3 /tmp/voix-off.m4a'), [
    'in.wav',
    'out/rendu.mp4',
    'voix.mp3',
    '/tmp/voix-off.m4a',
  ]);
  assert.deepEqual(cheminsDImages('notes.txt build.zip'), []);
});
