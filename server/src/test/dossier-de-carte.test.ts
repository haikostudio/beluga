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
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Où travaille une carte                                              */
/* ------------------------------------------------------------------ */

test('le dossier d’une carte porte le nom de sa branche', () => {
  const titre = 'Afficher la taille des fichiers';
  assert.equal(nomDuDossierDeCarte(titre, 'aaaaaa11'), nomDeBranche(titre, 'aaaaaa11').slice('tache/'.length));
  assert.equal(
    cheminDossierDeCarte('/root/haikodev', titre, 'aaaaaa11'),
    `/root/haikodev/${DOSSIER_DES_CARTES}/afficher-la-taille-des-fichiers-aaaaaa`,
  );
});

test('une barre finale au projet ne double pas la barre du chemin', () => {
  assert.equal(
    cheminDossierDeCarte('/root/haikodev/', 'Titre', 'bbbbbb22'),
    `/root/haikodev/${DOSSIER_DES_CARTES}/titre-bbbbbb`,
  );
});

test('deux cartes différentes ne visent JAMAIS le même dossier', () => {
  const un = cheminDossierDeCarte('/root/haikodev', 'Même titre', 'aaaaaa11');
  const deux = cheminDossierDeCarte('/root/haikodev', 'Même titre', 'bbbbbb22');
  assert.notEqual(un, deux);
});

test('le rangement des cartes se reconnaît, le dossier du projet non', () => {
  assert.equal(estDossierDeCarte('/root/haikodev', `/root/haikodev/${DOSSIER_DES_CARTES}/titre-aaaaaa`), true);
  assert.equal(estDossierDeCarte('/root/haikodev', '/root/haikodev'), false);
  assert.equal(estDossierDeCarte('/root/haikodev', '/root/autre/.worktrees/x'), false);
});

/* ------------------------------------------------------------------ */
/* La porte du dossier, maintenant que chaque carte a le sien          */
/* ------------------------------------------------------------------ */

test('deux cartes du même projet démarrent ensemble, chacune chez elle', () => {
  const racine = '/root/haikodev';
  const un = { cardId: 'aaaaaa11', titre: 'Première', dossier: cheminDossierDeCarte(racine, 'Première', 'aaaaaa11') };
  const deux = { cardId: 'bbbbbb22', dossier: cheminDossierDeCarte(racine, 'Seconde', 'bbbbbb22') };
  assert.deepEqual(porteDuDossier(deux, [un]), { ok: true });
});

test('un agent resté dans le dossier du projet retient la carte qui le vise', () => {
  const racine = '/root/haikodev';
  const ancien = { cardId: 'aaaaaa11', titre: 'Ancienne façon', dossier: racine };
  const verdict = porteDuDossier({ cardId: 'bbbbbb22', dossier: racine }, [ancien]);
  assert.equal(verdict.ok, false);
  assert.match(verdict.raison ?? '', /Ancienne façon/);
});

/* ------------------------------------------------------------------ */
/* Les dossiers laissés ouverts                                        */
/* ------------------------------------------------------------------ */

test('un dossier de carte que personne n’occupe est un orphelin', () => {
  const racine = '/root/haikodev';
  const occupe = cheminDossierDeCarte(racine, 'En cours', 'aaaaaa11');
  const laisse = cheminDossierDeCarte(racine, 'Tour tué net', 'bbbbbb22');
  assert.deepEqual(dossiersOrphelins(racine, [racine, occupe, laisse], [occupe]), [laisse]);
});

test('le dossier du projet n’est jamais un orphelin', () => {
  assert.deepEqual(dossiersOrphelins('/root/haikodev', ['/root/haikodev'], []), []);
});

test('un dossier ouvert à la main, hors du rangement, n’est pas touché', () => {
  assert.deepEqual(dossiersOrphelins('/root/haikodev', ['/tmp/hd-essai'], []), []);
});
