#!/usr/bin/env node
/*
 * L'ARBRE DE MÉMOIRE, ÉPROUVÉ SUR LA VRAIE MÉMOIRE DU PROJET.
 *
 * Les tests unitaires jugent des faits fabriqués. Ce contrôle-ci prend la
 * documentation RÉELLE du dépôt d'où il part, la range en arbre dans une copie
 * jetable, et vérifie les cinq promesses du changement :
 *
 *  1. l'arbre a ses trois étages, et le nom du parent se lit dans l'enfant ;
 *  2. rien n'est perdu à l'aller-retour, et la mise en arbre est rejouable ;
 *  3. la carte envoyée au moteur ne porte AUCUN fait, et pèse une fraction de
 *     ce que coûtait la recherche de passages ;
 *  4. un mot lu dans le fichier racine ouvre son fichier de détail, et LUI SEUL ;
 *  5. plus rien de la recherche par le sens ne subsiste dans le dépôt.
 *
 * Aucun moteur, aucun démon, aucun réseau : le mécanisme tout seul.
 *
 *   node scripts/verif-arbre-memoire.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-arbre-data-'));
process.env.HAIKODEV_DATA = bacASable;

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

/* ------------------------------------------------------------------ */
/* Une copie jetable de la vraie documentation                         */
/* ------------------------------------------------------------------ */

const projet = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-arbre-projet-'));
fs.cpSync(path.join(RACINE, 'docs'), path.join(projet, 'docs'), { recursive: true });
if (fs.existsSync(path.join(RACINE, 'MEMOIRE.md'))) {
  fs.cpSync(path.join(RACINE, 'MEMOIRE.md'), path.join(projet, 'MEMOIRE.md'));
}

const avant = memory.memoryFacts(projet);
console.log(`\nMémoire réelle du projet : ${avant.length} faits.\n`);

/* ------------------------------------------------------------------ */
console.log('1. Les trois étages, et le nom du parent dans celui de l’enfant');
/* ------------------------------------------------------------------ */

memory.migrerParSujet(projet);
const arbre = memory.arbreDuProjet(projet);

verifier(
  fs.readFileSync(path.join(projet, 'MEMOIRE.md'), 'utf8').includes(partage.MARQUE_ARBRE),
  'le fichier racine porte la marque de l’arbre',
);

const eclates = arbre.filter((s) => s.eclate);
verifier(eclates.length > 0, `au moins un sujet a son dossier enfant (${eclates.length} sur ${arbre.length})`);

let etagesOk = true;
let branchesTotal = 0;
for (const sujet of arbre) {
  if (!fs.existsSync(path.join(projet, ...sujet.rappel.split('/')))) {
    etagesOk = false;
    console.error(`    · rappel manquant : ${sujet.rappel}`);
  }
  if (!sujet.eclate) continue;
  for (const branche of sujet.branches) {
    branchesTotal++;
    const attendu = `${sujet.dossier}/${path.basename(sujet.dossier)}-${branche.nom}.md`;
    if (branche.fichier !== attendu) {
      etagesOk = false;
      console.error(`    · ${branche.fichier} ne répète pas le nom de son parent`);
    }
    if (!fs.existsSync(path.join(projet, ...branche.fichier.split('/')))) {
      etagesOk = false;
      console.error(`    · fichier de détail manquant : ${branche.fichier}`);
    }
  }
}
verifier(etagesOk, `les ${branchesTotal} branches sont sur le disque, préfixées du nom de leur sujet`);

/* ------------------------------------------------------------------ */
console.log('\n2. Rien de perdu, et la mise en arbre est rejouable');
/* ------------------------------------------------------------------ */

const apres = memory.memoryFacts(projet);
verifier(apres.length === avant.length, `${avant.length} faits avant, ${apres.length} après`);

const perdus = avant.filter((f) => !apres.includes(f));
verifier(perdus.length === 0, perdus.length ? `PERDUS : ${perdus.slice(0, 3).join(' | ')}` : 'aucun fait perdu');

const deuxieme = memory.migrerParSujet(projet);
verifier(deuxieme === 0, `un second passage ne déplace plus rien (${deuxieme})`);
verifier(
  memory.memoryFacts(projet).length === avant.length,
  'et il ne fait ni gagner ni perdre de fait',
);

/*
 * On cherche la FORME d'une ligne de table des matières — « **Titre** (3) —
 * `chemin.md` » —, jamais la simple mention d'un chemin : un vrai fait a
 * parfaitement le droit de citer `docs/memoire/<sujet>.md` dans son texte, et
 * le confondre avec un sommaire ferait échouer le contrôle sur du bon travail.
 */
