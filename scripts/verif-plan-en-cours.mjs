#!/usr/bin/env node
/**
 * UN PLAN ENCORE EN COURS D'ÉCRITURE NE S'AFFICHE PAS — dans un vrai
 * navigateur, sur le fil d'un agent RÉEL.
 *
 * Le défaut réparé : le cadre « Plan proposé » s'ouvrait sur la première bribe
 * de texte. Une phrase d'intention (« Je vais parcourir le site avant toute
 * analyse ») portait déjà son sélecteur de niveau et ses boutons « Valider » /
 * « Refuser », pendant qu'en dessous l'agent lançait une nouvelle recherche —
 * on pouvait donc valider un plan VIDE.
 *
 * Deux verrous, vérifiés ici sur le second (celui qui se voit) :
 *   1. le démon ne pose plus le drapeau `plan` qu'à la FIN du tour, une fois
 *      le texte jugé entier (`server/src/runtime.ts`) ;
 *   2. l'affichage refuse le cadre sur un message encore en écriture
 *      (`cadreDePlanVisible`, `shared/src/plan-conversation.ts`).
 *
 * Le message est INJECTÉ par le point d'essai de la page
 * (`window.haikodevEssai.plan`, option `enEcriture`) : on n'attend pas qu'un
 * vrai tour en produise un.
 *
 *   HAIKO_PLAN_URL=http://localhost:7099 node scripts/verif-plan-en-cours.mjs
 *
 * Le serveur de DÉVELOPPEMENT est visé : un script de vérification ne reprend
 * jamais HAIKODEV_URL, qui désigne l'application déjà publiée, ni
 * HAIKODEV_TOKEN, qui est le jeton d'un agent.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const BASE = process.env.HAIKO_PLAN_URL || 'http://localhost:7099';

/*
 * LA BASE VISÉE EST CELLE DU DÉMON QUI RÉPOND, pas celle du dépôt d'où part ce
 * script : le serveur de développement ne sert que l'interface et renvoie tout
 * le reste au démon (`web/vite.config.ts`), qui tourne sur le dossier
 * PRINCIPAL même quand on l'essaie depuis une copie de travail. On la déduit
 * du dépôt principal (`git rev-parse --path-format=absolute --git-common-dir`),
 * jamais d'un chemin écrit en dur ; `HAIKO_DB` a le dernier mot.
 */
const ICI = path.dirname(fileURLToPath(import.meta.url));
const principal = path.dirname(
  execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ICI, encoding: 'utf8' }).trim(),
);
const db = new Database(process.env.HAIKO_DB || path.join(principal, 'data', 'haikodev.db'));
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

// Jeton de session, une heure, haché en base et retiré en partant.
const jeton = crypto.randomBytes(32).toString('base64url');
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
  sha(jeton),
  Date.now(),
  Date.now() + 3600_000,
  'vérification plan en cours',
);

// Un projet d'essai jetable : un dossier vide suffit, la conversation ne
// touche à aucun code.
const dossier = fs.mkdtempSync('/tmp/plan-en-cours-');
const projetId = crypto.randomUUID();
const maintenant = Date.now();
const projet = {
  id: projetId,
  name: 'Essai — plan en cours',
  path: dossier,
  defaultEngine: 'claude',
  isSelf: false,
  miseEnProduction: {},
  archived: false,
  createdAt: maintenant,
  updatedAt: maintenant,
};
db.prepare(
  'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const nettoyer = () => {
  try {
    for (const agent of db.prepare('SELECT id FROM agents WHERE project_id = ?').all(projetId)) {
      db.prepare('DELETE FROM messages WHERE agent_id = ?').run(agent.id);
      db.prepare('DELETE FROM queue WHERE agent_id = ?').run(agent.id);
    }
    db.prepare('DELETE FROM agents WHERE project_id = ?').run(projetId);
    db.prepare('DELETE FROM cards WHERE project_id = ?').run(projetId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projetId);
    db.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton));
  } catch (err) {
    console.error('ménage : ', err);
  }
  fs.rmSync(dossier, { recursive: true, force: true });
};
process.on('exit', nettoyer);

