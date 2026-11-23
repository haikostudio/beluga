#!/usr/bin/env node
/**
 * UN DÉPANNAGE S'OUVRE DANS LE VOLET DE SON ÉTAPE.
 *
 * La panne verrouillée ici : tout agent de publication (rôle `deploy`) partait
 * vers le tiroir de MISE EN PRODUCTION. Le dépanneur d'un DÉPLOIEMENT, ouvert
 * depuis sa vignette « Dépannage » des Tableaux de bord (ou le menu Agents, la
 * cloche), atterrissait donc dans le mauvais volet — et, sur un projet sans
 * procédure de production, sur l'onglet « Conversation », ce qui lançait en
 * prime l'agent de configuration de la production.
 *
 *  1. Dépanneur du DÉPLOIEMENT → le volet du déploiement s'ouvre, son tiroir de
 *     dépannage empilé ; aucun tiroir de production.
 *  2. Dépanneur de la MISE EN PRODUCTION → le tiroir de production, son fil
 *     empilé ; aucun volet du déploiement.
 *  3. Aucun agent de configuration n'est créé au passage.
 *
 * Démon d'essai à soi (base neuve, port libre) : rien n'est mis en ligne,
 * aucun quota n'est dépensé — les dépanneurs posés n'ont jamais reçu de tour.
 *
 *   node scripts/verif-depannage-bon-volet.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { ouvrirLesTableauxDeBord } from './lib/navigation.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_DEPANNAGE_VOLET_PORT || 7231);
const BASE = `http://127.0.0.1:${PORT}`;
const { DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-depannage-volet-',
  port: PORT,
});

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${String(detail).slice(0, 180)}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* A. LA RÈGLE ET SON BRANCHEMENT                                      */
/* ------------------------------------------------------------------ */

