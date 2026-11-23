import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * L'ENTRETIEN INVISIBLE DE LA VERSION LIBRE (décision du 30/10/2026,
 * `shared/src/entretien-invisible.ts`) — ce qui ne doit jamais casser :
 *
 *  - hors de la machine de l'auteur, une routine d'ENTRETIEN est invisible ;
 *    sur la machine de l'auteur, elle reste visible ;
 *  - une routine qui PROPOSE, ou qu'un geste a demandée, reste visible partout ;
 *  - la carte invisible existe en base (le rangement la traite), mais ne paraît
 *    ni dans les paquets du tableau, ni dans ses compteurs, ni sur « En route »,
 *    ni dans la recherche, ni dans les archives, ni dans les pastilles « non lu ».
 *
 * Le bac à sable est posé AVANT le premier import du démon.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'entretien-invisible-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const { Project } = shared;
const store = await import('../store.js');
const { ouvrirCarteDAgent, rangerCarteDAgent } = await import('../carte-d-agent-demon.js');
const { machineDeLAuteur } = await import('../depot-public.js');

const projet = store.saveProject(
  Project.parse({ id: 'projet-libre', name: 'Projet Libre', path: bacASable, createdAt: store.now(), updatedAt: store.now() }),
);

test('seule une routine d’entretien est invisible, et seulement hors de la machine de l’auteur', () => {
  assert.equal(shared.routineInvisible('entretien', false), true);
  assert.equal(shared.routineInvisible('entretien', true), false);
  for (const genre of ['proposition', 'demandee'] as const) {
    assert.equal(shared.routineInvisible(genre, false), false, genre);
    assert.equal(shared.routineInvisible(genre, true), false, genre);
  }
  assert.equal(shared.carteDEntretienInvisible({ labels: [shared.LABEL_ENTRETIEN_INVISIBLE] }), true);
  assert.equal(shared.carteDEntretienInvisible({ labels: ['rendez-vous de nuit'] }), false);
  assert.equal(shared.carteDEntretienInvisible(null), false);
  assert.equal(shared.agentDEntretienInvisible({ entretienInvisible: true }), true);
  assert.equal(shared.agentDEntretienInvisible({}), false);
});

test('la machine de l’auteur se force par l’environnement, dans les deux sens', () => {
  const avant = process.env.BELUGA_MACHINE_AUTEUR;
  try {
    process.env.BELUGA_MACHINE_AUTEUR = '0';
    assert.equal(machineDeLAuteur(), false);
    process.env.BELUGA_MACHINE_AUTEUR = '1';
    assert.equal(machineDeLAuteur(), true);
  } finally {
    if (avant === undefined) delete process.env.BELUGA_MACHINE_AUTEUR;
    else process.env.BELUGA_MACHINE_AUTEUR = avant;
  }
});

