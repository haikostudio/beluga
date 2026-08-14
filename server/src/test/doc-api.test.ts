import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PREFIXE_CLE_API,
  ROUTE_CARTE_EXTERNE,
  ROUTE_DOC_API,
  TITRE_EXTERNE_MIN,
  documentationApi,
  pageDocApi,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* LE MODE D'EMPLOI PUBLIC DE LA PORTE D'ENTRÉE                         */
/*                                                                      */
/* Ce qui compte : l'adresse est bien `/api`, la documentation dit       */
/* l'adresse RÉELLE à appeler avec la racine du serveur, elle NAÎT des   */
/* mêmes constantes que la porte (elle ne peut donc pas mentir), et une  */
/* page servie telle quelle n'ouvre rien de ce qu'on y écrit.           */
/* ------------------------------------------------------------------ */

test('la documentation vit à /api, en dehors de la porte des cartes', () => {
  assert.equal(ROUTE_DOC_API, '/api');
  assert.notEqual(ROUTE_DOC_API, ROUTE_CARTE_EXTERNE);
});

test('elle donne l’adresse complète quand la racine est connue', () => {
  const doc = documentationApi('https://haiko.exemple');
  assert.equal(doc.adresse, `https://haiko.exemple${ROUTE_CARTE_EXTERNE}`);
  assert.equal(doc.chemin, ROUTE_CARTE_EXTERNE);
  assert.equal(doc.methode, 'POST');
});

test('une racine avec barre finale ne fabrique pas une adresse à double barre', () => {
  assert.equal(documentationApi('https://haiko.exemple/').adresse, `https://haiko.exemple${ROUTE_CARTE_EXTERNE}`);
});

test('sans racine, elle rend le seul chemin — utilisable tel quel', () => {
  assert.equal(documentationApi().adresse, ROUTE_CARTE_EXTERNE);
});

test('les champs documentés sont ceux que la porte accepte vraiment, alias compris', () => {
  const doc = documentationApi();
  const noms = doc.champs.map((c) => c.nom);
  assert.deepEqual(noms, ['projet', 'titre', 'description', 'etiquettes']);

  const projet = doc.champs.find((c) => c.nom === 'projet')!;
  assert.equal(projet.obligatoire, true);
  assert.ok(projet.alias.includes('project'));

  const titre = doc.champs.find((c) => c.nom === 'titre')!;
  assert.equal(titre.obligatoire, true);
  assert.ok(titre.description.includes(String(TITRE_EXTERNE_MIN)), 'les bornes viennent des constantes');

  assert.equal(doc.champs.find((c) => c.nom === 'description')!.obligatoire, false);
});

test('les refus documentés couvrent ceux que le serveur rend', () => {
  const statuts = documentationApi().refus.map((r) => r.statut);
  for (const attendu of [400, 401, 403, 404, 405, 409]) {
    assert.ok(statuts.includes(attendu), `le refus ${attendu} doit être documenté`);
  }
});

test('l’invariant qui compte est écrit noir sur blanc : rien ne part au moteur', () => {
  const doc = documentationApi();
  assert.ok(doc.invariants.some((i) => i.includes('Planifié')));
  assert.ok(doc.invariants.some((i) => i.toLowerCase().includes('moteur')));
});

test('la page est du HTML complet, qui montre l’appel et jamais une clé entière', () => {
  const html = pageDocApi('https://haiko.exemple');
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes(`https://haiko.exemple${ROUTE_CARTE_EXTERNE}`));
  assert.ok(html.includes('x-haikodev-cle'));
  assert.ok(html.includes(`${PREFIXE_CLE_API}…`), 'seul le préfixe est montré, jamais un secret');
  assert.ok(!html.includes('<script'), 'aucune exécution : la page est du texte');
});

test('ce qui est interpolé dans la page est échappé', () => {
  const html = pageDocApi('https://exemple.tld/<script>alert(1)</script>');
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
