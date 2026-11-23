import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* « Reconnecter » un compte À CLÉ (MiMo, Cursor) : jamais la page de   */
/* connexion de Claude, mais une nouvelle clé éprouvée, posée sur le    */
/* MÊME compte. Une clé refusée n'écrase jamais l'ancienne.             */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'reconnexion-cle-'));
process.env.BELUGA_DATA = bacASable;

const { saveAccountRecord, listAllAccountRecords, remplacerCleDuCompte } = await import('../accounts.js');
const { demarrerConnexion } = await import('../connexion-compte.js');

const dossierMimo = path.join(bacASable, 'comptes', 'mimo-perso');
fs.mkdirSync(dossierMimo, { recursive: true });
fs.writeFileSync(path.join(dossierMimo, 'api-key'), 'ancienne-cle\n');
saveAccountRecord({ id: 'mimo-perso', engine: 'mimo', label: 'MiMo — perso', priority: 50, configDir: dossierMimo });
saveAccountRecord({ id: 'claude-a', engine: 'claude', label: 'Claude A', priority: 10, configDir: path.join(bacASable, 'claude-a') });

const fetchOrigine = globalThis.fetch;
function repondre(statut: number, corps: unknown = { data: [{ id: 'mimo-v2.6-pro' }] }): void {
  globalThis.fetch = (async () => new Response(JSON.stringify(corps), { status: statut })) as typeof fetch;
}
test.after(() => {
  globalThis.fetch = fetchOrigine;
});

test('la page de connexion est refusée pour un compte à clé, au lieu d’ouvrir celle de Claude', async () => {
  await assert.rejects(() => demarrerConnexion({ engine: 'claude', accountId: 'mimo-perso' }), /clé d'accès/);
  await assert.rejects(() => demarrerConnexion({ engine: 'mimo' }), /clé d'accès/);
  await assert.rejects(() => demarrerConnexion({ engine: 'cursor' }), /clé d'accès/);
});

test('une clé refusée par le fournisseur laisse l’ancienne en place', async () => {
  repondre(401, { error: { message: 'invalid key' } });
  const rendu = await remplacerCleDuCompte('mimo-perso', 'mauvaise-cle');
  assert.equal(rendu.ok, false);
  assert.match(rendu.erreur ?? '', /refusée/);
  assert.equal(fs.readFileSync(path.join(dossierMimo, 'api-key'), 'utf8').trim(), 'ancienne-cle');
});

test('une clé acceptée remplace l’ancienne sur le MÊME compte', async () => {
  repondre(200);
  const avant = listAllAccountRecords().length;
  const rendu = await remplacerCleDuCompte('mimo-perso', '  nouvelle-cle  ');
  assert.equal(rendu.ok, true);
  assert.equal(rendu.account?.id, 'mimo-perso');
  assert.equal(fs.readFileSync(path.join(dossierMimo, 'api-key'), 'utf8').trim(), 'nouvelle-cle');
  assert.equal(fs.statSync(path.join(dossierMimo, 'api-key')).mode & 0o777, 0o600);
  assert.equal(listAllAccountRecords().length, avant, 'aucun compte en plus');
});

test('un compte à page ou inconnu ne reçoit pas de clé', async () => {
  repondre(200);
  assert.equal((await remplacerCleDuCompte('claude-a', 'x')).ok, false);
  assert.equal((await remplacerCleDuCompte('inconnu', 'x')).ok, false);
  assert.equal((await remplacerCleDuCompte('mimo-perso', '   ')).ok, false);
});
