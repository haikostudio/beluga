import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  chercherFaits,
  doitSynthetiser,
  estLigneDeJournal,
  resumerFait,
  sujetDuFait,
  syntheseAcceptable,
  texteIndex,
} from '@haikodev/shared';
import { humanStep } from '../engines/types.js';
import {
  appendMemory,
  blocMemoire,
  briefing,
  creerFichierInstructions,
  detailMemoire,
  memoryFacts,
  migrerJournal,
  readHistory,
  readMemory,
  replaceMemory,
} from '../memory.js';

/*
 * Alléger la mémoire des projets : le journal sort du contexte, l'index
 * remplace le texte entier, et le détail reste accessible à la demande.
 */

function dossierDEssai(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-memoire-'));
}

/* ------------------------------------------------------------------ */
/* Journal contre faits                                                */
/* ------------------------------------------------------------------ */

test('une livraison datée est reconnue comme du journal, un piège reste un fait', () => {
  assert.equal(estLigneDeJournal('03.08.2026 : « Barre du haut épurée » livrée et publiée.'), true);
  assert.equal(estLigneDeJournal('- 3.8.2026 : « Point vocal » livrée.'), true);
  assert.equal(estLigneDeJournal('Piège vécu le 03/08/2026 : un autre agent a changé de branche.'), false);
  assert.equal(estLigneDeJournal('Contraste du thème sombre renforcé (03.08.2026) : fond au noir pur.'), false);
});

test('une livraison datée part dans l\'historique, jamais dans la mémoire', () => {
  const dossier = dossierDEssai();
  appendMemory(dossier, 'Le brouillon ne s\'efface que sur un geste de l\'utilisateur.');
  appendMemory(dossier, '03.08.2026 : « Alléger la mémoire » livrée et publiée.');

  assert.equal(memoryFacts(dossier).length, 1);
  assert.match(readHistory(dossier), /Alléger la mémoire/);
  assert.doesNotMatch(readMemory(dossier), /Alléger la mémoire/);
});

test('les livraisons déjà écrites dans la mémoire sont déménagées une fois pour toutes', () => {
  const dossier = dossierDEssai();
  fs.writeFileSync(
    path.join(dossier, 'MEMOIRE.md'),
    '# Mémoire du projet\n\n- Une règle durable qui doit rester.\n- 01.08.2026 : « Une carte » livrée.\n- 02.08.2026 : « Une autre » livrée et publiée.\n',
  );

  assert.equal(migrerJournal(dossier), 2);
  assert.equal(memoryFacts(dossier).length, 1);
  assert.match(readHistory(dossier), /Une autre/);
  // Deuxième passage : plus rien à déménager.
  assert.equal(migrerJournal(dossier), 0);
});

/* ------------------------------------------------------------------ */
/* L'index                                                             */
/* ------------------------------------------------------------------ */

test('chaque fait est rangé sous un sujet', () => {
  assert.equal(sujetDuFait('Sur téléphone, tout menu déroulant devient un tiroir en bas.'), 'mobile');
  assert.equal(sujetDuFait('Publier fusionne les branches du lot dans la principale.'), 'publication');
  assert.equal(sujetDuFait('Les fenêtres de quota s\'affichent en temps restant.'), 'quotas');
  assert.equal(sujetDuFait('Une phrase sans aucun mot connu de nulle part.'), 'divers');
});

test('la ligne d\'index garde la règle et laisse tomber l\'explication', () => {
  const fait =
    "Le voyant d'état est à DROITE au bout du titre de la carte, et jamais à gauche : l'état en cours sort en bas de la carte sur un fond plus clair, comme une étiquette glissée derrière.";
  const court = resumerFait(fait);
  assert.match(court, /voyant/);
  assert.doesNotMatch(court, /étiquette/);
  assert.ok(court.length <= 111, `trop long : ${court}`);
});

test('l\'index est nettement plus court que la mémoire entière', () => {
  const faits = Array.from({ length: 30 }, (_, i) =>
    `Règle numéro ${i} sur le tiroir du téléphone, qui se referme en tirant la poignée vers le bas : elle vient avec une explication longue, une raison, un piège rencontré ce jour-là, et la parade retenue pour que personne ne le refasse une deuxième fois.`,
  );
  const index = texteIndex(faits);
  assert.ok(index.length < faits.join('\n').length / 2);
  assert.match(index, /Téléphone :/);
  assert.match(index, /^\s+1\. /m);
});

/* ------------------------------------------------------------------ */
/* Le détail à la demande                                              */
/* ------------------------------------------------------------------ */

