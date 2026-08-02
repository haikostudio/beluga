import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EngineId, Project } from '@haikodev/shared';
import * as store from './store.js';
import { CONFIG } from './config.js';
import { log } from './logger.js';

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
}): Project {
  const resolved = path.resolve(input.path);
  if (!fs.existsSync(resolved)) throw new Error(`le dossier ${resolved} n'existe pas`);

  const existing = store.getProjectByPath(resolved);
  const project = Project.parse({
    id: existing?.id ?? store.newId(),
    name: input.name,
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
    archived: false,
    createdAt: existing?.createdAt ?? store.now(),
    updatedAt: store.now(),
  });
  return store.saveProject(project);
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
