import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb } from './db.js';
import { PATHS, CONFIG } from './config.js';
import { bus } from './bus.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * Sauvegarde et restauration (PLAN §23). La base est copiée À CHAUD, sans
 * arrêter le service. Les secrets restent dehors : ils se recréent.
 */

export interface BackupEntry {
  name: string;
  size: number;
  at: number;
}

export async function runBackup(reason = 'automatique'): Promise<{ ok: boolean; file?: string; error?: string }> {
  try {
    fs.mkdirSync(PATHS.backups, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = path.join(PATHS.backups, `haikodev-${stamp}`);
    fs.mkdirSync(dir, { recursive: true });

    // Copie à chaud de la base, cohérente même pendant les écritures.
    getDb().exec(`VACUUM INTO '${path.join(dir, 'haikodev.db').replace(/'/g, "''")}'`);

    // Les données volumineuses suivent (pièces jointes, documents de clôture).
    for (const folder of ['attachments', 'documents']) {
      const source = path.join(CONFIG.dataDir, folder);
      if (fs.existsSync(source)) {
        fs.cpSync(source, path.join(dir, folder), { recursive: true });
      }
    }

    // Archive compressée, puis on retire le dossier de travail.
    const archive = `${dir}.tar.gz`;
    await execFileAsync('tar', ['czf', archive, '-C', PATHS.backups, path.basename(dir)], { timeout: 300000 });
    fs.rmSync(dir, { recursive: true, force: true });

    prune();
    log.info(`sauvegarde ${reason} : ${path.basename(archive)}`);
    bus.toast('success', 'Sauvegarde effectuée');
    return { ok: true, file: archive };
  } catch (err: any) {
    log.error('sauvegarde impossible', err);
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/** Conservation dégressive : chaque jour de la semaine, chaque semaine du mois, chaque mois de l'année. */
function prune(): void {
  const files = listBackups();
  const keep = new Set<string>();
  const byDay = new Map<string, BackupEntry>();
  const byWeek = new Map<string, BackupEntry>();
  const byMonth = new Map<string, BackupEntry>();

  for (const file of files) {
    const date = new Date(file.at);
    const day = date.toISOString().slice(0, 10);
    const week = `${date.getUTCFullYear()}-S${Math.floor(date.getUTCDate() / 7)}-${date.getUTCMonth()}`;
    const month = date.toISOString().slice(0, 7);
    if (!byDay.has(day)) byDay.set(day, file);
    if (!byWeek.has(week)) byWeek.set(week, file);
    if (!byMonth.has(month)) byMonth.set(month, file);
  }

  const now = Date.now();
  for (const [day, file] of byDay) if (now - new Date(day).getTime() < 8 * 24 * 3600 * 1000) keep.add(file.name);
  for (const file of byWeek.values()) if (now - file.at < 35 * 24 * 3600 * 1000) keep.add(file.name);
  for (const file of byMonth.values()) if (now - file.at < 400 * 24 * 3600 * 1000) keep.add(file.name);

  for (const file of files) {
    if (!keep.has(file.name)) {
      try {
        fs.unlinkSync(path.join(PATHS.backups, file.name));
      } catch {
        /* déjà parti */
      }
    }
  }
}

export function listBackups(): BackupEntry[] {
  try {
    return fs
      .readdirSync(PATHS.backups)
      .filter((name) => name.endsWith('.tar.gz'))
      .map((name) => {
        const stat = fs.statSync(path.join(PATHS.backups, name));
        return { name, size: stat.size, at: stat.mtimeMs };
      })
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

/** Restauration testée pour de vrai : une sauvegarde jamais remontée n'existe pas. */
export async function verifyBackup(file: string): Promise<{ ok: boolean; detail: string }> {
  const archive = path.join(PATHS.backups, path.basename(file));
  if (!fs.existsSync(archive)) return { ok: false, detail: 'archive introuvable' };
  const temp = fs.mkdtempSync(path.join(PATHS.backups, 'verif-'));
  try {
    await execFileAsync('tar', ['xzf', archive, '-C', temp], { timeout: 300000 });
    const inner = fs.readdirSync(temp)[0];
    const dbFile = path.join(temp, inner, 'haikodev.db');
    if (!fs.existsSync(dbFile)) return { ok: false, detail: 'base absente de la sauvegarde' };

    const Database = (await import('better-sqlite3')).default;
    const restored = new Database(dbFile, { readonly: true });
    const projects = restored.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number };
    const cards = restored.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number };
    const integrity = restored.pragma('integrity_check', { simple: true });
    restored.close();

    const ok = integrity === 'ok';
    return {
      ok,
      detail: ok
        ? `Restauration vérifiée : ${projects.n} projet(s), ${cards.n} carte(s) relus depuis la sauvegarde.`
        : `Base corrompue : ${integrity}`,
    };
  } catch (err: any) {
    return { ok: false, detail: err?.message ?? String(err) };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

export function scheduleNightlyBackup(hourGetter: () => number): NodeJS.Timeout {
  let lastDay = -1;
  return setInterval(
    () => {
      const now = new Date();
      if (now.getHours() === hourGetter() && now.getDate() !== lastDay) {
        lastDay = now.getDate();
        void runBackup('nocturne');
      }
    },
    5 * 60 * 1000,
  );
}
