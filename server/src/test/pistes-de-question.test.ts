import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PISTES_MINIMUM_PAR_QUESTION,
  REGLE_DES_PISTES,
  consigneDePlanDansLeMemeTour,
  consigneDuCahier,
  consigneDuQuestionnaire,
} from '@beluga/shared';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'pistes-de-question-'));
process.env.BELUGA_DATA = bacASable;

/*
 * UNE QUESTION DE CONCEPTION PROPOSE AU MOINS QUATRE PISTES, DONT UNE INATTENDUE.
 * La règle est dite une fois et reprise par les quatre consignes qui font poser
 * des questions : réalisation, cahier des charges, cadrage de plan, outil ask_user.
 */

test('la règle des pistes dit le minimum, la piste inattendue et le coût de chaque piste', () => {
  assert.equal(PISTES_MINIMUM_PAR_QUESTION, 4);
  assert.match(REGLE_DES_PISTES, /AU MOINS 4 pistes/);
  assert.match(REGLE_DES_PISTES, /INATTENDUE/);
  assert.match(REGLE_DES_PISTES, /coûte/);
  assert.match(REGLE_DES_PISTES, /\(recommandé\)/);
});

test('les consignes qui font poser des questions portent la règle', () => {
  assert.ok(consigneDuQuestionnaire({ medias: ['video'], document: '' }).includes(REGLE_DES_PISTES));
  assert.ok(consigneDuCahier('/x', '/y').includes(REGLE_DES_PISTES));
  assert.ok(consigneDePlanDansLeMemeTour(1).includes(REGLE_DES_PISTES));
});

test('la description de l’outil ask_user porte la règle', async () => {
  const { TOOL_DEFS } = await import('../tools.js');
  const ask = TOOL_DEFS.find((o) => o.name === 'ask_user');
  assert.ok(ask?.description.includes(REGLE_DES_PISTES));
});

test('la clause EXEMPLES : points de couleur d’office, exemples proposés avant un choix visuel, jamais pour une question pratique', async () => {
  const { REGLE_DES_EXEMPLES, MAX_PISTES_D_EXEMPLE } = await import('@beluga/shared');
  assert.match(REGLE_DES_EXEMPLES, /COULEURS/);
  assert.match(REGLE_DES_EXEMPLES, /« couleurs »/);
  assert.match(REGLE_DES_EXEMPLES, /Oui, montre-moi des exemples \(recommandé\)/);
  assert.match(REGLE_DES_EXEMPLES, /exemple_de_choix/);
  assert.match(REGLE_DES_EXEMPLES, /question pratique/);
  assert.match(REGLE_DES_EXEMPLES, /mode caméra/);
  assert.match(REGLE_DES_EXEMPLES, /« A \(#xxxx\) »/);
  assert.equal(MAX_PISTES_D_EXEMPLE, 4);
  const { TOOL_DEFS } = await import('../tools.js');
  const ask = TOOL_DEFS.find((o) => o.name === 'ask_user');
  assert.ok(ask?.description.includes(REGLE_DES_EXEMPLES), 'la description d’ask_user porte la clause, pour tous les agents');
  assert.ok(TOOL_DEFS.some((o) => o.name === 'exemple_de_choix'));
});
