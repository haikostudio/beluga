import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AMPLEURS,
  ampleurDeSuivi,
  ampleurEffective,
  ampleurParDefaut,
  checkTemplate,
  sectionsPour,
  wrapPrompt,
} from '@beluga/shared';
import { buildCodexArgs } from '../engines/codex.js';

/*
 * Économiser le quota, sur les deux fronts :
 *  — CE QUI SORT : la longueur de la réponse suit le travail réel.
 *  — CE QUI ENTRE : le gabarit et le contexte ne partent qu'à l'ouverture.
 */

/* ------------------------------------------------------------------ */
/* Longueur de référence                                               */
/* ------------------------------------------------------------------ */

test('une question part sur une réponse brève, une vraie tâche sur le compte rendu entier', () => {
  assert.equal(ampleurParDefaut('in_run', 'Pourquoi le bouton est gris ?'), 'breve');
  assert.equal(ampleurParDefaut('in_run', 'Corrige la faute'), 'breve');
  assert.equal(ampleurParDefaut('free', 'Explique-moi le fonctionnement du tableau'), 'breve');
  assert.equal(
    ampleurParDefaut('in_run', 'Renomme le bouton « Envoyer » en « Publier » sur la barre du bas.'.repeat(7)),
    'complete',
  );
  // Entre les deux : un ajustement contenu, trois titres suffisent.
  assert.equal(
    ampleurParDefaut('in_run', 'Renomme le bouton « Envoyer » en « Publier » sur la barre du bas.'.repeat(2)),
    'standard',
  );
});

test("un chiffrage ou un journal de publication garde sa forme, quelle que soit la demande", () => {
  assert.equal(ampleurParDefaut('pre_run', 'Ça va ?'), 'complete');
  assert.equal(ampleurParDefaut('deploy', 'Ça va ?'), 'complete');
  assert.deepEqual(sectionsPour('deploy', 'breve'), [
    'Ce qui a été publié',
    'Déroulé',
    'Vérification',
    'Suites éventuelles',
  ]);
});

test('un message de messagerie n’a aucun titre à remplir, quelle que soit la longueur', () => {
  // Décision du 17/10/2026 : la réponse d'un tour de travail ou de l'assistant
  // est un message, sans titres imposés ; sa longueur suit la demande depuis le 25/10/2026.
  for (const ampleur of ['breve', 'standard', 'complete'] as const) {
    assert.deepEqual(sectionsPour('in_run', ampleur), []);
    assert.deepEqual(sectionsPour('free', ampleur), []);
  }
  assert.ok(sectionsPour('pre_run', 'complete').length > 0, 'le chiffrage garde sa forme');
});

test('un tour de suivi part d\'un cran plus bas, sans jamais descendre sous « brève »', () => {
  assert.equal(ampleurDeSuivi('in_run', 'complete'), 'standard');
  assert.equal(ampleurDeSuivi('in_run', 'standard'), 'breve');
  assert.equal(ampleurDeSuivi('in_run', 'breve'), 'breve');
  assert.equal(ampleurDeSuivi('free', 'complete'), 'standard');
  // Un gabarit à forme fixe ne bouge pas : un chiffrage ou un journal restent entiers.
  assert.equal(ampleurDeSuivi('pre_run', 'complete'), 'complete');
  assert.equal(ampleurDeSuivi('deploy', 'complete'), 'complete');
});

test('la réponse d’un tour de travail est un message à la longueur de la demande, ses suites passent par un outil', () => {
  for (const ampleur of ['breve', 'standard', 'complete'] as const) {
    const enveloppe = wrapPrompt('in_run', 'Refais la barre du bas.', undefined, { ampleur });
    assert.doesNotMatch(enveloppe, /600 signes/);
    assert.match(enveloppe, /longueur que la demande appelle/);
    assert.match(enveloppe, /proposer_suites/);
    assert.doesNotMatch(enveloppe, /## 1\. Analyse/);
    assert.doesNotMatch(enveloppe, /Évolutions possibles/);
    assert.doesNotMatch(enveloppe, /CONTENU DE CHAQUE SECTION/);
  }
});

test('répondre plus court que la référence est un gain, pas une faute', () => {
  const court = "## Ce qui est fait\n\nJ'ai corrigé la faute dans le titre.\n\nRien d'autre n'a bougé.";
  assert.equal(checkTemplate('in_run', court, 'complete').ok, true);
  assert.equal(checkTemplate('in_run', court, 'breve').ok, true);
  assert.equal(ampleurEffective('complete', court), 'breve');
});

test('une réponse longue n’est plus jugée hors forme : sa longueur suit la demande (25/10/2026)', () => {
  const long = Array.from({ length: 400 }, (_, i) => (i % 10 === 9 ? 'texte.\n' : 'texte')).join(' ');
  assert.equal(checkTemplate('in_run', long, 'breve').ok, true);
});

/* ------------------------------------------------------------------ */
/* Ce qui entre : l'enveloppe                                          */
/* ------------------------------------------------------------------ */

test('le gabarit entier ne part qu\'une fois : ensuite un rappel d\'une ligne', () => {
  const demande = 'Corrige la faute dans le titre de la carte.';
  // Le chiffrage d'une proposition garde sa forme structurée, guide compris.
  const complet = wrapPrompt('pre_run', demande, undefined, { ampleur: 'complete' });
  const rappel = wrapPrompt('pre_run', demande, undefined, { rappel: true });

  assert.match(complet, /MISE EN FORME/);
  assert.doesNotMatch(rappel, /MISE EN FORME/);
  assert.match(rappel, /RAPPEL DE FORME/);

  // La demande elle-même reste intacte : on taille l'enveloppe, pas le contenu.
  assert.match(rappel, /Corrige la faute dans le titre de la carte\./);
  // Et le rappel coûte au moins quatre fois moins que le bloc entier.
  assert.ok(rappel.length * 4 < complet.length, `rappel ${rappel.length} vs complet ${complet.length}`);

  // Un message de messagerie : la forme entière au premier tour, le rappel ensuite.
  const message = wrapPrompt('in_run', demande, undefined, { ampleur: 'complete' });
  const rappelDuMessage = wrapPrompt('in_run', demande, undefined, { rappel: true });
  assert.match(message, /FORME DE TA RÉPONSE FINALE/);
  assert.doesNotMatch(rappelDuMessage, /FORME DE TA RÉPONSE FINALE/);
  assert.match(rappelDuMessage, /RAPPEL DE FORME/);
});

test('raccourcir ne veut pas dire cacher', () => {
  const message = wrapPrompt('in_run', 'Ajoute un bouton de partage sur la carte du tableau de bord.');
  assert.match(message, /Un échec, un point à vérifier ou une décision prise se dit, jamais passé sous silence/);
});

/* ------------------------------------------------------------------ */
/* Ce qui entre : les consignes de rôle côté Codex                     */
/* ------------------------------------------------------------------ */

test("les consignes de rôle ne sont recollées qu'au premier tour d'un fil Codex", () => {
  const base = {
    cwd: '/root/beluga',
    prompt: 'Fais la tâche.',
    systemPrompt: 'TU ES UN AGENT DE TÂCHE.',
    onEvent: () => {},
  } as any;

  const premier = buildCodexArgs(base).join(' ');
  const suivant = buildCodexArgs({ ...base, sessionId: 'fil-123' }).join(' ');

  assert.match(premier, /TU ES UN AGENT DE TÂCHE\./);
  assert.doesNotMatch(suivant, /TU ES UN AGENT DE TÂCHE\./);
  assert.match(suivant, /Fais la tâche\./);
});
