import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPARATIONS_MAX,
  objetsCitesDansLErreur,
  raisonApresReparations,
  reconnaitrePanneDeDossier,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Reconnaître la panne au message de git                              */
/* ------------------------------------------------------------------ */

test('une branche déjà là se REPREND, elle ne se recrée pas', () => {
  const panne = reconnaitrePanneDeDossier("fatal: a branch named 'tache/titre-aaaaaa' already exists");
  assert.equal(panne?.panne, 'branche-deja-la');
  assert.deepEqual(panne?.gestes, ['attacher-la-branche']);
});

test('une branche encore sortie ailleurs se libère', () => {
  const panne = reconnaitrePanneDeDossier(
    "fatal: 'tache/titre-aaaaaa' is already checked out at '/root/projet/.worktrees/titre-aaaaaa'",
  );
  assert.equal(panne?.panne, 'branche-prise-ailleurs');
  assert.deepEqual(panne?.gestes, ['ranger-les-copies', 'liberer-la-branche']);
});

test('un dossier encombré se retire avant de réessayer', () => {
  const panne = reconnaitrePanneDeDossier("fatal: '/root/projet/.worktrees/titre-aaaaaa' already exists");
  assert.equal(panne?.panne, 'dossier-encombre');
  assert.equal(panne?.gestes[0], 'retirer-le-dossier');
});

test('un verrou oublié se reconnaît avant tout le reste', () => {
  const panne = reconnaitrePanneDeDossier(
    "fatal: Unable to create '/root/projet/.git/index.lock': File exists.\n\nAnother git process seems to be running",
  );
  assert.equal(panne?.panne, 'verrou-oublie');
  assert.deepEqual(panne?.gestes, ['retirer-le-verrou']);
});

test('un objet abîmé fait redemander les objets au dépôt distant', () => {
  for (const message of [
    'error: object file .git/objects/ab/cdef0123456789 is empty',
    'fatal: loose object ab12cd34 is corrupt',
    'error: unable to read sha1 file of fichier.txt',
    'fatal: bad object HEAD',
  ]) {
    const panne = reconnaitrePanneDeDossier(message);
    assert.equal(panne?.panne, 'objets-abimes', message);
    assert.deepEqual(panne?.gestes, ['recuperer-les-objets', 'repartir-du-distant'], message);
  }
});

test('une copie verrouillée se déverrouille avant d’être rangée', () => {
  const panne = reconnaitrePanneDeDossier(
    "fatal: '/root/projet/.worktrees/titre-aaaaaa' is a missing but locked working tree",
  );
  assert.equal(panne?.panne, 'copie-verrouillee');
  assert.equal(panne?.gestes[0], 'deverrouiller-la-copie');
});

test('une copie dont les fichiers de service ne tiennent plus se recolle', () => {
  const panne = reconnaitrePanneDeDossier('fatal: validation failed, cannot remove working directory');
  assert.equal(panne?.panne, 'copie-abimee');
  assert.equal(panne?.gestes[0], 'reparer-les-copies');
});

test('une panne INCONNUE ne se bricole pas', () => {
  assert.equal(reconnaitrePanneDeDossier('fatal: quelque chose de tout à fait nouveau'), null);
  assert.equal(reconnaitrePanneDeDossier(''), null);
  assert.equal(reconnaitrePanneDeDossier(undefined as unknown as string), null);
});

test('aucun geste ne détruit une branche ni ne remet la carte à zéro', () => {
  const messages = [
    "fatal: a branch named 'tache/x' already exists",
    "fatal: 'tache/x' is already checked out at '/ailleurs'",
    'error: object file .git/objects/ab/cd is empty',
  ];
  for (const message of messages) {
    const gestes = reconnaitrePanneDeDossier(message)?.gestes ?? [];
    assert.equal(
      gestes.some((g) => g.includes('effacer') || g.includes('branche-neuve')),
      false,
      message,
    );
  }
});

/* ------------------------------------------------------------------ */
/* Les objets nommés par git                                           */
/* ------------------------------------------------------------------ */

test('les objets cités dans l’erreur sont retrouvés, une seule fois chacun', () => {
  const message = [
    'error: object file .git/objects/ab/cdef0123456789abcdef is empty',
    'error: object file .git/objects/ab/cdef0123456789abcdef is empty',
    'error: object file objects/12/34567890abcdef is empty',
  ].join('\n');
  const objets = objetsCitesDansLErreur(message);
  assert.equal(objets.length, 2);
  assert.equal(objets[0], '.git/objects/ab/cdef0123456789abcdef');
});

test('un message sans objet ne fait rien effacer', () => {
  assert.deepEqual(objetsCitesDansLErreur("fatal: 'chemin' already exists"), []);
});

/* ------------------------------------------------------------------ */
/* Ce que la carte lit quand rien n’y a fait                           */
/* ------------------------------------------------------------------ */

test('la raison finale dit la panne reconnue ET ce qui a été tenté', () => {
  const panne = reconnaitrePanneDeDossier("fatal: '/x' already exists");
  const raison = raisonApresReparations('fatal: cassé', panne, ['retirer-le-dossier', 'ranger-les-copies']);
  assert.match(raison, /git worktree/);
  assert.match(raison, /reste de tour précédent/);
  assert.match(raison, /retirer-le-dossier/);
  assert.match(raison, /fatal: cassé/);
});

test('une panne inconnue et sans réparation rend le message brut, comme avant', () => {
  const raison = raisonApresReparations('fatal: inconnu', null, []);
  assert.equal(raison, 'Dossier de travail impossible à ouvrir pour cette carte (git worktree) : fatal: inconnu');
});

test('on ne retente pas indéfiniment', () => {
  assert.ok(REPARATIONS_MAX >= 2 && REPARATIONS_MAX <= 5);
});
