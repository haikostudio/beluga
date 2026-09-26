import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

/**
 * LE PASSAGE DES ANCIENS NOMS — BLOC ÉPHÉMÈRE, À RETIRER UNE FOIS JOUÉ EN
 * PRODUCTION.
 *
 * La sauvegarde des sites s'est appelée « snapshot » jusqu'au 10.09.2026. Tout
 * le code dit désormais « backup » ; ce fichier est le SEUL qui cite encore
 * l'ancien nom, parce qu'il en a besoin pour retrouver ce qui a déjà été écrit
 * sous lui : les deux tables et leur index, les lignes du registre des
 * migrations, les clés de réglage, le dossier de stockage sur le disque, et les
 * archives d'export faites avant.
 *
 * CHAQUE GESTE EST IDEMPOTENT : une seconde exécution ne trouve plus rien à
 * renommer et ne fait rien. Le contrôle `scripts/verif-zero-snapshot.mjs`
 * tolère ce fichier, et lui seul avec `HISTORIQUE.md`. La retouche qui le
 * retirera enlève aussi ses trois appels : `db.ts` (`openDb`), `main.ts`
 * (le dossier) et `export-donnees.ts` (les archives d'avant).
 */

/** Les tables d'hier et leur nom d'aujourd'hui. */
export const ANCIENNES_TABLES: Readonly<Record<string, string>> = {
  snapshot_sites: 'backup_sites',
  snapshot_points: 'backup_points',
};

const ANCIEN_INDEX = 'idx_snapshot_points_site';

/** Les lignes du registre des migrations : renommées, elles ne se rejouent pas. */
export const ANCIENNES_MIGRATIONS: Readonly<Record<string, string>> = {
  'snapshots-des-sites': 'backups-des-sites',
  'purger-les-fiches-de-snapshot-d-essai': 'purger-les-fiches-de-backup-d-essai',
};

/** Les clés du réglage `settings` (table `meta`, bloc JSON). */
export const ANCIENS_REGLAGES: Readonly<Record<string, string>> = {
  snapshotDossier: 'backupDossier',
  snapshotHeure: 'backupHeure',
  snapshotAuto: 'backupAuto',
};

/** La catégorie d'export d'hier. */
const ANCIENNE_CATEGORIE = 'snapshots';

/** Le dossier de repli d'hier, posé à côté des données quand rien n'était réglé. */
export const ANCIEN_DOSSIER_PAR_DEFAUT = 'Snapshots';

function existe(database: Database.Database, type: 'table' | 'index', nom: string): boolean {
  return !!database.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(type, nom);
}

/**
 * LA BASE PASSE AUX NOUVEAUX NOMS, EN UNE SEULE TRANSACTION. Appelé par
 * `openDb` AVANT les migrations : une base d'hier y arrive donc avec des tables
 * déjà renommées et un registre qui connaît déjà « backups-des-sites » — la
 * migration 39, réécrite pour une base neuve, ne se rejoue pas sur elle.
 * Rend la liste de ce qui a été fait (vide à la seconde exécution).
 */
export function passerLaBaseAuxBackups(database: Database.Database): string[] {
  const faits: string[] = [];
  const passer = database.transaction(() => {
    for (const [ancienne, neuve] of Object.entries(ANCIENNES_TABLES)) {
      if (existe(database, 'table', ancienne) && !existe(database, 'table', neuve)) {
        // SQLite réécrit aussi la clé étrangère des points qui visait l'ancienne table.
        database.exec(`ALTER TABLE ${ancienne} RENAME TO ${neuve}`);
        faits.push(`table ${ancienne} → ${neuve}`);
      }
    }

    // Un index ne se renomme pas : on le retire et on le repose sous son nom.
    if (existe(database, 'index', ANCIEN_INDEX)) {
      database.exec(`DROP INDEX ${ANCIEN_INDEX}`);
      faits.push(`index ${ANCIEN_INDEX} retiré`);
    }
    if (existe(database, 'table', 'backup_points') && faits.length) {
      database.exec('CREATE INDEX IF NOT EXISTS idx_backup_points_site ON backup_points(site_id, debut DESC)');
    }

    if (existe(database, 'table', 'migrations')) {
      for (const [ancien, neuf] of Object.entries(ANCIENNES_MIGRATIONS)) {
        const deja = database.prepare('SELECT 1 FROM migrations WHERE name = ?').get(neuf);
        const change = deja
          ? database.prepare('DELETE FROM migrations WHERE name = ?').run(ancien)
          : database.prepare('UPDATE migrations SET name = ? WHERE name = ?').run(neuf, ancien);
        if (change.changes) faits.push(`migration « ${ancien} » → « ${neuf} »`);
      }
    }

    if (existe(database, 'table', 'meta')) {
      const ligne = database.prepare("SELECT value FROM meta WHERE key = 'settings'").get() as
        | { value: string }
        | undefined;
      if (ligne) {
        let reglages: Record<string, unknown> | null = null;
        try {
          const lu = JSON.parse(ligne.value);
          if (lu && typeof lu === 'object') reglages = lu as Record<string, unknown>;
        } catch {
          /* réglage illisible : le démon repartira de ses défauts, rien à porter */
        }
        if (reglages) {
          let bouge = false;
          for (const [ancienne, neuve] of Object.entries(ANCIENS_REGLAGES)) {
            if (!(ancienne in reglages)) continue;
            if (!(neuve in reglages)) reglages[neuve] = reglages[ancienne];
            delete reglages[ancienne];
            bouge = true;
            faits.push(`réglage ${ancienne} → ${neuve}`);
          }
          if (bouge) {
            database.prepare("UPDATE meta SET value = ? WHERE key = 'settings'").run(JSON.stringify(reglages));
          }
        }
      }
    }
  });
  passer();
  return faits;
}

