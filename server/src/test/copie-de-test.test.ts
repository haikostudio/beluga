import test from 'node:test';
import assert from 'node:assert/strict';
import { entreesEnAttente, raisonCopieBloquee } from '@beluga/shared';

test('les entrées en attente : branches réunies, sans doublon, dans l’ordre du rejeu, moins celles en ligne', () => {
  const dev = ['production/a-rejouer/20261008-0900-desactiver-health-check.sh', 'production/a-rejouer/README.md'];
  const carte = ['production/a-rejouer/20261009-1000-mettre-a-jour-cf7.sh', 'production/a-rejouer/20261008-0900-desactiver-health-check.sh'];
  assert.deepEqual(entreesEnAttente([carte, dev], []), ['20261008-0900-desactiver-health-check.sh', '20261009-1000-mettre-a-jour-cf7.sh']);
  assert.deepEqual(entreesEnAttente([carte, dev], ['20261008-0900-desactiver-health-check.sh', '']), ['20261009-1000-mettre-a-jour-cf7.sh']);
  assert.deepEqual(entreesEnAttente([], ['x.sh']), []);
});

test('le bouton « Rafraîchir la copie de test » : absent, occupé, bloqué par une entrée, ou prêt', () => {
  assert.equal(raisonCopieBloquee(null), 'indisponible');
  assert.equal(raisonCopieBloquee({ disponible: false, enAttente: [], enCours: false }), 'indisponible');
  assert.equal(raisonCopieBloquee({ disponible: true, enAttente: [], enCours: true }), 'en-cours');
  assert.equal(raisonCopieBloquee({ disponible: true, enAttente: ['a.sh'], enCours: false }), 'en-attente');
  assert.equal(raisonCopieBloquee({ disponible: true, enAttente: [], enCours: false }), null);
});
