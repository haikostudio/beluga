#!/usr/bin/env node
/**
 * La liste des tâches est-elle un VOLET FIXE au bas de la conversation ?
 *
 * On ouvre une carte dont l'agent a une liste en cours, en écran de téléphone
 * puis en écran d'ordinateur, on fait défiler la conversation de haut en bas,
 * et on vérifie que l'en-tête du volet ne quitte jamais l'écran, qu'il reste
 * au-dessus de la barre d'écriture, et que le pli se retient.
 *
 *   HAIKODEV_CARTE=… node scripts/verif-volet-taches.mjs
 */
import { chromium } from '/home/paseo/playwright-automation/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

/* On vise le serveur de DÉVELOPPEMENT : HAIKODEV_URL, posée pour les agents,
   pointe l'application déjà publiée — on y verrait l'ancienne version. */
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7099';
const CARTE = process.env.HAIKODEV_CARTE || '1690c416-e135-4765-8ad7-04e99dd73e33';
/** La carte à ouvrir, reconnue à son titre sur le tableau. */
const TITRE = process.env.HAIKODEV_TITRE || 'volet fixe en bas de la conversation';
const SHOTS = '/root/haikodev/data/verification';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Une session valable, posée directement en base : on vérifie l'écran, pas le mur d'accès. */
function jeton() {
  const db = new Database('/root/haikodev/data/haikodev.db');
  const token = crypto.randomBytes(32).toString('hex');
  // En base, la session est rangée sous son empreinte : le cookie garde le clair.
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification volet des tâches',
  );
  db.close();
  return token;
}

async function ouvrir(navigateur, token, telephone) {
  const context = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
    deviceScaleFactor: telephone ? 3 : 1,
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'haikodev_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  return { context, page, erreurs };
}

/** Un clic sur l'en-tête du volet, posé directement sur le bon bouton. */
async function cliquerEntete(page) {
  await page.evaluate(() => {
    document.querySelector('[data-volet="taches"] button')?.click();
  });
}

