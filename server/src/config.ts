import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** dist/ → server/ → racine du dépôt */
export const ROOT = path.resolve(here, '..', '..');

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

export const CONFIG = {
  port: Number(env('HAIKODEV_PORT', '7070')),
  host: env('HAIKODEV_HOST', '127.0.0.1'),
  dataDir: env('HAIKODEV_DATA', path.join(ROOT, 'data')),
  webDir: env('HAIKODEV_WEB', path.join(ROOT, 'web', 'dist')),
  /** Dossier où sont clonés les projets pilotables. */
  projectsRoot: env('HAIKODEV_PROJECTS_ROOT', '/root'),
  selfPath: ROOT,
  homeDir: env('HOME', os.homedir()),
  version: '1.0.0',
  /** Plafond d'agents simultanés — réglage, pas constante enfouie (PLAN §12). */
  defaultMaxAgents: 15,
  sessionDays: 30,
  compta: {
    baseUrl: env('HAIKODEV_COMPTA_URL', 'http://127.0.0.1:15010'),
  },
};

export const PATHS = {
  db: path.join(CONFIG.dataDir, 'haikodev.db'),
  attachments: path.join(CONFIG.dataDir, 'attachments'),
  archives: path.join(CONFIG.dataDir, 'archives'),
  logs: path.join(CONFIG.dataDir, 'logs'),
  audio: path.join(CONFIG.dataDir, 'audio'),
  docs: path.join(CONFIG.dataDir, 'documents'),
  backups: path.join(CONFIG.dataDir, 'backups'),
  secret: path.join(CONFIG.dataDir, 'secret.key'),
  accounts: path.join(CONFIG.dataDir, 'accounts'),
};

export function ensureDirs(): void {
  for (const dir of [
    CONFIG.dataDir,
    PATHS.attachments,
    PATHS.archives,
    PATHS.logs,
    PATHS.audio,
    PATHS.docs,
    PATHS.backups,
    PATHS.accounts,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
