/**
 * LES TROIS NIVEAUX DE CHEFS DE COMMUNICATION — les règles pures (`shared/src/chefs-de-communication.ts`).
 *
 * Ce que ces essais verrouillent : la ronde du matin ne réveille QUE les chefs de marque qui ont du neuf ou une
 * démarche à faire avancer, jamais un chef déjà au travail, le plus de neuf d'abord, sous un plafond ; la demande
 * du point nomme la marque, ses faits et ses projets ; le mot du général se tait quand personne n'est relancé ;
 * la mémoire jointe ne garde que les sujets communication / marketing, les plus importants d'abord, sous plafond ;
 * un rôle mal formé se lit comme « aucun rôle » ; chaque niveau a sa consigne, et le moteur reçoit la sienne.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSIGNE_DU_CHEF_DE_MARQUE,
  CONSIGNE_DU_CHEF_DE_PROJET,
  CONSIGNE_DU_CHEF_GENERAL,
  bilanDeLaRonde,
  consigneDuChef,
  demandeDuPointDeMarque,
  effortParDefaut,
  lireRoleDuChef,
  marquesARelancer,
  memoireCommunicationJointe,
  niveauDAccueil,
  type MarqueALaRonde,
} from '@beluga/shared';

const marque = (marqueId: string, faits: string[], demarcheEnCours = false, chefOccupe = false): MarqueALaRonde => ({ marqueId, nom: marqueId.toUpperCase(), faits, demarcheEnCours, chefOccupe });

test('la ronde ne réveille que les chefs qui ont du neuf ou une démarche, jamais un chef occupé', () => {
  const retenues = marquesARelancer([marque('a', []), marque('b', ['1 publication']), marque('c', [], true), marque('d', ['2 messages'], false, true)]);
  assert.deepEqual(retenues.map((m) => m.marqueId), ['b', 'c']);
});

test('le plus de neuf d’abord, une démarche seule ensuite, et le plafond tient', () => {
  const retenues = marquesARelancer([marque('a', [], true), marque('b', ['x']), marque('c', ['x', 'y']), marque('d', ['x'], true)], 3);
  assert.deepEqual(retenues.map((m) => m.marqueId), ['c', 'd', 'b']);
  assert.equal(marquesARelancer([marque('a', ['x'])], 0).length, 0);
});

test('la demande du point nomme la marque, ses faits, ses projets, et dit de confier', () => {
  const texte = demandeDuPointDeMarque({ ...marque('kipou', ['3 message(s) reçu(s)'], true), projets: [{ projetId: 'p1', nom: 'Site', faits: ['3 message(s) reçu(s)'] }, { projetId: 'p2', nom: 'Appli', faits: [] }] });
  assert.match(texte, /KIPOU/);
  assert.match(texte, /Site \(3 message/);
  assert.doesNotMatch(texte, /Appli/);
  assert.match(texte, /confier/);
  assert.match(texte, /RIEN À SIGNALER/);
});

test('le mot du chef général se tait quand personne n’est relancé', () => {
  assert.equal(bilanDeLaRonde([]), null);
  const mot = bilanDeLaRonde([{ nom: 'Kipou', faits: [] }])!;
  assert.match(mot, /^```directeur\n/);
  assert.match(JSON.parse(mot.split('\n')[1]!).titre, /Kipou/);
});

test('la mémoire jointe ne garde que la communication, la plus importante d’abord, sous plafond', () => {
  const faits = [
    { id: 'MEM-1', titre: 'Le ton est tutoyant', resume: '', sujets: ['communication'], importance: 'P2', modifieLe: 1, projet: 'Kipou' },
    { id: 'MEM-2', titre: 'Base SQLite', resume: '', sujets: ['interface'], importance: 'P0', modifieLe: 2, projet: 'Kipou' },
    { id: 'MEM-3', titre: 'TikTok ne marche pas', resume: 'trois essais', sujets: ['marketing'], importance: 'P1', modifieLe: 3, projet: 'Kipou' },
  ];
  const texte = memoireCommunicationJointe(faits)!;
  assert.ok(texte.indexOf('MEM-3') < texte.indexOf('MEM-1'));
  assert.doesNotMatch(texte, /MEM-2/);
  assert.equal(memoireCommunicationJointe([faits[1]!]), undefined);
  const court = memoireCommunicationJointe(faits, 60)!;
  assert.match(court, /MEM-3/);
  assert.doesNotMatch(court, /MEM-1\]/);
  assert.match(court, /1 autre/);
});

test('un rôle mal formé se lit comme aucun rôle', () => {
  assert.equal(lireRoleDuChef(null), null);
  assert.equal(lireRoleDuChef('pas du json'), null);
  assert.equal(lireRoleDuChef(JSON.stringify({ niveau: 'projet', compteId: 'c', marqueId: 'm' })), null);
  assert.deepEqual(lireRoleDuChef(JSON.stringify({ niveau: 'marque', compteId: 'c', marqueId: 'm' })), { niveau: 'marque', compteId: 'c', marqueId: 'm' });
});

test('chaque niveau a sa consigne, avec la mémoire, et un accueil minimal à effort moyen', () => {
  assert.ok(consigneDuChef('general').startsWith(CONSIGNE_DU_CHEF_GENERAL));
  assert.ok(consigneDuChef('marque').startsWith(CONSIGNE_DU_CHEF_DE_MARQUE));
  assert.ok(consigneDuChef('projet').startsWith(CONSIGNE_DU_CHEF_DE_PROJET));
  /* Tout média se fabrique dans le Studio (03/11/2026), aux trois niveaux. */
  for (const niveau of ['general', 'marque', 'projet'] as const) assert.match(consigneDuChef(niveau), /SE FABRIQUENT DANS LE STUDIO/);
  for (const c of [CONSIGNE_DU_CHEF_GENERAL, CONSIGNE_DU_CHEF_DE_MARQUE, CONSIGNE_DU_CHEF_DE_PROJET]) {
    assert.match(c, /« memoire », geste « proposer »/);
    assert.match(c, /DEUX NIVEAUX, SANS EXCEPTION/);
  }
  assert.match(CONSIGNE_DU_CHEF_GENERAL, /action « confier »/);
  assert.match(CONSIGNE_DU_CHEF_DE_MARQUE, /chef de projet/);
  for (const motif of ['chef-de-marque', 'chef-de-projet'] as const) {
    assert.equal(niveauDAccueil({ role: 'task', motif }), 'minimal');
    assert.equal(effortParDefaut({ role: 'task', motif }), 'medium');
  }
});
