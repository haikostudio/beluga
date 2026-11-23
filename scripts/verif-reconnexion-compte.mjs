#!/usr/bin/env node
/**
 * RECONNECTER UN COMPTE SE LIT EN TROIS TEMPS, dans un vrai navigateur.
 *
 *   1. dès que le code est envoyé : un chargement, et plus aucune pastille ni
 *      aucun bouton sur la ligne du compte ;
 *   2. puis le résultat, seul : « Connexion échouée » avec sa raison, ou
 *      « Connexion réussie » ;
 *   3. puis la ligne habituelle revient, pastilles relues — une reconnexion
 *      réussie n'affiche plus « session expirée ».
 *
 *   node scripts/verif-reconnexion-compte.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et un
 * HOME à lui. La commande `claude` y est un FAUX moteur posé dans le PATH du
 * démon d'essai : il affiche l'invite de connexion, accepte le code
 * « BON-CODE » et refuse tout autre. Aucun compte réel n'est lu ni touché.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7219);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-reconnexion-'));
const SHOTS = path.join(RACINE, 'data', 'verification');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const HOME = path.join(TMP, 'home');
const BIN = path.join(TMP, 'bin');
const COFFRE = path.join(TMP, 'coffre-claude');
fs.mkdirSync(BIN, { recursive: true });
fs.mkdirSync(COFFRE, { recursive: true });

/* Le faux moteur : l'invite de `claude auth login`, un code lu, trois secondes
   d'échange, puis réussite (coffre rempli) ou refus. */
fs.writeFileSync(
  path.join(BIN, 'claude'),
  `#!/bin/bash
if [ "$1" = "--version" ]; then echo "2.1.270 (Claude Code)"; exit 0; fi
if [ "$1" = "auth" ]; then
  echo "Opening browser to sign in…"
  echo "If the browser didn’t open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=essai&state=essai"
  printf "Paste code here if prompted > "
  read code
  sleep 3
  if [ "$code" = "BON-CODE" ]; then
    echo '{"claudeAiOauth":{"accessToken":"essai","refreshToken":"essai","expiresAt":9999999999999,"refreshTokenExpiresAt":9999999999999}}' > "$CLAUDE_CONFIG_DIR/.credentials.json"
    echo "Login successful."
    exit 0
  fi
  echo "OAuth error: Invalid code"
  exit 1
fi
exit 1
`,
  { mode: 0o755 },
);
/* Un coffre VIDÉ : le compte a servi, sa session est tombée. */
fs.writeFileSync(path.join(COFFRE, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: '', refreshToken: '' } }));

const { DATA, journal, attendrePort } = demarrerDemonDEssai({
  tmp: TMP,
  port: PORT,
  dossiers: [HOME],
  env: { HOME, PATH: `${BIN}:${process.env.PATH}` },
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now() - 60_000;
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3600_000,
    'vérification reconnexion de compte',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  for (const table of ['proposals', 'messages', 'agents', 'cards', 'projects', 'accounts']) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  const compte = { id: 'claude-essai', engine: 'claude', label: 'Claude — essai', priority: 10, configDir: COFFRE };
  db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    compte.id,
    compte.engine,
    JSON.stringify(compte),
    t,
  );
  db.close();
}

/** Attendre qu'une condition lue dans la page devienne vraie. */
async function attendre(page, lire, limiteMs) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (await lire().catch(() => false)) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

fs.mkdirSync(SHOTS, { recursive: true });
if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}
poserLeDecor();

const navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
});
const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
const page = await contexte.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);

/* Vers Réglages › Comptes (l'assistant de démarrage barre l'écran sans moteur en ligne). */
if ((await page.locator('[data-assistant-moteurs="1"]').count()) > 0) {
  await page.locator('[data-assistant-reglages="1"]').first().click();
} else {
  await page.getByRole('button', { name: 'Menu' }).first().click();
  await page.locator('[data-reglages-menu]').first().click();
}
// Les réglages sont une page à menu : la fiche « Comptes » s'ouvre par son entrée.
await page.locator('[data-page-menu="comptes"]').first().click({ timeout: 30000 });

