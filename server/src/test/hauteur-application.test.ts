/**
 * LA HAUTEUR DE L'APPLICATION INSTALLÉE : JAMAIS PLUS HAUTE QUE CE QUI SE VOIT.
 *
 * Un ami a installé l'application sur un iPhone Pro Max : le bas de
 * l'interface (boutons, pied) n'était pas visible. La hauteur de l'écran
 * physique était posée telle quelle, même quand la fenêtre était plus basse.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { hauteurDeLApplication } = await import('@beluga/shared');

const PRO_MAX = { ecranLargeur: 430, ecranHauteur: 932, zoneSureHaut: 59, zoneSureBas: 34 };

test('pas installée : rien à poser, la hauteur du navigateur suffit', () => {
  assert.equal(hauteurDeLApplication({ ...PRO_MAX, installee: false, fenetreLargeur: 430, fenetreHauteur: 800 }), null);
});

test('installée en portrait, sous les barres : la fenêtre vaut l’écran', () => {
  assert.equal(hauteurDeLApplication({ ...PRO_MAX, installee: true, fenetreLargeur: 430, fenetreHauteur: 932 }), 932);
});

test('démarrage à froid : la fenêtre manque une barre, on prend l’écran (pas de bande vide)', () => {
  assert.equal(hauteurDeLApplication({ ...PRO_MAX, installee: true, fenetreLargeur: 430, fenetreHauteur: 898 }), 932);
});

test('en paysage, iOS annonce encore l’écran en portrait : on ne prend pas 932', () => {
  const h = hauteurDeLApplication({
    ...PRO_MAX,
    zoneSureHaut: 0,
    zoneSureBas: 21,
    installee: true,
    fenetreLargeur: 932,
    fenetreHauteur: 430,
  });
  assert.equal(h, 430);
});

test('fenêtre plus basse que l’écran sans zones sûres : on prend la fenêtre, le bas reste visible', () => {
  const h = hauteurDeLApplication({
    ...PRO_MAX,
    zoneSureHaut: 0,
    zoneSureBas: 0,
    installee: true,
    fenetreLargeur: 430,
    fenetreHauteur: 839,
  });
  assert.equal(h, 839);
});

test('un manque bien plus grand que les barres : fenêtre réellement plus petite, on la suit', () => {
  const h = hauteurDeLApplication({ ...PRO_MAX, installee: true, fenetreLargeur: 430, fenetreHauteur: 700 });
  assert.equal(h, 700);
});

test('mesures absentes ou nulles : jamais une hauteur inventée', () => {
  assert.equal(hauteurDeLApplication({ ...PRO_MAX, installee: true, fenetreLargeur: 430, fenetreHauteur: 0 }), null);
  assert.equal(
    hauteurDeLApplication({ installee: true, ecranLargeur: 0, ecranHauteur: 0, fenetreLargeur: 430, fenetreHauteur: 800, zoneSureHaut: 0, zoneSureBas: 0 }),
    800,
  );
});

test('fenêtre plus haute que l’écran annoncé : on ne coupe pas, on suit la fenêtre', () => {
  assert.equal(
    hauteurDeLApplication({ ...PRO_MAX, ecranHauteur: 852, installee: true, fenetreLargeur: 430, fenetreHauteur: 932 }),
    932,
  );
});

test('barre d’état « default » : fenêtre posée SOUS l’heure, encart haut à 0, on garde la fenêtre', () => {
  /* iOS retire la barre d'état (≈ 54 pt) de la fenêtre et ne compte plus que
     la barre d'accueil : prendre l'écran ferait sortir le bas de l'application. */
  const h = hauteurDeLApplication({
    ...PRO_MAX,
    zoneSureHaut: 0,
    zoneSureBas: 34,
    installee: true,
    fenetreLargeur: 430,
    fenetreHauteur: 878,
  });
  assert.equal(h, 878);
});
