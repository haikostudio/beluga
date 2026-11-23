/**
 * LIAISON CHROME AUTOMATIQUE ET SUIVIE (carte du 22/11/2026). Ce qui est verrouillé ici :
 *  - un code neuf n'annule plus celui que Beluga Connect a posé dans `liaison.json` (plusieurs codes vivants, par
 *    ordinateur et par usage), le code de secours est UN code partagé, et le plafond de codes vivants tient ;
 *  - un refus signalé par l'extension n'est retenu que pour un code encore connu ;
 *  - la question « ma clé vaut-elle encore ? » : réponse ferme seulement à une signature juste, et `valable: false`
 *    seulement pour une fiche révoquée — jamais sur une signature fausse (l'extension garde alors sa clé) ;
 *  - les règles pures du suivi : préparation figée = échec dit, code de secours à 30 s, étapes cochées.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-suivie-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const { getDb } = await import('../db.js');
const chrome = await import('../extension-chrome.js');
const { creerUnOrdinateur } = await import('../ordinateurs.js');

getDb().prepare("INSERT OR IGNORE INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le) VALUES ('c1', 'c1', 'admin', 'C', 's', 'h', 1, 0)").run();

test('un code affiché ou émis ailleurs n’annule plus le code posé par Beluga Connect', () => {
  const mini = creerUnOrdinateur('c1', 'Mac mini');
  const autre = creerUnOrdinateur('c1', 'MacBook');
  const fichier = chrome.emettreUnCodeDeLiaison('c1', Date.now(), { ordinateurId: mini.id, usage: 'fichier' });
  /* Fenêtre Safari, code de secours, préparation d'un autre ordinateur : le code du fichier vit encore. */
  chrome.emettreUnCodeDeLiaison('c1', Date.now(), { ordinateurId: mini.id });
  chrome.codeDeSecours('c1', mini.id);
  chrome.emettreUnCodeDeLiaison('c1', Date.now(), { ordinateurId: autre.id, usage: 'fichier' });
  const r = chrome.relierUnChrome({ code: fichier.code, nom: 'Chrome · macOS' }, 'ip-1');
  assert.ok(r.ok, JSON.stringify(r));
  const ligne = getDb().prepare('SELECT ordinateur_id FROM chrome_appareils WHERE nom = ?').get('Chrome · macOS') as { ordinateur_id: string };
  assert.equal(ligne.ordinateur_id, mini.id);
});

test('un code neuf du même ordinateur et du même usage remplace l’ancien, et le plafond tient', () => {
  const o = creerUnOrdinateur('c1', 'Poste');
  const a = chrome.emettreUnCodeDeLiaison('c1', Date.now(), { ordinateurId: o.id, usage: 'fichier' });
  const b = chrome.emettreUnCodeDeLiaison('c1', Date.now(), { ordinateurId: o.id, usage: 'fichier' });
  assert.equal(chrome.relierUnChrome({ code: a.code }, 'ip-2').ok, a.code === b.code);
  for (let i = 0; i < 12; i++) chrome.emettreUnCodeDeLiaison('c1', Date.now(), { ordinateurId: creerUnOrdinateur('c1', `P${i}`).id });
  const n = (getDb().prepare("SELECT COUNT(*) AS n FROM chrome_codes WHERE compte_id = 'c1'").get() as { n: number }).n;
  assert.ok(n <= 6, `codes vivants : ${n}`);
});

test('le code de secours est le même pour tous les écrans, puis renouvelé près de l’échéance', () => {
  const o = creerUnOrdinateur('c1', 'Secours');
  const t0 = Date.now();
  const a = chrome.codeDeSecours('c1', o.id, t0);
  assert.equal(chrome.codeDeSecours('c1', o.id, t0 + 1_000).code, a.code);
  const b = chrome.codeDeSecours('c1', o.id, a.expireLe - 60_000);
  assert.notEqual(b.expireLe, a.expireLe);
});

test('un refus de liaison n’est retenu que pour un code encore connu', () => {
  const o = creerUnOrdinateur('c1', 'Refus');
  const { code } = chrome.emettreUnCodeDeLiaison('c1', Date.now(), { ordinateurId: o.id, usage: 'fichier' });
  const avant = Date.now() - 1;
  assert.equal(chrome.signalerUnEchecDeLiaison({ code: '99999x', raison: 'x' }, 'ip-3'), false);
  assert.equal(chrome.signalerUnEchecDeLiaison({ code, raison: 'Code inconnu ou expiré' }, 'ip-3'), true);
  assert.match(chrome.echecDeLiaisonSignale(o.id, avant)?.raison ?? '', /expiré/);
  assert.equal(chrome.echecDeLiaisonSignale(o.id, Date.now() + 1_000), null);
});

