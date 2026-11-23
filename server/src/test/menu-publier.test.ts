import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DUREE_DU_FINI_DANS_LE_MENU_MS,
  jalonsDePreparation,
  libelleCourtDeLEtape,
  motDuBoutonPublier,
  pourcentDePreparation,
  publicationBloquee,
  vueDuMenuPublier,
} from '@beluga/shared';

test('le menu Publier suit la publication qui tourne, puis la préparation, puis la réussite fraîche', () => {
  assert.deepEqual(vueDuMenuPublier({ run: { state: 'running', cible: 'production' }, maintenant: 0 }), { genre: 'suivi', cible: 'production' });
  assert.deepEqual(vueDuMenuPublier({ run: { state: 'success', endedAt: 100 }, preparationDev: true, maintenant: 200 }), { genre: 'preparation', cible: 'dev' });
  assert.deepEqual(vueDuMenuPublier({ run: { state: 'success', endedAt: 100 }, maintenant: 200 }), { genre: 'fini', cible: 'dev' });
  assert.deepEqual(vueDuMenuPublier({ run: { state: 'success', endedAt: 100 }, maintenant: 100 + DUREE_DU_FINI_DANS_LE_MENU_MS }), { genre: 'ordinaire' });
  assert.deepEqual(vueDuMenuPublier({ maintenant: 0 }), { genre: 'ordinaire' });
});

test('seule une dernière publication tombée sur un blocage, non rangée, est bloquée', () => {
  assert.equal(publicationBloquee({ state: 'failed', steps: [{ state: 'failed', blocage: { explication: 'x' } }] }), true);
  assert.equal(publicationBloquee({ state: 'failed', masquee: true, steps: [{ state: 'failed', blocage: {} }] }), false);
  assert.equal(publicationBloquee({ state: 'failed', steps: [{ state: 'failed' }] }), false);
  assert.equal(publicationBloquee({ state: 'running', steps: [{ state: 'running', blocage: {} }] }), false);
});

test('le bouton dit l’étape en cours, et rien au repos', () => {
  assert.equal(motDuBoutonPublier({ genre: 'suivi', cible: 'dev' }), 'Déploiement');
  assert.equal(motDuBoutonPublier({ genre: 'suivi', cible: 'production' }), 'Mise en production');
  assert.equal(motDuBoutonPublier({ genre: 'preparation', cible: 'dev' }), 'Préparation');
  assert.equal(motDuBoutonPublier({ genre: 'ordinaire' }), null);
});

test('les libellés courts parlent en gestes, avec le nombre de tâches', () => {
  assert.equal(libelleCourtDeLEtape('merge', 'dev', 2), 'Réunir le travail des 2 tâches');
  assert.equal(libelleCourtDeLEtape('merge', 'dev', 1), 'Réunir le travail de la tâche');
  assert.equal(libelleCourtDeLEtape('build', 'dev'), 'Construire l’application');
  assert.equal(libelleCourtDeLEtape('publish', 'production'), 'Transférer chez le client');
});

test('une préparation avance par jalons et ne dit jamais 100 % tant qu’elle tourne', () => {
  assert.deepEqual(jalonsDePreparation(0, 0).map((j) => j.etat), ['running', 'todo', 'todo']);
  assert.deepEqual(jalonsDePreparation(4, 6).map((j) => j.etat), ['done', 'done', 'running']);
  assert.equal(pourcentDePreparation(6, 6), 95);
  assert.equal(pourcentDePreparation(0, 0), 5);
});
