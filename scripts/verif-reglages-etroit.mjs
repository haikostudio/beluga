#!/usr/bin/env node
/**
 * LA MODALE DES RÉGLAGES TIENT DANS UN TÉLÉPHONE — TOUTES SES PAGES.
 *
 *   node scripts/verif-reglages-etroit.mjs
 *
 * Sur un écran de 390 px, la fiche d'un compte posait son nom, ses badges et
 * ses boutons sur UNE SEULE rangée non repliable : le nom se retrouvait écrasé
 * sur une colonne d'un caractère de large, illisible. Le contrôle mesure donc
 * les DÉBORDEMENTS RÉELS (`getBoundingClientRect().right`) sur chaque page du
 * menu, à 390 puis à 320 px, et vérifie au passage les trois gestes de la fiche de
 * compte : l'identité affichée, « Reconnecter » ouvert sur TOUS les comptes, et
 * le retrait avec sa confirmation.
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et
 * un faux dossier personnel : aucun compte réel n'est touché, aucun moteur
 * appelé, aucun quota dépensé.
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

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_REGLAGES_PORT || 7233);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-reglages-etroit-'));
const SHOTS = process.env.BELUGA_REGLAGES_CAPTURES || path.join(TMP, 'captures');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const MAISON = path.join(TMP, 'maison');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
for (const dossier of [DATA, MAISON, PROJETS, DEPOT, SHOTS]) fs.mkdirSync(dossier, { recursive: true });

execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
  cwd: DEPOT,
});

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    // Un faux dossier personnel : l'amorçage ne trouve AUCUN coffre réel, et
    // les comptes du serveur ne sont ni lus ni interrogés.
    HOME: MAISON,
    CURSOR_API_KEY: '',
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const journal = [];
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));

function nettoyer() {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
}
process.on('exit', nettoyer);

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
/* Le décor : deux coffres branchés sur le MÊME compte Anthropic       */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const MEME_COMPTE = '74b52c30-f844-4f64-969e-d4b4ca630be4';
const ADRESSE = 'compte.dessai@exemple.test';
/* Des noms VOLONTAIREMENT longs : c'est ce qui écrasait la rangée. */
const A = { id: 'claude-principal', label: 'Haiko Studio — Claude Max x20 (compte principal)' };
const B = { id: 'claude-secondary', label: 'Haiko Studio — Claude Max x20 (second coffre)' };

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification réglages étroits',
  );

  const projet = {
    id: 'p-essai',
    name: 'Essai réglages',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, 0, JSON.stringify(projet), maintenant, maintenant);

  const poserCompte = (compte, disabled) => {
    const record = {
      id: compte.id,
      engine: 'claude',
      label: compte.label,
      plan: 'Max x20',
      priority: 10,
      configDir: path.join(DATA, 'accounts', compte.id),
      ...(disabled ? { disabled: true } : {}),
    };
    fs.mkdirSync(record.configDir, { recursive: true });
    db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
      record.id,
      'claude',
      JSON.stringify(record),
      maintenant,
    );
  };
  /* Le premier est en service ; le second est EN PAUSE, avec un dernier relevé
     qui s'était bien passé — c'est le compte « sain » de ce décor. */
  poserCompte(A, false);
  poserCompte(B, true);

  /* Le dernier relevé connu de chacun : mêmes chiffres, MÊME identité. */
  const releve = (compte) => ({
    id: compte.id,
    engine: 'claude',
    label: compte.label,
    plan: 'Max x20',
    priority: 10,
    active: false,
    available: true,
    session: { usedPct: 41, resetsAt: maintenant + 3 * 3600_000, durationSeconds: 5 * 3600 },
    weekly: { usedPct: 15, resetsAt: maintenant + 4 * 24 * 3600_000, durationSeconds: 7 * 24 * 3600 },
    identite: {
      compteFournisseur: MEME_COMPTE,
      adresse: ADRESSE,
      organisation: '2bef33fe-cd35-4c5b-ab97-df932a829440',
      palier: 'Max x20',
      luA: maintenant,
    },
    fetchedAt: maintenant,
  });
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    'quotas.last',
    JSON.stringify([releve(A), releve(B)]),
  );
  db.close();
}

/* ------------------------------------------------------------------ */
/* Ce qui déborde                                                      */
/* ------------------------------------------------------------------ */

/**
 * LES ÉLÉMENTS QUI SORTENT DE LEUR CADRE, mesurés sur le bord droit RÉEL —
 * jamais sur une hauteur de page, qui change à chaque retouche d'affichage. On
 * ne juge que les éléments qui portent du TEXTE : un décor qui dépasse d'un
 * pixel n'a jamais gêné personne.
 */
