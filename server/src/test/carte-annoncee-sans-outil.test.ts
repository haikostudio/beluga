import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AVERTISSEMENT_SANS_CARTE,
  MIN_SIGNES_CARTE_COURTE,
  carteAnnonceeEnTexte,
  carteAnnonceeSansOutil,
  carteDecriteEnTexte,
  carteEcriteEnBloc,
  consigneDeCarteReelle,
  consigneDeDernierRappel,
  jugerDescription,
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

/* ------------------------------------------------------------------ */
/* Le trou n°1 : la carte RECOPIÉE en bloc, sans le moindre verbe       */
/* ------------------------------------------------------------------ */

/*
 * Relevé sur une vraie réponse gardée en base : aucune des annonces à verbe ne
 * s'y retrouve, et le premier filet ne se déclenchait donc même pas.
 */
const BLOC_REEL = `Je vais d'abord regarder ces images pour comprendre ce qu'il faut faire.

Parfait ! Je vois les 5 images : elles représentent les **formations principales**.

## **Carte proposée**

**Intégrer les images des formations dans la vitrine avec fonds transparents**

À faire : importer les 5 images dans le projet, retirer les fonds blancs, puis les brancher sur la vitrine (probablement la page d'accueil du catalogue). Test visuel : vérifier que chaque formation s'affiche avec sa vignette claire et sans débordements.

**Niveau :** Standard`;

test('une carte RECOPIÉE en bloc est reconnue, sans aucun verbe d’annonce', () => {
  assert.equal(carteEcriteEnBloc(BLOC_REEL), 'Carte proposée');
  assert.equal(carteAnnonceeEnTexte(BLOC_REEL), 'Carte proposée');
});

test('un bloc de champs nommés vaut une carte écrite', () => {
  const texte = ['**Titre** : Corriger le badge bleu', '**Description** : Il reste orange.', '**Niveau** : leger'].join('\n');
  assert.ok(carteEcriteEnBloc(texte));
});

test('une phrase qui NIE la carte n’est jamais prise pour une annonce', () => {
  for (const texte of [
    "Aucune carte n'est nécessaire ici : je réponds directement.",
    'Je ne propose pas de carte pour une simple question.',
    'Rien à créer ici, donc pas de carte.',
  ]) {
    assert.equal(carteAnnonceeEnTexte(texte), null, `« ${texte} » nie la carte, il ne l'annonce pas`);
  }
});

/* ------------------------------------------------------------------ */
/* Le trou n°2 : le démon relit la carte et appelle l'outil lui-même     */
/* ------------------------------------------------------------------ */

test('la carte écrite en bloc se relit : titre, description, niveau', () => {
  const relue = carteDecriteEnTexte(BLOC_REEL);
  assert.ok(relue, 'le bloc doit se relire');
  assert.equal(relue!.titre, 'Intégrer les images des formations dans la vitrine avec fonds transparents');
  assert.match(relue!.description, /importer les 5 images/);
  assert.equal(relue!.niveau, 'Standard');
  // Le niveau ne se redit pas dans la description : il part dans son champ.
  assert.doesNotMatch(relue!.description, /Niveau/);
});

test('la carte relue passe l’exigence de description de l’outil', () => {
  const relue = carteDecriteEnTexte(BLOC_REEL);
  assert.ok(jugerDescription(relue!.description, 'courte').ok);
  assert.ok(relue!.description.length >= MIN_SIGNES_CARTE_COURTE);
});

test('les champs nommés se relisent aussi, où qu’ils soient', () => {
  const texte = [
    'Voici ce que je te propose.',
    '',
    '**Titre** : Corriger le badge bleu du tableau',
    "**Description** : Le badge de la colonne « Terminé » reste orange alors qu'il devrait passer au bleu une fois la carte close.",
    '**Niveau** : leger',
  ].join('\n');
  const relue = carteDecriteEnTexte(texte);
  assert.equal(relue?.titre, 'Corriger le badge bleu du tableau');
  assert.match(relue!.description, /reste orange/);
  assert.equal(relue?.niveau, 'leger');
});

test('une annonce SANS carte décrite ne se relit pas : le démon n’invente rien', () => {
  assert.equal(carteDecriteEnTexte("J'ai créé la tâche « Corriger le badge bleu »."), null);
  assert.equal(carteDecriteEnTexte('Je propose une carte pour investiguer et réparer.'), null);
});

test('l’encadré d’avertissement ne peut pas devenir le titre de la carte relue', () => {
  const texte = `Carte proposée pour réparer ce manque de signal.${AVERTISSEMENT_SANS_CARTE}`;
  const relue = carteDecriteEnTexte(texte);
  assert.ok(!relue || !/WARNING/.test(relue.titre));
});

test('le dernier rappel dit le plancher de description et interdit le texte', () => {
  const consigne = consigneDeDernierRappel(MIN_SIGNES_CARTE_COURTE);
  assert.match(consigne, /board_create_card/);
  assert.match(consigne, new RegExp(String(MIN_SIGNES_CARTE_COURTE)));
  assert.match(consigne, /REFUS/i);
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
