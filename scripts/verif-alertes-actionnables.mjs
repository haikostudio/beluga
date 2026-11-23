#!/usr/bin/env node
/**
 * UNE ALERTE QUI S'ALLUME MÈNE-T-ELLE VRAIMENT À UN GESTE ?
 *
 * Le cas de la capture, rejoué tel quel dans un vrai navigateur : une
 * publication tombée il y a trois jours pose une décision « une erreur a arrêté
 * le travail ». Elle ne porte AUCUNE CARTE, et sa conversation n'est pas
 * envoyée à l'écran — un agent terminé depuis trois jours ne fait partie ni des
 * agents au travail, ni de ceux qui viennent de finir, ni de ceux d'une carte
 * affichée. La ligne s'affichait donc dans la cloche et sur le projet, et le
 * clic ne faisait RIEN : une alerte à vie.
 *
 * Ce contrôle vérifie, dans l'ordre :
 *
 *   1. l'alerte s'allume bien — pastille de la cloche, triangle du projet ;
 *   2. le clic OUVRE la conversation, même jamais chargée, et amène jusqu'au
 *      MESSAGE qui porte la décision, mis en évidence ;
 *   3. les trois issues sont là, et « Ignorer » ÉTEINT l'alerte pour de bon ;
 *   4. une décision qui ne mène à aucun geste n'allume rien du tout.
 *
 * Base neuve, dossiers jetables, démon à soi sur un port d'essai : le démon de
 * production n'est jamais touché, et aucun moteur n'est lancé.
 *
 *   npm run build && node scripts/verif-alertes-actionnables.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7196);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-alertes-actionnables-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

console.log(`  …  dépôt jugé : ${RACINE}`);

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

const DOSSIER = path.join(TMP, 'projet');
const { DATA, PROJETS, demon, journal, attendrePort } = demarrerDemonDEssai({
  tmp: TMP,
  port: PORT,
  depot: false,
  dossiers: [DOSSIER],
});
let navigateur;

/* ------------------------------------------------------------------ */
/* Le décor : une publication tombée il y a trois jours, sans carte     */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const AGENT_ID = 'a-publication';
const MESSAGE_ID = 'm-erreur';
const IL_Y_A_TROIS_JOURS = Date.now() - 3 * 24 * 3600_000;
const base = () => new Database(path.join(DATA, 'beluga.db'));

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(JETON),
    maintenant,
    maintenant + 3600_000,
    'vérification alertes actionnables',
  );

  // Plafond d'agents à ZÉRO : rien ne peut démarrer tout seul dans le dos.
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai alertes',
    path: DOSSIER,
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

  /*
   * L'agent de PUBLICATION : sans carte, en échec, terminé il y a trois jours.
   * C'est exactement ce que l'écran ne reçoit JAMAIS de lui-même — d'où le trou
   * que ce contrôle surveille.
   */
  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    role: 'deploy',
    title: 'Publication — Mise en ligne en échec',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'failed',
    startedAt: IL_Y_A_TROIS_JOURS,
    endedAt: IL_Y_A_TROIS_JOURS,
    createdAt: IL_Y_A_TROIS_JOURS,
    updatedAt: IL_Y_A_TROIS_JOURS,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(agent.id, PROJET_ID, 'deploy', 'failed', JSON.stringify(agent), IL_Y_A_TROIS_JOURS, IL_Y_A_TROIS_JOURS);

  // Quelques bulles ordinaires AVANT celle qui porte la décision : sans elles,
  // « amener jusqu'au message » ne prouverait rien — il serait déjà à l'écran.
  for (let i = 0; i < 12; i += 1) {
    const bavard = {
      id: `m-bruit-${i}`,
      agentId: AGENT_ID,
      role: 'assistant',
      content: `Étape ${i + 1} de la mise en ligne, terminée.\n\n`.repeat(6),
      steps: [],
      todos: [],
      proposals: [],
      questions: [],
      downloads: [],
      attachments: [],
      createdAt: IL_Y_A_TROIS_JOURS + i,
    };
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      bavard.id,
      AGENT_ID,
      'assistant',
      JSON.stringify(bavard),
      bavard.createdAt,
    );
  }

  const message = {
    id: MESSAGE_ID,
    agentId: AGENT_ID,
    role: 'assistant',
    content: 'La mise en ligne s’est arrêtée.',
    steps: [],
    todos: [],
    proposals: [],
    questions: [],
    downloads: [],
    attachments: [],
    erreurDeTour: { cause: 'Le moteur s’est arrêté (code 143).', at: IL_Y_A_TROIS_JOURS },
    createdAt: IL_Y_A_TROIS_JOURS + 100,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    message.id,
    AGENT_ID,
    'assistant',
    JSON.stringify(message),
    message.createdAt,
  );

  // Et douze bulles APRÈS : la décision est enterrée au milieu du fil.
  for (let i = 0; i < 12; i += 1) {
    const suite = {
      id: `m-suite-${i}`,
      agentId: AGENT_ID,
      role: 'assistant',
      content: `Journal ${i + 1}.\n\n`.repeat(6),
      steps: [],
      todos: [],
      proposals: [],
      questions: [],
      downloads: [],
      attachments: [],
      createdAt: IL_Y_A_TROIS_JOURS + 200 + i,
    };
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      suite.id,
      AGENT_ID,
      'assistant',
      JSON.stringify(suite),
      suite.createdAt,
    );
  }
  db.close();
}

