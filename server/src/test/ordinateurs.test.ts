import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LES ORDINATEURS NOMMÉS (carte « Choisir l'ordinateur visé depuis le téléphone », 15/11/2026) : règles pures (nom,
 * repère, résolution, choix, navigateur à prendre, Safari, applications), puis la base — un navigateur relié par un
 * code qui vise un ordinateur, plusieurs Mac par compte, l'ordinateur retenu par carte, et SURTOUT : jamais
 * l'ordinateur d'un autre compte, même par son nom exact. Enfin la commande « /ordinateur:<repère> ».
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-ordinateurs-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const { getDb } = await import('../db.js');
const chrome = await import('../extension-chrome.js');
const relais = await import('../relais-mac.js');
const ordinateurs = await import('../ordinateurs.js');
getDb();

type O = import('@beluga/shared').Ordinateur;
const nav = (id: string, genre: 'chrome' | 'safari', enLigne: boolean) => ({ id, genre, enLigne, version: null, vuLe: null, agentsAuTravail: 0 });
const ordi = (id: string, nom: string, navigateurs: O['navigateurs'], programme: O['programme'] = null): O => ({
  id,
  nom,
  repere: shared.repereDOrdinateur(nom),
  creeLe: 0,
  navigateurs,
  programme,
});

test('nom, repère et nom proposé', () => {
  assert.equal(shared.normaliserLeNomDOrdinateur('  Mac   mini\n du bureau '), 'Mac mini du bureau');
  assert.equal(shared.normaliserLeNomDOrdinateur(''), 'Ordinateur');
  assert.equal(shared.normaliserLeNomDOrdinateur('x'.repeat(90)).length, 60);
  assert.equal(shared.repereDOrdinateur('Mac mini du Bureau'), 'mac-mini-du-bureau');
  assert.equal(shared.repereDOrdinateur('Écran d’Hélène'), 'ecran-d-helene');
  assert.equal(shared.nomProposeDepuisLaPlateforme('Chrome · macOS'), 'Mac');
  assert.equal(shared.nomProposeDepuisLaPlateforme('Windows'), 'PC');
  assert.equal(shared.nomGenerique('Mac'), true);
  assert.equal(shared.nomGenerique('Mac mini du bureau'), false);
});

test('résoudre un nom écrit, choisir par défaut', () => {
  const liste = [ordi('o1', 'Mac mini', [nav('c1', 'chrome', true)]), ordi('o2', 'MacBook Air', [nav('c2', 'chrome', false)])];
  assert.equal(shared.resoudreLOrdinateur(liste, 'mac mini')?.id, 'o1');
  assert.equal(shared.resoudreLOrdinateur(liste, 'macbook-air')?.id, 'o2');
  assert.equal(shared.resoudreLOrdinateur(liste, 'c2')?.id, 'o2', 'par l’identifiant d’un navigateur');
  assert.equal(shared.resoudreLOrdinateur(liste, 'iMac'), null);
  assert.equal(shared.ordinateurParDefaut(liste, 'o2', 'o1')?.id, 'o2', 'le retenu d’abord');
  assert.equal(shared.ordinateurParDefaut(liste, null, 'o1')?.id, 'o1', 'puis le dernier');
  assert.equal(shared.ordinateurParDefaut(liste, 'disparu', null), null, 'plusieurs sans choix : rien');
  assert.equal(shared.ordinateurParDefaut([liste[0]!], null, null)?.id, 'o1', 'un seul : pris');
});

test('le navigateur d’un ordinateur : Chrome d’abord, relance, injoignable, jamais de bascule', () => {
  const mixte = ordi('o1', 'Mac', [nav('s1', 'safari', true), nav('c1', 'chrome', true)]);
  assert.equal(shared.navigateurAPrendre(mixte)?.id, 'c1');
  const ferme = ordi('o2', 'Mac mini', [nav('c2', 'chrome', false)], { id: 'r2', etat: 'recopie-fermee', vuLe: Date.now(), autorisations: null });
  const eteint = ordi('o3', 'iMac', [nav('c3', 'chrome', false)], { id: 'r3', etat: 'hors-ligne', vuLe: null, autorisations: null });
  const allume = ordi('o4', 'PC', [nav('c4', 'chrome', true)]);
  const tous = [ferme, eteint, allume];
  const relancer = shared.choisirLOrdinateur(tous, { retenu: 'o2' });
  assert.equal(relancer.genre, 'relancer');
  if (relancer.genre === 'relancer') assert.equal(relancer.navigateur, 'chrome');
  const injoignable = shared.choisirLOrdinateur(tous, { retenu: 'o3' });
  assert.equal(injoignable.genre, 'injoignable', 'iMac éteint : on le dit, on ne prend PAS le PC allumé');
  if (injoignable.genre === 'injoignable') assert.match(injoignable.texte, /iMac.*ne répond pas/);
  assert.equal(shared.choisirLOrdinateur(tous).genre, 'choisir');
  assert.equal(shared.choisirLOrdinateur(tous, { voulu: 'pc' }).genre, 'pret');
  assert.equal(shared.choisirLOrdinateur([]).genre, 'aucun');
});

