import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * Constat du 08/09/2026 : `contratMisDeCote` posait un marqueur générique,
 * puis le rangement concaténait TOUS les marqueurs d'un sujet en fin de
 * fichier — 269 marqueurs `_(hors contrat)_` sans qu'aucun ne dise à quelle
 * règle il se rapportait. Chaque marqueur suit désormais SA règle : chaque
 * règle devient sa propre fiche de classeur, qui porte son propre marqueur.
 */

// Le rangement écrit les règles en fiches de classeur : une base JETABLE, avant les imports du démon.
process.env.BELUGA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-marqueur-base-'));
const { rangerUnProjet } = await import('../instructions-en-attente.js');
const { unitesDeLaPortee } = await import('../connaissances.js');

function projetAuPlafondPresqueAtteint(): string {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-marqueur-'));

  // Un CLAUDE.md déjà presque plein : les deux nouvelles lignes de contrat
  // n'y tiennent plus, et débordent toutes les deux vers leur fiche.
  const remplissage = '- Ligne déjà là qui occupe de la place.\n'.repeat(1100);
  fs.writeFileSync(path.join(dossier, 'CLAUDE.md'), ['# Projet — instructions du moteur', '', '### Cartes', '', remplissage].join('\n'));

  fs.mkdirSync(path.join(dossier, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(dossier, 'docs', 'instructions-en-attente.md'),
    [
      '# Instructions en attente',
      '',
      '## Première règle tardive',
      '- sujet : cartes',
      '- contrat : première règle tardive',
      '',
      'Le texte entier de la première règle.',
      '',
      '## Seconde règle tardive',
      '- sujet : cartes',
      '- contrat : seconde règle tardive',
      '',
      'Le texte entier de la seconde règle.',
      '',
    ].join('\n'),
  );

  return dossier;
}

test('deux règles écartées du plafond portent chacune leur propre marqueur, dans leur fiche', async () => {
  const dossier = projetAuPlafondPresqueAtteint();
  const plan = await rangerUnProjet(dossier);
  assert.ok(plan);
  // Les deux lignes de contrat existent, mais aucune ne tient sous le plafond.
  assert.equal(plan?.contrat.length, 2);

  const regles = unitesDeLaPortee('global').filter((u) => u.sujets.includes('cartes') && /règle tardive/.test(u.titre));
  assert.equal(regles.length, 2, 'chaque règle est sa propre unité');
  for (const regle of regles) {
    const marqueurs = (regle.detail.match(/_\(hors contrat\)_/g) ?? []).length;
    assert.equal(marqueurs, 1, `« ${regle.titre} » porte son propre marqueur, et un seul`);
  }
  const premiere = regles.find((r) => r.titre.startsWith('Première'));
  assert.match(premiere?.detail ?? '', /première règle/);
  assert.doesNotMatch(premiere?.detail ?? '', /seconde règle/, 'le texte d’une règle ne déborde pas sur l’autre');
});
