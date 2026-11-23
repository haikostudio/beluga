/**
 * LES FORMATS DU VOLET D'APERÇU — les règles pures.
 *
 * Ce que ces essais verrouillent : le cadre ne se réduit que s'il ne tient pas —
 * jamais il ne s'agrandit — et l'appareil de départ suit la préférence retenue
 * (puis l'ancien format, puis l'appareil lui-même).
 *
 * Les APPAREILS D'ESSAI : largeur et hauteur réelles, paysage qui échange les
 * côtés, ordinateur toujours en paysage, rapport gardé par une réduction
 * commune, reprise d'un ancien format et retour au défaut d'un appareil retiré.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  APPAREILS_D_APERCU,
  CLE_APPAREIL_D_APERCU,
  CLE_ORIENTATION_D_APERCU,
  cleAppareilDApercu,
  cleApercuOuvert,
  cleOrientationDApercu,
  FORMATS_D_APERCU,
  LARGEUR_DU_FORMAT,
  appareilAdapte,
  appareilDeDepart,
  appareilParId,
  appareilsDuFormat,
  dimensionsDeLAppareil,
  echelleDeLAppareil,
  echelleDuFormat,
  estOrientable,
  estOrientationDApercu,
  famillesDuFormat,
  orientationDeLAppareil,
} from '@beluga/shared';

test('le cadre se réduit seulement s’il ne tient pas', () => {
  assert.equal(echelleDuFormat(1600, LARGEUR_DU_FORMAT.ordinateur), 1);
  assert.equal(echelleDuFormat(390, LARGEUR_DU_FORMAT.telephone), 1);
  assert.equal(echelleDuFormat(390, LARGEUR_DU_FORMAT.ordinateur), 390 / 1280);
  assert.equal(echelleDuFormat(410, LARGEUR_DU_FORMAT.tablette), 0.5);
  assert.equal(echelleDuFormat(0, LARGEUR_DU_FORMAT.ordinateur), 1);
});

test('chaque appareil a sa largeur et sa hauteur réelles, et le paysage échange les côtés', () => {
  const iphone = appareilParId('iphone-15');
  assert.ok(iphone);
  assert.deepEqual(dimensionsDeLAppareil(iphone, 'portrait'), { largeur: 393, hauteur: 852 });
  assert.deepEqual(dimensionsDeLAppareil(iphone, 'paysage'), { largeur: 852, hauteur: 393 });
  const ipad = appareilParId('ipad-10');
  assert.ok(ipad);
  assert.deepEqual(dimensionsDeLAppareil(ipad, 'paysage'), { largeur: 1180, hauteur: 820 });
});

test('un ordinateur reste en paysage, et « Adapté à la place » n’a pas de hauteur', () => {
  const ecran = appareilParId('ecran-1920');
  assert.ok(ecran);
  assert.equal(estOrientable(ecran), false);
  assert.equal(orientationDeLAppareil(ecran, 'portrait'), 'paysage');
  assert.deepEqual(dimensionsDeLAppareil(ecran, 'portrait'), { largeur: 1920, hauteur: 1080 });
  for (const format of FORMATS_D_APERCU) {
    const adapte = appareilAdapte(format);
    assert.equal(adapte.hauteur, null);
    assert.equal(adapte.largeur, LARGEUR_DU_FORMAT[format]);
    assert.equal(estOrientable(adapte), false);
  }
});

test('le catalogue : identifiants uniques, rapports réalistes, trois formats complets', () => {
  const ids = APPAREILS_D_APERCU.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const a of APPAREILS_D_APERCU) {
    if (a.hauteur === null) continue;
    if (a.format === 'ordinateur') assert.ok(a.largeur > a.hauteur, `${a.id} est en paysage`);
    else assert.ok(a.hauteur > a.largeur, `${a.id} est en portrait`);
  }
  for (const format of FORMATS_D_APERCU) {
    assert.ok(famillesDuFormat(format).length >= 2, `${format} a au moins deux familles`);
    assert.ok(appareilsDuFormat(format).length >= 4);
  }
  assert.deepEqual(famillesDuFormat('telephone'), ['iphone', 'android']);
  assert.deepEqual(famillesDuFormat('tablette'), ['ipad', 'android-tablette']);
  assert.deepEqual(famillesDuFormat('ordinateur'), ['portable', 'ecran']);
});

test('le cadre garde son rapport : largeur et hauteur se réduisent ensemble, sans jamais grandir', () => {
  // Un iPhone 15 dans un volet de 600 × 700 : la hauteur est le côté le plus contraint.
  const k = echelleDeLAppareil(600, 700, 393, 852);
  assert.equal(k, 700 / 852);
  assert.ok(Math.abs((393 * k) / (852 * k) - 393 / 852) < 1e-9);
  // La largeur peut être le côté contraint.
  assert.equal(echelleDeLAppareil(300, 900, 393, 852), 300 / 393);
  // Assez de place : 1, jamais plus.
  assert.equal(echelleDeLAppareil(2000, 2000, 393, 852), 1);
  // Zone pas encore mesurée : rien ne se réduit.
  assert.equal(echelleDeLAppareil(0, 0, 393, 852), 1);
  // Sans hauteur, seule la largeur compte (comme avant).
  assert.equal(echelleDeLAppareil(390, 100, 1280, null), 390 / 1280);
});

test('l’appareil de départ : le dernier choisi, l’ancien format repris, puis l’appareil lui-même', () => {
  assert.equal(appareilDeDepart('pixel', 'tablette', false).id, 'pixel');
  // Un ancien choix « téléphone / tablette / ordinateur » prend un appareil réaliste.
  assert.equal(appareilDeDepart(undefined, 'telephone', false).id, 'iphone-15');
  assert.equal(appareilDeDepart(undefined, 'tablette', true).id, 'ipad-10');
  assert.equal(appareilDeDepart(undefined, 'ordinateur', true).id, 'ordinateur-adapte');
  // Sans aucune préférence : l'appareil s'adapte à sa place.
  assert.equal(appareilDeDepart(undefined, undefined, true).id, 'telephone-adapte');
  assert.equal(appareilDeDepart(undefined, undefined, false).id, 'ordinateur-adapte');
  // Un appareil retiré du catalogue retombe sur l'ancien format, puis sur le défaut.
  assert.equal(appareilDeDepart('nokia-3310', 'tablette', false).id, 'ipad-10');
  assert.equal(appareilDeDepart('nokia-3310', undefined, false).id, 'ordinateur-adapte');
});

test('l’orientation retenue ne vaut que pour un appareil qui pivote', () => {
  const iphone = appareilParId('iphone-15');
  assert.ok(iphone);
  assert.equal(orientationDeLAppareil(iphone, 'paysage'), 'paysage');
  assert.equal(orientationDeLAppareil(iphone, 'n’importe quoi'), 'portrait');
  assert.equal(orientationDeLAppareil(appareilAdapte('telephone'), 'paysage'), 'portrait');
  assert.equal(estOrientationDApercu('paysage'), true);
  assert.equal(estOrientationDApercu('diagonale'), false);
});

test('l’appareil et l’orientation se retiennent par projet, avec repli sur le compte', () => {
  assert.equal(cleAppareilDApercu('p1'), 'apercu.appareil.p1');
  assert.equal(cleOrientationDApercu('p1'), 'apercu.orientation.p1');
  // Deux projets, deux clés ; les clés de compte restent celles d'avant.
  assert.notEqual(cleAppareilDApercu('p1'), cleAppareilDApercu('p2'));
  assert.equal(CLE_APPAREIL_D_APERCU, 'apercu.appareil');
  assert.equal(CLE_ORIENTATION_D_APERCU, 'apercu.orientation');
  // Le volet lit le projet d'abord, puis le compte ; il écrit toujours au projet.
  const volet = readFileSync(new URL('../../../web/src/components/volet-apercu.tsx', import.meta.url), 'utf8');
  assert.match(volet, /const prefereAppareil = appareilParId\(appareilDuProjet\) \? appareilDuProjet : appareilDuCompte/);
  assert.match(volet, /const prefereOrientation = estOrientationDApercu\(orientationDuProjet\) \? orientationDuProjet : orientationDuCompte/);
  assert.match(volet, /\[appareilDuProjet, setPrefereAppareil\] = usePref<unknown>\(cleAppareilDApercu\(projectId\)/);
});

test('l’aperçu ouvert se retient par projet et séparément pour téléphone et ordinateur', () => {
  assert.equal(cleApercuOuvert('p1', true), 'apercu.ouvert.p1.telephone');
  assert.equal(cleApercuOuvert('p1', false), 'apercu.ouvert.p1.ordinateur');
  assert.notEqual(cleApercuOuvert('p1', true), cleApercuOuvert('p2', true));
  const carte = readFileSync(new URL('../../../web/src/components/card-panel.tsx', import.meta.url), 'utf8');
  assert.match(carte, /\[apercu, setApercu\] = usePref<boolean>\(cleApercuOuvert\(card\.projectId, telephone\), false\)/);
  // Le garde-fou reste : sans adresse de développement, rien ne s'ouvre.
  assert.match(carte, /const apercuOuvert = apercu && !!adresseDeDev && !voletDuCahier/);
});
