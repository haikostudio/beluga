import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* LE MODE SE CONFIRME DANS LA DISCUSSION (11/11/2026) : l'étiquette   */
/* lit la carte, la question de mode part au premier tour, le mode     */
/* confirmé s'écrit par « board_update_card » ; et une création partie */
/* d'un modèle prend la police embarquée la plus proche du produit.     */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-de-la-carte-'));
process.env.BELUGA_DATA = bacASable;

const { Agent, Card, Project, MODES_DE_LA_CARTE, consigneDeLaQuestionDeMode, policeEmbarqueeLaPlusProche, CHAMPS_DE_CARTE_AVANT_ANALYSE } = await import('@beluga/shared');
const store = await import('../store.js');
const { poserLeModeDeLaCarte, modeDejaConfirme } = await import('../mode-de-la-carte.js');

const maintenant = store.now();
store.saveProject(Project.parse({ id: 'p-mode', name: 'Projet mode', path: bacASable, createdAt: maintenant, updatedAt: maintenant }));

function carteDeCadrage(id: string) {
  const carte = store.saveCard(Card.parse({ id, projectId: 'p-mode', title: 'Carte', column: 'planned', position: 1, run: { engine: 'claude' }, createdAt: maintenant, updatedAt: maintenant }));
  store.saveAgent(Agent.parse({ id: `cadrage-${id}`, projectId: 'p-mode', cardId: id, role: 'cadrage', title: 'Cadrage', run: { engine: 'claude' }, status: 'idle', createdAt: maintenant, updatedAt: maintenant }));
  return carte;
}

test('le mode : l’agent le choisit seul, question seulement dans le vrai doute, « Création » retiré', () => {
  const c = consigneDeLaQuestionDeMode(null);
  assert.match(c, /C’EST TOI QUI LE CHOISIS/);
  assert.match(c, /70-80 %/);
  assert.match(c, /VRAI doute/);
  assert.match(c, /DÉFAUT, aucun mode/);
  assert.doesNotMatch(c, /Création|creation/);
  assert.match(c, /« mode » \(plan \| studio \| aucun\)/);
  assert.ok(!(MODES_DE_LA_CARTE as readonly string[]).includes('creation'));
  assert.ok(CHAMPS_DE_CARTE_AVANT_ANALYSE.includes('mode' as never), 'le mode confirmé s’écrit dès la réponse');
});

test('le mode confirmé s’écrit sur la carte, un seul à la fois, et rend sa consigne', async () => {
  const c = carteDeCadrage('carte-mode-1');
  assert.equal(modeDejaConfirme(c.id), false);
  const plan = await poserLeModeDeLaCarte(c.id, 'cadrage-carte-mode-1', 'plan');
  assert.ok(plan.ok);
  assert.equal(store.getCard(c.id)?.parcours?.planSouhaite, true);
  assert.equal(modeDejaConfirme(c.id), true, 'la question ne se repose plus');
  const refus = await poserLeModeDeLaCarte(c.id, 'cadrage-carte-mode-1', 'studio');
  assert.equal(refus.ok, false, 'le Studio exige son type de média');
  const studio = await poserLeModeDeLaCarte(c.id, 'cadrage-carte-mode-1', 'studio', 'image');
  assert.ok(studio.ok);
  const lue = store.getCard(c.id)!;
  assert.equal(lue.parcours?.realisationSouhaitee, true);
  assert.equal(lue.parcours?.planSouhaite, false, 'un seul mode à la fois');
  assert.deepEqual(lue.realisation?.medias, ['image']);
  assert.ok(lue.realisation?.demandeA, 'le volet de réalisation s’ouvre dans le même tour');
  assert.ok(studio.ok && /CONSIGNE DU MODE STUDIO/.test(studio.texte));
  const aucun = await poserLeModeDeLaCarte(c.id, 'cadrage-carte-mode-1', 'aucun');
  assert.ok(aucun.ok);
  const sansMode = store.getCard(c.id)!;
  assert.ok(!sansMode.parcours?.planSouhaite && !sansMode.parcours?.realisationSouhaitee, '« aucun » retire les deux modes');
});

test('le mode ne se pose plus une fois la carte lancée', async () => {
  const c = carteDeCadrage('carte-mode-2');
  store.saveCard({ ...c, column: 'running' });
  const r = await poserLeModeDeLaCarte(c.id, 'cadrage-carte-mode-2', 'plan');
  assert.equal(r.ok, false);
});

test('la police du produit : la même si elle est embarquée, sinon la plus proche par sa famille', () => {
  assert.deepEqual(policeEmbarqueeLaPlusProche('"Montserrat", sans-serif'), { famille: 'Montserrat', exacte: true });
  assert.deepEqual(policeEmbarqueeLaPlusProche('Inter Variable, system-ui'), { famille: 'Inter', exacte: false });
  assert.equal(policeEmbarqueeLaPlusProche('Georgia, serif').famille, 'Playfair Display');
  assert.equal(policeEmbarqueeLaPlusProche('"Space Mono", monospace').famille, 'JetBrains Mono');
  assert.equal(policeEmbarqueeLaPlusProche('Oswald, sans-serif').famille, 'Bebas Neue');
  assert.equal(policeEmbarqueeLaPlusProche('Poppins, sans-serif').famille, 'Montserrat');
  assert.equal(policeEmbarqueeLaPlusProche('Helvetica Neue, Arial, sans-serif').famille, 'Inter');
});
