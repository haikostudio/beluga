import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  API_CURSOR,
  AccountQuota,
  EngineId,
  type EtatSeuilsSemaine,
  compteDeSecours,
  raisonDeRefusCursor,
  doitAlerterEmballement,
  doitAlerterEpuisementProche,
  doitAlerterFinDeFenetre,
  emballementConsommation,
  etatDeConnexion,
  franchissementSemaine,
  historiquePourProfil,
  memeFenetre,
  previsionEpuisement,
  tempsRestant,
} from '@haikodev/shared';
import { PATHS, CONFIG } from './config.js';
import { getDb, getMeta, setMeta } from './db.js';
import { dernieresAmorces, quotaHistory, quotaResume, recordQuotaSample } from './store.js';
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

/**
 * Les comptes RÉELLEMENT utilisables : un compte coupé à la main (`disabled`)
 * est écarté. C'est la liste que voient l'ordonnanceur, l'amorçage des fenêtres,
 * le catalogue des modèles — partout où un compte éteint ne doit plus servir.
 */
export function listAccountRecords(): AccountRecord[] {
  return listAllAccountRecords().filter((a) => !a.disabled);
}

/**
 * TOUS les comptes déclarés, coupés compris. Sert au volet Quotas, qui garde le
 * compte éteint visible avec son interrupteur, et à la commande qui le coupe.
 */
export function listAllAccountRecords(): AccountRecord[] {
  const rows = getDb().prepare('SELECT data FROM accounts ORDER BY id').all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as AccountRecord);
}

/**
 * Coupe ou remet en service un compte. Le réglage est écrit sur le compte, donc
 * il survit à un redémarrage. Rien n'est supprimé : le compte reste déclaré,
 * simplement marqué éteint.
 */
export function setAccountDisabled(id: string, disabled: boolean): AccountRecord | null {
  const account = listAllAccountRecords().find((a) => a.id === id);
  if (!account) return null;
  const updated: AccountRecord = { ...account, disabled };
  saveAccountRecord(updated);
  return updated;
}

/**
 * Renomme un compte : on ne touche QU'au nom affiché (`label`), écrit sur le
 * compte donc durable au redémarrage. Un nom vide (ou fait d'espaces) est
 * refusé — le compte garde son ancien nom et la fonction rend `null`.
 */
