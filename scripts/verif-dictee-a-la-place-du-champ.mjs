/**
 * LA DICTÉE PREND LA PLACE DU CHAMP (carte « Jarvis : déploiements vus et champ masqué », 18/11/2026, maquette #b3342).
 *
 * Dans la page d'une carte, à 1440 px et 390 px, clair et sombre :
 *   1. hors dictée, on relève l'écart entre la rangée « Lancer et valider » (`[data-rangee-principale]`) et le champ ;
 *   2. un clic sur le micro lance la dictée : le bandeau (`[data-enregistreur-en-cours]`) est visible, le champ
 *      d'écriture ne l'est plus (aucune hauteur gardée), le bandeau est collé sous la rangée avec le MÊME écart, et
 *      son bas tombe là où était le bas du champ ;
 *   3. « Valider » : le champ revient, avec le brouillon d'avant ET le texte dicté.
 *
 * Le micro est celui, factice, de Chrome ; `/api/dictee` et `/api/transcribe` sont servis par le contrôle.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-dictee-a-la-place-du-champ.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7241);
const PORT_WEB = Number(process.env.BELUGA_VERIF_PORT_WEB || 7141);
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-dictee-champ-'));
const DATA = path.join(TMP, 'data');
const DEPOT = path.join(TMP, 'depot');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(DEPOT, { recursive: true });
process.env.BELUGA_DATA = DATA;
process.env.BELUGA_PROJECTS_ROOT = path.join(TMP, 'projets');

const shared = await import(path.join(RACINE, 'shared/dist/index.js'));
const store = await import(path.join(RACINE, 'server/dist/store.js'));
const { getDb } = await import(path.join(RACINE, 'server/dist/db.js'));

const T = Date.now();
const PROJET = 'p-dictee-champ';
const CARTE = 'carte-dictee-champ';
const AGENT = `agent-${CARTE}`;
const jeton = crypto.randomBytes(32).toString('hex');
store.saveProject(shared.Project.parse({ id: PROJET, name: 'Facturo', path: DEPOT, createdAt: T, updatedAt: T }));
store.saveAgent(shared.Agent.parse({ id: AGENT, projectId: PROJET, role: 'task', title: 'Page de contact', cardId: CARTE, run: { engine: 'claude' }, status: 'done', createdAt: T, updatedAt: T }));
store.saveMessage(shared.Message.parse({ id: `rapport-${CARTE}`, agentId: AGENT, role: 'assistant', content: 'La page de contact est prête à être cadrée.', createdAt: T - 60_000 }));
store.saveCard(shared.Card.parse({ id: CARTE, projectId: PROJET, title: 'Page de contact', column: 'planned', position: 0, agentId: AGENT, run: { engine: 'claude' }, createdAt: T, updatedAt: T }));
const db = getDb();
db.prepare('INSERT OR REPLACE INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
  crypto.createHash('sha256').update(jeton).digest('hex'),
  T,
  T + 3_600_000,
  'essai dictée à la place du champ',
);
db.close();

const { journal, attendrePort, nettoyer } = demarrerDemonDEssai({ tmp: TMP, prefixe: 'verif-dictee-champ-', port: PORT, signaux: true });
const vite = spawn('npm', ['run', 'dev', '--workspace', 'web', '--', '--port', String(PORT_WEB), '--strictPort'], {
  cwd: RACINE,
  env: { ...process.env, BELUGA_DEMON_PORT: String(PORT), NODE_ENV: 'development', BELUGA_URL: '', BELUGA_TOKEN: '' },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const journalVite = [];
vite.stdout.on('data', (d) => journalVite.push(String(d)));
vite.stderr.on('data', (d) => journalVite.push(String(d)));
process.on('exit', () => {
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
});

async function poserLeTheme(clarte) {
  const Database = (await import('node:module')).createRequire(import.meta.url)('better-sqlite3');
  const base = new Database(path.join(DATA, 'beluga.db'));
  base.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('theme', JSON.stringify(clarte), Date.now());
  base.close();
}

/** Les boîtes utiles du pied, lues dans la page de la carte. */
const mesurer = (page) =>
  page.evaluate(() => {
    const visible = (n) => !!n && n.getBoundingClientRect().height > 0 && getComputedStyle(n).visibility !== 'hidden';
    const boite = (sel) => {
      const n = document.querySelector(`[data-page-carte] ${sel}`);
      if (!visible(n)) return null;
      const r = n.getBoundingClientRect();
      return { haut: Math.round(r.top), bas: Math.round(r.bottom), hauteur: Math.round(r.height) };
    };
    return {
      rangee: boite('[data-composer] [data-rangee-principale]'),
      champ: boite('[data-composer] [data-champ-d-ecriture]'),
      // La tête du champ (« Demande · 1 sur 5 », témoin, repère des tâches) : posée juste au-dessus de lui.
      tete: boite('[data-composer] [data-temoin-reflexion]'),
      bandeau: boite('[data-composer] [data-enregistreur-en-cours]'),
      texte: document.querySelector('[data-page-carte] [data-composer] textarea')?.value ?? null,
    };
  });

