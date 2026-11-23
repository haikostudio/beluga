#!/usr/bin/env node
/**
 * LE SCRIPT DE SUIVI DANS UN VRAI NAVIGATEUR — service Statistiques.
 *
 * Aucun démon : un petit serveur local sert une page de site, le VRAI script
 * (`scriptDeSuivi` de `shared/dist`) et une porte de collecte qui répond le
 * mode choisi (« a » anonyme, « v » visiteur), comme `/m/c`.
 *
 *  - MODE ANONYME : rien dans localStorage, sessionStorage ni document.cookie,
 *    aucun identifiant persistant envoyé, aucun bandeau ;
 *  - MODE VISITEUR : bandeau affiché, rien de stocké ni d'envoyé avant l'accord ;
 *    après « Accepter », identifiant stable d'une page à l'autre, aucun cookie ;
 *    un clic sur `[data-beluga-repere]` part en événement « repere » ;
 *  - REFUS : pas d'identifiant, choix mémorisé (le bandeau ne revient pas) ;
 *  - NE PAS SUIVRE (Do Not Track) : rien n'est envoyé.
 *
 * Lancer : `npm run build --workspace shared && node scripts/verif-statistiques-script.mjs`
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { scriptDeSuivi } = await import(pathToFileURL(path.join(racine, 'shared/dist/marketing.js')).href);

let mode = 'a';
const recus = [];
const serveur = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/m/s.js') {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
    return res.end(scriptDeSuivi(`http://localhost:${serveur.address().port}`));
  }
  if (url.pathname === '/m/c') {
    let corps = '';
    req.on('data', (c) => (corps += c));
    req.on('end', () => {
      try {
        recus.push(JSON.parse(corps));
      } catch {
        /* rien */
      }
      const entetes = { 'access-control-allow-origin': req.headers.origin ?? '*' };
      if (recus.at(-1)?.t === 'vue') {
        res.writeHead(200, { ...entetes, 'content-type': 'application/json' });
        return res.end(JSON.stringify({ m: mode, l: 'fr' }));
      }
      res.writeHead(204, entetes);
      res.end();
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="fr"><head><script defer src="/m/s.js" data-cle="cleEssai01"></script></head>
<body><h1>Page ${url.pathname}</h1><a href="/deux">Deux</a><button data-beluga-repere="reserver-hero">Réserver</button></body></html>`);
});
await new Promise((r) => serveur.listen(0, 'localhost', r));
const BASE = `http://localhost:${serveur.address().port}`;

let echecs = 0;
const noter = (nom, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${nom}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) echecs += 1;
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const stockage = (page) =>
  page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), cookie: document.cookie }));

const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
try {
  /* ---------------- Mode anonyme ---------------- */
  mode = 'a';
  let ctx = await navigateur.newContext();
  let page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await attendre(600);
  await page.click('[data-beluga-repere]');
  await page.goto(`${BASE}/deux`);
  await attendre(600);
  let s = await stockage(page);
  noter('anonyme : rien dans localStorage, sessionStorage ni cookie', !s.local.length && !s.session.length && !s.cookie, JSON.stringify(s));
  noter('anonyme : aucun bandeau', (await page.locator('[data-beluga-bandeau]').count()) === 0);
  noter('anonyme : aucun identifiant persistant envoyé', recus.length > 0 && recus.every((e) => !e.vp && !e.vs), JSON.stringify(recus.slice(0, 3)));
  noter('anonyme : le clic sur un repère est compté', recus.some((e) => e.t === 'repere' && e.n === 'reserver-hero'));
  await ctx.close();

  /* ---------------- Mode visiteur : accord ---------------- */
  mode = 'v';
  recus.length = 0;
  ctx = await navigateur.newContext();
  page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.waitForSelector('[data-beluga-bandeau]', { timeout: 5000 }).catch(() => {});
  noter('visiteur : le bandeau paraît', (await page.locator('[data-beluga-bandeau]').count()) === 1);
  s = await stockage(page);
  noter('visiteur : rien de stocké avant l’accord', !s.local.length && !s.session.length && !s.cookie, JSON.stringify(s));
  noter('visiteur : rien d’identifiant envoyé avant l’accord', recus.every((e) => !e.vp));
  const texte = await page.evaluate(() => document.querySelector('[data-beluga-bandeau]')?.shadowRoot?.textContent ?? '');
  noter('visiteur : le bandeau parle la langue de la page, deux boutons', /Accepter/.test(texte) && /Refuser/.test(texte), texte);
  await page.locator('[data-beluga-bandeau] button[data-r="1"]').click();
  await attendre(200);
  noter('visiteur : le bandeau se referme', (await page.locator('[data-beluga-bandeau]').count()) === 0);
  await page.click('[data-beluga-repere]');
  await page.goto(`${BASE}/deux`);
  await attendre(600);
  s = await stockage(page);
  const ids = recus.filter((e) => e.vp).map((e) => e.vp);
  noter('visiteur : après accord, un identifiant stable d’une page à l’autre', ids.length >= 2 && new Set(ids).size === 1, JSON.stringify(ids));
  noter('visiteur : la session part avec chaque événement', recus.filter((e) => e.vp).every((e) => typeof e.vs === 'string' && e.vs.length >= 12));
  noter('visiteur : toujours aucun cookie', !s.cookie, s.cookie);
  noter('visiteur : le bandeau ne revient pas', (await page.locator('[data-beluga-bandeau]').count()) === 0);
  await ctx.close();

  /* ---------------- Mode visiteur : refus ---------------- */
  recus.length = 0;
  ctx = await navigateur.newContext();
  page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.waitForSelector('[data-beluga-bandeau]', { timeout: 5000 }).catch(() => {});
  await page.locator('[data-beluga-bandeau] button[data-r="0"]').click();
  await page.goto(`${BASE}/deux`);
  await attendre(600);
  s = await stockage(page);
  noter('refus : aucun identifiant envoyé', recus.every((e) => !e.vp), JSON.stringify(recus));
  noter('refus : seul le choix est gardé, aucun identifiant', s.local.length === 1 && s.local[0].startsWith('beluga_accord_') && !s.session.length && !s.cookie, JSON.stringify(s));
  noter('refus : le bandeau ne revient pas', (await page.locator('[data-beluga-bandeau]').count()) === 0);
  await ctx.close();

  /* ---------------- Ne pas suivre ---------------- */
  recus.length = 0;
  ctx = await navigateur.newContext();
  await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1' }));
  page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await attendre(600);
  await page.click('[data-beluga-repere]');
  await attendre(300);
  noter('« ne pas suivre » : rien n’est envoyé, aucun bandeau', recus.length === 0 && (await page.locator('[data-beluga-bandeau]').count()) === 0, JSON.stringify(recus));
  await ctx.close();
} finally {
  await navigateur.close();
  serveur.close();
}
console.log(echecs ? `\n${echecs} échec(s).` : '\nTout est bon.');
process.exit(echecs ? 1 : 0);
