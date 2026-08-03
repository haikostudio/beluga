import test from 'node:test';
import assert from 'node:assert/strict';
import { manqueDeDroits, motifSystemctl, portDansUnite } from '../deploy.js';

/* ------------------------------------------------------------------ */
/* L'étape « Redémarrage du serveur » doit dire POURQUOI elle échoue   */
/* ------------------------------------------------------------------ */

/** Ce que systemctl répond vraiment quand le démon n'est pas administrateur. */
const REFUS = [
  'Failed to restart autoproject-haikonote.service: Interactive authentication required.',
  "See system logs and 'systemctl status autoproject-haikonote.service' for details.",
].join('\n');

test('un refus de droits est reconnu comme tel', () => {
  assert.equal(manqueDeDroits(REFUS), true);
  assert.equal(manqueDeDroits('inactive'), false);
  assert.equal(manqueDeDroits('Job for x.service failed'), false);
});

test('le motif est écrit en clair, jamais une ligne rouge muette', () => {
  assert.match(motifSystemctl(REFUS), /droits d’administration refusés/);
  assert.match(motifSystemctl('Job for x.service failed'), /Job for x.service failed/);
  assert.match(motifSystemctl('   '), /raison non précisée/);
});

/** Unité relevée sur le serveur le 03/08/2026. */
const UNITE = [
  '[Service]',
  'Type=simple',
  'Environment=HOST=127.0.0.1',
  'Environment=PORT=15011',
].join('\n');

test('le port du service est lu dans son unité, pour interroger sa santé', () => {
  assert.equal(portDansUnite(UNITE), 15011);
  assert.equal(portDansUnite('[Service]\nType=simple'), null);
});
