#!/usr/bin/env node
/*
 * LE FICHIER D'INSTRUCTIONS TIENT SOUS SON PLAFOND — ET IL NE SE MODIFIE PAS EN PLEINE JOURNÉE.
 *
 * Contrôle STATIQUE, sans navigateur, sans base, sans moteur : il ne lit que des fichiers.
 *
 * POURQUOI. `CLAUDE.md` est chargé par le MOTEUR lui-même à chaque session, et relu à CHACUN des
 * allers-retours d'un tour — 62 en moyenne pour une carte. Mesuré le 17/08/2026
 * (`docs/audit-quota-claude.md`), il pesait 158 743 signes, soit 73 423 jetons : environ LA MOITIÉ
 * de tout ce que Claude relisait sur ce serveur. Il était passé de 15 938 signes à 158 743 en neuf
 * jours, parce que rien ne mesurait sa taille.
 *
 * Le contrôle vise le dépôt d'où il PART (`import.meta.url`), jamais un chemin en dur : lancé depuis
 * une copie de travail, il doit juger cette copie et non le dossier principal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Le plafond, en SIGNES. 25 000 signes font environ 11 400 jetons avec le vrai rapport de cette
 * documentation : de quoi porter le contrat entier (le NOM de chaque invariant) sans son texte,
 * qui vit par sujet dans `docs/regles/`.
 */
const PLAFOND_SIGNES = 25_000;

/**
 * SIGNES PAR JETON — mesuré, pas supposé. Quatre signes par jeton vaut à peu près pour un texte
 * anglais ordinaire ; sur cette documentation dense en identifiants, chemins et accents, le rapport
 * mesuré est de 2,16 (158 743 signes pour 73 423 jetons). Même valeur que `SIGNES_PAR_JETON` dans
 * `shared/src/couches-tokens.ts`.
 */
const SIGNES_PAR_JETON = 2.2;

const resultats = [];
const verifier = (nom, ok, detail) => {
  resultats.push(ok);
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const milliers = (n) => Math.round(n).toLocaleString('fr-CH').replace(/ | /g, ' ');

console.log("\nLE SOCLE RELU À CHAQUE ALLER-RETOUR\n");

/* ------------------------------------------------------------------ */
/* 1. La taille du fichier d'instructions                              */
/* ------------------------------------------------------------------ */

const candidats = ['CLAUDE.md', 'AGENTS.md'].filter((nom) => fs.existsSync(path.join(RACINE, nom)));
if (!candidats.length) {
  console.log("  Aucun fichier d'instructions dans ce dépôt : rien à mesurer.");
  process.exit(0);
}

for (const nom of candidats) {
  const texte = fs.readFileSync(path.join(RACINE, nom), 'utf8');
  const signes = texte.length;
  const jetons = signes / SIGNES_PAR_JETON;
  /*
   * Un fichier qui ne fait que RENVOYER à un autre (le cas d'`AGENTS.md` ici) n'a pas à tenir sous
   * le même plafond : il est déjà minuscule, et le juger deux fois n'apprendrait rien.
   */
  const renvoi = signes < 2_000;
  verifier(
    `${nom} tient sous ${milliers(PLAFOND_SIGNES)} signes`,
    renvoi || signes <= PLAFOND_SIGNES,
    `${milliers(signes)} signes, environ ${milliers(jetons)} jetons relus à chaque aller-retour${
      renvoi ? ' (simple renvoi)' : ''
    }`,
  );
}

/* ------------------------------------------------------------------ */
/* 2. Le texte des règles vit ailleurs, et le contrat le dit           */
/* ------------------------------------------------------------------ */

const contrat = fs.readFileSync(path.join(RACINE, candidats[0]), 'utf8');

verifier(
  'le contrat renvoie au texte entier des règles',
  contrat.includes('docs/regles/'),
  'sinon un agent ne sait pas où lire la règle qu’il ne fait que voir nommée',
);

/*
 * UN NOM D'INVARIANT TIENT SUR UNE LIGNE. Un « nom » de dix lignes, c'est le texte de la règle
 * revenu par la fenêtre — exactement ce qui a fait passer ce fichier de 16 000 à 159 000 signes.
 */
const SIGNES_MAX_PAR_LIGNE = 400;
const tropLongues = contrat
  .split('\n')
  .filter((ligne) => ligne.startsWith('- ') && ligne.length > SIGNES_MAX_PAR_LIGNE);
verifier(
  `aucun invariant ne dépasse ${SIGNES_MAX_PAR_LIGNE} signes`,
  tropLongues.length === 0,
  tropLongues.length ? `${tropLongues.length} ligne(s) : ${tropLongues[0].slice(0, 60)}…` : 'le contrat ne porte que des noms',
);

/* ------------------------------------------------------------------ */
/* 3. Le fichier d'attente existe, et le contrat y renvoie             */
/* ------------------------------------------------------------------ */

const attente = path.join(RACINE, 'docs/instructions-en-attente.md');
verifier(
  "le fichier d'attente existe",
  fs.existsSync(attente),
  'c’est là qu’un agent écrit une règle durable, pour ne pas casser le cache en pleine journée',
);

verifier(
  "le contrat interdit sa propre modification en pleine journée",
  contrat.includes('instructions-en-attente'),
  'sans cette ligne, chaque carte réécrit le fichier en finissant',
);

/*
 * LE FICHIER D'ATTENTE NE DOIT PAS DEVENIR UN SECOND CONTRAT : il est là pour être VIDÉ chaque
 * nuit. S'il enfle, c'est que le rangement de nuit ne tourne plus.
 */
if (fs.existsSync(attente)) {
  const taille = fs.readFileSync(attente, 'utf8').length;
  verifier(
    "le fichier d'attente n'enfle pas (le rangement de nuit tourne)",
    taille <= 40_000,
    `${milliers(taille)} signes`,
  );
}

/* ------------------------------------------------------------------ */

const echecs = resultats.filter((ok) => !ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.\n`);
process.exit(echecs ? 1 : 0);
