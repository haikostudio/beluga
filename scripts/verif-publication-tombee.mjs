#!/usr/bin/env node
/**
 * UNE MISE EN LIGNE TOMBÉE RESTE ACTIVE (17/11/2026, maquette #fbdfc) : dans la colonne de gauche, sous son projet, la
 * ligne d'un déploiement en échec reste AU-DESSUS du trait des rangées, encadrée de rouge, avec le logo du projet et
 * un POINT ROUGE au coin ; une publication finie, elle, se range dessous. Captures 1440/390, clair et sombre.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL VERIF_CAPTURES=<dossier> node scripts/verif-publication-tombee.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7263);
const PORT_WEB = Number(process.env.BELUGA_VERIF_PORT_WEB || 7164);
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-publication-tombee-', port: PORT });
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
  const T = Date.now();
  {
    const db = base();
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai publication tombée');
    const p = { id: 'p-tombe', name: 'Toogo', path: path.join(DATA, 'depot-tombe'), defaultEngine: 'claude', isSelf: false, rank: 5, archived: false, createdAt: T, updatedAt: T };
    fs.mkdirSync(p.path, { recursive: true });
    db.prepare('INSERT OR REPLACE INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(p.id, p.name, p.path, JSON.stringify(p), T, T);
    const run = (id, state, cible, debut) => ({ id, projectId: 'p-tombe', cible, state, startedAt: debut, endedAt: debut + 30_000, error: state === 'failed' ? 'La construction échoue.' : undefined, steps: [{ key: 'merge', state: 'done', log: '' }, { key: 'build', state: state === 'failed' ? 'failed' : 'done', log: '' }], actor: 'essai' });
    for (const r of [run('d-finie', 'success', 'production', T - 600_000), run('d-tombee', 'failed', 'dev', T - 120_000)]) {
      db.prepare('INSERT INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)').run(r.id, r.projectId, r.state, JSON.stringify(r), r.startedAt, r.endedAt);
    }
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
      const contexte = await navigateur.newContext({ viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: telephone, hasTouch: telephone, serviceWorkers: 'block' });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await contexte.newPage();
      await page.goto(`${BASE}/#taches`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      if (telephone) {
        const menu = page.locator('button[aria-label="Projets"]').first();
        if (await menu.count()) await menu.click().catch(() => {});
        await page.waitForTimeout(600);
      }
      const deplier = page.locator('[data-deplier-taches="p-tombe"]').first();
      await deplier.waitFor({ timeout: 30_000 }).catch(() => {});
      // Déplié une fois, le projet le reste (préférence retenue) : un second clic le replierait.
      if ((await deplier.count()) && !(await page.locator('[data-taches-du-projet="p-tombe"]').count())) await deplier.click().catch(() => {});
      const ligne = page.locator('[data-taches-du-projet="p-tombe"] [data-mise-en-ligne="d-tombee"]').first();
      await ligne.waitFor({ timeout: 20_000 }).catch(() => {});
      const lu = await page.evaluate(() => {
        const liste = document.querySelector('[data-taches-du-projet="p-tombe"]');
        const ordre = [...(liste?.querySelectorAll('[data-mise-en-ligne], [data-ligne-rangee]') ?? [])].map((e) => e.getAttribute('data-mise-en-ligne'));
        const tombee = liste?.querySelector('[data-mise-en-ligne="d-tombee"]');
        return {
          rangee: tombee?.hasAttribute('data-ligne-rangee') ?? null,
          cadre: tombee?.querySelector('[data-cadre-mise-en-ligne]')?.getAttribute('data-cadre-mise-en-ligne') ?? null,
          point: !!tombee?.querySelector('[data-rond-d-etat="echec"] [data-point-rouge-echec]'),
          logo: !!tombee?.querySelector('[data-icone-agent-projet]'),
          ordre,
        };
      });
      const tag = `${appareil} ${clarte}`;
      verifier(`${tag} : la ligne tombée est active (pas rangée), cadre rouge`, lu.rangee === false && lu.cadre === 'echec', JSON.stringify(lu));
      verifier(`${tag} : le logo du projet porte le point rouge`, lu.point && lu.logo, JSON.stringify(lu));
      verifier(`${tag} : elle passe avant la publication finie`, lu.ordre.indexOf('d-tombee') > -1 && (lu.ordre.indexOf('d-finie') === -1 || lu.ordre.indexOf('d-tombee') < lu.ordre.indexOf('d-finie')), lu.ordre.join(', '));
      if (CAPTURES) {
        const zone = page.locator('[data-taches-du-projet="p-tombe"]').first();
        if (await zone.count()) await zone.screenshot({ path: path.join(CAPTURES, `publication-tombee-${appareil}-${clarte}.png`) }).catch(() => {});
        await page.screenshot({ path: path.join(CAPTURES, `publication-tombee-${appareil}-${clarte}-ecran.png`) });
      }
      await contexte.close();
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
