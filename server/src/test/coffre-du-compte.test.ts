import assert from 'node:assert/strict';
import test from 'node:test';
import { cibleRapatriee, reparationsDuCoffre, type LienDuCoffre } from '@haikodev/shared';

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
