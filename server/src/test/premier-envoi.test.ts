import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAICHEUR_AGENT_MS,
  agentUtileAuLancement,
  agentsDuPremierEnvoi,
  decisionsDuPremierEnvoi,
} from '@haikodev/shared';

const MAINTENANT = 1_700_000_000_000;
const ilYA = (ms: number) => MAINTENANT - ms;

const agent = (patch: Partial<Parameters<typeof agentUtileAuLancement>[0]> = {}) => ({
  projectId: 'autre',
  status: 'done',
  endedAt: ilYA(365 * 24 * 3600_000),
  ...patch,
});

test('un agent qui travaille part toujours, quel que soit son projet', () => {
  assert.equal(agentUtileAuLancement(agent({ status: 'running' }), 'ouvert', MAINTENANT), true);
  // « starting » compte comme actif, ici comme partout ailleurs.
  assert.equal(agentUtileAuLancement(agent({ status: 'starting' }), 'ouvert', MAINTENANT), true);
});

test('un agent du projet qu’on ouvre part, même terminé depuis longtemps', () => {
  assert.equal(agentUtileAuLancement(agent({ projectId: 'ouvert' }), 'ouvert', MAINTENANT), true);
});

test('un agent terminé récemment part : la pile de la colonne de gauche le montre encore', () => {
  assert.equal(agentUtileAuLancement(agent({ endedAt: ilYA(30_000) }), 'ouvert', MAINTENANT), true);
});

test('un agent d’un autre projet, terminé il y a longtemps, ne part pas', () => {
  assert.equal(agentUtileAuLancement(agent(), 'ouvert', MAINTENANT), false);
});

test('sans date de fin, on se rabat sur la dernière mise à jour', () => {
  const sansFin = { projectId: 'autre', status: 'stopped', updatedAt: ilYA(60_000) };
  assert.equal(agentUtileAuLancement(sansFin, 'ouvert', MAINTENANT), true);
  const vieux = { projectId: 'autre', status: 'stopped', updatedAt: ilYA(FRAICHEUR_AGENT_MS + 1) };
  assert.equal(agentUtileAuLancement(vieux, 'ouvert', MAINTENANT), false);
});

test('aucun projet ouvert : seuls les agents vivants ou frais partent', () => {
  const liste = [
    agent({ projectId: 'a', status: 'running' }),
    agent({ projectId: 'b' }),
    agent({ projectId: 'c', endedAt: ilYA(1000) }),
  ];
  assert.deepEqual(
    agentsDuPremierEnvoi(liste, null, MAINTENANT).map((a) => a.projectId),
    ['a', 'c'],
  );
});

test('l’ordre reçu est gardé : la liste est filtrée, jamais reclassée', () => {
  const liste = [
    agent({ projectId: 'z', status: 'running' }),
    agent({ projectId: 'a', status: 'running' }),
  ];
  assert.deepEqual(
    agentsDuPremierEnvoi(liste, null, MAINTENANT).map((a) => a.projectId),
    ['z', 'a'],
  );
});

test('seules les décisions encore ouvertes partent sur le fil', () => {
  const decisions = [
    { projectId: 'a', genre: 'question' as const, reglee: true, poseeA: 2 },
    { projectId: 'a', genre: 'question' as const, reglee: false, poseeA: 1 },
    { projectId: 'b', genre: 'validation' as const, poseeA: 3 },
  ];
  const envoyees = decisionsDuPremierEnvoi(decisions);
  assert.equal(envoyees.length, 2);
  // La plus ancienne en premier : l'ordre d'affichage de la cloche.
  assert.deepEqual(envoyees.map((d) => d.poseeA), [1, 3]);
});
