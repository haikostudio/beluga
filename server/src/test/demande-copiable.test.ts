import test from 'node:test';
import assert from 'node:assert/strict';
import {
  demandeCopiable,
  htmlDeLaDemandeCopiable,
  texteDeLaDemandeCopiable,
} from '@beluga/shared';

test('la version texte rend la demande seule quand il n’y a aucune pièce', () => {
  assert.equal(texteDeLaDemandeCopiable('  Corrige le tiroir  '), 'Corrige le tiroir');
});

test('la version texte cite les pièces jointes par leur nom', () => {
  const texte = texteDeLaDemandeCopiable('Regarde ça', [
    { nom: 'capture.png', source: 'data:image/png;base64,AAA' },
    { nom: 'notes.txt' },
  ]);
  assert.match(texte, /^Regarde ça/);
  assert.match(texte, /2 pièces jointes :/);
  assert.match(texte, /- capture\.png/);
  assert.match(texte, /- notes\.txt/);
});

test('une pièce sans nom garde un repère lisible', () => {
  assert.match(texteDeLaDemandeCopiable('x', [{}]), /- pièce 1/);
});

test('la version mise en forme garde les paragraphes et les retours à la ligne', () => {
  const html = htmlDeLaDemandeCopiable('une ligne\nune autre\n\nun second paragraphe');
  assert.match(html, /<p>une ligne<br>une autre<\/p>/);
  assert.match(html, /<p>un second paragraphe<\/p>/);
});

test('la version mise en forme embarque les images en data:', () => {
  const html = htmlDeLaDemandeCopiable('Voici', [
    { nom: 'capture.png', source: 'data:image/png;base64,AAA' },
  ]);
  assert.match(html, /<img src="data:image\/png;base64,AAA" alt="capture\.png"/);
});

test('une pièce qui n’est pas une image embarquée reste citée par son nom', () => {
  const html = htmlDeLaDemandeCopiable('Voici', [{ nom: 'rapport.pdf' }, { nom: 'perdue.png' }]);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /<li>rapport\.pdf<\/li>/);
  assert.match(html, /<li>perdue\.png<\/li>/);
});

test('le texte de la demande ne peut pas injecter de balise dans la version HTML', () => {
  const html = htmlDeLaDemandeCopiable('<script>alert(1)</script>');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('les deux représentations sortent d’un seul appel', () => {
  const deux = demandeCopiable('Bonjour', [{ nom: 'a.png', source: 'data:image/png;base64,B' }]);
  assert.match(deux.texte, /Bonjour/);
  assert.match(deux.html, /<img/);
});

test('le nom d’une pièce est échappé jusqu’aux guillemets dans l’attribut alt', () => {
  const html = htmlDeLaDemandeCopiable('', [
    { nom: 'a"<b>.png', type: 'image/png', source: 'data:image/png;base64,AAAA' },
  ]);
  assert.match(html, /alt="a&quot;&lt;b&gt;\.png"/);
});
