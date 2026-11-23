import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RAISON_SANS_DEPOT,
  RAISON_DOSSIER_INJOIGNABLE,
  brancheRefermableALArchivage,
  memeDossier,
  nomDeBranche,
  porteDuDepot,
  porteDuDossier,
  nomDuDossierDeLaCopie,
  titreDeBranche,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* Le nom de branche                                                   */
/* ------------------------------------------------------------------ */

test('une carte donne une branche « tache/… » lisible', () => {
  assert.equal(
    nomDeBranche('Root : aucune branche de carte n’est créée', '10663bAA'),
    'tache/root-aucune-branche-de-10663b',
  );
});

test('le titre d’une branche tient en 24 signes, coupé entre deux mots, sans tiret final', () => {
  assert.equal(titreDeBranche('Double entête tablette et infobulles'), 'double-entete-tablette');
  assert.equal(titreDeBranche('Réparer l’écran « Échéance » !'), 'reparer-l-ecran-echeance');
  // Un mot plus long que la limite se coupe où il est.
  assert.equal(titreDeBranche('Anticonstitutionnellement parlant'), 'anticonstitutionnellement'.slice(0, 24));
  // Une coupe qui tombe pile sur un tiret n'en laisse pas.
  assert.equal(titreDeBranche('abcdefghijklmnopqrstuvwx yz'), 'abcdefghijklmnopqrstuvwx');
  assert.ok(nomDeBranche('Un titre extrêmement long pour une carte qui en dit beaucoup trop', 'abcdef12').length <= 'tache/'.length + 24 + 7);
});

test('le dossier de la copie garde ses quarante signes de titre', () => {
  assert.equal(
    nomDuDossierDeLaCopie('Root : aucune branche de carte n’est créée', '10663bAA'),
    'root-aucune-branche-de-carte-n-est-creee-10663b',
  );
});

test('un titre sans une seule lettre garde au moins le numéro', () => {
  assert.equal(nomDeBranche('!!! ???', 'abcdef12'), 'tache/sans-titre-abcdef');
});

/* ------------------------------------------------------------------ */
/* La porte du dépôt                                                   */
/* ------------------------------------------------------------------ */

test('un projet sans dépôt git ne lance pas de carte', () => {
  const verdict = porteDuDepot(false);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.raison, RAISON_SANS_DEPOT);
});

test('un projet sur un dépôt git passe', () => {
  assert.deepEqual(porteDuDepot(true), { ok: true });
  assert.deepEqual(porteDuDepot('depot'), { ok: true });
});

test('un dossier injoignable est une panne, pas un projet mal déclaré', () => {
  const verdict = porteDuDepot('injoignable');
  assert.equal(verdict.ok, false);
  assert.equal(verdict.raison, RAISON_DOSSIER_INJOIGNABLE);
  assert.notEqual(verdict.raison, RAISON_SANS_DEPOT);
});

test('un dossier présent mais sans dépôt garde la phrase du réglage', () => {
  assert.equal(porteDuDepot('sans-depot').raison, RAISON_SANS_DEPOT);
});

/* ------------------------------------------------------------------ */
/* La porte du dossier partagé                                         */
/* ------------------------------------------------------------------ */

test('deux cartes ne se partagent pas la même copie de travail', () => {
  const verdict = porteDuDossier(
    { cardId: 'carte-2', dossier: '/root/projet-exemple' },
    [{ cardId: 'carte-1', titre: 'Taille des fichiers', dossier: '/root/projet-exemple' }],
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.raison ?? '', /Taille des fichiers/);
  assert.match(verdict.raison ?? '', /dès que l'autre aura rendu/);
});

test('une barre finale ne fait pas croire à deux dossiers différents', () => {
  const verdict = porteDuDossier(
    { cardId: 'carte-2', dossier: '/root/projet-exemple' },
    [{ cardId: 'carte-1', dossier: '/root/projet-exemple/' }],
  );
  assert.equal(verdict.ok, false);
});

test('un agent occupé AILLEURS ne retient personne', () => {
  const verdict = porteDuDossier(
    { cardId: 'carte-2', dossier: '/root/projet-exemple' },
    [{ cardId: 'carte-1', dossier: '/root/beluga' }],
  );
  assert.deepEqual(verdict, { ok: true });
});

test('la carte ne se bloque pas elle-même (relance du même travail)', () => {
  const verdict = porteDuDossier(
    { cardId: 'carte-1', dossier: '/root/projet-exemple' },
    [{ cardId: 'carte-1', dossier: '/root/projet-exemple' }],
  );
  assert.deepEqual(verdict, { ok: true });
});

test('sans personne dans le dossier, la porte est ouverte', () => {
  assert.deepEqual(porteDuDossier({ cardId: 'carte-1', dossier: '/root/beluga' }, []), { ok: true });
});

test('deux dossiers vides ne sont jamais « le même dossier »', () => {
  assert.equal(memeDossier('', ''), false);
  assert.equal(memeDossier(undefined, undefined), false);
  assert.equal(memeDossier('/root/beluga ', '/root/beluga'), true);
});

/* ------------------------------------------------------------------ */
/* La refermeture de branche à l'archivage                             */
/* ------------------------------------------------------------------ */

test("l'archivage referme la branche d'une carte", () => {
  assert.equal(brancheRefermableALArchivage('tache/reviser-les-readme-d7ca35'), true);
});

test("l'archivage ne referme JAMAIS la branche principale du dépôt", () => {
  // Le travail hors tâche (rangement de nuit, travaux enregistrés) porte la
  // branche principale : la renommer coupait son amont et bloquait tout push.
  for (const principale of ['main', 'master', 'dev']) {
    assert.equal(brancheRefermableALArchivage(principale), false, principale);
  }
});

test('une branche déjà refermée ne se referme pas deux fois', () => {
  assert.equal(brancheRefermableALArchivage('archive/tache/quelque-chose-ab12cd'), false);
  assert.equal(brancheRefermableALArchivage('archive/main'), false);
  assert.equal(brancheRefermableALArchivage('archive/archive/main'), false);
});

test('une branche absente ou vide ne déclenche aucun renommage', () => {
  assert.equal(brancheRefermableALArchivage(undefined), false);
  assert.equal(brancheRefermableALArchivage(null), false);
  assert.equal(brancheRefermableALArchivage('   '), false);
});