let navigateur;
try {
  if (!(await attendrePort())) throw new Error(`le démon d’essai n’a pas ouvert son port\n${journal.join('').slice(-2000)}`);
  for (let i = 0; i < 90 && !(await fetch(BASE).then(() => true).catch(() => false)); i += 1) await new Promise((r) => setTimeout(r, 1000));
  navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });

  for (const [largeur, hauteur] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const clarte of ['clair', 'sombre']) {
      await poserLeTheme(clarte);
      const telephone = largeur < 640;
      const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, isMobile: telephone, hasTouch: telephone, serviceWorkers: 'block', locale: 'fr-CH', permissions: ['microphone'] });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await contexte.newPage();
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(String(e)));
      await page.route('**/api/dictee', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ disponible: true }) }));
      await page.route('**/api/transcribe', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, text: 'texte dicté' }) }));
      const tag = `${largeur}-${clarte}`;
      console.log(`\n${tag}`);

      await page.goto(`${BASE}/#projet/${PROJET}/tache/${CARTE}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-page-carte] [data-composer] [data-mic-button]:not([data-dictee-absente])', { timeout: 60_000 });
      await page.waitForTimeout(800);
      await page.locator('[data-page-carte] [data-composer] textarea').first().fill('Brouillon gardé');
      await page.locator('[data-page-carte] [data-composer] textarea').first().blur();
      await page.waitForTimeout(300);

      const avant = await mesurer(page);
      verifier(`${tag} : rangée « Lancer et valider » et champ visibles hors dictée`, avant.rangee && avant.champ, JSON.stringify(avant));
      const dessousDeLaRangee = avant.tete ?? avant.champ;
      const ecartAvant = avant.rangee && dessousDeLaRangee ? dessousDeLaRangee.haut - avant.rangee.bas : NaN;

      await page.locator('[data-page-carte] [data-composer] [data-mic-button]').first().click();
      await page.waitForSelector('[data-page-carte] [data-enregistreur-en-cours]', { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(700);
      const pendant = await mesurer(page);
      if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `dictee-${tag}.png`) });
      verifier(`${tag} : le bandeau de dictée est visible`, !!pendant.bandeau, JSON.stringify(pendant));
      verifier(`${tag} : le champ d'écriture n'est plus affiché`, !pendant.champ);
      verifier(`${tag} : la rangée « Lancer et valider » reste`, !!pendant.rangee);
      verifier(`${tag} : la tête du champ (« Demande · 1 sur 5 ») part avec lui`, !!avant.tete && !pendant.tete, JSON.stringify(avant.tete));
      const ecart = pendant.rangee && pendant.bandeau ? pendant.bandeau.haut - pendant.rangee.bas : NaN;
      verifier(`${tag} : aucun trou entre la rangée et le bandeau (≤ 10 px, comme hors dictée)`, ecart >= 0 && ecart <= 10 && Math.abs(ecart - ecartAvant) <= 1, `écart ${ecart} px, hors dictée ${ecartAvant} px`);
      verifier(`${tag} : le bas du bandeau tombe au bas du champ`, avant.champ && pendant.bandeau && Math.abs(pendant.bandeau.bas - avant.champ.bas) <= 2, `bandeau ${pendant.bandeau?.bas}, champ ${avant.champ?.bas}`);

      await page.locator('[data-page-carte] [data-enregistreur-en-cours] button').first().click();
      await page.waitForFunction(() => /texte dicté/.test(document.querySelector('[data-page-carte] [data-composer] textarea')?.value ?? ''), null, { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(400);
      const apres = await mesurer(page);
      if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `apres-${tag}.png`) });
      verifier(`${tag} : le champ revient, le bandeau est parti`, !!apres.champ && !apres.bandeau);
      verifier(`${tag} : brouillon gardé et texte dicté ajouté`, apres.texte === 'Brouillon gardé texte dicté', JSON.stringify(apres.texte));
      verifier(`${tag} : aucune erreur de page`, !erreurs.length, erreurs.join(' | '));
      await contexte.close();
    }
  }
} catch (err) {
  console.error(err);
  resultats.push(false);
} finally {
  await navigateur?.close();
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
  nettoyer?.();
}
const reussis = resultats.filter(Boolean).length;
console.log(`\n${reussis}/${resultats.length} contrôles réussis`);
process.exit(reussis === resultats.length && resultats.length ? 0 : 1);
