import test from 'node:test';
import assert from 'node:assert/strict';
import { carteARefermerSurChoixDeVue, carteVisibleSurLaVue } from '@beluga/shared';

/*
 * « LE BOUTON NE RÉAGIT PAS QUAND JE CLIQUE SUR UNE CARTE DEPUIS LE TABLEAU DE
 * BORD » — choisir la page où l'on est déjà, recouverte par une carte, doit
 * refermer la carte. Les gardes : jamais sur le tableau d'un projet ni sur un
 * service plein, où la mémoire de la carte est voulue.
 */

test('« En route » recouverte par une carte ouverte depuis elle : la carte se referme', () => {
  assert.equal(
    carteARefermerSurChoixDeVue({
      vueDemandee: 'en-route',
      vueActuelle: 'en-route',
      vueDeLaCarte: 'en-route',
      carteOuverte: true,
    }),
    true,
  );
});

test('« Résumé » (tableau-de-bord) suit la même règle', () => {
  assert.equal(
    carteARefermerSurChoixDeVue({
      vueDemandee: 'tableau-de-bord',
      vueActuelle: 'tableau-de-bord',
      vueDeLaCarte: 'tableau-de-bord',
      carteOuverte: true,
    }),
    true,
  );
});

test('sans carte ouverte, il n’y a rien à refermer', () => {
  assert.equal(
    carteARefermerSurChoixDeVue({
      vueDemandee: 'en-route',
      vueActuelle: 'en-route',
      vueDeLaCarte: 'en-route',
      carteOuverte: false,
    }),
    false,
  );
});

test('demander une AUTRE page change la vue, la règle ne s’en mêle pas', () => {
  assert.equal(
    carteARefermerSurChoixDeVue({
      vueDemandee: 'en-route',
      vueActuelle: 'projet',
      vueDeLaCarte: 'projet',
      carteOuverte: true,
    }),
    false,
  );
});

test('une carte ouverte sur le tableau d’un projet n’est jamais refermée par un choix de vue', () => {
  assert.equal(
    carteARefermerSurChoixDeVue({
      vueDemandee: 'projet',
      vueActuelle: 'projet',
      vueDeLaCarte: 'projet',
      carteOuverte: true,
    }),
    false,
  );
});

test('un service plein ne referme rien : sa mémoire de carte reste', () => {
  for (const service of ['coffre', 'memoire', 'marketing', 'statistiques'] as const) {
    assert.equal(
      carteARefermerSurChoixDeVue({
        vueDemandee: service,
        vueActuelle: service,
        vueDeLaCarte: 'projet',
        carteOuverte: true,
      }),
      false,
      service,
    );
  }
});

test('une carte retenue d’une autre vue, non affichée ici, n’est pas refermée', () => {
  /* Ouverte sur le tableau du projet, puis on est passé sur « En route » : elle
     n'y est pas affichée (`carteVisibleSurLaVue`) — pas de geste à rendre. */
  assert.equal(carteVisibleSurLaVue('en-route', 'projet'), false);
  assert.equal(
    carteARefermerSurChoixDeVue({
      vueDemandee: 'en-route',
      vueActuelle: 'en-route',
      vueDeLaCarte: 'projet',
      carteOuverte: true,
    }),
    false,
  );
});