export function renameAccount(id: string, label: string): AccountRecord | null {
  const propre = label.trim();
  if (!propre) return null;
  const account = listAllAccountRecords().find((a) => a.id === id);
  if (!account) return null;
  const updated: AccountRecord = { ...account, label: propre };
  saveAccountRecord(updated);
  // Le nom affiché d'un compte vient de son relevé de quota. Un compte dont la
  // lecture est en pause (après un refus 429) repousse tel quel son dernier
  // relevé mémorisé : sans cette mise à jour, il garderait l'ancien nom. On
  // corrige le relevé en cache pour que le nouveau nom remonte AUSSITÔT, même
  // sans nouvelle lecture.
  loadCache();
  const enCache = quotaCache.get(id);
  if (enCache) {
    quotaCache.set(id, { ...enCache, label: propre });
    persistCache();
  }
  return updated;
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
  // On compte les comptes DÉJÀ connus sur la liste COMPLÈTE : un compte coupé à
  // la main (`disabled`) est bien connu, il ne doit surtout pas être reconstruit
  // à neuf — cela effacerait son drapeau et le rallumerait au redémarrage.
  const knownIds = new Set(listAllAccountRecords().map((account) => account.id));
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

  /*
   * CURSOR n'a pas de coffre à jetons sur la machine : sa clé vit hors du dépôt
   * (`CURSOR_API_KEY`, fichier d'environnement du service). Le compte n'est donc
   * déclaré que si la clé est là — sinon le moteur n'apparaît nulle part, ce qui
   * est exactement le comportement voulu.
   */
  if (!knownIds.has('cursor-principal') && (process.env.CURSOR_API_KEY ?? '').trim()) {
    saveAccountRecord({
      id: 'cursor-principal',
      engine: 'cursor',
      label: 'Cursor — compte principal',
      priority: 10,
      configDir: path.join(PATHS.accounts, 'cursor-principal'),
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
        // Le « plan » ne se lit que sur un coffre Claude : les autres moteurs
        // n'en ont pas, et aller y chercher un fichier absent n'apprend rien.
        plan: meta.plan ?? ((meta.engine ?? 'claude') === 'claude' ? readClaudePlan(configDir) : undefined),
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

/**
 * Prépare l'environnement d'un lancement : un compte, un dossier. Cursor n'a
 * pas de coffre sur la machine — il n'a qu'une CLÉ, qui voyage de la même
 * façon : le moteur ne lit jamais un compte, il lit son environnement.
 */
export function applyAccountEnv(account: AccountRecord): Record<string, string> {
  if (account.engine === 'claude') {
    return { CLAUDE_CONFIG_DIR: account.configDir };
  }
  if (account.engine === 'cursor') {
    const cle = cleDuCompteCursor(account);
    return cle ? { CURSOR_API_KEY: cle } : {};
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

/**
 * LA CLÉ D'ACCÈS D'UN COMPTE CURSOR. Ce moteur n'a pas de coffre à jetons comme
 * les outils en ligne de commande : il a une CLÉ, posée hors du dépôt dans
 * `CURSOR_API_KEY` (fichier d'environnement du service), ou déposée dans le
 * dossier du compte (`api-key`) pour un compte de relève. Rien n'est écrit en
 * dur ici.
 */
export function cleDuCompteCursor(account: AccountRecord): string {
  const depuisLEnvironnement = (process.env.CURSOR_API_KEY ?? '').trim();
  try {
    const fichier = path.join(account.configDir, 'api-key');
    const contenu = fs.readFileSync(fichier, 'utf8').trim();
    if (contenu) return contenu;
  } catch {
    /* pas de fichier de clé : celle de l'environnement fait foi */
  }
  return depuisLEnvironnement;
}

/**
 * Cursor ne publie AUCUN quota : sa facturation se lit à la dépense, pas à un
 * pourcentage de fenêtre. On ne montre donc pas de jauge inventée — on dit
 * seulement si la clé RÉPOND, ce qui est la seule chose qui décide qu'un tour
 * peut partir.
 */
async function fetchCursorQuota(account: AccountRecord): Promise<AccountQuota> {
  const base: AccountQuota = {
    id: account.id,
    engine: 'cursor',
    label: account.label,
    plan: account.plan,
    priority: account.priority,
    active: false,
    available: true,
    fetchedAt: Date.now(),
  };
  const cle = cleDuCompteCursor(account);
  if (!cle) return { ...base, error: 'aucune clé configurée', available: false };
  try {
    const res = await fetch(`${API_CURSOR}/v1/me`, {
      headers: { authorization: `Bearer ${cle}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      const corps: any = await res.json().catch(() => null);
      return {
        ...base,
        error: raisonDeRefusCursor(res.status, corps?.message ?? corps?.error?.message),
        available: false,
      };
    }
    const data: any = await res.json();
    return { ...base, plan: typeof data?.apiKeyName === 'string' ? data.apiKeyName : account.plan };
  } catch (err: any) {
    return { ...base, error: err?.message ?? 'lecture impossible' };
  }
}

/**
 * La lecture de quota du moteur de CE compte. Un seul endroit décide : ajouter
 * un moteur, c'est ajouter une ligne ici, jamais chercher les trois appels
 * dispersés qui répétaient la même condition.
 */
function lireQuotaDuMoteur(account: AccountRecord): Promise<AccountQuota> {
  if (account.engine === 'claude') return fetchClaudeQuota(account);
  if (account.engine === 'cursor') return fetchCursorQuota(account);
  return fetchCodexQuota(account);
}

/** Prochaine tentative autorisée par compte : le service limite la fréquence. */
const nextTry = new Map<string, number>();

/** Le planificateur d'échéance respecte la même pause que les lectures manuelles. */
export function prochaineTentativeQuota(accountId: string): number | undefined {
  return nextTry.get(accountId);
}

let actualisationEnCours: Promise<AccountQuota[]> | null = null;

export function refreshQuotas(force = false, seulement?: readonly string[]): Promise<AccountQuota[]> {
  // Une lecture périodique, manuelle et planifiée peuvent tomber dans la même
  // seconde. Elles partagent alors LA lecture déjà en cours au lieu d'envoyer
  // plusieurs fois la même requête au fournisseur.
  if (actualisationEnCours) return actualisationEnCours;
  actualisationEnCours = executerActualisationQuotas(force, seulement).finally(() => {
    actualisationEnCours = null;
  });
  return actualisationEnCours;
}

async function executerActualisationQuotas(force = false, seulement?: readonly string[]): Promise<AccountQuota[]> {
  loadCache();
  if (!force && Date.now() - lastFetch < CACHE_MS && quotaCache.size) {
    return [...quotaCache.values()];
  }
  lastFetch = Date.now();
  const demandes = seulement ? new Set(seulement) : null;
  const comptesActifs = listAccountRecords();
  const accounts = comptesActifs.filter((account) => !demandes || demandes.has(account.id));
  let lecturesLancees = 0;
  for (const [index, account] of accounts.entries()) {
    // Un compte qui vient d'être refusé attend son tour : insister ne fait que
    // prolonger le refus, et le dernier relevé connu reste affiché.
    const attendre = nextTry.get(account.id) ?? 0;
    const connu = quotaCache.get(account.id);
    if (Date.now() < attendre && connu) {
      // Le relevé mémorisé est repoussé tel quel, mais son NOM peut avoir changé
      // depuis (renommage) : on réapplique toujours celui du compte, jamais
      // celui figé dans le relevé.
      quotaCache.set(account.id, { ...connu, label: account.label });
      continue;
    }

    // Les comptes sont interrogés l'un après l'autre, avec un souffle entre
    // deux : deux lectures collées déclenchent un refus pour excès d'appels.
    if (index > 0 && lecturesLancees > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    lecturesLancees += 1;
    const quota = await lireQuotaDuMoteur(account);

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
    // Codex recalcule `resetsAt` en relatif à chaque lecture, si bien qu'il
    // dérive de quelques secondes sans que la fenêtre ait changé : les paliers
    // hebdomadaires repartaient alors à zéro à chaque relevé. On épingle donc
    // l'échéance sur celle déjà connue tant qu'elle décrit la MÊME fenêtre
    // (`memeFenetre`). Un vrai changement de fenêtre s'écarte de plusieurs jours
    // et n'est jamais confondu. Claude, dont `resetsAt` est absolu, ne bouge pas.
    if (previous?.weekly && quota.weekly && memeFenetre(previous.weekly.resetsAt, quota.weekly.resetsAt)) {
      quota.weekly = { ...quota.weekly, resetsAt: previous.weekly.resetsAt };
    }
    if (previous?.session && quota.session && memeFenetre(previous.session.resetsAt, quota.session.resetsAt)) {
      quota.session = { ...quota.session, resetsAt: previous.session.resetsAt };
    }
    quotaCache.set(account.id, quota);
    if (!quota.error) {
      recordQuotaSample(account.id, quota.session?.usedPct, quota.weekly?.usedPct);
    }
  }
  // Une tournée ciblée rend aussi les autres comptes depuis le cache, mais
  // seulement ceux qui existent encore et sont actifs. Les comptes coupés sont
  // ajoutés juste dessous avec leur vrai drapeau `disabled`.
  const results = comptesActifs
    .map((account) => quotaCache.get(account.id))
    .filter((quota): quota is AccountQuota => !!quota);
  ajouterComptesDesactives(results);
  markActive(results);
  persistCache();
  // Seulement sur une VRAIE lecture : le cache est rejoué à chaque connexion
  // d'un navigateur, et l'alerte partirait sur des chiffres déjà vus.
  alerterFinsDeFenetre(results);
  alerterSeuilsSemaine(results);
  alerterEpuisementsProches(results);
  alerterEmballements(results);
  return results;
}

export function cachedQuotas(): AccountQuota[] {
  loadCache();
  const list = [...quotaCache.values()];
  ajouterComptesDesactives(list);
  markActive(list);
  return list;
}

/**
 * Un compte coupé n'est plus interrogé (il ne fait pas partie de
 * `listAccountRecords`), mais il doit RESTER visible dans le volet Quotas, éteint,
 * pour qu'on puisse le rallumer. On le rejoue depuis son dernier relevé connu,
 * ou depuis un état minimal s'il n'a jamais été lu, toujours marqué `disabled` et
 * indisponible.
 */
function ajouterComptesDesactives(list: AccountQuota[]): void {
  const dejaLa = new Set(list.map((q) => q.id));
  for (const account of listAllAccountRecords()) {
    if (!account.disabled) continue;
    const connu = quotaCache.get(account.id);
    const quota: AccountQuota = connu
      ? { ...connu, disabled: true, active: false, available: false }
      : {
          id: account.id,
          engine: account.engine,
          label: account.label,
          plan: account.plan,
          priority: account.priority,
          active: false,
          available: false,
          disabled: true,
          fetchedAt: Date.now(),
        };
    quotaCache.set(account.id, quota);
    if (!dejaLa.has(account.id)) {
      list.push(quota);
      dejaLa.add(account.id);
    }
  }
}

/**
 * Les deux pourcentages consommés d'un compte, lus dans le DERNIER relevé connu
 * (le cache). Sert de point de départ AVANT un tour : la lecture est déjà
 * fraîche, un agent vient d'être choisi sur ce compte (`pickAccount` relève les
 * quotas). Aucun appel réseau : on ne bouscule pas le rythme des lectures.
 */
export function partsQuotaEnCache(accountId: string): { session?: number; weekly?: number } {
  loadCache();
  const quota = quotaCache.get(accountId);
  return { session: quota?.session?.usedPct, weekly: quota?.weekly?.usedPct };
}

/**
 * Relève À NEUF les deux pourcentages d'UN compte, hors du tour de ronde de
 * `refreshQuotas`. Sert de point d'arrivée APRÈS un tour, pour mesurer ce que la
 * tâche a réellement dépensé. Lecture PURE : ni cache mis à jour, ni relevé
 * enregistré, ni alerte déclenchée — le calcul des quotas et ses alertes ne
 * bougent pas. Une lecture en échec rend `null` : on n'attribue rien plutôt que
 * d'inventer une part.
 */
export async function relireQuotaDuCompte(
  accountId: string,
): Promise<{ session?: number; weekly?: number } | null> {
  const account = listAccountRecords().find((a) => a.id === accountId);
  if (!account) return null;
  const quota = await lireQuotaDuMoteur(account);
  if (quota.error) return null;
  return { session: quota.session?.usedPct, weekly: quota.weekly?.usedPct };
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
    // Une fenêtre de cinq heures qui s'achève se remplit d'elle-même : cela se
    // lit dans le volet des quotas, cela ne réveille plus personne.
    notify({
      motif: 'fenetre-bientot-finie',
      title: 'Fenêtre de 5 h bientôt finie',
      body: `${quota.label} : ${tempsRestant(quota.session?.resetsAt)} avant la remise à zéro (${Math.round(
        quota.session?.usedPct ?? 0,
      )} % consommés).`,
      reference: `${quota.id}:fenetre`,
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

/** Les paliers de consommation déjà annoncés, fenêtre hebdomadaire par fenêtre. */
const CLE_SEUILS_SEMAINE = 'quota.alerte.seuils';

/**
 * Les DEUX paliers qui comptent sur la semaine : 70 % (il est temps de
 * s'organiser) et 90 % (la fin approche). Chacun se dit une seule fois par
 * fenêtre, et la remise à zéro hebdomadaire efface l'ardoise. Passer de 60 à
 * 95 % d'un coup ne fait qu'une alerte : la règle est dans
 * `franchissementSemaine` (shared), le disque n'est ici que sa mémoire.
 */
function alerterSeuilsSemaine(list: AccountQuota[]): void {
  let etats: Record<string, EtatSeuilsSemaine> = {};
  try {
    const raw = getMeta(CLE_SEUILS_SEMAINE);
    etats = raw ? (JSON.parse(raw) as Record<string, EtatSeuilsSemaine>) : {};
  } catch {
    etats = {};
  }

  let change = false;
  for (const quota of list) {
    // Chiffres périmés : prévenir sur une preuve qu'on n'a plus n'aide personne.
    if (quota.error) continue;
    const franchi = franchissementSemaine(etats[quota.id], quota.weekly?.usedPct, quota.weekly?.resetsAt);
    if (!franchi) continue;

    notify({
      motif: 'quota-seuil',
      title: `Quota de la semaine : ${franchi.seuil} % atteints`,
      body: `${quota.label} : ${Math.round(quota.weekly?.usedPct ?? 0)} % du quota hebdomadaire sont consommés.`,
      // Pas de `resetsAt` dans la référence : côté Codex il dérive et la mémoire
      // courte du guichet `notify` ne rattraperait rien. La marque persistante
      // (`quota.alerte.seuils`) distingue déjà les vraies fenêtres ; ici, un même
      // compte au même palier ne fait qu'une alerte, second filet de dix minutes.
      reference: `${quota.id}:seuil-${franchi.seuil}`,
      element: `${quota.label} — ${franchi.seuil} %`,
    });
    etats[quota.id] = franchi.etat;
    change = true;
  }

  if (!change) return;
  try {
    setMeta(CLE_SEUILS_SEMAINE, JSON.stringify(etats));
  } catch (err) {
    // Sans trace retenue, le même palier se signalerait à chaque lecture.
    log.warn('quota : impossible de retenir le palier franchi', err);
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
  // Le profil des heures creuses puise aussi dans le RÉSUMÉ des semaines
  // passées ; la pente du moment, elle, reste mesurée sur les relevés récents.
  const resume = quotaResume();
  const previsions = new Map(
    list.map(
      (quota) =>
        [
          quota.id,
          previsionEpuisement(historiquePourProfil(resume[quota.id], histoire[quota.id]), quota.weekly),
        ] as const,
    ),
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
      motif: 'quota-surconsommation',
      title: 'Le quota de la semaine va manquer',
      body:
        `${quota.label} : ${prevision!.texte} (${Math.round(quota.weekly?.usedPct ?? 0)} % consommés).` +
        (secours ? ` Bascule possible sur ${secours.label}.` : ''),
      reference: `${quota.id}:epuisement:${quota.weekly!.resetsAt}`,
      element: `${quota.label} : ${prevision!.texte}`,
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

/** Les emballements déjà annoncés, compte par compte : le départ de la série. */
const CLE_ALERTE_EMBALLEMENT = 'quota.alerte.emballement';

/**
 * « Ce compte consomme bien plus vite que d'habitude » se dit sur le téléphone
 * AVANT que la prévision de fin de semaine n'ait basculé — c'est tout l'objet
 * de cette alerte-là. Une seule fois par emballement : le départ de la série
 * sert de marque, gardée sur le disque, donc un redémarrage n'en refait pas une
 * et il faut un retour à la normale pour redonner droit à la suivante.
 *
 * On prévient, on ne décide pas : aucun agent n'est arrêté, aucun compte n'est
 * changé.
 */
function alerterEmballements(list: AccountQuota[]): void {
  let annonces: Record<string, number> = {};
  try {
    const raw = getMeta(CLE_ALERTE_EMBALLEMENT);
    annonces = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    annonces = {};
  }

  const histoire = quotaHistory(14);

  let change = false;
  for (const quota of list) {
    const emballement = emballementConsommation(histoire[quota.id] ?? []);
    // Retour à la normale : l'ardoise s'efface, la prochaine pointe pourra parler.
    if (!emballement && annonces[quota.id] !== undefined) {
      delete annonces[quota.id];
      change = true;
    }
    if (
      !doitAlerterEmballement({
        emballement,
        lectureEnEchec: !!quota.error,
        dejaAnnoncee: annonces[quota.id],
      })
    ) {
      continue;
    }

    notify({
      motif: 'quota-emballement',
      title: 'Consommation inhabituelle',
      body: `${quota.label} : ${emballement!.texte}.`,
      reference: `${quota.id}:emballement:${emballement!.depuis}`,
      element: `${quota.label} — ${emballement!.facteur.toFixed(1)} fois l’habitude`,
    });
    annonces[quota.id] = emballement!.depuis;
    change = true;
  }

  if (!change) return;
  try {
    setMeta(CLE_ALERTE_EMBALLEMENT, JSON.stringify(annonces));
  } catch (err) {
    // Sans trace retenue, le même emballement se signalerait à chaque lecture.
    log.warn('quota : impossible de retenir l’alerte d’emballement', err);
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

/**
 * Quand le jeton d'un compte arrive à échéance, quand on sait le lire. Claude
 * l'écrit en clair ; Codex le range dans le jeton lui-même — un jeton signé en
 * trois parties, dont celle du milieu porte la date.
 */
export function expirationDuCompte(account: AccountRecord): number | undefined {
  try {
    if (account.engine === 'claude') {
      const raw = JSON.parse(fs.readFileSync(path.join(account.configDir, '.credentials.json'), 'utf8'));
      const expire = Number(raw?.claudeAiOauth?.expiresAt);
      return Number.isFinite(expire) ? expire : undefined;
    }
    const raw = JSON.parse(fs.readFileSync(path.join(account.configDir, 'auth.json'), 'utf8'));
    const jeton = raw?.tokens?.access_token;
    if (typeof jeton !== 'string') return undefined;
    const milieu = jeton.split('.')[1];
    if (!milieu) return undefined;
    const charge = JSON.parse(Buffer.from(milieu, 'base64url').toString('utf8'));
    return typeof charge?.exp === 'number' ? charge.exp * 1000 : undefined;
  } catch {
    // Fichier absent ou illisible : l'absence de jeton se lit déjà dans le quota.
    return undefined;
  }
}

/**
 * L'état RÉEL de la connexion voyage avec le quota : un compte peut avoir tout
 * son quota et un jeton mort, et rien à l'écran ne le disait — il fallait ouvrir
 * un terminal pour le découvrir. La règle est pure (`etatDeConnexion`), le
 * disque n'apporte ici que l'échéance du jeton.
 */
function attacherEtatConnexion(list: AccountQuota[]): void {
  const comptes = new Map(listAccountRecords().map((a) => [a.id, a]));
  for (const quota of list) {
    const compte = comptes.get(quota.id);
    quota.connexion = etatDeConnexion({
      erreur: quota.error,
      expireA: compte ? expirationDuCompte(compte) : undefined,
    });
  }
}

function markActive(list: AccountQuota[]): void {
  attacherAmorces(list);
  attacherEtatConnexion(list);
  for (const engine of ['claude', 'codex', 'cursor'] as EngineId[]) {
    // Un compte coupé ne peut pas être « celui qui sert » : on l'écarte du choix.
    const candidates = list
      .filter((q) => q.engine === engine && !q.disabled)
      .sort((a, b) => a.priority - b.priority);
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

/**
 * Cet événement de limite BLOQUE-T-IL le compte ? Un avertissement
 * (« allowed_warning ») dit qu'on approche, pas qu'on y est. Exporté parce que
 * le tour lui-même a besoin de le savoir : c'est la preuve la plus sûre qu'un
 * arrêt vient du quota, et non d'une panne.
 */
export function limiteBloquante(statut: string | undefined): boolean {
  return !!statut && STATUTS_BLOQUANTS.has(statut.toLowerCase());
}

export function noteAccountUse(accountId: string, rateLimit: { status: string; resetsAt?: number; type?: string }): void {
  const quota = quotaCache.get(accountId);
  if (!quota) return;
  // Un avertissement (« allowed_warning ») dit qu'on approche de la limite,
  // pas qu'on l'a atteinte : le compte reste utilisable.
  if (limiteBloquante(rateLimit.status)) {
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
