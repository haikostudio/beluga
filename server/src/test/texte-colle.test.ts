import test from 'node:test';
import assert from 'node:assert/strict';
import { nettoyerTexteColle } from '@beluga/shared';

/*
 * LE TEXTE COLLÉ DEPUIS CHATGPT PERD SES DÉBRIS, ET RIEN D'AUTRE.
 * Entités HTML, vignettes de sources (« [image](…favicons…) », nom du site,
 * « +1 ») et marqueurs `utm_` brouillaient la bulle de la demande.
 */

const COLLE = [
  '## Les meilleures bibliothèques',
  '',
  '### 1. [OSide / Skill](https://github.com/OSide/skill?utm_source=chatgpt.com)',
  '',
  'Une excellente base.&#x20;',
  '',
  '[image](https://www.google.com/s2/favicons?domain=https://github.com\\&sz=32)',
  '',
  'GitHub',
  '',
  '+1',
  '',
  '',
  '',
  '### 2. Suivant',
].join('\n');

test('les débris d’un copier ChatGPT disparaissent', () => {
  const net = nettoyerTexteColle(COLLE);
  assert.ok(!net.includes('&#x20;'), net);
  assert.ok(!net.includes('favicons'), net);
  assert.ok(!net.includes('utm_source'), net);
  assert.ok(!/^\+1$/m.test(net), net);
  assert.ok(!/^GitHub$/m.test(net), net);
  assert.ok(net.includes('[OSide / Skill](https://github.com/OSide/skill)'), net);
  assert.ok(net.includes('Une excellente base.'), net);
  assert.ok(!/\n{3,}/.test(net), net);
});

test('un texte ordinaire ressort à l’identique', () => {
  const texte = 'Pourquoi ?\n\nVoir https://exemple.fr/page?a=1&b=2 et `<div>` dans le code.\n\n```html\n<br>&amp;\n```';
  assert.equal(nettoyerTexteColle('Pourquoi ?\n\nUne liste :\n- a\n- b'), 'Pourquoi ?\n\nUne liste :\n- a\n- b');
  assert.ok(nettoyerTexteColle(texte).includes('```html\n<br>&amp;\n```'));
  assert.ok(nettoyerTexteColle(texte).includes('https://exemple.fr/page?a=1&b=2'));
});

test('les marqueurs utm partent, les autres paramètres restent', () => {
  assert.equal(nettoyerTexteColle('https://x.fr/?utm_source=a&b=2'), 'https://x.fr/?b=2');
  assert.equal(nettoyerTexteColle('https://x.fr/?a=1&utm_medium=b'), 'https://x.fr/?a=1');
  assert.equal(nettoyerTexteColle('a<br>b &nbsp;c'), 'a\nb  c');
});

test('le code en ligne garde ses balises', () => {
  assert.equal(nettoyerTexteColle('Pose un `<br>` ici.'), 'Pose un `<br>` ici.');
});
