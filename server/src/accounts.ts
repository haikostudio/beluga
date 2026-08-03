import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  AccountQuota,
  EngineId,
  compteDeSecours,
  doitAlerterEpuisementProche,
  doitAlerterFinDeFenetre,
  previsionEpuisement,
  tempsRestant,
} from '@haikodev/shared';
import { PATHS, CONFIG } from './config.js';
import { getDb, getMeta, setMeta } from './db.js';
import { dernieresAmorces, quotaHistory, recordQuotaSample } from './store.js';
import { bus } from './bus.js';
import { notify } from './notify.js';
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

/** Fenêtre de validité d'un relevé : au-delà, on redemande. */
const CACHE_MS = 5 * 60 * 1000;

/**
 * Le dernier relevé connu est conservé en base : un redémarrage du démon ne
 * doit pas faire retomber les jauges à zéro, et l'API de quota n'aime pas
 * qu'on l'interroge trop souvent.
 */
function loadCache(): void {
  if (quotaCache.size) return;
  try {
    const raw = getMeta('quotas.last');
    if (!raw) return;
    for (const entry of JSON.parse(raw)) {
      const quota = AccountQuota.parse(entry);
      quotaCache.set(quota.id, quota);
    }
  } catch {
    /* relevé illisible : on repartira d'une lecture */
  }
}

function persistCache(): void {
  try {
    setMeta('quotas.last', JSON.stringify([...quotaCache.values()]));
  } catch {
    /* la persistance du relevé ne doit jamais bloquer */
  }
}

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
    // Codex ne garantit PAS que la première fenêtre soit la courte : sur un
    // compte dont la fenêtre courte dort, la seule fenêtre annoncée est celle
    // de la semaine, et elle arrive en première position. On classe donc sur la
    // durée déclarée, sinon l'interface affiche la semaine sous « fenêtre ».
    const fenetres = [data?.rate_limit?.primary_window, data?.rate_limit?.secondary_window].filter(Boolean);
    const courte = (w: any) => typeof w?.limit_window_seconds !== 'number' || w.limit_window_seconds <= 24 * 3600;
    const courtes = fenetres.filter((w: any) => courte(w));
    const longues = fenetres.filter((w: any) => !courte(w));
    const session = win(courtes[0]);
    // Deux fenêtres sans durée déclarée : on retombe sur l'ordre reçu.
    const weekly = win(longues[0] ?? courtes[1]);
    if (typeof data?.plan_type === 'string') base.plan = data.plan_type.replace(/^plus$/i, 'Plus');
    const exhausted = (weekly?.usedPct ?? 0) >= 100 || (session?.usedPct ?? 0) >= 100;
    return { ...base, session, weekly, available: !exhausted };
  } catch (err: any) {
    return { ...base, error: err?.message ?? 'lecture impossible' };
  }
}

/** Prochaine tentative autorisée par compte : le service limite la fréquence. */
const nextTry = new Map<string, number>();

