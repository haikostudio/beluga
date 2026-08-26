import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PLAFOND_ANNONCES,
  ajouterAnnonce,
  annonceDoublonne,
  compteNonLues,
  genreDeLAnnonce,
  iconeDeLAnnonce,
  journalDesNotifications,
  marquerLues,
  titreDeLaDemande,
  type AnnonceRecue,
  type DecisionAttendue,
} from '@haikodev/shared';

const DEMANDES: DecisionAttendue[] = [
  {
    projectId: 'p1',
    agentId: 'a-carte',
    cardId: 'c1',
    genre: 'question',
    poseeA: 200,
    texte: 'Quelle couleur pour le bouton ?',
    projectName: 'Projet A',
    lieuTitre: 'Refonte du bandeau',
  },
  {
    projectId: 'p2',
    agentId: 'chef',
    genre: 'validation',
    poseeA: 100,
    texte: 'Faut-il garder la colonne ?',
    projectName: 'Projet B',
  },
];

const ANNONCES: AnnonceRecue[] = [
  { id: 'n1', titre: 'Tâche terminée', corps: 'La carte est rendue.', motif: 'tache-terminee', a: 500 },
  { id: 'n2', titre: 'Publication en échec', corps: 'La construction a cassé.', motif: 'publication-echec', a: 700 },
  { id: 'n3', titre: 'Quota', corps: '90 % atteints.', motif: 'quota-seuil', a: 600, lue: true },
];

/* ------------------------------------------------------------------ */
/* Les deux sources se réunissent, dans le bon ordre                    */
/* ------------------------------------------------------------------ */

test('les demandes ouvertes passent devant les annonces, même plus récentes', () => {
  const lignes = journalDesNotifications(DEMANDES, ANNONCES);
  assert.equal(lignes.length, 5);
  assert.deepEqual(
    lignes.map((l) => l.source),
    ['demande', 'demande', 'annonce', 'annonce', 'annonce'],
  );
  // La plus ANCIENNE demande en tête : c'est elle qui bloque depuis le plus longtemps.
  assert.equal(lignes[0].texte, 'Faut-il garder la colonne ?');
  // Les annonces, elles, vont de la plus récente à la plus ancienne.
  assert.deepEqual(
    lignes.slice(2).map((l) => l.titre),
    ['Publication en échec', 'Quota', 'Tâche terminée'],
  );
});

test('une ligne née d’une demande nomme son projet et son endroit', () => {
  const lignes = journalDesNotifications(DEMANDES, []);
  const carte = lignes.find((l) => l.demande?.cardId === 'c1');
  assert.equal(carte?.titre, 'Projet A · Refonte du bandeau');
  assert.equal(carte?.lieu.cardId, 'c1');
  assert.equal(carte?.genre, 'attente');
});

test('un projet sans nom retombe sur le mot par défaut', () => {
  assert.equal(titreDeLaDemande({ projectId: 'p', genre: 'question' }, 'Projet'), 'Projet');
  assert.equal(
    titreDeLaDemande({ projectId: 'p', genre: 'question', projectName: 'A', lieuTitre: 'Carte' }, 'Projet'),
    'A · Carte',
  );
});

test('une demande sans texte porte quand même une phrase', () => {
  const [ligne] = journalDesNotifications([{ projectId: 'p', genre: 'question', poseeA: 1 }], []);
  assert.equal(ligne.texte, 'Une décision est attendue.');
});

/* ------------------------------------------------------------------ */
/* Une annonce ne redit jamais une demande déjà listée                  */
/* ------------------------------------------------------------------ */

test('l’annonce « décision attendue » qui double une demande ouverte ne s’ajoute pas', () => {
  const double: AnnonceRecue = {
    id: 'n4',
    titre: 'Une réponse est attendue',
    corps: 'Quelle couleur pour le bouton ?',
    motif: 'decision-attendue',
    a: 900,
    cardId: 'c1',
  };
  assert.equal(annonceDoublonne(double, DEMANDES), true);
  const lignes = journalDesNotifications(DEMANDES, [...ANNONCES, double]);
  assert.equal(lignes.filter((l) => l.texte === 'Quelle couleur pour le bouton ?').length, 1);
});

