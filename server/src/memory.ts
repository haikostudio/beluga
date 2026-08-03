import fs from 'node:fs';
import path from 'node:path';
import { chercherFaits, estLigneDeJournal, nettoyer, texteIndex } from '@haikodev/shared';

/**
 * La mémoire du projet (PLAN §25) : un court fichier texte DANS le dépôt, que
 * les agents lisent naturellement et qui suit le code dans l'historique.
 * Règle d'hygiène : une ligne devenue fausse est remplacée, pas empilée.
 *
 * Deux fichiers, deux usages :
 *  — MEMOIRE.md  : les faits durables et les pièges. Seul son INDEX part au
 *    moteur au lancement d'un agent ; le texte entier d'un fait se demande.
 *  — HISTORIQUE.md : les livraisons datées. Relisible par un humain, jamais
 *    envoyé au moteur : « telle carte livrée le 3 août » n'apprend rien à un
 *    agent qui commence une tâche.
 */

const FILE_NAME = 'MEMOIRE.md';
const HISTORY_NAME = 'HISTORIQUE.md';
const HEADER = '# Mémoire du projet\n\n_Tenue automatiquement par HaikoDev : faits durables uniquement, une ligne par fait._\n\n';
const HISTORY_HEADER =
  "# Historique des livraisons\n\n_Tenu automatiquement par HaikoDev. Ce fichier n'est JAMAIS envoyé au moteur : il se relit à la main._\n\n";

/**
 * Plafond de sécurité, pas outil de ménage : la réduction se fait par synthèse
 * (voir `synthese-memoire.ts`). Couper les plus anciennes lignes à l'aveugle
 * jetait des pièges encore vrais.
 */
const MAX_LINES = 200;

export function memoryPath(projectPath: string): string {
  return path.join(projectPath, FILE_NAME);
}

export function historyPath(projectPath: string): string {
  return path.join(projectPath, HISTORY_NAME);
}

export function readMemory(projectPath: string): string {
  try {
    return fs.readFileSync(memoryPath(projectPath), 'utf8');
  } catch {
    return '';
  }
}

export function readHistory(projectPath: string): string {
  try {
    return fs.readFileSync(historyPath(projectPath), 'utf8');
  } catch {
    return '';
  }
}

/** Une livraison datée : elle va dans l'historique, jamais dans la mémoire. */
export function appendHistory(projectPath: string, line: string): void {
  const clean = `- ${nettoyer(line)}`;
  let content = readHistory(projectPath);
  if (!content.trim()) content = HISTORY_HEADER;
  const lines = content.split('\n');
  if (lines.some((l) => l.trim().toLowerCase() === clean.toLowerCase())) return;
  lines.push(clean);
  writeSafely(historyPath(projectPath), lines.join('\n'));
}

/**
 * Les lignes de journal déjà écrites dans la mémoire des versions précédentes
 * repartent une fois pour toutes dans l'historique. Rien n'est perdu : elles
 * cessent seulement d'occuper le contexte des agents.
 */
export function migrerJournal(projectPath: string): number {
  const content = readMemory(projectPath);
  if (!content.trim()) return 0;
  const lines = content.split('\n');
  const gardees: string[] = [];
  const deplacees: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith('- ') && estLigneDeJournal(line)) deplacees.push(line);
    else gardees.push(line);
  }
  if (!deplacees.length) return 0;

  for (const line of deplacees) appendHistory(projectPath, line);
  writeSafely(memoryPath(projectPath), gardees.join('\n'));
  return deplacees.length;
}

