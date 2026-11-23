import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGE_MAX_DEMANDE_COUPEE_MS, Agent, Message, demandeCoupeeAvantLeMoteur } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* UN MESSAGE EN FILE NE MEURT PLUS DANS UN REDÉMARRAGE                */
/*                                                                     */
/* Le 04/11/2026, un message mis en file pendant un cadrage n'est      */
/* jamais parti : la fin du tour a dépilé la demande (effacée de la    */
/* base), puis attendu 400 ms avant de l'envoyer — et le redémarrage   */
/* retenu par une mise en ligne est parti dans ce battement, l'agent   */
/* n'étant plus compté nulle part. La bulle s'est écrite, le processus */
/* est mort avant le moteur, et rien au démarrage ne la reprenait.     */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'demande-coupee-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const runtime = await import('../runtime.js');
const demon = await import('../demon.js');

let sorties = 0;
const vraiExit = process.exit;
// On remplace volontairement la sortie du processus, le temps du contrôle.
process.exit = (() => {
  sorties += 1;
}) as never;
test.after(() => {
  process.exit = vraiExit;
});

function agent(id: string, status: Agent['status'] = 'done'): Agent {
  const maintenant = Date.now();
  return store.saveAgent(
    Agent.parse({
      id,
      projectId: 'projet-essai',
      role: 'task',
      title: `Agent ${id}`,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      status,
      createdAt: maintenant,
      updatedAt: maintenant,
    }),
  );
}

function bulle(agentId: string, role: Message['role'], extra: Partial<Message> = {}): Message {
  return store.saveMessage(
    Message.parse({ id: store.newId(), agentId, role, content: `bulle ${role}`, createdAt: Date.now(), ...extra }),
  );
}

/* ------------------------------------------------------------------ */
/* 1. La règle pure                                                     */
/* ------------------------------------------------------------------ */

test('une bulle humaine sans contexte envoyé, en dernier, est une demande coupée', () => {
  const maintenant = 1_000_000_000;
  const humaine = { id: 'u', role: 'user' as const, createdAt: maintenant - 5_000 };
  assert.equal(demandeCoupeeAvantLeMoteur([humaine], maintenant)?.id, 'u');
  // Une annonce du serveur posée après ne compte pas comme une réponse.
  assert.equal(
    demandeCoupeeAvantLeMoteur([{ id: 's', role: 'system', createdAt: maintenant }, humaine], maintenant)?.id,
    'u',
  );
});

test('rien à relancer : réponse reçue, contexte envoyé, trop vieille ou déjà en file', () => {
  const maintenant = 1_000_000_000;
  const humaine = { id: 'u', role: 'user' as const, createdAt: maintenant - 5_000 };
  assert.equal(demandeCoupeeAvantLeMoteur([{ id: 'a', role: 'assistant', createdAt: maintenant }, humaine], maintenant), null);
  assert.equal(demandeCoupeeAvantLeMoteur([{ ...humaine, sentContext: {} }], maintenant), null);
  assert.equal(
    demandeCoupeeAvantLeMoteur([{ ...humaine, createdAt: maintenant - AGE_MAX_DEMANDE_COUPEE_MS - 1 }], maintenant),
    null,
  );
  assert.equal(demandeCoupeeAvantLeMoteur([humaine], maintenant, new Set(['u'])), null);
  assert.equal(demandeCoupeeAvantLeMoteur([], maintenant), null);
});

/* ------------------------------------------------------------------ */
/* 2. Le filet du démarrage : une fois, sans seconde bulle              */
/* ------------------------------------------------------------------ */

test('au démarrage, la bulle coupée revient en tête de file, une seule fois', () => {
  const a = agent('agent-coupe', 'starting');
  store.enqueuePrompt(a.id, 'une autre demande déjà en file', []);
  const coupee = bulle(a.id, 'user', { content: 'le message que personne ne doit recopier' });

  runtime.recoverAfterRestart();
  const file = store.listQueue(a.id);
  assert.equal(file.length, 2);
  assert.equal(file[0].messageId, coupee.id, 'en TÊTE, avec sa bulle : elle repart sans en écrire une seconde');
  assert.equal(file[0].text, 'le message que personne ne doit recopier');

  // Deux redémarrages de suite ne la doublent pas.
  store.saveAgent({ ...store.getAgent(a.id)!, status: 'starting' });
  runtime.recoverAfterRestart();
  assert.equal(store.listQueue(a.id).filter((d) => d.messageId === coupee.id).length, 1);
  assert.equal(store.listMessages(a.id).filter((m) => m.role === 'user').length, 1, 'aucune seconde bulle');
});

test('au démarrage, une bulle qui a eu sa réponse ne repart pas', () => {
  const a = agent('agent-repondu', 'running');
  bulle(a.id, 'user');
  bulle(a.id, 'assistant');
  runtime.recoverAfterRestart();
  assert.equal(store.listQueue(a.id).length, 0);
});

/* ------------------------------------------------------------------ */
/* 3. Le redémarrage retenu attend la demande qui quitte la file        */
/* ------------------------------------------------------------------ */

test('une demande dépilée compte au travail : le redémarrage attend, puis part tout seul', async () => {
  const a = agent('agent-file');
  store.enqueuePrompt(a.id, 'message en attente', []);

  runtime.reprendreLaFile(a.id);
  assert.equal(store.listQueue(a.id).length, 0, 'la demande a quitté la file');
  assert.ok(runtime.agentsActifs().includes(a.id), 'LA RÉGRESSION : l’agent compte au travail pendant le battement');

  const demande = await demon.demanderRedemarrage();
  assert.equal(demande.ok, false, 'le redémarrage ne coupe pas la demande en partance');
  assert.equal(demande.enAttente, true);

  // Un second dépilage dans le battement ne prend pas la demande suivante.
  store.enqueuePrompt(a.id, 'la suivante', []);
  runtime.reprendreLaFile(a.id);
  assert.equal(store.listQueue(a.id).length, 1, 'la suivante garde son rang');

  // L'envoi échoue (agent disparu) : l'agent n'est plus compté, le redémarrage retenu part.
  store.deleteAgent(a.id);
  await new Promise((r) => setTimeout(r, 3_500));
  assert.equal(runtime.agentsActifs().includes(a.id), false, 'jamais un verrou qui reste');
  assert.equal(sorties, 1, 'le redémarrage retenu est reparti de lui-même');
  assert.equal(demon.redemarrageEstEnAttente(), false);
});
