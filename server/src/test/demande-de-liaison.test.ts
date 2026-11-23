import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * « RELIER CE MAC ? » (21/11/2026) : Beluga Connect demande une liaison sans session, la personne l'accepte dans Beluga,
 * l'application retire sa clé par sa clé de retrait — jamais par le jeton de l'adresse.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-demande-de-liaison-'));
process.env.BELUGA_DATA = bacASable;

const { getDb } = await import('../db.js');
const relais = await import('../relais-mac.js');
getDb();

function signe(identifiant: string, secret: string, corps: string) {
  const ts = Math.floor(Date.now() / 1000);
  const empreinte = crypto.createHash('sha256').update(corps).digest('hex');
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${identifiant}.${empreinte}`).digest('base64url');
  return { id: identifiant, ts: String(ts), sig };
}

test('une demande acceptée remet la clé à l’application, une seule fois, et le compte la reconnaît', async () => {
  const d = relais.demanderUneLiaison({ nom: 'Mac mini', systeme: 'mac' }, '10.0.0.1');
  assert.ok(d.ok);
  if (!d.ok) return;
  assert.notEqual(d.jeton, d.retrait);
  assert.deepEqual(relais.lireUneDemandeDeLiaison(d.jeton)?.nom, 'Mac mini');
  /* Le jeton de l'adresse ne sert PAS à retirer la clé. */
  assert.equal((await relais.attendreLaLiaison(d.jeton, 0)).etat, 'inconnue');
  assert.equal((await relais.attendreLaLiaison(d.retrait, 0)).etat, 'attente');
  const attente = relais.attendreLaLiaison(d.retrait, 5_000);
  const r = relais.accepterUneLiaison('compte-a', d.jeton);
  assert.deepEqual(r, { ok: true, nom: 'Mac mini' });
  const issue = await attente;
  assert.equal(issue.etat, 'acceptee');
  if (issue.etat !== 'acceptee') return;
  const voie = relais.verifierLeRelais(signe(issue.identifiant, issue.secret, ''), '');
  assert.equal(voie?.compteId, 'compte-a');
  /* Usage unique : ni seconde acceptation, ni second retrait. */
  assert.equal(relais.accepterUneLiaison('compte-b', d.jeton).ok, false);
  assert.equal((await relais.attendreLaLiaison(d.retrait, 0)).etat, 'inconnue');
  assert.equal(relais.lireUneDemandeDeLiaison(d.jeton), null);
});

test('« Pas maintenant » : l’application l’apprend, et la demande meurt', async () => {
  const d = relais.demanderUneLiaison({ nom: 'PC', systeme: 'windows' }, '10.0.0.2');
  assert.ok(d.ok);
  if (!d.ok) return;
  assert.equal(relais.refuserUneLiaison(d.jeton), true);
  assert.equal((await relais.attendreLaLiaison(d.retrait, 0)).etat, 'refusee');
  assert.equal(relais.accepterUneLiaison('compte-a', d.jeton).ok, false);
});

test('une demande expire au bout de dix minutes', async () => {
  const debut = Date.now();
  const d = relais.demanderUneLiaison({ nom: 'Mac' }, '10.0.0.3', debut);
  assert.ok(d.ok);
  if (!d.ok) return;
  const apres = debut + relais.DUREE_DEMANDE_DE_LIAISON_MS + 1;
  assert.equal(relais.lireUneDemandeDeLiaison(d.jeton, apres), null);
  assert.equal(relais.accepterUneLiaison('compte-a', d.jeton, null, apres).ok, false);
});

test('une adresse qui insiste est freinée, et ne garde que ses dernières demandes', () => {
  const adresse = '10.0.0.4';
  const t0 = Date.now();
  const rendus = Array.from({ length: 12 }, (_, i) => relais.demanderUneLiaison({ nom: `M${i}` }, adresse, t0 + i));
  assert.equal(rendus.filter((r) => !r.ok).length, 2, 'au-delà de dix par minute : refusé');
  const vivantes = rendus.filter((r): r is Extract<typeof r, { ok: true }> => r.ok).filter((r) => relais.lireUneDemandeDeLiaison(r.jeton, t0 + 20));
  assert.equal(vivantes.length, 5);
});
