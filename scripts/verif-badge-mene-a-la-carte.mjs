#!/usr/bin/env node
/**
 * LE BADGE BLEU D'UN PROJET MÈNE À SA CARTE NON LUE (`RepereRobot` et
 * `clicSurLeBadgeRendu` de `web/src/components/sidebar.tsx`,
 * `client.ouvrirCarteNonLue`, commande `project.unreadCard`,
 * `carteNonLueLaPlusRecente` de `shared/src/travail-rendu.ts`) — vérifié dans
 * un VRAI navigateur, sur son PROPRE démon (base neuve, port libre : le démon
 * de production n'est pas touché, aucun quota dépensé).
 *
 *   node scripts/verif-badge-mene-a-la-carte.mjs
 *
 * Ce qui est prouvé : un projet porte deux cartes non lues en « Planifié »
 * (dont une posée par un agent du démon, sans conversation) et une archive
 * rendue plus récemment ; le badge annonce 2, jamais l'archive. Un clic sur le
 * badge, en venant d'un AUTRE projet, ouvre le projet ET la carte non lue la
 * plus récente — pas l'archive, pas la plus ancienne —, la marque consultée, et
 * le badge descend à 1. Un clic sur le NOM du projet, lui, n'ouvre aucune carte.
 *
 * RECALÉ SUR LA REFONTE (11/10/2026). La colonne de gauche suit le lieu : elle
 * ne liste les projets — donc leurs badges — que sur la page « Tableaux de
 * bord » (`#en-route`). Dans un projet, elle porte ses options sous une flèche
 * de retour (`[data-menu-de-colonne]`) et la liste, toujours montée, est
 * CACHÉE. « Depuis un autre projet » se joue donc en deux gestes : on ouvre
 * l'autre projet, on remonte par la flèche, puis on clique le badge. Chaque
 * lecture du badge exige une ligne AFFICHÉE.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7196);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { TMP, DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-badge-carte-',
  port: PORT,
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET = 'p-rendus';
const AUTRE = 'p-autre';
const RECENTE = 'Suivi d’audience anonyme';
const ANCIENNE = 'Une vieille carte non lue';
const ARCHIVE = 'Une archive rendue';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton), maintenant, maintenant + 3600_000, 'vérification badge',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  const projet = (id, nom, rank) => {
    const data = {
      id, name: nom, path: DEPOT, defaultEngine: 'claude', isSelf: false, rank,
      archived: false, createdAt: maintenant, updatedAt: maintenant,
    };
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run(id, nom, DEPOT, JSON.stringify(data), maintenant, maintenant);
  };
  projet(AUTRE, 'Projet de départ', 1);
  projet(PROJET, 'Projet aux rendus', 2);

  const carte = (id, titre, colonne, renduA, position) => {
    const data = { id, projectId: PROJET, title: titre, origin: 'agent', renduA };
    db.prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, PROJET, colonne, position, titre, JSON.stringify(data), maintenant, maintenant);
  };
  carte('c-ancienne', ANCIENNE, 'planned', maintenant - 60_000, 1);
  carte('c-recente', RECENTE, 'planned', maintenant - 10_000, 2);
  carte('c-archive', ARCHIVE, 'archived', maintenant - 1_000, 3);
  db.close();
}

function lu(cardId) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const row = db.prepare('SELECT last_read_at AS luA FROM cards WHERE id = ?').get(cardId);
  db.close();
  return row?.luA ?? null;
}

/** La ligne d'un projet dans la colonne de gauche — celle de la liste AFFICHÉE. */
const ligne = (id) => `aside[data-zone="gauche"] [data-drag-id="${id}"]`;

/** Le compte du badge, lu sur la ligne AFFICHÉE (`cachee` si la liste ne se voit pas). */
const compteur = (page) =>
  page.evaluate((selecteur) => {
    const element = document.querySelector(selecteur);
    if (!element || element.getBoundingClientRect().height === 0) return 'cachee';
    return element.getAttribute('data-projet-rendus') ?? null;
  }, ligne(PROJET));
const tiroirAvec = (page, titre) => page.locator('[role="dialog"]', { hasText: titre }).count();

/**
 * Remonte jusqu'à la page de tous les projets, où la colonne les liste : la
 * flèche en tête de la colonne remonte d'un cran — de la tâche au projet, du
 * projet aux tableaux de bord.
 */
async function versLesTableauxDeBord(page) {
  for (let cran = 0; cran < 3 && !(await page.locator(ligne(PROJET)).isVisible().catch(() => false)); cran++) {
    await page.locator('[data-menu-de-colonne]:visible').first().click();
    await page.waitForTimeout(700);
  }
  await page.locator(ligne(PROJET)).waitFor({ state: 'visible', timeout: 15000 });
}

/** Ouvre un projet par le NOM de sa ligne, depuis les tableaux de bord. */
async function ouvrirParLeNom(page, id, nom) {
  await versLesTableauxDeBord(page);
  await page.click(`${ligne(id)} button:has-text("${nom}")`);
  await page.locator('[data-column="planned"]').first().waitFor({ state: 'visible', timeout: 15000 });
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1600, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  // La page de tous les projets : c'est là que la colonne de gauche les liste.
  await page.goto(`${BASE}/#en-route`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator(ligne(PROJET)).waitFor({ state: 'visible', timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(2500);

  noter('le badge compte les 2 non lues, jamais l’archive', (await compteur(page)) === '2', String(await compteur(page)));

  // On part d'un AUTRE projet : le clic sur le badge doit y mener.
  await ouvrirParLeNom(page, AUTRE, 'Projet de départ');
  await page.waitForTimeout(1200);

  // Le nom du projet garde son geste : il ouvre le tableau, aucune carte.
  await ouvrirParLeNom(page, PROJET, 'Projet aux rendus');
  await page.waitForTimeout(1500);
  noter(
    'un clic sur le NOM n’ouvre aucune carte',
    (await page.locator('[role="dialog"]').count()) === 0 && (await page.locator('[data-column="planned"] [data-carte="c-recente"]').count()) === 1,
  );
  noter('…et ne marque rien consulté', lu('c-recente') == null && lu('c-ancienne') == null);

  // Retour dans l'AUTRE projet, puis à la liste : son badge s'y clique.
  await ouvrirParLeNom(page, AUTRE, 'Projet de départ');
  await page.waitForTimeout(1200);
  await versLesTableauxDeBord(page);

  const badge = page.locator(`${ligne(PROJET)} [data-repere-rendus]`);
  const libelle = (await badge.getAttribute('aria-label')) ?? '';
  noter('le badge dit qu’un clic ouvre la carte', /cliquez pour l’ouvrir/.test(libelle), libelle);
  await badge.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(TMP, 'badge-carte-ouverte.png') });

  noter('le clic ouvre la carte non lue la plus récente', (await tiroirAvec(page, RECENTE)) === 1);
  noter('…ni l’archive, ni la plus ancienne', (await tiroirAvec(page, ARCHIVE)) === 0 && (await tiroirAvec(page, ANCIENNE)) === 0);
  noter('…dans le bon projet', (await page.locator(`[data-carte="c-recente"]`).count()) === 1);
  noter('…et la marque consultée', lu('c-recente') != null && lu('c-ancienne') == null);

  // La carte refermée, on remonte à la liste : le badge s'y relit, ligne affichée.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  await versLesTableauxDeBord(page);
  noter('le badge descend à 1', (await compteur(page)) === '1', String(await compteur(page)));

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) console.log(`(captures et journal dans ${TMP})`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.slice(-20).join(''));
  process.exit(1);
});
