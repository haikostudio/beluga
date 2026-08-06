import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLE_VOIX_POSITION,
  DECALAGE_VOIX_DEFAUT,
  MARGE_VOIX,
  SEUIL_ACCROCHE_VOIX,
  SEUIL_GLISSEMENT_VOIX,
  bordDaccroche,
  correctionOuverture,
  decalageAccroche,
  decalageRetenu,
  estBordVoix,
  estDecalageVoix,
  estUnGlissement,
  memeDecalage,
  placeRetenue,
  ramenerDansLEcran,
  sensDouverture,
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

/* ------------------------------------------------------------------ */
/* Le panneau s'ouvre du côté où il y a de la place                    */
/* ------------------------------------------------------------------ */

// Un téléphone étroit et un panneau bien plus large que le rond de 44 px : le
// cas où le panneau centré déborderait s'il ne choisissait pas son côté.
const tel = { width: 402, height: 874 };
const ROND = { width: 44, height: 44 };
const PANNEAU = { width: 256, height: 300 };
/** La boîte du rond, à l'écran, d'après le centre en X et le bas en Y. */
const rond = (centreX: number, bas: number) => ({
  left: centreX - ROND.width / 2,
  top: bas - ROND.height,
  width: ROND.width,
  height: ROND.height,
});

test('au centre en bas, le panneau reste centré et grandit vers le haut', () => {
  const sens = sensDouverture(rond(201, 874), PANNEAU, tel);
  assert.deepEqual(sens, { horizontal: 'centre', vertical: 'haut' });
  assert.deepEqual(correctionOuverture(sens, PANNEAU, ROND), { x: 0, y: 0 });
});

test('collé au bord droit, le panneau s’ouvre vers la gauche', () => {
  const sens = sensDouverture(rond(402 - 8 - 22, 874), PANNEAU, tel);
  assert.equal(sens.horizontal, 'gauche');
  assert.equal(sens.vertical, 'haut');
  // On ancre le bord droit du panneau sur le bouton : correction négative.
  assert.deepEqual(correctionOuverture(sens, PANNEAU, ROND), {
    x: ROND.width / 2 - PANNEAU.width / 2,
    y: 0,
  });
});

test('collé au bord gauche, le panneau s’ouvre vers la droite', () => {
  const sens = sensDouverture(rond(8 + 22, 874), PANNEAU, tel);
  assert.equal(sens.horizontal, 'droite');
  assert.equal(sens.vertical, 'haut');
  assert.deepEqual(correctionOuverture(sens, PANNEAU, ROND), {
    x: PANNEAU.width / 2 - ROND.width / 2,
    y: 0,
  });
});

test('posé en haut de l’écran, le panneau se déplie vers le bas', () => {
  const sens = sensDouverture(rond(201, 52), PANNEAU, tel);
  assert.equal(sens.horizontal, 'centre');
  assert.equal(sens.vertical, 'bas');
  assert.deepEqual(correctionOuverture(sens, PANNEAU, ROND), {
    x: 0,
    y: PANNEAU.height - ROND.height,
  });
});

test('dans le coin haut-droit, le panneau s’ouvre vers la gauche ET vers le bas', () => {
  const sens = sensDouverture(rond(402 - 8 - 22, 52), PANNEAU, tel);
  assert.deepEqual(sens, { horizontal: 'gauche', vertical: 'bas' });
  const corr = correctionOuverture(sens, PANNEAU, ROND);
  assert.ok(corr.x < 0 && corr.y > 0);
});

test('le panneau choisi reste entièrement dans l’écran, aucun bord dehors', () => {
  // Pour chaque coin et chaque bord, la boîte du panneau, une fois posée, tient
  // dans la fenêtre à la marge près.
  const places = [
    rond(201, 866), // bas centre (bas du rond à la marge du bord bas)
    rond(8 + 22, 866), // bas gauche
    rond(402 - 8 - 22, 866), // bas droit
    rond(201, 52), // haut centre (haut du rond à la marge du bord haut)
    rond(8 + 22, 52), // haut gauche
    rond(402 - 8 - 22, 52), // haut droit
  ];
  for (const r of places) {
    const sens = sensDouverture(r, PANNEAU, tel);
    const corr = correctionOuverture(sens, PANNEAU, ROND);
    // Le centre en X du panneau = centre du rond + correction ; le bas du panneau
    // = bas du rond + correction (Y vers le bas). On en déduit ses bords.
    const centreX = r.left + r.width / 2 + corr.x;
    const gauche = centreX - PANNEAU.width / 2;
    const droite = centreX + PANNEAU.width / 2;
    const basPanneau = r.top + r.height + corr.y;
    const hautPanneau = basPanneau - PANNEAU.height;
    assert.ok(gauche >= MARGE_VOIX - 0.5, `bord gauche ${gauche}`);
    assert.ok(droite <= tel.width - MARGE_VOIX + 0.5, `bord droit ${droite}`);
    assert.ok(hautPanneau >= MARGE_VOIX - 0.5, `bord haut ${hautPanneau}`);
    assert.ok(basPanneau <= tel.height - MARGE_VOIX + 0.5, `bord bas ${basPanneau}`);
  }
});

test('module fermé, la correction d’ouverture est nulle quel que soit le côté', () => {
  // Le panneau a la taille du rond : rien à corriger, le bouton ne bouge pas.
  for (const s of [
    { horizontal: 'gauche', vertical: 'bas' },
    { horizontal: 'droite', vertical: 'haut' },
    { horizontal: 'centre', vertical: 'haut' },
  ] as const) {
    assert.deepEqual(correctionOuverture(s, ROND, ROND), { x: 0, y: 0 });
  }
});

