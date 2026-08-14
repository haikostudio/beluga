/**
 * LES FICHIERS DU PROJET DANS LA RECHERCHE — CÔTÉ RÈGLES PURES.
 *
 * La recherche ne connaissait que la documentation (`docs/`, la mémoire, les
 * contrôles). Un agent qui demande « où se décide la couleur d'une colonne »
 * n'avait donc rien : la réponse est dans le CODE, pas dans une règle. On indexe
 * désormais aussi les fichiers du projet, avec trois précautions.
 *
 *  1. ON N'INDEXE PAS TOUT. Les dossiers de machine (`node_modules`, `dist`, les
 *     copies de travail) n'apprennent rien et pèsent cent fois le dépôt.
 *  2. LE CODE PASSE DERRIÈRE LA DOCUMENTATION. Une règle écrite explique
 *     POURQUOI ; un fichier montre COMMENT. À score égal, la règle gagne — c'est
 *     la priorité `code`, la seule négative.
 *  3. LE CODE NE PREND PAS TOUTE LA PLACE. Deux passages de code au plus dans
 *     une recherche (`PASSAGES_CODE_MAX`) : sans cela, une demande truffée de
 *     noms de fichiers remontait sept bouts de code et pas une seule règle.
 *
 * Le découpage n'est pas celui du Markdown : un fichier de code n'a pas de
 * titres. On coupe aux lignes vides, en gardant le nom de la dernière
 * déclaration rencontrée comme titre — c'est ce qu'un agent lit pour décider
 * d'ouvrir le fichier.
 */

import { PLAFOND_PASSAGE_SIGNES, PLANCHER_PASSAGE_SIGNES, PRIORITE, type PassageDoc } from './passages-doc.js';

/* ------------------------------------------------------------------ */
/* Ce qu'on indexe, et ce qu'on laisse                                 */
/* ------------------------------------------------------------------ */

/** Les extensions qui portent du code ou de la configuration lisible. */
export const EXTENSIONS_CODE = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.php', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.vue', '.svelte', '.css', '.scss', '.sql', '.sh',
]);

/** Les dossiers qu'on ne descend jamais : machine, dépendances, copies de travail. */
export const DOSSIERS_HORS_INDEX = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'vendor',
  '.git', '.worktrees', '.next', '.nuxt', '.cache', '.venv', '__pycache__',
  'data', 'tmp', 'temp', 'logs',
]);

/**
 * LES DOSSIERS ÉCARTÉS POUR LES DOCUMENTS, plus courts que pour le code : un
 * Markdown peut vivre N'IMPORTE OÙ dans un projet et porter une information
 * qu'on ne trouve nulle part ailleurs — le contenu d'un cours dans
 * `scripts/formation-content/`, un document du chef dans `data/documents/`. On
 * n'écarte donc que ce qui n'a pas été ÉCRIT ici : les dépendances installées et
 * les dossiers de machine.
 */
export const DOSSIERS_SANS_DOC = new Set([
  'node_modules', '.git', '.worktrees', 'dist', 'build', 'out', 'coverage',
  'vendor', '.next', '.nuxt', '.cache', '__pycache__',
  'venv', '.venv', 'venv-kokoro', 'site-packages', 'env', '.tox',
]);

/**
 * DEUX DOCUMENTS NE S'INDEXENT JAMAIS, où qu'ils soient : le JOURNAL des
 * livraisons (`HISTORIQUE.md`) et la mémoire d'AVANT une synthèse
 * (`MEMOIRE.avant-synthese.md`). Le premier est une suite de dates dont aucune
 * ne répond jamais à une question ; le second est une version périmée de la
 * mémoire, qui contredirait la version en vigueur. Même règle que l'envoi
 * quotidien au cerveau.
 */
export const DOCUMENTS_JAMAIS_INDEXES = new Set(['HISTORIQUE.md', 'MEMOIRE.avant-synthese.md']);

/** Combien de documents Markdown on indexe au plus, sur un projet quelconque. */
export const FICHIERS_DOC_MAX = 1600;

