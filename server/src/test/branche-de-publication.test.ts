import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRANCHE_DEV_PAR_DEFAUT,
  brancheDePublication,
  brancheReglee,
  mentionBrancheParDefaut,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Rien de réglé : le comportement d'avant, au signe près              */
/* ------------------------------------------------------------------ */

test('sans réglage et sans branche « dev », on reste sur la principale', () => {
  const retenue = brancheDePublication({
    cible: 'dev',
    principale: 'main',
    branchesConnues: ['main', 'tache/quelque-chose'],
  });
  assert.equal(retenue.branche, 'main');
  assert.equal(retenue.origine, 'principale');
});

test('un dépôt en « master » n’est pas ramené de force à « main »', () => {
  const retenue = brancheDePublication({ cible: 'dev', principale: 'master', branchesConnues: ['master'] });
  assert.equal(retenue.branche, 'master');
});

test('sans réglage, la MISE EN PRODUCTION reste sur la principale même si « dev » existe', () => {
  const retenue = brancheDePublication({
    cible: 'production',
    principale: 'main',
    branchesConnues: ['main', 'dev'],
  });
  assert.equal(retenue.branche, 'main');
  assert.equal(retenue.origine, 'principale');
});

/* ------------------------------------------------------------------ */
/* La valeur par défaut demandée : « dev », quand elle existe          */
/* ------------------------------------------------------------------ */

test('sans réglage, le déploiement part sur « dev » quand le dépôt en a une', () => {
  const retenue = brancheDePublication({
    cible: 'dev',
    principale: 'main',
    branchesConnues: ['main', 'dev'],
  });
  assert.equal(retenue.branche, BRANCHE_DEV_PAR_DEFAUT);
  assert.equal(retenue.origine, 'defaut-dev');
});

test('la liste des branches inconnue ne fabrique jamais une branche « dev »', () => {
  const retenue = brancheDePublication({ cible: 'dev', principale: 'main' });
  assert.equal(retenue.branche, 'main');
});

/* ------------------------------------------------------------------ */
/* Une branche réglée l'emporte, séparément pour chaque étape          */
/* ------------------------------------------------------------------ */

test('chaque étape suit SA branche réglée', () => {
  const reglees = { dev: 'integration', production: 'release' };
  assert.equal(brancheDePublication({ cible: 'dev', reglees, principale: 'main' }).branche, 'integration');
  assert.equal(
    brancheDePublication({ cible: 'production', reglees, principale: 'main' }).branche,
    'release',
  );
});

test('une seule des deux réglée laisse l’autre à son défaut', () => {
  const reglees = { production: 'release' };
  const dev = brancheDePublication({ cible: 'dev', reglees, principale: 'main', branchesConnues: ['main', 'dev'] });
  assert.equal(dev.branche, 'dev');
  assert.equal(brancheDePublication({ cible: 'production', reglees, principale: 'main' }).branche, 'release');
});

test('une branche réglée l’emporte même absente du dépôt : rien ne repart en silence ailleurs', () => {
  const retenue = brancheDePublication({
    cible: 'dev',
    reglees: { dev: 'livraison' },
    principale: 'main',
    branchesConnues: ['main', 'dev'],
  });
  assert.equal(retenue.branche, 'livraison');
  assert.equal(retenue.origine, 'reglee');
});

test('un réglage fait d’espaces n’est pas un réglage', () => {
  assert.equal(brancheReglee({ dev: '   ' }, 'dev'), undefined);
  assert.equal(
    brancheDePublication({ cible: 'dev', reglees: { dev: '  ' }, principale: 'main' }).branche,
    'main',
  );
});

/* ------------------------------------------------------------------ */
/* Ce que l'écran de réglages annonce                                  */
/* ------------------------------------------------------------------ */

test('la mention dit « dev » quand le dépôt en a une, la principale sinon', () => {
  assert.match(mentionBrancheParDefaut('dev', ['main', 'dev']), /dev/);
  assert.match(mentionBrancheParDefaut('dev', ['main']), /principale/);
  assert.match(mentionBrancheParDefaut('production', ['main', 'dev']), /principale/);
});

test('chaque cas porte une raison en français, jamais un code nu', () => {
  for (const retenue of [
    brancheDePublication({ cible: 'dev', reglees: { dev: 'x' }, principale: 'main' }),
    brancheDePublication({ cible: 'dev', principale: 'main', branchesConnues: ['dev'] }),
    brancheDePublication({ cible: 'production', principale: 'main' }),
  ]) {
    assert.match(retenue.raison, /Branche /);
    assert.ok(retenue.raison.endsWith('.'));
  }
});
