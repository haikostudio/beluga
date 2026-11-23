#!/usr/bin/env node
/**
 * LA BARRE DE DÉFILEMENT AU BORD, LES ÉTAPES ALIGNÉES, RIEN QUI TOURNE AVANT LE PREMIER ENVOI (15/11/2026).
 *
 * 1. Sur une conversation de carte à 1440 px, la zone qui défile s'étend jusqu'au bord de la page
 *    (`data-zone-jusqu-au-bord`) : sa barre dessinée tombe à 2 px du bord droit de la page, la colonne de lecture
 *    garde ses 820 px au plus, centrée. Même contrôle sur quelques pages de service.
 * 2. Dans la ligne d'étapes collée au champ d'écriture, dépliée : le centre de chaque rond tombe sous celui du titre.
 * 3. Une carte sans aucun message : rien ne tourne (`.animate-spin`) dans la ligne d'étapes ni dans le flux.
 * 4. Sur téléphone (390 px), la zone ne s'étend pas : la colonne y occupe déjà toute la largeur.
 *
 * Captures écrites dans le dossier donné par `VERIF_CAPTURES` (défaut : /tmp/verif-barre-au-bord).
 * Vise le serveur de DÉVELOPPEMENT (jamais `BELUGA_URL`) :
 *   BELUGA_VERIF_URL=http://localhost:7099 node scripts/verif-barre-au-bord-et-etapes.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const BASE = process.env.BELUGA_VERIF_URL || 'http://localhost:7099';
const CAPTURES = process.env.VERIF_CAPTURES || '/tmp/verif-barre-au-bord';
fs.mkdirSync(CAPTURES, { recursive: true });

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
  'vérification de la barre au bord et des étapes',
);
const longue = db
  .prepare(
    `SELECT c.id AS id, c.project_id AS projet, COUNT(m.id) AS n
       FROM cards c JOIN agents a ON a.card_id = c.id JOIN messages m ON m.agent_id = a.id
      WHERE c.updated_at > ? GROUP BY c.id HAVING n BETWEEN 12 AND 40 ORDER BY c.updated_at DESC LIMIT 1`,
  )
  .get(Date.now() - 7 * 24 * 3_600_000);
const neuve = db
  .prepare(
    `SELECT c.id AS id, c.project_id AS projet FROM cards c
      WHERE c.column_key = 'planned' AND NOT EXISTS (
        SELECT 1 FROM agents a JOIN messages m ON m.agent_id = a.id WHERE a.card_id = c.id)
      ORDER BY c.updated_at DESC LIMIT 1`,
  )
  .get();

/** Mesure la zone de la conversation : son étendue, sa barre, la colonne de son contenu, le bord de sa page. */
const mesurerLaZone = (selecteur) => {
  const zone = document.querySelector(selecteur);
  if (!zone) return null;
  const enveloppe = zone.parentElement;
  const piste = enveloppe.querySelector(':scope > [data-barre-defilement="vertical"]');
  const bord = enveloppe.parentElement.closest('[data-bord-de-defilement], [data-page-de-zone], main[data-zone="centre"]');
  const style = getComputedStyle(zone);
  const contenuGauche = zone.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
  const contenuDroite = zone.getBoundingClientRect().right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
  return {
    etendue: enveloppe.hasAttribute('data-zone-jusqu-au-bord'),
    droitePiste: piste ? Math.round(piste.getBoundingClientRect().right) : null,
    droiteBord: bord ? Math.round(bord.getBoundingClientRect().right) : null,
    gaucheBord: bord ? Math.round(bord.getBoundingClientRect().left) : null,
    contenuGauche: Math.round(contenuGauche),
    contenuDroite: Math.round(contenuDroite),
  };
};

