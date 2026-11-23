import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

/*
 * UNE FICHE DE SAUVEGARDE S'ESSAIE AVANT DE S'ENREGISTRER.
 *
 * Une fiche COMPLÈTE n'est pas une fiche JUSTE : le fichier de base peut ne pas
 * exister, le dossier avoir été déplacé. On ne l'apprenait qu'à la première
 * nuit, dans un échec que personne ne regardait. Ici, les accès sont ouverts
 * POUR DE VRAI (un fichier SQLite, un dossier sur le disque) et l'outil de
 * l'assistant REFUSE d'enregistrer ce qui ne répond pas — sauf accord explicite,
 * porté par « forcer ».
 */

/*
 * LE BAC À SABLE SE NOMME PAR LE NOM D'AUJOURD'HUI.
 *
 * Un test qui n'y pose pas `BELUGA_DATA` AVANT son premier import du démon
 * tombe sur la BASE RÉELLEMENT SERVIE, où il enregistrait deux fiches
 * « Boutique » à chaque passage. Le passage de nuit les sauvegardait ensuite en
 * boucle et convoquait un assistant : des décisions attendues sur des fiches qui
 * n'existaient que pour un test.
 *
 * Le dossier est donc posé d'abord, et `scripts/verif-tests-isoles.mjs` vérifie
 * chaque jour qu'aucun test n'ouvre la base servie.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'backups-essai-'));
process.env.BELUGA_DATA = bacASable;

const { Agent, Project, essaisConcluants } = await import('@beluga/shared');
const store = await import('../store.js');
const { callTool } = await import('../tools.js');
const { essayerLesAcces, listerSites } = await import('../backups.js');
const { siteVierge } = await import('@beluga/shared');

/* Le site à essayer : une vraie base SQLite et un vrai dossier de fichiers. */
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'site-a-sauvegarder-'));
const BASE_DU_SITE = path.join(SITE, 'boutique.sqlite');
// Une VRAIE base : l'outil ne se contente plus d'ouvrir le fichier, il rejoue
// la recette (« sqlite3 .backup »), qui refuse un faux fichier.
new Database(BASE_DU_SITE).exec('CREATE TABLE produits (nom TEXT)');
const FICHIERS_DU_SITE = path.join(SITE, 'public');
fs.mkdirSync(FICHIERS_DU_SITE, { recursive: true });
fs.writeFileSync(path.join(FICHIERS_DU_SITE, 'index.html'), '<h1>Boutique</h1>');

const projet = store.saveProject(
  Project.parse({
    id: 'projet-backups',
    name: 'Projet backups',
    path: SITE,
    createdAt: store.now(),
    updatedAt: store.now(),
  }),
);
const agent = store.saveAgent(
  Agent.parse({
    id: 'agent-backups',
    projectId: projet.id,
    role: 'task',
    title: 'Assistant de backups',
    run: { engine: 'claude' },
    workdir: SITE,
    status: 'running',
    createdAt: store.now(),
    updatedAt: store.now(),
  }),
);

const contexte = { agentId: agent.id, projectId: projet.id, role: 'task' as const };

const ficheJuste = {
  nom: 'Boutique',
  base: { moteur: 'sqlite', nom: BASE_DU_SITE },
  fichiers: { moyen: 'local', chemin: FICHIERS_DU_SITE },
  conservationJours: 7,
};

test('un essai ouvre la base et le dossier POUR DE VRAI', async () => {
  const site = {
    ...siteVierge(null, 'Boutique'),
    base: { moteur: 'sqlite' as const, hote: '', port: '', nom: BASE_DU_SITE, utilisateur: '', motDePasse: '' },
    fichiers: {
      moyen: 'local' as const,
      chemin: FICHIERS_DU_SITE,
      hote: '',
      port: '',
      utilisateur: '',
      motDePasse: '',
    },
  };
  const essais = await essayerLesAcces(site);
  assert.equal(essaisConcluants(essais), true);
  assert.deepEqual(
    essais.map((e) => e.cible),
    ['base', 'fichiers'],
  );
});

test('un fichier de base absent et un dossier absent sont DITS, chacun avec sa raison', async () => {
  const site = {
    ...siteVierge(null, 'Boutique'),
    base: {
      moteur: 'sqlite' as const,
      hote: '',
      port: '',
      nom: path.join(SITE, 'nulle-part.sqlite'),
      utilisateur: '',
      motDePasse: '',
    },
    fichiers: {
      moyen: 'local' as const,
      chemin: path.join(SITE, 'dossier-parti'),
      hote: '',
      port: '',
      utilisateur: '',
      motDePasse: '',
    },
  };
  const essais = await essayerLesAcces(site);
  assert.equal(essaisConcluants(essais), false);
  assert.equal(
    essais.every((e) => !e.ok && e.detail.length > 0),
    true,
  );
});

