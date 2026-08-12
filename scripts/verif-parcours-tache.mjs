#!/usr/bin/env node
/**
 * LE PARCOURS D'UNE TÂCHE, DANS UN VRAI NAVIGATEUR.
 *
 * L'onglet « Détails » raconte désormais ce qui s'est PASSÉ : une étape par
 * moment réel, du tri par le chef d'orchestre jusqu'à la mise en production,
 * chacune avec ce qu'elle est allée chercher et ce qu'elle a RÉELLEMENT
 * consommé. Trois choses à tenir, et pas une de plus :
 *
 *   1. la ligne de temps existe, ses étapes se suivent dans l'ordre du travail ;
 *   2. chaque étape affiche soit une mesure, soit la RAISON de son absence —
 *      jamais un zéro consolant, jamais une projection déguisée en relevé ;
 *   3. le détail se DÉPLIE et nomme ce que l'étape est allée chercher.
 *
 * Démon et base d'ESSAI à soi (aucun compte réel touché, aucun moteur appelé),
 * ordinateur PUIS téléphone. Le démon servi est celui du dépôt d'où part le
 * script : lancé depuis une copie de travail, il juge bien ce code-là.
 *
 *   node scripts/verif-parcours-tache.mjs
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
const PORT = Number(process.env.HAIKO_PARCOURS_PORT || 7201);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-parcours-'));
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
const PROJET_ID = 'p-parcours';
const CHEF_ID = 'a-parcours-chef';
const TACHE_ID = 'a-parcours-tache';
const CARTE_ID = 'c-parcours';
const TITRE_CARTE = 'Essai — parcours de la tâche';

/**
 * LE DÉCOR : une carte née d'une proposition du chef, autorisée, exécutée, avec
 * de vrais tours mesurés des deux côtés. C'est le seul cas où la ligne de temps
 * porte toutes ses étapes.
 */
function poserDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const t = Date.now() - 600_000;
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    Date.now() + 3_600_000,
    'vérification parcours de tâche',
  );
  // Aucun agent ne doit démarrer pendant le relevé.
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: 'Essai parcours',
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

  const agent = (id, role, cardId, quand) => {
    const data = {
      id,
      projectId: PROJET_ID,
      cardId: cardId ?? undefined,
      role,
      title: role === 'orchestrator' ? 'Chef d’orchestre — essai' : TITRE_CARTE,
      run: { engine: 'claude', model: 'claude-sonnet-5', thinking: 'medium', mode: 'direct' },
      status: 'done',
      createdAt: quand,
      updatedAt: quand,
    };
    db.prepare(
      `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'done', ?, ?, ?)`,
    ).run(id, PROJET_ID, cardId, role, JSON.stringify(data), quand, quand);
  };
  agent(CHEF_ID, 'orchestrator', null, t);
  agent(TACHE_ID, 'task', CARTE_ID, t + 60_000);

  // Les SUJETS de mémoire que chaque agent est allé chercher : c'est cela que
  // la ligne « ce qu'elle est allée chercher » doit nommer.
  const memoire = (agentId, sujets) =>
    db
      .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(`memoire.demandes.${agentId}`, JSON.stringify(sujets));
  memoire(CHEF_ID, []);
  memoire(TACHE_ID, ['cartes', 'interface']);

  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    title: TITRE_CARTE,
    description: 'Carte d’essai posée par le script de vérification.',
    labels: [],
    column: 'done',
    position: 0,
    origin: 'agent',
    attachments: [],
    analyseDemandee: true,
    origineAgentId: CHEF_ID,
    origineAt: t,
    run: { engine: 'claude', model: 'claude-sonnet-5', thinking: 'medium', mode: 'direct' },
    estimate: {
      failed: false,
      machineSeconds: 600,
      seniorHours: 2,
      projection: { tokens: 100_000, quotaShare: 0.04, formula: '4 tours × 25 000', assumptions: ['3 fichiers'] },
      analysisMeasurement: {
        inputTokens: 30_000,
        cachedInputTokens: 12_000,
        outputTokens: 3_000,
        totalTokens: 45_000,
        breakdown: {
          haikoDevInstructions: { status: 'measured', characters: 4_000, note: '' },
          cardDescription: { status: 'measured', characters: 900, note: '' },
          memoryAndInstructions: { status: 'measured', characters: 6_000, note: '' },
          agentReads: { status: 'unavailable', note: 'part non isolable' },
        },
        measuredAt: t,
      },
    },
    consumption: { machineSeconds: 780, tokens: 90_000 },
    agentId: TACHE_ID,
    excludedFromDeploy: false,
    horsTache: false,
    codeDejaEnregistre: true,
    createdAt: t,
    updatedAt: t,
    doneAt: t + 300_000,
  };
  db.prepare(
    'INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(CARTE_ID, PROJET_ID, 'done', 0, TITRE_CARTE, JSON.stringify(carte), t, t);

  const tour = (agentId, cardId, quand, model, entree, cache, sortie, quota5h = 0, quotaSemaine = 0) =>
    db
      .prepare(
        `INSERT INTO usage (project_id, project_name, card_id, agent_id, account, engine, model, tokens,
                            input_tokens, cached_tokens, output_tokens, quota_share, quota_5h, quota_semaine, seconds, created_at)
         VALUES (?, ?, ?, ?, 'compte', 'claude', ?, ?, ?, ?, ?, 0, ?, ?, 12, ?)`,
      )
      .run(
        PROJET_ID,
        'Essai parcours',
        cardId,
        agentId,
        model,
        entree + cache + sortie,
        entree,
        cache,
        sortie,
        quota5h,
        quotaSemaine,
        quand,
      );

  // Le tour du CHEF, écrit après la proposition : c'est lui que le parcours doit
  // retrouver pour donner une mesure à l'étape de tri.
  tour(CHEF_ID, null, t + 5_000, 'claude-sonnet-5', 3_000, 1_000, 400);
  // Les tours de l'agent de TRAVAIL, avec leur part de quota RÉELLEMENT
  // consommée — c'est elle que le parcours doit reprendre à la place de
  // l'ancienne projection.
  tour(TACHE_ID, CARTE_ID, t + 100_000, 'claude-sonnet-5', 40_000, 10_000, 4_000, 1.2, 0.3);
  tour(TACHE_ID, CARTE_ID, t + 200_000, 'claude-sonnet-5', 25_000, 8_000, 3_000, 0.8, 0.2);
  db.close();
}

