import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alerteServeurInjoignable,
  DELAI_CANAL_COUPE,
  RAISON_SANS_REPONSE,
  type EtatDuLien,
} from '@haikodev/shared';

const MAINTENANT = 1_700_000_000_000;

/** Le cas du symptôme : un lancement qui répond après le délai, canal ouvert. */
const REQUETE_LENTE: EtatDuLien = { connecte: true, echecsConsecutifs: 1 };

test('une requête isolée sans réponse n’allume aucune alerte', () => {
  assert.equal(alerteServeurInjoignable(REQUETE_LENTE, MAINTENANT), false);
});

test('deux requêtes de suite sans réponse : là, on le dit', () => {
  assert.equal(alerteServeurInjoignable({ ...REQUETE_LENTE, echecsConsecutifs: 2 }, MAINTENANT), true);
});

test('un canal coupé depuis moins de quinze secondes est une reconnexion, pas une panne', () => {
  const lien: EtatDuLien = {
    connecte: false,
    coupeDepuis: MAINTENANT - (DELAI_CANAL_COUPE - 1),
    echecsConsecutifs: 0,
  };
  assert.equal(alerteServeurInjoignable(lien, MAINTENANT), false);
});

test('un canal coupé qui dure est une vraie panne : on ne la masque pas', () => {
  const lien: EtatDuLien = {
    connecte: false,
    coupeDepuis: MAINTENANT - DELAI_CANAL_COUPE,
    echecsConsecutifs: 0,
  };
  assert.equal(alerteServeurInjoignable(lien, MAINTENANT), true);
});

test('canal coupé sans date connue : on se tait plutôt que d’inventer', () => {
  assert.equal(alerteServeurInjoignable({ connecte: false, echecsConsecutifs: 0 }, MAINTENANT), false);
});

test('le texte rendu à l’appelant reste celui que le bilan d’un lot sait traduire', () => {
  assert.match(RAISON_SANS_REPONSE, /le serveur ne répond pas/i);
});
