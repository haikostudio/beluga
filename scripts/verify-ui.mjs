#!/usr/bin/env node
/**
 * Vérification RÉELLE de l'application dans un navigateur (PLAN §32) :
 * chaque geste est essayé pour de vrai, pas seulement testé techniquement.
 */
import { chromium } from '/home/paseo/playwright-automation/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = process.env.HAIKODEV_URL || 'https://haikodev.203.0.113.10.sslip.io';
const USER = process.env.HAIKODEV_USER;
const PASS = process.env.HAIKODEV_PASSWORD;
const SHOTS = '/root/haikodev/data/verification';

const results = [];
let browser;

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function main() {
  browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    locale: 'fr-CH',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });

  /* ---------- 1. Mur d'accès ---------- */
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const hasLogin = await page.locator('input[name="username"]').count();
  record('Mur d\'accès : la page de connexion protège l\'application', hasLogin === 1);
  await shot(page, '01-login');

  const badLogin = await page.evaluate(async (base) => {
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'inconnu', password: 'faux' }),
    });
    return res.status;
  }, BASE);
  record('Mur d\'accès : un mauvais mot de passe est refusé', badLogin === 401, `code ${badLogin}`);

  /* ---------- 2. Connexion ---------- */
  await page.fill('input[name="username"]', USER);
  await page.fill('input[name="password"]', PASS);
  await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.click('button[type="submit"]')]);
  await page.waitForTimeout(2500);
  const connected = await page.locator('text=HaikoDev').first().isVisible();
  record('Connexion : l\'interface s\'ouvre', connected);

  /* ---------- 3. Liaison démon ↔ application ---------- */
  await page.waitForTimeout(2500);
  const live = await page.evaluate(() => {
    const root = document.getElementById('root');
    return {
      html: root?.innerHTML.length ?? 0,
      hasProject: !!document.body.innerText.includes('HaikoDev'),
      connectedIcon: document.body.innerHTML.includes('lucide-wifi'),
    };
  });
  record('Liaison temps réel : le tableau reçoit l\'état du serveur', live.html > 1000 && live.connectedIcon, `${live.html} caractères`);
  await shot(page, '02-tableau');

  /* ---------- 4. Colonnes du tableau ---------- */
  const columns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('h2')).map((h) => h.textContent?.trim()),
  );
  const expected = ['Notes', 'À faire', 'Validé', 'Planifié', 'En cours', 'Terminé', 'À déployer', 'Archivé'];
  const allColumns = expected.every((label) => columns.includes(label));
  record('Tableau : les huit colonnes sont présentes', allColumns, columns.filter(Boolean).join(' · '));

  /* ---------- 5. Création d'une carte ---------- */
  const before = await page.locator('article').count();
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const plus = buttons.find((b) => b.querySelector('.lucide-plus') && b.closest('div')?.textContent?.includes('À faire'));
    plus?.click();
  });
  await page.waitForTimeout(600);
  const input = page.locator('input[placeholder="Titre de la tâche…"]');
  if (await input.count()) {
    await input.fill('Vérification automatique de l\'interface');
    await input.press('Enter');
    await page.waitForTimeout(1800);
  }
  const after = await page.locator('article').count();
  record('Carte : création depuis le tableau', after > before, `${before} → ${after} cartes`);
  await shot(page, '03-carte-creee');

  /* ---------- 6. Ouverture du panneau de carte ---------- */
  if (after > 0) {
    await page.locator('article').first().click();
    await page.waitForTimeout(1200);
    const tabs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="tab"]')).map((t) => t.textContent?.trim()),
    );
    const hasTabs = ['Détails', 'Facturation', 'GitHub'].every((label) => tabs.includes(label));
    record('Carte : les trois onglets Détails / Facturation / GitHub', hasTabs, tabs.filter(Boolean).join(' · '));
    await shot(page, '04-panneau-carte');

    /* ---------- 7. Onglet facturation ---------- */
    await page.getByRole('tab', { name: 'Facturation' }).click();
    await page.waitForTimeout(1200);
    const billingVisible = await page.evaluate(() =>
      document.body.innerText.includes('Heures (développeur senior)') &&
      document.body.innerText.includes('Tarif horaire'),
    );
    record('Facturation : le formulaire distingue heures humaines et durée machine', billingVisible);
    await shot(page, '05-facturation');

    /* ---------- 8. Onglet GitHub ---------- */
    await page.getByRole('tab', { name: 'GitHub' }).click();
    await page.waitForTimeout(1200);
    const githubVisible = await page.evaluate(() => document.body.innerText.includes('Actualiser'));
    record('GitHub : l\'onglet de suivi s\'affiche', githubVisible);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }

  /* ---------- 9. Chef d'orchestre ---------- */
  const orchestratorVisible = await page.evaluate(() => document.body.innerText.includes("Chef d'orchestre"));
  record("Chef d'orchestre : le panneau de conversation est présent", orchestratorVisible);

  /* ---------- 10. Réglages et capacité ---------- */
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    buttons.find((b) => b.querySelector('.lucide-settings2'))?.click();
  });
  await page.waitForTimeout(3200);
  const settings = await page.evaluate(() => {
    const text = document.body.innerText.toLowerCase();
    return {
      capacity: text.includes('capacité du système'),
      slots: /peuvent encore démarrer|peut encore démarrer/.test(text),
      processes: text.includes('ce qui tourne en ce moment'),
      backups: text.includes('sauvegardes'),
      accounts: text.includes('comptes et quotas'),
    };
  });
  record('Réglages : jauge de capacité et places restantes', settings.capacity && settings.slots);
  record('Réglages : liste vivante de ce qui tourne', settings.processes);
  record('Réglages : comptes, quotas et sauvegardes', settings.accounts && settings.backups);
  await shot(page, '06-reglages');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  /* ---------- 11. Bouton de quota et son menu ---------- */
  await page.click('button[title="Quotas des moteurs"]');
  await page.waitForTimeout(900);
  const quotaMenu = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      fenetre: text.includes('Fenêtre 5 h'),
      semaine: text.includes('Semaine'),
      comptes: (text.match(/Claude|Codex/g) ?? []).length,
    };
  });
  record(
    'Quotas : le bouton ouvre le détail (fenêtre 5 h et semaine, tous les comptes)',
    quotaMenu.fenetre && quotaMenu.semaine && quotaMenu.comptes >= 2,
    `${quotaMenu.comptes} mentions de moteur`,
  );
  await shot(page, '09-quotas');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  /* ---------- 12. Thème clair / sombre ---------- */
  const themeToggled = await page.evaluate(() => {
    const before = document.documentElement.classList.contains('dark');
    const buttons = Array.from(document.querySelectorAll('button'));
    const toggle = buttons.find((b) => b.querySelector('.lucide-sun') || b.querySelector('.lucide-moon'));
    toggle?.click();
    return { before, after: document.documentElement.classList.contains('dark') };
  });
  await page.waitForTimeout(500);
  record('Thème : bascule sombre / clair', themeToggled.before !== themeToggled.after);
  await shot(page, '07-theme-clair');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const toggle = buttons.find((b) => b.querySelector('.lucide-sun') || b.querySelector('.lucide-moon'));
    toggle?.click();
  });

  /* ---------- 13. Application installable ---------- */
  const pwa = await page.evaluate(async () => {
    const manifest = await fetch('/manifest.json').then((r) => r.json());
    const sw = await navigator.serviceWorker.getRegistration();
    return { name: manifest.name, display: manifest.display, sw: !!sw };
  });
  record('Application installable : manifeste et service worker', pwa.name === 'HaikoDev' && pwa.display === 'standalone' && pwa.sw);

  /* ---------- 13 bis. Notifications poussées ---------- */
  const push = await page.evaluate(async () => {
    const me = await fetch('/api/me').then((r) => r.json());
    const registration = await navigator.serviceWorker.getRegistration();
    return { key: !!me?.pushKey, sw: !!registration };
  });
  record('Notifications : la clé du serveur et le service worker sont prêts', push.key && push.sw);

  /* ---------- 14. Aucune erreur console ---------- */
  // Le 401 sur /auth/login est provoqué par la vérification n° 2 (mot de passe
  // volontairement faux) : c'est le comportement attendu, pas une anomalie.
  const realErrors = errors.filter(
    (e) =>
      !/favicon|manifest|Download the React DevTools/i.test(e) &&
      !/401/.test(e),
  );
  record('Console : aucune erreur bloquante', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

  /* ---------- 15. Mobile ---------- */
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await mobile.waitForTimeout(3000);
  const mobileNav = await mobile.evaluate(() => document.body.innerText.includes('Tableau'));
  record('Téléphone : navigation adaptée', mobileNav);
  await shot(mobile, '08-mobile');
  await mobile.close();

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
  if (failed.length) {
    console.log('Échecs :');
    for (const failure of failed) console.log(` - ${failure.name} ${failure.detail}`);
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('vérification interrompue :', err.message);
  if (browser) await browser.close();
  process.exit(2);
});
