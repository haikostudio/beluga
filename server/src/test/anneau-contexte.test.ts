import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ESPACE_MILLIERS,
  detailDuContexte,
  jetonsLisibles,
  mesurerContexte,
  niveauDeContexte,
  traceDeLAnneau,
} from '@beluga/shared';

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
  assert.equal(jetonsLisibles(18_000), `18${ESPACE_MILLIERS}000`);
  assert.equal(jetonsLisibles(199_999), `199${ESPACE_MILLIERS}999`);
  // Toujours la MÊME espace, quelle que soit la région de la machine.
  assert.equal(ESPACE_MILLIERS, '\u202f');
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
  // Un agent de tâche n'a pas de plafond : 80 % de la fenêtre.
  assert.equal(detail.seuilJetons, 160_000);
  assert.equal(detail.seuilPourcentage, 80);
  assert.equal(detail.avantCompression, 120_000);
});

test('sur une fenêtre d’un million, un agent de tâche se compresse à 80 %', () => {
  const usage = mesurerContexte(120_000, 1_000_000, 1);
  assert.ok(usage);
  const detail = detailDuContexte(usage);
  assert.equal(detail.pourcentage, 12);
  assert.equal(detail.seuilJetons, 800_000);
  assert.equal(detail.seuilPourcentage, 80);
  assert.equal(detail.avantCompression, 680_000);
});

test('le cadrage garde son plafond propre : sa fenêtre le dit', () => {
  const usage = mesurerContexte(120_000, 1_000_000, 1);
  assert.ok(usage);
  const detail = detailDuContexte(usage, 60_000);
  assert.equal(detail.seuilJetons, 60_000);
  assert.equal(detail.seuilPourcentage, 6);
  // Le seuil est déjà passé : la fenêtre le dit, l'anneau à 12 % ne le dirait pas.
  assert.equal(detail.avantCompression, 0);
});
