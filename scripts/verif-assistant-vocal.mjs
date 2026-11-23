#!/usr/bin/env node
/**
 * LE BLOC « ASSISTANT VOCAL » DE « VOTRE ASSISTANT » (17/11/2026, maquette #12ea), lu dans Réglages › Voix : le texte
 * qui dit qu'il faut un compte ChatGPT relié à Codex, l'interrupteur (la préférence `voix.active`), et la DICTÉE
 * proposée seulement quand la voix est éteinte — alors le champ d'écriture montre le micro à la place du bouton voix.
 * Sans jamais cliquer « Installer » (le démon lancerait le vrai installateur).
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL VERIF_CAPTURES=<dossier> node scripts/verif-assistant-vocal.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7253);
const PORT_WEB = Number(process.env.BELUGA_VERIF_PORT_WEB || 7154);
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-assistant-vocal-', port: PORT });
const jeton = crypto.randomBytes(32).toString('hex');
const vite = spawn('npm', ['run', 'dev', '--workspace', 'web', '--', '--port', String(PORT_WEB), '--strictPort'], {
  cwd: RACINE,
  env: { ...process.env, BELUGA_DEMON_PORT: String(PORT), NODE_ENV: 'development', BELUGA_URL: '', BELUGA_TOKEN: '' },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
vite.stdout.on('data', () => {});
vite.stderr.on('data', () => {});
process.on('exit', () => {
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
});
const base = () => new Database(path.join(DATA, 'beluga.db'));
function preference(cle, valeur) {
  const db = base();
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run(cle, JSON.stringify(valeur), Date.now());
  db.close();
}

async function principal() {
  if (!(await attendrePort())) throw new Error('le démon d’essai n’a pas démarré');
  {
    const db = base();
    const T = Date.now();
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai assistant vocal');
    db.close();
  }
  for (let i = 0; i < 90; i += 1) {
    if ((await fetch(BASE).then((r) => r.ok).catch(() => false))) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [appareil, clarte] of [['ordinateur', 'sombre'], ['ordinateur', 'clair'], ['telephone', 'sombre'], ['telephone', 'clair']]) {
      const telephone = appareil === 'telephone';
      preference('theme', clarte === 'clair' ? 'light' : 'dark');
      for (const voix of [true, false]) {
        preference('voix.active', voix);
        const contexte = await navigateur.newContext({ viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: telephone, hasTouch: telephone, serviceWorkers: 'block' });
        await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
        const page = await contexte.newPage();
        await page.goto(`${BASE}/#reglages/voix`, { waitUntil: 'domcontentloaded' });
        const bloc = page.locator('[data-assistant-vocal]').first();
        await bloc.waitFor({ timeout: 60_000 });
        await page.waitForTimeout(1500);
        await bloc.scrollIntoViewIfNeeded();
        const lu = await page.evaluate(() => ({
          texte: document.querySelector('[data-assistant-vocal]')?.textContent ?? '',
          interrupteur: !!document.querySelector('[data-assistant-vocal] [data-interrupteur-assistant-vocal]'),
          dictee: !!document.querySelector('[data-assistant-vocal] [data-fonction="dictee"]'),
          deborde: document.documentElement.scrollWidth > window.innerWidth + 1,
        }));
        const tag = `${appareil} ${clarte} voix ${voix ? 'allumée' : 'éteinte'}`;
        verifier(`${tag} : le bloc dit qu'il faut un compte ChatGPT relié à Codex`, /compte ChatGPT/.test(lu.texte) && /Codex/.test(lu.texte));
        verifier(`${tag} : l'interrupteur est là`, lu.interrupteur);
        verifier(`${tag} : la dictée n'est proposée que voix éteinte`, lu.dictee === !voix, String(lu.dictee));
        verifier(`${tag} : rien ne déborde`, !lu.deborde);
        if (CAPTURES) await bloc.screenshot({ path: path.join(CAPTURES, `assistant-vocal-${appareil}-${clarte}-${voix ? 'allumee' : 'eteinte'}.png`) });
        await contexte.close();
      }
    }
  } finally {
    await navigateur.close();
  }
}

principal()
  .catch((err) => {
    console.error(err);
    resultats.push(false);
  })
  .finally(() => {
    nettoyer();
    const ok = resultats.filter(Boolean).length;
    console.log(`${ok}/${resultats.length} contrôles réussis`);
    process.exit(ok === resultats.length && resultats.length > 0 ? 0 : 1);
  });
