/** LE MOT DE PASSE GÉNÉRÉ : long, complet, lisible, jamais deux fois le même. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { FAMILLES_DU_MOT_DE_PASSE, LONGUEUR_DU_MOT_DE_PASSE, genererMotDePasse } from '@beluga/shared';

test('vingt signes par défaut, chaque famille présente', () => {
  for (let essai = 0; essai < 200; essai += 1) {
    const mdp = genererMotDePasse();
    assert.equal(mdp.length, LONGUEUR_DU_MOT_DE_PASSE);
    for (const famille of FAMILLES_DU_MOT_DE_PASSE) {
      assert.ok([...mdp].some((signe) => famille.includes(signe)), `${mdp} sans ${famille}`);
    }
  }
});

test('aucun signe ambigu à la lecture', () => {
  const mdp = Array.from({ length: 300 }, () => genererMotDePasse()).join('');
  assert.doesNotMatch(mdp, /[0Oo1lI5S2Z]/);
});

test('deux tirages diffèrent ; une longueur trop courte est relevée', () => {
  assert.notEqual(genererMotDePasse(), genererMotDePasse());
  assert.equal(genererMotDePasse(2).length, FAMILLES_DU_MOT_DE_PASSE.length);
  assert.equal(genererMotDePasse(32).length, 32);
});

test('une valeur du dernier tour incomplet est rejetée, pas repliée', () => {
  // La première valeur tombe au-delà du plafond de la famille des chiffres : elle doit être retirée.
  const valeurs = [0xffff_ffff, 0, 0, 0, 0, ...Array(200).fill(7)];
  let i = 0;
  const mdp = genererMotDePasse(4, (tableau) => {
    tableau[0] = valeurs[i++] ?? 0;
    return tableau;
  });
  assert.equal(mdp.length, 4);
  assert.ok(i > 4, 'la valeur hors plafond a été retirée');
});
