import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { humanStep } from '../engines/types.js';
import { creerFichierInstructions } from '../memory.js';

/*
 * Ce qui reste de la mémoire côté fichiers : l'étape « mémoire » lisible dans le
 * déroulé, et le squelette d'instructions posé à l'ajout d'un projet. La mémoire
 * elle-même vit dans la base de connaissances (`server/src/connaissances.ts`).
 */

function dossierDEssai(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-memoire-'));
}

test('aller chercher dans la mémoire se voit dans le déroulé, avec ce qui est cherché', () => {
  assert.equal(
    humanStep('mcp__beluga__memoire', { geste: 'chercher', demande: 'tiroir du téléphone' }).label,
    'Base de connaissances : recherche de « tiroir du téléphone »',
  );
  assert.equal(humanStep('mcp__beluga__memoire', { geste: 'lire', id: 'MEM-0042' }).label, 'Base de connaissances : lecture de « MEM-0042 »');
  assert.equal(humanStep('mcp__beluga__memoire', {}).label, 'Base de connaissances');
});

test('un projet sans fichier d\'instructions en reçoit un, un projet qui en a déjà n\'est pas touché', () => {
  const neuf = dossierDEssai();
  assert.equal(creerFichierInstructions(neuf, 'Projet neuf'), true);
  const pose = fs.readFileSync(path.join(neuf, 'CLAUDE.md'), 'utf8');
  assert.match(pose, /Projet neuf — instructions du moteur/);
  assert.match(pose, /Ne jamais publier de sa propre initiative/);
  assert.doesNotMatch(pose, /docs\/memoire/);
  // Deuxième passage : on n'écrase jamais ce qui existe.
  fs.writeFileSync(path.join(neuf, 'CLAUDE.md'), '# Écrit à la main\n');
  assert.equal(creerFichierInstructions(neuf, 'Projet neuf'), false);
  assert.match(fs.readFileSync(path.join(neuf, 'CLAUDE.md'), 'utf8'), /Écrit à la main/);

  // Un projet qui suit Codex a déjà son fichier : on n'en ajoute pas un second.
  const codex = dossierDEssai();
  fs.writeFileSync(path.join(codex, 'AGENTS.md'), '# Déjà là\n');
  assert.equal(creerFichierInstructions(codex, 'Projet Codex'), false);
  assert.equal(fs.existsSync(path.join(codex, 'CLAUDE.md')), false);
});
