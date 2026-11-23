import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARTES_PAR_TRANCHE,
  FRAICHEUR_AGENT_MS,
  agentPourLEcran,
  agentsUtilesAuTableau,
  positionDeReprise,
  premiereTranche,
  resteSurLeServeur,
  totauxApresChangement,
} from '@beluga/shared';

const MAINTENANT = 1_700_000_000_000;
const carte = (id: string, column: string, position: number) => ({ id, column, position });

test('la première tranche garde un paquet par colonne, et compte le total réel', () => {
  const cartes = [
    ...Array.from({ length: 50 }, (_, i) => carte(`a-${i}`, 'archived', 1000 - i)),
    carte('p-1', 'planned', 5),
    carte('r-1', 'running', 4),
  ];
  const { cartes: gardees, totaux } = premiereTranche(cartes);
  assert.equal(gardees.filter((c) => c.column === 'archived').length, CARTES_PAR_TRANCHE);
  assert.deepEqual(totaux, { archived: 50, planned: 1, running: 1 });
  // L'ordre reçu est gardé : les vingt premières, jamais reclassées.
  assert.equal(gardees[0].id, 'a-0');
  assert.equal(gardees[CARTES_PAR_TRANCHE - 1].id, `a-${CARTES_PAR_TRANCHE - 1}`);
  assert.ok(gardees.some((c) => c.id === 'p-1') && gardees.some((c) => c.id === 'r-1'));
});

test('aucune carte : aucune tranche, aucun total', () => {
  assert.deepEqual(premiereTranche([]), { cartes: [], totaux: {} });
});

test('les agents utiles : au travail, sur une carte envoyée, ou tout juste finis', () => {
  const vieux = MAINTENANT - 30 * 24 * 3600_000;
  const agents = [
    { id: 'travaille', status: 'running', endedAt: undefined },
    { id: 'demarre', status: 'starting' },
    { id: 'porte-une-carte', cardId: 'c-1', status: 'done', endedAt: vieux },
    { id: 'carte-absente', cardId: 'c-99', status: 'done', endedAt: vieux },
    { id: 'frais', status: 'done', endedAt: MAINTENANT - 10_000 },
    { id: 'sans-fin-mais-frais', status: 'stopped', updatedAt: MAINTENANT - 10_000 },
    { id: 'vieux-sans-carte', status: 'done', endedAt: vieux },
    { id: 'juste-trop-vieux', status: 'done', endedAt: MAINTENANT - FRAICHEUR_AGENT_MS },
  ];
  assert.deepEqual(
    agentsUtilesAuTableau(agents, new Set(['c-1']), MAINTENANT).map((a) => a.id),
    ['travaille', 'demarre', 'porte-une-carte', 'frais', 'sans-fin-mais-frais'],
  );
});

test('le résumé de continuité ne part pas vers l’écran, le reste du contexte oui', () => {
  const agent = {
    id: 'a',
    context: { tokens: 10, window: 100, ratio: 0.1, compressionCount: 2, continuitySummary: 'x'.repeat(5000) },
  };
  const allege = agentPourLEcran(agent);
  assert.deepEqual(allege.context, { tokens: 10, window: 100, ratio: 0.1, compressionCount: 2 });
  // L'objet reçu n'est pas modifié : le démon garde son résumé.
  assert.equal(agent.context.continuitySummary.length, 5000);
  const sansContexte = { id: 'b', context: undefined };
  assert.equal(agentPourLEcran(sansContexte), sansContexte);
});

test('les totaux suivent une carte qui change de colonne, naît ou disparaît', () => {
  const depart = { planned: 3, archived: 800 };
  assert.deepEqual(totauxApresChangement(depart, 'planned', 'running'), { planned: 2, archived: 800, running: 1 });
  assert.deepEqual(totauxApresChangement(depart, undefined, 'planned'), { planned: 4, archived: 800 });
  assert.deepEqual(totauxApresChangement(depart, 'archived', undefined), { planned: 3, archived: 799 });
  // Même colonne : rien ne bouge, et c'est le même objet.
  assert.equal(totauxApresChangement(depart, 'planned', 'planned'), depart);
  // Jamais en dessous de zéro.
  assert.deepEqual(totauxApresChangement({}, 'done', undefined), { done: 0 });
});

test('la tranche suivante reprend sous la carte la plus basse reçue', () => {
  assert.equal(positionDeReprise([]), undefined);
  assert.equal(positionDeReprise([{ position: 30 }, { position: 10 }, { position: 20 }]), 10);
});

test('il reste des cartes sur le démon tant que le total dépasse ce qui est reçu', () => {
  assert.equal(resteSurLeServeur(20, 75), true);
  assert.equal(resteSurLeServeur(75, 75), false);
  assert.equal(resteSurLeServeur(0, undefined), false);
});