test('un agent retrouve le texte entier d\'un fait par son numéro, son sujet ou des mots', () => {
  const dossier = dossierDEssai();
  const complet =
    "Le creux du clavier n'est réservé QUE si un champ a le curseur et que l'écart dépasse cent points, sinon la barre d'adresse passait pour un clavier.";
  appendMemory(dossier, 'La publication fusionne les branches du lot dans la principale.');
  appendMemory(dossier, complet);

  assert.match(detailMemoire(dossier, '2'), /barre d'adresse/);
  assert.match(detailMemoire(dossier, 'mobile'), /creux du clavier/);
  assert.match(detailMemoire(dossier, 'clavier curseur'), /cent points/);
  // Rien trouvé : on rend l'index plutôt qu'un silence.
  assert.match(detailMemoire(dossier, 'zzz introuvable'), /index complet/i);
});

test('la recherche par mots exige que tous les mots soient présents', () => {
  const faits = ['Le tiroir se referme en tirant la poignée vers le bas.', 'La poignée de redimensionnement est un trait fin.'];
  assert.equal(chercherFaits(faits, 'poignée').length, 2);
  assert.equal(chercherFaits(faits, 'poignée redimensionnement').length, 1);
});

/* ------------------------------------------------------------------ */
/* Ce qui part au moteur                                               */
/* ------------------------------------------------------------------ */

test('le briefing envoie l\'index, pas la mémoire entière, et parle du fichier d\'instructions', () => {
  const dossier = dossierDEssai();
  const explication =
    " : la raison longue de cette règle, écrite pour qu'un agent ne refasse pas l'erreur, avec le détail du piège rencontré.";
  for (let i = 0; i < 20; i++) appendMemory(dossier, `Règle ${i} sur le tiroir du téléphone${explication}`);

  const ouverture = briefing(dossier, 'Essai', true);
  assert.match(ouverture, /index des faits retenus \(20\)/);
  assert.match(ouverture, /project_memory/);
  assert.match(ouverture, /CLAUDE\.md/);
  // L'explication longue ne part plus : elle se demande.
  assert.doesNotMatch(ouverture, /ne refasse pas l'erreur/);

  /*
   * On pèse la PART DE MÉMOIRE, jamais le briefing entier : le reste du
   * briefing (nom du projet, fichiers d'instructions, compétences partagées
   * installées sur la machine) n'a rien à voir avec la règle et grossit avec le
   * produit. Peser le tout revenait à faire dépendre le contrôle de l'état de
   * la machine — et c'est ce qui l'a fait tomber.
   */
  const bloc = blocMemoire(dossier);
  assert.ok(ouverture.includes(bloc), 'le briefing porte bien la part de mémoire');
  assert.ok(bloc.length < readMemory(dossier).length, `trop long : ${bloc.length}`);

  // Avec Codex, c'est l'autre fichier d'instructions qui est nommé.
  assert.match(briefing(dossier, 'Essai', true, 'codex'), /AGENTS\.md/);
});

test('aller chercher un fait détaillé se voit dans le déroulé, avec le sujet demandé', () => {
  assert.equal(
    humanStep('mcp__haikodev__project_memory', { sujet: 'tiroir du téléphone' }).label,
    'Mémoire du projet : le détail sur « tiroir du téléphone »',
  );
  assert.equal(humanStep('mcp__haikodev__project_memory', {}).label, 'Lecture de la mémoire du projet');
});

test('un projet sans fichier d\'instructions en reçoit un, un projet qui en a déjà n\'est pas touché', () => {
  const neuf = dossierDEssai();
  assert.equal(creerFichierInstructions(neuf, 'Projet neuf'), true);
  const pose = fs.readFileSync(path.join(neuf, 'CLAUDE.md'), 'utf8');
  assert.match(pose, /Projet neuf — instructions du moteur/);
  assert.match(pose, /Ne jamais publier de sa propre initiative/);
  // Deuxième passage : on n'écrase jamais ce qui existe.
  fs.writeFileSync(path.join(neuf, 'CLAUDE.md'), '# Écrit à la main\n');
  assert.equal(creerFichierInstructions(neuf, 'Projet neuf'), false);
  assert.match(fs.readFileSync(path.join(neuf, 'CLAUDE.md'), 'utf8'), /Écrit à la main/);

  // Un projet qui suit Codex a déjà son fichier : on n'en ajoute pas un second.
  const codex = dossierDEssai();
  fs.writeFileSync(path.join(codex, 'AGENTS.md'), '# Déjà là\n');
  assert.equal(creerFichierInstructions(codex, 'Projet Codex'), false);
  assert.equal(fs.existsSync(path.join(codex, 'CLAUDE.md')), false);
});

/* ------------------------------------------------------------------ */
/* La synthèse                                                         */
/* ------------------------------------------------------------------ */

test('la synthèse ne se déclenche qu\'au-delà du seuil', () => {
  const court = Array.from({ length: 10 }, (_, i) => `Fait ${i}`);
  assert.equal(doitSynthetiser(court), false);
  assert.equal(doitSynthetiser(Array.from({ length: 61 }, (_, i) => `Fait ${i}`)), true);
  assert.equal(doitSynthetiser([{ length: 0 }].map(() => 'x'.repeat(15000))), true);
});

test('une synthèse qui perd trop de faits est refusée', () => {
  const avant = Array.from({ length: 20 }, (_, i) => `Une règle durable numéro ${i} à conserver.`);
  assert.equal(syntheseAcceptable(avant, avant.slice(0, 15)).ok, true);
  assert.equal(syntheseAcceptable(avant, avant.slice(0, 5)).ok, false);
  assert.equal(syntheseAcceptable(avant, []).ok, false);
  assert.equal(syntheseAcceptable(avant, ['trop court']).ok, false);
});

test('une synthèse acceptée remplace la mémoire sans toucher à l\'historique', () => {
  const dossier = dossierDEssai();
  appendMemory(dossier, 'Une première règle durable et suffisamment longue.');
  appendMemory(dossier, '01.08.2026 : « Une carte » livrée.');
  replaceMemory(dossier, ['Une règle fusionnée, plus courte, mais toujours vraie.']);

  assert.deepEqual(memoryFacts(dossier), ['Une règle fusionnée, plus courte, mais toujours vraie.']);
  assert.match(readHistory(dossier), /Une carte/);
});
