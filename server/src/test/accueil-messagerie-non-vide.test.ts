/**
 * L'ACCUEIL DE LA MESSAGERIE NE PEUT PLUS ÊTRE VIDE ALORS QUE DES CLIENTS ONT
 * ÉCHANGÉ.
 *
 * Ce que cet essai rattrape : le relevé des échanges lisait `demandes.cree_le`,
 * une colonne qui n'existe pas — elle s'appelle `creee_le`, avec trois « e ».
 * SQLite levait donc « no such column » dès qu'un client avait un projet, la
 * commande `espace.tableauDeBord` tombait en entier, et l'écran s'affichait
 * tous chiffres à zéro, sans une seule fiche. Un défaut invisible au typage :
 * seule une VRAIE base le montre, d'où cet essai qui en ouvre une.
 *
 * On vérifie donc les trois sources d'échanges à la fois — une demande
 * déposée, un commentaire sous cette demande, un message du fil — parce que
 * chacune vient d'une table différente et qu'une seule qui tombe suffit à vider
 * l'écran.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { joursDInteractions, minuitDe, UN_JOUR_MS } from '@beluga/shared';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'accueil-messagerie-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const espace = await import('../espace-client.js');

const auteur = { id: 'client-essai', nom: 'Cliente d’essai', role: 'client' as const };

const projet = store.saveProject({
  id: store.newId(),
  name: 'Projet du client',
  path: bacASable,
  defaultEngine: 'claude',
  isSelf: false,
  archived: false,
  createdAt: store.now(),
  updatedAt: store.now(),
} as any);

test('les échanges d’un client se relèvent VRAIMENT, sans tomber sur la base', () => {
  const demande = espace.creerDemande(auteur, { projectId: projet.id, titre: 'Une première demande' });
  espace.commenterDemande(auteur, demande.id, 'Et une précision.');
  espace.envoyerAuFil(auteur, auteur.id, 'Bonjour !');

  const debut = minuitDe(Date.now() - 6 * UN_JOUR_MS);
  const quand = espace.horodatagesDesEchanges([projet.id], auteur.id, debut, Date.now());

  assert.equal(quand.length, 3, 'la demande, son commentaire et le message du fil comptent chacun');
  const cases = joursDInteractions(quand, debut, Date.now());
  assert.equal(cases.length, 7, 'une case par jour de la période, bornes incluses');
  assert.equal(
    cases.reduce((total, n) => total + n, 0),
    3,
    'AUCUN ÉCRAN VIDE : ce qui a été échangé se retrouve dans le graphique',
  );
  assert.equal(cases.at(-1), 3, 'tout vient d’être écrit : tout est dans la journée en cours');
});

test('la période exclut par les DEUX bouts, jamais par le seul début', () => {
  const hier = minuitDe(Date.now() - UN_JOUR_MS);
  const quand = espace.horodatagesDesEchanges([projet.id], auteur.id, minuitDe(Date.now() - 6 * UN_JOUR_MS), hier - 1);
  assert.deepEqual(quand, [], 'ce qui vient après la fin de période ne remonte pas');
});

test('un client sans aucun projet ne fait pas tomber le relevé', () => {
  assert.deepEqual(espace.horodatagesDesEchanges([], 'fil-inconnu', 0, Date.now()), []);
});
