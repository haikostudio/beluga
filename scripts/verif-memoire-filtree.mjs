#!/usr/bin/env node
/*
 * LA MÉMOIRE D'UNE CARTE, SERVIE AU POIDS DE SA DEMANDE — mesuré sur la VRAIE
 * documentation du dépôt d'où part ce script, jamais sur un décor fabriqué.
 *
 * Ce qui est vérifié, une carte à portée ÉTROITE sur un sujet VOLUMINEUX :
 *
 *  1. AVANT / APRÈS : ce qui part quand le sujet est nommé sans carte, et ce qui
 *     part quand la carte dit le travail réel. La mesure est imprimée.
 *  2. Le passage qui répond VRAIMENT à la carte est là — filtrer ne veut pas
 *     dire perdre l'essentiel.
 *  3. Ce qui est écarté est DIT, avec le moyen de tout obtenir.
 *  4. « <sujet> entier » rend bien le fichier entier, malgré la carte.
 *  5. Les CONTRÔLES du sujet suivent l'extrait : la méthode impose de les rejouer.
 *  6. Un petit sujet n'est jamais rogné, et une demande sans mot utile non plus.
 *
 * Aucun moteur, aucun démon : le mécanisme tout seul, donc rejouable partout.
 *
 *   node scripts/verif-memoire-filtree.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const memory = await import(path.join(RACINE, 'server/dist/memory.js'));
const partage = await import(path.join(RACINE, 'shared/dist/index.js'));

const echecs = [];
function verifier(condition, message) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.error(`  ✗ ${message}`);
    echecs.push(message);
  }
}

/** Une mesure lisible : signes, et jetons à 2,2 signes par jeton sur cette doc. */
function poids(signes) {
  return `${signes} signes (~${Math.round(signes / 2.2)} jetons)`;
}

/* ------------------------------------------------------------------ */
/* Le sujet le plus volumineux du dépôt, et une carte à portée étroite  */
/* ------------------------------------------------------------------ */

const sujets = partage.SUJETS_REGLES.map((sujet) => ({
  sujet,
  signes: (() => {
    try {
      return fs.readFileSync(path.join(RACINE, sujet.fichier), 'utf8').length;
    } catch {
      return 0;
    }
  })(),
})).sort((a, b) => b.signes - a.signes);

const gros = sujets[0];
if (!gros?.signes) {
  console.error("✗ Aucun fichier de règles lisible dans ce dépôt : rien à mesurer.");
  process.exit(1);
}
console.log(`Sujet le plus volumineux : « ${gros.sujet.id} » (${gros.sujet.fichier}) — ${poids(gros.signes)}`);
verifier(
  gros.signes > partage.PLAFOND_SUJET_NOMME,
  `« ${gros.sujet.id} » dépasse le plafond (${partage.PLAFOND_SUJET_NOMME} signes) : c'est bien un gros sujet`,
);

/*
 * LA CARTE D'ESSAI est à portée ÉTROITE : elle ne parle que d'un geste précis,
 * et la moitié du fichier de règles n'a rien à voir avec elle. Son texte est
 * écrit comme une vraie carte — titre, constat, attendu.
 */
const CARTE = [
  'Le bouton « Arrêter » ne range pas la carte dans sa colonne',
  "**Constat** : un arrêt à la main laisse la carte allumée en « En cours ».",
  "**Attendu** : l'arrêt ramène la carte en « Planifié », comme la sortie à la souris.",
].join('\n');

/* ------------------------------------------------------------------ */
/* 1. AVANT / APRÈS                                                    */
/* ------------------------------------------------------------------ */

console.log('\n1. Ce qui part au moteur quand l’agent nomme le sujet de sa tâche');

const avant = memory.detailRegles(RACINE, gros.sujet.id);
const apres = memory.detailRegles(RACINE, gros.sujet.id, CARTE);

console.log(`  → AVANT (sujet nommé, aucune carte) : ${poids(avant.length)}`);
console.log(`  → APRÈS (même sujet, avec la carte) : ${poids(apres.length)}`);
const gain = avant.length ? Math.round((1 - apres.length / avant.length) * 100) : 0;
console.log(`  → économie sur ce sujet : ${gain} %`);

