import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { colonneFermeLesQuestions, fermetureDesQuestions } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Une carte rangée ferme ses questions                                 */
/* ------------------------------------------------------------------ */

/*
 * Le cas réel : une carte déjà « En production » affichait encore « Répondre »,
 * pour une question dont le tour était mort depuis longtemps — et le bloc de
 * réponse dormait dans le fil d'un ancien agent, invisible. Deux gestes
 * répondent : le déplacement ferme d'office (`rangerLaCarte`), et le bouton
 * « Annuler » de la carte coupe tout d'un coup (`fermerLesQuestionsDeLaCarte`).
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'fermeture-questions-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { fermerLesQuestionsDeLaCarte } = await import('../fermeture-questions.js');
const { rangerLaCarte } = await import('../deplacement-carte.js');

const QUESTION_TEXTE =
  'Faut-il retenir la formule Essentielle ou la formule Sérénité pour cette offre ?';

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
    title: 'Une carte qui pose une question',
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

function messageAvecQuestionDOutil(agentId: string, createdAt = store.now()) {
  return store.saveMessage({
    id: store.newId(),
    agentId,
    role: 'assistant',
    content: 'Un choix est nécessaire.',
    questions: [{ id: store.newId(), question: 'Quelle formule ?', kind: 'text' }],
    createdAt,
  } as any);
}

function decisionsDeLaCarte(cardId: string) {
  return store.decisionsEnAttente().filter((d) => d.cardId === cardId && !d.reglee);
}

test('la règle nomme les trois colonnes qui ferment, et elles seules', () => {
  for (const colonne of ['to_deploy', 'in_production', 'archived']) {
    assert.equal(colonneFermeLesQuestions(colonne), true, colonne);
  }
  for (const colonne of ['notes', 'planned', 'running', 'done']) {
    assert.equal(colonneFermeLesQuestions(colonne), false, colonne);
  }
  // Sans colonne connue, on ne présume rien.
  assert.equal(colonneFermeLesQuestions(undefined), false);

  // Seule l'ARRIVÉE dans une colonne close déclenche la fermeture.
  assert.equal(fermetureDesQuestions('running', 'archived'), true);
  assert.equal(fermetureDesQuestions('done', 'to_deploy'), true);
  assert.equal(fermetureDesQuestions('to_deploy', 'in_production'), false, 'déjà close');
  assert.equal(fermetureDesQuestions('archived', 'running'), false, 'retour en arrière');
  assert.equal(fermetureDesQuestions('running', 'done'), false);
});

test('archiver une carte ferme la question de l’outil restée ouverte', () => {
  const projet = projetDEssai();
  const carte = carteDEssai(projet.id, 'running');
  const agent = agentDEssai(projet.id, carte.id);
  const message = messageAvecQuestionDOutil(agent.id);

  assert.equal(decisionsDeLaCarte(carte.id).length, 1, 'la question attend');

  rangerLaCarte(store.getCard(carte.id)!, 'archived');

  assert.equal(decisionsDeLaCarte(carte.id).length, 0, 'la question est fermée');
  const frais = store.getMessage(message.id)!;
  assert.equal(frais.questions[0].cancelled, true, 'la question porte sa marque d’annulation');
});

test('une réponse déjà donnée n’est pas écrasée par la fermeture', () => {
  const projet = projetDEssai();
  const carte = carteDEssai(projet.id, 'running');
  const agent = agentDEssai(projet.id, carte.id);
  const message = messageAvecQuestionDOutil(agent.id);
  const repondu = store.saveMessage({
    ...message,
    questions: message.questions.map((q) => ({ ...q, answer: 'Sérénité', answeredAt: store.now() })),
  } as any);

  rangerLaCarte(store.getCard(carte.id)!, 'to_deploy');

  const frais = store.getMessage(repondu.id)!;
  assert.equal(frais.questions[0].answer, 'Sérénité');
  assert.notEqual(frais.questions[0].cancelled, true, 'une question répondue n’est pas annulée');
});

test('le bouton « Annuler » de la carte coupe tout, question de l’outil comme texte libre', () => {
  const projet = projetDEssai();
  const carte = carteDEssai(projet.id, 'running');

  const ancien = agentDEssai(projet.id, carte.id);
  const cachee = messageAvecQuestionDOutil(ancien.id, store.now() - 120_000);

  const recent = agentDEssai(projet.id, carte.id);
  const enTexte = store.saveMessage({
    id: store.newId(),
    agentId: recent.id,
    role: 'assistant',
    content: `Le travail est prêt.\n\n${QUESTION_TEXTE}`,
    createdAt: store.now(),
  } as any);

  assert.equal(decisionsDeLaCarte(carte.id).length, 2, 'les deux questions attendent');

  const fermees = fermerLesQuestionsDeLaCarte(carte.id);

  assert.equal(fermees, 1, 'une seule question d’outil à fermer');
  assert.equal(decisionsDeLaCarte(carte.id).length, 0, 'plus aucune décision sur la carte');
  assert.equal(store.getMessage(cachee.id)!.questions[0].cancelled, true);
  assert.equal(store.getMessage(enTexte.id)!.texteLibreAnnulee, true);
  // La carte n'a pas bougé : annuler n'est pas ranger.
  assert.equal(store.getCard(carte.id)!.column, 'running');
});
