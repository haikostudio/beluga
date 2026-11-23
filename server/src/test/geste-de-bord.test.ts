import test from 'node:test';
import assert from 'node:assert/strict';

/* LE BOUTON DU BORD SUR LES QUATRE BORDS (carte « Jarvis : volet, voix et rapidité ») : la règle de la place. */
import {
  boiteDuBoutonDeBord,
  bordLePlusProche,
  placeAuBordLue,
  placeAuLacher,
  PLACE_AU_BORD_PAR_DEFAUT,
  LONGUEUR_DU_BOUTON_DE_BORD,
  EPAISSEUR_DU_BOUTON_DE_BORD,
  CONGE_DU_BOUTON_DE_BORD,
} from '@beluga/shared';

test('le lâcher choisit le bord le plus proche', () => {
  assert.equal(bordLePlusProche(5, 400, 1440, 900), 'gauche');
  assert.equal(bordLePlusProche(1430, 400, 1440, 900), 'droite');
  assert.equal(bordLePlusProche(700, 8, 1440, 900), 'haut');
  assert.equal(bordLePlusProche(700, 890, 1440, 900), 'bas');
});

test('la place au lâcher suit le pointeur le long du bord, bornée à la zone', () => {
  const zone = { haut: 76, bas: 860, gauche: 12, droite: 1428 };
  const long = LONGUEUR_DU_BOUTON_DE_BORD + 2 * CONGE_DU_BOUTON_DE_BORD;
  const droite = placeAuLacher(1435, 76 + long / 2, 1440, 900, zone);
  assert.deepEqual(droite, { bord: 'droite', fraction: 0 });
  const bas = placeAuLacher(1428 - long / 2, 895, 1440, 900, zone);
  assert.deepEqual(bas, { bord: 'bas', fraction: 1 });
  const loin = placeAuLacher(3, 5000, 1440, 900, zone);
  assert.equal(loin.bord, 'bas');
});

test('la boîte du bouton colle à son bord, dans le bon sens', () => {
  const zone = { haut: 76, bas: 860, gauche: 12, droite: 1428 };
  const long = LONGUEUR_DU_BOUTON_DE_BORD + 2 * CONGE_DU_BOUTON_DE_BORD;
  const g = boiteDuBoutonDeBord({ bord: 'gauche', fraction: 0 }, zone, 1440, 880);
  assert.deepEqual(g, { left: 0, top: 76, width: EPAISSEUR_DU_BOUTON_DE_BORD, height: long });
  const d = boiteDuBoutonDeBord({ bord: 'droite', fraction: 1 }, zone, 1440, 880);
  assert.equal(d.left + d.width, 1440);
  assert.equal(d.top + d.height, 860);
  const h = boiteDuBoutonDeBord({ bord: 'haut', fraction: 0.5 }, zone, 1440, 880);
  assert.equal(h.top, 0);
  assert.equal(h.width, long);
  const b = boiteDuBoutonDeBord({ bord: 'bas', fraction: 0 }, zone, 1440, 880);
  assert.equal(b.top + b.height, 880);
  assert.equal(b.left, 12);
});

test('une place abîmée retombe sur la place par défaut', () => {
  assert.deepEqual(placeAuBordLue(null), PLACE_AU_BORD_PAR_DEFAUT);
  assert.deepEqual(placeAuBordLue({ bord: 'nord', fraction: 0.2 }), PLACE_AU_BORD_PAR_DEFAUT);
  assert.deepEqual(placeAuBordLue({ bord: 'haut', fraction: 7 }), { bord: 'haut', fraction: PLACE_AU_BORD_PAR_DEFAUT.fraction });
  assert.deepEqual(placeAuBordLue({ bord: 'droite', fraction: 0.25 }), { bord: 'droite', fraction: 0.25 });
});

