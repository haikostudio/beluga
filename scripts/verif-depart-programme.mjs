#!/usr/bin/env node
/**
 * Une carte peut porter une DATE de départ : elle attend dans « Planifié » et
 * part à l'heure dite, sans clic.
 *
 *   node scripts/verif-depart-programme.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et un
 * dossier de projets vide : le démon de production n'est pas touché.
 *
 * Le plafond d'agents est mis à ZÉRO : aucun quota n'est dépensé, et c'est
 * justement ce refus-là qui PROUVE le départ. Une carte que l'ordonnanceur tente
 * de lancer se voit écrire sa raison d'attente par les portes dures ; une carte
 * qu'il n'a même pas regardée n'en porte aucune. La raison écrite est donc la
 * trace du départ, sans qu'un seul tour de moteur ait été payé.
 *
 * Quatre cartes, quatre cas :
 *   - heure PASSÉE           → tentée (raison écrite) ;
 *   - heure À VENIR          → intouchée, et la carte DIT quand elle partira ;
 *   - heure passée, SUSPENDUE → intouchée : la main l'emporte sur la date ;
 *   - SANS date              → intouchée : rien ne change pour elle.
 *
 * Puis l'interface : la mention sur la carte du tableau, et le champ de l'onglet
 * « Détails » qui pose vraiment la date en base.
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
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7196);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-depart-'));

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
/* Le décor : quatre cartes « Planifié », une session                   */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const PROJET_NOM = 'Essai départ';
const HEURE = 60 * 60 * 1000;

const PASSEE = 'Carte d’essai — heure passée';
const FUTURE = 'Carte d’essai — heure à venir';
const SUSPENDUE = 'Carte d’essai — heure passée mais suspendue';
const SANS_DATE = 'Carte d’essai — sans date';
const TITRES = [PASSEE, FUTURE, SUSPENDUE, SANS_DATE];

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification départ programmé',
  );

  /* Plafond d'agents à ZÉRO : aucun tour réel, et le refus attendu au lancement. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

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

  const ordonnancements = {
    [PASSEE]: { asap: false, attempts: 0, restarts: 0, departPrevu: maintenant - 5 * 60 * 1000 },
    [FUTURE]: { asap: false, attempts: 0, restarts: 0, departPrevu: maintenant + 3 * HEURE },
    [SUSPENDUE]: {
      asap: false,
      attempts: 0,
      restarts: 0,
      departPrevu: maintenant - 5 * 60 * 1000,
      suspendu: true,
    },
    [SANS_DATE]: { asap: false, attempts: 0, restarts: 0 },
  };

  TITRES.forEach((titre, index) => {
    const carte = {
      id: `c-essai-${index}`,
      projectId: PROJET_ID,
      title: titre,
      description: 'Carte fabriquée par le script de vérification.',
      labels: [],
      column: 'planned',
      position: index + 1,
      origin: 'user',
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      scheduling: ordonnancements[titre],
      excludedFromDeploy: false,
      horsTache: false,
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(carte.id, PROJET_ID, 'planned', carte.position, titre, JSON.stringify(carte), maintenant, maintenant);
  });
  db.close();
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

/** Combien d'agents de carte ont été créés ? Doit rester à zéro. */
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

