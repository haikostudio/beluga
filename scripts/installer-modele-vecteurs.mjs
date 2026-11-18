#!/usr/bin/env node
/*
 * INSTALLE LE MODÈLE DE VECTEURS DE LA MÉMOIRE EN CLASSEURS, HORS DU DÉPÔT.
 *
 * `<données>/vectoriseur` reçoit le moteur (`@huggingface/transformers`) et le
 * modèle multilingual-e5-small (~130 Mo). Le démon s'en sert s'il est là
 * (`server/src/vectoriseur.ts`) et reste au plein texte seul sinon. CE DOSSIER
 * N'EST PAS INUTILISÉ : le retirer éteint la recherche par le sens.
 *
 * Il reçoit aussi le MODÈLE DE TRI des compétences (bge-reranker-v2-m3, ~570 Mo,
 * `MODELE_DE_TRI` dans shared/src/classeurs.ts) : sans lui, les compétences
 * gardent l'ordre de la recherche (`--sans-tri` pour s'en passer).
 *
 *   node scripts/installer-modele-vecteurs.mjs        (données : BELUGA_DATA ou ./data)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DONNEES = process.env.BELUGA_DATA || path.join(RACINE, 'data');
const DOSSIER = path.join(DONNEES, 'vectoriseur');
const MODELE = 'Xenova/multilingual-e5-small';
const MODELE_DE_TRI = 'onnx-community/bge-reranker-v2-m3-ONNX';

fs.mkdirSync(DOSSIER, { recursive: true });
fs.writeFileSync(
  path.join(DOSSIER, 'package.json'),
  `${JSON.stringify(
    {
      name: 'beluga-vectoriseur',
      private: true,
      type: 'module',
      description: 'Le modèle de vecteurs de la mémoire en classeurs — hors dépôt, installé par scripts/installer-modele-vecteurs.mjs.',
      dependencies: { '@huggingface/transformers': '^3.7.6' },
    },
    null,
    2,
  )}\n`,
);
console.log(`moteur : npm install dans ${DOSSIER}`);
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: DOSSIER, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });

const { pipeline, env, AutoTokenizer, AutoModelForSequenceClassification } = await import(path.join(DOSSIER, 'node_modules/@huggingface/transformers/src/transformers.js'));
env.cacheDir = path.join(DOSSIER, 'modeles');
console.log(`modèle : ${MODELE} (q8)`);
const extracteur = await pipeline('feature-extraction', MODELE, { dtype: 'q8' });
const sortie = await extracteur(['query: essai'], { pooling: 'mean', normalize: true });
console.log(`prêt : ${sortie.dims[1]} dimensions, rangé dans ${env.cacheDir}`);

if (!process.argv.includes('--sans-tri')) {
  console.log(`modèle de tri : ${MODELE_DE_TRI} (q8, ~570 Mo)`);
  const tokenizer = await AutoTokenizer.from_pretrained(MODELE_DE_TRI);
  const modele = await AutoModelForSequenceClassification.from_pretrained(MODELE_DE_TRI, { dtype: 'q8' });
  const { logits } = await modele(tokenizer(['devis'], { text_pair: ['Chiffrer un projet pour un client'], padding: true, truncation: true }));
  console.log(`prêt : note d'essai ${(1 / (1 + Math.exp(-logits.data[0]))).toFixed(3)}, rangé dans ${env.cacheDir}`);
}
