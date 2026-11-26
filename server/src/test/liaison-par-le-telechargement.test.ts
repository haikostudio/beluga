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
 * DEPUIS LE 26/11/2026 (« toujours un code à taper dans Beluga Connect ») : ce code ne relie plus — il reconnaît le
 * parcours quand Beluga Connect se lance ; le lien se fait par le code affiché dans les réglages.
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

test('le code du téléchargement ne relie plus rien : seul le code à taper relie (26/11/2026)', async () => {
  const { code } = relais.emettreUnCodeDuRelais('compte-lier', Date.now(), null);
  const r = relais.relierUnMac({ code, nom: 'MacBook Air' }, '10.0.0.21');
  assert.equal(r.ok, false, 'le code du fichier reconnaît le parcours, il ne relie pas');
  assert.equal((await ordinateurs.ordinateursDuCompte('compte-lier')).length, 0);
});

test('Beluga Connect Mac relit le code du téléchargement pour s’annoncer, puis demande le code à taper', () => {
  const swift = fs.readFileSync(path.join(racine, 'connect/Sources/main.swift'), 'utf8');
  assert.match(swift, /func origineDuTelechargement\(\) -> \(base: String, code: String\?\)\?/);
  assert.match(swift, /\$0\.name == "code"/);
  /* Au démarrage sans clé : il s'annonce avec le code de son téléchargement, puis ouvre le champ du code à taper. */
  const demarrer = swift.slice(swift.indexOf('func demarrer()'), swift.indexOf('func applicationWillTerminate'));
  assert.ok(demarrer.indexOf('prendreLeCodeDuTelechargement()') > 0);
  assert.match(swift, /\/api\/relais-mac\/annonce/);
  assert.match(swift, /func demanderLeCode\(/);
  assert.doesNotMatch(demarrer, /silencieux: true/, 'plus aucune liaison silencieuse par le code du fichier');
});

test('« La rouvrir sur le Mac » : le relais sait rouvrir la fenêtre « Activer » sans redemander d’accord', () => {
  const js = fs.readFileSync(path.join(racine, 'scripts/relais-mac/relais.js'), 'utf8');
  assert.match(js, /aide: 'beluga-connect:\/\/autorisations'/);
  assert.match(js, /if \(quoi !== 'aide'\) demanderLesAutorisations\(quoi\);/);
});
