import test from 'node:test';
import assert from 'node:assert/strict';
import { reglageSuitLesAutresOnglets, reglagesALaReconnexion, reglagesPourCetOnglet } from '@beluga/shared';

/*
 * CHAQUE ONGLET GARDE SA PAGE (12/11/2026) : seuls le thème, la langue et le brouillon suivent d'un onglet à l'autre ;
 * un changement posé par le serveur lui-même s'applique partout ; une reconnexion garde l'affichage de l'onglet.
 */

test('seuls le thème, la langue et le brouillon suivent les autres onglets', () => {
  assert.equal(reglageSuitLesAutresOnglets('theme'), true);
  assert.equal(reglageSuitLesAutresOnglets('langue'), true);
  assert.equal(reglageSuitLesAutresOnglets('draft.agent-1'), true);
  assert.equal(reglageSuitLesAutresOnglets('draftAttachments.agent-1'), true);
  for (const cle of ['project.active', 'mobile.onglet', 'sidebar.collapsed', 'studio.timelineOuverte', 'board.colonne']) assert.equal(reglageSuitLesAutresOnglets(cle), false, cle);
});

test('un changement d’un AUTRE onglet ne garde que ses clés vivantes ; le sien et celui du serveur passent', () => {
  const recus = { 'project.active': 'p2', theme: 'sombre' };
  assert.deepEqual(reglagesPourCetOnglet(recus, 'onglet-b', 'onglet-a'), { theme: 'sombre' });
  assert.deepEqual(reglagesPourCetOnglet(recus, 'onglet-a', 'onglet-a'), recus, 'son propre écho');
  assert.deepEqual(reglagesPourCetOnglet(recus, undefined, 'onglet-a'), recus, 'un changement du serveur (un agent qui pilote la colonne)');
});

test('une reconnexion garde la page de l’onglet ; la première connexion repart de la base', () => {
  const actuels = { 'project.active': 'p1', theme: 'clair', 'sidebar.collapsed': false };
  const recus = { 'project.active': 'p2', theme: 'sombre', 'resume.lignes': 20 };
  assert.deepEqual(reglagesALaReconnexion(actuels, recus, false), recus);
  assert.deepEqual(reglagesALaReconnexion(actuels, recus, true), { 'project.active': 'p1', theme: 'sombre', 'sidebar.collapsed': false, 'resume.lignes': 20 });
});
