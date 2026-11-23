import test from 'node:test';
import assert from 'node:assert/strict';
import { imageDuMorphing, etapeDuMorphing, centreDuRond, coinsDuBouton, FIN_DE_L_OUVERTURE, DIAMETRE_DU_ROND, type GeometrieDuMorphing } from '@beluga/shared';

/* LE BOUTON DU BORD DEVIENT LA BULLE, ET L'INVERSE (17/11/2026, illustration #0666). */
const g: GeometrieDuMorphing = {
  bouton: { x: 1410, y: 300, w: 30, h: 30 },
  bord: 'droite',
  cible: { x: 1024, y: 700, w: 340, h: 184 },
  centreCible: { x: 1194, y: 760 },
  rayonCible: 22,
};

test('les étapes se suivent : traits, cercle, glisse, bulle, ondes', () => {
  assert.equal(etapeDuMorphing(0).etape, 'traits');
  assert.equal(etapeDuMorphing(0.2).etape, 'cercle');
  assert.equal(etapeDuMorphing(0.45).etape, 'glisse');
  assert.equal(etapeDuMorphing(0.7).etape, 'bulle');
  assert.equal(etapeDuMorphing(0.95).etape, 'ondes');
  assert.equal(FIN_DE_L_OUVERTURE, 0.85, 'l’ouverture s’arrête avant les ondes : la bulle les fait elle-même');
});

test('au départ, le calque EST le bouton ; à la fin de l’ouverture, il EST la bulle', () => {
  const debut = imageDuMorphing(0, g, 1440, 900);
  assert.deepEqual(debut.boite, g.bouton);
  assert.deepEqual(debut.coins, coinsDuBouton('droite', 15));
  assert.equal(debut.fond, 0);
  const fin = imageDuMorphing(FIN_DE_L_OUVERTURE, g, 1440, 900);
  assert.deepEqual(fin.boite, g.cible);
  assert.deepEqual(fin.coins, [22, 22, 22, 22]);
  assert.equal(fin.fond, 1);
  assert.deepEqual(fin.centre, g.centreCible);
});

test('le bouton se décolle du bord en devenant rond, puis le rond glisse jusqu’au centre du cercle de la bulle', () => {
  const rond = imageDuMorphing(0.32, g, 1440, 900);
  assert.equal(rond.boite.w, DIAMETRE_DU_ROND);
  assert.deepEqual(rond.coins, [27, 27, 27, 27]);
  assert.deepEqual(rond.centre, centreDuRond(g.bouton, 'droite', 1440, 900));
  assert.ok(rond.boite.x + rond.boite.w <= 1440 - 10, 'décollé du bord');
  const arrive = imageDuMorphing(0.58, g, 1440, 900);
  assert.deepEqual(arrive.centre, g.centreCible);
  assert.equal(arrive.boite.w, DIAMETRE_DU_ROND);
});

test('le mouvement est continu : pas de saut entre deux images voisines', () => {
  let avant = imageDuMorphing(0, g, 1440, 900);
  for (let i = 1; i <= 1000; i += 1) {
    const img = imageDuMorphing(i / 1000, g, 1440, 900);
    for (const cle of ['x', 'y', 'w', 'h'] as const) assert.ok(Math.abs(img.boite[cle] - avant.boite[cle]) < 12, `${cle} à ${i / 1000}`);
    avant = img;
  }
});

test('depuis un bouton à gauche ou en haut, le rond se décolle vers l’intérieur', () => {
  assert.equal(centreDuRond({ x: 0, y: 300, w: 30, h: 30 }, 'gauche', 1440, 900).x, 10 + 27);
  assert.equal(centreDuRond({ x: 600, y: 0, w: 30, h: 30 }, 'haut', 1440, 900).y, 10 + 27);
});
