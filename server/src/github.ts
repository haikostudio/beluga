import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GithubTracking, variablesGithub } from '@haikodev/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * Suivi GitHub (PLAN §8). La lecture passe par l'outil GitHub en ligne de
 * commande DÉJÀ authentifié sur le serveur : aucun jeton à saisir dans
 * l'interface. La couche est isolée pour accepter demain GitLab ou Gitea.
 */

async function gh(args: string[], cwd: string): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout } = await execFileAsync('gh', args, { cwd, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, out: stdout };
  } catch (err: any) {
    return { ok: false, out: (err?.stderr ?? err?.message ?? '').toString() };
  }
}

/*
 * LE JETON GITHUB DE L'ENVIRONNEMENT DES AGENTS.
 *
 * L'outil `gh` est identifié sur le serveur : son jeton dort dans le dossier
 * personnel du compte qui porte le démon. Un agent, lui, travaille dans une copie
 * de travail ou dans un bac à sable, où ce dossier n'est pas forcément lisible :
 * on lui passe donc le jeton par l'ENVIRONNEMENT (`variablesGithub`), ce qui rend
 * `gh` utilisable partout sans rien lire sur le disque.
 *
 * Le jeton est demandé À `gh` lui-même (`gh auth token`) : aucune clé à saisir
 * dans l'interface, aucun chemin en dur, et un changement d'identification est
 * repris tout seul. La réponse est gardée une heure — le relever à chaque tour
 * ajouterait un lancement de processus pour une valeur qui ne bouge pas.
 */
const DUREE_CACHE_JETON_MS = 60 * 60 * 1000;
let jetonEnCache: { valeur?: string; at: number } | undefined;

/** Le jeton GitHub du serveur, ou rien si l'outil n'est pas identifié. */
export async function jetonGithub(): Promise<string | undefined> {
  const depuisEnv = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  if (depuisEnv) return depuisEnv;
  if (jetonEnCache && Date.now() - jetonEnCache.at < DUREE_CACHE_JETON_MS) return jetonEnCache.valeur;
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 10000 });
    const valeur = stdout.trim() || undefined;
    jetonEnCache = { valeur, at: Date.now() };
    if (!valeur) log.warn("gh est présent mais ne rend aucun jeton : les agents n'auront pas GitHub");
    return valeur;
  } catch (err: any) {
    jetonEnCache = { valeur: undefined, at: Date.now() };
    log.warn(`jeton GitHub indisponible pour les agents : ${(err?.stderr ?? err?.message ?? '').toString().trim()}`);
    return undefined;
  }
}

/**
 * Les variables GitHub à poser dans l'environnement d'un agent. Vide quand le
 * serveur n'est pas identifié : on ne pose jamais de variable creuse.
 */
export async function envGithub(): Promise<Record<string, string>> {
  return variablesGithub(await jetonGithub());
}

async function git(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } catch {
    return '';
  }
}

export async function refreshCard(cardId: string): Promise<GithubTracking | null> {
  const card = store.getCard(cardId);
  if (!card) return null;
  const project = store.getProject(card.projectId);
  if (!project) return null;

  const branch = card.github?.branch;
  const tracking: GithubTracking = GithubTracking.parse({
    ...(card.github ?? {}),
    checks: [],
    commits: [],
    activity: [],
    fetchedAt: Date.now(),
  });

  if (branch) {
    // Date complète (heure comprise) : « le 2 à 09:14 » est plus utile que « le 2 ».
    const logOut = await git(['log', '-n', '10', '--format=%H|%s|%aI', branch], project.path);
    tracking.commits = logOut
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, message, date] = line.split('|');
        return { sha: sha ?? '', message: message ?? '', date };
      });

    const prJson = await gh(
      ['pr', 'view', branch, '--json', 'number,title,state,url,mergeable,reviewDecision,statusCheckRollup,comments,reviews'],
      project.path,
    );
    if (prJson.ok) {
      try {
        const data = JSON.parse(prJson.out);
        tracking.prNumber = data.number;
        tracking.prTitle = data.title;
        tracking.prState = data.state === 'MERGED' ? 'merged' : data.state === 'CLOSED' ? 'closed' : 'open';
        tracking.prUrl = data.url;
        tracking.mergeable = data.mergeable;
        tracking.reviewDecision = data.reviewDecision ?? undefined;
        tracking.checks = (data.statusCheckRollup ?? []).map((check: any) => ({
          name: check.name ?? check.context ?? 'test',
          status: check.status ?? check.state ?? 'UNKNOWN',
          conclusion: check.conclusion ?? undefined,
        }));
        tracking.activity = [
          ...(data.comments ?? []).map((c: any) => ({
            kind: 'commentaire',
            author: c.author?.login ?? '—',
            body: (c.body ?? '').slice(0, 400),
            date: c.createdAt ?? '',
          })),
          ...(data.reviews ?? []).map((r: any) => ({
            kind: `revue (${r.state ?? ''})`,
            author: r.author?.login ?? '—',
            body: (r.body ?? '').slice(0, 400),
            date: r.submittedAt ?? '',
          })),
        ].sort((a, b) => (a.date < b.date ? 1 : -1));
      } catch (err) {
        log.warn('lecture de la demande de fusion impossible', err);
      }
    }
  }

  const updated = store.saveCard({ ...card, github: tracking });
  bus.emit({ type: 'card.upsert', card: updated });
  return tracking;
}

export async function mergeCard(
  cardId: string,
  method: 'merge' | 'squash' | 'rebase',
  auto = false,
): Promise<{ ok: boolean; error?: string }> {
  const card = store.getCard(cardId);
  if (!card) return { ok: false, error: 'carte introuvable' };
  const project = store.getProject(card.projectId);
  if (!project || !card.github?.prNumber) return { ok: false, error: 'aucune demande de fusion liée' };

  const args = ['pr', 'merge', String(card.github.prNumber), `--${method}`];
  if (auto) args.push('--auto');
  const result = await gh(args, project.path);
  if (!result.ok) return { ok: false, error: result.out.slice(0, 300) };

  await refreshCard(cardId);
  return { ok: true };
}

/** Ouvre une demande de fusion pour la branche de la carte. */
export async function openPullRequest(cardId: string): Promise<{ ok: boolean; error?: string }> {
  const card = store.getCard(cardId);
  if (!card?.github?.branch) return { ok: false, error: 'aucune branche' };
  const project = store.getProject(card.projectId);
  if (!project) return { ok: false, error: 'projet introuvable' };

  const result = await gh(
    ['pr', 'create', '--head', card.github.branch, '--title', card.title, '--body', card.description || card.title],
    project.path,
  );
  if (!result.ok) return { ok: false, error: result.out.slice(0, 300) };
  await refreshCard(cardId);
  return { ok: true };
}
