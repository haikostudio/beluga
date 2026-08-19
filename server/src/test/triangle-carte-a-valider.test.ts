/**
 * TOUTE CARTE À VALIDER ALLUME LE TRIANGLE DU PROJET, D'OÙ QU'ELLE VIENNE.
 *
 * Le défaut constaté le 19/08/2026 sur HaikoFormations : le panneau « Carte à
 * valider » s'affichait dans la conversation, boutons compris, et la ligne du
 * projet restait NUE dans la colonne de gauche.
 *
 * Deux causes, deux verrous ici :
 *  1. L'ORDRE. Le compte des décisions se lit dans la TABLE des propositions,
 *     mais chaque appelant l'y écrivait APRÈS l'attachement au message — donc
 *     après l'émission du signal. Le signal partait sur une table qui ne
 *     contenait pas encore la proposition, et rien ne le rejouait ensuite.
 *  2. LA SOURCE UNIQUE. L'écran lit le message, le compte lisait la table :
 *     deux sources, deux occasions de diverger.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'triangle-carte-'));
process.env.HAIKODEV_DATA = bacASable;

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

function chefDEssai(projectId: string) {
  return store.saveAgent({
    id: store.newId(),
    projectId,
    role: 'orchestrator',
    title: 'Chef d’orchestre',
    run: {},
    status: 'running',
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

function proposition(titre: string) {
  return {
    id: store.newId(),
    title: titre,
    description: 'Constat, attendu, limites et vérification.',
    labels: [],
    attachments: [],
    sourceProposalIds: [],
    decision: 'pending' as const,
  };
}

function messageAvecProposition(agentId: string, prop: ReturnType<typeof proposition>) {
  return store.saveMessage({
    id: store.newId(),
    agentId,
    role: 'assistant',
    content: 'Carte proposée.',
    proposals: [prop],
    createdAt: store.now(),
  } as any);
}

/* ------------------------------------------------------------------ */
/* 1. Le filet : le message porte la proposition, la table ne l'a pas   */
/* ------------------------------------------------------------------ */

test('une carte à valider affichée dans le fil compte, même absente de la table', () => {
  const projet = projetDEssai();
  const chef = chefDEssai(projet.id);
  messageAvecProposition(chef.id, proposition('Mettre tous les prix à 99 CHF'));

  const compte = store.projectsNeedingAttention();
  assert.equal(compte[projet.id], 1, 'le triangle du projet doit s’allumer');
});

test('la même proposition n’est jamais comptée deux fois', () => {
  const projet = projetDEssai();
  const chef = chefDEssai(projet.id);
  const prop = proposition('Refaire la page d’accueil');
  const message = messageAvecProposition(chef.id, prop);
  store.saveProposal(message.id, projet.id, prop as any);

  assert.equal(store.projectsNeedingAttention()[projet.id], 1, 'une proposition, un seul repère');
});

test('une proposition tranchée dans la table n’allume plus rien', () => {
  const projet = projetDEssai();
  const chef = chefDEssai(projet.id);
  const prop = proposition('Exporter les cartes');
  const message = messageAvecProposition(chef.id, prop);
  store.saveProposal(message.id, projet.id, prop as any);
  store.decideProposal(prop.id, 'accepted');

  assert.equal(
    store.projectsNeedingAttention()[projet.id],
    undefined,
    'la décision prise éteint le triangle, même si le message n’a pas encore été réécrit',
  );
});

/* ------------------------------------------------------------------ */
/* 2. L'ordre : le signal ne part jamais avant l'enregistrement          */
/* ------------------------------------------------------------------ */

test('le signal d’attention part APRÈS que la proposition est rangée', async () => {
  const { attachToCurrentMessage } = await import('../runtime.js');
  const { bus } = await import('../bus.js');

  const projet = projetDEssai();
  const chef = chefDEssai(projet.id);
  store.saveMessage({
    id: store.newId(),
    agentId: chef.id,
    role: 'assistant',
    content: 'Voici ce que je propose.',
    createdAt: store.now(),
  } as any);

  const comptes: number[] = [];
  const stop = bus.subscribe((event: any) => {
    if (event.type === 'attention') comptes.push(event.byProject[projet.id] ?? 0);
  });

  attachToCurrentMessage(chef.id, { proposal: proposition('Ajouter un bouton d’export') as any });
  stop();

  assert.ok(comptes.length > 0, 'un signal d’attention doit partir');
  assert.ok(
    comptes.every((compte) => compte >= 1),
    `le signal doit déjà porter la carte à valider (reçu : ${comptes.join(', ')})`,
  );
});

test('la proposition attachée est bien rangée dans sa table', async () => {
  const { attachToCurrentMessage } = await import('../runtime.js');

  const projet = projetDEssai();
  const chef = chefDEssai(projet.id);
  store.saveMessage({
    id: store.newId(),
    agentId: chef.id,
    role: 'assistant',
    content: 'Voici ce que je propose.',
    createdAt: store.now(),
  } as any);

  const prop = proposition('Réduire les espaces des formations');
  const messageId = attachToCurrentMessage(chef.id, { proposal: prop as any });

  assert.ok(messageId, 'la proposition doit trouver son message');
  const { getDb } = await import('../db.js');
  const rangee = getDb()
    .prepare('SELECT message_id AS messageId, decision FROM proposals WHERE id = ?')
    .get(prop.id) as { messageId: string; decision: string } | undefined;
  assert.equal(rangee?.messageId, messageId, 'rangée sous le message réellement touché');
  assert.equal(rangee?.decision, 'pending');
});
