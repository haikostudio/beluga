#!/usr/bin/env node
/**
 * L'ASSISTANT VOCAL RÉPOND VITE ET DANS L'ORDRE (carte « Assistant vocal rapide et apps Beluga », 16/11/2026).
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-voix-rapide.mjs
 *   VERIF_CAPTURES=/chemin …   # garde la capture du fil
 *
 * Référence AVANT (rollout réel du 16/11/2026 07:14, DISC-0001) : « les dernières tâches » → ~64 s, 8 appels
 * (update_plan, fouille des outils, résumé projet par projet, boucle sur ~20 projets) ; « les cinq tâches
 * d'hier » → 5 appels dont `rg` sur les données, jamais de réponse.
 *
 * Démon d'essai à base neuve (port à soi), un compte Codex recopié de la base servie (lecture seule) : la vraie
 * session vocale passe par l'ABONNEMENT. Le décor pose six tâches terminées « hier » (heure de Paris) dans deux
 * projets, archivées comprises, plus du bruit d'avant-hier et d'aujourd'hui. Une phrase dite par la voix du
 * serveur (Piper) tient lieu de micro.
 *
 * Contrôles : la réponse arrive ; elle cite les cinq plus récentes d'hier dans l'ordre de fin ; le tour délégué
 * n'a fait qu'un ou deux appels d'outil, aucun update_plan, aucune fouille d'outils, aucune commande ; il a
 * réfléchi au niveau léger (`turn_context.effort` = low dans le rollout) ; le délai est mesuré.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7237);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const DEPOT_PRINCIPAL = path.resolve(execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: RACINE, encoding: 'utf8' }).trim(), '..');
const BASE_SERVIE = process.env.BELUGA_BASE_SERVIE || path.join(DEPOT_PRINCIPAL, 'data', 'beluga.db');

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-voix-rapide-', port: PORT, signaux: true });
const jeton = crypto.randomBytes(32).toString('hex');
const T = Date.now();

/** Minuit d'hier à Paris, en ms : le décor parle le même fuseau que le produit. */
function minuitDHierAParis() {
  const jour = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(T - 86_400_000));
  for (const decalage of [1, 2]) {
    const essai = Date.parse(`${jour}T00:00:00Z`) - decalage * 3_600_000;
    const vu = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }).format(new Date(essai));
    if (vu === '00') return essai;
  }
  return Date.parse(`${jour}T00:00:00Z`) - 3_600_000;
}

const HIER = minuitDHierAParis();
const H = 3_600_000;
/* Six tâches d'hier (la plus récente d'abord), et du bruit autour. */
const TACHES_D_HIER = [
  ['Relances automatiques des factures', 'p-facturo', 22.5 * H, 'archived'],
  ['Export comptable mensuel', 'p-facturo', 19 * H, 'to_deploy'],
  ['Page panier sur téléphone', 'p-boutique', 16.25 * H, 'archived'],
  ['Codes promo à date limite', 'p-boutique', 11 * H, 'archived'],
  ['Courriel de bienvenue', 'p-boutique', 9.5 * H, 'archived'],
  ['Sauvegarde des photos produits', 'p-boutique', 0.25 * H, 'archived'],
];
const BRUIT = [
  ['Ménage de la veille au soir', 'p-boutique', -1 * H, 'archived'],
  ['Correctif de ce matin', 'p-facturo', 24.5 * H, 'archived'],
];

