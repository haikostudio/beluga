import test from 'node:test';
import assert from 'node:assert/strict';
import { rolePrompt, rappelDeMethode } from '../runtime.js';

/* ------------------------------------------------------------------ */
/* Une question se pose avec l'outil, jamais en texte simple            */
/* ------------------------------------------------------------------ */

/*
 * Une question écrite à la fin d'une réponse termine le tour sans rien
 * enregistrer : aucune alerte, aucune reprise, la carte reste bloquée. La
 * consigne vit donc dans le texte UNIQUE de la méthode — tous les rôles, les
 * deux moteurs — et l'outil qu'elle nomme (`ask_user`) est un outil du PROJET,
 * commun aux deux moteurs, jamais un outil natif de l'un d'eux.
 */

const ROLES = ['orchestrator', 'analysis', 'deploy', 'task'] as const;
const MOTEURS = ['claude', 'codex'] as const;

test('la consigne est donnée à tous les rôles et à tous les moteurs', () => {
  for (const engine of MOTEURS) {
    for (const role of ROLES) {
      const p = rolePrompt(role, false, engine);
      assert.match(p, /UNE QUESTION SE POSE AVEC L'OUTIL « ask_user »/, `${role} / ${engine}`);
      assert.match(p, /JAMAIS EN TEXTE SIMPLE/, `${role} / ${engine}`);
    }
  }
});

test('la consigne est EXACTEMENT la même pour les deux moteurs', () => {
  for (const role of ROLES) {
    const extrait = (engine: (typeof MOTEURS)[number]) =>
      rolePrompt(role, false, engine).split("UNE QUESTION SE POSE AVEC L'OUTIL")[1];
    assert.equal(extrait('codex'), extrait('claude'), `Rôle « ${role} »`);
  }
});

test('elle dit la conséquence, pas seulement la règle', () => {
  const consigne = rolePrompt('task', false, 'claude');
  assert.match(consigne, /la carte reste bloquée/);
});

test('le rappel des tours suivants la reprend', () => {
  for (const engine of MOTEURS) {
    assert.match(rappelDeMethode(engine), /ask_user/, engine);
    assert.match(rappelDeMethode(engine), /jamais en texte simple/, engine);
  }
});
