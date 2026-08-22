import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMANDES_INTEGREES,
  commandeDuMessage,
  commandesDuMoteur,
  deplacerDansLaListe,
  filtrerCommandes,
  insereCommande,
  nomDeCommandeValable,
  slashEnCours,
  type CommandeSlash,
} from '@haikodev/shared';
import { commandesSurLeDisque } from '../commandes-slash.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* Le « / » en train de s'écrire                                        */
/* ------------------------------------------------------------------ */

test('le menu s’ouvre sur une barre oblique en tête de message', () => {
  const zone = slashEnCours('/', 1);
  assert.deepEqual(zone, { debut: 0, fin: 1, mot: '' });
});

test('le mot déjà tapé derrière la barre est rendu', () => {
  const zone = slashEnCours('/comp', 5);
  assert.deepEqual(zone, { debut: 0, fin: 5, mot: 'comp' });
});

test('une barre en début de LIGNE ouvre aussi le menu', () => {
  const texte = 'Merci de relire ceci.\n/rev';
  const zone = slashEnCours(texte, texte.length);
  assert.equal(zone?.mot, 'rev');
  assert.equal(zone?.debut, 22);
});

test('un chemin de fichier n’ouvre rien', () => {
  assert.equal(slashEnCours('web/src', 7), null);
  assert.equal(slashEnCours('regarde web/src/app.tsx', 23), null);
});

test('une date ou une fraction n’ouvrent rien', () => {
  assert.equal(slashEnCours('12/08', 5), null);
  assert.equal(slashEnCours('1/2', 3), null);
});

test('un espace après la commande referme le menu', () => {
  assert.equal(slashEnCours('/compact ', 9), null);
  assert.equal(slashEnCours('/compact et ensuite', 19), null);
});

test('le curseur remonté avant la barre ne rouvre rien', () => {
  assert.equal(slashEnCours('/compact', 0), null);
});

/* ------------------------------------------------------------------ */
/* Le tri, le filtre et l’insertion                                     */
/* ------------------------------------------------------------------ */

const RELEVEES: CommandeSlash[] = [
  { nom: 'compta', description: 'Facturation', origine: 'compte' },
  { nom: 'deployer', description: 'Mise en ligne', origine: 'projet' },
  { nom: 'compact', description: 'relevé sur le disque', origine: 'compte' },
];

test('les commandes du projet passent devant, l’alphabet départage', () => {
  const noms = commandesDuMoteur('claude', RELEVEES).map((c) => c.nom);
  // Le projet d'abord, le compte ensuite, le moteur en dernier.
  assert.deepEqual(noms.slice(0, 3), ['deployer', 'compact', 'compta']);
  // Et à l'intérieur du bloc du moteur, l'alphabet départage.
  const duMoteur = noms.slice(3);
  assert.deepEqual(duMoteur, [...duMoteur].sort((a, b) => a.localeCompare(b)));
});

test('une commande relevée sur le disque l’emporte sur celle écrite en dur', () => {
  const liste = commandesDuMoteur('claude', RELEVEES);
  const compact = liste.find((c) => c.nom === 'compact');
  assert.equal(compact?.description, 'relevé sur le disque');
  assert.equal(compact?.origine, 'compte');
});

test('un nom impossible est écarté au lieu d’être affiché', () => {
  const liste = commandesDuMoteur('codex', [{ nom: 'mon prompt', origine: 'compte' }]);
  assert.ok(!liste.some((c) => c.nom === 'mon prompt'));
});

test('chaque moteur a sa propre liste, et aucune n’est vide', () => {
  // Un menu vide fait passer la fonction pour cassée : les deux moteurs en
  // ligne de commande portent leurs propres commandes, même sans rien sur le
  // disque. C'est le trou qu'on a bouché.
  assert.ok(commandesDuMoteur('claude', []).length > 0);
  assert.ok(commandesDuMoteur('codex', []).length > 0);
  const claude = commandesDuMoteur('claude', []).map((c) => c.nom);
  const codex = commandesDuMoteur('codex', []).map((c) => c.nom);
  assert.notDeepEqual(claude, codex);
  assert.ok(claude.includes('context') && !codex.includes('context'));
  assert.ok(codex.includes('diff') && !claude.includes('diff'));
});

test('aucune commande intégrée ne porte un nom impossible à taper', () => {
  for (const [moteur, liste] of Object.entries(COMMANDES_INTEGREES)) {
    for (const commande of liste) {
      assert.ok(nomDeCommandeValable(commande.nom), `${moteur} : ${commande.nom}`);
      assert.equal(commande.origine, 'moteur');
    }
  }
});

