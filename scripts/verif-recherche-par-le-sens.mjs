#!/usr/bin/env node
/*
 * LA RECHERCHE PAR LE SENS, ÉPROUVÉE SUR LA VRAIE BASE DU DÉMON.
 *
 * `verif-recherche-passages.mjs` éprouve les RÈGLES, sur une base jetable et un
 * petit corpus fabriqué. Celui-ci répond à l'autre question, celle qui compte
 * pour l'utilisateur : sur les projets RÉELS, tels qu'ils sont vectorisés en ce
 * moment, la recherche répond-elle par le sens, et répond-elle JUSTE ?
 *
 * Il ne modifie rien : il ouvre la base en LECTURE SEULE, pose des demandes
 * écrites comme un humain les écrirait — avec d'autres mots que la
 * documentation — et regarde ce qui remonte.
 *
 *   node scripts/verif-recherche-par-le-sens.mjs
 *   HAIKODEV_DATA=/root/haikodev/data node scripts/verif-recherche-par-le-sens.mjs
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.HAIKODEV_DATA ??= '/root/haikodev/data';

const passages = await import(path.join(RACINE, 'server/dist/passages.js'));
const memory = await import(path.join(RACINE, 'server/dist/memory.js'));
const vecteurs = await import(path.join(RACINE, 'server/dist/vecteurs.js'));
const store = await import(path.join(RACINE, 'server/dist/store.js'));

const echecs = [];
function verifier(condition, message, detail = '') {
  if (condition) console.log(`  ✓ ${message}${detail ? ` — ${detail}` : ''}`);
  else {
    console.error(`  ✗ ${message}${detail ? ` — ${detail}` : ''}`);
    echecs.push(message);
  }
}

/* ------------------------------------------------------------------ */
/* 1. Le moteur                                                        */
/* ------------------------------------------------------------------ */

console.log('1. Le moteur de vectorisation');
const etat = vecteurs.etatDesVecteurs();
console.log(`  moteur : ${etat.moteur === 'local' ? 'LOCAL, sur ce serveur' : 'EXTERNE (OpenRouter)'}`);
console.log(`  modèle : ${etat.modele}`);
verifier(etat.pret, 'le moteur est prêt');
verifier(etat.moteur === 'local', 'il tourne en local : aucun appel facturé, aucune donnée qui sort');

/* ------------------------------------------------------------------ */
/* 2. La couverture, projet par projet                                 */
/* ------------------------------------------------------------------ */

console.log('\n2. Les projets qui cherchent déjà par le SENS');
const projets = store.listProjects().filter((p) => !p.archived);
let parLeSens = 0;
for (const projet of projets) {
  const c = passages.couvertureDesVecteurs(projet.id);
  const part = c.total ? c.vectorises / c.total : 0;
  if (part >= 0.75) parLeSens += 1;
  console.log(
    `  ${part >= 0.75 ? '✓' : '·'} ${projet.name.padEnd(18)} ${String(c.vectorises).padStart(6)} / ${String(c.total).padEnd(6)} documents  ${Math.round(part * 100)} %`,
  );
}
verifier(parLeSens > 0, 'au moins un projet cherche par le sens', `${parLeSens} sur ${projets.length}`);

/* ------------------------------------------------------------------ */
/* 3. De vraies demandes, écrites avec d'AUTRES mots                   */
/* ------------------------------------------------------------------ */

const DEMANDES = [
  {
    question: 'est-ce que le programme peut décider tout seul d’envoyer le site chez le client ?',
    attendu: /publication|mise-en-ligne|deploiement/,
    pourquoi: 'aucun mot commun avec « publication »',
  },
  {
    question: 'quand je parle, comment il sait que je m’adresse à lui ?',
    attendu: /voix|conversation/,
    pourquoi: 'aucun mot commun avec « mot de réveil »',
  },
  {
    question: 'l’écran rame quand il y a énormément de fiches à afficher',
    attendu: /interface|cartes|mobile|conversation|paquets/,
    pourquoi: 'aucun mot commun avec « paquets de vingt »',
  },
  {
    question: 'que se passe-t-il si la machine s’éteint pendant qu’une tâche travaille ?',
    attendu: /carte|demon|publication|reprise/,
    pourquoi: 'aucun mot commun avec « tour interrompu »',
  },
];

console.log('\n3. Des demandes écrites comme on parle, pas comme la documentation');
const cible = projets.find((p) => p.isSelf) ?? projets[0];
const INDEX = { texte: memory.blocMemoire(cible.path), faits: memory.memoryFacts(cible.path).length };
const couverture = passages.couvertureDesVecteurs(cible.id);
const pretPourLeSens = couverture.total > 0 && couverture.vectorises / couverture.total >= 0.75;

for (const { question, attendu, pourquoi } of DEMANDES) {
  const trouve = await passages.rechercherPourLaTache(cible.id, cible.path, question, INDEX);
  if (!trouve) {
    verifier(false, `« ${question.slice(0, 52)}… » — aucun passage`);
    continue;
  }
  const sources = trouve.passages.map((p) => p.source).join(' ');
  verifier(
    attendu.test(sources),
    `« ${question.slice(0, 52)}… »`,
    `${trouve.mode.vecteurs ? 'SENS' : 'mots'} · ${trouve.passages.length} passages · ${pourquoi}`,
  );
  for (const p of trouve.passages.slice(0, 3)) {
    console.log(`      ${p.score.toFixed(2)}  ${p.source} — ${p.titre.slice(0, 54)}`);
  }
  if (pretPourLeSens) verifier(trouve.mode.vecteurs, '  … et elle a bien classé par le SENS');
}

/* ------------------------------------------------------------------ */

console.log('');
if (echecs.length) {
  console.error(`✗ ÉCHEC : ${echecs.length} contrôle(s) tombé(s).`);
  process.exit(1);
}
console.log('✓ La recherche par le sens répond juste, sur la vraie base, avec le moteur local.');
