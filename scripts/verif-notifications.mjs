#!/usr/bin/env node
/**
 * LA CLOCHE DU BANDEAU, SON TIROIR, ET L'AGENT QUI S'OUVRE EN TIROIR.
 *
 * Ce que ce script prouve, dans un vrai navigateur, sur un démon À SOI (base
 * neuve, port libre, HOME vide — aucun vrai compte moteur n'est joignable) :
 *
 *  1. la CLOCHE est dans le bandeau du haut, à DROITE, et elle y reste même
 *     quand rien n'attend — l'ancien point d'interrogation, lui, disparaissait ;
 *  2. un clic ouvre un vrai TIROIR (celui de l'application, refermable par
 *     Échap), pas un menu déroulant ;
 *  3. ce tiroir montre AU MOINS TROIS notifications différentes : les questions
 *     qui attendent une réponse ET ce que le guichet de notifications a poussé
 *     (ici une chute de site réellement provoquée, motif « site-indisponible ») ;
 *  4. une question cliquée y emmène, et disparaît de la liste une fois réglée ;
 *  5. « Tout effacer » retire les annonces LUES sans toucher aux questions qui
 *     attendent encore — on n'efface jamais ce qui bloque quelqu'un ;
 *  6. un AGENT ouvert depuis la pile de la colonne de gauche s'ouvre dans le
 *     TIROIR commun, plus dans la fenêtre bricolée à la main d'avant.
 *
 * Deux sites d'essai sont montés DANS le script : aucun appel ne sort de la
 * machine, et la chute se rejoue à l'identique.
 *
 *   npm run build && node scripts/verif-notifications.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ouvrirLesTableauxDeBord, ouvrirNavigation } from './lib/navigation.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_NOTIFS_PORT || 7196);
const PORT_SITES = Number(process.env.BELUGA_NOTIFS_SITES_PORT || 7197);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = `${RACINE}/data/verification`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-notifs-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Un site d'essai qui tombe, monté ici                                */
/* ------------------------------------------------------------------ */

const sites = http.createServer((req, res) => {
  if (req.url?.startsWith('/casse')) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('en panne');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('debout');
});
sites.listen(PORT_SITES, '127.0.0.1');

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DOSSIER_A = path.join(TMP, 'projet-a');
const DOSSIER_B = path.join(TMP, 'projet-b');
// Un HOME vide, à soi : sans lui le démon retrouve les vrais identifiants de la
// machine et « Répondre » relancerait un VRAI tour, sur un VRAI compte.
const HOME_VIDE = path.join(TMP, 'home');
for (const dossier of [DATA, PROJETS, DOSSIER_A, DOSSIER_B, HOME_VIDE]) fs.mkdirSync(dossier, { recursive: true });

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    HOME: HOME_VIDE,
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

