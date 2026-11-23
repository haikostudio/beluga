#!/usr/bin/env node
/**
 * La barre du MOIS de MiMo (et rien d'autre : ni 5 h ni semaine) dans le volet
 * des quotas, Gemini sans barre, Cursor SANS barres dans Réglages › Comptes, et
 * le formulaire du forfait mensuel de MiMo.
 *
 * Les relevés sont GLISSÉS dans les messages du démon servi (comme
 * `verif-volet-quotas-bulle.mjs`) : aucun fournisseur n'est interrogé, aucune
 * base n'est écrite en dehors de la session d'une heure, retirée en partant.
 *
 * OÙ SONT LES CHOSES DEPUIS LA REFONTE DU 11/10/2026 : le bouton des quotas
 * (`[data-essai="badge-quota"]`) et celui des réglages (`[data-reglages-menu]`)
 * vivent au PIED DE LA COLONNE DE GAUCHE — le bandeau et son bouton « Menu »
 * ont disparu. Sur téléphone la colonne est rangée dans le panneau « Projets »
 * de la barre d'en-tête : on l'ouvre d'abord, puis on touche le bouton.
 *
 *   HAIKO_BARRES_URL=http://localhost:7099 node scripts/verif-barres-mimo-gemini.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

/* Le serveur de DÉVELOPPEMENT, jamais BELUGA_URL (l'application publiée). */
const BASE = process.env.HAIKO_BARRES_URL || 'http://localhost:7099';
const CAPTURES = process.env.HAIKO_BARRES_CAPTURES || '/tmp';
const BASE_DE_DONNEES = process.env.BELUGA_DB || cheminDeLaBaseServie();

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

function jeton() {
  const db = new Database(BASE_DE_DONNEES);
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte, maintenant, maintenant + 3600_000, 'vérification barre du mois MiMo',
  );
  db.close();
  return { token, empreinte };
}