const navigateur = await chromium.launch({ channel: 'chrome' });
try {
  if (!longue) throw new Error('aucune carte avec un fil dans la base servie');
  for (const sombre of [false, true]) {
    const theme = sombre ? 'sombre' : 'clair';
    for (const largeur of [1440, 390]) {
      const telephone = largeur < 640;
      const contexte = await navigateur.newContext({
        viewport: { width: largeur, height: telephone ? 844 : 900 },
        colorScheme: sombre ? 'dark' : 'light',
        serviceWorkers: 'block',
      });
      await contexte.addCookies([
        { name: 'beluga_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
      ]);
      const page = await contexte.newPage();
      await page.goto(`${BASE}/#projet/${longue.projet}/tache/${longue.id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-fil="parcours"]', { timeout: 90_000 });
      /* Le fil doit être arrivé (et déborder) avant toute mesure : la silhouette ne défile pas. */
      await page
        .waitForFunction(() => {
          const fil = document.querySelector('[data-fil="parcours"]');
          return fil && fil.scrollHeight > fil.clientHeight + 200;
        }, null, { timeout: 90_000 })
        .catch(() => {});
      await page.waitForTimeout(800);
      await page.evaluate(() => {
        const fil = document.querySelector('[data-fil="parcours"]');
        fil.scrollTop = Math.max(0, fil.scrollHeight / 2);
        fil.dispatchEvent(new Event('scroll'));
      });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${CAPTURES}/conversation-${largeur}-${theme}.png` });
      const m = await page.evaluate(`(${mesurerLaZone})('[data-fil="parcours"]')`);
      if (telephone) {
        noter(`téléphone ${theme} : la conversation ne s'étend pas`, m && !m.etendue, JSON.stringify(m));
      } else {
        noter(`ordinateur ${theme} : la zone de la conversation s'étend au bord`, !!m?.etendue, JSON.stringify(m));
        noter(
          `ordinateur ${theme} : la barre tombe au bord droit de la page`,
          !!m && m.droitePiste !== null && Math.abs(m.droiteBord - m.droitePiste) <= 3,
          `piste ${m?.droitePiste}, bord ${m?.droiteBord}`,
        );
        const largeurContenu = m ? m.contenuDroite - m.contenuGauche : 0;
        const vides = m ? [m.contenuGauche - m.gaucheBord, m.droiteBord - m.contenuDroite] : [0, 0];
        noter(
          `ordinateur ${theme} : la colonne garde 820 px au plus, centrée`,
          largeurContenu > 300 && largeurContenu <= 820 && Math.abs(vides[0] - vides[1]) <= 2,
          `largeur ${largeurContenu}, vides ${vides.join('/')}`,
        );
        /* La molette posée dans la marge fait défiler le fil. */
        const avant = await page.evaluate(() => document.querySelector('[data-fil="parcours"]').scrollTop);
        await page.mouse.move(m.droiteBord - 40, 450);
        await page.mouse.wheel(0, avant > 0 ? -300 : 300);
        await page.waitForTimeout(400);
        const apres = await page.evaluate(() => document.querySelector('[data-fil="parcours"]').scrollTop);
        noter(`ordinateur ${theme} : la molette dans la marge fait défiler`, apres !== avant, `${avant} → ${apres}`);
      }

      /* LES ÉTAPES DÉPLIÉES SOUS LE TITRE, rond sous rond. */
      const titre = await page.$('[data-barre-en-ligne]');
      if (titre) {
        if (!(await page.$('[data-ligne-ouverte]'))) await titre.click();
        await page.waitForTimeout(400);
        const axes = await page.evaluate(() => {
          const centre = (e) => {
            const r = e.getBoundingClientRect();
            return r.left + r.width / 2;
          };
          const rondTitre = document.querySelector('[data-barre-en-ligne] > [data-rond-etape]');
          const ronds = [...document.querySelectorAll('[data-ligne-etapes] [data-segment] [data-rond-etape]')];
          const chevronTitre = document.querySelector('[data-barre-en-ligne] > svg:last-child');
          return {
            titre: rondTitre ? centre(rondTitre) : null,
            lignes: ronds.map(centre),
            chevron: chevronTitre ? Math.round(chevronTitre.getBoundingClientRect().right) : null,
          };
        });
        const ecart = axes.titre === null ? Infinity : Math.max(0, ...axes.lignes.map((x) => Math.abs(x - axes.titre)));
        noter(`${largeur} ${theme} : chaque rond des étapes tombe sous celui du titre`, axes.lignes.length > 0 && ecart <= 0.5, `écart ${ecart.toFixed(2)} px`);
        const zone = await page.$('[data-ligne-etapes]');
        await zone?.screenshot({ path: `${CAPTURES}/etapes-${largeur}-${theme}.png` });
      } else {
        noter(`${largeur} ${theme} : la ligne d'étapes est affichée`, false);
      }
      await contexte.close();
    }
  }

  /* UNE CARTE NEUVE : rien ne tourne. */
  if (neuve) {
    const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await contexte.addCookies([{ name: 'beluga_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    await page.goto(`${BASE}/#projet/${neuve.projet}/tache/${neuve.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-barre-en-ligne]', { timeout: 90_000 });
    await page.waitForTimeout(1500);
    if (!(await page.$('[data-ligne-ouverte]'))) await page.click('[data-barre-en-ligne]');
    await page.waitForTimeout(400);
    const tourne = await page.evaluate(
      () => document.querySelectorAll('[data-ligne-etapes] .animate-spin, [data-flux-points] .animate-spin, [data-flux-points] .animate-pulse-soft').length,
    );
    const forme = await page.evaluate(() => document.querySelector('[data-barre-en-ligne] > [data-rond-etape]')?.getAttribute('data-rond-etape'));
    noter('carte neuve : rien ne tourne avant le premier envoi', tourne === 0, `${tourne} élément(s) animé(s)`);
    noter('carte neuve : le rond du titre dit « vous êtes ici »', forme === 'ici', `forme ${forme}`);
    await page.screenshot({ path: `${CAPTURES}/carte-neuve-1440-clair.png` });
    await contexte.close();
  } else {
    console.log('  --   aucune carte neuve sans message dans la base servie : point 3 sauté');
  }

  /* QUELQUES PAGES DE SERVICE : leur grande zone qui défile s'étend aussi au bord, quand la page est une colonne. */
  for (const adresse of ['#en-route', '#assistant', '#coffre', '#surveillance', '#backups', '#memoire']) {
    const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await contexte.addCookies([{ name: 'beluga_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    await page.goto(`${BASE}/${adresse}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const lu = await page.evaluate(() => {
      const etendues = [...document.querySelectorAll('[data-zone-jusqu-au-bord]')].filter((e) => e.offsetParent !== null);
      return etendues.map((e) => {
        const piste = e.querySelector(':scope > [data-barre-defilement="vertical"]');
        const bord = e.parentElement.closest('[data-bord-de-defilement], [data-page-de-zone], main[data-zone="centre"]');
        return { piste: Math.round(piste?.getBoundingClientRect().right ?? -1), bord: Math.round(bord?.getBoundingClientRect().right ?? -1) };
      });
    });
    const nom = adresse.slice(1);
    await page.screenshot({ path: `${CAPTURES}/page-${nom}-1440-clair.png` });
    console.log(`  --   ${adresse} : ${lu.length} zone(s) étendue(s) ${JSON.stringify(lu)}`);
    noter(`${adresse} : toute zone étendue a sa barre au bord`, lu.every((z) => Math.abs(z.bord - z.piste) <= 3));
    /* Ce qui flotte dans la marge (le bouton de l'assistant, en bas à droite) reste au-dessus de la zone étendue. */
    const flottant = await page.evaluate(() => {
      const bouton = [...document.querySelectorAll('button')].find((b) => {
        const r = b.getBoundingClientRect();
        return getComputedStyle(b).position === 'fixed' || (r.right > innerWidth - 80 && r.bottom > innerHeight - 80 && r.width > 0);
      });
      if (!bouton) return null;
      const r = bouton.getBoundingClientRect();
      const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return bouton.contains(dessus);
    });
    if (flottant !== null && lu.length) noter(`${adresse} : le bouton flottant du coin reste cliquable`, flottant);
    await contexte.close();
  }
} finally {
  await navigateur.close();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} points tenus — captures dans ${CAPTURES}`);
process.exit(echecs ? 1 : 0);
