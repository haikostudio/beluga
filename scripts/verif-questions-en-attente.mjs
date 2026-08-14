#!/usr/bin/env node
/**
 * Les questions d'agent en attente de réponse doivent se voir de PARTOUT, pas
 * seulement en cliquant sur le triangle orange d'un projet précis.
 *
 * Ce script monte son PROPRE démon, sur un port libre, avec une base neuve, et
 * pose deux décisions dans DEUX projets différents :
 *   - une question posée sur la CARTE d'un projet (agent de rôle « task ») ;
 *   - une question posée sur la CONVERSATION du chef d'un autre projet (pas de
 *     carte).
 *
 * Le parcours complet, dans un vrai navigateur : la cloche du bandeau du haut
 * annonce le bon compte, la liste montre le projet, l'endroit et le texte de
 * chaque question, un clic sur l'une emmène au bon endroit (carte ou
 * conversation) où la question est visible, y répondre l'éteint, et le compte
 * de la cloche baisse tout seul, sans recharger la page.
 *
 *   npm run build && node scripts/verif-questions-en-attente.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7192);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = `${RACINE}/data/verification`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-questions-'));

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
const DOSSIER_A = path.join(TMP, 'projet-a');
const DOSSIER_B = path.join(TMP, 'projet-b');
const DOSSIER_C = path.join(TMP, 'projet-c');
// Un HOME vide, à soi : sans lui, le démon retrouve les vrais identifiants
// Claude/Codex de la machine et « Répondre » relancerait un VRAI tour, sur le
// VRAI compte — exactement ce qu'on ne veut jamais d'un script de vérification.
const HOME_VIDE = path.join(TMP, 'home');
for (const dossier of [DATA, PROJETS, DOSSIER_A, DOSSIER_B, DOSSIER_C, HOME_VIDE]) fs.mkdirSync(dossier, { recursive: true });

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
/* Le décor : deux projets, une question sur une carte, une question   */
/* sur la conversation du chef                                         */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const PROJET_C = 'p-questions-c';
const PROJET_A = 'p-questions-a';
const PROJET_B = 'p-questions-b';
const CARD_ID = 'c-questions-a';
const AGENT_TACHE = 'a-questions-tache';
const AGENT_CHEF = 'a-questions-chef';
const base = () => new Database(path.join(DATA, 'haikodev.db'));

