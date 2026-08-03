#!/usr/bin/env node
/**
 * Vérification au doigt d'une carte du tableau, sur un écran de téléphone :
 * le badge « en ligne » au-dessus du titre, le pied réduit à l'ancienneté, et
 * plus aucun repère technique (durée prévue, réalisé, heures, branche, robot).
 *
 *   HAIKODEV_TOKEN=… node scripts/verif-carte-allegee.mjs
 */
import { chromium } from '/home/paseo/playwright-automation/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = process.env.HAIKODEV_URL || 'http://127.0.0.1:7099';
const TOKEN = process.env.HAIKODEV_TOKEN;
const SHOTS = '/root/haikodev/data/verification';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  const origine = new URL(BASE).origin;
  if (TOKEN) {
    await context.addCookies([
      { name: 'haikodev_session', value: TOKEN, url: origine, httpOnly: true, sameSite: 'Lax' },
    ]);
  }

  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && erreurs.push(message.text()));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  // Le projet retenu peut n'avoir aucune carte : on ouvre le panneau latéral
  // et on choisit celui qu'on veut regarder (HaikoDev par défaut).
  const projet = process.env.HAIKODEV_PROJET || 'HaikoDev';
  if (!(await page.locator('article').count())) {
    await page.locator('header button[aria-label="Projets"]').click();
    await page.waitForTimeout(1200);
    const ligne = page
      .locator('[role="dialog"][aria-label="Projets"]')
      .getByText(projet, { exact: true })
      .first();
    await ligne.waitFor({ state: 'visible', timeout: 15000 });
    await ligne.click();
    await page.waitForTimeout(3000);
  }

  const cartes = page.locator('article');
  const total = await cartes.count();
  record('Des cartes sont affichées', total > 0, `${total} carte(s)`);
  if (!total) {
    await browser.close();
    process.exit(1);
  }

  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/carte-allegee-tableau.png` });

  /* ---------- Plus aucun repère technique dans le pied ---------- */
  // On regarde tout SAUF le titre : un titre peut très bien parler de « 5 h ».
  const textes = await cartes.evaluateAll((n) =>
    n.map((c) =>
      [...c.children]
        .filter((e) => !e.querySelector('h3') && e.tagName !== 'H3')
        .map((e) => e.textContent || '')
        .join(' '),
    ),
  );
  const fautifs = textes.filter((t) => /réalisé |\b\d+([.,]\d+)?\s?h\b|branche|#\d+/.test(t));
  record(
    'Aucune carte ne montre durée réalisée, heures ou branche',
    fautifs.length === 0,
    fautifs.length ? fautifs[0].replace(/\n/g, ' · ').slice(0, 90) : '',
  );

  const icones = await cartes.evaluateAll((n) =>
    n.flatMap((c) => [...c.querySelectorAll('svg')].map((s) => s.getAttribute('class') || '')),
  );
  const interdites = icones.filter((c) => /lucide-bot|lucide-git-branch|lucide-circle-dollar-sign/.test(c));
  record('Ni tête de robot, ni icône de branche, ni montant', interdites.length === 0, interdites.join(' '));

  /* ---------- Le pied ne garde que « il y a … », à gauche ---------- */
  const pieds = await cartes.evaluateAll((n) =>
    n.map((c) => {
      const dernier = c.lastElementChild;
      const boite = dernier?.getBoundingClientRect();
      const parent = c.getBoundingClientRect();
      return { texte: (dernier?.textContent || '').trim(), decalage: boite && parent ? boite.x - parent.x : -1 };
    }),
  );
  const piedsOk = pieds.every((p) => /^(il y a |à l'instant|maintenant)/i.test(p.texte) && p.decalage < 20);
  record(
    'Le pied ne porte que l’ancienneté, calée à gauche',
    piedsOk,
    pieds.map((p) => `«${p.texte}»`).join(' '),
  );

  /* ---------- Le badge « en ligne » est au-dessus du titre ---------- */
  const enLigne = await cartes.evaluateAll((n) =>
    n
      .filter((c) => /en ligne/.test(c.textContent || ''))
      .map((c) => {
        const badge = [...c.querySelectorAll('span,div')].find((e) => e.textContent?.trim() === 'en ligne');
        const titre = c.querySelector('h3');
        const b = badge?.getBoundingClientRect();
        const t = titre?.getBoundingClientRect();
        return b && t ? { badge: Math.round(b.y), titre: Math.round(t.y), titreTexte: titre.textContent } : null;
      })
      .filter(Boolean),
  );
  if (enLigne.length) {
    const dessus = enLigne.every((e) => e.badge < e.titre);
    record(
      'Le badge « en ligne » est au-dessus du titre',
      dessus,
      enLigne.map((e) => `badge y=${e.badge} < titre y=${e.titre}`).join(' · '),
    );
  } else {
    record('Aucune carte « en ligne » visible pour comparer', true, 'contrôle sauté');
  }

  /* ---------- Trois blocs plus une ligne de pied ---------- */
  const blocs = await cartes.evaluateAll((n) => n.map((c) => c.children.length));
  record('Une carte tient en quatre blocs au plus', blocs.every((b) => b <= 4), blocs.join(' · '));

  const hauteurs = await cartes.evaluateAll((n) => n.map((c) => Math.round(c.getBoundingClientRect().height)));
  record('Les cartes restent compactes', hauteurs.every((h) => h < 220), hauteurs.join(' · '));

  record('Aucune erreur dans la console', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await browser.close();
  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${results.length - echecs.length}/${results.length} contrôles au vert`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
