import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Agent,
  colonneAuDemarrage,
  colonneEnFinDeTour,
  demarrageAutomatiqueAutorise,
} from '@haikodev/shared';
import { reprendPourExecution } from '../scheduler.js';

/* ------------------------------------------------------------------ */
/* SESSION FUSIONNÉE : pause obligatoire après l'analyse               */
/*                                                                     */
/* Le chiffrage et l'exécution partagent un même agent et un même      */
/* contexte (on économise le quota), mais l'agent d'analyse ne doit    */
/* JAMAIS enchaîner tout seul sur l'exécution : une carte fraîchement  */
/* analysée reste en attente tant que l'utilisateur n'a pas cliqué.    */
/* Le partage de contexte (reprendPourExecution) est préservé.         */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.resolve(ICI, '../../src');

function lire(fichier: string): string {
  return fs.readFileSync(path.join(SOURCES, fichier), 'utf8');
}

function agent(role: Agent['role'], id = 'a1'): Agent {
  return Agent.parse({
    id,
    projectId: 'p1',
    cardId: 'c1',
    role,
    title: 'x',
    run: { engine: 'claude' },
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
  });
}

/* -------- La règle pure : qui l'ordonnanceur démarre de lui-même -------- */

test('une carte fraîchement analysée (jamais lancée) ne part pas toute seule', () => {
  // Sortie de l'analyse : promue en « Planifié », mais attempts = 0, pas asap.
  assert.equal(demarrageAutomatiqueAutorise({ asap: false, attempts: 0, restarts: 0 }), false);
  // Un scheduling absent est traité comme « pas encore autorisé ».
  assert.equal(demarrageAutomatiqueAutorise(undefined), false);
});

test('« Dès que possible » EST le geste de lancement : la carte peut partir', () => {
  assert.equal(demarrageAutomatiqueAutorise({ asap: true, attempts: 0, restarts: 0 }), true);
});

test('une carte déjà lancée puis interrompue se reprend sans nouveau clic', () => {
  // Un tour coupé (attempts) ou une reprise après redémarrage (restarts).
  assert.equal(demarrageAutomatiqueAutorise({ asap: false, attempts: 1, restarts: 0 }), true);
  assert.equal(demarrageAutomatiqueAutorise({ asap: false, attempts: 0, restarts: 1 }), true);
});

/* -------- Le tour d'analyse ne touche RIEN sur le tableau -------- */

test("un tour d'analyse ne fait entrer aucune carte en « En cours »", () => {
  // Le rôle « analysis » ne déplace jamais une carte, quelle que soit sa colonne.
  assert.equal(colonneAuDemarrage('planned', 'analysis'), null);
  assert.equal(colonneAuDemarrage('notes', 'analysis'), null);
  // …et il ne la clôt pas non plus, même s'il avait modifié le dépôt.
  assert.equal(colonneEnFinDeTour('running', true, 'analysis', true), null);
});

test("seul l'agent d'EXÉCUTION fait basculer la carte en « En cours »", () => {
  assert.equal(colonneAuDemarrage('planned', 'task'), 'running');
});

/* -------- À la validation, l'exécution reprend le MÊME contexte -------- */

test("le clic reçu, l'exécution reprend l'agent d'analyse (contexte partagé)", () => {
  // C'est la fusion qu'on préserve : pas de second agent, le fil se poursuit.
  assert.equal(reprendPourExecution(agent('analysis'), false), true);
});

/* -------- Verrous de code : la garde ne peut pas être contournée -------- */

test("l'ordonnanceur gate son démarrage sur la règle de pause", () => {
  const scheduler = lire('scheduler.ts');
  // La boucle de démarrage saute toute carte non autorisée.
  assert.match(scheduler, /if \(!demarrageAutomatiqueAutorise\(card\.scheduling\)\) continue;/);
});

test("l'analyse chiffre SUR PLACE : elle ne déplace plus aucune carte", () => {
  const scheduler = lire('scheduler.ts');
  // Le corps d'analyseCard : il n'écrit AUCUNE colonne, donc encore moins
  // « En cours ». La carte naît et reste dans « Planifié » le temps du
  // chiffrage — il n'y a plus de promotion à faire.
  const corps = scheduler.split('export async function analyseCard(')[1].split('\nexport ')[0];
  assert.doesNotMatch(corps, /column: 'running'/);
  assert.doesNotMatch(corps, /\bcolumn:/);
});

test("une carte en plein chiffrage n'est pas lancée par l'ordonnanceur", () => {
  const scheduler = lire('scheduler.ts');
  // La carte ne quitte plus « Planifié » pendant son analyse : la boucle de
  // démarrage doit donc l'écarter elle-même, sinon un « Dès que possible »
  // poserait un agent d'exécution par-dessus l'agent d'analyse.
  assert.match(scheduler, /if \(analysing\.has\(card\.id\)\) continue;/);
  assert.match(scheduler, /if \(card\.analyseDemandee && !card\.estimate\) continue;/);
});
