import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentApresNouveauDepart,
  cleNouveauDepart,
  comptePrecedents,
  libellePrecedents,
  messagesDepuis,
  peutRepartir,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Repartir de zéro dans la conversation du chef d'orchestre           */
/* ------------------------------------------------------------------ */

const fil = [
  { createdAt: 100 },
  { createdAt: 200 },
  { createdAt: 300 },
  { createdAt: 400 },
];

test('la clé du repère ne change pas, et chaque agent a la sienne', () => {
  assert.equal(cleNouveauDepart('a1'), 'chat.depart.a1');
  assert.notEqual(cleNouveauDepart('a1'), cleNouveauDepart('a2'));
});

/* -------- Quand le bouton peut agir -------- */

test('on ne coupe pas le fil sous un agent qui travaille', () => {
  const verdict = peutRepartir({ status: 'running' }, fil);
  assert.equal(verdict.ok, false);
  assert.match(verdict.raison, /travaille/);
});

test("une réponse encore en train d'arriver bloque aussi le bouton", () => {
  const verdict = peutRepartir({ status: 'idle' }, [{ createdAt: 100, streaming: true }]);
  assert.equal(verdict.ok, false);
});

test('une conversation déjà neuve ne se remet pas à zéro', () => {
  assert.equal(peutRepartir({ status: 'idle' }, []).ok, false);
});

test('un agent au repos avec des échanges : le bouton agit', () => {
  const verdict = peutRepartir({ status: 'idle' }, fil);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.raison, '');
});

test("sans agent, rien à remettre à zéro", () => {
  assert.equal(peutRepartir(null, fil).ok, false);
});

/* -------- Ce qui reste visible -------- */

test('le repère ne montre que les échanges qui suivent', () => {
  assert.deepEqual(messagesDepuis(fil, 300), [{ createdAt: 300 }, { createdAt: 400 }]);
});

test('un message posé à la seconde même du départ appartient au nouveau fil', () => {
  assert.equal(messagesDepuis([{ createdAt: 250 }], 250).length, 1);
});

test('sans repère, tout le fil reste visible', () => {
  assert.equal(messagesDepuis(fil, 0).length, 4);
  assert.equal(messagesDepuis(fil, undefined).length, 4);
});

test('un repère farfelu ne fait jamais disparaître une conversation', () => {
  assert.equal(messagesDepuis(fil, 'hier').length, 4);
  assert.equal(messagesDepuis(fil, Number.NaN).length, 4);
  assert.equal(messagesDepuis(fil, -5).length, 4);
});

test('rien n’est supprimé : ce qui sort de la vue est compté', () => {
  assert.equal(comptePrecedents(fil, 300), 2);
  assert.equal(comptePrecedents(fil, 0), 0);
});

/* -------- Ce que l'agent oublie -------- */

const agentCharge = {
  id: 'a1',
  run: { engine: 'claude', model: 'opus' },
  account: 'perso',
  contextUsage: { usedTokens: 18_000, capacityTokens: 200_000, percentage: 9, measuredAt: 1 },
  context: { tokens: 18_000, window: 200_000, ratio: 0.09, armed: true, pending: false, continuitySummary: 'le fil d’avant' },
  todos: { done: 3, total: 3 },
};

test('repartir de zéro efface la mesure de contexte : plus de pourcentage sur un fil vide', () => {
  assert.equal(agentApresNouveauDepart(agentCharge).contextUsage, undefined);
});

test("repartir de zéro efface l'état de remplissage ET son résumé de continuité", () => {
  // Sans cela, le premier tour de la conversation neuve renverrait au moteur
  // un résumé du fil que l'utilisateur venait de couper.
  assert.equal(agentApresNouveauDepart(agentCharge).context, undefined);
});

test("l'avancement d'une liste de tâches ne survit pas au départ à zéro", () => {
  assert.equal(agentApresNouveauDepart(agentCharge).todos, undefined);
});

test('le reste de l’agent ne bouge pas : on remet à zéro une conversation, pas un agent', () => {
  const neuf = agentApresNouveauDepart(agentCharge);
  assert.equal(neuf.id, 'a1');
  assert.equal(neuf.account, 'perso');
  assert.deepEqual(neuf.run, { engine: 'claude', model: 'opus' });
});

test("un agent qui n'a jamais parlé traverse la remise à zéro sans dommage", () => {
  const nu = { contextUsage: undefined, titre: 'Chef' };
  const neuf = agentApresNouveauDepart(nu);
  assert.equal(neuf.titre, 'Chef');
  assert.equal(neuf.contextUsage, undefined);
  // L'original n'est jamais modifié sur place : une copie, toujours.
  assert.notEqual(neuf, nu);
});

/* -------- Ce que dit le lien -------- */

test('le lien se dit au singulier comme au pluriel, et se tait à zéro', () => {
  assert.equal(libellePrecedents(0), '');
  assert.equal(libellePrecedents(1), 'Voir le message précédent');
  assert.equal(libellePrecedents(7), 'Voir les 7 messages précédents');
});
