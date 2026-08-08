import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/* VALIDATION D'UNE PROPOSITION DU CHEF : PAS DE SECONDE ANALYSE       */
/*                                                                     */
/* Le chef a déjà préparé le titre, la description et les réglages de  */
/* la carte dans sa proposition. Quand l'utilisateur l'accepte, le     */
/* serveur doit créer la carte avec ces données, puis s'arrêter là :   */
/* ni analyseCard, ni nouveau tour du chef, ni réveil de l'ordonnanceur. */
/* Le chiffrage demandé plus tard depuis le tableau reste un autre     */
/* geste, couvert par les contrôles généraux des agents.               */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const websocket = fs.readFileSync(path.resolve(ICI, '../../src/ws.ts'), 'utf8');

function corpsDecisionProposition(): string {
  const apresDebut = websocket.split("case 'proposal.decide':")[1];
  assert.ok(apresDebut, 'le traitement de la validation d’une proposition doit exister');

  const avantSuite = apresDebut.split("case 'deploy.start':")[0];
  assert.ok(avantSuite, 'le traitement de la validation doit rester isolable');
  return avantSuite;
}

test('valider la carte proposée par le chef réutilise les données préparées', () => {
  const corps = corpsDecisionProposition();

  assert.match(corps, /createCard\(agent\.projectId,\s*\{\s*\.\.\.retenu,/s);
});

test('valider la carte proposée par le chef ne relance aucune analyse', () => {
  const corps = corpsDecisionProposition();

  assert.doesNotMatch(
    corps,
    /\banalyseCard\s*\(/,
    'une proposition déjà préparée ne doit pas repartir dans analyseCard',
  );
  assert.doesNotMatch(
    corps,
    /\bsendPrompt\s*\(/,
    'la validation ne doit pas ouvrir un second tour du chef',
  );
  assert.doesNotMatch(
    corps,
    /\btick\s*\(/,
    'la validation ne doit pas réveiller indirectement une nouvelle analyse',
  );
});