async function debordements(page, cadre) {
  return page.evaluate((selecteur) => {
    const trouves = [...document.querySelectorAll(selecteur)];
    const racine = trouves[trouves.length - 1];
    if (!racine) return ['cadre introuvable'];
    const bord = racine.getBoundingClientRect().right;
    /*
     * UNE ZONE QUI DÉFILE N'EST PAS UN DÉBORDEMENT : ce qui y dépasse se
     * rattrape en faisant glisser. On ne juge donc que ce qui vit HORS d'un
     * conteneur à défilement horizontal.
     */
    const dansUneBandeQuiDefile = (noeud) => {
      for (let parent = noeud.parentElement; parent && parent !== racine; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (/(auto|scroll)/.test(style.overflowX)) return true;
        // Un texte COUPÉ par son parent (« truncate ») ne dépasse pas : il est
        // découpé au bord. Sa boîte, elle, garde la largeur du texte entier —
        // la mesurer accuserait à tort un affichage parfaitement propre.
        if (/(hidden|clip)/.test(style.overflowX)) return true;
      }
      return false;
    };
    const fautifs = [];
    for (const noeud of racine.querySelectorAll('*')) {
      const texte = (noeud.textContent ?? '').trim();
      if (!texte) continue;
      const boite = noeud.getBoundingClientRect();
      if (boite.width === 0 || boite.height === 0) continue;
      if (dansUneBandeQuiDefile(noeud)) continue;
      // Deux pixels de tolérance : les bordures et les ombres arrondissent.
      if (boite.right > bord + 2) {
        fautifs.push(`${noeud.tagName.toLowerCase()} « ${texte.slice(0, 40)} » à ${Math.round(boite.right)} pour ${Math.round(bord)}`);
      }
      // UNE COLONNE D'UN CARACTÈRE DE LARGE : le défaut de la capture.
      if (boite.width < 24 && texte.length > 8 && noeud.children.length === 0) {
        fautifs.push(`${noeud.tagName.toLowerCase()} « ${texte.slice(0, 40)} » écrasé à ${Math.round(boite.width)} px`);
      }
    }
    return fautifs.slice(0, 6);
  }, cadre);
}

/* ------------------------------------------------------------------ */

