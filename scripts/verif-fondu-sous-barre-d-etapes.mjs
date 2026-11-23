#!/usr/bin/env node
/**
 * LE FONDU DU HAUT DU FIL D'UNE CARTE NE MORD PAS SUR LA BARRE D'ÉTAPES.
 *
 * Sur ordinateur, la barre « Demande · Compréhension · Travail · À déployer ·
 * Archivée » est posée au-dessus du fil qui défile. Le voile du haut de ce fil
 * (`ZoneDefilement`) partait collé à elle, et son ombre mangeait le bas des
 * libellés (capture #d12b). On ouvre une vraie carte, on fait défiler le fil,
 * et on mesure, en clair puis en sombre : le voile du haut est allumé, et il
 * commence au moins 8 px sous le bas de la barre.
 *
 * Vise le serveur de DÉVELOPPEMENT (jamais `BELUGA_URL`, l'application publiée) :
 *   BELUGA_VERIF_URL=http://localhost:7099 node scripts/verif-fondu-sous-barre-d-etapes.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const BASE = process.env.BELUGA_VERIF_URL || 'http://localhost:7099';
const ECART_MINIMAL = 8;

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

const db = new Database(cheminDeLaBaseServie());
const token = crypto.randomBytes(32).toString('hex');
const empreinte = crypto.createHash('sha256').update(token).digest('hex');
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
  empreinte,
  Date.now(),
  Date.now() + 3_600_000,
  'vérification du fondu sous la barre d’étapes',
);
/* Une carte qui a un long fil : celle dont l'agent a le plus de messages. */
const carte = db
  .prepare(
    `SELECT c.id AS id, c.project_id AS projet, COUNT(m.id) AS n
       FROM cards c JOIN agents a ON a.card_id = c.id JOIN messages m ON m.agent_id = a.id
      WHERE c.updated_at > ? GROUP BY c.id ORDER BY n DESC LIMIT 1`,
  )
  .get(Date.now() - 7 * 24 * 3_600_000);

const navigateur = await chromium.launch({ channel: 'chrome' });
try {
  if (!carte) throw new Error('aucune carte avec un fil dans la base servie');
  for (const sombre of [false, true]) {
    const contexte = await navigateur.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: sombre ? 'dark' : 'light',
      serviceWorkers: 'block',
    });
    await contexte.addCookies([
      { name: 'beluga_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await contexte.newPage();
    await page.goto(`${BASE}/#projet/${carte.projet}/tache/${carte.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-barre-du-fil]', { timeout: 30_000 });
    await page.waitForSelector('[data-fil="parcours"]', { timeout: 30_000 });
    await page.waitForTimeout(1500);
    // Le voile du haut est le voisin de la zone qui défile, dans la même enveloppe.
    const lireLeVoile = () =>
      Array.from(document.querySelectorAll('[data-voile-defilement="vertical-debut"]')).find((v) =>
        v.parentElement?.contains(document.querySelector('[data-fil="parcours"]')),
      );
    await page.evaluate(`(${lireLeVoile})()?.parentElement && (() => {
      const fil = document.querySelector('[data-fil="parcours"]');
      const zone = [fil, ...fil.querySelectorAll('*'), ...[fil.parentElement]].find((e) => e && e.scrollHeight > e.clientHeight + 8);
      if (zone) { zone.scrollTop = 400; zone.dispatchEvent(new Event('scroll')); }
    })()`);
    await page.waitForTimeout(800);
    const mesure = await page.evaluate(`(() => {
      const barre = document.querySelector('[data-barre-du-fil]');
      const voile = (${lireLeVoile})();
      if (!barre || !voile) return null;
      return {
        basBarre: Math.round(barre.firstElementChild.getBoundingClientRect().bottom),
        hautVoile: Math.round(voile.getBoundingClientRect().top),
        allume: voile.getAttribute('data-voile-allume'),
      };
    })()`);
    const theme = sombre ? 'sombre' : 'clair';
    noter(`${theme} : le voile du haut du fil existe`, !!mesure, JSON.stringify(mesure));
    if (mesure) {
      noter(
        `${theme} : le voile commence au moins ${ECART_MINIMAL} px sous la barre d’étapes`,
        mesure.hautVoile - mesure.basBarre >= ECART_MINIMAL && mesure.allume === 'oui',
        `écart ${mesure.hautVoile - mesure.basBarre} px, voile ${mesure.allume}`,
      );
    }
    await page.screenshot({ path: `/tmp/fondu-sous-barre-${theme}.png`, clip: { x: 0, y: 0, width: 1440, height: 260 } });
    await contexte.close();
  }
} catch (err) {
  noter('la page s’ouvre', false, err?.message ?? String(err));
} finally {
  await navigateur.close();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`${resultats.length - echecs}/${resultats.length}`);
process.exit(echecs ? 1 : 0);
