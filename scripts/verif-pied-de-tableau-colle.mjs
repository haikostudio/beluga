#!/usr/bin/env node
/**
 * LE PIED D'UN TABLEAU TOUCHE LE BAS DE LA ZONE QUI DÉFILE (carte « Audits SEO et GEO dans le Marketing », 18/11/2026,
 * capture #7e81 : « pourquoi le footer est décalé du bord ? il faut qu'il soit collé, et pareil partout »).
 *
 * Ouvre des écrans qui portent un tableau commun paginé (accueil d'un projet : tâches et coûts ; Tableaux de bord), à
 * 1440 px puis 390 px, en clair puis en sombre. Dans chaque zone qui défile, on se place au milieu d'un tableau plus
 * long que l'écran : son pied (`[data-tableau-pied]`, collé) doit toucher le bas de la zone (écart ≤ 1 px), et le
 * point juste au-dessus du bord bas doit être le pied lui-même — aucune ligne visible dessous.
 *
 * Vise le serveur de DÉVELOPPEMENT de la copie (`HAIKO_PIED_URL`, défaut http://localhost:7071), jamais `BELUGA_URL`.
 * La session d'une heure est fabriquée dans la base servie (jeton haché) et retirée à la fin. Captures dans
 * `HAIKO_PIED_CAPTURES` (défaut /tmp/pied-de-tableau).
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const BASE = process.env.HAIKO_PIED_URL ?? 'http://localhost:7071';
const BASE_DE_DONNEES = process.env.HAIKO_PIED_DB ?? '/root/beluga/data/beluga.db';
const CAPTURES = process.env.HAIKO_PIED_CAPTURES ?? '/tmp/pied-de-tableau';
const PROJET = process.env.HAIKO_PIED_PROJET ?? '';
fs.mkdirSync(CAPTURES, { recursive: true });

const db = new Database(BASE_DE_DONNEES);
const jeton = crypto.randomBytes(24).toString('hex');
const hache = crypto.createHash('sha256').update(jeton).digest('hex');
const T = Date.now();
const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY cree_le LIMIT 1").get()?.id;
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(hache, T, T + 3600_000, 'essai pied de tableau', admin);
/* Le projet qui a le plus de cartes : son accueil a un tableau des tâches paginé. */
const projet = PROJET || db.prepare('SELECT project_id AS id FROM cards GROUP BY project_id ORDER BY COUNT(*) DESC LIMIT 1').get()?.id;

let echecs = 0;
let reussites = 0;
const ok = (vrai, texte) => {
  if (vrai) reussites++;
  else echecs++;
  console.log(`${vrai ? '✓' : '✗'} ${texte}`);
};

/** Chaque pied visible : on fait défiler sa zone jusqu'au milieu de son tableau, puis on mesure. */
async function mesurer(page) {
  return page.evaluate(async () => {
    const sortie = [];
    const pieds = [...document.querySelectorAll('[data-tableau-pied]')].filter((p) => p instanceof HTMLElement && p.offsetParent);
    for (const pied of pieds) {
      let zone = pied.parentElement;
      while (zone && zone !== document.body && !/(auto|scroll)/.test(getComputedStyle(zone).overflowY)) zone = zone.parentElement;
      if (!zone || zone === document.body) continue;
      const tableau = pied.closest('[data-tableau]') ?? pied.parentElement;
      const cadreZone = zone.getBoundingClientRect();
      const cadreTableau = tableau.getBoundingClientRect();
      if (cadreTableau.height < cadreZone.height * 0.6) {
        sortie.push({ tableau: tableau.getAttribute('data-tableau') ?? '?', court: true });
        continue;
      }
      /* Le haut du tableau au tiers de la zone : le tableau descend sous le bord, le pied est donc collé. */
      zone.scrollTop += cadreTableau.top - cadreZone.top - cadreZone.height / 3;
      await new Promise((r) => setTimeout(r, 400));
      const z = zone.getBoundingClientRect();
      const p = pied.getBoundingClientRect();
      const t = tableau.getBoundingClientRect();
      const x = p.left + p.width / 2;
      const dessous = document.elementFromPoint(x, z.bottom - 1);
      /* La flèche « Page suivante » n'est recouverte par rien (terminal, bulle vocale du coin bas droit). */
      const suivante = pied.querySelector('[data-page-suivante]')?.getBoundingClientRect();
      const surSuivante = suivante ? document.elementFromPoint(suivante.left + suivante.width / 2, suivante.top + suivante.height / 2) : null;
      sortie.push({
        tableau: tableau.getAttribute('data-tableau') ?? '?',
        colle: t.bottom > z.bottom + 2,
        ecart: Math.round((z.bottom - p.bottom) * 10) / 10,
        piedAuBord: !!dessous && pied.contains(dessous),
        suivanteLibre: !suivante || (!!surSuivante && pied.contains(surSuivante)),
        retrait: getComputedStyle(zone).paddingBottom,
      });
    }
    return sortie;
  });
}

const navigateur = await chromium.launch({ channel: 'chrome' });
try {
  for (const theme of ['light', 'dark']) {
    for (const [largeur, hauteur, appareil] of [
      [1440, 900, 'ordinateur'],
      [390, 844, 'téléphone'],
    ]) {
      const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, colorScheme: theme });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE }]);
      const page = await contexte.newPage();
      for (const [nom, fragment] of [
        ['accueil du projet', `projet/${projet}`],
        ['Tableaux de bord', 'en-route'],
      ]) {
        await page.goto(`${BASE}/#${fragment}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        const vu = await page.locator('[data-tableau-pied]').first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
        if (!vu) {
          ok(appareil === 'téléphone', `[${theme} · ${appareil}] ${nom} : aucun tableau paginé${appareil === 'téléphone' ? ' (liste en cartes sur téléphone)' : ''}`);
          continue;
        }
        /* Les tableaux du bas de page (coûts) arrivent après le premier : on attend qu'ils soient posés. */
        await page.waitForTimeout(3500);
        const mesures = await mesurer(page);
        const longs = mesures.filter((m) => !m.court && m.colle);
        if (!longs.length) ok(mesures.length > 0, `[${theme} · ${appareil}] ${nom} : tableaux trop courts pour coller leur pied (${mesures.map((m) => m.tableau).join(', ') || 'aucun pied mesuré'})`);
        for (const m of longs) {
          ok(Math.abs(m.ecart) <= 1 && m.piedAuBord, `[${theme} · ${appareil}] ${nom} · ${m.tableau} : pied collé au bord (écart ${m.ecart} px, retrait de la zone ${m.retrait}, bord bas = le pied : ${m.piedAuBord})`);
          ok(m.suivanteLibre, `[${theme} · ${appareil}] ${nom} · ${m.tableau} : « Page suivante » n'est recouverte par aucun bouton flottant`);
        }
        await page.screenshot({ path: path.join(CAPTURES, `${nom.replace(/\s+/g, '-')}-${appareil}-${theme}.png`) });
      }
      await contexte.close();
    }
  }
} finally {
  await navigateur.close();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(hache);
  db.close();
}
console.log(`\n${reussites}/${reussites + echecs} contrôles passés.`);
process.exit(echecs ? 1 : 0);
