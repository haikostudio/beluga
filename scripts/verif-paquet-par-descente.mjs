#!/usr/bin/env node
/**
 * UN SEUL PAQUET DE CARTES PAR DESCENTE — vérifié dans un VRAI navigateur, sur
 * son PROPRE démon (base neuve, port libre : le démon de production n'est pas
 * touché, aucun quota dépensé).
 *
 * « Archivé » range ses cartes par publication, et ses publications sont
 * REPLIÉES par défaut : vingt cartes de plus n'y ajoutent souvent qu'un
 * bandeau. Le palier de chargement restait donc près de l'écran après chaque
 * paquet, et le suivant repartait tout seul, en boucle, en faisant sauter
 * l'écran. Ce contrôle pose une RANGÉE « Archivé » bien remplie et vérifie :
 *
 *  - à l'ouverture, la rangée se remplit jusqu'à pouvoir défiler, puis
 *    S'ARRÊTE (plus rien n'arrive sans geste) ;
 *  - une seule descente fait venir UN paquet, et un seul, même en attendant ;
 *  - pendant cette attente, la position de lecture ne bouge pas ;
 *  - une deuxième descente fait venir le paquet suivant.
 *
 * Les gestes se font à la ROULETTE, jamais par `scrollLeft` : c'est le geste
 * réel, et le seul qui compte au bout d'une rangée qui ne défile plus.
 *
 *   node scripts/verif-paquet-par-descente.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7198);
const BASE = `http://127.0.0.1:${PORT}`;

/** Huit publications de cinquante cartes : un paquet de vingt n’y ajoute souvent RIEN à l’écran, puisqu’il rejoint un groupe replié. */
const PUBLICATIONS = 8;
const CARTES_PAR_PUBLICATION = 50;
const ORPHELINES = 60;
const CARTES = PUBLICATIONS * CARTES_PAR_PUBLICATION + ORPHELINES;
const PAQUET = 20;
const ATTENTE_MS = 4000;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-paquet-descente-',
  port: PORT,
  signaux: true,
});

