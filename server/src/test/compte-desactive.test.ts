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

const accounts = await import('../accounts.js');
const { etatDesComptes } = await import('../amorce.js');

const { saveAccountRecord, listAccountRecords, listAllAccountRecords, setAccountDisabled } = accounts;

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
