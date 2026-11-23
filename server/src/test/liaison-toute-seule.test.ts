import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * BELUGA CONNECT SE RELIE TOUT SEUL (carte « Beluga Connect : liaison sans fenêtre », 22/11/2026) : par le code du
 * téléchargement, sinon par le même réseau quand UN SEUL compte vient de cliquer « Lier », sinon un code de secours
 * affiché par Beluga Connect et tapé dans l'onglet — jamais un compte deviné, jamais un clic « Relier ».
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-liaison-toute-seule-'));
process.env.BELUGA_DATA = bacASable;

const { getDb } = await import('../db.js');
const { bus } = await import('../bus.js');
const relais = await import('../relais-mac.js');
const ecrans = await import('../ecrans-ouverts.js');
getDb();

test('même réseau, un seul compte qui vient de cliquer « Lier » : relié à ce compte, sans code', async () => {
  relais.emettreUnCodeDuRelais('compte-maison', Date.now(), null, '::ffff:81.1.1.1');
  const d = relais.demanderUneLiaison({ nom: 'Mac de la maison' }, '81.1.1.1');
  assert.ok(d.ok && d.etat === 'reliee');
  if (!d.ok || !d.identifiant) return;
  assert.ok(d.identifiant.startsWith('compte-maison.'), 'la clé appartient au compte du réseau');
  /* Le « Lier » est servi : un second ordinateur du même réseau ne s'y raccroche pas. */
  const second = relais.demanderUneLiaison({ nom: 'Autre Mac' }, '81.1.1.1');
  assert.ok(second.ok && second.etat === 'code');
});

test('même réseau, DEUX comptes qui viennent de cliquer « Lier » : on ne devine pas, code de secours', () => {
  relais.emettreUnCodeDuRelais('compte-bureau-a', Date.now(), null, '82.2.2.2');
  relais.emettreUnCodeDuRelais('compte-bureau-b', Date.now(), null, '82.2.2.2');
  const d = relais.demanderUneLiaison({ nom: 'Mac du bureau' }, '82.2.2.2');
  assert.ok(d.ok && d.etat === 'code' && /^[0-9]{6}$/.test(d.codeDeSecours ?? ''));
});

test('un « Lier » de plus de dix minutes ne relie plus par le réseau', () => {
  relais.emettreUnCodeDuRelais('compte-lent', Date.now() - relais.APPARIEMENT_PAR_RESEAU_MS - 1_000, null, '83.3.3.3');
  const d = relais.demanderUneLiaison({ nom: 'Mac' }, '83.3.3.3');
  assert.ok(d.ok && d.etat === 'code');
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
