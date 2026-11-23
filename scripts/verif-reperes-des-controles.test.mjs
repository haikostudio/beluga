import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { relevePresents, reperesVises, reperesAbsents, comparer } from './verif-reperes-des-controles.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'verif-reperes-des-controles.mjs');

test('le dépôt courant ne porte aucune nouvelle dérive de repère', () => {
  const debut = Date.now();
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(Date.now() - debut < 2000, 'le contrôle doit tenir sous 2 s pour rester dans npm test');
});

test('un faux repère ajouté à un script est une nouvelle dérive', () => {
  const presents = relevePresents(['<div data-vrai="1"></div>']);
  const scripts = { 'verif-x.mjs': "page.locator('[data-vrai]'); page.locator('[data-faux-repere]')" };
  const absents = reperesAbsents(scripts, presents);
  assert.deepEqual(absents, { 'verif-x.mjs': ['data-faux-repere'] });
  assert.equal(comparer(absents, {}).nouveaux.length, 1);
  assert.equal(comparer(absents, { 'verif-x.mjs': { reperes: ['data-faux-repere'] } }).nouveaux.length, 0);
});

test('une exception dont le repère est revenu est signalée périmée', () => {
  const { perimes } = comparer({}, { 'verif-y.mjs': { reperes: ['data-revenu'] } });
  assert.deepEqual(perimes, [{ nom: 'verif-y.mjs', reperes: ['data-revenu'] }]);
});

test('repères fabriqués, de bibliothèque ou posés par le script ne sont pas des absences', () => {
  const presents = relevePresents(['el.dataset.maCle = 1; const a = `data-rang-${i}`;']);
  const scripts = {
    'verif-z.mjs': "'[data-ma-cle]' '[data-rang-3]' '[data-radix-popper]' '[data-state=open]' '[data-prefixe-]' '<i data-t=\"a\">' '[data-t]'",
  };
  assert.deepEqual(reperesAbsents(scripts, presents), {});
  assert.deepEqual([...reperesVises("'[data-prefixe-]'")], []);
});
