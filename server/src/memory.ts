import fs from 'node:fs';
import path from 'node:path';

/**
 * La mémoire du projet (PLAN §25) : un court fichier texte DANS le dépôt, que
 * les agents lisent naturellement et qui suit le code dans l'historique.
 * Règle d'hygiène : une ligne devenue fausse est remplacée, pas empilée.
 */

const FILE_NAME = 'MEMOIRE.md';
const HEADER = '# Mémoire du projet\n\n_Tenue automatiquement par HaikoDev : faits durables uniquement, une ligne par fait._\n\n';
const MAX_LINES = 90;

export function memoryPath(projectPath: string): string {
  return path.join(projectPath, FILE_NAME);
}

export function readMemory(projectPath: string): string {
  try {
    return fs.readFileSync(memoryPath(projectPath), 'utf8');
  } catch {
    return '';
  }
}

export function appendMemory(projectPath: string, line: string, replaces?: string): void {
  const file = memoryPath(projectPath);
  let content = readMemory(projectPath);
  if (!content.trim()) content = HEADER;

  const clean = `- ${line.replace(/^[-*]\s*/, '').trim()}`;
  const lines = content.split('\n');

  if (replaces) {
    const needle = replaces.replace(/^[-*]\s*/, '').trim().toLowerCase().slice(0, 40);
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

  // La mémoire reste courte par construction : au-delà du plafond, on retire
  // les plus anciennes lignes (les plus récentes sont les plus pertinentes).
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

/**
 * Le briefing compact injecté au lancement de chaque agent : il sait déjà où
 * regarder au lieu de redécouvrir le projet de zéro.
 */
export function briefing(projectPath: string, projectName: string): string {
  const memory = readMemory(projectPath).trim();
  const parts: string[] = [`Projet : ${projectName} (dossier ${projectPath}).`];

  const instructions = ['CLAUDE.md', 'AGENTS.md', 'README.md'].filter((f) =>
    fs.existsSync(path.join(projectPath, f)),
  );
  if (instructions.length) parts.push(`Fichiers d'instructions présents : ${instructions.join(', ')}.`);

  if (memory) {
    parts.push(`MÉMOIRE DU PROJET (à connaître avant d'explorer) :\n${memory}`);
  } else {
    parts.push("La mémoire du projet est vide : tu la rempliras en fin de tâche avec ce que tu auras appris.");
  }
  return parts.join('\n\n');
}
