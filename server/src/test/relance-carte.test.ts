import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { colonneAuDemarrage, tourDeLaCarte } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Une carte qui retravaille ne reste pas en « En cours » sans agent     */
/* ------------------------------------------------------------------ */

/*
 * Une carte a été vue avec le rond vert qui tournait alors que sa colonne
 * réelle n'avait pas suivi : le tableau annonçait la fin du travail pendant
 * que l'agent écrivait encore.
 *
 * La règle, elle, était juste : `colonneAuDemarrage` ramène en « En cours »
 * toute carte dont un tour d'EXÉCUTION redémarre. Ce qui manquait, c'était la
 * garantie qu'aucun chemin de relance ne puisse l'éviter — et le constat que le
 * tour d'AVANT, qui rend la main à son rythme, ne doit plus rien écrire sur une
 * carte confiée depuis à quelqu'un d'autre.
 *
 * Depuis la fusion de « Terminé » dans « À déployer », il n'y a plus de
 * colonne intermédiaire résumable : une carte rendue tombe directement dans
 * une FIN DE PARCOURS, qui ne se rouvre que sur geste humain
 * (`repriseAutorisee`). Les chemins de relance testés ici ne concernent donc
 * plus que « En cours » elle-même — cf. `une relance ne rouvre jamais une fin
 * de parcours`, plus bas.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.resolve(ICI, '../../src');

function lire(fichier: string): string {
  return fs.readFileSync(path.join(SOURCES, fichier), 'utf8');
}

test('une relance ne rouvre jamais une fin de parcours', () => {
  // La limite posée par la carte : « À déployer » et « Archivé » ne bougent que
  // sur geste humain, et cette tâche-ci n'y touche pas.
  assert.equal(colonneAuDemarrage('to_deploy', 'task'), null);
  assert.equal(colonneAuDemarrage('archived', 'task'), null);
});

test('une relance d’analyse ou de publication laisse la carte terminée', () => {
  for (const role of ['analysis', 'cadrage', 'deploy'] as const) {
    assert.equal(colonneAuDemarrage('to_deploy', role), null, role);
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
  // Le rangement de fin de tour vit dans `deplacement-carte.ts`, appelé par le
  // démon : c'est là que la question se pose, avant toute écriture.
  assert.match(lire('deplacement-carte.ts'), /tourDeLaCarte\(card, fin\.agentId\)/);
  assert.match(lire('runtime.ts'), /carteApresFinDeTour\(card, \{/);
});

/* -------- Une relance efface la marque de suspension -------- */

/*
 * Une carte arrêtée à la main, ou sortie de « En cours », garde
 * `scheduling.suspendu` : l'ordonnanceur ne la reprend plus tout seul, et
 * seul un geste efface la marque. Répondre à sa question EN EST UN — le tour
 * repartait pourtant avec la marque intacte, si bien que la carte retombait
 * en file après ce tour-là et n'en ressortait jamais. `startCard` efface déjà
 * la marque de son côté ; les deux seuls départs possibles la traitent donc
 * pareil.
 */
test('un départ de tour efface la suspension, comme le fait « Lancer maintenant »', () => {
  const runtime = lire('runtime.ts');
  const corps = runtime
    .split('export function replacerCarteAuDemarrage(')[1]
    .split('\nexport ')[0];
  assert.match(corps, /suspendu: false/, 'la relance doit effacer la marque de suspension');
  assert.match(corps, /waitingReason: undefined/, "…et la raison d'attente qui allait avec");
  // La marque de `startCard` ne bouge pas : les deux départs restent alignés.
  assert.match(lire('scheduler.ts'), /suspendu: false/);
});

/* -------- Un travail déjà atterri ne redit plus « aucun code enregistré » -------- */

/*
 * Une carte qui a produit et fusionné du code (« Enregistrer par tâche le
 * quota », « Page tableau de bord »…) recevait ensuite une SUITE — un tour sans
 * nouvel enregistrement — qui stampait « aucun fichier n'a changé », comme si
 * rien n'avait jamais été fait. Le drapeau `codeDejaEnregistre` survit au
 * relancement (contrairement à `doneAt`) : gravé au moment où du code atterrit,
 * il éteint la note pour toute suite ultérieure.
 */
test('relancer une carte aboutie grave le drapeau « code déjà enregistré »', () => {
  const runtime = lire('runtime.ts');
  const corps = runtime
    .split('export function replacerCarteAuDemarrage(')[1]
    .split('\nexport ')[0];
  // Au relancement depuis une fin de travail, le drapeau est posé pour de bon —
  // ce qui rattrape aussi les cartes abouties avant l'existence du drapeau.
  assert.match(corps, /codeDejaEnregistre:/);
  assert.match(corps, /carte\.column === 'to_deploy'/);
});

test('la fin de tour tient compte du code DÉJÀ enregistré par la carte', () => {
  const deplacement = lire('deplacement-carte.ts');
  // L'issue reçoit l'historique de la carte, pas ce seul tour : c'est lui qui
  // distingue « rien à changer, tout était déjà là » de « répondre n'est pas
  // travailler ».
  assert.match(deplacement, /issueDeFinDeTour\([^)]*dejaEnregistreApres\(card, fin\)\)/s);
  // Un tour qui produit du code grave le drapeau sur la carte, pour de bon.
  assert.match(deplacement, /return card\.codeDejaEnregistre \|\| aProduit;/);
});

/* -------- Une question restée en texte prévient, elle aussi -------- */

/*
 * Une question posée par l'outil notifie tout de suite. La même question
 * écrite en texte n'allumait que le triangle : rien ne sortait de
 * l'application. Le motif est le MÊME (`decision-attendue`), donc le
 * dédoublonnage de `notify` fait que l'agent qui a fait les deux ne prévient
 * qu'une fois.
 */
test('un tour qui finit sur une question en texte prévient par le guichet unique', () => {
  const runtime = lire('runtime.ts');
  assert.match(runtime, /decisionEnTexteLibre\(\{ statut: 'done', dernierMessage: dernier \}\)/);
  const bloc = runtime.split('if (!failed && agent.cardId) {')[1].split('\n  // Dès que')[0];
  assert.match(bloc, /motif: 'decision-attendue'/, 'le motif déjà prévu, jamais un nouveau genre');
  assert.match(bloc, /reference: agent\.cardId/, 'la CARTE comme référence : deux tours, une alerte');
});
