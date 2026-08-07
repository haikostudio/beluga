#!/usr/bin/env node
/**
 * L'espace de développement de l'application, en BOUTON À PART.
 *
 * Le projet posé sur le dossier de HaikoDev (marque `isSelf`) n'est pas un
 * projet client : il quitte la liste des projets pour prendre place au-dessus
 * du libellé « Projets », à côté du tableau de bord. Ce qu'on contrôle :
 *
 *  - il n'a plus AUCUNE ligne dans la liste (ni hors groupe, ni dans un groupe) ;
 *  - le bouton dédié existe, au-dessus du libellé « Projets » ;
 *  - un clic ouvre bien SON tableau (même identifiant qu'en base) ;
 *  - le bouton s'allume tant que cet espace est celui qu'on regarde ;
 *  - il porte les mêmes repères qu'une ligne de projet : robot quand un agent
 *    travaille, triangle orange quand une décision attend, point bleu pour un
 *    travail rendu non lu — un seul repère d'attente à la fois ;
 *  - ses réglages restent atteignables depuis ce bouton.
 *
 * Les états sont SIMULÉS : on rejoue les messages du serveur dans le canal
 * temps réel, sans toucher à la base ni déranger un agent au travail. Le projet
 * qu'on regardait au départ est remis en place en partant.
 *
 *   HAIKO_ESPACE_DEV_URL=http://localhost:7099 node scripts/verif-espace-dev.mjs
 *
 * Viser le serveur de DÉVELOPPEMENT : `HAIKODEV_URL` désigne l'application déjà
 * publiée, où l'on verrait l'ancienne version.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où l'on PART : lancé depuis une copie de travail, ce script doit
   juger CE code-là, jamais celui du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_ESPACE_DEV_URL || 'http://localhost:7099';
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';
const SHOTS = path.join(DONNEES, 'verification');

const require = createRequire(import.meta.url);
const base = require(path.join(RACINE, 'node_modules/better-sqlite3'))(path.join(DONNEES, 'haikodev.db'));
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

/* Les jetons de session sont stockés HACHÉS : on s'en fabrique un d'une heure,
   retiré en partant. Surtout pas HAIKODEV_TOKEN (jeton d'agent, périmé). */
const jeton = crypto.randomBytes(32).toString('base64url');
base
  .prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)')
  .run(sha(jeton), Date.now(), Date.now() + 3600_000, 'vérification espace de développement');
process.on('exit', () => base.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton)));

/* L'espace de développement, tel que le démon l'a marqué en base. */
const soi = base
  .prepare('SELECT id, name, data FROM projects WHERE archived = 0')
  .all()
  .find((p) => {
    try {
      return JSON.parse(p.data).isSelf === true;
    } catch {
      return false;
    }
  });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

noter('un projet porte la marque « lui-même » en base', !!soi, soi ? `${soi.name} (${soi.id})` : 'aucun');
if (!soi) {
  console.log('\nRien à contrôler sans ce projet.');
  process.exit(1);
}

fs.mkdirSync(SHOTS, { recursive: true });
const navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
});
const contexte = await navigateur.newContext({
  viewport: { width: 1280, height: 900 },
  locale: 'fr-CH',
  // Sinon un poste réglé sur « réduire les animations » éteindrait le
  // clignotement du point bleu : on ne jugerait plus rien.
  reducedMotion: 'no-preference',
});
await contexte.addCookies([
  { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
]);
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));
page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));

/* On se greffe sur le canal temps réel pour rejouer les messages du serveur
   tels qu'ils arriveraient pour de vrai. */
