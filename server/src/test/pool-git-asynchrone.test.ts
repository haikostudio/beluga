/**
 * LE POOL NE FIGE PLUS LE DÉMON : ses enregistrements git sont asynchrones et
 * sérialisés (jamais deux commits en même temps, donc jamais d'`index.lock`),
 * et la relecture des dates se fait en arrière-plan.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { enregistrerLePool, preparerLeDepotDuPool, rafraichirLesDatesDuPool } from '../competences.js';

const lire = (racine: string, args: string[]) =>
  execFileSync('git', args, { cwd: racine, encoding: 'utf8' }).trim();

test('deux enregistrements rapprochés : deux commits, pas de verrou, la boucle garde la main', async () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-git-'));
  try {
    assert.equal((await preparerLeDepotDuPool(racine)).ok, true);
    fs.mkdirSync(path.join(racine, 'a'));
    fs.writeFileSync(path.join(racine, 'a', 'SKILL.md'), 'un');

    let laBoucleATourne = false;
    setImmediate(() => {
      laBoucleATourne = true;
    });

    const premier = enregistrerLePool(racine, 'premier');
    fs.mkdirSync(path.join(racine, 'b'));
    fs.writeFileSync(path.join(racine, 'b', 'SKILL.md'), 'deux');
    const second = enregistrerLePool(racine, 'second');

    // Rien n'a encore été attendu : la boucle a pu tourner avant la fin de git.
    await new Promise((r) => setImmediate(r));
    assert.equal(laBoucleATourne, true);

    await Promise.all([premier, second]);
    // Le premier `add -A` peut déjà voir le second fichier : un ou deux commits,
    // mais jamais un enregistrement perdu ni un verrou resté.
    const messages = lire(racine, ['log', '--format=%s']).split('\n');
    assert.equal(messages[messages.length - 1], 'premier');
    assert.ok(messages.length >= 1 && messages.length <= 2);
    assert.equal(lire(racine, ['ls-files']).split('\n').length, 2);
    assert.equal(lire(racine, ['status', '--porcelain']), '');
    assert.equal(fs.existsSync(path.join(racine, '.git', 'index.lock')), false);

    // Rien à enregistrer : pas de commit de plus.
    await enregistrerLePool(racine, 'vide');
    assert.equal(lire(racine, ['rev-list', '--count', 'HEAD']), String(messages.length));

    // Écriture entre deux enregistrements en file : chacune a son commit.
    fs.writeFileSync(path.join(racine, 'a', 'SKILL.md'), 'trois');
    const troisieme = enregistrerLePool(racine, 'troisième');
    fs.writeFileSync(path.join(racine, 'b', 'SKILL.md'), 'quatre');
    await troisieme;
    await enregistrerLePool(racine, 'quatrième');
    assert.equal(lire(racine, ['status', '--porcelain']), '');
    assert.equal(fs.existsSync(path.join(racine, '.git', 'index.lock')), false);

    // Relecture des dates : une seule en vol à la fois, et elle se termine.
    const a = rafraichirLesDatesDuPool(racine);
    const b = rafraichirLesDatesDuPool(racine);
    assert.equal(a, b);
    await a;
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});
