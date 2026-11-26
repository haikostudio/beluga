import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DELAI_AVANT_CONNEXION_BLOQUEE,
  ESPACEMENT_DES_ALERTES_DE_BLOCAGE,
  REPLI_MAXIMAL_DU_CANAL,
  ROUTE_SIGNALEMENT_DE_BLOCAGE,
  alerteDeBlocageAutorisee,
  genreDeLAlerte,
  repliDuCanal,
  resteAvantConnexionBloquee,
  routeApiAutorisee,
  signalementDeBlocageValide,
} from '@beluga/shared';

test('30 s sans liaison : l’écran bloqué, pas avant', () => {
  assert.equal(DELAI_AVANT_CONNEXION_BLOQUEE, 30_000);
  assert.equal(resteAvantConnexionBloquee(null, 1_000_000), null);
  assert.equal(resteAvantConnexionBloquee(1_000_000, 1_000_000), 30_000);
  assert.equal(resteAvantConnexionBloquee(1_000_000, 1_029_999), 1);
  assert.equal(resteAvantConnexionBloquee(1_000_000, 1_030_000), 0);
  assert.equal(resteAvantConnexionBloquee(1_000_000, 1_090_000), 0);
});

test('le repli entre deux tentatives croît puis plafonne', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 50].map(repliDuCanal), [1500, 3000, 6000, 12000, 15000, 15000, 15000]);
  assert.equal(repliDuCanal(-3), 1500);
  assert.equal(repliDuCanal(Number.NaN), 1500);
  assert.ok(repliDuCanal(1e9) <= REPLI_MAXIMAL_DU_CANAL);
});

test('une alerte de blocage par compte et par heure', () => {
  const t0 = 5_000_000;
  assert.equal(alerteDeBlocageAutorisee(undefined, t0), true);
  assert.equal(alerteDeBlocageAutorisee(t0, t0 + 60_000), false);
  assert.equal(alerteDeBlocageAutorisee(t0, t0 + ESPACEMENT_DES_ALERTES_DE_BLOCAGE - 1), false);
  assert.equal(alerteDeBlocageAutorisee(t0, t0 + ESPACEMENT_DES_ALERTES_DE_BLOCAGE), true);
});

test('le signalement reçu est borné, et refusé s’il ne colle pas', () => {
  assert.deepEqual(signalementDeBlocageValide({ etape: 'connexion', dureeMs: 30_412.6, userAgent: 'Mozilla' }), {
    etape: 'connexion',
    dureeMs: 30_413,
    userAgent: 'Mozilla',
  });
  assert.equal(signalementDeBlocageValide({ etape: 'session', dureeMs: 31_000, userAgent: 'x'.repeat(5000) })!.userAgent.length, 300);
  for (const mauvais of [null, [], 'texte', { etape: 'autre', dureeMs: 1 }, { etape: 'connexion', dureeMs: -1 }, { etape: 'connexion', dureeMs: '30' }, { etape: 'connexion', dureeMs: 1e12 }]) {
    assert.equal(signalementDeBlocageValide(mauvais), null, JSON.stringify(mauvais));
  }
});

test('le blocage d’un espace alerte au genre « erreur », sans genre de plus', () => {
  assert.equal(genreDeLAlerte('espace-connexion-bloquee'), 'erreur');
});

test('la route du signalement est ouverte au client', () => {
  assert.equal(routeApiAutorisee('client', ROUTE_SIGNALEMENT_DE_BLOCAGE), true);
});
