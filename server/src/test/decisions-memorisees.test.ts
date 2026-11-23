import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* Les décisions en attente : gardées tant que la base ne bouge pas     */
/* ------------------------------------------------------------------ */

/*
 * Le calcul des décisions bloquait le démon 1,5 s par appel, et la veille de
 * quinze secondes l'enchaînait plusieurs fois sans rien écrire entre deux.
 * Il est désormais gardé tant que la base n'a pas bougé — ces essais
 * verrouillent que la moindre écriture le refait, et que le filtre SQL des
 * cartes rangées dit la même chose que l'ancien filtre en code.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'decisions-memorisees-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');

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
    title: 'Une carte qui attend',
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

const deLaCarte = (cardId: string) => store.decisionsEnAttente().filter((d) => d.cardId === cardId && !d.reglee);

test('sans écriture, le même résultat revient, et le modifier ne touche pas le suivant', () => {
  const projet = projetDEssai();
  const carte = carteDEssai(projet.id, 'running');
  const agent = agentDEssai(projet.id, carte.id);
  store.saveMessage({
    id: store.newId(),
    agentId: agent.id,
    role: 'assistant',
    content: 'Un choix est nécessaire.',
    questions: [{ id: store.newId(), question: 'Quelle formule ?', kind: 'text' }],
    createdAt: store.now(),
  } as any);

  const premier = store.decisionsEnAttente();
  premier.length = 0;
  const second = store.decisionsEnAttente();
  assert.ok(second.some((d) => d.cardId === carte.id && d.source === 'question-outil'));
});

test('une question posée APRÈS un premier calcul est vue au suivant', () => {
  const projet = projetDEssai();
  const carte = carteDEssai(projet.id, 'running');
  const agent = agentDEssai(projet.id, carte.id);
  assert.equal(deLaCarte(carte.id).length, 0);

  store.saveMessage({
    id: store.newId(),
    agentId: agent.id,
    role: 'assistant',
    content: 'Un choix est nécessaire.',
    questions: [{ id: store.newId(), question: 'Quelle formule ?', kind: 'text' }],
    createdAt: store.now(),
  } as any);
  assert.equal(deLaCarte(carte.id).length, 1);
});

test('une carte rangée après coup perd sa question au calcul suivant', () => {
  const projet = projetDEssai();
  const carte = carteDEssai(projet.id, 'running');
  const agent = agentDEssai(projet.id, carte.id);
  store.saveMessage({
    id: store.newId(),
    agentId: agent.id,
    role: 'assistant',
    content: 'Un choix est nécessaire.',
    questions: [{ id: store.newId(), question: 'Quelle formule ?', kind: 'text' }],
    createdAt: store.now(),
  } as any);
  assert.equal(deLaCarte(carte.id).length, 1);

  store.saveCard({ ...store.getCard(carte.id)!, column: 'archived' });
  assert.equal(deLaCarte(carte.id).length, 0);
});

test('la question écrite en texte ne compte ni sur une carte rangée ni pendant le travail', () => {
  const projet = projetDEssai();
  const ouverte = carteDEssai(projet.id, 'running');
  const rangee = carteDEssai(projet.id, 'archived');
  const texte =
    'J’ai préparé les deux variantes de la page d’accueil : laquelle voulez-vous retenir pour la mise en ligne ?';
  for (const carte of [ouverte, rangee]) {
    const agent = agentDEssai(projet.id, carte.id);
    store.saveMessage({
      id: store.newId(),
      agentId: agent.id,
      role: 'assistant',
      content: texte,
      createdAt: store.now(),
    } as any);
  }
  assert.ok(deLaCarte(ouverte.id).some((d) => d.source === 'question-en-texte'));
  assert.equal(deLaCarte(rangee.id).length, 0);

  // Le même agent se remet au travail : son dernier message n'est plus le mot de la fin.
  const agentOuvert = store.listAgents(projet.id).find((a) => a.cardId === ouverte.id)!;
  store.saveAgent({ ...agentOuvert, status: 'running' });
  assert.ok(!deLaCarte(ouverte.id).some((d) => d.source === 'question-en-texte'));
});
