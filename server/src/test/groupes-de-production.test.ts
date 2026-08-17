import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DeployRun,
  GROUPE_SANS_PUBLICATION,
  cartesRangeesParGroupe,
  compteDuGroupe,
  groupesDeProduction,
  grouperVautLaPeine,
  publicationDeChaqueCarte,
} from '@haikodev/shared';

/** Une publication réduite à ce qui compte ici : quand, quoi, quelle issue. */
function publication(
  id: string,
  startedAt: number,
  cardIds: string[],
  state: DeployRun['state'] = 'success',
): DeployRun {
  return DeployRun.parse({ id, projectId: 'p1', state, startedAt, cardIds, steps: [] });
}

const carte = (id: string) => ({ id });

/* ------------------------------------------------------------------ */
/* QUELLE PUBLICATION A EMBARQUÉ CHAQUE CARTE                           */
/* ------------------------------------------------------------------ */

test('une carte appartient à la publication la PLUS RÉCENTE qui l’a embarquée', () => {
  // Redéployée après correction, la carte se range sous son dernier passage :
  // c'est celui-là qui dit ce qui est réellement en ligne.
  const runs = [publication('r1', 1000, ['a', 'b']), publication('r2', 5000, ['a'])];
  const index = publicationDeChaqueCarte(runs);
  assert.equal(index.get('a')?.id, 'r2');
  assert.equal(index.get('b')?.id, 'r1');
});

test('une publication TOMBÉE ou ARRÊTÉE ne revendique aucune carte', () => {
  // Sinon l'échec du matin s'attribuerait le lot que la reprise de
  // l'après-midi a réellement déployé.
  const runs = [publication('r1', 1000, ['a']), publication('r2', 5000, ['a'], 'failed')];
  assert.equal(publicationDeChaqueCarte(runs).get('a')?.id, 'r1');
  assert.equal(publicationDeChaqueCarte([publication('r3', 9000, ['z'], 'stopped')].concat()).size, 0);
});

/* ------------------------------------------------------------------ */
/* LES GROUPES DE LA COLONNE                                            */
/* ------------------------------------------------------------------ */

test('les cartes parties ensemble forment un groupe, le plus récent d’abord', () => {
  const runs = [publication('r1', 1000, ['a', 'b']), publication('r2', 5000, ['c'])];
  const groupes = groupesDeProduction([carte('c'), carte('a'), carte('b')], runs);
  assert.equal(groupes.length, 2);
  assert.equal(groupes[0].runId, 'r2');
  assert.deepEqual(groupes[1].cartes.map((c) => c.id), ['a', 'b']);
});

test('l’ordre des cartes ne change pas À L’INTÉRIEUR d’un groupe', () => {
  const runs = [publication('r1', 1000, ['a', 'b', 'c'])];
  const groupes = groupesDeProduction([carte('c'), carte('a'), carte('b')], runs);
  assert.deepEqual(groupes[0].cartes.map((c) => c.id), ['c', 'a', 'b']);
});

test('ce qui n’est rattaché à rien se DIT, et passe en dernier', () => {
  const runs = [publication('r1', 5000, ['a'])];
  const groupes = groupesDeProduction([carte('a'), carte('posee-a-la-main')], runs);
  assert.equal(groupes.length, 2);
  assert.equal(groupes[1].runId, null);
  assert.equal(groupes[1].titre, GROUPE_SANS_PUBLICATION);
  assert.deepEqual(groupes[1].cartes.map((c) => c.id), ['posee-a-la-main']);
});

test('sans aucune publication connue, tout tient dans le groupe sans publication', () => {
  const groupes = groupesDeProduction([carte('a'), carte('b')], []);
  assert.equal(groupes.length, 1);
  assert.equal(groupes[0].runId, null);
  assert.equal(groupes[0].cartes.length, 2);
});

test('une colonne vide ne rend aucun groupe', () => {
  assert.deepEqual(groupesDeProduction([], [publication('r1', 1000, ['a'])]), []);
});

test('le groupe porte le titre de sa publication, avec sa date', () => {
  const at = new Date(2026, 7, 17, 14, 32).getTime();
  const groupes = groupesDeProduction([carte('a')], [publication('r1', at, ['a'])]);
  assert.equal(groupes[0].titre, 'Déploiement du 17 août, 14:32');
  assert.equal(groupes[0].etat, 'success');
});

/* ------------------------------------------------------------------ */
/* QUAND GROUPER APPREND QUELQUE CHOSE                                  */
/* ------------------------------------------------------------------ */

test('un seul groupe SANS publication n’apprend rien : on ne groupe pas', () => {
  const groupes = groupesDeProduction([carte('a'), carte('b')], []);
  assert.equal(grouperVautLaPeine(groupes), false);
});

test('un seul groupe AVEC publication se montre : c’est le seul chemin vers son fil', () => {
  const groupes = groupesDeProduction([carte('a')], [publication('r1', 1000, ['a'])]);
  assert.equal(grouperVautLaPeine(groupes), true);
});

test('deux groupes se montrent toujours', () => {
  const groupes = groupesDeProduction([carte('a'), carte('b')], [publication('r1', 1000, ['a'])]);
  assert.equal(grouperVautLaPeine(groupes), true);
});

/* ------------------------------------------------------------------ */
/* LA LISTE RENDUE À LA COLONNE                                         */
/* ------------------------------------------------------------------ */

test('les cartes ressortent groupe par groupe, aucune ajoutée ni perdue', () => {
  // La colonne pose ses cartes par paquets de vingt : un groupe éclaté entre
  // deux paquets afficherait un bandeau sans ses cartes.
  const runs = [publication('r1', 1000, ['a', 'c']), publication('r2', 5000, ['b'])];
  const cartes = [carte('a'), carte('b'), carte('c'), carte('orpheline')];
  const rangees = cartesRangeesParGroupe(groupesDeProduction(cartes, runs));
  assert.deepEqual(rangees.map((c) => c.id), ['b', 'a', 'c', 'orpheline']);
  assert.equal(rangees.length, cartes.length);
});

test('le compte d’un groupe se dit en français', () => {
  assert.equal(compteDuGroupe(1), '1 tâche');
  assert.equal(compteDuGroupe(3), '3 tâches');
});
