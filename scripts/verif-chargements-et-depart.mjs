#!/usr/bin/env node
/**
 * CHARGEMENTS, PUBLICATIONS BLOQUÉES ET DÉPARTS PROGRAMMÉS, DANS UN VRAI NAVIGATEUR (carte du 19/11/2026).
 *
 *   1. La ligne « Départ » du menu « Configuration de l'agent » ouvre la feuille « Départ de la tâche » : un jour du
 *      calendrier, « Partir le … », et la carte porte sa date (`scheduling.departPrevu`) en base.
 *   2. La page « Tâches planifiées » montre la carte sous « Départs programmés » ; « Annuler le départ » retire la date.
 *   3. Une publication bloquée porte, dans le menu « Publier », « Relancer » et « Ouvrir le dépannage », côte à côte et
 *      de même hauteur ; « Relancer » arrête le dépanneur au travail.
 *   4. Une image citée par le CHEMIN de sa capture s'affiche (la pièce rangée depuis ce fichier) ; une image vraiment
 *      absente dit « Image indisponible ».
 *   5. Sur téléphone, toucher un projet dans la colonne montre une roue sur sa ligne tant que ses cartes n'arrivent pas
 *      (arrivée retardée de 2,5 s sur le canal), et la colonne ne se referme qu'ensuite.
 *
 * Un DÉMON D'ESSAI (base neuve, aucun moteur) et le serveur de développement de la copie branché sur lui. Jamais
 * BELUGA_URL, jamais BELUGA_TOKEN.
 *
 *   env -u BELUGA_TOKEN node scripts/verif-chargements-et-depart.mjs
 *   VERIF_CAPTURES=/chemin env -u BELUGA_TOKEN node scripts/verif-chargements-et-depart.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7241);
const PORT_WEB = Number(process.env.BELUGA_VERIF_PORT_WEB || 7142);
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, TMP, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-chargements-depart-', port: PORT, signaux: true, dossiers: [] });
const DOSSIER = path.join(TMP, 'projet');
const DOSSIER_2 = path.join(TMP, 'projet-2');
fs.mkdirSync(DOSSIER, { recursive: true });
fs.mkdirSync(DOSSIER_2, { recursive: true });
const CAPTURE_CITEE = path.join(TMP, 'captures-essai', 'vue-citee.png');
fs.mkdirSync(path.dirname(CAPTURE_CITEE), { recursive: true });
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-chargements';
const PROJET_2 = 'p-chargements-2';
const AGENT_ID = 'a-chargements';
const CARTE_ID = 'c-chargements';
const DEPANNEUR_ID = 'a-depanneur';
const RUN_ID = 'r-bloquee';

const vite = spawn('npm', ['run', 'dev', '--workspace', 'web', '--', '--port', String(PORT_WEB), '--strictPort'], {
  cwd: RACINE,
  env: { ...process.env, BELUGA_DEMON_PORT: String(PORT), NODE_ENV: 'development', BELUGA_URL: '', BELUGA_TOKEN: '' },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
vite.stdout.on('data', () => undefined);
vite.stderr.on('data', () => undefined);
const couperVite = () => {
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
};
process.on('exit', couperVite);

const base = () => new Database(path.join(DATA, 'beluga.db'));
function poserLaPreference(cle, valeur) {
  const db = base();
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run(cle, JSON.stringify(valeur), Date.now());
  db.close();
}

function poserLeDecor() {
  const db = base();
  const T = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai chargements et départ');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('DELETE FROM projects').run();
  for (const [id, name, dossier, rank] of [
    [PROJET_ID, 'Essai chargements', DOSSIER, 1],
    [PROJET_2, 'Second projet', DOSSIER_2, 2],
  ]) {
    const projet = { id, name, path: dossier, defaultEngine: 'claude', isSelf: false, rank, archived: false, createdAt: T, updatedAt: T };
    db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(id, name, dossier, JSON.stringify(projet), T, T);
  }
  db.close();
}

async function envoyerUneImage(nom) {
  const reponse = await fetch(`${BASE}/api/upload?project=${PROJET_ID}`, {
    method: 'POST',
    headers: { cookie: `beluga_session=${jeton}`, 'content-type': 'image/png', 'x-file-name': encodeURIComponent(nom) },
    body: fs.readFileSync(path.join(RACINE, 'web/public/icon-192.png')),
  });
  return reponse.ok ? (await reponse.json()).attachment : null;
}

/** Une carte dans « Planifié » avec sa conversation, dont la réponse cite une image par son chemin et une absente. */
function poserLaCarte(idImage) {
  const db = base();
  const T = Date.now();
  if (idImage) db.prepare("UPDATE attachments SET data = json_set(data, '$.chemins', json(?)) WHERE id = ?").run(JSON.stringify([CAPTURE_CITEE]), idImage);
  const run = { engine: 'claude', thinking: 'none', mode: 'direct' };
  const agent = { id: AGENT_ID, projectId: PROJET_ID, cardId: CARTE_ID, role: 'task', title: 'Carte d’essai', run, status: 'done', createdAt: T, updatedAt: T };
  db.prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(AGENT_ID, PROJET_ID, CARTE_ID, 'task', 'done', JSON.stringify(agent), T, T);
  const carte = {
    id: CARTE_ID, projectId: PROJET_ID, title: 'Carte d’essai — départ programmé', description: `Carte posée par un contrôle automatique.\n\n![Capture citée par son chemin](piece:${CAPTURE_CITEE})\n\n![Capture perdue](piece:/tmp/inexistant-verif/perdue.png)`, labels: [],
    column: 'planned', position: 1, origin: 'agent', agentId: AGENT_ID, run, excludedFromDeploy: false, horsTache: false,
    scheduling: { asap: false, attempts: 0, restarts: 0 }, createdAt: T, updatedAt: T,
  };
  db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(CARTE_ID, PROJET_ID, 'planned', 1, carte.title, JSON.stringify(carte), T, T);
  const vide = { steps: [], todos: [], proposals: [], questions: [], downloads: [], streaming: false };
  const contenu = `Carte d’essai : ne rien exécuter.\n\n![Capture citée par son chemin](piece:${CAPTURE_CITEE})\n\n![Capture perdue](piece:/tmp/inexistant-verif/perdue.png)`;
  const demande = { ...vide, id: 'm-demande', agentId: AGENT_ID, role: 'user', content: contenu, attachments: [], createdAt: T - 5000 };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(demande.id, AGENT_ID, 'user', JSON.stringify(demande), demande.createdAt);
  const reponse = { ...vide, id: 'm-reponse', agentId: AGENT_ID, role: 'assistant', content: 'Réponse d’essai.', attachments: [], createdAt: T };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(reponse.id, AGENT_ID, 'assistant', JSON.stringify(reponse), T);
  db.close();
}

