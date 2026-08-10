#!/usr/bin/env node
/*
 * LA RECHERCHE DE PASSAGES, MESURÉE SUR LA VRAIE DOCUMENTATION.
 *
 * Au lancement d'une carte, la demande sert de QUESTION : le démon remonte
 * quelques passages de `docs/` à la place de l'INDEX de la mémoire. Ce contrôle
 * le rejoue sur le dépôt d'où il part, sans moteur et sans démon :
 *
 *  1. l'indexation lit la documentation, la découpe, et se rejoue sans rien
 *     recalculer ;
 *  2. une demande réelle retrouve le bon fichier — le sens ET les noms exacts ;
 *  3. ce qui part tient sous le plafond et pèse MOINS que l'index remplacé ;
 *  4. une fiche de mécanique passe devant une règle sur la tâche qu'elle décrit ;
 *  5. sans passage assez pertinent, l'index reprend sa place — le repli est dit.
 *
 *   node scripts/verif-recherche-passages.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* La base se pose dans un dossier JETABLE, AVANT tout import du serveur : un
   contrôle qui indexe ne doit pas écrire dans la base du démon. */
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-recherche-'));
process.env.HAIKODEV_DATA = BASE;
process.on('exit', () => fs.rmSync(BASE, { recursive: true, force: true }));

const passages = await import(path.join(RACINE, 'server/dist/passages.js'));
const memory = await import(path.join(RACINE, 'server/dist/memory.js'));
const partage = await import(path.join(RACINE, 'shared/dist/index.js'));

const echecs = [];
function verifier(condition, message, detail = '') {
  if (condition) console.log(`  ✓ ${message}${detail ? ` — ${detail}` : ''}`);
  else {
    console.error(`  ✗ ${message}${detail ? ` — ${detail}` : ''}`);
    echecs.push(message);
  }
}

/* ------------------------------------------------------------------ */
/* 1. L'indexation                                                     */
/* ------------------------------------------------------------------ */

console.log("1. L'indexation de la documentation");
const premier = passages.indexerDocumentation('verif', RACINE);
verifier(premier.fichiers > 0, 'des fichiers de documentation ont été trouvés', `${premier.fichiers} fichiers`);
verifier(premier.passages > premier.fichiers, 'un fichier rend plusieurs passages', `${premier.passages} passages`);

const second = passages.indexerDocumentation('verif', RACINE);
verifier(second.modifies === 0, 'rejouée, elle ne recalcule rien', 'indexation incrémentale');
verifier(second.passages === premier.passages, 'et le compte de passages ne bouge pas');

const indexes = passages.passagesIndexes('verif');
const plusGros = Math.max(...indexes.map((p) => p.texte.length));
verifier(
  plusGros <= partage.PLAFOND_PASSAGE_SIGNES,
  'aucun passage ne dépasse le plafond de découpage',
  `${plusGros} signes au plus`,
);
verifier(
  indexes.some((p) => p.source.startsWith('docs/mecaniques/')),
  'les fiches de mécaniques sont indexées',
);

/* ------------------------------------------------------------------ */
/* 2. Ce que la recherche rend, sur des demandes réelles               */
/* ------------------------------------------------------------------ */

const INDEX = { texte: memory.blocMemoire(RACINE), faits: memory.memoryFacts(RACINE).length };
const jetonsIndex = Math.round(INDEX.texte.length / 4);

const DEMANDES = [
  { question: "Changer le mot de réveil de l'écoute vocale", attendu: /voix/ },
  { question: 'Reprendre un déploiement interrompu par un conflit de fusion', attendu: /publication|memoire/ },
  { question: 'Ajouter une colonne au tableau des cartes', attendu: /cartes|mecaniques|tableau/ },
  { question: 'Ajouter un outil au démon pour les agents', attendu: /mecaniques|methode/ },
];

console.log('\n2. Une demande réelle retrouve les passages qui y répondent');
let total = 0;
for (const { question, attendu } of DEMANDES) {
  const trouve = passages.rechercherPourLaTache('verif', RACINE, question, INDEX);
  if (!trouve) {
    verifier(false, `« ${question} » — aucun passage retrouvé`);
    continue;
  }
  total += trouve.jetons;
  const sources = trouve.passages.map((p) => p.source).join(' ');
  verifier(attendu.test(sources), `« ${question} »`, `${trouve.passages.length} passages, ${trouve.jetons} jetons`);
  verifier(
    trouve.jetons < jetonsIndex,
    '  … et cela pèse moins que l’index remplacé',
    `${trouve.jetons} contre ${jetonsIndex}`,
  );
  verifier(trouve.texte.includes('project_memory'), '  … en disant que le reste de la mémoire reste demandable');
}
console.log(
  `\n  → ${Math.round((1 - total / (jetonsIndex * DEMANDES.length)) * 100)} % de moins qu'un index envoyé à chaque lancement.`,
);

/* ------------------------------------------------------------------ */
/* 3. Les mécaniques passent devant                                    */
/* ------------------------------------------------------------------ */

console.log('\n3. Une fiche de mécanique passe devant sur la tâche qu’elle décrit');
for (const fiche of fs.readdirSync(path.join(RACINE, 'docs', 'mecaniques'))) {
  const question = fiche.replace(/\.md$/, '').replace(/-/g, ' ');
  const trouve = passages.rechercherPourLaTache('verif', RACINE, question, INDEX);
  verifier(
    !!trouve && trouve.passages.some((p) => p.source === `docs/mecaniques/${fiche}`),
    `« ${question} » retrouve sa fiche`,
  );
}

/* ------------------------------------------------------------------ */
/* 4. Le repli : l'index reprend sa place                              */
/* ------------------------------------------------------------------ */

console.log('\n4. Le repli sur l’index, quand la recherche ne vaut pas le coup');
verifier(
  passages.rechercherPourLaTache('verif', RACINE, '   ', INDEX) === undefined,
  'sans question, la recherche se tait',
);
verifier(
  passages.rechercherPourLaTache('verif', RACINE, 'un déploiement', { texte: '  1. Un fait.', faits: 1 }) === undefined,
  'sur une mémoire minuscule, l’index reste le moins cher',
);
verifier(
  passages.rechercherPourLaTache('verif', os.tmpdir(), 'un déploiement', INDEX) === undefined,
  'sur un projet sans documentation, la recherche se tait',
);

/* ------------------------------------------------------------------ */

console.log('');
if (echecs.length) {
  console.error(`✗ ÉCHEC : ${echecs.length} contrôle(s) tombé(s).`);
  process.exit(1);
}
console.log('✓ La recherche remonte les passages qui répondent, sous plafond, sans jamais coûter plus que l’index.');
