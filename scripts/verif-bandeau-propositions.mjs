#!/usr/bin/env node
/**
 * Les cartes proposées tiennent-elles dans un BANDEAU FIXE, au-dessus de la
 * barre d'écriture ?
 *
 * Une proposition rendue dans le fil remonte avec les messages : ses boutons
 * « Créer la carte » / « Refuser » sortent de l'écran dès qu'un échange arrive.
 * On vérifie ici qu'une proposition ENCORE EN ATTENTE sort du fil et se pose
 * dans un bandeau fixe : toujours visible quel que soit le défilement, rangée
 * en ligne avec les autres, glissant horizontalement et JAMAIS verticalement.
 * Une proposition décidée, elle, reste dans le fil et ne paraît plus dans le
 * bandeau ; sans aucune en attente, le bandeau ne prend aucune place.
 *
 *   node scripts/verif-bandeau-propositions.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve :
 * le démon de production n'est pas touché, et aucun moteur n'est appelé.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script : lancé depuis une copie de travail
   (« .worktrees/… »), il doit juger CE code-là. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_BANDEAU_PORT || 7198);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-bandeau-'));
const SHOTS = path.join(RACINE, 'data', 'verification');

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
/* Le décor : un chef, un long échange, DEUX propositions en attente   */
/* et une déjà refusée.                                                */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-bandeau';
const AGENT_ID = 'a-chef-bandeau';
const TITRE_A = 'Première carte proposée — en attente';
const TITRE_B = 'Deuxième carte proposée — en attente';
const TITRE_REFUSEE = 'Carte déjà refusée';

