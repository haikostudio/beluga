import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LE PÉRIMÈTRE D'UN AGENT : SON PROJET, ET LUI SEUL. Le cadrage d'une carte
 * InVia (08.10.2026) proposait « Tous les sites / Seulement InVia ». Seuls le
 * projet de l'APPLICATION (`isSelf`) et l'assistant général voient l'ensemble,
 * et ils proposent une carte PAR projet. Piège de nom : le projet « Beluga
 * Build » est le site vitrine, un projet ordinaire — la règle se tranche sur
 * `isSelf`, jamais sur un nom.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'perimetre-des-agents-'));
process.env.BELUGA_DATA = bacASable;

const {
  Agent,
  Project,
  CONSIGNE_ASSISTANT_GLOBAL,
  CONSIGNE_ASSISTANT_SURVEILLANCE,
  CONSIGNE_PERIMETRE_APPLICATION,
  CONSIGNE_PERIMETRE_PROJET,
  consigneDePerimetre,
  propositionAilleursPermise,
} = await import('@beluga/shared');
const store = await import('../store.js');
const { enregistrerSurveillance } = await import('../surveillance.js');
const { accueilDeLaProposition, projetDAccueilDeLaProposition } = await import('../proposition-de-site.js');
const { rolePrompt } = await import('../runtime.js');

/* ------------------------------------------------------------------ */
/* La règle pure                                                        */
/* ------------------------------------------------------------------ */

test('la consigne de périmètre suit la marque isSelf, et ne désigne jamais l’application par « Beluga Build »', () => {
  assert.equal(consigneDePerimetre(true), CONSIGNE_PERIMETRE_APPLICATION);
  assert.equal(consigneDePerimetre(false), CONSIGNE_PERIMETRE_PROJET);
  assert.match(CONSIGNE_PERIMETRE_PROJET, /tous les sites/);
  assert.match(CONSIGNE_PERIMETRE_PROJET, /aucun autre projet/);
  assert.match(CONSIGNE_PERIMETRE_APPLICATION, /UNE carte PAR projet/);
  assert.match(CONSIGNE_PERIMETRE_APPLICATION, /« Beluga Build » est le site vitrine/);
});

test('seul un agent du projet de l’application, hors agent de site, vise un autre projet', () => {
  assert.equal(propositionAilleursPermise({ projetDeLAgentIsSelf: true, agentDUnSite: false }).ok, true);
  assert.equal(propositionAilleursPermise({ projetDeLAgentIsSelf: false, agentDUnSite: false }).ok, false);
  assert.equal(propositionAilleursPermise({ projetDeLAgentIsSelf: true, agentDUnSite: true }).ok, false);
});

test('chaque rôle d’un projet reçoit SON périmètre ; l’assistant et l’agent de site aussi', () => {
  for (const role of ['cadrage', 'task', 'analysis'] as const) {
    assert.ok(rolePrompt(role, false).includes(CONSIGNE_PERIMETRE_PROJET), `${role} d’un projet ordinaire`);
    assert.ok(!rolePrompt(role, false).includes(CONSIGNE_PERIMETRE_APPLICATION), `${role} d’un projet ordinaire`);
    assert.ok(rolePrompt(role, true).includes(CONSIGNE_PERIMETRE_APPLICATION), `${role} du projet de l’application`);
  }
  // Stable d'un tour à l'autre : la consigne ne dépend que du projet.
  assert.equal(rolePrompt('task', false), rolePrompt('task', false));
  assert.match(CONSIGNE_ASSISTANT_SURVEILLANCE, /TON PÉRIMÈTRE EST LE SITE DONT TU AS LA CHARGE/);
  assert.match(CONSIGNE_ASSISTANT_GLOBAL, /UNE CARTE PAR PROJET/);
  assert.doesNotMatch(CONSIGNE_ASSISTANT_GLOBAL, /il vise Beluga Build/);
});

