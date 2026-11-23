import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, Message, type ServerEvent } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* « AVEC QUEL COMPTE POURSUIVRE ? » SE REFERME QUAND L'AGENT REPART.   */
/*                                                                     */
/* Le cas de la capture du 24.10.2026 : la reprise 05b02197 restait     */
/* ouverte, l'utilisateur écrit à l'agent, un tour du MÊME agent part   */
/* (3bbf173e) — et la fenêtre restait affichée au-dessus d'un agent     */
/* déjà au travail, jusqu'à un « abandon » à la main. Le tour qui part  */
/* referme désormais toute reprise ouverte de son agent, sur le compte  */
/* qui le sert, et l'écran le reçoit par `message.upsert`.             */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = fs.readFileSync(path.resolve(ICI, '../../src/runtime.ts'), 'utf8');

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'reprise-refermee-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const runtime = await import('../runtime.js');
const { bus } = await import('../bus.js');

const now = Date.now();
for (const id of ['agent-capture', 'agent-voisin']) {
  store.saveAgent(
    Agent.parse({
      id,
      projectId: 'p',
      title: id,
      role: 'task',
      status: 'idle',
      run: { engine: 'claude' },
      createdAt: now,
      updatedAt: now,
    }),
  );
}

function repriseOuverte(id: string, agentId: string): Message {
  return store.saveMessage(
    Message.parse({
      id,
      agentId,
      role: 'assistant',
      content: 'You’ve hit your session limit.',
      createdAt: now,
      repriseCompte: {
        engine: 'claude',
        compteEpuise: 'claude-pro',
        compteEpuiseLabel: 'Claude Pro',
        motif: 'limite-structuree',
        at: now,
      },
    }),
  );
}

test('un tour parti par un message de l’utilisateur referme la reprise ouverte de SON agent', () => {
  repriseOuverte('reprise-capture', 'agent-capture');
  repriseOuverte('reprise-voisine', 'agent-voisin');
  assert.deepEqual(
    store
      .reprisesDeCompteEnAttente()
      .map((a) => a.messageId)
      .sort(),
    ['reprise-capture', 'reprise-voisine'],
    'les deux fenêtres sont ouvertes avant le tour',
  );

  const recus: ServerEvent[] = [];
  const desabonner = bus.subscribe((evenement) => recus.push(evenement));
  try {
    // Un message tapé n'est la reprise de rien : `repriseDe` est absent.
    runtime.refermerLesReprisesDepassees('agent-capture', undefined, { id: 'claude-max20', label: 'Claude Max x20' }, 'tour-capture');
  } finally {
    desabonner();
  }

  const refermee = store.getMessage('reprise-capture')?.repriseCompte;
  assert.equal(refermee?.choisi, 'claude-max20', 'refermée sur le compte qui sert le tour');
  assert.equal(refermee?.automatique, true, 'sans clic : le travail est reparti seul');
  assert.ok(refermee?.consommeeA, 'consommée : un clic arrivé ensuite ne relance rien');

  const enAttente = store.reprisesDeCompteEnAttente().map((a) => a.messageId);
  assert.ok(!enAttente.includes('reprise-capture'), 'plus aucune décision en attente pour cet agent');
  assert.ok(enAttente.includes('reprise-voisine'), 'la reprise d’un AUTRE agent reste ouverte');

  const upserts = recus.filter((e): e is Extract<ServerEvent, { type: 'message.upsert' }> => e.type === 'message.upsert');
  assert.equal(upserts.length, 1, 'l’écran reçoit la fenêtre refermée, sans recharger');
  assert.equal(upserts[0].message.id, 'reprise-capture');
  assert.ok(recus.some((e) => e.type === 'attention'), 'la cloche des décisions se recalcule');
});

test('la colonne de l’index partiel suit : la reprise refermée n’est plus marquée ouverte en base', async () => {
  const { getDb } = await import('../db.js');
  const ligne = getDb().prepare('SELECT a_reprise_ouverte AS ouverte FROM messages WHERE id = ?').get('reprise-capture') as {
    ouverte: number;
  };
  assert.equal(ligne.ouverte, 0);
});

test('la reprise que le tour CONSOMME lui-même n’est pas refermée une seconde fois', () => {
  repriseOuverte('reprise-du-tour', 'agent-voisin');
  runtime.refermerLesReprisesDepassees('agent-voisin', 'reprise-du-tour', { id: 'claude-max20' }, 'tour-reprise');
  assert.equal(store.getMessage('reprise-du-tour')?.repriseCompte?.choisi, undefined, 'elle suit sa propre route, `consommerLaReprise`');
  assert.equal(store.getMessage('reprise-voisine')?.repriseCompte?.automatique, true, 'l’ancienne du même agent, si');
});

test('le SEUL départ de moteur passe par la fermeture : un message tapé, la file ou une relève', () => {
  const debut = RUNTIME.indexOf('const handle = lancerLeMoteur(prompt, sessionId);');
  assert.ok(debut > 0);
  const apres = RUNTIME.slice(debut, debut + 2500);
  assert.match(apres, /live\.set\(agent\.id, runState\);/);
  assert.match(apres, /refermerLesReprisesDepassees\(agent\.id, tour\.repriseDe, account, runState\.messageId\);/);
  // Le second appel de `lancerLeMoteur` est le nouvel essai du MÊME tour, après une panne passagère.
  assert.equal(RUNTIME.match(/= lancerLeMoteur\(/g)?.length, 2);
  assert.equal(RUNTIME.match(/await startTurn\(/g)?.length, 1, 'tout tour passe par startTurn');
});
