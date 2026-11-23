import test from 'node:test';
import assert from 'node:assert/strict';
import { accesDeLAgent, accesSuffit, guideDesServices, refusDuService, type Interlocuteur } from '@beluga/shared';

const admin: Interlocuteur = { role: 'admin', projets: [] };
const membre: Interlocuteur = {
  role: 'membre',
  projets: ['p1', 'p2'],
  droits: { projets: { p1: 'travailler', p2: 'voir' }, services: { coffre: 'voir' } },
};

test('le propriétaire a tout, partout', () => {
  assert.equal(accesDeLAgent({ interlocuteur: admin, service: 'studio', projectId: 'p9' }), 'agir');
  assert.equal(accesDeLAgent({ interlocuteur: admin, service: 'surveillances' }), 'agir');
});

test('un accès tiers suit le niveau du projet', () => {
  assert.equal(accesDeLAgent({ interlocuteur: membre, service: 'medias', projectId: 'p1' }), 'agir');
  assert.equal(accesDeLAgent({ interlocuteur: membre, service: 'medias', projectId: 'p2' }), 'lire');
  assert.equal(accesDeLAgent({ interlocuteur: membre, service: 'medias', projectId: 'p3' }), 'aucun');
  assert.equal(accesDeLAgent({ interlocuteur: membre, service: 'studio' }), 'aucun', 'sans projet : fermé');
});

test('un service sans projet reste au propriétaire', () => {
  assert.equal(accesDeLAgent({ interlocuteur: membre, service: 'surveillances', projectId: 'p1' }), 'aucun');
});

test('le coffre suit en plus sa ligne de service', () => {
  assert.equal(accesDeLAgent({ interlocuteur: membre, service: 'coffre', projectId: 'p1' }), 'lire');
  const sansCoffre: Interlocuteur = { ...membre, droits: { projets: { p1: 'deployer' }, services: {} } };
  assert.equal(accesDeLAgent({ interlocuteur: sansCoffre, service: 'coffre', projectId: 'p1' }), 'aucun');
});

test('un client ne pilote rien', () => {
  assert.equal(accesDeLAgent({ interlocuteur: { role: 'client', projets: ['p1'] }, service: 'medias', projectId: 'p1' }), 'aucun');
});

test('interlocuteur inconnu : le droit le plus étroit', () => {
  assert.equal(accesDeLAgent({ interlocuteur: null, service: 'medias', projectId: 'p1', projetDeLAgent: 'p1' }), 'lire');
  assert.equal(accesDeLAgent({ interlocuteur: null, service: 'medias', projectId: 'p2', projetDeLAgent: 'p1' }), 'aucun');
  assert.equal(accesDeLAgent({ interlocuteur: null, service: 'coffre', projectId: 'p1', projetDeLAgent: 'p1' }), 'aucun');
});

test('un accès tiers d’avant la grille garde son rôle', () => {
  const lecteur: Interlocuteur = { role: 'lecteur', projets: ['p1'] };
  assert.equal(accesDeLAgent({ interlocuteur: lecteur, service: 'reseaux', projectId: 'p1' }), 'lire');
});

test('accesSuffit et le refus en clair', () => {
  assert.ok(accesSuffit('agir', 'lire'));
  assert.ok(!accesSuffit('lire', 'agir'));
  const refus = refusDuService('medias', 'agir', 'Vitrine');
  assert.match(refus, /Médias/);
  assert.match(refus, /Vitrine/);
  assert.doesNotMatch(refus, /je n.ai pas les droits/i);
});

test('le guide ne parle que des services ouverts', () => {
  assert.equal(guideDesServices({}), '');
  const g = guideDesServices({ medias: 'lire', studio: 'agir', reseaux: 'agir' });
  assert.match(g, /Médias : lister les images, vidéos et sons déjà fabriqués \(lecture seule\)/);
  assert.match(g, /Studio/);
  assert.match(g, /Programmer/);
  assert.doesNotMatch(g, /Coffre/);
  assert.ok(g.length < 2000, 'le guide reste court');
});
