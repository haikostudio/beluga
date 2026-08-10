import test from 'node:test';
import assert from 'node:assert/strict';
import { motAnalyse, phaseAnalyse, titreDeBloc, wrapPrompt } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Où en est l'analyse d'une carte                                     */
/* ------------------------------------------------------------------ */

const base = { aEstimation: false, estimationEchouee: false, analyseEnCours: false } as const;

test("une carte validée sans chiffres est en cours d'analyse, même avant que son agent parte", () => {
  // Plus de colonne « Validé » : la carte reste dans « À faire » le temps du
  // chiffrage, c'est son drapeau de validation qui le dit.
  assert.equal(phaseAnalyse({ ...base, column: 'todo', analyseDemandee: true }), 'en_cours');
  assert.equal(phaseAnalyse({ ...base, column: 'todo' }), 'aucune');
});

test("un agent d'analyse qui tourne l'emporte sur la colonne", () => {
  assert.equal(phaseAnalyse({ ...base, column: 'todo', analyseEnCours: true }), 'en_cours');
  assert.equal(
    phaseAnalyse({ ...base, column: 'todo', aEstimation: true, analyseEnCours: true }),
    'en_cours',
  );
});

test('une analyse finie se dit prête, une analyse sans chiffres se dit échouée', () => {
  assert.equal(phaseAnalyse({ ...base, column: 'todo', aEstimation: true }), 'prete');
  assert.equal(phaseAnalyse({ ...base, column: 'todo', estimationEchouee: true }), 'echouee');
});

test("une carte jamais validée n'annonce aucune analyse", () => {
  assert.equal(phaseAnalyse({ ...base, column: 'todo' }), 'aucune');
  assert.equal(phaseAnalyse({ ...base, column: 'notes' }), 'aucune');
});

test('une conversation vide ne reste jamais muette : elle dit ce qui se passe', () => {
  for (const phase of ['aucune', 'en_cours', 'prete', 'echouee'] as const) {
    const mot = motAnalyse(phase);
    assert.ok(mot.titre.length > 3, `titre manquant pour ${phase}`);
    assert.ok(mot.indice.length > 10, `explication manquante pour ${phase}`);
  }
  assert.match(motAnalyse('en_cours').titre, /Analyse en cours/);
});

test('chaque agent de la carte a son repère dans la conversation', () => {
  assert.equal(titreDeBloc('analysis'), 'Analyse de la carte');
  assert.equal(titreDeBloc('task'), 'Exécution de la tâche');
  assert.equal(titreDeBloc(undefined), 'Exécution de la tâche');
  assert.equal(titreDeBloc('deploy'), 'Publication');
});

test("l'analyse doit dire ce qu'elle a trouvé dans le projet, pas seulement ce qu'elle a compris", () => {
  const prompt = wrapPrompt('pre_run', 'Refonte du tableau');
  assert.match(prompt, /Analyse de la demande/);
  assert.match(prompt, /trouvé dans le projet/);
  assert.match(prompt, /Approche retenue/);
});
