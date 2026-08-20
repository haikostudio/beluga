import test from 'node:test';
import assert from 'node:assert/strict';
import { fichiersAAjouter } from '@haikodev/shared';

test('un statut vide ne rend aucun fichier', () => {
  assert.deepEqual(fichiersAAjouter(''), []);
  assert.deepEqual(fichiersAAjouter('\n\n'), []);
});

test('modifié, supprimé et non suivi rendent chacun leur chemin', () => {
  const porcelain = [
    ' M docs/memoire/conversation.md',
    ' D docs/memoire/divers/divers-agent-arret-question.md',
    '?? docs/memoire/nouveau-fait.md',
  ].join('\n');
  assert.deepEqual(fichiersAAjouter(porcelain), [
    'docs/memoire/conversation.md',
    'docs/memoire/divers/divers-agent-arret-question.md',
    'docs/memoire/nouveau-fait.md',
  ]);
});

test('un renommage rend les deux chemins, ancien puis nouveau', () => {
  const porcelain = 'R  docs/memoire/ancien.md -> docs/memoire/nouveau.md';
  assert.deepEqual(fichiersAAjouter(porcelain), ['docs/memoire/ancien.md', 'docs/memoire/nouveau.md']);
});

test('un chemin avec des espaces reste entier', () => {
  const porcelain = ' M docs/memoire/un dossier/un fichier.md';
  assert.deepEqual(fichiersAAjouter(porcelain), ['docs/memoire/un dossier/un fichier.md']);
});

test('les doublons ne se répètent pas', () => {
  const porcelain = ' M docs/memoire/conversation.md\nMM docs/memoire/conversation.md';
  assert.deepEqual(fichiersAAjouter(porcelain), ['docs/memoire/conversation.md']);
});
