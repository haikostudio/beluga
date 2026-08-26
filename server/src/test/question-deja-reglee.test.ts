import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { carteRangee, decisionEnTexteLibre, type MessageAJuger } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Une question déjà réglée n'allume plus rien                          */
/* ------------------------------------------------------------------ */

/*
 * Le cas réel : la carte « Créer l'offre de maintenance annuelle INVIA ». Un
 * premier agent finit son fil sur une question, un second y répond et termine
 * le travail. Le message du premier reste le dernier de SON fil : tant que le
 * décompte regardait le dernier message PAR AGENT, la question se comptait
 * pour toujours. Il faut une vraie base pour le prouver — c'est la requête
 * SQL, pas la règle pure, qui choisissait le mauvais message.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'question-reglee-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');

const QUESTION =
  'Quelle formule dois-je inscrire dans l’offre : Essentielle — 20 h, 2 600 CHF/an ' +
  'ou Sérénité — 30 h, 3 900 CHF/an ?';

function projetDEssai() {
  return store.saveProject({
    id: store.newId(),
    name: 'Projet d’essai',
    path: bacASable,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

function carteDEssai(projectId: string, colonne: string) {
  return store.saveCard({
    id: store.newId(),
    projectId,
    title: 'Créer l’offre de maintenance annuelle',
    column: colonne,
    position: 1,
    run: {},
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

function agentDEssai(projectId: string, cardId: string) {
  return store.saveAgent({
    id: store.newId(),
    projectId,
    cardId,
    role: 'task',
    title: 'Agent d’essai',
    run: {},
    status: 'done',
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

function messageDEssai(agentId: string, content: string, createdAt: number) {
  return store.saveMessage({
    id: store.newId(),
    agentId,
    role: 'assistant',
    content,
    createdAt,
  } as any);
}

/** Les décisions comptées pour une carte donnée. */
function decisionsDeLaCarte(cardId: string) {
  return store.decisionsEnAttente().filter((d) => d.cardId === cardId && !d.reglee);
}

test('une question suivie d’un message plus récent d’un AUTRE agent ne compte plus', () => {
  const projet = projetDEssai();
  const carte = carteDEssai(projet.id, 'running');

  const ancien = agentDEssai(projet.id, carte.id);
  messageDEssai(ancien.id, `Voici l’état du chiffrage.\n\n${QUESTION}`, store.now() - 60_000);

  // Personne n'a encore repris : la question est bien la dernière chose dite.
  assert.equal(decisionsDeLaCarte(carte.id).length, 1, 'la question seule allume le triangle');

  const suivant = agentDEssai(projet.id, carte.id);
  messageDEssai(suivant.id, 'La formule Sérénité a été retenue, l’offre est créée.', store.now());

  assert.equal(
    decisionsDeLaCarte(carte.id).length,
    0,
    'un message plus récent sur la même carte règle la question',
  );
});

test('une carte rangée en « Archivé » ne réclame plus d’arbitrage', () => {
  const projet = projetDEssai();
  const carte = carteDEssai(projet.id, 'archived');
  const agent = agentDEssai(projet.id, carte.id);
  messageDEssai(agent.id, `Voici l’état du chiffrage.\n\n${QUESTION}`, store.now());

  assert.equal(decisionsDeLaCarte(carte.id).length, 0);
});

test('les trois colonnes rangées sont écartées, les autres non', () => {
  for (const colonne of ['done', 'to_deploy', 'archived']) {
    assert.equal(carteRangee(colonne), true, colonne);
    assert.equal(decisionEnTexteLibre({ statut: 'done', dernierMessage: message(), colonne }), null);
  }
  for (const colonne of ['notes', 'planned', 'running']) {
    assert.equal(carteRangee(colonne), false, colonne);
    assert.ok(decisionEnTexteLibre({ statut: 'done', dernierMessage: message(), colonne }));
  }
  // Sans colonne connue, on ne présume rien : la question compte comme avant.
  assert.ok(decisionEnTexteLibre({ statut: 'done', dernierMessage: message() }));
});

function message(): MessageAJuger {
  return { role: 'assistant', content: QUESTION };
}

/**
 * UNE QUESTION DE L'OUTIL SUR UNE CARTE FERMÉE NE COMPTE PLUS NON PLUS. C'était
 * le dernier trou : la question écrite en texte ordinaire s'éteignait sur une
 * carte rangée, celle d'`ask_user` continuait d'allumer le triangle et le
 * bouton « Répondre » sur une carte archivée ou déjà en production, dont le
 * tour n'existait même plus. « Terminé », en revanche, garde ses questions : le
 * travail peut y être repris.
 */
function questionDOutil(agentId: string) {
  return store.saveMessage({
    id: store.newId(),
    agentId,
    role: 'assistant',
    content: 'Un choix est nécessaire.',
    questions: [{ id: store.newId(), question: 'Quelle formule ?', kind: 'text' }],
    createdAt: store.now(),
  } as any);
}

test('une question de l’outil s’éteint sur une carte fermée, pas sur une carte terminée', () => {
  const projet = projetDEssai();

  for (const colonne of ['to_deploy', 'archived']) {
    const carte = carteDEssai(projet.id, colonne);
    questionDOutil(agentDEssai(projet.id, carte.id).id);
    assert.equal(decisionsDeLaCarte(carte.id).length, 0, colonne);
  }

  for (const colonne of ['running', 'done']) {
    const carte = carteDEssai(projet.id, colonne);
    questionDOutil(agentDEssai(projet.id, carte.id).id);
    assert.equal(decisionsDeLaCarte(carte.id).length, 1, colonne);
  }
});
