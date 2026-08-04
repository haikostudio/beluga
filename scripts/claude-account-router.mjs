#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Le dossier de réglages est celui de l'utilisateur qui LANCE le routeur, jamais
// un nom d'utilisateur écrit en dur : le même fichier, sans dépendre d'un compte.
const CONFIG_FILE =
  process.env.CLAUDE_ACCOUNT_POOL_CONFIG ||
  path.join(os.homedir(), '.config', 'claude-account-pool.json');
const OAUTH_BETA = 'oauth-2025-04-20';
const CACHE_MAX_AGE_MS = 60_000;
const STALE_CACHE_MAX_AGE_MS = 60 * 60_000;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function argumentValue(name) {
  const index = process.argv.indexOf(name, 2);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function safeSessionId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

function credentialFile(account) {
  return path.join(account.configDir, '.credentials.json');
}

function hasCredentials(account) {
  const credentials = readJson(credentialFile(account));
  return typeof credentials?.claudeAiOauth?.accessToken === 'string';
}

function cacheFile(config, account) {
  return path.join(config.stateDir, 'quota', `${account.id}.json`);
}

function scopedLimitApplies(limit, requestedModel) {
  if (!requestedModel) return false;
  const model = `${limit?.scope?.model?.id || ''} ${limit?.scope?.model?.display_name || ''}`.toLowerCase();
  if (!model.trim()) return false;
  const requested = requestedModel.toLowerCase();
  if (requested.includes('opus')) return model.includes('opus');
  if (requested.includes('sonnet')) return model.includes('sonnet');
  if (requested.includes('haiku')) return model.includes('haiku');
  return false;
}

function quotaAvailable(data, requestedModel) {
  const percentages = [data?.five_hour?.utilization, data?.seven_day?.utilization];
  if (requestedModel?.toLowerCase().includes('opus')) {
    percentages.push(data?.seven_day_opus?.utilization);
  }
  for (const limit of Array.isArray(data?.limits) ? data.limits : []) {
    if (scopedLimitApplies(limit, requestedModel)) percentages.push(limit?.percent);
  }
  return !percentages.some((value) => typeof value === 'number' && value >= 100);
}

async function fetchAvailability(config, account, requestedModel) {
  if (!hasCredentials(account)) return false;
  const cachePath = cacheFile(config, account);
  const cached = readJson(cachePath);
  if (cached && Date.now() - cached.at < CACHE_MAX_AGE_MS) return cached.available !== false;

  const credentials = readJson(credentialFile(account));
  const token = credentials?.claudeAiOauth?.accessToken;
  try {
    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        authorization: `Bearer ${token}`,
        'anthropic-beta': OAUTH_BETA,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`usage endpoint returned ${response.status}`);
    const available = quotaAvailable(await response.json(), requestedModel);
    writeJsonAtomic(cachePath, { at: Date.now(), available });
    return available;
  } catch {
    if (cached && Date.now() - cached.at < STALE_CACHE_MAX_AGE_MS) return cached.available !== false;
    return true;
  }
}

function mappingFile(config, sessionId) {
  return path.join(config.stateDir, 'sessions', `${sessionId}.json`);
}

function accountById(config, id) {
  return config.accounts.find((account) => account.id === id) || null;
}

function mappedAccount(config, sessionId) {
  const mapping = sessionId ? readJson(mappingFile(config, sessionId)) : null;
  return mapping ? accountById(config, mapping.accountId) : null;
}

function rememberAccount(config, sessionId, account) {
  if (!sessionId) return;
  writeJsonAtomic(mappingFile(config, sessionId), { accountId: account.id, at: Date.now() });
}

async function chooseAccount(config) {
  const forced = process.env.CLAUDE_ACCOUNT_ID;
  if (forced) {
    const account = accountById(config, forced);
    if (account && hasCredentials(account)) return account;
  }

  const resumeId = safeSessionId(argumentValue('--resume'));
  const newSessionId = safeSessionId(argumentValue('--session-id'));
  const sessionId = resumeId || newSessionId;
  const existing = mappedAccount(config, resumeId || newSessionId);
  const requestedModel = argumentValue('--model');
  if (existing && (await fetchAvailability(config, existing, requestedModel))) return existing;

  const accounts = [...config.accounts].sort((left, right) => left.priority - right.priority);
  for (const account of accounts) {
    if (await fetchAvailability(config, account, requestedModel)) {
      rememberAccount(config, sessionId, account);
      return account;
    }
  }
  return accounts.find(hasCredentials) || accounts[0];
}

function appendSelectionLog(config, account) {
  try {
    fs.mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(
      path.join(config.stateDir, 'selections.log'),
      `${new Date().toISOString()} account=${account.id} args=${process.argv.slice(2, 5).join(' ')}\n`,
      { mode: 0o600 },
    );
  } catch {
    // Selection must still work if diagnostics cannot be written.
  }
}

const config = readJson(CONFIG_FILE);
if (!config || !Array.isArray(config.accounts) || !config.accounts.length) {
  process.stderr.write(`Invalid Claude account pool configuration: ${CONFIG_FILE}\n`);
  process.exit(2);
}

const account = await chooseAccount(config);
if (!account) {
  process.stderr.write('No Claude account is configured.\n');
  process.exit(2);
}

appendSelectionLog(config, account);
process.env.CLAUDE_CONFIG_DIR = account.configDir;
process.env.CLAUDE_ACCOUNT_ID = account.id;

const executable = config.executable || '/usr/local/bin/claude';
const { spawn } = await import('node:child_process');
const child = spawn(executable, process.argv.slice(2), {
  env: process.env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}

const exitCode = await new Promise((resolve) => {
  child.once('error', (error) => {
    process.stderr.write(`${error.message}\n`);
    resolve(1);
  });
  child.once('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    resolve(code ?? 1);
  });
});
process.exit(exitCode);
