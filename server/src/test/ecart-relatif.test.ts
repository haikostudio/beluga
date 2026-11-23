import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ecartRelatif,
  jourAvecEcart,
  rendreChangelog,
  rendreFicheNumerotee,
  rendreUnite,
  texteDAccueilConnaissances,
  FICHES_PROJET,
  type EntreeDuChangelog,
  type Unite,
} from '@beluga/shared';

/*
 * Un agent avait la date du jour ET la date d'une correction du matin sous les
 * yeux, et a écrit « la correction de la semaine dernière ». Le démon calcule
 * désormais l'écart lui-même, dans ce qu'il sert aux agents — et seulement là.
 */

const midi = (jour: string) => Date.parse(`${jour}T12:00:00Z`);

test('l’écart dit aujourd’hui, hier, puis les jours et les mois', () => {
  assert.equal(ecartRelatif('2026-10-06', midi('2026-10-06')), "aujourd'hui");
  assert.equal(ecartRelatif('2026-10-05', midi('2026-10-06')), 'hier');
  assert.equal(ecartRelatif('2026-09-29', midi('2026-10-06')), 'il y a 7 jours');
  assert.equal(ecartRelatif('2026-07-01', midi('2026-10-06')), 'il y a 3 mois');
});

test('les bords de minuit et de mois suivent le jour calendaire, au même fuseau que la date imprimée', () => {
  assert.equal(ecartRelatif('2026-10-06', Date.parse('2026-10-06T00:00:00Z')), "aujourd'hui");
  assert.equal(ecartRelatif('2026-10-06', Date.parse('2026-10-06T23:59:59Z')), "aujourd'hui");
  assert.equal(ecartRelatif('2026-10-05', Date.parse('2026-10-06T00:00:01Z')), 'hier');
  assert.equal(ecartRelatif('2026-09-30', Date.parse('2026-10-01T08:00:00Z')), 'hier');
  assert.equal(ecartRelatif('2026-02-28', Date.parse('2026-03-01T08:00:00Z')), 'hier');
});

test('une date future ou illisible ne dit rien', () => {
  assert.equal(ecartRelatif('2026-10-07', midi('2026-10-06')), '');
  assert.equal(ecartRelatif('pas une date', midi('2026-10-06')), '');
  assert.equal(jourAvecEcart('2026-10-07', midi('2026-10-06')), '2026-10-07');
  assert.equal(jourAvecEcart('2026-10-06'), '2026-10-06', 'sans instant, la date seule');
});

const entree = (jour: string, titre: string): EntreeDuChangelog =>
  ({
    cle: `${jour}-${titre}`,
    jour,
    texte: titre,
    titre,
    poids: 'amelioration',
    explication: 'Une explication assez longue pour être acceptée.',
    categorie: 'amelioration',
    source: 'agent',
    commits: [],
    cartes: [],
    unites: [],
    at: Date.parse(`${jour}T10:00:00Z`),
  }) as unknown as EntreeDuChangelog;

test('le changelog de l’accueil porte l’écart de chaque entrée', () => {
  const texte = texteDAccueilConnaissances({
    nomDuProjet: 'Essai',
    tete: [],
    jamaisSupposer: [],
    vitales: [],
    changelog: [entree('2026-10-06', 'Rédaction qui défile'), entree('2026-10-05', 'Veille'), entree('2026-09-29', 'Avant')],
    totalUnites: 0,
    maintenant: midi('2026-10-06'),
  });
  assert.match(texte, /- 2026-10-06 \(aujourd'hui\) · /);
  assert.match(texte, /- 2026-10-05 \(hier\) · /);
  assert.match(texte, /- 2026-09-29 \(il y a 7 jours\) · /);
});

const unite = {
  id: 'MEM-0001',
  portee: 'p1',
  type: 'convention',
  importance: 'P2',
  statut: 'active',
  titre: 'Une convention',
  resume: 'Un résumé.',
  detail: '',
  raisonnement: '',
  sujets: [],
  liens: [],
  source: { genre: 'carte' },
  confiance: 0.8,
  version: 1,
  creeLe: Date.parse('2026-10-06T08:00:00Z'),
  modifieLe: Date.parse('2026-10-06T08:00:00Z'),
  jamaisSupposer: false,
} as unknown as Unite;

test('une unité lue par un agent porte l’écart, ses rendus enregistrés jamais', () => {
  assert.match(rendreUnite(unite, 1, { maintenant: midi('2026-10-06') }), /v1 · 2026-10-06 \(aujourd'hui\)/);
  const enregistre = rendreUnite(unite);
  assert.match(enregistre, /v1 · 2026-10-06$/m);
  assert.doesNotMatch(enregistre, /aujourd'hui|hier|il y a/);
  const fiche = FICHES_PROJET.find((f) => f.types.includes('convention'))!;
  const rendu = { portee: 'p1', nomDeLaPortee: 'Essai', fiche, unites: [unite] };
  assert.doesNotMatch(rendreFicheNumerotee(rendu), /aujourd'hui|hier|il y a/);
  assert.match(rendreFicheNumerotee(rendu, [unite], { maintenant: midi('2026-10-07') }), /mise à jour le 2026-10-06 \(hier\)[\s\S]*v1 · 2026-10-06 \(hier\)/);
  const changelog = [entree('2026-10-06', 'Rédaction qui défile')];
  assert.doesNotMatch(rendreChangelog('Essai', changelog), /aujourd'hui/);
  assert.match(rendreChangelog('Essai', changelog, { maintenant: midi('2026-10-06') }), /^## 2026-10-06 \(aujourd'hui\)$/m);
});
