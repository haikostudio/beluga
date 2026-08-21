import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/* ------------------------------------------------------------------ */
/* MOINS DE CONFLITS ARRIVENT JUSQU'À LA FUSION DU LOT                 */
/*                                                                     */
/* Mesuré sur les 207 publications du 02/08/2026 au 20/08/2026 : la    */
/* fusion des branches pèse 64 % du temps de publication, et une       */
/* fusion en conflit coûte 379 s contre 2,6 s pour une fusion propre.  */
/* Le recollage automatique du 18/08 a fait tomber les conflits de     */
/* 83 (sur 184 publications) à 3 (sur 23) — et ces trois-là portent    */
/* tous `docs/instructions-en-attente.md`, le fichier que TOUS les     */
/* agents complètent en finissant.                                     */
/*                                                                     */
/* Deux causes, deux réponses, toutes deux EN AMONT de la fusion :     */
/*  1. un dépôt de règles par CARTE — deux fichiers ne se heurtent pas ;*/
/*  2. le recollage à la FERMETURE d'une carte, plus seulement à la    */
/*     publication : le heurt meurt à la seconde où il naît.           */
/* ------------------------------------------------------------------ */

const {
  DOSSIER_D_ATTENTE,
  FICHIER_D_ATTENTE,
  documentRecollable,
  fichierDAttentePourCopie,
} = await import('@haikodev/shared');

/* ------------------------------------------------------------------ */
/* 1. Le dépôt d'une règle apprise est propre à la carte               */
/* ------------------------------------------------------------------ */

test('chaque copie de travail a SON fichier d’attente, et deux cartes n’en partagent aucun', () => {
  const une = fichierDAttentePourCopie('afficher-le-parcours-de-la-memoire-837088');
  const deux = fichierDAttentePourCopie('reduire-les-conflits-de-fusion-582c24');
  assert.equal(une, `${DOSSIER_D_ATTENTE}/afficher-le-parcours-de-la-memoire-837088.md`);
  assert.notEqual(une, deux);
});

test('un nom de copie exotique est assaini, un nom vide rend le fichier commun', () => {
  assert.equal(fichierDAttentePourCopie('Ma Carte — Été 2026 !'), `${DOSSIER_D_ATTENTE}/ma-carte-t-2026.md`);
  assert.equal(fichierDAttentePourCopie('   '), undefined);
  assert.equal(fichierDAttentePourCopie(undefined), undefined);
});

test('le dépôt d’une carte reste recollable : une carte reprise revient sur son propre fichier', () => {
  assert.equal(documentRecollable(`${DOSSIER_D_ATTENTE}/une-carte-aaaaaa.md`), true);
  assert.equal(documentRecollable(FICHIER_D_ATTENTE), true);
  // Le filet ne s'étend jamais au code, même dans ce dossier-là.
  assert.equal(documentRecollable(`${DOSSIER_D_ATTENTE}/une-carte.ts`), false);
});

/* ------------------------------------------------------------------ */
/* 2. La nuit range TOUS les dépôts, et retire ceux des cartes         */
/* ------------------------------------------------------------------ */

function depotJetable(): string {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-attente-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: racine, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'essai@haikodev');
  git('config', 'user.name', 'Essai');
  fs.mkdirSync(path.join(racine, 'docs', 'regles'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'docs', 'regles', 'cartes.md'), '# Cartes — règles du moteur\n');
  fs.writeFileSync(path.join(racine, 'CLAUDE.md'), '# Instructions\n\n### Cartes\n\nTexte entier : (`project_memory`, sujet « cartes »).\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'départ');
  return racine;
}

const ENTREE = (titre: string) =>
  `## ${titre}\n- sujet : cartes\n- contrat : ${titre.toLowerCase()}\n\nLe texte entier de la règle ${titre}.\n`;