function poserLeDecor() {
  for (const piece of [['venv'], ['models', 'piper']]) {
    const source = path.join(DEPOT_PRINCIPAL, 'data', ...piece);
    const cible = path.join(DATA, ...piece);
    if (fs.existsSync(source) && !fs.existsSync(cible)) {
      fs.mkdirSync(path.dirname(cible), { recursive: true });
      fs.symlinkSync(source, cible);
    }
  }
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai');
  const autre = path.join(path.dirname(DEPOT), 'facturo');
  fs.mkdirSync(autre, { recursive: true });
  for (const [id, name, chemin, rang] of [['p-boutique', 'Boutique', DEPOT, 1], ['p-facturo', 'Facturo', autre, 2]]) {
    const p = { id, name, path: chemin, defaultEngine: 'claude', isSelf: false, rank: rang, archived: false, createdAt: T, updatedAt: T };
    db.prepare('INSERT OR REPLACE INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(id, name, chemin, JSON.stringify(p), T, T);
  }
  let rang = 1;
  for (const [titre, projet, apres, colonne] of [...TACHES_D_HIER, ...BRUIT]) {
    const id = crypto.randomUUID();
    const doneAt = Math.round(HIER + apres);
    const carte = { id, projectId: projet, title: titre, column: colonne, position: rang++, run: { engine: 'claude', thinking: 'none', mode: 'direct' }, createdAt: doneAt - H, updatedAt: doneAt, doneAt };
    db.prepare(
      'INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description, origin, done_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, projet, colonne, carte.position, titre, JSON.stringify(carte), carte.createdAt, doneAt, '', 'user', doneAt);
  }
  const pref = db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)');
  pref.run('voix.visible', JSON.stringify(true), T);
  pref.run('theme', JSON.stringify('sombre'), T);
  const servie = new Database(BASE_SERVIE, { readonly: true });
  const compte = servie.prepare("SELECT * FROM accounts WHERE json_extract(data, '$.engine') = 'codex' AND coalesce(json_extract(data, '$.disabled'), 0) = 0 ORDER BY id LIMIT 1").get();
  servie.close();
  if (!compte) throw new Error('aucun compte Codex dans la base servie');
  const colonnes = Object.keys(compte);
  db.prepare(`INSERT OR REPLACE INTO accounts (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`).run(...colonnes.map((c) => compte[c]));
  db.close();
  return JSON.parse(compte.data ?? '{}');
}

function phraseParlee() {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-voix-rapide-phrase-'));
  const brut = path.join(dossier, 'brut.wav');
  const sortie = path.join(dossier, 'phrase.wav');
  const venv = path.join(DEPOT_PRINCIPAL, 'data', 'venv', 'bin', 'python');
  const modele = path.join(DEPOT_PRINCIPAL, 'data', 'models', 'piper', 'fr_FR-siwis-medium.onnx');
  execFileSync(venv, ['-m', 'piper', '-m', modele, '-f', brut], { input: 'Donne-moi les cinq dernières tâches terminées hier, de la plus récente à la plus ancienne.' });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', brut, '-af', 'adelay=1500|1500,apad=pad_dur=90', '-ar', '48000', '-ac', '1', sortie]);
  return sortie;
}

/** Le rollout Codex du fil : cherché dans les dossiers où Codex écrit ses sessions. */
function trouverLeRollout(threadId) {
  const dossiers = [path.join(DEPOT_PRINCIPAL, 'data', 'accounts'), path.join(os.homedir(), '.codex', 'sessions'), path.join(os.homedir(), '.beluga', 'maisons-codex'), DATA];
  for (const d of dossiers) {
    if (!fs.existsSync(d)) continue;
    try {
      const sortie = execFileSync('find', [d, '-name', `rollout-*${threadId}*.jsonl`, '-newermt', new Date(T - 60_000).toISOString()], { encoding: 'utf8', timeout: 30_000 });
      const premier = sortie.split('\n').find(Boolean);
      if (premier) return premier;
    } catch {
      /* dossier suivant */
    }
  }
  return null;
}

function lireLeRollout(fichier) {
  const appels = [];
  const efforts = new Set();
  for (const ligne of fs.readFileSync(fichier, 'utf8').split('\n')) {
    if (!ligne.trim()) continue;
    let e;
    try {
      e = JSON.parse(ligne);
    } catch {
      continue;
    }
    const p = e.payload ?? {};
    if (e.type === 'turn_context' && p.effort) efforts.add(p.effort);
    if (e.type === 'turn_context' && p.reasoning_effort) efforts.add(p.reasoning_effort);
    if (e.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call')) {
      appels.push({ nom: p.name, args: String(p.arguments ?? p.input ?? '').slice(0, 400) });
    }
  }
  return { appels, efforts: [...efforts] };
}

try {
  if (!(await attendrePort())) throw new Error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  poserLeDecor();
  const fauxMicro = phraseParlee();
  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--use-file-for-fake-audio-capture=${fauxMicro}`],
  });
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE }]);
  const page = await contexte.newPage();
  page.on('pageerror', (e) => console.log(`    (erreur de page) ${e.message}`));
  await page.goto(`${BASE}/#en-route`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  /* Le bouton du bord ouvre le volet ; son bouton du micro lance la conversation (carte « Jarvis : volet, voix et
     rapidité », 16/11/2026). */
  const rond = page.locator('[data-bouton-du-bord]');
  await rond.waitFor({ state: 'visible', timeout: 20_000 });
  for (let i = 0; i < 3 && !(await page.$('[data-module-voix][data-conversation]')); i++) {
    /* La voix ne s'ouvre plus d'un bouton du champ (18/11/2026) : l'événement du raccourci. */ await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:parler-a-jarvis', { detail: { agentId: null } })));
    await page.waitForTimeout(800);
  }
  const enDirect = await page.locator('[data-module-voix][data-etat-direct="ecoute"]').waitFor({ state: 'attached', timeout: 70_000 }).then(() => true, () => false);
  verifier('le direct s’ouvre', enDirect);
  if (!enDirect) {
    console.log(`    module : ${(await page.locator('[data-module-voix]').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)}`);
    console.log(`    démon :\n${journal.join('').split('\n').filter((l) => /voix|direct|codex|WARN|ERROR/i.test(l)).slice(-25).join('\n')}`);
  }
  const dite = await page.locator('[data-tour-fil][data-role="user"][data-tour-final]').first().waitFor({ timeout: 45_000 }).then(() => true, () => false);
  const tDite = Date.now();
  verifier('la question est entendue', dite, dite ? await page.locator('[data-tour-fil][data-role="user"]').first().textContent() : '');
  /* La réponse utile : celle qui cite au moins une tâche d'hier (le « Je regarde. » d'avant ne compte pas). */
  const titres = TACHES_D_HIER.map(([t]) => t);
  let reponse = '';
  let tReponse = 0;
  for (let i = 0; i < 240 && !tReponse; i++) {
    const textes = await page.locator('[data-tour-fil][data-role="assistant"][data-tour-final]').allTextContents();
    const utile = textes.find((t) => /relances|export comptable|panier|codes promo|bienvenue/i.test(t));
    if (utile) {
      reponse = utile;
      tReponse = Date.now();
    } else await page.waitForTimeout(500);
  }
  const delai = tReponse ? Math.round((tReponse - tDite) / 100) / 10 : null;
  verifier('la réponse arrive, avec les tâches d’hier', !!tReponse, reponse.slice(0, 400));
  console.log(`  délai question → réponse utile : ${delai ?? '—'} s (avant : ~64 s, ou jamais)`);
  verifier('le délai est sous 30 s', delai !== null && delai < 30, `${delai} s`);
  const textesAssistant = await page.locator('[data-tour-fil][data-role="assistant"][data-tour-final]').allTextContents();
  console.log(`  messages de l’assistant : ${textesAssistant.length} — ${JSON.stringify(textesAssistant).slice(0, 600)}`);
  /* L'ordre : les cinq plus récentes, dans l'ordre de fin, la sixième absente. */
  const bas = reponse.toLowerCase();
  /* Un mot propre à chaque tâche : la voix reformule (« panier sur téléphone » pour « Page panier sur téléphone »). */
  const MOTS = ['relances', 'export comptable', 'panier', 'codes promo', 'bienvenue'];
  const positions = MOTS.map((m) => bas.indexOf(m));
  verifier('la sixième (la plus ancienne d’hier) n’est pas citée', !bas.includes('photos produits'));
  verifier('les cinq plus récentes sont citées, dans l’ordre', positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1])), JSON.stringify(positions));
  if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'voix-rapide.png') });
  await page.locator('[data-jarvis-raccrocher]').click();
  await page.waitForTimeout(3000);

  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const disc = db.prepare('SELECT thread_id FROM discussions_vocales ORDER BY id DESC LIMIT 1').get();
  db.close();
  const rollout = disc?.thread_id ? trouverLeRollout(disc.thread_id) : null;
  verifier('le rollout du fil est retrouvé', !!rollout, rollout ?? disc?.thread_id ?? '');
  if (rollout) {
    const { appels, efforts } = lireLeRollout(rollout);
    console.log(`  appels d’outil : ${appels.length} — ${appels.map((a) => `${a.nom}(${a.args.replace(/\s+/g, ' ').slice(0, 120)})`).join(' | ')}`);
    const brut = appels.map((a) => `${a.nom} ${a.args}`).join('\n');
    verifier('un ou deux appels d’outil au plus', appels.length >= 1 && appels.length <= 2, String(appels.length));
    verifier('aucun update_plan', !/update_plan/.test(brut));
    verifier('aucune fouille des outils', !/ALL_TOOLS|list_tools|tools\.filter/i.test(brut));
    verifier('aucune commande shell', !/\b(rg|grep|sqlite3?|find)\s/.test(brut) && !appels.some((a) => /^(shell|exec_command|local_shell)$/.test(a.nom ?? '')));
    verifier('assistant_resume appelé avec le jour', /assistant_resume/.test(brut) && /hier|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}/.test(brut), brut.slice(0, 200));
    verifier('réflexion légère sur le fil (turn_context.effort = low)', efforts.length > 0 && efforts.every((e) => e === 'low'), efforts.join(', '));
  }
  await navigateur.close();
} catch (err) {
  console.error(err);
  resultats.push(false);
} finally {
  nettoyer();
}

const ok = resultats.filter(Boolean).length;
console.log(`\n${ok}/${resultats.length} contrôles au vert`);
process.exit(ok === resultats.length ? 0 : 1);