async function main() {
  // La base n'existe qu'une fois le démon passé par ses migrations : le décor
  // se pose donc APRÈS, et le cache des quotas est relu à la première demande.
  if (!(await attendrePort())) {
    noter('le démon d’essai répond', false, journal.join('').slice(-600));
    return;
  }
  noter('le démon d’essai répond', true);
  await new Promise((r) => setTimeout(r, 1500));
  poserLeDecor();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const contexte = await navigateur.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([
    { name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);

  /* LES RÉGLAGES S'OUVRENT PAR L'ADRESSE : sur une base neuve, le bandeau du
     haut n'est pas toujours celui qu'on croit (l'écran « aucun moteur » passe
     devant), et un clic deviné dans l'entête tombait en attente. */
  const ouvrirLesReglages = async () => {
    if (await page.locator('[data-modale-reglages]').count()) return;
    await page.evaluate(() => {
      window.location.hash = 'reglages';
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.waitForSelector('[data-modale-reglages]', { timeout: 20_000 });
    await page.waitForTimeout(800);
  };
  await ouvrirLesReglages();

  const tiroir = page.locator('[data-modale-reglages]').last();
  noter('la modale des réglages s’ouvre', await tiroir.isVisible());

  /* SUR TÉLÉPHONE, la page choisie RECOUVRE le menu : pour ouvrir une page, on
     clique sa ligne dans le menu, et le bouton de retour ramène au menu. */
  const ouvrirLaPage = async (cle) => {
    const retour = tiroir.locator('[data-retour-menu-reglages]');
    if (await retour.isVisible().catch(() => false)) {
      await retour.click();
      await page.waitForTimeout(400);
    }
    await tiroir.locator(`[data-page-menu="${cle}"]`).click();
    await page.waitForSelector(`[data-page-reglages="${cle}"]`, { timeout: 10_000 });
    await page.waitForTimeout(600);
  };

  /* ---- La fiche de compte : identité, jumeaux, gestes -------------- */

  await ouvrirLaPage('comptes');
  await page.waitForTimeout(800);

  noter(
    'chaque fiche dit à quel compte elle est branchée',
    (await tiroir.locator(`text=${ADRESSE}`).count()) >= 2,
    `${await tiroir.locator(`text=${ADRESSE}`).count()} fiche(s)`,
  );
  const phraseJumeaux = (await tiroir.locator('[data-comptes-jumeaux]').first().textContent()) ?? '';
  noter(
    'deux coffres au même compte le disent comme un FAIT, pas comme un relevé',
    /Même compte/.test(phraseJumeaux),
    phraseJumeaux.trim().slice(0, 80),
  );
  noter(
    '« Reconnecter » est ouvert sur TOUS les comptes',
    (await tiroir.locator('[data-reconnecter-compte]').count()) === 2,
    `${await tiroir.locator('[data-reconnecter-compte]').count()} bouton(s)`,
  );

  /* Le compte SAIN (celui en pause, dont le dernier relevé était bon) demande
     une confirmation avant de remplacer sa session. */
  await tiroir.locator(`[data-reconnecter-compte="${B.id}"]`).click();
  await page.waitForTimeout(400);
  const confirmation = tiroir.locator(`[data-confirmation-reconnexion="${B.id}"]`);
  noter('reconnecter un compte sain demande d’abord confirmation', await confirmation.isVisible());
  noter(
    '…et la confirmation NOMME le compte visé',
    ((await confirmation.textContent()) ?? '').includes(B.label),
  );
  await confirmation.getByRole('button', { name: 'Annuler' }).click();
  await page.waitForTimeout(300);

  /* ---- Le retrait, jusqu'au bout ---------------------------------- */

  await tiroir.locator(`[data-retirer-compte="${B.id}"]`).click();
  await page.waitForTimeout(400);
  const confirmationRetrait = tiroir.locator(`[data-confirmation-retrait="${B.id}"]`);
  noter('retirer un compte demande confirmation', await confirmationRetrait.isVisible());
  noter(
    '…et la confirmation dit que les identifiants restent sur le serveur',
    /identifiants restent/.test((await confirmationRetrait.textContent()) ?? ''),
  );
  await confirmationRetrait.getByRole('button', { name: 'Retirer' }).click();
  await page.waitForTimeout(2500);
  noter(
    'le compte retiré disparaît de la liste',
    (await tiroir.locator(`text=${B.label}`).count()) === 0,
    `${await tiroir.locator(`text=${B.label}`).count()} reste(s)`,
  );

  /* ---- Le volet des quotas, sur un écran étroit -------------------- */

  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  /*
   * Le décor n'a AUCUN moteur installé (c'est un démon d'essai, sans outil en
   * ligne de commande) : l'assistant de démarrage barre donc l'écran, comme il
   * doit. Ce n'est pas ce qu'on mesure ici, et il masque la barre du haut : on
   * l'écarte le temps de la mesure, sans toucher au volet lui-même.
   */
  await page.evaluate(() => {
    const barrage = document.querySelector('[data-assistant-moteurs]');
    if (barrage) barrage.style.display = 'none';
  });
  for (const largeur of [390, 320]) {
    await page.setViewportSize({ width: largeur, height: 844 });
    await page.waitForTimeout(500);
    await page.locator('header button[title="Quotas des moteurs"]').first().click();
    await page.waitForTimeout(900);
    const volet = page.locator('[role="dialog"], [role="menu"]').last();
    const fautifs = await debordements(page, '[role="dialog"], [role="menu"]');
    noter(
      `à ${largeur} px, le volet des quotas tient dans son cadre`,
      (await volet.count()) > 0 && fautifs.length === 0,
      fautifs.join(' · '),
    );
    await volet.screenshot({ path: path.join(SHOTS, `quotas-${largeur}.png`) }).catch(() => {});
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await ouvrirLesReglages();
  await page.waitForTimeout(800);

  /* ---- L'étroitesse, PAGE PAR PAGE -------------------------------- */

  const retourAuMenu = tiroir.locator('[data-retour-menu-reglages]');
  if (await retourAuMenu.isVisible().catch(() => false)) {
    await retourAuMenu.click();
    await page.waitForTimeout(400);
  }
  const pages = await tiroir
    .locator('[data-page-menu]')
    .evaluateAll((noeuds) => noeuds.map((n) => n.getAttribute('data-page-menu')));
  noter('le menu porte toutes ses pages sur un téléphone', pages.length >= 15, `${pages.length} pages`);

  for (const largeur of [390, 320]) {
    await page.setViewportSize({ width: largeur, height: 844 });
    await page.waitForTimeout(600);
    for (const cle of pages) {
      await ouvrirLaPage(cle);
      const fautifs = await debordements(page, '[data-modale-reglages]');
      noter(`à ${largeur} px, la page « ${cle} » tient dans son cadre`, fautifs.length === 0, fautifs.join(' · '));
      if (cle === 'comptes') {
        await tiroir.screenshot({ path: path.join(SHOTS, `reglages-comptes-${largeur}.png`) }).catch(() => {});
      }
    }
  }

  await navigateur.close();
}

await main().catch((err) => noter('le contrôle va au bout', false, String(err?.message ?? err)));

const reussis = resultats.filter((r) => r.ok).length;
console.log(`\n${reussis}/${resultats.length} contrôles passés.`);
process.exit(reussis === resultats.length ? 0 : 1);
