/**
 * UN REFUS DU BAC À SABLE NE SE DIT PAS « JE N'AI PAS LES DROITS ».
 *
 * Le chef d'orchestre travaille dans un bac à sable : son dossier de travail
 * est écrivable, le projet est en lecture seule, l'élévation de privilèges est
 * coupée. C'est la frontière voulue, pas un droit oublié. Il rapportait pourtant
 * ses échecs en parlant de droits — un utilisateur qui a tout accordé lisait
 * alors une autorisation manquante.
 *
 * Les sorties citées ici sont RÉELLES : relevées dans les conversations du
 * 11/08/2026 et rejouées à la main sous `bwrap`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consigneEspaceDuChef,
  detailDuRefus,
  expliquerRefus,
  natureDuRefus,
} from '@haikodev/shared';

test('une écriture dans le projet monté en lecture seule est reconnue', () => {
  assert.equal(
    natureDuRefus("/bin/sh: 1: cannot create /root/projet/x.txt: Read-only file system"),
    'projet-en-lecture-seule',
  );
  assert.equal(
    natureDuRefus("EROFS: read-only file system, open '/root/projet/ESSAI.txt'"),
    'projet-en-lecture-seule',
  );
});

test('une écriture ailleurs sur la machine ne se confond pas avec le projet', () => {
  // Relevé réel : le chef tentait d'écrire un script de déploiement dans /usr/local/bin.
  const sortie =
    "EACCES: permission denied, open '/usr/local/bin/haiko-compta-deploy.sh.tmp.1001925'";
  assert.equal(natureDuRefus(sortie), 'ecriture-hors-espace');
  assert.match(expliquerRefus('ecriture-hors-espace'), /dossier de travail/i);
});

test("l'élévation de privilèges coupée est reconnue, pas prise pour une écriture", () => {
  const sortie =
    'sudo: /etc/sudo.conf is owned by uid 65534, should be 0\n' +
    'sudo: The "no new privileges" flag is set, which prevents sudo from running as root.';
  assert.equal(natureDuRefus(sortie), 'administration-refusee');
});

test('un bac à sable qui ne démarre pas passe AVANT les autres empreintes', () => {
  // Il se plaint aussi de permissions : sans l'ordre, on le prendrait pour une
  // écriture refusée, et la VRAIE panne du serveur resterait invisible.
  const sortie = 'bwrap: setting up uid map: Permission denied';
  assert.equal(natureDuRefus(sortie), 'bac-a-sable-absent');
  assert.match(expliquerRefus('bac-a-sable-absent'), /PANNE DU SERVEUR/);
});

test('une sortie ordinaire, ou qui CITE ces mots, n’est pas un refus', () => {
  assert.equal(natureDuRefus(''), null);
  assert.equal(natureDuRefus('   '), null);
  assert.equal(natureDuRefus('Construction terminée en 12 s'), null);
  // Une documentation qui parle du sujet ne doit pas déclencher l'explication.
  assert.equal(
    natureDuRefus('Le projet est monté en lecture seule pour le chef, dit la règle.'),
    null,
  );
});

test('aucune explication ne parle de droits, toutes disent la route à prendre', () => {
  for (const nature of [
    'projet-en-lecture-seule',
    'ecriture-hors-espace',
    'administration-refusee',
  ] as const) {
    const phrase = expliquerRefus(nature);
    assert.match(phrase, /Ce n'est pas une autorisation qui manque/);
    assert.match(phrase, /agent de tâche/);
  }
});

test('le détail garde la sortie d’origine sous l’explication', () => {
  const brut = "EROFS: read-only file system, open '/root/projet/x'";
  const detail = detailDuRefus(brut, '/root/projet');
  assert.ok(detail, 'un refus reconnu donne un détail réécrit');
  assert.match(detail, /LECTURE SEULE/);
  assert.match(detail, /\/root\/projet/);
  assert.ok(detail.includes(brut), 'la sortie du système reste lisible dessous');
});

test('rien à expliquer : le détail est laissé intact à l’appelant', () => {
  assert.equal(detailDuRefus('tout va bien'), null);
  assert.equal(detailDuRefus(undefined), null);
});

test('la consigne du chef nomme ce qui échouera et interdit le mot « droits »', () => {
  const consigne = consigneEspaceDuChef('/root/travail/chef', '/root/projet');
  assert.match(consigne, /\/root\/travail\/chef/);
  assert.match(consigne, /\/root\/projet/);
  // Ce qu'il n'essaie pas : c'est en essayant qu'il rapportait un refus.
  for (const geste of [/construire/i, /installer/i, /déploiement/i, /redémarrer/i]) {
    assert.match(consigne, geste);
  }
  // La consigne générale du serveur qui pousse à publier est écartée nommément.
  assert.match(consigne, /ne s'applique PAS à toi/);
  assert.match(consigne, /NE DIS JAMAIS « je n'ai pas les droits »/);
  assert.match(consigne, /agent de tâche/);
});