test('l’outil REFUSE d’enregistrer une fiche dont un accès ne répond pas', async () => {
  const resultat = await callTool(contexte, 'backup_recette', {
    ...ficheJuste,
    nom: 'Boutique cassée',
    fichiers: { moyen: 'local', chemin: path.join(SITE, 'dossier-parti') },
  });
  assert.equal(resultat.ok, false);
  assert.match(resultat.text ?? '', /ne répond pas/);
  assert.equal(
    listerSites().some((site) => site.nom === 'Boutique cassée'),
    false,
    'rien n’est enregistré tant que l’accès ne répond pas',
  );
});

test('« forcer » enregistre quand même : c’est la porte de sortie, pas le chemin ordinaire', async () => {
  const resultat = await callTool(contexte, 'backup_recette', {
    ...ficheJuste,
    nom: 'Boutique hors ligne',
    fichiers: { moyen: 'local', chemin: path.join(SITE, 'dossier-parti') },
    forcer: true,
  });
  assert.equal(resultat.ok, true);
  assert.equal(
    listerSites().some((site) => site.nom === 'Boutique hors ligne'),
    true,
  );
});

test('une fiche dont tout répond s’enregistre, et retient sa conversation', async () => {
  const resultat = await callTool(contexte, 'backup_recette', ficheJuste);
  assert.equal(resultat.ok, true);
  assert.match(resultat.text ?? '', /Essai des accès/);
  const site = listerSites().find((s) => s.nom === 'Boutique');
  assert.ok(site);
  assert.equal(site!.assistantId, agent.id);
  assert.equal(site!.assistantProjectId, projet.id);
});

test('« backup_essai » sonde sans rien enregistrer', async () => {
  const avant = listerSites().length;
  const resultat = await callTool(contexte, 'backup_essai', {
    nom: 'Site jamais enregistré',
    base: { moteur: 'sqlite', nom: BASE_DU_SITE },
    fichiers: { moyen: 'local', chemin: FICHIERS_DU_SITE },
  });
  assert.equal(resultat.ok, true);
  assert.match(resultat.text ?? '', /Tout répond/);
  assert.equal(listerSites().length, avant, 'un essai n’enregistre aucune fiche');
});

test('« backup_essai » sur un site déjà là reprend ce qui est en base', async () => {
  const site = listerSites().find((s) => s.nom === 'Boutique');
  assert.ok(site);
  const resultat = await callTool(contexte, 'backup_essai', { id: site!.id });
  assert.equal(resultat.ok, true);
  assert.match(resultat.text ?? '', /Tout répond/);
});

const RECETTE_DU_CODE = {
  explication: 'le dossier public est tout le site',
  etapes: [
    {
      genre: 'code',
      libelle: 'Le dossier public',
      prendre: 'cp -a "$FICHIERS_CHEMIN/." "$SORTIE/"',
      remettre: 'cp -a "$ENTREE/." "$FICHIERS_CHEMIN/"',
    },
  ],
};

test('« backup_essai » rejoue une recette et rend ce que l’archive contient, sans rien garder', async () => {
  const avant = listerSites().length;
  const resultat = await callTool(contexte, 'backup_essai', {
    nom: 'Site jamais enregistré',
    fichiers: { moyen: 'local', chemin: FICHIERS_DU_SITE },
    recette: RECETTE_DU_CODE,
  });
  assert.equal(resultat.ok, true);
  assert.match(resultat.text ?? '', /archive complète/);
  assert.match(resultat.text ?? '', /Le dossier public : 1 fichier/);
  assert.equal(listerSites().length, avant);
});

test('« backup_recette » refuse une recette qui ne donne qu’une archive partielle, en nommant l’étape', async () => {
  const resultat = await callTool(contexte, 'backup_recette', {
    ...ficheJuste,
    nom: 'Boutique à moitié',
    recette: {
      etapes: [
        ...RECETTE_DU_CODE.etapes,
        { genre: 'base', libelle: 'Une base introuvable', prendre: 'echo "pas de base" >&2; exit 2', remettre: 'true' },
      ],
    },
  });
  assert.equal(resultat.ok, false);
  assert.match(resultat.text ?? '', /PARTIELLE/);
  assert.match(resultat.text ?? '', /Une base introuvable : MANQUE — pas de base/);
  assert.equal(listerSites().some((s) => s.nom === 'Boutique à moitié'), false);
});

test('« backup_recette » enregistre la recette qui marche, avec sa date de validation et son auteur', async () => {
  const resultat = await callTool(contexte, 'backup_recette', { ...ficheJuste, nom: 'Boutique analysée', recette: RECETTE_DU_CODE });
  assert.equal(resultat.ok, true, resultat.text);
  assert.match(resultat.text ?? '', /Recette écrite par l’agent/);
  const site = listerSites().find((s) => s.nom === 'Boutique analysée');
  assert.equal(site?.recette?.etapes[0].libelle, 'Le dossier public');
  assert.ok((site?.recetteValideeLe ?? 0) > 0);
  assert.equal(site?.recetteAgentId, agent.id);

  // Corriger la fiche sans redire la recette la garde.
  const corrige = await callTool(contexte, 'backup_recette', { id: site!.id, nom: site!.nom, conservationJours: 30 });
  assert.equal(corrige.ok, true, corrige.text);
  assert.equal(listerSites().find((s) => s.id === site!.id)?.recette?.etapes.length, 1);
});
