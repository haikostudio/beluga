import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filtrerLaColonne, fluxDeLaColonne, nomCorrespond } from '@beluga/shared';

const groupes = [{ id: 'g1', name: 'Clients' }, { id: 'g2', name: 'Studio' }];
const projets = [
  { id: 'a', name: 'Atelier', groupId: 'g1' },
  { id: 'b', name: 'Boutique', groupId: 'g1' },
  { id: 'c', name: 'Café', groupId: 'g2' },
  { id: 'r', name: 'Réunion', groupId: 'g2' },
  { id: 'm', name: 'Membre caché', groupId: 'g2', regroupementId: 'r' },
  { id: 'x', name: 'Seul' },
];

test('la casse, les accents et l’ordre des mots ne comptent pas', () => {
  assert.equal(nomCorrespond('Clôture de Compte', 'compte clot'), true);
  assert.equal(nomCorrespond('Clôture', 'ouverture'), false);
  assert.equal(nomCorrespond('Clôture', '   '), false);
});

test('un dossier trouvé garde ses projets, sans ouvrir de projet réuni', () => {
  const filtre = filtrerLaColonne('clients', groupes, projets);
  assert.deepEqual([...filtre.groupes], ['g1']);
  assert.deepEqual([...filtre.projets].sort(), ['a', 'b']);
  assert.equal(filtre.regroupementsOuverts.size, 0);
});

test('un projet trouvé emmène son dossier ; un membre ouvre son projet réuni', () => {
  const filtre = filtrerLaColonne('cache', groupes, projets);
  assert.deepEqual([...filtre.projets].sort(), ['m', 'r']);
  assert.deepEqual([...filtre.groupes], ['g2']);
  assert.deepEqual([...filtre.regroupementsOuverts], ['r']);
});

test('une tâche trouvée fait paraître son projet, et seulement ses tâches trouvées', () => {
  const filtre = filtrerLaColonne('facture', groupes, projets, [
    { id: 't1', projectId: 'x' },
    { id: 't2', projectId: 'x' },
    { id: 't3', projectId: 'absent' },
  ]);
  assert.deepEqual([...filtre.projets], ['x']);
  assert.deepEqual(filtre.cartesParProjet.get('x'), ['t1', 't2']);
  assert.equal(filtre.cartesParProjet.has('absent'), false);
});

test('le flux montre cinq tâches, plus les tâches gardées à leur rang de date', () => {
  const lignes = [9, 8, 7, 6, 5, 4, 3, 2].map((updatedAt) => ({ carte: { id: `t${updatedAt}`, updatedAt }, gardee: updatedAt === 2 }));
  const lues = new Set(lignes.map((ligne) => ligne.carte.id).filter((id) => id !== 't2'));
  const flux = fluxDeLaColonne(lignes, lues, 5, (ligne) => ligne.gardee).map((ligne) => ligne.carte.id);
  assert.deepEqual(flux, ['t9', 't8', 't7', 't6', 't5', 't2']);
  // Une tâche gardée déjà dans les cinq n'en retire aucune et ne se double pas.
  const dedans = fluxDeLaColonne(lignes, lues, 5, (ligne) => ligne.carte.id === 't7').map((ligne) => ligne.carte.id);
  assert.deepEqual(dedans, ['t9', 't8', 't7', 't6', 't5']);
});
