#!/usr/bin/env node
/*
 * INSTALLE LE MODÈLE DE VECTEURS DE LA MÉMOIRE EN CLASSEURS, HORS DU DÉPÔT.
 *
 * `<données>/vectoriseur` reçoit le moteur (`@huggingface/transformers`) et le
 * modèle multilingual-e5-small (~130 Mo). Le démon s'en sert s'il est là
 * (`server/src/vectoriseur.ts`) et reste au plein texte seul sinon. CE DOSSIER
 * N'EST PAS INUTILISÉ : le retirer éteint la recherche par le sens.
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

const { pipeline, env } = await import(path.join(DOSSIER, 'node_modules/@huggingface/transformers/src/transformers.js'));
env.cacheDir = path.join(DOSSIER, 'modeles');
console.log(`modèle : ${MODELE} (q8)`);
const extracteur = await pipeline('feature-extraction', MODELE, { dtype: 'q8' });
const sortie = await extracteur(['query: essai'], { pooling: 'mean', normalize: true });
console.log(`prêt : ${sortie.dims[1]} dimensions, rangé dans ${env.cacheDir}`);
