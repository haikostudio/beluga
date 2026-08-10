#!/usr/bin/env node
/*
 * Le relevé AVANT / APRÈS de ce qui part au moteur à chaque tour.
 *
 * On ne devine pas : la version AVANT est relue dans git (l'état de la branche
 * avant la tâche « Économiser le quota »), compilée à part, et comparée à la
 * version courante sur une conversation type. Seule l'enveloppe est mesurée —
 * gabarit, briefing, mémoire, description de carte — c'est-à-dire ce que HaikoDev
 * ajoute par-dessus la demande de l'utilisateur.
 *
 * Le compteur de consommation par compte (relevé toutes les quinze minutes)
 * reste le juge de paix ; ce script dit ce qu'on a cessé d'envoyer.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE = process.argv[2] ?? 'tache/economiser-le-quota-reponses-plus-courte-02fac6';

/** Estimation maison, la même que le démon : environ quatre signes par jeton. */
const jetons = (texte) => Math.round(texte.length / 4);

function git(...args) {
  return execFileSync('git', args, {
    cwd: RACINE,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    // Une référence disparue est un cas prévu : le message de git n'a pas à
    // s'afficher au milieu du relevé.
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** La version d'avant, compilée dans un dossier temporaire depuis git. */
async function chargerAvant() {
  // Le dossier temporaire vit DANS le dépôt : les modules du projet (zod) ne se
  // résolvent pas depuis /tmp, et la version d'avant les utilise pour de vrai.
  const tmp = fs.mkdtempSync(path.join(RACINE, 'node_modules', '.cache-mesure-'));
  for (const f of ['templates.ts', 'columns.ts']) {
    fs.writeFileSync(path.join(tmp, f), git('show', `${REFERENCE}:shared/src/${f}`));
  }
  fs.writeFileSync(
    path.join(tmp, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { target: 'es2022', module: 'esnext', moduleResolution: 'bundler', outDir: 'dist' },
      include: ['*.ts'],
    }),
  );
  execFileSync('npx', ['tsc', '-p', tmp], { cwd: RACINE, stdio: 'pipe' });
  const module = await import(path.join(tmp, 'dist', 'templates.js'));
  fs.rmSync(tmp, { recursive: true, force: true });
  return module;
}

const apres = await import(path.join(RACINE, 'shared/dist/templates.js'));

/*
 * La branche de référence finit par être fusionnée puis supprimée : dans ce
 * cas, on ne devine pas ce qu'elle contenait. On mesure alors la seule
 * différence qu'on peut encore établir — celle du contexte, mémoire comprise —
 * et on le DIT, au lieu de rendre un chiffre inventé.
 */
let avant = apres;
let gabaritComparable = true;
try {
  avant = await chargerAvant();
} catch {
  gabaritComparable = false;
  console.log(
    `\nLa branche de référence « ${REFERENCE} » n'existe plus : le gabarit de réponse est donc\ncomparé à lui-même. Ce relevé mesure alors ce que le CONTEXTE a cessé d'envoyer.`,
  );
}

/* ------------------------------------------------------------------ */
/* La conversation type                                                */
/* ------------------------------------------------------------------ */

/*
 * La mémoire compte double dans ce relevé : elle part avec le briefing.
 *  — AVANT : le fichier ENTIER, journal des livraisons compris.
 *  — APRÈS : l'index seul (une ligne brève par fait, groupée par sujet), le
 *    journal ayant déménagé dans HISTORIQUE.md et le détail se demandant.
 */
const memory = await import(path.join(RACINE, 'server/dist/memory.js'));

// La mémoire ENTIÈRE, réunie depuis ses fichiers par sujet : c'est elle qui
// partait autrefois d'un bloc, et c'est à elle qu'on compare l'index.
const MEMOIRE = memory.readMemory(RACINE).trim();
const HISTORIQUE = fs.existsSync(path.join(RACINE, 'HISTORIQUE.md'))
  ? fs.readFileSync(path.join(RACINE, 'HISTORIQUE.md'), 'utf8').trim()
  : '';
// La mémoire d'avant : les faits ET les livraisons datées, dans le même fichier.
const MEMOIRE_AVANT = [MEMOIRE, ...HISTORIQUE.split('\n').filter((l) => l.trim().startsWith('- '))].join('\n');

/*
 * LE CONTRAT LU À L'OUVERTURE. Le briefing ne porte PAS CLAUDE.md : c'est la
 * MÉTHODE qui fait lire le fichier d'instructions au premier tour. Depuis la
 * tâche « la mémoire par sujet », ce fichier est court — la longue liste des
 * contrôles est partie dans `docs/verifications.md`, le texte des règles dans
 * `docs/regles/`, tout servi à la demande par `project_memory`. On pèse donc ce
 * que CLAUDE.md a cessé d'imposer à CHAQUE ouverture de session. La version
 * d'avant est relue dans git (le dernier état enregistré) ; si elle manque, on
 * ne compare pas le contrat.
 */
let contratAvant = 0;
let contratApres = 0;
try {
  contratApres = jetons(fs.readFileSync(path.join(RACINE, 'CLAUDE.md'), 'utf8'));
  contratAvant = jetons(git('show', 'HEAD:CLAUDE.md'));
} catch {
  /* pas de version d'avant dans git : on laisse le contrat hors du relevé */
}

const BRIEFING = `Projet : HaikoDev (dossier ${RACINE}).\n\nFichiers d'instructions présents : README.md.\n\nMÉMOIRE DU PROJET (à connaître avant d'explorer) :\n${MEMOIRE_AVANT}`;
const BRIEFING_APRES = memory.briefing(RACINE, 'HaikoDev', true);
const BRIEFING_COURT = `Projet : HaikoDev (dossier ${RACINE}).\n\nFichiers d'instructions présents : CLAUDE.md, README.md.`;

const CARTE = {
  titre: 'Économiser le quota : réponses plus courtes et contexte au strict nécessaire',
  description:
    "Le gabarit à six sections impose de la longueur même pour une retouche d'une ligne. Rendre la longueur proportionnelle au travail réel, et ne plus renvoyer à chaque tour le gabarit, les consignes de rôle et la description de la carte.",
  colonne: 'running',
};
const BLOC_CARTE = `CARTE EN COURS : « ${CARTE.titre} »\n${CARTE.description}\nColonne : ${CARTE.colonne}.`;

/** Cinq tours : le lancement de la carte, puis quatre échanges au fil de l'eau. */
const TOURS = [
  { nom: 'Lancement de la carte', texte: `Réalise cette tâche.\n\nTITRE : ${CARTE.titre}\n${CARTE.description}\n\nVa au bout : lis ce qu'il faut, modifie, teste, puis enregistre et sauvegarde.`, ampleur: 'complete' },
  { nom: 'Question de suivi', texte: "Pourquoi tu as choisi trois longueurs plutôt que deux ?" },
  { nom: 'Retouche d\'une ligne', texte: 'Corrige la faute dans le titre.' },
  { nom: 'Ajustement contenu', texte: 'Ajoute le rappel de forme aussi pour le chef d\'orchestre, et vérifie que les tests passent toujours.' },
  { nom: 'Relance', texte: 'Et les tests ?' },
];

/* ------------------------------------------------------------------ */
/* Le relevé                                                           */
/* ------------------------------------------------------------------ */

const lignes = [];
let totalAvant = 0;
let totalApres = 0;

TOURS.forEach((tour, i) => {
  const premier = i === 0;

  // AVANT : briefing + carte + gabarit entier, à chaque tour.
  const ctxAvant = [premier ? BRIEFING : BRIEFING_COURT, BLOC_CARTE].join('\n\n');
  const promptAvant = avant.wrapPrompt('in_run', tour.texte, ctxAvant);

  // APRÈS : briefing (index de la mémoire) et carte au premier tour seulement,
  // rappel de forme ensuite.
  const ctxApres = premier ? [BRIEFING_APRES, BLOC_CARTE].join('\n\n') : '';
  const ampleur = tour.ampleur ?? apres.ampleurParDefaut('in_run', tour.texte);
  const promptApres = apres.wrapPrompt('in_run', tour.texte, ctxApres || undefined, {
    rappel: !premier,
    ampleur,
  });

  let a = jetons(promptAvant);
  let b = jetons(promptApres);
  // Au premier tour, la MÉTHODE fait lire le contrat : on l'ajoute à l'enveloppe.
  if (premier) {
    a += contratAvant;
    b += contratApres;
  }
  totalAvant += a;
  totalApres += b;
  lignes.push({ tour: tour.nom, avant: a, apres: b, gain: a - b, reference: ampleur });
});

const largeur = Math.max(...lignes.map((l) => l.tour.length));
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

console.log('\nCE QUI ENTRE — jetons envoyés par tour (enveloppe HaikoDev, demande comprise)\n');
console.log(`${pad('Tour', largeur)}  ${num('avant', 7)}  ${num('après', 7)}  ${num('gain', 7)}   référence`);
console.log('-'.repeat(largeur + 40));
for (const l of lignes) {
  console.log(`${pad(l.tour, largeur)}  ${num(l.avant, 7)}  ${num(l.apres, 7)}  ${num(l.gain, 7)}   ${l.reference}`);
}
console.log('-'.repeat(largeur + 40));
console.log(`${pad('TOTAL', largeur)}  ${num(totalAvant, 7)}  ${num(totalApres, 7)}  ${num(totalAvant - totalApres, 7)}`);
console.log(`\nGain sur la conversation : ${Math.round((1 - totalApres / totalAvant) * 100)} %`);
if (contratAvant) {
  console.log(
    `  dont le CONTRAT lu à l'ouverture (CLAUDE.md) : ${contratAvant} → ${contratApres} jetons ` +
      `(${Math.round((1 - contratApres / contratAvant) * 100)} % en moins, une fois par session).`,
  );
}

const suivants = lignes.slice(1);
const sa = suivants.reduce((s, l) => s + l.avant, 0);
const sb = suivants.reduce((s, l) => s + l.apres, 0);
console.log(`Gain sur les tours SUIVANT l'ouverture : ${Math.round((1 - sb / sa) * 100)} % (${sa} → ${sb} jetons)`);

/* ------------------------------------------------------------------ */
/* L'OUVERTURE DU CHEF D'ORCHESTRE                                     */
/* ------------------------------------------------------------------ */

/*
 * Ce que le chef reçoit au PREMIER tour d'une conversation, avant même la
 * demande : son briefing et sa consigne de rôle. Depuis la tâche « alléger le
 * chef d'orchestre », il ne fait plus qu'un tri — carte courte et niveau de
 * l'agent qui exécutera — donc il ne reçoit plus ni index de la mémoire, ni
 * fichiers d'instructions, ni méthode de travail en six points, ni exigence de
 * description en quatre parties.
 *
 * L'AVANT est reconstruit à partir des blocs qu'il portait alors, tous encore
 * dans le code : le briefing COMPLET, la consigne commune des rôles qui
 * travaillent (déroulé visible + méthode + création de projet), le tri, et
 * l'exigence de description en quatre parties. Il OMET les trois paragraphes de
 * queue (relais d'analyse, outils, mise en forme) : le gain annoncé est donc
 * prudent, jamais gonflé.
 */
const runtime = await import(path.join(RACINE, 'server/dist/runtime.js'));
const partage = await import(path.join(RACINE, 'shared/dist/index.js'));

const CHEF_AVANT =
  memory.briefing(RACINE, 'HaikoDev', true, 'claude', undefined, 'complet') +
  '\n\n' +
  runtime.rolePrompt('task', true, 'claude', 'complet') +
  '\n\n' +
  runtime.TRI_DU_CHEF +
  '\n\n' +
  partage.CONSIGNE_DESCRIPTION_CARTE;

const CHEF_APRES =
  memory.briefing(RACINE, 'HaikoDev', true, 'claude', undefined, partage.niveauDAccueil({ role: 'orchestrator' })) +
  '\n\n' +
  runtime.rolePrompt('orchestrator', true, 'claude', partage.niveauDAccueil({ role: 'orchestrator' }));

const chefAvant = jetons(CHEF_AVANT);
const chefApres = jetons(CHEF_APRES);

console.log("\nL'OUVERTURE DU CHEF D'ORCHESTRE — jetons envoyés au premier tour d'une conversation\n");
console.log(`${pad('Bloc', largeur)}  ${num('avant', 7)}  ${num('après', 7)}  ${num('gain', 7)}`);
console.log('-'.repeat(largeur + 40));
console.log(
  `${pad('Briefing du chef', largeur)}  ${num(jetons(memory.briefing(RACINE, 'HaikoDev', true, 'claude', undefined, 'complet')), 7)}  ` +
    `${num(jetons(memory.briefing(RACINE, 'HaikoDev', true, 'claude', undefined, 'tri')), 7)}  ` +
    `${num(jetons(memory.briefing(RACINE, 'HaikoDev', true, 'claude', undefined, 'complet')) - jetons(memory.briefing(RACINE, 'HaikoDev', true, 'claude', undefined, 'tri')), 7)}`,
);
console.log(
  `${pad('Consigne de rôle', largeur)}  ${num(chefAvant - jetons(memory.briefing(RACINE, 'HaikoDev', true, 'claude', undefined, 'complet')), 7)}  ` +
    `${num(chefApres - jetons(memory.briefing(RACINE, 'HaikoDev', true, 'claude', undefined, 'tri')), 7)}  ` +
    `${num(chefAvant - chefApres - (jetons(memory.briefing(RACINE, 'HaikoDev', true, 'claude', undefined, 'complet')) - jetons(memory.briefing(RACINE, 'HaikoDev', true, 'claude', undefined, 'tri'))), 7)}`,
);
console.log('-'.repeat(largeur + 40));
console.log(`${pad('TOTAL', largeur)}  ${num(chefAvant, 7)}  ${num(chefApres, 7)}  ${num(chefAvant - chefApres, 7)}`);
console.log(
  `\nGain à CHAQUE conversation neuve du chef : ${Math.round((1 - chefApres / chefAvant) * 100)} %.\n` +
    "L'avant est reconstruit des blocs qu'il portait (trois paragraphes de queue omis) : le gain réel est un peu plus grand.",
);

/* ------------------------------------------------------------------ */
/* Ce qui sort                                                         */
/* ------------------------------------------------------------------ */

console.log('\nCE QUI SORT — longueur de référence de la réponse\n');
console.log('avant : six sections servies à chaque fois, quelle que soit la demande.');
for (const [cle, val] of Object.entries(apres.AMPLEURS)) {
  const sections = apres.sectionsPour('in_run', cle);
  const titres = sections.length ? sections.join(', ') : 'aucun titre imposé';
  console.log(`après : ${pad(val.libelle, 9)} ${num(val.mots, 4)} mots au plus — ${titres}`);
}
console.log(
  '\nLe compteur de consommation par compte (relevé toutes les quinze minutes, courbe sur sept jours)\nreste le juge de paix : ce relevé dit ce qu\'on a cessé d\'envoyer, pas ce que le moteur répondra.\n',
);