test('la même annonce reste quand la demande a été réglée', () => {
  const double: AnnonceRecue = {
    id: 'n4',
    titre: 'Une réponse est attendue',
    corps: 'Question réglée depuis.',
    motif: 'decision-attendue',
    a: 900,
    cardId: 'c1',
  };
  assert.equal(annonceDoublonne(double, []), false);
  assert.equal(journalDesNotifications([], [double]).length, 1);
});

test('une annonce qui n’est pas une attente n’est jamais un doublon', () => {
  const finie: AnnonceRecue = { id: 'n5', titre: 'Fini', corps: '', motif: 'tache-terminee', a: 1, cardId: 'c1' };
  assert.equal(annonceDoublonne(finie, DEMANDES), false);
});

/* ------------------------------------------------------------------ */
/* Genre et image d'une annonce                                         */
/* ------------------------------------------------------------------ */

test('le genre et l’image suivent le motif, et un motif inconnu ne casse rien', () => {
  assert.equal(genreDeLAnnonce('tache-echec'), 'erreur');
  assert.equal(genreDeLAnnonce('decision-attendue'), 'attente');
  assert.equal(genreDeLAnnonce(undefined), 'termine');
  assert.equal(genreDeLAnnonce('motif-jamais-vu'), 'termine');
  assert.equal(iconeDeLAnnonce('publication-terminee'), 'publication');
  assert.equal(iconeDeLAnnonce('motif-jamais-vu'), 'termine');
  assert.equal(iconeDeLAnnonce(undefined), 'termine');
});

/* ------------------------------------------------------------------ */
/* La pastille, l'ajout et la lecture                                   */
/* ------------------------------------------------------------------ */

test('la pastille compte les demandes ouvertes plus les annonces jamais lues', () => {
  // Deux demandes + deux annonces non lues (la troisième est déjà lue).
  assert.equal(compteNonLues(DEMANDES, ANNONCES), 4);
  assert.equal(compteNonLues([], ANNONCES), 2);
  assert.equal(compteNonLues([], marquerLues(ANNONCES)), 0);
  assert.equal(compteNonLues([], []), 0);
});

test('une annonce arrive en tête, et la liste ne dépasse jamais son plafond', () => {
  const pleine: AnnonceRecue[] = Array.from({ length: PLAFOND_ANNONCES }, (_, i) => ({
    id: `v${i}`,
    titre: 'Ancienne',
    corps: '',
    a: i,
  }));
  const suite = ajouterAnnonce(pleine, { id: 'neuve', titre: 'Neuve', corps: '', a: 1000 });
  assert.equal(suite.length, PLAFOND_ANNONCES);
  assert.equal(suite[0].id, 'neuve');
  assert.equal(
    suite.some((a) => a.id === `v${PLAFOND_ANNONCES - 1}`),
    false,
  );
});

test('marquer lues ne touche pas aux demandes, qui se règlent au lieu de se lire', () => {
  const lues = marquerLues(ANNONCES);
  assert.equal(
    lues.every((a) => a.lue),
    true,
  );
  assert.equal(compteNonLues(DEMANDES, lues), 2);
});

test('l’affichage tient au-delà du plafond d’annonces', () => {
  const beaucoup: AnnonceRecue[] = Array.from({ length: PLAFOND_ANNONCES + 20 }, (_, i) => ({
    id: `v${i}`,
    titre: `Annonce ${i}`,
    corps: '',
    a: i,
  }));
  const lignes = journalDesNotifications([], beaucoup);
  assert.equal(lignes.length, PLAFOND_ANNONCES);
  assert.equal(lignes[0].titre, `Annonce ${PLAFOND_ANNONCES + 19}`);
});
