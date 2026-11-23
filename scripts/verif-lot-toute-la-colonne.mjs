#!/usr/bin/env node
/**
 * « DÉPLOYER » COMPTE ET EMPORTE TOUTE LA COLONNE, PAS LE PREMIER PAQUET REÇU —
 * vérifié dans un VRAI navigateur, sur son PROPRE démon (base neuve, dossier de
 * projets vide, port libre : le démon en service n'est pas touché, aucun quota
 * dépensé).
 *
 * Le bogue : à l'ouverture d'un projet, le démon n'envoie que vingt cartes par
 * colonne (`premiereTranche`, `shared/src/tranches-de-cartes.ts`) ; la suite ne
 * vient qu'au défilement. Le bouton « Déployer » comptait ces seules cartes
 * reçues — « Déployer (20) » pour une colonne de trente — et sa fenêtre de
 * sélection n'envoyait que ces vingt-là : les dix autres restaient dans « À
 * déployer » sans que rien ne le dise.
 *
 * Constats, sans jamais faire défiler la colonne :
 *  1. la colonne annonce ses 30 cartes et n'en a posé que 20 — le décor est
 *     bien celui du bogue ;
 *  2. le bouton de la barre d'en-tête dit « Déployer (30) » ;
 *  3. sa fenêtre de sélection liste les 30 tâches, toutes cochées, et son
 *     bouton dit « Déployer (30) » ; en décocher une rend « (29) » ;
 *  4. la commande `deploy.start` porte les 30 identifiants ;
 *  5. sur téléphone, la page du déploiement annonce les 30 elle aussi.
 *
 * AUCUNE PUBLICATION N'EST LANCÉE : la commande `deploy.start` est retenue
 * avant d'atteindre le démon d'essai, on ne fait que la lire.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-lot-toute-la-colonne.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { creerResultats } from './lib/verif-resultats.mjs';

const PORT = Number(process.env.BELUGA_LOT_PORT || 7236);
const BASE = `http://127.0.0.1:${PORT}`;

/** Une colonne plus longue qu'un paquet : c'est tout le sujet. */
const CARTES = 30;
const PAQUET = 20;
const PROJET = 'p-lot-entier';

const { results, record } = creerResultats();

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-lot-entier-',
  port: PORT,
  signaux: true,
});

