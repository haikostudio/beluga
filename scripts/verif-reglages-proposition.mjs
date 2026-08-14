#!/usr/bin/env node
/**
 * Une carte proposée pendant une conversation Codex part-elle bien sur Codex ?
 *
 * Deux relevés, du plus profond au plus visible :
 *   1. la RÈGLE, jouée sur le catalogue RÉEL de cette machine : une proposition
 *      faite sous Codex ne peut pas ressortir avec un modèle Claude ; un modèle
 *      choisi à l'écran n'est pas réécrit par le palier du chef ;
 *   2. l'ÉCRAN, dans un vrai navigateur : la carte à valider affiche le moteur
 *      et le modèle de la conversation, et ses trois réglages s'ouvrent encore.
 *
 * Une proposition d'essai est posée en base le temps du relevé, puis retirée ;
 * le projet ouvert au départ est remis en place en partant.
 *
 *   node scripts/verif-reglages-proposition.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogueMoteurs } from '../server/dist/catalogue-moteurs.js';
import { accorderRunDeProposition, reglagesDeLaProposition } from '../shared/dist/reglages-proposition.js';

/* Le contrôle monte son propre démon avec la construction du dépôt d'où part
   ce script : il ne dépend ni de l'application publiée, ni de sa base. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_REGLAGES_PORT || 7199);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-reglages-proposition-'));
const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
for (const dossier of [DATA, PROJETS, DEPOT]) fs.mkdirSync(dossier, { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], { cwd: DEPOT });

const BASE_DB = path.join(DATA, 'haikodev.db');
const CLE_PROJET_ACTIF = 'project.active';
const PROJET_ID = 'projet-reglages-proposition';
const AGENT_ID = 'agent-reglages-proposition';

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
demon.stdout.on('data', (donnees) => journal.push(String(donnees)));
demon.stderr.on('data', (donnees) => journal.push(String(donnees)));

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
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

function poserDecor() {
  const db = new Database(BASE_DB);
  const t = Date.now() - 60_000;
  const projet = {
    id: PROJET_ID,
    name: 'Essai réglages',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), t, t);
  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    role: 'orchestrator',
    title: 'Chef d’orchestre — Essai réglages',
    run: { engine: 'codex', model: 'gpt-5.1-codex', thinking: 'medium', mode: 'direct' },
    status: 'done',
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, 'orchestrator', 'done', ?, ?, ?)`,
  ).run(agent.id, agent.projectId, JSON.stringify(agent), t, t);
  db.close();
}

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Une session valable, posée directement en base : on vérifie l'écran, pas le mur d'accès. */
function poserSession() {
  const db = new Database(BASE_DB);
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification réglages de proposition',
  );
  db.close();
  return { token, empreinte };
}

/** La conversation de chef d'orchestre où poser la proposition d'essai. */
function chefDOrchestre() {
  const db = new Database(BASE_DB, { readonly: true });
  const ligne = db
    .prepare(
      `SELECT a.id AS agentId, a.project_id AS projectId, p.name AS nom
         FROM agents a JOIN projects p ON p.id = a.project_id
        WHERE a.role = 'orchestrator' AND p.archived = 0
          AND a.id = (
            SELECT a2.id FROM agents a2
             WHERE a2.project_id = a.project_id AND a2.role = 'orchestrator'
             LIMIT 1
          )
        ORDER BY p.name = 'HaikoDev' DESC LIMIT 1`,
    )
    .get();
  db.close();
  return ligne;
}

