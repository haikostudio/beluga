import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DROITS_VIDES,
  commandeOuverteAuCompte,
  droitsDeDepart,
  droitsDuCompte,
  droitsLus,
  evenementOuvertParUnService,
  niveauRequisPourLaCommande,
  niveauSuffit,
  projetsDesDroits,
  roleDesDroits,
  viseurPourLeCompte,
  type DroitsDAcces,
} from '@beluga/shared';

/*
 * LES ACCÈS TIERS À BELUGA : UNE GRILLE PROJET PAR PROJET, SERVICE PAR SERVICE.
 * Tout est fermé par défaut ; le premier formulaire part de rien, les suivants
 * reprennent la grille du dernier accès créé.
 */

const compte = (droits: DroitsDAcces) => ({
  role: roleDesDroits(droits),
  projets: projetsDesDroits(droits),
  droits,
});

test('une grille vide n’ouvre rien et fait un lecteur', () => {
  assert.deepEqual(droitsLus(undefined), { projets: {}, services: {} });
  assert.equal(roleDesDroits(DROITS_VIDES), 'lecteur');
  const c = compte(DROITS_VIDES);
  assert.equal(commandeOuverteAuCompte(c, 'coffre.lister'), false);
  assert.equal(commandeOuverteAuCompte(c, 'deploy.start'), false);
  assert.equal(commandeOuverteAuCompte(c, 'settings.update'), false);
});

test('une valeur inconnue tombe, un projet disparu aussi', () => {
  const lus = droitsLus({ projets: { a: 'travailler', b: 'admin', c: 'voir' }, services: { coffre: 'tout', moteurs: 'voir' } }, ['a', 'b']);
  assert.deepEqual(lus, { projets: { a: 'travailler' }, services: { moteurs: 'voir' } });
});

test('le niveau du projet borne le geste : voir < travailler < déployer', () => {
  assert.ok(niveauSuffit('deployer', 'travailler'));
  assert.ok(!niveauSuffit('voir', 'travailler'));
  assert.ok(!niveauSuffit(undefined, 'voir'));
  assert.equal(niveauRequisPourLaCommande('deploy.start'), 'deployer');
  assert.equal(niveauRequisPourLaCommande('card.create'), 'travailler');
  assert.equal(niveauRequisPourLaCommande('card.get'), 'voir');
  const c = compte({ projets: { a: 'deployer', b: 'voir' }, services: {} });
  assert.equal(c.role, 'membre');
  assert.ok(commandeOuverteAuCompte(c, 'deploy.start'));
  assert.equal(viseurPourLeCompte(c, 'deploy.start'), 'projet:projectId');
  // Arrêter une publication par son numéro reste à l'administrateur.
  assert.ok(!commandeOuverteAuCompte(c, 'deploy.stop'));
});

test('un service s’ouvre en lecture ou en écriture, et ses événements avec lui', () => {
  const c = compte({ projets: {}, services: { reglages: 'voir', moteurs: 'modifier' } });
  assert.ok(commandeOuverteAuCompte(c, 'settings.get'));
  assert.ok(!commandeOuverteAuCompte(c, 'settings.update'));
  assert.ok(commandeOuverteAuCompte(c, 'account.connect'));
  assert.ok(!commandeOuverteAuCompte(c, 'coffre.lister'));
  assert.ok(evenementOuvertParUnService(c, 'settings'));
  assert.ok(evenementOuvertParUnService(c, 'quotas'));
  // Les dossiers du coffre, communs à tous les projets, ne s'ouvrent jamais à un tiers.
  const coffre = compte({ projets: {}, services: { coffre: 'modifier' } });
  assert.ok(commandeOuverteAuCompte(coffre, 'coffre.enregistrer'));
  assert.ok(!commandeOuverteAuCompte(coffre, 'coffre.dossier.supprimer'));
  // La gestion des accès reste à l'administrateur, quelle que soit la grille.
  assert.ok(!commandeOuverteAuCompte(coffre, 'comptes.creer'));
});

test('un accès d’avant la grille garde exactement ce qu’il avait', () => {
  assert.deepEqual(droitsDuCompte({ role: 'membre', projets: ['a'] }), { projets: { a: 'travailler' }, services: {} });
  assert.deepEqual(droitsDuCompte({ role: 'lecteur', projets: ['a'] }), { projets: { a: 'voir' }, services: {} });
});

test('le premier formulaire part de rien, les suivants reprennent le dernier accès créé', () => {
  assert.deepEqual(droitsDeDepart([], ['a']), { projets: {}, services: {} });
  const ancien = { role: 'membre' as const, projets: ['a'], creeLe: 1, droits: { projets: { a: 'travailler' as const }, services: {} } };
  const recent = { role: 'lecteur' as const, projets: ['b'], creeLe: 2, droits: { projets: { b: 'voir' as const, x: 'voir' as const }, services: { coffre: 'voir' as const } } };
  const client = { role: 'client' as const, projets: ['a'], creeLe: 3 };
  assert.deepEqual(droitsDeDepart([ancien, recent, client], ['a', 'b']), { projets: { b: 'voir' }, services: { coffre: 'voir' } });
});
