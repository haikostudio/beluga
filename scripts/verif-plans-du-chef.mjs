#!/usr/bin/env node
/*
 * LES DOCUMENTS ET LES PLANS DU CHEF D'ORCHESTRE, REJOUÉS DE BOUT EN BOUT.
 *
 * Le chef écrit dans UN dossier — `docs/plans/` — et ce qu'il y range revient
 * tout seul au lancement d'une carte sur le même sujet. Ce contrôle rejoue le
 * parcours entier sur un projet jetable, sans moteur et sans démon :
 *
 *  1. le chef ÉCRIT un plan : le fichier est là, au bon endroit, sous un nom propre ;
 *  2. il le MODIFIE : le même fichier est remplacé, aucun doublon ;
 *  3. tout autre chemin du projet lui est REFUSÉ, la raison dite ;
 *  4. le plan REMONTE dans les passages d'une carte sur le même sujet ;
 *  5. sa consigne lui dit où écrire, et le mode plan lui dit d'enregistrer.
 *
 *   node scripts/verif-plans-du-chef.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Base et projet JETABLES, posés AVANT tout import du serveur : un contrôle qui
   écrit ne doit toucher ni la base du démon, ni le dépôt. */
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-plans-base-'));
const PROJET = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-plans-projet-'));
process.env.HAIKODEV_DATA = BASE;
process.on('exit', () => {
  fs.rmSync(BASE, { recursive: true, force: true });
  fs.rmSync(PROJET, { recursive: true, force: true });
});

const store = await import(path.join(RACINE, 'server/dist/store.js'));
const outils = await import(path.join(RACINE, 'server/dist/tools.js'));
const passages = await import(path.join(RACINE, 'server/dist/passages.js'));
const runtime = await import(path.join(RACINE, 'server/dist/runtime.js'));
const partage = await import(path.join(RACINE, 'shared/dist/index.js'));

const echecs = [];
function verifier(condition, message, detail = '') {
  if (condition) console.log(`  ✓ ${message}${detail ? ` — ${detail}` : ''}`);
  else {
    console.error(`  ✗ ${message}${detail ? ` — ${detail}` : ''}`);
    echecs.push(message);
  }
}

const projet = store.saveProject({
  id: store.newId(),
  name: 'Projet d’essai',
  path: PROJET,
  defaultEngine: 'claude',
  isSelf: false,
  archived: false,
  createdAt: store.now(),
  updatedAt: store.now(),
});
const CHEF = { projectId: projet.id, role: 'orchestrator', agentId: 'chef-essai' };
const dossier = path.join(PROJET, ...partage.DOSSIER_PLANS.split('/'));

/* ------------------------------------------------------------------ */
/* 1. Le chef écrit un plan                                            */
/* ------------------------------------------------------------------ */

console.log('1. Le chef écrit un plan');
const PLAN = [
  '# Plan — recherche vocale dans le tableau',
  '',
  '## Faisabilité',
  'Le tableau porte déjà une barre de filtre ; la dictée s’y branche sans toucher aux colonnes.',
  '',
  '## Chemin à suivre',
  'Ouvrir le micro depuis la barre de filtre, transcrire, poser le texte dans le filtre existant.',
  '',
  '## Conséquences',
  'Une carte se retrouve à la voix, sans quitter le tableau.',
  '',
  '## Améliorations apportées',
  'On cherche une carte sans lâcher son téléphone.',
].join('\n');

const ecrit = await outils.callTool(CHEF, 'write_document', {
  relativePath: 'Plan : recherche vocale dans le tableau',
  content: PLAN,
});
verifier(ecrit.ok, 'l’écriture est acceptée', ecrit.text);
const attendu = 'plan-recherche-vocale-dans-le-tableau.md';
verifier(fs.existsSync(path.join(dossier, attendu)), 'le fichier est dans le dossier des plans', attendu);
verifier(/créé/i.test(ecrit.text), 'le chef sait qu’il a CRÉÉ le document');

/* ------------------------------------------------------------------ */
/* 2. Il le modifie                                                    */
/* ------------------------------------------------------------------ */

