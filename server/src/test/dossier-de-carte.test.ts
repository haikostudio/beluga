import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOSSIER_DES_CARTES,
  cheminDossierDeCarte,
  dossiersOrphelins,
  estDossierDeCarte,
  nomDeBranche,
  nomDuDossierDeCarte,
  porteDuDossier,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* Où travaille une carte                                              */
/* ------------------------------------------------------------------ */

test('le dossier d’une carte garde l’ancien nom de branche (quarante signes de titre)', () => {
  const titre = 'Afficher la taille des fichiers';
  assert.equal(nomDuDossierDeCarte(titre, 'aaaaaa11'), 'afficher-la-taille-des-fichiers-aaaaaa');
  // La branche neuve, elle, est plus courte.
  assert.equal(nomDeBranche(titre, 'aaaaaa11'), 'tache/afficher-la-taille-des-aaaaaa');
  assert.equal(
    cheminDossierDeCarte('/root/beluga', titre, 'aaaaaa11'),
    `/root/beluga/${DOSSIER_DES_CARTES}/afficher-la-taille-des-fichiers-aaaaaa`,
  );
});

test('une barre finale au projet ne double pas la barre du chemin', () => {
  assert.equal(
    cheminDossierDeCarte('/root/beluga/', 'Titre', 'bbbbbb22'),
    `/root/beluga/${DOSSIER_DES_CARTES}/titre-bbbbbb`,
  );
});

test('deux cartes différentes ne visent JAMAIS le même dossier', () => {
  const un = cheminDossierDeCarte('/root/beluga', 'Même titre', 'aaaaaa11');
  const deux = cheminDossierDeCarte('/root/beluga', 'Même titre', 'bbbbbb22');
  assert.notEqual(un, deux);
});

test('le rangement des cartes se reconnaît, le dossier du projet non', () => {
  assert.equal(estDossierDeCarte('/root/beluga', `/root/beluga/${DOSSIER_DES_CARTES}/titre-aaaaaa`), true);
  assert.equal(estDossierDeCarte('/root/beluga', '/root/beluga'), false);
  assert.equal(estDossierDeCarte('/root/beluga', '/root/autre/.worktrees/x'), false);
});

/* ------------------------------------------------------------------ */
/* La porte du dossier, maintenant que chaque carte a le sien          */
/* ------------------------------------------------------------------ */

test('deux cartes du même projet démarrent ensemble, chacune chez elle', () => {
  const racine = '/root/beluga';
  const un = { cardId: 'aaaaaa11', titre: 'Première', dossier: cheminDossierDeCarte(racine, 'Première', 'aaaaaa11') };
  const deux = { cardId: 'bbbbbb22', dossier: cheminDossierDeCarte(racine, 'Seconde', 'bbbbbb22') };
  assert.deepEqual(porteDuDossier(deux, [un]), { ok: true });
});

test('un agent resté dans le dossier du projet retient la carte qui le vise', () => {
  const racine = '/root/beluga';
  const ancien = { cardId: 'aaaaaa11', titre: 'Ancienne façon', dossier: racine };
  const verdict = porteDuDossier({ cardId: 'bbbbbb22', dossier: racine }, [ancien]);
  assert.equal(verdict.ok, false);
  assert.match(verdict.raison ?? '', /Ancienne façon/);
});

/* ------------------------------------------------------------------ */
/* Les dossiers laissés ouverts                                        */
/* ------------------------------------------------------------------ */

test('un dossier de carte que personne n’occupe est un orphelin', () => {
  const racine = '/root/beluga';
  const occupe = cheminDossierDeCarte(racine, 'En cours', 'aaaaaa11');
  const laisse = cheminDossierDeCarte(racine, 'Tour tué net', 'bbbbbb22');
  assert.deepEqual(dossiersOrphelins(racine, [racine, occupe, laisse], [occupe]), [laisse]);
});

test('le dossier du projet n’est jamais un orphelin', () => {
  assert.deepEqual(dossiersOrphelins('/root/beluga', ['/root/beluga'], []), []);
});

test('un dossier ouvert à la main, hors du rangement, n’est pas touché', () => {
  assert.deepEqual(dossiersOrphelins('/root/beluga', ['/tmp/hd-essai'], []), []);
});
