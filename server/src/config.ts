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

const dataDir = env('HAIKODEV_DATA', path.join(ROOT, 'data'));
/**
 * L'application EN LIGNE vit dans son propre dossier, écrit uniquement par la
 * publication. Le dossier de travail, lui, change de branche au gré des cartes :
 * s'il servait l'application, la dernière construction d'un agent déciderait de
 * ce que voit l'utilisateur (rencontré le 02/08/2026, une demi-journée de
 * travail rendue invisible). Tant qu'une branche n'est pas envoyée, elle ne
 * change rien à ce qui est servi.
 */
const liveDir = path.join(dataDir, 'live');
const buildDir = path.join(ROOT, 'web', 'dist');

export const CONFIG = {
  port: Number(env('HAIKODEV_PORT', '7070')),
  host: env('HAIKODEV_HOST', '127.0.0.1'),
  dataDir,
  /** Réglage forcé à la main ; sinon la décision est prise à CHAQUE requête. */
  webDirForce: process.env.HAIKODEV_WEB?.trim() || '',
  /** Là où la publication installe l'application, et d'où elle est servie. */
  liveDir,
  /** Là où `npm run build` écrit, dans le dossier de travail. */
  buildDir,
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

/**
 * Le dossier réellement servi, décidé à chaque requête : l'application publiée
 * si elle existe, sinon la construction du dossier de travail. Le décider une
 * fois pour toutes au démarrage obligeait à redémarrer le démon après la
 * première publication pour la voir.
 */
export function webRoot(): string {
  if (CONFIG.webDirForce) return CONFIG.webDirForce;
  return fs.existsSync(path.join(CONFIG.liveDir, 'index.html')) ? CONFIG.liveDir : CONFIG.buildDir;
}

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
  /**
   * Les compétences partagées : un dossier par compétence, chacun portant son
   * `SKILL.md`. Un seul endroit fait foi pour tous les projets et tous les
   * comptes — voir `server/src/competences.ts`.
   */
  competences: env('HAIKODEV_COMPETENCES', path.join(CONFIG.dataDir, 'competences')),
  /**
   * Les icônes de site des projets, récupérées côté serveur sur leur adresse
   * de dev (`server/src/favicon.ts`) : un fichier par projet, servi ensuite
   * par `/api/favicon`.
   */
  favicons: path.join(CONFIG.dataDir, 'favicons'),
  /**
   * Les personnages de colonne REMPLACÉS à la main depuis les réglages : deux
   * fichiers par colonne remplacée (la silhouette et le portrait rond), aux
   * mêmes noms que ceux d'origine. Ils vivent dans les DONNÉES, jamais dans le
   * dépôt : une image déposée par l'utilisateur n'est pas du code, et elle doit
   * survivre à une publication comme à un changement de branche. Le dossier
   * vide vaut « les sept personnages d'origine ». Voir `server/src/personnages.ts`.
   */
  personnages: path.join(CONFIG.dataDir, 'personnages'),
  /**
   * Le DOSSIER DE TRAVAIL du chef d'orchestre bridé : un sous-dossier par projet,
   * le seul endroit où il a le droit d'écrire (brouillons, sorties d'analyse). Il
   * vit hors des dépôts des projets — le projet, lui, reste monté en lecture
   * seule. Voir `shared/src/bridage-chef.ts`.
   */
  chefScratch: path.join(CONFIG.dataDir, 'chef-scratch'),
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
    PATHS.competences,
    PATHS.chefScratch,
    PATHS.favicons,
    PATHS.personnages,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
