#!/usr/bin/env node
/**
 * Sortir une carte d'une fin de parcours est un geste HUMAIN — et il existe.
 *
 * Trois choses vérifiées dans un vrai navigateur :
 *   1. archiver une carte au glisser-déposer lui pose une date d'archivage ;
 *   2. la RESSORTIR au glisser-déposer la fait atterrir dans « Planifié », et
 *      elle garde la mention de son archivage, en toutes lettres, sur la carte ;
 *   3. le bouton dédié du tiroir fait la même chose, depuis « Archivé » comme
 *      depuis « À déployer » (« Retirer du lot à publier »).
 *
 * L'interdiction faite aux chemins AUTOMATIQUES, elle, se vérifie sur les
 * règles pures : `server/src/test/suivi-colonne.test.ts`.
 *
 *   node scripts/verif-sortie-archive.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et
 * un dossier de projets vide : le démon de production n'est pas touché. Le
 * plafond d'agents est mis à ZÉRO : aucun tour n'est lancé, aucun quota dépensé.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* La racine se déduit du script LUI-MÊME : lancé depuis une copie de travail
   (`.worktrees/…`), il doit juger le code de CETTE copie, jamais celui du
   dossier principal — sinon il déclare bon un changement jamais exécuté. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* La résolution ordinaire de Node remonte les dossiers parents : elle trouve le
   `node_modules` de la copie de travail, et à défaut celui du dépôt principal. */
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7196);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-sortie-archive-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
for (const dossier of [DATA, PROJETS, DEPOT]) fs.mkdirSync(dossier, { recursive: true });

execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
  cwd: DEPOT,
});

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    HAIKODEV_PORT: String(PORT),
    HAIKODEV_HOST: '127.0.0.1',
    HAIKODEV_DATA: DATA,
    HAIKODEV_PROJECTS_ROOT: PROJETS,
    HAIKODEV_WEB: path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const journal = [];
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));

process.on('exit', () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function attendrePort(limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Le décor : trois cartes, une session                                 */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';

/** Les trois cartes de l'essai : où elles partent, ce qu'on leur fait. */
const CARTES = [
  { id: 'c-glissee', titre: 'Carte d’essai — sortie au glissement', colonne: 'to_deploy' },
  { id: 'c-bouton', titre: 'Carte d’essai — sortie au bouton', colonne: 'archived', archivedAt: true },
  { id: 'c-lot', titre: 'Carte d’essai — retirée du lot', colonne: 'to_deploy' },
];

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification sortie d’archive',
  );

  /* Plafond d'agents à ZÉRO : rien ne peut se lancer pendant l'essai. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai archive',
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

  CARTES.forEach((modele, index) => {
    const carte = {
      id: modele.id,
      projectId: PROJET_ID,
      title: modele.titre,
      description: 'Carte fabriquée par le script de vérification.',
      labels: [],
      column: modele.colonne,
      position: index + 1,
      origin: 'user',
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      scheduling: { asap: false, attempts: 0, restarts: 0, suspendu: false },
      excludedFromDeploy: false,
      horsTache: false,
      createdAt: maintenant,
      updatedAt: maintenant,
      // La carte du bouton est déjà archivée depuis trois jours.
      ...(modele.archivedAt ? { archivedAt: maintenant - 3 * 86400_000 } : {}),
    };
    db.prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(carte.id, PROJET_ID, carte.column, carte.position, carte.title, JSON.stringify(carte), maintenant, maintenant);
  });
  db.close();
}

/** Une carte telle qu'elle est en BASE. */
function lireCarte(id) {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const ligne = db.prepare('SELECT data FROM cards WHERE id = ?').get(id);
  db.close();
  return ligne ? JSON.parse(ligne.data) : null;
}

/* ------------------------------------------------------------------ */
/* Les gestes                                                          */
/* ------------------------------------------------------------------ */

/**
 * Glisser une carte jusqu'à une colonne, à la souris. Le tableau n'utilise PAS
 * le glisser-déposer natif : il suit les événements de pointeur.
 */
async function glisser(page, titre, versColonne) {
  const carte = page.locator(`article:has-text(${JSON.stringify(titre)})`).first();
  const colonne = page.locator(`[data-column="${versColonne}"]`);
  await colonne.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const depart = await carte.boundingBox();
  const arrivee = await colonne.boundingBox();
  if (!depart || !arrivee) throw new Error('carte ou colonne introuvable à l’écran');

  const x0 = depart.x + depart.width / 2;
  const y0 = depart.y + 12;
  const x1 = arrivee.x + arrivee.width / 2;
  const y1 = arrivee.y + Math.min(140, arrivee.height / 2);

  await page.evaluate(
    async ([x0, y0, x1, y1]) => {
      const commun = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 };
      const cible = document.elementFromPoint(x0, y0);
      cible?.dispatchEvent(new PointerEvent('pointerdown', { ...commun, clientX: x0, clientY: y0 }));
      for (let i = 1; i <= 12; i++) {
        const x = x0 + ((x1 - x0) * i) / 12;
        const y = y0 + ((y1 - y0) * i) / 12;
        window.dispatchEvent(new PointerEvent('pointermove', { ...commun, clientX: x, clientY: y }));
        await new Promise((r) => setTimeout(r, 25));
      }
      window.dispatchEvent(new PointerEvent('pointerup', { ...commun, buttons: 0, clientX: x1, clientY: y1 }));
    },
    [x0, y0, x1, y1],
  );
  await page.waitForTimeout(3000);
}

