import test from 'node:test';
import assert from 'node:assert/strict';
import { basculerUnNoeud, documentDuBrief, elementOuvertParDefaut, intituleLisible, noeudOuvert, ouvrirUnNoeud, partieFondueDansSaSection } from '@beluga/shared';

/*
 * LE BRIEF EN ARBRE (26/10/2026) : parties dépliées, Plans et Scènes repliés à
 * l'ouverture, ce qu'on bascule retenu par carte sans faire grossir la
 * préférence, et des intitulés écrits d'une seule façon.
 */

const piece = (cle: string, genre: string, titre: string, contenu: string, etat = 'valide') => ({ id: `id-${cle}`, cle, genre, titre, contenu, etat, versions: [{ creeLe: 1000 }] });

test('parties dépliées, Plans et Scènes repliés, le reste déplié', () => {
  const parties = documentDuBrief([
    { etape: 'brief', elements: [piece('brief', 'brief', 'Brief', 'Objectif : vendre.')] },
    { etape: 'scenario', elements: [piece('scenario', 'script', 'Avant, après', 'Texte.'), piece('scene-1', 'scene', 'Scène 1 : le contraste', 'On voit : Chris.')] },
    { etape: 'plans', elements: [piece('plan-1', 'plan', 'Plan 1', 'DURÉE : 7 s.'), piece('plan-2', 'plan', 'Plan 2', 'DURÉE : 9 s.')] },
  ]);
  const [brief, scenario, plans] = parties;
  assert.equal(partieFondueDansSaSection(brief!, 'Brief'), true);
  assert.equal(partieFondueDansSaSection(scenario!, 'Scénario'), false);
  assert.deepEqual(scenario!.sections.map((sec) => elementOuvertParDefaut(sec)), [true, false]);
  assert.ok(plans!.sections.every((s) => !elementOuvertParDefaut(s)));
  assert.equal(elementOuvertParDefaut({ piece: null }), true);
});

test('basculer retient l’écart au défaut, et revenir au défaut l’efface', () => {
  let b = basculerUnNoeud({}, 'carte-1', 'brief-plans-plan-1');
  assert.equal(noeudOuvert(b, 'carte-1', 'brief-plans-plan-1', false), true);
  assert.equal(noeudOuvert(b, 'carte-2', 'brief-plans-plan-1', false), false);
  b = basculerUnNoeud(b, 'carte-1', 'brief-plans');
  assert.equal(noeudOuvert(b, 'carte-1', 'brief-plans', true), false);
  b = basculerUnNoeud(b, 'carte-1', 'brief-plans-plan-1');
  b = basculerUnNoeud(b, 'carte-1', 'brief-plans');
  assert.deepEqual(b, {});
});

test('la préférence garde les cartes touchées en dernier, jamais plus', () => {
  let b = {};
  for (let i = 0; i < 10; i++) b = basculerUnNoeud(b, `carte-${i}`, 'x', 4);
  assert.deepEqual(Object.keys(b), ['carte-6', 'carte-7', 'carte-8', 'carte-9']);
  b = basculerUnNoeud(b, 'carte-6', 'y', 4);
  assert.deepEqual(Object.keys(b), ['carte-7', 'carte-8', 'carte-9', 'carte-6']);
  assert.deepEqual(basculerUnNoeud(null, 'c', 'k'), { c: ['k'] });
});

test('le sommaire ouvre une partie repliée, et ne touche pas à une partie ouverte', () => {
  assert.equal(ouvrirUnNoeud({}, 'c', 'brief-plans', true), null);
  const b = basculerUnNoeud({}, 'c', 'brief-plans');
  assert.deepEqual(ouvrirUnNoeud(b, 'c', 'brief-plans', true), {});
});

test('un intitulé tout en capitales s’écrit comme les autres, un sigle reste un sigle', () => {
  assert.equal(intituleLisible('DURÉE'), 'Durée');
  assert.equal(intituleLisible('ACCROCHE (0-2 s)'), 'Accroche (0-2 s)');
  assert.equal(intituleLisible('1. OUVERTURE'), '1. Ouverture');
  assert.equal(intituleLisible('Capacité'), 'Capacité');
  assert.equal(intituleLisible('Message clé'), 'Message clé');
  assert.equal(intituleLisible('IA'), 'IA');
  assert.equal(intituleLisible('ÉCHÉANCE'), 'Échéance');
});