const ligne = page.locator('[data-ligne-compte="claude-essai"]');
/* Le compte d'essai est posé APRÈS le démarrage du démon : on fait relire les
   quotas pour qu'il entre dans la liste, au lieu d'attendre le relevé suivant. */
await page.locator('[data-relire-quotas]').first().click({ timeout: 30000 });
if (!(await attendre(page, async () => (await ligne.count()) > 0, 30_000))) {
  const vues = await page.locator('[data-ligne-compte]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ligne-compte')));
  console.log(`lignes de compte affichées : ${vues.join(', ') || 'aucune'}`);
}
const phase = () => ligne.getAttribute('data-phase-connexion');
const actions = () => ligne.locator('[data-actions-compte]').count();

noter(
  'le compte au coffre vidé annonce « session expirée »',
  await attendre(page, async () => /session expirée/.test((await ligne.textContent()) ?? ''), 20_000),
);

async function reconnecterAvec(code) {
  await ligne.locator('[data-reconnecter-compte="claude-essai"]').click();
  const champ = ligne.getByPlaceholder('Collez ici le code rendu par la page');
  if (!(await attendre(page, async () => (await champ.count()) > 0, 20_000))) return false;
  noter(`[${code}] pendant la saisie, la ligne garde ses pastilles`, (await phase()) === 'saisie' && (await actions()) > 0);
  await champ.fill(code);
  await ligne.getByRole('button', { name: /Valider/ }).click();
  return true;
}

async function suivreJusquAuResultat(code, etapeAttendue, texteAttendu) {
  const enValidation = await attendre(page, async () => (await phase()) === 'validation', 5_000);
  noter(
    `[${code}] code envoyé : chargement, sans pastille ni bouton`,
    enValidation && (await actions()) === 0 && (await ligne.locator('[data-connexion-validation]').count()) === 1,
  );
  await page.screenshot({ path: path.join(SHOTS, `reconnexion-${code}-chargement.png`) });

  const resultat = await attendre(page, async () => (await phase()) === 'resultat', 40_000);
  const fin = ligne.locator(`[data-connexion-fin="${etapeAttendue}"]`);
  const texte = (await fin.count()) ? ((await fin.textContent()) ?? '') : '';
  noter(
    `[${code}] le résultat s'affiche seul`,
    resultat && texteAttendu.test(texte) && (await actions()) === 0,
    texte || 'aucun résultat',
  );
  await page.screenshot({ path: path.join(SHOTS, `reconnexion-${code}-resultat.png`) });

  const retour = await attendre(page, async () => (await phase()) === 'aucune', 15_000);
  noter(`[${code}] puis les pastilles et les boutons reviennent`, retour && (await actions()) > 0);
}

if (await reconnecterAvec('MAUVAIS-CODE')) {
  await suivreJusquAuResultat('MAUVAIS-CODE', 'echec', /Connexion échouée.*Invalid code/);
} else noter('le champ du code apparaît après « Reconnecter »', false);

if (await reconnecterAvec('BON-CODE')) {
  await suivreJusquAuResultat('BON-CODE', 'reussie', /Connexion réussie/);
  const texteLigne = (await ligne.textContent()) ?? '';
  noter('après une reconnexion réussie, plus de « session expirée »', !/session expirée/.test(texteLigne), texteLigne.slice(0, 160));
  await page.screenshot({ path: path.join(SHOTS, 'reconnexion-apres.png') });
} else noter('le champ du code réapparaît pour une seconde tentative', false);

await navigateur.close();
console.log(`\n${resultats.filter((r) => r.ok).length}/${resultats.length} contrôles passés`);
process.exit(resultats.every((r) => r.ok) ? 0 : 1);
