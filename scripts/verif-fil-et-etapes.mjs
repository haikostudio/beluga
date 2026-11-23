#!/usr/bin/env node
/**
 * LE FIL FAÇON EXTENSION CHROME, LES TÂCHES SOUS « TRAVAIL », LE MENU ⋮ ÉPURÉ (13/11/2026), DANS UN VRAI NAVIGATEUR.
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-fil-et-etapes.mjs
 *   (BELUGA_VERIF_CAPTURES=<dossier> pour garder les captures 1440 / 390, clair et sombre)
 *
 * Démon d'essai sur une base neuve, port à soi, aucun moteur lancé. Ce qui est vérifié :
 *   1. le menu ⋮ de la colonne ne porte plus Résumé, Statistiques, Messagerie, Backup, Surveillance ni Tâches
 *      récurrentes ;
 *   2. le fil d'un tour se lit à plat : phrases de l'agent en clair, actions réunies en groupes repliés nommés en
 *      toutes lettres (« 3 fichiers lus, 1 recherche »), question à sa place, et la réponse EN DERNIER ;
 *   3. au-dessus du champ, un seul bloc : plus de ligne « Liste des tâches », les tâches rangées sous « Travail »,
 *      dépliées pour une carte au travail, repliées en « n/N tâches » pour une carte archivée, et un appui les déplie ;
 *   4. la zone « En cours » montre une demande de « Planifié » vieille de trois semaines.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7263);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.BELUGA_VERIF_CAPTURES;
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });
const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-fil-et-etapes-', port: PORT });
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const MAINTENANT = Date.now();
const MIN = 60_000;
const JOUR = 24 * 60 * MIN;
const base = (options) => new Database(path.join(DATA, 'beluga.db'), options);

function projet(db, id, name) {
  const p = { id, name, path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: MAINTENANT, updatedAt: MAINTENANT };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(id, name, p.path, JSON.stringify(p), MAINTENANT, MAINTENANT);
}

function carte(db, id, column, title, quand, extra = {}) {
  const c = {
    id, projectId: 'p-un', title, description: '', labels: [], column, position: quand,
    origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    excludedFromDeploy: false, horsTache: false, codeDejaEnregistre: false, createdAt: quand, updatedAt: quand,
    ...extra,
  };
  db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, last_read_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, 'p-un', column, quand, title, JSON.stringify(c), c.deployedAt ?? null, c.lastReadAt ?? null, quand, quand,
  );
}

function agentAvecTaches(db, id, carteId, todos, quand) {
  const agent = { id, projectId: 'p-un', cardId: carteId, role: 'task', title: 'Agent', run: { engine: 'claude', thinking: 'low', mode: 'direct' }, status: 'done', startedAt: quand, endedAt: quand + MIN, createdAt: quand, updatedAt: quand + MIN };
  db.prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, 'p-un', carteId, 'task', 'done', JSON.stringify(agent), quand, quand + MIN);
  const message = { id: `m-${id}`, agentId: id, role: 'assistant', content: 'Fait.', steps: [], todos, proposals: [], questions: [], downloads: [], attachments: [], createdAt: quand + MIN };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(message.id, id, 'assistant', JSON.stringify(message), quand + MIN);
  const ligne = db.prepare('SELECT data FROM cards WHERE id = ?').get(carteId);
  db.prepare('UPDATE cards SET data = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(ligne.data), agentId: id }), carteId);
}

let rang = 0;
function trace(db, carteId, phase, partiel) {
  rang += 1;
  db.prepare(
    `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, outil, params, resultat, reussie, duree_ms, etat, donnees)
     VALUES (@id, @card_id, @rang, @phase, @nature, @at, @agent_id, @agent_role, @tour_id, @libelle, @outil, @params, @resultat, @reussie, @duree_ms, @etat, @donnees)`,
  ).run({
    id: `j-${carteId}-${rang}`, card_id: carteId, rang, phase, nature: 'requete', at: MAINTENANT - 50 * MIN + rang * 1000,
    agent_id: 'a-travail', agent_role: phase === 'cadrage' ? 'cadrage' : 'task', tour_id: `t-${phase}`, libelle: '',
    outil: null, params: null, resultat: null, reussie: 1, duree_ms: 800, etat: null, donnees: null, ...partiel,
  });
}
const note = (db, c, phase, texte) => trace(db, c, phase, { nature: 'jalon', libelle: 'Note de l’agent', resultat: texte });
const lire = (db, c, phase, f) => trace(db, c, phase, { outil: 'Read', libelle: 'Read', params: JSON.stringify({ file_path: `/depot/web/src/${f}` }), resultat: 'contenu' });

function poserLeDecor() {
  const db = base();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), MAINTENANT, MAINTENANT + 3600_000, 'essai');
  projet(db, 'p-un', 'Beluga essai');
  carte(db, 'c-travail', 'running', 'Fil façon extension Chrome', MAINTENANT - 50 * MIN);
  carte(db, 'c-archivee', 'archived', 'Bouton d’export livré', MAINTENANT - 2 * JOUR, { deployedAt: MAINTENANT - JOUR, lastReadAt: MAINTENANT - JOUR / 2 });
  carte(db, 'c-vieille', 'planned', 'Une demande de trois semaines', MAINTENANT - 21 * JOUR);
  agentAvecTaches(db, 'a-travail', 'c-travail', [
    { label: 'Lire le fil des cartes', state: 'done', startedAt: MAINTENANT - 40 * MIN, endedAt: MAINTENANT - 35 * MIN },
    { label: 'Écrire la règle du flux', state: 'done', startedAt: MAINTENANT - 35 * MIN, endedAt: MAINTENANT - 25 * MIN },
    { label: 'Ranger la réponse en dernier', state: 'done', startedAt: MAINTENANT - 25 * MIN, endedAt: MAINTENANT - 15 * MIN },
    { label: 'Lancer les contrôles', state: 'unfinished', startedAt: MAINTENANT - 15 * MIN },
    { label: 'Prendre les captures', state: 'todo' },
  ], MAINTENANT - 45 * MIN);
  agentAvecTaches(db, 'a-archivee', 'c-archivee', Array.from({ length: 8 }, (_, i) => ({ label: `Étape ${i + 1} du bouton d’export`, state: 'done', startedAt: MAINTENANT - 2 * JOUR + i * MIN, endedAt: MAINTENANT - 2 * JOUR + (i + 1) * MIN })), MAINTENANT - 2 * JOUR);
  /* Le tour de cadrage : phrases, actions, question répondue, puis la réponse. */
  trace(db, 'c-travail', 'cadrage', { nature: 'jalon', libelle: 'Demande', resultat: 'Corrige l’ordre du fil : le travail doit passer avant la réponse.' });
  note(db, 'c-travail', 'cadrage', 'Je regarde comment le fil range la réponse et le récit du travail.');
  lire(db, 'c-travail', 'cadrage', 'chat.tsx');
  lire(db, 'c-travail', 'cadrage', 'flux-en-points.tsx');
  lire(db, 'c-travail', 'cadrage', 'barre-etapes.tsx');
  trace(db, 'c-travail', 'cadrage', { outil: 'Grep', libelle: 'Grep', params: JSON.stringify({ pattern: 'reponseDuPoint' }), resultat: 'a' });
  note(db, 'c-travail', 'cadrage', 'L’ordre vient d’un choix d’octobre. Je vérifie les contrôles qui s’appuient dessus.');
  trace(db, 'c-travail', 'cadrage', { outil: 'Bash', libelle: 'Bash', params: JSON.stringify({ command: 'grep -rn data-reponse scripts', description: 'Chercher les contrôles de la réponse' }), resultat: 'ok' });
  trace(db, 'c-travail', 'cadrage', {
    outil: 'mcp__beluga__ask_user', libelle: 'mcp__beluga__ask_user',
    params: JSON.stringify({ question: 'On applique le même ordre au Studio et aux cartes ?', options: [{ label: 'Oui, partout' }, { label: 'Non' }] }),
    resultat: 'Réponse : Oui, partout',
  });
  note(db, 'c-travail', 'cadrage', 'Noté. Je prépare la suite.');
  trace(db, 'c-travail', 'cadrage', { outil: 'Read', libelle: 'Read', params: JSON.stringify({ file_path: '/depot/scripts/verif.mjs' }), resultat: 'x' });
  trace(db, 'c-travail', 'cadrage', { nature: 'jalon', libelle: 'Réponse rendue', resultat: '### Le travail avant la réponse\nChaque tour se lit maintenant de haut en bas : les phrases de l’agent, ses actions groupées, puis la réponse en dernier.' });
  db.close();
}

