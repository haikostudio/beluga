/**
 * LA VALIDATION D'UN GESTE IMPORTANT, DANS LE FIL (26/11/2026, capture #6b90 : l'agent laissait à l'utilisateur
 * « deux clics sur “Enregistrer” »). Ce que ces essais verrouillent : la forme de la question (deux issues dans
 * l'ordre valider → refuser, captures d'image seulement, bornées), le sens de la réponse, et qu'Auto ne tranche
 * jamais une validation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentQuestion,
  MAX_CAPTURES_DE_VALIDATION,
  REGLE_DE_LA_VALIDATION,
  REPONSE_REFUSER_LE_GESTE,
  REPONSE_VALIDER_LE_GESTE,
  optionsDeValidation,
  questionPourAuto,
  validationAccordee,
  validationLue,
} from '@beluga/shared';

const images = new Set(['img1', 'img2', 'img3', 'img4', 'img5']);
const estUneImage = (id: string) => (images.has(id) ? id : null);

test('le champ « validation » se relit : phrase bornée, captures d’image connues, sans doublon, quatre au plus', () => {
  assert.equal(validationLue(undefined, estUneImage), null);
  assert.equal(validationLue({ geste: '   ' }, estUneImage), null, 'sans phrase, la question reste ordinaire');
  const v = validationLue({ geste: '  Cliquer   « Enregistrer » dans les deux onglets  ', captures: ['img1', 'inconnue', 'img1', 'img2', 'img3', 'img4', 'img5'] }, estUneImage);
  assert.deepEqual(v, { geste: 'Cliquer « Enregistrer » dans les deux onglets', captures: ['img1', 'img2', 'img3', 'img4'] });
  assert.equal(v!.captures.length, MAX_CAPTURES_DE_VALIDATION);
  // « capture » au singulier est accepté aussi.
  assert.deepEqual(validationLue({ geste: 'Publier', capture: 'img2' }, estUneImage)?.captures, ['img2']);
  assert.ok(validationLue({ geste: 'x'.repeat(900) }, estUneImage)!.geste.length <= 300);
});

test('deux issues dans l’ordre que lit l’écran, et seule la première fait partir le geste', () => {
  const options = optionsDeValidation();
  assert.deepEqual(options.map((o) => o.label), [REPONSE_VALIDER_LE_GESTE, REPONSE_REFUSER_LE_GESTE]);
  assert.equal(validationAccordee('Valider'), true);
  assert.equal(validationAccordee('Refuser'), false);
  assert.equal(validationAccordee(''), false);
  // Une confirmation du pilote de Chrome garde ses propres libellés.
  assert.equal(validationAccordee('Oui, le faire', 'Oui, le faire'), true);
});

test('une validation n’est jamais tranchée par Auto, une question ordinaire peut l’être', () => {
  const ordinaire = AgentQuestion.parse({ id: 'q1', question: 'Quel ton ?', options: [{ id: 'o0', label: 'Chaleureux' }] });
  assert.equal(questionPourAuto(ordinaire as any), true);
  const validation = AgentQuestion.parse({
    id: 'q2',
    question: 'J’enregistre l’adresse sur LinkedIn ?',
    options: optionsDeValidation(),
    allowFreeText: false,
    validation: { geste: 'Cliquer « Enregistrer »', captures: ['img1'] },
  });
  assert.equal(questionPourAuto(validation as any), false);
});

test('la règle dite à l’agent : il fait lui-même, ne demande jamais de clic, valide l’important avec capture', () => {
  assert.match(REGLE_DE_LA_VALIDATION, /TU FAIS LES GESTES TOI-MÊME/);
  assert.match(REGLE_DE_LA_VALIDATION, /« il te reste deux clics… » est interdit/);
  assert.match(REGLE_DE_LA_VALIDATION, /capturer/);
  assert.match(REGLE_DE_LA_VALIDATION, /À « Valider », fais le geste TOI-MÊME/);
});
