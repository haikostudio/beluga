#!/usr/bin/env node
/*
 * CE QUI PART AU MOTEUR NE DOIT PAS SE DÉGRADER TOUT SEUL AU FIL DES JOURS.
 *
 * Deux règles sont éprouvées ici, toutes deux nées du constat du 16/08/2026 :
 * sur HaikoDev, 390 passages de documentation sur 824 étaient SANS VECTEUR —
 * `CLAUDE.md` en entier, `docs/regles/cartes.md`, `docs/regles/interface.md`,
 * `docs/verifications.md` et tout `docs/memoire/`. L'index retombait donc sous
 * le seuil de couverture et la recherche cherchait par les MOTS, toute la
 * journée, sur les fichiers qui comptent le plus.
 *
 *  1. UN PASSAGE INCHANGÉ GARDE SON VECTEUR. L'indexation est incrémentale par
 *     FICHIER : un fichier réécrit d'une ligne perdait les vecteurs de TOUS ses
 *     passages. On modifie donc une seule section d'un fichier et on vérifie que
 *     seuls SES passages repartent à vectoriser.
 *  2. LE SOMMAIRE DES SUJETS VOYAGE AVEC LES PASSAGES. La recherche remplace
 *     l'index de la mémoire : sans la liste des sujets, l'agent à qui on dit
 *     « demande le sujet de ta tâche » devine un nom. Le bloc envoyé doit donc
 *     nommer les sujets — et rester MOINS cher que l'index qu'il remplace.
 *
 *   node scripts/verif-memoire-des-vecteurs.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* La base se pose dans un dossier JETABLE, AVANT tout import du serveur : un
   contrôle qui indexe ne doit jamais écrire dans la base du démon. */
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-vecteurs-'));
process.env.HAIKODEV_DATA = BASE;
process.on('exit', () => fs.rmSync(BASE, { recursive: true, force: true }));

const passages = await import(path.join(RACINE, 'server/dist/passages.js'));
const memory = await import(path.join(RACINE, 'server/dist/memory.js'));
const db = await import(path.join(RACINE, 'server/dist/db.js'));
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
/* 1. Un passage inchangé garde son vecteur                            */
/* ------------------------------------------------------------------ */

console.log('1. Un fichier réécrit ne fait pas tout revectoriser');

/* Un projet d'essai : un fichier de documentation à plusieurs sections, comme
   `CLAUDE.md`. On ne touche PAS au dépôt — tout vit dans le dossier jetable. */
const PROJET = fs.mkdtempSync(path.join(os.tmpdir(), 'projet-vecteurs-'));
process.on('exit', () => fs.rmSync(PROJET, { recursive: true, force: true }));

const SECTIONS = ['Lancer', 'Vérifier', 'Publication', 'Cartes', 'Interface'];
const corpsDe = (titre, marque) =>
  `## ${titre}\n\nCe que ce projet fait pour « ${titre.toLowerCase()} », écrit en toutes lettres ` +
  `pour peser au moins un passage entier. ${marque}\n`;

const ecrireDoc = (marqueDePublication) =>
  fs.writeFileSync(
    path.join(PROJET, 'CLAUDE.md'),
    `# Projet d'essai — instructions du moteur\n\n` +
      SECTIONS.map((titre) =>
        corpsDe(titre, titre === 'Publication' ? marqueDePublication : 'Rien ne bouge ici.'),
      ).join('\n'),
  );

ecrireDoc('Version première.');
passages.indexerDocumentation('essai', PROJET);

/* On pose un faux vecteur sur CHAQUE passage : ce contrôle éprouve la règle de
   conservation, pas le modèle de vectorisation — qui met des minutes et n'est
   pas toujours installé. Le modèle nommé est celui du démon, sinon les vecteurs
   seraient jugés étrangers et repris de toute façon. */
const modele = (await import(path.join(RACINE, 'server/dist/vecteurs.js'))).modeleDesVecteurs();
const faux = Buffer.alloc(partage.DIMENSIONS_MINIMALES * 4);
faux.writeFloatLE(1, 0);
const base = db.getDb();
base
  .prepare('UPDATE doc_passages SET vecteur = ?, modele = ? WHERE project_id = ?')
  .run(faux, modele, 'essai');

