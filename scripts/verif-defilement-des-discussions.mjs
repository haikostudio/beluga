#!/usr/bin/env node
/**
 * LE DÉFILEMENT DES DISCUSSIONS, DANS UN VRAI NAVIGATEUR (demande du 29/10/2026).
 *
 *   npm run build && env -u BELUGA_TOKEN node scripts/verif-defilement-des-discussions.mjs
 *
 * Le script monte son PROPRE démon (port libre, base neuve, interface construite
 * de CETTE copie) — jamais depuis le dépôt principal, jamais sur l'application
 * publiée. La conversation de l'assistant (le robot), au fil déjà écrit, aucun
 * moteur : elle se ferme (le fil disparaît) et se rouvre.
 *
 * Toute discussion (carte, cadrage, assistant, tiroirs) passe par le même fil :
 *   1. À L'OUVERTURE, TOUT EN BAS — même un long fil ;
 *   2. EN BAS, IL SUIT — un contenu qui s'ajoute recolle le fil au bas, et une
 *      remontée de moins de 50 px compte encore comme « en bas » ;
 *   3. REMONTÉ DE 50 PX OU PLUS, IL NE BOUGE PAS — un contenu qui s'ajoute ne
 *      tire pas le lecteur ;
 *   4. LA LECTURE EST RETROUVÉE — fermer la conversation remonté puis la
 *      rouvrir rend la même position ; fermée en bas, elle se rouvre en bas.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (path.resolve(RACINE) === '/root/beluga') {
  console.error('Ce contrôle monte un démon jetable : lance-le depuis la copie de travail d’une carte, jamais depuis le dépôt principal.');
  process.exit(2);
}
const PORT = Number(process.env.BELUGA_DEFILEMENT_PORT || 7231);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-defilement-discussions-'));
const CAPTURES = process.env.BELUGA_CAPTURES || path.join(TMP, 'captures');
fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le décor, écrit par le magasin du démon lui-même, AVANT son lancement */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(PROJETS, { recursive: true });
process.env.BELUGA_DATA = DATA;
process.env.BELUGA_PROJECTS_ROOT = PROJETS;

const shared = await import(path.join(RACINE, 'shared/dist/index.js'));
const store = await import(path.join(RACINE, 'server/dist/store.js'));
const { getDb } = await import(path.join(RACINE, 'server/dist/db.js'));

const { setMeta } = await import(path.join(RACINE, 'server/dist/db.js'));

const maintenant = Date.now();
const PROJET = 'p-defilement';
const ASSISTANT = 'agent-assistant-essai';
const jeton = crypto.randomBytes(32).toString('hex');
const paragraphe = (i) => `Réponse ${i}. ${'Voici une explication assez longue pour remplir la conversation et la faire défiler. '.repeat(6)}`;

store.saveProject(shared.Project.parse({ id: PROJET, name: 'Défilement', path: PROJETS, createdAt: maintenant, updatedAt: maintenant }));
store.saveAgent({
  ...shared.Agent.parse({ id: ASSISTANT, projectId: PROJET, role: 'deploy', title: 'Assistant', run: { engine: 'claude' }, status: 'idle', createdAt: maintenant, updatedAt: maintenant }),
  assistantGlobal: true,
});
for (let i = 0; i < 40; i++) {
  store.saveMessage(shared.Message.parse({ id: `q${i}`, agentId: ASSISTANT, role: 'user', content: `Question ${i} ?`, createdAt: maintenant - 3_600_000 + i * 60_000 }));
  store.saveMessage(shared.Message.parse({ id: `r${i}`, agentId: ASSISTANT, role: 'assistant', content: paragraphe(i), createdAt: maintenant - 3_600_000 + i * 60_000 + 30_000 }));
}
setMeta('assistant.agent', ASSISTANT);
const db = getDb();
db.prepare('INSERT OR REPLACE INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
  crypto.createHash('sha256').update(jeton).digest('hex'),
  maintenant,
  maintenant + 3_600_000,
  'vérification du défilement des discussions',
);
db.close();

/* ------------------------------------------------------------------ */
/* Le démon                                                             */
/* ------------------------------------------------------------------ */

const journal = [];
const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    BELUGA_TOKEN: '',
    BELUGA_URL: '',
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));
process.on('exit', () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  if (!process.env.BELUGA_CAPTURES) fs.rmSync(TMP, { recursive: true, force: true });
});

