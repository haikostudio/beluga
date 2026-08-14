import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLAFOND_ATTENTE_LOT_MS,
  RAISON_SANS_REPONSE,
  bilanDeLot,
  bilanEnRoute,
  gesteResteEnRoute,
  partsDuLot,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* UN GESTE DU PIED DE COLONNE REND LA MAIN, ET NE MENT PAS.           */
/*                                                                     */
/* Deux choses figeaient l'écran : le lancement d'une carte ne         */
/* répondait qu'à la FIN du tour, et un délai dépassé était compté     */
/* comme un refus — « Aucune carte lancée » pendant que les agents     */
/* démarraient.                                                        */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.resolve(ICI, '../../src');
const BOARD = path.resolve(ICI, '../../../web/src/components/board.tsx');

const RAISON_DOSSIER = 'Un autre agent travaille déjà dans ce dossier (carte « Refaire le tableau »).';

/* -------- La règle : un délai dépassé n'est pas un refus -------- */

test('un délai dépassé se reconnaît, et lui seul', () => {
  assert.ok(gesteResteEnRoute(RAISON_SANS_REPONSE));
  assert.ok(!gesteResteEnRoute(RAISON_DOSSIER));
  assert.ok(!gesteResteEnRoute(undefined));
});

test('les trois parts d’un lot se comptent séparément', () => {
  const parts = partsDuLot(1, [
    { titre: 'Plan A', raison: RAISON_DOSSIER },
    { titre: 'Plan B', raison: RAISON_SANS_REPONSE },
  ]);
  assert.equal(parts.faites, 1);
  assert.deepEqual(parts.refusees.map((r) => r.titre), ['Plan A']);
  assert.deepEqual(parts.enRoute.map((r) => r.titre), ['Plan B']);
});

test('un lot sans réponse à temps n’est PAS un échec', () => {
  const bilan = bilanDeLot('lancée', 0, [
    { titre: 'Plan A', raison: RAISON_SANS_REPONSE },
    { titre: 'Plan B', raison: RAISON_SANS_REPONSE },
  ]);
  assert.equal(bilan.niveau, 'info');
  // La phrase qui contredisait ce qui se passait vraiment ne doit plus paraître.
  assert.doesNotMatch(bilan.texte, /Aucune carte lancée/);
  assert.match(bilan.texte, /2 cartes en route/);
  assert.match(bilan.texte, /la colonne se met à jour toute seule/);
});

test('un vrai refus reste dit, même à côté d’un geste encore en route', () => {
  const bilan = bilanDeLot('lancée', 0, [
    { titre: 'Plan A', raison: RAISON_DOSSIER },
    { titre: 'Plan B', raison: RAISON_SANS_REPONSE },
  ], 'HaikoDev');
  // Une carte est partie : ce n'est plus l'échec franc du lot entièrement refusé.
  assert.equal(bilan.niveau, 'warning');
  assert.match(bilan.texte, /^Projet « HaikoDev » — Aucune carte lancée — 1 en attente :/);
  assert.match(bilan.texte, /« Plan A » — Un autre agent travaille déjà/);
  assert.match(bilan.texte, /1 carte en route/);
});

test('un lot passé qui garde une carte en route le dit sans alarme', () => {
  const bilan = bilanDeLot('déployée', 2, [{ titre: 'Plan C', raison: RAISON_SANS_REPONSE }]);
  assert.equal(bilan.niveau, 'success');
  assert.match(bilan.texte, /2 cartes déployées\./);
  assert.match(bilan.texte, /1 carte en route/);
});

test('le message du pied qui rend la main annonce un travail parti, pas une panne', () => {
  const bilan = bilanEnRoute(2, 'HaikoDev');
  assert.equal(bilan.niveau, 'info');
  assert.match(bilan.texte, /^Projet « HaikoDev » — 2 cartes en route/);
});

test('le plafond d’attente du pied reste très en deçà du délai du navigateur', () => {
  // 120 000 ms : le délai de `call()` — l'écran ne doit jamais l'atteindre.
  assert.ok(PLAFOND_ATTENTE_LOT_MS > 1000, 'un geste normal doit avoir le temps de répondre');
  assert.ok(PLAFOND_ATTENTE_LOT_MS <= 10_000, 'au-delà, l’écran paraît figé');
});

/* -------- Le serveur : le lancement répond dès que le tour part -------- */

test('startCard n’attend plus la fin du tour pour répondre', () => {
  const scheduler = fs.readFileSync(path.join(SOURCES, 'scheduler.ts'), 'utf8');
  const start = scheduler.split('export async function startCard(')[1].split('\nexport ')[0];
  assert.match(start, /void sendPrompt\(/, 'le tour part sans être attendu');
  assert.doesNotMatch(start, /await sendPrompt\(/);
  // Une panne du lancement lui-même ne doit pas disparaître en silence.
  assert.match(start, /\}\)\.catch\(\(err\) => \{/);
  // Ce qui doit être vrai AVANT la réponse l'est : la carte est déjà en « En cours ».
  assert.ok(
    start.indexOf("column: 'running'") < start.indexOf('void sendPrompt('),
    'la carte passe en « En cours » avant que la commande réponde',
  );
});

/* -------- L'interface : les boutons du bas redeviennent cliquables -------- */

test('le pied de colonne rend la main au bout du plafond', () => {
  const board = fs.readFileSync(BOARD, 'utf8');
  assert.match(board, /PLAFOND_ATTENTE_LOT_MS/);
  assert.match(board, /const rendreLaMain = \(\) => \{/);
  assert.match(board, /window\.setTimeout\(\(\) => \{\s*\n\s*rendreLaMain\(\);/);
});

test('un geste en vol n’éteint que les boutons de SA colonne', () => {
  const board = fs.readFileSync(BOARD, 'utf8');
  assert.doesNotMatch(board, /lotEnCours/, 'plus de drapeau commun à tout le tableau');
  assert.match(board, /colonneQuiTravaille === column/);
});
