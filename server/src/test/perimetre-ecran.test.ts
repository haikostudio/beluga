import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClientEnvelope, ServerEvent } from '@beluga/shared';
import { detailPourCetEcran, elargirLePerimetre, type LecturesDuPerimetre } from '../perimetre-ecran.js';

/** Deux projets, un agent de tâche dans chacun. Aucune base. */
const lire: LecturesDuPerimetre = {
  agent: (id) => ({ 'a-vu': { projectId: 'p-vu', cardId: 'c-vu' }, 'a-ailleurs': { projectId: 'p-ailleurs', cardId: 'c-ailleurs' } })[id] ?? null,
  carte: (id) => ({ 'c-vu': { projectId: 'p-vu' }, 'c-ailleurs': { projectId: 'p-ailleurs' } })[id] ?? null,
};
const ecran = (projet: string | null = 'p-vu') => ({ projet, agents: new Set<string>(), cartes: new Set<string>() });
const evenement = (objet: unknown) => objet as ServerEvent;
const commande = (objet: unknown) => objet as ClientEnvelope['cmd'];
const fragment = (agentId: string) => evenement({ type: 'message.upsert', message: { id: 'm', agentId } });

test('le fil d’un agent du projet affiché arrive, celui d’un autre projet non', () => {
  assert.equal(detailPourCetEcran(fragment('a-vu'), ecran(), lire), true);
  assert.equal(detailPourCetEcran(fragment('a-ailleurs'), ecran(), lire), false);
});

test('ce qui nourrit la colonne des projets, le triangle et la cloche part toujours', () => {
  for (const type of ['agent.upsert', 'card.upsert', 'card.deplacee', 'attention', 'notify', 'toast', 'quotas', 'project.etat', 'agent.etat', 'card.conversation']) {
    assert.equal(detailPourCetEcran(evenement({ type, agent: { id: 'a-ailleurs' } }), ecran(), lire), true, type);
  }
});

test('le journal, le carnet et la file suivent la même règle', () => {
  assert.equal(detailPourCetEcran(evenement({ type: 'journal.entree', entree: { cardId: 'c-ailleurs' } }), ecran(), lire), false);
  assert.equal(detailPourCetEcran(evenement({ type: 'carnet.lignes', cardId: 'c-ailleurs', lignes: [] }), ecran(), lire), false);
  assert.equal(detailPourCetEcran(evenement({ type: 'queue.etat', agentId: 'a-ailleurs', queue: [] }), ecran(), lire), false);
  assert.equal(detailPourCetEcran(evenement({ type: 'journal.entree', entree: { cardId: 'c-vu' } }), ecran(), lire), true);
});

test('ouvrir une conversation, ou la carte de l’agent, fait arriver son fil d’où qu’il vienne', () => {
  const parAgent = ecran();
  elargirLePerimetre(parAgent, commande({ type: 'agent.open', id: 'a-ailleurs' }));
  assert.equal(detailPourCetEcran(fragment('a-ailleurs'), parAgent, lire), true);

  const parCarte = ecran();
  elargirLePerimetre(parCarte, commande({ type: 'card.conversation', cardId: 'c-ailleurs' }));
  assert.equal(detailPourCetEcran(fragment('a-ailleurs'), parCarte, lire), true);

  const parJournal = ecran();
  elargirLePerimetre(parJournal, commande({ type: 'card.journal', cardId: 'c-ailleurs' }));
  assert.equal(detailPourCetEcran(evenement({ type: 'journal.entree', entree: { cardId: 'c-ailleurs' } }), parJournal, lire), true);
});

test('changer de projet déplace le périmètre ; ce qui a été ouvert reste suivi', () => {
  const p = ecran();
  elargirLePerimetre(p, commande({ type: 'agent.open', id: 'a-vu' }));
  elargirLePerimetre(p, commande({ type: 'project.open', id: 'p-ailleurs' }));
  assert.equal(p.projet, 'p-ailleurs');
  assert.equal(detailPourCetEcran(fragment('a-ailleurs'), p, lire), true);
  assert.equal(detailPourCetEcran(fragment('a-vu'), p, lire), true);
});

test('après une reconnexion, l’écran redit ce qu’il regarde sans rien redemander', () => {
  const p = ecran();
  elargirLePerimetre(p, commande({ type: 'ecran.perimetre', agents: ['a-ailleurs'], cartes: [] }));
  assert.equal(detailPourCetEcran(fragment('a-ailleurs'), p, lire), true);
});

test('dans le doute, on envoie : agent inconnu, ou écran sans projet ouvert', () => {
  assert.equal(detailPourCetEcran(fragment('a-inconnu'), ecran(), lire), true);
  assert.equal(detailPourCetEcran(fragment('a-ailleurs'), ecran(null), lire), true);
});

test('la base n’est lue qu’une fois par événement, quel que soit le nombre d’écrans', () => {
  let lectures = 0;
  const compte: LecturesDuPerimetre = { agent: (id) => (lectures++, lire.agent(id)), carte: (id) => lire.carte(id) };
  const event = fragment('a-ailleurs');
  for (let i = 0; i < 5; i += 1) detailPourCetEcran(event, ecran(), compte);
  assert.equal(lectures, 1);
});
