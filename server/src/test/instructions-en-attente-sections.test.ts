import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Le rangement écrit les règles en fiches de classeur : une base JETABLE, posée avant les imports du démon.
process.env.BELUGA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-rangement-base-'));
const { rangerUnProjet } = await import('../instructions-en-attente.js');
const { unitesDeLaPortee, versionsDeLUnite } = await import('../connaissances.js');

/** Les règles rangées en unités du Global (une racine d'essai n'est pas un projet déclaré). */
function reglesRangees(titre: RegExp) {
  return unitesDeLaPortee('global')
    .filter((u) => titre.test(u.titre))
    .map((u) => ({ id: u.id, theme: u.sujets[0], titre: u.titre, corps: u.detail }));
}

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

test('la ligne de contrat va sous la section de son sujet, pas à la fin du fichier', async () => {
  const dossier = projetAvecPlusieursSections();
  const plan = await rangerUnProjet(dossier);
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

test('un contrat qui répète mot pour mot son titre ne s’écrit qu’une fois', async () => {
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

  await rangerUnProjet(dossier);
  const claude = fs.readFileSync(path.join(dossier, 'CLAUDE.md'), 'utf8');
  const occurrences = claude.split('UNE RÈGLE RÉPÉTÉE').length - 1;
  assert.equal(occurrences, 1);
});

/*
 * Une règle déposée deux fois ne se double pas : elle MET À JOUR sa fiche du
 * classeur, et la version précédente reste dans l'historique de la fiche.
 */
test('une règle déposée deux fois met à jour sa fiche, elle ne la double pas', async () => {
  const dossier = projetAvecPlusieursSections();
  const deposer = (texte: string) =>
    fs.writeFileSync(
      path.join(dossier, 'docs', 'instructions-en-attente.md'),
      ['# Instructions en attente', '', '## Une règle déjà rangée', '- sujet : interface', '', texte, ''].join('\n'),
    );
  deposer('Première version, plus courte.');
  await rangerUnProjet(dossier);
  deposer('Seconde version, plus complète, qui doit remplacer la première.');
  await rangerUnProjet(dossier);

  const fiches = reglesRangees(/^Une règle déjà rangée$/);
  assert.equal(fiches.length, 1);
  assert.match(fiches[0].corps, /Seconde version, plus complète/);
  assert.doesNotMatch(fiches[0].corps, /Première version/);
  assert.equal(fiches[0].theme, 'interface');
  assert.ok(
    versionsDeLUnite(fiches[0].id).some((v) => /Première version/.test(v.unite.detail)),
    'la version précédente est gardée',
  );
});

/*
 * Constat du 06/09/2026 : la même règle revenait une fois tout en MAJUSCULES et
 * une fois en casse normale. La clé de la fiche ignore la casse et les accents.
 */
test('une règle déposée sous une casse différente met à jour la même fiche', async () => {
  const dossier = projetAvecPlusieursSections();
  const deposer = (titre: string, texte: string) =>
    fs.writeFileSync(
      path.join(dossier, 'docs', 'instructions-en-attente.md'),
      ['# Instructions en attente', '', `## ${titre}`, '- sujet : interface', '', texte, ''].join('\n'),
    );
  deposer('LE CADRAGE TIENT EN QUATRE GESTES, CHACUN PAR UN OUTIL', 'Première version, toute en majuscules.');
  await rangerUnProjet(dossier);
  deposer('Le cadrage tient en quatre gestes, chacun par un outil', 'Seconde version, en casse normale.');
  await rangerUnProjet(dossier);

  const fiches = reglesRangees(/cadrage tient en quatre gestes/i);
  assert.equal(fiches.length, 1);
  assert.match(fiches[0].corps, /Seconde version, en casse normale/);
});

/*
 * La table des anciens noms (`ANCIENS_SUJETS`, `shared/src/memoire.ts`) route
 * un ancien sujet vers son vrai thème, SANS la note « rangée ici par défaut ».
 */
test('un ancien nom de sujet rejoint son vrai thème, sans note de repli', async () => {
  const dossier = projetAvecPlusieursSections();
  fs.writeFileSync(
    path.join(dossier, 'docs', 'instructions-en-attente.md'),
    ['# Instructions en attente', '', '## Une règle de conversation', '- sujet : conversation', '', 'Le texte entier de la règle de conversation.', ''].join('\n'),
  );

  await rangerUnProjet(dossier);
  const [fiche] = reglesRangees(/^Une règle de conversation$/);
  assert.ok(fiche, 'la règle est rangée');
  assert.equal(fiche.theme, 'interface');
  assert.doesNotMatch(fiche.corps, /rangée ici par défaut/);
});
