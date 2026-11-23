#!/usr/bin/env node
/**
 * LA COLONNE DE GAUCHE : L'ICÔNE DE PLAN sur un projet dont une carte attend
 * qu'on génère son plan — vérifié dans un VRAI navigateur, sur son PROPRE
 * démon (base neuve, dossier de projets vide, port libre : le démon de
 * production n'est pas touché, aucun quota dépensé).
 *
 * LA SOURCE A CHANGÉ, PAS L'ICÔNE. Elle venait de l'ancien mode plan (un
 * message porteur du drapeau `plan`) ; elle vient désormais du PARCOURS de la
 * carte : le tour de cadrage s'est tu, la compréhension est rendue, le plan
 * peut être généré, et personne n'a rouvert la carte
 * (`shared/src/attente-de-geste.ts`). Le repère s'éteint à la simple
 * consultation de la carte.
 *
 * LA BORDURE BLANCHE N'EXISTE PLUS, et ce n'est pas une panne : les lignes de
 * projet sont NUES depuis le 13/08/2026 (« lignes de projet sans cadre ni
 * fond »), l'état ne vivant plus que sur l'icône de gauche et le repère de
 * droite. Ce contrôle a donc cessé de la réclamer — il vérifie en revanche
 * qu'AUCUNE bordure ne revient, pour que la règle des lignes nues tienne.
 *
 *   node scripts/verif-repere-plan.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7194);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { TMP, DATA, PROJETS, DEPOT, demon, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-repere-plan-',
  port: PORT,
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const AGENT_ID = 'a-essai';
const TITRE = 'Essai — repère de plan';
const CARTE_ID = 'c-essai';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification repère de plan',
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

  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    cardId: CARTE_ID,
    role: 'cadrage',
    title: 'Chef d’essai',
    run: { engine: 'claude', thinking: 'none' },
    status: 'done',
    /* La FIN DU TOUR : c'est elle qui date l'attente, et que la consultation
       de la carte doit dépasser pour éteindre le repère. */
    endedAt: maintenant,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(agent.id, PROJET_ID, CARTE_ID, 'cadrage', 'done', JSON.stringify(agent), maintenant, maintenant);

  db.close();
}

/**
 * La carte de cadrage, telle qu'elle est juste après un tour rendu : sa
 * compréhension est écrite, aucun plan encore, aucune lecture depuis.
 * `luA` repousse la date de consultation — c'est le geste qui éteint.
 */
function poserLaCarte({ comprehension, luA }) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    column: 'planned',
    position: 1,
    title: 'Carte d’essai',
    description: 'Une carte de cadrage.',
    labels: [],
    attachments: [],
    run: { engine: 'claude', thinking: 'none' },
    agentId: undefined,
    conversationAgentId: AGENT_ID,
    parcours: comprehension
      ? { comprehension: { texte: 'J’ai compris.', at: maintenant, hypotheses: [], sujets: [] }, plans: [] }
      : { plans: [] },
    lastReadAt: luA,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(CARTE_ID, PROJET_ID, 'planned', 1, carte.title, JSON.stringify(carte), maintenant, maintenant);
  db.close();
}

function poserUnMessage({ content, role = 'user', createdAt }) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const message = {
    id: crypto.randomUUID(),
    agentId: AGENT_ID,
    role,
    content,
    steps: [],
    todos: [],
    proposals: [],
    questions: [],
    downloads: [],
    attachments: [],
    streaming: false,
    createdAt,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    message.id,
    AGENT_ID,
    role,
    JSON.stringify(message),
    createdAt,
  );
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
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  return { page, erreurs };
}

/** Le repère du projet, tel qu'il paraît sur sa ligne de la colonne de gauche. */
async function etatDuRepere(page) {
  return page.evaluate((projectId) => {
    const ligne = document.querySelector(`[data-drag-id="${projectId}"]`);
    if (!ligne) return { trouve: false };
    return {
      trouve: true,
      // La ligne doit rester NUE : aucun anneau, aucune bordure de couleur.
      ring: /\bring-|border-(?!transparent)/.test(ligne.className),
      badge: !!ligne.querySelector('[data-repere-plan]'),
      // Un seul repère d'attente à droite, et il DIT sa nature.
      nature: ligne.querySelector('[data-signal-attention]')?.getAttribute('data-signal-nature') ?? null,
      reperes: ligne.querySelectorAll('[data-signal-attention]').length,
    };
  }, PROJET_ID);
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
  const { page, erreurs } = await ouvrirLaColonne(navigateur);

  poserLaCarte({ comprehension: false });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const auRepos = await etatDuRepere(page);
  noter(
    'sans compréhension rendue, rien n’attend : la ligne ne porte aucun repère',
    !auRepos.badge && !auRepos.ring && auRepos.reperes === 0,
    JSON.stringify(auRepos),
  );

  poserUnMessage({ content: 'Fais ceci.', createdAt: Date.now() });
  poserLaCarte({ comprehension: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const avecPlan = await etatDuRepere(page);
  noter('un plan qui peut être généré pose son icône', avecPlan.badge, JSON.stringify(avecPlan));
  noter('…et cette icône DIT sa nature : « plan », pas un triangle', avecPlan.nature === 'plan', JSON.stringify(avecPlan));
  noter('…un seul repère à droite, jamais deux', avecPlan.reperes === 1, JSON.stringify(avecPlan));
  noter('…et la ligne reste NUE : aucune bordure ne revient', !avecPlan.ring, JSON.stringify(avecPlan));
  await page.screenshot({ path: path.join(TMP, 'repere-plan-allume.png') });

  // La CONSULTATION de la carte éteint le repère, et rien d'autre.
  poserLaCarte({ comprehension: true, luA: Date.now() + 60_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const apresLecture = await etatDuRepere(page);
  noter(
    'la carte consultée éteint le repère',
    !apresLecture.badge && !apresLecture.ring && apresLecture.reperes === 0,
    JSON.stringify(apresLecture),
  );
  await page.screenshot({ path: path.join(TMP, 'repere-plan-eteint.png') });

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
