import test from 'node:test';
import assert from 'node:assert/strict';
import { libelleDOutil, puissanceDuTour, reglagePoseParLeSysteme, reglagesDuNiveau, titreDeTacheLu, type MoteurCatalogue, type PuissanceDuTour } from '@beluga/shared';

/* Un catalogue Claude où Fable est le plus « gourmand » : il ne doit JAMAIS sortir d'un palier. */
const CLAUDE: MoteurCatalogue = {
  id: 'claude',
  label: 'Claude',
  installed: true,
  defaultModel: 'claude-sonnet-5-5',
  comptesDisponibles: 1,
  models: [
    { id: 'claude-fable-5-2', label: 'Fable 5.2', thinking: [{ id: 'none' }, { id: 'high' }], appetite: 'heavy' },
    { id: 'claude-opus-5-5', label: 'Opus 5.5', thinking: [{ id: 'none' }, { id: 'medium' }, { id: 'high' }], appetite: 'heavy' },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', thinking: [{ id: 'none' }, { id: 'medium' }, { id: 'high' }], appetite: 'medium' },
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5', thinking: [{ id: 'none' }], appetite: 'light' },
  ],
};
const conversation = reglagesDuNiveau(CLAUDE, 'approfondi');
const passages = reglagesDuNiveau(CLAUDE, 'standard');

test('les paliers traduits : Opus en réflexion haute pour la conversation, Sonnet pour les passages, jamais Fable', () => {
  assert.deepEqual(conversation, { model: 'claude-opus-5-5', thinking: 'high' });
  assert.deepEqual(passages, { model: 'claude-sonnet-5-5', thinking: 'medium' });
});

test("un message de l'utilisateur fait passer l'ancien réglage d'office au palier approfondi, enregistré", () => {
  const r = puissanceDuTour({ run: { engine: 'claude', model: 'claude-sonnet-5-5', thinking: 'medium' }, humain: true, conversation, passages });
  assert.deepEqual(r, { enregistrer: { model: 'claude-opus-5-5', thinking: 'high', niveau: 'approfondi' } });
  // Déjà au palier : rien à réécrire, et le tour part tel quel.
  assert.deepEqual(puissanceDuTour({ run: { engine: 'claude', ...conversation, niveau: 'approfondi' }, humain: true, conversation, passages }), {});
  // Un agent né sans modèle (chef de Communication) suit aussi.
  assert.ok(puissanceDuTour({ run: { engine: 'claude' }, humain: true, conversation, passages }).enregistrer);
});

test('un passage seul part au palier standard pour CE tour, sans rien enregistrer', () => {
  const r: PuissanceDuTour = puissanceDuTour({ run: { engine: 'claude', ...conversation, niveau: 'approfondi' }, humain: false, conversation, passages });
  assert.equal(r.enregistrer, undefined);
  assert.deepEqual(r, { duTour: { model: 'claude-sonnet-5-5', thinking: 'medium' } });
});

test('un modèle choisi à la main n’est jamais touché (DEC-213), ni en conversation ni en passage', () => {
  const manuel = { engine: 'claude', model: 'claude-haiku-5-5', thinking: 'none' };
  assert.equal(reglagePoseParLeSysteme(manuel, passages), false);
  assert.deepEqual(puissanceDuTour({ run: manuel, humain: true, conversation, passages }), {});
  assert.deepEqual(puissanceDuTour({ run: manuel, humain: false, conversation, passages }), {});
  // Opus choisi à la main (le menu retire le palier) : un passage ne le ramène pas au standard.
  assert.deepEqual(puissanceDuTour({ run: { engine: 'claude', model: 'claude-opus-5-5', thinking: 'high' }, humain: false, conversation, passages }), {});
  // Fable choisi à la main reste à la main.
  assert.deepEqual(puissanceDuTour({ run: { engine: 'claude', model: 'claude-fable-5-2', thinking: 'high' }, humain: true, conversation, passages }), {});
});

test('un autre moteur ne suit pas les paliers des agents des services', () => {
  assert.deepEqual(puissanceDuTour({ run: { engine: 'codex', model: 'gpt-5.6' }, humain: true, conversation, passages }), {});
});

test('un catalogue qui ne rendrait que Fable ne donne jamais Fable', () => {
  assert.deepEqual(puissanceDuTour({ run: { engine: 'claude' }, humain: true, conversation: { model: 'claude-fable-5-2', thinking: 'high' }, passages }), {});
  assert.deepEqual(puissanceDuTour({ run: { engine: 'claude' }, humain: false, conversation, passages: { model: 'claude-fable-5-2', thinking: 'high' } }), {});
});

test('le nom de la tâche dit l’action : un titre générique, vide ou trop long est refusé', () => {
  assert.deepEqual(titreDeTacheLu('  « Calendrier de publication de décembre »  '), { ok: true, titre: 'Calendrier de publication de décembre' });
  assert.equal(titreDeTacheLu('Nouvel agent').ok, false);
  assert.equal(titreDeTacheLu('Marketing').ok, false);
  assert.equal(titreDeTacheLu('').ok, false);
  assert.equal(titreDeTacheLu(42).ok, false);
  assert.equal(titreDeTacheLu('x'.repeat(81)).ok, false);
  assert.equal(libelleDOutil('nommer_la_tache'), 'Nom de la tâche');
});