const marque = Date.now();
const TEXTES = {
  carte: `Vérification ${marque} — quelle couleur pour le bouton ?`,
  conversation: `Vérification ${marque} — faut-il archiver ce projet ?`,
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
    'vérification questions en attente',
  );

  // Plafond d'agents à ZÉRO : rien ne peut démarrer tout seul dans le dos.
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  // Un TROISIÈME projet, sans aucune décision, de rang le plus bas : c'est
  // lui que l'application ouvre par défaut au chargement. Sans lui, la
  // « carte » de PROJET_A (rang 1, souvent choisi par défaut) n'exigeait
  // jamais de VRAI changement de projet pour être atteinte par un clic sur
  // la cloche — ce qui aurait laissé passer un bug propre à ce changement
  // (cartes chargées seulement pour le projet OUVERT, donc pas encore là au
  // moment du clic).
  inserProjet(db, PROJET_C, `Essai questions C ${marque} (par défaut)`, DOSSIER_C, 0, maintenant);
  inserProjet(db, PROJET_A, `Essai questions A ${marque}`, DOSSIER_A, 1, maintenant);
  inserProjet(db, PROJET_B, `Essai questions B ${marque}`, DOSSIER_B, 2, maintenant);

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

  const agentChef = {
    id: AGENT_CHEF,
    projectId: PROJET_B,
    role: 'orchestrator',
    title: `Chef d'orchestre — Essai questions B ${marque}`,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(agentChef.id, PROJET_B, 'orchestrator', 'idle', JSON.stringify(agentChef), maintenant, maintenant);

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
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    agentId,
    'assistant',
    JSON.stringify(message),
    message.createdAt,
  );
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
  poserQuestion(AGENT_TACHE, TEXTES.carte);
  poserQuestion(AGENT_CHEF, TEXTES.conversation);
  // La session et les décisions sont écrites sous le démon avant tout chargement.
  await new Promise((r) => setTimeout(r, 1000));

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
  // Chaque « project.open » envoyé par le client dit à quel projet
  // l'écran est vraiment passé — la preuve, indépendante du texte affiché,
  // qu'un clic sur la cloche a bien changé de projet et pas seulement ouvert
  // un tiroir sur celui déjà affiché.
  const projetsOuverts = [];
  page.on('websocket', (ws) => {
    ws.on('framesent', (frame) => {
      try {
        const msg = JSON.parse(frame.payload);
        const cmd = msg.cmd ?? msg;
        if (cmd.type === 'project.open') projetsOuverts.push(cmd.id);
      } catch {
        /* pas du JSON, ou pas ce message : ignoré */
      }
    });
  });
  page.on('pageerror', (error) => erreurs.push(String(error)));
  // La synthèse vocale est volontairement absente du démon isolé : son 503 ne
  // concerne pas ce qui est vérifié ici.
  page.on(
    'console',
    (m) => m.type() === 'error' && !/Failed to load resource.*503/.test(m.text()) && erreurs.push(m.text()),
  );

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    /* ---- 1. La cloche annonce le bon compte, même sans avoir ouvert
       aucun des deux projets ---- */
    const cloche = page.locator('[data-repere-questions]');
    await cloche.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    noter('la cloche des questions en attente est visible dans le bandeau du haut', (await cloche.count()) > 0);
    const badge = cloche.locator('span').last();
    noter('la cloche annonce 2 questions en attente', (await badge.textContent())?.trim() === '2');
    await page.screenshot({ path: `${SHOTS}/questions-en-attente-cloche.png` });

    /* ---- 2. Un clic ouvre la liste, avec projet, endroit et texte ---- */
    await cloche.click();
    await page.waitForTimeout(500);
    const items = page.locator('[data-question-en-attente]');
    noter('la liste ouverte montre les 2 questions', (await items.count()) === 2);
    const texteListe = await page.locator('[data-question-en-attente]').allTextContents();
    noter(
      'chaque entrée montre le projet, l’endroit (carte ou conversation) et le texte de la question',
      texteListe.some((t) => t.includes(`Essai questions A ${marque}`) && t.includes(TEXTES.carte)) &&
        texteListe.some((t) => t.includes(`Essai questions B ${marque}`) && t.includes(TEXTES.conversation)),
      JSON.stringify(texteListe),
    );
    await page.screenshot({ path: `${SHOTS}/questions-en-attente-liste.png` });

    /* ---- 2bis. On part bien du TROISIÈME projet, sans décision : les deux
       clics qui suivent exigent donc un VRAI changement de projet, pas
       seulement l'ouverture d'un tiroir sur le projet déjà affiché. Les
       cartes d'un projet ne sont chargées qu'une fois ce projet OUVERT
       (« project.open ») : cliquer une question qui vit ailleurs doit
       provoquer ce message, sinon le tiroir resterait vide en arrivant. ---- */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    noter('le projet ouvert par défaut est le troisième, sans décision', projetsOuverts.at(-1) === PROJET_C);

    await page.locator('[data-repere-questions]').click();
    await page.waitForTimeout(500);

    /* ---- 3. Cliquer une question de CARTE y emmène directement, sur un
       AUTRE projet que celui affiché ---- */
    const entreeCarte = page.locator('[data-question-en-attente]', { hasText: TEXTES.carte });
    await entreeCarte.click();
    await page.waitForTimeout(2000);
    noter('cliquer la question de la carte a bien ouvert le projet A (pas resté sur C)', projetsOuverts.at(-1) === PROJET_A);
    const questionVisibleSurCarte = await page.getByText(TEXTES.carte).count();
    noter('un clic sur la question de la carte ouvre la carte, question visible', questionVisibleSurCarte > 0);
    await page.screenshot({ path: `${SHOTS}/questions-en-attente-carte-ouverte.png` });

    /* ---- 4. Répondre depuis là éteint le signal, sans recharger ---- */
    const blocCarte = page
      .getByText(TEXTES.carte)
      .first()
      .locator('xpath=ancestor::div[contains(@class,"border-warning/40")][1]');
    if ((await blocCarte.count()) > 0) {
      await blocCarte.locator('textarea').fill('Bleu, comme le reste.');
      await blocCarte.getByRole('button', { name: 'Répondre' }).click();
    }
    const badgeCarte = page.locator('[data-repere-questions] span').last();
    await badgeCarte.filter({ hasText: '1' }).waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    const badgeApres = await badgeCarte.textContent();
    noter('répondre à la question de la carte fait passer la cloche à 1', badgeApres?.trim() === '1', badgeApres ?? '');

    /* ---- 5. La question restante (conversation, sans carte) reste
       atteignable et amène à la bonne conversation. Le tiroir de la carte
       est un plein écran modal : tant qu'il est ouvert, rien derrière lui —
       la cloche comprise — n'est cliquable, il faut donc le refermer d'abord
       (un vrai geste, pas une fuite de l'application). Ce qui est vérifié
       ici, c'est qu'une fois refermé, la cloche retrouve la question
       restante et y emmène — SANS que le tiroir qu'on vient de quitter ne
       revienne se poser par-dessus la conversation. */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    noter('fermer le tiroir de la carte le retire bien de l’écran', (await page.locator('[data-tags-carte]').count()) === 0);
    await page.locator('[data-repere-questions]').click();
    await page.waitForTimeout(500);
    const derniereEntree = page.locator('[data-question-en-attente]', { hasText: TEXTES.conversation });
    noter('la question restante (conversation du chef) est toujours listée', (await derniereEntree.count()) === 1);
    await derniereEntree.click();
    await page.waitForTimeout(2000);
    noter(
      'le tiroir de la carte ne revient pas se poser par-dessus la conversation',
      (await page.locator('[data-tags-carte]').count()) === 0,
    );
    noter('cliquer la question de conversation a bien ouvert le projet B (pas resté sur A)', projetsOuverts.at(-1) === PROJET_B);
    const questionVisibleEnConversation = await page.getByText(TEXTES.conversation).count();
    noter(
      'un clic sur la question de conversation ouvre le projet et la question s’y voit',
      questionVisibleEnConversation > 0,
    );
    await page.screenshot({ path: `${SHOTS}/questions-en-attente-conversation-ouverte.png` });

    const blocConv = page
      .getByText(TEXTES.conversation)
      .first()
      .locator('xpath=ancestor::div[contains(@class,"border-warning/40")][1]');
    await blocConv.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    if ((await blocConv.count()) > 0) {
      await blocConv.locator('textarea').fill('Non, on la garde active.');
      await blocConv.getByRole('button', { name: 'Répondre' }).click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SHOTS}/questions-en-attente-apres-reponse-conv.png` });
    } else {
      noter('la question de conversation porte bien son bloc de réponse', false, 'bloc introuvable');
    }
    // Le signal met le temps d'un aller-retour réseau à s'éteindre : on
    // patiente en interrogeant, plutôt que de juger sur un seul instant.
    let cloheFinale = 1;
    for (let essai = 0; essai < 15; essai += 1) {
      cloheFinale = await page.locator('[data-repere-questions]').count();
      if (cloheFinale === 0) break;
      await page.waitForTimeout(1000);
    }
    noter('les deux questions réglées, la cloche disparaît du bandeau', cloheFinale === 0);

    noter('aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));
  } finally {
    await context.close();
    await navigateur.close().catch(() => {});
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
