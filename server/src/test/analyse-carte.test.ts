import test from 'node:test';
import assert from 'node:assert/strict';
import { motAnalyse, phaseAnalyse, titreDeBloc, wrapPrompt } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Où en est l'analyse d'une carte                                     */
/* ------------------------------------------------------------------ */

const base = { aEstimation: false, estimationEchouee: false, analyseEnCours: false } as const;

test('une carte validée qui attend son lancement n’annonce aucune analyse', () => {
  // Rien ne part au moteur avant le lancement : une carte « Planifié » sans
  // chiffres n'a rien à montrer, et elle n'a rien coûté. Il n'y a plus de
  // colonne « Validé » ni de colonne « À faire » : la carte naît là et y reste.
  assert.equal(phaseAnalyse({ ...base, column: 'planned' }), 'aucune');
  assert.equal(phaseAnalyse({ ...base, column: 'notes' }), 'aucune');
});

test("un agent qui tourne l'emporte sur la colonne", () => {
  assert.equal(phaseAnalyse({ ...base, column: 'planned', analyseEnCours: true }), 'en_cours');
  assert.equal(
    phaseAnalyse({ ...base, column: 'planned', aEstimation: true, analyseEnCours: true }),
    'en_cours',
  );
});

test('un chiffrage rendu se dit prêt, un chiffrage sans chiffres se dit échoué', () => {
  assert.equal(phaseAnalyse({ ...base, column: 'running', aEstimation: true }), 'prete');
  assert.equal(phaseAnalyse({ ...base, column: 'running', estimationEchouee: true }), 'echouee');
});

test("une carte jamais lancée n'annonce aucune analyse", () => {
  assert.equal(phaseAnalyse({ ...base, column: 'planned' }), 'aucune');
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
