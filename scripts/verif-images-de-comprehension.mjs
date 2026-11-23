/*
 * ESSAI : LES IMAGES D'UNE COMPRÉHENSION SE VOIENT EN IMAGES (14/11/2026, capture #fbac0). Ouvre une carte de cadrage
 * dont les compréhensions posent des lignes « ![…](piece:…) » et relève, pour chacune : les images rendues, celles
 * marquées comme neuves, et l'absence de tout lien « piece: » ou « ! » visible. Vise le serveur de développement
 * (HAIKO_IMAGES_URL, défaut http://localhost:7099), jamais BELUGA_URL ; session d'une heure hachée, retirée en partant ;
 * n'écrit rien (lecture de carte et réglages non relayés).
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-images-de-comprehension.mjs <projet> <carte> [capture.png]
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';

const [projet, carte, capture = '/tmp/comprehension-images.png'] = process.argv.slice(2);
if (!projet || !carte) {
  console.error('usage : essai-images-comprehension.mjs <projet> <carte> [capture.png]');
  process.exit(2);
}
const URL = process.env.HAIKO_IMAGES_URL || 'http://localhost:7099';
const cookie = randomBytes(24).toString('hex');
const jeton = createHash('sha256').update(cookie).digest('hex');
const db = new Database(process.env.HAIKO_BASE || '/root/beluga/data/beluga.db');
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?,?,?,?,?)').run(jeton, Date.now(), Date.now() + 3600000, 'essai-images', 'admin-premier');
const nav = await chromium.launch({ channel: 'chrome' });
let echec = false;
try {
  const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await ctx.addCookies([{ name: 'beluga_session', value: cookie, url: URL }]);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const serveur = ws.connectToServer();
    ws.onMessage((m) => {
      try {
        const o = JSON.parse(String(m));
        if (/^(prefs\.set|card\.(read|update|create|move|delete))/.test(o?.cmd?.type ?? '')) return;
      } catch {}
      serveur.send(m);
    });
    serveur.onMessage((m) => ws.send(m));
  });
  await page.goto(`${URL}/#projet/${projet}/tache/${carte}`);
  await page.waitForSelector('[data-moment="comprehension"]', { timeout: 40000 });
  await page.waitForTimeout(3000);
  const releves = await page.$$eval('[data-moment="comprehension"]', (els) =>
    els.map((el) => ({
      images: el.querySelectorAll('[data-illustration-du-plan] img').length,
      neuves: el.querySelectorAll('[data-illustration-du-plan] [data-ecart-de-comprehension]').length,
      liensPiece: [...el.querySelectorAll('a')].filter((a) => (a.getAttribute('href') || '').startsWith('piece:')).length,
      exclamations: [...el.querySelectorAll('p')].filter((p) => /^!\S/.test((p.textContent || '').trim())).length,
    })),
  );
  for (const [i, r] of releves.entries()) {
    const bon = r.liensPiece === 0 && r.exclamations === 0;
    if (!bon) echec = true;
    console.log(`${bon ? '✓' : '✗'} compréhension ${i + 1} : ${r.images} image(s), ${r.neuves} neuve(s), ${r.liensPiece} lien(s) piece:, ${r.exclamations} « ! » visible(s)`);
  }
  if (!releves.some((r) => r.images > 0)) {
    echec = true;
    console.log('✗ aucune image rendue dans les compréhensions');
  }
  const neuve = await page.$('[data-illustration-du-plan] [data-ecart-de-comprehension]');
  if (neuve) await neuve.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
  /* LES IMAGES SONT CHARGÉES, PAS SEULEMENT POSÉES : une image cassée se dessinerait en petit rond vide. */
  const tailles = await page.$$eval('[data-illustration-du-plan] img', (imgs) => imgs.map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth, complet: i.complete })));
  const vues = tailles.filter((x) => x.complet);
  const cassees = vues.filter((x) => !x.w);
  if (cassees.length) echec = true;
  console.log(`${cassees.length ? '✗' : '✓'} ${vues.length - cassees.length}/${vues.length} image(s) chargée(s) ${cassees.slice(0, 2).map((x) => x.src).join(' ')}`);
  await page.screenshot({ path: capture });
} finally {
  await nav.close();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(jeton);
  db.close();
}
process.exit(echec ? 1 : 0);
