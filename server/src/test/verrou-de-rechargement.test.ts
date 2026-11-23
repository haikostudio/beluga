import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAFOND_DE_RECHARGEMENTS,
  REPOS_ENTRE_RECHARGEMENTS_MS,
  deciderDuRechargement,
  type EtatDesRechargements,
} from '@beluga/shared';

/*
 * UN SEUL RECHARGEMENT PAR ARRIVÉE DE VERSION.
 *
 * Les deux mécanismes — nouvelle version, décalage de protocole — se
 * déclenchent ensemble à chaque mise en ligne. Ces contrôles prouvent qu'un
 * seul rechargement en sort, et qu'aucune boucle n'est possible.
 */

test('le premier appel recharge, le second pour la même valeur non', () => {
  const premier = deciderDuRechargement({ motif: 'version', valeur: 'v2', etat: {}, maintenant: 0 });
  assert.equal(premier.recharger, true);
  const second = deciderDuRechargement({
    motif: 'version',
    valeur: 'v2',
    etat: premier.etat,
    maintenant: REPOS_ENTRE_RECHARGEMENTS_MS * 5,
  });
  assert.equal(second.recharger, false);
});

test('les deux mécanismes ensemble ne rechargent QU’UNE fois', () => {
  // Une mise en ligne : la version change, et le protocole avec.
  const version = deciderDuRechargement({ motif: 'version', valeur: 'v2', etat: {}, maintenant: 1_000 });
  assert.equal(version.recharger, true);
  const protocole = deciderDuRechargement({
    motif: 'protocole',
    valeur: '7',
    etat: version.etat,
    maintenant: 1_200,
  });
  assert.equal(protocole.recharger, false, 'le second mécanisme ne doit pas recharger dans la foulée');
  // …et il ne revient pas frapper une seconde plus tard.
  const encore = deciderDuRechargement({
    motif: 'protocole',
    valeur: '7',
    etat: protocole.etat,
    maintenant: 60_000,
  });
  assert.equal(encore.recharger, false);
});

test('passé le temps de repos, une NOUVELLE valeur recharge bien', () => {
  const premier = deciderDuRechargement({ motif: 'version', valeur: 'v2', etat: {}, maintenant: 0 });
  const suivant = deciderDuRechargement({
    motif: 'version',
    valeur: 'v3',
    etat: premier.etat,
    maintenant: REPOS_ENTRE_RECHARGEMENTS_MS + 1,
  });
  assert.equal(suivant.recharger, true);
});

test('le plafond casse la boucle : jamais plus de trois rechargements', () => {
  let etat: EtatDesRechargements = {};
  let maintenant = 0;
  let faits = 0;
  for (let i = 0; i < 10; i += 1) {
    maintenant += REPOS_ENTRE_RECHARGEMENTS_MS + 1;
    const decision = deciderDuRechargement({ motif: 'version', valeur: `v${i}`, etat, maintenant });
    etat = decision.etat;
    if (decision.recharger) faits += 1;
  }
  assert.equal(faits, PLAFOND_DE_RECHARGEMENTS);
});

test('un refus ne consomme pas le droit d’un motif qui n’a rien obtenu', () => {
  // Plafond atteint : l'état ne bouge pas, donc rien ne se perd.
  const etat: EtatDesRechargements = { total: PLAFOND_DE_RECHARGEMENTS, dernier: 0 };
  const decision = deciderDuRechargement({ motif: 'version', valeur: 'v9', etat, maintenant: 999_999 });
  assert.equal(decision.recharger, false);
  assert.deepEqual(decision.etat, etat);
});
