import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ETAT_DU_REPLI_INITIAL,
  HAUT_TOUJOURS_AFFICHE,
  recalerLeRepli,
  repliALOuverture,
  suivreLeDefilement,
  type EtatDuRepli,
} from '@beluga/shared';

/*
 * L'EN-TÊTE D'UNE PAGE DE CARTE SE REPLIE DÈS QU'ON DESCEND ET REVIENT DÈS
 * QU'ON REMONTE, À CHAQUE FOIS — même par petits pas (demande du 14/10/2026).
 */

const MAX = 3000;
const descendre = (depart: EtatDuRepli, de: number, a: number, pas: number) => {
  let etat = depart;
  for (let y = de; y <= a; y += pas) etat = suivreLeDefilement(etat, y, MAX);
  return etat;
};

test('une descente LENTE, par pas de 3 px, replie quand même', () => {
  const etat = descendre(ETAT_DU_REPLI_INITIAL, 0, 120, 3);
  assert.equal(etat.masque, true);
});

test('en haut de page, l’en-tête reste affiché', () => {
  const etat = descendre(ETAT_DU_REPLI_INITIAL, 0, HAUT_TOUJOURS_AFFICHE - 1, 5);
  assert.equal(etat.masque, false);
});

test('replié, 5 px de remontée ne changent rien, 20 px le ramènent', () => {
  const replie = descendre(ETAT_DU_REPLI_INITIAL, 0, 600, 4);
  assert.equal(replie.masque, true);
  assert.equal(suivreLeDefilement(replie, 595, MAX).masque, true);
  assert.equal(suivreLeDefilement(replie, 580, MAX).masque, false);
});

test('une remontée LENTE, par pas de 2 px, ramène aussi', () => {
  let etat = descendre(ETAT_DU_REPLI_INITIAL, 0, 600, 4);
  for (let y = 600; y >= 570; y -= 2) etat = suivreLeDefilement(etat, y, MAX);
  assert.equal(etat.masque, false);
});

test('le rebond élastique, au-delà du bas ou du haut, ne compte pas', () => {
  const replie = descendre(ETAT_DU_REPLI_INITIAL, 0, MAX, 10);
  assert.equal(replie.masque, true);
  // Au bas, la page dépasse puis revient : sans borne, le retour ramenait l'en-tête.
  const apresDepassement = suivreLeDefilement(suivreLeDefilement(replie, MAX + 60, MAX), MAX, MAX);
  assert.equal(apresDepassement.masque, true);
});

test('hors geste, la référence se recale sans basculer', () => {
  // Le fil saute tout en bas à l'arrivée d'une réponse : affiché, il le reste…
  const recale = recalerLeRepli({ masque: false, reference: 200 }, 2200, MAX);
  assert.deepEqual(recale, { masque: false, reference: 2200 });
  // …et le geste suivant part de là : 5 px de plus ne replient rien.
  assert.equal(suivreLeDefilement(recale, 2205, MAX).masque, false);
  assert.equal(suivreLeDefilement(recale, 2230, MAX).masque, true);
});

test('À L’OUVERTURE, UN FIL LONG POSÉ EN BAS REPLIE L’EN-TÊTE', () => {
  const etat = repliALOuverture(MAX, MAX, 120);
  assert.deepEqual(etat, { masque: true, reference: MAX });
  /* Un arrondi de sous-pixel compte comme le bas. */
  assert.equal(repliALOuverture(MAX - 2, MAX, 120)?.masque, true);
});

test('à l’ouverture, un fil court garde l’en-tête — même une fois l’en-tête rendu au fil', () => {
  assert.equal(repliALOuverture(0, 0, 120), null);
  assert.equal(repliALOuverture(30, 30, 0), null);
  /* 150 px de défilement, dont 120 rendus par l'en-tête replié : il en resterait 30. */
  assert.equal(repliALOuverture(150, 150, 120), null);
  assert.equal(repliALOuverture(HAUT_TOUJOURS_AFFICHE + 120, HAUT_TOUJOURS_AFFICHE + 120, 120)?.masque, true);
});

test('à l’ouverture, un fil qui n’est pas posé en bas ne bouge rien', () => {
  assert.equal(repliALOuverture(MAX - 200, MAX, 120), null);
});
