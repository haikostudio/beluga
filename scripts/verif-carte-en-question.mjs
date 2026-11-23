#!/usr/bin/env node
/**
 * UNE CARTE ARRÊTÉE SUR SA QUESTION N'EST EN TRAVAIL POUR PERSONNE — vérifié
 * dans un vrai navigateur, sur « Tableaux de bord » ET sur le tableau du projet.
 *
 * L'agent de la carte a son tour vivant (l'outil `ask_user` bloque jusqu'à la
 * réponse) ET le drapeau `attendReponse`. La carte doit alors :
 *  - dire « Attend votre réponse » dans son coin (Tableaux de bord), sans point qui bat ;
 *  - ne montrer AUCUNE roue qui tourne, ni la barre de travail animée ;
 *  - montrer en pied que l'agent attend votre réponse (nature « question ») ;
 *  - porter le repère de la question, au ton d'une décision attendue ;
 *  - allumer la pastille bleue « rendu non consulté ».
 * Et une carte dont l'agent travaille vraiment garde sa roue : la règle ne
 * doit pas éteindre le travail réel.
 *
 * Démon et base d'ESSAI à soi (`BELUGA_VERIF_QUESTION_PORT`), plafond d'agents
 * à zéro : aucun moteur ne part. Ne reprend jamais `BELUGA_URL` ni `BELUGA_TOKEN`.
 *
 * RECALÉ SUR LA REFONTE (11/10/2026). La colonne de gauche suit le lieu : dans
 * le projet où l'application s'ouvre, elle porte les options du projet, plus
 * la ligne « Tableaux de bord » (`data-ouvrir-en-route`, cachée avec la liste
 * des projets). On atteint la page de tous les projets par la flèche de retour
 * en tête de la colonne (`data-menu-de-colonne`).
 *
 *   npm run build && node scripts/verif-carte-en-question.mjs
 */
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { ouvrirLesTableauxDeBord } from './lib/navigation.mjs';

const PORT = Number(process.env.BELUGA_VERIF_QUESTION_PORT || 7201);
const BASE = `http://127.0.0.1:${PORT}`;
const PROJET = 'p-question';

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, PROJETS, attendrePort, journal } = demarrerDemonDEssai({
  prefixe: 'verif-carte-en-question-',
  port: PORT,
  depot: false,
  env: { BELUGA_MARKETING_NUIT: '0' },
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), maintenant, maintenant + 3600_000, 'vérification carte en question');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  const dossier = path.join(PROJETS, PROJET);
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
    PROJET,
    'Projet en question',
    dossier,
    JSON.stringify({ id: PROJET, name: 'Projet en question', path: dossier, defaultEngine: 'claude', isSelf: false, branchesDePublication: {}, rank: 1000, archived: false, createdAt: maintenant, updatedAt: maintenant }),
    maintenant,
    maintenant,
  );
  const carte = (id, titre, agentId, renduA) => {
    const donnees = {
      description: 'Une carte d’essai.', origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' }, excludedFromDeploy: false,
      horsTache: false, scheduling: { asap: false, attempts: 0, restarts: 0 }, agentId, renduA, lastReadAt: 1, createdAt: maintenant, updatedAt: maintenant,
    };
    db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, agent_id, last_read_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, PROJET, 'running', 1, titre, JSON.stringify(donnees), agentId, 1, maintenant, maintenant,
    );
  };
  const agent = (id, cardId, attendReponse) => {
    const donnees = {
      id, projectId: PROJET, cardId, role: 'cadrage', title: 'Agent', status: 'running', startedAt: maintenant - 60_000,
      tourVivantDepuis: maintenant - 60_000, run: { engine: 'claude', thinking: 'none', mode: 'direct' }, createdAt: maintenant, updatedAt: maintenant,
      ...(attendReponse ? { attendReponse: true, etapeEnCours: 'Question posée' } : { etapeEnCours: 'Lecture du code' }),
    };
    db.prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, PROJET, cardId, 'cadrage', 'running', JSON.stringify(donnees), maintenant, maintenant,
    );
  };
  // Le démon écrit l'instant de la question sur la carte (`marquerRendu`) ; le décor le pose de même.
  carte('c-question', 'Carte qui attend votre réponse', 'a-question', maintenant - 30_000);
  agent('a-question', 'c-question', true);
  carte('c-travail', 'Carte au travail', 'a-travail', undefined);
  agent('a-travail', 'c-travail', false);
  db.close();
}

