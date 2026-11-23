import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * COMMUNICATION 2 — LE CHEF EN COULISSES NE POSE AUCUNE QUESTION (carte « Communication V2, simple et limpide »).
 * Une demande venue de Communication 2 n'a personne pour répondre : tant que son drapeau est posé sur le chef,
 * l'outil « ask_user » REFUSE et rend la main sans attente (DEC-026). Le drapeau retiré, ou trop vieux, la question
 * redevient permise. La règle est tenue par le refus, pas seulement par la consigne.
 */

process.env.BELUGA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'coulisses-sans-question-'));

const { Project, DUREE_DES_COULISSES, REFUS_DE_QUESTION_EN_COULISSES, REFUS_D_ETUDE_EN_COULISSES } = await import('@beluga/shared');
const store = await import('../store.js');
const { setMeta } = await import('../db.js');
const { callTool } = await import('../tools.js');
const { etudeRefuseeEnCoulisses, questionRefuseeEnCoulisses } = await import('../communication-coulisses.js');

const ctx = { agentId: 'chef-de-marque-essai', projectId: 'projet-coulisses', role: 'task' as const };
store.saveProject(Project.parse({ id: ctx.projectId, name: 'Projet coulisses', path: fs.mkdtempSync(path.join(os.tmpdir(), 'projet-coulisses-')), createdAt: store.now(), updatedAt: store.now() }));

const poserLeDrapeau = (depuis: number) => setMeta(`communication.coulisses.chef.${ctx.agentId}`, JSON.stringify({ genre: 'programme', marqueId: 'm1', campagneId: 'c1', depuis }));

test('pendant un travail en coulisses, ask_user refuse sans poser de question', async () => {
  poserLeDrapeau(Date.now());
  assert.equal(questionRefuseeEnCoulisses(ctx.agentId), REFUS_DE_QUESTION_EN_COULISSES);
  const r = await callTool(ctx, 'ask_user', { question: 'Quel ton pour la campagne ?', options: [{ label: 'Chaleureux (recommandé)' }, { label: 'Sobre' }] });
  assert.equal(r.ok, false);
  assert.match(r.text, /personne ne répondra/);
  assert.equal((r as { question?: unknown }).question, undefined);
});

test('pendant un travail en coulisses, l’outil Marketing est refusé (sorti de Communication 2)', () => {
  poserLeDrapeau(Date.now());
  assert.equal(etudeRefuseeEnCoulisses(ctx.agentId), REFUS_D_ETUDE_EN_COULISSES);
  assert.equal(etudeRefuseeEnCoulisses('un-autre-agent'), null, 'hors coulisses, l’ancien espace garde l’outil Marketing');
});

test('un drapeau trop vieux ne bride plus le chef', () => {
  poserLeDrapeau(Date.now() - DUREE_DES_COULISSES - 60_000);
  assert.equal(questionRefuseeEnCoulisses(ctx.agentId), null);
});

test('le drapeau retiré à la fin du tour, la question redevient permise', () => {
  setMeta(`communication.coulisses.chef.${ctx.agentId}`, '');
  assert.equal(questionRefuseeEnCoulisses(ctx.agentId), null);
  assert.equal(etudeRefuseeEnCoulisses(ctx.agentId), null);
  assert.equal(questionRefuseeEnCoulisses('un-autre-agent'), null);
});
