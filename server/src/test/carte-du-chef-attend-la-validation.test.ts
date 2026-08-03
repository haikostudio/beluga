import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* Aucune carte du chef ne part sans le clic de l'utilisateur           */
/* ------------------------------------------------------------------ */

/*
 * La base est une VRAIE base, mais posée dans un dossier jetable : le test
 * vérifie justement que RIEN n'y est écrit, il lui en faut donc une à lui.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'carte-du-chef-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { callTool, TOOL_DEFS } = await import('../tools.js');

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

test('l’outil du chef n’écrit AUCUNE carte : il propose', async () => {
  const projet = projetDEssai();
  const avant = store.listCards(projet.id).length;

  const resultat = await callTool({ projectId: projet.id } as any, 'board_create_card', {
    title: 'Ajouter un bouton d’export',
  });

  assert.equal(resultat.ok, true);
  assert.equal(store.listCards(projet.id).length, avant, 'le tableau ne bouge pas avant le clic');
});

test('la proposition attend la décision, et ne désigne aucune carte', async () => {
  const projet = projetDEssai();
  const resultat = await callTool({ projectId: projet.id } as any, 'board_create_card', {
    title: 'Refaire la page d’accueil',
    description: 'Un vrai travail de programmation',
    labels: ['interface'],
  });

  assert.equal(resultat.proposal?.decision, 'pending');
  assert.equal(resultat.proposal?.cardId, undefined, 'aucune carte n’existe encore');
  assert.equal(resultat.proposal?.title, 'Refaire la page d’accueil');
  assert.deepEqual(resultat.proposal?.labels, ['interface']);
});

test('la validation d’office est bel et bien abandonnée', async () => {
  const module: any = await import('../tools.js');
  assert.equal(
    typeof module.lancerCarteDuChef,
    'undefined',
    'plus de départ sans clic : la fonction ne doit plus exister',
  );
  assert.equal(typeof module.ETIQUETTE_LANCEE_PAR_LE_CHEF, 'undefined');
});

test('un titre manquant ne propose rien', async () => {
  const projet = projetDEssai();
  const resultat = await callTool({ projectId: projet.id } as any, 'board_create_card', {});
  assert.equal(resultat.ok, false);
  assert.equal(resultat.proposal, undefined);
});

test('la colonne reste hors de portée du chef : elle n’est pas un champ de l’outil', () => {
  const outil = TOOL_DEFS.find((t) => t.name === 'board_create_card');
  const proprietes = (outil?.inputSchema as any)?.properties ?? {};
  assert.equal('column' in proprietes, false);
});

test('la description de l’outil dit que le clic est obligatoire', () => {
  const outil = TOOL_DEFS.find((t) => t.name === 'board_create_card');
  const texte = String(outil?.description ?? '');
  assert.match(texte, /valider/i);
  assert.doesNotMatch(texte, /d’office|d'office/);
});

test('le cas ambigu garde sa propre voie : propose_task existe toujours', () => {
  assert.ok(TOOL_DEFS.find((t) => t.name === 'propose_task'), 'propose_task doit rester disponible');
});
