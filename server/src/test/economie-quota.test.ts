import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AMPLEURS,
  ampleurEffective,
  ampleurParDefaut,
  checkTemplate,
  sectionsPour,
  wrapPrompt,
} from '@haikodev/shared';
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

test('les trois longueurs demandent trois jeux de titres', () => {
  assert.deepEqual(sectionsPour('in_run', 'breve'), []);
  assert.deepEqual(sectionsPour('in_run', 'standard'), AMPLEURS.standard.sections);
  assert.equal(sectionsPour('in_run', 'complete').length, 6);
});

test('répondre plus court que la référence est un gain, pas une faute', () => {
  const court = "## Ce qui est fait\n\nJ'ai corrigé la faute dans le titre.\n\nRien d'autre n'a bougé.";
  assert.equal(checkTemplate('in_run', court, 'complete').ok, true);
  assert.equal(checkTemplate('in_run', court, 'breve').ok, true);
  assert.equal(ampleurEffective('complete', court), 'breve');
});

test("une réponse longue reste tenue de se structurer", () => {
  const long = Array.from({ length: 400 }, (_, i) => (i % 10 === 9 ? 'texte.\n' : 'texte')).join(' ');
  const verdict = checkTemplate('in_run', long, 'breve');
  assert.equal(verdict.ok, false);
});

/* ------------------------------------------------------------------ */
/* Ce qui entre : l'enveloppe                                          */
/* ------------------------------------------------------------------ */

test('le gabarit entier ne part qu\'une fois : ensuite un rappel d\'une ligne', () => {
  const demande = 'Corrige la faute dans le titre de la carte.';
  const complet = wrapPrompt('in_run', demande);
  const rappel = wrapPrompt('in_run', demande, undefined, { rappel: true });

  assert.match(complet, /MISE EN FORME/);
  assert.match(complet, /CONTENU DE CHAQUE SECTION/);
  assert.doesNotMatch(rappel, /MISE EN FORME/);
  assert.doesNotMatch(rappel, /CONTENU DE CHAQUE SECTION/);
  assert.match(rappel, /RAPPEL DE FORME/);

  // La demande elle-même reste intacte : on taille l'enveloppe, pas le contenu.
  assert.match(rappel, /Corrige la faute dans le titre de la carte\./);
  // Et le rappel coûte au moins quatre fois moins que le bloc entier.
  assert.ok(rappel.length * 4 < complet.length, `rappel ${rappel.length} vs complet ${complet.length}`);
});

test('la règle de longueur est écrite une seule fois, avec la référence du tour', () => {
  const complet = wrapPrompt('in_run', 'Refais toute la barre du bas en trois onglets.', undefined, {
    ampleur: 'complete',
  });
  assert.match(complet, /LONGUEUR DE TA RÉPONSE/);
  assert.match(complet, /la référence est : complète/);

  const bref = wrapPrompt('in_run', 'Pourquoi ?', undefined, { ampleur: 'breve' });
  assert.match(bref, /la référence est : brève/);
});

test('raccourcir ne veut pas dire cacher', () => {
  const complet = wrapPrompt('in_run', 'Ajoute un bouton de partage sur la carte du tableau de bord.');
  assert.match(complet, /Raccourcir ne veut jamais dire taire un changement, un échec ou une décision\./);
});

/* ------------------------------------------------------------------ */
/* Ce qui entre : les consignes de rôle côté Codex                     */
/* ------------------------------------------------------------------ */

test("les consignes de rôle ne sont recollées qu'au premier tour d'un fil Codex", () => {
  const base = {
    cwd: '/root/haikodev',
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