test('Safari : ce qu’il ne sait pas faire se refuse ou se signale', () => {
  assert.equal(shared.refusDuNavigateur('chrome', 'deposer', {}), null);
  assert.match(shared.refusDuNavigateur('safari', 'deposer', {}) ?? '', /Safari/);
  assert.equal(shared.refusDuNavigateur('safari', 'deposer', { repere: 3 }), null);
  assert.match(shared.avertissementSafari('capturer', { pleinePage: true }) ?? '', /visible/);
  assert.match(shared.avertissementSafari('cliquer') ?? '', /simulé/);
  assert.equal(shared.avertissementSafari('lire'), null);
});

test('ouvrir une application : jamais une commande libre', () => {
  assert.equal(shared.nomDApplicationValable('Mail'), 'Mail');
  assert.equal(shared.nomDApplicationValable('Photos.app'), 'Photos');
  assert.equal(shared.nomDApplicationValable('Google Chrome'), 'Google Chrome');
  for (const piege of ['Mail; rm -rf ~', '$(reboot)', '../../bin/sh', '/Applications/Mail.app', '`id`', '-a Terminal', 'Mail"', '']) {
    assert.equal(shared.nomDApplicationValable(piege), null, piege);
  }
});

function compte(id: string): void {
  getDb()
    .prepare("INSERT OR IGNORE INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le) VALUES (?, ?, 'admin', ?, 's', 'h', 1, 0)")
    .run(id, id, id);
}

test('un navigateur relié par un code rejoint l’ordinateur visé ; sans cible, un ordinateur neuf', async () => {
  compte('a1');
  const mini = ordinateurs.creerUnOrdinateur('a1', 'Mac mini');
  const { code } = chrome.emettreUnCodeDeLiaison('a1', Date.now(), { ordinateurId: mini.id });
  const r = chrome.relierUnChrome({ code, nom: 'Chrome · macOS', version: '1.0.7' }, 'ip-o1');
  assert.ok(r.ok);
  const { code: code2 } = chrome.emettreUnCodeDeLiaison('a1');
  const r2 = chrome.relierUnChrome({ code: code2, nom: 'macOS', navigateur: 'safari' }, 'ip-o1');
  assert.ok(r2.ok);
  const liste = await ordinateurs.ordinateursDuCompte('a1');
  assert.equal(liste.length, 2);
  const leMini = liste.find((o) => o.id === mini.id)!;
  assert.equal(leMini.navigateurs.length, 1);
  assert.equal(leMini.navigateurs[0]!.genre, 'chrome');
  const neuf = liste.find((o) => o.id !== mini.id)!;
  assert.equal(neuf.nom, 'Mac', 'nom proposé depuis la plateforme');
  assert.equal(neuf.navigateurs[0]!.genre, 'safari');

  /* Renommer, puis délier : ses navigateurs partent avec lui. */
  assert.equal(ordinateurs.renommerUnOrdinateur('a1', neuf.id, 'MacBook de Haiko'), true);
  assert.equal((await ordinateurs.ordinateursDuCompte('a1')).find((o) => o.id === neuf.id)?.nom, 'MacBook de Haiko');
  assert.equal(await ordinateurs.delierUnOrdinateur('a1', neuf.id), true);
  assert.equal((await ordinateurs.ordinateursDuCompte('a1')).length, 1);
  assert.equal(chrome.chromesDuCompte('a1').length, 1);
});

test('jamais l’ordinateur d’un autre compte, même par son nom exact', async () => {
  compte('a2');
  compte('b2');
  const aMoi = ordinateurs.creerUnOrdinateur('a2', 'Mon Mac');
  const aLui = ordinateurs.creerUnOrdinateur('b2', 'Mac mini secret');
  /* Le code d'un compte ne rattache pas à l'ordinateur d'un autre : un ordinateur neuf naît chez lui. */
  const { code } = chrome.emettreUnCodeDeLiaison('a2', Date.now(), { ordinateurId: aLui.id });
  assert.ok(chrome.relierUnChrome({ code, nom: 'macOS' }, 'ip-o2').ok);
  const miens = await ordinateurs.ordinateursDuCompte('a2');
  assert.equal(miens.some((o) => o.id === aLui.id), false);
  assert.equal(shared.resoudreLOrdinateur(miens, 'Mac mini secret'), null);
  assert.equal(shared.resoudreLOrdinateur(miens, aLui.id), null);
  /* Retenir, renommer, délier l'ordinateur d'un autre : refusé. */
  assert.equal(ordinateurs.retenirLOrdinateur('a2', 'agent-x', 'carte-x', aLui.id), false);
  assert.equal(ordinateurs.renommerUnOrdinateur('a2', aLui.id, 'pris'), false);
  assert.equal(await ordinateurs.delierUnOrdinateur('a2', aLui.id), false);
  assert.equal(ordinateurs.retenirLOrdinateur('a2', 'agent-x', 'carte-x', aMoi.id), true);
  assert.equal(ordinateurs.ordinateurRetenu('agent-x', 'carte-x'), aMoi.id);
  assert.equal(ordinateurs.dernierOrdinateur('a2'), aMoi.id);
  assert.equal(ordinateurs.dernierOrdinateur('b2'), null);
});