/* ------------------------------------------------------------------ */
/* Le champ « projet » d'une carte proposée, branché sur la base        */
/* ------------------------------------------------------------------ */

function projet(id: string, name: string, isSelf = false) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), `projet-${id}-`));
  return store.saveProject(Project.parse({ id, name, path: dossier, isSelf, createdAt: store.now(), updatedAt: store.now() }));
}

function agent(id: string, projectId: string) {
  return store.saveAgent(
    Agent.parse({
      id,
      projectId,
      role: 'task',
      title: id,
      run: { engine: 'claude' },
      workdir: bacASable,
      status: 'idle',
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
}

const beluga = projet('app', 'Beluga', true);
const vitrine = projet('vitrine', 'Beluga Build');
const invia = projet('invia', 'InVia');
const agentBeluga = agent('agent-beluga', beluga.id);
const agentVitrine = agent('agent-vitrine', vitrine.id);
const agentInvia = agent('agent-invia', invia.id);
const agentDuSite = agent('agent-du-site', beluga.id);
const pose = enregistrerSurveillance({ url: 'https://invia.example', nom: 'InVia', agentId: agentDuSite.id, projectId: beluga.id });
assert.ok(pose.ok);

test('depuis le projet de l’application, « projet » pose la carte dans le projet visé', () => {
  const accueil = accueilDeLaProposition({ agentId: agentBeluga.id, projectId: beluga.id }, 'InVia');
  assert.ok(!('refus' in accueil), JSON.stringify(accueil));
  assert.equal((accueil as { projectId?: string }).projectId, invia.id);
  // …et l'acceptation relit ce projet noté, pas celui de la conversation.
  assert.equal(projetDAccueilDeLaProposition({ projectId: invia.id }, agentBeluga), invia.id);
  // Un projet inconnu est refusé en donnant la liste.
  const inconnu = accueilDeLaProposition({ agentId: agentBeluga.id, projectId: beluga.id }, 'Fantôme');
  assert.ok('refus' in inconnu);
});

test('le site vitrine « Beluga Build » et tout autre projet se voient refuser « projet »', () => {
  for (const [a, p] of [
    [agentVitrine, vitrine],
    [agentInvia, invia],
  ] as const) {
    const accueil = accueilDeLaProposition({ agentId: a.id, projectId: p.id }, 'Beluga');
    assert.ok('refus' in accueil, `${p.name} ne vise pas un autre projet`);
    assert.match((accueil as { refus: string }).refus, /que dans TON projet/);
    // Sans « projet », rien ne change : la carte naît chez lui.
    const chezLui = accueilDeLaProposition({ agentId: a.id, projectId: p.id }, undefined);
    assert.ok(!('refus' in chezLui));
    assert.equal((chezLui as { projectId?: string }).projectId, undefined);
  }
});

test('l’agent d’un site, bien que logé dans le projet de l’application, ne choisit pas le projet', () => {
  const accueil = accueilDeLaProposition({ agentId: agentDuSite.id, projectId: beluga.id }, 'InVia');
  assert.ok('refus' in accueil);
  assert.match((accueil as { refus: string }).refus, /agent d'un site surveillé/);
});

test('l’assistant général, qui vise un autre projet par son contexte, y note le projet d’accueil', () => {
  // L'assistant retire « projet » et appelle l'outil avec le projet visé en contexte.
  const accueil = accueilDeLaProposition({ agentId: agentBeluga.id, projectId: invia.id }, undefined);
  assert.ok(!('refus' in accueil));
  assert.equal((accueil as { projectId?: string }).projectId, invia.id);
});

test('l’agent d’un site garde sa consigne aux tours suivants (lu dans la source)', () => {
  const runtime = fs.readFileSync(new URL('../../src/runtime.ts', import.meta.url), 'utf8');
  assert.match(runtime, /listerSites\(\)\.some\(\(site\) => site\.agentId === agentId\)\)\s*\n\s*options = \{ \.\.\.options, motif: 'configuration-surveillance' \}/);
});
