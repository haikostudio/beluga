import test from 'node:test';
import assert from 'node:assert/strict';
import { corpsNotification, titreNotification } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Le texte d'une notification : de quel projet, et de quoi il s'agit  */
/* ------------------------------------------------------------------ */

test('le nom du projet vient en tête du titre', () => {
  assert.equal(titreNotification('Tâche terminée', 'HaikoDev'), 'HaikoDev — Tâche terminée');
});

test('sans projet connu, le titre reste tel quel', () => {
  assert.equal(titreNotification('Tâche terminée'), 'Tâche terminée');
  assert.equal(titreNotification('Tâche terminée', '   '), 'Tâche terminée');
});

test('un titre qui nomme déjà le projet ne le répète pas', () => {
  assert.equal(titreNotification('HaikoDev est publié', 'HaikoDev'), 'HaikoDev est publié');
});

test('le corps donne le titre de la carte puis sa description', () => {
  const corps = corpsNotification('Le volet des quotas', {
    title: 'Le volet des quotas',
    description: 'Il doit défiler et se refermer au doigt.',
  });
  assert.deepEqual(corps.split('\n'), ['Le volet des quotas', 'Il doit défiler et se refermer au doigt.']);
});

test('une description qui répète le titre ne prend pas la seconde ligne', () => {
  const corps = corpsNotification('Le volet des quotas', {
    title: 'Le volet des quotas',
    description: 'Le volet des quotas',
  });
  assert.equal(corps, 'Le volet des quotas');
});

test('sans description, le corps se limite à la première ligne', () => {
  assert.equal(corpsNotification('Tâche X', { title: 'Tâche X' }), 'Tâche X');
  assert.equal(corpsNotification('', { title: 'Tâche X' }), 'Tâche X');
});

test('un corps trop long est coupé sur un mot entier, jamais au milieu', () => {
  const long = 'mot '.repeat(80).trim();
  const corps = corpsNotification(long, {});
  assert.ok(corps.length <= 181, `longueur ${corps.length}`);
  assert.ok(corps.endsWith('…'));
  assert.ok(!corps.includes('mo…'));
});

test('la description est raccourcie sans manger le retour à la ligne', () => {
  const corps = corpsNotification('Un titre court', {
    title: 'Un titre court',
    description: 'phrase '.repeat(60).trim(),
  });
  const lignes = corps.split('\n');
  assert.equal(lignes.length, 2);
  assert.equal(lignes[0], 'Un titre court');
  assert.ok(lignes[1].endsWith('…'));
});