async function ouvrirDetails(navigateur, telephone) {
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1400, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
    locale: 'fr-CH',
    serviceWorkers: 'block',
    colorScheme: telephone ? 'dark' : 'light',
  });
  await contexte.addCookies([{ name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(4_000);

  /* L'application ROUVRE le dernier panneau consulté : sur le second passage, le
     tiroir déjà ouvert intercepterait le clic sur la carte. On le referme. */
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

  const tiroir = page.locator('[role="dialog"]').last();
  await tiroir.getByRole('tab', { name: 'Détails' }).click();
  await page.waitForTimeout(1_500);
  return { contexte, page, tiroir, erreurs };
}

async function relever(navigateur, telephone) {
  const ou = telephone ? 'téléphone' : 'ordinateur';
  const { contexte, page, tiroir, erreurs } = await ouvrirDetails(navigateur, telephone);

  const parcours = tiroir.locator('[data-parcours-tache]');
  const vu = await parcours.count();
  noter(`${ou} — la ligne de temps du parcours est là`, vu > 0);
  if (!vu) {
    await contexte.close();
    return;
  }
  await parcours.scrollIntoViewIfNeeded().catch(() => {});

  const etapes = parcours.locator('[data-etape]');
  const cles = [];
  const nombre = await etapes.count();
  for (let i = 0; i < nombre; i++) cles.push(await etapes.nth(i).getAttribute('data-etape'));
  noter(`${ou} — les étapes se suivent dans l’ordre du travail`, cles.join(',') === 'tri,autorisation,execution', cles.join(', '));

  /* Chaque étape porte un état lisible et DIT quelque chose : une durée ou un
     coût en francs — jamais un compteur de jetons —, ou la raison de son
     absence. Un zéro nu serait le pire des deux mondes. */
  let toutesLisibles = true;
  let aucunJeton = true;
  for (let i = 0; i < nombre; i++) {
    const etape = etapes.nth(i);
    const etat = await etape.getAttribute('data-etat');
    if (!['faite', 'en-cours', 'a-venir'].includes(etat ?? '')) toutesLisibles = false;
    const texte = (await etape.innerText()) ?? '';
    if (/\bjetons?\b/i.test(texte) || /\btokens?\b/i.test(texte)) aucunJeton = false;
    const aMesure = /CHF|\btour\b|\btours\b/.test(texte);
    const aRaison = /[Aa]ucun|pas rattaché|pas encore|indisponible|rien rendu|ne consomme rien/.test(texte);
    if (!aMesure && !aRaison) toutesLisibles = false;
  }
  noter(`${ou} — chaque étape dit son état et sa mesure, ou pourquoi elle manque`, toutesLisibles);
  noter(`${ou} — plus aucun compteur de jetons dans les étapes`, aucunJeton);

  const texteTri = await etapes.nth(0).innerText();
  noter(`${ou} — le tri du chef porte SON nombre de tours réel`, /\b1 tour\b/.test(texteTri), texteTri.replace(/\n/g, ' '));

  const texteExecution = await etapes.nth(2).innerText();
  noter(
    `${ou} — le travail porte la somme de SES tours, sans recouvrement`,
    /\b2 tours\b/.test(texteExecution),
    texteExecution.replace(/\n/g, ' '),
  );

  const entete = await parcours.locator('p').first().innerText();
  noter(`${ou} — le total réunit les étapes mesurées, en tours`, /\b3 tours\b/.test(entete), entete.replace(/\n/g, ' '));

  /* Le détail se DÉPLIE : replié par défaut, c'est ce qui rend la ligne de temps
     lisible d'un coup d'œil. */
  noter(`${ou} — le détail est replié au départ`, (await parcours.locator('[data-detail-etape]').count()) === 0);
  await etapes.nth(2).locator('button').first().click();
  await page.waitForTimeout(500);
  const detail = parcours.locator('[data-detail-etape]').first();
  const ouvert = await detail.count();
  noter(`${ou} — un clic déplie le détail de l’étape`, ouvert > 0);
  if (ouvert) {
    const texte = (await detail.innerText()).replace(/\n/g, ' ');
    noter(`${ou} — le détail nomme ce que l’étape est allée chercher`, /allée chercher/i.test(texte));
    noter(`${ou} — les sujets de mémoire demandés sont nommés`, /cartes/.test(texte) && /interface/.test(texte), texte);
    noter(`${ou} — le détail déplié ne montre aucun compteur de jetons`, !/\bjetons?\b/i.test(texte) && !/\btokens?\b/i.test(texte));
  }

  /* La part de quota RÉELLEMENT consommée remplace l'ancienne projection,
     dans un bloc à part sous les étapes — jamais mêlée aux jetons mesurés. */
  const quotaReel = parcours.locator('[data-quota-reel-parcours]');
  noter(`${ou} — la part de quota réelle est affichée, distincte des étapes`, (await quotaReel.count()) > 0);
  if (await quotaReel.count()) {
    const texte = (await quotaReel.innerText()).replace(/\n/g, ' ');
    noter(`${ou} — la fenêtre de 5 h réellement consommée est chiffrée`, /2\s*%/.test(texte), texte);
    noter(`${ou} — aucune trace de l’ancienne projection de jetons`, !/Jetons projetés/.test(texte), texte);
  }

  /* Le PRÉVU reste à part, et se dit prévision. */
  const prevu = tiroir.locator('[data-ce-qui-etait-prevu]');
  noter(`${ou} — le bloc de prévision est séparé du parcours`, (await prevu.count()) > 0);
  if (await prevu.count()) {
    const texte = (await prevu.innerText()).replace(/\n/g, ' ');
    noter(`${ou} — la prévision se dit prévision, jamais mesure`, /ne sont pas des mesures/i.test(texte));
    noter(`${ou} — l’écart au prévu est dit`, /Durée réelle/.test(texte), texte);
  }

  /* Aucun tour ici n'a de `sentContext` (le décor n'écrit que la table
     `usage`, jamais `messages`) : le lecteur de prompts doit rester ABSENT,
     jamais une section vide affichée quand même. */
  noter(
    `${ou} — sans tour envoyé enregistré, le lecteur de prompts ne s’affiche pas à vide`,
    (await parcours.locator('[data-prompts-de-la-carte]').count()) === 0,
  );

  noter(`${ou} — aucune erreur de page`, erreurs.length === 0, erreurs.join(' | '));
  await contexte.close();
}

async function main() {
  if (!(await attendrePort())) {
    console.error('le démon d’essai n’a pas démarré');
    process.exit(1);
  }
  poserDecor();
  // Le démon lit la base à chaque commande : le décor posé après son démarrage
  // est vu tel quel, sans redémarrage.
  await new Promise((r) => setTimeout(r, 1_000));

  const navigateur = await chromium.launch({ channel: 'chrome' });
  try {
    await relever(navigateur, false);
    await relever(navigateur, true);
  } finally {
    await navigateur.close();
  }

  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passées`);
  process.exit(echecs ? 1 : 0);
}

main().catch((err) => {
  console.error('vérification interrompue :', err?.message ?? err);
  process.exit(1);
});