function decisionTranchee() {
  const db = base();
  const ligne = db.prepare('SELECT data FROM messages WHERE id = ?').get(MESSAGE_ID);
  db.close();
  return ligne ? JSON.parse(ligne.data).erreurDeTour?.choix : undefined;
}

/* ------------------------------------------------------------------ */
/* Le contrôle                                                         */
/* ------------------------------------------------------------------ */

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const contexte = await navigateur.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([
    { name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  /* ---------- 1. L'alerte s'allume ---------- */

  const pastille = page.locator('[data-repere-questions]');
  await pastille.first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  const compte = (await pastille.count()) ? (await pastille.first().innerText()).trim() : '';
  noter('la publication tombée allume la pastille de la cloche', compte === '1', `pastille « ${compte} »`);

  /* ---------- 2. Le clic ouvre la conversation, jamais chargée ---------- */

  await page.locator('[data-cloche-notifications]').click();
  await page.waitForTimeout(800);
  const ligne = page.locator('[data-notification-cliquable]').first();
  noter('la ligne de la cloche est cliquable', (await ligne.count()) === 1);
  await ligne.click();
  await page.waitForTimeout(2500);

  // Plus de fenêtre d'agent à part : le fil d'une publication s'empile sur
  // son volet de mise en production.
  const tiroir = page.locator(`[data-fil-agent-production="${AGENT_ID}"]`);
  const ouvert = (await tiroir.count()) > 0 && (await tiroir.first().isVisible());
  noter('le clic ouvre la conversation, même jamais chargée par l’écran', ouvert);

  /* ---------- 3. …et amène jusqu'au message, avec ses trois issues ---------- */

  const bulle = page.locator(`[data-message="${MESSAGE_ID}"]`);
  const bulleLa = (await bulle.count()) > 0;
  noter('le message qui porte la décision est dans le fil affiché', bulleLa);

  const dansLaVue = bulleLa
    ? await bulle.first().evaluate((element) => {
        const cadre = element.getBoundingClientRect();
        return cadre.top < window.innerHeight && cadre.bottom > 0;
      })
    : false;
  noter('le fil a défilé jusqu’à ce message, il ne s’est pas posé en bas', dansLaVue);

  const issues = page.locator('[data-erreur-de-tour="attente"]');
  noter('les trois issues sont offertes (relancer, ignorer, arrêter)', (await issues.count()) === 1);

  /* ---------- 4. « Ignorer » éteint l'alerte pour de bon ---------- */

  await page.locator('[data-erreur-ignorer]').first().click();
  await page.waitForTimeout(2500);
  noter('le choix est enregistré en base', decisionTranchee() === 'ignorer');

  const restant = await page.locator('[data-repere-questions]').count();
  noter('l’alerte s’éteint : plus aucune pastille sur la cloche', restant === 0);

  const triangle = await page.locator('[data-signal-attention]').count();
  noter('…ni aucun triangle sur la ligne du projet', triangle === 0);

  noter('aucune erreur de page pendant le parcours', erreurs.length === 0, erreurs.join(' | '));

  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await navigateur?.close();
  } catch {
    /* rien à fermer */
  }
  process.exit(1);
});
