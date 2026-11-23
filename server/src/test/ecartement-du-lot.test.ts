import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FICHIERS_NOMMES_MAX,
  JALON_ECARTEE_DU_LOT,
  cartesHeurtees,
  genreDAction,
  listeDeFichiers,
  mentionDeLEcartement,
} from '@beluga/shared';

/*
 * UNE CARTE ÉCARTÉE DU LOT DIT QUELS FICHIERS HEURTENT, ET CONTRE QUELLE
 * CARTE. Constat : « conflit toujours présent après passage de l'agent »,
 * sans un nom de fichier ni une carte — il fallait rouvrir le dépôt.
 */

const fusionnees = [
  { cardId: 'a', titre: 'Première carte', branche: 'tache/premiere-aaaaaa', fichiers: ['src/a.ts', 'CLAUDE.md'] },
  { cardId: 'b', titre: 'Deuxième carte', branche: 'tache/deuxieme-bbbbbb', fichiers: ['src/b.ts', 'src/commun.ts'] },
  { cardId: 'c', titre: 'Troisième carte', branche: 'tache/troisieme-cccccc', fichiers: ['docs/x.md'] },
];

test('les cartes heurtées sont celles du lot qui ont touché un fichier en conflit, avec les fichiers communs', () => {
  const contre = cartesHeurtees(['src/commun.ts', 'CLAUDE.md', 'src/z.ts'], fusionnees);
  assert.deepEqual(
    contre.map((c) => [c.cardId, c.fichiers]),
    [
      ['a', ['CLAUDE.md']],
      ['b', ['src/commun.ts']],
    ],
  );
});

test('aucun fichier en conflit, ou aucune carte du lot dessus : la liste est vide, jamais une carte au hasard', () => {
  assert.deepEqual(cartesHeurtees([], fusionnees), []);
  assert.deepEqual(cartesHeurtees(['src/z.ts'], fusionnees), []);
  assert.deepEqual(cartesHeurtees(['src/z.ts'], []), []);
});

test('la phrase nomme la branche écartée, les fichiers, et chaque carte heurtée avec ses fichiers', () => {
  const phrase = mentionDeLEcartement({
    branche: 'tache/quatrieme-dddddd',
    brancheDAccueil: 'dev',
    fichiers: ['src/commun.ts', 'CLAUDE.md'],
    contre: cartesHeurtees(['src/commun.ts', 'CLAUDE.md'], fusionnees),
    recit: 'conflit toujours présent après passage de l’agent',
  });
  assert.equal(
    phrase,
    'tache/quatrieme-dddddd écartée du lot : heurt sur src/commun.ts, CLAUDE.md, contre « Première carte » (tache/premiere-aaaaaa) sur CLAUDE.md ; « Deuxième carte » (tache/deuxieme-bbbbbb) sur src/commun.ts. conflit toujours présent après passage de l’agent.',
  );
});

test('sans carte du lot en cause, la phrase dit que le heurt vient de la branche d’accueil', () => {
  const phrase = mentionDeLEcartement({
    branche: 'tache/seule-eeeeee',
    brancheDAccueil: 'dev',
    fichiers: ['src/z.ts'],
    contre: [],
  });
  assert.match(phrase, /heurt sur src\/z\.ts, contre ce qui était déjà sur « dev » avant ce lot/);
  assert.match(phrase, /aucune carte du lot n’a touché ces fichiers/);
  assert.ok(!phrase.endsWith('..'), 'sans récit, la phrase se termine proprement');
});

test('sans fichier identifié, la phrase le dit au lieu d’inventer', () => {
  const phrase = mentionDeLEcartement({ branche: 'tache/x', brancheDAccueil: 'dev', fichiers: [], contre: [] });
  assert.match(phrase, /heurt sur fichiers non identifiés/);
});

test('une longue liste de fichiers est bornée, et dit combien manquent', () => {
  const fichiers = Array.from({ length: FICHIERS_NOMMES_MAX + 3 }, (_, i) => `src/f${i}.ts`);
  const liste = listeDeFichiers(fichiers);
  assert.match(liste, /et 3 autres$/);
  assert.equal(listeDeFichiers(fichiers.slice(0, FICHIERS_NOMMES_MAX + 1)).endsWith('et 1 autre'), true);
  assert.equal(listeDeFichiers(['a.ts', ' ', 'b.ts']), 'a.ts, b.ts');
});

test('le jalon d’écartement est un incident dans la ligne de temps de la carte', () => {
  assert.equal(genreDAction({ nature: 'jalon', libelle: JALON_ECARTEE_DU_LOT, reussie: false }), 'incident');
});
