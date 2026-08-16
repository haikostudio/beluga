#!/usr/bin/env node
/**
 * Le CRÉNEAU CONSEILLÉ : chaque carte posée dit QUAND il serait opportun de la
 * lancer, et personne n'a payé un jeton pour cela.
 *
 *   node scripts/verif-creneau-conseille.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et un
 * dossier de projets vide : le démon de production n'est pas touché. Le plafond
 * d'agents est mis à ZÉRO — AUCUN moteur n'est appelé, et c'est le cœur du
 * contrôle : le conseil doit naître du seul calcul du démon.
 *
 * Ce qui est prouvé, bout en bout :
 *   1. une carte créée par la porte extérieure (donc par le chemin `createCard`,
 *      celui du chef d'orchestre) NAÎT avec son créneau en base ;
 *   2. le créneau gardé ne porte NI date NI phrase — seulement une plage, sa
 *      source et, le cas échéant, la reprise du quota : c'est ce qui le rend
 *      encore vrai trois jours plus tard ;
 *   3. une carte créée AVEC une date de départ n'en reçoit pas : elle a déjà
 *      une réponse ferme ;
 *   4. la carte du tableau AFFICHE le conseil, et le tiroir propose le bouton
 *      qui pose vraiment la date en base ;
 *   5. aucun agent n'a été créé : rien n'a été dépensé.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* La racine se déduit du script LUI-MÊME : lancé depuis une copie de travail
   (`.worktrees/…`), il doit juger le code de CETTE copie, jamais celui du
   dossier principal — sinon il déclare bon un changement jamais exécuté. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKODEV_CRENEAU_PORT || 7198);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-creneau-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
for (const dossier of [DATA, PROJETS, DEPOT]) fs.mkdirSync(dossier, { recursive: true });

execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'créneau'], {
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
const journal = [];
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));

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
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Le décor : un projet, une session, une clé d'API                     */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
/* Le préfixe et la longueur sont ceux de `shared/src/cles-api.ts` : une clé mal
   formée serait refusée AVANT même d'être cherchée en base. */
const cleApi = `hkd_${crypto.randomBytes(32).toString('hex')}`;
const PROJET_ID = 'p-essai';
const PROJET_NOM = 'Essai créneau';
const HEURE = 60 * 60 * 1000;

const SANS_DATE = 'Carte d’essai — sans date de départ';
const AVEC_DATE = 'Carte d’essai — déjà datée';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification créneau conseillé',
  );

  /* Plafond d'agents à ZÉRO : aucun tour réel, aucun quota dépensé. Les heures
     creuses sont posées en clair pour que le conseil attendu soit connu à
     l'avance : sans historique de quota, aucun creux n'est mesurable et c'est
     la plage RÉGLÉE qui doit sortir. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0, offPeakStart: 22, offPeakEnd: 7 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: PROJET_NOM,
    path: DEPOT,
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

  /* La porte extérieure passe par le MÊME `createCard` que le chef d'orchestre :
     c'est donc bien ce chemin-là qu'on éprouve, sans lancer un seul agent. */
  db.prepare(
    'INSERT INTO api_keys (id, nom, empreinte, apercu, creee_le) VALUES (?, ?, ?, ?, ?)',
  ).run('k-essai', 'vérification créneau', sha(cleApi), cleApi.slice(0, 10), maintenant);

  /*
   * Une carte DÉJÀ DATÉE, posée à la main en base : elle n'a pas de créneau, et
   * l'écran ne doit rien lui conseiller — sa date est une réponse ferme, un
   * conseil ne ferait que la contredire.
   */
  const datee = {
    id: 'c-essai-datee',
    projectId: PROJET_ID,
    title: AVEC_DATE,
    description: 'Carte du contrôle, avec son heure.',
    labels: [],
    column: 'planned',
    position: 2,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    scheduling: { asap: false, attempts: 0, restarts: 0, departPrevu: maintenant + 5 * HEURE },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(datee.id, PROJET_ID, 'planned', 2, AVEC_DATE, JSON.stringify(datee), maintenant, maintenant);
  db.close();
}

async function poserUneCarte(titre, extra = {}) {
  const reponse = await fetch(`${BASE}/api/externe/carte`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-haikodev-cle': cleApi },
    body: JSON.stringify({ projet: PROJET_NOM, titre, description: 'Carte du contrôle.', ...extra }),
  });
  return { statut: reponse.status, corps: await reponse.json().catch(() => null) };
}

/** L'état d'ordonnancement de chaque carte, lu en base : titre → scheduling. */
function ordonnancementsEnBase() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const lignes = db.prepare('SELECT title, data FROM cards').all();
  db.close();
  return Object.fromEntries(
    lignes.map((l) => {
      let scheduling = {};
      try {
        scheduling = JSON.parse(l.data)?.scheduling ?? {};
      } catch {
        /* carte illisible */
      }
      return [l.title, scheduling];
    }),
  );
}

