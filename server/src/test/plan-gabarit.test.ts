/**
 * LE GABARIT D'UN PLAN — le texte rendu par le moteur, rangé toujours pareil.
 *
 * Trois écritures d'une même partie (titre Markdown, ligne en gras, intitulé
 * suivi de deux points) doivent donner la MÊME structure : c'est ce qui permet
 * à l'affichage de dessiner un rapport au lieu d'un long texte plat.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLES_DU_GABARIT, planEnTexteSimple, rangerLePlan } from '@beluga/shared';

const EN_TITRES = [
  '# Refonte de la page d’accueil',
  '_Trois écrans à revoir, sans toucher au tableau._',
  '',
  '## Faisabilité',
  'Ce qui existe aujourd’hui tient debout.',
  '',
  '## Chemin à suivre',
  '1. Poser le gabarit.',
  '2. Brancher l’affichage.',
  '',
  '## Conséquences',
  'Rien ne bouge ailleurs.',
  '',
  '## Améliorations apportées',
  '- Ajoute un export au format tableur.',
  '- Retiens le dernier dossier choisi.',
].join('\n');

/* LA FORME NEUVE : plus de résumé en italique, un bloc « Liste des tâches »
   ouvre le plan. */
const AVEC_TACHES = [
  '# Refonte de la page d’accueil',
  '',
  '## Liste des tâches',
  '**Poser le gabarit**',
  'Découper l’écran en trois zones et fixer leurs marges.',
  '',
  '**Brancher l’affichage**',
  'Relier chaque zone à sa source de données.',
  '',
  '## Faisabilité',
  'Ce qui existe aujourd’hui tient debout.',
  '',
  '## Chemin à suivre',
  '1. Poser le gabarit.',
  '',
  '## Conséquences',
  'Rien ne bouge ailleurs.',
  '',
  '## Améliorations apportées',
  '- Ajoute un export au format tableur.',
].join('\n');

const EN_GRAS = [
  '**Faisabilité**',
  'Ce qui existe aujourd’hui tient debout.',
  '',
  '**Chemin à suivre :**',
  '1. Poser le gabarit.',
  '',
  '**Conséquences**',
  'Rien ne bouge ailleurs.',
  '',
  '**Améliorations apportées**',
  '- Ajoute un export au format tableur.',
].join('\n');

test('un plan en titres Markdown se range en quatre parties numérotées', () => {
  const range = rangerLePlan(EN_TITRES);
  assert.equal(range.conforme, true);
  assert.deepEqual(
    range.parties.map((p) => p.cle),
    [...CLES_DU_GABARIT],
  );
  assert.deepEqual(
    range.parties.map((p) => p.numero),
    [1, 2, 3, 4],
  );
  assert.equal(range.titre, 'Refonte de la page d’accueil');
  assert.equal(range.resume, 'Trois écrans à revoir, sans toucher au tableau.');
  assert.match(range.parties[1].corps, /1\. Poser le gabarit\./);
  // Le titre de la partie ne se retrouve JAMAIS dans son corps.
  assert.ok(!range.parties[0].corps.includes('Faisabilité'));
});

test('un plan écrit en lignes grasses se range exactement pareil', () => {
  const range = rangerLePlan(EN_GRAS);
  assert.equal(range.conforme, true);
  assert.deepEqual(
    range.parties.map((p) => p.cle),
    [...CLES_DU_GABARIT],
  );
  assert.equal(range.titre, null);
  assert.equal(range.parties[0].corps, 'Ce qui existe aujourd’hui tient debout.');
});

test('les emoji et la numérotation d’un titre ne cachent pas la partie', () => {
  const range = rangerLePlan(
    ['## 1. 🎯 Faisabilité', 'Oui.', '## 2. 🛤️ Chemin à suivre', 'Une étape.'].join('\n'),
  );
  assert.equal(range.parties.length, 2);
  assert.equal(range.conforme, false);
  assert.equal(range.parties[0].nom, 'Faisabilité');
});

test('une phrase qui cite une partie n’ouvre pas de section', () => {
  const range = rangerLePlan(
    ['## Faisabilité', 'Chemin à suivre : on commence par le serveur, puis l’écran.'].join('\n'),
  );
  assert.equal(range.parties.length, 1);
  assert.match(range.parties[0].corps, /on commence par le serveur/);
});

