/**
 * UNE DÉCISION NE RÉÉCRIT QUE SA PROPOSITION (carte « Carte créée qui se repropose », 21/11/2026) : deux propositions
 * d'un même message validées presque ensemble gardent TOUTES DEUX leur décision ; un message déjà désaccordé se répare
 * depuis la table `proposals`, sans créer de carte ; et un nouveau clic sur une proposition tranchée en table ne crée
 * rien.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TaskProposal } from '@beluga/shared';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-voisine-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');

const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, '../../..');
const lire = (fichier: string) => fs.readFileSync(path.join(racine, fichier), 'utf8');

store.saveProject({ id: 'P', name: 'P', path: bacASable, defaultEngine: 'claude', isSelf: false, archived: false, createdAt: store.now(), updatedAt: store.now() } as any);
store.saveAgent({ id: 'A', projectId: 'P', role: 'cadrage', title: 'Chef', run: { engine: 'claude', thinking: 'medium', mode: 'direct' }, status: 'done', createdAt: store.now(), updatedAt: store.now() } as any);

function proposition(id: string): TaskProposal {
  return { id, title: `Titre ${id}`, description: `Description ${id}`, labels: [], attachments: [], decision: 'pending', sourceProposalIds: [] } as any;
}

function messageADeuxPropositions(id: string) {
  const a = proposition(`${id}-a`);
  const b = proposition(`${id}-b`);
  store.saveMessage({ id, agentId: 'A', role: 'assistant', content: 'Deux cartes', proposals: [a, b], createdAt: store.now() } as any);
  store.saveProposal(id, 'P', a);
  store.saveProposal(id, 'P', b);
  return { a, b };
}

/** Ce que fait `proposal.decide` : le message est lu AVANT les attentes, la décision écrite APRÈS. */
async function decider(messageId: string, proposalId: string, cardId: string) {
  const lu = store.getMessage(messageId)!;
  const proposal = lu.proposals.find((p) => p.id === proposalId)!;
  await new Promise((r) => setTimeout(r, 10)); // le catalogue des moteurs, la création de la carte…
  const decided = { ...(store.decideProposal(proposalId, 'accepted', cardId) ?? proposal), decision: 'accepted' as const, cardId };
  store.saveProposal(messageId, 'P', decided);
  return store.appliquerDecisionAuMessage(messageId, decided);
}

test('deux validations concurrentes dans le même message gardent toutes deux leur carte', async () => {
  const { a, b } = messageADeuxPropositions('M1');
  await Promise.all([decider('M1', a.id, 'carte-a'), decider('M1', b.id, 'carte-b')]);
  const relu = store.getMessage('M1')!;
  assert.deepEqual(
    relu.proposals.map((p) => [p.id, p.decision, p.cardId]),
    [
      [a.id, 'accepted', 'carte-a'],
      [b.id, 'accepted', 'carte-b'],
    ],
  );
});

test('la décision ne touche QUE sa proposition, et rend null sur un message inconnu', () => {
  const { a, b } = messageADeuxPropositions('M2');
  const ecrit = store.appliquerDecisionAuMessage('M2', { ...a, decision: 'refused' } as any)!;
  assert.equal(ecrit.proposals.find((p) => p.id === a.id)?.decision, 'refused');
  assert.equal(ecrit.proposals.find((p) => p.id === b.id)?.decision, 'pending');
  assert.equal(store.appliquerDecisionAuMessage('inconnu', a), null);
  assert.equal(store.appliquerDecisionAuMessage('M2', proposition('absente')), null);
});

test('un message désaccordé se répare depuis la table, sans carte ni retouche du titre — et une seule fois', () => {
  const { a, b } = messageADeuxPropositions('M3');
  // L'état constaté en base : la table dit « acceptée » pour les deux, le message a perdu la première.
  store.decideProposal(a.id, 'accepted', 'carte-a');
  store.decideProposal(b.id, 'accepted', 'carte-b');
  store.appliquerDecisionAuMessage('M3', { ...b, decision: 'accepted', cardId: 'carte-b' } as any);
  // Un titre retenu dans le message n'est pas remplacé par celui de la table.
  const m = store.getMessage('M3')!;
  store.saveMessage({ ...m, proposals: m.proposals.map((p) => (p.id === a.id ? { ...p, title: 'Titre retenu' } : p)) });
  const cartesAvant = store.listCards('P').length;

  const reecrits = store.resynchroniserLesDecisionsDesMessages();
  assert.deepEqual(reecrits.map((x) => x.id), ['M3']);
  const relu = store.getMessage('M3')!;
  const pa = relu.proposals.find((p) => p.id === a.id)!;
  assert.equal(pa.decision, 'accepted');
  assert.equal(pa.cardId, 'carte-a');
  assert.equal(pa.title, 'Titre retenu');
  assert.equal(relu.proposals.find((p) => p.id === b.id)?.cardId, 'carte-b');
  assert.equal(store.listCards('P').length, cartesAvant, 'aucune carte ne naît du rattrapage');
  assert.deepEqual(store.resynchroniserLesDecisionsDesMessages(), [], 'idempotent');
});

test('une proposition encore en attente dans la table n’est jamais touchée par le rattrapage', () => {
  messageADeuxPropositions('M4');
  assert.ok(!store.resynchroniserLesDecisionsDesMessages().some((m) => m.id === 'M4'));
  assert.equal(store.decisionEnregistree('M4-a')?.decision, 'pending');
});

test('le serveur ne réécrit plus un message depuis une copie lue avant ses attentes', () => {
  const ws = lire('server/src/ws.ts');
  for (const cas of ["case 'proposal.decide'", "case 'proposal.config'", "case 'proposal.integrate'"]) {
    const debut = ws.indexOf(cas);
    const fin = ws.indexOf("\n    case '", debut + cas.length);
    const bloc = ws.slice(debut, fin);
    assert.ok(!/saveMessage\(\{\s*\.\.\.(message|relu)/.test(bloc), `${cas} réécrit encore le message entier`);
    assert.match(bloc, /appliquerDecisionAuMessage/, `${cas} passe par l’écriture qui relit`);
  }
  const decide = ws.slice(ws.indexOf("case 'proposal.decide'"));
  assert.ok(
    decide.indexOf('decisionEnregistree') < decide.indexOf('decisionsEnCours.add'),
    'la décision de la table est lue avant toute carte',
  );
  assert.match(lire('server/src/scheduler.ts'), /resynchroniserLesDecisions\(\)/, 'le démarrage répare les messages désaccordés');
  assert.match(lire('server/src/propositions-orphelines.ts'), /appliquerDecisionAuMessage/);
  assert.match(lire('server/src/auto-amelioration.ts'), /appliquerDecisionAuMessage/);
});
