/**
 * LE GABARIT D'UN RAPPORT — la réponse finale d'un agent, rangée toujours
 * pareil, pour que l'écran la pose dans le MÊME flux vertical que le cadrage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLES_DU_RAPPORT, rangerLeRapport, sectionOuvertePar } from '@beluga/shared';

const RAPPORT = [
  'Opus 5 · niveau standard · 9 min · ~12 CHF',
  '',
  '## 1. Analyse',
  'La demande porte sur la forme de la réponse.',
  '',
  '## 2. Ce qui est fait',
  'La règle de rangement a été écrite.',
  '',
  '## 3. Conséquences',
  'Le fil garde ses ronds.',
  '',
  '## 4. Impact',
  'On lit la même page du début à la fin.',
  '',
  '## 5. Évolutions possibles',
  '- Replier une section trop longue',
  '',
  '## 6. Coûts',
  'Neuf minutes de machine.',
].join('\n');

test('les six sections du gabarit sont rangées dans l’ordre, en-tête à part', () => {
  const range = rangerLeRapport(RAPPORT);
  assert.equal(range.conforme, true);
  assert.deepEqual(
    range.sections.map((section) => section.cle),
    [...CLES_DU_RAPPORT],
  );
  assert.equal(range.entete, 'Opus 5 · niveau standard · 9 min · ~12 CHF');
  assert.equal(range.sections[0].corps, 'La demande porte sur la forme de la réponse.');
  assert.equal(range.sections[4].corps, '- Replier une section trop longue');
  assert.deepEqual(
    range.sections.map((section) => section.numero),
    [1, 2, 3, 4, 5, 6],
  );
});

test('une réponse d’ampleur moyenne (trois sections) tient le gabarit', () => {
  const range = rangerLeRapport(
    '## Ce qui est fait\nUne faute corrigée.\n\n## Conséquences\nRien d’autre ne bouge.\n\n## Coûts\nDeux minutes.',
  );
  assert.equal(range.conforme, true);
  assert.deepEqual(
    range.sections.map((section) => section.cle),
    ['ce-qui-est-fait', 'consequences', 'couts'],
  );
});

test('les titres écrits en gras ouvrent les mêmes sections', () => {
  const range = rangerLeRapport('**Analyse**\nUn constat.\n\n**Coûts :**\nTrois minutes.');
  assert.equal(range.conforme, true);
  assert.equal(range.sections[0].corps, 'Un constat.');
  assert.equal(range.sections[1].cle, 'couts');
});

test('une phrase qui commence par un intitulé n’ouvre aucune section', () => {
  assert.equal(sectionOuvertePar('Analyse du fichier : rien à signaler.'), null);
  assert.equal(sectionOuvertePar('## Analyse')?.cle, 'analyse');
  const range = rangerLeRapport('Analyse du fichier : rien à signaler.\nImpact immédiat sur la page.');
  assert.equal(range.conforme, false);
  assert.equal(range.sections.length, 0);
});

test('une réponse brève sans titre garde le rendu ordinaire', () => {
  const range = rangerLeRapport('La faute est corrigée, rien d’autre n’a bougé.');
  assert.equal(range.conforme, false);
  assert.equal(range.entete, 'La faute est corrigée, rien d’autre n’a bougé.');
});

test('une section citée deux fois ne se dédouble pas', () => {
  const range = rangerLeRapport('## Analyse\nUn.\n\n## Coûts\nTrois minutes.\n\n## Analyse\nDeux.');
  assert.equal(range.sections.length, 2);
  assert.equal(range.sections[0].corps, 'Un.\n\nDeux.');
});

test('un compte rendu au gabarit est rangeable, un texte bref ne l’est pas', () => {
  assert.equal(rangerLeRapport(RAPPORT).conforme, true);
  assert.equal(rangerLeRapport('La faute est corrigée.').conforme, false);
});
