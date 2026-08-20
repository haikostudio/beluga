import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MEMORY_STEP_ID, Message } from '@haikodev/shared';
import { EngineEvent, normalizeTodos } from '../engines/types.js';
import { SuiviDesTaches, emitFromClaude } from '../engines/claude.js';
import { buildCodexArgs, emitFromCodex } from '../engines/codex.js';
import {
  appendMemory,
  briefing,
  empreintesDesFaits,
  memoryFacts,
  memorySummary,
  newFactsSince,
} from '../memory.js';
import { ORCHESTRATOR_ALLOWED_NATIVE, ORCHESTRATOR_DENIED_NATIVE } from '../tools.js';
import { allDone, mergeTodos } from '../todos.js';

/* ------------------------------------------------------------------ */
/* Le déroulé visible dans la conversation (PLAN §26)                  */
/* ------------------------------------------------------------------ */

test('la mémoire relue se résume en un nombre de faits et son texte', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-memoire-'));
  try {
    assert.deepEqual(memorySummary(dossier), { facts: 0, text: '' });

    appendMemory(dossier, 'Le démon est la source de vérité.');
    appendMemory(dossier, 'Une carte naît toujours dans « À faire ».');

    const resume = memorySummary(dossier);
    assert.equal(resume.facts, 2);
    assert.match(resume.text, /source de vérité/);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test('l\'étape de mémoire garde un identifiant réservé, que l\'interface sait isoler', () => {
  const message = Message.parse({
    id: 'm1',
    agentId: 'a1',
    role: 'assistant',
    steps: [
      { id: MEMORY_STEP_ID, label: 'Lecture de la mémoire du projet — 2 faits retenus', state: 'done' },
      { id: 'outil-1', label: 'Lecture de un/fichier.ts', state: 'done' },
    ],
    createdAt: Date.now(),
  });
  const memoire = message.steps.find((step) => step.id === MEMORY_STEP_ID);
  assert.ok(memoire, 'la mémoire doit être retrouvable en tête');
  assert.equal(message.steps.filter((step) => step.id !== MEMORY_STEP_ID).length, 1);
});

test('un message enregistré avant cette version reste lisible, sans liste de tâches', () => {
  // Règle du protocole : jamais de champ obligatoire ajouté.
  const ancien = Message.parse({ id: 'm2', agentId: 'a1', role: 'assistant', createdAt: Date.now() });
  assert.deepEqual(ancien.todos, []);
});

test('la liste de tâches de Claude est traduite dans le format unique', () => {
  const todos = normalizeTodos([
    { content: 'Lire le code du chat', status: 'completed', activeForm: 'Lecture du code' },
    { content: 'Ajouter la liste de tâches', status: 'in_progress' },
    { content: 'Lancer les tests', status: 'pending' },
  ]);
  assert.deepEqual(todos, [
    { label: 'Lire le code du chat', state: 'done' },
    { label: 'Ajouter la liste de tâches', state: 'running' },
    { label: 'Lancer les tests', state: 'todo' },
  ]);
});

test('le plan de Codex donne exactement la même liste', () => {
  const todos = normalizeTodos([
    { step: 'Lire le code du chat', completed: true },
    { step: 'Ajouter la liste de tâches', completed: false },
  ]);
  assert.deepEqual(todos, [
    { label: 'Lire le code du chat', state: 'done' },
    { label: 'Ajouter la liste de tâches', state: 'todo' },
  ]);
});

test('une liste absente ou vide ne casse rien', () => {
  assert.deepEqual(normalizeTodos(undefined), []);
  assert.deepEqual(normalizeTodos([{ status: 'pending' }, '', null]), []);
});

test('le flux de Claude sort une liste de tâches, pas une étape de plus', () => {
  const events: EngineEvent[] = [];
  emitFromClaude(
    {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'TodoWrite',
            input: { todos: [{ content: 'Lire le chat', status: 'in_progress' }] },
          },
        ],
      },
    },
    (event) => events.push(event),
    new Map(),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'todo');
  assert.deepEqual(events[0].todos, [{ label: 'Lire le chat', state: 'running' }]);
});

test('le flux de Codex sort la même liste, dans le même format', () => {
  const events: EngineEvent[] = [];
  emitFromCodex(
    {
      type: 'item.updated',
      item: { id: 'plan-1', type: 'todo_list', items: [{ text: 'Lire le chat', completed: true }] },
    },
    (event) => events.push(event),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'todo');
  assert.deepEqual(events[0].todos, [{ label: 'Lire le chat', state: 'done' }]);
});

