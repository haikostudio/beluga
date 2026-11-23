import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * UN PROJET NE S'EFFACE JAMAIS D'UN CLIC : IL SE MET DE CÔTÉ.
 *
 * Depuis le 08/10/2026, une suppression DÉFINITIVE existe, mais par une autre
 * commande (`project.supprimerDefinitivement`, voir `suppression-projet.test.ts`),
 * qui exige le nom recopié, une sauvegarde et l'arrêt des agents. `project.delete`,
 * lui, ne fait que mettre de côté — c'est ce que verrouille ce fichier.
 *
 * Le 22/09/2026, le bouton « Effacer » des réglages d'un projet a détruit d'un
 * clic le projet HaikoDev — 94 cartes, 185 conversations, 88 pièces jointes,
 * 62 mises en ligne —, reconstruit ensuite à la main depuis la sauvegarde de
 * nuit. Le bouton a disparu, et la commande `project.delete` (qu'un ancien
 * écran encore ouvert peut toujours envoyer) aboutit désormais à la même mise
 * de côté que « Mettre de côté » : le projet quitte la colonne, rien ne part.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'projet-jamais-efface-'));
process.env.BELUGA_DATA = bacASable;

const { Card, Project } = await import('@beluga/shared');
const store = await import('../store.js');

const projet = store.saveProject(
  Project.parse({ id: 'projet-precieux', name: 'Projet précieux', path: bacASable, createdAt: store.now(), updatedAt: store.now() }),
);
store.saveCard(
  Card.parse({
    id: 'carte-archivee',
    projectId: projet.id,
    column: 'archived',
    position: 1,
    title: 'Un travail fini',
    run: { engine: 'claude' },
    createdAt: store.now(),
    updatedAt: store.now(),
  }),
);

test('mettre de côté cache le projet de la colonne sans rien effacer', () => {
  const range = store.mettreProjetDeCote(projet.id);
  assert.equal(range?.archived, true);
  assert.equal(store.listProjects().some((p) => p.id === projet.id), false, 'plus dans la colonne de gauche');
  assert.equal(store.listProjects(true).some((p) => p.id === projet.id), true, 'toujours en base');
  assert.equal(store.getCard('carte-archivee')?.title, 'Un travail fini', 'ses cartes restent');
});

test('le projet se remet en service d’un geste, avec ses cartes', () => {
  const revenu = store.mettreProjetDeCote(projet.id, false);
  assert.equal(revenu?.archived, false);
  assert.equal(store.listCards(projet.id).length, 1);
});

test('un projet inconnu ne se met pas de côté', () => {
  assert.equal(store.mettreProjetDeCote('inconnu'), null);
});

test('le magasin n’a toujours aucune fonction nommée « deleteProject » : l’effacement vit à part', () => {
  assert.equal('deleteProject' in store, false);
});

test('la commande « project.delete » met de côté, elle n’efface plus', () => {
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.resolve(ici, '../../src/ws.ts'), 'utf8');
  const debut = source.indexOf("case 'project.delete':");
  assert.ok(debut > 0, 'la commande existe encore pour les anciens écrans');
  const bloc = source.slice(debut, source.indexOf('case ', debut + 10));
  assert.match(bloc, /mettreProjetDeCote/);
  assert.doesNotMatch(bloc, /DELETE|delete[A-Z]|supprimerDefinitivement/);
});