/**
 * LES FICHIERS DE CONFIGURATION. Ils ne sont ni de la documentation ni vraiment
 * du code, mais ils répondent à des questions que rien d'autre ne couvre : quelle
 * bibliothèque le projet déclare, sur quel port il écoute, comment son service
 * démarre. On les prend par NOM EXACT ou par extension.
 *
 * Les fichiers d'environnement RÉELS (`.env`, `.env.production`) restent dehors :
 * ils changent à chaque réglage et ne décrivent pas le projet — leur EXEMPLE
 * (`.env.example`), lui, entre, car c'est lui qui documente les variables
 * attendues.
 */
export const FICHIERS_DE_CONFIG = new Set([
  'package.json', 'tsconfig.json', 'nuxt.config.ts', 'vite.config.ts', 'next.config.js',
  'tailwind.config.js', 'docker-compose.yml', 'docker-compose.prod.yml', 'dockerfile',
  'caddyfile', 'nginx.conf', 'makefile', 'pyproject.toml', 'requirements.txt',
  'composer.json', 'go.mod', 'cargo.toml', '.env.example', '.env.sample',
]);

/** Les extensions de configuration prises partout : services système, réglages. */
export const EXTENSIONS_CONFIG = new Set(['.service', '.timer', '.toml', '.ini', '.conf']);

/** Vrai si ce fichier décrit le montage du projet plutôt que son code. */
export function estFichierDeConfig(relatif: string): boolean {
  if (cheminEcarte(relatif)) return false;
  const nom = (relatif.split('/').pop() ?? '').toLowerCase();
  if (nom === 'package-lock.json' || nom === 'composer.lock') return false;
  if (FICHIERS_DE_CONFIG.has(nom)) return true;
  if (nom.startsWith('dockerfile')) return true;
  return EXTENSIONS_CONFIG.has(extensionDuFichier(nom));
}

/**
 * Vrai si ce Markdown mérite d'entrer dans l'index. Contrairement au code, la
 * profondeur n'est pas bornée : un document utile peut être rangé loin.
 */
export function estDocumentMarkdown(relatif: string): boolean {
  const parts = relatif.split('/').filter(Boolean);
  const nom = parts[parts.length - 1] ?? '';
  if (!/\.(md|markdown)$/i.test(nom)) return false;
  if (DOCUMENTS_JAMAIS_INDEXES.has(nom)) return false;
  for (const part of parts.slice(0, -1)) {
    if (DOSSIERS_SANS_DOC.has(part)) return false;
    if (part.startsWith('.') && part !== '.claude') return false;
  }
  return true;
}

/** Combien de niveaux de dossiers on descend au plus, pour le CODE. */
export const PROFONDEUR_CODE_MAX = 6;

/** Un fichier plus gros que cela est un fichier généré, pas un fichier écrit. */
export const SIGNES_MAX_PAR_FICHIER = 120_000;

/** Combien de fichiers de code on indexe au plus, sur un projet quelconque. */
export const FICHIERS_CODE_MAX = 900;

/** Combien de passages de code au plus dans une même recherche. */
export const PASSAGES_CODE_MAX = 2;

/** L'extension d'un chemin, en minuscules, point compris. */
export function extensionDuFichier(chemin: string): string {
  const nom = chemin.split('/').pop() ?? '';
  const point = nom.lastIndexOf('.');
  return point > 0 ? nom.slice(point).toLowerCase() : '';
}

/** Vrai si ce chemin relatif traverse un dossier écarté, ou un dossier caché. */
export function cheminEcarte(relatif: string): boolean {
  const parts = relatif.split('/').filter(Boolean);
  for (const part of parts.slice(0, -1)) {
    if (DOSSIERS_HORS_INDEX.has(part)) return true;
    if (part.startsWith('.')) return true;
  }
  return parts.length > PROFONDEUR_CODE_MAX;
}

/**
 * Vrai si ce fichier mérite d'entrer dans l'index. Les fichiers construits
 * (`*.min.js`, `*.d.ts`) sont écartés : ils redisent le code source en moins
 * lisible.
 */
