import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RAISON_SANS_DEPOT,
  memeDossier,
  nomDeBranche,
  porteDuDepot,
  porteDuDossier,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Le nom de branche                                                   */
/* ------------------------------------------------------------------ */

test('une carte donne une branche « tache/… » lisible', () => {
  assert.equal(
    nomDeBranche('Root : aucune branche de carte n’est créée', '10663bAA'),
    'tache/root-aucune-branche-de-carte-n-est-creee-10663b',
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
});

/* ------------------------------------------------------------------ */
/* La porte du dossier partagé                                         */
/* ------------------------------------------------------------------ */

test('deux cartes ne se partagent pas la même copie de travail', () => {
  const verdict = porteDuDossier(
    { cardId: 'carte-2', dossier: '/home/paseo/rsd-work' },
    [{ cardId: 'carte-1', titre: 'Taille des fichiers', dossier: '/home/paseo/rsd-work' }],
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.raison ?? '', /Taille des fichiers/);
  assert.match(verdict.raison ?? '', /dès que l'autre aura rendu/);
});

test('une barre finale ne fait pas croire à deux dossiers différents', () => {
  const verdict = porteDuDossier(
    { cardId: 'carte-2', dossier: '/home/paseo/rsd-work' },
    [{ cardId: 'carte-1', dossier: '/home/paseo/rsd-work/' }],
  );
  assert.equal(verdict.ok, false);
});

test('un agent occupé AILLEURS ne retient personne', () => {
  const verdict = porteDuDossier(
    { cardId: 'carte-2', dossier: '/home/paseo/rsd-work' },
    [{ cardId: 'carte-1', dossier: '/root/haikodev' }],
  );
  assert.deepEqual(verdict, { ok: true });
});

test('la carte ne se bloque pas elle-même (relance du même travail)', () => {
  const verdict = porteDuDossier(
    { cardId: 'carte-1', dossier: '/home/paseo/rsd-work' },
    [{ cardId: 'carte-1', dossier: '/home/paseo/rsd-work' }],
  );
  assert.deepEqual(verdict, { ok: true });
});

test('sans personne dans le dossier, la porte est ouverte', () => {
  assert.deepEqual(porteDuDossier({ cardId: 'carte-1', dossier: '/root/haikodev' }, []), { ok: true });
});

test('deux dossiers vides ne sont jamais « le même dossier »', () => {
  assert.equal(memeDossier('', ''), false);
  assert.equal(memeDossier(undefined, undefined), false);
  assert.equal(memeDossier('/root/haikodev ', '/root/haikodev'), true);
});