await page.addInitScript(() => {
  window.__ecouteurs = [];
  const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
  Object.defineProperty(WebSocket.prototype, 'onmessage', {
    configurable: true,
    get() {
      return propriete.get.call(this);
    },
    set(ecouteur) {
      window.__ecouteurs.push(ecouteur);
      return propriete.set.call(this, ecouteur);
    },
  });
  const rejouer = (charge) => {
    const donnees = JSON.stringify(charge);
    for (const ecouteur of window.__ecouteurs) ecouteur({ data: donnees });
  };
  window.__attention = (byProject) => rejouer({ type: 'attention', byProject });
  window.__rendus = (byProject) => rejouer({ type: 'rendus', byProject });
  window.__agent = (id, projectId) =>
    rejouer({
      type: 'agent.upsert',
      agent: {
        id,
        projectId,
        status: 'running',
        role: 'task',
        title: 'Agent d’essai (vérification)',
        run: { engine: 'claude', thinking: 'none', mode: 'direct' },
        startedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
  window.__agentFini = (id) => rejouer({ type: 'agent.delete', id });
});

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[data-drop-root]', { timeout: 60000 });
await page.waitForTimeout(4000);
// L'application reprend l'endroit quitté : un panneau resté ouvert masquerait
// la colonne de gauche.
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

/* Le projet qu'on regardait au départ : on le remettra en place en partant. */
const projetDeDepart = await page
  .locator('[data-drop-root] [data-drag-kind="project"].bg-raised')
  .first()
  .getAttribute('data-drag-id')
  .catch(() => null);

/* --- 1. Plus aucune ligne dans la liste --------------------------------- */
const lignes = page.locator(`[data-drop-root] [data-drag-kind="project"][data-drag-id="${soi.id}"]`);
noter('l’espace de développement a quitté la liste des projets', (await lignes.count()) === 0);
const nomDansListe = await page
  .locator('[data-drop-root]')
  .first()
  .innerText()
  .then((t) => t.includes(soi.name));
noter('son nom n’apparaît plus dans la liste', !nomDansListe);

/* --- 2. Le bouton dédié, au-dessus du libellé « Projets » ---------------- */
const bouton = page.locator('[data-ouvrir-espace-dev]').first();
const bloc = page.locator(`[data-espace-dev="${soi.id}"]`).first();
noter('un bouton dédié le remplace', (await bouton.count()) === 1 && (await bloc.count()) === 1);

const places = await page.evaluate(() => {
  const dev = document.querySelector('[data-ouvrir-espace-dev]');
  const bord = document.querySelector('[data-ouvrir-tableau-de-bord]');
  const titre = [...document.querySelectorAll('span')].find((s) => s.textContent?.trim() === 'Projets');
  const y = (el) => (el ? el.getBoundingClientRect().top : null);
  return { dev: y(dev), bord: y(bord), titre: y(titre) };
});
noter(
  'il est posé au-dessus du libellé « Projets »',
  places.dev !== null && places.titre !== null && places.dev < places.titre,
  `bouton à ${Math.round(places.dev ?? -1)} px, libellé à ${Math.round(places.titre ?? -1)} px`,
);
noter(
  'et juste sous le tableau de bord, dans la même tenue',
  places.bord !== null && places.dev > places.bord,
);
noter(
  'il dit en français ce qu’il ouvre',
  ((await bouton.innerText()) || '').includes('Développement'),
  (await bouton.innerText()).replace(/\s+/g, ' ').trim(),
);

/* --- 3. Un clic ouvre SON tableau, et le bouton s'allume ----------------- */
await bouton.click();
await page.waitForTimeout(1500);
noter('un clic ouvre bien cet espace', (await page.evaluate(() => location.hash)).includes(soi.id), await page.evaluate(() => location.hash));
noter(
  'le bouton s’allume tant que cet espace est ouvert',
  ((await bloc.getAttribute('class')) || '').includes('bg-raised'),
);
await page.screenshot({ path: `${SHOTS}/espace-dev-ouvert.png` });

/* --- 4. Les mêmes repères qu'une ligne de projet ------------------------- */
await page.evaluate(() => {
  window.__attention({});
  window.__rendus({});
});
await page.waitForTimeout(400);
const robot = bloc.locator('[data-repere-robot]');
const triangle = bloc.locator('[data-signal-attention]');
const point = bloc.locator('[data-signal-termine]');
/* Le robot suit les agents RÉELS de cet espace — celui qui joue ce contrôle
   compris : on ne peut pas exiger le repos, seulement l'absence de repère
   d'ATTENTE tant qu'aucun compte n'est diffusé. */
noter('sans compte diffusé, aucun repère d’attente', (await triangle.count()) === 0 && (await point.count()) === 0);

await page.evaluate((id) => window.__agent('essai-espace-dev', id), soi.id);
await page.waitForTimeout(400);
noter('un agent au travail montre un robot', (await robot.count()) === 1);

await page.evaluate((id) => window.__rendus({ [id]: 2 }), soi.id);
await page.waitForTimeout(400);
noter('un travail rendu allume le point bleu', (await point.count()) === 1);

await page.evaluate((id) => window.__attention({ [id]: 1 }), soi.id);
await page.waitForTimeout(400);
noter('une décision attendue affiche le triangle orange', (await triangle.count()) === 1);
noter('et le point bleu s’efface le temps de la décision', (await point.count()) === 0);
await page.screenshot({ path: `${SHOTS}/espace-dev-reperes.png` });

noter(
  'le triangle dit ce qu’il veut dire',
  ((await triangle.getAttribute('aria-label')) || '').length > 8,
  (await triangle.getAttribute('aria-label')) || '',
);

await page.evaluate(() => window.__attention({}));
await page.waitForTimeout(400);
noter(
  'la décision réglée, le triangle s’efface et le point bleu revient',
  (await triangle.count()) === 0 && (await point.count()) === 1,
);

/* --- 5. Les réglages restent atteignables -------------------------------- */
noter(
  'ses réglages s’ouvrent depuis ce bouton',
  (await bloc.locator(`[data-reglages-projet="${soi.id}"]`).count()) === 1,
);

/* On remet la page dans l'état où on l'a trouvée. */
await page.evaluate(() => {
  window.__attention({});
  window.__rendus({});
  window.__agentFini('essai-espace-dev');
});
if (projetDeDepart && projetDeDepart !== soi.id) {
  await page.locator(`[data-drop-root] [data-drag-kind="project"][data-drag-id="${projetDeDepart}"] button`).first().click();
  await page.waitForTimeout(1000);
}

noter('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

await navigateur.close();

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
process.exit(echecs.length ? 1 : 0);