function voletDesRegles() {
  const regle = fs.readFileSync(path.join(RACINE, 'shared', 'src', 'depannage-publication.ts'), 'utf8');
  noter(
    'la règle de routage est PURE et lit la cible du dépanneur en premier',
    /export function voletDeLAgentDePublication\(/.test(regle) &&
      /if \(agent\.depannagePublication\) return agent\.depannagePublication\.cible;/.test(regle),
  );
  const app = fs.readFileSync(path.join(RACINE, 'web', 'src', 'app.tsx'), 'utf8');
  noter(
    'ouvrirAgent suit la règle, et la production demandée par un agent ne s’ouvre jamais sur « Conversation »',
    /voletDeLAgentDePublication\(\{/.test(app) &&
      /client\.demanderDeploiement\(\{ projectId: agent\.projectId, agentId: fil \}\)/.test(app) &&
      /ouvrirRubriqueDeLEtape\(agent\.projectId, 'production'\)/.test(app),
  );
}

/* ------------------------------------------------------------------ */
/* B. L'ÉCRAN                                                          */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const P_DEV = 'p-depannage-dev';
const P_PROD = 'p-depannage-prod';
const D_DEV = 'a-depanneur-dev';
const D_PROD = 'a-depanneur-prod';

function poserDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3_600_000,
    'vérification du volet de dépannage',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = (id, name, rank, production) => ({
    id,
    name,
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank,
    archived: false,
    ...(production
      ? { miseEnProduction: { processus: { etapes: [{ libelle: 'Contrôle', commande: 'true', delaiS: 5 }] } } }
      : {}),
    /* Depuis le 10/10/2026 un projet sans processus ne déploie pas : le décor est « hérité » (déploiement déjà en place), sinon l'en-tête n'offre que « Configuration de la procédure », sans chevron. */
    deploiement: { herite: true },
    createdAt: t,
    updatedAt: t,
  });
  /* LE PROJET DU DÉPLOIEMENT N'A AUCUNE PROCÉDURE DE PRODUCTION : c'est là que
     l'ancien routage lançait l'agent de configuration. */
  for (const p of [projet(P_DEV, 'Essai dépannage déploiement', 1, false), projet(P_PROD, 'Essai dépannage production', 2, true)]) {
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run(p.id, p.name, p.path, JSON.stringify(p), t, t);
  }

  db.prepare('DELETE FROM deploys').run();
  db.prepare("DELETE FROM agents WHERE role = 'deploy'").run();
  const tombee = (id, projectId, cible, agentId) => {
    const debut = t - 10 * 60_000;
    const run = {
      id,
      projectId,
      state: 'failed',
      cible,
      steps: [
        { key: 'merge', state: 'done', log: '', startedAt: debut, endedAt: debut + 1000 },
        { key: 'publish', state: 'failed', log: 'échec simulé', startedAt: debut + 1000, endedAt: debut + 2000 },
      ],
      cardIds: [],
      reprises: 0,
      repriseApresCoupure: false,
      queued: false,
      startedAt: debut,
      endedAt: debut + 2000,
      error: 'échec simulé',
      depannage: { agentId, at: t - 60_000 },
    };
    db.prepare('INSERT INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      run.id,
      projectId,
      run.state,
      JSON.stringify(run),
      run.startedAt,
      run.endedAt,
    );
    /* Un dépanneur qui ATTEND une réponse : vivant, donc sur les Tableaux de
       bord, sans avoir jamais reçu de tour. */
    const agent = {
      id: agentId,
      projectId,
      role: 'deploy',
      title: cible === 'production' ? 'Dépannage de la mise en production' : 'Dépannage du déploiement',
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      status: 'done',
      attendReponse: true,
      depannagePublication: { runId: id, cible },
      startedAt: t - 60_000,
      createdAt: t - 60_000,
      updatedAt: t - 30_000,
    };
    db.prepare(
      `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).run(agentId, projectId, 'deploy', 'done', JSON.stringify(agent), agent.createdAt, agent.updatedAt);
  };
  tombee('r-dep-dev', P_DEV, 'dev', D_DEV);
  tombee('r-dep-prod', P_PROD, 'production', D_PROD);
  db.close();
}

/** Ce que l'écran montre après le clic sur une vignette. */
async function lireLEcran(page) {
  return page.evaluate(() => ({
    voletDev: !!document.querySelector('[data-volet-publication="dev"]'),
    tiroirDepannage: !!document.querySelector('[data-tiroir-depannage]'),
    tiroirProduction: !!document.querySelector('[data-tiroir-production]'),
    ongletsProduction: !!document.querySelector('[data-onglets-production], [data-onglet-production]'),
    filProduction: document.querySelector('[data-fil-agent-production]')?.getAttribute('data-fil-agent-production') ?? null,
  }));
}

/*
 * VERS LES TABLEAUX DE BORD, PAR UN VRAI GESTE. La colonne de gauche n'a plus de
 * ligne « Tableaux de bord » (12/10/2026) : sur ordinateur comme sur téléphone,
 * on y va par la ligne qui coiffe la grille des services
 * (`ouvrirLesTableauxDeBord`, `scripts/lib/navigation.mjs`).
 */
async function allerAuxTableauxDeBord(page) {
  await ouvrirLesTableauxDeBord(page);
  await page.waitForTimeout(1500);
}

async function fermerTout(page) {
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
}

async function voletDeLEcran(navigateur, appareil) {
  const contexte = await navigateur.newContext({
    ...(appareil === 'téléphone'
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 } }),
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  const noterIci = noter;
  const noter2 = (nom, ok, detail) => noterIci(`${appareil} — ${nom}`, ok, detail);
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e.message ?? e)));
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(4000);

    /* 1. LE DÉPANNEUR DU DÉPLOIEMENT */
    await allerAuxTableauxDeBord(page, appareil === 'téléphone');
    const vignetteDev = page.locator(`[data-ouvrir-depannage="${D_DEV}"]`);
    noter2('la vignette du dépannage du DÉPLOIEMENT est aux Tableaux de bord', (await vignetteDev.count()) === 1);
    if (await vignetteDev.count()) {
      await vignetteDev.click();
      await page.waitForTimeout(2500);
      const ecran = await lireLEcran(page);
      noter2(
        'elle ouvre le volet du DÉPLOIEMENT, avec le dépanneur empilé',
        ecran.voletDev && ecran.tiroirDepannage,
        JSON.stringify(ecran),
      );
      noter2('aucun tiroir de mise en production ne s’ouvre', !ecran.tiroirProduction && !ecran.filProduction, JSON.stringify(ecran));
    }
    await fermerTout(page);

    /* 2. LE DÉPANNEUR DE LA MISE EN PRODUCTION */
    await allerAuxTableauxDeBord(page, appareil === 'téléphone');
    const vignetteProd = page.locator(`[data-ouvrir-depannage="${D_PROD}"]`);
    noter2('la vignette du dépannage de la MISE EN PRODUCTION est aux Tableaux de bord', (await vignetteProd.count()) === 1);
    if (await vignetteProd.count()) {
      await vignetteProd.click();
      await page.waitForTimeout(2500);
      const ecran = await lireLEcran(page);
      noter2(
        'elle ouvre le tiroir de PRODUCTION, avec le fil du dépanneur empilé',
        ecran.filProduction === D_PROD,
        JSON.stringify(ecran),
      );
      noter2('aucun volet du déploiement ne s’ouvre', !ecran.voletDev, JSON.stringify(ecran));
    }

    /* 3. AUCUN AGENT DE CONFIGURATION CRÉÉ EN ROUTE */
    await page.waitForTimeout(1000);
    const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
    const agents = db.prepare("SELECT id FROM agents WHERE role = 'deploy'").all().map((r) => r.id).sort();
    const retenus = db
      .prepare('SELECT data FROM projects')
      .all()
      .map((r) => JSON.parse(r.data).miseEnProduction?.agentId)
      .filter(Boolean);
    db.close();
    noter2(
      'aucun agent de configuration de la production n’a été lancé',
      agents.join(',') === [D_DEV, D_PROD].sort().join(',') && retenus.length === 0,
      JSON.stringify({ agents, retenus }),
    );

    noter2('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await contexte.close();
  }
}

/* ------------------------------------------------------------------ */

try {
  voletDesRegles();
  if (!(await attendrePort())) {
    noter('le démon d’essai répond', false, journal.join('').slice(-400));
  } else {
    noter('le démon d’essai répond', true);
    poserDecor();
    const navigateur = await chromium.launch({ channel: 'chrome' });
    try {
      await voletDeLEcran(navigateur, 'ordinateur');
      await voletDeLEcran(navigateur, 'téléphone');
    } finally {
      await navigateur.close();
    }
  }
} catch (erreur) {
  noter('le contrôle est allé au bout', false, String(erreur?.message ?? erreur));
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées.`);
nettoyer();
process.exit(echecs.length ? 1 : 0);
