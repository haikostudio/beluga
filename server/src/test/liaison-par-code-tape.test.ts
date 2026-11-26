import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LE CODE TAPÉ DANS BELUGA CONNECT (décisions de l'utilisateur, 26/11/2026 : « toujours un code à taper dans Beluga
 * Connect », sur Mac, Windows et Linux ; un même ordinateur n'a qu'une fiche ; supprimer une fiche est définitif).
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-code-tape-'));
process.env.BELUGA_DATA = bacASable;

const { getDb } = await import('../db.js');
const { bus } = await import('../bus.js');
const relais = await import('../relais-mac.js');
const ordinateurs = await import('../ordinateurs.js');
const { etapeDAjout, lierTelecharge, codeATaperLu, DUREE_DU_CODE_A_TAPER_MS } = await import('@beluga/shared');
getDb();

const MACHINE = 'a'.repeat(64);

test('le code à taper relie une seule fois, au compte qui l’affiche, pendant dix minutes', async () => {
  const { code, expireLe } = relais.codeATaper('compte-a');
  assert.match(code, /^\d{6}$/);
  assert.ok(expireLe - Date.now() <= DUREE_DU_CODE_A_TAPER_MS);
  /* Rouvrir les réglages réaffiche LE MÊME code ; « Nouveau code » en donne un autre et tue l'ancien. */
  assert.equal(relais.codeATaper('compte-a').code, code);
  const neuf = relais.codeATaper('compte-a', { renouveler: true });
  assert.notEqual(neuf.code, code);
  assert.equal(relais.relierUnMac({ code, nom: 'Mac', machine: MACHINE }, '10.1.0.1').ok, false, 'l’ancien code ne relie plus');
  const r = relais.relierUnMac({ code: `${neuf.code.slice(0, 3)} ${neuf.code.slice(3)}`, nom: 'MacBook Pro', machine: MACHINE }, '10.1.0.2');
  assert.ok(r.ok);
  if (r.ok) {
    assert.ok(r.identifiant.startsWith('compte-a.'));
    assert.equal((r as Record<string, unknown>).ordinateurId, undefined, 'la réponse à Beluga Connect ne change pas de forme');
  }
  assert.equal(relais.relierUnMac({ code: neuf.code, nom: 'Mac' }, '10.1.0.3').ok, false, 'usage unique');
  /* Un code à taper de plus de dix minutes est refusé. */
  const vieux = relais.emettreUnCodeDuRelais('compte-a', Date.now() - DUREE_DU_CODE_A_TAPER_MS - 1_000, null, null, 'saisie');
  assert.equal(relais.relierUnMac({ code: vieux.code, nom: 'Mac' }, '10.1.0.4').ok, false);
});

test('la même machine reliée de nouveau reprend SA fiche ; une autre machine en reçoit une ; un autre compte ne la voit pas', async () => {
  const avant = await ordinateurs.ordinateursDuCompte('compte-a');
  assert.equal(avant.length, 1);
  ordinateurs.changerUnDroit('compte-a', avant[0]!.id, 'ecran', true);
  const r = relais.relierUnMac({ code: relais.codeATaper('compte-a', { renouveler: true }).code, nom: 'MacBook Pro', machine: MACHINE }, '10.1.0.5');
  assert.ok(r.ok);
  const apres = await ordinateurs.ordinateursDuCompte('compte-a');
  assert.equal(apres.length, 1, 'une seule fiche pour un même ordinateur');
  assert.equal(apres[0]!.id, avant[0]!.id);
  assert.equal(ordinateurs.droitsDUnOrdinateur('compte-a', apres[0]!.id)?.ecran, true, 'la fiche reprise garde ses droits');
  assert.ok(relais.relierUnMac({ code: relais.codeATaper('compte-a', { renouveler: true }).code, nom: 'Mac mini', machine: 'b'.repeat(64) }, '10.1.0.6').ok);
  assert.equal((await ordinateurs.ordinateursDuCompte('compte-a')).length, 2);
  /* La même machine sur un AUTRE compte : une fiche à lui, jamais celle du premier. */
  assert.ok(relais.relierUnMac({ code: relais.codeATaper('compte-b').code, nom: 'MacBook Pro', machine: MACHINE }, '10.1.0.7').ok);
  const deB = await ordinateurs.ordinateursDuCompte('compte-b');
  assert.equal(deB.length, 1);
  assert.notEqual(deB[0]!.id, avant[0]!.id);
  assert.notEqual(ordinateurs.empreinteDeMachine('compte-a', MACHINE), ordinateurs.empreinteDeMachine('compte-b', MACHINE));
  assert.equal(ordinateurs.empreinteDeMachine('compte-a', 'trop court'), null);
});