async function attendreLaBase(limiteMs = 30_000) {
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

const jeton = crypto.randomBytes(32).toString('hex');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(jeton).digest('hex'),
    maintenant,
    maintenant + 3_600_000,
    'vérification du lot entier',
  );
  /* Aucun agent ne doit partir : on ne juge que l'écran. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const depart = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: DEPOT }).toString().trim();
  const projet = {
    id: PROJET,
    name: 'Essai du lot entier',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    /* Le marqueur des projets d'avant (`procedureEnPlace`, migration 117) :
       sans lui, la colonne propose d'INITIER le déploiement au lieu de
       montrer son bouton. */
    deploiement: { herite: true },
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(PROJET, projet.name, DEPOT, JSON.stringify(projet), maintenant, maintenant);
  const run = {
    id: 'd-lot-entier',
    projectId: PROJET,
    state: 'success',
    cible: 'dev',
    targetCommit: depart,
    cardIds: [],
    steps: [],
    startedAt: maintenant - 60_000,
    endedAt: maintenant - 50_000,
  };
  db.prepare('INSERT INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    run.id,
    PROJET,
    'success',
    JSON.stringify(run),
    run.startedAt,
    run.endedAt,
  );
  const poser = db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, description, data, created_at, updated_at)
     VALUES (?, ?, 'to_deploy', ?, ?, ?, '{}', ?, ?)`,
  );
  db.transaction(() => {
    for (let i = 0; i < CARTES; i += 1) {
      poser.run(`c-lot-${i}`, PROJET, i, `Tâche ${i + 1}`, 'Carte d’essai', maintenant - i * 1000, maintenant - i * 1000);
    }
  })();
  db.close();
}

/** Le nombre entre parenthèses d'un libellé « Déployer (30) », ou `null`. */
const nombreEntreParentheses = (texte) => {
  const lu = /\((\d+)\)/.exec(texte ?? '');
  return lu ? Number(lu[1]) : null;
};

/**
 * LA COMMANDE `deploy.start` EST RETENUE : on la lit, elle n'atteint jamais le
 * démon. Tout le reste passe tel quel.
 */
async function retenirLeDeploiement(page, recues) {
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const serveur = ws.connectToServer();
    ws.onMessage((message) => {
      try {
        const lu = JSON.parse(String(message));
        if (lu?.cmd?.type === 'deploy.start') {
          recues.push(lu.cmd);
          return;
        }
      } catch {
        /* un message qui n'est pas du JSON passe tel quel */
      }
      serveur.send(message);
    });
  });
}

async function main() {
  if (!(await attendrePort()) || !(await attendreLaBase())) {
    console.error(`Le démon d’essai n’a pas démarré :\n${journal.join('').slice(-800)}`);
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome' });
  try {
    /* ---------- Ordinateur ---------- */
    const contexte = await navigateur.newContext({
      viewport: { width: 1400, height: 900 },
      locale: 'fr-CH',
      serviceWorkers: 'block',
    });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    const departs = [];
    await retenirLeDeploiement(page, departs);
    await page.goto(`${BASE}/#projet/${PROJET}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-column="to_deploy"] [data-carte]', { timeout: 30_000 });

    const colonne = await page.evaluate(() => ({
      posees: document.querySelectorAll('[data-column="to_deploy"] [data-carte]').length,
      compteur: document.querySelector('[data-compteur-colonne="to_deploy"]')?.textContent?.trim() ?? '',
    }));
    record(
      'la colonne annonce ses 30 cartes et n’en pose que le premier paquet',
      colonne.posees === PAQUET && /30/.test(colonne.compteur),
      `${colonne.posees} posées, compteur « ${colonne.compteur} »`,
    );

    const libelle = page.locator('[data-bloc-publication="to_deploy"][data-publication-en-tete] [data-libelle-deployer]');
    await libelle.waitFor({ state: 'visible', timeout: 15_000 });
    /* ON ATTEND UN ÉTAT : le chiffre du lot, pas une durée. */
    await page
      .waitForFunction(
        (attendu) =>
          new RegExp(`\\(${attendu}\\)`).test(
            document.querySelector('[data-publication-en-tete] [data-libelle-deployer]')?.textContent ?? '',
          ),
        CARTES,
        { timeout: 10_000 },
      )
      .catch(() => {});
    const texteDuBouton = (await libelle.textContent())?.trim() ?? '';
    record('le bouton de la barre d’en-tête dit « Déployer (30) »', nombreEntreParentheses(texteDuBouton) === CARTES, texteDuBouton);
    record(
      'la colonne n’a toujours posé que son premier paquet — rien n’a défilé',
      (await page.locator('[data-column="to_deploy"] [data-carte]').count()) === PAQUET,
    );

    await libelle.click();
    const fenetre = page.locator('[data-selection-deploiement]');
    await fenetre.waitFor({ state: 'visible', timeout: 15_000 });
    const lignes = await fenetre.locator('[data-carte-selection]').count();
    const cochees = await fenetre.locator('[data-case-selection][aria-checked="true"]').count();
    record('la fenêtre de sélection liste les 30 tâches', lignes === CARTES, `${lignes} ligne(s)`);
    record('elles sont toutes cochées d’avance', cochees === CARTES, `${cochees} cochée(s)`);
    const confirmer = fenetre.locator('[data-bouton-deployer-selection]');
    const texteConfirmer = (await confirmer.textContent())?.trim() ?? '';
    record('son bouton dit « Déployer (30) »', nombreEntreParentheses(texteConfirmer) === CARTES, texteConfirmer);

    /* La dernière tâche de la liste : une de celles que le premier paquet n'apportait pas. */
    const derniereCase = fenetre.locator('[data-case-selection]').last();
    await derniereCase.uncheck();
    const apresDecoche = (await confirmer.textContent())?.trim() ?? '';
    record('décocher une tâche rend « (29) »', nombreEntreParentheses(apresDecoche) === CARTES - 1, apresDecoche);
    await derniereCase.check();

    await confirmer.click();
    await page.waitForTimeout(800);
    const parti = departs[0];
    const emportees = new Set(parti?.selectedCardIds ?? []);
    record(
      '`deploy.start` porte les 30 identifiants',
      departs.length === 1 && emportees.size === CARTES,
      `${departs.length} commande(s), ${emportees.size} identifiant(s)`,
    );
    record(
      'dont ceux des cartes que le premier paquet n’apportait pas',
      Array.from({ length: CARTES }, (_, i) => `c-lot-${i}`).every((id) => emportees.has(id)),
    );
    await contexte.close();

    /* ---------- Téléphone : le geste est une ligne du menu du haut, qui ouvre la page ---------- */
    const mobile = await navigateur.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      locale: 'fr-CH',
      serviceWorkers: 'block',
    });
    await mobile.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const telephone = await mobile.newPage();
    const departsTelephone = [];
    await retenirLeDeploiement(telephone, departsTelephone);
    await telephone.goto(`${BASE}/#projet/${PROJET}`, { waitUntil: 'domcontentloaded' });
    await telephone.waitForSelector('[data-entete-de-zone] [data-menu-general]', { timeout: 30_000 });
    await telephone.locator('[data-entete-de-zone] [data-menu-general]').first().tap();
    const ligne = telephone.locator('[role="menu"] [data-menu-deployer]').first();
    await ligne.waitFor({ state: 'visible', timeout: 10_000 });
    await ligne.tap();
    const lancer = telephone.locator('[data-lancer-depuis-la-page]').first();
    await lancer.waitFor({ state: 'visible', timeout: 15_000 });
    await telephone
      .waitForFunction(
        (attendu) =>
          new RegExp(`\\(${attendu}\\)`).test(document.querySelector('[data-lancer-depuis-la-page]')?.textContent ?? ''),
        CARTES,
        { timeout: 10_000 },
      )
      .catch(() => {});
    const texteTelephone = (await lancer.textContent())?.trim() ?? '';
    record(
      'téléphone : la page du déploiement annonce les 30 tâches',
      nombreEntreParentheses(texteTelephone) === CARTES,
      texteTelephone,
    );
    record('téléphone : rien n’est parti sans confirmation', departsTelephone.length === 0);
    await mobile.close();
  } finally {
    await navigateur.close();
  }

  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${results.length - echecs.length}/${results.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((erreur) => {
  console.error(erreur);
  process.exit(1);
});