test('une question posée après la dernière puce se détache du plan', () => {
  const range = rangerLePlan(
    [
      '## Faisabilité',
      'Oui.',
      '## Chemin à suivre',
      '1. Une étape.',
      '## Conséquences',
      'Aucune.',
      '## Améliorations apportées',
      '- Ajoute un export.',
      '',
      'Préférez-vous garder l’ancien écran en parallèle ?',
    ].join('\n'),
  );
  assert.equal(range.queue, 'Préférez-vous garder l’ancien écran en parallèle ?');
  assert.equal(range.parties[3].corps, '- Ajoute un export.');
});

test('un texte qui n’est pas un plan ne se dit pas conforme', () => {
  const range = rangerLePlan('Voici trois pistes, dites-moi laquelle intégrer.');
  assert.equal(range.conforme, false);
  assert.equal(range.parties.length, 0);
});

/* ------------------------------------------------------------------ */
/* LE PLAN SE LIT EN TEXTE SIMPLE, PLUS EN RAPPORT DÉPLIANT            */
/* ------------------------------------------------------------------ */

test('un plan est recomposé en markdown simple, titres normalisés', () => {
  const texte = planEnTexteSimple(EN_TITRES) ?? '';
  assert.ok(texte.startsWith('# Refonte de la page d’accueil'), texte.slice(0, 40));
  assert.ok(texte.includes('_Trois écrans à revoir, sans toucher au tableau._'));
  for (const nom of ['## Faisabilité', '## Chemin à suivre', '## Conséquences', '## Améliorations apportées']) {
    assert.ok(texte.includes(nom), nom);
  }
  // Le corps est gardé mot pour mot : on normalise les titres, pas le texte.
  assert.ok(texte.includes('Ce qui existe aujourd’hui tient debout.'));
  assert.ok(texte.includes('- Ajoute un export au format tableur.'));
});

test('un plan écrit EN GRAS retrouve les mêmes titres qu’un plan en titres', () => {
  const texte = planEnTexteSimple(EN_GRAS) ?? '';
  for (const nom of ['## Faisabilité', '## Chemin à suivre', '## Conséquences', '## Améliorations apportées']) {
    assert.ok(texte.includes(nom), nom);
  }
  // Plus une seule ligne en gras : c'est ce qui rendait le plan illisible.
  assert.ok(!texte.includes('**Faisabilité**'), texte);
  assert.ok(!texte.includes('**Chemin à suivre :**'), texte);
  // Et le texte reste celui du moteur, mot pour mot.
  assert.ok(texte.includes('Ce qui existe aujourd’hui tient debout.'));
  assert.ok(texte.includes('- Ajoute un export au format tableur.'));
});

test('un texte qui n’est pas un plan n’est jamais recomposé', () => {
  assert.equal(planEnTexteSimple('## Faisabilité\nTrois pistes, dites-moi laquelle.'), null);
  assert.equal(planEnTexteSimple(''), null);
});

/* ------------------------------------------------------------------ */
/* LE PREMIER BLOC : LA LISTE DES TÂCHES                               */
/* ------------------------------------------------------------------ */

test('« Liste des tâches » ouvre son bloc, et n’est JAMAIS lue comme un résumé', () => {
  const range = rangerLePlan(AVEC_TACHES);
  assert.equal(range.conforme, true);
  assert.equal(range.resume, null, 'le titre du bloc n’est pas un résumé');
  assert.ok(range.taches?.includes('**Poser le gabarit**'));
  assert.ok(range.taches?.includes('Relier chaque zone à sa source de données.'));
  // Le bloc ne déborde pas sur la première partie.
  assert.ok(!range.taches?.includes('Ce qui existe aujourd’hui tient debout.'));
  assert.equal(range.parties[0].corps.trim(), 'Ce qui existe aujourd’hui tient debout.');
  // Et il ne traîne pas dans le préambule.
  assert.ok(!range.preambule.includes('Poser le gabarit'));
});

test('le plan neuf est recomposé avec son bloc de tâches, sans ligne en italique', () => {
  const texte = planEnTexteSimple(AVEC_TACHES) ?? '';
  assert.ok(texte.startsWith('# Refonte de la page d’accueil\n\n## Liste des tâches'), texte.slice(0, 80));
  assert.ok(texte.includes('**Poser le gabarit**'));
  assert.ok(!texte.includes('_'), 'aucun résumé en italique');
  for (const nom of ['## Faisabilité', '## Chemin à suivre', '## Conséquences', '## Améliorations apportées']) {
    assert.ok(texte.includes(nom), nom);
  }
});