export async function refreshQuotas(force = false): Promise<AccountQuota[]> {
  loadCache();
  if (!force && Date.now() - lastFetch < CACHE_MS && quotaCache.size) {
    return [...quotaCache.values()];
  }
  lastFetch = Date.now();
  const accounts = listAccountRecords();
  const results: AccountQuota[] = [];
  for (const [index, account] of accounts.entries()) {
    // Un compte qui vient d'être refusé attend son tour : insister ne fait que
    // prolonger le refus, et le dernier relevé connu reste affiché.
    const attendre = nextTry.get(account.id) ?? 0;
    const connu = quotaCache.get(account.id);
    if (Date.now() < attendre && connu) {
      results.push(connu);
      continue;
    }

    // Les comptes sont interrogés l'un après l'autre, avec un souffle entre
    // deux : deux lectures collées déclenchent un refus pour excès d'appels.
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    const quota = account.engine === 'claude' ? await fetchClaudeQuota(account) : await fetchCodexQuota(account);

    if (quota.error?.includes('429')) {
      // Refus pour excès d'appels : on double l'attente, jusqu'à trente minutes.
      const precedent = Math.max(60_000, (nextTry.get(account.id) ?? 0) - Date.now());
      nextTry.set(account.id, Date.now() + Math.min(30 * 60_000, precedent * 2));
      quota.error = 'lecture momentanément indisponible';
    } else if (!quota.error) {
      nextTry.delete(account.id);
    }
    // Un compte marqué indisponible par un événement de limite le reste jusqu'à sa remise à zéro.
    const previous = quotaCache.get(account.id);
    // Une lecture RÉUSSIE fait foi : un compte remis à zéro, ou simplement mal
    // classé la fois d'avant, redevient disponible. Sans cela, un compte marqué
    // indisponible le restait jusqu'à la remise à zéro hebdomadaire, même quand
    // le fournisseur annonçait qu'il restait du quota.
    if (quota.error && previous?.available === false) {
      quota.available = false;
    }
    // Lecture refusée ou impossible : on garde les derniers chiffres RÉELLEMENT
    // relevés plutôt que d'afficher des zéros trompeurs.
    if (quota.error && previous) {
      quota.session = previous.session ?? quota.session;
      quota.weekly = previous.weekly ?? quota.weekly;
      quota.plan = previous.plan ?? quota.plan;
      quota.fetchedAt = previous.fetchedAt ?? quota.fetchedAt;
    }
    quotaCache.set(account.id, quota);
    if (!quota.error) {
      recordQuotaSample(account.id, quota.session?.usedPct, quota.weekly?.usedPct);
    }
    results.push(quota);
  }
  markActive(results);
  persistCache();
  // Seulement sur une VRAIE lecture : le cache est rejoué à chaque connexion
  // d'un navigateur, et l'alerte partirait sur des chiffres déjà vus.
  alerterFinsDeFenetre(results);
  alerterEpuisementsProches(results);
  return results;
}

export function cachedQuotas(): AccountQuota[] {
  loadCache();
  const list = [...quotaCache.values()];
  markActive(list);
  return list;
}

/** Les échéances pour lesquelles on a déjà prévenu, retenues d'un redémarrage à l'autre. */
const CLE_ALERTE_FENETRE = 'quota.alerte.fenetre';

