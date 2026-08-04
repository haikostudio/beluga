import assert from 'node:assert/strict';
import test from 'node:test';
import {
  doitAlerterEmballement,
  emballementConsommation,
  profilHoraire,
  type ReleveQuota,
} from '@haikodev/shared';

const MAINTENANT = new Date('2026-08-03T09:00:00+02:00').getTime();
const h = (n: number) => n * 3600_000;

/** Treize jours d'historique : ce que le serveur garde réellement. */
const JOURS = 13;

/** Le débit ordinaire : la nuit creuse, le jour plein. */
function ordinaire(at: number): number {
  const heure = new Date(at).getHours();
  return heure >= 1 && heure < 7 ? 0.02 : 0.25;
}

/**
 * Des relevés d'heure en heure. `pointes` remplace le débit ordinaire pour les
 * intervalles qui commencent à tant d'heures avant la fin : `{ 2: 1.5 }` fait
 * brûler 1,5 point de % entre H-2 et H-1.
 */
function historique(pointes: Record<number, number> = {}, fin = MAINTENANT): ReleveQuota[] {
  const out: ReleveQuota[] = [];
  let cumul = 0;
  for (let i = JOURS * 24; i >= 0; i--) {
    const at = fin - h(i);
    out.push({ at, weekly: cumul });
    cumul += pointes[i] ?? ordinaire(at);
  }
  return out;
}

test('un historique régulier ne déclenche rien', () => {
  const points = historique();
  // Le profil, lui, existe bien : c'est donc le rythme qui est jugé normal.
  assert.ok(profilHoraire(points), 'un profil mesuré est attendu');
  assert.equal(emballementConsommation(points, MAINTENANT), null);
});

test('une pointe soutenue est vue, et dite en français simple', () => {
  const points = historique({ 3: 1.5, 2: 1.5, 1: 1.5 });
  const emballement = emballementConsommation(points, MAINTENANT);
  assert.ok(emballement, 'un emballement est attendu');
  assert.equal(emballement.releves, 3);
  assert.equal(emballement.depuis, MAINTENANT - h(3));
  assert.ok(emballement.facteur > 3, `l’écart doit être franc (${emballement.facteur})`);
  assert.ok(Math.abs(emballement.consommePct - 4.5) < 0.01);
  assert.match(emballement.texte, /fois plus vite que d’habitude depuis 3 h/);
  assert.match(emballement.texte, /consommés au lieu de/);
});

test('une pointe d’un seul relevé ne suffit pas', () => {
  assert.equal(emballementConsommation(historique({ 1: 1.5 }), MAINTENANT), null);
});

test('trois fois presque rien reste presque rien', () => {
  // Le rapport est bien au-dessus du seuil, mais 0,6 % en tout ne mérite pas
  // qu'on réveille quelqu'un.
  const petit = emballementConsommation(historique({ 3: 0.2, 2: 0.2, 1: 0.2 }), MAINTENANT);
  assert.equal(petit, null);
});

test('sans profil mesuré, aucune alerte', () => {
  // Deux heures d'historique : pas de quoi savoir ce qui est « habituel ».
  const court: ReleveQuota[] = [
    { at: MAINTENANT - h(2), weekly: 10 },
    { at: MAINTENANT - h(1), weekly: 15 },
    { at: MAINTENANT, weekly: 20 },
  ];
  assert.equal(profilHoraire(court), null);
  assert.equal(emballementConsommation(court, MAINTENANT), null);
});

test('la fenêtre de cinq heures n’est pas jugée sur un profil de journée', () => {
  const points = historique({ 3: 1.5, 2: 1.5, 1: 1.5 });
  assert.equal(emballementConsommation(points, MAINTENANT, 'session'), null);
});

test('des relevés trop vieux ne déclenchent rien', () => {
  // La même pointe, mais terminée il y a trois heures : ce n'est plus l'actualité.
  const points = historique({ 3: 1.5, 2: 1.5, 1: 1.5 }, MAINTENANT - h(3));
  assert.equal(emballementConsommation(points, MAINTENANT), null);
});

test('une seule alerte par emballement, le retour au calme en redonne une', () => {
  const pointe = emballementConsommation(historique({ 3: 1.5, 2: 1.5, 1: 1.5 }), MAINTENANT);
  assert.ok(pointe);

  // Première fois : on prévient.
  assert.equal(doitAlerterEmballement({ emballement: pointe }), true);
  // La même série, déjà annoncée : on se tait — un redémarrage du serveur
  // retrouve la même marque et ne refait donc pas d'alerte.
  assert.equal(doitAlerterEmballement({ emballement: pointe, dejaAnnoncee: pointe.depuis }), false);
  // Même série, mais un relevé de plus : le DÉPART n'a pas bougé, donc silence.
  const suite = emballementConsommation(historique({ 4: 1.5, 3: 1.5, 2: 1.5, 1: 1.5 }), MAINTENANT);
  assert.ok(suite);
  assert.equal(suite.depuis, MAINTENANT - h(4));
  assert.equal(doitAlerterEmballement({ emballement: suite, dejaAnnoncee: suite.depuis }), false);

  // Retour au calme : plus rien à signaler.
  const calme = emballementConsommation(historique({ 6: 1.5, 5: 1.5 }), MAINTENANT);
  assert.equal(calme, null);

  // Puis une NOUVELLE pointe : nouveau départ, donc nouvelle alerte permise,
  // même en gardant la marque de la précédente.
  const seconde = emballementConsommation(historique({ 6: 1.5, 5: 1.5, 2: 1.5, 1: 1.5 }), MAINTENANT);
  assert.ok(seconde);
  assert.equal(seconde.depuis, MAINTENANT - h(2));
  assert.equal(doitAlerterEmballement({ emballement: seconde, dejaAnnoncee: pointe.depuis }), true);
});

test('chiffres périmés : on ne prévient pas sur une preuve qu’on n’a plus', () => {
  const pointe = emballementConsommation(historique({ 3: 1.5, 2: 1.5, 1: 1.5 }), MAINTENANT);
  assert.ok(pointe);
  assert.equal(doitAlerterEmballement({ emballement: pointe, lectureEnEchec: true }), false);
  assert.equal(doitAlerterEmballement({ emballement: null }), false);
});
