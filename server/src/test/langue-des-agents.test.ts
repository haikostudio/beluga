import test from 'node:test';
import assert from 'node:assert/strict';
import { consigneDeLangue, LANGUES } from '@beluga/shared';
import { rolePrompt, rappelDeMethode } from '../runtime.js';

/* ------------------------------------------------------------------ */
/* Un agent écrit dans la langue réglée par l'utilisateur               */
/* ------------------------------------------------------------------ */

/*
 * L'interface parle cinq langues, les agents n'en parlaient qu'une : leur
 * consigne système disait « Réponds en français simple », et un utilisateur
 * anglophone lisait son écran en anglais et ses agents en français. La langue
 * est désormais ANNONCÉE EN TÊTE de chaque consigne, pour tous les rôles, tous
 * les moteurs et tous les niveaux d'accueil — dépannage compris.
 */

const ROLES = ['cadrage', 'analysis', 'deploy', 'task'] as const;
const MOTEURS = ['claude', 'codex'] as const;

/** Le nom de chaque langue en français, tel que la consigne doit le citer. */
const EN_FRANCAIS: Record<string, string> = {
  fr: 'français',
  en: 'anglais',
  es: 'espagnol',
  de: 'allemand',
  zh: 'chinois',
};

test('chaque langue est nommée en français dans sa consigne', () => {
  for (const langue of LANGUES) {
    assert.ok(EN_FRANCAIS[langue.id], langue.id);
    assert.match(consigneDeLangue(langue.id), new RegExp(EN_FRANCAIS[langue.id].toUpperCase()), langue.id);
  }
});

test('un code régional retombe sur sa langue, jamais sur du vide', () => {
  assert.match(consigneDeLangue('en-US'), /ANGLAIS/);
  assert.match(consigneDeLangue('zh-CN'), /CHINOIS/);
  assert.match(consigneDeLangue('klingon'), /FRANÇAIS/);
});

test('la consigne de langue couvre tout ce que l’utilisateur lit', () => {
  const consigne = consigneDeLangue('en');
  assert.match(consigne, /ask_user/);
  assert.match(consigne, /liste de tâches/);
  assert.match(consigne, /erreur/);
  /* Le code et la mémoire, eux, ne changent pas de langue. */
  assert.match(consigne, /CODE/);
});

test('tous les rôles et tous les moteurs reçoivent la langue en tête', () => {
  for (const engine of MOTEURS) {
    for (const role of ROLES) {
      const p = rolePrompt(role, false, engine, 'complet', undefined, 'es');
      assert.ok(p.startsWith('LANGUE DE TES RÉPONSES : ESPAGNOL'), `${role} / ${engine}`);
    }
  }
});

test('le dépannage de publication et l’assistant des backups la reçoivent aussi', () => {
  const depannage = rolePrompt('task', false, 'claude', 'minimal', undefined, 'de');
  assert.ok(depannage.startsWith('LANGUE DE TES RÉPONSES : ALLEMAND'));
  const backup = rolePrompt('task', false, 'claude', 'complet', 'configuration-backup', 'de');
  assert.ok(backup.startsWith('LANGUE DE TES RÉPONSES : ALLEMAND'));
});

test('le rappel de méthode des tours suivants redit la langue', () => {
  assert.match(rappelDeMethode('claude', 'zh'), /LANGUE DE TES RÉPONSES : CHINOIS/);
});

test('sans réglage, tout reste en français et aucune consigne ne dit « français simple »', () => {
  const p = rolePrompt('task', true, 'claude');
  assert.ok(p.startsWith('LANGUE DE TES RÉPONSES : FRANÇAIS'));
  assert.doesNotMatch(p, /en français simple/);
});
