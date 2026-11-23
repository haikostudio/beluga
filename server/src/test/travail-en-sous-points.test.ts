import assert from 'node:assert/strict';
import test from 'node:test';
import { travailEnSousPoints, type EntreeJournal } from '@beluga/shared';

/**
 * LE TRAVAIL DÉCOUPÉ EN SOUS-POINTS — ÉPROUVÉ SUR CE QUE LE DÉMON ÉCRIT.
 *
 * Le moteur renvoie sa liste de tâches ENTIÈRE à chaque changement, et le
 * démon en écrit une entrée `nature: 'point'` par ligne et par état
 * (`runtime.ts`). C'est ce flot-là qu'on rejoue ici : l'ordre des sous-points,
 * la place des actions entre deux lignes, les durées venues du journal, et
 * l'échec qui remonte au sous-point.
 */

let rang = 0;
function entree(partiel: Partial<EntreeJournal>): EntreeJournal {
  rang += 1;
  return {
    id: `e${rang}`,
    cardId: 'c1',
    phase: 'execution',
    nature: 'requete',
    at: 1_000 + rang,
    rang,
    libelle: '',
    ...partiel,
  } as EntreeJournal;
}

function action(commande: string, partiel: Partial<EntreeJournal> = {}): EntreeJournal {
  return entree({ outil: 'Bash', libelle: 'Bash', params: JSON.stringify({ command: commande }), ...partiel });
}

/** LA LISTE ENTIÈRE, telle que le moteur la renvoie : une entrée par ligne. */
function liste(lignes: { label: string; state: string; debutLe?: number; finLe?: number }[]): EntreeJournal[] {
  return lignes.map((ligne, index) =>
    entree({
      nature: 'point',
      libelle: ligne.label,
      etat: ligne.state,
      donnees: JSON.stringify({
        rang: index + 1,
        sur: lignes.length,
        ...(ligne.debutLe === undefined ? {} : { debutLe: ligne.debutLe }),
        ...(ligne.finLe === undefined ? {} : { finLe: ligne.finLe }),
      }),
    }),
  );
}

test('un tour sans aucune liste de tâches ne rend que « Réflexion »', () => {
  const sousPoints = travailEnSousPoints([action('npm test'), action('npm run build')]);
  assert.equal(sousPoints.length, 1);
  assert.equal(sousPoints[0].sorte, 'reflexion');
  assert.equal(sousPoints[0].libelle, 'Réflexion');
  assert.equal(sousPoints[0].traduire, true);
  assert.equal(sousPoints[0].entrees.length, 2);
});

test('un passage vide ne rend aucun sous-point', () => {
  assert.deepEqual(travailEnSousPoints([]), []);
});

test('ce qui précède la liste va dans « Réflexion », le reste sous sa ligne', () => {
  const journal = [
    action('git status'),
    ...liste([
      { label: 'Lire les fichiers', state: 'running' },
      { label: 'Écrire le code', state: 'todo' },
    ]),
    action('cat a.ts'),
    action('cat b.ts'),
    ...liste([
      { label: 'Lire les fichiers', state: 'done' },
      { label: 'Écrire le code', state: 'running' },
    ]),
    action('npm run build'),
  ];
  const sousPoints = travailEnSousPoints(journal);
  assert.deepEqual(
    sousPoints.map((sp) => sp.libelle),
    ['Réflexion', 'Lire les fichiers', 'Écrire le code'],
  );
  assert.equal(sousPoints[0].entrees.length, 1);
  assert.equal(sousPoints[1].entrees.length, 2);
  assert.equal(sousPoints[2].entrees.length, 1);
  /* L'ÉTAT SUIVI EST LE PLUS AVANCÉ, jamais le premier écrit. */
  assert.equal(sousPoints[1].etat, 'done');
  assert.equal(sousPoints[2].etat, 'running');
  assert.equal(sousPoints[1].rang, 1);
  assert.equal(sousPoints[1].sur, 2);
});

