import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSAGES_FERMES,
  REQUETE_SURVOL,
  annonceDeLaPile,
  appuiDeclencheLAction,
  gesteDOuverture,
  messagesMontres,
  pileApres,
  resteAVoir,
} from '@haikodev/shared';

/*
 * La pile des messages courts s'ouvre au survol à la souris, à l'appui au
 * doigt. Sur un écran tactile il n'y a pas de survol : sans ce relais, la pile
 * resterait fermée et tout ce qui est dessous serait hors d'atteinte.
 */

/* ------------------------------------------------------------------ */
/* Le geste vient du POINTEUR, pas de la largeur de l'écran            */
/* ------------------------------------------------------------------ */

test('un pointeur qui survole ouvre au survol, les autres à l’appui', () => {
  assert.equal(gesteDOuverture(true), 'survol');
  assert.equal(gesteDOuverture(false), 'appui');
});

test('la question posée au navigateur porte sur le pointeur, jamais sur la largeur', () => {
  assert.match(REQUETE_SURVOL, /hover/);
  assert.match(REQUETE_SURVOL, /pointer/);
  assert.ok(!/width/.test(REQUETE_SURVOL), 'la largeur d’écran ne doit pas décider du geste');
});

/* ------------------------------------------------------------------ */
/* Ce que fait chaque geste                                            */
/* ------------------------------------------------------------------ */

test('à la souris, le survol ouvre et la sortie referme', () => {
  assert.equal(pileApres(false, 'survol-entre', 'survol'), true);
  assert.equal(pileApres(true, 'survol-sort', 'survol'), false);
});

test('au doigt, un appui déploie et un second referme', () => {
  const ouverte = pileApres(false, 'appui-dedans', 'appui');
  assert.equal(ouverte, true);
  assert.equal(pileApres(ouverte, 'appui-dedans', 'appui'), false);
});

test('un appui ailleurs sur l’écran referme, quel que soit le pointeur', () => {
  assert.equal(pileApres(true, 'appui-dehors', 'appui'), false);
  assert.equal(pileApres(true, 'appui-dehors', 'survol'), false);
});

test('à la souris, un clic ne rabat pas la pile sous le curseur', () => {
  // Sinon la pile se refermerait puis se rouvrirait aussitôt, le curseur
  // n'ayant pas bougé : un battement pour rien.
  assert.equal(pileApres(true, 'appui-dedans', 'survol'), true);
});

test('au doigt, un faux survol fabriqué par le navigateur ne change rien', () => {
  assert.equal(pileApres(false, 'survol-entre', 'appui'), false);
  assert.equal(pileApres(true, 'survol-sort', 'appui'), true);
});

/* ------------------------------------------------------------------ */
/* L'appui qui déploie n'emporte pas l'action du message de devant     */
/* ------------------------------------------------------------------ */

test('au doigt, le premier appui déploie seulement', () => {
  assert.equal(appuiDeclencheLAction(false, 'appui'), false);
});

test('au doigt, la pile ouverte, chaque message répond de nouveau pour lui-même', () => {
  assert.equal(appuiDeclencheLAction(true, 'appui'), true);
});

test('à la souris, un clic agit toujours, pile fermée ou ouverte', () => {
  assert.equal(appuiDeclencheLAction(false, 'survol'), true);
  assert.equal(appuiDeclencheLAction(true, 'survol'), true);
});

/* ------------------------------------------------------------------ */
/* Ce que la pile montre et ce qu'elle annonce                         */
/* ------------------------------------------------------------------ */

test('fermée, la pile ne montre que le message de devant ; ouverte, tous', () => {
  assert.equal(messagesMontres(5, false), MESSAGES_FERMES);
  assert.equal(messagesMontres(5, true), 5);
  assert.equal(messagesMontres(0, false), 0);
  assert.equal(messagesMontres(0, true), 0);
});

test('le reste caché se compte en toutes lettres, et se tait quand tout est là', () => {
  assert.equal(resteAVoir(3, false), '+ 2 autres messages');
  assert.equal(resteAVoir(2, false), '+ 1 autre message');
  assert.equal(resteAVoir(1, false), '');
  assert.equal(resteAVoir(4, true), '');
});

test('l’annonce nomme le geste du pointeur qu’on a sous la main', () => {
  assert.match(annonceDeLaPile(3, false, 'appui'), /Appuyer/);
  assert.match(annonceDeLaPile(3, false, 'survol'), /Survoler/);
  assert.match(annonceDeLaPile(3, true, 'appui'), /replier/);
});
