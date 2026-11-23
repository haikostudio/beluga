import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/* UNE SOURCE RETIRÉE EMPORTE SON FICHIER COMPILÉ                      */
/*                                                                     */
/* `tsc` n'efface rien : le jour où un test est retiré exprès, son     */
/* `.js` déjà compilé reste dans `dist/` — et `npm test`, qui balaie   */
/* `server/dist/test/*.test.js`, continue de le jouer. Il appelle une  */
/* fonction qui n'existe plus, il tombe, et il fait tomber la          */
/* publication entière alors que le dépôt, lui, est juste.             */
/*                                                                     */
/* `dist/` étant hors dépôt, ce fantôme ne se voit sur aucune machine  */
/* neuve : il ne hante que le dossier qui a construit l'ancienne       */
/* version. Le seul remède sûr est d'émonder AVANT chaque             */
/* construction, ce que fait `scripts/emonder-dist.mjs`.               */
/* ------------------------------------------------------------------ */

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { emonder, orphelins } = await import(
  path.join(RACINE, 'scripts/emonder-dist.mjs')
) as {
  emonder: (espace: string) => string[];
  orphelins: (dist: string, src: string) => string[];
};

/** Un faux espace de travail, avec ses sources et son dist déjà écrit. */
function espaceFactice(sources: string[], compiles: string[]) {
  const espace = fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-emondage-'));
  /* Un espace de travail a TOUJOURS ses deux dossiers, même vides : sans
     `src/`, l'émondage se retient exprès plutôt que de vider un `dist/`. */
  for (const dossier of ['src', 'dist']) fs.mkdirSync(path.join(espace, dossier), { recursive: true });
  for (const [dossier, fichiers] of [['src', sources], ['dist', compiles]] as const) {
    for (const relatif of fichiers) {
      const chemin = path.join(espace, dossier, relatif);
      fs.mkdirSync(path.dirname(chemin), { recursive: true });
      fs.writeFileSync(chemin, '/* factice */\n');
    }
  }
  return espace;
}

test('un test compilé dont la source a disparu est retiré de dist', () => {
  const espace = espaceFactice(
    ['test/vivant.test.ts'],
    ['test/vivant.test.js', 'test/fantome.test.js'],
  );
  const retires = emonder(espace);
  assert.deepEqual(retires, ['test/fantome.test.js']);
  assert.ok(fs.existsSync(path.join(espace, 'dist/test/vivant.test.js')), 'le vivant reste');
  assert.ok(!fs.existsSync(path.join(espace, 'dist/test/fantome.test.js')), 'le fantôme part');
  fs.rmSync(espace, { recursive: true, force: true });
});

test('le compilé, sa déclaration et ses cartes partent ensemble', () => {
  const espace = espaceFactice(
    [],
    ['perdu.js', 'perdu.d.ts', 'perdu.js.map', 'perdu.d.ts.map'],
  );
  assert.deepEqual(emonder(espace), [
    'perdu.d.ts',
    'perdu.d.ts.map',
    'perdu.js',
    'perdu.js.map',
  ]);
  fs.rmSync(espace, { recursive: true, force: true });
});

test('une source en .tsx ou un .json copié gardent leur sortie', () => {
  const espace = espaceFactice(
    ['vue.tsx', 'reglages.json'],
    ['vue.js', 'reglages.json'],
  );
  assert.deepEqual(emonder(espace), []);
  fs.rmSync(espace, { recursive: true, force: true });
});

test('ce que tsc n’a pas produit n’est jamais touché', () => {
  const espace = espaceFactice([], ['.tsbuildinfo', 'note.txt']);
  assert.deepEqual(emonder(espace), []);
  assert.ok(fs.existsSync(path.join(espace, 'dist/.tsbuildinfo')));
  fs.rmSync(espace, { recursive: true, force: true });
});

test('un dossier vidé de tous ses fantômes disparaît aussi', () => {
  const espace = espaceFactice([], ['vieux/module.js']);
  emonder(espace);
  assert.ok(!fs.existsSync(path.join(espace, 'dist/vieux')), 'plus de dossier vide');
  fs.rmSync(espace, { recursive: true, force: true });
});

test('sans dossier src, l’émondage se retient au lieu de vider dist', () => {
  /* Un espace à moitié installé ne doit pas voir tout son dist balayé. */
  const espace = fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-emondage-'));
  fs.mkdirSync(path.join(espace, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(espace, 'dist/main.js'), '/* factice */\n');
  assert.deepEqual(emonder(espace), []);
  assert.ok(fs.existsSync(path.join(espace, 'dist/main.js')), 'rien n’a été retiré');
  fs.rmSync(espace, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* Et le vrai dépôt : après construction, plus AUCUN fantôme.          */
/* ------------------------------------------------------------------ */

test('les dist du dépôt ne portent plus aucun fichier sans source', () => {
  for (const espace of ['shared', 'server']) {
    assert.deepEqual(
      orphelins(path.join(RACINE, espace, 'dist'), path.join(RACINE, espace, 'src')),
      [],
      `${espace}/dist porte encore un compilé sans source : la construction n’émonde pas`,
    );
  }
});

test('chaque construction émonde avant d’appeler tsc', () => {
  for (const espace of ['shared', 'server']) {
    const manifeste = JSON.parse(
      fs.readFileSync(path.join(RACINE, espace, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    const build = manifeste.scripts?.build ?? '';
    assert.ok(
      build.includes('emonder-dist.mjs') && build.indexOf('emonder-dist.mjs') < build.indexOf('tsc'),
      `la construction de ${espace} doit émonder AVANT tsc (trouvé : « ${build} »)`,
    );
  }
});