const sommaires = memory
  .memoryFacts(projet)
  .filter((f) => /^\*\*[^*]+\*\*\s*(\(\d+\)\s*)?—\s*`[^`]+\.md`$/.test(f.trim()));
verifier(
  sommaires.length === 0,
  sommaires.length
    ? `la table des matières a été relue comme un fait : ${sommaires[0]}`
    : 'aucune ligne de table des matières n’est prise pour un fait',
);

/* ------------------------------------------------------------------ */
console.log('\n3. Ce qui part au moteur : une carte, jamais des faits');
/* ------------------------------------------------------------------ */

const carte = memory.blocMemoire(projet);
const memoireEntiere = memory.memoryFacts(projet).join('\n');
console.log(
  `  carte : ${carte.length} signes (~${Math.round(carte.length / 2.2)} jetons) — mémoire entière : ${memoireEntiere.length} signes`,
);

verifier(carte.length < memoireEntiere.length / 2, 'la carte pèse moins de la moitié de la mémoire entière');

/*
 * AUCUN FAIT NE VOYAGE AVEC LA CARTE. On le prouve sur les faits RÉELS : si
 * l'un d'eux se retrouve dans la carte, la promesse est fausse.
 */
const faitsDansLaCarte = memory
  .memoryFacts(projet)
  .filter((f) => f.length > 40 && carte.includes(f.slice(0, 40)));
verifier(
  faitsDansLaCarte.length === 0,
  faitsDansLaCarte.length ? `un fait part avec la carte : ${faitsDansLaCarte[0]}` : 'aucun fait ne part avec la carte',
);

/*
 * LE PLAFOND QU'ON S'IMPOSE. La recherche de passages qu'on retire coûtait
 * environ 1 300 jetons À CHAQUE TOUR. La carte est envoyée une seule fois par
 * session : la garder sous ce chiffre est le minimum, et on se donne de la
 * marge — un projet peut grossir.
 */
const jetonsCarte = Math.round(carte.length / 2.2);
verifier(jetonsCarte < 1300, `la carte tient sous les 1 300 jetons de l’ancienne recherche (${jetonsCarte})`);

/* ------------------------------------------------------------------ */
console.log('\n4. Un mot ouvre son fichier de détail, et lui seul');
/* ------------------------------------------------------------------ */

const sujetFourni = eclates.sort((a, b) => b.branches.length - a.branches.length)[0];
const cible = sujetFourni.branches[Math.floor(sujetFourni.branches.length / 2)];
const autre = sujetFourni.branches.find((b) => b.nom !== cible.nom);

const detail = memory.detailMemoire(projet, cible.nom);
console.log(`  demande : « ${cible.nom} » → ${detail.length} signes`);
verifier(detail.includes(cible.fichier), `la réponse NOMME son fichier (${cible.fichier})`);
verifier(
  cible.faits.every((f) => detail.includes(f)),
  'elle porte tous les faits de cette branche, en entier',
);
verifier(
  !autre || !autre.faits.some((f) => detail.includes(f)),
  'et aucun fait d’une branche voisine ne vient avec',
);

const silence = memory.detailMemoire(projet, 'photosynthese-des-orchidees');
verifier(
  /Aucun fait ne correspond/.test(silence),
  'un mot qui ne nomme rien rend un silence honnête, pas un extrait au hasard',
);

/*
 * LA DESCENTE PAR PALIERS. Un sujet fourni ne déballe pas ses faits d'un coup :
 * il rend ses branches, et l'agent ouvre celle qui le concerne. C'est le
 * « souvenir flou » d'abord, le détail ensuite.
 */
const palier = memory.detailMemoire(projet, sujetFourni.id);
verifier(
  palier.length < sujetFourni.branches.flatMap((b) => b.faits).join('\n').length,
  `« ${sujetFourni.id} » rend son rappel (${palier.length} signes), pas ses ${sujetFourni.faits} faits`,
);

/* ------------------------------------------------------------------ */
console.log('\n5. Plus rien de la recherche par le sens dans le dépôt');
/* ------------------------------------------------------------------ */

const DISPARUS = [
  'server/src/passages.ts',
  'server/src/vecteurs.ts',
  'server/src/vecteurs-local.ts',
  'server/src/vecteurs-nocturne.ts',
  'shared/src/passages-doc.ts',
  'shared/src/passages-code.ts',
  'shared/src/passages-de-suite.ts',
  'shared/src/vecteurs-doc.ts',
  'scripts/installer-vectoriseur.mjs',
  'scripts/vectoriser-index.mjs',
];
const restants = DISPARUS.filter((f) => fs.existsSync(path.join(RACINE, f)));
verifier(
  restants.length === 0,
  restants.length ? `il reste : ${restants.join(', ')}` : `les ${DISPARUS.length} modules de recherche sont retirés`,
);

verifier(
  typeof partage.carteDeLArbre === 'function' && partage.rechercherPourLaTache === undefined,
  'le module partagé expose l’arbre, et plus aucune recherche',
);

/* La base ne garde plus d'index de passages : la migration 33 le range. */
const db = fs.readFileSync(path.join(RACINE, 'server/src/db.ts'), 'utf8');
verifier(
  db.includes('DROP TABLE IF EXISTS doc_passages'),
  'la base retire ses tables d’index de recherche',
);

/* ------------------------------------------------------------------ */

fs.rmSync(projet, { recursive: true, force: true });
fs.rmSync(bacASable, { recursive: true, force: true });

console.log('');
if (echecs.length) {
  console.error(`ÉCHEC — ${echecs.length} constat(s) :`);
  for (const e of echecs) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('Tout est vert : la mémoire est un arbre, et il se navigue par les noms.');