async function ouvrirLaCarte(page) {
  const projet = process.env.HAIKODEV_PROJET || 'HaikoDev';
  const tiroir = () => page.locator('[role="dialog"] [role="tab"]');
  const cartes = () => page.locator('article', { hasText: TITRE });

  // L'application retient la carte quittée : un tiroir peut déjà être ouvert.
  // S'il porte une autre carte, on le referme avant de chercher la bonne.
  if (await tiroir().count()) {
    const titre = await page.locator('[role="dialog"] h2, [role="dialog"] h3').first().textContent();
    if (titre && titre.includes(TITRE)) return await surLaConversation(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
  }

  if (!(await cartes().count())) {
    // Le projet retenu n'est pas le bon : on le choisit dans le panneau.
    await page.locator('header button[aria-label="Projets"]').click({ force: true });
    await page.waitForTimeout(1500);
    // On vise la LIGNE du projet, pas un texte quelconque : une adresse
    // affichée dans le panneau ferait quitter le serveur de développement.
    const ligne = page
      .locator('[role="dialog"][aria-label="Projets"] button', { hasText: projet })
      .first();
    await ligne.waitFor({ state: 'visible', timeout: 15000 });
    await ligne.click({ force: true });
    await page.waitForTimeout(3500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
  }

  await revenirAuDev(page);
  if (!(await cartes().count())) return false;
  await cartes().first().click({ force: true });
  await page.waitForTimeout(3500);
  return await surLaConversation(page);
}

/** Un clic malheureux peut emmener sur l'application publiée : on revient. */
async function revenirAuDev(page) {
  if (page.url().startsWith(BASE)) return;
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
}

/** L'onglet « Conversation » du tiroir : c'est là que vit le volet. */
async function surLaConversation(page) {
  const onglet = page.locator('[role="tab"]', { hasText: 'Conversation' }).first();
  if (await onglet.count()) {
    await onglet.click({ force: true });
    await page.waitForTimeout(2500);
  }
  return (await page.locator('[role="dialog"] [role="tab"]').count()) > 0;
}

async function mesurer(page) {
  return page.evaluate(() => {
    const tete = document.querySelector('[data-volet="taches"] button');
    if (!tete) return null;
    const r = tete.getBoundingClientRect();
    const zone = document.querySelector('textarea');
    const rz = zone?.getBoundingClientRect();
    return {
      haut: Math.round(r.top),
      bas: Math.round(r.bottom),
      ecran: window.innerHeight,
      visible: r.top >= 0 && r.bottom <= window.innerHeight,
      auDessusDeLaBarre: rz ? r.bottom <= rz.top + 2 : null,
      texte: (tete.textContent || '').trim().slice(0, 90),
    };
  });
}

async function faireDefiler(page, vers) {
  await page.evaluate((v) => {
    const fils = Array.from(document.querySelectorAll('div')).filter(
      (d) => d.scrollHeight > d.clientHeight + 50 && d.className.includes('overflow-y-auto'),
    );
    const fil = fils.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (fil) fil.scrollTop = v === 'haut' ? 0 : fil.scrollHeight;
  }, vers);
  await page.waitForTimeout(700);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const token = jeton();
  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });

  for (const telephone of [true, false]) {
    const ecran = telephone ? 'téléphone' : 'ordinateur';
    const { context, page, erreurs } = await ouvrir(navigateur, token, telephone);
    const ouverte = await ouvrirLaCarte(page);
    noter(`${ecran} : la conversation de la carte s'ouvre`, ouverte);

    let mesure = await mesurer(page);
    if (!mesure) await page.screenshot({ path: `${SHOTS}/volet-${ecran}-introuvable.png` });
    noter(`${ecran} : le volet des tâches est là`, !!mesure, mesure?.texte);

    if (mesure) {
      noter(`${ecran} : l'en-tête est entièrement visible`, mesure.visible, `${mesure.haut}→${mesure.bas} / ${mesure.ecran}`);
      noter(
        `${ecran} : le volet est posé au-dessus de la barre d'écriture`,
        mesure.auDessusDeLaBarre !== false,
        mesure.auDessusDeLaBarre === null ? 'pas de barre d\'écriture ici' : '',
      );

      // Le pli par défaut : replié sur téléphone, déplié sur ordinateur.
      const lignes = await page.locator('ul li', { hasText: /./ }).count();
      const deplie = await page.evaluate(() => {
        return (
          document.querySelector('[data-volet="taches"] button')?.getAttribute('aria-expanded') === 'true'
        );
      });
      noter(`${ecran} : pli d'origine correct`, deplie === !telephone, deplie ? 'déplié' : 'replié', lignes);
      await page.screenshot({ path: `${SHOTS}/volet-${ecran}-origine.png` });

      // On remonte tout en haut de la conversation : le volet ne bouge pas.
      await faireDefiler(page, 'haut');
      const enHaut = await mesurer(page);
      noter(`${ecran} : en remontant la conversation, le volet reste à l'écran`, !!enHaut?.visible);
      await faireDefiler(page, 'bas');

      // On déplie / replie : le choix doit être retenu au rechargement.
      await cliquerEntete(page);
      await page.waitForTimeout(500);
      const apresClic = await page.evaluate(() => {
        return (
          document.querySelector('[data-volet="taches"] button')?.getAttribute('aria-expanded') === 'true'
        );
      });
      noter(`${ecran} : le pli se change au clic`, apresClic === telephone);
      await page.screenshot({ path: `${SHOTS}/volet-${ecran}-bascule.png` });

      const memoire = await page.evaluate(() => window.localStorage.getItem('haikodev.volet-taches.ouvert'));
      noter(`${ecran} : le choix est retenu`, memoire === (apresClic ? '1' : '0'), `retenu « ${memoire} »`);

      // Déplié, la liste reste bornée et ne mange pas la conversation.
      if (!apresClic) {
        await cliquerEntete(page);
        await page.waitForTimeout(500);
      }
      {
        const hauteur = await page.evaluate(() => {
          const l = document.querySelector('[data-volet="taches"] ul');
          return l ? Math.round(l.getBoundingClientRect().height) : null;
        });
        noter(
          `${ecran} : la liste dépliée reste bornée`,
          hauteur !== null && hauteur <= Math.min(page.viewportSize().height * 0.35, 260) + 4,
          `${hauteur} px`,
        );
      }
    }

    noter(`${ecran} : aucune erreur dans la console`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    await context.close();
  }

  await navigateur.close();
  const ratés = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - ratés.length}/${resultats.length} contrôles au vert`);
  process.exit(ratés.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
