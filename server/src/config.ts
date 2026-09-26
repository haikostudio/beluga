import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { depotsQuUnDemonNeRangePas } from '@beluga/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
/** dist/ → server/ → racine du dépôt */
export const ROOT = path.resolve(here, '..', '..');

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

/**
 * LE DÉPÔT PRINCIPAL, MÊME QUAND LE CODE TOURNE DANS UNE COPIE DE CARTE.
 *
 * `ROOT` est déduit de l'endroit d'où le code a été chargé. Depuis une COPIE DE
 * TRAVAIL de carte (`.worktrees/<carte>`), il désigne donc la copie, pas le
 * dépôt où vivent les données réelles. Le dépôt principal se lit dans le
 * marqueur `.git` de la copie (`depotsQuUnDemonNeRangePas`,
 * `shared/src/depots-du-demon.ts`), sans lancer git. Au moindre doute —
 * marqueur illisible, dépôt annoncé absent — on garde `ROOT` : mieux vaut le
 * dossier d'à côté qu'un chemin inventé.
 */
function depotPrincipal(): string {
  const marqueur = path.join(ROOT, '.git');
  let contenu: string | null = null;
  try {
    if (fs.statSync(marqueur).isFile()) contenu = fs.readFileSync(marqueur, 'utf8');
  } catch {
    contenu = null;
  }
  const [, principal] = depotsQuUnDemonNeRangePas(ROOT, contenu);
  if (!principal) return ROOT;
  return fs.existsSync(path.join(principal, '.git')) ? principal : ROOT;
}

const dataDir = env('BELUGA_DATA', path.join(ROOT, 'data'));

/**
 * LE STOCKAGE DES PIÈCES JOINTES EST CENTRAL, ET IL NE SUIT PAS LA COPIE DE CARTE.
 *
 * Une image déposée est écrite UNE FOIS, dans `<dépôt principal>/data/attachments`,
 * et elle doit s'y relire depuis n'importe où : le démon, un script de contrôle,
 * un outil appelé par un agent. Or ces deux derniers tournent dans la copie de
 * travail de leur carte, où `<copie>/data/attachments` est un dossier VIDE que
 * `ensureDirs` créait au passage — l'image était donc « introuvable » alors que
 * le fichier était bien posé sur le serveur.
 *
 * Le dossier des pièces jointes est donc le SEUL du lot à être ramené sur le
 * dépôt principal. Le reste des données — à commencer par la BASE — garde le
 * dossier de l'endroit d'où l'on tourne : ramener la base aussi ferait ouvrir la
 * base de PRODUCTION aux tests lancés depuis une copie de carte.
 *
 * `BELUGA_DATA` posé à la main (les bacs à sable des tests) garde le dernier
 * mot : le bac à sable reste entier, pièces jointes comprises.
 */
