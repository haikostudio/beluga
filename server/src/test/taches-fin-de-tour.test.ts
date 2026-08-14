import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  cloturerLesTaches,
  mentionProgressionTaches,
  mentionTachesNonFaites,
  progressionDesTaches,
  tachesAPoursuivre,
  type TodoItem,
} from '@haikodev/shared';

const T = 1_800_000_000_000;

/** La liste telle que la capture la montrait : quatre cochées, une qui tourne. */
const LISTE: TodoItem[] = [
  { label: 'Trouver le code', state: 'done', startedAt: T, endedAt: T + 1000 },
  { label: 'Diagnostiquer', state: 'done', startedAt: T + 1000, endedAt: T + 2000 },
  { label: 'Corriger', state: 'done', startedAt: T + 2000, endedAt: T + 3000 },
  { label: 'Vérifier', state: 'done', startedAt: T + 3000, endedAt: T + 4000 },
  { label: 'Enregistrer et pousser', state: 'running', startedAt: T + 4000 },
];

test('un tour rendu ne laisse AUCUNE ligne en cours', () => {
  const ferme = cloturerLesTaches(LISTE, { issue: 'reussi', maintenant: T + 9000 });
  assert.equal(
    ferme.some((todo) => todo.state === 'running'),
    false,
  );
  assert.equal(ferme[4].state, 'done');
  assert.equal(ferme[4].endedAt, T + 9000);
  // Le démon a coché, pas l'agent : la ligne le dit.
  assert.equal(ferme[4].closedByTurnEnd, true);
});

test('le décompte porté par l’agent suit la liste refermée, pas l’avant-dernière reçue', () => {
  // Ce que le TABLEAU lit tant que la carte n'est pas ouverte : figé sur 4/5, il
  // affichait « 4/5 faites » pour toujours sur une carte pourtant rendue.
  assert.deepEqual(progressionDesTaches(LISTE), { done: 4, total: 5, unfinished: 0 });
  const ferme = cloturerLesTaches(LISTE, { issue: 'reussi', maintenant: T + 9000 });
  assert.deepEqual(progressionDesTaches(ferme), { done: 5, total: 5, unfinished: 0 });
});

test('un tour coupé compte ses lignes non faites, et la carte les dit', () => {
  const coupe = cloturerLesTaches(LISTE, { issue: 'interrompu', maintenant: T + 9000 });
  assert.deepEqual(progressionDesTaches(coupe), { done: 4, total: 5, unfinished: 1 });
  assert.equal(mentionProgressionTaches({ todos: progressionDesTaches(coupe) }), '4/5 faites · 1 non faite');
});

test('sans reste non fait, le décroché de la carte ne dit que les cochées', () => {
  const rendu = cloturerLesTaches(LISTE, { issue: 'reussi', maintenant: T + 9000 });
  assert.equal(mentionProgressionTaches({ todos: progressionDesTaches(rendu) }), '5/5 faites');
  // Une carte d'avant la migration n'a pas le champ : rien ne doit être inventé.
  assert.equal(mentionProgressionTaches({ todos: { done: 2, total: 3 } }), '2/3 faites');
});

test('une ligne jamais commencée dit « non faite » plutôt que d’attendre pour toujours', () => {
  const ferme = cloturerLesTaches(
    [
      { label: 'Corriger', state: 'done', startedAt: T, endedAt: T + 1000 },
      { label: 'Documenter', state: 'todo' },
    ],
    { issue: 'reussi', maintenant: T + 9000 },
  );
  assert.equal(ferme[1].state, 'unfinished');
  // Jamais commencée, donc aucun temps à afficher — ni début ni fin.
  assert.equal(ferme[1].startedAt, undefined);
  assert.equal(ferme[1].endedAt, undefined);
  assert.equal(ferme[1].closedByTurnEnd, undefined);
});

test('un tour INTERROMPU ne coche rien : ce qui tournait n’a pas été mené à bout', () => {
  const ferme = cloturerLesTaches(LISTE, { issue: 'interrompu', maintenant: T + 9000 });
  assert.equal(ferme[4].state, 'unfinished');
  // Elle avait commencé : son chronomètre s'arrête au lieu de courir sans fin.
  assert.equal(ferme[4].endedAt, T + 9000);
  assert.equal(ferme.filter((todo) => todo.state === 'done').length, 4);
});

test('refermer deux fois ne change rien (les chemins de fermeture se doublent)', () => {
  const une = cloturerLesTaches(LISTE, { issue: 'reussi', maintenant: T + 9000 });
  const deux = cloturerLesTaches(une, { issue: 'interrompu', maintenant: T + 50_000 });
  assert.deepEqual(deux, une);
});

test('la liste d’origine n’est jamais modifiée sur place', () => {
  cloturerLesTaches(LISTE, { issue: 'reussi', maintenant: T + 9000 });
  assert.equal(LISTE[4].state, 'running');
});

test('l’en-tête annonce ce qui n’a pas été fait, avec son pluriel', () => {
  assert.equal(mentionTachesNonFaites([]), null);
  assert.equal(mentionTachesNonFaites(LISTE), null);
  assert.equal(
    mentionTachesNonFaites(cloturerLesTaches(LISTE, { issue: 'interrompu', maintenant: T })),
    '1 non faite',
  );
  assert.equal(
    mentionTachesNonFaites([
      { label: 'a', state: 'unfinished' },
      { label: 'b', state: 'unfinished' },
    ]),
    '2 non faites',
  );
});