test('la carte d’un entretien invisible vit en base, mais ne paraît ni ne compte nulle part', () => {
  const cachee = ouvrirCarteDAgent({
    projectId: projet.id,
    titre: 'Ménage des compétences',
    description: 'entretien de nuit',
    labels: ['rendez-vous de nuit'],
    role: 'analysis',
    invisible: true,
  });
  const montree = ouvrirCarteDAgent({
    projectId: projet.id,
    titre: 'Examen de nuit',
    description: 'proposition',
    labels: ['rendez-vous de nuit'],
    role: 'analysis',
  });

  // En base, avec ses marques : le rangement et le balayage la voient.
  const enBase = store.getCard(cachee.card.id);
  assert.equal(enBase?.column, 'running');
  assert.ok(enBase?.labels.includes(shared.LABEL_ENTRETIEN_INVISIBLE));
  assert.equal(store.getAgent(cachee.agentId)?.entretienInvisible, true);
  assert.equal(store.carteInvisible(cachee.card.id), true);
  assert.equal(store.agentInvisible(cachee.agentId), true);
  assert.equal(store.carteInvisible(montree.card.id), false);
  assert.equal(store.agentInvisible(montree.agentId), false);
  assert.ok(store.cartesEnCours().some((c) => c.id === cachee.card.id), 'le balayage des cartes en cours la traite');

  // Au travail : ni paquet, ni compteur, ni « En route », ni recherche.
  const tranche = store.premiereTrancheDeCartes(projet.id);
  const ids = tranche.cards.map((c) => c.id);
  assert.ok(ids.includes(montree.card.id) && !ids.includes(cachee.card.id), ids.join(', '));
  assert.equal(tranche.totaux.running, 1, 'le compteur de colonne compte ce que la liste montre');
  assert.equal(store.trancheDeCartes(projet.id, 'running', undefined).total, 1);
  const enRoute = store.cartesEnRoute(undefined).cards.map((c) => c.id);
  assert.ok(enRoute.includes(montree.card.id) && !enRoute.includes(cachee.card.id), enRoute.join(', '));
  const trouvees = store.rechercherDesCartes('nuit', { projectId: projet.id }).map((c) => c.card.id);
  assert.ok(!trouvees.includes(cachee.card.id), trouvees.join(', '));

  // Rangée : ni dans les archives, ni dans les pastilles « non lu ».
  assert.ok(rangerCarteDAgent(cachee.card.id, cachee.agentId, 'archived', 'fait'));
  assert.ok(rangerCarteDAgent(montree.card.id, montree.agentId, 'planned', 'à décider'));
  assert.equal(store.getCard(cachee.card.id)?.column, 'archived');
  assert.equal(store.trancheDeCartes(projet.id, 'archived', undefined).total, 0);
  const archives = store.cartesEnRoute(undefined, undefined, 'terminer').cards.map((c) => c.id);
  assert.ok(!archives.includes(cachee.card.id), archives.join(', '));
  assert.ok(!store.unreadCards(projet.id).includes(cachee.card.id));
});

test('une question de l’entretien invisible n’allume pas la cloche, celle d’une carte visible oui', () => {
  const poser = (invisible: boolean) => {
    const { card, agentId } = ouvrirCarteDAgent({
      projectId: projet.id,
      titre: invisible ? 'Ménage des compétences' : 'Examen de nuit',
      description: 'question',
      labels: [],
      role: 'analysis',
      invisible,
    });
    store.saveMessage({
      id: store.newId(),
      agentId,
      role: 'assistant',
      content: 'Un choix est nécessaire.',
      questions: [{ id: store.newId(), question: 'Quelle formule ?', kind: 'text' }],
      createdAt: store.now(),
    } as Parameters<typeof store.saveMessage>[0]);
    return card.id;
  };
  const cachee = poser(true);
  const montree = poser(false);
  const decisions = store.decisionsEnAttente().filter((d) => !d.reglee);
  assert.ok(decisions.some((d) => d.cardId === montree), 'la carte visible garde sa question');
  assert.ok(!decisions.some((d) => d.cardId === cachee), 'la carte invisible ne pose rien dans la cloche');
});

test('la dernière porte vers l’écran retire ce qui parle d’un entretien invisible, et l’ôte des listes', () => {
  const juges = { carte: (id?: string) => id === 'carte-cachee', agent: (id?: string) => id === 'agent-cache' };
  const porte = shared.evenementSansEntretienInvisible;
  assert.equal(porte({ type: 'card.upsert', card: { id: 'carte-cachee' } }, juges), null);
  assert.equal(porte({ type: 'agent.upsert', agent: { id: 'agent-cache' } }, juges), null);
  assert.equal(porte({ type: 'message.upsert', message: { id: 'm', agentId: 'agent-cache' } }, juges), null);
  assert.equal(porte({ type: 'card.conversation', cardId: 'carte-cachee' }, juges), null);
  const ordinaire = { type: 'card.upsert', card: { id: 'carte-visible' } };
  assert.equal(porte(ordinaire, juges), ordinaire, 'un événement ordinaire part tel quel');
  const liste = porte(
    { type: 'project.etat', cards: [{ id: 'carte-cachee' }, { id: 'carte-visible' }], agents: [{ id: 'agent-cache' }, { id: 'agent-visible' }] },
    juges,
  );
  assert.deepEqual(liste?.cards, [{ id: 'carte-visible' }]);
  assert.deepEqual(liste?.agents, [{ id: 'agent-visible' }]);
});
