#!/usr/bin/env node
/**
 * LA FIN D'UN TRAVAIL REPLIE LA LISTE DES TÂCHES ET « CE QUE L'AGENT A VU », LE TRAVAIL SUIVANT LES ROUVRE
 * (`useRepliDeFinDeTour`, décision du 06/11/2026), vérifié dans un vrai navigateur, 1440 et 390 px, clair et sombre.
 *
 * Aucun moteur : l'agent d'une carte finie est habillé « au travail » puis « fini » par le point d'essai
 * (`window.belugaEssai.agent` / `.rapport`), et les mises à jour de CET agent venues du démon sont retenues pendant
 * l'essai. Le réglage enregistré n'est jamais touché ; une session d'une heure est fabriquée puis retirée.
 *
 *   npm run dev --workspace web -- --port 7099
 *   HAIKO_REPLI_URL=http://localhost:7099 env -u BELUGA_TOKEN node scripts/verif-repli-fin-de-tour.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { cheminDeLaBaseServie, dossierDesDonnees } from './lib/base-servie.mjs';
const require = createRequire(import.meta.url);
const DONNEES = dossierDesDonnees();
const D = require(path.join(DONNEES, '../node_modules/better-sqlite3'));
const BASE = process.env.HAIKO_REPLI_URL || 'http://localhost:7099';
const SORTIE = path.join(os.tmpdir(), 'verif-repli-fin-de-tour');
const db = new D(cheminDeLaBaseServie(DONNEES));
/* Une carte rangée dont l'agent de tâche a fini : son fil a des listes de tâches passées. */
const cible = db
  .prepare("SELECT c.id AS carte, c.project_id AS projet, a.id AS agent FROM cards c JOIN agents a ON a.card_id = c.id WHERE a.role = 'task' AND a.status = 'done' AND c.column_key IN ('to_deploy', 'archived') ORDER BY c.updated_at DESC LIMIT 1")
  .get();
