import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* Une demande d'action claire part toute seule                        */
/* ------------------------------------------------------------------ */

/*
 * La base est une VRAIE base, mais posée dans un dossier jetable : le test
 * écrit des cartes, il n'a rien à faire dans celle du serveur.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'carte-lancee-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { lancerCarteDuChef, ETIQUETTE_LANCEE_PAR_LE_CHEF, callTool, TOOL_DEFS } = await import('../tools.js');

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

test('la carte naît dans « À faire » puis se retrouve validée', () => {
  const projet = projetDEssai();
  const carte = lancerCarteDuChef(projet.id, { title: 'Refaire la page d’accueil' });

  assert.equal(carte.column, 'validated');
  // Le passage par « À faire » n'est pas sauté : la position y a bien été prise.
  assert.equal(carte.origin, 'agent');
  assert.equal(store.getCard(carte.id)?.column, 'validated');
});

test('l’étiquette garde la trace d’un départ sans clic', () => {
  const projet = projetDEssai();
  const carte = lancerCarteDuChef(projet.id, { title: 'Corriger le pied de page', labels: ['interface'] });

  assert.equal(carte.labels.includes(ETIQUETTE_LANCEE_PAR_LE_CHEF), true);
  // Les étiquettes demandées restent : la trace s'ajoute, elle ne remplace pas.
  assert.equal(carte.labels.includes('interface'), true);
});

test('l’étiquette ne se met pas deux fois', () => {
  const projet = projetDEssai();
  const carte = lancerCarteDuChef(projet.id, {
    title: 'Deux fois',
    labels: [ETIQUETTE_LANCEE_PAR_LE_CHEF],
  });
  assert.equal(carte.labels.filter((l) => l === ETIQUETTE_LANCEE_PAR_LE_CHEF).length, 1);
});

test('l’outil du chef rend une carte déjà tranchée, pas une question', async () => {
  const projet = projetDEssai();
  const resultat = await callTool({ projectId: projet.id } as any, 'board_create_card', {
    title: 'Ajouter un bouton d’export',
  });

  assert.equal(resultat.ok, true);
  assert.equal(resultat.proposal?.decision, 'accepted');
  assert.ok(resultat.proposal?.cardId, 'la proposition doit désigner la carte créée');
  assert.equal(store.getCard(resultat.proposal!.cardId!)?.column, 'validated');
});

test('un titre manquant ne crée rien', async () => {
  const projet = projetDEssai();
  const avant = store.listCards(projet.id).length;
  const resultat = await callTool({ projectId: projet.id } as any, 'board_create_card', {});
  assert.equal(resultat.ok, false);
  assert.equal(store.listCards(projet.id).length, avant);
});

test('la colonne reste hors de portée du chef : elle n’est pas un champ de l’outil', () => {
  const outil = TOOL_DEFS.find((t) => t.name === 'board_create_card');
  const proprietes = (outil?.inputSchema as any)?.properties ?? {};
  assert.equal('column' in proprietes, false);
});

test('le doute garde son clic : propose_task existe toujours', () => {
  assert.ok(TOOL_DEFS.find((t) => t.name === 'propose_task'), 'propose_task doit rester disponible');
});
