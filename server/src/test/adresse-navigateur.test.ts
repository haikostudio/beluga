import test from 'node:test';
import assert from 'node:assert/strict';
import {
  construireFragment,
  lireFragment,
  memeEcran,
  slugTitre,
} from '@haikodev/shared';

const CARTE = '0073bde7-0ef0-4fd6-be06-6d53e1e823c8';
const PROJET = 'projet-42';

/* ------------------------------------------------------------------ */
/* Construire le fragment d'adresse depuis l'écran courant             */
/* ------------------------------------------------------------------ */

test('chaque écran a son fragment', () => {
  assert.equal(construireFragment({ vue: 'accueil' }), '');
  assert.equal(construireFragment({ vue: 'reglages' }), 'reglages');
  assert.equal(construireFragment({ vue: 'tableau-de-bord' }), 'tableau-de-bord');
  assert.equal(construireFragment({ vue: 'projet', projectId: PROJET }), 'projet/projet-42');
});

test('une carte ouverte ajoute son identifiant puis le slug du titre', () => {
  const fragment = construireFragment({
    vue: 'projet',
    projectId: PROJET,
    cardId: CARTE,
    titreCarte: 'Adresse du navigateur avec # pour chaque écran',
  });
  assert.equal(fragment, `projet/projet-42/tache/${CARTE}-adresse-du-navigateur-avec-pour-chaque-ecran`);
});

test('sans titre, la carte ne porte que son identifiant', () => {
  const fragment = construireFragment({ vue: 'projet', projectId: PROJET, cardId: CARTE });
  assert.equal(fragment, `projet/projet-42/tache/${CARTE}`);
});

/* ------------------------------------------------------------------ */
/* Relire un fragment d'adresse                                        */
/* ------------------------------------------------------------------ */

test('le « # » de tête et son absence donnent le même écran', () => {
  assert.deepEqual(lireFragment('#reglages'), { vue: 'reglages' });
  assert.deepEqual(lireFragment('reglages'), { vue: 'reglages' });
  assert.deepEqual(lireFragment('#tableau-de-bord'), { vue: 'tableau-de-bord' });
});

test('un fragment vide, inconnu ou abîmé ramène à l accueil', () => {
  assert.deepEqual(lireFragment(''), { vue: 'accueil' });
  assert.deepEqual(lireFragment('#'), { vue: 'accueil' });
  assert.deepEqual(lireFragment('#nimportequoi'), { vue: 'accueil' });
  assert.deepEqual(lireFragment('#projet'), { vue: 'accueil' });
});

test('le projet et la carte se relisent, slug jeté', () => {
  assert.deepEqual(lireFragment('#projet/projet-42'), { vue: 'projet', projectId: PROJET });
  assert.deepEqual(lireFragment(`#projet/projet-42/tache/${CARTE}-vieux-titre`), {
    vue: 'projet',
    projectId: PROJET,
    cardId: CARTE,
  });
});

test('l identifiant reste la clé : un slug modifié pointe la même carte', () => {
  const a = lireFragment(`#projet/projet-42/tache/${CARTE}-un-titre`);
  const b = lireFragment(`#projet/projet-42/tache/${CARTE}-autre-titre`);
  assert.equal(a.vue === 'projet' && a.cardId, CARTE);
  assert.equal(b.vue === 'projet' && b.cardId, CARTE);
});

/* ------------------------------------------------------------------ */
/* Aller-retour et comparaison d'écrans                                */
/* ------------------------------------------------------------------ */

test('construire puis relire retrouve l écran, slug compris', () => {
  const ecran = { vue: 'projet', projectId: PROJET, cardId: CARTE, titreCarte: 'Mon Titre' } as const;
  const relu = lireFragment('#' + construireFragment(ecran));
  assert.deepEqual(relu, { vue: 'projet', projectId: PROJET, cardId: CARTE });
});

test('memeEcran ignore le slug mais distingue les identifiants', () => {
  assert.ok(
    memeEcran(
      { vue: 'projet', projectId: PROJET, cardId: CARTE, titreCarte: 'A' },
      { vue: 'projet', projectId: PROJET, cardId: CARTE },
    ),
  );
  assert.ok(!memeEcran({ vue: 'projet', projectId: PROJET }, { vue: 'projet', projectId: 'autre' }));
  assert.ok(!memeEcran({ vue: 'reglages' }, { vue: 'tableau-de-bord' }));
});

test('le slug retire accents et ponctuation, borne la longueur', () => {
  assert.equal(slugTitre('Été à Zürich !'), 'ete-a-zurich');
  assert.equal(slugTitre('  ---  '), '');
  assert.ok(slugTitre('x'.repeat(200)).length <= 60);
});