if (!cible) {
  console.error('Aucune carte finie dans la base servie : rien à vérifier.');
  process.exit(1);
}
const { projet: PROJET, carte: CARTE, agent: AGENT } = cible;
const cookie = crypto.randomBytes(24).toString('hex');
const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(empreinte, Date.now(), Date.now() + 3_600_000, 'vérification du repli de fin de tour');
const resultats = [];
const noter = (nom, ok, detail = '') => resultats.push(`${ok ? 'OK   ' : 'ÉCHEC'} ${nom} ${detail}`);
const b = await chromium.launch({ channel: 'chrome' });
try {
  for (const [largeur, hauteur, theme] of [[1440, 900, 'light'], [1440, 900, 'dark'], [390, 844, 'light'], [390, 844, 'dark']]) {
    const ctx = await b.newContext({ viewport: { width: largeur, height: hauteur }, colorScheme: theme, serviceWorkers: 'block' });
    await ctx.addCookies([{ name: 'beluga_session', value: cookie, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await ctx.newPage();
    /* Le vrai démon rétablit l'état réel de l'agent : ses mises à jour de CET agent sont retenues pendant l'essai. */
    await page.routeWebSocket(/\/ws/, (ws) => {
      const serveur = ws.connectToServer();
      serveur.onMessage((m) => {
        if (typeof m === 'string' && m.includes('"agent.upsert"') && m.includes(AGENT)) return;
        /* Le réglage réel garde la bande repliée : l'essai la montre dépliée, sans toucher au réglage enregistré. */
        ws.send(typeof m === 'string' ? m.replace('"captures.repliee":true', '"captures.repliee":false') : m);
      });
      ws.onMessage((m) => serveur.send(m));
    });
    await page.addInitScript(() => localStorage.setItem('beluga.volet-taches.deplie', '1'));
    await page.goto(`${BASE}/#projet/${PROJET}/tache/${CARTE}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.belugaEssai?.pret?.(), null, { timeout: 30000 });
    await page.waitForFunction((a) => window.belugaEssai.agent(a, {}), AGENT, { timeout: 30000 });
    await page.waitForSelector('[data-volet="taches"], [data-message-id], [data-message]', { timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(4000);
    const nom = `${largeur} px ${theme}`;
    const lire = () => page.evaluate(() => {
      const v = document.querySelector('[data-volet="taches"]');
      return { volet: !!v, parLeTour: !!v?.hasAttribute('data-liste-repliee-par-le-tour'), lignes: v ? v.querySelectorAll('[data-case-de-tache]').length : 0, entete: v?.innerText.split('\n')[0] ?? '', question: !!document.querySelector('[data-question-en-attente], [data-panneau-question]'), captures: document.querySelector('[data-captures-repli]')?.getAttribute('data-captures-repli') ?? null };
    });
    const avant = await lire();
    noter(`${nom} : une conversation déjà finie s'ouvre sans repli de fin de tour`, !avant.parLeTour, JSON.stringify(avant));
    /* Le travail démarre : l'agent se met au travail, une réponse s'écrit. */
    await page.evaluate((a) => window.belugaEssai.agent(a, { status: 'running', tourVivantDepuis: Date.now(), endedAt: undefined }), AGENT);
    await page.evaluate((a) => window.belugaEssai.rapport(a, 'Je travaille…', { enEcriture: true, id: 'essai-repli', todos: [{ label: 'Lire', state: 'done' }, { label: 'Modifier', state: 'running' }] }), AGENT);
    await page.waitForTimeout(900);
    const pendant = await lire();
    if (pendant.captures) noter(`${nom} : pendant le travail, « Ce que l'agent a vu » est ouvert`, pendant.captures === 'ouvert');
    noter(`${nom} : pendant le travail, la liste est ouverte`, pendant.volet && !pendant.parLeTour && pendant.lignes > 0 && !pendant.entete.startsWith('Liste'), JSON.stringify(pendant));
    await page.screenshot({ path: `${SORTIE}-${largeur}-${theme}-pendant.png` });
    /* Le travail se termine. */
    await page.evaluate((a) => window.belugaEssai.rapport(a, 'Travail terminé.', { id: 'essai-repli', todos: [{ label: 'Lire', state: 'done' }, { label: 'Modifier', state: 'done' }] }), AGENT);
    await page.evaluate((a) => window.belugaEssai.agent(a, { status: 'done', tourVivantDepuis: undefined, endedAt: Date.now() }), AGENT);
    await page.waitForTimeout(900);
    const apres = await lire();
    noter(`${nom} : à la fin du travail, la liste se replie`, apres.volet && apres.parLeTour && apres.lignes === 0, JSON.stringify(apres));
    if (apres.captures) noter(`${nom} : « Ce que l'agent a vu » se replie aussi`, apres.captures === 'ferme', apres.captures);
    await page.screenshot({ path: `${SORTIE}-${largeur}-${theme}-apres.png` });
    noter(`${nom} : le pli retenu n'a pas bougé`, (await page.evaluate(() => localStorage.getItem('beluga.volet-taches.deplie'))) === '1');
    /* Un appui rouvre. */
    await page.locator('[data-volet="taches"] button[aria-expanded]').first().click().catch(() => page.locator('[data-volet="taches"] button').first().click());
    await page.waitForTimeout(900);
    const rouvert = await lire();
    noter(`${nom} : un appui rouvre la liste`, rouvert.lignes > 0, JSON.stringify(rouvert));
    /* Le travail suivant rouvre tout seul. */
    await page.evaluate((a) => window.belugaEssai.agent(a, { status: 'running', tourVivantDepuis: Date.now(), endedAt: undefined }), AGENT);
    await page.evaluate((a) => window.belugaEssai.rapport(a, 'Je repars…', { enEcriture: true, id: 'essai-repli-2', todos: [{ label: 'Relire', state: 'running' }] }), AGENT);
    await page.waitForTimeout(900);
    const suivant = await lire();
    noter(`${nom} : le travail suivant rouvre la liste`, !suivant.parLeTour && suivant.lignes > 0, JSON.stringify(suivant));
    await ctx.close();
  }
} finally {
  await b.close();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}
console.log(resultats.join('\n'));
const echecs = resultats.filter((r) => r.startsWith('ÉCHEC')).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passent (captures : ${SORTIE}-*.png).`);
process.exit(echecs ? 1 : 0);
