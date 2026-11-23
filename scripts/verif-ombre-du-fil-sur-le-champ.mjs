#!/usr/bin/env node
/**
 * L'ombre du bas du fil d'une discussion tient-elle sur le champ d'écriture ? (capture #d470, 16/11/2026)
 *
 *   1. le voile du bas du fil a la largeur du champ [data-composer] (±2 px) et ses bords alignés dessus ;
 *   2. son masque latéral s'éteint sur plus de 24 px (le fondu large du fil), à 1440 et 390 px.
 * Une carte à contenu assez long pour défiler est ouverte ; sans elle le contrôle le dit et s'arrête.
 *
 *   BELUGA_VERIF_URL=http://localhost:7099 node scripts/verif-ombre-du-fil-sur-le-champ.mjs
 *   BELUGA_VERIF_CAPTURES=/tmp/ombre  → garde une capture par taille et clarté
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const BASE = process.env.BELUGA_VERIF_URL || 'http://localhost:7099';
const DOSSIER = process.env.BELUGA_VERIF_CAPTURES || '';
let echecs = 0;
const noter = (nom, ok, detail = '') => {
  if (!ok) echecs += 1;
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const db = new Database(cheminDeLaBaseServie());
const token = crypto.randomBytes(32).toString('hex');
const empreinte = crypto.createHash('sha256').update(token).digest('hex');
const maintenant = Date.now();
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(empreinte, maintenant, maintenant + 3600_000, 'vérification de l’ombre du fil');
db.close();

const navigateur = await chromium.launch({ channel: 'chrome' });
try {
  for (const [largeur, hauteur] of [[1440, 900], [390, 844]]) {
    for (const clarte of ['clair', 'sombre']) {
      const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur } });
      await contexte.addCookies([{ name: 'beluga_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' }]);
      await contexte.addInitScript((c) => { try { localStorage.setItem('beluga-theme-flash', c); } catch {} }, clarte);
      const page = await contexte.newPage();
      await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
        const serveur = ws.connectToServer();
        ws.onMessage((m) => {
          try {
            const l = JSON.parse(String(m));
            if (['prefs.set', 'card.read', 'project.read'].includes(l?.cmd?.type ?? l?.type)) return;
          } catch {}
          serveur.send(m);
        });
      });
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForSelector('[data-zone="centre"]', { timeout: 60_000 });
      await page.evaluate((c) => {
        document.documentElement.dataset.theme = c;
        document.documentElement.classList.toggle('dark', c === 'sombre');
      }, clarte);
      await page.waitForTimeout(1500);
      const cartes = page.locator('[data-zone="centre"] tbody tr');
      const mobile = largeur < 600;
      if (!mobile) await page.waitForSelector('[data-zone="centre"] tbody tr', { timeout: 30_000 }).catch(() => {});
      const n = mobile ? 6 : Math.min(await cartes.count(), 12);
      let trouve = false;
      for (let i = 0; i < n && !trouve; i += 1) {
        if (i > 0) await page.goto(BASE, { waitUntil: 'domcontentloaded' }).then(() => page.waitForTimeout(3000)).catch(() => {});
        // Téléphone : la liste des agents n'est pas un tableau, on touche la i-ème ligne.
        if (mobile) await page.mouse.click(150, 175 + i * 63);
        else await cartes.nth(i).click({ timeout: 5000 }).catch(() => {});
        await page.waitForSelector('[data-composer]', { timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(1500);
        trouve = await page.evaluate(() => {
          const z = document.querySelector('[data-fil="parcours"]');
          const c = document.querySelector('[data-composer]');
          if (!z || !c) return false;
          z.scrollTop = 0;
          return z.scrollHeight > z.clientHeight + 40;
        });
      }
      const nom = `${largeur}px ${clarte}`;
      if (!trouve) { noter(`${nom} : une carte à fil assez long`, false, 'aucune carte ouverte ne défile'); await contexte.close(); continue; }
      const m = await page.evaluate(() => {
        const z = document.querySelector('[data-fil="parcours"]');
        z.scrollTop = Math.max(0, z.scrollHeight / 3);
        return null;
      });
      await page.waitForTimeout(600);
      const mesure = await page.evaluate(() => {
        const c = document.querySelector('[data-composer]').getBoundingClientRect();
        const v = document.querySelector('[data-fil="parcours"]').closest('div[class*="relative"]').querySelector('[data-voile-defilement="vertical-fin"]')
          ?? document.querySelector('[data-voile-defilement="vertical-fin"]');
        const r = v.getBoundingClientRect();
        const ombre = v.children[v.children.length - 1];
        return { composer: [c.left, c.right], voile: [r.left, r.right], masque: getComputedStyle(ombre).maskImage };
      });
      const dg = Math.abs(mesure.voile[0] - mesure.composer[0]);
      const dd = Math.abs(mesure.voile[1] - mesure.composer[1]);
      noter(`${nom} : l'ombre est calée sur le champ`, dg <= 2 && dd <= 2, `champ ${mesure.composer.map(Math.round)}, ombre ${mesure.voile.map(Math.round)}`);
      const bande = /(?:black|rgb\(0, 0, 0\)|rgba\(0, 0, 0, 1\)) (\d+(?:\.\d+)?)px/.exec(mesure.masque);
      noter(`${nom} : fondu des côtés plus large que 24 px`, !!bande && +bande[1] > 24, bande ? `${bande[1]} px` : mesure.masque.slice(0, 80));
      if (DOSSIER) await page.screenshot({ path: `${DOSSIER}-${largeur}-${clarte}.png` });
      await contexte.close();
    }
  }
} finally {
  const d = new Database(cheminDeLaBaseServie());
  d.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  d.close();
  await navigateur.close();
}
console.log(echecs ? `\n${echecs} échec(s)` : '\nTout est conforme');
process.exit(echecs ? 1 : 0);