console.log('\n2. Il modifie le même plan');
const modifie = await outils.callTool(CHEF, 'write_document', {
  relativePath: attendu,
  content: `${PLAN}\n\n## Réserve\nLa dictée reste hors ligne sur mobile.\n`,
});
verifier(/mis à jour/i.test(modifie.text), 'le chef sait qu’il a REMPLACÉ le document');
verifier(fs.readdirSync(dossier).length === 1, 'aucun doublon n’est apparu', `${fs.readdirSync(dossier).length} fichier`);
verifier(
  fs.readFileSync(path.join(dossier, attendu), 'utf8').includes('hors ligne'),
  'le contenu est bien celui de la dernière version',
);

/* ------------------------------------------------------------------ */
/* 3. Le reste du projet lui reste fermé                               */
/* ------------------------------------------------------------------ */

console.log('\n3. Le reste du projet lui reste fermé');
for (const chemin of ['docs/regles/cartes.md', 'docs/memoire/cartes.md', 'server/src/runtime.ts', '../evasion.md']) {
  const refus = await outils.callTool(CHEF, 'write_document', { relativePath: chemin, content: 'non' });
  verifier(!refus.ok, `« ${chemin} » est refusé`, refus.text.slice(0, 80));
}
verifier(
  !fs.existsSync(path.join(PROJET, 'docs', 'regles')) && !fs.existsSync(path.join(PROJET, 'server')),
  'aucun fichier n’a été créé hors du dossier des plans',
);

/* Un nom NU, lui, n'est pas refusé : il est RAMENÉ dans le dossier des plans.
   Un chef qui demande « CLAUDE.md » écrit `docs/plans/claude.md`, jamais le
   fichier d'instructions du moteur. */
fs.writeFileSync(path.join(PROJET, 'CLAUDE.md'), 'les instructions du moteur', 'utf8');
const ramene = await outils.callTool(CHEF, 'write_document', { relativePath: 'CLAUDE.md', content: 'ma note' });
verifier(ramene.ok, '« CLAUDE.md » n’est pas refusé mais RAMENÉ dans les plans', ramene.text.slice(0, 60));
verifier(
  fs.readFileSync(path.join(PROJET, 'CLAUDE.md'), 'utf8') === 'les instructions du moteur',
  'le fichier d’instructions du moteur est intact',
);
fs.rmSync(path.join(dossier, 'claude.md'), { force: true });

/* ------------------------------------------------------------------ */
/* 4. Le plan remonte au lancement d'une carte                         */
/* ------------------------------------------------------------------ */

console.log('\n4. Le plan remonte dans le contexte d’une carte sur le même sujet');
/* Une mémoire de projet crédible : sans index à remplacer, la recherche se
   refuse par construction (`rechercheRentable`). */
const INDEX = {
  texte: [
    'MÉMOIRE DU PROJET — index des faits, par sujet.',
    ...Array.from({ length: 40 }, (_, i) => `${i + 1}. Un fait durable du projet, rangé par sujet, qui décrit une règle ou un piège connu.`),
  ].join('\n'),
  faits: 40,
};
const trouve = passages.rechercherPourLaTache(
  projet.id,
  PROJET,
  'Ajouter la recherche vocale dans le tableau',
  INDEX,
);
verifier(!!trouve, 'la recherche rend des passages');
verifier(
  !!trouve && trouve.passages.some((p) => p.source === `${partage.DOSSIER_PLANS}/${attendu}`),
  'le plan du chef fait partie des passages retenus',
  trouve ? trouve.passages.map((p) => p.source).join(', ') : '',
);
verifier(
  !!trouve && trouve.texte.includes('recherche vocale'),
  'son contenu part réellement au moteur',
);

/* ------------------------------------------------------------------ */
/* 5. Ce que le chef en sait                                           */
/* ------------------------------------------------------------------ */

console.log('\n5. Le chef sait où écrire');
const consigne = runtime.rolePrompt('orchestrator', false);
verifier(consigne.includes(partage.DOSSIER_PLANS), 'sa consigne nomme le dossier des plans');
verifier(
  runtime.rolePrompt('orchestrator', false, 'claude', 'complet', 'plan').includes('ENREGISTRE CHAQUE PLAN'),
  'le mode plan lui dit d’enregistrer son plan',
);

console.log('');
if (echecs.length) {
  console.error(`${echecs.length} contrôle(s) en échec.`);
  process.exit(1);
}
console.log('Tous les contrôles des plans du chef sont au vert.');
