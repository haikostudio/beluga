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

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_NOTIFS_PORT || 7196);
const PORT_SITES = Number(process.env.HAIKODEV_NOTIFS_SITES_PORT || 7197);
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
const base = () => new Database(path.join(DATA, 'haikodev.db'));

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
  await context.addCookies([{ name: 'haikodev_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
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
    await page.waitForSelector('[data-column="notes"]', { timeout: 30000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    /* ---- 1. La cloche est là, à droite, AVANT toute notification ---- */
    const cloche = page.locator('[data-cloche-notifications]');
    noter('la cloche vit dans le bandeau du haut', (await cloche.count()) === 1);
    noter(
      'elle est visible alors que rien n’attend encore',
      await cloche.isVisible(),
    );
    const aDroite = await page.evaluate(() => {
      const bouton = document.querySelector('[data-cloche-notifications]');
      const bandeau = bouton?.closest('header');
      if (!bouton || !bandeau) return null;
      const b = bouton.getBoundingClientRect();
      const h = bandeau.getBoundingClientRect();
      // Dans la moitié DROITE du bandeau : la place d'une cloche.
      return b.left > h.left + h.width / 2;
    });
    noter('elle est posée dans la moitié droite du bandeau', aDroite === true);
    noter('aucune pastille tant que rien n’attend', (await page.locator('[data-repere-questions]').count()) === 0);

    /* ---- 2. Deux questions posées : la pastille s'allume ---- */
    poserQuestion(AGENT_TACHE, TEXTES.carte);
    poserQuestion(AGENT_CHEF, TEXTES.conversation);
    // Les décisions sont relues à la connexion : on recharge la page.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-column="notes"]', { timeout: 30000 });
    await page.keyboard.press('Escape');
    const pastille = page.locator('[data-repere-questions]');
    await pastille.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    noter('la pastille annonce les 2 questions', (await pastille.textContent())?.trim() === '2');

    /* ---- 3. Une chute de site : le guichet pousse une annonce ---- */
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
     * jamais visité) emmène aussi à sa conversation. Ce chemin est distinct de
     * celui d'une carte : `allerVersDecision` bascule sur `openConversation`,
     * qui ouvre le TIROIR d'agent (`data-tiroir-agent`) plutôt que le tiroir de
     * carte. Jamais rejoué avant ce script, alors que c'est le même bouton.
     */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await cloche.click();
    await tiroir.waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-notification]', { hasText: TEXTES.conversation }).click();
    const tiroirAgentDepuisNotif = page.locator('[role="dialog"][data-state="open"]', {
      has: page.locator('[data-tiroir-agent]'),
    });
    await tiroirAgentDepuisNotif.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    noter(
      'une question sans carte ouvre le tiroir de conversation de son agent',
      (await tiroirAgentDepuisNotif.count()) > 0 && (await page.getByText(TEXTES.conversation).count()) > 0,
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
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
     * La réponse libre ne se tape plus dans la bulle de la question (elle
     * n'a plus de champ à elle, `message-view.tsx`) : elle se tape dans la
     * barre de la conversation, qui la remet à la question ouverte
     * (`texteRepondALaQuestion`, `shared/src/attente-question.ts`).
     */
    if ((await page.getByText(TEXTES.carte).count()) > 0) {
      await page.getByPlaceholder('Écrivez votre demande…').fill('Bleu, comme le reste.');
      await page.keyboard.press('Enter');
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

    /* ---- 9. Un agent s'ouvre dans le TIROIR commun ---- */
    const pile = page.locator('[data-pile-agents-colonne]');
    let agentEnTiroir = 'pile absente';
    if ((await pile.count()) > 0) {
      /*
       * On SURVOLE, on ne clique pas : la pile s'ouvre déjà au survol, et le
       * clic qui suivrait la refermerait aussitôt.
       */
      await pile.hover();
      await page.waitForTimeout(600);
      const vignette = page.locator('[data-vignette-agent-colonne] button').first();
      if ((await vignette.count()) > 0) {
        await vignette.click();
        const tiroirAgent = page.locator('[role="dialog"][data-state="open"]', {
          has: page.locator('[data-tiroir-agent]'),
        });
        await tiroirAgent.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
        agentEnTiroir = (await tiroirAgent.count()) > 0 ? 'ok' : 'pas de tiroir';
      } else {
        agentEnTiroir = 'aucune vignette';
      }
    }
    noter('un agent ouvert depuis la colonne de gauche s’ouvre dans le tiroir commun', agentEnTiroir === 'ok', agentEnTiroir);
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