test('« ma clé vaut-elle encore ? » : non seulement pour une fiche révoquée, jamais sur une signature fausse', () => {
  const o = creerUnOrdinateur('c1', 'Sonde');
  const { code } = chrome.emettreUnCodeDeLiaison('c1', Date.now(), { ordinateurId: o.id });
  const r = chrome.relierUnChrome({ code, nom: 'Sonde' }, 'ip-4');
  assert.ok(r.ok);
  if (!r.ok) return;
  const ts = Math.floor(Date.now() / 1000);
  const sig = (t: number) => chrome.signer(r.secret, shared.messageASigner(t, r.identifiant, 'sonde'));
  assert.deepEqual(chrome.laCleVautEncore({ id: r.identifiant, ts, sig: sig(ts) }), { valable: true });
  /* La signature de la voie (corps vide) ne vaut pas pour la sonde, ni une signature fausse : aucune réponse ferme. */
  assert.equal(chrome.laCleVautEncore({ id: r.identifiant, ts, sig: chrome.signer(r.secret, shared.messageASigner(ts, r.identifiant, '')) }), null);
  assert.equal(chrome.laCleVautEncore({ id: r.identifiant, ts, sig: 'faux' }), null);
  /* La sonde ne consomme pas l'horodatage de la voie : la voie s'ouvre encore au même instant. */
  assert.ok(chrome.verifierLaVoie({ id: r.identifiant, ts: String(ts), sig: chrome.signer(r.secret, shared.messageASigner(ts, r.identifiant, '')) }));
  chrome.delierUnChrome('c1', shared.lireIdentifiantDAppareil(r.identifiant)!.id);
  assert.deepEqual(chrome.laCleVautEncore({ id: r.identifiant, ts: ts + 1, sig: sig(ts + 1) }), { valable: false });
});

test('le suivi : préparation figée = échec dit, code de secours à 30 s, étapes cochées', () => {
  const t0 = 1_000_000;
  const p = { etat: 'en-cours' as const, ajoutee: true, message: null, depuis: t0, debutLiaison: t0, majLe: t0, travail: 'installation' as const };
  assert.equal(shared.codeDeSecoursAMontrer(p, false, t0 + 29_000), false);
  assert.equal(shared.codeDeSecoursAMontrer(p, false, t0 + 30_000), true);
  assert.equal(shared.codeDeSecoursAMontrer(p, true, t0 + 60_000), false);
  assert.equal(shared.codeDeSecoursAMontrer({ ...p, debutLiaison: null }, false, t0 + 60_000), false);
  assert.equal(shared.preparationVue(p, t0 + shared.PREPARATION_FIGEE_APRES_MS + 1)?.etat, 'echec');
  assert.equal(shared.preparationVue(p, t0 + 1_000)?.etat, 'en-cours');
  assert.deepEqual(
    shared.etapesDeLaPreparation(p, null, true, t0 + 1_000).map((e) => e.etat),
    ['fait', 'fait', 'en-cours', 'a-venir', 'a-venir'],
  );
  /* Les cinq lignes du Mac, dans le même ordre partout (page, fenêtre et volet de Beluga Connect). */
  assert.deepEqual(
    shared.etapesDeLaPreparation(p, null, true, t0 + 1_000).map((e) => e.cle),
    ['developpeur', 'ajoutee', 'reliee', 'prive', 'rouvert'],
  );
  /* Mode développeur posé, extension pas encore là : la ligne « ajoutée » est la ligne en cours. */
  assert.deepEqual(
    shared.etapesDeLaPreparation({ ...p, ajoutee: null, developpeur: true }, null, true, t0 + 1_000).map((e) => e.etat),
    ['fait', 'en-cours', 'a-venir', 'a-venir', 'a-venir'],
  );
  assert.deepEqual(
    shared.etapesDeLaPreparation({ ...p, etat: 'echec' }, { enLigne: true, incognito: false }, true).map((e) => e.etat),
    ['fait', 'fait', 'fait', 'echec', 'fait'],
  );
  assert.deepEqual(shared.etapesDeLaPreparation(null, { enLigne: true }, false).map((e) => e.etat), ['fait', 'fait']);
});
