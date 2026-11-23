#!/usr/bin/env node
/**
 * LES IDÉES ENVOYÉES RESTENT COCHÉES — vérifié dans un VRAI navigateur, sur son
 * PROPRE démon (base neuve, port libre : le démon de production n'est pas
 * touché, aucun moteur appelé, aucun quota dépensé).
 *
 * Une idée d'un plan (« Améliorations apportées ») se coche en s'écrivant dans
 * la barre d'écriture ; l'envoi vide la barre, et sa case se décochait, comme si
 * rien n'avait été retenu. Elle se lit désormais aussi dans les messages
 * réellement partis :
 *   - une idée dont la ligne figure dans un message envoyé est COCHÉE et ne se
 *     clique plus (`data-idee-envoyee`) ;
 *   - une idée pas encore envoyée reste cochable, et « Tout ajouter » ne compte
 *     qu'elles ;
 *   - la même chose vaut après un rechargement de la page ;
 *   - dans un plan DÉPASSÉ par une version suivante, les idées sont figées :
 *     celles qui sont parties s'y lisent cochées, aucune ne se clique.
 *
 *   node scripts/verif-idees-envoyees.mjs      (port : BELUGA_IDEES_ENVOYEES_PORT, 7263 par défaut)
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const Database = require_('better-sqlite3');
const ws = require_('ws');
const PORT = Number(process.env.BELUGA_IDEES_ENVOYEES_PORT || 7263);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-idees-envoyees-'));
const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(PROJETS, { recursive: true });
fs.mkdirSync(DEPOT, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const jeton = crypto.randomBytes(32).toString('hex');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const PROJET = 'p-idees';

let demon = null;
let garderLesTraces = false;
const journal = [];

function demarrerLeDemon() {
  const enfant = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
    env: {
      ...process.env,
      BELUGA_PORT: String(PORT),
      BELUGA_HOST: '127.0.0.1',
      BELUGA_DATA: DATA,
      BELUGA_PROJECTS_ROOT: PROJETS,
      BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  enfant.stdout.on('data', (d) => journal.push(String(d)));
  enfant.stderr.on('data', (d) => journal.push(String(d)));
  return enfant;
}

process.on('exit', () => {
  try {
    demon?.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  if (!garderLesTraces) fs.rmSync(TMP, { recursive: true, force: true });
});

async function attendrePort(port, limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(port, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function arreterLeDemon() {
  if (!demon) return;
  const parti = new Promise((r) => demon.on('exit', r));
  demon.kill('SIGTERM');
  await Promise.race([parti, new Promise((r) => setTimeout(r, 5000))]);
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  demon = null;
}

async function nouveauContexte(navigateur, options) {
  const contexte = await navigateur.newContext({ locale: 'fr-CH', serviceWorkers: 'block', ...options });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  page.erreurs = [];
  page.on('pageerror', (e) => page.erreurs.push(String(e)));
  return { contexte, page };
}


const IDEES = ['Ajouter une saisie de dimensions libres.', 'Proposer une capture d’écran de l’aperçu.', 'Retenir l’appareil par projet.'];
const t0 = Date.now() - 600_000;

function plan(numero, titre, idees, at) {
  const texte = [
    `# ${titre}`,
    '',
    '## Liste des tâches',
    '**Poser le gabarit**',
    'Découper l’écran en trois zones.',
    '',
    '## Faisabilité',
    'Rien d’incertain.',
    '',
    '## Chemin à suivre',
    '1. Poser le gabarit.',
    '',
    '## Conséquences',
    'Rien d’autre ne bouge.',
    '',
    '## Améliorations apportées',
    ...idees.map((i) => `- ${i}`),
  ].join('\n');
  return { id: `plan-${numero}`, numero, titre, texte, at };
}

/** Le décor : le projet, la session, puis une carte par scénario. */
function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification idées envoyées',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  const projet = {
    id: PROJET,
    name: 'Essai idées envoyées',
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
  ).run(PROJET, projet.name, DEPOT, JSON.stringify(projet), maintenant, maintenant);

  /** Une carte, son agent de cadrage, ses plans, ses jalons et ses messages. */
  const carte = (cle, titre, plans, messages) => {
    const carteId = `c-${cle}`;
    const agentId = `a-${cle}`;
    const donneesCarte = {
      id: carteId,
      projectId: PROJET,
      agentId,
      title: titre,
      description: 'Carte du contrôle.',
      labels: [],
      column: 'planned',
      position: 1,
      origin: 'user',
      run: { engine: 'claude', thinking: 'none' },
      scheduling: { asap: false, attempts: 0, restarts: 0 },
      parcours: { plans },
      excludedFromDeploy: false,
      horsTache: false,
      createdAt: t0,
      updatedAt: t0,
    };
    db.prepare(
      'INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(carteId, PROJET, 'planned', 1, titre, JSON.stringify(donneesCarte), t0, t0);
    const agent = {
      id: agentId,
      projectId: PROJET,
      cardId: carteId,
      role: 'cadrage',
      title: titre,
      run: { engine: 'claude', thinking: 'none' },
      status: 'idle',
      createdAt: t0,
      updatedAt: t0,
    };
    db.prepare(
      'INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(agentId, PROJET, carteId, 'cadrage', 'idle', JSON.stringify(agent), t0, t0);
    messages.forEach((m, i) => {
      const message = {
        id: `m-${cle}-${i}`,
        agentId,
        role: 'user',
        content: m.content,
        steps: [],
        todos: [],
        proposals: [],
        questions: [],
        downloads: [],
        attachments: [],
        createdAt: m.at,
      };
      db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
        message.id,
        agentId,
        'user',
        JSON.stringify(message),
        m.at,
      );
    });
    plans.forEach((p, rang) => {
      db.prepare(
        `INSERT INTO card_journal
           (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, resultat, reussie, donnees)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        `j-${cle}-${p.numero}`,
        carteId,
        rang,
        'cadrage',
        'jalon',
        p.at,
        agentId,
        'cadrage',
        `tour-${cle}-${p.numero}`,
        'Plan proposé',
        p.texte.slice(0, 400),
        1,
        JSON.stringify({ version: p.numero, titre: p.titre }),
      );
    });
    return carteId;
  };

  const idA = `- ${IDEES[0]}`;
  const idB = `- ${IDEES[1]}`;
  // 1. Un seul plan : deux idées sont déjà parties dans un message.
  carte(
    'un',
    'Plan unique',
    [plan(1, 'Appareils d’essai', IDEES, t0 + 1000)],
    [
      { content: 'Fais l’essai des idées.', at: t0 },
      { content: `${idA}\n${idB}`, at: t0 + 5000 },
    ],
  );
  // 2. Deux plans : le premier est dépassé, ses idées sont figées.
  carte(
    'deux',
    'Deux plans',
    [plan(1, 'Appareils d’essai', IDEES, t0 + 1000), plan(2, 'Appareils d’essai (suite)', [IDEES[0], 'Une idée neuve.'], t0 + 9000)],
    [
      { content: 'Fais l’essai des idées.', at: t0 },
      { content: `${idA}\n${idB}`, at: t0 + 5000 },
    ],
  );
  // 3. Rien n'est parti : tout reste cochable, aucune case n'est inerte.
  carte('trois', 'Rien envoyé', [plan(1, 'Appareils d’essai', IDEES, t0 + 1000)], [{ content: 'Fais l’essai des idées.', at: t0 }]);
  db.close();
}

/** Ce que l'écran montre pour chaque idée d'un bloc de plan : coche, envoi, clic possible. */
async function lireLesIdees(bloc) {
  return bloc.locator('[role="checkbox"]').evaluateAll((cases) =>
    cases.map((c) => ({
      texte: (c.textContent || '').trim(),
      cochee: c.getAttribute('aria-checked') === 'true',
      envoyee: c.getAttribute('data-idee-envoyee') === 'oui',
      cliquable: c.hasAttribute('data-suggestion-cliquable') && !c.disabled,
    })),
  );
}

async function ouvrirLaCarte(page, cle) {
  await page.goto(`${BASE}/#projet/${PROJET}/tache/c-${cle}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('[data-page-carte]').first().waitFor({ timeout: 30000 });
  await page.locator('[data-rapport-plan]').first().waitFor({ timeout: 30000 });
}

async function main() {
  demon = demarrerLeDemon();
  if (!(await attendrePort(PORT))) throw new Error('le démon d’essai n’a pas démarré');
  await arreterLeDemon();
  poserLeDecor();
  demon = demarrerLeDemon();
  if (!(await attendrePort(PORT))) throw new Error('le démon d’essai n’a pas redémarré');
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const { contexte, page } = await nouveauContexte(navigateur, { viewport: { width: 1400, height: 1000 } });

  /* ─── 1. UN PLAN, DEUX IDÉES DÉJÀ PARTIES ─── */
  await ouvrirLaCarte(page, 'un');
  const bloc = page.locator('[data-rapport-plan]').last();
  let idees = await lireLesIdees(bloc);
  noter('un plan : les trois idées sont des cases', idees.length === 3, JSON.stringify(idees));
  noter(
    'un plan : les deux idées envoyées sont cochées et ne se cliquent plus',
    idees[0]?.cochee && idees[0].envoyee && !idees[0].cliquable && idees[1]?.cochee && idees[1].envoyee && !idees[1].cliquable,
    JSON.stringify(idees.slice(0, 2)),
  );
  noter(
    'un plan : l’idée pas envoyée reste vide et cochable',
    idees[2] && !idees[2].cochee && !idees[2].envoyee && idees[2].cliquable,
    JSON.stringify(idees[2]),
  );
  const tout = bloc.getByRole('button', { name: /Tout (ajouter|retirer)/ });
  noter('un plan : « Tout ajouter » est là, il ne compte que ce qui reste', (await tout.count()) === 1 && /ajouter/i.test(await tout.innerText()));
  await page.screenshot({ path: path.join(TMP, 'idees-plan-unique.png') });

  // Cliquer une idée envoyée ne change rien.
  const champ = page.locator('[data-champ-d-ecriture] textarea').first();
  await champ.waitFor({ timeout: 30000 });
  await bloc.locator('[role="checkbox"]').nth(0).click({ force: true }).catch(() => undefined);
  await page.waitForTimeout(250);
  noter('un plan : cliquer une idée envoyée n’écrit rien dans la barre', (await champ.inputValue()) === '', await champ.inputValue());

  // L'idée restante se coche dans la barre, et se décoche au second clic.
  await bloc.locator('[role="checkbox"]').nth(2).click();
  await page.waitForTimeout(250);
  idees = await lireLesIdees(bloc);
  noter(
    'un plan : l’idée restante se coche et s’écrit dans la barre',
    idees[2]?.cochee && !idees[2].envoyee && (await champ.inputValue()).includes(IDEES[2]),
    `${await champ.inputValue()}`,
  );
  await bloc.locator('[role="checkbox"]').nth(2).click();
  await page.waitForTimeout(250);
  idees = await lireLesIdees(bloc);
  noter('un plan : un second clic la décoche et la retire de la barre', !idees[2]?.cochee && (await champ.inputValue()) === '');

  // Après rechargement, les idées envoyées restent cochées.
  await page.goto('about:blank');
  await ouvrirLaCarte(page, 'un');
  idees = await lireLesIdees(page.locator('[data-rapport-plan]').last());
  noter(
    'un plan : après rechargement, les deux idées envoyées sont toujours cochées',
    idees[0]?.cochee && idees[1]?.cochee && !idees[2]?.cochee,
    JSON.stringify(idees),
  );

  /* ─── 2. DEUX PLANS : LE PREMIER EST DÉPASSÉ ─── */
  await ouvrirLaCarte(page, 'deux');
  const blocs = page.locator('[data-rapport-plan]');
  noter('deux plans : les deux versions se lisent dans le fil', (await blocs.count()) === 2, `${await blocs.count()}`);
  const ancien = await lireLesIdees(blocs.first());
  noter(
    'plan dépassé : les idées parties y sont cochées, aucune ne se clique',
    ancien.length === 3 &&
      ancien[0].cochee &&
      ancien[1].cochee &&
      !ancien[2].cochee &&
      ancien.every((i) => !i.cliquable),
    JSON.stringify(ancien),
  );
  noter(
    'plan dépassé : aucun bouton « Tout ajouter »',
    (await blocs.first().getByRole('button', { name: /Tout (ajouter|retirer)/ }).count()) === 0,
  );
  const courant = await lireLesIdees(blocs.last());
  noter(
    'plan courant : l’idée déjà envoyée est cochée, la neuve reste cochable',
    courant.length === 2 && courant[0].cochee && courant[0].envoyee && !courant[1].cochee && courant[1].cliquable,
    JSON.stringify(courant),
  );

  /* ─── 3. RIEN N'EST PARTI : COMME AVANT ─── */
  await ouvrirLaCarte(page, 'trois');
  idees = await lireLesIdees(page.locator('[data-rapport-plan]').last());
  noter(
    'rien envoyé : aucune case n’est cochée, toutes sont cochables',
    idees.length === 3 && idees.every((i) => !i.cochee && !i.envoyee && i.cliquable),
    JSON.stringify(idees),
  );

  noter('aucune erreur de page', page.erreurs.length === 0, page.erreurs.slice(0, 2).join(' | '));
  await contexte.close();
  await navigateur.close();
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) {
    garderLesTraces = true;
    console.log(`(captures et dossier d’essai gardés dans ${TMP})`);
  }
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  garderLesTraces = true;
  console.error(e);
  console.error(journal.slice(-20).join(''));
  console.error(`(dossier d’essai gardé dans ${TMP})`);
  process.exit(1);
});
