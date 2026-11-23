/**
 * L'AIR SOUS LA BARRE DU HAUT DU TÉLÉPHONE (carte « Jarvis : déploiements vus et champ masqué », 18/11/2026,
 * capture #b688, maquette #d2f0).
 *
 * À 390 px (iPhone simulé, zone sûre de 47 px), clair et sombre, sur la page d'une carte, l'accueil d'un projet, les
 * tableaux de bord et l'assistant : l'écart entre le BAS des boutons de la barre du haut (`[data-entete-de-zone]`) et
 * le bas de cette barre vaut 12 px (± 1), comme la marge latérale ; le haut des boutons reste 2 px sous la zone sûre, comme avant ;
 * le nom centré reste centré sur les boutons. À 1440 px, les hauteurs de l'entête sont relevées pour comparaison.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-air-sous-le-haut.mjs
 *   (VERIF_CAPTURES=<dossier> pour garder les captures, VERIF_RELEVE_SEUL=1 pour relever sans juger)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7243);
const PORT_WEB = Number(process.env.BELUGA_VERIF_PORT_WEB || 7143);
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-air-haut-'));
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
  'essai air sous le haut',
);
db.close();

const { journal, attendrePort, nettoyer } = demarrerDemonDEssai({ tmp: TMP, prefixe: 'verif-air-haut-', port: PORT, signaux: true });
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


const RELEVE_SEUL = !!process.env.VERIF_RELEVE_SEUL;
const ZONE_SURE = 47;

/** Le relevé de la barre du haut visible : sa boîte, celle de ses boutons, celle du nom centré. */
const mesurer = (page) =>
  page.evaluate(() => {
    const visible = (n) => {
      const r = n.getBoundingClientRect();
      return r.height > 0 && r.width > 0 && getComputedStyle(n).visibility !== 'hidden' && r.top < innerHeight / 2;
    };
    const entetes = [...document.querySelectorAll('[data-entete-de-zone]')].filter(visible);
    // La barre la plus haute (et la plus avant dans le document) : celle que l'on voit en haut de l'écran.
    entetes.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const entete = entetes[0];
    if (!entete) return null;
    const re = entete.getBoundingClientRect();
    const boutons = [...entete.querySelectorAll('button, a[href]')].filter((b) => visible(b) && b.getBoundingClientRect().height >= 24);
    if (!boutons.length) return { entete: { haut: re.top, bas: re.bottom }, boutons: 0 };
    const hauts = boutons.map((b) => b.getBoundingClientRect().top);
    const bas = boutons.map((b) => b.getBoundingClientRect().bottom);
    const nom = entete.querySelector('[data-calque-du-nom] [data-titre-bandeau], [data-calque-du-nom] button');
    const rn = nom && visible(nom) ? nom.getBoundingClientRect() : null;
    const centreBoutons = (Math.min(...hauts) + Math.max(...bas)) / 2;
    return {
      variante: ['data-titre-centre', 'data-haut-un-rang', 'data-entete-une-rangee', 'data-barre-du-projet'].find((a) => entete.hasAttribute(a)) ?? 'simple',
      entete: { haut: Math.round(re.top), bas: Math.round(re.bottom), hauteur: Math.round(re.height) },
      boutons: boutons.length,
      hautDesBoutons: Math.round(Math.min(...hauts)),
      airDessous: Math.round(re.bottom - Math.max(...bas)),
      tailles: boutons.map((b) => `${b.getAttribute('aria-label') ?? b.textContent?.trim().slice(0, 12)}:${Math.round(b.getBoundingClientRect().height)}`),
      ecartDuNom: rn ? Math.round(Math.abs((rn.top + rn.bottom) / 2 - centreBoutons)) : null,
    };
  });

const PAGES = [
  ['carte', `#projet/${PROJET}/tache/${CARTE}`],
  ['projet', `#projet/${PROJET}`],
  ['tableaux', '#tableau-de-bord'],
  ['assistant', '#tableau-de-bord', true],
];

let navigateur;
try {
  if (!(await attendrePort())) throw new Error(`le démon d’essai n’a pas ouvert son port\n${journal.join('').slice(-2000)}`);
  for (let i = 0; i < 90 && !(await fetch(BASE).then(() => true).catch(() => false)); i += 1) await new Promise((r) => setTimeout(r, 1000));
  navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (const [largeur, hauteur] of [
    [390, 844],
    [1440, 900],
  ]) {
    for (const clarte of ['clair', 'sombre']) {
      await poserLeTheme(clarte);
      const telephone = largeur < 640;
      const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, isMobile: telephone, hasTouch: telephone, serviceWorkers: 'block', locale: 'fr-CH' });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      if (telephone) await contexte.addInitScript((z) => {
          const poser = () => document.documentElement?.style.setProperty('--zone-sure-haut-systeme', `${z}px`);
          poser();
          document.addEventListener('DOMContentLoaded', poser);
        }, ZONE_SURE);
      for (const [nom, adresse, assistant] of PAGES) {
        const page = await contexte.newPage();
        const erreurs = [];
        page.on('pageerror', (e) => erreurs.push(String(e)));
        const tag = `${largeur}-${clarte}-${nom}`;
        await page.goto(`${BASE}/${adresse}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-entete-de-zone]', { timeout: 60_000 });
        await page.waitForTimeout(1500);
        if (assistant) {
          await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant')));
          await page.waitForTimeout(1500);
        }
        const r = await mesurer(page);
        if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `haut-${tag}.png`), clip: { x: 0, y: 0, width: largeur, height: 160 } });
        console.log(`  ${tag} : ${JSON.stringify(r)}`);
        if (assistant) {
          await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant', { detail: { ouvrir: false } })));
          await page.waitForTimeout(500);
        }
        if (!RELEVE_SEUL) {
          verifier(`${tag} : une barre du haut avec ses boutons`, r && r.boutons > 0);
          if (telephone && r) {
            verifier(`${tag} : 12 px sous les boutons`, Math.abs(r.airDessous - 12) <= 1, `${r.airDessous} px (${r.variante})`);
            verifier(`${tag} : le haut des boutons ne bouge pas (zone sûre + 2 px ± 1)`, Math.abs(r.hautDesBoutons - ZONE_SURE - 2) <= 1, `${r.hautDesBoutons - ZONE_SURE} px`);
            if (r.ecartDuNom !== null) verifier(`${tag} : le nom reste centré sur les boutons`, r.ecartDuNom <= 1, `${r.ecartDuNom} px`);
          }
          verifier(`${tag} : aucune erreur de page`, !erreurs.length, erreurs.join(' | '));
        }
        await page.close();
      }
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
process.exit(reussis === resultats.length && (resultats.length || RELEVE_SEUL) ? 0 : 1);