async function attendrePort(limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

if (!(await attendrePort())) {
  console.error(journal.join('').slice(-3000));
  throw new Error('le démon jetable n’a jamais ouvert son port');
}

/* ------------------------------------------------------------------ */
/* Le navigateur                                                        */
/* ------------------------------------------------------------------ */

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const erreurs = [];
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
const page = await contexte.newPage();
page.on('pageerror', (e) => erreurs.push(String(e)));

const FIL = '[data-assistant-chat] [data-fil="conversation"]';
/* Le robot ouvre et ferme la conversation : fermée, son fil n'existe plus. */
const basculer = async (ouvrir) => {
  // Le toucher du bouton du bord lance la voix : le volet s'ouvre en texte par le point d'essai.
  if (ouvrir) await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant')));
  else await page.locator('[data-bouton-du-bord]').click();
  await page.locator(FIL).first().waitFor({ state: ouvrir ? 'visible' : 'detached', timeout: 30000 });
};
const mesure = () =>
  page.evaluate((sel) => {
    const fil = document.querySelector(sel);
    if (!fil) return null;
    return { haut: Math.round(fil.scrollTop), reste: Math.round(fil.scrollHeight - fil.scrollTop - fil.clientHeight), hauteur: fil.scrollHeight, vue: fil.clientHeight };
  }, FIL);
const attendre = async (condition, limiteMs = 8000) => {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await page.waitForTimeout(150);
  }
  return false;
};
/* Un bloc ajouté au fil, comme un message qui arrive : le recollage le suit (ou pas). */
const ajouterAuFil = () =>
  page.evaluate((sel) => {
    const fil = document.querySelector(sel);
    const bloc = document.createElement('div');
    bloc.style.height = '320px';
    bloc.style.flexShrink = '0';
    bloc.setAttribute('data-essai-ajout', '');
    fil.appendChild(bloc);
  }, FIL);
const molette = async (dy) => {
  const boite = await page.locator(FIL).first().boundingBox();
  await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2);
  await page.mouse.wheel(0, dy);
};

try {
  await page.goto(`${BASE}/#${shared.construireFragment({ vue: 'projet', projectId: PROJET })}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('[data-bouton-du-bord]').waitFor({ timeout: 30000 });
  await basculer(true);
  const ouverte = await attendre(async () => {
    const m = await mesure();
    return !!m && m.hauteur > m.vue * 2 && m.reste < 50;
  }, 15000);
  const m1 = await mesure();
  noter('à l’ouverture, une longue discussion se pose tout en bas', ouverte, JSON.stringify(m1));

  /* EN BAS, IL SUIT, même après une petite remontée (< 50 px). */
  await molette(-30);
  await page.waitForTimeout(500);
  await ajouterAuFil();
  noter('une remontée de moins de 50 px compte comme « en bas » : le fil suit ce qui s’ajoute', await attendre(async () => (await mesure()).reste < 50, 4000), JSON.stringify(await mesure()));

  /* REMONTÉ DE 50 PX OU PLUS, IL NE BOUGE PAS. */
  await molette(-600);
  await page.waitForTimeout(600);
  const remonte = await mesure();
  await ajouterAuFil();
  await page.waitForTimeout(800);
  const apresAjout = await mesure();
  noter('remonté d’au moins 50 px, un contenu qui s’ajoute ne tire pas le lecteur', remonte.reste >= 50 && Math.abs(apresAjout.haut - remonte.haut) <= 2, `${JSON.stringify(remonte)} → ${JSON.stringify(apresAjout)}`);
  await page.screenshot({ path: path.join(CAPTURES, '01-remonte.png') });

  /* LA LECTURE EST RETROUVÉE à la réouverture. */
  const lu = (await mesure()).haut;
  await basculer(false);
  await page.waitForTimeout(400);
  await basculer(true);
  const retrouvee = await attendre(async () => {
    const m = await mesure();
    return !!m && m.hauteur > m.vue * 2 && Math.abs(m.haut - lu) <= 60 && m.reste >= 50;
  }, 10000);
  noter('fermer la conversation remonté puis la rouvrir rend la même lecture', retrouvee, `lu ${lu} → ${JSON.stringify(await mesure())}`);
  await page.screenshot({ path: path.join(CAPTURES, '02-retrouvee.png') });

  /* De retour en bas, la réouverture se fait en bas. */
  await molette(100_000);
  await attendre(async () => (await mesure()).reste < 50, 4000);
  await page.waitForTimeout(500);
  await basculer(false);
  await page.waitForTimeout(400);
  await basculer(true);
  noter('fermée en bas, la conversation se rouvre tout en bas', await attendre(async () => {
    const m = await mesure();
    return !!m && m.hauteur > m.vue * 2 && m.reste < 50;
  }, 10000), JSON.stringify(await mesure()));

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
} catch (err) {
  noter('le contrôle est allé au bout', false, String(err).split('\n')[0]);
} finally {
  await navigateur.close();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis. Captures : ${CAPTURES}`);
process.exit(echecs.length ? 1 : 0);
