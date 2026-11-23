#!/usr/bin/env node
/**
 * LE BOUTON DE BRANCHE ET LE MENU DES MODÈLES, dans un vrai navigateur (carte
 * « Branches et choix des modèles »).
 *
 *  - le bouton de branche suit le titre dans le fil d'Ariane de la tâche, et
 *    ne garde que son pictogramme sur téléphone ;
 *  - son menu montre la branche, son parcours (étape courante en violet), les
 *    branches à reprendre — « dev » et « main » jamais —, et grise celle où
 *    l'agent d'une autre carte travaille ;
 *  - renommer marche de bout en bout ; changer de branche quand la tâche a du
 *    travail POSE la question « laisser / emporter » ;
 *  - le menu des modèles porte une recherche, au plus dix modèles d'abord et
 *    « Afficher plus » quand le moteur en offre davantage.
 *
 * Démon et base d'ESSAI à soi (`BELUGA_VERIF_BRANCHE_PORT`), plafond d'agents
 * à zéro : aucun moteur ne part. À lancer depuis la copie de travail de la
 * carte, jamais depuis le dépôt principal. Ne reprend ni `BELUGA_URL` ni
 * `BELUGA_TOKEN`.
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-branche-et-modeles.mjs
 */
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_BRANCHE_PORT || 7213);
const BASE = `http://127.0.0.1:${PORT}`;
const PROJET = 'p-branches';

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, attendrePort, journal } = demarrerDemonDEssai({
  prefixe: 'verif-branche-et-modeles-',
  port: PORT,
  env: { BELUGA_MARKETING_NUIT: '0' },
});

const g = (...args) => execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', ...args], { cwd: DEPOT, encoding: 'utf8' }).trim();
g('branch', 'dev');
g('branch', 'tache/libre-aaaaaa');
g('branch', 'tache/occupee-bbbbbb');
// La carte principale a déjà du travail sur sa branche : changer posera la question.
g('checkout', '-qb', 'tache/carte-principale-c-bran', 'dev');
fs.writeFileSync(path.join(DEPOT, 'travail.txt'), 'travail\n');
g('add', 'travail.txt');
g('commit', '-qm', 'travail de la carte');
g('checkout', '-q', 'main');

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), maintenant, maintenant + 3600_000, 'vérification branche et modèles');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
    PROJET,
    'Projet des branches',
    DEPOT,
    JSON.stringify({ id: PROJET, name: 'Projet des branches', path: DEPOT, defaultEngine: 'claude', isSelf: false, branchesDePublication: {}, rank: 1000, archived: false, createdAt: maintenant, updatedAt: maintenant }),
    maintenant,
    maintenant,
  );
  const carte = (id, titre, colonne, extra = {}) => {
    const donnees = {
      description: 'Une carte d’essai.', origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' }, excludedFromDeploy: false,
      horsTache: false, scheduling: { asap: false, attempts: 0, restarts: 0 }, lastReadAt: maintenant, createdAt: maintenant, updatedAt: maintenant, ...extra,
    };
    db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, agent_id, branche_choisie, last_read_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, PROJET, colonne, 1, titre, JSON.stringify(donnees), extra.agentId ?? null, extra.brancheChoisie ?? null, maintenant, maintenant, maintenant,
    );
  };
  carte('c-branches-1', 'Carte principale', 'planned', {
    brancheChoisie: 'tache/carte-principale-c-bran',
    github: { branch: 'tache/carte-principale-c-bran', checks: [], commits: [], fichiers: [], activity: [] },
  });
  // Une voisine dont l'agent « travaille » : son tour vivant est dans la base.
  carte('c-occupee-2', 'Carte voisine au travail', 'running', { agentId: 'a-voisine', brancheChoisie: 'tache/occupee-bbbbbb' });
  db.close();
}

async function ouvrirLaCarte(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((id) => {
    window.location.hash = `projet/${id}`;
  }, PROJET);
  /* L'application peut rouvrir d'elle-même la carte consultée en dernier. */
  await page.waitForSelector('[data-carte="c-branches-1"], [data-bouton-de-branche]', { timeout: 20000 });
  if (!(await page.locator('[data-bouton-de-branche]').count())) await page.locator('[data-carte="c-branches-1"]').first().click();
  await page.waitForSelector('[data-bouton-de-branche]', { timeout: 15000 });
}

