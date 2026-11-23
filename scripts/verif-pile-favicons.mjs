#!/usr/bin/env node
/**
 * La pile des favicons d'un PROJET RÉUNI, dans la colonne de gauche : chaque
 * regroupement qui a des membres montre au plus trois de leurs icônes,
 * décalées de 4 px, sur 15 px de haut ; et les lignes gardent la même position
 * verticale entre colonne réduite et dépliée (MEM-2899).
 *
 * Session d'une heure fabriquée puis retirée (jeton HACHÉ), jamais BELUGA_URL :
 *   HAIKO_PILE_URL=http://localhost:7099 node scripts/verif-pile-favicons.mjs
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { cheminDeLaBaseServie } from './base-servie.mjs';

const BASE = process.env.HAIKO_PILE_URL || 'http://localhost:7099';
const CAPTURES = process.env.HAIKO_PILE_CAPTURES || '/tmp';
const PRINCIPAL = path.resolve(process.env.BELUGA_DATA || '/root/beluga/data', '..');

function base() {
  const require = createRequire(import.meta.url);
  return require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(cheminDeLaBaseServie());
}

const cookie = crypto.randomBytes(24).toString('hex');
const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
{
  const d = base();
  const n = Date.now();
  d.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?,?,?,?)')
    .run(empreinte, n, n + 3600_000, 'vérif pile des favicons');
  d.close();
}
const retirerLaSession = () => {
  const d = base();
  d.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  d.close();
};

let echecs = 0;
const noter = (ok, texte) => { if (!ok) echecs += 1; console.log(`  ${ok ? ' OK  ' : 'ÉCHEC'} ${texte}`); };

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
  await contexte.addCookies([{ name: 'beluga_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-regroupement-colonne]', { timeout: 30_000 });
  await page.waitForTimeout(800);

  const piles = await page.$$eval('[data-regroupement-colonne] [data-pile-favicons]', (els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const enfants = [...el.children].map((c) => c.getBoundingClientRect().left - r.left);
      return { n: Number(el.getAttribute('data-pile-favicons')), largeur: r.width, hauteur: r.height, decalages: enfants };
    }),
  );
  noter(piles.length > 0, `au moins une pile de favicons (${piles.length})`);
  for (const p of piles) {
    noter(p.n >= 1 && p.n <= 3, `pile de ${p.n} icône(s), trois au plus`);
    noter(Math.round(p.hauteur) === 15, `hauteur 15 px (${p.hauteur})`);
    noter(Math.round(p.largeur) === 15 + 4 * (p.n - 1), `largeur ${p.largeur} = 15 + 4 × ${p.n - 1}`);
    noter(p.decalages.every((d, i) => Math.round(d) === 4 * i), `décalages ${p.decalages.map(Math.round).join('/')}`);
  }
  await page.locator('aside[data-zone="gauche"]').screenshot({ path: `${CAPTURES}/pile-favicons-depliee.png` });

  /* MEM-2899 : mêmes positions verticales réduite / survolée. Le réglage
     `sidebar.reduite` est partagé en base : on ne le bascule pas, on compare
     seulement quand la colonne est DÉJÀ réduite. */
  const colonne = await page.getAttribute('[data-colonne-projets]', 'data-colonne-projets');
  const hauts = () => page.$$eval('[data-regroupement-colonne]', (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  if (colonne === 'reduite') {
    const avant = await hauts();
    await page.locator('aside[data-zone="gauche"]').screenshot({ path: `${CAPTURES}/pile-favicons-reduite.png` });
    const boite = await page.locator('aside[data-zone="gauche"]').boundingBox();
    await page.mouse.move(boite.x + boite.width / 2, boite.y + 300);
    await page.waitForTimeout(700);
    const apres = await hauts();
    noter(JSON.stringify(avant) === JSON.stringify(apres), `lignes au même niveau réduite/survolée (${avant.join(',')} / ${apres.join(',')})`);
  } else {
    console.log(`  (colonne « ${colonne} » : comparaison réduite/survolée sautée)`);
  }
} finally {
  await navigateur.close();
  retirerLaSession();
}
console.log(echecs ? `\n${echecs} échec(s)` : '\nTout est bon.');
process.exit(echecs ? 1 : 0);
