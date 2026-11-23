import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPARATIONS_MAX,
  causeDansLErreur,
  objetsCitesDansLErreur,
  raisonApresReparations,
  reconnaitrePanneDeDossier,
} from '@beluga/shared';

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

test('un dossier de projet qui n’appartient plus au service se répare par les droits', () => {
  /* Les deux messages RÉELS relevés le 22 septembre 2026, sur beluga-vitrine et
     haiko-hetzner : 19 projets sur 24 ne pouvaient plus lancer une carte. */
  for (const message of [
    "fatal: could not create leading directories of '/root/beluga-vitrine/.worktrees/fichage-par-colonne-pour-la-demo-40c3af/.git': Permission denied",
    "fatal: cannot lock ref 'refs/heads/tache/gestionnaire-de-fichiers-par-serveur-80c073': Unable to create '/root/haiko-hetzner/.git/refs/heads/tache/gestionnaire-de-fichiers-par-serveur-80c073.lock': Permission denied",
    "error: EACCES: permission denied, mkdir '/root/projet/.worktrees'",
    "fatal: EPERM: operation not permitted, chown '/root/projet/.git'",
    "fatal: Operation not permitted",
  ]) {
    const panne = reconnaitrePanneDeDossier(message);
    assert.equal(panne?.panne, 'droits-insuffisants', message);
    assert.deepEqual(panne?.gestes, ['rendre-les-droits'], message);
  }
});

test('une clé SSH refusée par le dépôt distant n’est PAS une panne de droits locaux', () => {
  const panne = reconnaitrePanneDeDossier(
    'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
  );
  assert.notEqual(panne?.panne, 'droits-insuffisants');
});

test('un VRAI verrou oublié garde son diagnostic, malgré la panne de droits placée devant', () => {
  const panne = reconnaitrePanneDeDossier(
    "fatal: Unable to create '/root/projet/.git/index.lock': File exists.",
  );
  assert.equal(panne?.panne, 'verrou-oublie');
  assert.deepEqual(panne?.gestes, ['retirer-le-verrou']);
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

test('la raison retient la LIGNE de cause, pas la fin du procès-verbal de git', () => {
  /* Le message tel que l'écran l'affichait : la commande entière tenait dans
     les 300 derniers signes, et la phrase commençait au milieu d'un mot. */
  const brut = [
    'Command failed: git worktree add --quiet /root/beluga-vitrine/.worktrees/fichage-par-colonne-pour-la-demo-40c3af tache/fichage-par-colonne-pour-la-demo-40c3af',
    "fatal: could not create leading directories of '/root/beluga-vitrine/.worktrees/fichage-par-colonne-pour-la-demo-40c3af/.git': Permission denied",
  ].join('\n');
  const cause = causeDansLErreur(brut);
  assert.ok(cause.startsWith('fatal: could not create leading directories'), cause);
  assert.equal(cause.includes('Command failed'), false);

  const raison = raisonApresReparations(brut, reconnaitrePanneDeDossier(brut), ['rendre-les-droits']);
  assert.match(raison, /n'appartenaient pas au compte du service/);
  assert.equal(raison.includes('Command failed'), false);
});

test('la cause retenue est la DERNIÈRE nommée par git, jamais un avertissement d’ouverture', () => {
  const cause = causeDansLErreur(
    ['warning: quelque chose de bénin', 'error: premier souci', 'fatal: le vrai échec'].join('\n'),
  );
  assert.equal(cause, 'fatal: le vrai échec');
});

test('un message sans préfixe connu garde sa dernière ligne, et un message vide le dit', () => {
  assert.equal(causeDansLErreur('une ligne\nune autre ligne'), 'une autre ligne');
  assert.match(causeDansLErreur(''), /rien dit de plus/);
});

test('on ne retente pas indéfiniment', () => {
  assert.ok(REPARATIONS_MAX >= 2 && REPARATIONS_MAX <= 5);
});

/* ------------------------------------------------------------------ */
/* Le chemin qu'un chown -R a le droit de toucher                      */
/*                                                                     */
/* Le geste « rendre-les-droits » est le seul de la liste qui agisse   */
/* HORS de git, en élévation. Un chemin vide, relatif ou mal lu y      */
/* deviendrait une catastrophe : ses refus se vérifient donc un par un.*/
/* ------------------------------------------------------------------ */

test('la reprise de droits refuse tout ce qui n’est pas un dépôt à soi', async () => {
  const { cheminReparableEnDroits } = await import('../dossier-de-carte.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');

  for (const refuse of ['', '   ', 'projet', './projet', '/', '/root', '/home', '/etc', '/usr', '/beluga']) {
    assert.equal(cheminReparableEnDroits(refuse), false, refuse);
  }
  assert.equal(cheminReparableEnDroits(undefined as unknown as string), false);
  assert.equal(cheminReparableEnDroits(os.homedir()), false, 'le dossier personnel garde son .ssh');

  /* Un dossier bien formé mais SANS dépôt git : refusé aussi. */
  const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'droits-'));
  try {
    assert.equal(cheminReparableEnDroits(bac), false, 'un dossier sans .git ne se répare pas');
    fs.mkdirSync(path.join(bac, '.git'));
    assert.equal(cheminReparableEnDroits(bac), true, 'un dépôt git se répare');
    assert.equal(cheminReparableEnDroits(`${bac}/`), true, 'la barre finale ne change rien');
  } finally {
    fs.rmSync(bac, { recursive: true, force: true });
  }
});

test('l’échec d’un crochet post-checkout se reconnaît, une vraie panne de git non', async () => {
  const { crochetDeCheckoutTombe } = await import('@beluga/shared');
  assert.equal(crochetDeCheckoutTombe('husky - post-checkout script failed (code 1)'), true);
  assert.equal(crochetDeCheckoutTombe("error: hook 'post-checkout' exited with status 1"), true);
  assert.equal(crochetDeCheckoutTombe("fatal: 'tache/x' is already checked out at '/tmp/y'"), false);
});