async function attendreLaBase(limiteMs = 30000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
      db.close();
      if (table) return true;
    } catch {
      /* base pas encore là */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-descente';

function poserLeProjetEtSesCartes() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification du paquet par descente',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: 'Projet aux archives chargées',
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

  const poserCarte = db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, description, data, created_at, updated_at)
     VALUES (?, ?, 'archived', ?, ?, ?, '{}', ?, ?)`,
  );
  const poserPublication = db.prepare(
    'INSERT INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    for (let i = 0; i < CARTES; i += 1) {
      // Les cartes les plus hautes arrivent d'abord : ce sont celles des publications.
      poserCarte.run(`c-archive-${i}`, PROJET_ID, CARTES - i, `Carte archivée ${i}`, 'Carte d’essai', maintenant, maintenant);
    }
    for (let p = 0; p < PUBLICATIONS; p += 1) {
      const debut = maintenant - (p + 1) * 3600_000;
      const cardIds = Array.from({ length: CARTES_PAR_PUBLICATION }, (_, k) => `c-archive-${p * CARTES_PAR_PUBLICATION + k}`);
      const run = { id: `d-essai-${p}`, projectId: PROJET_ID, state: 'success', steps: [], cardIds, startedAt: debut, endedAt: debut + 60_000 };
      poserPublication.run(run.id, PROJET_ID, 'success', JSON.stringify(run), debut, debut + 60_000);
    }
  })();
  db.close();
}

/**
 * Ce que dit la RANGÉE « Archivé » : cartes posées, bande qui défile.
 *
 * Le tableau s'écrit en rangées : « Archivé » est la dernière, et ses cartes
 * glissent de GAUCHE À DROITE dans leur bande (`data-bande-cartes`). Le palier
 * de chargement, lui, n'a pas bougé d'un caractère (`data-palier-cartes`).
 */
const etat = (page) =>
  page.evaluate(
    (total) => {
      const palier = document.querySelector('[data-palier-cartes="archived"]');
      const zone = document.querySelector('[data-bande-cartes="archived"]');
      const restant = palier ? Number(palier.getAttribute('data-cartes-restantes')) : 0;
      return {
        posees: total - restant,
        scrollTop: zone ? Math.round(zone.scrollLeft) : null,
        defilable: zone ? zone.scrollWidth > zone.clientWidth + 1 : false,
      };
    },
    CARTES,
  );

/**
 * Un geste d'avancée, comme un vrai utilisateur : la ROULETTE au-dessus de la
 * bande. Au bout d'une rangée qui n'a rien gagné en largeur (vingt cartes
 * rangées dans un groupe replié), la bande ne peut plus défiler : c'est la
 * roulette seule qui dit « j'avance ».
 */
async function descendre(page) {
  const point = await page.evaluate(() => {
    const zone = document.querySelector('[data-bande-cartes="archived"]');
    const r = zone?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  if (!point) return;
  await page.mouse.move(point.x, point.y);
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.wheel(1500, 0);
    await page.waitForTimeout(80);
  }
}

/** Relève l'état pendant `ms` : le plus grand nombre de cartes vu, et les positions. */
async function surveiller(page, ms) {
  const releves = [];
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    releves.push(await etat(page));
    await page.waitForTimeout(150);
  }
  return releves;
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  if (!(await attendreLaBase())) {
    console.error(`La base d’essai est restée vide : le port ${PORT} est peut-être déjà pris.`);
    process.exit(1);
  }
  poserLeProjetEtSesCartes();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  try {
    const contexte = await navigateur.newContext({
      viewport: { width: 1400, height: 700 },
      locale: 'fr-CH',
      serviceWorkers: 'block',
    });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // « Archivé » est une RANGÉE du tableau : rien à ouvrir, elle est là.
    await page.waitForSelector('[data-bande-cartes="archived"]', { timeout: 30000 });
    await page.waitForSelector('[data-palier-cartes="archived"]', { timeout: 30000 });

    // 1. À l'ouverture : la colonne se remplit jusqu'à défiler, puis s'arrête.
    await page.waitForTimeout(3000);
    const ouverture = await surveiller(page, ATTENTE_MS);
    const posesOuverture = ouverture.at(-1).posees;
    noter(
      'à l’ouverture, la rangée se remplit jusqu’à pouvoir défiler',
      ouverture.at(-1).defilable,
      `${posesOuverture} carte(s) posée(s) sur ${CARTES}`,
    );
    noter(
      'puis plus rien n’arrive sans geste',
      ouverture.every((r) => r.posees === posesOuverture) && posesOuverture < CARTES,
      `relevés : ${[...new Set(ouverture.map((r) => r.posees))].join(' → ')}`,
    );

    // 2. Une seule descente : un seul paquet, même en attendant.
    await descendre(page);
    await page.waitForTimeout(600);
    const juste = await etat(page);
    const attente = await surveiller(page, ATTENTE_MS);
    const apres = attente.at(-1).posees;
    noter(
      'un geste fait venir UN paquet, et un seul',
      apres === Math.min(CARTES, posesOuverture + PAQUET),
      `${posesOuverture} puis ${apres} (relevés : ${[...new Set(attente.map((r) => r.posees))].join(' → ')})`,
    );
    const positions = [...new Set(attente.map((r) => r.scrollTop))];
    noter(
      'pendant l’attente, la position de lecture ne bouge pas',
      attente.every((r) => r.scrollTop === juste.scrollTop),
      `défilement ${juste.scrollTop} puis ${positions.join(' → ')}`,
    );

    // 3. Une deuxième descente : le paquet suivant.
    await descendre(page);
    await page.waitForTimeout(600);
    const second = await surveiller(page, ATTENTE_MS);
    noter(
      'un deuxième geste fait venir le paquet suivant, et lui seul',
      second.at(-1).posees === Math.min(CARTES, apres + PAQUET),
      `${apres} puis ${second.at(-1).posees}`,
    );

    noter('aucune erreur de page', erreurs.length === 0, erreurs[0] ?? '');
    await contexte.close();
  } finally {
    await navigateur.close();
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log('');
  console.log(`${resultats.length - echecs.length}/${resultats.length} contrôle(s) au vert.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
