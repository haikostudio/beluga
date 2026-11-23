import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DEPANNAGES_AUTOMATIQUES,
  depannageAutomatiquePermis,
  fluxMele,
  miseEnLigneActive,
  miseEnLigneAfficheeActive,
  misesEnLigneApres,
  repriseApresLeTour,
} from '@beluga/shared';

/*
 * UNE MISE EN LIGNE QUI ÉCHOUE RESTE À GAUCHE, EN COURS, ET SE RÉPARE (décision de l'utilisateur, 17/11/2026) :
 * la ligne tombée reste active, un dépanneur s'ouvre seul (deux fois au plus), la MÊME publication reprend.
 */

const run = (id: string, state: string, extra: Record<string, unknown> = {}) => ({ id, projectId: 'p', state, cible: 'dev' as const, startedAt: 1000, ...extra });

test('une publication tombée reste active ; arrêtée ou rangée, non ; le filet de relecture ne suit que celles qui tournent', () => {
  assert.equal(miseEnLigneAfficheeActive(run('a', 'running')), true);
  assert.equal(miseEnLigneAfficheeActive(run('a', 'failed')), true);
  assert.equal(miseEnLigneAfficheeActive(run('a', 'failed', { masquee: true })), false);
  assert.equal(miseEnLigneAfficheeActive(run('a', 'stopped')), false);
  assert.equal(miseEnLigneAfficheeActive(run('a', 'success')), false);
  assert.equal(miseEnLigneActive(run('a', 'failed')), false, 'la relecture des 15 s ne tourne pas pour une tombée');
});

test('dans le flux, une tombée garde sa place même au-delà du paquet ; dépassée par une plus récente, elle part', () => {
  const tombee = run('t', 'failed', { startedAt: 10, endedAt: 20 });
  const lignes = Array.from({ length: 4 }, (_, i) => ({ carte: { id: `c${i}`, updatedAt: 100 + i } }));
  const flux = fluxMele(lignes, new Set(lignes.map((l) => l.carte.id)), [tombee], 2, () => false);
  assert.ok(flux.some((e) => e.id === 't'), 'la tombée reste, au-delà des deux premières entrées');
  const suivante = run('s', 'success', { startedAt: 30, endedAt: 40 });
  const apres = fluxMele(lignes, new Set(lignes.map((l) => l.carte.id)), [tombee, suivante], 10, () => false);
  assert.ok(!apres.some((e) => e.id === 't'), 'une plus récente de la même étape l’efface');
});

test('la reprise rallume la MÊME ligne ; un vieil événement « en cours » ne le peut pas', () => {
  const finie = run('a', 'failed', { endedAt: 5000 });
  const liste = [finie];
  assert.equal(misesEnLigneApres(liste, run('a', 'running')), liste, 'un événement en retard reste ignoré');
  const reprise = run('a', 'running', { reprisA: 6000 });
  const suite = misesEnLigneApres(liste, reprise);
  assert.equal(suite.length, 1);
  assert.equal(suite[0].state, 'running');
  // La chute d'AVANT la reprise, arrivée en retard, ne repasse pas la ligne en rouge.
  assert.equal(misesEnLigneApres(suite, run('a', 'failed', { endedAt: 5000 }))[0].state, 'running');
  assert.equal(misesEnLigneApres(suite, run('a', 'failed', { endedAt: 7000 }))[0].state, 'failed');
});

test('deux dépannages automatiques au plus par publication', () => {
  assert.equal(MAX_DEPANNAGES_AUTOMATIQUES, 2);
  assert.equal(depannageAutomatiquePermis({ state: 'failed', depannagesAuto: 0 }), true);
  assert.equal(depannageAutomatiquePermis({ state: 'failed', depannagesAuto: 1 }), true);
  assert.equal(depannageAutomatiquePermis({ state: 'failed', depannagesAuto: 2 }), false);
  assert.equal(depannageAutomatiquePermis({ state: 'stopped', depannagesAuto: 0 }), false);
});

test('à la fin du tour du dépanneur : reprendre, sauf question en attente, file sans quota ou publication dépassée', () => {
  const repos = { status: 'idle' };
  assert.equal(repriseApresLeTour({ agent: repos, aDesDemandesEnFile: false, aDepanner: true }), 'reprendre');
  assert.equal(repriseApresLeTour({ agent: { status: 'running' }, aDesDemandesEnFile: false, aDepanner: true }), 'attendre');
  assert.equal(repriseApresLeTour({ agent: { status: 'idle', tourVivantDepuis: 1 }, aDesDemandesEnFile: false, aDepanner: true }), 'attendre');
  assert.equal(repriseApresLeTour({ agent: { status: 'idle', attendReponse: true }, aDesDemandesEnFile: false, aDepanner: true }), 'attendre', 'rien ne repart avant la réponse');
  assert.equal(repriseApresLeTour({ agent: repos, aDesDemandesEnFile: true, aDepanner: true }), 'abandonner', 'sans quota, il n’a rien réparé');
  assert.equal(repriseApresLeTour({ agent: repos, aDesDemandesEnFile: false, aDepanner: false }), 'abandonner');
  assert.equal(repriseApresLeTour({ agent: null, aDesDemandesEnFile: false, aDepanner: true }), 'abandonner');
});
