/**
 * LA BARRE D'ÉCRITURE RÉPOND À LA QUESTION OUVERTE.
 *
 * Deux endroits pour écrire la même chose — la bulle de la question et la barre
 * de la conversation — laissaient la question ouverte pour toujours dès qu'on
 * répondait dans la barre : le texte partait dans la file d'attente, le bouton
 * « Annuler » restait, le triangle orange aussi.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { texteRepondALaQuestion } from '@haikodev/shared';

test('un texte écrit pendant qu’une question attend est sa réponse', () => {
  assert.equal(texteRepondALaQuestion({ questionEnAttente: 'q1', texte: 'oui' }), 'q1');
});

test('aucune question ouverte : le texte reste une demande ordinaire', () => {
  assert.equal(texteRepondALaQuestion({ questionEnAttente: null, texte: 'oui' }), null);
  assert.equal(texteRepondALaQuestion({ texte: 'oui' }), null);
});

test('un texte vide ne répond rien', () => {
  assert.equal(texteRepondALaQuestion({ questionEnAttente: 'q1', texte: '   ' }), null);
});

test('une question à choix PUR attend un clic, pas une phrase', () => {
  assert.equal(
    texteRepondALaQuestion({ questionEnAttente: 'q1', texte: 'oui', texteLibreAutorise: false }),
    null,
  );
  assert.equal(
    texteRepondALaQuestion({ questionEnAttente: 'q1', texte: 'oui', texteLibreAutorise: true }),
    'q1',
  );
});