let navigateur;
try {
  if (!(await attendrePort())) throw new Error(`Le démon d’essai n’a pas démarré :\n${journal.join('')}`);
  poserLeDecor();
  navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  for (const [largeur, hauteur, appareil] of [[1440, 950, 'ordinateur'], [390, 844, 'telephone']]) {
    for (const theme of ['light', 'dark']) {
      const db = base();
      db.prepare('INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('theme', JSON.stringify(theme === 'dark' ? 'sombre' : 'clair'), Date.now());
      db.close();
      const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-CH', colorScheme: theme, ...(largeur < 640 ? { isMobile: true, hasTouch: true } : {}) });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await contexte.newPage();
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(String(e)));
      const capture = async (nom) => CAPTURES && page.screenshot({ path: path.join(CAPTURES, `${nom}-${appareil}-${theme === 'dark' ? 'sombre' : 'clair'}.png`) });
      const verifier = appareil === 'ordinateur' && theme === 'light';

      /* 1. Le menu ⋮ de la colonne (ordinateur) */
      if (appareil === 'ordinateur') {
        await page.goto(`${BASE}/#en-route`);
        await page.locator('aside[data-zone="gauche"] [data-menu-dossier]').first().click({ timeout: 30000 });
        const panneau = page.locator('[data-menu-dossier-panneau]');
        await panneau.waitFor({ state: 'visible', timeout: 10000 });
        await capture('menu-colonne');
        if (verifier) {
          const retires = await panneau.locator('[data-ouvrir-statistiques], [data-ouvrir-backups], [data-ouvrir-surveillance], [data-ouvrir-espace-client], [data-ouvrir-tableau-de-bord], [data-ouvrir-taches-recurrentes]').count();
          noter('1. le menu ⋮ ne porte plus les six outils propres à un projet', retires === 0, `${retires} entrée(s)`);
          noter('1. il garde Coffre-fort et Mémoire', (await panneau.locator('[data-ouvrir-coffre], [data-ouvrir-memoire]').count()) === 2);
          const zone = 'aside[data-zone="gauche"] [data-taches-en-cours-colonne] ';
          const ids = await page.locator(`${zone}[data-agent-en-cours]`).evaluateAll((els) => els.map((el) => el.getAttribute('data-agent-en-cours')));
          noter('4. la zone « En cours » garde une demande de trois semaines', ids.includes('c-vieille'), ids.join(','));
        }
        await page.keyboard.press('Escape');
      }

      /* 2 et 3. La carte au travail */
      await page.goto(`${BASE}/#projet/p-un/tache/c-travail`);
      const point = page.locator('[data-point="comprehension"]').last();
      await point.locator('[data-flux-du-tour]').waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForTimeout(800);
      const bloc = page.locator('[data-ligne-etapes]:visible').first();
      if ((await bloc.getAttribute('data-ligne-ouverte')) === null) await page.locator('[data-barre-en-ligne]:visible').click();
      await page.waitForTimeout(400);
      await capture('carte-au-travail');
      if (verifier) {
        const notes = await point.locator('[data-note-du-flux]').allTextContents();
        noter('2. les phrases de l’agent se lisent en clair, dans l’ordre', notes.length === 3 && notes[0].includes('Je regarde') && notes[2].includes('Noté'), notes.join(' | '));
        const libelles = await point.locator('[data-groupe-libelle]').allTextContents();
        noter('2. les actions se réunissent en groupes nommés en toutes lettres', libelles[0] === '3 fichiers lus, 1 recherche', libelles.join(' | '));
        const ordre = await point.evaluate((el) => {
          const sel = ['[data-note-du-flux]', '[data-groupe-d-actions]', '[data-element-du-flux="question"]', '[data-bloc-reponse]'];
          return sel.map((s) => { const n = el.querySelector(s); return n ? n.getBoundingClientRect().top : null; });
        });
        noter('2. la question à sa place, la réponse en dernier', ordre.every((v) => v !== null) && ordre[2] > ordre[1] && ordre[3] > ordre[2], ordre.map((v) => Math.round(v ?? NaN)).join(' < '));
        noter('3. plus de ligne « Liste des tâches » sous les étapes', (await page.locator('[data-ligne-du-temoin]').count()) === 0);
        const sousTravail = page.locator('[data-ligne-etapes]:visible [data-taches-sous-travail]');
        noter('3. les tâches se rangent sous « Travail », dépliées pour une carte au travail', (await sousTravail.count()) === 1 && (await sousTravail.getAttribute('data-taches-repliees')) === null && (await sousTravail.locator('[data-taches-en-branches] li').count()) === 5);
        noter('3. « Travail » dit le compte de ses tâches', ((await page.locator('[data-ligne-etapes]:visible [data-compte-des-taches]').textContent()) ?? '').includes('3/5 tâches'));
        await point.locator('[data-groupe-bascule]').first().click();
        await page.waitForTimeout(400);
        noter('2. un appui déplie le détail du groupe', (await point.locator('[data-groupe-detail] [data-bloc-raconte]').count()) >= 1);
        await capture('groupe-deplie');
      }

      /* 3. La carte archivée : « Travail · 8/8 tâches » replié, puis déplié */
      await page.goto(`${BASE}/#projet/p-un/tache/c-archivee`);
      await page.locator('[data-ligne-etapes]:visible').waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForTimeout(600);
      if ((await page.locator('[data-ligne-etapes]:visible').getAttribute('data-ligne-ouverte')) === null) await page.locator('[data-barre-en-ligne]:visible').click();
      await page.waitForTimeout(400);
      await capture('carte-archivee-repliee');
      const repliee = page.locator('[data-ligne-etapes]:visible [data-taches-sous-travail][data-taches-repliees]');
      if (verifier) noter('3. une carte archivée montre « 8/8 tâches » replié', (await repliee.count()) === 1 && ((await page.locator('[data-ligne-etapes]:visible [data-compte-des-taches]').textContent()) ?? '').includes('8/8'));
      await page.locator('[data-ligne-etapes]:visible [data-chevron-des-taches]').click();
      await page.waitForTimeout(400);
      await capture('carte-archivee-depliee');
      if (verifier) noter('3. un appui déplie les huit tâches', (await page.locator('[data-ligne-etapes]:visible [data-taches-sous-travail] [data-taches-en-branches] li').count()) === 8);
      if (verifier) noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
      await contexte.close();
    }
  }
} catch (erreur) {
  noter('le contrôle s’est déroulé jusqu’au bout', false, String(erreur?.message ?? erreur).slice(0, 400));
} finally {
  await navigateur?.close().catch(() => undefined);
}
const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passent.`);
process.exit(echecs.length ? 1 : 0);
