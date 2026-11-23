#!/usr/bin/env node
/*
 * L'INTERFACE MAISON ET LA NAVIGATION DU TÉLÉPHONE (décision de l'utilisateur du 03/11/2026) — contrôle dans un vrai
 * navigateur, à 390 px :
 *
 *  - le HAUT : un seul rang, un NOM centré qui ouvre sa liste maison (refonte du 03/11/2026 ; le détail, écran par
 *    écran, est contrôlé par `verif-menu-bas-telephone.mjs`) ;
 *  - le BAS : aucun, un bouton pleine largeur, ou des boutons répartis — jamais l'ancien bouton central fourre-tout ;
 *  - AUCUN élément du système visible : ni `<select>`, ni case, date ou recherche natives ;
 *  - les ONGLETS : une barre au fond contrasté, l'onglet au repos TRANSPARENT, un seul éclairé ;
 *  - les TABLEAUX : aucun titre de ligne plus gros que le texte courant (13 px) ;
 *  - Communication n'a plus de menu secondaire (`data-communication-menu`).
 *
 * Vise le serveur de développement (`HAIKO_INTERFACE_URL`, défaut http://localhost:7099), jamais `BELUGA_URL`.
 * Session d'une heure posée (jeton HACHÉ) puis retirée. Captures : `HAIKO_CAPTURES` (défaut /tmp/interface-maison).
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const BASE = process.env.HAIKO_INTERFACE_URL || 'http://localhost:7099';
const CAPTURES = process.env.HAIKO_CAPTURES || '/tmp/interface-maison';
const TAILLE_MAX_TITRE_DE_LIGNE = 13;
fs.mkdirSync(CAPTURES, { recursive: true });

function avecLaBase(geste) {
  const db = new Database(cheminDeLaBaseServie());
  try {
    return geste(db);
  } finally {
    db.close();
  }
}
const hacher = (v) => crypto.createHash('sha256').update(v).digest('hex');
function poserSession() {
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  avecLaBase((db) =>
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(hacher(cookie), maintenant, maintenant + 3600_000, 'vérification de l’interface maison'),
  );
  return cookie;
}
const retirerSession = (cookie) => avecLaBase((db) => db.prepare('DELETE FROM sessions WHERE token = ?').run(hacher(cookie)));

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/* Ce que l'écran montre, mesuré d'un coup. */
const MESURER = (taille) => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const nav = [...document.querySelectorAll('nav[data-menu-bas]')].find(visible);
  const boutons = nav ? [...nav.querySelectorAll('[data-bouton-du-bas]')].filter(visible).map((b) => b.getAttribute('data-bouton-du-bas')) : [];
  const natifs = [...document.querySelectorAll('select, input[type="checkbox"], input[type="radio"], input[type="date"], input[type="time"], input[type="search"], input[type="datetime-local"]')].filter(visible).length;
  const repos = [...document.querySelectorAll('[data-barre-onglets] [role="tab"][aria-selected="false"]')].filter(visible).map((o) => getComputedStyle(o).backgroundColor);
  const reposOpaques = repos.filter((c) => c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent').length;
  const titres = [...document.querySelectorAll('[data-titre-de-ligne]')].filter(visible).map((el) => parseFloat(getComputedStyle(el).fontSize));
  const trop = titres.filter((px) => px > taille);
  const nom = document.querySelector('[data-haut-telephone] [data-haut-titre]');
  const contenu = document.querySelector('[data-haut-telephone][data-haut-contenu]');
  return {
    sorte: nav?.getAttribute('data-menu-bas') ?? null,
    boutons,
    forme: nav?.getAttribute('data-menu-bas') ?? 'aucun',
    ancienCentral: !!document.querySelector('[data-bouton-central], [data-tiroir-du-bas]'),
    natifs,
    repos: repos.length,
    reposOpaques,
    titres: titres.length,
    trop,
    nom: nom ? nom.textContent.trim() : contenu ? '(recherche)' : null,
    liste: nom?.getAttribute('data-haut-liste') ?? null,
    menuSecondaire: !!document.querySelector('[data-communication-menu]'),
    debord: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
};

async function main() {
  const cookie = poserSession();
  const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'fr-CH', ignoreHTTPSErrors: true, serviceWorkers: 'block' });
    await context.addCookies([{ name: 'beluga_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    /* Le contrôle ne déplace pas l'écran de l'utilisateur : les réglages et les « lu » ne partent pas. */
    await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
      const serveur = ws.connectToServer();
      ws.onMessage((message) => {
        try {
          const lu = JSON.parse(String(message));
          if (['prefs.set', 'card.read', 'project.read'].includes(lu?.cmd?.type ?? lu?.type)) return;
        } catch {
          /* tel quel */
        }
        serveur.send(message);
      });
    });
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e?.message ?? e)));

    const visiter = async (fragment, nom) => {
      await page.goto(`${BASE}/#${fragment}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3500);
      await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
      return page.evaluate(MESURER, TAILLE_MAX_TITRE_DE_LIGNE);
    };

    const SERVICES = [
      ['en-route', 'tableaux-de-bord'],
      ['communication', 'communication'],
      ['communication/vue-d-ensemble', 'communication-vue-d-ensemble'],
      ['notes', 'notes'],
      ['statistiques', 'statistiques'],
      ['coffre', 'coffre'],
      ['memoire', 'memoire'],
      ['backups', 'sauvegardes'],
      ['surveillance', 'surveillance'],
      ['taches-recurrentes', 'taches-recurrentes'],
      ['studio', 'studio'],
    ];
    for (const [fragment, nom] of SERVICES) {
      const m = await visiter(fragment, nom);
      noter(`${nom} : le haut dit où l'on est, sur un seul rang`, !!m.nom, `« ${m.nom} »${m.liste ? ` (liste : ${m.liste})` : ''}`);
      noter(`${nom} : plus de bouton central fourre-tout`, !m.ancienCentral && m.boutons.length <= 5, `${m.forme} · ${m.boutons.join(', ')}`);
      noter(`${nom} : aucun élément du système visible`, m.natifs === 0, `${m.natifs}`);
      noter(`${nom} : onglets au repos transparents`, m.reposOpaques === 0, `${m.reposOpaques} / ${m.repos}`);
      noter(`${nom} : aucun titre de ligne plus gros que le texte courant`, m.trop.length === 0, m.titres ? `${m.titres} titres, trop gros : ${m.trop.join(', ') || 'aucun'}` : 'aucun tableau');
      noter(`${nom} : rien ne déborde de côté`, !m.debord);
    }
    const com = await visiter('communication', 'communication-vue');
    noter('Communication : plus de menu secondaire', !com.menuSecondaire);
    noter('Communication : un seul bouton en bas, parler au directeur', com.forme === 'pleine-largeur' && com.boutons.join(',') === 'directeur', com.boutons.join(', '));

    /* LE NOM DU HAUT OUVRE LE MENU PRINCIPAL (13/11/2026) : plus de liste des services derrière lui. */
    await page.locator('[data-haut-titre][data-menu-principal]').first().click();
    await page.waitForTimeout(600);
    noter('le nom du haut ouvre le menu principal', (await page.locator('[data-menu-du-telephone]').count()) >= 1);
    await page.screenshot({ path: path.join(CAPTURES, 'menu-principal.png') });
    await page.keyboard.press('Escape');
    noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
    retirerSession(cookie);
  }
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis — captures dans ${CAPTURES}`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