function poserProposition(agentId, run) {
  const db = new Database(BASE_DB);
  const id = crypto.randomUUID();
  const message = {
    id,
    agentId,
    role: 'assistant',
    content: "Vérification automatique : proposition d'essai, à retirer.",
    steps: [],
    todos: [],
    proposals: [
      {
        id: crypto.randomUUID(),
        title: "Essai — réglages hérités de la conversation",
        description: 'Proposition posée par un script de vérification. Elle disparaît toute seule.',
        labels: [],
        run,
        decision: 'pending',
      },
    ],
    questions: [],
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
  return id;
}

function retirer(messageId, empreinte, projetAvant) {
  const db = new Database(BASE_DB);
  if (messageId) db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
  if (empreinte) db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  if (projetAvant === null) db.prepare('DELETE FROM preferences WHERE key = ?').run(CLE_PROJET_ACTIF);
  else if (projetAvant !== undefined)
    db.prepare(
      'INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    ).run(CLE_PROJET_ACTIF, projetAvant, Date.now());
  db.close();
}

function viserProjet(projectId) {
  const db = new Database(BASE_DB);
  const avant = db.prepare('SELECT value FROM preferences WHERE key = ?').get(CLE_PROJET_ACTIF);
  db.prepare(
    'INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(CLE_PROJET_ACTIF, JSON.stringify(projectId), Date.now());
  db.close();
  return avant ? avant.value : null;
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserDecor();

  /* ---------------- 1. La règle, sur le catalogue réel ---------------- */

  const catalogue = await catalogueMoteurs();
  const codex = catalogue.find((m) => m.id === 'codex');
  const claude = catalogue.find((m) => m.id === 'claude');
  console.log(
    `Catalogue lu sur cette machine : ${catalogue
      .map((m) => `${m.label} ${m.installed ? `(${m.models.length} modèles, ${m.comptesDisponibles} compte(s))` : '(absent)'}`)
      .join(' · ')}`,
  );

  if (!codex?.installed || !claude?.installed) {
    console.log('Les deux moteurs ne sont pas installés ici : la règle ne peut pas être jouée pour de vrai.');
    process.exit(0);
  }

  const modelesClaude = new Set(claude.models.map((m) => m.id));
  const sousCodex = reglagesDeLaProposition({ engine: 'codex' }, catalogue);
  noter(
    'sous Codex, le modèle proposé vient du catalogue Codex',
    !!sousCodex && codex.models.some((m) => m.id === sousCodex.model),
    `${sousCodex?.model} / réflexion ${sousCodex?.thinking}`,
  );

  const modeleEmprunte = reglagesDeLaProposition(
    { engine: 'codex', model: claude.models[0].id, thinking: 'xhigh' },
    catalogue,
  );
  noter(
    'un modèle Claude glissé dans une proposition Codex est écarté',
    !!modeleEmprunte && !modelesClaude.has(modeleEmprunte.model ?? ''),
    `rendu : ${modeleEmprunte?.model}`,
  );

  const sansCompte = reglagesDeLaProposition(
    { engine: 'codex' },
    catalogue.map((m) => (m.id === 'codex' ? { ...m, comptesDisponibles: 0 } : m)),
  );
  noter(
    'un moteur sans compte se dit, et le moteur ne change pas dans le dos',
    sansCompte?.engine === 'codex' && /aucun compte/i.test(sansCompte?.avertissement ?? ''),
    sansCompte?.avertissement ?? '(aucun avertissement)',
  );

  const autreModele = (codex.models ?? []).find((m) => m.id !== sousCodex?.model);
  if (autreModele && sousCodex?.model) {
    const choisi = accorderRunDeProposition(
      { engine: 'codex', model: sousCodex.model, thinking: sousCodex.thinking, niveau: 'standard' },
      { engine: 'codex', model: autreModele.id, thinking: sousCodex.thinking },
      catalogue,
    );
    noter(
      'un modèle choisi à l’écran n’est pas réécrit par le palier du chef',
      choisi?.model === autreModele.id,
      `demandé : ${autreModele.id} · rendu : ${choisi?.model}`,
    );
  }

  /* ---------------- 2. L'écran, dans un vrai navigateur ---------------- */

  const chef = chefDOrchestre();
  if (!chef) {
    console.log('Aucune conversation de chef d’orchestre en base : rien à montrer à l’écran.');
    process.exit(resultats.some((r) => !r.ok) ? 1 : 0);
  }
  console.log(`Conversation d’essai : chef d’orchestre de « ${chef.nom} ».`);

  const attendu = sousCodex;
  let messageId;
  let projetAvant;
  let empreinte;
  let navigateur;
  try {
    projetAvant = viserProjet(chef.projectId);
    messageId = poserProposition(chef.agentId, {
      engine: attendu.engine,
      model: attendu.model,
      thinking: attendu.thinking,
      mode: 'direct',
    });

    const session = poserSession();
    empreinte = session.empreinte;
    navigateur = await chromium.launch({
      channel: 'chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
    });
    const context = await navigateur.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'fr-CH',
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    });
    await context.addCookies([
      { name: 'haikodev_session', value: session.token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await context.newPage();
    const erreurs = [];
    const instantanes = [];
    let moteursAffiches = [];
    page.on('pageerror', (error) => erreurs.push(String(error)));
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        try {
          const event = JSON.parse(String(payload));
          if (event.type === 'ready') moteursAffiches = event.engines ?? [];
          if (event.type === 'agent.snapshot') {
            instantanes.push({ agentId: event.agentId, messages: event.messages?.length ?? 0 });
          }
        } catch {
          /* trame binaire ou sans JSON */
        }
      });
    });
    await page.goto(`${BASE}/#projet/${encodeURIComponent(chef.projectId)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(7000);

    // L'application peut rouvrir sur un panneau : la conversation du chef vit
    // dans la colonne de droite, et se retrouve à l'Échap près.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    const ouvrirChef = page.getByRole('button', { name: /^Chef/ }).first();
    if (await ouvrirChef.count()) {
      await ouvrirChef.click();
      await page.waitForTimeout(1800);
    }

    /* Le cadre ENTIER de la carte à valider — titre, avertissement et barre de
       réglages — et non le seul paragraphe du titre. */
    const bloc = page
      .getByText('Essai — réglages hérités de la conversation')
      .first()
      .locator('xpath=ancestor::div[contains(@class,"border-accent/40")][1]');
    const vu = (await bloc.count()) > 0;
    noter('la proposition d’essai est bien affichée', vu);
    if (!vu) {
      const textePage = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      console.log(
        `  …  écran obtenu : titre=${await page.getByText('Essai — réglages hérités de la conversation').count()}, ` +
          `bandeaux=${await page.locator('[data-bandeau="propositions"]').count()}, ` +
          `instantanés=${JSON.stringify(instantanes)} · ${textePage.slice(0, 500)}`,
      );
    }

    if (vu) {
      await bloc.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(600);
      const texte = (await bloc.innerText()).replace(/\s+/g, ' ');
      // Le point d'entrée unique des réglages : son aperçu porte la ligne
      // « Modèle », avec la valeur affichée en clair dans `data-valeur`.
      await bloc.locator('[data-selecteur="config"]').first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(600);
      // Le contenu du menu est posé dans un PORTAIL, hors du bloc de la carte.
      const modeleAffiche = ((await page.locator('[data-selecteur="modele"]').first().getAttribute('data-valeur').catch(() => '')) || '').trim();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      noter('le moteur de la conversation est affiché sur la carte à valider', texte.includes(codex.label), texte.slice(0, 160));
      const modelesCodexAffiches = (moteursAffiches.find((moteur) => moteur.id === 'codex')?.models ?? []).map(
        (modele) => modele.label,
      );
      noter(
        'le modèle affiché appartient bien au moteur retenu',
        modelesCodexAffiches.some((label) => label.toLowerCase() === modeleAffiche.toLowerCase()),
        `demandé : ${attendu.model} · affiché : ${modeleAffiche || '(introuvable)'}`,
      );
      // Aucun libellé de modèle Claude ne doit apparaître sur une carte Codex.
      const intrus = (moteursAffiches.find((moteur) => moteur.id === 'claude')?.models ?? [])
        .map((m) => m.label)
        .filter((label) => texte.toLowerCase().includes(label.toLowerCase()));
      noter('aucun modèle Claude n’apparaît sur une proposition Codex', intrus.length === 0, intrus.join(', '));

      // Les trois réglages restent MODIFIABLES : le point d'entrée s'ouvre.
      const entreeReglages = bloc.locator('[data-selecteur="config"]').first();
      if (await entreeReglages.count()) {
        await entreeReglages.click({ force: true });
        await page.waitForTimeout(1200);
        const ouvert = await page.getByRole('menu').count();
        noter('les réglages restent modifiables avant validation', ouvert > 0);
        await page.keyboard.press('Escape');
      } else {
        noter('les réglages restent modifiables avant validation', false, 'point d’entrée des réglages introuvable');
      }
    }

    noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    await context.close();
  } finally {
    if (navigateur) await navigateur.close().catch(() => {});
    retirer(messageId, empreinte, projetAvant);
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
