import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTENSIONS_MARKDOWN, estMarkdown, formatParDefaut } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Un fichier Markdown s'ouvre mis en page                              */
/* ------------------------------------------------------------------ */

test('les extensions courantes du Markdown sont reconnues', () => {
  for (const ext of EXTENSIONS_MARKDOWN) {
    assert.equal(estMarkdown(`document${ext}`), true, ext);
  }
});

test('la casse et le chemin ne trompent pas la reconnaissance', () => {
  assert.equal(estMarkdown('DOCUMENTATION.MD'), true);
  assert.equal(estMarkdown('/root/invia/ETUDE-WORDPRESS.md'), true);
  assert.equal(estMarkdown('  MEMOIRE.md  '), true);
});

test('une adresse avec paramètres reste jugeable', () => {
  assert.equal(estMarkdown('/api/file?path=notes.md'), false, 'le nom est pris tel quel');
  assert.equal(estMarkdown('notes.md?v=2'), true);
});

test('le type déclaré suffit quand le nom ne dit rien', () => {
  assert.equal(estMarkdown('piece-jointe', 'text/markdown'), true);
  assert.equal(estMarkdown('piece-jointe', 'text/plain'), false);
});

test('les autres fichiers ne sont pas du Markdown', () => {
  for (const nom of ['index.ts', 'photo.png', 'notes.txt', 'README', 'archive.tar.gz']) {
    assert.equal(estMarkdown(nom), false, nom);
  }
});

test('un fichier Markdown s’ouvre en vue mise en page', () => {
  assert.equal(formatParDefaut('DOCUMENTATION.md'), 'visuel');
});

test('tout le reste s’ouvre en texte brut', () => {
  assert.equal(formatParDefaut('serveur.ts'), 'markdown');
  assert.equal(formatParDefaut('notes.txt'), 'markdown');
});
