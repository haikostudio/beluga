import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* Une VRAIE base, dans un dossier jetable : le test n'a rien à faire de celle du serveur. */
process.env.BELUGA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-mesure-'));

const store = await import('../store.js');
const { getDb } = await import('../db.js');
const { pickAccount, listAccountRecords, listAllAccountRecords, saveAccountRecord, reglerForfaitMensuel } = await import('../accounts.js');

const H = 3600 * 1000;
const J = 24 * H;
const MAINTENANT = Date.now();

function poser(account: string, engine: string, tokens: number, at: number): void {
  getDb()
    .prepare('INSERT INTO usage (account, engine, tokens, created_at) VALUES (?, ?, ?, ?)')
    .run(account, engine, tokens, at);
}

test("les tours mesurés d'un compte ne sont que les siens, sur 35 jours", () => {
  poser('mimo-essai', 'mimo', 1000, MAINTENANT - 20 * J);
  poser('mimo-essai', 'mimo', 250, MAINTENANT - 1 * H);
  poser('autre-compte', 'mimo', 9999, MAINTENANT - 1 * H); // jamais compté ici
  poser('mimo-essai', 'mimo', 5000, MAINTENANT - 40 * J); // hors des 35 jours

  const evenements = store.evenementsDUsageDuCompte('mimo-essai', MAINTENANT);
  assert.deepEqual(
    evenements.map((e) => e.valeur),
    [1000, 250],
  );
  assert.deepEqual(store.evenementsDUsageDuCompte('inconnu', MAINTENANT), []);
});

test('Gemini, suivi seulement, ne peut jamais être choisi pour un tour : aucun compte derrière', async () => {
  assert.equal(listAccountRecords().some((a) => a.engine === 'ext-google-gemini'), false);
  assert.equal(await pickAccount('ext-google-gemini' as never), null);
});

test('le forfait du mois se règle champ par champ, et le consommé date son relevé', () => {
  saveAccountRecord({ id: 'mimo-forfait', engine: 'mimo', label: 'MiMo forfait', priority: 10, configDir: os.tmpdir() });
  saveAccountRecord({ id: 'claude-forfait', engine: 'claude', label: 'Claude', priority: 10, configDir: os.tmpdir() });
  const lire = () => listAllAccountRecords().find((a) => a.id === 'mimo-forfait')?.forfaitMensuel;

  reglerForfaitMensuel('mimo-forfait', { plafond: 4_100_000_000, renouvellement: MAINTENANT + 10 * J });
  assert.equal(lire()?.plafond, 4_100_000_000);
  assert.equal(lire()?.consommeAuReleve, undefined);

  const avant = Date.now();
  reglerForfaitMensuel('mimo-forfait', { consomme: 441_230_050 });
  assert.equal(lire()?.consommeAuReleve, 441_230_050);
  assert.ok((lire()?.releveAt ?? 0) >= avant);
  assert.equal(lire()?.plafond, 4_100_000_000); // un champ absent ne change pas

  reglerForfaitMensuel('mimo-forfait', { consomme: null, plafond: null });
  assert.equal(lire()?.consommeAuReleve, undefined);
  assert.equal(lire()?.releveAt, undefined);
  assert.equal(lire()?.plafond, undefined);
  assert.notEqual(lire()?.renouvellement, undefined);

  // Un plafond n'a de sens que sur MiMo, et sur un compte qui existe.
  assert.equal(reglerForfaitMensuel('claude-forfait', { plafond: 10 }), null);
  assert.equal(reglerForfaitMensuel('inconnu', { plafond: 10 }), null);
});
