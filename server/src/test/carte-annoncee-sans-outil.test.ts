import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AVERTISSEMENT_SANS_CARTE,
  carteAnnonceeEnTexte,
  carteAnnonceeSansOutil,
  consigneDeCarteReelle,
} from '@haikodev/shared';
import { rolePrompt } from '../runtime.js';

/* ------------------------------------------------------------------ */
/* Une carte RACONTÉE n'est pas une carte : le tour se refait           */
/* ------------------------------------------------------------------ */

/*
 * Le défaut d'origine : le chef réglé sur Haiku répondait « J'ai créé la tâche
 * … » sans jamais appeler `board_create_card`. Le tour se terminait bien, aucune
 * proposition n'était née, et l'utilisateur attendait une carte qui n'existait
 * pas. Sonnet, lui, appelait l'outil.
 */

const tour = (extra: Partial<Parameters<typeof carteAnnonceeSansOutil>[0]> = {}) => ({
  role: 'orchestrator',
  mode: 'direct' as const,
  texte: "J'ai créé la tâche « Corriger le badge bleu ».",
  ...extra,
});

test('une annonce de carte sans appel d’outil est reconnue', () => {
  for (const texte of [
    "J'ai créé la tâche « Corriger le badge bleu ».",
    'Je viens de créer une carte pour cette correction.',
    'La carte a été créée dans « Planifié ».',
    'Je propose une carte pour ce chantier.',
    'Je vais créer une carte pour corriger ce défaut.',
    'Voici la carte proposée pour ce travail.',
    "Parfait.\nLa tâche est créée, vous pouvez la valider.",
  ]) {
    assert.ok(carteAnnonceeEnTexte(texte), `« ${texte} » doit être reconnu comme une carte annoncée`);
  }
});

test('une phrase qui parle de cartes sans en annoncer une ne déclenche rien', () => {
  for (const texte of [
    'Les cartes se valident d’un clic, en bas de la conversation.',
    'Le tableau contient trois cartes en cours.',
    'Cette tâche demanderait une bonne demi-heure de travail.',
    'Rien à créer ici : je réponds directement à votre question.',
  ]) {
    assert.equal(carteAnnonceeEnTexte(texte), null, `« ${texte} » ne doit pas être pris pour une annonce`);
  }
});

test('l’outil réellement appelé éteint le rattrapage', () => {
  assert.equal(carteAnnonceeSansOutil(tour({ propositions: 1 })), null);
});

test('seul le chef d’orchestre est jugé, et jamais en mode plan', () => {
  assert.equal(carteAnnonceeSansOutil(tour({ role: 'task' })), null);
  assert.equal(carteAnnonceeSansOutil(tour({ mode: 'plan' })), null);
});

test('un tour tombé ne se rattrape pas ici : son texte est tronqué', () => {
  assert.equal(carteAnnonceeSansOutil(tour({ echec: true })), null);
});

test('le chef sans proposition et avec l’annonce se fait relancer', () => {
  const phrase = carteAnnonceeSansOutil(tour());
  assert.ok(phrase);
  const consigne = consigneDeCarteReelle(phrase!);
  assert.match(consigne, /board_create_card/);
  assert.match(consigne, /RATTRAPAGE/);
  assert.ok(consigne.includes(phrase!), 'la consigne rappelle la phrase fautive');
});

test('l’avertissement dit clairement qu’aucune carte n’est née', () => {
  assert.match(AVERTISSEMENT_SANS_CARTE, /Aucune carte/);
  assert.match(AVERTISSEMENT_SANS_CARTE, /WARNING/);
});

test('la consigne du chef dit qu’une carte n’existe que par l’appel de l’outil', () => {
  const chef = rolePrompt('orchestrator', false);
  assert.match(chef, /N'EXISTE QUE PAR L'APPEL DE L'OUTIL/);
});