/** Une description de carte en règle : quatre parties, largement repliable. */
const DESCRIPTION = [
  '**Constat** : la proposition vivait dans le fil et remontait avec les messages.',
  '**Attendu** : elle se pose dans un bandeau fixe au-dessus de la barre d’écriture.',
  '**Limites** : rien n’est validé ni refusé automatiquement, le clic reste seul maître.',
  '**Vérification** : ouvrir la conversation, faire défiler, les boutons restent visibles.',
].join('\n\n');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const t = Date.now() - 60_000;

  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3600_000,
    'vérification bandeau des propositions',
  );

  // Aucun agent ne doit démarrer : une carte créée reste sagement en « À faire ».
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  for (const table of ['proposals', 'messages', 'agents', 'cards', 'projects']) {
    db.prepare(`DELETE FROM ${table}`).run();
  }

  const projet = {
    id: PROJET_ID,
    name: 'Essai bandeau',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
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
    title: 'Chef d’orchestre — Essai bandeau',
    run: { engine: 'claude', model: 'claude-opus-5', thinking: 'medium', mode: 'direct' },
    status: 'done',
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, 'orchestrator', 'done', ?, ?, ?)`,
  ).run(AGENT_ID, PROJET_ID, JSON.stringify(agent), t, t);

  const message = (id, role, data, quand) => {
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      AGENT_ID,
      role,
      JSON.stringify({ id, agentId: AGENT_ID, role, createdAt: quand, ...data }),
      quand,
    );
  };

  const proposition = (id, title, decision) => ({
    id,
    title,
    description: DESCRIPTION,
    labels: ['interface'],
    decision,
    decidedAt: decision === 'pending' ? undefined : t + 2000,
  });

  const propositions = [
    proposition('prop-a', TITRE_A, 'pending'),
    proposition('prop-b', TITRE_B, 'pending'),
    proposition('prop-refusee', TITRE_REFUSEE, 'refused'),
  ];

  /* Un fil LONG : c'est tout l'enjeu — la proposition ne doit pas remonter
     hors de l'écran quand les messages s'accumulent. */
  for (let i = 0; i < 30; i += 1) {
    message(
      `m-${i}`,
      i % 2 ? 'assistant' : 'user',
      { content: `Échange n° ${i + 1} — de quoi remplir le fil bien au-delà d’un écran.` },
      t + i * 1000,
    );
  }

  message(
    'm-propositions',
    'assistant',
    { content: 'Je propose deux cartes ; une troisième a déjà été refusée.', steps: [], proposals: propositions },
    t + 40_000,
  );

  for (const p of propositions) {
    db.prepare(
      'INSERT INTO proposals (id, message_id, project_id, decision, data, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(p.id, 'm-propositions', PROJET_ID, p.decision, JSON.stringify(p), t + 40_000, p.decidedAt ?? null);
  }
  db.close();
}

/* ------------------------------------------------------------------ */
/* Les mesures                                                         */
/* ------------------------------------------------------------------ */

/** Le bandeau est-il bien posé entre le fil et la barre d'écriture ? */
async function place(page) {
  return page.evaluate(() => {
    const bandeau = document.querySelector('[data-bandeau="propositions"]');
    if (!bandeau) return { present: false };
    const fil = document.querySelector('[data-fil="conversation"]');
    const zone = bandeau.querySelector('[data-bandeau-zone], .overflow-x-auto');
    const style = zone ? getComputedStyle(zone) : null;
    const b = bandeau.getBoundingClientRect();
    const f = fil?.getBoundingClientRect();
    return {
      present: true,
      vignettes: bandeau.querySelectorAll('[data-vignette="proposition"]').length,
      sousLeFil: f ? b.top >= f.bottom - 2 : false,
      dansLEcran: b.top >= 0 && b.bottom <= window.innerHeight + 1,
      axeX: style?.overflowX ?? '',
      axeY: style?.overflowY ?? '',
      titres: [...bandeau.querySelectorAll('[data-vignette="proposition"]')].map((n) =>
        (n.textContent || '').trim().slice(0, 60),
      ),
    };
  });
}

/** Le fil montre-t-il encore une proposition donnée ? */
async function dansLeFil(page, titre) {
  return page.evaluate((cherche) => {
    const fil = document.querySelector('[data-fil="conversation"]');
    return (fil?.textContent || '').includes(cherche);
  }, titre);
}

async function ouvrir(navigateur, telephone) {
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1400, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
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
  const chef = page.getByRole('button', { name: /^Chef/ });
  if (await chef.count()) {
    await chef.first().click();
    await page.waitForTimeout(2500);
  }
  return { contexte, page, erreurs };
}

/* ------------------------------------------------------------------ */

fs.mkdirSync(SHOTS, { recursive: true });

if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}
poserLeDecor();

const navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
});

try {
  for (const telephone of [true, false]) {
    const ecran = telephone ? 'téléphone 390×844' : 'ordinateur 1400×900';
    poserLeDecor();
    const { contexte, page, erreurs } = await ouvrir(navigateur, telephone);
    try {
      const vue = await place(page);
      noter(`${ecran} : le bandeau est là`, vue.present);
      if (!vue.present) continue;

      noter(`${ecran} : les deux propositions en attente y sont`, vue.vignettes === 2, `${vue.vignettes} vignette(s)`);
      noter(`${ecran} : le bandeau est sous le fil, dans l’écran`, vue.sousLeFil && vue.dansLEcran);
      noter(
        `${ecran} : il glisse en largeur, jamais en hauteur`,
        vue.axeX === 'auto' && vue.axeY === 'hidden',
        `x=${vue.axeX} y=${vue.axeY}`,
      );

      // Le fil garde la refusée, et NON les propositions en attente.
      noter(`${ecran} : la carte refusée reste dans le fil`, await dansLeFil(page, TITRE_REFUSEE));
      noter(
        `${ecran} : une proposition en attente ne paraît plus dans le fil`,
        !(await dansLeFil(page, TITRE_A)),
      );

      // On remonte tout en haut du fil : le bandeau ne bouge pas.
      await page.evaluate(() => {
        const fil = document.querySelector('[data-fil="conversation"]');
        if (fil) fil.scrollTop = 0;
      });
      await page.waitForTimeout(600);
      const apres = await place(page);
      noter(`${ecran} : en remontant la conversation, le bandeau reste à l’écran`, apres.dansLEcran);

      // Les boutons de décision sont visibles sans défiler le bandeau.
      const boutons = page.locator('[data-vignette="proposition"]').first().getByRole('button', {
        name: /Créer la carte/,
      });
      noter(`${ecran} : le bouton « Créer la carte » est visible`, await boutons.first().isVisible());

      await page.screenshot({
        path: path.join(SHOTS, `bandeau-propositions-${telephone ? 'telephone' : 'ordinateur'}.png`),
      });

      // On valide la première : elle quitte le bandeau et reparaît dans le fil.
      await boutons.first().click();
      await page.waitForTimeout(2500);
      const restant = await place(page);
      noter(
        `${ecran} : la carte validée quitte le bandeau`,
        restant.present && restant.vignettes === 1,
        `${restant.vignettes ?? 0} vignette(s)`,
      );
      noter(`${ecran} : elle reparaît décidée dans le fil`, await dansLeFil(page, TITRE_A));

      // On refuse la seconde : le bandeau disparaît entièrement.
      const refus = page.locator('[data-vignette="proposition"]').first().getByRole('button', { name: /Refuser/ });
      await refus.first().click();
      await page.waitForTimeout(2500);
      const vide = await place(page);
      noter(`${ecran} : sans proposition en attente, le bandeau ne rend rien`, vide.present === false);

      noter(`${ecran} : aucune erreur de page`, erreurs.length === 0, erreurs[0] ?? '');
    } finally {
      await contexte.close();
    }
  }
} finally {
  await navigateur.close();
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
