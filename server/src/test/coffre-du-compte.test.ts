import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cibleRapatriee,
  dossiersDuCoffre,
  marqueDuCoffre,
  reparationsDuCoffre,
  type LienDuCoffre,
} from '@haikodev/shared';

/** Le coffre tel qu'il était le lendemain du renommage du compte système. */
const COFFRE: LienDuCoffre[] = [
  { nom: 'tasks', cible: '/home/paseo/.claude/tasks', vivant: false },
  { nom: 'projects', cible: '/home/paseo/.claude/projects', vivant: false },
  { nom: 'settings.json', cible: '/home/paseo/.claude/settings.json', vivant: false },
];

test('les liens morts du coffre reviennent au dossier personnel d’aujourd’hui', () => {
  assert.deepEqual(
    reparationsDuCoffre(COFFRE, '/home/haiko').map((r) => `${r.nom} → ${r.nouvelleCible}`),
    [
      'tasks → /home/haiko/.claude/tasks',
      'projects → /home/haiko/.claude/projects',
      'settings.json → /home/haiko/.claude/settings.json',
    ],
  );
});

test('un lien vivant ne bouge jamais, même s’il pointe ailleurs', () => {
  const liens: LienDuCoffre[] = [{ nom: 'skills', cible: '/opt/skills-partagees', vivant: true }];
  assert.deepEqual(reparationsDuCoffre(liens, '/home/haiko'), []);
});

test('un lien mort qui ne désigne pas un coffre Claude est laissé tel quel', () => {
  const liens: LienDuCoffre[] = [{ nom: 'notes', cible: '/mnt/disque-parti/notes', vivant: false }];
  assert.deepEqual(reparationsDuCoffre(liens, '/home/haiko'), []);
});

test('un lien qui pointe DÉJÀ le bon dossier n’est pas réécrit pour rien', () => {
  assert.equal(cibleRapatriee('/home/haiko/.claude/tasks', '/home/haiko'), null);
  assert.equal(cibleRapatriee('/home/haiko/.claude/tasks', '/home/haiko/'), null);
});

test('un coffre chez root se rapatrie comme les autres', () => {
  assert.equal(cibleRapatriee('/root/.claude/tasks', '/home/haiko'), '/home/haiko/.claude/tasks');
});

test('le dossier des sous-tâches est un sous-dossier du coffre, jamais le coffre lui-même', () => {
  assert.equal(cibleRapatriee('/home/paseo/.claude/', '/home/haiko'), null);
  assert.equal(cibleRapatriee('/home/paseo/.claude', '/home/haiko'), null);
});

/* ------------------------------------------------------------------ */
/* Les autres moteurs                                                  */
/* ------------------------------------------------------------------ */

/** Le coffre d'un compte Codex de relève, après le même déménagement. */
const COFFRE_CODEX: LienDuCoffre[] = [
  { nom: 'auth.json', cible: '/home/paseo/.codex/auth.json', vivant: false },
  { nom: 'config.toml', cible: '/home/paseo/.codex/config.toml', vivant: false },
  { nom: 'sessions', cible: '/home/paseo/.codex/sessions', vivant: false },
];

test('le coffre d’un compte Codex se rapatrie comme celui d’un compte Claude', () => {
  assert.deepEqual(
    reparationsDuCoffre(COFFRE_CODEX, '/home/haiko', 'codex').map((r) => `${r.nom} → ${r.nouvelleCible}`),
    [
      'auth.json → /home/haiko/.codex/auth.json',
      'config.toml → /home/haiko/.codex/config.toml',
      'sessions → /home/haiko/.codex/sessions',
    ],
  );
});

test('un coffre n’emprunte jamais la marque d’un autre moteur', () => {
  // Un lien Claude jugé avec les yeux de Codex ne bouge pas, et l’inverse non plus.
  assert.deepEqual(reparationsDuCoffre(COFFRE_CODEX, '/home/haiko', 'claude'), []);
  assert.deepEqual(
    reparationsDuCoffre([{ nom: 'tasks', cible: '/home/paseo/.claude/tasks', vivant: false }], '/home/haiko', 'codex'),
    [],
  );
});

test('Cursor n’a pas de coffre : rien n’est jamais rapatrié chez lui', () => {
  assert.equal(marqueDuCoffre('cursor'), null);
  assert.deepEqual(reparationsDuCoffre(COFFRE_CODEX, '/home/haiko', 'cursor'), []);
});

test('un moteur inconnu est laissé tranquille, jamais réparé à l’aveugle', () => {
  assert.equal(marqueDuCoffre('un-moteur-de-demain'), null);
  assert.deepEqual(reparationsDuCoffre(COFFRE_CODEX, '/home/haiko', 'un-moteur-de-demain'), []);
});

test('seul Claude réclame un dossier de sous-tâches', () => {
  assert.deepEqual(dossiersDuCoffre('claude'), ['tasks']);
  assert.deepEqual(dossiersDuCoffre('codex'), []);
  assert.deepEqual(dossiersDuCoffre('cursor'), []);
});
