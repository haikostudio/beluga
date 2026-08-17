import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHOIX_DE_THEME,
  THEMES,
  THEME_SYSTEME,
  APPARENCE_PAR_DEFAUT,
  choixParId,
  couleurDeBandeau,
  estThemeSombre,
  themeAAppliquer,
  themeChoisiValide,
  themeDuSysteme,
  themeParId,
  themeValide,
} from '@haikodev/shared';

test('quatre thèmes, deux clairs et deux sombres, trois plats', () => {
  assert.equal(THEMES.length, 4);
  assert.deepEqual(
    THEMES.map((theme) => theme.id),
    ['sombre', 'clair', 'sable', 'ardoise'],
  );
  assert.equal(THEMES.filter((theme) => theme.clarte === 'sombre').length, 2);
  assert.equal(THEMES.filter((theme) => theme.clarte === 'clair').length, 2);
  // Le CLAIR est le dernier thème à bordures : les trois autres se lisent au fond.
  assert.deepEqual(
    THEMES.filter((theme) => theme.plat).map((theme) => theme.id),
    ['sombre', 'sable', 'ardoise'],
  );
  assert.deepEqual(
    THEMES.filter((theme) => !theme.plat).map((theme) => theme.id),
    ['clair'],
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

test('« Système » se choisit sans être un thème : il n’a pas de palette', () => {
  // Cinq choix au menu, quatre palettes derrière : c'est toute la nuance.
  assert.equal(CHOIX_DE_THEME.length, 5);
  assert.deepEqual(
    CHOIX_DE_THEME.map((choix) => choix.id),
    ['sombre', 'clair', 'sable', 'ardoise', 'systeme'],
  );
  assert.equal(
    THEMES.some((theme) => (theme.id as string) === THEME_SYSTEME),
    false,
  );
  // Il désigne les deux thèmes d'ORIGINE, pas un beige surprise.
  assert.equal(themeDuSysteme(true), 'sombre');
  assert.equal(themeDuSysteme(false), 'clair');
});

test('un choix vide rend « rien de choisi », pas le thème par défaut', () => {
  // C'est ce qui distingue « ce projet n'impose aucun thème » de « il impose le sombre ».
  assert.equal(themeChoisiValide(undefined), null);
  assert.equal(themeChoisiValide(null), null);
  assert.equal(themeChoisiValide(''), null);
  assert.equal(themeChoisiValide('turquoise'), null);
  assert.equal(themeChoisiValide('systeme'), 'systeme');
  assert.equal(themeChoisiValide('light'), 'clair');
  assert.equal(choixParId('systeme')?.libelle, 'Système');
  assert.equal(choixParId('turquoise'), null);
});

test('LE THÈME DU PROJET OUVERT PASSE DEVANT LE RÉGLAGE GÉNÉRAL', () => {
  assert.deepEqual(themeAAppliquer({ duProjet: 'sable', general: 'ardoise' }), {
    theme: 'sable',
    source: 'projet',
    choisi: 'sable',
    parLeSysteme: false,
  });
  // Un projet sans thème rend la main au réglage général.
  assert.deepEqual(themeAAppliquer({ duProjet: null, general: 'ardoise' }), {
    theme: 'ardoise',
    source: 'general',
    choisi: 'ardoise',
    parLeSysteme: false,
  });
  // Et un projet dont le thème est illisible ne bloque pas l'application.
  assert.equal(themeAAppliquer({ duProjet: 'turquoise', general: 'sable' }).theme, 'sable');
});

test('« Système » est tranché par le réglage de l’ordinateur, où qu’il soit choisi', () => {
  assert.deepEqual(themeAAppliquer({ general: 'systeme', systemeSombre: true }), {
    theme: 'sombre',
    source: 'general',
    choisi: 'systeme',
    parLeSysteme: true,
  });
  assert.equal(themeAAppliquer({ general: 'systeme', systemeSombre: false }).theme, 'clair');
  // Un PROJET peut lui aussi suivre l'ordinateur, et il passe toujours devant.
  const parLeProjet = themeAAppliquer({ duProjet: 'systeme', general: 'sable', systemeSombre: true });
  assert.equal(parLeProjet.theme, 'sombre');
  assert.equal(parLeProjet.source, 'projet');
  assert.equal(parLeProjet.parLeSysteme, true);
  // Réglage de l'ordinateur inconnu : on ne devine pas le sombre.
  assert.equal(themeAAppliquer({ general: 'systeme' }).theme, 'clair');
});

test('rien de réglé nulle part : le défaut, jamais un vide', () => {
  assert.deepEqual(themeAAppliquer({}), {
    theme: 'sombre',
    source: 'general',
    choisi: 'sombre',
    parLeSysteme: false,
  });
});

test('la clarté décide de la classe « dark » et du bandeau du téléphone', () => {
  assert.equal(estThemeSombre('sombre'), true);
  assert.equal(estThemeSombre('ardoise'), true);
  assert.equal(estThemeSombre('clair'), false);
  assert.equal(estThemeSombre('sable'), false);
  // Le bandeau prend le FOND DE PAGE du thème, jamais une couleur choisie à part.
  for (const theme of THEMES) assert.equal(couleurDeBandeau(theme.id), theme.apercu[0]);
});
