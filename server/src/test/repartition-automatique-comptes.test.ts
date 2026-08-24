import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  CompteConnu,
  compteDeRepriseAutomatique,
  compteQuiRecoitLeTravail,
} from '@haikodev/shared';

const pro = {
  id: 'claude-pro',
  plan: 'Pro',
  priority: 50,
  sessionPct: 72,
  weeklyPct: 40,
};

const max20 = {
  id: 'claude-max20',
  plan: 'Max x20',
  priority: 10,
  sessionPct: 5,
  weeklyPct: 15,
};

test('le quota disponible du compte Pro sert avant la grande réserve Max x20', () => {
  assert.equal(compteQuiRecoitLeTravail([max20, pro])?.id, 'claude-pro');
});

test('Max x20 prend la relève quand le compte Pro est à sec', () => {
  assert.equal(compteQuiRecoitLeTravail([max20, { ...pro, sessionPct: 100 }])?.id, 'claude-max20');
});

test('une reprise automatique exige une relève disponible du même moteur', () => {
  const comptes: CompteConnu[] = [
    {
      ...pro,
      label: 'Claude Pro',
      engine: 'claude',
      disponible: false,
      releveFiable: true,
      consommePct: 100,
    },
    {
      ...max20,
      label: 'Claude Max x20',
      engine: 'claude',
      disponible: true,
      releveFiable: true,
      consommePct: 15,
    },
    {
      id: 'codex-max20',
      label: 'Codex Max x20',
      engine: 'codex',
      plan: 'Max x20',
      disponible: true,
      releveFiable: true,
    },
  ];

  assert.equal(compteDeRepriseAutomatique('claude', 'claude-pro', comptes)?.id, 'claude-max20');
  assert.equal(
    compteDeRepriseAutomatique('claude', 'claude-pro', comptes.map((compte) => ({ ...compte, disponible: false }))),
    undefined,
  );
  assert.equal(
    compteDeRepriseAutomatique('claude', 'claude-pro', comptes.map((compte) => ({ ...compte, releveFiable: false }))),
    undefined,
  );
});

test('la relève ne part qu’après la fermeture du tour courant', () => {
  const runtime = fs.readFileSync(new URL('../runtime.js', import.meta.url), 'utf8');
  const fermeture = runtime.indexOf('retirerLeTourVivant(agent.id)');
  const reprise = runtime.indexOf('await reprendreAutomatiquement(runState.messageId)', fermeture);
  const filetManuel = runtime.indexOf('poserDecisionDeReprise({', reprise);

  assert.ok(fermeture >= 0 && reprise > fermeture, 'le tour courant doit être retiré avant la relève');
  assert.ok(filetManuel > reprise, 'le choix manuel reste le filet quand aucune relève automatique ne part');
});
