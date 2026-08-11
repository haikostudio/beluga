import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { partsDAccueil, texteAccesGithub, variablesGithub, VARIABLES_GITHUB } from '@haikodev/shared';
import { briefing } from '../memory.js';

/*
 * GITHUB EST DISPONIBLE POUR TOUS LES AGENTS, SUR TOUS LES PROJETS.
 *
 * Deux choses à verrouiller, et elles vont ensemble : le JETON part dans
 * l'environnement de chaque agent (sinon `gh` ne marche pas dans un bac à sable
 * ni dans une copie de travail), et la CAPACITÉ est annoncée dans l'accueil
 * (sinon un agent qui l'a propose quand même une carte pour un `gh pr view`).
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_RUNTIME = fs.readFileSync(path.resolve(ICI, '../../src/runtime.ts'), 'utf8');
const SOURCE_MEMORY = fs.readFileSync(path.resolve(ICI, '../../src/memory.ts'), 'utf8');

function dossierDEssai(): string {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-github-'));
  fs.writeFileSync(path.join(dossier, 'CLAUDE.md'), '# Essai\n\nInstructions du moteur.\n');
  return dossier;
}

/* ------------------------------------------------------------------ */
/* Les variables d'environnement                                       */
/* ------------------------------------------------------------------ */

test('un jeton pose les variables que lisent gh et les scripts', () => {
  const env = variablesGithub('ghp_essai');
  assert.equal(env.GH_TOKEN, 'ghp_essai');
  assert.equal(env.GITHUB_TOKEN, 'ghp_essai');
  // Un tour d'agent n'est pas interactif : une question de `gh` figerait le tour.
  assert.equal(env.GH_PROMPT_DISABLED, '1');
  for (const nom of VARIABLES_GITHUB) assert.ok(env[nom], `${nom} manquante`);
});

test('sans jeton, aucune variable creuse ne vient écraser une identification en place', () => {
  assert.deepEqual(variablesGithub(undefined), {});
  assert.deepEqual(variablesGithub(''), {});
  assert.deepEqual(variablesGithub('   '), {});
});

test("l'environnement de chaque agent reçoit les variables GitHub", () => {
  // Un seul objet `env` sert les trois lancements de moteur d'un tour (tour
  // normal, plan rendu en entier, compression) : le poser une fois suffit.
  assert.match(SOURCE_RUNTIME, /\.\.\.\(await envGithub\(\)\)/);
});

/* ------------------------------------------------------------------ */
/* L'annonce dans l'accueil                                            */
/* ------------------------------------------------------------------ */

test("l'annonce nomme des gestes réels et la seule limite", () => {
  const texte = texteAccesGithub();
  assert.match(texte, /gh repo view/);
  assert.match(texte, /gh pr create/);
  assert.match(texte, /gh issue/);
  assert.match(texte, /gh repo create/);
  // La publication reste un geste de l'utilisateur, y compris depuis GitHub.
  assert.match(texte, /mise en production|mettre en ligne/);
  assert.ok(texte.length < 900, `annonce trop longue : ${texte.length} signes`);
});

test('agent de tâche et chef d’orchestre reçoivent l’annonce, le dépannage non', () => {
  assert.equal(partsDAccueil('complet').github, true);
  assert.equal(partsDAccueil('tri').github, true);
  assert.equal(partsDAccueil('minimal').github, false);
});

test('le briefing porte l’annonce, sauf en accueil minimal', () => {
  const dossier = dossierDEssai();
  try {
    const complet = briefing(dossier, 'Essai', true, 'claude', undefined, 'complet');
    const tri = briefing(dossier, 'Essai', true, 'claude', undefined, 'tri');
    const minimal = briefing(dossier, 'Essai', true, 'claude', undefined, 'minimal');
    assert.match(complet, /GITHUB EST DIRECTEMENT ACCESSIBLE/);
    assert.match(tri, /GITHUB EST DIRECTEMENT ACCESSIBLE/);
    assert.doesNotMatch(minimal, /GITHUB EST DIRECTEMENT ACCESSIBLE/);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test("l'annonce vit dans la part sans mémoire du briefing", () => {
  // Elle ne coûte donc rien de plus quand la recherche de passages remplace
  // l'index, et elle survit à un accueil sans mémoire.
  const avant = SOURCE_MEMORY.indexOf('emporte.github');
  const separation = SOURCE_MEMORY.indexOf('const sansMemoire = parts.join');
  assert.ok(avant > 0 && separation > avant, 'l’annonce doit être poussée avant la coupure du briefing');
});
