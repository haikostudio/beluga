import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountQuota } from '@haikodev/shared';

/**
 * Bascule de compte (PLAN §13). La logique de choix est testée ici sur des
 * données, sans toucher au réseau : ordre déclaré, relève, retour automatique.
 */

function pick(accounts: { id: string; priority: number }[], quotas: AccountQuota[]): string | null {
  const sorted = [...accounts].sort((a, b) => a.priority - b.priority);
  for (const account of sorted) {
    const quota = quotas.find((q) => q.id === account.id);
    if (!quota || quota.available) return account.id;
  }
  return null;
}

const quota = (id: string, available: boolean, resetsAt?: number): AccountQuota =>
  AccountQuota.parse({
    id,
    engine: 'claude',
    label: id,
    priority: 10,
    active: false,
    available,
    weekly: resetsAt ? { usedPct: available ? 40 : 100, resetsAt } : undefined,
  });

const accounts = [
  { id: 'max20', priority: 10 },
  { id: 'pro', priority: 50 },
];

test('le compte prioritaire passe toujours en premier', () => {
  assert.equal(pick(accounts, [quota('max20', true), quota('pro', true)]), 'max20');
});

test('le compte de relève ne sert que si le prioritaire est épuisé', () => {
  assert.equal(pick(accounts, [quota('max20', false), quota('pro', true)]), 'pro');
});

test('les deux à sec : la carte attend, elle n\'échoue pas', () => {
  assert.equal(pick(accounts, [quota('max20', false), quota('pro', false)]), null);
});

test('retour automatique au prioritaire une fois la remise à zéro passée', () => {
  const passe = Date.now() - 60_000;
  assert.equal(pick(accounts, [quota('max20', true, passe), quota('pro', true)]), 'max20');
});

test("l'ordre est une donnée déclarée, pas une devinette", () => {
  const inverse = [
    { id: 'pro', priority: 5 },
    { id: 'max20', priority: 90 },
  ];
  assert.equal(pick(inverse, [quota('max20', true), quota('pro', true)]), 'pro');
});