// Règle du 17/11/2026 (`sansBas`), gardée comme option ; le téléphone passe aux côtés seulement le 20/11/2026.
test('sans le bas, le bouton du bord ne se pose jamais en bas (17/11/2026)', () => {
  const zone = { haut: 64, bas: 780, gauche: 12, droite: 378 };
  // Un lâcher tout près du bas, à gauche puis à droite : il va sur le côté le plus proche.
  assert.equal(bordLePlusProche(120, 840, 390, 844, { sansBas: true }), 'gauche');
  assert.equal(bordLePlusProche(300, 840, 390, 844, { sansBas: true }), 'droite');
  assert.equal(placeAuLacher(195, 843, 390, 844, zone, { sansBas: true }).bord !== 'bas', true);
  // Le haut reste permis.
  assert.equal(placeAuLacher(195, 4, 390, 844, zone, { sansBas: true }).bord, 'haut');
  // Sur ordinateur, rien ne change.
  assert.equal(placeAuLacher(700, 897, 1440, 900, { haut: 72, bas: 880, gauche: 12, droite: 1428 }).bord, 'bas');
  // Une place retenue au bas avant la règle revient sur le côté le plus proche, en bas de sa course.
  assert.deepEqual(placeAuBordLue({ bord: 'bas', fraction: 0.2 }, { sansBas: true }), { bord: 'gauche', fraction: 1 });
  assert.deepEqual(placeAuBordLue({ bord: 'bas', fraction: 0.8 }, { sansBas: true }), { bord: 'droite', fraction: 1 });
  assert.deepEqual(placeAuBordLue({ bord: 'bas', fraction: 0.8 }), { bord: 'bas', fraction: 0.8 });
});

test('sur téléphone, le bouton du bord ne se pose que sur les côtés (20/11/2026)', () => {
  const zone = { haut: 120, bas: 760, gauche: 12, droite: 378 };
  const cotes = { cotesSeulement: true };
  // Un lâcher en haut au milieu, en bas au milieu ou au centre : toujours un côté.
  for (const [x, y] of [[195, 4], [195, 840], [195, 422], [150, 300], [260, 700]] as const) {
    const bord = placeAuLacher(x, y, 390, 844, zone, cotes).bord;
    assert.ok(bord === 'gauche' || bord === 'droite', `${x},${y} → ${bord}`);
  }
  assert.equal(bordLePlusProche(150, 4, 390, 844, cotes), 'gauche');
  assert.equal(bordLePlusProche(260, 4, 390, 844, cotes), 'droite');
  // Lâché tout en haut, il reste dans la course : sous l'en-tête (zone.haut).
  const p = placeAuLacher(10, 4, 390, 844, zone, cotes);
  assert.deepEqual(p, { bord: 'gauche', fraction: 0 });
  assert.equal(boiteDuBoutonDeBord(p, zone, 390, 772).top, zone.haut);
  // Lâché tout en bas, il reste au-dessus du menu du bas (zone.bas).
  const b = boiteDuBoutonDeBord(placeAuLacher(380, 843, 390, 844, zone, cotes), zone, 390, 772);
  assert.ok(b.top + b.height <= zone.bas);
  // Une place retenue en haut ou en bas revient sur le côté le plus proche.
  assert.deepEqual(placeAuBordLue({ bord: 'haut', fraction: 0.2 }, cotes), { bord: 'gauche', fraction: 0 });
  assert.deepEqual(placeAuBordLue({ bord: 'haut', fraction: 0.9 }, cotes), { bord: 'droite', fraction: 0 });
  assert.deepEqual(placeAuBordLue({ bord: 'bas', fraction: 0.8 }, cotes), { bord: 'droite', fraction: 1 });
  assert.deepEqual(placeAuBordLue({ bord: 'droite', fraction: 0.3 }, cotes), { bord: 'droite', fraction: 0.3 });
  // L'ordinateur garde ses quatre bords.
  assert.equal(placeAuLacher(700, 8, 1440, 900, { haut: 72, bas: 880, gauche: 12, droite: 1428 }).bord, 'haut');
});
