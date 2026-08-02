import crypto from 'node:crypto';
import fs from 'node:fs';
import { getDb, getMeta, setMeta } from './db.js';
import { PATHS, CONFIG } from './config.js';
import { log } from './logger.js';

/**
 * Le mur d'accès (PLAN §32) : identifiant peu devinable, mot de passe long tiré
 * au hasard, conservé sous forme illisible (scrypt), tentatives limitées,
 * session qui expire.
 */

const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

export function secretKey(): Buffer {
  if (!fs.existsSync(PATHS.secret)) {
    fs.writeFileSync(PATHS.secret, crypto.randomBytes(48), { mode: 0o600 });
  }
  return fs.readFileSync(PATHS.secret);
}

function hashPassword(password: string, salt: Buffer): string {
  return crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}

export interface Credentials {
  username: string;
  password: string;
}

/** Génère un identifiant sans rapport avec l'utilisateur ni le projet. */
function makeUsername(): string {
  const words = ['orbite', 'basalte', 'cyprès', 'nickel', 'quartz', 'silex', 'zircon', 'obsidienne'];
  const word = words[crypto.randomInt(words.length)];
  return `${word}-${crypto.randomInt(1000, 9999)}`;
}

function makePassword(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 28; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out.replace(/(.{7})(?=.)/g, '$1-');
}

/** Crée le compte au premier démarrage et rend les identifiants UNE seule fois. */
export function ensureCredentials(): Credentials | null {
  if (getMeta('auth.user')) return null;
  const username = process.env.HAIKODEV_USER || makeUsername();
  const password = process.env.HAIKODEV_PASSWORD || makePassword();
  setCredentials(username, password);
  log.info(`compte d'accès créé : ${username}`);
  return { username, password };
}

export function setCredentials(username: string, password: string): void {
  const salt = crypto.randomBytes(16);
  setMeta('auth.user', username);
  setMeta('auth.salt', salt.toString('hex'));
  setMeta('auth.hash', hashPassword(password, salt));
  // Un changement de mot de passe invalide les sessions ouvertes.
  getDb().prepare('DELETE FROM sessions').run();
}

export function currentUsername(): string | null {
  return getMeta('auth.user');
}

function tooManyAttempts(ip: string): boolean {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM auth_attempts WHERE ip = ? AND ok = 0 AND at > ?')
    .get(ip, Date.now() - ATTEMPT_WINDOW_MS) as { n: number };
  return row.n >= MAX_ATTEMPTS;
}

function noteAttempt(ip: string, ok: boolean): void {
  getDb().prepare('INSERT INTO auth_attempts (ip, at, ok) VALUES (?, ?, ?)').run(ip, Date.now(), ok ? 1 : 0);
  getDb().prepare('DELETE FROM auth_attempts WHERE at < ?').run(Date.now() - 24 * 3600 * 1000);
}

export interface LoginResult {
  ok: boolean;
  token?: string;
  expiresAt?: number;
  error?: string;
}

export function login(username: string, password: string, ip: string): LoginResult {
  if (tooManyAttempts(ip)) {
    return { ok: false, error: 'Trop de tentatives. Réessayez dans quelques minutes.' };
  }
  const user = getMeta('auth.user');
  const saltHex = getMeta('auth.salt');
  const hash = getMeta('auth.hash');
  if (!user || !saltHex || !hash) return { ok: false, error: "Aucun compte n'est configuré." };

  const candidate = hashPassword(password, Buffer.from(saltHex, 'hex'));
  const okUser = crypto.timingSafeEqual(
    Buffer.from(user.padEnd(64).slice(0, 64)),
    Buffer.from(username.padEnd(64).slice(0, 64)),
  );
  const okPass =
    candidate.length === hash.length && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));

  if (!okUser || !okPass) {
    noteAttempt(ip, false);
    return { ok: false, error: 'Identifiant ou mot de passe incorrect.' };
  }
  noteAttempt(ip, true);

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + CONFIG.sessionDays * 24 * 3600 * 1000;
  getDb()
    .prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)')
    .run(sha(token), Date.now(), expiresAt, ip);
  return { ok: true, token, expiresAt };
}

function sha(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function checkSession(token: string | undefined): boolean {
  if (!token) return false;
  const row = getDb().prepare('SELECT expires_at FROM sessions WHERE token = ?').get(sha(token)) as
    | { expires_at: number }
    | undefined;
  if (!row) return false;
  if (row.expires_at < Date.now()) {
    getDb().prepare('DELETE FROM sessions WHERE token = ?').run(sha(token));
    return false;
  }
  return true;
}

export function logout(token: string | undefined): void {
  if (token) getDb().prepare('DELETE FROM sessions WHERE token = ?').run(sha(token));
}

/** Jeton interne : sert au pont d'outils des agents, jamais exposé au navigateur. */
let internalToken: string | null = null;
export function getInternalToken(): string {
  if (!internalToken) {
    internalToken = getMeta('internal.token') ?? crypto.randomBytes(24).toString('hex');
    setMeta('internal.token', internalToken);
  }
  return internalToken;
}

/** Jetons de téléchargement à usage limité dans le temps (PLAN §18). */
const downloadTokens = new Map<string, { path: string; expiresAt: number; name: string }>();

export function mintDownload(filePath: string, name: string, ttlMs = 24 * 3600 * 1000): string {
  const token = crypto.randomBytes(18).toString('base64url');
  downloadTokens.set(token, { path: filePath, name, expiresAt: Date.now() + ttlMs });
  return token;
}

export function resolveDownload(token: string): { path: string; name: string } | null {
  const entry = downloadTokens.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    downloadTokens.delete(token);
    return null;
  }
  return { path: entry.path, name: entry.name };
}
