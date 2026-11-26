import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * BELUGA CONNECT NE SE RELIE PLUS TOUT SEUL (décision du 26/11/2026, « toujours un code à taper ») : un Beluga Connect
 * d'avant (≤ 1.6) qui demande une liaison reçoit un code de secours, affiché par lui et tapé dans l'onglet ; la version
 * 1.7 tape le code affiché dans les réglages (`liaison-par-code-tape.test.ts`). Jamais un compte deviné.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-liaison-toute-seule-'));
process.env.BELUGA_DATA = bacASable;

const { getDb } = await import('../db.js');
const { bus } = await import('../bus.js');
const relais = await import('../relais-mac.js');
const ecrans = await import('../ecrans-ouverts.js');
getDb();

test('plus aucune liaison toute seule : même réseau, un seul compte qui vient de cliquer « Lier » → code de secours (26/11/2026)', () => {
  relais.emettreUnCodeDuRelais('compte-maison', Date.now(), null, '::ffff:81.1.1.1');
  const d = relais.demanderUneLiaison({ nom: 'Mac de la maison' }, '81.1.1.1');
  assert.ok(d.ok && d.etat === 'code' && /^[0-9]{6}$/.test(d.codeDeSecours ?? ''));
  if (d.ok) assert.equal(d.identifiant, undefined, 'aucune clé rendue sans code tapé');
});

test('même réseau, DEUX comptes qui viennent de cliquer « Lier » : code de secours', () => {
  relais.emettreUnCodeDuRelais('compte-bureau-a', Date.now(), null, '82.2.2.2');
  relais.emettreUnCodeDuRelais('compte-bureau-b', Date.now(), null, '82.2.2.2');
  const d = relais.demanderUneLiaison({ nom: 'Mac du bureau' }, '82.2.2.2');
  assert.ok(d.ok && d.etat === 'code' && /^[0-9]{6}$/.test(d.codeDeSecours ?? ''));
});

test('le code de secours tapé dans l’onglet relie au compte connecté, et Beluga Connect reçoit sa clé', async () => {
  relais.emettreUnCodeDuRelais('compte-secours', Date.now(), null, '84.4.4.4');
  relais.emettreUnCodeDuRelais('compte-voisin', Date.now(), null, '84.4.4.4');
  const lacher = ecrans.noterUnEcranOuvert('compte-secours');
  const recus: any[] = [];
  const stop = bus.subscribe((e: any) => {
    if (e.type === 'relaisMac.codeAttendu') recus.push(e);
  });
  const d = relais.demanderUneLiaison({ nom: 'Mac partagé' }, '84.4.4.4');
  stop();
  assert.ok(d.ok && d.etat === 'code' && d.codeDeSecours);
  if (!d.ok || !d.codeDeSecours) return;
  assert.ok(recus.some((e) => e.pour === 'compte-secours'), 'l’onglet du compte qui vient de cliquer « Lier » est prévenu');
  assert.ok(d.prevenus >= 1);
  assert.equal(relais.codeAttenduParLeCompte('compte-secours')?.nom, 'Mac partagé');
  assert.equal(relais.accepterParCodeDeSecours('compte-secours', '000000').ok, d.codeDeSecours === '000000');
  const attente = relais.attendreLaLiaison(d.retrait, 5_000);
  const r = relais.accepterParCodeDeSecours('compte-secours', d.codeDeSecours.slice(0, 3) + ' ' + d.codeDeSecours.slice(3));
  assert.deepEqual(r, { ok: true, nom: 'Mac partagé' });
  const issue = await attente;
  assert.equal(issue.etat, 'acceptee');
  if (issue.etat === 'acceptee') assert.ok(issue.identifiant.startsWith('compte-secours.'));
  assert.equal(relais.accepterParCodeDeSecours('compte-voisin', d.codeDeSecours).ok, false, 'usage unique');
  assert.equal(relais.codeAttenduParLeCompte('compte-secours'), null);
  lacher();
});