export function estFichierDeCode(relatif: string): boolean {
  if (cheminEcarte(relatif)) return false;
  const nom = relatif.split('/').pop() ?? '';
  if (nom.startsWith('.')) return false;
  if (/\.min\.(js|css)$/i.test(nom)) return false;
  if (/\.d\.ts$/i.test(nom)) return false;
  if (/[-.]lock\./i.test(nom) || nom === 'package-lock.json') return false;
  return EXTENSIONS_CODE.has(extensionDuFichier(nom));
}

/* ------------------------------------------------------------------ */
/* Le découpage d'un fichier de code                                   */
/* ------------------------------------------------------------------ */

/**
 * LE NOM DE LA DÉCLARATION portée par une ligne, quand elle en ouvre une. On ne
 * cherche pas à analyser un langage : on reconnaît les formes les plus
 * répandues, et l'on se tait quand on ne reconnaît rien.
 */
export function declarationDeLaLigne(ligne: string): string | undefined {
  const nette = ligne.trim();
  if (!nette || nette.length > 200) return undefined;
  const formes = [
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    /^(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
    /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/,
    /^(?:public|private|protected|static)?\s*(?:async\s+)?(?:def|func|fn|sub)\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:public|private|protected)?\s*function\s+([A-Za-z_$][\w$]*)/,
  ];
  for (const forme of formes) {
    const trouve = nette.match(forme);
    if (trouve) return trouve[1];
  }
  return undefined;
}

/**
 * LE DÉCOUPAGE D'UN FICHIER DE CODE EN PASSAGES. On empile les lignes jusqu'au
 * plafond, en coupant de préférence sur une ligne vide ou sur une nouvelle
 * déclaration : un morceau qui commence au milieu d'une fonction ne se comprend
 * pas. Le titre d'un morceau est la dernière déclaration ouverte avant lui.
 */
export function decouperCodeEnPassages(
  source: string,
  texte: string,
  options: { sujet?: string; plafond?: number } = {},
): PassageDoc[] {
  const plafond = options.plafond ?? PLAFOND_PASSAGE_SIGNES;
  const sujet = options.sujet ?? 'code';
  const lignes = texte.replace(/\r\n/g, '\n').split('\n');

  const passages: PassageDoc[] = [];
  let courant: string[] = [];
  let signes = 0;
  /** Le nom qui titrera le morceau en train de se remplir. */
  let titreEnCours = '';
  /** La dernière déclaration de PREMIER NIVEAU vue : les locales ne titrent rien. */
  let derniereDeclaration = '';

  const vider = (titreSuivant: string) => {
    const brut = courant.join('\n').trim();
    courant = [];
    signes = 0;
    const titre = titreEnCours;
    titreEnCours = titreSuivant;
    if (brut.length < PLANCHER_PASSAGE_SIGNES) return;
    passages.push({ source, titre, sujet, priorite: PRIORITE.code, texte: brut });
  };

  for (const ligne of lignes) {
    // Seules les lignes NON indentées déclarent : `const ligne0 = …` au milieu
    // d'une fonction est une variable locale, pas le sujet du morceau.
    const declaration = /^\S/.test(ligne) ? declarationDeLaLigne(ligne) : undefined;
    if (declaration) {
      // Une déclaration de premier niveau est le meilleur endroit où couper :
      // le morceau qui s'ouvre commence alors par elle, et porte son nom.
      if (signes >= plafond / 2) vider(declaration);
      derniereDeclaration = declaration;
      if (!titreEnCours) titreEnCours = declaration;
    }
    // Une coupe de TAILLE, elle, reste dans la même déclaration : le morceau
    // suivant garde son nom, sinon il paraîtrait venir d'ailleurs.
    if (signes + ligne.length + 1 > plafond && courant.length) vider(derniereDeclaration);
    courant.push(ligne);
    signes += ligne.length + 1;
  }
  vider('');

  return passages;
}
