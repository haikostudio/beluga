import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PLAFOND_ATTENTE_MS,
  TRANCHE_ATTENTE_MS,
  attenteExpiree,
  delaiOutilMoteurMs,
  texteDeReponseALaQuestion,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Une question ARRÊTE l'agent jusqu'à la réponse                       */
/* ------------------------------------------------------------------ */

/*
 * L'appel d'outil `ask_user` ne rend la main qu'une fois l'utilisateur ayant
 * répondu : c'est cela — et rien d'autre — qui empêche le moteur d'enchaîner
 * les étapes suivantes de sa liste. On vérifie ici les deux moitiés de la
 * mécanique : les textes rendus au moteur (règles pures) et le registre des
 * attentes (poser, réveiller, libérer).
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'attente-question-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const {
  agentEnAttente,
  annulerLAttente,
  attendreUneTranche,
  libererLesAttentes,
  oublierToutesLesAttentes,
  poserLAttente,
  repondreALAttente,
} = await import('../attente-question.js');

function agentDEssai() {
  return store.saveAgent({
    id: store.newId(),
    projectId: 'p1',
    role: 'task',
    title: 'essai',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any);
}

/* ------------------------------ Les textes ------------------------------ */

test('la réponse rendue au moteur dit quoi en faire', () => {
  const texte = texteDeReponseALaQuestion('Garde la base et déplace-la.');
  assert.match(texte, /Réponse de l'utilisateur : Garde la base/);
  assert.match(texte, /Reprends ton travail à partir de cette réponse/);
});

test('les fichiers joints à la réponse sont annoncés par leur chemin', () => {
  const texte = texteDeReponseALaQuestion('voir la capture', ['/tmp/a.png']);
  assert.match(texte, /\/tmp\/a\.png/);
});

test('le délai laissé aux moteurs dépasse le plafond d’attente', () => {
  assert.ok(delaiOutilMoteurMs() > PLAFOND_ATTENTE_MS);
});

test('une tranche est très courte devant le plafond', () => {
  assert.ok(TRANCHE_ATTENTE_MS < PLAFOND_ATTENTE_MS / 10);
});

test('le plafond se juge sur un temps donné, jamais sur l’horloge', () => {
  assert.equal(attenteExpiree(1000, 1000 + PLAFOND_ATTENTE_MS - 1), false);
  assert.equal(attenteExpiree(1000, 1000 + PLAFOND_ATTENTE_MS), true);
});

/* ----------------------------- Le registre ----------------------------- */

test('tant que personne ne répond, la tranche rend « attente »', async () => {
  const agent = agentDEssai();
  poserLAttente('q1', agent.id);
  const issue = await attendreUneTranche('q1', 10);
  assert.equal(issue.etat, 'attente');
  assert.equal(agentEnAttente(agent.id), true, "l'agent attend toujours");
  libererLesAttentes(agent.id);
});

test('la réponse réveille l’attente AVANT la fin de la tranche', async () => {
  const agent = agentDEssai();
  poserLAttente('q2', agent.id);
  // La tranche dort une minute : seule la réponse peut la réveiller à temps.
  const tranche = attendreUneTranche('q2', 60_000);
  assert.equal(repondreALAttente('q2', 'Oui, supprime-la'), true);
  const issue = await tranche;
  assert.equal(issue.etat, 'repondu');
  assert.match(issue.text, /Oui, supprime-la/);
  assert.equal(agentEnAttente(agent.id), false, "l'agent ne l'attend plus");
});

test('répondre deux fois à la même question ne réveille qu’une fois', async () => {
  const agent = agentDEssai();
  poserLAttente('q3', agent.id);
  assert.equal(repondreALAttente('q3', 'première'), true);
  assert.equal(repondreALAttente('q3', 'seconde'), false, 'la seconde ne trouve plus rien');
  const issue = await attendreUneTranche('q3', 10);
  assert.match(issue.text, /première/);
});

test('une réponse à une question que plus personne n’attend rend faux', () => {
  assert.equal(repondreALAttente('jamais-posee', 'réponse'), false);
});

test('annuler la question libère le tour sans rien trancher', async () => {
  const agent = agentDEssai();
  poserLAttente('q4', agent.id);
  assert.equal(annulerLAttente('q4'), true);
  const issue = await attendreUneTranche('q4', 10);
  assert.equal(issue.etat, 'annulee');
  assert.match(issue.text, /Ne devine pas à la place de l'utilisateur/);
  assert.equal(agentEnAttente(agent.id), false);
});

test('un tour refermé libère ses attentes, et le drapeau tombe', async () => {
  const agent = agentDEssai();
  poserLAttente('q5', agent.id);
  assert.equal(store.getAgent(agent.id)?.attendReponse, true, 'le drapeau est posé');
  libererLesAttentes(agent.id);
  const issue = await attendreUneTranche('q5', 10);
  assert.equal(issue.etat, 'perdue');
  assert.equal(store.getAgent(agent.id)?.attendReponse, undefined, 'le drapeau est retiré');
});

test('une question inconnue est PERDUE, jamais une attente sans fin', async () => {
  const issue = await attendreUneTranche('question-fantome', 10);
  assert.equal(issue.etat, 'perdue');
});

test('le plafond atteint arrête l’agent au lieu de le laisser deviner', async () => {
  const agent = agentDEssai();
  poserLAttente('q6', agent.id, Date.now() - PLAFOND_ATTENTE_MS - 1);
  const issue = await attendreUneTranche('q6', 10);
  assert.equal(issue.etat, 'expiree');
  assert.match(issue.text, /ARRÊTE-TOI ICI/);
  assert.equal(agentEnAttente(agent.id), false);
});

test('un redémarrage n’en laisse aucune debout', async () => {
  const agent = agentDEssai();
  poserLAttente('q7', agent.id);
  oublierToutesLesAttentes();
  assert.equal(agentEnAttente(agent.id), false);
  assert.equal(store.getAgent(agent.id)?.attendReponse, undefined);
  const issue = await attendreUneTranche('q7', 10);
  assert.equal(issue.etat, 'perdue');
});
