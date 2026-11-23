#!/usr/bin/env node
/**
 * LA COLONNE DE GAUCHE : POURCENTAGE D'AVANCEMENT À DROITE D'UN PROJET EN
 * COURS — vérifié dans un VRAI navigateur, sur son PROPRE démon (base neuve,
 * dossier de projets vide, port libre : le démon de production n'est pas
 * touché, aucun quota dépensé).
 *
 *   node scripts/verif-avancement-colonne-gauche.mjs
 *
 * RECALÉ SUR LA REFONTE (11/10/2026). La colonne de gauche suit le lieu : elle
 * ne liste les projets que sur la page « Tableaux de bord » ; dans un projet
 * elle laisse la place à ses options, et la liste reste montée mais CACHÉE. La
 * ligne du projet et la tête de la colonne « En cours » ne se voient donc plus
 * ensemble : on lit le pourcentage de la ligne sur les tableaux de bord (ligne
 * VISIBLE exigée, atteinte par un vrai geste : `ouvrirLesTableauxDeBord`), on
 * ouvre le projet par cette ligne pour lire celui du tableau, puis on revient
 * par la flèche de la colonne (`[data-menu-de-colonne]`) pour mesurer sa place.
 *
 * ROUGE AUJOURD'HUI, ET C'EST L'ÉCRAN QUI EST EN CAUSE (constat du 11/10/2026).
 * Depuis la refonte, la ligne d'un projet ne dessine plus son pourcentage : les
 * deux composants de ligne de `web/src/components/sidebar.tsx` reçoivent
 * toujours `avancement` mais l'écartent (`void avancement;`), et
 * `RepereAvancementProjet` (`data-avancement-projet`) n'est plus appelé nulle
 * part. Aucune règle de la refonte ne retire pourtant l'invariant « la ligne
 * d'un projet où un agent travaille porte, à DROITE, le même pourcentage que la
 * tête de la colonne « En cours » du tableau » : ce contrôle le garde donc tel
 * quel, et les points qui mesurent la place du chiffre disent « repère absent »
 * au lieu de planter.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { ouvrirLesTableauxDeBord } from './lib/navigation.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7195);
const BASE = `http://127.0.0.1:${PORT}`;
const TABLEAUX_DE_BORD = `${BASE}/#en-route`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { TMP, DATA, PROJETS, DEPOT, demon, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-avancement-gauche-',
  port: PORT,
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const CARD_ID = 'c-essai';
const AGENT_ID = 'a-essai';
const TITRE = 'Essai — pourcentage d’avancement';

function poserLeProjetEtLaCarte() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification avancement colonne de gauche',
  );

  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: TITRE,
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

  const carte = {
    id: CARD_ID,
    projectId: PROJET_ID,
    column: 'running',
    position: 1,
    title: 'Carte d’essai',
    description: 'Carte d’essai',
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(CARD_ID, PROJET_ID, 'running', 1, carte.title, JSON.stringify(carte), maintenant, maintenant);

  db.close();
}

function poserLAgent({ status, done, total }) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    cardId: CARD_ID,
    role: 'task',
    title: 'Agent d’essai',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status,
    todos: total ? { done, total } : undefined,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`,
  ).run(AGENT_ID, PROJET_ID, CARD_ID, 'task', status, JSON.stringify(agent), maintenant, maintenant);

  db.close();
}

async function ouvrirLaColonne(navigateur) {
  const contexte = await navigateur.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([
    { name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  // La page de tous les projets : c'est là que la colonne de gauche les liste.
  await page.goto(TABLEAUX_DE_BORD, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await versLaListeDesProjets(page);
  await page.waitForTimeout(2500);
  return { page, erreurs };
}

/** La ligne du projet, AFFICHÉE dans la colonne de gauche (la liste cachée d'un projet ouvert ne compte pas). */
const LIGNE = `aside[data-zone="gauche"] [data-drag-id="${PROJET_ID}"]`;
const attendreLaLigne = (page) => page.locator(LIGNE).first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => undefined);
/**
 * Jusqu'à la liste des projets, par un vrai geste. Un chargement peut retomber
 * sur le tableau d'un projet, où la colonne ne liste plus les projets : on
 * remonte alors par la flèche de la colonne (`ouvrirLesTableauxDeBord`).
 */
async function versLaListeDesProjets(page) {
  await ouvrirLesTableauxDeBord(page).catch(() => undefined);
  await attendreLaLigne(page);
}

/**
 * Le pourcentage tel qu'il paraît sur la ligne du projet, dans la colonne de
 * gauche. `trouve` exige une ligne VISIBLE : dans un projet ouvert, la liste
 * reste dans le document mais ne s'affiche pas.
 */
async function pourcentDeLaLigne(page) {
  return page.evaluate((selecteur) => {
    const ligne = document.querySelector(selecteur);
    if (!ligne || ligne.getBoundingClientRect().height === 0) return { trouve: false };
    const repere = ligne.querySelector('[data-avancement-projet]');
    return { trouve: true, texte: repere ? repere.textContent : null };
  }, LIGNE);
}