/** Le nom d'aujourd'hui d'un dossier nommé hier (casse gardée). */
export function nomDeDossierActuel(nom: string): string {
  return nom
    .replace(/SNAPSHOT/g, 'BACKUP')
    .replace(/Snapshot/g, 'Backup')
    .replace(/snapshot/g, 'backup');
}

/**
 * LE DOSSIER DE STOCKAGE PASSE AU NOUVEAU NOM. Un simple renommage sur le même
 * disque : instantané, même pour des dizaines de gigaoctets, là où une copie
 * prendrait des heures. Les points déjà pris gardent leur chemin JUSTE : il est
 * réécrit dans la base au même moment. Rien n'est tenté quand le nouveau nom
 * est déjà pris (on ne mélange jamais deux dossiers), et un disque qui refuse
 * le renommage laisse tout en place — un réglage qui pointe l'ancien dossier
 * vaut mieux que des sauvegardes orphelines.
 *
 * Rend le nouveau chemin quand le réglage doit changer, `null` sinon.
 */
export function passerLeDossierAuxBackups(
  dossier: string,
  database: Database.Database,
  journal: (texte: string) => void = () => undefined,
): string | null {
  const propre = (dossier ?? '').trim().replace(/\/+$/, '');
  if (!propre) return null;
  const base = path.basename(propre);
  const neufNom = nomDeDossierActuel(base);
  if (neufNom === base) return null;
  const neuf = path.join(path.dirname(propre), neufNom);

  const ancienLa = fs.existsSync(propre);
  const neufLa = fs.existsSync(neuf);
  if (ancienLa && neufLa) {
    journal(`dossier des backups : « ${neuf} » existe déjà à côté de « ${propre} » — rien n'est déplacé`);
    return null;
  }
  if (ancienLa) {
    try {
      fs.renameSync(propre, neuf);
    } catch (err: any) {
      journal(`dossier des backups : renommage de « ${propre} » refusé (${err?.message ?? err}) — réglage gardé`);
      return null;
    }
    journal(`dossier des backups : « ${propre} » → « ${neuf} »`);
  }

  if (existe(database, 'table', 'backup_points')) {
    const reecrits = database
      .prepare('UPDATE backup_points SET data = replace(data, ?, ?) WHERE instr(data, ?) > 0')
      .run(`"${propre}/`, `"${neuf}/`, `"${propre}/`);
    if (reecrits.changes) journal(`dossier des backups : ${reecrits.changes} point(s) relus sous le nouveau chemin`);
  }
  return neuf;
}

/**
 * LES ARCHIVES D'EXPORT FAITES AVANT portent l'ancienne catégorie et les
 * anciens noms de tables. Leur manifeste est relu sous les noms d'aujourd'hui
 * AVANT d'être jugé : sans cela, l'import les écarterait comme une catégorie
 * inconnue. Le chemin des fichiers dans l'archive, lui, ne change pas.
 */
export function manifesteAuxNomsActuels<T>(brut: T): T {
  if (!brut || typeof brut !== 'object') return brut;
  const manifeste = brut as Record<string, any>;
  const categorie = (cle: unknown) => (cle === ANCIENNE_CATEGORIE ? 'backups' : cle);
  return {
    ...manifeste,
    categories: Array.isArray(manifeste.categories) ? manifeste.categories.map(categorie) : manifeste.categories,
    tables: Array.isArray(manifeste.tables)
      ? manifeste.tables.map((entree: any) =>
          entree && typeof entree === 'object'
            ? { ...entree, table: ANCIENNES_TABLES[entree.table] ?? entree.table, categorie: categorie(entree.categorie) }
            : entree,
        )
      : manifeste.tables,
  } as T;
}
