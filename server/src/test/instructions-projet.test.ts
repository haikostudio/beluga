import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fichierNatif, instructionsQuiFontFoi, renvoiVers } from '@haikodev/shared';
import { briefing, instructionsDuProjet } from '../memory.js';

/*
 * Codex doit recevoir les VRAIES instructions d'un projet, pas un renvoi.
 *
 * HaikoDev pose à la création d'un projet un `AGENTS.md` qui ne fait que
 * pointer vers `CLAUDE.md`. Nommer ce renvoi à Codex, c'est lui donner deux
 * lignes vides de sens là où Claude reçoit tout — et l'inviter à écrire ses
 * règles durables dans un fichier que personne ne relit. On suit le renvoi.
 */

function dossierDEssai(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-instructions-'));
}

/** Un projet monté comme HaikoDev les monte : CLAUDE.md plein, AGENTS.md renvoi. */
function projetAvecRenvoi(): string {
  const dossier = dossierDEssai();
  fs.writeFileSync(
    path.join(dossier, 'CLAUDE.md'),
    '# Root — instructions du moteur\n\n## Lancer\n\n`./publier.sh --ecrire` met en ligne.\n\n' +
      '## Règles\n\n- Les copies servies ne se modifient jamais à la main.\n',
  );
  fs.writeFileSync(
    path.join(dossier, 'AGENTS.md'),
    '# Root — instructions du moteur\n\nLes instructions de ce projet vivent dans `CLAUDE.md`. Lis-le : il fait foi.\n',
  );
  return dossier;
}

/* ------------------------------------------------------------------ */
/* La règle pure : reconnaître un renvoi                                */
/* ------------------------------------------------------------------ */

test('un fichier qui ne fait que pointer vers un autre est reconnu comme renvoi', () => {
  const renvoi = '# Projet — instructions du moteur\n\nLes instructions de ce projet vivent dans `CLAUDE.md`. Lis-le : il fait foi.\n';
  assert.equal(renvoiVers(renvoi, 'AGENTS.md'), 'CLAUDE.md');
});

test('un fichier qui porte de vraies instructions n’est jamais pris pour un renvoi', () => {
  const vrai =
    '# Projet\n\n## Lancer\n\nnpm run dev\n\n## Vérifier\n\nnpm test\n\n## Règles\n\n' +
    '- Ne jamais publier de sa propre initiative.\n- Committer les fichiers un par un.\n';
  assert.equal(renvoiVers(vrai, 'AGENTS.md'), null);
  // Même court, un fichier qui ne cite aucun autre fichier d'instructions reste le sien.
  assert.equal(renvoiVers('# Projet\n\nOn lance avec npm run dev.\n', 'AGENTS.md'), null);
  // Vide : rien à suivre.
  assert.equal(renvoiVers('# Projet\n', 'AGENTS.md'), null);
  // Un fichier qui se cite lui-même ne renvoie nulle part.
  assert.equal(renvoiVers('# Projet\n\nTout est dans `AGENTS.md`.\n', 'AGENTS.md'), null);
});

test('un renvoi vers un fichier absent n’est pas suivi : on garde le fichier natif', () => {
  const lire = (nom: string) =>
    nom === 'AGENTS.md' ? 'Les instructions vivent dans `CLAUDE.md`.' : null;
  assert.deepEqual(instructionsQuiFontFoi('codex', lire), {
    fichier: 'AGENTS.md',
    renvoiDepuis: null,
  });
});

test('deux fichiers qui se renvoient l’un à l’autre ne font pas boucler', () => {
  const lire = (nom: string) =>
    nom === 'AGENTS.md'
      ? 'Tout est dans `CLAUDE.md`.'
      : 'Tout est dans `AGENTS.md`.';
  assert.equal(instructionsQuiFontFoi('codex', lire).fichier, 'CLAUDE.md');
  assert.equal(instructionsQuiFontFoi('claude', lire).fichier, 'AGENTS.md');
});

test('le fichier natif du moteur ne change pas', () => {
  assert.equal(fichierNatif('codex'), 'AGENTS.md');
  assert.equal(fichierNatif('claude'), 'CLAUDE.md');
  assert.equal(fichierNatif(), 'CLAUDE.md');
});

/* ------------------------------------------------------------------ */
/* Sur un vrai dossier, pour les DEUX moteurs                           */
/* ------------------------------------------------------------------ */

test('sur un projet dont AGENTS.md est un renvoi, les deux moteurs sont menés à CLAUDE.md', () => {
  const dossier = projetAvecRenvoi();
  assert.deepEqual(instructionsDuProjet(dossier, 'codex'), {
    fichier: 'CLAUDE.md',
    renvoiDepuis: 'AGENTS.md',
  });
  assert.deepEqual(instructionsDuProjet(dossier, 'claude'), {
    fichier: 'CLAUDE.md',
    renvoiDepuis: null,
  });
});

test('le briefing de Codex nomme CLAUDE.md, et dit que AGENTS.md n’est qu’un renvoi', () => {
  const dossier = projetAvecRenvoi();
  const codex = briefing(dossier, 'Root', true, 'codex');

  assert.match(codex, /AGENTS\.md ne fait que RENVOYER à CLAUDE\.md/);
  // La consigne de fin de tâche désigne le fichier qui porte le contenu.
  assert.match(codex, /mets CLAUDE\.md à jour avant de finir/);
  assert.doesNotMatch(codex, /mets AGENTS\.md à jour/);
});

test('le briefing de Claude est inchangé : pas de renvoi à signaler', () => {
  const dossier = projetAvecRenvoi();
  const claude = briefing(dossier, 'Root', true, 'claude');
  assert.match(claude, /mets CLAUDE\.md à jour avant de finir/);
  assert.doesNotMatch(claude, /ne fait que RENVOYER/);
});

test('un projet dont AGENTS.md porte ses propres règles garde AGENTS.md pour Codex', () => {
  const dossier = dossierDEssai();
  fs.writeFileSync(path.join(dossier, 'CLAUDE.md'), '# Projet\n\nRègles de Claude.\n');
  fs.writeFileSync(
    path.join(dossier, 'AGENTS.md'),
    '# Projet — instructions du moteur\n\n## Lancer\n\nnpm run dev\n\n## Vérifier\n\nnpm test\n\n' +
      '## Règles\n\n- Ne jamais publier de sa propre initiative.\n- Committer un fichier à la fois.\n',
  );
  assert.equal(instructionsDuProjet(dossier, 'codex').fichier, 'AGENTS.md');
  assert.match(briefing(dossier, 'Essai', true, 'codex'), /mets AGENTS\.md à jour avant de finir/);
});

test('un projet sans aucun fichier d’instructions garde le nom natif du moteur', () => {
  const dossier = dossierDEssai();
  assert.equal(instructionsDuProjet(dossier, 'codex').fichier, 'AGENTS.md');
  assert.equal(instructionsDuProjet(dossier, 'claude').fichier, 'CLAUDE.md');
});