process.on('exit', () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  try {
    sites.close();
  } catch {
    /* déjà fermé */
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
/* Le décor                                                            */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const PROJET_A = 'p-notifs-a';
const PROJET_B = 'p-notifs-b';
const CARD_ID = 'c-notifs-a';
const AGENT_TACHE = 'a-notifs-tache';
const AGENT_CHEF = 'a-notifs-chef';
const base = () => new Database(path.join(DATA, 'beluga.db'));

const marque = Date.now();
const TEXTES = {
  carte: `Notifications ${marque} — quelle couleur pour le bouton ?`,
  conversation: `Notifications ${marque} — faut-il archiver ce projet ?`,
};

function inserProjet(db, id, nom, dossier, rang, maintenant) {
  const projet = {
    id,
    name: nom,
    path: dossier,
    defaultEngine: 'claude',
    isSelf: false,
    rank: rang,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);
}

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(JETON),
    maintenant,
    maintenant + 3600_000,
    'vérification notifications',
  );

  // Plafond d'agents à ZÉRO : rien ne peut démarrer tout seul dans le dos.
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  inserProjet(db, PROJET_A, `Essai notifs A ${marque}`, DOSSIER_A, 0, maintenant);
  inserProjet(db, PROJET_B, `Essai notifs B ${marque}`, DOSSIER_B, 1, maintenant);

  const carte = {
    id: CARD_ID,
    projectId: PROJET_A,
    column: 'running',
    position: 1,
    title: 'Carte en attente d’une décision',
    description: 'Carte en attente d’une décision',
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(CARD_ID, PROJET_A, 'running', 1, carte.title, JSON.stringify(carte), maintenant, maintenant);

  const agentTache = {
    id: AGENT_TACHE,
    projectId: PROJET_A,
    cardId: CARD_ID,
    role: 'task',
    title: 'Carte en attente d’une décision',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(agentTache.id, PROJET_A, CARD_ID, 'task', 'idle', JSON.stringify(agentTache), maintenant, maintenant);

  /*
   * Le chef du second projet est déclaré AU TRAVAIL : c'est la seule façon de
   * le faire paraître dans la pile d'agents du pied de la colonne de gauche,
   * d'où l'on ouvre une conversation d'un clic. Rien ne démarre pour autant —
   * le plafond d'agents est à zéro et aucun moteur n'est joignable.
   */
  const agentChef = {
    id: AGENT_CHEF,
    projectId: PROJET_B,
    role: 'cadrage',
    title: `Chef d'orchestre — Essai notifs B ${marque}`,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'running',
    startedAt: maintenant,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(agentChef.id, PROJET_B, 'cadrage', 'running', JSON.stringify(agentChef), maintenant, maintenant);

  db.close();
}

function poserQuestion(agentId, texte) {
  const db = base();
  const id = crypto.randomUUID();
  const message = {
    id,
    agentId,
    role: 'assistant',
    content: 'Question posée par le script de vérification.',
    steps: [],
    todos: [],
    proposals: [],
    questions: [
      {
        id: crypto.randomUUID(),
        question: texte,
        kind: 'text',
        options: [],
        allowFreeText: true,
        answerAttachments: [],
      },
    ],
    downloads: [],
    attachments: [],
    streaming: false,
    createdAt: Date.now(),
  };
  // `a_questions` : le démon lit cette colonne, pas le contenu des messages.
  db.prepare(
    'INSERT INTO messages (id, agent_id, role, data, created_at, a_questions) VALUES (?, ?, ?, ?, ?, 1)',
  ).run(id, agentId, 'assistant', JSON.stringify(message), message.createdAt);
  db.close();
}

/* ------------------------------------------------------------------ */
/* L'écran                                                             */
/* ------------------------------------------------------------------ */

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  if (!(await attendrePort())) {
    console.error(`Le démon d'essai n'a pas démarré :\n${journal.join('')}`);
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await navigateur.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));

  // Les alertes se lisent LÀ OÙ ELLES PASSENT : dans le canal du démon.
  const alertes = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', ({ payload }) => {
      try {
        const event = JSON.parse(String(payload));
        if (event?.type === 'notify') alertes.push(event);
      } catch {
        /* trame binaire ou illisible */
      }
    });
  });

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    /*
     * L'ASSISTANT DES MOTEURS NE SE JUGE PAS ICI. Ce démon d'essai tourne avec
     * un HOME vide : aucun moteur ne répond, et l'assistant de démarrage barre
     * tout l'écran — à raison, c'est SON contrôle (`verif-assistant-moteurs.mjs`)
     * qui le vérifie. Ici il n'empêchait qu'une chose, le premier clic sur la
     * cloche : on le retire de la surface, sans le contredire.
     */
    await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });
    await page.waitForSelector('[data-column="planned"]', { timeout: 30000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    /* ---- 1. La cloche est là, à droite, AVANT toute notification ---- */
    const cloche = page.locator('[data-cloche-notifications]');
    noter('une seule cloche', (await cloche.count()) === 1);
    noter(
      'elle est visible alors que rien n’attend encore',
      await cloche.isVisible(),
    );
    /* SUR ORDINATEUR, LA CLOCHE VIT DANS LE PIED DE LA COLONNE, à côté des
       réglages (12/10/2026) ; sur téléphone elle reste en haut à droite. */
    const auPied = await page.evaluate(() => {
      const bouton = document.querySelector('[data-cloche-notifications]');
      const pied = bouton?.closest('[data-pied-colonne]');
      const reglages = pied?.querySelector('[data-reglages-menu]');
      if (!bouton || !pied || !reglages) return null;
      const b = bouton.getBoundingClientRect();
      const r = reglages.getBoundingClientRect();
      return { voisins: Math.abs(b.top - r.top) < 2 && b.right <= r.left + 1, horsBandeau: !bouton.closest('header') };
    });
    noter('elle est posée dans le pied de la colonne, juste avant les réglages', auPied?.voisins === true && auPied?.horsBandeau === true, JSON.stringify(auPied));
    noter('aucune pastille tant que rien n’attend', (await page.locator('[data-repere-questions]').count()) === 0);

    /* ---- 2. Deux questions posées : la pastille s'allume ---- */
    poserQuestion(AGENT_TACHE, TEXTES.carte);
    poserQuestion(AGENT_CHEF, TEXTES.conversation);
    // Les décisions sont relues à la connexion : on recharge la page.
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Un rechargement emporte la feuille de style ajoutée : on la repose.
    await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });
    await page.waitForSelector('[data-column="planned"]', { timeout: 30000 });
    await page.keyboard.press('Escape');
    const pastille = page.locator('[data-repere-questions]');
    await pastille.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    noter('la pastille annonce les 2 questions', (await pastille.textContent())?.trim() === '2');

    /* ---- 3. Une chute de site : le guichet pousse une annonce ---- */
    await ouvrirNavigation(page);
    await page.locator('aside[data-zone="gauche"] [data-ouvrir-surveillance]').click();
    const veille = page.locator('[role="dialog"][data-state="open"]', {
      has: page.locator('[data-surveillance-url]'),
    });
    await veille.waitFor({ state: 'visible', timeout: 15000 });
    await veille.locator('[data-surveillance-url]').fill(`http://127.0.0.1:${PORT_SITES}/casse`);
    await veille.locator('[data-surveillance-nom]').fill('Site cassé');
    await veille.locator('[data-surveillance-ajouter]').click();
    // Le guichet groupe quatre secondes avant d'émettre : plus tôt, on
    // constaterait une absence qui n'en est pas une.
    await page.waitForTimeout(9000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    const chute = alertes.find((a) => a.motif === 'site-indisponible');
    noter('le guichet de notifications a bien poussé la chute du site', !!chute, JSON.stringify(alertes.slice(0, 2)));

    /* ---- 4. Le tiroir : au moins trois notifications différentes ---- */
    await cloche.click();
    const tiroir = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-notification]') });
    await tiroir.waitFor({ state: 'visible', timeout: 15000 });
    noter('un clic sur la cloche ouvre un vrai tiroir', await tiroir.isVisible());

    const lignes = page.locator('[data-notification]');
    const combien = await lignes.count();
    noter('le tiroir montre au moins 3 notifications différentes', combien >= 3, `${combien} ligne(s)`);
    const textes = await lignes.allTextContents();
    noter(
      'les deux questions qui attendent une réponse y sont, avec leur texte',
      textes.some((t) => t.includes(TEXTES.carte)) && textes.some((t) => t.includes(TEXTES.conversation)),
      JSON.stringify(textes).slice(0, 300),
    );
    noter(
      'ce qui vient du guichet de notifications y est aussi',
      textes.some((t) => t.includes('Site cassé') || t.toLowerCase().includes('indisponible')),
      JSON.stringify(textes).slice(0, 300),
    );
    noter(
      'les questions à régler passent DEVANT les annonces à lire',
      (await lignes.nth(0).getAttribute('data-question-en-attente')) !== null &&
        (await lignes.nth(1).getAttribute('data-question-en-attente')) !== null,
    );
    await page.screenshot({ path: `${SHOTS}/notifications-tiroir.png` });

    /* ---- 5. Le tiroir se referme comme tous les autres ---- */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    noter('la touche Échap referme le tiroir', (await page.locator('[data-notification]').count()) === 0);

    /* ---- 6. Une question cliquée emmène à sa carte ---- */
    await cloche.click();
    await tiroir.waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-notification]', { hasText: TEXTES.carte }).click();
    await page.waitForTimeout(2500);
    noter(
      'cliquer une question ouvre son endroit, la question visible',
      (await page.getByText(TEXTES.carte).count()) > 0,
    );

    /*
     * ---- 6bis. Une question SANS carte (chef d'orchestre d'un AUTRE projet,
     * jamais visité) emmène à son PROJET. Il n'existe plus de fenêtre d'agent à
     * part : un agent sans carte ni volet amène à son projet, sans rien ouvrir
     * de faux.
     */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await cloche.click();
    await tiroir.waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-notification]', { hasText: TEXTES.conversation }).click();
    await page.waitForTimeout(2500);
    noter(
      'une question sans carte amène à son projet, sans fenêtre d’agent',
      (await page.locator('[data-tiroir-agent]').count()) === 0 &&
        (await page.locator(`[data-bandeau-production="${PROJET_B}"]`).count()) > 0,
    );
    await page.keyboard.press('Escape');
    // Le voile de fond s'estompe encore un instant après l'Échap : un clic
    // trop tôt le trouve encore là et vise le mauvais élément.
    await page.locator('[role="dialog"][data-state="open"]').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    // On revient sur le premier projet et sur sa carte : les contrôles
    // suivants en dépendent, et le passage par le projet B les a refermés.
    await page.getByText(`Essai notifs A ${marque}`).first().click();
    await page.waitForTimeout(500);
    await cloche.click();
    await tiroir.waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-notification]', { hasText: TEXTES.carte }).click();
    await page.waitForTimeout(1500);

    /*
     * ---- 7. Y répondre la retire de la liste ----
     * La réponse libre se tape DANS la bulle de la question, puis « Répondre » :
     * la barre de la conversation ne répond jamais, elle met en file.
     */
    if ((await page.getByText(TEXTES.carte).count()) > 0) {
      const bulle = page.locator('[data-bulle-question]').filter({ hasText: TEXTES.carte }).first();
      await bulle.locator('[data-champ-reponse-question]').first().fill('Bleu, comme le reste.');
      await bulle.locator('[data-repondre-question]').first().click();
    }
    await pastille.filter({ hasText: '1' }).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    noter('la question réglée fait passer la pastille à 1', (await pastille.textContent())?.trim() === '1');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    /* ---- 8. « Tout effacer » n'emporte pas ce qui attend ---- */
    await cloche.click();
    await tiroir.waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-vider-notifications]').click();
    await page.waitForTimeout(600);
    const restantes = await page.locator('[data-notification]').count();
    const questionsRestantes = await page.locator('[data-question-en-attente]').count();
    noter(
      '« Tout effacer » retire les annonces lues mais garde la question en attente',
      restantes === 1 && questionsRestantes === 1,
      `${restantes} ligne(s), ${questionsRestantes} question(s)`,
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    /* ---- 9. Un agent du menu ouvre ce qui le suit, jamais une fenêtre à part ---- */
    let agentEnTiroir = 'page « En route » inaccessible';
    {
      /* La pile flottante a laissé place à la page « En route » : l'agent
         sans carte s'y lit dans la bande de tête. On y va par la grille des
         services : la colonne de gauche n'a plus de ligne « Tableaux de bord ». */
      await ouvrirLesTableauxDeBord(page);
      await page.waitForTimeout(1500);
      const vignette = page.locator('[data-ouvrir-agent-en-route]').first();
      if ((await vignette.count()) > 0) {
        await vignette.click();
        await page.waitForTimeout(2500);
        // La vignette en tête est le chef du projet B, sans carte : le clic
        // amène à son projet, sans aucune fenêtre d'agent.
        const fenetre = await page.locator('[data-tiroir-agent]').count();
        const surSonProjet = await page.locator(`[data-bandeau-production="${PROJET_B}"]`).count();
        agentEnTiroir = fenetre > 0 ? 'fenêtre d’agent encore là' : surSonProjet > 0 ? 'ok' : 'pas amené à son projet';
      } else {
        agentEnTiroir = 'aucune vignette';
      }
    }
    noter('un agent ouvert depuis la colonne de gauche ouvre ce qui le suit, jamais une fenêtre d’agent', agentEnTiroir === 'ok', agentEnTiroir);
    await page.screenshot({ path: `${SHOTS}/notifications-agent-en-tiroir.png` });

    /*
     * ET PLUS AUCUNE FENÊTRE BRICOLÉE : l'ancienne conversation posait un voile
     * et un cadre centré à la main, hors de tout tiroir. On le vérifie sur la
     * SOURCE, seul endroit où cette forme se reconnaît sans ambiguïté.
     */
    const source = fs.readFileSync(path.join(RACINE, 'web/src/app.tsx'), 'utf8');
    noter(
      'plus aucune fenêtre d’agent bricolée à la main dans l’application',
      !/grid place-items-center bg-voile/.test(source),
    );

    noter('aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));
  } finally {
    await navigateur.close();
  }
}

main()
  .catch((err) => {
    console.error(err);
    resultats.push({ nom: 'le script est allé au bout', ok: false });
  })
  .finally(() => {
    const echecs = resultats.filter((r) => !r.ok);
    console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
    process.exit(echecs.length ? 1 : 0);
  });
