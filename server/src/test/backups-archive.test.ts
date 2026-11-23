import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

/*
 * UN BACKUP EST UNE RECETTE REJOUÉE VERS UNE ARCHIVE ZIP, ET SE RESTAURE D'UN
 * GESTE — sur un vrai disque, avec une vraie base SQLite et un vrai dossier.
 *
 * Le bac à sable pose le dossier de données, pour la raison dite en tête de
 * `backups-essai.test.ts` : ce test ne doit jamais toucher la base réellement
 * servie.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'backups-archive-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const backups = await import('../backups.js');
const { lireArchive } = await import('../archive-zip.js');
const { recetteProposee, siteVierge } = await import('@beluga/shared');

const STOCKAGE = path.join(bacASable, 'stockage');
fs.mkdirSync(STOCKAGE, { recursive: true });
store.saveSettings({ backupDossier: STOCKAGE });

/* Le site : une base SQLite qui porte une ligne, et un dossier public. */
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'site-a-sauvegarder-'));
const BASE = path.join(SITE, 'boutique.sqlite');
const PUBLIC = path.join(SITE, 'public');
fs.mkdirSync(path.join(PUBLIC, 'node_modules', 'lourd'), { recursive: true });
fs.writeFileSync(path.join(PUBLIC, 'index.html'), '<h1>Boutique</h1>');
fs.writeFileSync(path.join(PUBLIC, 'node_modules', 'lourd', 'x.js'), 'refabriquable');
{
  const db = new Database(BASE);
  db.exec("CREATE TABLE produits (nom TEXT); INSERT INTO produits VALUES ('chaise');");
  db.close();
}

function lireProduits(): string[] {
  const db = new Database(BASE, { readonly: true });
  const noms = (db.prepare('SELECT nom FROM produits').all() as { nom: string }[]).map((p) => p.nom);
  db.close();
  return noms;
}

const enregistre = backups.enregistrerSite({
  ...siteVierge(),
  nom: 'Boutique',
  base: { moteur: 'sqlite', hote: '', port: '', nom: BASE, utilisateur: '', motDePasse: '' },
  fichiers: { moyen: 'local', chemin: PUBLIC, hote: '', port: '', utilisateur: '', motDePasse: '' },
});
assert.ok(enregistre.ok);
const SITE_ID = enregistre.ok ? enregistre.site.id : '';

test('une fiche sans recette de l’agent rejoue la recette de sa fiche, vers une archive jugée réussie', async () => {
  const issue = await backups.prendreUnBackup(SITE_ID, 'manuel');
  assert.equal(issue.ok, true, issue.raison);
  const point = issue.point!;
  assert.equal(point.statut, 'reussi', point.detail);
  assert.ok(point.cheminArchive && fs.existsSync(point.cheminArchive));
  assert.ok(point.cheminArchive!.startsWith(STOCKAGE));
  assert.ok((point.taille ?? 0) > 0);
  assert.deepEqual(point.inventaire?.etapes.map((e) => [e.id, e.ok]), [
    ['base', true],
    ['fichiers', true],
  ]);

  const lue = await lireArchive(point.cheminArchive!);
  const noms = lue!.entrees.map((e) => e.nom);
  assert.ok(noms.includes('fichiers/index.html') && noms.includes('base/base.sqlite'));
  assert.ok(!noms.some((n) => n.includes('node_modules')), 'ce qui se refabrique n’est pas pris');

  // Relu en base : l'archive, son poids et son inventaire ont survécu.
  const relu = backups.lirePoint(point.id)!;
  assert.equal(relu.cheminArchive, point.cheminArchive);
  assert.equal(relu.inventaire?.etapes.length, 2);
  // LE TRAVAIL SE FAIT SUR LE DISQUE DE STOCKAGE, jamais sur celui du serveur (12/10/2026).
  assert.equal(backups.racineDeTravail(), path.join(STOCKAGE, '.travail'));
  assert.ok(!fs.existsSync(path.join(bacASable, 'backups-travail')), 'rien n’est posé sur le disque du serveur');
  const travail = backups.racineDeTravail();
  assert.ok(!fs.existsSync(travail) || !fs.readdirSync(travail).filter((n) => n !== 'essais').length, 'le dossier de travail est vidé');
});

