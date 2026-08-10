import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/* UN SEUL AGENT PAR CARTE, de l'étude à la livraison.                 */
/*                                                                     */
/* Le chiffrage ne part plus AVANT le lancement : c'est l'agent        */
/* d'exécution, créé au clic, qui étudie le projet, chiffre la tâche,  */
/* puis la réalise dans la foulée. Un seul agent, un seul fil, un seul */
/* contexte lourd lu (briefing, CLAUDE.md, index de la mémoire).       */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.resolve(ICI, '../../src');

function lire(fichier: string): string {
  return fs.readFileSync(path.join(SOURCES, fichier), 'utf8');
}

/** Le corps d'une fonction exportée de l'ordonnanceur, isolé pour le lire. */
function corps(nom: string): string {
  const scheduler = lire('scheduler.ts');
  const apres = scheduler.split(`export ${nom}(`)[1];
  assert.ok(apres, `${nom} doit exister dans l’ordonnanceur`);
  return apres.split('\nexport ')[0];
}

test('aucun agent de rôle « analysis » n’est plus créé pour une carte', () => {
  const scheduler = lire('scheduler.ts');
  assert.doesNotMatch(scheduler, /role: 'analysis'/);
  assert.doesNotMatch(scheduler, /export async function analyseCard\(/);
});

test('le lancement crée UN agent d’exécution, et un seul', () => {
  const start = corps('async function startCard');
  const creations = [...start.matchAll(/createAgent\(/g)];
  assert.equal(creations.length, 1, 'un seul agent naît au lancement');
  assert.match(start, /role: 'task'/);
});

test('le tour de lancement porte le chiffrage avec le travail', () => {
  const start = corps('async function startCard');
  // Le chiffrage n'est demandé que si la carte n'en porte pas déjà un.
  assert.match(start, /const chiffrageAttendu = !card\.estimate \|\| card\.estimate\.failed;/);
  assert.match(start, /chiffrage: chiffrageAttendu/);
  // Et les chiffres rendus remontent sur la carte, avec la mesure du moteur.
  assert.match(start, /parseEstimate\(text\)/);
  assert.match(start, /avecMesureAnalyse\(estimate, measurement\)/);
});

test('valider une carte n’envoie rien au moteur', () => {
  const valider = corps('function validerCarte');
  assert.doesNotMatch(valider, /sendPrompt\(/);
  assert.doesNotMatch(valider, /createAgent\(/);
  assert.match(valider, /column: 'planned'/);
});
