import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rangerUnProjet } from '../instructions-en-attente.js';

/*
 * Avant cette carte, `ajouterALaFin` recollait TOUTE ligne de contrat en fin de
 * `CLAUDE.md`, sans regarder le sujet de l'entrée : la section « ### Quotas »
 * gonflait de règles qui n'avaient rien à voir avec les quotas. La ligne doit
 * atterrir sous la section dont l'en-tête annonce le bon sujet, repérée par
 * « sujet « <sujet> » », pas à la fin du fichier.
 */

function dossierDEssai(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-rangement-'));
}

function projetAvecPlusieursSections(): string {
  const dossier = dossierDEssai();
  fs.mkdirSync(path.join(dossier, 'docs', 'regles'), { recursive: true });
  fs.writeFileSync(path.join(dossier, 'docs', 'regles', 'cartes.md'), '# Cartes — règles du moteur\n\nTexte.\n');
  fs.writeFileSync(path.join(dossier, 'docs', 'regles', 'interface.md'), '# Interface — règles du moteur\n\nTexte.\n');

  fs.writeFileSync(
    path.join(dossier, 'CLAUDE.md'),
    [
      '# Projet — instructions du moteur',
      '',
      '### Cartes',
      '',
      'Texte entier : `docs/regles/cartes.md` (`project_memory`, sujet « cartes »).',
      '',
      '- Une règle de cartes déjà là',
      '',
      '### Interface et code',
      '',
      'Texte entier : `docs/regles/interface.md` (`project_memory`, sujet « interface »).',
      '',
      '- Une règle d’interface déjà là',
      '',
    ].join('\n'),
  );

  fs.writeFileSync(
    path.join(dossier, 'docs', 'instructions-en-attente.md'),
    [
      '# Instructions en attente',
      '',
      '## Une nouvelle règle d’interface',
      '- sujet : interface',
      '- contrat : une nouvelle règle d’interface',
      '',
      'Le texte entier de la règle.',
      '',
    ].join('\n'),
  );

  return dossier;
}

test('la ligne de contrat va sous la section de son sujet, pas à la fin du fichier', () => {
  const dossier = projetAvecPlusieursSections();
  const plan = rangerUnProjet(dossier);
  assert.ok(plan);
  assert.equal(plan?.contrat.length, 1);

  const claude = fs.readFileSync(path.join(dossier, 'CLAUDE.md'), 'utf8');
  const sections = claude.split(/^### /m);
  const sectionCartes = sections.find((s) => s.startsWith('Cartes')) ?? '';
  const sectionInterface = sections.find((s) => s.startsWith('Interface et code')) ?? '';

  // La nouvelle ligne est sous « Interface et code »…
  assert.match(sectionInterface, /nouvelle règle d’interface/);
  // …et n'a pas fini sous « Cartes », ni collée à la toute fin du fichier.
  assert.doesNotMatch(sectionCartes, /nouvelle règle d’interface/);
  assert.equal(claude.trimEnd().endsWith('nouvelle règle d’interface'), false);
});

test('un contrat qui répète mot pour mot son titre ne s’écrit qu’une fois', () => {
  const dossier = projetAvecPlusieursSections();
  fs.writeFileSync(
    path.join(dossier, 'docs', 'instructions-en-attente.md'),
    [
      '# Instructions en attente',
      '',
      '## UNE RÈGLE RÉPÉTÉE',
      '- sujet : interface',
      '- contrat : UNE RÈGLE RÉPÉTÉE',
      '',
      'Le texte entier de la règle.',
      '',
    ].join('\n'),
  );

  rangerUnProjet(dossier);
  const claude = fs.readFileSync(path.join(dossier, 'CLAUDE.md'), 'utf8');
  const occurrences = claude.split('UNE RÈGLE RÉPÉTÉE').length - 1;
  assert.equal(occurrences, 1);
});
