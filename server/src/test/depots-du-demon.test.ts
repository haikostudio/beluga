import test from 'node:test';
import assert from 'node:assert/strict';
import { depotsQuUnDemonNeRangePas } from '@beluga/shared';

/*
 * LE MÉNAGE DES COPIES DE TRAVAIL ÉPARGNE DEUX DÉPÔTS, PAS UN.
 *
 * Un contrôle lève un démon d'essai depuis la copie de la carte, sur une base
 * NEUVE : aucun agent n'y est inscrit, et la base adopte d'office les projets de
 * `/root`, dont le dépôt PRINCIPAL. Ne protéger que la racine du démon laissait
 * donc ranger ce principal — et refermer la copie de l'agent qui avait lancé le
 * contrôle.
 */

test('un démon posé dans un vrai dépôt ne protège que lui-même', () => {
  assert.deepEqual(depotsQuUnDemonNeRangePas('/root/beluga', null), ['/root/beluga']);
});

test('un démon lancé depuis une copie protège AUSSI le dépôt principal', () => {
  const marqueur = 'gitdir: /root/beluga/.git/worktrees/ma-carte\n';
  assert.deepEqual(depotsQuUnDemonNeRangePas('/root/beluga/.worktrees/ma-carte', marqueur), [
    '/root/beluga/.worktrees/ma-carte',
    '/root/beluga',
  ]);
});

test('un marqueur illisible ne fabrique pas de chemin inventé', () => {
  assert.deepEqual(depotsQuUnDemonNeRangePas('/root/copie', 'n’importe quoi'), ['/root/copie']);
});

test('le principal n’est pas listé deux fois quand il vaut la racine', () => {
  const marqueur = 'gitdir: /root/beluga/.git/worktrees/x\n';
  assert.deepEqual(depotsQuUnDemonNeRangePas('/root/beluga', marqueur), ['/root/beluga']);
});