test('plusieurs Mac par compte : chaque programme sur son ordinateur, le vrai nom remplace un nom par défaut', async () => {
  compte('a3');
  const premier = ordinateurs.creerUnOrdinateur('a3', 'Mac');
  const c1 = relais.emettreUnCodeDuRelais('a3', Date.now(), premier.id);
  const l1 = relais.relierUnMac({ code: c1.code, nom: 'Mac mini de Haiko' }, '10.0.0.1');
  assert.ok(l1.ok);
  const c2 = relais.emettreUnCodeDuRelais('a3');
  const l2 = relais.relierUnMac({ code: c2.code, nom: 'MacBook Air' }, '10.0.0.1');
  assert.ok(l2.ok);
  const liste = await ordinateurs.ordinateursDuCompte('a3');
  assert.equal(liste.length, 2, 'deux Mac, deux programmes : le second ne remplace plus le premier');
  assert.equal(liste.find((o) => o.id === premier.id)?.nom, 'Mac mini de Haiko', 'le vrai nom remplace « Mac »');
  assert.ok(liste.every((o) => o.programme));
  assert.equal(relais.relaisDuCompte('a3', Date.now(), premier.id).etat, 'hors-ligne');
  /* Délier le programme d'UN ordinateur laisse l'autre. */
  assert.equal(relais.delierLeMac('a3', premier.id), true);
  assert.equal((await ordinateurs.ordinateursDuCompte('a3')).filter((o) => o.programme).length, 1);
});

test('« /ordinateur:<repère> » : une pastille d’un bloc, une consigne qui nomme l’ordinateur', () => {
  const commandes = shared.commandesDuMoteur('claude', []);
  const ecrit = 'Ouvre Mail /ordinateur:mac-mini stp';
  const reconnues = shared.commandesReconnues(ecrit, commandes);
  assert.deepEqual(
    reconnues.map((c) => c.nom),
    ['ordinateur:mac-mini'],
  );
  const efface = shared.effacementDeCommande(ecrit, 31, 31, 'arriere', reconnues);
  assert.equal(efface?.texte, 'Ouvre Mail stp', 'effacée d’un bloc');
  assert.equal(shared.argumentDeLaCommande(ecrit, 'ordinateur'), 'mac-mini');
  const consigne = shared.consigneDeLaCommandeDeBeluga(ecrit, [], { ordinateurs: [{ id: 'o1', nom: 'Mac mini', repere: 'mac-mini' }] });
  assert.match(consigne ?? '', /SUR L'ORDINATEUR « Mac mini »/);
  assert.match(consigne ?? '', /Ouvre Mail stp/);
  const inconnu = shared.consigneDeLaCommandeDeBeluga('/ordinateur:imac fais X', [], { ordinateurs: [{ id: 'o1', nom: 'Mac mini', repere: 'mac-mini' }] });
  assert.match(inconnu ?? '', /aucun de ses ordinateurs/);
  /* Elle se cumule avec une autre commande de Beluga. */
  const cumul = shared.consigneDeLaCommandeDeBeluga('/ordinateur:mac-mini /verifier la page', [], { ordinateurs: [{ id: 'o1', nom: 'Mac mini', repere: 'mac-mini' }] });
  assert.match(cumul ?? '', /combiné 2 commandes/);
  assert.ok(shared.COMMANDES_DE_BELUGA.find((c) => c.nom === 'ordinateur')?.argument);
});

test('un travail de Beluga Connect en cours déclenche la relecture de secours, rien en cours : aucune', () => {
  const { travailEnCoursSurUnOrdinateur, RELECTURE_DES_ORDINATEURS_MS } = shared;
  assert.equal(RELECTURE_DES_ORDINATEURS_MS, 5_000);
  assert.equal(travailEnCoursSurUnOrdinateur([]), false);
  assert.equal(travailEnCoursSurUnOrdinateur(null), false);
  assert.equal(travailEnCoursSurUnOrdinateur([{ programme: null }]), false);
  const safari = (etat: 'en-cours' | 'fait' | 'echec') => ({ etat, installee: true, activee: false, message: null, depuis: 1 });
  const chrome = (etat: 'en-cours' | 'fait' | 'echec') => ({ etat, ajoutee: null, message: null, depuis: 1 });
  assert.equal(travailEnCoursSurUnOrdinateur([{ programme: { safari: safari('en-cours') } as any }]), true);
  assert.equal(travailEnCoursSurUnOrdinateur([{ programme: { safari: safari('echec'), preparation: chrome('fait') } as any }]), false);
  assert.equal(travailEnCoursSurUnOrdinateur([{ programme: null }, { programme: { preparation: chrome('en-cours') } as any }]), true);
});
