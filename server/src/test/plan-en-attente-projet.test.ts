import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * La colonne de gauche pose une bordure blanche et l'icône du plan sur un
 * projet dont un fil de mode plan attend encore une décision. La règle qui
 * décide « encore courant ou déjà dépassé » vit dans `shared`
 * (`planEnAttente`, `plan-conversation.ts`) et s'y teste seule ; ce fichier
 * prouve que la REQUÊTE SQL qui la nourrit (`projetsAvecPlanEnAttente`,
 * `store.ts`) va chercher les bons messages, sur une vraie base.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-en-attente-projet-'));
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

function agentDEssai(projectId: string) {
  return store.saveAgent({
    id: store.newId(),
    projectId,
    role: 'orchestrator',
    title: 'Chef d’essai',
    run: { mode: 'plan' },
    status: 'done',
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

function messageDEssai(agentId: string, content: string, createdAt: number, plan = false) {
  return store.saveMessage({
    id: store.newId(),
    agentId,
    role: 'assistant',
    content,
    plan,
    createdAt,
  } as any);
}

test('un plan écrit et jamais suivi allume le repère de son projet', () => {
  const projet = projetDEssai();
  const agent = agentDEssai(projet.id);
  messageDEssai(agent.id, '## Faisabilité\n\nPossible.', store.now(), true);

  assert.equal(store.projetsAvecPlanEnAttente()[projet.id], true);
  assert.equal(store.signalPlans().byProject[projet.id], true);
});

test('un message rédigé qui suit le plan le refuse d’office : le repère s’éteint', () => {
  const projet = projetDEssai();
  const agent = agentDEssai(projet.id);
  messageDEssai(agent.id, '## Faisabilité\n\nPossible.', store.now() - 60_000, true);
  messageDEssai(agent.id, 'Vas-y, lance ce plan.', store.now(), false);

  assert.equal(store.projetsAvecPlanEnAttente()[projet.id], undefined);
});

test('une version plus récente du même plan garde le repère allumé', () => {
  const projet = projetDEssai();
  const agent = agentDEssai(projet.id);
  messageDEssai(agent.id, '## Faisabilité\n\nVersion 1.', store.now() - 60_000, true);
  messageDEssai(agent.id, '## Faisabilité\n\nVersion 2.', store.now(), true);

  assert.equal(store.projetsAvecPlanEnAttente()[projet.id], true);
});

test('un projet sans aucun plan écrit ne paraît pas dans le signal', () => {
  const projet = projetDEssai();
  const agent = agentDEssai(projet.id);
  messageDEssai(agent.id, 'Une réponse ordinaire.', store.now(), false);

  assert.equal(store.projetsAvecPlanEnAttente()[projet.id], undefined);
});
