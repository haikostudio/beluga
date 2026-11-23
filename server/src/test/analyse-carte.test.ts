import test from 'node:test';
import assert from 'node:assert/strict';
import { titreDeBloc, wrapPrompt } from '@beluga/shared';

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
