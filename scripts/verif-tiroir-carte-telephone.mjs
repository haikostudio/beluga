#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur, du tiroir d'une carte ÉPURÉ sur
 * téléphone (`web/src/components/card-panel.tsx`) :
 *
 *  - sur un écran de 390 px, les tags (état, étiquettes, « modifiée »,
 *    archivage) sont MASQUÉS par défaut ; un chevron à droite du titre les
 *    déplie et les replie ;
 *  - défiler le contenu vers le bas CACHE la barre d'onglets, remonter la
 *    fait revenir, l'onglet actif restant choisi ;
 *  - sur un écran large, les tags sont toujours visibles, il n'y a pas de
 *    chevron et la barre d'onglets ne se cache jamais.
 *
 * Tout est SIMULÉ : la carte est injectée dans le canal temps réel, comme le
 * font `verif-signal-attention.mjs` et `verif-carte-sans-suite.mjs`. Rien n'est
 * écrit en base à part la session d'essai, retirée en partant.
 *
 *   HAIKO_TIROIR_URL=http://localhost:7099 node scripts/verif-tiroir-carte-telephone.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/* La racine se déduit du script : lancé depuis une copie de travail, il juge CE
   code-là, jamais celui du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_TIROIR_URL || 'http://localhost:7099';
/* La base et ses dépendances natives vivent dans le dépôt PRINCIPAL. */
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';
const PRINCIPAL = path.resolve(DONNEES, '..');

function poserSession() {
  const require = createRequire(import.meta.url);
  const db = require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(
    path.join(DONNEES, 'haikodev.db'),
  );
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification tiroir téléphone',
  );
  db.close();
  return { cookie, retirer: () => retirerSession(cookie) };
}

function retirerSession(cookie) {
  const require = createRequire(import.meta.url);
  const db = require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(
    path.join(DONNEES, 'haikodev.db'),
  );
  db.prepare('DELETE FROM sessions WHERE token = ?').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
  );
  db.close();
}