test('la nuit lit le fichier commun ET les dépôts de carte, puis retire ceux des cartes', async () => {
  const { depotsDAttente, rangerUnProjet } = await import('../instructions-en-attente.js');
  const racine = depotJetable();
  try {
    fs.mkdirSync(path.join(racine, DOSSIER_D_ATTENTE), { recursive: true });
    fs.writeFileSync(path.join(racine, FICHIER_D_ATTENTE), `# En attente\n\n${ENTREE('Règle du commun')}`);
    fs.writeFileSync(path.join(racine, DOSSIER_D_ATTENTE, 'carte-a.md'), ENTREE('Règle de la carte A'));
    fs.writeFileSync(path.join(racine, DOSSIER_D_ATTENTE, 'carte-b.md'), ENTREE('Règle de la carte B'));

    assert.deepEqual(depotsDAttente(racine), [
      FICHIER_D_ATTENTE,
      `${DOSSIER_D_ATTENTE}/carte-a.md`,
      `${DOSSIER_D_ATTENTE}/carte-b.md`,
    ]);

    const plan = rangerUnProjet(racine);
    assert.ok(plan, 'le rangement doit avoir eu lieu');
    const range = fs.readFileSync(path.join(racine, 'docs', 'regles', 'cartes.md'), 'utf8');
    for (const titre of ['Règle du commun', 'Règle de la carte A', 'Règle de la carte B']) {
      assert.ok(range.includes(titre), `« ${titre} » doit être rangée dans son sujet`);
    }
    // Les dépôts de carte sont consommés : les relire chaque nuit rangerait deux fois.
    assert.equal(fs.existsSync(path.join(racine, DOSSIER_D_ATTENTE, 'carte-a.md')), false);
    assert.equal(fs.existsSync(path.join(racine, DOSSIER_D_ATTENTE, 'carte-b.md')), false);
    assert.equal(fs.existsSync(path.join(racine, FICHIER_D_ATTENTE)), true);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('un projet sans aucun dépôt ne fait rien, et ne casse pas la nuit des autres', async () => {
  const { rangerUnProjet, depotsDAttente } = await import('../instructions-en-attente.js');
  const racine = depotJetable();
  try {
    assert.deepEqual(depotsDAttente(racine), []);
    assert.equal(rangerUnProjet(racine), undefined);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* 3. Le recollage se fait dans la copie, sur une fusion en cours      */
/* ------------------------------------------------------------------ */

function depotAvecDeuxBranches(fichiers: Record<string, [string, string, string]>): string {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-recollage-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: racine, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'essai@haikodev');
  git('config', 'user.name', 'Essai');
  for (const [nom, [depart]] of Object.entries(fichiers)) {
    fs.mkdirSync(path.join(racine, path.dirname(nom)), { recursive: true });
    fs.writeFileSync(path.join(racine, nom), depart);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'départ');

  git('checkout', '-q', '-b', 'tache/une-carte');
  for (const [nom, [, , surLaCarte]] of Object.entries(fichiers)) fs.writeFileSync(path.join(racine, nom), surLaCarte);
  git('add', '-A');
  git('commit', '-q', '-m', 'la carte');

  git('checkout', '-q', 'main');
  for (const [nom, [, surMain]] of Object.entries(fichiers)) fs.writeFileSync(path.join(racine, nom), surMain);
  git('add', '-A');
  git('commit', '-q', '-m', 'le tronc');
  return racine;
}

test('un heurt de pure documentation se recolle et referme la fusion, sans agent', async () => {
  const { fichiersEnConflitDuDossier, recollerLesDocumentsEnConflit } = await import('../recollage-documentaire.js');
  const racine = depotAvecDeuxBranches({
    'MEMOIRE.md': ['- un fait\n', '- un fait\n- ce qu’a appris le tronc\n', '- un fait\n- ce qu’a appris la carte\n'],
  });
  try {
    const merge = execFileSync('bash', ['-c', 'git merge --no-ff --no-edit tache/une-carte || true'], {
      cwd: racine,
      encoding: 'utf8',
    });
    assert.ok(merge !== undefined);
    const enConflit = await fichiersEnConflitDuDossier(racine);
    assert.deepEqual(enConflit, ['MEMOIRE.md']);

    const bilan = await recollerLesDocumentsEnConflit(racine, enConflit);
    assert.equal(bilan.fusionnee, true, 'la fusion doit être recollée et enregistrée');
    assert.deepEqual(bilan.restants, []);

    const texte = fs.readFileSync(path.join(racine, 'MEMOIRE.md'), 'utf8');
    assert.ok(texte.includes('ce qu’a appris le tronc'), 'l’intention du tronc est gardée');
    assert.ok(texte.includes('ce qu’a appris la carte'), 'l’intention de la carte est gardée');
    assert.equal(await fichiersEnConflitDuDossier(racine).then((f) => f.length), 0);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('un heurt MIXTE recolle les documents et ne laisse que le code à l’agent', async () => {
  const { fichiersEnConflitDuDossier, recollerLesDocumentsEnConflit } = await import('../recollage-documentaire.js');
  const racine = depotAvecDeuxBranches({
    'MEMOIRE.md': ['- un fait\n', '- un fait\n- tronc\n', '- un fait\n- carte\n'],
    'src/code.ts': ['export const n = 0;\n', 'export const n = 1;\n', 'export const n = 2;\n'],
  });
  try {
    execFileSync('bash', ['-c', 'git merge --no-ff --no-edit tache/une-carte || true'], { cwd: racine, encoding: 'utf8' });
    const enConflit = await fichiersEnConflitDuDossier(racine);
    assert.deepEqual(enConflit.sort(), ['MEMOIRE.md', 'src/code.ts']);

    const bilan = await recollerLesDocumentsEnConflit(racine, enConflit);
    assert.equal(bilan.fusionnee, false, 'du code reste en conflit : la fusion ne se referme pas');
    assert.deepEqual(bilan.recolles, ['MEMOIRE.md']);
    assert.deepEqual(bilan.restants, ['src/code.ts'], 'l’agent ne reçoit plus que le code');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('un heurt de pur code ne touche à rien et rend la main tout de suite', async () => {
  const { fichiersEnConflitDuDossier, recollerLesDocumentsEnConflit } = await import('../recollage-documentaire.js');
  const racine = depotAvecDeuxBranches({
    'src/code.ts': ['export const n = 0;\n', 'export const n = 1;\n', 'export const n = 2;\n'],
  });
  try {
    execFileSync('bash', ['-c', 'git merge --no-ff --no-edit tache/une-carte || true'], { cwd: racine, encoding: 'utf8' });
    const enConflit = await fichiersEnConflitDuDossier(racine);
    const bilan = await recollerLesDocumentsEnConflit(racine, enConflit);
    assert.equal(bilan.fusionnee, false);
    assert.deepEqual(bilan.recolles, []);
    assert.deepEqual(bilan.restants, ['src/code.ts']);
    assert.equal(bilan.recit, '', 'rien à raconter : aucun document n’était en jeu');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});
