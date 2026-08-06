import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CRANS_DE_VITESSE,
  VITESSE_PAR_DEFAUT,
  echelleDeVitesse,
} from '@haikodev/shared';

test('la vitesse normale garde l’échelle d’origine (1)', () => {
  assert.equal(echelleDeVitesse('normale'), 1);
  assert.equal(VITESSE_PAR_DEFAUT, 'normale');
});

test('lente ralentit (échelle > 1), rapide accélère (échelle < 1)', () => {
  assert.ok(echelleDeVitesse('lente') > 1);
  assert.ok(echelleDeVitesse('rapide') < 1);
});

test('un cran inconnu retombe sur la vitesse normale, jamais un son muet', () => {
  assert.equal(echelleDeVitesse('galope'), 1);
  assert.equal(echelleDeVitesse(undefined), 1);
});

test('les trois crans annoncés existent, du plus lent au plus rapide', () => {
  assert.deepEqual(
    CRANS_DE_VITESSE.map((c) => c.id),
    ['lente', 'normale', 'rapide'],
  );
  const echelles = CRANS_DE_VITESSE.map((c) => c.echelle);
  assert.deepEqual(echelles, [...echelles].sort((a, b) => b - a));
});
