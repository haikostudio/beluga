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

/** Combien de niveaux de dossiers on descend au plus. */
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
