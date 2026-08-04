import test from 'node:test';
import assert from 'node:assert/strict';
import { RAISONS_AFFICHEES, RAISON_SANS_MOT, bilanDeLot } from '@haikodev/shared';

const RAISON_DOSSIER =
  'Un autre agent travaille déjà dans ce dossier (carte « Refaire le tableau ») : deux cartes ne peuvent pas se partager la même copie de travail. Cette carte démarrera dès que l’autre aura rendu.';

test('un lot entièrement passé se dit en une ligne, sans alarme', () => {
  const bilan = bilanDeLot('lancée', 3, []);
  assert.equal(bilan.niveau, 'success');
  assert.equal(bilan.texte, '3 cartes lancées.');
});

test('une seule carte reste au singulier', () => {
  assert.equal(bilanDeLot('archivée', 1, []).texte, '1 carte archivée.');
});

test('un lot partiel compte honnêtement, et nomme chaque carte refusée', () => {
  const bilan = bilanDeLot('lancée', 1, [
    { titre: 'Plan B', raison: RAISON_DOSSIER },
    { titre: 'Plan C', raison: RAISON_DOSSIER },
  ]);
  assert.equal(bilan.niveau, 'warning');
  assert.match(bilan.texte, /^1 carte lancée, 2 en attente :/);
  assert.match(bilan.texte, /« Plan B » — Un autre agent travaille déjà dans ce dossier/);
  assert.match(bilan.texte, /« Plan C » —/);
});

test('un lot entièrement refusé est un échec franc, jamais un silence', () => {
  const bilan = bilanDeLot('lancée', 0, [
    { titre: 'Plan A', raison: RAISON_DOSSIER },
    { titre: 'Plan B', raison: RAISON_DOSSIER },
    { titre: 'Plan C', raison: RAISON_DOSSIER },
  ]);
  assert.equal(bilan.niveau, 'error');
  assert.match(bilan.texte, /^Aucune carte lancée — 3 en attente :/);
  // Chacune des trois est nommée : c'est la preuve que la boucle est allée au bout.
  for (const titre of ['Plan A', 'Plan B', 'Plan C']) assert.match(bilan.texte, new RegExp(titre));
});

test('au-delà de trois refus, le reste est annoncé au lieu de faire un mur', () => {
  const refus = Array.from({ length: 6 }, (_, i) => ({ titre: `Carte ${i}`, raison: RAISON_DOSSIER }));
  const bilan = bilanDeLot('lancée', 0, refus);
  const lignes = bilan.texte.split('\n');
  assert.equal(lignes.length, RAISONS_AFFICHEES + 2); // en-tête + 3 raisons + le reste
  assert.match(bilan.texte, /et 3 autres, chacune avec sa raison écrite sur sa carte\./);
});

test('un refus sans explication le dit, au lieu de laisser un tiret vide', () => {
  const bilan = bilanDeLot('déployée', 0, [{ titre: 'Plan A' }]);
  assert.match(bilan.texte, new RegExp(RAISON_SANS_MOT));
});

test('une sélection vide ne raconte pas qu’un travail a eu lieu', () => {
  const bilan = bilanDeLot('validée', 0, []);
  assert.equal(bilan.texte, 'Aucune carte à traiter.');
});
