import test from 'node:test';
import assert from 'node:assert/strict';
import { prixEnEurosEtDollars, prixParQuantite, refusDeQuestionSansPrix } from '@beluga/shared';

test('le prix se dit en euros, le dollar d’origine entre parenthèses, jamais « 0,00 »', () => {
  assert.equal(prixEnEurosEtDollars(0.06), 'environ 0,05 € (0,06 $)');
  assert.equal(prixEnEurosEtDollars(1.5), 'environ 1,34 € (1,50 $)');
  assert.equal(prixEnEurosEtDollars(0.004), 'environ 0,01 € (0,01 $)');
  assert.deepEqual(prixParQuantite(0.06, [1, 2]), ['1 : environ 0,05 € (0,06 $)', '2 : environ 0,11 € (0,12 $)']);
});

test('une question de quantité ou de modèle sans prix est refusée (capture #cc7eb)', () => {
  const question = 'Combien de propositions de musique voulez-vous écouter avant de choisir ?';
  const sans = [{ label: '2 propositions (recommandé)', description: 'au double du prix d’une seule' }, { label: '1 proposition', description: 'Le moins cher' }];
  assert.match(refusDeQuestionSansPrix({ question, options: sans })!, /prix TOTAL/);
  assert.equal(refusDeQuestionSansPrix({ question, options: sans.map((o) => ({ ...o, description: 'environ 0,11 € (0,12 $)' })) }), null);
  assert.match(refusDeQuestionSansPrix({ question: 'Quel modèle pour cette image ?', options: [{ label: 'FLUX' }] })!, /prix TOTAL/);
  assert.equal(refusDeQuestionSansPrix({ question: 'Quel modèle pour cette image ?', options: [{ label: 'FLUX', description: 'prix non publié' }] }), null);
  assert.match(refusDeQuestionSansPrix({ question: 'Que préférez-vous ?', options: [{ label: '3 variantes' }] })!, /prix TOTAL/);
  /* Une question d'ambiance ou une réponse libre ne se chiffre pas. */
  assert.equal(refusDeQuestionSansPrix({ question: 'Quelle ambiance voulez-vous ?', options: [{ label: 'Lumineuse' }, { label: 'Sombre' }] }), null);
  assert.equal(refusDeQuestionSansPrix({ question, options: [] }), null);
});