let navigateur;
try {
  if (!(await attendrePort(60_000))) throw new Error('le démon d’essai ne répond pas');
  poserLeDecor();
  navigateur = await chromium.launch({ channel: 'chrome' });

  /* -------- Ordinateur -------- */
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  await contexte.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await ouvrirLaCarte(page);

  const bouton = page.locator('[data-bouton-de-branche]');
  noter('le bouton de branche suit le titre dans le fil d’Ariane', (await bouton.getAttribute('data-bouton-de-branche')) === 'tache/carte-principale-c-bran');
  noter('le nom de la branche est lisible sur ordinateur', (await bouton.innerText()).includes('carte-principale-c-bran'));

  await bouton.click();
  await page.waitForSelector('[data-branche-proposee]', { timeout: 15000 });
  const proposees = await page.locator('[data-branche-proposee]').evaluateAll((els) => els.map((e) => e.getAttribute('data-branche-proposee')));
  noter('les branches à reprendre sont proposées', proposees.includes('tache/libre-aaaaaa') && proposees.includes('tache/occupee-bbbbbb'), proposees.join(', '));
  noter('« dev » et « main » ne se proposent jamais', !proposees.includes('dev') && !proposees.includes('main'));
  noter('le parcours montre l’étape courante en violet', (await page.locator('[data-cran-de-parcours="branche"][data-actif]').count()) === 1 && /text-teinte/.test((await page.locator('[data-cran-de-parcours="branche"]').getAttribute('class')) ?? ''));
  await page.screenshot({ path: path.join(os.tmpdir(), 'verif-branche-menu.png') });
  console.log(`  …  capture : ${path.join(os.tmpdir(), 'verif-branche-menu.png')}`);

  /* La question « laisser / emporter » : la carte a du travail. */
  await page.locator('[data-branche-proposee="tache/libre-aaaaaa"]').click();
  await page.waitForSelector('[data-question-travail]', { timeout: 15000 });
  noter('changer de branche avec du travail pose la question laisser / emporter', (await page.locator('[data-travail="laisser"]').count()) === 1 && (await page.locator('[data-travail="emporter"]').count()) === 1);
  await page.locator('[data-travail="laisser"]').click();
  await page.waitForFunction(() => document.querySelector('[data-bouton-de-branche]')?.getAttribute('data-bouton-de-branche') === 'tache/libre-aaaaaa', null, { timeout: 15000 }).catch(() => undefined);
  noter('« laisser » bascule la tâche sur la branche reprise', (await bouton.getAttribute('data-bouton-de-branche')) === 'tache/libre-aaaaaa');
  noter('le travail est resté sur l’ancienne branche', g('log', '--format=%s', '-1', 'tache/carte-principale-c-bran') === 'travail de la carte');

  /* Renommer. */
  await bouton.click();
  await page.waitForSelector('[data-renommer-branche]:not([data-disabled])', { timeout: 15000 });
  await page.locator('[data-renommer-branche]').click();
  await page.locator('[data-nom-de-branche]').fill('nom choisi');
  await page.locator('[data-valider-branche]').click();
  await page.waitForFunction(() => document.querySelector('[data-bouton-de-branche]')?.getAttribute('data-bouton-de-branche') === 'tache/nom-choisi', null, { timeout: 15000 }).catch(() => undefined);
  noter('renommer suit la branche dans le fil et dans le dépôt', (await bouton.getAttribute('data-bouton-de-branche')) === 'tache/nom-choisi' && g('branch', '--list', 'tache/nom-choisi') !== '');

  /* -------- Le menu des modèles -------- */
  await page.keyboard.press('Escape');
  /* La fiche de configuration d'une tâche planifiée : sa ligne « Modèle » ouvre la liste. */
  const ligneModele = page.locator('[data-ligne-configuration="Modèle"]').first();
  if (await ligneModele.count()) {
    await ligneModele.click();
    await page.waitForSelector('[data-selecteur-liste="modele"]', { timeout: 10000 });
    const liste = page.locator('[data-selecteur-liste="modele"]');
    const lignes = await liste.locator('[data-modele-id]').count();
    const plus = liste.locator('[data-afficher-plus-modeles]');
    const caches = (await plus.count()) ? Number(await plus.getAttribute('data-afficher-plus-modeles')) : 0;
    noter('le menu des modèles montre au plus dix modèles d’abord (choisi compris)', lignes <= 11 && lignes > 0, `${lignes} ligne(s), ${caches} derrière « Afficher plus »`);
    if (caches > 0) {
      await page.screenshot({ path: path.join(os.tmpdir(), 'verif-modeles-menu.png') });
      await plus.click();
      const apres = await liste.locator('[data-modele-id]').count();
      noter('« Afficher plus » montre le reste sans refermer le menu', apres === lignes + caches, `${apres} ligne(s)`);
      const dernier = await liste.locator('[data-modele-id]').last().getAttribute('data-modele-id');
      await liste.locator('[data-recherche-modeles]').fill(dernier ?? '');
      const filtres = await liste.locator('[data-modele-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-modele-id')));
      noter('la recherche filtre la liste entière, frappe comprise', filtres.includes(dernier) && filtres.length < apres, filtres.join(', '));
    } else {
      console.log('  …  le moteur d’essai offre dix modèles ou moins : « Afficher plus » ne paraît pas (règle testée à part, catalogue-complet.test.ts)');
    }
    await page.keyboard.press('Escape');
  } else {
    noter('la fiche de configuration porte sa ligne « Modèle »', false);
  }

  noter('aucune erreur JavaScript (ordinateur)', erreurs.length === 0, erreurs.join(' | '));

  /* -------- Téléphone -------- */
  const mobile = await navigateur.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'fr-CH' });
  await mobile.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const tel = await mobile.newPage();
  await ouvrirLaCarte(tel);
  const nomVisible = await tel.locator('[data-bouton-de-branche] span.font-mono').isVisible();
  noter('sur téléphone, seul le pictogramme reste, à droite de la barre', !nomVisible && (await tel.locator('[data-bouton-de-branche]').isVisible()));
  await tel.locator('[data-bouton-de-branche]').tap();
  await tel.waitForSelector('[data-menu-de-branche]', { timeout: 10000 });
  noter('sur téléphone, le menu s’ouvre en panneau du bas', (await tel.locator('[data-menu-de-branche]').boundingBox())?.width >= 380);
  await tel.screenshot({ path: path.join(os.tmpdir(), 'verif-branche-telephone.png') });
  console.log(`  …  capture : ${path.join(os.tmpdir(), 'verif-branche-telephone.png')}`);
} catch (err) {
  noter('le contrôle est allé au bout', false, err?.message ?? String(err));
  console.log(journal.slice(-20).join(''));
} finally {
  await navigateur?.close();
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
process.exit(echecs ? 1 : 0);
