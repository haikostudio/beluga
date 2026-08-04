import test from 'node:test';
import assert from 'node:assert/strict';
import { rolePrompt, rappelDeMethode } from '../runtime.js';

/* ------------------------------------------------------------------ */
/* Silence sur les identifiants stockés dans le projet                  */
/* ------------------------------------------------------------------ */

/*
 * Garder des identifiants dans le projet est un choix ASSUMÉ de l'utilisateur.
 * Sans consigne, chaque agent qui croisait un fichier de clés y allait de son
 * avertissement de sécurité — le même conseil, redit à chaque tour. La consigne
 * vit donc dans le texte UNIQUE de la méthode : elle vaut pour tous les rôles et
 * pour les deux moteurs, sinon elle ne vaudrait nulle part.
 */

const ROLES = ['orchestrator', 'analysis', 'deploy', 'task'] as const;
const MOTEURS = ['claude', 'codex'] as const;

test('la consigne de silence est donnée à tous les rôles et à tous les moteurs', () => {
  for (const engine of MOTEURS) {
    for (const role of ROLES) {
      const p = rolePrompt(role, false, engine);
      assert.match(p, /SILENCE SUR LES IDENTIFIANTS STOCKÉS/, `${role} / ${engine}`);
      assert.match(p, /ni dans une carte proposée, ni dans une alerte/, `${role} / ${engine}`);
    }
  }
});

test('la consigne de silence est EXACTEMENT la même pour les deux moteurs', () => {
  for (const role of ROLES) {
    const extrait = (engine: (typeof MOTEURS)[number]) =>
      rolePrompt(role, false, engine).split('SILENCE SUR LES IDENTIFIANTS STOCKÉS')[1];
    assert.equal(extrait('codex'), extrait('claude'), `Rôle « ${role} »`);
  }
});

test('la consigne ne nomme aucun outil propre à un moteur', () => {
  const consigne = rolePrompt('task', false, 'claude').split(
    'SILENCE SUR LES IDENTIFIANTS STOCKÉS',
  )[1];
  assert.doesNotMatch(consigne, /TaskCreate|TaskUpdate|update_plan/);
});

test('une panne d’identifiant reste dicible : le silence porte sur le stockage', () => {
  for (const engine of MOTEURS) {
    const p = rolePrompt('task', false, engine);
    assert.match(p, /Une PANNE se dit toujours/, engine);
  }
});

test('le rappel envoyé aux tours suivants porte aussi la consigne', () => {
  for (const engine of MOTEURS) {
    const rappel = rappelDeMethode(engine);
    assert.match(rappel, /ne signale ni ne commente JAMAIS le stockage de mots de passe/, engine);
    assert.match(rappel, /se dit/, engine);
  }
});