test('une fiche supprimée est définitive : rien ne la relie tout seul, et la machine reçoit une fiche neuve au code suivant', async () => {
  const fiche = (await ordinateurs.ordinateursDuCompte('compte-a')).find((o) => o.nom === 'MacBook Pro')!;
  /* Le code du téléchargement encore vivant (moins de 24 h) : c'est lui qui reliait de nouveau en deux secondes. */
  const telechargement = relais.emettreUnCodeDuRelais('compte-a', Date.now(), null);
  getDb().prepare('UPDATE ordinateurs SET revoque_le = ? WHERE id = ?').run(Date.now(), fiche.id);
  relais.delierLeMac('compte-a', fiche.id);
  const d = relais.demanderUneLiaison({ nom: 'MacBook Pro', code: telechargement.code }, '10.1.0.8');
  assert.ok(d.ok && d.etat === 'code', 'un Beluga Connect d’avant reçoit un code de secours, jamais une clé');
  assert.equal(relais.relierUnMac({ code: telechargement.code, nom: 'MacBook Pro', machine: MACHINE }, '10.1.0.9').ok, false);
  assert.ok(!(await ordinateurs.ordinateursDuCompte('compte-a')).some((o) => o.id === fiche.id));
  const r = relais.relierUnMac({ code: relais.codeATaper('compte-a', { renouveler: true }).code, nom: 'MacBook Pro', machine: MACHINE }, '10.1.0.10');
  assert.ok(r.ok);
  const neuve = (await ordinateurs.ordinateursDuCompte('compte-a')).find((o) => o.nom === 'MacBook Pro');
  assert.ok(neuve && neuve.id !== fiche.id, 'la fiche supprimée ne revient pas');
});

test('le parcours est tenu par le démon : téléchargé, Beluga Connect lancé (annonce), relié — et « Lier » ne retélécharge plus', () => {
  const p = relais.ouvrirLeParcours('compte-c', 'mac');
  assert.equal(etapeDAjout(p), 'telecharger');
  assert.equal(lierTelecharge(p, Date.now()), true);
  const { code } = relais.emettreUnCodeDuRelais('compte-c', Date.now(), null);
  relais.noterAuParcours('compte-c', { telechargeLe: Date.now() });
  assert.equal(etapeDAjout(relais.parcoursDuCompte('compte-c')), 'lancer');
  assert.equal(lierTelecharge(relais.parcoursDuCompte('compte-c'), Date.now()), false, '« Lier » reprend sans retélécharger');
  const recus: any[] = [];
  const stop = bus.subscribe((e: any) => {
    if (e.type === 'relaisMac.connectLance') recus.push(e);
  });
  assert.deepEqual(relais.annoncerConnect({ code, nom: 'MacBook de C', systeme: 'mac' }, '10.2.0.1'), { ok: true });
  /* Un code inconnu ne dit rien, ne prévient personne. */
  assert.deepEqual(relais.annoncerConnect({ code: '000000', nom: 'Intrus' }, '10.2.0.2'), { ok: true });
  stop();
  assert.equal(recus.length, 1);
  assert.equal(recus[0].pour, 'compte-c', 'seuls les onglets du compte du parcours rouvrent les réglages');
  assert.equal(etapeDAjout(relais.parcoursDuCompte('compte-c')), 'code');
  const r = relais.relierUnMac({ code: relais.codeATaper('compte-c').code, nom: 'MacBook de C', machine: 'c'.repeat(64) }, '10.2.0.3');
  assert.ok(r.ok);
  const fin = relais.parcoursDuCompte('compte-c');
  assert.equal(etapeDAjout(fin), 'relie');
  assert.ok(fin?.ordinateurId);
  relais.fermerLeParcours('compte-c');
  assert.equal(relais.parcoursDuCompte('compte-c'), null);
  assert.equal(codeATaperLu(' 123-456 '), '123456');
  assert.equal(codeATaperLu('12345'), null);
});
