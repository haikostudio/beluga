/**
 * LES FILTRES DU TABLEAU COMMUN — les règles pures (`shared/src/filtres-du-tableau.ts`).
 *
 * Ce que ces essais verrouillent : la recherche ignore accents et majuscules et exige chaque mot ; un choix
 * retient les valeurs cochées, y compris dans une colonne à plusieurs étiquettes ; les filtres se cumulent ;
 * un filtre vide ne filtre pas ; une valeur cochée disparue reste décochable ; la signature ne dépend ni de
 * l'ordre des colonnes ni de la casse.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { basculerUnChoix, ecrireUnTexte, filtrerLesLignes, nombreDeFiltresActifs, ligneRetenueParLeFiltre, signatureDesFiltres, valeursDuChoix } from '@beluga/shared';

interface Ligne {
  titre: string;
  genre: string;
  etiquettes: string[];
}

const LIGNES: Ligne[] = [
  { titre: 'Vidéo de l’Été', genre: 'video', etiquettes: ['instagram', 'tiktok'] },
  { titre: 'Affiche été', genre: 'image', etiquettes: ['instagram'] },
  { titre: 'Jingle', genre: 'son', etiquettes: [] },
];
const LECTEURS = { titre: (l: Ligne) => l.titre, genre: (l: Ligne) => l.genre, etiquettes: (l: Ligne) => l.etiquettes };

test('la recherche ignore accents et majuscules, et exige chaque mot', () => {
  assert.deepEqual(filtrerLesLignes(LIGNES, { titre: { genre: 'texte', texte: 'ETE' } }, LECTEURS).map((l) => l.genre), ['video', 'image']);
  assert.deepEqual(filtrerLesLignes(LIGNES, { titre: { genre: 'texte', texte: 'video ete' } }, LECTEURS).map((l) => l.genre), ['video']);
  assert.equal(ligneRetenueParLeFiltre(null, { genre: 'texte', texte: 'x' }), false);
});

test('un choix retient les valeurs cochées, même parmi plusieurs étiquettes', () => {
  assert.deepEqual(filtrerLesLignes(LIGNES, { genre: { genre: 'choix', valeurs: ['son', 'image'] } }, LECTEURS).map((l) => l.titre), ['Affiche été', 'Jingle']);
  assert.deepEqual(filtrerLesLignes(LIGNES, { etiquettes: { genre: 'choix', valeurs: ['tiktok'] } }, LECTEURS).map((l) => l.genre), ['video']);
});

test('les filtres se cumulent, et la recherche d’ensemble lit toutes les colonnes', () => {
  assert.deepEqual(filtrerLesLignes(LIGNES, { genre: { genre: 'choix', valeurs: ['video', 'image'] }, etiquettes: { genre: 'choix', valeurs: ['instagram'] } }, LECTEURS, 'affiche').map((l) => l.genre), ['image']);
  assert.deepEqual(filtrerLesLignes(LIGNES, {}, LECTEURS, 'tiktok').map((l) => l.genre), ['video']);
});

test('un filtre vide ne filtre pas, et disparaît des filtres', () => {
  assert.equal(filtrerLesLignes(LIGNES, { titre: { genre: 'texte', texte: '  ' }, genre: { genre: 'choix', valeurs: [] } }, LECTEURS).length, 3);
  assert.deepEqual(ecrireUnTexte({ titre: { genre: 'texte', texte: 'a' } }, 'titre', ''), {});
  const coche = basculerUnChoix({}, 'genre', 'son');
  assert.equal(nombreDeFiltresActifs(coche), 1);
  assert.deepEqual(basculerUnChoix(coche, 'genre', 'son'), {});
});

test('les valeurs d’un choix : présentes, comptées, triées, et la cochée disparue reste proposée', () => {
  assert.deepEqual(valeursDuChoix(LIGNES, LECTEURS.etiquettes, ['youtube'], 'fr'), [
    { valeur: 'instagram', nombre: 2 },
    { valeur: 'tiktok', nombre: 1 },
    { valeur: 'youtube', nombre: 0 },
  ]);
});

test('la signature ne dépend ni de l’ordre des colonnes ni de la casse', () => {
  const a = signatureDesFiltres({ titre: { genre: 'texte', texte: 'Été' }, genre: { genre: 'choix', valeurs: ['b', 'a'] } }, ' X ');
  const b = signatureDesFiltres({ genre: { genre: 'choix', valeurs: ['a', 'b'] }, titre: { genre: 'texte', texte: 'ete' } }, 'x');
  assert.equal(a, b);
  assert.notEqual(a, signatureDesFiltres({}));
});
