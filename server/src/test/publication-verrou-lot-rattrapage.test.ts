import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  carteEnPublication,
  cibleDuPlanDEnvoi,
  commandesDeRattrapage,
  envoiRefuseCarLeDistantAAvance,
  lotDuDeploiementAutomatique,
} from '@beluga/shared';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const lire = (fichier: string) => fs.readFileSync(path.resolve(ICI, '../../src', fichier), 'utf8');

test('une carte du lot en cours de publication est verrouillée, et seulement pendant', () => {
  const lot = { state: 'running', cardIds: ['a', 'b'] };
  assert.equal(carteEnPublication(lot, 'a'), true);
  assert.equal(carteEnPublication(lot, 'c'), false, 'une carte hors du lot reste ouverte');
  for (const fin of ['success', 'failed', 'stopped']) {
    assert.equal(carteEnPublication({ ...lot, state: fin }, 'a'), false, `le verrou tombe sur « ${fin} »`);
  }
  assert.equal(carteEnPublication(null, 'a'), false);
  assert.equal(carteEnPublication(lot, undefined), false, 'un agent sans carte n’est jamais verrouillé');
});

test('le verrou vit côté serveur, épargne le conducteur et les demandes silencieuses', () => {
  const ws = lire('ws.ts');
  const commande = ws.split("case 'agent.prompt': {")[1]!.split('UN MESSAGE SOUS UN RAPPORT RENDU')[0]!;
  assert.match(commande, /agent\.role !== 'deploy'/);
  assert.match(commande, /carteEnPublication\(store\.latestDeploy\(agent\.projectId\), agent\.cardId\)/);
  assert.match(commande, /throw new Error\(TEXTE_CARTE_EN_PUBLICATION\)/);

  const runtime = lire('runtime.ts');
  const envoi = runtime.split('export async function sendPrompt(')[1]!.split('Un agent occupé ?')[0]!;
  /* LE MÊME REFUS POUR LA FILE ET POUR L'ENVOI (04/11/2026) : `refusDUnEnvoiHumain`, jugé AVANT de dépiler un message en
     file — une demande silencieuse et le conducteur de publication passent toujours. */
  assert.match(envoi, /options\.silent \? null : refusDUnEnvoiHumain\(agent\)/);
  const refus = runtime.split('function refusDUnEnvoiHumain(')[1]!.split('\n}\n')[0]!;
  assert.match(refus, /agent\.role !== 'deploy' && carteEnPublication/);
  assert.match(runtime.split('function enchainerLaFile(')[1]!.split('\n}\n')[0]!, /rendreAuChampCeQuiSeraitRefuse\(agentId\);\s*const next = store\.dequeuePrompt/);
});

test('le lot automatique ne part qu’avec les cartes prêtes, jamais avec la colonne entière', () => {
  assert.deepEqual(lotDuDeploiementAutomatique([{ id: 'a' }, { id: 'b' }]), ['a', 'b']);
  assert.equal(lotDuDeploiementAutomatique([]), null, 'aucune carte prête : rien ne part');

  const auto = lire('deploiement-automatique.ts');
  const envoi = auto.split('async function envoyerLeLot(')[1]!.split('\n}\n')[0]!;
  assert.match(envoi, /startDeploy\(project\.id, \{ cible: 'dev', selectedCardIds: lot \}\)/);
  assert.doesNotMatch(envoi, /startDeploy\(project\.id, \{ cible: 'dev' \}\)/);
});

test('un envoi refusé parce que le distant a avancé est reconnu, les autres refus non', () => {
  assert.equal(
    envoiRefuseCarLeDistantAAvance(' ! [rejected]        HEAD -> dev (non-fast-forward)\nerror: failed to push some refs'),
    true,
  );
  assert.equal(envoiRefuseCarLeDistantAAvance(' ! [rejected]        HEAD -> dev (fetch first)'), true);
  assert.equal(envoiRefuseCarLeDistantAAvance('remote: Permission to x/y.git denied to z.\nfatal: unable to access'), false);
  assert.equal(envoiRefuseCarLeDistantAAvance('fatal: Authentication failed'), false);
});

test('le rattrapage fusionne la branche distante visée, sans rebase ni envoi forcé', () => {
  const cible = cibleDuPlanDEnvoi(['push', 'origin', 'HEAD:refs/heads/dev']);
  assert.deepEqual(cible, { distant: 'origin', branche: 'dev' });
  assert.deepEqual(cibleDuPlanDEnvoi(['push', '-u', 'origin', 'HEAD:refs/heads/tache/x']), { distant: 'origin', branche: 'tache/x' });
  assert.equal(cibleDuPlanDEnvoi(['push', 'origin', 'dev']), null);

  const commandes = commandesDeRattrapage(cible!);
  assert.deepEqual(commandes.recuperer, ['fetch', 'origin', '+refs/heads/dev:refs/remotes/origin/dev']);
  assert.deepEqual(commandes.fusionner, ['merge', '--no-edit', 'refs/remotes/origin/dev']);
  assert.deepEqual(commandes.annuler, ['merge', '--abort']);
  const tout = [...commandes.recuperer, ...commandes.fusionner, ...commandes.annuler].join(' ');
  assert.doesNotMatch(tout, /--force|rebase|-f\b/);
});
