#!/usr/bin/env node
/**
 * Définit (ou redéfinit) les identifiants d'accès à Beluga Build.
 * Usage : node scripts/set-credentials.mjs [identifiant] [mot de passe]
 * Sans argument, les deux sont tirés au hasard et affichés une seule fois.
 */
import { openDb, setMeta } from '../server/dist/db.js';
import crypto from 'node:crypto';

const WORDS = ['orbite', 'basalte', 'cypres', 'nickel', 'quartz', 'silex', 'zircon', 'obsidienne'];

function makeUsername() {
  return `${WORDS[crypto.randomInt(WORDS.length)]}-${crypto.randomInt(1000, 9999)}`;
}

function makePassword() {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 28; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out.replace(/(.{7})(?=.)/g, '$1-');
}

const username = process.argv[2] || makeUsername();
const password = process.argv[3] || makePassword();

const db = openDb();
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');

setMeta('auth.user', username);
setMeta('auth.salt', salt.toString('hex'));
setMeta('auth.hash', hash);
db.prepare('DELETE FROM sessions').run();

console.log(JSON.stringify({ username, password }, null, 2));
