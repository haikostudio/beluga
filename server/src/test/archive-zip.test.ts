import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NOM_MANIFESTE } from '@beluga/shared';
import { ecrireArchive, extraireArchive, lireArchive } from '../archive-zip.js';

/*
 * L'ARCHIVE D'UN BACKUP, SUR UN VRAI DISQUE : ce qui entre ressort à
 * l'identique (contenu, droits, dossiers vides, liens), et rien ne sort du
 * dossier d'extraction.
 */

function dossierDeTravail(): string {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-zip-'));
  fs.mkdirSync(path.join(racine, 'code', 'vide'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'code', 'index.js'), 'console.log("site")');
  fs.symlinkSync('index.js', path.join(racine, 'code', 'lien.js'));
  fs.mkdirSync(path.join(racine, 'base'));
  fs.writeFileSync(path.join(racine, 'base', 'base.sql'), 'CREATE TABLE t (x);'.repeat(50), { mode: 0o600 });
  fs.chmodSync(path.join(racine, 'base', 'base.sql'), 0o600);
  return racine;
}

test('une archive écrite se relit : entrées, poids décompressés et manifeste', async () => {
  const travail = dossierDeTravail();
  const archive = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'archive-dest-')), 'point.zip');
  const taille = await ecrireArchive(travail, archive, { version: 1, siteId: 's' });
  assert.ok(taille > 0);
  assert.ok(!fs.existsSync(`${archive}.partiel`), 'le nom provisoire ne reste pas');

  const lue = await lireArchive(archive);
  assert.ok(lue);
  const noms = lue!.entrees.map((e) => e.nom);
  assert.ok(noms.includes(NOM_MANIFESTE));
  assert.ok(noms.includes('code/index.js') && noms.includes('base/base.sql') && noms.includes('code/vide/'));
  assert.equal(lue!.entrees.find((e) => e.nom === 'base/base.sql')?.octets, 'CREATE TABLE t (x);'.length * 50);
  assert.deepEqual(lue!.manifeste, { version: 1, siteId: 's' });
});

test('l’extraction repose le contenu, les droits, les dossiers vides et les liens', async () => {
  const travail = dossierDeTravail();
  const archive = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'archive-dest-')), 'point.zip');
  await ecrireArchive(travail, archive, {});
  const cible = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-extrait-'));
  await extraireArchive(archive, cible);

  assert.equal(fs.readFileSync(path.join(cible, 'code', 'index.js'), 'utf8'), 'console.log("site")');
  assert.equal(fs.statSync(path.join(cible, 'base', 'base.sql')).mode & 0o777, 0o600);
  assert.ok(fs.statSync(path.join(cible, 'code', 'vide')).isDirectory());
  assert.equal(fs.readlinkSync(path.join(cible, 'code', 'lien.js')), 'index.js');
});

test('une archive abîmée ne se relit pas, et le dit par « null »', async () => {
  const faux = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'archive-faux-')), 'point.zip');
  fs.writeFileSync(faux, 'ceci n’est pas un zip');
  assert.equal(await lireArchive(faux), null);
  assert.equal(await lireArchive(path.join(os.tmpdir(), 'absent-de-partout.zip')), null);
});

test('une entrée qui remonte hors du dossier fait tomber l’extraction', async () => {
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-evasion-'));
  fs.mkdirSync(path.join(travail, 'xx'));
  fs.writeFileSync(path.join(travail, 'xx', 'evil'), 'dehors');
  const archive = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'archive-dest-')), 'point.zip');
  await ecrireArchive(travail, archive, {});
  // Même longueur de nom : « xx/evil » devient « ../evil » ailleurs dans l'octet près.
  const brut = fs.readFileSync(archive);
  fs.writeFileSync(archive, Buffer.from(brut.toString('latin1').split('xx/evil').join('../evil'), 'latin1'));

  const cible = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-extrait-'));
  await assert.rejects(() => extraireArchive(archive, path.join(cible, 'dedans')));
  assert.ok(!fs.existsSync(path.join(cible, 'evil')), 'rien n’a été écrit à côté du dossier');
});
