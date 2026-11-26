import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LA TOURNÉE AUTOMATIQUE DES SAUVEGARDES NE FAIT PLUS DE LIGNE DANS LA COLONNE (décision de l'utilisateur,
 * 25/11/2026 : la colonne ne montre que le ponctuel). Une sauvegarde lancée à la main reste visible ; les lignes
 * automatiques déjà gardées sortent, une ligne manuelle ou sans point retrouvé reste.
 *
 * Bac à sable comme `backups-archive.test.ts` : jamais la base réellement servie.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'travaux-sauvegardes-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const backups = await import('../backups.js');
const travaux = await import('../travaux-des-services.js');
const { getDb, setMeta } = await import('../db.js');
const { siteVierge } = await import('@beluga/shared');

const STOCKAGE = path.join(bacASable, 'stockage');
fs.mkdirSync(STOCKAGE, { recursive: true });
store.saveSettings({ backupDossier: STOCKAGE });

const PUBLIC = fs.mkdtempSync(path.join(os.tmpdir(), 'site-tournee-'));
fs.writeFileSync(path.join(PUBLIC, 'index.html'), '<h1>Site</h1>');

function unSite(nom: string): string {
  const enregistre = backups.enregistrerSite({
    ...siteVierge(),
    nom,
    fichiers: { moyen: 'local', chemin: PUBLIC, hote: '', port: '', utilisateur: '', motDePasse: '' },
  });
  assert.ok(enregistre.ok);
  return enregistre.ok ? enregistre.site.id : '';
}

const AUTO = unSite('Tournée');
const MAIN = unSite('À la main');
const SANS_POINT = unSite('Sans point');

test('une sauvegarde de la tournée automatique n’est pas montrée, une sauvegarde à la main l’est', async () => {
  const automatique = backups.prendreUnBackup(AUTO, 'automatique');
  assert.deepEqual(backups.backupsEnCours(), [AUTO], 'le verrou la tient toujours');
  assert.deepEqual(backups.backupsEnCoursVisibles(), [], 'la colonne ne la voit pas');
  const finie = await automatique;
  assert.equal(finie.ok, true, finie.raison);
  assert.deepEqual(backups.backupsEnCours(), []);

  const manuelle = backups.prendreUnBackup(MAIN, 'manuel');
  assert.deepEqual(backups.backupsEnCoursVisibles(), [MAIN]);
  assert.equal((await manuelle).ok, true);
  assert.deepEqual(backups.backupsEnCoursVisibles(), []);
});

test('les lignes automatiques déjà gardées sortent ; la manuelle et celle sans point restent', () => {
  const debutDe = (siteId: string) =>
    (getDb().prepare('SELECT debut FROM backup_points WHERE site_id = ? ORDER BY debut DESC LIMIT 1').get(siteId) as { debut: number }).debut;
  const ligne = (siteId: string, debut: number) => ({
    id: `backups:${siteId}`,
    service: 'backups',
    projectId: 'p1',
    nature: 'sauvegarde',
    adresse: `backups/${siteId}`,
    etat: 'termine',
    debut,
    fin: debut + 1000,
    vusPar: [],
  });
  setMeta(
    'travaux-des-services',
    JSON.stringify([ligne(AUTO, debutDe(AUTO) + 2000), ligne(MAIN, debutDe(MAIN) + 2000), ligne(SANS_POINT, Date.now())]),
  );
  assert.equal(travaux.retirerLesSauvegardesAutomatiques(), 1);
  assert.deepEqual(
    travaux.travauxSuivis().map((t) => t.id),
    [`backups:${MAIN}`, `backups:${SANS_POINT}`],
  );
  assert.equal(travaux.retirerLesSauvegardesAutomatiques(), 0, 'sans effet la seconde fois');
});