/**
 * Combien d'agents de CARTE ont été créés ? Doit rester à zéro : c'est la
 * preuve qu'aucun tour de moteur n'a été payé pour porter le conseil. Le chef
 * d'orchestre du projet, lui, est créé d'office à l'inscription et ne dépense
 * rien tant qu'on ne lui parle pas — il n'entre donc pas dans le compte.
 */
function agentsDeCarte() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const n = db.prepare('SELECT COUNT(*) AS n FROM agents WHERE card_id IS NOT NULL').get()?.n ?? 0;
  db.close();
  return n;
}

/* ------------------------------------------------------------------ */
/* Le navigateur                                                       */
/* ------------------------------------------------------------------ */

async function ouvrirLeTableau(navigateur) {
  const contexte = await navigateur.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([
    { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  const onglet = page.getByRole('button', { name: /^Tableau$/ });
  if (await onglet.count()) {
    await onglet.first().click();
    await page.waitForTimeout(2000);
  }
  await page.locator('[data-column="planned"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  return { page, erreurs };
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  await new Promise((r) => setTimeout(r, 1500));

  /* ---------------- 1. La carte naît avec son créneau ---------------- */

  const sansDate = await poserUneCarte(SANS_DATE);
  noter(
    'la porte extérieure accepte la carte',
    sansDate.statut === 201,
    `HTTP ${sansDate.statut} ${JSON.stringify(sansDate.corps)}`,
  );
  await new Promise((r) => setTimeout(r, 1000));

  const enBase = ordonnancementsEnBase();
  const creneau = enBase[SANS_DATE]?.creneauConseille;

  noter(
    'une carte posée NAÎT avec son créneau conseillé',
    !!creneau,
    creneau ? JSON.stringify(creneau) : 'aucun créneau en base',
  );
  noter(
    'sans historique de quota, c’est la plage RÉGLÉE qui sort (22 h → 7 h)',
    creneau?.source === 'heures-creuses' && creneau?.heureDebut === 22 && creneau?.heureFin === 7,
    JSON.stringify(creneau ?? null),
  );
  noter(
    'le créneau gardé ne porte NI date NI phrase : il reste vrai demain',
    !!creneau &&
      Object.keys(creneau).every((clef) =>
        ['source', 'heureDebut', 'heureFin', 'lourde', 'pasAvant'].includes(clef),
      ),
    Object.keys(creneau ?? {}).join(', ') || '(vide)',
  );

  /* ---------------- 2. Ce que l'écran en montre ---------------- */

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  const { page, erreurs } = await ouvrirLeTableau(navigateur);

  const mention = page.locator('[data-creneau-conseille]');
  const nombre = await mention.count();
  const texte = nombre ? await mention.first().innerText() : '';
  noter(
    'la carte du tableau affiche le conseil',
    nombre > 0 && /Lancement conseillé|Bon moment pour la lancer/.test(texte),
    texte.replace(/\n/g, ' ') || 'aucune mention à l’écran',
  );
  noter(
    'une carte DÉJÀ datée n’en porte pas : une seule mention pour deux cartes',
    nombre === 1,
    `${nombre} mention(s)`,
  );

  /* Le tiroir : la même phrase, plus le bouton qui pose vraiment la date. */
  const carteVue = page.locator('article').filter({ hasText: SANS_DATE.slice(0, 30) }).first();
  await carteVue.scrollIntoViewIfNeeded().catch(() => {});
  await carteVue.click();
  await page.waitForTimeout(1800);
  const tiroir = page.locator('[role="dialog"]').last();
  await tiroir.getByRole('tab', { name: 'Détails' }).click();
  await page.waitForTimeout(900);

  const bloc = tiroir.locator('[data-creneau-conseille]').first();
  noter('le tiroir porte le conseil', (await bloc.count()) > 0);

  const bouton = tiroir.getByRole('button', { name: /Retenir cette heure/ });
  noter('il propose de retenir cette heure', (await bouton.count()) > 0);

  await bouton.first().click();
  await page.waitForTimeout(2500);

  const apres = ordonnancementsEnBase()[SANS_DATE];
  const pose = apres?.departPrevu;
  const heurePosee = pose ? new Date(pose).getHours() : null;
  noter(
    'le clic pose vraiment la date, à l’heure ronde du créneau',
    typeof pose === 'number' && heurePosee === 22 && new Date(pose).getMinutes() === 0,
    pose ? new Date(pose).toLocaleString('fr-CH') : 'aucune date posée',
  );
  noter(
    'la date posée fait taire le conseil : une seule réponse à l’écran',
    (await page.locator('[data-creneau-conseille]').count()) === 0,
    `${await page.locator('[data-creneau-conseille]').count()} mention(s) restante(s)`,
  );

  /* ---------------- 3. Rien n'a été dépensé ---------------- */

  noter(
    'aucun agent de carte créé : pas un jeton dépensé',
    agentsDeCarte() === 0,
    `${agentsDeCarte()} agent(s)`,
  );
  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await page.screenshot({ path: path.join(TMP, 'creneau-conseille.png') });

  await navigateur.close();
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) console.log(`(journal dans ${TMP})`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.slice(-20).join(''));
  process.exit(1);
});