/** Une mise en production tombée, avec un dépanneur « au travail » (sans moteur réel). */
function poserLaPublicationBloquee() {
  const db = base();
  const T = Date.now();
  const depanneur = {
    id: DEPANNEUR_ID, projectId: PROJET_ID, role: 'deploy', title: 'Dépannage du déploiement', run: { engine: 'claude', thinking: 'none' },
    status: 'running', depannagePublication: { runId: RUN_ID, cible: 'dev' }, createdAt: T, updatedAt: T,
  };
  db.prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)').run(DEPANNEUR_ID, PROJET_ID, 'deploy', 'running', JSON.stringify(depanneur), T, T);
  const run = {
    id: RUN_ID, projectId: PROJET_ID, state: 'failed', cible: 'dev', error: 'La construction a échoué.', cardIds: [], taches: [],
    steps: [
      { key: 'merge', state: 'done', log: '' },
      { key: 'build', state: 'failed', log: 'boom', blocage: { explication: 'La construction échoue encore après trois essais.', essais: 3 } },
    ],
    startedAt: T - 60_000, endedAt: T - 30_000, depannage: { agentId: DEPANNEUR_ID, at: T - 30_000, automatique: true },
  };
  db.prepare('INSERT INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)').run(RUN_ID, PROJET_ID, 'failed', JSON.stringify(run), run.startedAt, run.endedAt);
  db.close();
}

function departEnBase() {
  const db = base();
  const ligne = db.prepare("SELECT json_extract(data, '$.scheduling.departPrevu') AS d FROM cards WHERE id = ?").get(CARTE_ID);
  db.close();
  return ligne?.d ?? null;
}

async function contexte(navigateur, { telephone, clarte }) {
  const ctx = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    ...(telephone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    serviceWorkers: 'block',
    colorScheme: clarte === 'sombre' ? 'dark' : 'light',
  });
  await ctx.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  return { ctx, page, erreurs };
}

