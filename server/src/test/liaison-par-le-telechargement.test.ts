import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LIAISON D'ORDINATEUR SIMPLIFIÉE (carte du 22/11/2026) : le clic « Lier » émet un code à six chiffres qui voyage avec
 * le téléchargement (remorque sous Windows / Linux, ADRESSE de l'image disque sur Mac, relue par Beluga Connect dans la
 * quarantaine). Le clic vaut l'accord : le code relie seul, une seule fois, pendant dix minutes, au compte qui a
 * cliqué — sans ouvrir de page. Depuis le 22/11/2026 : vingt-quatre heures, rangé haché, six vivants par compte. Le Mac reçoit l'image « glisser dans Applications » ; le zip reste pour la mise à jour.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-liaison-telechargement-'));
process.env.BELUGA_DATA = bacASable;

const { getDb } = await import('../db.js');
const relais = await import('../relais-mac.js');
const ordinateurs = await import('../ordinateurs.js');
getDb();

const racine = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');

test('l’image disque a sa route, le zip garde la sienne (mise à jour de Beluga Connect)', () => {
  assert.equal(relais.paquetDeLaRoute('/api/connect/Beluga-Connect.dmg'), 'mac-dmg');
  assert.equal(relais.paquetDeLaRoute('/api/connect/Beluga-Connect.zip'), 'mac');
});

test('le code du clic « Lier » relie seul au compte qui a cliqué, une seule fois', async () => {
  const { code } = relais.emettreUnCodeDuRelais('compte-lier', Date.now(), null);
  const r = relais.relierUnMac({ code, nom: 'MacBook Air' }, '10.0.0.21');
  assert.ok(r.ok, 'le clic vaut l’accord : aucune question dans la page');
  const liste = await ordinateurs.ordinateursDuCompte('compte-lier');
  assert.equal(liste.length, 1);
  assert.equal(liste[0]!.nom, 'MacBook Air');
  const encore = relais.relierUnMac({ code, nom: 'Autre Mac' }, '10.0.0.22');
  assert.equal(encore.ok, false, 'usage unique');
  assert.equal((await ordinateurs.ordinateursDuCompte('compte-lier')).length, 1);
});

test('un code de plus de vingt-quatre heures est refusé (Beluga Connect retombe sur « Relier ce Mac ? » poussé à l’onglet)', () => {
  const emis = Date.now() - 25 * 60 * 60_000;
  const { code } = relais.emettreUnCodeDuRelais('compte-tard', emis, null);
  const r = relais.relierUnMac({ code, nom: 'Mac' }, '10.0.0.23');
  assert.equal(r.ok, false);
});

test('Beluga Connect Mac relit le code dans l’adresse du téléchargement et se relie sans ouvrir de page', () => {
  const swift = fs.readFileSync(path.join(racine, 'connect/Sources/main.swift'), 'utf8');
  assert.match(swift, /func origineDuTelechargement\(\) -> \(base: String, code: String\?\)\?/);
  assert.match(swift, /\$0\.name == "code"/);
  /* Au démarrage sans clé : d'abord le code du téléchargement, puis seulement « Relier ce Mac ? ». */
  const demarrer = swift.slice(swift.indexOf('func demarrer()'), swift.indexOf('func applicationWillTerminate'));
  assert.ok(demarrer.indexOf('prendreLeCodeDuTelechargement()') > 0);
  assert.ok(demarrer.indexOf('prendreLeCodeDuTelechargement()') < demarrer.lastIndexOf('self.relierABeluga()'));
  assert.match(demarrer, /silencieux: true/);
});

test('« La rouvrir sur le Mac » : le relais sait rouvrir la fenêtre « Activer » sans redemander d’accord', () => {
  const js = fs.readFileSync(path.join(racine, 'scripts/relais-mac/relais.js'), 'utf8');
  assert.match(js, /aide: 'beluga-connect:\/\/autorisations'/);
  assert.match(js, /if \(quoi !== 'aide'\) demanderLesAutorisations\(quoi\);/);
});
