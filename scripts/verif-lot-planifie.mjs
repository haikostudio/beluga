#!/usr/bin/env node
/**
 * « PLANIFIÉ » N'A PLUS DE GESTE DE LOT : « Tout lancer » a disparu, et sa
 * place — en haut à droite de l'entête de la rangée « Demande » — est tenue par
 * le bouton « Nouvelle tâche », qui a aussi remplacé la grande tuile posée en
 * tête des cartes. Ce contrôle prouve :
 *  - qu'aucun bouton « Tout lancer » / « Tout reprendre » ni aucune case à
 *    cocher n'apparaît dans « Planifié », même avec trois cartes ;
 *  - que « Nouvelle tâche » est DANS l'entête, collé à droite, sur la ligne du
 *    titre, et qu'aucune tuile ne reste dans la bande de cartes ;
 *  - qu'en largeur de téléphone l'entête tient sur une ligne SANS ce bouton :
 *    « Nouvelle tâche » y est le seul bouton du bas de l'écran, sur toute la
 *    largeur (retouches du 11/10/2026, « sur téléphone, le bas de l'écran ne
 *    porte qu'un bouton » : le bouton de tête de « Demande » y ferait doublon) ;
 *  - qu'un clic fait naître UNE carte dans « Planifié ».
 *
 *   node scripts/verif-lot-planifie.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et un
 * dossier de projets vide : le démon de production n'est pas touché. Le plafond
 * d'agents est à ZÉRO : aucun quota n'est dépensé.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

/* La racine se déduit du script LUI-MÊME : lancé depuis une copie de travail
   (`.worktrees/…`), il doit juger le code de CETTE copie, jamais celui du
   dossier principal — sinon il déclare bon un changement jamais exécuté. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* La résolution ordinaire de Node remonte les dossiers parents : elle trouve le
   `node_modules` de la copie de travail, et à défaut celui du dépôt principal. */
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7194);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

const { TMP, DATA, PROJETS, DEPOT, demon, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-lot-planifie-',
  port: PORT,
});

/* ------------------------------------------------------------------ */
/* Le décor : un projet, trois cartes « Planifié », une session         */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const TITRES = ['Carte d’essai — plan A', 'Carte d’essai — plan B', 'Carte d’essai — plan C'];

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification lot planifié',
  );

  /* Plafond d'agents à ZÉRO : aucun tour réel, et le refus attendu au lancement. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai lot',
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

  TITRES.forEach((titre, index) => {
    const carte = {
      id: `c-essai-${index}`,
      projectId: PROJET_ID,
      title: titre,
      description: 'Carte fabriquée par le script de vérification.',
      labels: [],
      column: 'planned',
      position: index + 1,
      origin: 'user',
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      scheduling: { asap: false, attempts: 0, restarts: 0, suspendu: false },
      excludedFromDeploy: false,
      horsTache: false,
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(carte.id, PROJET_ID, 'planned', carte.position, titre, JSON.stringify(carte), maintenant, maintenant);
  });
  db.close();
}

/** Où chaque carte se trouve À L'ÉCRAN : titre → colonne affichée. */
async function colonnesAffichees(page) {
  return page.evaluate((titres) => {
    const trouve = {};
    for (const col of document.querySelectorAll('[data-column]')) {
      for (const titre of titres) {
        if (col.textContent?.includes(titre)) trouve[titre] = col.getAttribute('data-column');
      }
    }
    return trouve;
  }, TITRES);
}

/** Les cases à cocher d'une colonne. */
async function cases(page, colonne = 'planned') {
  return page.evaluate(
    (colonne) => document.querySelector(`[data-column="${colonne}"]`)?.querySelectorAll('button[aria-pressed]').length ?? 0,
    colonne,
  );
}

/** Tous les textes de boutons d'une rangée. */
async function boutons(page, colonne = 'planned') {
  return page.evaluate((colonne) => {
    const col = document.querySelector(`[data-column="${colonne}"]`);
    return [...(col?.querySelectorAll('button') ?? [])].map((b) => b.textContent?.trim() ?? '');
  }, colonne);
}

/** Où se tient « Nouvelle tâche » par rapport à l'entête de sa rangée. */
async function placeDuBouton(page) {
  return page.evaluate(() => {
    const col = document.querySelector('[data-column="planned"]');
    const tete = col?.querySelector('[data-tete-colonne="planned"]');
    const titre = tete?.querySelector('h2');
    const bouton = col?.querySelector('[data-nouvelle-carte="planned"]');
    const bande = col?.querySelector('[data-bande-cartes="planned"]');
    if (!tete || !titre || !bouton) return null;
    const t = tete.getBoundingClientRect();
    const h = titre.getBoundingClientRect();
    const b = bouton.getBoundingClientRect();
    return {
      dansLEntete: tete.contains(bouton),
      dansLaBande: !!bande?.querySelector('[data-nouvelle-carte]'),
      nombre: col.querySelectorAll('[data-nouvelle-carte]').length,
      aDroite: b.left > h.right && t.right - b.right < 80,
      memeLigne: Math.abs(b.top + b.height / 2 - (h.top + h.height / 2)) < 6,
      tientDansLEntete: b.right <= t.right + 0.5 && t.height < 48,
      texte: bouton.textContent?.trim() ?? '',
    };
  });
}