const compter = () =>
  base
    .prepare(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN vecteur IS NULL THEN 1 ELSE 0 END) AS sans ' +
        'FROM doc_passages WHERE project_id = ?',
    )
    .get('essai');

const avant = compter();
verifier(avant.total >= SECTIONS.length, 'le fichier d’essai rend un passage par section', `${avant.total} passages`);
verifier(avant.sans === 0, 'tous sont vectorisés au départ');

/* On modifie UNE section, comme le fait n'importe quelle carte sur CLAUDE.md. */
ecrireDoc('Version corrigée par une carte.');
const relance = passages.indexerDocumentation('essai', PROJET);
verifier(relance.modifies === 1, 'la réindexation ne reprend que le fichier modifié');

const apres = compter();
verifier(apres.total === avant.total, 'le compte de passages ne bouge pas', `${apres.total} passages`);
verifier(
  apres.sans === 1,
  'SEUL le passage réellement modifié a perdu son vecteur',
  `${apres.sans} passage(s) à revectoriser sur ${apres.total}`,
);

const couverture = passages.couvertureDesVecteurs('essai');
const part = couverture.total ? couverture.vectorises / couverture.total : 0;
verifier(
  part >= partage.COUVERTURE_VECTEURS_MIN,
  'la couverture reste au-dessus du seuil, donc la recherche continue par le SENS',
  `${Math.round(part * 100)} % (seuil ${Math.round(partage.COUVERTURE_VECTEURS_MIN * 100)} %)`,
);

/* Un fichier SUPPRIMÉ emporte ses passages : la conservation ne ressuscite rien. */
fs.rmSync(path.join(PROJET, 'CLAUDE.md'));
passages.indexerDocumentation('essai', PROJET);
verifier(compter().total === 0, 'un fichier disparu emporte bien ses passages et leurs vecteurs');

/* ------------------------------------------------------------------ */
/* 2. Le sommaire des sujets part avec les passages                    */
/* ------------------------------------------------------------------ */

console.log('\n2. Le bloc de mémoire nomme les sujets qu’on peut demander');

const faits = memory.memoryFacts(RACINE);
const sommaire = partage.texteDuSommaire(faits);
verifier(faits.length > 0, 'la mémoire du dépôt porte des faits', `${faits.length} faits`);
verifier(sommaire.includes('project_memory'), 'le sommaire nomme l’outil qui sert les sujets');

const sujets = partage.sommaireDesSujets(faits);
verifier(sujets.length > 1, 'il nomme plusieurs sujets', sujets.map((s) => s.id).join(', '));
verifier(
  sujets.every((s) => sommaire.includes(`« ${s.id} »`)),
  'chaque sujet est écrit avec le NOM qu’attend l’outil',
);

const INDEX = {
  texte: memory.blocMemoire(RACINE),
  faits: faits.length,
  sommaire,
};
const jetonsIndex = Math.round(INDEX.texte.length / 4);

const trouve = await passages.rechercherPourLaTache('essai-doc', RACINE, 'Revoir la publication d’un projet', INDEX);
if (!trouve) {
  verifier(false, 'une demande réelle retrouve des passages');
} else {
  verifier(trouve.texte.includes('project_memory'), 'le bloc envoyé invite à demander un sujet');
  verifier(
    sujets.every((s) => trouve.texte.includes(`« ${s.id} »`)),
    'et il donne la LISTE des sujets, au lieu de laisser deviner un nom',
  );
  verifier(
    trouve.jetons < jetonsIndex,
    'sommaire compris, il reste MOINS cher que l’index qu’il remplace',
    `${trouve.jetons} jetons contre ${jetonsIndex}`,
  );
}

/* ------------------------------------------------------------------ */

if (echecs.length) {
  console.error(`\n${echecs.length} contrôle(s) en échec.`);
  process.exit(1);
}
console.log('\nTout est vérifié.');