let navigateur;
try {
  if (!(await attendrePort(60_000))) throw new Error('le démon d’essai ne répond pas');
  poserLeDecor();
  navigateur = await chromium.launch({ channel: 'chrome' });
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));

  /* -------- Tableaux de bord -------- */
  // Par la colonne de gauche, comme un utilisateur : une adresse collée au
  // chargement peut être réécrite par l'application pendant son démarrage.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await ouvrirLesTableauxDeBord(page);
  await page.waitForSelector('[data-carte-en-route="c-question"]', { timeout: 10000 });
  await page.waitForTimeout(800);
  const q = page.locator('[data-carte-en-route="c-question"]');
  noter('Tableaux de bord : le coin dit « Attend votre réponse »', (await q.locator('[data-temoin-en-route="question"]').innerText()).includes('Attend votre réponse'));
  noter('Tableaux de bord : aucune roue qui tourne sur la carte', (await q.locator('.animate-spin').count()) === 0);
  noter('Tableaux de bord : aucun point qui bat dans le coin', (await q.locator('[data-temoin-en-route] .animate-pulse, [data-temoin-en-route] [class*="animate-ping"]').count()) === 0);
  noter('Tableaux de bord : le pied dit que la carte attend votre réponse', (await q.locator('[data-travail-restant-nature="question"]').count()) === 1 && (await q.locator('[data-barre-travail]').count()) === 0);
  const repere = q.locator('[data-attention-carte="c-question"]');
  noter('Tableaux de bord : le repère de la question est là, au ton d’une décision attendue', (await repere.count()) === 1 && /text-warning/.test((await repere.getAttribute('class')) ?? ''));
  noter('Tableaux de bord : la pastille bleue est allumée', (await page.locator('[data-carte-non-lue="c-question"]').count()) === 1);
  await q.screenshot({ path: path.join(os.tmpdir(), 'verif-carte-en-question.png') });
  console.log(`  …  capture : ${path.join(os.tmpdir(), 'verif-carte-en-question.png')}`);
  const t = page.locator('[data-carte-en-route="c-travail"]');
  noter('une carte vraiment au travail garde sa roue et son témoin', (await t.locator('[data-temoin-en-route="travail"]').count()) === 1 && (await t.locator('[data-barre-travail]').count()) === 1);

  /* -------- Le tableau du projet -------- */
  await page.evaluate((id) => {
    window.location.hash = `projet/${id}`;
  }, PROJET);
  await page.waitForSelector('[data-carte="c-question"]', { timeout: 20000 });
  await page.waitForTimeout(800);
  const carteTableau = page.locator('[data-carte="c-question"]');
  noter('au tableau : aucune roue qui tourne sur la carte', (await carteTableau.locator('.animate-spin').count()) === 0);
  noter('au tableau : le repère de la question est là, au ton d’une décision attendue', /text-warning/.test((await page.locator('[data-attention-carte="c-question"]').first().getAttribute('class')) ?? ''));
  noter('au tableau : la pastille bleue est allumée', (await page.locator('[data-carte-non-lue="c-question"]').count()) === 1);
  noter('au tableau : la carte au travail garde sa barre de travail', (await page.locator('[data-barre-travail="c-travail"]').count()) === 1);
  noter('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
} catch (err) {
  noter('le contrôle est allé au bout', false, err?.message ?? String(err));
  console.log(journal.slice(-20).join(''));
} finally {
  await navigateur?.close();
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
process.exit(echecs ? 1 : 0);
