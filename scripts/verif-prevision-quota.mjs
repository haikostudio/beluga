#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur, de la prévision d'épuisement du quota
 * hebdomadaire : la ligne « épuisé lundi vers 17 h » se pose bien sous la barre
 * « Semaine » de chaque moteur, elle porte l'heure exacte en infobulle, et elle
 * se TAIT quand le calcul n'a pas de sens.
 *
 * Comme les vrais comptes n'ont pas forcément un rythme qui épuise la semaine,
 * le script rejoue aussi le volet avec un historique fabriqué (relevés injectés
 * dans la réponse « quota.history ») pour voir la ligne s'afficher pour de bon.
 *
 *   HAIKODEV_TOKEN=… HAIKODEV_URL=http://localhost:7100 node scripts/verif-prevision-quota.mjs
 */
import { chromium } from '/home/paseo/playwright-automation/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const BASE = process.env.HAIKODEV_URL || 'http://localhost:7099';
const SHOTS = '/root/haikodev/data/verification';

/** Une session d'essai : la colonne « token » garde le SHA-256 du cookie. */
function poserSession() {
  const require = createRequire(import.meta.url);
  const db = require('/root/haikodev/node_modules/better-sqlite3')('/root/haikodev/data/haikodev.db');
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification prévision quota',
  );
  return cookie;
}

const resultats = [];
function record(nom, ok, detail = '') {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Ouvre le volet des quotas depuis la barre du haut. */
async function ouvrirLeVolet(page) {
  await page.locator('header button[title="Quotas des moteurs"]').click();
  await page.waitForTimeout(1200);
  return page.locator('[role="menu"]').last();
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    // Sinon c'est la version PUBLIÉE qui s'affiche, pas celle qu'on vérifie.
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'haikodev_session', value: poserSession(), url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);

  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && erreurs.push(message.text()));

  /*
   * Les relevés arrivent par le canal temps réel : on remplace la réponse à
   * « quota.history » à la volée, avant même que la page ne se charge, pour
   * mettre le volet devant un rythme connu (1 % par heure sur trente heures).
   */
  await page.addInitScript(() => {
    const vrai = WebSocket.prototype.send;
    const attendus = new Set();
    WebSocket.prototype.send = function (donnees) {
      try {
        const message = JSON.parse(donnees);
        if (message?.type === 'quota.history') attendus.add(message.id);
      } catch {
        /* message non JSON : rien à intercepter */
      }
      return vrai.call(this, donnees);
    };
    const ajouterEcouteur = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, ecouteur, options) {
      if (!(this instanceof WebSocket) || type !== 'message') {
        return ajouterEcouteur.call(this, type, ecouteur, options);
      }
      const filtre = (evenement) => {
        try {
          const message = JSON.parse(evenement.data);
          if (message?.type === 'ack' && attendus.has(message.id)) {
            const maintenant = Date.now();
            const releves = [];
            for (let i = 30; i >= 0; i--) releves.push({ at: maintenant - i * 3600_000, weekly: 10 + (30 - i), session: 5 });
            const faux = { ...message, data: { history: {} } };
            for (const compte of Object.keys(message.data?.history ?? { 'compte-simule': [] })) {
              faux.data.history[compte] = releves;
            }
            window.__previsionSimulee = true;
            return ecouteur.call(this, { ...evenement, data: JSON.stringify(faux) });
          }
        } catch {
          /* message non JSON : on laisse passer */
        }
        return ecouteur.call(this, evenement);
      };
      return ajouterEcouteur.call(this, type, filtre, options);
    };
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);

  const volet = await ouvrirLeVolet(page);
  record('le volet des quotas s’ouvre', await volet.isVisible());

  const texte = await volet.innerText();
  const lignes = (texte.match(/épuisé [^\n]+/g) ?? []).map((l) => l.trim());
  record(
    'une prévision s’affiche sous la barre « Semaine »',
    lignes.length > 0,
    lignes.join(' | ') || 'aucune ligne « épuisé … »',
  );

  record(
    'la formulation est en clair (« épuisé <jour> vers <heure> »)',
    lignes.every((ligne) => /^épuisé (aujourd’hui|demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) vers \d{1,2} h( 30)?$/.test(ligne)),
    lignes.join(' | '),
  );

  // La prévision vit SOUS la barre de la semaine, pas sous celle de 5 h.
  const bienPlacee = await volet.evaluate((noeud) => {
    const lignes = [...noeud.querySelectorAll('p')].filter((p) => p.textContent.startsWith('épuisé'));
    return lignes.every((ligne) => {
      const bloc = ligne.parentElement;
      return bloc?.textContent?.includes('Semaine') && !bloc.textContent.includes('Fenêtre 5 h');
    });
  });
  record('elle est posée sous la fenêtre hebdomadaire, pas sous celle de 5 h', bienPlacee);

  // Une prévision serrée se distingue : couleur d'alerte et graisse.
  const distinguee = await volet.evaluate((noeud) => {
    const ligne = [...noeud.querySelectorAll('p')].find((p) => p.textContent.startsWith('épuisé'));
    if (!ligne) return null;
    return { classes: ligne.className, couleur: getComputedStyle(ligne).color };
  });
  record(
    'une prévision qui manque est signalée en couleur d’alerte',
    !!distinguee && /text-warning/.test(distinguee.classes),
    distinguee ? `${distinguee.couleur}` : 'ligne introuvable',
  );

  // L'heure exacte et le rythme restent en infobulle, comme le temps restant.
  const infobulle = await volet.evaluate((noeud) => {
    const ligne = [...noeud.querySelectorAll('p')].find((p) => p.textContent.startsWith('épuisé'));
    let parent = ligne;
    while (parent && !parent.getAttribute?.('data-state') && !parent.hasAttribute?.('aria-describedby')) {
      parent = parent.parentElement;
    }
    return !!parent;
  });
  record('l’heure exacte passe en infobulle', infobulle !== false);

  await page.screenshot({ path: `${SHOTS}/prevision-quota.png` });

  record('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));

  await browser.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