/* ------------------------------------------------------------------ */
/* LE DEUXIÈME BLOC : LES DÉCISIONS DES ITÉRATIONS                      */
/* ------------------------------------------------------------------ */

const AVEC_DECISIONS = [
  '# Refonte de la page d’accueil',
  '',
  '## Liste des tâches',
  '**Poser le gabarit**',
  'Découper l’écran en trois zones et fixer leurs marges.',
  '',
  '**Décisions de mise en page**',
  'Fixer la grille une fois pour toutes.',
  '',
  '## Décisions des itérations',
  '- Version 1 : trois zones retenues.',
  '- Version 2 : le bandeau animé est abandonné, demandé au deuxième message.',
  '',
  '## Faisabilité',
  'Ce qui existe aujourd’hui tient debout.',
  '',
  '## Chemin à suivre',
  '1. Poser le gabarit.',
  '',
  '## Conséquences',
  'Rien ne bouge ailleurs.',
  '',
  '## Améliorations apportées',
  '- Ajoute un export au format tableur.',
].join('\n');

test('« Décisions des itérations » a son propre bloc : ni dans les tâches, ni dans les améliorations', () => {
  const range = rangerLePlan(AVEC_DECISIONS);
  assert.equal(range.conforme, true, 'le bloc ne compte pas parmi les quatre parties');
  assert.equal(range.parties.length, 4);
  assert.match(range.decisions ?? '', /bandeau animé est abandonné/);
  assert.match(range.decisions ?? '', /^- Version 1/);
  // Les tâches ne l'avalent pas — même quand une tâche parle de « décisions ».
  assert.ok(range.taches?.includes('**Décisions de mise en page**'), 'une tâche en gras n’ouvre pas le bloc');
  assert.ok(!range.taches?.includes('Version 1'), range.taches ?? '');
  // Les améliorations gardent leur propre partie.
  const ameliorations = range.parties.find((p) => p.cle === 'ameliorations')!;
  assert.match(ameliorations.corps, /^- Ajoute un export au format tableur\./m);
  assert.equal(range.parties[0].corps.trim(), 'Ce qui existe aujourd’hui tient debout.');
  assert.ok(!range.preambule.includes('Version'));
});

test('le plan est recomposé avec ses décisions juste après ses tâches', () => {
  const texte = planEnTexteSimple(AVEC_DECISIONS) ?? '';
  const taches = texte.indexOf('## Liste des tâches');
  const decisions = texte.indexOf('## Décisions des itérations');
  const faisabilite = texte.indexOf('## Faisabilité');
  assert.ok(taches >= 0 && taches < decisions && decisions < faisabilite, texte);
  assert.ok(texte.includes('- Version 2 : le bandeau animé est abandonné, demandé au deuxième message.'));
});

test('un plan de l’ANCIENNE forme garde son résumé en italique', () => {
  const range = rangerLePlan(EN_TITRES);
  assert.equal(range.taches, null);
  assert.equal(range.decisions, null, 'un plan d’avant le bloc n’a pas de décisions');
  assert.equal(rangerLePlan(AVEC_TACHES).decisions, null);
  assert.ok(!(planEnTexteSimple(AVEC_TACHES) ?? '').includes('Décisions'));
  assert.equal(range.resume, 'Trois écrans à revoir, sans toucher au tableau.');
  const texte = planEnTexteSimple(EN_TITRES) ?? '';
  assert.ok(texte.includes('_Trois écrans à revoir, sans toucher au tableau._'), texte.slice(0, 120));
  assert.ok(!texte.includes('## Liste des tâches'));
});

test('le plan exporté porte sa version et le titre de sa carte, sans caractère interdit', async () => {
  const { nomDuPlanExporte, planAEmporter } = await import('@beluga/shared');
  assert.equal(nomDuPlanExporte(2, 'Outils / boutons: plan', 'pdf'), 'Plan v2 — Outils boutons plan.pdf');
  assert.equal(nomDuPlanExporte(1, '', 'md'), 'Plan v1 — carte.md');
  assert.equal(planAEmporter('texte libre'), 'texte libre');
  assert.equal(planAEmporter('avant\n![#65ec — L’historique](piece:65ec10ac-f493)\naprès'), 'avant\n*Illustration : #65ec — L’historique*\naprès');
});