/* ------------------------------------------------------------------ */
/* Accrocher le module à un bord                                       */
/* ------------------------------------------------------------------ */

test('la place retenue lit l’ancien format (décalage seul) comme une place libre', () => {
  assert.deepEqual(placeRetenue({ x: 10, y: -20 }), { x: 10, y: -20 });
  assert.equal(placeRetenue({ x: 10, y: -20 }).bord, undefined);
  // Une place abîmée retombe sur l’origine, libre.
  assert.deepEqual(placeRetenue('12,4'), { x: 0, y: 0 });
});

test('un bord valide retenu donne une place accrochée', () => {
  assert.equal(estBordVoix('gauche'), true);
  assert.equal(estBordVoix('droite'), true);
  assert.equal(estBordVoix('bas'), true);
  // Jamais le haut : la barre du haut y vit déjà.
  assert.equal(estBordVoix('haut'), false);
  assert.equal(estBordVoix('milieu'), false);
  const p = placeRetenue({ x: 5, y: -100, bord: 'droite' });
  assert.deepEqual(p, { x: 5, y: -100, bord: 'droite' });
  // Un bord invalide est ignoré : la place reste libre.
  assert.equal(placeRetenue({ x: 5, y: -100, bord: 'haut' }).bord, undefined);
});

// Une fenêtre et un rond posé quelque part : le bord le plus proche décide.
const fen = { width: 1000, height: 800 };

test('lâché tout contre un bord, le module s’y accroche', () => {
  // La règle de visibilité maintient le module à MARGE_VOIX du bord : cette
  // distance est bien sous le seuil d’accroche.
  assert.ok(MARGE_VOIX < SEUIL_ACCROCHE_VOIX);
  // Contre le bord droit (rond de 44).
  assert.equal(
    bordDaccroche({ left: 1000 - MARGE_VOIX - 44, top: 400, width: 44, height: 44 }, fen),
    'droite',
  );
  // Contre le bord gauche.
  assert.equal(bordDaccroche({ left: MARGE_VOIX, top: 400, width: 44, height: 44 }, fen), 'gauche');
  // Contre le bord bas.
  assert.equal(
    bordDaccroche({ left: 480, top: 800 - MARGE_VOIX - 44, width: 44, height: 44 }, fen),
    'bas',
  );
});

test('lâché au centre, le module ne s’accroche à rien', () => {
  assert.equal(bordDaccroche({ left: 480, top: 380, width: 44, height: 44 }, fen), null);
});

test('jamais d’accroche au bord du haut', () => {
  // Tout contre le haut, mais loin des trois bords accrochables : pas d’accroche.
  assert.equal(bordDaccroche({ left: 480, top: 0, width: 44, height: 44 }, fen), null);
});

test('le bord le plus proche l’emporte', () => {
  // Proche du bas ET de la droite, mais la droite est plus proche.
  const rond = { left: 1000 - 44 - 5, top: 800 - 44 - 15, width: 44, height: 44 };
  assert.equal(bordDaccroche(rond, fen), 'droite');
});

// La place à donner au module accroché. L’origine (bas du rond sans décalage)
// est posée en bas au centre, comme dans l’app.
const originBas = 760; // le bas du rond d’origine, à 40 px du bord bas
const place = { x: 0, y: -200 }; // lâché haut-centre, puis accroché

test('accroché à droite et fermé, la pastille est à moitié hors de l’écran', () => {
  const pastille = 30;
  const d = decalageAccroche('droite', place, originBas, fen, pastille, true);
  // Le centre horizontal se pose sur le bord droit : moitié de la pastille dehors.
  const centreX = fen.width / 2 + d.x;
  assert.equal(centreX, fen.width);
  // Verticalement, elle reste dans l’écran, à la hauteur du lâcher.
  const bas = originBas + d.y;
  assert.ok(bas - pastille >= MARGE_VOIX && bas <= fen.height - MARGE_VOIX);
});

test('accroché à gauche et fermé, la pastille sort par la gauche', () => {
  const d = decalageAccroche('gauche', place, originBas, fen, 30, true);
  assert.equal(fen.width / 2 + d.x, 0);
});

test('accroché en bas et fermé, la pastille sort par le bas', () => {
  const pastille = 30;
  const d = decalageAccroche('bas', { x: 0, y: 0 }, originBas, fen, pastille, true);
  const bas = originBas + d.y;
  // Le centre vertical se pose sur le bord bas : moitié de la pastille dehors.
  assert.equal(bas - pastille / 2, fen.height);
});

test('accroché et OUVERT, le rond rentre entièrement, au ras du bord', () => {
  const d = decalageAccroche('droite', place, originBas, fen, 44, false);
  const centreX = fen.width / 2 + d.x;
  // Bord droit du rond AU RAS du bord de l’écran : entièrement visible, et le
  // panneau qui s’ouvre vers l’intérieur recouvre la bande de la pastille.
  assert.equal(centreX + 44 / 2, fen.width);
});

test('accroché sur un bord vertical, la hauteur reste dans l’écran', () => {
  // Lâché très haut : la pastille est ramenée sous le bord haut.
  const d = decalageAccroche('droite', { x: 0, y: -5000 }, originBas, fen, 30, true);
  const bas = originBas + d.y;
  assert.equal(bas - 30, MARGE_VOIX);
});
