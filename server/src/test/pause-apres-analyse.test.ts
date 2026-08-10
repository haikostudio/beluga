import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  colonneAuDemarrage,
  colonneEnFinDeTour,
  demarrageAutomatiqueAutorise,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* PAUSE AVANT LE LANCEMENT : rien ne part sans un geste               */
/*                                                                     */
/* Le chiffrage et l'exécution tiennent dans un même tour, celui de    */
/* l'agent lancé sur la carte. La carte validée attend donc en         */
/* « Planifié » — sans rien coûter — et ne bascule en « En cours »     */
/* que sur un geste : clic, dépôt, ou « Tout lancer ».                 */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.resolve(ICI, '../../src');

function lire(fichier: string): string {
  return fs.readFileSync(path.join(SOURCES, fichier), 'utf8');
}

/* -------- La règle pure : qui l'ordonnanceur démarre de lui-même -------- */

test('une carte validée (jamais lancée) ne part pas toute seule', () => {
  // Sortie de la validation : promue en « Planifié », mais attempts = 0, pas asap.
  assert.equal(demarrageAutomatiqueAutorise({ asap: false, attempts: 0, restarts: 0 }), false);
  // Un scheduling absent est traité comme « pas encore autorisé ».
  assert.equal(demarrageAutomatiqueAutorise(undefined), false);
});

test('« Dès que possible » EST le geste de lancement : la carte peut partir', () => {
  assert.equal(demarrageAutomatiqueAutorise({ asap: true, attempts: 0, restarts: 0 }), true);
});

test('une carte déjà lancée puis interrompue se reprend sans nouveau clic', () => {
  // Un tour coupé (attempts) ou une reprise après redémarrage (restarts).
  assert.equal(demarrageAutomatiqueAutorise({ asap: false, attempts: 1, restarts: 0 }), true);
  assert.equal(demarrageAutomatiqueAutorise({ asap: false, attempts: 0, restarts: 1 }), true);
});

/* -------- Seule l'exécution déplace la carte -------- */

test("seul l'agent d'EXÉCUTION fait basculer la carte en « En cours »", () => {
  assert.equal(colonneAuDemarrage('planned', 'task'), 'running');
  // Les autres rôles la regardent sans y toucher, où qu'elle soit.
  for (const role of ['analysis', 'orchestrator', 'deploy'] as const) {
    assert.equal(colonneAuDemarrage('planned', role), null, `depuis « ${role} »`);
    assert.equal(colonneEnFinDeTour('running', true, role, true), null, `fin de tour « ${role} »`);
  }
});

/* -------- Verrous de code : la garde ne peut pas être contournée -------- */

test("l'ordonnanceur gate son démarrage sur la règle de pause", () => {
  const scheduler = lire('scheduler.ts');
  // La boucle de démarrage saute toute carte non autorisée.
  assert.match(scheduler, /if \(!demarrageAutomatiqueAutorise\(card\.scheduling\)\) continue;/);
});

test('valider promeut la carte en « Planifié », jamais en « En cours »', () => {
  const scheduler = lire('scheduler.ts');
  const corps = scheduler.split('export function validerCarte(')[1].split('\nexport ')[0];
  assert.doesNotMatch(corps, /column: 'running'/);
  assert.match(corps, /column: 'planned'/);
  // Et la carte porte la raison de son attente tant que rien ne l'autorise.
  assert.match(corps, /RAISON_ATTENTE_LANCEMENT/);
});

test('une carte qui dort en « Planifié » ne coûte rien : aucun tour ne part', () => {
  const scheduler = lire('scheduler.ts');
  // Le seul envoi au moteur de l'ordonnanceur est celui du lancement.
  const envois = [...scheduler.matchAll(/await sendPrompt\(/g)];
  assert.equal(envois.length, 1, 'un seul envoi au moteur dans l’ordonnanceur : le lancement');
  const start = scheduler.split('export async function startCard(')[1].split('\nexport ')[0];
  assert.match(start, /await sendPrompt\(/, 'et il est bien dans startCard');
});
