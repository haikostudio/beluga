import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOSSIER_PLANS, cheminDuDocument, estUnDocument, nomDeFichierPropre } from '@haikodev/shared';

/*
 * `../runtime.js` importe `../config.js` en cascade (via `../store.js`) : un
 * `import` statique de haut de fichier se résout AVANT toute autre ligne du
 * module, HAIKODEV_DATA compris — la base réelle du démon serait figée dans
 * `PATHS.db` avant même d'être redirigée. D'où l'import dynamique, comme pour
 * `store.js` et `tools.js` juste en dessous.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'documents-de-cadrage-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { callTool } = await import('../tools.js');
const { rolePrompt } = await import('../runtime.js');

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
  const choix = cheminDuDocument('refonte-accueil');
  assert.equal(choix.ok, true);
  assert.equal(choix.ok && choix.chemin, `${DOSSIER_PLANS}/refonte-accueil.md`);
  assert.equal(choix.ok && choix.parDefaut, true, 'le dossier des plans a été posé d’office');
});

test('le dossier déjà écrit n’est pas redoublé', () => {
  const choix = cheminDuDocument(`${DOSSIER_PLANS}/refonte-accueil.md`);
  assert.equal(choix.ok && choix.chemin, `${DOSSIER_PLANS}/refonte-accueil.md`);
});

test('un nom porté par un humain devient un nom de fichier propre', () => {
  assert.equal(nomDeFichierPropre('Plan : refonte de l’accueil'), 'plan-refonte-de-l-accueil');
  const choix = cheminDuDocument('Plan : refonte de l’accueil');
  assert.equal(choix.ok && choix.chemin, `${DOSSIER_PLANS}/plan-refonte-de-l-accueil.md`);
});

test('un DOCUMENT s’écrit n’importe où dans le projet, dossier nommé', () => {
  for (const chemin of ['docs/regles/cartes.md', 'docs/memoire/cartes.md', 'docs/audit/2026/bilan.txt']) {
    const choix = cheminDuDocument(chemin);
    assert.equal(choix.ok, true, `« ${chemin} » aurait dû être accepté`);
    assert.equal(choix.ok && choix.chemin, chemin);
  }
});

test('un fichier de la racine qui EXISTE déjà se modifie sous son nom nu', () => {
  const choix = cheminDuDocument('CLAUDE.md', (rel) => rel === 'CLAUDE.md');
  assert.equal(choix.ok && choix.chemin, 'CLAUDE.md');
  // Sans fichier connu, le même nom reste un plan.
  const sansFichier = cheminDuDocument('CLAUDE.md');
  assert.equal(sansFichier.ok && sansFichier.chemin, `${DOSSIER_PLANS}/CLAUDE.md`);
});

test('le CODE reste fermé, quelle que soit sa place', () => {
  for (const chemin of ['runtime.ts', 'server/src/runtime.ts', 'package.json', 'scripts/verif.mjs', 'style.css']) {
    const choix = cheminDuDocument(chemin);
    assert.equal(choix.ok, false, `« ${chemin} » aurait dû être refusé`);
    assert.match(!choix.ok ? choix.raison : '', /document|carte/i);
  }
});

test('on ne sort pas du projet, on ne touche ni au caché ni aux dossiers de machine', () => {
  for (const chemin of ['../ailleurs.md', '/etc/passwd.md', '.git/config.md', 'node_modules/paquet/lisez.md']) {
    const choix = cheminDuDocument(chemin);
    assert.equal(choix.ok, false, `« ${chemin} » aurait dû être refusé`);
    assert.match(!choix.ok ? choix.raison : '', /refus/i);
  }
});

test('« estUnDocument » sépare le texte du code', () => {
  assert.equal(estUnDocument('docs/note.md'), true);
  assert.equal(estUnDocument('note.TXT'), true);
  assert.equal(estUnDocument('server/src/tools.ts'), false);
});

/* ------------------------------------------------------------------ */
/* L'outil : le chef écrit les documents, partout, et jamais le code   */
/* ------------------------------------------------------------------ */

test('le chef écrit son plan dans le dossier des plans', async () => {
  const p = projetDEssai();
  const resultat = await callTool(
    { projectId: p.id, role: 'cadrage' } as any,
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
  const ctx = { projectId: p.id, role: 'cadrage' } as any;
  await callTool(ctx, 'write_document', { relativePath: 'ajustable.md', content: 'avant' });
  const resultat = await callTool(ctx, 'write_document', { relativePath: 'ajustable.md', content: 'après' });
  assert.match(resultat.text, /mis à jour/i);
  assert.equal(fs.readFileSync(path.join(projet, DOSSIER_PLANS, 'ajustable.md'), 'utf8'), 'après');
});

test('le chef écrit la documentation du projet, hors du dossier des plans', async () => {
  const p = projetDEssai();
  const resultat = await callTool(
    { projectId: p.id, role: 'cadrage' } as any,
    'write_document',
    { relativePath: 'docs/memoire/nouveau-sujet.md', content: '# Un sujet' },
  );
  assert.equal(resultat.ok, true, resultat.text);
  assert.equal(fs.existsSync(path.join(projet, 'docs', 'memoire', 'nouveau-sujet.md')), true);
});

test('le chef modifie le fichier d’instructions du moteur sous son nom nu', async () => {
  const p = projetDEssai();
  fs.writeFileSync(path.join(projet, 'CLAUDE.md'), 'avant', 'utf8');
  const resultat = await callTool(
    { projectId: p.id, role: 'cadrage' } as any,
    'write_document',
    { relativePath: 'CLAUDE.md', content: 'après' },
  );
  assert.equal(resultat.ok, true, resultat.text);
  assert.equal(fs.readFileSync(path.join(projet, 'CLAUDE.md'), 'utf8'), 'après');
});

test('le chef SUPPRIME un document, et un document seulement', async () => {
  const p = projetDEssai();
  const ctx = { projectId: p.id, role: 'cadrage' } as any;
  await callTool(ctx, 'write_document', { relativePath: 'docs/jetable.md', content: 'à effacer' });
  const supprime = await callTool(ctx, 'write_document', { relativePath: 'docs/jetable.md', action: 'supprimer' });
  assert.equal(supprime.ok, true, supprime.text);
  assert.equal(fs.existsSync(path.join(projet, 'docs', 'jetable.md')), false);

  const absent = await callTool(ctx, 'write_document', { relativePath: 'docs/jetable.md', action: 'supprimer' });
  assert.equal(absent.ok, false, 'effacer un document absent se dit');

  const code = await callTool(ctx, 'write_document', { relativePath: 'server/src/tools.ts', action: 'supprimer' });
  assert.equal(code.ok, false, 'le code ne s’efface pas par cet outil');
});

test('le chef ne peut pas écrire un fichier de CODE', async () => {
  const p = projetDEssai();
  const resultat = await callTool(
    { projectId: p.id, role: 'cadrage' } as any,
    'write_document',
    { relativePath: 'server/src/runtime.ts', content: 'export const x = 1;' },
  );
  assert.equal(resultat.ok, false);
  assert.equal(fs.existsSync(path.join(projet, 'server', 'src', 'runtime.ts')), false);
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
/* La suite : le plan est indexé, et l'agent sait où écrire             */
/* ------------------------------------------------------------------ */

test('en mode plan, le plan écrit est aussi enregistré', () => {
  const consigne = rolePrompt('cadrage', false, 'claude', 'complet', 'plan');
  assert.match(consigne, /ENREGISTRE CHAQUE PLAN/);
});
