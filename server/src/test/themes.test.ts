import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AMBIANCES,
  ANCIENS_THEMES,
  THEMES,
  APPARENCE_PAR_DEFAUT,
  REGLAGE_APPARENCE_PAR_DEFAUT,
  ambianceParId,
  apparenceRetenue,
  causeDeLaBascule,
  couleurDeBandeau,
  estThemeSombre,
  hslEnHexadecimal,
  reglageApparenceValide,
  themeAAppliquer,
  themeChoisiDepuisReglage,
  themeChoisiValide,
  themeDeLAmbiance,
  themeDuSysteme,
  themeParId,
  themeValide,
} from '@beluga/shared';

test('une seule apparence, en deux clartés', () => {
  assert.equal(AMBIANCES.length, 1);
  assert.deepEqual(
    THEMES.map((theme) => theme.id),
    ['sombre', 'clair'],
  );
  const [ambiance] = AMBIANCES;
  assert.equal(ambiance!.id, 'origine');
  assert.equal(themeParId(ambiance!.variantes.clair).clarte, 'clair');
  assert.equal(themeParId(ambiance!.variantes.sombre).clarte, 'sombre');
  /* Les deux palettes sont plates : plus aucune n'a de teinte. */
  assert.deepEqual(THEMES.filter((theme) => !theme.plat), []);
});

test('chaque palette porte un nom, une phrase et quatre couleurs d’aperçu sans teinte', () => {
  for (const theme of THEMES) {
    assert.ok(theme.libelle.length > 2, theme.id);
    assert.ok(theme.description.length > 20, theme.id);
    assert.equal(theme.apercu.length, 4, theme.id);
    for (const couleur of theme.apercu) {
      /* Noir et blanc : teinte 0, saturation 0 — seule la clarté varie. */
      assert.match(couleur, /^hsl\(0 0% \d+(\.\d+)?%\)$/, `${theme.id} : ${couleur}`);
    }
  }
});

test('les dix palettes retirées se relisent comme leur clarté', () => {
  const attendu: Record<string, 'clair' | 'sombre'> = {
    sable: 'clair',
    'sable-sombre': 'sombre',
    ardoise: 'sombre',
    'ardoise-clair': 'clair',
    givre: 'clair',
    'givre-sombre': 'sombre',
    sapin: 'sombre',
    'sapin-clair': 'clair',
    contraste: 'clair',
    'contraste-sombre': 'sombre',
  };
  for (const [ancien, clarte] of Object.entries(attendu)) {
    assert.equal(ANCIENS_THEMES[ancien], clarte, ancien);
    assert.equal(themeValide(ancien), clarte, ancien);
    assert.deepEqual(reglageApparenceValide(ancien), { ambiance: 'origine', clarte, automatique: false }, ancien);
    /* Le réglage général et le repère local passent tous par là. */
    assert.equal(themeAAppliquer({ general: ancien }).theme, clarte, ancien);
  }
});

