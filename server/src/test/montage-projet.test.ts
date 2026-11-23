import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ecrireFichiersDeDepart } from '../projects.js';

/* ------------------------------------------------------------------ */
/* Le montage d'un projet neuf : les fichiers qu'il doit avoir          */
/* ------------------------------------------------------------------ */

function dossierNeuf(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'montage-projet-'));
}

test('un projet neuf reçoit ses documents de départ, sans aucun fichier de mémoire', () => {
  const cible = dossierNeuf();
  ecrireFichiersDeDepart(cible, 'Mon Atelier');

  for (const fichier of [
    'README.md',
    'CLAUDE.md',
    'AGENTS.md',
    'DOCUMENTATION.md',
    'HISTORIQUE.md',
    '.gitignore',
  ]) {
    assert.equal(fs.existsSync(path.join(cible, fichier)), true, `${fichier} manque`);
  }
  // La mémoire vit en classeurs dans Beluga Build : plus de MEMOIRE.md posé.
  assert.equal(fs.existsSync(path.join(cible, 'MEMOIRE.md')), false);
});

test('le fichier de Codex renvoie à celui de Claude : une seule vérité', () => {
  const cible = dossierNeuf();
  ecrireFichiersDeDepart(cible, 'Mon Atelier');
  const agents = fs.readFileSync(path.join(cible, 'AGENTS.md'), 'utf8');
  assert.match(agents, /CLAUDE\.md/);
});

test('la phrase de présentation ouvre la documentation et le fichier de garde', () => {
  const cible = dossierNeuf();
  ecrireFichiersDeDepart(cible, 'Mon Atelier', "Le site vitrine de l'atelier");
  assert.match(fs.readFileSync(path.join(cible, 'DOCUMENTATION.md'), 'utf8'), /site vitrine de l'atelier/);
  assert.match(fs.readFileSync(path.join(cible, 'README.md'), 'utf8'), /site vitrine de l'atelier/);
});

test('l’historique part vide, mais avec son en-tête', () => {
  const cible = dossierNeuf();
  ecrireFichiersDeDepart(cible, 'Mon Atelier');
  const histoire = fs.readFileSync(path.join(cible, 'HISTORIQUE.md'), 'utf8');
  assert.match(histoire, /^# Historique des livraisons/);
  // Le rappel compte : ce fichier ne doit jamais partir au moteur.
  assert.match(histoire, /JAMAIS envoyé au moteur/);
});

test('un fichier déjà là n’est jamais écrasé', () => {
  const cible = dossierNeuf();
  fs.writeFileSync(path.join(cible, 'README.md'), 'à moi', 'utf8');
  const ecrits = ecrireFichiersDeDepart(cible, 'Mon Atelier');
  assert.equal(fs.readFileSync(path.join(cible, 'README.md'), 'utf8'), 'à moi');
  assert.equal(ecrits.includes('README.md'), false);
});

test('un projet qui a déjà ses instructions garde les siennes', () => {
  const cible = dossierNeuf();
  fs.writeFileSync(path.join(cible, 'CLAUDE.md'), '# règles à moi', 'utf8');
  ecrireFichiersDeDepart(cible, 'Mon Atelier');
  assert.equal(fs.readFileSync(path.join(cible, 'CLAUDE.md'), 'utf8'), '# règles à moi');
});
