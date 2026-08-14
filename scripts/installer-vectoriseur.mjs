#!/usr/bin/env node
/**
 * Installe le MOTEUR DE VECTORISATION LOCAL : BAAI/bge-m3, sur le serveur.
 *
 * La recherche par le sens partait chez un fournisseur extérieur et facturé.
 * Elle tourne désormais ICI : plus un octet de documentation ne sort de la
 * machine, plus un centime n'est dépensé par appel.
 *
 * Le moteur vit HORS DU DÉPÔT, dans `data/vectoriseur` — bibliothèque et modèle
 * pèsent ensemble plus d'un gigaoctet, et surtout : chaque carte lancée ouvre sa
 * propre copie du dépôt et y refait `npm install`. Une dépendance de cette
 * taille dans le `package.json` du projet ralentirait TOUS les lancements pour
 * un moteur dont un seul processus se sert. C'est exactement le choix déjà fait
 * pour Kokoro, le second moteur de voix (`scripts/installer-kokoro.mjs`).
 *
 * Sans danger à relancer : ce qui est déjà là n'est ni retéléchargé ni réinstallé.
 *
 *   node scripts/installer-vectoriseur.mjs
 *   node scripts/installer-vectoriseur.mjs --verifier   # ne rien installer, juste éprouver
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DONNEES = process.env.HAIKODEV_DATA ?? path.join(RACINE, 'data');
const DOSSIER = path.join(DONNEES, 'vectoriseur');
const MODELES = path.join(DOSSIER, 'modeles');
const BIBLIOTHEQUE = '@huggingface/transformers';
const MODELE = 'Xenova/bge-m3';
const verifierSeulement = process.argv.includes('--verifier');

function dire(texte) {
  console.log(texte);
}

/* ------------------------------------------------------------------ */
/* 1. Le dossier et sa bibliothèque                                    */
/* ------------------------------------------------------------------ */

if (!verifierSeulement) {
  fs.mkdirSync(MODELES, { recursive: true });
  const manifeste = path.join(DOSSIER, 'package.json');
  if (!fs.existsSync(manifeste)) {
    fs.writeFileSync(
      manifeste,
      `${JSON.stringify(
        {
          name: 'haikodev-vectoriseur',
          private: true,
          type: 'module',
          description: 'Le moteur de vectorisation local du démon — hors dépôt, installé une seule fois.',
          dependencies: { [BIBLIOTHEQUE]: '^3.7.6' },
        },
        null,
        2,
      )}\n`,
    );
  }

  const deja = fs.existsSync(path.join(DOSSIER, 'node_modules', ...BIBLIOTHEQUE.split('/')));
  if (deja) {
    dire(`La bibliothèque est déjà installée dans ${DOSSIER}.`);
  } else {
    dire(`Installation de ${BIBLIOTHEQUE} dans ${DOSSIER} — quelques minutes…`);
    // `NODE_ENV=production` saute les dépendances de développement : ce dossier
    // n'en a aucune, mais le dire évite une surprise sur un serveur d'agents.
    execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
      cwd: DOSSIER,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' },
    });
  }
}

if (!fs.existsSync(path.join(DOSSIER, 'node_modules'))) {
  console.error(`✗ Rien d'installé dans ${DOSSIER}. Lance ce script sans « --verifier ».`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 2. Le modèle, et la preuve qu'il tourne                             */
/* ------------------------------------------------------------------ */

const { pipeline, env } = await import(path.join(DOSSIER, 'node_modules', BIBLIOTHEQUE, 'dist/transformers.node.mjs'));
env.cacheDir = MODELES;
env.allowLocalModels = true;

dire(`\nChargement de ${MODELE} (première fois : environ 560 Mo à télécharger)…`);
const debut = Date.now();
const extraire = await pipeline('feature-extraction', MODELE, { dtype: 'q8' });
dire(`Modèle prêt en ${Math.round((Date.now() - debut) / 1000)} s.`);

/*
 * L'ÉPREUVE : une question posée avec d'AUTRES mots que la règle qu'elle vise.
 * C'est tout l'intérêt du sens — un moteur qui ne saurait pas la rapprocher ne
 * servirait à rien, et il vaut mieux le découvrir ici qu'en pleine nuit.
 */
const REGLES = [
  "La mise en ligne appartient à l'utilisateur : le démon fusionne le lot, enregistre et pousse la branche, mais il n'envoie jamais rien vers le serveur public de sa propre initiative.",
  "Le mot de réveil de l'écoute permanente se compare sans accent ni ponctuation, et il ne déclenche l'enregistrement qu'après quatre-vingt-treize millisecondes de parole continue.",
  "Chaque hausse mesurée sur un compte n'est attribuée qu'une fois : les tours simultanés cumulent leur part depuis un repère commun.",
];
const QUESTION = "est-ce que le programme peut décider tout seul d'envoyer le site chez le client ?";

const t = Date.now();
const sortie = await extraire([...REGLES, QUESTION], { pooling: 'cls', normalize: true });
const vecteurs = sortie.tolist();
const cosinus = (a, b) => a.reduce((total, x, i) => total + x * b[i], 0);
const scores = REGLES.map((regle, i) => ({ regle, score: cosinus(vecteurs[3], vecteurs[i]) }));
scores.sort((a, b) => b.score - a.score);

dire(`\nDimensions du vecteur : ${vecteurs[0].length}`);
dire(`Vitesse : ${(4 / ((Date.now() - t) / 1000)).toFixed(1)} textes courts par seconde\n`);
dire(`Question : « ${QUESTION} »`);
for (const { regle, score } of scores) dire(`  ${score.toFixed(3)}  ${regle.slice(0, 70)}…`);

if (scores[0].regle !== REGLES[0]) {
  console.error('\n✗ Le moteur ne rapproche pas la question de la règle qu’elle vise : quelque chose ne va pas.');
  process.exit(1);
}
dire(`\n✓ Le moteur local répond, et il retrouve la bonne règle malgré la reformulation.`);
dire(`  Modèle rangé dans ${MODELES} — aucun appel extérieur, aucun coût par appel.`);
