import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRANCHE_DEV_PAR_DEFAUT,
  BRANCHE_PRODUCTION_PAR_DEFAUT,
  brancheDePublication,
  brancheImposee,
  brancheReglee,
  ecartAuSchema,
  mentionBrancheParDefaut,
  mentionEcartAuSchema,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* LA RÈGLE D'OR : deux branches fixes, sur tous les projets           */
/* ------------------------------------------------------------------ */

test('sans réglage, le déploiement va sur « dev » et la production sur « main »', () => {
  const dev = brancheDePublication({ cible: 'dev', principale: 'main' });
  assert.equal(dev.branche, BRANCHE_DEV_PAR_DEFAUT);
  assert.equal(dev.origine, 'imposee');
  assert.equal(dev.ecart, false);

  const prod = brancheDePublication({ cible: 'production', principale: 'main' });
  assert.equal(prod.branche, BRANCHE_PRODUCTION_PAR_DEFAUT);
  assert.equal(prod.origine, 'imposee');
});

test('un dépôt en « master » n’échappe pas au schéma : « dev » et « main » quand même', () => {
  assert.equal(
    brancheDePublication({ cible: 'dev', principale: 'master', branchesConnues: ['master'] }).branche,
    'dev',
  );
  assert.equal(
    brancheDePublication({ cible: 'production', principale: 'master', branchesConnues: ['master'] })
      .branche,
    'main',
  );
});

test('un dépôt qui n’a pas encore la branche imposée le DIT, il ne repart pas ailleurs', () => {
  const retenue = brancheDePublication({
    cible: 'dev',
    principale: 'main',
    branchesConnues: ['main', 'tache/quelque-chose'],
  });
  assert.equal(retenue.branche, 'dev');
  assert.match(retenue.raison, /sera créée/);
});

test('la branche imposée se lit d’un seul endroit', () => {
  assert.equal(brancheImposee('dev'), 'dev');
  assert.equal(brancheImposee('production'), 'main');
});

/* ------------------------------------------------------------------ */
/* Une branche réglée l'emporte encore, mais c'est un ÉCART            */
/* ------------------------------------------------------------------ */

test('chaque étape suit SA branche réglée', () => {
  const reglees = { dev: 'integration', production: 'release' };
  assert.equal(brancheDePublication({ cible: 'dev', reglees, principale: 'main' }).branche, 'integration');
  assert.equal(
    brancheDePublication({ cible: 'production', reglees, principale: 'main' }).branche,
    'release',
  );
});

test('une branche réglée hors du schéma est signalée comme un écart', () => {
  const retenue = brancheDePublication({ cible: 'dev', reglees: { dev: 'livraison' }, principale: 'main' });
  assert.equal(retenue.origine, 'reglee');
  assert.equal(retenue.ecart, true);
  assert.match(retenue.raison, /hors du schéma/);
});

test('régler exactement le nom imposé n’est pas un écart', () => {
  const retenue = brancheDePublication({ cible: 'production', reglees: { production: 'main' } });
  assert.equal(retenue.origine, 'reglee');
  assert.equal(retenue.ecart, false);
});

test('une seule des deux réglée laisse l’autre au schéma imposé', () => {
  const reglees = { production: 'release' };
  assert.equal(brancheDePublication({ cible: 'dev', reglees, principale: 'main' }).branche, 'dev');
  assert.equal(brancheDePublication({ cible: 'production', reglees, principale: 'main' }).branche, 'release');
});

test('un réglage fait d’espaces n’est pas un réglage', () => {
  assert.equal(brancheReglee({ dev: '   ' }, 'dev'), undefined);
  assert.equal(brancheDePublication({ cible: 'dev', reglees: { dev: '  ' }, principale: 'main' }).branche, 'dev');
});

/* ------------------------------------------------------------------ */
/* Ce que l'écran et le déroulé disent                                 */
/* ------------------------------------------------------------------ */

test('l’écart se dit en une phrase, et rien ne se dit quand la règle est suivie', () => {
  assert.equal(ecartAuSchema('dev', 'dev'), false);
  assert.equal(ecartAuSchema('dev', ''), false);
  assert.equal(ecartAuSchema('production', 'master'), true);
  assert.equal(mentionEcartAuSchema('dev', 'dev'), undefined);
  assert.match(String(mentionEcartAuSchema('production', 'master')), /main/);
});

test('la mention par défaut nomme toujours la branche imposée', () => {
  assert.match(mentionBrancheParDefaut('dev', ['main', 'dev']), /« dev »/);
  assert.match(mentionBrancheParDefaut('dev', ['main']), /sera créée/);
  assert.match(mentionBrancheParDefaut('production', ['main', 'dev']), /« main »/);
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

