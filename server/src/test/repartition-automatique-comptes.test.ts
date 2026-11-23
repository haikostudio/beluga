import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  CompteConnu,
  classerComptesPourLeTravail,
  compteDeRepriseAutomatique,
  compteQuiRecoitLeTravail,
} from '@beluga/shared';

/*
 * ENTRE COMPTES SEMBLABLES, ON FINIT LA FENÊTRE ENTAMÉE (27/10/2026).
 *
 * « premier » et « second » portent le MÊME plan (Max x5) : c'est le cas des
 * deux comptes Claude du serveur. L'ancienne règle les départageait par la
 * place restante (le travail alternait), puis par le rang (le n° 1 remis à
 * zéro reprenait la main et la fenêtre entamée du n° 2 se perdait). Le
 * travail va désormais à la fenêtre qui se remet à zéro le plus tôt.
 */
const premier = {
  id: 'claude-premier',
  plan: 'Max x5',
  priority: 10,
  sessionPct: 72,
  weeklyPct: 40,
};

const second = {
  id: 'claude-second',
  plan: 'Max x5',
  priority: 20,
  sessionPct: 5,
  weeklyPct: 15,
};

/* L'instant de référence des essais : les fins de fenêtre se comptent depuis lui. */
const T0 = Date.UTC(2026, 9, 27, 12, 0, 0);
const HEURE = 3_600_000;

test('deux comptes semblables : celui dont la fenêtre finit le plus tôt sert d’abord', () => {
  const a = { ...premier, sessionFinit: T0 + 3 * HEURE };
  const b = { ...second, sessionFinit: T0 + 1 * HEURE };
  assert.equal(compteQuiRecoitLeTravail([a, b], T0)?.id, 'claude-second');
});

test('le second compte prend la relève quand le premier est à sec', () => {
  assert.equal(compteQuiRecoitLeTravail([second, { ...premier, sessionPct: 100 }], T0)?.id, 'claude-second');
});

test('le n° 1 revenu à zéro ne reprend PAS la main tant que le n° 2 a une fenêtre entamée', () => {
  /* La demande du 27/10/2026 : le secondaire à 80 % finit sa fenêtre, le
     principal remis à zéro (et réengagé) attend son tour. */
  const principalRemisAZero = { ...premier, sessionPct: 0, sessionFinit: T0 + 5 * HEURE };
  const secondaireEntame = { ...second, sessionPct: 80, sessionFinit: T0 + 2 * HEURE };
  assert.equal(compteQuiRecoitLeTravail([principalRemisAZero, secondaireEntame], T0)?.id, 'claude-second');
  /* Le secondaire à sa limite : le principal reprend. */
  assert.equal(compteQuiRecoitLeTravail([principalRemisAZero, { ...secondaireEntame, sessionPct: 100 }], T0)?.id, 'claude-premier');
});

test('sans fin de fenêtre connue, la plus consommée sert d’abord ; l’ordre réglé départage le reste', () => {
  const a = { id: 'a', plan: 'Max x5', priority: 20, sessionPct: 90, weeklyPct: 10 };
  const b = { id: 'b', plan: 'Max x5', priority: 10, sessionPct: 10, weeklyPct: 10 };
  assert.equal(compteQuiRecoitLeTravail([a, b], T0)?.id, 'a');
  assert.equal(compteQuiRecoitLeTravail([{ ...a, sessionPct: 10 }, b], T0)?.id, 'b');
});

test('une fin de fenêtre déjà passée (relevé périmé) ne compte pas', () => {
  const perime = { ...premier, sessionPct: 10, sessionFinit: T0 - HEURE };
  const entame = { ...second, sessionPct: 40, sessionFinit: T0 + 4 * HEURE };
  assert.equal(compteQuiRecoitLeTravail([perime, entame], T0)?.id, 'claude-second');
});

test('tailles différentes : l’ordre réglé décide, le plus gros seulement à rang égal', () => {
  const petit = { id: 'petit', plan: 'Max x5', priority: 10, sessionPct: 10, sessionFinit: T0 + 4 * HEURE };
  const gros = { id: 'gros', plan: 'Max x20', priority: 20, sessionPct: 90, sessionFinit: T0 + HEURE };
  assert.equal(compteQuiRecoitLeTravail([gros, petit], T0)?.id, 'petit');
  assert.equal(compteQuiRecoitLeTravail([gros, { ...petit, priority: 20 }], T0)?.id, 'gros');
});

test('les comptes semblables forment un lot rangé à la place de son mieux rangé', () => {
  /* Ordre réglé : x5 A (1er), x20 B (2e), x5 C (3e). C a une fenêtre entamée :
     il passe devant A dans le lot des x5, et ce lot reste devant B. */
  const A = { id: 'A', plan: 'Max x5', priority: 10, sessionPct: 0 };
  const B = { id: 'B', plan: 'Max x20', priority: 20, sessionPct: 50, sessionFinit: T0 + HEURE };
  const C = { id: 'C', plan: 'Max x5', priority: 30, sessionPct: 60, sessionFinit: T0 + 2 * HEURE };
  assert.deepEqual(classerComptesPourLeTravail([A, B, C], T0).map((c) => c.id), ['C', 'A', 'B']);
});

test('une reprise automatique exige une relève disponible du même moteur', () => {
  const comptes: CompteConnu[] = [
    {
      ...premier,
      label: 'Claude Perso',
      engine: 'claude',
      disponible: false,
      releveFiable: true,
      consommePct: 100,
    },
    {
      ...second,
      label: 'Claude Pro',
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

  assert.equal(compteDeRepriseAutomatique('claude', 'claude-premier', comptes)?.id, 'claude-second');
  assert.equal(
    compteDeRepriseAutomatique('claude', 'claude-premier', comptes.map((compte) => ({ ...compte, disponible: false }))),
    undefined,
  );
  assert.equal(
    compteDeRepriseAutomatique('claude', 'claude-premier', comptes.map((compte) => ({ ...compte, releveFiable: false }))),
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
