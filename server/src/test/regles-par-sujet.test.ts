import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  decouperRegles,
  reglesContenant,
  SUJETS_REGLES,
  sujetsPourRequete,
} from '@haikodev/shared';
import { appendMemory, detailProjet, detailRegles } from '../memory.js';

/*
 * Les règles et les contrôles ne partent plus en bloc : rangés par sujet, ils
 * se demandent à la carte par le même outil que les faits. On vérifie que la
 * demande d'un sujet rend SES règles et SES contrôles, et rien d'autre.
 */

function projetDEssai(): string {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-regles-'));
  fs.mkdirSync(path.join(dossier, 'docs', 'regles'), { recursive: true });
  fs.writeFileSync(
    path.join(dossier, 'docs', 'regles', 'publication.md'),
    '# Publication — règles du moteur\n\n' +
      '- **Ne jamais publier de sa propre initiative.** Enregistrer et pousser, oui ; publier est un geste humain.\n\n' +
      '- **Ne JAMAIS redémarrer le serveur pendant une publication.** Le démon porte toutes les publications.\n',
  );
  fs.writeFileSync(
    path.join(dossier, 'docs', 'regles', 'voix.md'),
    '# Voix et écoute — règles du moteur\n\n' +
      "- **L'écoute permanente ne s'ouvre JAMAIS toute seule.** Le mot de réveil vaut « Dis Haiko » par défaut.\n",
  );
  fs.writeFileSync(
    path.join(dossier, 'docs', 'verifications.md'),
    '# Contrôles\n\n' +
      '## Publication\n\n```bash\nnode scripts/verif-mise-en-ligne.mjs # déployer fusionne et construit\n```\n\n' +
      '## Voix et écoute\n\n```bash\nnode scripts/verif-module-voix.mjs # le module de voix se métamorphose\n```\n',
  );
  return dossier;
}

/* ------------------------------------------------------------------ */
/* La sélection pure                                                   */
/* ------------------------------------------------------------------ */

test('un sujet nommé est reconnu, seul', () => {
  const sujets = sujetsPourRequete('publication');
  assert.deepEqual(sujets.map((s) => s.id), ['publication']);
});

test('des mots-clés ramènent le bon sujet', () => {
  const ids = sujetsPourRequete("changer le mot de réveil de l'écoute").map((s) => s.id);
  assert.ok(ids.includes('voix'), `attendu « voix », reçu ${ids.join(', ')}`);
});

test('une demande vide ne ramène aucun sujet', () => {
  assert.equal(sujetsPourRequete('   ').length, 0);
});

test('les huit sujets pointent vers un fichier de docs/regles', () => {
  assert.equal(SUJETS_REGLES.length, 8);
  for (const s of SUJETS_REGLES) assert.match(s.fichier, /^docs\/regles\/[a-z]+\.md$/);
});

test('découpe et recherche par mots dans les règles', () => {
  const bloc =
    '- **Règle une.** Corps de la première.\n  suite.\n- **Règle deux.** Parle de worktree.\n';
  const regles = decouperRegles(bloc);
  assert.equal(regles.length, 2);
  const trouve = reglesContenant(regles, 'worktree');
  assert.equal(trouve.length, 1);
  assert.match(trouve[0], /Règle deux/);
});

/* ------------------------------------------------------------------ */
/* Le détail sur disque                                                */
/* ------------------------------------------------------------------ */

test('detailRegles rend les règles ET les contrôles du sujet demandé', () => {
  const dossier = projetDEssai();
  const texte = detailRegles(dossier, 'publication');
  assert.match(texte, /Ne jamais publier/);
  assert.match(texte, /CONTRÔLES/);
  assert.match(texte, /verif-mise-en-ligne/);
  // Pas le contrôle d'un autre sujet.
  assert.doesNotMatch(texte, /verif-module-voix/);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('un invariant critique se retrouve par mots-clés hors nom de sujet', () => {
  const dossier = projetDEssai();
  const texte = detailRegles(dossier, 'redémarrer pendant une publication');
  assert.match(texte, /Ne JAMAIS redémarrer/);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('detailProjet réunit faits et règles, sans noyer une règle sous l\'index', () => {
  const dossier = projetDEssai();
  appendMemory(dossier, 'La barre du haut ne garde que deux repères, réseau à gauche et menu à droite.');
  const texte = detailProjet(dossier, 'publication');
  assert.match(texte, /Ne jamais publier/, 'la règle doit être là');
  // La demande vise une règle : l'index complet des faits ne doit pas la noyer.
  assert.doesNotMatch(texte, /barre du haut/);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('sans docs/regles, detailRegles se tait et detailProjet ne rend que les faits', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-sans-regles-'));
  appendMemory(dossier, 'Un fait durable quelconque du projet, retenu pour plus tard.');
  assert.equal(detailRegles(dossier, 'publication'), '');
  assert.match(detailProjet(dossier, ''), /MÉMOIRE DU PROJET/);
  fs.rmSync(dossier, { recursive: true, force: true });
});
