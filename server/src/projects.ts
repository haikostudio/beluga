import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EngineId, Project } from '@haikodev/shared';
import * as store from './store.js';
import { CONFIG } from './config.js';
import { log } from './logger.js';
import { creerFichierInstructions } from './memory.js';

const execFileAsync = promisify(execFile);

/** Registre de projets : les dossiers du VPS et leurs métadonnées git. */

async function gitInfo(dir: string): Promise<{ remote?: string; branch?: string } | null> {
  try {
    const { stdout: branch } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: dir,
      timeout: 8000,
    });
    let remote: string | undefined;
    try {
      const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: dir, timeout: 8000 });
      remote = stdout.trim();
    } catch {
      /* dépôt local sans distant */
    }
    return { branch: branch.trim(), remote };
  } catch {
    return null;
  }
}

export function registerProject(input: {
  name: string;
  path: string;
  gitRemote?: string;
  defaultEngine?: EngineId;
  deployCommand?: string;
  deployUrl?: string;
  rank?: number;
}): Project {
  const resolved = path.resolve(input.path);
  if (!fs.existsSync(resolved)) throw new Error(`le dossier ${resolved} n'existe pas`);

  const existing = store.getProjectByPath(resolved);
  const project = Project.parse({
    id: existing?.id ?? store.newId(),
    // Un projet déjà inscrit garde le nom que vous lui avez donné : une
    // nouvelle exploration du serveur ne doit jamais l'écraser.
    name: existing?.name ?? input.name,
    path: resolved,
    gitRemote: input.gitRemote ?? existing?.gitRemote,
    gitBranch: existing?.gitBranch,
    defaultEngine: input.defaultEngine ?? existing?.defaultEngine ?? 'claude',
    defaultModel: existing?.defaultModel,
    // Le basculement « agent complet » se décide sur le CHEMIN, jamais sur une
    // adresse distante (PLAN §5).
    isSelf: resolved === path.resolve(CONFIG.selfPath),
    deployCommand: input.deployCommand ?? existing?.deployCommand,
    deployUrl: input.deployUrl ?? existing?.deployUrl,
    billing: existing?.billing,
    rank: input.rank ?? existing?.rank ?? nextRank(),
    archived: false,
    createdAt: existing?.createdAt ?? store.now(),
    updatedAt: store.now(),
  });

  // Un projet qui arrive sans fichier d'instructions en reçoit un, vide mais
  // cadré : les agents savent alors où écrire les règles durables du projet.
  if (!existing) {
    try {
      if (creerFichierInstructions(resolved, project.name)) {
        log.info(`fichier d'instructions du moteur créé pour ${project.name}`);
      }
    } catch (err) {
      log.warn("fichier d'instructions non créé", err);
    }
  }

  return store.saveProject(project);
}

function nextRank(): number {
  const ranks = store.listProjects(true).map((p) => p.rank ?? 1000);
  return ranks.length ? Math.max(...ranks) + 10 : 10;
}

/** Range les projets dans l'ordre voulu : le premier de la liste passe en haut. */
export function reorderProjects(ids: string[]): Project[] {
  ids.forEach((id, index) => {
    const project = store.getProject(id);
    if (project) store.saveProject({ ...project, rank: (index + 1) * 10 });
  });
  return store.listProjects();
}

/**
 * Crée un dossier NEUF sur le serveur puis l'inscrit : un nouveau projet
 * existe pour de vrai, il n'est pas seulement une ligne dans une liste.
 */