/**
 * SUR TÉLÉPHONE : l'entête de « Demande » ne porte plus le bouton (il ferait
 * doublon) et tient sur une ligne ; « Nouvelle tâche » est LE bouton du bas de
 * l'écran — le + violet du centre (`data-bouton-nouvel-agent`, même repère `data-nouvelle-carte`),
 * seul, sous le tableau, au milieu (03/11/2026).
 */
async function placeSurTelephone(page) {
  return page.evaluate(() => {
    const visible = (el) => el.getClientRects().length > 0;
    const col = document.querySelector('[data-column="planned"]');
    const tete = col?.querySelector('[data-tete-colonne="planned"]');
    const titre = tete?.querySelector('h2');
    const boutons = [...document.querySelectorAll('[data-nouvelle-carte="planned"]')].filter(visible);
    const bouton = boutons[0];
    if (!tete || !titre || !bouton) return { tete: !!tete, titre: !!titre, boutons: boutons.length };
    const t = tete.getBoundingClientRect();
    const b = bouton.getBoundingClientRect();
    return {
      nombre: boutons.length,
      dansLaColonne: [...col.querySelectorAll('[data-nouvelle-carte]')].filter(visible).length,
      enteteSurUneLigne: t.height < 48 && tete.scrollWidth <= tete.clientWidth + 1,
      duBas: bouton.hasAttribute('data-bouton-nouvel-agent') && b.top >= t.bottom && window.innerHeight - b.bottom <= 24 && b.bottom <= window.innerHeight + 0.5,
      pleineLargeur: Math.abs(b.left + b.width / 2 - window.innerWidth / 2) <= 4, // le + du centre (03/11/2026), plus un bouton pleine largeur
      texte: bouton.textContent?.trim() ?? '',
      boite: { haut: Math.round(b.top), bas: Math.round(b.bottom), gauche: Math.round(b.left), droite: Math.round(b.right), entete: Math.round(t.height) },
    };
  });
}

/** Le nombre de cartes « Planifié » en base. */
function cartesPlanifiees() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const n = db.prepare("SELECT COUNT(*) AS n FROM cards WHERE column_key = 'planned'").get()?.n ?? 0;
  db.close();
  return n;
}

/* ------------------------------------------------------------------ */

async function ouvrirLeTableau(navigateur) {
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
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  const onglet = page.getByRole('button', { name: /^Tableau$/ });
  if (await onglet.count()) {
    await onglet.first().click();
    await page.waitForTimeout(2000);
  }
  await page.locator('[data-column="planned"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  return { page, erreurs };
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const { page, erreurs } = await ouvrirLeTableau(navigateur);

  const depart = await colonnesAffichees(page);
  noter(
    'les trois cartes d’essai sont dans « Planifié »',
    TITRES.every((t) => depart[t] === 'planned'),
    JSON.stringify(depart),
  );

  const textes = await boutons(page);
  noter(
    '« Planifié » n’a plus de bouton « Tout lancer » ni « Tout reprendre »',
    !textes.some((t) => /Tout lancer|Tout reprendre/.test(t)),
    textes.filter(Boolean).join(' | '),
  );
  noter('aucune case à cocher n’est affichée', (await cases(page)) === 0);

  const place = await placeDuBouton(page);
  noter('« Nouvelle tâche » est dans l’entête de la rangée', !!place?.dansLEntete, JSON.stringify(place));
  noter('il est collé à droite, sur la ligne du titre', !!place?.aDroite && !!place?.memeLigne);
  noter('et il porte son nom', !!place?.texte.includes('Nouvelle tâche'), place?.texte);
  noter('aucune tuile ne reste dans la bande de cartes', place?.nombre === 1 && !place?.dansLaBande);
  await page.screenshot({ path: path.join(TMP, 'entete-bureau.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  const telephone = await placeSurTelephone(page);
  noter(
    'en largeur de téléphone, l’entête tient sur une ligne, sans le bouton : « Nouvelle tâche » est le seul bouton du bas de l’écran, sur toute la largeur',
    telephone?.nombre === 1 && telephone.dansLaColonne === 0 && !!telephone.enteteSurUneLigne && !!telephone.duBas && !!telephone.pleineLargeur &&
      telephone.texte.includes('Nouvelle tâche'),
    JSON.stringify(telephone),
  );
  await page.screenshot({ path: path.join(TMP, 'entete-telephone.png') });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(1500);

  const avant = cartesPlanifiees();
  await page.locator('[data-column="planned"] [data-nouvelle-carte="planned"]').click();
  await page.waitForTimeout(3000);
  noter('un clic fait naître une carte dans « Planifié »', cartesPlanifiees() === avant + 1, `${avant} → ${cartesPlanifiees()}`);

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