function dossierDesPiecesJointes(): string {
  const bacASable = process.env.BELUGA_DATA?.trim();
  if (bacASable) return path.join(bacASable, 'attachments');
  return path.join(depotPrincipal(), 'data', 'attachments');
}

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
  port: Number(env('BELUGA_PORT', '7070')),
  host: env('BELUGA_HOST', '127.0.0.1'),
  dataDir,
  /** Réglage forcé à la main ; sinon la décision est prise à CHAQUE requête. */
  webDirForce: process.env.BELUGA_WEB?.trim() || '',
  /** Là où la publication installe l'application, et d'où elle est servie. */
  liveDir,
  /** Là où `npm run build` écrit, dans le dossier de travail. */
  buildDir,
  /** Dossier où sont clonés les projets pilotables. */
  projectsRoot: env('BELUGA_PROJECTS_ROOT', '/root'),
  selfPath: ROOT,
  /**
   * LE DÉPÔT DONT CE DÉMON DÉPEND — le principal, même quand le code tourne
   * depuis une copie de carte. Vaut `selfPath` dans le cas normal.
   *
   * Un démon d'essai levé depuis `<copie>/server/dist/main.js` (les contrôles
   * en montent) adopte d'office tous les projets de `/root`, donc le dépôt
   * PRINCIPAL : son ménage refermait alors les copies de TOUTES les cartes en
   * cours, celle de l'agent qui l'avait lancé comprise. La garde a besoin de ce
   * chemin-ci, pas seulement de `selfPath`.
   */
  depotDuDemon: depotPrincipal(),
  homeDir: env('HOME', os.homedir()),
  version: '1.0.0',
  /** Plafond d'agents simultanés — réglage, pas constante enfouie (PLAN §12). */
  defaultMaxAgents: 15,
  sessionDays: 30,
  compta: {
    baseUrl: env('BELUGA_COMPTA_URL', 'http://127.0.0.1:15010'),
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

/**
 * LE FICHIER DE BASE S'APPELLE `beluga.db`, ET UN FICHIER VIDE N'EST PAS UNE BASE.
 *
 * Il ne vit pas dans le dépôt : c'est une donnée réelle, posée sur le serveur à
 * côté des pièces jointes et des journaux. SQLite ouvre volontiers un fichier
 * absent ou de ZÉRO OCTET, et le tableau s'afficherait alors vierge, sans la
 * moindre erreur. Si `beluga.db` n'a aucun contenu alors qu'une AUTRE base
 * pleine dort dans le même dossier, le démon refuse donc de démarrer et nomme
 * les deux fichiers : c'est une base déplacée ou mal nommée, jamais une
 * installation neuve.
 */
export function cheminDeLaBase(dossierDonnees: string): string {
  const base = path.join(dossierDonnees, 'beluga.db');
  if (pleine(base)) return base;
  const voisines = basesPleinesVoisines(dossierDonnees);
  if (voisines.length) {
    throw new Error(
      `${base} est absente ou vide alors que ${voisines.join(', ')} contient des données : ` +
        'refus de démarrer sur une base vierge. Renommer la bonne base en beluga.db, démon arrêté.',
    );
  }
  return base;
}

/** Les autres fichiers `*.db` pleins du dossier de données. */
export function basesPleinesVoisines(dossierDonnees: string): string[] {
  let noms: string[];
  try {
    noms = fs.readdirSync(dossierDonnees);
  } catch {
    return [];
  }
  return noms
    .filter((nom) => nom.endsWith('.db') && nom !== 'beluga.db')
    .map((nom) => path.join(dossierDonnees, nom))
    .filter(pleine);
}

function pleine(fichier: string): boolean {
  try {
    return fs.statSync(fichier).size > 0;
  } catch {
    return false;
  }
}

export const PATHS = {
  db: cheminDeLaBase(CONFIG.dataDir),
  /** CENTRAL, et jamais celui de la copie de carte — voir `dossierDesPiecesJointes`. */
  attachments: dossierDesPiecesJointes(),
  /**
   * LE DISQUE DE STOCKAGE des pièces jointes (`BELUGA_PIECES_JOINTES`, le disque
   * de 1 To sur le serveur de Haiko). Vide = pas de disque dédié : tout reste
   * dans `attachments`. Ignoré dans un bac à sable (`BELUGA_DATA` posé à la
   * main) : un test n'écrit jamais sur le vrai disque — sauf l'essai du choix
   * lui-même, qui pose `BELUGA_PIECES_JOINTES_EN_ESSAI=1` avec un disque factice.
   * Le choix du dossier réellement utilisé vit dans `server/src/pieces-jointes.ts`.
   */
  attachmentsStockage:
    process.env.BELUGA_DATA?.trim() && process.env.BELUGA_PIECES_JOINTES_EN_ESSAI !== '1'
      ? ''
      : (process.env.BELUGA_PIECES_JOINTES?.trim() ?? ''),
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
  competences: env('BELUGA_COMPETENCES', path.join(CONFIG.dataDir, 'competences')),
  /**
   * Les icônes de site des projets, récupérées côté serveur sur leur adresse
   * de dev (`server/src/favicon.ts`) : un fichier par projet, servi ensuite
   * par `/api/favicon`.
   */
  favicons: path.join(CONFIG.dataDir, 'favicons'),
  /**
   * Le DOSSIER DE TRAVAIL du chef d'orchestre bridé : un sous-dossier par projet,
   * le seul endroit où il a le droit d'écrire (brouillons, sorties d'analyse). Il
   * vit hors des dépôts des projets — le projet, lui, reste monté en lecture
   * seule. Voir `shared/src/bridage-cadrage.ts`.
   */
  cadrageScratch: path.join(CONFIG.dataDir, 'cadrage-scratch'),
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
    PATHS.cadrageScratch,
    PATHS.favicons,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