/** Dans quelle colonne la carte se trouve-t-elle À L'ÉCRAN ? */
async function colonneAffichee(page, titre) {
  return page.evaluate((titre) => {
    for (const col of document.querySelectorAll('[data-column]')) {
      if (col.textContent?.includes(titre)) return col.getAttribute('data-column');
    }
    return null;
  }, titre);
}

/** La mention d'archivage lue sur la carte du tableau, s'il y en a une. */
async function mentionSurLaCarte(page, titre) {
  return page.evaluate((titre) => {
    for (const article of document.querySelectorAll('article')) {
      if (!article.textContent?.includes(titre)) continue;
      return article.querySelector('[data-mention-archivage]')?.textContent?.trim() ?? null;
    }
    return null;
  }, titre);
}

/** Ouvrir le tiroir d'une carte et rendre le libellé de son bouton de reprise. */
async function ouvrirCarte(page, titre) {
  await page.locator(`article:has-text(${JSON.stringify(titre)})`).first().click();
  await page.waitForTimeout(1500);
  return page.evaluate(() => document.querySelector('[data-geste="reprendre"]')?.textContent?.trim() ?? null);
}

async function cliquerReprise(page) {
  await page.locator('[data-geste="reprendre"]').first().click();
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
}

/* ------------------------------------------------------------------ */

async function ouvrirLeTableau(navigateur) {
  const contexte = await navigateur.newContext({
    // Assez large pour voir les huit colonnes d'un coup : on ne glisse pas vers
    // une colonne restée hors de l'écran.
    viewport: { width: 2800, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([
    { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
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

  /* -------- 1. Archiver au glissement pose la date -------- */

  const glissee = CARTES[0];
  noter(
    'la carte de l’essai part de « À déployer »',
    (await colonneAffichee(page, glissee.titre)) === 'to_deploy',
    String(await colonneAffichee(page, glissee.titre)),
  );

  await glisser(page, glissee.titre, 'archived');
  const archivee = lireCarte(glissee.id);
  noter('le glissement l’a bien archivée', archivee?.column === 'archived', archivee?.column);
  noter(
    'l’archivage a posé une date, gardée sur la carte',
    typeof archivee?.archivedAt === 'number',
    String(archivee?.archivedAt),
  );
  noter(
    'tant qu’elle est dans « Archivé », la carte n’affiche pas de mention',
    (await mentionSurLaCarte(page, glissee.titre)) === null,
  );
  await page.screenshot({ path: path.join(TMP, '1-archivee.png') });

  /* -------- 2. La ressortir au glissement -------- */

  await glisser(page, glissee.titre, 'planned');
  const ressortie = lireCarte(glissee.id);
  noter('un geste humain la ressort d’« Archivé »', ressortie?.column === 'planned', ressortie?.column);
  noter(
    'elle garde la date de son archivage',
    ressortie?.archivedAt === archivee?.archivedAt,
    String(ressortie?.archivedAt),
  );
  noter(
    'le tableau la montre bien dans « Planifié »',
    (await colonneAffichee(page, glissee.titre)) === 'planned',
    String(await colonneAffichee(page, glissee.titre)),
  );
  const mention = await mentionSurLaCarte(page, glissee.titre);
  noter('la carte ressortie porte la mention de son archivage', /Archivée le /.test(mention ?? ''), String(mention));
  await page.screenshot({ path: path.join(TMP, '2-ressortie.png') });

  /* -------- 3. Le bouton dédié du tiroir, depuis « Archivé » -------- */

  const parBouton = CARTES[1];
  const libelle = await ouvrirCarte(page, parBouton.titre);
  noter('le tiroir d’une carte archivée porte « Sortir de l’archive »', /Sortir de l’archive/.test(libelle ?? ''), String(libelle));
  noter('le bouton annonce où elle retombe', /archive/i.test(libelle ?? ''), String(libelle));
  await page.screenshot({ path: path.join(TMP, '3-bouton.png') });
  const avantClic = lireCarte(parBouton.id);
  await cliquerReprise(page);
  const sortieBouton = lireCarte(parBouton.id);
  noter('le bouton la ramène dans « Planifié »', sortieBouton?.column === 'planned', sortieBouton?.column);
  noter(
    'sa date d’archivage, vieille de trois jours, est intacte',
    !!avantClic?.archivedAt && sortieBouton?.archivedAt === avantClic.archivedAt,
    String(sortieBouton?.archivedAt),
  );

  /* -------- 4. Le même bouton depuis « À déployer » -------- */

  const duLot = CARTES[2];
  const libelleLot = await ouvrirCarte(page, duLot.titre);
  noter(
    'le tiroir d’une carte du lot à publier porte « Retirer du lot à publier »',
    /Retirer du lot à publier/.test(libelleLot ?? ''),
    String(libelleLot),
  );
  await cliquerReprise(page);
  const sortieLot = lireCarte(duLot.id);
  noter('elle repasse en « Terminé », rien n’est mis en ligne', sortieLot?.column === 'done', sortieLot?.column);
  noter('aucune date de publication n’a été inventée', !sortieLot?.deployedAt, String(sortieLot?.deployedAt));

  /* -------- 5. Un bouton qui n'a pas lieu d'être ne s'affiche pas -------- */

  const ailleurs = await ouvrirCarte(page, glissee.titre);
  noter('une carte de « Planifié » n’a aucun bouton de reprise', ailleurs === null, String(ailleurs));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

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
