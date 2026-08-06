import test from 'node:test';
import assert from 'node:assert/strict';
import { VOIX_LONGUEUR_MAX, texteAEcouter } from '@haikodev/shared';

test('un message court est lu en entier', () => {
  assert.equal(texteAEcouter('Bonjour, ça marche.'), 'Bonjour, ça marche.');
});

test('la mise en forme Markdown est retirée pour l’oreille', () => {
  const brut = '## Titre\n\n- **Point** un\n- Un [lien](https://exemple.fr) ici\n\n`code`';
  assert.equal(texteAEcouter(brut), 'Titre Point un Un lien ici code');
});

test('un message trop long s’arrête sur une phrase complète', () => {
  const phrase = 'La tâche est finie. ';
  const brut = phrase.repeat(30); // bien au-delà de la borne
  const lu = texteAEcouter(brut);
  assert.ok(lu.length <= VOIX_LONGUEUR_MAX, `longueur ${lu.length}`);
  assert.ok(lu.endsWith('.'), `finit sur un point : ${lu}`);
  // Aucune phrase n’est coupée en son milieu : on ne garde que des « La tâche est finie. »
  assert.equal(lu.replace(/La tâche est finie\.\s?/g, '').trim(), '');
});

test('une première phrase interminable est coupée au dernier mot entier, avec des points de suspension', () => {
  const brut = 'mot '.repeat(200).trim(); // aucun point : pas de fin de phrase
  const lu = texteAEcouter(brut);
  assert.ok(lu.endsWith('…'), `finit par … : ${lu}`);
  assert.ok(lu.length <= VOIX_LONGUEUR_MAX + 1, `longueur ${lu.length}`);
  // Jamais un mot tronqué : le texte sans le « … » finit sur un mot entier.
  const sansSuite = lu.slice(0, -1).trim();
  assert.ok(sansSuite.endsWith('mot'), `dernier mot entier : ${sansSuite}`);
});

test('rien à lire rend une chaîne vide', () => {
  assert.equal(texteAEcouter(''), '');
  assert.equal(texteAEcouter('   \n  '), '');
});