test('les tout premiers noms sont repris aussi', () => {
  assert.equal(themeValide('light'), 'clair');
  assert.equal(themeValide('dark'), 'sombre');
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

test('le réglage enregistré garde le choix manuel et l’automatique, sous une forme que les serveurs en service relisent', () => {
  const reglage = { ambiance: 'origine', clarte: 'sombre', automatique: true } as const;
  assert.equal(themeChoisiDepuisReglage(reglage), 'auto-origine-sombre');
  assert.deepEqual(reglageApparenceValide('auto-origine-sombre'), reglage);
  /* Un automatique d'une ancienne ambiance garde sa clarté de repli, pas son ambiance. */
  assert.deepEqual(reglageApparenceValide('auto-givre-clair'), {
    ambiance: 'origine',
    clarte: 'clair',
    automatique: true,
  });
  assert.equal(themeChoisiValide('auto-givre-clair'), 'auto-origine-clair');
  assert.equal(themeChoisiValide('systeme'), 'auto-origine-sombre');
  assert.equal(themeChoisiValide('light'), 'clair');
  assert.equal(themeChoisiValide('sapin'), 'sombre');
});

test('le réglage général s’applique seul, quel que soit le projet ouvert', () => {
  const applique = themeAAppliquer({ general: 'clair' });
  assert.equal(applique.theme, 'clair');
  assert.equal(applique.source, 'general');
  assert.equal(applique.ambiance, 'origine');
  assert.equal(applique.clarteAppliquee, 'clair');
  assert.equal(applique.automatique, false);

  /* Un ancien thème de projet, même encore présent dans l'entrée, ne compte plus. */
  const ancienneEntree = { duProjet: 'sombre', general: 'clair' } as Parameters<typeof themeAAppliquer>[0];
  assert.equal(themeAAppliquer(ancienneEntree).theme, 'clair');
  /* Changer de projet ne change rien : les entrées sont les mêmes. */
  assert.deepEqual(themeAAppliquer({ general: 'clair' }), themeAAppliquer({ general: 'clair' }));
});

test('le mode automatique suit la clarté de l’ordinateur', () => {
  const sombre = themeAAppliquer({ general: 'auto-origine-clair', systemeSombre: true });
  assert.equal(sombre.theme, 'sombre');
  assert.equal(sombre.clarteChoisie, 'clair');
  assert.equal(sombre.clarteAppliquee, 'sombre');
  assert.equal(sombre.parLeSysteme, true);

  const clair = themeAAppliquer({ general: 'auto-origine-clair', systemeSombre: false });
  assert.equal(clair.theme, 'clair');
  assert.equal(themeDuSysteme('origine', false), 'clair');
  assert.equal(themeDuSysteme('ardoise', true), 'sombre');
});

test('rien de réglé nulle part conserve le sombre', () => {
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

test('le réglage clair / sombre de l’ordinateur n’est écouté qu’en automatique', () => {
  assert.equal(themeAAppliquer({ general: 'sombre' }).ecouteLeSysteme, false);
  assert.equal(themeAAppliquer({ general: 'auto-origine-sombre' }).ecouteLeSysteme, true);
  /* Un réglage manuel ne bouge pas d'un pouce, quoi que dise l'ordinateur. */
  const manuelSombre = themeAAppliquer({ general: 'sombre', systemeSombre: false });
  const manuelClair = themeAAppliquer({ general: 'sombre', systemeSombre: true });
  assert.equal(manuelSombre.theme, 'sombre');
  assert.equal(manuelClair.theme, 'sombre');
  /* L'écoute ne s'ouvre que sur le réglage automatique. */
  assert.equal(themeAAppliquer({ general: 'clair' }).ecouteLeSysteme, false);
  assert.equal(themeAAppliquer({ general: 'auto-origine-sombre' }).ecouteLeSysteme, true);
});

test('un réglage qui revient vide ne remplace jamais le choix déjà connu', () => {
  assert.equal(apparenceRetenue(undefined, 'sombre'), 'sombre');
  /* Réponse du serveur repartie sans la clé : on garde ce qu'on avait. */
  assert.equal(apparenceRetenue('sombre', undefined), 'sombre');
  assert.equal(apparenceRetenue('sombre', ''), 'sombre');
  assert.equal(apparenceRetenue('sombre', 'turquoise'), 'sombre');
  /* Un vrai changement, lui, passe. */
  assert.equal(apparenceRetenue('sombre', 'clair'), 'clair');
  /* Un ancien nom encore en base reste un choix lisible : il n'est pas jeté. */
  assert.equal(apparenceRetenue(undefined, 'sapin'), 'sapin');
  /* Rien n'a jamais été connu : le défaut s'applique, sans rien remplacer. */
  assert.equal(apparenceRetenue(undefined, undefined), undefined);
  assert.equal(themeAAppliquer({ general: apparenceRetenue('clair', undefined) }).theme, 'clair');
});

test('chaque bascule d’apparence nomme l’entrée qui a bougé', () => {
  const manuel = { general: 'sombre', systemeSombre: false };
  /* Rien n'a bougé. */
  assert.deepEqual(causeDeLaBascule(manuel, manuel), []);
  /* Le même choix écrit autrement n'est pas un changement — y compris sous un ancien nom. */
  assert.deepEqual(causeDeLaBascule({ general: 'dark' }, { general: 'sombre' }), []);
  assert.deepEqual(causeDeLaBascule({ general: 'sapin' }, { general: 'sombre' }), []);
  /* En manuel, l'ordinateur peut basculer : il n'explique rien et ne change rien. */
  assert.deepEqual(causeDeLaBascule(manuel, { ...manuel, systemeSombre: true }), []);
  assert.equal(themeAAppliquer({ ...manuel, systemeSombre: true }).theme, 'sombre');
  /* En automatique, il redevient une cause légitime. */
  const auto = { general: 'auto-origine-sombre', systemeSombre: true };
  assert.deepEqual(causeDeLaBascule(auto, { ...auto, systemeSombre: false }), ['systeme']);
  /* Le réglage général se nomme aussi. */
  assert.deepEqual(causeDeLaBascule(manuel, { ...manuel, general: 'clair' }), ['general']);
});

test('la clarté décide de la classe dark et du bandeau', () => {
  const clair = themeDeLAmbiance('origine', 'clair');
  const sombre = themeDeLAmbiance('origine', 'sombre');
  assert.equal(estThemeSombre(clair), false);
  assert.equal(estThemeSombre(sombre), true);
  for (const theme of THEMES) {
    assert.equal(couleurDeBandeau(theme.id), hslEnHexadecimal(theme.apercu[0]));
    assert.match(couleurDeBandeau(theme.id), /^#[0-9a-f]{6}$/);
  }
});

test('le bandeau du téléphone se pose en hexadécimal', () => {
  assert.equal(hslEnHexadecimal('hsl(0 0% 13%)'), '#212121');
  assert.equal(hslEnHexadecimal('hsl(0 0% 100%)'), '#ffffff');
  assert.equal(hslEnHexadecimal('hsl(0 72% 46%)'), '#ca2121');
  assert.equal(hslEnHexadecimal('#123456'), '#123456');
});