test('une commande du disque remplace celle du moteur, sans la doubler', () => {
  const liste = commandesDuMoteur('codex', [{ nom: 'plan', origine: 'compte' }]);
  assert.equal(liste.filter((c) => c.nom === 'plan').length, 1);
  assert.equal(liste.find((c) => c.nom === 'plan')?.origine, 'compte');
});

test('le filtre met les débuts de mot devant', () => {
  const liste = commandesDuMoteur('claude', RELEVEES);
  const trouves = filtrerCommandes(liste, 'com');
  assert.deepEqual(trouves.map((c) => c.nom), ['compact', 'compta']);
});

test('un filtre vide rend toute la liste', () => {
  const liste = commandesDuMoteur('claude', RELEVEES);
  assert.equal(filtrerCommandes(liste, '').length, liste.length);
});

test('la commande choisie remplace le mot à moitié tapé, et pose un espace', () => {
  const texte = '/comp';
  const zone = slashEnCours(texte, 5)!;
  assert.deepEqual(insereCommande(texte, zone, 'compact'), { texte: '/compact ', curseur: 9 });
});

test('un espace déjà présent n’est pas doublé', () => {
  const texte = '/c la suite';
  const zone = slashEnCours(texte, 2)!;
  const apres = insereCommande(texte, zone, 'compact');
  assert.equal(apres.texte, '/compact la suite');
  assert.equal(apres.curseur, 8);
});

test('l’insertion respecte le reste du message', () => {
  const texte = 'Bonjour\n/rev';
  const zone = slashEnCours(texte, texte.length)!;
  assert.equal(insereCommande(texte, zone, 'review').texte, 'Bonjour\n/review ');
});

/* ------------------------------------------------------------------ */
/* Ce que le message porte, et le déplacement au clavier                */
/* ------------------------------------------------------------------ */

test('la commande d’un message se lit en tête, et nulle part ailleurs', () => {
  assert.equal(commandeDuMessage('/compact merci'), 'compact');
  assert.equal(commandeDuMessage('/compact'), 'compact');
  assert.equal(commandeDuMessage('merci /compact'), null);
  // Une date écrite en tête n'est pas une commande : le nom doit être suivi
  // d'un espace ou de la fin du message, jamais d'une seconde barre.
  assert.equal(commandeDuMessage('/12/08 rendez-vous'), null);
  assert.equal(commandeDuMessage('web/src'), null);
});

test('les deux bouts de la liste se rejoignent', () => {
  assert.equal(deplacerDansLaListe(0, 3, -1), 2);
  assert.equal(deplacerDansLaListe(2, 3, 1), 0);
  assert.equal(deplacerDansLaListe(0, 0, 1), 0);
});

/* ------------------------------------------------------------------ */
/* Le relevé sur le disque                                              */
/* ------------------------------------------------------------------ */

test('les commandes et les compétences du disque sont relevées, avec leur description', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-slash-'));
  const compte = path.join(racine, 'compte');
  const projet = path.join(racine, 'projet');
  fs.mkdirSync(path.join(compte, 'commands'), { recursive: true });
  fs.writeFileSync(
    path.join(compte, 'commands', 'ranger.md'),
    '---\ndescription: Range le bureau\n---\n\nRange tout.\n',
  );
  fs.mkdirSync(path.join(projet, '.claude', 'skills', 'compta'), { recursive: true });
  fs.writeFileSync(
    path.join(projet, '.claude', 'skills', 'compta', 'SKILL.md'),
    '---\nname: compta\ndescription: Devis et factures\n---\n',
  );

  const relevees = commandesSurLeDisque('claude', projet, [compte]);
  const parNom = new Map(relevees.map((c) => [c.nom, c]));
  assert.equal(parNom.get('ranger')?.description, 'Range le bureau');
  assert.equal(parNom.get('ranger')?.origine, 'compte');
  assert.equal(parNom.get('compta')?.description, 'Devis et factures');
  assert.equal(parNom.get('compta')?.origine, 'projet');

  fs.rmSync(racine, { recursive: true, force: true });
});

test('un dossier absent ne fait pas échouer le relevé', () => {
  assert.deepEqual(commandesSurLeDisque('codex', '/tmp/projet-qui-nexiste-pas-haiko', ['/tmp/rien-du-tout']), []);
});