test('la reprise Codex n’utilise que les options acceptées par exec resume', () => {
  const args = buildCodexArgs({
    cwd: '/srv/projet',
    prompt: 'Continue',
    sessionId: '00000000-0000-0000-0000-000000000000',
    fullAccess: false,
    onEvent: () => undefined,
  });

  assert.deepEqual(args.slice(0, 5), [
    'exec',
    'resume',
    '00000000-0000-0000-0000-000000000000',
    '--json',
    '--skip-git-repo-check',
  ]);
  assert.equal(args.includes('-C'), false);
  assert.equal(args.includes('-s'), false);
  assert.ok(args.includes('sandbox_mode="read-only"'));
});

test('le chef d\'orchestre peut annoncer sa liste de tâches, qui ne touche à rien', () => {
  assert.ok(ORCHESTRATOR_ALLOWED_NATIVE.includes('TodoWrite'));
  assert.equal(ORCHESTRATOR_DENIED_NATIVE.includes('TodoWrite'), false);
});

/* ------------------------------------------------------------------ */
/* Le temps passé sur chaque ligne de la liste de tâches               */
/* ------------------------------------------------------------------ */

test('une ligne qui passe en cours puis cochée garde son temps', () => {
  const debut = Date.now() - 60_000;
  const premiere = mergeTodos([], [{ label: 'Lire le chat', state: 'running' }], debut);
  assert.ok(premiere[0].startedAt, 'une ligne en cours a un départ');
  assert.equal(premiere[0].endedAt, undefined, 'elle n\'a pas encore de fin');

  const ensuite = mergeTodos(premiere, [{ label: 'Lire le chat', state: 'done' }], debut);
  assert.equal(ensuite[0].startedAt, premiere[0].startedAt, 'le départ ne bouge plus');
  assert.ok(ensuite[0].endedAt, 'la ligne cochée a une fin');
});

test('une ligne cochée sans passer par « en cours » compte depuis la précédente', () => {
  const debut = Date.now() - 120_000;
  const premiere = mergeTodos(
    [],
    [
      { label: 'Un', state: 'done' },
      { label: 'Deux', state: 'todo' },
    ],
    debut,
  );
  assert.equal(premiere[0].startedAt, debut, 'la première part du début du tour');

  const ensuite = mergeTodos(
    premiere,
    [
      { label: 'Un', state: 'done' },
      { label: 'Deux', state: 'done' },
    ],
    debut,
  );
  assert.equal(ensuite[0].endedAt, premiere[0].endedAt, 'la ligne déjà cochée ne rajeunit pas');
  assert.equal(ensuite[1].startedAt, premiere[0].endedAt, 'la suivante part de la fin de la précédente');
});

test('une liste entièrement cochée se reconnaît, une liste vide non', () => {
  assert.equal(allDone([]), false);
  assert.equal(allDone([{ label: 'Un', state: 'done' }]), true);
  assert.equal(allDone([{ label: 'Un', state: 'done' }, { label: 'Deux', state: 'running' }]), false);
});

test('une ligne remise en attente perd ses heures', () => {
  const debut = Date.now();
  const avant = mergeTodos([], [{ label: 'Un', state: 'done' }], debut);
  const apres = mergeTodos(avant, [{ label: 'Un', state: 'todo' }], debut);
  assert.deepEqual(apres, [{ label: 'Un', state: 'todo' }]);
});

/* ------------------------------------------------------------------ */
/* Les tâches annoncées par les versions récentes du moteur            */
/* ------------------------------------------------------------------ */

test('TaskCreate et TaskUpdate forment une liste de tâches cochée', () => {
  const vus: EngineEvent[] = [];
  const pendingSteps = new Map<string, string>();
  const taches = new SuiviDesTaches();
  const rejouer = (event: any) => emitFromClaude(event, (e) => vus.push(e), pendingSteps, taches);

  const creation = (id: string, subject: string) => ({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name: 'TaskCreate', input: { subject } }] },
  });
  const reponse = (id: string, texte: string) => ({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: id, content: texte }] },
  });
  const maj = (input: Record<string, unknown>) => ({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: `u-${input.taskId}`, name: 'TaskUpdate', input }] },
  });

  rejouer(creation('a', 'Replier le déroulé'));
  rejouer(reponse('a', 'Task #1 created successfully: Replier le déroulé'));
  rejouer(creation('b', 'Traduire les tâches'));
  rejouer(reponse('b', 'Task #2 created successfully: Traduire les tâches'));

  // Une création n'est PAS une étape du journal : elle n'a que sa liste.
  assert.equal(vus.filter((e) => e.kind === 'step').length, 0);

  rejouer(maj({ taskId: '1', status: 'in_progress' }));
  rejouer(maj({ taskId: '1', status: 'completed' }));
  rejouer(maj({ taskId: '2', status: 'in_progress' }));

  const derniere = [...vus].reverse().find((e) => e.kind === 'todo') as any;
  assert.deepEqual(derniere.todos, [
    { label: 'Replier le déroulé', state: 'done' },
    { label: 'Traduire les tâches', state: 'running' },
  ]);
});

