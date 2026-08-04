import test from 'node:test';
import assert from 'node:assert/strict';
import { corpsNotification, emojiDuMotif, titreNotification } from '@haikodev/shared';

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

test('un emoji ouvre le titre, avant le projet et l’action', () => {
  assert.equal(
    titreNotification('Refondre les notifications', 'HaikoDev', '✅'),
    '✅ HaikoDev — Refondre les notifications',
  );
  // Sans projet, l'emoji reste en tête de l'action.
  assert.equal(titreNotification('Le serveur redémarre', undefined, '🔄'), '🔄 Le serveur redémarre');
  // Un emoji vide ne laisse pas d'espace parasite.
  assert.equal(titreNotification('Tâche terminée', 'HaikoDev', ''), 'HaikoDev — Tâche terminée');
});

test('chaque motif qui interrompt porte son emoji, un motif inconnu n’en met aucun', () => {
  assert.equal(emojiDuMotif('tache-terminee'), '✅');
  assert.equal(emojiDuMotif('decision-attendue'), '⚠️');
  assert.equal(emojiDuMotif('tache-echec'), '⛔');
  assert.equal(emojiDuMotif('publication-terminee'), '🚀');
  assert.equal(emojiDuMotif('publication-echec'), '⛔');
  assert.equal(emojiDuMotif('quota-seuil'), '📊');
  assert.equal(emojiDuMotif('redemarrage-serveur'), '🔄');
  assert.equal(emojiDuMotif('motif-du-futur'), '');
  assert.equal(emojiDuMotif(undefined), '');
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

test('quand le titre porte déjà l’action, le corps laisse la place à la description', () => {
  const corps = corpsNotification(
    'Le volet des quotas',
    { title: 'Le volet des quotas', description: 'Il doit défiler et se refermer au doigt.' },
    'Le volet des quotas',
  );
  // Plus de première ligne redondante : la description illustre seule la tâche.
  assert.equal(corps, 'Il doit défiler et se refermer au doigt.');
});

test('sans description, le corps garde la première ligne même si le titre la porte déjà', () => {
  const corps = corpsNotification('Le volet des quotas', { title: 'Le volet des quotas' }, 'Le volet des quotas');
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
