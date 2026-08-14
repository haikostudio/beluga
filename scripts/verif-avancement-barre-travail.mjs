#!/usr/bin/env node
/**
 * L'avancement des étapes sur la barre « travail en cours », dans un VRAI
 * navigateur, ordinateur PUIS téléphone :
 *
 *  - un agent qui travaille avec une liste 2/5 montre « 2/5 » sur la barre,
 *    à côté de l'étape en cours et de la durée ;
 *  - il progresse en direct quand l'agent avance (2/5 → 4/5) ;
 *  - une fois le tour terminé, la barre entière disparaît (le compteur avec) ;
 *  - un agent qui travaille SANS liste connue ne montre aucun compteur.
 *
 * Démon et base d'ESSAI à soi (aucun compte réel touché, aucun moteur
 * appelé), comme `verif-parcours-tache.mjs`. Le démon servi est celui du
 * dépôt d'où part le script : lancé depuis une copie de travail, il juge
 * bien ce code-là.
 *
 *   node scripts/verif-avancement-barre-travail.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKO_AVANCEMENT_PORT || 7202);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-avancement-'));
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
demon.stdout.on('data', () => {});
demon.stderr.on('data', () => {});

process.on('exit', () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function attendrePort() {
  const fin = Date.now() + 60_000;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${String(detail).slice(0, 150)}` : ''}`);
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-avancement';
const TACHE_ID = 'a-avancement-tache';
const CARTE_ID = 'c-avancement';
const TITRE_CARTE = 'Essai — avancement barre de travail';

function poserDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const t = Date.now() - 60_000;
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    Date.now() + 3_600_000,
    'vérification avancement barre de travail',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: 'Essai avancement',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), t, t);

  // L'agent n'est PAS écrit en base avec le statut « running » : sans processus
  // RÉEL derrière lui, la veille du démon (`veilleDesToursBloques`, toutes les
  // quinze secondes) le refermerait d'autorité — un tour qu'elle ne « suit »
  // pas est jugé abandonné. Il n'existe donc que dans le canal temps réel,
  // injecté après le chargement de la page (comme `verif-progression-taches.mjs`
  // le fait déjà pour les cartes du tableau).
  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    title: TITRE_CARTE,
    description: 'Carte d’essai posée par le script de vérification.',
    labels: [],
    column: 'running',
    position: 0,
    origin: 'user',
    attachments: [],
    run: { engine: 'claude', model: 'claude-sonnet-5', thinking: 'medium', mode: 'direct' },
    agentId: TACHE_ID,
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    'INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(CARTE_ID, PROJET_ID, 'running', 0, TITRE_CARTE, JSON.stringify(carte), t, t);

  const message = {
    id: 'm-avancement-1',
    agentId: TACHE_ID,
    role: 'assistant',
    kind: 'progress',
    text: '',
    steps: [{ id: 's1', label: 'Construction du projet', state: 'running' }],
    todos: [
      { label: 'Lire le code existant', state: 'done' },
      { label: 'Écrire le correctif', state: 'done' },
      { label: 'Construire le projet', state: 'running' },
      { label: 'Lancer les tests', state: 'todo' },
      { label: 'Enregistrer et pousser', state: 'todo' },
    ],
    createdAt: t + 1000,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    message.id,
    TACHE_ID,
    message.role,
    JSON.stringify(message),
    t + 1000,
  );

  db.close();
}

async function ouvrirCarte(navigateur, telephone) {
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1400, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));

  // On se greffe sur le canal temps réel pour SIMULER la suite du travail
  // (comme `verif-progression-taches.mjs`) : rejouer un tour complet coûterait
  // un vrai agent, alors qu'ici seul l'AFFICHAGE est en jeu.
  await page.addInitScript(() => {
    window.__ecouteurs = [];
    const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get() {
        return propriete.get.call(this);
      },
      set(ecouteur) {
        window.__ecouteurs.push(ecouteur);
        return propriete.set.call(this, ecouteur);
      },
    });
    window.__injecter = (evenement) => {
      const donnees = JSON.stringify(evenement);
      for (const ecouteur of window.__ecouteurs) ecouteur({ data: donnees });
    };
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3_500);

  // L'application rouvre le dernier panneau consulté : sur le second passage
  // (téléphone), le tiroir déjà ouvert intercepterait le clic sur la carte.
  const dejaOuvert = page.locator('[role="dialog"]').last();
  if (await dejaOuvert.count()) {
    await dejaOuvert.locator('button').first().click({ force: true });
    await dejaOuvert.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  const carteVue = page.locator('article').filter({ hasText: TITRE_CARTE }).first();
  await carteVue.waitFor({ state: 'visible', timeout: 30_000 });
  await carteVue.click();
  await page.waitForTimeout(1_500);

  /*
   * L'agent au travail : injecté plutôt qu'écrit en base (voir `poserDecor`),
   * il n'existe que le temps de la page — exactement ce que voit un vrai
   * témoin quand un agent tourne pour de bon.
   */
  const injecterAgent = (patch) =>
    page.evaluate(
      ([projectId, cardId, agentId, titre, patch]) => {
        window.__injecter({
          type: 'agent.upsert',
          agent: {
            id: agentId,
            projectId,
            cardId,
            role: 'task',
            title: titre,
            run: { engine: 'claude', model: 'claude-sonnet-5', thinking: 'medium', mode: 'direct' },
            status: 'running',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            ...patch,
          },
        });
      },
      [PROJET_ID, CARTE_ID, TACHE_ID, TITRE_CARTE, patch],
    );

  await injecterAgent({ todos: { done: 2, total: 5 } });
  await page.waitForTimeout(1_000);

  return { contexte, page, erreurs, injecterAgent };
}

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  if (!(await attendrePort())) throw new Error('le démon d’essai ne répond pas');
  poserDecor();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  for (const telephone of [false, true]) {
    const cible = telephone ? 'téléphone' : 'ordinateur';
    const { contexte, page, erreurs, injecterAgent } = await ouvrirCarte(navigateur, telephone);

    const barre = page.locator('[data-temoin-reflexion]');
    await barre.waitFor({ state: 'visible', timeout: 10_000 });

    const compteur = page.locator('[data-avancement-travail]');
    const texte = await compteur.textContent().catch(() => null);
    noter(`${cible} — le compteur « n/N » est visible sur la barre`, /2\s*\/\s*5/.test(texte ?? ''), texte ?? 'absent');

    // Le libellé de l'étape (message de la conversation, pas notre agent
    // injecté) garde une largeur RÉELLE, pas écrasée à zéro par le compteur.
    const etapeLargeur = await page.evaluate(() => {
      const span = document.querySelector('[data-temoin-reflexion] span');
      return span ? span.getBoundingClientRect().width : 0;
    });
    noter(`${cible} — l’étape en cours garde sa place, non écrasée`, etapeLargeur > 20, `${etapeLargeur}px`);

    // Le compteur ne doit pas écraser le bouton d’arrêt : les deux tiennent
    // dans la largeur de la barre.
    const chevauchement = await page.evaluate(() => {
      const c = document.querySelector('[data-avancement-travail]');
      const bouton = document.querySelector('[data-temoin-reflexion] button');
      if (!c || !bouton) return null;
      const a = c.getBoundingClientRect();
      const b = bouton.getBoundingClientRect();
      return a.right <= b.left + 1;
    });
    noter(`${cible} — le compteur n’écrase pas le bouton d’arrêt`, chevauchement !== false, String(chevauchement));

    if (!telephone) {
      // Un agent qui travaille SANS liste connue (pas encore de première tâche
      // annoncée) ne montre aucun compteur — la barre reste simple.
      await injecterAgent({ todos: undefined });
      await page.waitForTimeout(1_000);
      noter(`${cible} — sans liste connue, aucun compteur ne s’affiche`, (await compteur.count()) === 0);
      await injecterAgent({ todos: { done: 2, total: 5 } });
      await page.waitForTimeout(1_000);
    }

    // Fait avancer l’agent : 2/5 → 4/5, en direct — exactement l’événement
    // que le démon rediffuse à chaque étape cochée (`agent.upsert`).
    await injecterAgent({ todos: { done: 4, total: 5 } });
    await page.waitForTimeout(1_000);
    const texte2 = await compteur.textContent().catch(() => null);
    noter(`${cible} — le compteur avance en direct (4/5)`, /4\s*\/\s*5/.test(texte2 ?? ''), texte2 ?? 'absent');

    // Fin du tour : la barre entière disparaît.
    await injecterAgent({ status: 'done', todos: { done: 5, total: 5 } });
    await page.waitForTimeout(1_200);
    noter(`${cible} — la barre disparaît proprement une fois le tour rendu`, (await barre.count()) === 0 || !(await barre.isVisible().catch(() => false)));

    noter(`${cible} — aucune erreur JavaScript`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

    await contexte.close();
  }

  await navigateur.close();

  const rates = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés.`);
  if (rates.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
