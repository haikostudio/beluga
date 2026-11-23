#!/usr/bin/env node
/**
 * LA PAGE « NOTIFICATIONS » DES RÉGLAGES : L'APPAREIL, LES APPAREILS CONNECTÉS.
 *
 *   npm run build && env -u BELUGA_TOKEN node scripts/verif-notifications-reglages.mjs
 *
 * Sur un démon JETABLE (port libre, base neuve), dans un vrai navigateur :
 *   1. la page a son groupe et son titre « Notifications » dans le menu ;
 *   2. elle montre l'interrupteur de CET appareil, la liste des appareils
 *      connectés (ceux du compte seulement, par leur NOM, jamais l'adresse
 *      d'abonnement), les types de notifications et les heures de silence ;
 *   3. retirer un appareil le fait disparaître de la liste ET de la base ;
 *   4. le compte d'un autre ne voit ni ne retire rien ici.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_NOTIFICATIONS_PORT || 7241);
const BASE = `http://127.0.0.1:${PORT}`;
const { DATA, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-notifications-', port: PORT, signaux: true });

const echecs = [];
const noter = (nom, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : ' ÉCHEC'}  ${nom}${detail ? ` — ${detail}` : ''}`);
  if (!ok) echecs.push(nom);
};

if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}

const sha = (valeur) => crypto.createHash('sha256').update(valeur).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const JETON_AUTRE = crypto.randomBytes(32).toString('hex');
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
{
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  for (const [id, identifiant, jeton] of [
    ['u-admin-essai', 'admin-essai', JETON],
    ['u-autre-essai', 'autre-essai', JETON_AUTRE],
  ]) {
    db.prepare(
      `INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le) VALUES (?, ?, 'admin', ?, ?, 'x', 1, ?)`,
    ).run(id, identifiant, identifiant, crypto.randomBytes(16).toString('hex'), maintenant);
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(
      sha(jeton),
      maintenant,
      maintenant + 3600_000,
      'verif-notifications',
      id,
    );
  }
  db.close();
}

const appel = (route, jeton, corps, userAgent) =>
  fetch(`${BASE}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `beluga_session=${jeton}`, ...(userAgent ? { 'user-agent': userAgent } : {}) },
    body: JSON.stringify(corps),
  }).then((r) => r.json());

/* Deux appareils pour le compte d'essai, un pour l'autre compte — par la VRAIE route d'abonnement. */
await appel('/api/push/subscribe', JETON, { endpoint: 'https://push.exemple/telephone', keys: {} }, IPHONE);
await appel('/api/push/subscribe', JETON, { endpoint: 'https://push.exemple/ordinateur', keys: {} }, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
await appel('/api/push/subscribe', JETON_AUTRE, { endpoint: 'https://push.exemple/autre', keys: {} }, IPHONE);

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 860 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: JETON, domain: '127.0.0.1', path: '/' }]);
  const page = await contexte.newPage();
  await page.goto(`${BASE}/#reglages/notifications`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  const liste = page.locator('[data-liste-appareils]');
  await liste.waitFor({ timeout: 30_000 }).catch(() => undefined);
  const menu = page.locator('[data-menu-reglages]');
  noter('le menu a un groupe « Notifications »', (await menu.getByText('Notifications', { exact: true }).count()) >= 1);
  noter('l’interrupteur de cet appareil est là', (await page.getByText('Notifications sur cet appareil').count()) === 1);
  const noms = await page.locator('[data-appareil]').allInnerTexts();
  noter('la liste montre les deux appareils du compte, par leur nom', noms.length === 2 && noms.some((n) => n.includes('iPhone · Safari')) && noms.some((n) => n.includes('Windows · Chrome')), noms.join(' | ').replace(/\n/g, ' '));
  const html = await page.content();
  noter('aucune adresse d’abonnement n’est dans la page', !html.includes('push.exemple'));
  noter('les types de notifications et les heures de silence restent', (await page.getByText('Quand une tâche se termine').count()) === 1 && (await page.getByText('Heures de silence').count()) >= 1);

  await page.locator('[data-appareil]').first().getByRole('button').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-appareil]').length === 1, null, { timeout: 15_000 }).catch(() => undefined);
  noter('retirer un appareil le fait disparaître de la liste', (await page.locator('[data-appareil]').count()) === 1);
  {
    const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
    const restants = db.prepare('SELECT endpoint FROM push_subs WHERE user_id = ?').all('u-admin-essai').length;
    const autre = db.prepare('SELECT endpoint FROM push_subs WHERE user_id = ?').all('u-autre-essai').length;
    db.close();
    noter('…et de la base, sans toucher à l’appareil d’un autre compte', restants === 1 && autre === 1, `${restants} / ${autre}`);
  }

  const autre = await appel('/api/push/appareils', JETON_AUTRE, {});
  noter('l’autre compte ne voit que le sien', autre.appareils.length === 1);
  const refus = await appel('/api/push/appareils/retirer', JETON_AUTRE, { id: (await appel('/api/push/appareils', JETON, {})).appareils[0].id });
  noter('l’autre compte ne retire pas l’appareil d’autrui', refus.ok === false);
} finally {
  await navigateur.close();
}

if (echecs.length) {
  console.error(`\n${echecs.length} échec(s) :\n- ${echecs.join('\n- ')}\n\nJournal du démon :\n${journal.join('').slice(-1500)}`);
  process.exit(1);
}
console.log('\nLa page Notifications tient.');
process.exit(0);