export function appendMemory(projectPath: string, line: string, replaces?: string): void {
  // Une livraison datée n'est pas un fait : elle part dans l'historique.
  if (estLigneDeJournal(line)) {
    appendHistory(projectPath, line);
    return;
  }

  const file = memoryPath(projectPath);
  migrerJournal(projectPath);
  let content = readMemory(projectPath);
  if (!content.trim()) content = HEADER;

  const clean = `- ${nettoyer(line)}`;
  const lines = content.split('\n');

  if (replaces) {
    const needle = nettoyer(replaces).toLowerCase().slice(0, 40);
    const idx = lines.findIndex((l) => l.trim().toLowerCase().replace(/^[-*]\s*/, '').startsWith(needle));
    if (idx >= 0) {
      lines[idx] = clean;
      writeSafely(file, lines.join('\n'));
      return;
    }
  }

  // Doublon exact : on ne l'empile pas.
  const already = lines.some((l) => l.trim().toLowerCase() === clean.toLowerCase());
  if (already) return;

  lines.push(clean);

  // Plafond de sécurité seulement : au-delà, la synthèse a déjà dû passer.
  const factLines = lines.filter((l) => l.trim().startsWith('- '));
  if (factLines.length > MAX_LINES) {
    const excess = factLines.length - MAX_LINES;
    let removed = 0;
    for (let i = 0; i < lines.length && removed < excess; i++) {
      if (lines[i].trim().startsWith('- ')) {
        lines.splice(i, 1);
        i--;
        removed++;
      }
    }
  }

  writeSafely(file, lines.join('\n'));
}

/** Réécrit la mémoire entière (synthèse relue et acceptée). */
export function replaceMemory(projectPath: string, faits: string[]): void {
  const body = faits.map((f) => `- ${nettoyer(f)}`).join('\n');
  writeSafely(memoryPath(projectPath), `${HEADER}${body}\n`);
}

function writeSafely(file: string, content: string): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content.endsWith('\n') ? content : content + '\n', 'utf8');
  } catch {
    /* la mémoire ne doit jamais faire échouer une tâche */
  }
}

/**
 * Ce que l'agent vient de relire, en clair : combien de faits, et lesquels.
 * Sert à afficher l'étape « lecture de la mémoire du projet » tout en haut de
 * la conversation — on voit qu'il pioche dans la mémoire avant de répondre.
 */
export function memorySummary(projectPath: string): { facts: number; text: string } {
  const memory = readMemory(projectPath).trim();
  const facts = memory.split('\n').filter((line) => line.trim().startsWith('- ')).length;
  return { facts, text: memory };
}

/** Les faits de la mémoire, un par ligne, dans leur ordre d'écriture. */
export function memoryFacts(projectPath: string): string[] {
  return readMemory(projectPath)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => nettoyer(line));
}

/**
 * Les faits ajoutés DEPUIS un point donné. Une session d'agent garde la mémoire
 * dans son contexte : la renvoyer en entier à chaque message la répéterait des
 * dizaines de fois pour rien. Seul le complément est utile.
 */
export function newFactsSince(projectPath: string, alreadySeen: number): string[] {
  const facts = memoryFacts(projectPath);
  // La mémoire a été raccourcie ou réécrite : on repart du tout.
  if (alreadySeen > facts.length) return facts;
  return facts.slice(alreadySeen);
}

/** Le détail demandé par un agent : le texte ENTIER des faits qui l'intéressent. */
export function detailMemoire(projectPath: string, requete: string): string {
  const faits = memoryFacts(projectPath);
  if (!faits.length) return 'La mémoire du projet est vide pour le moment.';
  if (!requete.trim()) {
    return `MÉMOIRE DU PROJET — index (${faits.length} faits)\n\n${texteIndex(faits)}\n\nDemande le texte entier d'un fait avec un numéro, un sujet ou des mots-clés.`;
  }
  const trouves = chercherFaits(faits, requete);
  if (!trouves.length) {
    return `Aucun fait ne correspond à « ${requete} ».\n\nL'index complet :\n\n${texteIndex(faits)}`;
  }
  return trouves.map((f) => `${f.numero}. ${f.texte}`).join('\n\n');
}

/** Le nom du fichier d'instructions natif du moteur. */
export function fichierInstructions(engine?: string): string {
  return engine === 'codex' ? 'AGENTS.md' : 'CLAUDE.md';
}

