import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  MENTION_EN_PAUSE,
  RAISON_EN_PAUSE,
  effacerPause,
  estEnPause,
  gestePause,
  marquerPause,
  promptDeReprise,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Mettre une tâche en pause, et la reprendre où elle s'est arrêtée     */
/* ------------------------------------------------------------------ */

/*
 * La pause écrit dans la base : il lui en faut donc une à elle, jetable, sinon
 * le test toucherait au vrai tableau.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'pause-agent-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { pauseCard, preparerReprise } = await import('../scheduler.js');

/** Un dépôt git minuscule, avec la branche que la carte porte déjà. */
function depotDEssai(branche: string): string {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pause-depot-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dossier, stdio: 'ignore' });
  git('init', '-b', 'main');
  git('config', 'user.email', 'essai@haikodev.test');
  git('config', 'user.name', 'Essai');
  fs.writeFileSync(path.join(dossier, 'depart.txt'), 'depart\n');
  git('add', 'depart.txt');
  git('commit', '-m', 'depart');
  git('checkout', '-b', branche);
  fs.writeFileSync(path.join(dossier, 'travail.txt'), 'travail déjà fait\n');
  git('add', 'travail.txt');
  git('commit', '-m', 'travail déjà fait avant la pause');
  git('checkout', 'main');
  return dossier;
}

function scene(branche = 'tache/essai-de-pause') {
  const dossier = depotDEssai(branche);
  const project = store.saveProject({
    id: store.newId(),
    name: 'Projet d’essai',
    path: dossier,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);

  const card = store.saveCard({
    id: store.newId(),
    projectId: project.id,
    title: 'Une tâche à mettre en pause',
    description: 'Peu importe : c’est la pause qu’on regarde.',
    labels: [],
    column: 'running',
    position: 1,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    github: { checks: [], commits: [], activity: [], branch: branche },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);

  const agent = store.saveAgent({
    id: store.newId(),
    projectId: project.id,
    cardId: card.id,
    role: 'task',
    title: card.title,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'running',
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);

  const avecAgent = store.saveCard({ ...card, agentId: agent.id });
  return { project, card: avecAgent, agent, dossier, branche };
}

/* -------- Les règles pures -------- */

test('un travail qui tourne se met en pause ; un travail en pause se reprend', () => {
  assert.equal(gestePause({ agentLance: true, travailleMaintenant: true, enPause: false }), 'pause');
  assert.equal(gestePause({ agentLance: true, travailleMaintenant: false, enPause: true }), 'reprendre');
  // Rien ne tourne et rien n'est en pause : le bouton n'a pas lieu d'être.
  assert.equal(gestePause({ agentLance: true, travailleMaintenant: false, enPause: false }), 'aucun');
  // Aucun agent n'a jamais travaillé : il n'y a rien à reprendre.
  assert.equal(gestePause({ agentLance: false, travailleMaintenant: false, enPause: true }), 'aucun');
});

test('la marque de pause est la marque de suspension, pas une seconde', () => {
  const pose = marquerPause({ asap: false, attempts: 2, restarts: 0 });
  assert.equal(pose.suspendu, true);
  assert.equal(pose.waitingReason, RAISON_EN_PAUSE);
  // Ce qui ne regarde pas la pause est laissé intact.
  assert.equal(pose.attempts, 2);

  const efface = effacerPause(pose);
  assert.equal(efface.suspendu, false);
  assert.equal(efface.waitingReason, undefined);
  assert.equal(efface.attempts, 2);
});

test('la demande de reprise dit de continuer, jamais de recommencer', () => {
  const prompt = promptDeReprise({ titre: 'Ma tâche', branche: 'tache/ma-tache' });
  assert.match(prompt, /tache\/ma-tache/);
  assert.match(prompt, /POINT DE DÉPART/);
  assert.match(prompt, /ne refais pas ce qui est déjà fait/i);
  // Sans dépôt git, aucune branche n'est promise à l'agent.
  assert.doesNotMatch(promptDeReprise({ titre: 'Ma tâche', branche: null }), /branche/i);
});

test('les phrases affichées disent la pause et la reprise', () => {
  assert.match(RAISON_EN_PAUSE, /pause/i);
  assert.match(RAISON_EN_PAUSE, /votre geste/i);
  assert.match(MENTION_EN_PAUSE, /reprendra/i);
});

/* -------- Le geste, dans le démon -------- */

test('la pause marque la carte, vide la file et ne la déplace pas', async () => {
  const { card, agent } = scene();
  store.enqueuePrompt(agent.id, 'une demande qui attendait derrière');
  store.enqueuePrompt(agent.id, 'et une deuxième');
  assert.equal(store.listQueue(agent.id).length, 2);

  const resultat = await pauseCard(card.id);
  assert.equal(resultat.ok, true);

  const apres = store.getCard(card.id)!;
  assert.equal(estEnPause(apres), true);
  assert.equal(apres.scheduling?.waitingReason, RAISON_EN_PAUSE);
  // La pause n'est pas un rangement : la colonne ne bouge pas.
  assert.equal(apres.column, 'running');
  // Plus rien n'attend derrière : sinon le tour suivant repartirait tout seul.
  assert.equal(store.listQueue(agent.id).length, 0);
});

test('la reprise repart avec le MÊME agent, sur la MÊME branche, et efface la marque', async () => {
  const { card, agent, branche } = scene();
  await pauseCard(card.id);
  assert.equal(estEnPause(store.getCard(card.id)!), true);

  const reprise = await preparerReprise(card.id);
  assert.equal(reprise.ok, true);
  assert.equal(reprise.agentId, agent.id);
  assert.equal(reprise.branche, branche);
  assert.match(reprise.prompt ?? '', /Reprends cette tâche là où elle s'est arrêtée/);

  // La marque ne s'efface que là : sur le geste, et sur rien d'autre.
  assert.equal(estEnPause(store.getCard(card.id)!), false);
  assert.equal(store.listQueue(agent.id).length, 0);
});

test('la reprise ne recrée pas la branche : le travail enregistré avant la pause reste', async () => {
  const { card, dossier, branche } = scene();
  await pauseCard(card.id);
  await preparerReprise(card.id);

  const fichiers = execFileSync('git', ['ls-tree', '--name-only', branche], { cwd: dossier })
    .toString()
    .trim()
    .split('\n');
  assert.ok(fichiers.includes('travail.txt'), 'le commit d’avant la pause est toujours sur la branche');
});

test('une carte en pause laissée seule ne repart pas : la marque tient', async () => {
  const { card } = scene();
  await pauseCard(card.id);
  // L'ordonnanceur saute toute carte marquée : c'est cette marque qu'il lit.
  const relue = store.getCard(card.id)!;
  assert.equal(relue.scheduling?.suspendu, true);
});
