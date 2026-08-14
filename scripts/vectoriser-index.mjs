#!/usr/bin/env node
/*
 * LANCER LA VECTORISATION À LA MAIN, sans attendre le rendez-vous de 1 h.
 *
 * Le démon vectorise l'index de tous les projets une fois par nuit
 * (`server/src/vecteurs-nocturne.ts`). Ce script fait la même chose tout de
 * suite : il sert après une réindexation, après un changement de modèle, ou
 * simplement pour voir où en est chaque projet.
 *
 *   node scripts/vectoriser-index.mjs            # tous les projets non archivés
 *   node scripts/vectoriser-index.mjs --etat     # ne vectorise rien, dit juste où on en est
 *   node scripts/vectoriser-index.mjs HaikoDev   # un seul projet, par son nom
 *
 * ATTENTION : il écrit dans la BASE DU DÉMON, celle qui tourne. C'est voulu —
 * une vectorisation rangée dans une base jetable ne servirait à personne. Les
 * écritures sont courtes et transactionnelles ; le démon continue de servir.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const etatSeulement = args.includes('--etat');
const nomVoulu = args.find((a) => !a.startsWith('--'));

const passages = await import(path.join(RACINE, 'server/dist/passages.js'));
const nocturne = await import(path.join(RACINE, 'server/dist/vecteurs-nocturne.js'));
const vecteurs = await import(path.join(RACINE, 'server/dist/vecteurs.js'));
const store = await import(path.join(RACINE, 'server/dist/store.js'));

const etat = vecteurs.etatDesVecteurs();
console.log(`Moteur de vectorisation : ${etat.moteur === 'local' ? 'LOCAL, sur ce serveur' : 'EXTERNE (OpenRouter), facturé'}`);
console.log(`Modèle : ${etat.modele}`);
console.log(
  etat.pret
    ? 'Prêt : oui\n'
    : etat.moteur === 'local'
      ? 'Prêt : NON — lance « node scripts/installer-vectoriseur.mjs »\n'
      : 'Prêt : NON — aucune clé posée\n',
);

const projets = store
  .listProjects()
  .filter((p) => !p.archived)
  .filter((p) => !nomVoulu || p.name.toLowerCase() === nomVoulu.toLowerCase());

if (!projets.length) {
  console.error(nomVoulu ? `Aucun projet nommé « ${nomVoulu} ».` : 'Aucun projet à vectoriser.');
  process.exit(1);
}

const largeur = Math.max(...projets.map((p) => p.name.length), 8);
const pad = (t, n) => String(t).padEnd(n);
const num = (t, n) => String(t).padStart(n);

console.log(`${pad('Projet', largeur)}  ${num('passages', 9)}  ${num('vectorisés', 11)}  ${num('reste', 7)}   état`);
console.log('-'.repeat(largeur + 46));

let totalPassages = 0;
let totalVectorises = 0;

for (const projet of projets) {
  let bilan = { vectorises: 0 };
  const debut = Date.now();
  if (!etatSeulement) {
    try {
      bilan = await nocturne.vectoriserUnProjet(projet.id, projet.path, 500);
    } catch (err) {
      console.log(`${pad(projet.name, largeur)}  ${num('—', 9)}  ${num('—', 11)}  ${num('—', 7)}   ÉCHEC : ${err.message}`);
      continue;
    }
  } else {
    passages.indexerDocumentation(projet.id, projet.path);
  }
  const couverture = passages.couvertureDesVecteurs(projet.id);
  totalPassages += couverture.total;
  totalVectorises += couverture.vectorises;
  const part = couverture.total ? Math.round((couverture.vectorises / couverture.total) * 100) : 0;
  const duree = etatSeulement ? '' : ` en ${Math.round((Date.now() - debut) / 1000)} s`;
  console.log(
    `${pad(projet.name, largeur)}  ${num(couverture.total, 9)}  ${num(couverture.vectorises, 11)}  ` +
      `${num(couverture.total - couverture.vectorises, 7)}   ${part} %${duree}`,
  );
}

console.log('-'.repeat(largeur + 46));
const part = totalPassages ? Math.round((totalVectorises / totalPassages) * 100) : 0;
console.log(`${pad('TOTAL', largeur)}  ${num(totalPassages, 9)}  ${num(totalVectorises, 11)}  ${num(totalPassages - totalVectorises, 7)}   ${part} %`);
console.log(
  `\nUn projet vectorisé à moins de 75 % cherche encore par les MOTS ; au-dessus, il cherche par le SENS.`,
);
process.exit(0);