test('une « Réflexion » vide ne s’affiche pas', () => {
  const sousPoints = travailEnSousPoints([
    ...liste([{ label: 'Tout faire', state: 'running' }]),
    action('npm test'),
  ]);
  assert.deepEqual(
    sousPoints.map((sp) => sp.libelle),
    ['Tout faire'],
  );
});

test('la durée d’un point vient du journal, pas d’une estimation', () => {
  const sousPoints = travailEnSousPoints([
    ...liste([{ label: 'Lire', state: 'done', debutLe: 5_000, finLe: 12_000 }]),
    action('cat a.ts'),
  ]);
  assert.equal(sousPoints[0].debut, 5_000);
  assert.equal(sousPoints[0].dureeMs, 7_000);
});

test('sans heures écrites, la durée court jusqu’au point suivant', () => {
  const journal = [
    ...liste([
      { label: 'Un', state: 'running' },
      { label: 'Deux', state: 'todo' },
    ]),
    entree({ outil: 'Bash', libelle: 'Bash', at: 10_000 }),
    ...liste([
      { label: 'Un', state: 'done' },
      { label: 'Deux', state: 'running' },
    ]),
    entree({ outil: 'Bash', libelle: 'Bash', at: 30_000 }),
  ];
  const sousPoints = travailEnSousPoints(journal);
  const un = sousPoints.find((sp) => sp.libelle === 'Un')!;
  const deux = sousPoints.find((sp) => sp.libelle === 'Deux')!;
  assert.ok(un.dureeMs !== undefined && un.dureeMs > 0, 'le premier point doit avoir une durée');
  assert.ok(deux.dureeMs !== undefined, 'le dernier point se termine sur la dernière action du passage');
});

test('un échec remonte au sous-point où il a eu lieu, et à lui seul', () => {
  const journal = [
    ...liste([
      { label: 'Un', state: 'running' },
      { label: 'Deux', state: 'todo' },
    ]),
    action('npm test', { reussie: false }),
    ...liste([
      { label: 'Un', state: 'done' },
      { label: 'Deux', state: 'running' },
    ]),
    action('npm run build'),
  ];
  const sousPoints = travailEnSousPoints(journal);
  assert.equal(sousPoints.find((sp) => sp.libelle === 'Un')!.enEchec, true);
  assert.equal(sousPoints.find((sp) => sp.libelle === 'Deux')!.enEchec, false);
});

test('les sous-points se lisent dans l’ordre de leur rang, pas de leur cochage', () => {
  const journal = [
    ...liste([
      { label: 'Un', state: 'todo' },
      { label: 'Deux', state: 'todo' },
      { label: 'Trois', state: 'todo' },
    ]),
    /* LE MOTEUR COCHE LA TROISIÈME EN PREMIER : l'ordre affiché ne bouge pas. */
    ...liste([
      { label: 'Un', state: 'todo' },
      { label: 'Deux', state: 'todo' },
      { label: 'Trois', state: 'done' },
    ]),
  ];
  assert.deepEqual(
    travailEnSousPoints(journal).map((sp) => sp.libelle),
    ['Un', 'Deux', 'Trois'],
  );
});

test('le journal se lit par son rang, jamais par son heure', () => {
  const points = liste([{ label: 'Un', state: 'running' }]);
  /* L'ACTION VIENT APRÈS LE POINT PAR SON RANG, mais porte une heure PLUS
     ANCIENNE, et la liste est donnée à l'envers : seul le rang fait l'ordre.
     Elle appartient donc au point, pas à la réflexion. */
  const tard = action('npm test');
  tard.at = 500;
  const sousPoints = travailEnSousPoints([tard, ...points]);
  assert.equal(sousPoints.length, 1);
  assert.equal(sousPoints[0].libelle, 'Un');
  assert.equal(sousPoints[0].entrees.length, 1);
});