verifier(apres.length < avant.length / 2, 'la carte reçoit moins de la moitié de ce qui partait');
verifier(apres.length > 300, 'et elle reçoit tout de même une vraie réponse, pas trois lignes');

/* ------------------------------------------------------------------ */
/* 2 à 5. Ce qui reste, ce qui est dit, et l’échappatoire              */
/* ------------------------------------------------------------------ */

console.log('\n2. Ce qui reste est ce qui répond à la carte');

const motsDeLaCarte = partage.motsDeLaRequete(CARTE);
const touches = motsDeLaCarte.filter((mot) => apres.toLowerCase().includes(mot));
verifier(
  touches.length >= 3,
  `l'extrait parle bien du travail de la carte (${touches.length} de ses mots sur ${motsDeLaCarte.length})`,
);
verifier(/ARRÊT|arrêt|Arrêter/.test(apres), "le geste nommé par la carte est présent dans l'extrait");

console.log('\n3. Ce qui est écarté est DIT, avec le moyen de tout obtenir');
verifier(/autres? règles? de ce sujet/.test(apres), 'le nombre de règles écartées est écrit');
verifier(apres.includes(`« ${gros.sujet.id} entier »`), 'le moyen d’obtenir le sujet entier est écrit');

console.log('\n4. « entier » reste un choix de l’agent, et il est respecté');
const force = memory.detailRegles(RACINE, `${gros.sujet.id} entier`, CARTE);
verifier(force.length >= avant.length, 'demander « … entier » rend bien tout le sujet, malgré la carte');

console.log('\n5. Les CONTRÔLES du sujet suivent l’extrait');
verifier(/CONTRÔLES/.test(apres), 'la section des contrôles du sujet est toujours là');

/* ------------------------------------------------------------------ */
/* 6. Les garde-fous : on ne rogne pas n’importe quoi                  */
/* ------------------------------------------------------------------ */

console.log('\n6. Ce qui ne se filtre JAMAIS');

const petit = sujets.filter((s) => s.signes && s.signes <= partage.PLAFOND_SUJET_NOMME).pop();
if (petit) {
  const servi = memory.detailRegles(RACINE, petit.sujet.id, CARTE);
  verifier(
    servi.length >= petit.signes * 0.9,
    `un petit sujet (« ${petit.sujet.id} », ${petit.signes} signes) part entier, même avec une carte`,
  );
} else {
  console.log('  · aucun sujet sous le plafond dans ce dépôt : rien à mesurer ici.');
}

const sansMot = memory.detailRegles(RACINE, gros.sujet.id, 'de la à un et');
verifier(sansMot.length >= avant.length, 'une demande sans mot utile ne rogne rien : on ne devine pas');

const horsSujet = memory.detailRegles(RACINE, gros.sujet.id, 'photosynthèse chlorophylle betterave sucrière');
verifier(horsSujet.length >= avant.length, 'aucune règle ne parle du travail : le sujet part entier, pas le silence');

/* ------------------------------------------------------------------ */
/* Le compte global : ce que la mécanique fait gagner sur tout le dépôt */
/* ------------------------------------------------------------------ */

console.log('\nMesure sur tous les sujets de ce dépôt, pour cette même carte :');
let totalAvant = 0;
let totalApres = 0;
for (const { sujet } of sujets) {
  const sansCarte = memory.detailRegles(RACINE, sujet.id);
  if (!sansCarte) continue;
  const avecCarte = memory.detailRegles(RACINE, sujet.id, CARTE);
  totalAvant += sansCarte.length;
  totalApres += avecCarte.length;
  const part = sansCarte.length ? Math.round((1 - avecCarte.length / sansCarte.length) * 100) : 0;
  console.log(`  · ${sujet.id.padEnd(12)} ${String(sansCarte.length).padStart(6)} → ${String(avecCarte.length).padStart(6)} signes (${part} %)`);
}
console.log(`  → total : ${poids(totalAvant)} → ${poids(totalApres)}`);

/* ------------------------------------------------------------------ */

console.log('');
if (echecs.length) {
  console.error(`✗ ÉCHEC : ${echecs.length} contrôle(s) tombé(s).`);
  process.exit(1);
}
console.log('✓ Un sujet nommé sur une carte est servi au poids de la demande de la carte :');
console.log('  ce qui en parle, ce qui est écarté est dit, et « <sujet> entier » rend tout.');
