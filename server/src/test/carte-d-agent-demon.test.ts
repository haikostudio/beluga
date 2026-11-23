import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Card } from '@beluga/shared';

/*
 * LA CARTE DU RENDEZ-VOUS DE NUIT PART DIRECTEMENT EN ARCHIVE.
 *
 * `rangerCarteDAgent` sert aux cartes que le démon lance lui-même (rendez-vous
 * d'auto-amélioration compris) : elle n'ont ni branche ni copie de travail, et
 * la publication les ignore de toute façon. Le rendez-vous de nuit, une fois
 * tenu, ne doit plus encombrer « À déployer » : sa carte va droit en
 * « Archivé ». Sans complément, elle y arriverait sans date de fin — le tiroir
 * des archives montrerait un travail sans jamais dire quand il s'est terminé.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'carte-d-agent-demon-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { rangerCarteDAgent } = await import('../carte-d-agent-demon.js');

function carteEnCours(agentId: string) {
  return store.saveCard(
    Card.parse({
      id: store.newId(),
      projectId: 'projet-essai',
      title: 'Rendez-vous du 21 septembre',
      column: 'running',
      position: 1,
      agentId,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

test('le rendez-vous rangé en « archived » reçoit une date de fin et une photo de session', () => {
  const agentId = store.newId();
  const carte = carteEnCours(agentId);
  const rangee = rangerCarteDAgent(carte.id, agentId, 'archived', 'Rendez-vous tenu.');
  assert.ok(rangee);
  assert.equal(rangee!.column, 'archived');
  assert.ok(rangee!.doneAt, 'la carte archivée porte une date de fin');
  assert.equal(rangee!.llmSessionMetrics?.state, 'unavailable');
});

test('rangée en « to_deploy », une carte garde le comportement d’avant (pas de photo forcée)', () => {
  const agentId = store.newId();
  const carte = carteEnCours(agentId);
  const rangee = rangerCarteDAgent(carte.id, agentId, 'to_deploy', null);
  assert.ok(rangee);
  assert.equal(rangee!.column, 'to_deploy');
  assert.equal(rangee!.llmSessionMetrics?.state, 'unavailable');
});
