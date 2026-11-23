#!/usr/bin/env node
/**
 * Contrôle des axes de défilement du tableau, dans un vrai navigateur.
 *
 * LE TABLEAU D'UN PROJET SE LIT EN COLONNES, ET SEULEMENT EN COLONNES (refonte
 * du 11/10/2026) : les quatre étapes sont posées côte à côte, sur téléphone
 * comme sur ordinateur. Le rail des colonnes (`[data-rail-du-tableau]`) ne
 * glisse QUE de côté, et la bande de cartes d'une colonne
 * (`[data-bande-cartes]`) QUE de haut en bas.
 *
 * Deux cas : téléphone et ordinateur. L'affichage « en rangées » et sa bascule
 * ont été retirés de l'application : les cas qui le jugeaient (« téléphone forcé
 * en rangées », « ordinateur en rangées ») sont partis avec lui, comme la clé
 * `beluga.disposition-tableau` et le repère `[data-disposition-tableau]`. La
 * disposition ne se lit donc plus dans un attribut : elle se MESURE (les
 * colonnes sont sur une même ligne, l'une à droite de l'autre).
 *
 *   HAIKO_DEFILEMENT_URL=http://localhost:7099 node scripts/verif-defilement-tableau.mjs
 *
 * Jamais `BELUGA_URL` : elle désigne l'application PUBLIÉE. On vise le serveur
 * de développement, par une variable à soi.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie, dossierDesDonnees } from './lib/base-servie.mjs';

const BASE = process.env.HAIKO_DEFILEMENT_URL || 'http://localhost:7099';
const SHOTS = path.join(dossierDesDonnees(), 'verification');

const base = new Database(cheminDeLaBaseServie());
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

/*
  Les jetons de session sont stockés hachés : impossible d'en reprendre un.
  Le script s'en fabrique donc un, valable une heure, et le retire en partant.
  On n'utilise SURTOUT pas BELUGA_TOKEN : c'est le jeton d'un agent, pas
  une session de navigateur — le raccourci fait échouer la connexion.
*/
const jeton = crypto.randomBytes(32).toString('base64url');
base
  .prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)')
  .run(sha(jeton), Date.now(), Date.now() + 3600_000, 'vérification défilement tableau');
process.on('exit', () => base.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton)));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const TELEPHONE = { viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true };
const ORDINATEUR = { viewport: { width: 1440, height: 900 } };
const CAS = [
  { nom: 'téléphone', fenetre: TELEPHONE },
  { nom: 'ordinateur', fenetre: ORDINATEUR },
];

/** Tout ce qu'il faut savoir des axes du rail et des bandes, lu dans la page. */
function lireAxes() {
  /* Le rail est le nœud qui DÉFILE : `ZoneDefilement` pose ses attributs sur
     sa zone intérieure, celle qui porte `overflow`. */
  const rail = document.querySelector('[data-rail-du-tableau]');
  if (!rail) return null;
  const s = getComputedStyle(rail);
  return {
    railX: s.overflowX,
    railY: s.overflowY,
    railDebordeY: rail.scrollHeight - rail.clientHeight,
    colonnes: [...rail.querySelectorAll('[data-column]')].map((colonne) => {
      const bande = colonne.querySelector('[data-bande-cartes]');
      const sb = bande ? getComputedStyle(bande) : null;
      const b = colonne.getBoundingClientRect();
      return {
        nom: colonne.getAttribute('data-column'),
        gauche: b.left,
        haut: b.top,
        largeur: b.width,
        hauteur: b.height,
        hauteurRail: rail.clientHeight,
        bandeTrouvee: Boolean(bande),
        bandeX: sb?.overflowX ?? null,
        bandeY: sb?.overflowY ?? null,
        debordeX: bande ? bande.scrollWidth - bande.clientWidth : 0,
        debordeY: bande ? bande.scrollHeight - bande.clientHeight : 0,
      };
    }),
  };
}

const glisse = (v) => v === 'auto' || v === 'scroll';

const navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

for (const cas of CAS) {
  console.log(`\n— ${cas.nom} —`);
  const contexte = await navigateur.newContext({ ...cas.fenetre, serviceWorkers: 'block' });
  await contexte.addCookies([
    { name: 'beluga_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('[data-column]').first().waitFor({ state: 'attached', timeout: 30000 }).catch(() => undefined);
  /* L'application rouvre la dernière carte ouverte : sa page couvre le tableau.
     On en sort par son retour (téléphone) ou par la flèche de la colonne de
     gauche (ordinateur) — la barre « Tableau / agent / Fichiers » n'existe plus. */
  if (await page.locator('[data-page-carte]').count()) {
    const retour = page
      .locator(
        '[data-page-carte] [data-retour-carte]:visible, aside[data-zone="gauche"] [data-menu-de-colonne]:visible, [data-page-carte] [data-fil-d-ariane] [data-icone-du-cran]:visible',
      )
      .first();
    if (await retour.count()) await retour.click();
    else await page.keyboard.press('Escape');
    await page.locator('[data-page-carte]').first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
  }
  await page.locator('[data-column]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
  /* Mesure de pixels : on laisse la mise en page se poser une fois l'état atteint. */
  await page.waitForTimeout(800);

  const m = await page.evaluate(lireAxes);
  if (!m || !m.colonnes.length) {
    noter(`${cas.nom} : le tableau est visible`, false, 'aucune colonne trouvée');
    await contexte.close();
    continue;
  }
  /* « En colonnes » se mesure : les étapes tiennent sur UNE ligne, chacune à
     droite de la précédente. */
  const memeLigne = m.colonnes.every((r) => Math.abs(r.haut - m.colonnes[0].haut) <= 1);
  const coteACote = m.colonnes.every((r, i) => i === 0 || r.gauche >= m.colonnes[i - 1].gauche + m.colonnes[i - 1].largeur - 1);
  noter(
    `${cas.nom} : disposition « colonnes »`,
    memeLigne && coteACote,
    m.colonnes.map((r) => `${r.nom} à ${Math.round(r.gauche)} px`).join(', '),
  );
  noter(`${cas.nom} : quatre étapes à l'écran`, m.colonnes.length >= 4, `${m.colonnes.length}`);

  noter(`${cas.nom} : le rail des colonnes glisse de côté`, glisse(m.railX), m.railX);
  noter(`${cas.nom} : le rail ne glisse PAS de haut en bas`, m.railY === 'hidden', m.railY);
  noter(`${cas.nom} : le rail ne déborde pas en hauteur`, m.railDebordeY <= 1, `${m.railDebordeY} px`);
  for (const r of m.colonnes) {
    const nom = `${cas.nom}, colonne « ${r.nom} »`;
    noter(`${nom} : une bande qui glisse de haut en bas`, r.bandeTrouvee && glisse(r.bandeY), String(r.bandeY));
    noter(`${nom} : sa bande ne glisse PAS de côté`, r.bandeX === 'hidden', String(r.bandeX));
    noter(`${nom} : pas plus haute que le tableau`, r.hauteur <= r.hauteurRail + 1,
      `${Math.round(r.hauteur)} px sur ${Math.round(r.hauteurRail)} px`);
    noter(`${nom} : rien ne déborde en largeur`, r.debordeX <= 1, `${r.debordeX} px`);
  }

  await page.screenshot({ path: `${SHOTS}/defilement-tableau-${cas.nom.replace(/\s+/g, '-')}.png` }).catch(() => undefined);
  noter(`${cas.nom} : aucune erreur dans la page`, erreurs.length === 0, erreurs[0] ?? '');
  await contexte.close();
}

await navigateur.close();
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
process.exit(echecs ? 1 : 0);