const resultats = [];
function record(nom, ok, detail = '') {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

const INIT_INJECTION = () => {
  window.__ecouteurs = [];
  const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
  Object.defineProperty(WebSocket.prototype, 'onmessage', {
    configurable: true,
    get() {
      return propriete.get.call(this);
    },
    set(ecouteur) {
      window.__ecouteurs.push(ecouteur);
      return propriete.set.call(this, ecouteur);
    },
  });
  window.__injecter = (evenement) => {
    const donnees = JSON.stringify(evenement);
    for (const ecouteur of window.__ecouteurs) ecouteur({ data: donnees });
  };
};

/** Poser la carte d'essai dans le projet ouvert, puis ouvrir son tiroir. */
async function ouvrirCarte(page, { mobile } = {}) {
  // Sur téléphone, l'app s'ouvre souvent sur le « Chef » : on ramène le tableau.
  if (mobile) {
    await page
      .locator('nav button', { hasText: 'Tableau' })
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(500);
  }
  // Le tableau affiche le projet ACTIF (rangée surlignée `bg-raised`), pas
  // forcément le premier de la colonne de gauche.
  const projectId = await page.evaluate(() => {
    const actif = Array.from(document.querySelectorAll('[data-drag-id]')).find((el) =>
      el.className.includes('bg-raised'),
    );
    return (
      actif?.getAttribute('data-drag-id') ??
      document.querySelector('[data-drag-kind="project"]')?.getAttribute('data-drag-id') ??
      null
    );
  });
  if (!projectId) throw new Error('aucun projet dans la colonne de gauche');

  const cardId = 'essai-tiroir-telephone';
  const description = 'Consigne volontairement longue pour rendre l’onglet Détails défilable. '.repeat(120);
  await page.evaluate(
    ([projectId, cardId, description]) => {
      window.__injecter({
        type: 'card.upsert',
        card: {
          id: cardId,
          projectId,
          title: 'Essai — tiroir épuré sur téléphone',
          description,
          labels: ['formation', 'RAG', 'illustrations', 'contenu'],
          column: 'running',
          position: 1,
          origin: 'user',
          run: { engine: 'codex', mode: 'direct' },
          excludedFromDeploy: false,
          horsTache: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
    },
    [projectId, cardId, description],
  );
  await page.waitForTimeout(700);
  // Un tiroir restauré d'un état précédent couvrirait le tableau : on le ferme.
  for (let i = 0; i < 3 && (await page.locator('[role="dialog"]').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  const colonne = page.locator('[data-column="running"]').first();
  await colonne.scrollIntoViewIfNeeded().catch(() => {});
  await page.locator(`[data-carte="${cardId}"]`).first().click();
  await page.waitForTimeout(900);
  return cardId;
}

/** L'onglet Détails, seul onglet dont le défilement est déterministe ici. */
async function allerAuxDetails(page) {
  await page
    .locator('[role="tab"]', { hasText: 'Détails' })
    .first()
    .click();
  await page.waitForTimeout(500);
}

/** Défiler le conteneur actif à `y` et prévenir React (capture). */
async function defiler(page, y) {
  await page.evaluate((y) => {
    const panneau = document.querySelector('[role="tabpanel"][data-state="active"]');
    const zone = panneau?.querySelector('.overflow-y-auto') ?? panneau;
    if (!zone) return;
    zone.scrollTop = y;
    zone.dispatchEvent(new Event('scroll', { bubbles: false }));
  }, y);
  await page.waitForTimeout(450);
}

const barreCachee = (page) =>
  page.evaluate(() => document.querySelector('[data-barre-onglets]')?.hasAttribute('data-cachee') ?? null);
const tagsPresents = (page) => page.locator('[data-tags-carte]').count();
const chevron = (page) =>
  page.locator('button[aria-label="Afficher les étiquettes"], button[aria-label="Masquer les étiquettes"]');

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  const session = poserSession();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });

  const nouvelOnglet = async (viewport) => {
    const context = await browser.newContext({
      viewport,
      locale: 'fr-CH',
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    });
    await context.addCookies([
      {
        name: 'haikodev_session',
        value: session.cookie,
        url: new URL(BASE).origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();
    await page.addInitScript(INIT_INJECTION);
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    page.setDefaultTimeout(8000);
    return { context, page };
  };

  const erreurs = [];

  /* ---------------- Téléphone ---------------- */
  {
    const { context, page } = await nouvelOnglet({ width: 390, height: 844 });
    page.on('pageerror', (e) => erreurs.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));

    await ouvrirCarte(page, { mobile: true });

    record('téléphone : les tags sont masqués par défaut', (await tagsPresents(page)) === 0);
    record('téléphone : un chevron s’affiche à côté du titre', (await chevron(page).count()) > 0);

    await chevron(page).first().click();
    await page.waitForTimeout(400);
    record('un appui sur le chevron déplie les tags', (await tagsPresents(page)) > 0);

    await chevron(page).first().click();
    await page.waitForTimeout(400);
    record('un second appui les replie', (await tagsPresents(page)) === 0);

    await allerAuxDetails(page);
    record('téléphone : la barre d’onglets est d’abord visible', (await barreCachee(page)) === false);
    await defiler(page, 400);
    record('défiler vers le bas cache la barre d’onglets', (await barreCachee(page)) === true);
    await defiler(page, 0);
    record('remonter la fait revenir', (await barreCachee(page)) === false);
    const detailsActif = await page.evaluate(
      () =>
        document
          .querySelector('[role="tab"][data-state="active"]')
          ?.textContent?.toLowerCase()
          .includes('détails') ?? false,
    );
    record('l’onglet actif reste « Détails » quand la barre revient', detailsActif);

    await context.close();
  }

  /* ---------------- Ordinateur ---------------- */
  {
    const { context, page } = await nouvelOnglet({ width: 1440, height: 900 });
    page.on('pageerror', (e) => erreurs.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));

    await ouvrirCarte(page);
    record('ordinateur : les tags sont visibles d’emblée', (await tagsPresents(page)) > 0);
    record('ordinateur : aucun chevron', (await chevron(page).count()) === 0);

    await allerAuxDetails(page);
    await defiler(page, 240);
    record('ordinateur : la barre d’onglets ne se cache jamais', (await barreCachee(page)) === false);

    await context.close();
  }

  record('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await browser.close();
  session.retirer();

  const rates = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés.`);
  if (rates.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
