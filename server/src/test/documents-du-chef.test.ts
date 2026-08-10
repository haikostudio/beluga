import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOSSIER_PLANS, cheminDuDocumentDuChef, nomDeFichierPropre } from '@haikodev/shared';
import { CONSIGNE_DOCUMENTS_DU_CHEF, rolePrompt } from '../runtime.js';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'documents-du-chef-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { callTool } = await import('../tools.js');
const { fichiersAIndexer } = await import('../passages.js');

const projet = fs.mkdtempSync(path.join(os.tmpdir(), 'projet-plans-'));

function projetDEssai() {
  return store.saveProject({
    id: store.newId(),
    name: 'Projet d’essai',
    path: projet,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

/* ------------------------------------------------------------------ */
/* La règle pure : où va un document du chef, et ce qui est refusé     */
/* ------------------------------------------------------------------ */

test('un nom simple est rangé d’office dans le dossier des plans', () => {
  const choix = cheminDuDocumentDuChef('refonte-accueil');
  assert.equal(choix.ok, true);
  assert.equal(choix.ok && choix.chemin, `${DOSSIER_PLANS}/refonte-accueil.md`);
});

test('le dossier déjà écrit n’est pas redoublé', () => {
  const choix = cheminDuDocumentDuChef(`${DOSSIER_PLANS}/refonte-accueil.md`);
  assert.equal(choix.ok && choix.chemin, `${DOSSIER_PLANS}/refonte-accueil.md`);
});

test('un nom porté par un humain devient un nom de fichier propre', () => {
  assert.equal(nomDeFichierPropre('Plan : refonte de l’accueil'), 'plan-refonte-de-l-accueil');
  const choix = cheminDuDocumentDuChef('Plan : refonte de l’accueil');
  assert.equal(choix.ok && choix.chemin, `${DOSSIER_PLANS}/plan-refonte-de-l-accueil.md`);
});

test('tout autre dossier du projet est refusé, avec la raison dite', () => {
  for (const chemin of ['docs/regles/cartes.md', 'docs/memoire/cartes.md', '../ailleurs.md', '/etc/passwd.md']) {
    const choix = cheminDuDocumentDuChef(chemin);
    assert.equal(choix.ok, false, `« ${chemin} » aurait dû être refusé`);
    assert.match(!choix.ok ? choix.raison : '', /refus/i);
  }
});

test('un fichier de code ne passe pas par cet outil', () => {
  const choix = cheminDuDocumentDuChef('runtime.ts');
  assert.equal(choix.ok, false);
});

/* ------------------------------------------------------------------ */
/* L'outil : le chef écrit dans son dossier, et nulle part ailleurs    */
/* ------------------------------------------------------------------ */

test('le chef écrit son plan dans le dossier des plans', async () => {
  const p = projetDEssai();
  const resultat = await callTool(
    { projectId: p.id, role: 'orchestrator' } as any,
    'write_document',
    { relativePath: 'refonte-accueil', content: '# Refonte de l’accueil\n\nPremière version.\n' },
  );
  assert.equal(resultat.ok, true);
  const fichier = path.join(projet, DOSSIER_PLANS, 'refonte-accueil.md');
  assert.equal(fs.existsSync(fichier), true, 'le fichier doit exister sur le disque');
  assert.match(resultat.text, /créé/i);
});

test('réécrire le même plan est une MISE À JOUR, pas un doublon', async () => {
  const p = projetDEssai();
  const ctx = { projectId: p.id, role: 'orchestrator' } as any;
  await callTool(ctx, 'write_document', { relativePath: 'ajustable.md', content: 'avant' });
  const resultat = await callTool(ctx, 'write_document', { relativePath: 'ajustable.md', content: 'après' });
  assert.match(resultat.text, /mis à jour/i);
  assert.equal(fs.readFileSync(path.join(projet, DOSSIER_PLANS, 'ajustable.md'), 'utf8'), 'après');
});

test('le chef ne peut pas écrire par-dessus les règles du moteur', async () => {
  const p = projetDEssai();
  const resultat = await callTool(
    { projectId: p.id, role: 'orchestrator' } as any,
    'write_document',
    { relativePath: 'docs/regles/cartes.md', content: 'plus de règles' },
  );
  assert.equal(resultat.ok, false);
  assert.equal(fs.existsSync(path.join(projet, 'docs', 'regles', 'cartes.md')), false);
});

test('un agent de tâche, lui, garde le dossier entier', async () => {
  const p = projetDEssai();
  const resultat = await callTool(
    { projectId: p.id, role: 'task' } as any,
    'write_document',
    { relativePath: 'docs/audit.md', content: '# Audit' },
  );
  assert.equal(resultat.ok, true);
  assert.equal(fs.existsSync(path.join(projet, 'docs', 'audit.md')), true);
});

/* ------------------------------------------------------------------ */
/* La suite : le plan est indexé, et le chef sait où écrire            */
/* ------------------------------------------------------------------ */

test('les plans entrent dans l’index de la recherche, en priorité haute', () => {
  fs.mkdirSync(path.join(projet, DOSSIER_PLANS), { recursive: true });
  fs.writeFileSync(path.join(projet, DOSSIER_PLANS, 'indexe.md'), '# Un plan\n\nContenu.\n', 'utf8');
  const fichiers = fichiersAIndexer(projet);
  const plan = fichiers.find((f) => f.source === `${DOSSIER_PLANS}/indexe.md`);
  assert.ok(plan, 'le plan doit être dans la liste des fichiers à indexer');
  assert.equal(plan!.sujet, 'plan-indexe');
  assert.ok(plan!.priorite >= 2, 'un plan passe devant à score égal');
});

test('la consigne du chef nomme son dossier d’écriture', () => {
  const consigne = rolePrompt('orchestrator', false);
  assert.ok(consigne.includes(CONSIGNE_DOCUMENTS_DU_CHEF));
  assert.ok(consigne.includes(DOSSIER_PLANS));
});

test('en mode plan, le plan écrit est aussi enregistré', () => {
  const consigne = rolePrompt('orchestrator', false, 'claude', 'complet', 'plan');
  assert.match(consigne, /ENREGISTRE CHAQUE PLAN/);
});