function retirer(empreinte) {
  const db = new Database(BASE_DE_DONNEES);
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

const base = { priority: 50, active: false, available: true, fetchedAt: Date.now() };
const dans = (jours) => Date.now() + jours * 86400_000;
const FAUX_COMPTES = [
  {
    ...base, id: 'mimo-essai', engine: 'mimo', label: 'MiMo essai', plan: 'Token Plan',
    credit: { resume: 'Clé active chez Xiaomi · abonnement mensuel (Token Plan)' },
    usageMesuree: { mois: { usedPct: 42, durationSeconds: 30 * 86400, resetsAt: dans(20) } },
    forfaitMensuel: { plafond: 4_100_000_000, renouvellement: Date.parse('2026-10-27T00:00:00Z'), consommeAuReleve: 441_230_050, releveAt: Date.now() - 86400_000 },
  },
  {
    ...base, id: 'mimo-vide', engine: 'mimo', label: 'MiMo sans plafond', plan: 'Token Plan',
    credit: { resume: 'Clé active chez Xiaomi · abonnement mensuel (Token Plan)' },
    usageMesuree: {},
  },
  {
    ...base, id: 'suivi-google-gemini', engine: 'ext-google-gemini', label: 'Google Gemini', plan: "À l'usage",
    priority: 1000, suivi: true, available: false,
    credit: { resume: 'Quota atteint chez Google', soldeEpuise: true },
  },
  {
    ...base, id: 'cursor-essai', engine: 'cursor', label: 'Cursor essai',
    credit: { forfait: 'Pro', prix: '20 $', cursorPct: 12, autresPct: 3, finDuCycle: Date.now() + 5 * 86400_000 },
  },
];

/** Remplace la liste des quotas, où qu'elle voyage dans un message du démon. */
function greffer(objet) {
  if (Array.isArray(objet)) return objet.forEach(greffer);
  if (!objet || typeof objet !== 'object') return;
  if (Array.isArray(objet.quotas)) objet.quotas = JSON.parse(JSON.stringify(FAUX_COMPTES));
  for (const valeur of Object.values(objet)) greffer(valeur);
}

async function ouvrir(navigateur, token, mobile) {
  const context = await navigateur.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await context.addCookies([{ name: 'beluga_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  await page.routeWebSocket(/\/ws/, (ws) => {
    const serveur = ws.connectToServer();
    serveur.onMessage((message) => {
      try {
        const lu = JSON.parse(String(message));
        greffer(lu);
        ws.send(JSON.stringify(lu));
      } catch {
        ws.send(message);
      }
    });
    ws.onMessage((message) => serveur.send(message));
  });
  return { context, page };
}

async function volet(navigateur, token, mobile) {
  const nom = mobile ? 'telephone' : 'ordinateur';
  const { context, page } = await ouvrir(navigateur, token, mobile);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  /* Sur téléphone le bouton est monté mais caché tant que le panneau des
     projets est fermé : on attend qu'il EXISTE, puis on ouvre le panneau. */
  await page.waitForSelector('[data-essai="badge-quota"]', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 3 && (await page.locator('[role="dialog"]').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  if (mobile) {
    await page.locator('button[aria-label="Projets"]:visible').first().click();
    await page.waitForTimeout(800);
  }
  await page.locator('[data-essai="badge-quota"]:visible').first().click();
  const menu = page.locator('[role="menu"]').first();
  await menu.waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);

  const carte = (nomCompte) => menu.locator('div.rounded-md.border', { hasText: nomCompte }).first();
  const mimo = carte('MiMo essai');
  const texteMimo = await mimo.innerText();
  noter(`${nom} : MiMo montre UNE barre « Mois »`, /Mois/.test(texteMimo) && /42 %/.test(texteMimo), texteMimo.replace(/\n/g, ' · '));
  noter(`${nom} : MiMo n'a ni fenêtre 5 h ni semaine`, !/Fenêtre 5 h/.test(texteMimo) && !/Semaine/.test(texteMimo));
  noter(`${nom} : MiMo dit que c'est estimé`, /Estimé/.test(texteMimo));
  const vide = carte('MiMo sans plafond');
  const texteVide = await vide.innerText();
  noter(`${nom} : sans plafond saisi, MiMo dit quoi renseigner et n'a aucune barre`, /Aucun plafond mensuel saisi/.test(texteVide) && !/ %/.test(texteVide), texteVide.replace(/\n/g, ' · '));
  noter(`${nom} : MiMo garde sa ligne d'état`, /Clé active chez Xiaomi/.test(texteMimo));

  const gemini = carte('Google Gemini');
  const texteGemini = await gemini.innerText();
  noter(`${nom} : Google Gemini apparaît dans le volet`, (await gemini.count()) === 1);
  noter(`${nom} : Gemini montre son état réel`, /Quota atteint chez Google/.test(texteGemini), texteGemini.replace(/\n/g, ' · '));
  noter(`${nom} : Gemini n'invente aucune barre`, !/Fenêtre 5 h/.test(texteGemini) && !/Semaine/.test(texteGemini) && !/ %/.test(texteGemini));
  noter(`${nom} : Gemini n'a pas d'interrupteur (ce n'est pas un compte)`, (await gemini.locator('[data-interrupteur-compte]').count()) === 0);
  noter(`${nom} : MiMo garde son interrupteur`, (await mimo.locator('[data-interrupteur-compte]').count()) === 1);
  noter(`${nom} : Gemini se dit « suivi seulement »`, (await gemini.locator('[data-etat="suivi"], [data-etat="epuise"]').count()) === 1);

  const cursor = carte('Cursor essai');
  const texteCursor = await cursor.innerText();
  noter(`${nom} : le volet garde les barres Cursor`, /Modèles Cursor/.test(texteCursor) && (await cursor.locator('.h-1').count()) >= 2);
  await page.screenshot({ path: `${CAPTURES}/barres-volet-${nom}.png` });
  noter(`${nom} : aucune erreur de page`, erreurs.length === 0, erreurs.join(' | '));
  await context.close();
}

async function reglages(navigateur, token) {
  const { context, page } = await ouvrir(navigateur, token, false);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-essai="badge-quota"]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  // Réglages › Comptes, atteint comme un utilisateur : le bouton des réglages, au pied de la colonne.
  if ((await page.locator('[data-assistant-moteurs="1"]').count()) > 0) {
    await page.locator('[data-assistant-reglages="1"]').first().click();
  } else {
    await page.locator('[data-reglages-menu]:visible').first().click();
  }
  await page.locator('[data-page-menu="comptes"]').first().click({ timeout: 30000 });
  await page.waitForTimeout(1500);
  const ligne = page.locator('[data-essai="quota-cursor-chiffres"]').first();
  const present = await ligne.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  noter('Réglages › Comptes : Cursor dit ses chiffres en une ligne', present);
  if (present) {
    const texte = await ligne.innerText();
    noter('Réglages › Comptes : la ligne porte le forfait et les deux parts', /Pro/.test(texte) && /12 %/.test(texte) && /3 %/.test(texte), texte);
    const barres = await page.locator('[data-essai="quota-cursor"] .h-1').count();
    noter('Réglages › Comptes : plus aucune barre Cursor', barres === 0, `${barres}`);
  }
  noter('Réglages › Comptes : la ligne de suivi Gemini n\'y figure pas comme un compte', (await page.locator('[data-ligne-compte="suivi-google-gemini"]').count()) === 0);
  noter('Réglages › Comptes : MiMo garde sa ligne de compte', (await page.locator('[data-ligne-compte="mimo-essai"]').count()) === 1);
  // Le forfait du mois : le formulaire s'ouvre, prérempli en millions de jetons.
  await page.locator('[data-forfait-mensuel-compte="mimo-essai"]').click();
  const formulaire = page.locator('[data-forfait-mensuel="mimo-essai"]');
  const ouvert = await formulaire.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  noter('Réglages › Comptes : le forfait du mois de MiMo s\'ouvre', ouvert);
  if (ouvert) {
    noter('Réglages › Comptes : plafond prérempli en millions', (await formulaire.locator('[data-forfait-plafond]').inputValue()) === '4100');
    noter('Réglages › Comptes : renouvellement prérempli', (await formulaire.locator('[data-forfait-renouvellement]').getAttribute('data-choix-de-date')) === '2026-10-27');
    noter('Réglages › Comptes : consommé prérempli en millions', (await formulaire.locator('[data-forfait-consomme]').inputValue()) === '441.23');
  }
  noter('Réglages › Comptes : seul MiMo porte le forfait du mois', (await page.locator('[data-forfait-mensuel-compte]').count()) === 2);
  await page.screenshot({ path: `${CAPTURES}/barres-reglages-comptes.png` });
  await context.close();
}

async function main() {
  const { token, empreinte } = jeton();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    await volet(navigateur, token, false);
    await volet(navigateur, token, true);
    await reglages(navigateur, token);
  } finally {
    await navigateur.close();
    retirer(empreinte);
  }
  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(echecs ? `\n${echecs} échec(s)` : '\nTout est bon.');
  process.exit(echecs ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
