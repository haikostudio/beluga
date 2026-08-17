import assert from 'node:assert/strict';
import test from 'node:test';
import {
  THEMES,
  APPARENCE_PAR_DEFAUT,
  couleurDeBandeau,
  estThemeSombre,
  themeParId,
  themeValide,
} from '@haikodev/shared';

test('quatre thèmes, deux clairs et deux sombres, deux plats', () => {
  assert.equal(THEMES.length, 4);
  assert.deepEqual(
    THEMES.map((theme) => theme.id),
    ['sombre', 'clair', 'sable', 'ardoise'],
  );
  assert.equal(THEMES.filter((theme) => theme.clarte === 'sombre').length, 2);
  assert.equal(THEMES.filter((theme) => theme.clarte === 'clair').length, 2);
  // Les deux thèmes d'origine gardent leurs bordures ; les deux nouveaux non.
  assert.deepEqual(
    THEMES.filter((theme) => theme.plat).map((theme) => theme.id),
    ['sable', 'ardoise'],
  );
});

test('chaque thème porte un nom, une phrase et quatre couleurs d’aperçu', () => {
  for (const theme of THEMES) {
    assert.ok(theme.libelle.length > 2, theme.id);
    assert.ok(theme.description.length > 20, theme.id);
    assert.equal(theme.apercu.length, 4, theme.id);
    for (const couleur of theme.apercu) {
      assert.match(couleur, /^hsl\(\d+(\.\d+)? \d+% \d+%\)$/, `${theme.id} : ${couleur}`);
    }
  }
});

test('les anciens noms enregistrés sont REPRIS, jamais perdus', () => {
  // Un utilisateur qui avait choisi le clair ne se réveille pas en sombre.
  assert.equal(themeValide('light'), 'clair');
  assert.equal(themeValide('dark'), 'sombre');
  assert.equal(themeValide('LIGHT'), 'clair');
  assert.equal(themeValide('  dark  '), 'sombre');
});

test('une valeur inconnue, absente ou d’un autre type retombe sur le défaut', () => {
  assert.equal(APPARENCE_PAR_DEFAUT, 'sombre');
  assert.equal(themeValide(undefined), 'sombre');
  assert.equal(themeValide(null), 'sombre');
  assert.equal(themeValide(42), 'sombre');
  assert.equal(themeValide('turquoise'), 'sombre');
  // Et la fiche rendue n'est JAMAIS indéfinie : un écran ne se garde pas d'un vide.
  assert.equal(themeParId('turquoise').id, 'sombre');
});

test('les quatre noms se reconnaissent eux-mêmes', () => {
  for (const theme of THEMES) assert.equal(themeValide(theme.id), theme.id);
});

test('la clarté décide de la classe « dark » et du bandeau du téléphone', () => {
  assert.equal(estThemeSombre('sombre'), true);
  assert.equal(estThemeSombre('ardoise'), true);
  assert.equal(estThemeSombre('clair'), false);
  assert.equal(estThemeSombre('sable'), false);
  // Le bandeau prend le FOND DE PAGE du thème, jamais une couleur choisie à part.
  for (const theme of THEMES) assert.equal(couleurDeBandeau(theme.id), theme.apercu[0]);
});
