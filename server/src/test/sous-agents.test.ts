/**
 * LES SOUS-AGENTS — les règles pures (`shared/src/sous-agents.ts`).
 *
 * Ce que ces essais verrouillent : la racine se trouve en remontant les parents connus (une boucle ne fige rien) ;
 * la famille se lit à plat dans l'ordre des onglets — la racine, puis chaque sous-agent suivi des siens ; la branche
 * est REPLIÉE par défaut et DÉPLIÉE quand on est dans l'agent ou l'un de ses descendants, un geste sur le chevron
 * l'emporte ; « En cours » ne montre qu'une fois chaque racine, jamais un sous-agent en ligne autonome.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { aDesSousAgents, brancheDepliee, enfantsParParent, familleAPlat, racineDeLaFamille, racinesEnCours } from '@beluga/shared';

const general = { id: 'g', title: 'Votre directeur général', createdAt: 1 };
const marqueA = { id: 'ma', parentAgentId: 'g', title: 'Chef de la marque A', createdAt: 2 };
const marqueB = { id: 'mb', parentAgentId: 'g', title: 'Chef de la marque B', createdAt: 3 };
const projetA = { id: 'pa', parentAgentId: 'ma', title: 'Chef du projet A', createdAt: 4 };
const seul = { id: 's', title: 'Agent seul', createdAt: 5 };
const tous = [projetA, marqueB, seul, marqueA, general];

test('la racine se trouve en remontant les parents connus', () => {
  assert.equal(racineDeLaFamille('pa', tous), 'g');
  assert.equal(racineDeLaFamille('g', tous), 'g');
  assert.equal(racineDeLaFamille('s', tous), 's');
  /* Un parent absent des agents chargés : l'agent est racine de ce qu'on sait. */
  assert.equal(racineDeLaFamille('pa', [projetA]), 'pa');
  /* Une boucle ne fige rien. */
  assert.equal(typeof racineDeLaFamille('x', [{ id: 'x', parentAgentId: 'y' }, { id: 'y', parentAgentId: 'x' }]), 'string');
});

test('la famille à plat suit l’ordre des onglets : la racine, puis chaque sous-agent suivi des siens', () => {
  const famille = familleAPlat('g', tous);
  assert.deepEqual(
    famille.map((m) => [m.agent.id, m.profondeur]),
    [
      ['g', 0],
      ['ma', 1],
      ['pa', 2],
      ['mb', 1],
    ],
  );
  assert.deepEqual(familleAPlat('absent', tous), []);
  assert.deepEqual(familleAPlat('s', tous).map((m) => m.agent.id), ['s']);
});

test('les enfants se rangent par date de naissance', () => {
  assert.deepEqual(enfantsParParent(tous).get('g')?.map((a) => a.id), ['ma', 'mb']);
  assert.equal(aDesSousAgents('g', tous), true);
  assert.equal(aDesSousAgents('mb', tous), false);
});

test('la branche est repliée par défaut, dépliée quand on est dedans, et le geste l’emporte', () => {
  assert.equal(brancheDepliee('g', null, tous), false);
  assert.equal(brancheDepliee('g', 's', tous), false);
  assert.equal(brancheDepliee('g', 'g', tous), true);
  assert.equal(brancheDepliee('g', 'mb', tous), true);
  assert.equal(brancheDepliee('g', 'pa', tous), true);
  assert.equal(brancheDepliee('ma', 'pa', tous), true);
  assert.equal(brancheDepliee('mb', 'pa', tous), false);
  assert.equal(brancheDepliee('g', 'pa', tous, false), false);
  assert.equal(brancheDepliee('g', null, tous, true), true);
});

test('« En cours » ne montre qu’une fois chaque racine, jamais un sous-agent seul', () => {
  assert.deepEqual(racinesEnCours([projetA, marqueB, seul], tous), ['g', 's']);
});

test('la conversation d’un sous-agent a son adresse, lue et réécrite à l’identique', async () => {
  const { adresseDuFilDeLAgent, lireFragment, construireFragment } = await import('@beluga/shared');
  const adresse = adresseDuFilDeLAgent({ id: 'pa', projectId: 'p1' });
  assert.equal(adresse, 'projet/p1/agents/fil/pa');
  const ecran = lireFragment(`#${adresse}`);
  assert.deepEqual(ecran, { vue: 'projet', projectId: 'p1', agents: true, agentId: 'pa' });
  assert.equal(construireFragment(ecran), adresse);
});

test('un chef mène à sa conversation, un agent de campagne garde sa page', async () => {
  const { adresseDeLAgentDeService, estChefDeLArbre } = await import('@beluga/shared');
  const chef = { id: 'c', projectId: 'p', service: { id: 'communication', adresse: 'communication/m1' } };
  const campagne = { id: 'k', projectId: 'p', service: { id: 'communication', adresse: 'communication/m1/campagnes/x' } };
  const studio = { id: 's', projectId: 'p', service: { id: 'studio', adresse: 'studio/abc' } };
  assert.equal(adresseDeLAgentDeService(chef), 'projet/p/agents/fil/c');
  assert.equal(adresseDeLAgentDeService(campagne), 'communication/m1/campagnes/x');
  assert.equal(adresseDeLAgentDeService(studio), 'studio/abc');
  assert.equal(adresseDeLAgentDeService({ id: 'n', projectId: 'p' }), null);
  assert.equal(estChefDeLArbre(chef), true);
  assert.equal(estChefDeLArbre(campagne), false);
});