/** Ouvre le tiroir d'une carte, sur son onglet « Détails ». */
async function ouvrirDetails(page, titre) {
  const panneauOuvert = page.locator('[role="dialog"]').last();
  if (await panneauOuvert.count()) {
    await panneauOuvert.locator('button').first().click({ force: true });
    await panneauOuvert.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
  const extrait = titre.slice(0, 30);
  const carteVue = page.locator('article').filter({ hasText: extrait }).first();
  await carteVue.scrollIntoViewIfNeeded().catch(() => {});
  await carteVue.waitFor({ state: 'visible', timeout: 15000 });
  await carteVue.click();
  await page.waitForTimeout(1800);
  const tiroir = page.locator('[role="dialog"]').last();
  await tiroir.getByRole('tab', { name: 'Détails' }).click();
  await page.waitForTimeout(900);
  return tiroir;
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  /* La boucle de l'ordonnanceur passe toutes les quinze secondes : on lui laisse
     deux passages, pour que le constat ne dépende pas d'une seconde près. */
  console.log('… on laisse l’ordonnanceur passer (35 s)');
  await new Promise((r) => setTimeout(r, 35000));

  const apres = ordonnancementsEnBase();
  const raison = (titre) => apres[titre]?.waitingReason ?? '';

  noter(
    'heure PASSÉE : la carte a été tentée, sa raison est écrite',
    raison(PASSEE).length > 10,
    raison(PASSEE) || 'aucune raison : la carte n’a pas été regardée',
  );
  noter(
    'heure À VENIR : la carte n’a pas bougé, rien ne lui a été tenté',
    !raison(FUTURE),
    raison(FUTURE) || 'aucune raison, c’est ce qu’on veut',
  );
  noter(
    'heure passée mais SUSPENDUE : la main l’emporte, rien n’est tenté',
    !raison(SUSPENDUE),
    raison(SUSPENDUE) || 'aucune raison, c’est ce qu’on veut',
  );
  noter(
    'SANS date : rien ne change, la carte attend le geste',
    !raison(SANS_DATE),
    raison(SANS_DATE) || 'aucune raison, c’est ce qu’on veut',
  );
  noter(
    'la date à venir est intacte en base',
    typeof apres[FUTURE]?.departPrevu === 'number',
    String(apres[FUTURE]?.departPrevu),
  );
  noter('aucun agent créé : aucun quota dépensé', agentsDeCarte() === 0, `${agentsDeCarte()} agent(s)`);

  /* -------- L'interface -------- */

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const { page, erreurs } = await ouvrirLeTableau(navigateur);

  /* La mention sur la carte du tableau : elle dit QUAND la carte partira. */
  const mention = await page
    .locator('[data-depart-programme]')
    .allTextContents()
    .catch(() => []);
  noter(
    'la carte du tableau annonce son départ programmé',
    mention.some((t) => /Départ programmé/.test(t)),
    mention.join(' | ') || 'aucune mention affichée',
  );
  noter(
    'la mention dit que la carte partira TOUTE SEULE',
    mention.some((t) => /toute seule/.test(t)),
    mention.join(' | '),
  );
  /* Deux cartes seulement parlent : celle qui attend son heure, et celle dont
     l'heure est atteinte. La suspendue se tait (la suspension dit mieux ce qui
     bloque) et celle sans date n'a rien à dire. */
  noter(
    'seules les cartes DATÉES et non suspendues affichent une mention',
    mention.length === 2 && mention.some((t) => /Heure de départ atteinte/.test(t)),
    `${mention.length} mention(s) pour 4 cartes`,
  );

  /* Le champ de l'onglet « Détails » : il pose vraiment la date en base. */
  const tiroir = await ouvrirDetails(page, SANS_DATE);
  const champ = tiroir.locator('input[type="datetime-local"]');
  noter('le détail d’une carte planifiée porte un champ de date', (await champ.count()) === 1);

  const souhait = new Date(Date.now() + 26 * HEURE);
  const deux = (n) => String(n).padStart(2, '0');
  const valeur = `${souhait.getFullYear()}-${deux(souhait.getMonth() + 1)}-${deux(souhait.getDate())}T${deux(
    souhait.getHours(),
  )}:${deux(souhait.getMinutes())}`;
  await champ.first().fill(valeur);
  await page.waitForTimeout(2500);

  const pose = ordonnancementsEnBase()[SANS_DATE]?.departPrevu;
  noter(
    'la date saisie à la main est enregistrée sur la carte',
    typeof pose === 'number' && Math.abs(pose - souhait.getTime()) < 60_000,
    `posé : ${pose ? new Date(pose).toLocaleString('fr-CH') : 'rien'}`,
  );
  noter(
    'le détail dit alors quand la carte partira',
    /Départ programmé/.test(await tiroir.innerText()),
    'phrase absente du tiroir',
  );

  /* Retirer la date rend la carte à son geste de lancement. */
  await tiroir.getByRole('button', { name: /Retirer la date/ }).click();
  await page.waitForTimeout(2000);
  const apresRetrait = ordonnancementsEnBase()[SANS_DATE];
  noter(
    'la date se retire, et la carte redit qu’elle attend le lancement',
    !apresRetrait?.departPrevu && /attend votre lancement/.test(apresRetrait?.waitingReason ?? ''),
    JSON.stringify(apresRetrait),
  );

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await page.screenshot({ path: path.join(TMP, 'depart-programme.png') });

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
