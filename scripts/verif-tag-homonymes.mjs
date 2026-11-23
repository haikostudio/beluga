#!/usr/bin/env node
/**
 * DEUX IMAGES DE MÊME NOM, DEUX PASTILLES DISTINCTES — dans un vrai navigateur.
 *
 *   node scripts/verif-tag-homonymes.mjs
 *
 * Deux captures collées s'appellent toutes deux « image.png ». Le tag du
 * texte retrouvait sa pièce par son NOM : les deux pastilles montraient le même
 * « #alias », et l'agent recevait deux fois le premier fichier. Le composeur
 * écrit désormais la désignation (« image.png #f0da ») : chaque pastille porte
 * l'alias de SA pièce, et la croix de la seconde ne retire que la seconde.
 *
 * Démon et base d'ESSAI à soi (`BELUGA_TAG_PORT`), plafond d'agents à zéro :
 * rien ne part au moteur. Il ne reprend jamais `BELUGA_URL`.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { ouvrirLaCarte } from './lib/navigation.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_TAG_PORT || 7234);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { TMP, DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-tag-homonymes-', port: PORT });

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-tag';
const CARTE_ID = 'c-tag';
const AGENT_ID = 'a-tag';
const TITRE = 'Carte d’essai — identifiant court';
const NOM = 'image.png';
/* Une image PNG d'un pixel : le dépôt la range comme n'importe quelle capture. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const SECONDE = Buffer.concat([PNG, Buffer.from('seconde')]);

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification homonymes',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('DELETE FROM projects').run();
  const projet = { id: PROJET_ID, name: 'Essai tag', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: maintenant, updatedAt: maintenant };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);
  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    agentId: AGENT_ID,
    title: TITRE,
    description: 'Carte du contrôle.',
    labels: [],
    column: 'planned',
    position: 1,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none', mode: 'plan' },
    scheduling: { asap: false, attempts: 0, restarts: 0 },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(CARTE_ID, PROJET_ID, 'planned', 1, TITRE, JSON.stringify(carte), maintenant, maintenant);
  const agent = { id: AGENT_ID, projectId: PROJET_ID, cardId: CARTE_ID, role: 'cadrage', title: TITRE, run: carte.run, status: 'idle', createdAt: maintenant, updatedAt: maintenant };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(AGENT_ID, PROJET_ID, CARTE_ID, 'cadrage', 'idle', JSON.stringify(agent), maintenant, maintenant);
  const demande = { id: 'm-demande', agentId: AGENT_ID, role: 'user', content: 'Essai du tag.', steps: [], todos: [], proposals: [], questions: [], downloads: [], attachments: [], createdAt: maintenant };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    demande.id,
    AGENT_ID,
    'user',
    JSON.stringify(demande),
    maintenant,
  );
  /* UNE « image.png » DÉJÀ CONNUE D'UNE AUTRE CARTE, au contenu de la
     seconde : le dédoublonnage la rend telle quelle, sous son nom d'origine —
     exactement le cas de la capture d'écran qui a ouvert cette carte. */
  const ancienne = {
    id: 'f0da0000-0000-4000-8000-00000000abcd',
    alias: 'f0da',
    projectId: PROJET_ID,
    name: NOM,
    mime: 'image/png',
    size: SECONDE.length,
    sha: crypto.createHash('sha256').update(SECONDE).digest('hex'),
    cardId: 'c-autre',
    createdAt: maintenant - 60_000,
  };
  db.prepare('INSERT INTO attachments (id, project_id, sha, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    ancienne.id, PROJET_ID, ancienne.sha, JSON.stringify(ancienne), ancienne.createdAt,
  );
  db.close();
}

/** Les alias ENREGISTRÉS des pièces déposées, dans l'ordre du dépôt. */
function aliasEnBase() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const lignes = db.prepare('SELECT data FROM attachments').all();
  db.close();
  return lignes.map((l) => JSON.parse(l.data)).map((p) => ({ alias: p.alias, name: p.name }));
}

const etiquettes = (page) =>
  page.evaluate(() => ({
    tags: [...document.querySelectorAll('[data-prompt-file-pastille]')].map((n) => n.innerText.replace(/\s+/g, ' ').trim()),
    barre: [...document.querySelectorAll('[data-piece-etiquette]')].map((n) => n.getAttribute('data-piece-etiquette')),
  }));

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  await new Promise((r) => setTimeout(r, 1500));

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(5000);
  await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });
  await ouvrirLaCarte(page, { id: CARTE_ID, titre: TITRE, projetId: PROJET_ID });
  await page.waitForSelector('[data-composer] [data-composer-file]', { state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(1000);

  await page.locator('[data-composer] textarea').last().click();
  await page.locator('[data-composer] textarea').last().type('Voir ');
  /* Deux contenus différents, un même nom, envoyés ENSEMBLE ; la seconde est
     déjà connue du projet sous « image.png » (autre carte). */
  await page.setInputFiles('[data-composer] [data-composer-file]', [
    { name: NOM, mimeType: 'image/png', buffer: PNG },
    { name: NOM, mimeType: 'image/png', buffer: SECONDE },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('[data-prompt-file-pastille]').length === 2, null, { timeout: 20_000 });
  await page.waitForTimeout(800);

  const pieces = aliasEnBase();
  const attendues = pieces.map((p) => `#${p.alias}`).sort();
  const avant = await etiquettes(page);
  noter('deux pièces de même nom, chacune son alias', pieces.length === 2 && pieces[0].name === pieces[1].name && pieces[0].alias !== pieces[1].alias, JSON.stringify(pieces));
  noter(
    'les deux pastilles du texte portent deux alias différents, ceux des pièces',
    JSON.stringify([...avant.tags].sort()) === JSON.stringify(attendues),
    JSON.stringify(avant),
  );

  // La croix de la SECONDE pastille ne retire que la seconde pièce.
  const seconde = avant.tags[1];
  await page.locator('[data-prompt-file-pastille]').nth(1).locator('[data-prompt-file-close]').click();
  await page.waitForTimeout(800);
  const apres = await etiquettes(page);
  noter(
    'la croix de la seconde pastille ne retire que la seconde pièce',
    apres.tags.length === 1 && apres.tags[0] === avant.tags[0] && !apres.barre.includes(seconde) && apres.barre.includes(avant.tags[0]),
    JSON.stringify(apres),
  );

  await page.screenshot({ path: path.join(TMP, 'tag-homonymes.png') });
  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  if (echecs.length) console.log(`(capture dans ${TMP})`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  console.error(journal.slice(-30).join(''));
  process.exit(1);
});
