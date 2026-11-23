import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { garderLesMorceauxPrecedents } from '../morceaux-precedents.js';

/*
 * LES MORCEAUX DE LA VERSION D'AVANT RESTENT SERVIS quelque temps (12/10/2026) :
 * une application restée ouverte les réclame encore après une mise en ligne.
 */
function dossier(): { anciens: string; nouveaux: string } {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'morceaux-'));
  const anciens = path.join(racine, 'anciens');
  const nouveaux = path.join(racine, 'nouveaux');
  fs.mkdirSync(anciens);
  fs.mkdirSync(nouveaux);
  return { anciens, nouveaux };
}
function ecrire(dir: string, nom: string, contenu: string, ageMs: number, maintenant: number): void {
  const fichier = path.join(dir, nom);
  fs.writeFileSync(fichier, contenu);
  const date = new Date(maintenant - ageMs);
  fs.utimesSync(fichier, date, date);
}

test('un ancien morceau absent de la version neuve est repris, avec sa date d’origine', () => {
  const { anciens, nouveaux } = dossier();
  const maintenant = Date.now();
  ecrire(anciens, 'coffre-fort-AAA.js', 'ancien', 3_600_000, maintenant);
  ecrire(anciens, 'index-OLD.js', 'ancien index', 3_600_000, maintenant);
  ecrire(nouveaux, 'index-NEW.js', 'nouveau', 0, maintenant);
  const repris = garderLesMorceauxPrecedents(anciens, nouveaux, maintenant);
  assert.equal(repris, 2);
  assert.equal(fs.readFileSync(path.join(nouveaux, 'coffre-fort-AAA.js'), 'utf8'), 'ancien');
  assert.ok(fs.existsSync(path.join(nouveaux, 'index-NEW.js')), 'le neuf reste');
  const date = fs.statSync(path.join(nouveaux, 'coffre-fort-AAA.js')).mtimeMs;
  assert.ok(Math.abs(date - (maintenant - 3_600_000)) < 2000, 'il garde sa date : il ne se rajeunit pas');
});

test('un morceau déjà présent n’est pas écrasé, et un trop vieux n’est pas repris', () => {
  const { anciens, nouveaux } = dossier();
  const maintenant = Date.now();
  ecrire(anciens, 'commun.js', 'ancien', 1000, maintenant);
  ecrire(nouveaux, 'commun.js', 'nouveau', 0, maintenant);
  ecrire(anciens, 'vieux.js', 'très vieux', 40 * 3_600_000, maintenant);
  assert.equal(garderLesMorceauxPrecedents(anciens, nouveaux, maintenant), 0);
  assert.equal(fs.readFileSync(path.join(nouveaux, 'commun.js'), 'utf8'), 'nouveau');
  assert.equal(fs.existsSync(path.join(nouveaux, 'vieux.js')), false);
});

test('le poids total est borné : les plus récents passent d’abord', () => {
  const { anciens, nouveaux } = dossier();
  const maintenant = Date.now();
  ecrire(anciens, 'recent.js', 'x'.repeat(60), 1000, maintenant);
  ecrire(anciens, 'plus-ancien.js', 'y'.repeat(60), 5000, maintenant);
  const repris = garderLesMorceauxPrecedents(anciens, nouveaux, maintenant, { poidsMax: 100 });
  assert.equal(repris, 1);
  assert.ok(fs.existsSync(path.join(nouveaux, 'recent.js')));
  assert.equal(fs.existsSync(path.join(nouveaux, 'plus-ancien.js')), false);
});

test('sans ancien dossier, rien ne se passe', () => {
  const { nouveaux } = dossier();
  assert.equal(garderLesMorceauxPrecedents('/chemin/qui/n/existe/pas', nouveaux), 0);
});
