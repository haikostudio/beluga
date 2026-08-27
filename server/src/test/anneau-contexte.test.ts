import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detailDuContexte,
  jetonsLisibles,
  mesurerContexte,
  niveauDeContexte,
  traceDeLAnneau,
} from '@haikodev/shared';

test('les trois niveaux de remplissage', () => {
  assert.equal(niveauDeContexte(0), 'repos');
  assert.equal(niveauDeContexte(59), 'repos');
  assert.equal(niveauDeContexte(60), 'charge');
  assert.equal(niveauDeContexte(84), 'charge');
  assert.equal(niveauDeContexte(85), 'critique');
  assert.equal(niveauDeContexte(100), 'critique');
});

test('le tracé de l’anneau : trait plein et trou complémentaires', () => {
  const trace = traceDeLAnneau(25, 10);
  assert.equal(Math.round(trace.circonference), 63);
  assert.ok(Math.abs(trace.rempli - trace.circonference / 4) < 1e-9);
  assert.ok(Math.abs(trace.rempli + trace.vide - trace.circonference) < 1e-9);
});

test('un pourcentage hors bornes ne déborde pas du cercle', () => {
  const plein = traceDeLAnneau(180, 10);
  assert.equal(plein.vide, 0);
  assert.ok(Math.abs(plein.rempli - plein.circonference) < 1e-9);

  const vide = traceDeLAnneau(-40, 10);
  assert.equal(vide.rempli, 0);

  // Un rayon absurde ne fait pas rendre NaN.
  assert.ok(Number.isFinite(traceDeLAnneau(50, 0).circonference));
});

test('les jetons se lisent avec une espace, et s’abrègent au million', () => {
  assert.equal(jetonsLisibles(0), '0');
  assert.equal(jetonsLisibles(18_000), '18 000');
  assert.equal(jetonsLisibles(199_999), '199 999');
  assert.equal(jetonsLisibles(1_200_000), '1,2 M');
  assert.equal(jetonsLisibles(12_000_000), '12 M');
});

test('le détail dit le seuil de compression en jetons ET en part de fenêtre', () => {
  const usage = mesurerContexte(40_000, 200_000, 1);
  assert.ok(usage);
  const detail = detailDuContexte(usage);
  assert.equal(detail.utilises, 40_000);
  assert.equal(detail.capacite, 200_000);
  assert.equal(detail.restants, 160_000);
  assert.equal(detail.pourcentage, 20);
  // Plafond de 100 000 jetons, moitié de la fenêtre = 100 000 : c'est le plus petit des deux.
  assert.equal(detail.seuilJetons, 100_000);
  assert.equal(detail.seuilPourcentage, 50);
  assert.equal(detail.avantCompression, 60_000);
});

test('sur une fenêtre d’un million, la compression part bien avant 50 %', () => {
  const usage = mesurerContexte(120_000, 1_000_000, 1);
  assert.ok(usage);
  const detail = detailDuContexte(usage);
  assert.equal(detail.pourcentage, 12);
  assert.equal(detail.seuilJetons, 100_000);
  assert.equal(detail.seuilPourcentage, 10);
  // Le seuil est déjà passé : la fenêtre le dit, l'anneau à 12 % ne le dirait pas.
  assert.equal(detail.avantCompression, 0);
});
