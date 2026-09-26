import crypto from 'node:crypto';
import fs from 'node:fs';
import { decisionDuMur, MUR_FENETRE_MS, type CompteUtilisateur, type RoleCompte } from '@beluga/shared';
import {
  compteParId,
  compteParIdentifiant,
  creerCompte,
  listerComptes,
  noterEntree,
  nombreDAdministrateurs,
  secretDuCompte,
} from './comptes.js';
import { getDb, getMeta, setMeta } from './db.js';
import { PATHS, CONFIG } from './config.js';
import { log } from './logger.js';

/**
 * Le mur d'accès (PLAN §32) : identifiant peu devinable, mot de passe long tiré
 * au hasard, conservé sous forme illisible (scrypt), tentatives limitées,
 * session qui expire. Le nombre d'essais et le délai entre essais vivent dans
 * la règle pure `decisionDuMur` (shared/src/mur-acces.ts).
 */

function hashPassword(password: string, salt: Buffer): string {
  return crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}

export interface Credentials {
  username: string;
  password: string;
}

/**
 * Génère un identifiant sans rapport avec l'utilisateur ni le projet.
 *
 * SANS ACCENT, ET C'EST UNE RÈGLE, PAS UN GOÛT : un identifiant se tape à la
 * main, parfois sur un clavier étranger, et `jugerIdentifiant` les refuse. Le
 * mot « cyprès » figurait ici : tiré au premier démarrage, il faisait ÉCHOUER
 * la création du compte, donc le démarrage entier.
 */
function makeUsername(): string {
  const words = ['orbite', 'basalte', 'cypres', 'nickel', 'quartz', 'silex', 'zircon', 'obsidienne'];
  const word = words[crypto.randomInt(words.length)];
  return `${word}-${crypto.randomInt(1000, 9999)}`;
}

function makePassword(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 28; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out.replace(/(.{7})(?=.)/g, '$1-');
}

/**
 * Crée le PREMIER ADMINISTRATEUR au premier démarrage et rend ses identifiants
 * UNE seule fois. Sur une base qui vient de l'ancien mur à compte unique, la
 * migration 51 a déjà reporté ce compte : il n'y a alors rien à créer.
 */
export function ensureCredentials(): Credentials | null {
  if (nombreDAdministrateurs() > 0) return null;
  const username = process.env.BELUGA_USER || makeUsername();
  const password = process.env.BELUGA_PASSWORD || makePassword();
  creerCompte({ identifiant: username, role: 'admin', nomAffiche: 'Haiko', motDePasse: password }, []);
  log.info(`compte d'accès créé : ${username}`);
  return { username, password };
}

export function currentUsername(): string | null {
  const premier = listerComptes().find((c) => c.role === 'admin');
  return premier?.identifiant ?? getMeta('auth.user');
}

/** Horodatages des essais RATÉS récents d'une adresse, dans la fenêtre de comptage. */
function essaisRates(ip: string): number[] {
  const rows = getDb()
    .prepare('SELECT at FROM auth_attempts WHERE ip = ? AND ok = 0 AND at > ?')
    .all(ip, Date.now() - MUR_FENETRE_MS) as { at: number }[];
  return rows.map((r) => r.at);
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
  /** Le rôle du compte entré : c'est lui qui décide de la porte servie. */
  role?: RoleCompte;
  userId?: string;
}

export function login(username: string, password: string, ip: string): LoginResult {
  const decision = decisionDuMur(essaisRates(ip), Date.now());
  if (!decision.autorise) {
    return { ok: false, error: decision.message };
  }

  /*
   * LE COMPTE SE CHERCHE DANS `users`, PLUS DANS `meta`. L'ancien chemin reste
   * lu EN SECOURS : une base qui n'aurait pas encore joué la migration 51
   * ouvre encore sa porte, au lieu de mettre son propriétaire dehors.
   */
  const compte = compteParIdentifiant(username);
  const secret = compte ? secretDuCompte(compte.id) : secretDeSecours(username);

  if (!compte && !secret) {
    noteAttempt(ip, false);
    return { ok: false, error: 'Identifiant ou mot de passe incorrect.' };
  }
  if (compte && !compte.actif) {
    noteAttempt(ip, false);
    // On ne dit pas « ce compte est suspendu » : cela confirmerait qu'il existe.
    return { ok: false, error: 'Identifiant ou mot de passe incorrect.' };
  }
  if (!secret) {
    noteAttempt(ip, false);
    return { ok: false, error: 'Identifiant ou mot de passe incorrect.' };
  }

  const candidate = hashPassword(password, Buffer.from(secret.salt, 'hex'));
  const okPass =
    candidate.length === secret.hash.length &&
    crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(secret.hash));

  if (!okPass) {
    noteAttempt(ip, false);
    return { ok: false, error: 'Identifiant ou mot de passe incorrect.' };
  }
  noteAttempt(ip, true);

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + CONFIG.sessionDays * 24 * 3600 * 1000;
  getDb()
    .prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)')
    .run(sha(token), Date.now(), expiresAt, ip, compte?.id ?? null);
  if (compte) noterEntree(compte.id);
  return { ok: true, token, expiresAt, role: compte?.role ?? 'admin', userId: compte?.id };
}

/** Le secret de l'ANCIEN mur à compte unique, lu en secours. */
function secretDeSecours(username: string): { salt: string; hash: string } | null {
  const user = getMeta('auth.user');
  const salt = getMeta('auth.salt');
  const hash = getMeta('auth.hash');
  if (!user || !salt || !hash) return null;
  if (user.toLowerCase() !== username.trim().toLowerCase()) return null;
  return { salt, hash };
}

function sha(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * UNE SESSION N'EST PLUS « OUVERTE OU FERMÉE », ELLE EST OUVERTE PAR QUELQU'UN.
 *
 * `checkSession` rend l'IDENTITÉ derrière le jeton — qui, quel rôle, quels
 * projets — ou `null`. Tout ce qui décide d'un droit part de là, jamais d'un
 * booléen : c'est ce qui rend le cloisonnement vérifiable au serveur.
 *
 * Une session dont le compte a été SUSPENDU tombe aussitôt, même si son jeton
 * n'a pas expiré : le compte est relu à chaque requête.
 */
export function checkSession(token: string | undefined): CompteUtilisateur | null {
  if (!token) return null;
  const row = getDb().prepare('SELECT expires_at, user_id FROM sessions WHERE token = ?').get(sha(token)) as
    | { expires_at: number; user_id: string | null }
    | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    getDb().prepare('DELETE FROM sessions WHERE token = ?').run(sha(token));
    return null;
  }

  if (row.user_id) {
    const compte = compteParId(row.user_id);
    if (!compte || !compte.actif) {
      getDb().prepare('DELETE FROM sessions WHERE token = ?').run(sha(token));
      return null;
    }
    return compte;
  }

  /*
   * Une session ouverte AVANT les comptes n'a pas d'identité écrite : elle
   * appartient au propriétaire de l'application, seul compte qui existait
   * alors. On la rattache au premier administrateur plutôt que de mettre
   * dehors quelqu'un qui n'a rien demandé.
   */
  const premier = listerComptes().find((c) => c.role === 'admin' && c.actif);
  if (premier) {
    getDb().prepare('UPDATE sessions SET user_id = ? WHERE token = ?').run(premier.id, sha(token));
    return premier;
  }
  return null;
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
