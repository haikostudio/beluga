import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LONGUEUR_DE_FICHE_DU_TRI,
  NOTE_DE_TRI_SUFFISANTE,
  demandePourLeTri,
  reordonnerParLeTri,
  retenirParLeTri,
  sansFormuleDEntree,
  texteDeFichePourLeTri,
} from '@beluga/shared';
import { noterParLeTri } from '../vectoriseur.js';

/**
 * LE TRI DES COMPÉTENCES PAR UN MODÈLE QUI LIT (carte 71e1006a) : la présélection
 * de la recherche est reclassée par les notes du modèle de tri ; le cadrage
 * propose ce qu'il note nettement. Sans notes, rien ne change.
 */

test('la formule d’entrée « À utiliser quand vous devez » est retirée, le sujet reste', () => {
  assert.equal(sansFormuleDEntree('À utiliser quand vous devez chiffrer un projet.'), 'chiffrer un projet.');
  assert.equal(sansFormuleDEntree("À utiliser dès qu'une application vend un abonnement"), 'une application vend un abonnement');
  assert.equal(sansFormuleDEntree('Chiffre un projet client.'), 'Chiffre un projet client.');
});

test('le texte lu par le modèle : titre, quand s’en servir, thèmes — borné', () => {
  const texte = texteDeFichePourLeTri({ titre: 'Devis brain', quandSenServir: 'À utiliser quand vous devez chiffrer un site.', themes: ['devis', 'prix'] });
  assert.equal(texte, 'Devis brain. chiffrer un site. (devis, prix)');
  const long = texteDeFichePourLeTri({ titre: 'Long', quandSenServir: 'x'.repeat(2000) });
  assert.equal(long.length, LONGUEUR_DE_FICHE_DU_TRI);
  assert.equal(demandePourLeTri(`  ${'a'.repeat(900)}  `).length, 500);
});

test('reclasser : les notées par note décroissante, le reste de la présélection derrière, dans son ordre', () => {
  assert.deepEqual(reordonnerParLeTri(['a', 'b', 'c', 'd'], [0.1, 0.9, 0.5]), ['b', 'c', 'a', 'd']);
});

test('sans notes, ou des notes qui ne correspondent pas, l’ordre d’avant reste tel quel', () => {
  assert.deepEqual(reordonnerParLeTri(['a', 'b', 'c'], undefined), ['a', 'b', 'c']);
  assert.deepEqual(reordonnerParLeTri(['a', 'b'], [0.1, 0.2, 0.3]), ['a', 'b']);
  assert.deepEqual(reordonnerParLeTri(['a', 'b'], []), ['a', 'b']);
});

test('une note nette propose la tête ; une voisine la rejoint si elle vaut au moins la moitié', () => {
  const r = retenirParLeTri(
    [
      { nom: 'landing-page', note: 0.97 },
      { nom: 'landing', note: 0.95 },
      { nom: 'design', note: 0.3 },
      { nom: 'autre', note: 0.01 },
    ],
    [],
    3,
  );
  assert.deepEqual(r.map((c) => c.nom), ['landing-page', 'landing']);
});

test('une tête faible mais qui se DÉTACHE de la suivante est proposée (abonnés qui résilient)', () => {
  const r = retenirParLeTri([{ nom: 'churn-prevention', note: 0.05 }, { nom: 'x', note: 0.003 }], [], 3);
  assert.deepEqual(r.map((c) => c.nom), ['churn-prevention']);
});

test('une demande sans compétence : têtes basses et serrées, rien n’est proposé', () => {
  // Mesuré : la plus haute tête d'une demande sans compétence vaut 0,086, suivie de 0,072.
  assert.deepEqual(retenirParLeTri([{ nom: 'a', note: 0.086 }, { nom: 'b', note: 0.072 }], [], 3), []);
  assert.deepEqual(retenirParLeTri([{ nom: 'a', note: 0.015 }, { nom: 'b', note: 0.0001 }], [], 3), []);
  assert.ok(0.086 < NOTE_DE_TRI_SUFFISANTE);
});

test('jamais une fiche déjà proposée sur la carte, jamais au-delà de la place restante', () => {
  const notees = [
    { nom: 'a', note: 0.9 },
    { nom: 'b', note: 0.8 },
    { nom: 'c', note: 0.7 },
  ];
  assert.deepEqual(retenirParLeTri(notees, ['a'], 3).map((c) => c.nom), ['b', 'c']);
  assert.deepEqual(retenirParLeTri(notees, [], 1).map((c) => c.nom), ['a']);
  assert.deepEqual(retenirParLeTri(notees, [], 0), []);
  assert.deepEqual(retenirParLeTri([], [], 3), []);
});

test('noterParLeTri ne lève jamais : sans modèle ou sans délai, il rend undefined', async () => {
  const avant = process.env.BELUGA_SANS_TRI_DES_COMPETENCES;
  process.env.BELUGA_SANS_TRI_DES_COMPETENCES = '1';
  try {
    assert.equal(await noterParLeTri('devis', ['Chiffrer un projet'], 5_000), undefined);
  } finally {
    if (avant === undefined) delete process.env.BELUGA_SANS_TRI_DES_COMPETENCES;
    else process.env.BELUGA_SANS_TRI_DES_COMPETENCES = avant;
  }
  assert.equal(await noterParLeTri('devis', ['Chiffrer un projet'], 0), undefined);
  assert.equal(await noterParLeTri('devis', [], 5_000), undefined);
});
