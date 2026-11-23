import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { delaiOutilMoteurMs } from '@beluga/shared';
import { toolsFor } from '../tools.js';

/* ------------------------------------------------------------------ */
/* LES LIGNES ROUGES QUI VENAIENT DE LA MÉCANIQUE                       */
/*                                                                     */
/* Mesurées par `scripts/inventaire-echecs.mjs` : une question coupée   */
/* par le moteur une seconde avant la réponse propre du démon, un       */
/* « Accès refusé » pour un champ manquant, un plan refusé pour des     */
/* minimums que son schéma ne disait pas.                              */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.resolve(ICI, '../../src');

test('le moteur laisse une question muette aussi longtemps que le démon peut l’attendre', () => {
  const runtime = fs.readFileSync(path.join(SOURCES, 'runtime.ts'), 'utf8');
  assert.ok(runtime.includes('MCP_TOOL_TIMEOUT: String(delaiOutilMoteurMs())'));
  assert.ok(
    runtime.includes('CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: String(delaiOutilMoteurMs())'),
    'le délai d’inactivité suit le délai d’appel : sinon Claude coupe à 1 800 s, pile au plafond',
  );
  assert.ok(delaiOutilMoteurMs() > 1_800_000);
});

test('un enregistrement du coffre incomplet ne se dit plus « Accès refusé »', () => {
  const tools = fs.readFileSync(path.join(SOURCES, 'tools.ts'), 'utf8');
  assert.equal(tools.includes('`Accès refusé :'), false);
  assert.ok(tools.includes('Enregistrement impossible :'));
});

test('le schéma de « rendre_plan » déclare les minimums que le démon exige', () => {
  const outil = toolsFor('cadrage').find((t) => t.name === 'rendre_plan');
  assert.ok(outil, 'rendre_plan est servi au cadrage');
  const proprietes = (outil!.inputSchema as any).properties;
  assert.equal(proprietes.taches.minItems, 2);
  assert.equal(proprietes.decisions.minItems, 1);
  assert.equal(proprietes.verifications.minItems, 1);
  /* LE PLAN COMPACT (17/10/2026) : chemin et améliorations ne sont plus demandés. */
  assert.equal(proprietes.chemin, undefined);
  assert.equal(proprietes.ameliorations, undefined);
});