async function pourcentDuTableau(page) {
  return page.evaluate(() => {
    const repere = document.querySelector('[data-avancement-colonne="running"]');
    return repere ? repere.textContent : null;
  });
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeProjetEtLaCarte();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const { page, erreurs } = await ouvrirLaColonne(navigateur);

  const auRepos = await pourcentDeLaLigne(page);
  noter('sans agent au travail, rien ne s’affiche sur la ligne', auRepos.trouve && !auRepos.texte, JSON.stringify(auRepos));

  // L'agent démarre, sans encore avoir annoncé de liste de tâches : silence.
  poserLAgent({ status: 'running', done: 0, total: 0 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await versLaListeDesProjets(page);
  await page.waitForTimeout(2000);
  const sansListe = await pourcentDeLaLigne(page);
  noter('un agent au travail sans liste annoncée reste silencieux', sansListe.trouve && !sansListe.texte, JSON.stringify(sansListe));

  // L'agent annonce sa liste : 3 étapes sur 6.
  poserLAgent({ status: 'running', done: 3, total: 6 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await versLaListeDesProjets(page);
  await page.waitForTimeout(2000);
  const enCours = await pourcentDeLaLigne(page);
  await page.screenshot({ path: path.join(TMP, 'avancement-colonne-gauche.png') });
  // La ligne ouvre le projet : la tête de sa colonne « En cours » porte le même chiffre.
  await page.click(`${LIGNE} button`);
  await page.locator('[data-avancement-colonne="running"]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
  const duTableau = await pourcentDuTableau(page);
  await page.screenshot({ path: path.join(TMP, 'avancement-tableau.png') });
  noter('le pourcentage apparaît à droite de la ligne', enCours.texte === '50 %', JSON.stringify(enCours));
  noter('il suit le même chiffre que la tête de la colonne « En cours »', enCours.texte === duTableau, `ligne=${enCours.texte} tableau=${duTableau}`);
  // Retour à la page de tous les projets, par la flèche en tête de la colonne.
  await page.locator('[data-menu-de-colonne]:visible').first().click();
  await attendreLaLigne(page);
  await page.waitForTimeout(600);

  // Le chiffre doit rester COLLÉ au bord droit, immobile au survol — sur
  // colonne large comme sur colonne étroite (le clic ci-dessus a laissé le
  // pointeur SUR la ligne : on l'en écarte avant de mesurer le repos).
  // Sans repère sur la ligne, rien ne se mesure : les quatre points qui suivent échouent en le disant.
  const positionAvancement = (page) =>
    page.evaluate((selecteur) => {
      const ligne = document.querySelector(selecteur);
      const repere = ligne?.querySelector('[data-avancement-projet]');
      if (!ligne || !repere) return null;
      const rLigne = ligne.getBoundingClientRect();
      const rRepere = repere.getBoundingClientRect();
      return { right: rRepere.right, ligneRight: rLigne.right };
    }, LIGNE);
  const ABSENT = 'repère [data-avancement-projet] absent de la ligne';

  await page.mouse.move(700, 700);
  await page.waitForTimeout(300);
  const auReposLarge = await positionAvancement(page);
  const boiteLarge = await page.locator(LIGNE).boundingBox();
  await page.mouse.move(boiteLarge.x + boiteLarge.width / 2, boiteLarge.y + boiteLarge.height / 2);
  await page.waitForTimeout(400);
  const auSurvolLarge = await positionAvancement(page);
  noter(
    'collé au bord droit (colonne large)',
    !!auReposLarge && auReposLarge.ligneRight - auReposLarge.right < 12,
    auReposLarge ? JSON.stringify(auReposLarge) : ABSENT,
  );
  noter(
    'immobile au survol (colonne large)',
    !!auReposLarge && !!auSurvolLarge && auSurvolLarge.right === auReposLarge.right,
    auReposLarge && auSurvolLarge ? `repos=${auReposLarge.right} survol=${auSurvolLarge.right}` : ABSENT,
  );

  await page.evaluate(() => {
    const aside = document.querySelector('aside[data-zone="gauche"]');
    aside.style.setProperty('--largeur-projets', '150px');
    aside.style.width = '150px';
  });
  await page.mouse.move(700, 700);
  await page.waitForTimeout(300);
  const auReposEtroit = await positionAvancement(page);
  const boiteEtroite = await page.locator(LIGNE).boundingBox();
  await page.mouse.move(boiteEtroite.x + boiteEtroite.width / 2, boiteEtroite.y + boiteEtroite.height / 2);
  await page.waitForTimeout(400);
  const auSurvolEtroit = await positionAvancement(page);
  noter(
    'collé au bord droit (colonne étroite)',
    !!auReposEtroit && auReposEtroit.ligneRight - auReposEtroit.right < 12,
    auReposEtroit ? JSON.stringify(auReposEtroit) : ABSENT,
  );
  noter(
    'immobile au survol (colonne étroite)',
    !!auReposEtroit && !!auSurvolEtroit && auSurvolEtroit.right === auReposEtroit.right,
    auReposEtroit && auSurvolEtroit ? `repos=${auReposEtroit.right} survol=${auSurvolEtroit.right}` : ABSENT,
  );
  await page.evaluate(() => {
    const aside = document.querySelector('aside[data-zone="gauche"]');
    aside.style.removeProperty('--largeur-projets');
    aside.style.removeProperty('width');
  });

  // Le travail se termine : l'agent n'est plus « running ».
  poserLAgent({ status: 'done', done: 6, total: 6 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await versLaListeDesProjets(page);
  await page.waitForTimeout(2000);
  const termine = await pourcentDeLaLigne(page);
  noter('le pourcentage disparaît une fois le travail fini', termine.trouve && !termine.texte, JSON.stringify(termine));

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
