import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLE_VOIX_POSITION,
  DECALAGE_VOIX_DEFAUT,
  MARGE_VOIX,
  SEUIL_GLISSEMENT_VOIX,
  decalageRetenu,
  estDecalageVoix,
  estUnGlissement,
  memeDecalage,
  ramenerDansLEcran,
} from '@haikodev/shared';

/*
 * Le module de voix se déplace et sa place est retenue dans le compte. Ce qui
 * est retenu est un DÉCALAGE par rapport à la place d'origine (bas au centre) ;
 * il est toujours ramené dans les bords pour que le module reste attrapable.
 */

/* ------------------------------------------------------------------ */
/* Ce qui est retenu                                                   */
/* ------------------------------------------------------------------ */

test('la clé de préférence est propre au module de voix, jamais celle du bloc du dock', () => {
  assert.equal(CLE_VOIX_POSITION, 'voix');
  assert.notEqual(CLE_VOIX_POSITION, 'dock');
});

test('sans rien de retenu, le module ne bouge pas de sa place d’origine', () => {
  assert.deepEqual(DECALAGE_VOIX_DEFAUT, { x: 0, y: 0 });
  assert.deepEqual(decalageRetenu(undefined), DECALAGE_VOIX_DEFAUT);
});

test('une préférence abîmée retombe sur la place d’origine', () => {
  assert.equal(estDecalageVoix({ x: 10, y: -20 }), true);
  assert.equal(estDecalageVoix({ x: 10 }), false);
  assert.equal(estDecalageVoix({ x: 'gauche', y: 0 }), false);
  assert.equal(estDecalageVoix({ x: Number.NaN, y: 0 }), false);
  assert.equal(estDecalageVoix(null), false);
  assert.equal(estDecalageVoix('12,4'), false);
  assert.deepEqual(decalageRetenu({ x: 'gauche', y: 0 }), DECALAGE_VOIX_DEFAUT);
});

/* ------------------------------------------------------------------ */
/* Le module reste entièrement visible                                 */
/* ------------------------------------------------------------------ */

const fenetre = { width: 1000, height: 800 };
// Le module d'origine : 44 px de côté, centré en bas.
const ancre = { left: 478, top: 730, width: 44, height: 44 };

test('un décalage qui tient dans l’écran est laissé tel quel', () => {
  assert.deepEqual(ramenerDansLEcran({ x: -100, y: -200 }, ancre, fenetre), { x: -100, y: -200 });
});

test('un décalage qui sort par la gauche est ramené contre le bord', () => {
  const corrige = ramenerDansLEcran({ x: -5000, y: 0 }, ancre, fenetre);
  assert.equal(corrige.x, MARGE_VOIX - ancre.left);
  assert.equal(ancre.left + corrige.x, MARGE_VOIX);
});

test('un décalage qui sort par la droite est ramené contre le bord', () => {
  const corrige = ramenerDansLEcran({ x: 5000, y: 0 }, ancre, fenetre);
  assert.equal(ancre.left + corrige.x + ancre.width, fenetre.width - MARGE_VOIX);
});

test('un décalage qui sort par le haut ou par le bas est ramené dans l’écran', () => {
  const haut = ramenerDansLEcran({ x: 0, y: -5000 }, ancre, fenetre);
  assert.equal(ancre.top + haut.y, MARGE_VOIX);
  const bas = ramenerDansLEcran({ x: 0, y: 5000 }, ancre, fenetre);
  assert.equal(ancre.top + bas.y + ancre.height, fenetre.height - MARGE_VOIX);
});

test('une position venue d’un grand écran revient dans un petit écran', () => {
  // Retenue sur un grand écran, elle enverrait le module hors du téléphone.
  const petit = { width: 390, height: 700 };
  const ancrePetite = { left: 173, top: 630, width: 44, height: 44 };
  const corrige = ramenerDansLEcran({ x: 700, y: 0 }, ancrePetite, petit);
  assert.ok(ancrePetite.left + corrige.x >= MARGE_VOIX);
  assert.ok(ancrePetite.left + corrige.x + ancrePetite.width <= petit.width - MARGE_VOIX);
});

test('un module plus grand que la fenêtre est collé au bord, jamais rogné n’importe où', () => {
  const etroite = { width: 200, height: 200 };
  const gros = { left: 0, top: 0, width: 400, height: 400 };
  const corrige = ramenerDansLEcran({ x: 300, y: 300 }, gros, etroite);
  assert.equal(corrige.x, MARGE_VOIX);
  assert.equal(corrige.y, MARGE_VOIX);
});

test('deux décalages égaux au pixel près ne font pas réécrire la préférence', () => {
  assert.equal(memeDecalage({ x: 12.2, y: -4.4 }, { x: 12, y: -4 }), true);
  assert.equal(memeDecalage({ x: 12, y: -4 }, { x: 13, y: -4 }), false);
});

/* ------------------------------------------------------------------ */
/* Déplacer ou déplier : c'est le mouvement qui tranche                */
/* ------------------------------------------------------------------ */

test('un appui immobile reste un clic, un appui qui glisse déplace', () => {
  assert.equal(estUnGlissement(0, 0), false);
  assert.equal(estUnGlissement(2, -1), false);
  assert.equal(estUnGlissement(SEUIL_GLISSEMENT_VOIX, 0), true);
  assert.equal(estUnGlissement(0, -SEUIL_GLISSEMENT_VOIX), true);
  assert.equal(estUnGlissement(60, 40), true);
});