/**
 * Le fichier d'instructions posé À L'AJOUT d'un projet, s'il n'en a aucun.
 * Un squelette vide vaut mieux qu'une absence : il dit ce qu'on attend de lui,
 * et le premier agent qui touche à une règle durable le remplit au lieu de se
 * demander où l'écrire. Un projet qui a déjà le sien n'est jamais touché.
 */
export function creerFichierInstructions(projectPath: string, projectName: string): boolean {
  const existants = ['CLAUDE.md', 'AGENTS.md'].filter((f) => fs.existsSync(path.join(projectPath, f)));
  if (existants.length) return false;

  const contenu = `# ${projectName} — instructions du moteur

Fichier court et factuel, tenu à jour AU FIL des tâches par les agents : comment lancer, comment
vérifier, où vivent les choses, ce qu'on n'enfreint pas. Aucun journal ici — les livraisons vont
dans \`HISTORIQUE.md\`, les règles apprises dans \`MEMOIRE.md\`.

## Où vivent les choses

_À remplir : les dossiers du projet et leur rôle, une ligne chacun._

## Lancer

\`\`\`bash
# À remplir : installer, construire, lancer en développement.
\`\`\`

## Vérifier

\`\`\`bash
# À remplir : les tests, les scripts de contrôle.
\`\`\`

## Règles à ne pas enfreindre

- Ne jamais publier de sa propre initiative : enregistrer et pousser, oui ; mettre en ligne est un
  geste de l'utilisateur.
`;
  writeSafely(path.join(projectPath, 'CLAUDE.md'), contenu);
  return true;
}

/**
 * Le briefing compact injecté au lancement de chaque agent : il sait déjà où
 * regarder au lieu de redécouvrir le projet de zéro.
 *
 * Depuis la tâche « alléger la mémoire », ce n'est plus la mémoire ENTIÈRE qui
 * part mais son INDEX : une ligne brève par fait, groupée par sujet. Le texte
 * complet se demande avec l'outil `project_memory`, quand le sujet concerne la
 * tâche. Sur un projet chargé, l'index tient en un quart de la place.
 *
 * `avecMemoire` est faux pour les tours SUIVANTS d'une même session : l'agent a
 * déjà l'index sous les yeux, on ne lui renvoie que les faits nouveaux.
 */
export function briefing(
  projectPath: string,
  projectName: string,
  avecMemoire = true,
  engine?: string,
): string {
  migrerJournal(projectPath);
  const parts: string[] = [`Projet : ${projectName} (dossier ${projectPath}).`];

  const natif = fichierInstructions(engine);
  const instructions = [natif, 'CLAUDE.md', 'AGENTS.md', 'README.md'].filter(
    (f, i, tab) => tab.indexOf(f) === i && fs.existsSync(path.join(projectPath, f)),
  );
  if (instructions.length) parts.push(`Fichiers d'instructions présents : ${instructions.join(', ')}.`);

  if (!avecMemoire) return parts.join('\n\n');

  const faits = memoryFacts(projectPath);
  if (faits.length) {
    parts.push(
      `MÉMOIRE DU PROJET — index des faits retenus (${faits.length}), une ligne par fait, groupée par sujet :\n` +
        `${texteIndex(faits)}\n\n` +
        `Ces lignes sont VOLONTAIREMENT tronquées. Le texte entier d'un fait se demande avec l'outil « project_memory » ` +
        `(argument « sujet » : un numéro, un nom de sujet, ou des mots-clés) — fais-le dès qu'une ligne touche à ce que tu vas modifier.`,
    );
  } else {
    parts.push("La mémoire du projet est vide : tu la rempliras en fin de tâche avec ce que tu auras appris.");
  }

  parts.push(
    `FICHIER D'INSTRUCTIONS DU MOTEUR : si ta tâche change une règle durable, une architecture ou une commande, mets ${natif} à jour avant de finir (crée-le s'il n'existe pas). ` +
      `Court et factuel : comment lancer, comment vérifier, où vivent les choses, les règles à ne pas enfreindre. Aucun journal dedans, aucune trace de tâche.`,
  );

  return parts.join('\n\n');
}
