/**
 * LA PAGE « RÉSUMÉ » — les règles pures (`shared/src/resume.ts`).
 *
 * Ce que ces essais verrouillent : une rubrique ou une taille de page inconnue
 * retombe sur sa valeur par défaut ; le tri est stable et range TOUJOURS les
 * valeurs absentes en bas ; le clic sur un entête suit le cycle naturel →
 * inverse → ordre du serveur ; une page demandée hors bornes est ramenée
 * dedans ; la pertinence et le taux d'aide disent « inconnu » plutôt que zéro
 * quand rien n'a été mesuré ; les séries par jour ignorent ce qui déborde ; et
 * une période plus ancienne que les données gardées est dite partielle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RUBRIQUE_PAR_DEFAUT,
  TAILLE_DE_PAGE_PAR_DEFAUT,
  UN_JOUR_MS,
  bornesDeLaPeriode,
  minuitDe,
  pageDuTableau,
  partRendue,
  periodePartielle,
  rubriqueDuResume,
  sommesParJour,
  tauxDAide,
  trierLesLignes,
  triSuivantDuTableau,
} from '@beluga/shared';

test('une rubrique ou une taille inconnue retombe sur son défaut', () => {
  assert.equal(rubriqueDuResume('memoire'), 'memoire');
  assert.equal(rubriqueDuResume('inconnue'), RUBRIQUE_PAR_DEFAUT);
  assert.equal(rubriqueDuResume(undefined), RUBRIQUE_PAR_DEFAUT);
});

test('le tri est stable, numérique, et range les valeurs absentes en bas dans les deux sens', () => {
  const lignes = [
    { id: 'a', n: 3 as number | null, nom: 'Élan' },
    { id: 'b', n: null, nom: 'beta' },
    { id: 'c', n: 10, nom: 'Alpha' },
    { id: 'd', n: 3, nom: 'delta' },
  ];
  assert.deepEqual(trierLesLignes(lignes, (l) => l.n, 'asc').map((l) => l.id), ['a', 'd', 'c', 'b']);
  assert.deepEqual(trierLesLignes(lignes, (l) => l.n, 'desc').map((l) => l.id), ['c', 'a', 'd', 'b']);
  // Les accents et la casse ne dérangent pas l'ordre alphabétique.
  assert.deepEqual(trierLesLignes(lignes, (l) => l.nom, 'asc').map((l) => l.id), ['c', 'b', 'd', 'a']);
  // « 10 » vient après « 9 » quand la colonne est du texte.
  assert.deepEqual(trierLesLignes([{ v: 'v10' }, { v: 'v9' }], (l) => l.v, 'asc').map((l) => l.v), ['v9', 'v10']);
});

test('le clic sur un entête : sens naturel, puis inverse, puis ordre du serveur', () => {
  const un = triSuivantDuTableau(null, 'jetons', 'desc');
  assert.deepEqual(un, { colonne: 'jetons', sens: 'desc' });
  const deux = triSuivantDuTableau(un, 'jetons', 'desc');
  assert.deepEqual(deux, { colonne: 'jetons', sens: 'asc' });
  assert.equal(triSuivantDuTableau(deux, 'jetons', 'desc'), null);
  // Une autre colonne repart de son propre sens naturel.
  assert.deepEqual(triSuivantDuTableau(deux, 'nom', 'asc'), { colonne: 'nom', sens: 'asc' });
});

test('une page hors bornes est ramenée dedans, et le pied dit « premier – dernier sur total »', () => {
  const lignes = Array.from({ length: 45 }, (_, i) => i);
  const p = pageDuTableau(lignes, 2, 20);
  assert.deepEqual([p.page, p.pages, p.total, p.premier, p.dernier, p.lignes.length], [2, 3, 45, 41, 45, 5]);
  const trop = pageDuTableau(lignes, 9, 20);
  assert.equal(trop.page, 2);
  const negative = pageDuTableau(lignes, -3, 20);
  assert.equal(negative.page, 0);
  const vide = pageDuTableau([], 4, 20);
  assert.deepEqual([vide.page, vide.pages, vide.total, vide.premier, vide.dernier], [0, 1, 0, 0, 0]);
});

test('pertinence et taux d’aide : « inconnu » plutôt que zéro quand rien n’est mesuré', () => {
  assert.equal(partRendue(0, 0), null);
  assert.equal(partRendue(10, 4), 0.4);
  assert.equal(partRendue(10, 14), 1);
  assert.equal(tauxDAide({ aidee: 0, inutile: 0, contredite: 0 }), null);
  assert.equal(tauxDAide({ aidee: 3, inutile: 1, contredite: 0 }), 0.75);
});

test('les séries par jour ont une case par jour et ignorent ce qui déborde', () => {
  const maintenant = Date.UTC(2026, 9, 6, 12);
  const { debut, fin, jours } = bornesDeLaPeriode(maintenant - 6 * UN_JOUR_MS, maintenant, maintenant);
  assert.equal(jours, 7);
  const cases = sommesParJour(
    [
      { at: debut + 1000, valeur: 5 },
      { at: debut + 2000 },
      { at: fin - 1000, valeur: 2 },
      { at: debut - 1000, valeur: 100 },
      { at: fin + 1000, valeur: 100 },
    ],
    debut,
    fin,
  );
  assert.equal(cases.length, 7);
  assert.deepEqual([cases[0], cases[6]], [6, 2]);
  assert.equal(cases.reduce((a, b) => a + b, 0), 8);
});

test('une période plus ancienne que les données gardées est dite partielle', () => {
  const maintenant = Date.UTC(2026, 9, 6, 12);
  const debut = minuitDe(maintenant - 29 * UN_JOUR_MS);
  assert.equal(periodePartielle(debut, maintenant - 3 * UN_JOUR_MS), true);
  assert.equal(periodePartielle(debut, debut + 3600_000), false);
  assert.equal(periodePartielle(debut, null), false);
});
