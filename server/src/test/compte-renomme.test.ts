import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* Renommer un compte : on n'écrit QUE le nom affiché (`label`), et de   */
/* façon durable. Un nom vide est refusé — le compte garde son ancien    */
/* nom.                                                                 */
/* ------------------------------------------------------------------ */

// Comme les autres tests qui touchent la base, on la pose dans un dossier
// jetable AVANT d'importer les modules qui la lisent.
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'compte-renomme-'));
process.env.HAIKODEV_DATA = bacASable;

const accounts = await import('../accounts.js');
const { saveAccountRecord, listAllAccountRecords, renameAccount } = accounts;

saveAccountRecord({
  id: 'claude-relais',
  engine: 'claude',
  label: 'Claude — compte principal',
  priority: 10,
  configDir: '/tmp/claude-relais',
  disabled: true,
});

test('renommer un compte écrit le nouveau nom, et rien d’autre', () => {
  const modifie = renameAccount('claude-relais', 'Studio — Max x20');
  assert.equal(modifie?.label, 'Studio — Max x20');
  // On ne touche qu'au nom : le reste du compte est intact.
  assert.equal(modifie?.priority, 10);
  assert.equal(modifie?.engine, 'claude');
  assert.equal(modifie?.configDir, '/tmp/claude-relais');
  assert.equal(modifie?.disabled, true);
});

test('le nouveau nom survit : relire la base rend le même label', () => {
  const relu = listAllAccountRecords().find((a) => a.id === 'claude-relais');
  assert.equal(relu?.label, 'Studio — Max x20', 'le nom est écrit sur le compte, pas en mémoire vive');
});

test('un nom vide (ou fait d’espaces) est refusé et laisse l’ancien nom', () => {
  assert.equal(renameAccount('claude-relais', ''), null);
  assert.equal(renameAccount('claude-relais', '   '), null);
  const relu = listAllAccountRecords().find((a) => a.id === 'claude-relais');
  assert.equal(relu?.label, 'Studio — Max x20', 'l’ancien nom tient');
});

test('le nom est débarrassé de ses espaces de bord', () => {
  const modifie = renameAccount('claude-relais', '  Codex — relève  ');
  assert.equal(modifie?.label, 'Codex — relève');
});

test('renommer un compte inconnu ne crée rien', () => {
  assert.equal(renameAccount('inexistant', 'Peu importe'), null);
  assert.ok(!listAllAccountRecords().some((a) => a.id === 'inexistant'));
});
