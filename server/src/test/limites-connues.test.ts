import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountQuota, LIMITE_SANS_ECHEANCE_MS } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* LA MÉMOIRE DES LIMITES CONNUES, PAR COMPTE, PERSISTÉE               */
/*                                                                     */
/* Un tour tombé sur une limite l'écrit ; le choix du tour suivant     */
/* l'écarte tant qu'elle court ; un relevé frais qui montre la fenêtre */
/* remise à zéro la lève. Tout passe par la base (clé `meta`), donc un  */
/* redémarrage du démon n'oublie rien.                                 */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'limites-connues-'));
process.env.BELUGA_DATA = bacASable;

const limites = await import('../limites-connues.js');
const { getMeta } = await import('../db.js');

const NOW = Date.parse('2026-09-06T14:00:00+02:00');
const DEMAIN = Date.parse('2026-09-07T15:00:00+02:00');

const releve = (id: string, patch: Partial<AccountQuota> = {}): AccountQuota =>
  AccountQuota.parse({ id, engine: 'claude', label: id, active: false, available: true, fetchedAt: NOW, ...patch });

test('une limite notée est écrite en base, et écarte son compte tant qu’elle court', () => {
  limites.noterLimiteConnue({ compte: 'claude-pro', motif: 'texte-de-limite', resetsAt: DEMAIN, now: NOW });
  assert.ok(getMeta('limites-connues')?.includes('claude-pro'), 'persistée : un redémarrage la retrouve');
  assert.deepEqual([...limites.comptesEcartesParLimite(NOW + 60_000)], ['claude-pro']);
  assert.equal(limites.limitesConnues(NOW).find((l) => l.compte === 'claude-pro')?.resetsAt, DEMAIN);
  assert.deepEqual([...limites.comptesEcartesParLimite(DEMAIN + 1)], [], 'échue, elle n’écarte plus rien');
});

test('une limite renotée REMPLACE la précédente, jamais deux lignes pour un compte', () => {
  limites.noterLimiteConnue({ compte: 'claude-pro', motif: 'limite-structuree', now: NOW + 1000 });
  const toutes = limites.limitesConnues(NOW + 2000).filter((l) => l.compte === 'claude-pro');
  assert.equal(toutes.length, 1);
  assert.equal(toutes[0].motif, 'limite-structuree');
});

test('un relevé frais lève la limite quand une fenêtre a COMMENCÉ depuis qu’elle a été notée', () => {
  const H = 3_600_000;
  limites.noterLimiteConnue({ compte: 'claude-pro', motif: 'texte-de-limite', now: NOW });
  // La fenêtre en cours a commencé AVANT la limite (remise à zéro dans 3 h, durée 5 h) : rien ne prouve qu'elle a tourné.
  assert.deepEqual(
    limites.effacerLesLimitesLevees([releve('claude-pro', { session: { usedPct: 40, resetsAt: NOW + 3 * H, durationSeconds: 5 * 3600 } })], NOW + H),
    [],
  );
  // Une fenêtre sans durée annoncée ne dit pas quand elle a commencé.
  assert.deepEqual(limites.effacerLesLimitesLevees([releve('claude-pro', { session: { usedPct: 4, resetsAt: NOW + 7 * H } })], NOW + 2 * H), []);
  // Deux heures plus tard, le relevé annonce une fenêtre commencée à NOW + 2 h : la limite est levée.
  assert.deepEqual(
    limites.effacerLesLimitesLevees([releve('claude-pro', { session: { usedPct: 3, resetsAt: NOW + 7 * H, durationSeconds: 5 * 3600 } })], NOW + 2 * H + 1),
    ['claude-pro'],
  );
  assert.equal(limites.limitesConnues(NOW + 2 * H + 2).find((l) => l.compte === 'claude-pro'), undefined);
});

test('un relevé en erreur, à sec, ou d’un autre compte ne lève rien', () => {
  limites.noterLimiteConnue({ compte: 'claude-pro', motif: 'texte-de-limite', now: NOW });
  const plusTard = NOW + LIMITE_SANS_ECHEANCE_MS - 1;
  const fenetreSuivante = { usedPct: 10, resetsAt: NOW + 2 * LIMITE_SANS_ECHEANCE_MS, durationSeconds: 5 * 3600 };
  assert.deepEqual(limites.effacerLesLimitesLevees([releve('claude-pro', { error: 'lecture impossible', session: fenetreSuivante })], plusTard), []);
  assert.deepEqual(limites.effacerLesLimitesLevees([releve('claude-pro', { available: false, session: fenetreSuivante })], plusTard), []);
  assert.deepEqual(limites.effacerLesLimitesLevees([releve('claude-pro', { session: { ...fenetreSuivante, usedPct: 100 } })], plusTard), []);
  assert.deepEqual(limites.effacerLesLimitesLevees([releve('claude-max20', { session: fenetreSuivante })], plusTard), []);
  assert.ok(limites.limitesConnues(plusTard).find((l) => l.compte === 'claude-pro'), 'toujours là');
});

test('les relevés diffusés portent la limite connue, et le bloc de reprise ne propose plus ce compte', async () => {
  const { cachedQuotas } = await import('../accounts.js');
  const { comptesConnus } = await import('../reprise-compte.js');
  limites.noterLimiteConnue({ compte: 'claude-pro', motif: 'texte-de-limite', resetsAt: DEMAIN, now: Date.now() });
  // Aucun compte réel dans ce bac à sable : on regarde la forme, pas la liste.
  for (const quota of cachedQuotas()) assert.equal(quota.limiteConnue, undefined);
  for (const compte of comptesConnus()) assert.notEqual(compte.id, 'claude-pro');
});
