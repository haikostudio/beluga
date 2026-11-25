/**
 * L'ICÔNE D'UN GROS DÉPÔT SE TROUVE QUAND MÊME.
 *
 * Constat du 25/11/2026 : le projet Beluga gardait son ancienne icône. Le parcours
 * de tout le dépôt s'arrêtait après 4000 entrées, épuisées dans `data/` (rangé
 * avant `web/`) : `web/public/icon-192.png` n'était jamais vu. Le serveur ne lit
 * plus que les dossiers où un site range ses icônes : ces essais posent un dépôt
 * factice de plus de 4000 images et vérifient que l'icône est bien retrouvée.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Bac à sable : importer le module ne doit jamais toucher les données réelles.
process.env.BELUGA_DATA ??= fs.mkdtempSync(path.join(os.tmpdir(), 'icone-gros-depot-data-'));
const { fichiersCandidatsDuDepot, iconeDuDepot } = await import('../favicon.js');

function grosDepot(): string {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'icone-gros-depot-'));
  // 50 dossiers × 100 images dans data/, rangés avant web/ dans l'ordre alphabétique.
  for (let d = 0; d < 50; d += 1) {
    const dossier = path.join(racine, 'data', `lot-${d}`);
    fs.mkdirSync(dossier, { recursive: true });
    for (let f = 0; f < 100; f += 1) fs.writeFileSync(path.join(dossier, `favicon-${f}.png`), 'x');
  }
  fs.mkdirSync(path.join(racine, 'web', 'public'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'web', 'public', 'icon-192.png'), 'png-192');
  return racine;
}

test('un dépôt de plus de 4000 images dans data/ rend quand même web/public/icon-192.png', () => {
  const racine = grosDepot();
  try {
    const candidats = fichiersCandidatsDuDepot(racine);
    assert.ok(candidats.includes('web/public/icon-192.png'));
    assert.ok(!candidats.some((c) => c.startsWith('data/')), 'data/ n’est jamais lu');
    const icone = iconeDuDepot({ path: racine });
    assert.equal(icone?.source, 'web/public/icon-192.png');
    assert.equal(icone?.data.toString(), 'png-192');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('la règle de choix reste celle de shared : favicon.svg à la racine de public passe devant', () => {
  const racine = grosDepot();
  try {
    fs.writeFileSync(path.join(racine, 'web', 'public', 'favicon.svg'), '<svg/>');
    assert.equal(iconeDuDepot({ path: racine })?.source, 'web/public/favicon.svg');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('un dossier écrit avec des majuscules compte, les fichiers cachés et les dossiers absents non', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'icone-casse-'));
  try {
    fs.mkdirSync(path.join(racine, 'Public'));
    fs.writeFileSync(path.join(racine, 'Public', 'favicon.ico'), 'ico');
    fs.writeFileSync(path.join(racine, 'Public', '.favicon.png'), 'cache');
    const candidats = fichiersCandidatsDuDepot(racine);
    assert.deepEqual(candidats, ['Public/favicon.ico']);
    assert.equal(iconeDuDepot({ path: racine })?.source, 'Public/favicon.ico');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('un dépôt sans icône ou absent rend null, sans erreur', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'icone-vide-'));
  try {
    assert.equal(iconeDuDepot({ path: racine }), null);
    assert.equal(iconeDuDepot({ path: path.join(racine, 'nulle-part') }), null);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});
