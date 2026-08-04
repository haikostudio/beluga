import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { colonneAuDemarrage, effetDuDepot, tourDeLaCarte } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Une carte qui retravaille ne reste pas en « Terminé »                 */
/* ------------------------------------------------------------------ */

/*
 * Une carte a été vue dans « Terminé » avec le rond vert qui tournait : le
 * tableau annonçait la fin du travail pendant que l'agent écrivait encore.
 *
 * La règle, elle, était juste : `colonneAuDemarrage` ramène en « En cours »
 * toute carte dont un tour d'EXÉCUTION redémarre. Ce qui manquait, c'était la
 * garantie qu'aucun chemin de relance ne puisse l'éviter — et le constat que le
 * tour d'AVANT, qui rend la main à son rythme, ne doit plus rien écrire sur une
 * carte confiée depuis à quelqu'un d'autre.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.resolve(ICI, '../../src');

function lire(fichier: string): string {
  return fs.readFileSync(path.join(SOURCES, fichier), 'utf8');
}

/* -------- Chaque chemin de relance, un par un -------- */

/**
 * Les six façons de faire repartir le travail d'une carte. Toutes finissent par
 * un tour d'agent de rôle « task » qui démarre : c'est le seul fait qui compte
 * pour la colonne.
 */
const CHEMINS_DE_RELANCE = [
  'le bouton « Lancer maintenant »',
  'le dépôt de la carte dans « En cours »',
  'un message écrit dans la conversation de la carte',
  'un message qui attendait en file',
  'la réponse à une question de l’agent',
  'la reprise d’un travail mis en pause',
] as const;

test('depuis « Terminé », TOUT chemin de relance ramène la carte en cours', () => {
  for (const chemin of CHEMINS_DE_RELANCE) {
    assert.equal(colonneAuDemarrage('done', 'task'), 'running', chemin);
  }
});

test('déposer une carte terminée dans « En cours » vaut un lancement', () => {
  // Le glissement n'a pas de chemin à lui : il retombe sur le même départ.
  assert.equal(effetDuDepot('done', 'running'), 'lancer');
  assert.equal(colonneAuDemarrage('done', 'task'), 'running');
});

test('une relance ne rouvre jamais une fin de parcours', () => {
  // La limite posée par la carte : « À déployer » et « Archivé » ne bougent que
  // sur geste humain, et cette tâche-ci n'y touche pas.
  assert.equal(colonneAuDemarrage('to_deploy', 'task'), null);
  assert.equal(colonneAuDemarrage('archived', 'task'), null);
});

test('une relance d’analyse ou de publication laisse la carte terminée', () => {
  for (const role of ['analysis', 'orchestrator', 'deploy'] as const) {
    assert.equal(colonneAuDemarrage('done', role), null, role);
  }
});

/* -------- Le tour d'avant n'écrit plus sur la carte de quelqu'un d'autre -------- */

test('le tour de l’agent inscrit sur la carte peut la clore', () => {
  assert.equal(tourDeLaCarte({ agentId: 'a1' }, 'a1'), true);
});

test('un tour dont la carte a changé de main ne clôt plus rien', () => {
  // Arrêt puis relance : la carte porte le NOUVEL agent, l'ancien rend la main
  // après coup et ne doit pas écrire « Terminé » par-dessus.
  assert.equal(tourDeLaCarte({ agentId: 'a2' }, 'a1'), false);
});

test('une carte sans agent inscrit ne bloque personne', () => {
  assert.equal(tourDeLaCarte({}, 'a1'), true);
});

/* -------- Un seul endroit, pour que rien ne puisse l'éviter -------- */

test('la règle de départ vit dans UNE fonction, appelée au vrai départ du tour', () => {
  const runtime = lire('runtime.ts');
  assert.match(
    runtime,
    /export function replacerCarteAuDemarrage\(/,
    'la règle de départ doit être une fonction nommée, pas un bloc recopié',
  );
  // Elle est appelée à l'écriture de la demande ET au départ réel du moteur.
  const appels = runtime.match(/replacerCarteAuDemarrage\(agent\)/g) ?? [];
  assert.equal(appels.length, 2, 'appelée dans sendPrompt et dans startTurn');
});

test('aucun autre fichier du démon ne rejoue la règle dans son coin', () => {
  for (const fichier of ['scheduler.ts', 'ws.ts', 'deploy.ts']) {
    assert.doesNotMatch(
      lire(fichier),
      // Une mention en commentaire est permise ; un APPEL, non.
      /colonneAuDemarrage\(/,
      `${fichier} doit passer par le départ de tour, pas écrire une seconde règle`,
    );
  }
});

test('la fin de tour demande d’abord si le tour est encore celui de la carte', () => {
  const runtime = lire('runtime.ts');
  assert.match(runtime, /tourDeLaCarte\(card, agent\.id\)/);
});