export async function createProjectFolder(input: {
  name: string;
  folder?: string;
  git?: boolean;
  gitRemote?: string;
}): Promise<Project> {
  const slug =
    (input.folder?.trim() || input.name)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'projet';

  const target = path.resolve(CONFIG.projectsRoot, slug);
  if (!target.startsWith(path.resolve(CONFIG.projectsRoot) + path.sep)) {
    throw new Error('emplacement refusé');
  }
  if (fs.existsSync(target)) throw new Error(`le dossier ${slug} existe déjà`);

  // Le dossier des projets appartient à l'administrateur du serveur : si le
  // démon ne peut pas y écrire directement, il crée avec élévation puis se
  // donne le dossier — c'est la convention en place sur cette machine.
  try {
    fs.mkdirSync(target, { recursive: true });
  } catch (err: any) {
    if (err?.code !== 'EACCES' && err?.code !== 'EPERM') throw err;
    const user = process.env.USER || 'paseo';
    await execFileAsync('sudo', ['-n', 'mkdir', '-p', target], { timeout: 20000 });
    await execFileAsync('sudo', ['-n', 'chown', '-R', `${user}:${user}`, target], { timeout: 20000 });
  }

  fs.writeFileSync(
    path.join(target, 'README.md'),
    `# ${input.name}\n\nProjet créé depuis HaikoDev le ${new Date().toLocaleDateString('fr-CH')}.\n`,
    'utf8',
  );

  if (input.git !== false) {
    try {
      await execFileAsync('git', ['init', '-q'], { cwd: target, timeout: 20000 });
      await execFileAsync('git', ['add', '-A'], { cwd: target, timeout: 20000 });
      await execFileAsync(
        'git',
        ['-c', 'user.email=haikodev@local', '-c', 'user.name=HaikoDev', 'commit', '-qm', 'Départ du projet'],
        { cwd: target, timeout: 20000 },
      );
      if (input.gitRemote?.trim()) {
        await execFileAsync('git', ['remote', 'add', 'origin', input.gitRemote.trim()], { cwd: target, timeout: 20000 });
      }
    } catch (err) {
      log.warn('dépôt git non initialisé', err);
    }
  }

  log.info(`nouveau projet créé sur le serveur : ${target}`);
  return registerProject({ name: input.name, path: target, gitRemote: input.gitRemote, rank: 5 });
}

/** Parcourt le dossier des projets et propose ceux qui ne sont pas encore inscrits. */
export async function scanProjects(): Promise<{ name: string; path: string; git: boolean }[]> {
  const root = CONFIG.projectsRoot;
  const known = new Set(store.listProjects(true).map((p) => p.path));
  const found: { name: string; path: string; git: boolean }[] = [];

  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const full = path.join(root, entry.name);
      if (known.has(full)) continue;
      const hasGit = fs.existsSync(path.join(full, '.git'));
      const hasPackage = fs.existsSync(path.join(full, 'package.json'));
      if (!hasGit && !hasPackage) continue;
      found.push({ name: entry.name, path: full, git: hasGit });
    }
  } catch (err) {
    log.warn('exploration des projets impossible', err);
  }
  return found;
}

/**
 * Tous les projets présents sur le serveur sont inscrits d'office : on doit
 * les VOIR dans la colonne de gauche, comme avant. Ceux qui ne servent plus se
 * mettent de côté par archivage, ils ne disparaissent pas d'eux-mêmes.
 */
export async function adoptServerProjects(): Promise<number> {
  if (store.getMetaValue('projects.adopted') === '1') return 0;
  const found = await scanProjects();
  let count = 0;
  for (const entry of found) {
    try {
      registerProject({ name: entry.name, path: entry.path });
      count += 1;
    } catch (err) {
      log.warn(`projet ${entry.name} non inscrit`, err);
    }
  }
  store.setMetaValue('projects.adopted', '1');
  if (count) log.info(`${count} projet(s) du serveur inscrits automatiquement`);
  return count;
}

/** Le projet HaikoDev lui-même, inscrit au premier démarrage. */
export async function ensureSelfProject(): Promise<Project> {
  const selfPath = path.resolve(CONFIG.selfPath);
  const existing = store.getProjectByPath(selfPath);
  if (existing) {
    if (!existing.isSelf) return store.saveProject({ ...existing, isSelf: true });
    return existing;
  }
  const info = await gitInfo(selfPath);
  return registerProject({
    name: 'HaikoDev',
    path: selfPath,
    gitRemote: info?.remote,
    defaultEngine: 'claude',
  });
}

/** Rafraîchit la branche courante de chaque projet. */
export async function refreshGitInfo(): Promise<void> {
  for (const project of store.listProjects()) {
    const info = await gitInfo(project.path);
    if (info && info.branch !== project.gitBranch) {
      store.saveProject({ ...project, gitBranch: info.branch, gitRemote: info.remote ?? project.gitRemote });
    }
  }
}
