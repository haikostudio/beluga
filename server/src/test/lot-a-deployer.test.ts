import test from 'node:test';
import assert from 'node:assert/strict';
import { carteBloqueeDansLeLot, dateDeMiseEnLignePerimee, raisonLotBloque } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* La DATE DE MISE EN LIGNE périmée : le bogue du « Tout déployer » muet */
/* ------------------------------------------------------------------ */

test('une carte repassée de « En production » à « À déployer » perd sa date', () => {
  assert.equal(dateDeMiseEnLignePerimee('in_production', 'to_deploy'), true);
});

test('une carte qui revient de « Terminé » vers « À déployer » perd sa date', () => {
  // Le cas réel : la carte avait été déployée, elle a été retravaillée, puis
  // reposée dans le lot. Sa vieille date l'écartait de tous les lots suivants.
  assert.equal(dateDeMiseEnLignePerimee('done', 'to_deploy'), true);
});

test('une carte qui QUITTE « À déployer » garde sa date de mise en ligne', () => {
  assert.equal(dateDeMiseEnLignePerimee('to_deploy', 'in_production'), false);
  assert.equal(dateDeMiseEnLignePerimee('to_deploy', 'archived'), false);
  assert.equal(dateDeMiseEnLignePerimee('to_deploy', 'done'), false);
});

test('un rangement sur place ne périme rien', () => {
  assert.equal(dateDeMiseEnLignePerimee('to_deploy', 'to_deploy'), false);
});

test('une carte posée dans « À déployer » avec une date est bloquée', () => {
  assert.equal(carteBloqueeDansLeLot({ column: 'to_deploy', deployedAt: 1 }), true);
  assert.equal(carteBloqueeDansLeLot({ column: 'to_deploy' }), false);
  // « En production » porte forcément une date : elle n'a rien de bloquant.
  assert.equal(carteBloqueeDansLeLot({ column: 'in_production', deployedAt: 1 }), false);
});

/* ------------------------------------------------------------------ */
/* Le bouton éteint DIT pourquoi                                       */
/* ------------------------------------------------------------------ */

test('un lot prêt à partir n’a rien à expliquer', () => {
  assert.equal(raisonLotBloque({ verbe: 'déployer', aPublier: 2, cartesDansLaColonne: 2 }), null);
});

test('le lien coupé passe devant tout', () => {
  const raison = raisonLotBloque({
    verbe: 'déployer',
    aPublier: 3,
    cartesDansLaColonne: 3,
    horsLigne: true,
    autrePublication: true,
  });
  assert.match(raison ?? '', /lien avec le serveur est coupé/);
});

test('une mise en production sans prompt rend sa propre phrase', () => {
  const raison = raisonLotBloque({
    verbe: 'publier',
    aPublier: 4,
    cartesDansLaColonne: 4,
    productionBloquee: 'Aucun prompt de mise en production n’est réglé pour ce projet.',
    autrePublication: true,
  });
  assert.equal(raison, 'Aucun prompt de mise en production n’est réglé pour ce projet.');
});

test('une publication déjà en cours passe devant les agents', () => {
  const raison = raisonLotBloque({
    verbe: 'déployer',
    aPublier: 1,
    cartesDansLaColonne: 1,
    autrePublication: true,
    agentsOccupes: ['refonte du tableau'],
  });
  assert.match(raison ?? '', /déjà en cours/);
});

test('un agent au travail est nommé', () => {
  const raison = raisonLotBloque({
    verbe: 'déployer',
    aPublier: 1,
    cartesDansLaColonne: 1,
    agentsOccupes: ['refonte du tableau'],
  });
  assert.match(raison ?? '', /refonte du tableau/);
});

test('des cartes présentes mais toutes écartées : la cause est nommée', () => {
  // Exactement le bogue constaté : deux cartes dans la colonne, lot vide.
  const raison = raisonLotBloque({ verbe: 'déployer', aPublier: 0, cartesDansLaColonne: 2 });
  assert.match(raison ?? '', /2 cartes sont dans cette colonne/);
  assert.match(raison ?? '', /date de mise en ligne/);
});

test('une colonne vraiment vide le dit simplement', () => {
  const raison = raisonLotBloque({ verbe: 'déployer', aPublier: 0, cartesDansLaColonne: 0 });
  assert.match(raison ?? '', /Rien à déployer/);
});

test('le verbe suit l’étape', () => {
  const raison = raisonLotBloque({ verbe: 'publier', aPublier: 0, cartesDansLaColonne: 0 });
  assert.match(raison ?? '', /Rien à publier/);
});
