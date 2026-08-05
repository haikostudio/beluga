import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* Un interrupteur coupe un compte : il reste dans la liste, éteint,    */
/* mais l'ordonnanceur ne le choisit plus et sa fenêtre n'est plus      */
/* amorcée.                                                            */
/* ------------------------------------------------------------------ */

/*
 * Comme les autres tests qui touchent la base, on la pose dans un dossier
 * jetable AVANT d'importer les modules qui la lisent.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'compte-desactive-'));
process.env.HAIKODEV_DATA = bacASable;

// Un faux dossier personnel avec des identifiants Claude déjà en place : c'est
// ce que `bootstrapAccounts` va trouver et vouloir déclarer en « claude-principal »
// au démarrage. On le pose AVANT d'importer les modules qui lisent `HOME`.
const fauxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'compte-desactive-home-'));
const claudeDir = path.join(fauxHome, '.claude');
fs.mkdirSync(claudeDir, { recursive: true });
fs.writeFileSync(path.join(claudeDir, '.credentials.json'), JSON.stringify({ claudeAiOauth: {} }));
process.env.HOME = fauxHome;

const accounts = await import('../accounts.js');
const { etatDesComptes } = await import('../amorce.js');

const { saveAccountRecord, listAccountRecords, listAllAccountRecords, setAccountDisabled, bootstrapAccounts } =
  accounts;

saveAccountRecord({
  id: 'claude-actif',
  engine: 'claude',
  label: 'Claude — actif',
  priority: 10,
  configDir: '/tmp/claude-actif',
});
saveAccountRecord({
  id: 'claude-coupe',
  engine: 'claude',
  label: 'Claude — à couper',
  priority: 50,
  configDir: '/tmp/claude-coupe',
});

test('couper un compte le sort de la liste utilisable, pas de la liste complète', () => {
  const modifie = setAccountDisabled('claude-coupe', true);
  assert.equal(modifie?.disabled, true);

  const utilisables = listAccountRecords().map((a) => a.id);
  assert.ok(!utilisables.includes('claude-coupe'), 'le compte coupé ne sert plus');
  assert.ok(utilisables.includes('claude-actif'), 'le compte actif sert toujours');

  const tous = listAllAccountRecords().map((a) => a.id);
  assert.ok(tous.includes('claude-coupe'), 'le compte coupé reste déclaré, jamais supprimé');
});

test('un compte coupé est écarté de etatDesComptes, donc de l’amorçage', () => {
  const ids = etatDesComptes().map((e) => e.id);
  assert.ok(!ids.includes('claude-coupe'), 'plus aucune amorce ne peut viser un compte coupé');
  assert.ok(ids.includes('claude-actif'));
});

test('le réglage survit : relire la base rend le même état', () => {
  const relu = listAllAccountRecords().find((a) => a.id === 'claude-coupe');
  assert.equal(relu?.disabled, true, 'l’état coupé est écrit sur le compte, pas en mémoire vive');
});

test('rallumer le compte le remet dans le jeu', () => {
  setAccountDisabled('claude-coupe', false);
  assert.ok(listAccountRecords().map((a) => a.id).includes('claude-coupe'), 'de nouveau utilisable');
  assert.ok(etatDesComptes().map((e) => e.id).includes('claude-coupe'), 'de nouveau amorçable');
});

/*
 * Le cœur de la carte : un compte principal coupé à la main NE DOIT PAS se
 * rallumer au redémarrage du démon. `bootstrapAccounts` retrouve les identifiants
 * du faux dossier personnel et voudrait déclarer « claude-principal » à neuf ;
 * comme le compte est déjà connu (même coupé), il doit être LAISSÉ tel quel.
 */
test('un redémarrage ne rallume pas un compte principal coupé', () => {
  // Le compte principal existe déjà (créé par un bootstrap précédent ou à la
  // main) et vient d'être coupé.
  saveAccountRecord({
    id: 'claude-principal',
    engine: 'claude',
    label: 'Claude — compte principal',
    priority: 10,
    configDir: claudeDir,
  });
  setAccountDisabled('claude-principal', true);
  const avant = listAllAccountRecords().find((a) => a.id === 'claude-principal');
  assert.equal(avant?.disabled, true, 'préparation : le compte principal est bien coupé');

  // Le démon redémarre : bootstrapAccounts repasse.
  bootstrapAccounts();

  const apres = listAllAccountRecords().find((a) => a.id === 'claude-principal');
  assert.equal(apres?.disabled, true, 'le compte principal reste coupé après le redémarrage');
  assert.ok(
    !listAccountRecords().map((a) => a.id).includes('claude-principal'),
    'et il reste hors de la liste utilisable, donc aucune tâche ne le choisit',
  );
});