test('restaurer remet la base et les fichiers, après un filet pris juste avant', async () => {
  const point = backups.listerPoints(SITE_ID).find((p) => p.statut === 'reussi')!;
  fs.rmSync(path.join(PUBLIC, 'index.html'));
  fs.writeFileSync(path.join(PUBLIC, 'intrus.html'), 'ajouté après');
  {
    const db = new Database(BASE);
    db.exec("DELETE FROM produits; INSERT INTO produits VALUES ('table');");
    db.close();
  }

  const avant = backups.listerPoints(SITE_ID).length;
  const issue = await backups.restaurerUnBackup(point.id);
  assert.equal(issue.ok, true, issue.raison);
  assert.ok(issue.filet, 'un filet est pris avant d’écraser');
  assert.equal(backups.listerPoints(SITE_ID).length, avant + 1);

  assert.equal(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), '<h1>Boutique</h1>');
  assert.ok(!fs.existsSync(path.join(PUBLIC, 'intrus.html')), 'le dossier revient à l’identique');
  assert.ok(fs.existsSync(path.join(PUBLIC, 'node_modules', 'lourd', 'x.js')), 'ce qui n’a pas été pris n’est pas effacé');
  assert.deepEqual(lireProduits(), ['chaise']);
});

test('une étape qui tombe rend le point partiel, et nomme l’étape', async () => {
  const recette = recetteProposee({
    explication: 'essai',
    etapes: [
      { id: 'public', genre: 'fichiers', libelle: 'Le dossier public', prendre: 'cp -a "$FICHIERS_CHEMIN/index.html" "$SORTIE/"', remettre: 'cp -a "$ENTREE/." "$FICHIERS_CHEMIN/"' },
      { id: 'cassee', genre: 'base', libelle: 'Une base absente', prendre: 'echo "base introuvable" >&2; exit 3', remettre: 'true' },
    ],
  });
  const issue = await backups.essayerLaRecette(backups.lireSite(SITE_ID)!, recette);
  assert.equal(issue.statut, 'partiel');
  assert.match(issue.detail, /Une base absente : base introuvable/);
  assert.equal(issue.inventaire?.etapes.find((e) => e.id === 'public')?.ok, true);
});

test('un essai de recette ne laisse rien sur le disque de stockage', async () => {
  const avant = fs.readdirSync(STOCKAGE, { recursive: true }).length;
  const issue = await backups.essayerLaRecette(
    backups.lireSite(SITE_ID)!,
    recetteProposee({ etapes: [{ genre: 'code', libelle: 'Code', prendre: 'echo ok > "$SORTIE/a.txt"', remettre: 'true' }] }),
  );
  assert.equal(issue.statut, 'reussi');
  assert.equal(fs.readdirSync(STOCKAGE, { recursive: true }).length, avant);
});

test('une commande de recette qui viserait le démon est refusée avant de partir', async () => {
  await assert.rejects(
    () => backups.lancerCommandeDeRecette('systemctl stop beluga.service', {}, os.tmpdir()),
    /démon|Beluga|refus/i,
  );
});

test('une commande qui ne rend pas la main est coupée au délai, et le dit', async () => {
  await assert.rejects(() => backups.lancerCommandeDeRecette('sleep 30', {}, os.tmpdir(), 300), /rendu la main/);
});

test('la recette de l’agent est gardée quand le formulaire corrige la fiche sans la redire', () => {
  const recette = recetteProposee({ etapes: [{ genre: 'code', libelle: 'Code', prendre: 'true', remettre: 'true' }] });
  const avec = backups.enregistrerSite({ ...backups.lireSite(SITE_ID)!, recette, recetteValideeLe: 5, recetteAgentId: 'agent-x' });
  assert.ok(avec.ok);
  const { recette: _oubliee, recetteValideeLe: _v, recetteAgentId: _a, ...sansRecette } = backups.lireSite(SITE_ID)!;
  const corrige = backups.enregistrerSite({ ...(sansRecette as any), note: 'corrigée' });
  assert.ok(corrige.ok);
  const relu = backups.lireSite(SITE_ID)!;
  assert.equal(relu.note, 'corrigée');
  assert.equal(relu.recette?.etapes[0].libelle, 'Code');
  assert.equal(relu.recetteAgentId, 'agent-x');
  // Remise à « aucune recette » pour les tests suivants.
  assert.ok(backups.enregistrerSite({ ...relu, recette: null, recetteValideeLe: 0, recetteAgentId: '' }).ok);
});

test('le ménage retire l’archive d’un point trop vieux, du disque comme de la base', async () => {
  const site = backups.lireSite(SITE_ID)!;
  const points = backups.listerPoints(SITE_ID).filter((p) => p.cheminArchive);
  assert.ok(points.length >= 2);
  const plusVieux = points[points.length - 1];
  const loin = Date.now() + (site.conservationJours + 2) * 24 * 3600 * 1000;
  const jetes = await backups.menageDuSite(site, loin);
  assert.ok(jetes >= 1);
  assert.ok(!fs.existsSync(plusVieux.cheminArchive!), 'l’archive quitte le disque');
  assert.equal(backups.lirePoint(plusVieux.id), null);
});
