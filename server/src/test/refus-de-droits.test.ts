/**
 * LE CHEF A L'ACCÈS COMPLET, ET AUCUN REFUS NE SE DIT « PAS LES DROITS ».
 *
 * Sa seule frontière est de ne pas modifier lui-même du code : elle tient sur
 * les outils d'édition, pas sur le disque. Le bac à sable qui l'enfermait a été
 * retiré le 11/08/2026 — il rendait impossibles les gestes mêmes qu'on veut lui
 * ouvrir (construire écrit dans le projet, administrer exige l'élévation de
 * privilèges, qu'aucun bac à sable ne laisse passer).
 *
 * Restent les refus RÉELS de la machine, qui doivent nommer leur cause et sa
 * réparation. Les sorties citées ici ont été relevées à la main sur le serveur.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consigneEspaceDuChef,
  detailDuRefus,
  expliquerRefus,
  natureDuRefus,
  reglagesClaudeDuChef,
  surchargesCodexDuChef,
} from '@haikodev/shared';

const LISTES = { allowedTools: ['Bash'], disallowedTools: ['Edit', 'Write'] };

test('aucun moteur n’enferme le chef dans un bac à sable', () => {
  const codex = surchargesCodexDuChef(LISTES);
  assert.ok(
    codex.includes('sandbox_mode="danger-full-access"'),
    'Codex laisse passer construction, déploiement et administration',
  );
  assert.ok(
    !codex.some((s) => s.startsWith('sandbox_workspace_write')),
    'plus rien ne limite l’écriture à un espace de travail',
  );
  const claude = reglagesClaudeDuChef(LISTES, '/root/projet');
  assert.deepEqual(claude?.sandbox, { enabled: false });
  assert.ok(
    !JSON.stringify(claude).includes('denyWrite'),
    'plus aucun dossier n’est fermé en écriture au chef',
  );
});

test('la frontière du CODE reste posée sur les outils du projet', () => {
  // C'est le verrou qui subsiste : il ne doit pas partir avec le bac à sable.
  const codex = surchargesCodexDuChef({
    allowedTools: ['Bash', 'mcp__haikodev__board_create_card'],
    disallowedTools: ['Edit', 'Write', 'mcp__haikodev__make_archive'],
  });
  assert.ok(codex.some((s) => s.includes('enabled_tools=["board_create_card"]')));
  assert.ok(codex.some((s) => s.includes('disabled_tools=["make_archive"]')));
  // Une commande doit partir sans attendre un accord que personne ne donnera.
  assert.ok(codex.includes('approval_policy="never"'));
});

test('un reste de bac à sable est signalé comme un réglage à éteindre', () => {
  for (const sortie of [
    'bwrap: setting up uid map: Permission denied',
    "EROFS: read-only file system, open '/root/projet/x'",
    '/bin/sh: 1: cannot create /root/projet/x.txt: Read-only file system',
    'sudo: The "no new privileges" flag is set, which prevents sudo from running as root.',
  ]) {
    assert.equal(natureDuRefus(sortie), 'bac-a-sable-residuel', sortie);
  }
  assert.match(expliquerRefus('bac-a-sable-residuel'), /À RÉPARER SUR LE SERVEUR/);
  assert.match(expliquerRefus('bac-a-sable-residuel'), /éteindre/);
});

test('un fichier d’un autre compte nomme la possession, pas un droit manquant', () => {
  const sortie =
    "EACCES: permission denied, open '/usr/local/bin/haiko-compta-deploy.sh.tmp.1001925'";
  assert.equal(natureDuRefus(sortie), 'fichier-d-un-autre-compte');
  assert.match(expliquerRefus('fichier-d-un-autre-compte'), /appartient à un AUTRE compte/);
});

test('une administration qui réclame un mot de passe dit la règle à poser', () => {
  assert.equal(
    natureDuRefus('sudo: a password is required'),
    'administration-a-configurer',
  );
  assert.match(expliquerRefus('administration-a-configurer'), /sudoers/);
});

test('une sortie ordinaire, ou qui CITE ces mots, n’est pas un refus', () => {
  assert.equal(natureDuRefus(''), null);
  assert.equal(natureDuRefus('   '), null);
  assert.equal(natureDuRefus('Construction terminée en 12 s'), null);
  assert.equal(natureDuRefus('Le chef a désormais l’accès complet, dit la règle.'), null);
});

test('aucune explication ne parle de droits manquants', () => {
  for (const nature of [
    'bac-a-sable-residuel',
    'fichier-d-un-autre-compte',
    'administration-a-configurer',
  ] as const) {
    assert.doesNotMatch(expliquerRefus(nature), /pas les droits|droits manquants/i);
  }
});

test('le détail garde la sortie d’origine sous l’explication', () => {
  const brut = "EACCES: permission denied, open '/usr/local/bin/x'";
  const detail = detailDuRefus(brut);
  assert.ok(detail, 'un refus reconnu donne un détail réécrit');
  assert.match(detail, /AUTRE compte/);
  assert.ok(detail.includes(brut), 'la sortie du système reste lisible dessous');
  assert.equal(detailDuRefus('tout va bien'), null);
  assert.equal(detailDuRefus(undefined), null);
});

test('la consigne du chef annonce l’accès complet et sa seule frontière', () => {
  const consigne = consigneEspaceDuChef('/root/travail/chef', '/root/projet');
  assert.match(consigne, /ACCÈS COMPLET/);
  // Les gestes qu'il se croyait interdits sont nommés : sans cela, il s'arrête
  // avant d'essayer et rapporte un refus qui n'existe pas.
  for (const geste of [/construction/i, /installation/i, /déploiement/i, /redémarrage/i, /administration/i]) {
    assert.match(consigne, geste);
  }
  assert.match(consigne, /TA SEULE FRONTIÈRE/);
  assert.match(consigne, /tu ne modifies pas TOI-MÊME le code/);
  assert.match(consigne, /NE DIS JAMAIS « je n'ai pas les droits »/);
});