const capturer = async (page, nom) => {
  if (!CAPTURES) return;
  await page.mouse.move(2, 2).catch(() => undefined);
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
};
const demain = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function ouvrirLaCarte(page) {
  await page.goto(`${BASE}/#projet/${PROJET_ID}/tache/${CARTE_ID}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-reglages-du-lancement]:visible').first().waitFor({ state: 'visible', timeout: 60_000 });
}

let navigateur = null;
try {
  if (!(await attendrePort())) throw new Error('le démon d’essai ne répond pas');
  poserLeDecor();
  for (let i = 0; i < 90; i += 1) {
    if (await fetch(BASE).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const piece = await envoyerUneImage('vue-citee.png');
  verifier('la capture citée est rangée en pièce jointe', !!piece?.id);
  poserLaCarte(piece?.id ?? null);
  navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  /* ===== L'adresse des images accepte le chemin d'une capture rangée ===== */
  const parChemin = await fetch(`${BASE}/api/attachment?id=${encodeURIComponent(CAPTURE_CITEE)}`, { headers: { cookie: `beluga_session=${jeton}` } });
  verifier('/api/attachment sert la pièce désignée par son chemin', parChemin.ok && (parChemin.headers.get('content-type') ?? '').startsWith('image/'), String(parChemin.status));
  const absente = await fetch(`${BASE}/api/attachment?id=${encodeURIComponent('/tmp/inexistant-verif/perdue.png')}`, { headers: { cookie: `beluga_session=${jeton}` } });
  verifier('un chemin inconnu reste introuvable', absente.status === 404, String(absente.status));

  for (const clarte of ['clair', 'sombre']) {
    poserLaPreference('theme', clarte);
    for (const telephone of [false, true]) {
      const ecran = `${telephone ? 'telephone' : 'ordinateur'}-${clarte}`;
      const { ctx, page, erreurs } = await contexte(navigateur, { telephone, clarte });

      /* ===== 4. Les images de la réponse ===== */
      await ouvrirLaCarte(page);
      const citee = page.locator(`[data-illustration-du-plan="${CAPTURE_CITEE}"] img, [data-image-en-ligne="${CAPTURE_CITEE}"] img`).first();
      const chargee = await citee
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => citee.evaluate((img) => new Promise((ok) => (img.complete ? ok(img.naturalWidth) : img.addEventListener('load', () => ok(img.naturalWidth)))) ))
        .catch(() => 0);
      verifier(`${ecran} · l’image citée par son chemin s’affiche`, chargee > 0, String(chargee));
      const indispo = await page.locator('[data-image-indisponible]').first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
      verifier(`${ecran} · l’image absente dit « Image indisponible »`, indispo);
      await page.locator('[data-image-indisponible]').first().scrollIntoViewIfNeeded().catch(() => undefined);
      await capturer(page, `${ecran}-images`);

      /* ===== 1. La ligne « Départ » et sa feuille ===== */
      await page.locator('[data-reglages-du-lancement]:visible').first().click();
      const entree = page.locator('[data-selecteur="depart"]').first();
      verifier(`${ecran} · la ligne « Départ » est dans la configuration`, await entree.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false));
      verifier(`${ecran} · « Départ » vaut « Dès le lancement »`, (await entree.getAttribute('data-valeur').catch(() => '')) === 'Dès le lancement');
      await capturer(page, `${ecran}-ligne-depart`);
      await entree.click();
      const feuille = page.locator('[data-feuille-depart]');
      verifier(`${ecran} · la feuille « Départ de la tâche » s’ouvre`, await feuille.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false));
      await page.locator(`[data-feuille-depart] [data-calendrier-jour="${demain()}"]`).click();
      await page.waitForTimeout(300);
      await capturer(page, `${ecran}-feuille-depart`);
      const libelle = await page.locator('[data-poser-depart]').innerText();
      verifier(`${ecran} · le bouton dit « Partir le … »`, /Partir le/.test(libelle), libelle);
      const deborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      verifier(`${ecran} · rien ne déborde`, deborde <= 0, String(deborde));
      await page.locator('[data-poser-depart]').click();
      await feuille.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      const date = departEnBase();
      const attendu = new Date(`${demain()}T00:00:00`).getTime();
      verifier(`${ecran} · la carte porte sa date de départ (demain, heure locale)`, !!date && date >= attendu && date < attendu + 86_400_000, date ? new Date(date).toString() : 'aucune');

      /* ===== 2. « Tâches planifiées » ===== */
      await page.goto(`${BASE}/#projet/${PROJET_ID}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      await page.goto(`${BASE}/#taches-recurrentes`, { waitUntil: 'domcontentloaded' });
      const ligne = page.locator(`[data-depart-programme="${CARTE_ID}"]`);
      verifier(`${ecran} · « Tâches planifiées » liste la carte programmée`, await ligne.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false));
      verifier(`${ecran} · la page s’appelle « Tâches planifiées »`, await page.getByText('Tâches planifiées').first().isVisible().catch(() => false) || telephone);
      await capturer(page, `${ecran}-taches-planifiees`);
      await page.locator(`[data-annuler-depart="${CARTE_ID}"]`).click();
      verifier(`${ecran} · « Annuler le départ » retire la carte et sa date`, await ligne.waitFor({ state: 'hidden', timeout: 10_000 }).then(() => departEnBase() === null, () => false));

      verifier(`${ecran} · aucune erreur de page`, erreurs.length === 0, erreurs.join(' | '));
      await ctx.close();
    }
  }

  /* ===== 3. La publication bloquée ===== */
  poserLaPublicationBloquee();
  for (const clarte of ['clair', 'sombre']) {
    poserLaPreference('theme', clarte);
    for (const telephone of [false, true]) {
      const ecran = `${telephone ? 'telephone' : 'ordinateur'}-${clarte}`;
      const { ctx, page } = await contexte(navigateur, { telephone, clarte });
      await page.goto(`${BASE}/#projet/${PROJET_ID}`, { waitUntil: 'domcontentloaded' });
      const bouton = page.locator('[data-bouton-publier]:visible').first();
      await bouton.waitFor({ state: 'visible', timeout: 60_000 });
      await bouton.click();
      const encadre = page.locator('[data-encadre-de-blocage]:visible').first();
      verifier(`${ecran} · l’encadré de blocage paraît`, await encadre.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false));
      await page.waitForTimeout(900);
      const relancer = encadre.locator('[data-relancer-la-publication]');
      const depanner = encadre.locator('[data-ouvrir-le-depannage]');
      const [a, b] = [await relancer.boundingBox(), await depanner.boundingBox()];
      verifier(`${ecran} · « Relancer » et « Ouvrir le dépannage » côte à côte, même hauteur`, !!a && !!b && Math.abs(a.height - b.height) < 1 && Math.abs(a.y - b.y) < 1, a && b ? `${a.height}/${b.height}` : 'absents');
      await capturer(page, `${ecran}-publication-bloquee`);
      await ctx.close();
    }
  }
  /* Le clic : le dépanneur « au travail » est arrêté, puis la reprise passe par les gardes (ici : sans procédure). */
  {
    const { ctx, page } = await contexte(navigateur, { telephone: false, clarte: 'clair' });
    await page.goto(`${BASE}/#projet/${PROJET_ID}`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-bouton-publier]:visible').first().click();
    await page.locator('[data-relancer-la-publication]:visible').first().click();
    await page.waitForTimeout(4000);
    const db = base();
    const statut = db.prepare('SELECT status FROM agents WHERE id = ?').get(DEPANNEUR_ID)?.status;
    db.close();
    verifier('« Relancer » arrête le dépanneur au travail', statut !== 'running', String(statut));
    await ctx.close();
  }

  /* ===== 5. La roue du projet qui se charge (téléphone) ===== */
  for (const clarte of ['clair', 'sombre']) {
    poserLaPreference('theme', clarte);
    const { ctx, page } = await contexte(navigateur, { telephone: true, clarte });
    await page.goto(`${BASE}/#projet/${PROJET_ID}`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-menu-principal]:visible').first().waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(1500);
    /* L'arrivée des cartes du second projet est retardée de 2,5 s sur le canal. */
    await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
      const serveur = ws.connectToServer();
      serveur.onMessage((m) => {
        const texte = String(m);
        if (texte.includes('"project.etat"') && texte.includes(PROJET_2)) setTimeout(() => ws.send(texte), 2500);
        else ws.send(texte);
      });
      ws.onMessage((m) => serveur.send(m));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-menu-principal]:visible').first().waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(2000);
    await page.locator('[data-menu-principal]:visible').first().tap();
    const ligne = page.locator(`[data-projet-cible="${PROJET_2}"] a:visible`).first();
    await ligne.waitFor({ state: 'visible', timeout: 15_000 });
    await ligne.tap();
    const roue = page.locator(`[data-projet-en-chargement="${PROJET_2}"]`);
    const vue = await roue.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false);
    verifier(`téléphone-${clarte} · une roue tourne sur la ligne du projet choisi`, vue);
    await capturer(page, `telephone-${clarte}-roue-projet`);
    verifier(`téléphone-${clarte} · la roue s’efface une fois le projet chargé`, await roue.waitFor({ state: 'hidden', timeout: 12_000 }).then(() => true, () => false));
    await ctx.close();
  }
} catch (err) {
  verifier('déroulé complet', false, String(err?.stack ?? err));
} finally {
  await navigateur?.close().catch(() => undefined);
  couperVite();
  nettoyer();
}

const echecs = resultats.filter((r) => !r).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles réussis`);
process.exit(echecs ? 1 : 0);