test('un tour qui REPART reprend les lignes non faites comme des lignes à faire', () => {
  const coupe = cloturerLesTaches(LISTE, { issue: 'interrompu', maintenant: T + 9000 });
  const suite = tachesAPoursuivre(coupe);
  assert.equal(suite[4].state, 'todo');
  // Le chronomètre du tour d'avant ne repart pas avec elle.
  assert.equal(suite[4].startedAt, undefined);
  assert.equal(suite[4].endedAt, undefined);
  assert.equal(suite.filter((todo) => todo.state === 'done').length, 4);
});

/* ------------------------------------------------------------------ */
/* LES LISTES DÉJÀ FIGÉES EN BASE (migration 23)                        */
/*                                                                      */
/* La règle répare l'avenir ; la migration répare le passé. On fabrique  */
/* donc une base D'AVANT — migrations 1 à 22 déjà posées — avec les trois */
/* cas qu'on trouve réellement dedans, et on l'ouvre.                    */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'taches-fin-de-tour-'));
process.env.HAIKODEV_DATA = bacASable;

function messageDAvant(id: string, contenu: string, streaming: boolean, todos: unknown[], agentId = 'agent-1') {
  return {
    id,
    agentId,
    role: 'assistant',
    content: contenu,
    steps: [],
    todos,
    proposals: [],
    questions: [],
    downloads: [],
    attachments: [],
    streaming,
    plan: false,
    durationMs: 5000,
    createdAt: T,
  };
}

const AVANT = [
  // Le cas de la capture : réponse rendue, dernière ligne restée « en cours ».
  messageDAvant('m-rendu', 'Voilà le travail.', false, [
    { label: 'Corriger', state: 'done', startedAt: T, endedAt: T + 1000 },
    { label: 'Enregistrer et pousser', state: 'running', startedAt: T + 1000 },
  ]),
  // Un tour muet, coupé : rien n'a été mené à bout.
  messageDAvant('m-muet', '', false, [{ label: 'Corriger', state: 'running', startedAt: T }]),
  // Un tour ENCORE en écriture : on n'y touche pas.
  messageDAvant('m-vivant', '', true, [{ label: 'Corriger', state: 'running', startedAt: T }]),
  /*
   * LES DEUX DÉCOMPTES QUI NE DISAIENT PAS PAREIL (migration 24). Le tableau ne
   * lit pas les étapes mais un résumé posé sur l'agent, figé sur l'avant-dernière
   * liste reçue. Une carte close gardait donc « 1/2 faite » à vie.
   */
  messageDAvant(
    'm-clos',
    'Travail rendu.',
    false,
    [
      { label: 'Corriger', state: 'done', startedAt: T, endedAt: T + 1000 },
      { label: 'Enregistrer et pousser', state: 'running', startedAt: T + 1000 },
    ],
    'agent-clos',
  ),
  messageDAvant(
    'm-au-travail',
    '',
    true,
    [
      { label: 'Corriger', state: 'done', startedAt: T, endedAt: T + 1000 },
      { label: 'Enregistrer et pousser', state: 'running', startedAt: T + 1000 },
    ],
    'agent-au-travail',
  ),
];

/** Les agents d'avant, avec leur décompte figé : un au repos, un au travail. */
const AGENTS_DAVANT = [
  { id: 'agent-clos', status: 'done', todos: { done: 1, total: 2 } },
  { id: 'agent-au-travail', status: 'running', todos: { done: 1, total: 2 } },
];

const avant = new Database(path.join(bacASable, 'haikodev.db'));
avant.exec(`
  CREATE TABLE migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at INTEGER);
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    role TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    card_id TEXT,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);
for (const agent of AGENTS_DAVANT) {
  avant
    .prepare(
      `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      agent.id,
      'projet-1',
      `carte-${agent.id}`,
      'task',
      agent.status,
      JSON.stringify({ id: agent.id, role: 'task', status: agent.status, todos: agent.todos }),
      T,
      T,
    );
}
for (let id = 1; id <= 22; id += 1) {
  avant.prepare('INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)').run(id, `ancienne-${id}`, 1);
}
for (const message of AVANT) {
  avant
    .prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(message.id, message.agentId, message.role, JSON.stringify(message), message.createdAt);
}
avant.close();

const { getDb } = await import('../db.js');

function listeDe(id: string): TodoItem[] {
  const ligne = getDb().prepare('SELECT data FROM messages WHERE id = ?').get(id) as { data: string };
  return JSON.parse(ligne.data).todos as TodoItem[];
}

test('migration 23 : un tour rendu voit sa dernière ligne cochée, avec sa fin', () => {
  const liste = listeDe('m-rendu');
  assert.equal(liste[1].state, 'done');
  assert.equal(liste[1].closedByTurnEnd, true);
  // Faute d'heure de fin, celle du tour : début du message + sa durée.
  assert.equal(liste[1].endedAt, T + 5000);
  assert.equal(liste[0].state, 'done');
});

test('migration 23 : un tour muet dit « non faite », il ne coche rien', () => {
  assert.equal(listeDe('m-muet')[0].state, 'unfinished');
});

test('migration 23 : un tour encore en écriture garde sa liste vivante', () => {
  assert.equal(listeDe('m-vivant')[0].state, 'running');
});

function decompteDe(id: string): { done: number; total: number; unfinished?: number } {
  const ligne = getDb().prepare('SELECT data FROM agents WHERE id = ?').get(id) as { data: string };
  return JSON.parse(ligne.data).todos;
}

test('migration 24 : le décompte d’une carte close est refait avec sa liste', () => {
  assert.deepEqual(decompteDe('agent-clos'), { done: 2, total: 2, unfinished: 0 });
});

test('migration 24 : un agent encore au travail garde son décompte', () => {
  assert.deepEqual(decompteDe('agent-au-travail'), { done: 1, total: 2 });
});
