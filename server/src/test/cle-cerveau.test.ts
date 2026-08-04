import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-cerveau-'));
const fichier = path.join(dossier, 'haikodev.env');
process.env.HAIKODEV_ENV_FILE = fichier;
delete process.env.CERVEAU_API_KEY;

const { enregistrerCleCerveau, lireCleCerveau } = await import('../cle-cerveau.js');

test('la clé posée vaut tout de suite et se relit depuis le fichier du service', () => {
  const pose = enregistrerCleCerveau('  sk-essai-1  ');
  assert.equal(pose.ok, true);
  assert.equal(pose.endroit, fichier);
  assert.equal(lireCleCerveau(), 'sk-essai-1');

  // Même sans la variable en mémoire, la clé survit au redémarrage.
  delete process.env.CERVEAU_API_KEY;
  assert.equal(lireCleCerveau(), 'sk-essai-1');
});

test("le reste du fichier d'environnement n'est pas touché", () => {
  fs.writeFileSync(fichier, 'AUTRE=valeur\nCERVEAU_API_KEY=vieille\nENCORE=1\n');
  delete process.env.CERVEAU_API_KEY;
  enregistrerCleCerveau('sk-essai-2');
  const lignes = fs.readFileSync(fichier, 'utf8').trim().split('\n');
  assert.deepEqual(lignes, ['AUTRE=valeur', 'CERVEAU_API_KEY=sk-essai-2', 'ENCORE=1']);
});

test('une clé vide est refusée et ne change rien', () => {
  delete process.env.CERVEAU_API_KEY;
  const pose = enregistrerCleCerveau('   ');
  assert.equal(pose.ok, false);
  assert.equal(lireCleCerveau(), 'sk-essai-2');
});