function annoncesFaites(): Record<string, number> {
  try {
    const raw = getMeta(CLE_ALERTE_FENETRE);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/**
 * La fenêtre de cinq heures qui s'achève se dit sur le téléphone, une seule
 * fois par fenêtre. Les heures de silence s'appliquent : c'est la notification
 * elle-même qui les fait respecter.
 */
function alerterFinsDeFenetre(list: AccountQuota[]): void {
  const annonces = annoncesFaites();
  let change = false;
  for (const quota of list) {
    const etat = {
      resetsAt: quota.session?.resetsAt,
      lectureEnEchec: !!quota.error,
      dejaAnnoncee: annonces[quota.id],
    };
    if (!doitAlerterFinDeFenetre(etat)) continue;
    notify({
      kind: 'quota',
      title: 'Fenêtre de 5 h bientôt finie',
      body: `${quota.label} : ${tempsRestant(quota.session?.resetsAt)} avant la remise à zéro (${Math.round(
        quota.session?.usedPct ?? 0,
      )} % consommés).`,
      tag: `fenetre-${quota.id}`,
    });
    annonces[quota.id] = quota.session!.resetsAt!;
    change = true;
  }
  if (!change) return;
  try {
    setMeta(CLE_ALERTE_FENETRE, JSON.stringify(annonces));
  } catch (err) {
    // Sans trace retenue, la même fenêtre se signalerait à chaque lecture.
    log.warn('quota : impossible de retenir l’alerte de fin de fenêtre', err);
  }
}

/** Les semaines pour lesquelles on a déjà annoncé un manque annoncé. */
const CLE_ALERTE_EPUISEMENT = 'quota.alerte.epuisement';

/**
 * « Au rythme actuel, ce compte n'ira pas au bout de la semaine » se dit sur le
 * téléphone, UNE seule fois par semaine et par compte. Le message porte le
 * compte de secours quand il en existe un : prévenir sans dire quoi faire ne
 * sert à rien au milieu de la nuit.
 */
function alerterEpuisementsProches(list: AccountQuota[]): void {
  let annonces: Record<string, number> = {};
  try {
    const raw = getMeta(CLE_ALERTE_EPUISEMENT);
    annonces = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    annonces = {};
  }

  const histoire = quotaHistory(7);
  const previsions = new Map(
    list.map((quota) => [quota.id, previsionEpuisement(histoire[quota.id] ?? [], quota.weekly)] as const),
  );

  let change = false;
  for (const quota of list) {
    const prevision = previsions.get(quota.id);
    const etat = {
      resetsAt: quota.weekly?.resetsAt,
      niveau: prevision?.niveau,
      lectureEnEchec: !!quota.error,
      dejaAnnoncee: annonces[quota.id],
    };
    if (!doitAlerterEpuisementProche(etat)) continue;

    const secours = compteDeSecours(
      { id: quota.id, engine: quota.engine },
      list.map((autre) => ({
        id: autre.id,
        label: autre.label,
        engine: autre.engine,
        disponible: autre.available !== false,
        tientJusquAuBout: !previsions.get(autre.id),
        consommePct: autre.weekly?.usedPct ?? 0,
      })),
    );

    notify({
      kind: 'quota',
      title: 'Le quota de la semaine va manquer',
      body:
        `${quota.label} : ${prevision!.texte} (${Math.round(quota.weekly?.usedPct ?? 0)} % consommés).` +
        (secours ? ` Bascule possible sur ${secours.label}.` : ''),
      tag: `epuisement-${quota.id}`,
    });
    annonces[quota.id] = quota.weekly!.resetsAt!;
    change = true;
  }

  if (!change) return;
  try {
    setMeta(CLE_ALERTE_EPUISEMENT, JSON.stringify(annonces));
  } catch (err) {
    // Sans trace retenue, la même semaine se signalerait à chaque lecture.
    log.warn('quota : impossible de retenir l’alerte d’épuisement proche', err);
  }
}

/**
 * La dernière amorce posée par le serveur voyage avec le quota : c'est ce qui
 * permet de lire à l'écran QUAND la fenêtre a été lancée, sans ouvrir la base.
 */
function attacherAmorces(list: AccountQuota[]): void {
  try {
    const amorces = dernieresAmorces();
    for (const quota of list) quota.derniereAmorce = amorces[quota.id];
  } catch {
    // Journal illisible : le quota reste affichable, c'est l'essentiel.
  }
}

function markActive(list: AccountQuota[]): void {
  attacherAmorces(list);
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

  const quotas = await refreshQuotas(false);
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
  // Aucun compte n'est marqué disponible. Avant de faire attendre la carte, on
  // regarde s'il en reste un qui n'est pas réellement à 100 % : mieux vaut
  // travailler sur le compte le moins consommé que de refuser à tort.
  const restant = accounts
    .map((account) => ({ account, quota: quotas.find((q) => q.id === account.id) }))
    .filter(({ quota }) => {
      const pire = Math.max(quota?.session?.usedPct ?? 0, quota?.weekly?.usedPct ?? 0);
      return pire < 100;
    })
    .sort(
      (a, b) =>
        Math.max(a.quota?.session?.usedPct ?? 0, a.quota?.weekly?.usedPct ?? 0) -
        Math.max(b.quota?.session?.usedPct ?? 0, b.quota?.weekly?.usedPct ?? 0),
    )[0];

  if (restant) {
    log.info(`aucun compte marqué disponible : on retient ${restant.account.label}, qui a encore du quota`);
    return restant.account;
  }

  return null; // tous à sec : la carte attend et le dit, elle n'échoue pas
}

/** Un événement de limite reçu en cours d'exécution met le compte de côté. */
/** Les statuts qui signifient vraiment « ce compte ne répond plus ». */
const STATUTS_BLOQUANTS = new Set(['rejected', 'exceeded', 'blocked', 'exhausted', 'limit_reached']);

export function noteAccountUse(accountId: string, rateLimit: { status: string; resetsAt?: number; type?: string }): void {
  const quota = quotaCache.get(accountId);
  if (!quota) return;
  // Un avertissement (« allowed_warning ») dit qu'on approche de la limite,
  // pas qu'on l'a atteinte : le compte reste utilisable.
  if (rateLimit.status && STATUTS_BLOQUANTS.has(rateLimit.status.toLowerCase())) {
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
