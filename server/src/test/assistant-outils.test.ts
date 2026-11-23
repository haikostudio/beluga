import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* L'ASSISTANT BELUGA EST UN AGENT ORDINAIRE (18/10/2026) : il reçoit   */
/* les outils d'un agent, plus les siens, et sa consigne est celle d'un */
/* agent ordinaire, accès complet compris.                              */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-outils-'));
process.env.BELUGA_DATA = bacASable;

const { OUTILS_PROPRES_A_L_ASSISTANT, gesteIrreversible, genreDeLAppel } = await import('@beluga/shared');
const { outilsDeLAssistant, outilServiALAssistant } = await import('../assistant-global.js');
const { toolsFor, outilServiA } = await import('../tools.js');
const { consigneDeLAssistantGlobal } = await import('../runtime.js');

test('l’assistant reçoit les outils d’un agent ordinaire, plus les siens', () => {
  const servis = new Set(outilsDeLAssistant('agent-essai').map((t) => t.name));
  for (const t of toolsFor('deploy').filter((t) => outilServiA(t.name, 'agent-essai'))) {
    assert.ok(servis.has(t.name), `outil ordinaire manquant : ${t.name}`);
  }
  for (const propre of OUTILS_PROPRES_A_L_ASSISTANT) assert.ok(servis.has(propre), propre);
  assert.ok(servis.has('marketing'), 'le marketing reste servi à l’assistant');
  assert.ok(!servis.has('rendre_comprehension'), 'aucun outil réservé au cadrage');
  assert.equal(outilServiALAssistant('write_document', 'agent-essai'), true);
  assert.equal(outilServiALAssistant('rendre_plan', 'agent-essai'), false);
});

test('aucun outil servi à l’assistant n’est jugé irréversible sans geste destructif ou envoi', () => {
  // Les outils sans action : leur classement ne doit pas retomber sur « suppression » par défaut.
  const sansAction = outilsDeLAssistant('agent-essai')
    .map((t) => t.name)
    .filter((nom) => !['board_delete_card', 'compta', 'project_manage', 'group_manage', 'memoire', 'competences', 'coffre_fort', 'marketing', 'statistiques'].includes(nom))
    .filter((nom) => !nom.startsWith('assistant_'));
  for (const nom of sansAction) {
    assert.equal(gesteIrreversible(genreDeLAppel(nom, {})), false, nom);
  }
});

test('la consigne de l’assistant est celle d’un agent ordinaire, avec tous les droits', () => {
  const consigne = consigneDeLAssistantGlobal(true, 'claude');
  assert.match(consigne, /DÉROULÉ VISIBLE/);
  assert.match(consigne, /MÉTHODE DE TRAVAIL IMPOSÉE/);
  assert.match(consigne, /ACCÈS COMPLET/);
  assert.match(consigne, /assistant_messagerie/);
  assert.doesNotMatch(consigne, /ni commande, ni éditeur/);
});

test('l’assistant ressort une carte d’« Archivé » comme l’utilisateur ; un agent de tâche reste refusé (MEM-0339)', async () => {
  const store = await import('../store.js');
  const { getDb } = await import('../db.js');
  const { callTool } = await import('../tools.js');
  const { deplacerCommeLUtilisateur } = await import('../assistant-global.js');
  getDb()
    .prepare("INSERT OR IGNORE INTO users (id, identifiant, role, salt, hash, actif, cree_le) VALUES ('admin-essai', 'admin-essai', 'admin', 's', 'h', 1, 0)")
    .run();
  const maintenant = Date.now();
  store.saveProject({ id: 'p-essai-assistant', name: 'Essai assistant', path: bacASable, defaultEngine: 'claude', isSelf: false, archived: false, createdAt: maintenant, updatedAt: maintenant } as any);
  const carte = store.saveCard({
    id: 'c-essai-assistant', projectId: 'p-essai-assistant', title: "Carte d'essai — archivée", description: '', labels: [], column: 'archived',
    position: maintenant, origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    excludedFromDeploy: false, horsTache: false, codeDejaEnregistre: false, createdAt: maintenant, updatedAt: maintenant, rangeeTableauDeBordAt: maintenant,
  } as any);

  const refus = await callTool(
    { agentId: 'agent-tache', projectId: carte.projectId, role: 'task', run: { engine: 'claude' } } as any,
    'board_move_card',
    { cardId: carte.id, column: 'planned' },
  );
  assert.equal(refus.ok, false, 'un agent de tâche ne sort pas une carte d’« Archivé »');
  assert.equal(store.getCard(carte.id)?.column, 'archived');

  const fait = await deplacerCommeLUtilisateur(carte.id, 'planned');
  assert.equal(fait.ok, true, fait.text);
  const sortie = store.getCard(carte.id)!;
  assert.equal(sortie.column, 'planned');
  assert.equal(sortie.rangeeTableauDeBordAt, undefined, 'le rangement des tableaux de bord s’efface, comme au geste humain');
  assert.match(fait.text, /#projet\/p-essai-assistant\/tache\/c-essai-assistant/);
});