/** Le cadre d'un plan RÉELLEMENT visible dans la page (hauteur non nulle). */
async function cadreVisible(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-mode-plan-reponse]')).some(
      (n) => n.getBoundingClientRect().height > 0,
    ),
  );
}

/** Les boutons de décision réellement affichés. */
async function boutonsVisibles(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-boutons-plan]')).some((n) => n.getBoundingClientRect().height > 0),
  );
}

const PHRASE = 'Je vais parcourir le site vitrine et lire les textes réels avant toute analyse.';

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
await contexte.addCookies([
  { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
]);
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));

await page.goto(`${BASE}/#projet/${projetId}`, { waitUntil: 'domcontentloaded' });

if (!(await page.evaluate(() => Boolean(window.haikodevEssai?.plan)))) {
  noter('la page est bien celle du serveur de développement', false, 'point d’essai absent — viser le serveur de dev');
  await navigateur.close();
  process.exit(1);
}

// Le chef d'orchestre du projet d'essai se crée à l'ouverture du panneau de
// droite : on attend sa conversation avant d'y injecter quoi que ce soit.
await page.waitForSelector('textarea[placeholder="Écrivez votre demande…"]', { timeout: 20000 });

/*
 * L'identifiant du chef se lit EN BASE, pas dans la page : l'interface ne le
 * porte plus nulle part depuis que les compteurs de jetons en ont été retirés.
 * Le démon le crée à l'ouverture du projet — on lui laisse quelques secondes.
 */
const chercherLeChef = () =>
  db.prepare("SELECT id FROM agents WHERE project_id = ? AND role = 'cadrage' LIMIT 1").get(projetId)?.id ?? null;
let agentId = null;
for (let essai = 0; essai < 40 && !agentId; essai += 1) {
  agentId = chercherLeChef();
  if (!agentId) await page.waitForTimeout(500);
}
noter('le chef d’orchestre du projet d’essai est ouvert', !!agentId, agentId ?? 'introuvable');
if (!agentId) {
  await navigateur.close();
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 1. L'AGENT ÉCRIT ENCORE : ni cadre, ni boutons.                     */
/* ------------------------------------------------------------------ */

const idMessage = `essai-plan-en-cours`;
await page.evaluate(
  ([agent, texte, id]) => window.haikodevEssai.plan(agent, texte, { enEcriture: true, id }),
  [agentId, PHRASE, idMessage],
);
await page.waitForTimeout(600);

noter('aucun cadre « Plan proposé » pendant que l’agent écrit', !(await cadreVisible(page)));
noter('aucun bouton « Valider » / « Refuser » pendant que l’agent écrit', !(await boutonsVisibles(page)));

// …et le texte est bien là, en réponse ordinaire : on ne le CACHE pas, on lui
// retire seulement son cadre de décision.
const texteVisible = await page.evaluate(
  (attendu) => document.body.innerText.includes(attendu.slice(0, 40)),
  PHRASE,
);
noter('le texte déjà écrit reste lisible dans le fil', texteVisible);

/* ------------------------------------------------------------------ */
/* 2. LE TOUR EST RENDU : le cadre et ses boutons paraissent.          */
/* ------------------------------------------------------------------ */

await page.evaluate(
  ([agent, texte, id]) => window.haikodevEssai.plan(agent, texte, { id }),
  [agentId, PHRASE, idMessage],
);
await page.waitForTimeout(600);

noter('le cadre paraît une fois le tour rendu', await cadreVisible(page));
noter('les boutons de décision paraissent avec lui', await boutonsVisibles(page));

noter('aucune erreur de page', erreurs.length === 0, erreurs.join(' | '));

await navigateur.close();

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles au vert`);
process.exit(echecs.length ? 1 : 0);
