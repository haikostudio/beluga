import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AccountQuota, EngineId } from '@haikodev/shared';
import { PATHS, CONFIG } from './config.js';
import { getDb } from './db.js';
import { bus } from './bus.js';
import { log } from './logger.js';

/**
 * Les comptes des moteurs (PLAN §13). Chaque compte a SON PROPRE COFFRE : un
 * dossier de configuration isolé. Jamais deux comptes dans le même dossier —
 * ils se déconnecteraient mutuellement en réécrivant leurs jetons.
 */

export interface AccountRecord {
  id: string;
  engine: EngineId;
  label: string;
  plan?: string;
  /** Ordre déclaré : le plus petit passe en premier (x20 avant Pro). */
  priority: number;
  configDir: string;
  disabled?: boolean;
}

const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20';

export function listAccountRecords(): AccountRecord[] {
  const rows = getDb().prepare('SELECT data FROM accounts ORDER BY id').all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as AccountRecord).filter((a) => !a.disabled);
}

export function saveAccountRecord(account: AccountRecord): void {
  getDb()
    .prepare(
      `INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(account.id, account.engine, JSON.stringify(account), Date.now());
}

/** Déclare les comptes déjà authentifiés sur le serveur au premier démarrage. */
export function bootstrapAccounts(): void {
  const knownIds = new Set(listAccountRecords().map((account) => account.id));
  const home = CONFIG.homeDir || os.homedir();

  const claudeDir = path.join(home, '.claude');
  if (!knownIds.has('claude-principal') && fs.existsSync(path.join(claudeDir, '.credentials.json'))) {
    saveAccountRecord({
      id: 'claude-principal',
      engine: 'claude',
      label: 'Claude — compte principal',
      plan: readClaudePlan(claudeDir),
      priority: 10,
      configDir: claudeDir,
    });
  }

  const codexDir = path.join(home, '.codex');
  if (!knownIds.has('codex-principal') && fs.existsSync(path.join(codexDir, 'auth.json'))) {
    saveAccountRecord({
      id: 'codex-principal',
      engine: 'codex',
      label: 'Codex — compte principal',
      priority: 10,
      configDir: codexDir,
    });
  }

  // Les comptes de relève déclarés à la main dans data/accounts/<id>/
  try {
    for (const entry of fs.readdirSync(PATHS.accounts, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metaFile = path.join(PATHS.accounts, entry.name, 'meta.json');
      if (!fs.existsSync(metaFile)) continue;
      if (knownIds.has(entry.name)) continue;
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      const accountDir = path.join(PATHS.accounts, entry.name);
      const configuredDir = typeof meta.configDir === 'string' ? meta.configDir.trim() : '';
      const configDir = configuredDir
        ? path.isAbsolute(configuredDir)
          ? configuredDir
          : path.resolve(accountDir, configuredDir)
        : accountDir;
      saveAccountRecord({
        id: entry.name,
        engine: meta.engine ?? 'claude',
        label: meta.label ?? entry.name,
        plan: meta.plan ?? (meta.engine === 'codex' ? undefined : readClaudePlan(configDir)),
        priority: meta.priority ?? 50,
        configDir,
      });
      knownIds.add(entry.name);
    }
  } catch {
    /* aucun compte de relève */
  }
}

function readClaudePlan(configDir: string): string | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(configDir, '.credentials.json'), 'utf8'));
    const oauth = raw?.claudeAiOauth;
    const tier = typeof oauth?.rateLimitTier === 'string' ? oauth.rateLimitTier : '';
    const subscription = typeof oauth?.subscriptionType === 'string' ? oauth.subscriptionType : '';
    if (/20/.test(tier)) return 'Max x20';
    if (/max/i.test(tier) || /max/i.test(subscription)) return 'Max';
    if (/pro/i.test(subscription)) return 'Pro';
    return subscription || tier || undefined;
  } catch {
    /* plan inconnu */
  }
  return undefined;
}

/** Prépare l'environnement d'un lancement : un compte, un dossier. */
export function applyAccountEnv(account: AccountRecord): Record<string, string> {
  if (account.engine === 'claude') {
    return { CLAUDE_CONFIG_DIR: account.configDir };
  }
  return { CODEX_HOME: account.configDir };
}

/* ------------------------------------------------------------------ */
/* Lecture des quotas                                                  */
/* ------------------------------------------------------------------ */

const quotaCache = new Map<string, AccountQuota>();
let lastFetch = 0;

async function fetchClaudeQuota(account: AccountRecord): Promise<AccountQuota> {
  const base: AccountQuota = {
    id: account.id,
    engine: 'claude',
    label: account.label,
    plan: account.plan,
    priority: account.priority,
    active: false,
    available: true,
    fetchedAt: Date.now(),
  };
  try {
    const credFile = path.join(account.configDir, '.credentials.json');
    const raw = JSON.parse(fs.readFileSync(credFile, 'utf8'));
    const token = raw?.claudeAiOauth?.accessToken;
    if (!token) return { ...base, error: 'compte non connecté', available: false };

    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        authorization: `Bearer ${token}`,
        'anthropic-beta': CLAUDE_OAUTH_BETA,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { ...base, error: `lecture impossible (${res.status})` };
    const data: any = await res.json();

    const window = (w: any) =>
      w
        ? {
            usedPct: typeof w.utilization === 'number' ? w.utilization : undefined,
            resetsAt: w.resets_at ? new Date(w.resets_at).getTime() : undefined,
          }
        : undefined;

    const session = window(data.five_hour);
    const weekly = window(data.seven_day);
    const exhausted = (weekly?.usedPct ?? 0) >= 100 || (session?.usedPct ?? 0) >= 100;

    return { ...base, session, weekly, available: !exhausted };
  } catch (err: any) {
    return { ...base, error: err?.message ?? 'lecture impossible' };
  }
}

async function fetchCodexQuota(account: AccountRecord): Promise<AccountQuota> {
  const base: AccountQuota = {
    id: account.id,
    engine: 'codex',
    label: account.label,
    plan: account.plan,
    priority: account.priority,
    active: false,
    available: true,
    fetchedAt: Date.now(),
  };
  try {
    const authFile = path.join(account.configDir, 'auth.json');
    const raw = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    const token = raw?.tokens?.access_token ?? raw?.OPENAI_API_KEY;
    if (!token) return { ...base, error: 'compte non connecté', available: false };

    const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: { authorization: `Bearer ${token}`, originator: 'codex_cli_rs' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { ...base, error: `lecture impossible (${res.status})` };
    const data: any = await res.json();
    const win = (w: any) =>
      w
        ? {
            usedPct: w.used_percent ?? undefined,
            resetsAt:
              typeof w.resets_in_seconds === 'number'
                ? Date.now() + w.resets_in_seconds * 1000
                : w.reset_at
                  ? w.reset_at * 1000
                  : undefined,
          }
        : undefined;
    const session = win(data?.rate_limit?.primary_window);
    const weekly = win(data?.rate_limit?.secondary_window);
    if (typeof data?.plan_type === 'string') base.plan = data.plan_type.replace(/^plus$/i, 'Plus');
    const exhausted = (weekly?.usedPct ?? 0) >= 100 || (session?.usedPct ?? 0) >= 100;
    return { ...base, session, weekly, available: !exhausted };
  } catch (err: any) {
    return { ...base, error: err?.message ?? 'lecture impossible' };
  }
}

export async function refreshQuotas(force = false): Promise<AccountQuota[]> {
  if (!force && Date.now() - lastFetch < 60_000 && quotaCache.size) {
    return [...quotaCache.values()];
  }
  lastFetch = Date.now();
  const accounts = listAccountRecords();
  const results: AccountQuota[] = [];
  for (const [index, account] of accounts.entries()) {
    // Les comptes sont interrogés l'un après l'autre, avec un souffle entre
    // deux : deux lectures collées déclenchent un refus pour excès d'appels.
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 700));
    const quota = account.engine === 'claude' ? await fetchClaudeQuota(account) : await fetchCodexQuota(account);
    // Un compte marqué indisponible par un événement de limite le reste jusqu'à sa remise à zéro.
    const previous = quotaCache.get(account.id);
    if (previous?.available === false && previous.weekly?.resetsAt && previous.weekly.resetsAt > Date.now()) {
      quota.available = false;
    }
    // Lecture momentanément refusée : on garde les derniers chiffres connus
    // plutôt que d'afficher des zéros trompeurs.
    if (quota.error && previous && !previous.error) {
      quota.session = previous.session;
      quota.weekly = previous.weekly;
      quota.plan = previous.plan ?? quota.plan;
    }
    quotaCache.set(account.id, quota);
    results.push(quota);
  }
  markActive(results);
  return results;
}

export function cachedQuotas(): AccountQuota[] {
  const list = [...quotaCache.values()];
  markActive(list);
  return list;
}

function markActive(list: AccountQuota[]): void {
  for (const engine of ['claude', 'codex'] as EngineId[]) {
    const candidates = list.filter((q) => q.engine === engine).sort((a, b) => a.priority - b.priority);
    const chosen = candidates.find((q) => q.available) ?? candidates[0];
    for (const quota of candidates) quota.active = quota.id === chosen?.id;
  }
}

/**
 * La décision se prend AU LANCEMENT d'un agent : compte prioritaire d'abord,
 * relève ensuite. Jamais de bascule en plein vol.
 */
export async function pickAccount(engine: EngineId): Promise<AccountRecord | null> {
  const accounts = listAccountRecords()
    .filter((a) => a.engine === engine)
    .sort((a, b) => a.priority - b.priority);
  if (!accounts.length) return null;

  const quotas = await refreshQuotas();
  for (const account of accounts) {
    const quota = quotas.find((q) => q.id === account.id);
    if (!quota || quota.available) {
      if (quota && !quota.active) {
        log.info(`bascule de compte : ${account.label} prend le relais`);
        bus.toast('info', `Bascule de compte : ${account.label}`);
      }
      return account;
    }
  }
  return null; // les deux sont à sec : la carte attend et le dit, elle n'échoue pas
}

/** Un événement de limite reçu en cours d'exécution met le compte de côté. */
export function noteAccountUse(accountId: string, rateLimit: { status: string; resetsAt?: number; type?: string }): void {
  const quota = quotaCache.get(accountId);
  if (!quota) return;
  if (rateLimit.status && rateLimit.status !== 'allowed') {
    quota.available = false;
    if (rateLimit.type === 'seven_day' || rateLimit.type === 'weekly') {
      quota.weekly = { ...(quota.weekly ?? {}), resetsAt: rateLimit.resetsAt };
    } else {
      quota.session = { ...(quota.session ?? {}), resetsAt: rateLimit.resetsAt };
    }
    quotaCache.set(accountId, quota);
    bus.emit({ type: 'quotas', quotas: cachedQuotas() });
  }
}

export function accountLabel(id: string | undefined): string {
  if (!id) return '—';
  return listAccountRecords().find((a) => a.id === id)?.label ?? id;
}
