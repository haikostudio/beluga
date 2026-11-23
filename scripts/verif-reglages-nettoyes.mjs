#!/usr/bin/env node
/**
 * LES RÉGLAGES NETTOYÉS, dans un VRAI navigateur :
 *
 *  - « Mode simplifié », « Alerte de surcharge » et « Accès au VPS » ont quitté
 *    le menu des réglages, et leur ancienne adresse retombe sur une page réelle ;
 *  - aucun repère `data-mode-simplifie` n'est posé sur la page ;
 *  - « Thème » : DEUX cartes, Clair et Sombre (plus d'ambiance à choisir), deux
 *    aperçus différents ; la carte RETENUE se détache du panneau par son fond
 *    et se dit à une machine (`aria-pressed`) ;
 *  - « Compétences » a quitté le menu : les compétences vivent dans la mémoire
 *    (classeur global), et leur ancienne adresse retombe sur une page réelle.
 *
 * Démon et base d'ESSAI à soi (`BELUGA_REGLAGES_NETS_PORT`), plafond d'agents à
 * zéro : aucun moteur appelé.
 *
 *   node scripts/verif-reglages-nettoyes.mjs
 *
 * RECALÉ SUR LA REFONTE MINIMALISTE (11/10/2026). « L'apparence est noir et
 * blanc : deux palettes, clair et sombre » et « le thème se règle en deux
 * commandes : Suivre le système, puis Clair ou Sombre — plus d'ambiance à
 * choisir ». Les six cartes d'ambiance et leurs douze aperçus n'existent plus :
 *  - « six cartes d'ambiance » devient « deux cartes, Clair et Sombre » ;
 *  - « douze aperçus, tous différents » devient « deux aperçus, différents » ;
 *  - « ce fond se détache du panneau » se lit sur la carte RETENUE : depuis la
 *    refonte c'est le FOND qui marque le choix (`appearance-picker.tsx`) ;
 *  - « un fond COMMUN aux six cartes » est RETIRÉ : la règle portait sur la
 *    grille des six ambiances (jeton `--fond-plan`), et les deux cartes se
 *    distinguent désormais justement par leur fond. Elle est remplacée par son
 *    pendant d'aujourd'hui : la carte retenue, et elle seule, porte
 *    `aria-pressed` et un fond à elle.
 * Le tableau s'attend par `[data-rail-du-tableau]` (plus `[data-disposition-tableau]`).
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_REGLAGES_NETS_PORT || 7213);
const BASE = `http://127.0.0.1:${PORT}`;
const { TMP, DATA, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-reglages-nettoyes-',
  port: PORT,
  garder: process.env.BELUGA_REGLAGES_NETS_GARDER === '1',
});

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${String(detail).slice(0, 240)}` : ''}`);
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

function poserDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton), t, t + 3_600_000, 'vérification des réglages nettoyés',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.close();
}

async function ouvrirLesReglages(page, cle) {
  await page.evaluate((page_) => {
    window.location.hash = page_ ? `reglages/${page_}` : 'reglages';
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, cle ?? '');
  await page.waitForSelector('[data-modale-reglages]', { timeout: 20_000 });
  await page.waitForTimeout(600);
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('[data-rail-du-tableau]', { timeout: 30_000 });

  /* 1. Les trois pages ont quitté le menu. */
  await ouvrirLesReglages(page);
  const cles = await page.locator('[data-page-menu]').evaluateAll((n) => n.map((x) => x.getAttribute('data-page-menu')));
  for (const retiree of ['mode-simplifie', 'surcharge', 'vps']) {
    noter(`le menu des réglages ne porte plus « ${retiree} »`, cles.length > 5 && !cles.includes(retiree), cles.join(', '));
  }
  await ouvrirLesReglages(page, 'vps');
  const ouverte = await page.locator('[data-page-reglages]').first().getAttribute('data-page-reglages');
  noter('une ancienne adresse (« reglages/vps ») retombe sur une page réelle', !!ouverte && ouverte !== 'vps', ouverte);
  noter('aucun repère « mode simplifié » sur la page', !(await page.evaluate(() => document.documentElement.hasAttribute('data-mode-simplifie'))));

  /* 2. Thème : deux cartes (Clair, Sombre), la retenue détachée du panneau, deux aperçus distincts. */
  await ouvrirLesReglages(page, 'theme');
  await page.waitForSelector('[data-theme-carte]', { timeout: 15_000 });
  // La souris hors des cartes : une carte survolée prend le fond de la retenue.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  const lireLeTheme = () =>
    page.evaluate(() => {
      const cartes = Array.from(document.querySelectorAll('[data-theme-carte]'));
      const panneau = document.querySelector('[data-page-reglages="theme"]');
      const fondDe = (el) => getComputedStyle(el).backgroundColor;
      // Le panneau peut être transparent : on remonte jusqu'au premier fond posé.
      let p = panneau;
      while (p && /rgba\(0, 0, 0, 0\)|transparent/.test(fondDe(p))) p = p.parentElement;
      const apercus = Array.from(document.querySelectorAll('[data-theme-apercu]')).map((a) =>
        Array.from(a.querySelectorAll('span')).map((s) => getComputedStyle(s).backgroundColor).join('|'),
      );
      return {
        cartes: cartes.map((c) => ({
          mode: c.getAttribute('data-theme-mode'),
          retenue: c.getAttribute('aria-pressed') === 'true',
          fond: fondDe(c),
        })),
        fondPanneau: p ? fondDe(p) : null,
        apercus,
      };
    });
  let theme = await lireLeTheme();
  // En « Suivre le système », aucune carte n'est retenue : on en choisit une à la
  // main (le geste coupe l'automatique), puis on écarte la souris pour ne pas
  // lire un fond de survol.
  if (!theme.cartes.some((c) => c.retenue)) {
    await page.locator('[data-theme-carte][data-theme-mode="sombre"]').first().click();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(500);
    theme = await lireLeTheme();
  }
  const retenues = theme.cartes.filter((c) => c.retenue);
  const autres = theme.cartes.filter((c) => !c.retenue);
  noter(
    'deux cartes : Clair et Sombre',
    theme.cartes.length === 2 && theme.cartes.map((c) => c.mode).sort().join(',') === 'clair,sombre',
    theme.cartes.map((c) => c.mode).join(', '),
  );
  noter(
    'une seule carte RETENUE, avec un fond à elle',
    retenues.length === 1 && autres.length === 1 && retenues[0].fond !== autres[0].fond,
    theme.cartes.map((c) => `${c.mode}${c.retenue ? ' (retenue)' : ''} ${c.fond}`).join(' / '),
  );
  noter(
    'le fond de la carte retenue se détache du panneau des réglages',
    retenues.length === 1 && !!theme.fondPanneau && retenues[0].fond !== theme.fondPanneau,
    `${retenues[0]?.fond} sur ${theme.fondPanneau}`,
  );
  noter('deux aperçus, différents', theme.apercus.length === 2 && new Set(theme.apercus).size === 2, `${new Set(theme.apercus).size} distincts`);
  await page.screenshot({ path: path.join(TMP, 'theme.png') });

  /* 3. Compétences : la page a quitté le menu, les fiches vivent dans la mémoire. */
  noter('le menu des réglages ne porte plus « competences »', !cles.includes('competences'), cles.join(', '));
  await ouvrirLesReglages(page, 'competences');
  const surLaPage = await page.locator('[data-page-reglages]').first().getAttribute('data-page-reglages');
  noter('l’ancienne adresse « reglages/competences » retombe sur une page réelle', !!surLaPage && surLaPage !== 'competences', surLaPage);

  noter('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.${process.env.BELUGA_REGLAGES_NETS_GARDER === '1' ? ` (captures dans ${TMP})` : ''}`);
  process.exit(echecs ? 1 : 0);
}

main().catch((err) => {
  console.error('ÉCHEC :', err);
  console.error('Journal du démon :\n' + journal.slice(-30).join(''));
  process.exit(1);
});
