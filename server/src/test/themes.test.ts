import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AMBIANCES,
  THEMES,
  APPARENCE_PAR_DEFAUT,
  REGLAGE_APPARENCE_PAR_DEFAUT,
  ambianceParId,
  couleurDeBandeau,
  estThemeSombre,
  reglageApparenceValide,
  themeAAppliquer,
  themeChoisiDepuisReglage,
  themeChoisiValide,
  themeDeLAmbiance,
  themeDuSysteme,
  themeParId,
  themeValide,
} from '@haikodev/shared';

test('six ambiances ont chacune une variante claire et une variante sombre', () => {
  assert.equal(AMBIANCES.length, 6);
  assert.equal(THEMES.length, 12);
  assert.deepEqual(
    AMBIANCES.map((ambiance) => ambiance.id),
    ['origine', 'sable', 'ardoise', 'givre', 'sapin', 'contraste'],
  );
  for (const ambiance of AMBIANCES) {
    const clair = themeParId(ambiance.variantes.clair);
    const sombre = themeParId(ambiance.variantes.sombre);
    assert.equal(clair.ambiance, ambiance.id);
    assert.equal(clair.clarte, 'clair');
    assert.equal(sombre.ambiance, ambiance.id);
    assert.equal(sombre.clarte, 'sombre');
    assert.notEqual(clair.id, sombre.id);
  }
  assert.equal(THEMES.filter((theme) => theme.clarte === 'clair').length, 6);
  assert.equal(THEMES.filter((theme) => theme.clarte === 'sombre').length, 6);
  assert.deepEqual(THEMES.filter((theme) => !theme.plat).map((theme) => theme.id), ['clair']);
});

test('chaque palette porte un nom, une phrase et quatre couleurs d’aperçu', () => {
  for (const theme of THEMES) {
    assert.ok(theme.libelle.length > 2, theme.id);
    assert.ok(theme.description.length > 20, theme.id);
    assert.equal(theme.apercu.length, 4, theme.id);
    for (const couleur of theme.apercu) {
      assert.match(couleur, /^hsl\(\d+(\.\d+)? \d+% \d+%\)$/, `${theme.id} : ${couleur}`);
    }
  }
});

test('les anciens choix sont repris sans changer leur apparence', () => {
  assert.equal(themeValide('light'), 'clair');
  assert.equal(themeValide('dark'), 'sombre');
  assert.deepEqual(reglageApparenceValide('sable'), {
    ambiance: 'sable',
    clarte: 'clair',
    automatique: false,
  });
  assert.deepEqual(reglageApparenceValide('ardoise'), {
    ambiance: 'ardoise',
    clarte: 'sombre',
    automatique: false,
  });
  assert.deepEqual(reglageApparenceValide('systeme'), {
    ambiance: 'origine',
    clarte: 'sombre',
    automatique: true,
  });
});

test('une valeur inconnue retombe sur le défaut seulement quand un thème réel est exigé', () => {
  assert.equal(APPARENCE_PAR_DEFAUT, 'sombre');
  assert.equal(themeValide('turquoise'), 'sombre');
  assert.equal(themeParId('turquoise').id, 'sombre');
  assert.equal(ambianceParId('turquoise').id, 'origine');
  assert.equal(reglageApparenceValide('turquoise'), null);
  assert.equal(themeChoisiValide('turquoise'), null);
});

test('le réglage enregistré garde l’ambiance, le choix manuel et l’automatique', () => {
  const reglage = { ambiance: 'givre', clarte: 'sombre', automatique: true } as const;
  assert.equal(themeChoisiDepuisReglage(reglage), 'auto-givre-sombre');
  assert.deepEqual(reglageApparenceValide('auto-givre-sombre'), reglage);
  assert.equal(themeChoisiValide('systeme'), 'auto-origine-sombre');
  assert.equal(themeChoisiValide('light'), 'clair');
});

test('le thème du projet passe devant le réglage général', () => {
  const applique = themeAAppliquer({ duProjet: 'sable-sombre', general: 'ardoise-clair' });
  assert.equal(applique.theme, 'sable-sombre');
  assert.equal(applique.source, 'projet');
  assert.equal(applique.ambiance, 'sable');
  assert.equal(applique.clarteAppliquee, 'sombre');
  assert.equal(applique.automatique, false);

  const general = themeAAppliquer({ duProjet: null, general: 'ardoise-clair' });
  assert.equal(general.theme, 'ardoise-clair');
  assert.equal(general.source, 'general');
});

test('le mode automatique change la clarté sans changer l’ambiance', () => {
  const sombre = themeAAppliquer({ general: 'auto-sable-clair', systemeSombre: true });
  assert.equal(sombre.theme, 'sable-sombre');
  assert.equal(sombre.ambiance, 'sable');
  assert.equal(sombre.clarteChoisie, 'clair');
  assert.equal(sombre.clarteAppliquee, 'sombre');
  assert.equal(sombre.parLeSysteme, true);

  const clair = themeAAppliquer({ general: 'auto-sable-clair', systemeSombre: false });
  assert.equal(clair.theme, 'sable');
  assert.equal(themeDuSysteme('ardoise', false), 'ardoise-clair');
  assert.equal(themeDuSysteme('ardoise', true), 'ardoise');
});

test('rien de réglé nulle part conserve le sombre d’origine', () => {
  assert.deepEqual(REGLAGE_APPARENCE_PAR_DEFAUT, {
    ambiance: 'origine',
    clarte: 'sombre',
    automatique: false,
  });
  const applique = themeAAppliquer({});
  assert.equal(applique.theme, 'sombre');
  assert.equal(applique.source, 'general');
  assert.equal(applique.automatique, false);
});

test('la clarté de chaque variante décide de la classe dark et du bandeau', () => {
  for (const ambiance of AMBIANCES) {
    const clair = themeDeLAmbiance(ambiance.id, 'clair');
    const sombre = themeDeLAmbiance(ambiance.id, 'sombre');
    assert.equal(estThemeSombre(clair), false, clair);
    assert.equal(estThemeSombre(sombre), true, sombre);
  }
  for (const theme of THEMES) assert.equal(couleurDeBandeau(theme.id), theme.apercu[0]);
});