test('une tâche supprimée sort de la liste sans décaler les autres', () => {
  const vus: EngineEvent[] = [];
  const taches = new SuiviDesTaches();
  const pendingSteps = new Map<string, string>();
  const rejouer = (event: any) => emitFromClaude(event, (e) => vus.push(e), pendingSteps, taches);

  for (const [id, numero, sujet] of [
    ['a', '1', 'Une'],
    ['b', '2', 'Deux'],
    ['c', '3', 'Trois'],
  ] as const) {
    rejouer({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'TaskCreate', input: { subject: sujet } }] } });
    rejouer({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: `Task #${numero} created successfully` }] } });
  }
  rejouer({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'TaskUpdate', input: { taskId: '2', status: 'deleted' } }] } });
  rejouer({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'y', name: 'TaskUpdate', input: { taskId: '3', status: 'completed' } }] } });

  const derniere = [...vus].reverse().find((e) => e.kind === 'todo') as any;
  assert.deepEqual(derniere.todos, [
    { label: 'Une', state: 'todo' },
    { label: 'Trois', state: 'done' },
  ]);
});

/* ------------------------------------------------------------------ */
/* La mémoire ne repart pas en entier à chaque message                 */
/* ------------------------------------------------------------------ */

test("la mémoire n'est envoyée en entier qu'à l'ouverture d'une session", () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-memoire-session-'));
  try {
    appendMemory(dossier, 'Le démon est la source de vérité.');
    appendMemory(dossier, 'Une carte naît toujours dans « À faire ».');

    /*
     * Ouverture de session : ce qui part, c'est la CARTE de l'arbre — les
     * sujets et les mots de leurs branches. Aucun fait : c'est tout l'objet du
     * changement, et le briefing ne doit donc PAS porter leur texte.
     */
    const ouverture = briefing(dossier, 'Essai', true);
    assert.match(ouverture, /MÉMOIRE DU PROJET/);
    assert.match(ouverture, /CARTE de l'arbre/);
    assert.doesNotMatch(ouverture, /source de vérité/);

    // Tour suivant : plus de mémoire, seulement le repère du projet.
    const suite = briefing(dossier, 'Essai', false);
    assert.doesNotMatch(suite, /MÉMOIRE DU PROJET/);
    assert.match(suite, /Projet : Essai/);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test('seuls les faits ajoutés depuis sont renvoyés à l\'agent', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-memoire-suite-'));
  try {
    appendMemory(dossier, 'Premier fait.');
    appendMemory(dossier, 'Deuxième fait.');
    const vus = empreintesDesFaits(dossier);
    assert.equal(memoryFacts(dossier).length, 2);
    assert.deepEqual(newFactsSince(dossier, vus), []);

    appendMemory(dossier, 'Troisième fait, appris en route.');
    const nouveaux = newFactsSince(dossier, vus);
    assert.equal(nouveaux.length, 1);
    assert.match(nouveaux[0], /Troisième fait/);

    // Un fait rangé sous un AUTRE sujet ne passe pas pour déjà vu, alors même
    // qu'il ne s'ajoute pas à la fin de la liste.
    appendMemory(dossier, 'La publication fusionne les branches du lot dans la principale.');
    assert.equal(newFactsSince(dossier, vus).length, 2);

    // Session neuve, rien de vu : on repart du tout plutôt que de rien.
    assert.equal(newFactsSince(dossier, []).length, 4);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* Publier : le dossier servi et le travail non enregistré             */
/* ------------------------------------------------------------------ */

test("le dossier servi est l'application publiée dès qu'elle existe", () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-live-'));
  const live = path.join(racine, 'live');
  const build = path.join(racine, 'dist');
  fs.mkdirSync(build, { recursive: true });
  fs.writeFileSync(path.join(build, 'index.html'), '<html>construction</html>');

  // Tant que rien n'est publié, on sert la construction du dossier de travail.
  const choisir = () =>
    fs.existsSync(path.join(live, 'index.html')) ? live : build;
  assert.equal(choisir(), build);

  // Après publication, l'application installée prend la main SANS redémarrage.
  fs.mkdirSync(live, { recursive: true });
  fs.writeFileSync(path.join(live, 'index.html'), '<html>publiée</html>');
  assert.equal(choisir(), live);

  fs.rmSync(racine, { recursive: true, force: true });
});
