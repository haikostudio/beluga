#!/usr/bin/env node
/**
 * L'ADRESSE D'UNE CARTE OUVERTE, PARTOUT OÙ ELLE S'OUVRE — vérifiée dans un
 * VRAI navigateur, sur son PROPRE démon (base neuve, port libre : le démon de
 * production n'est pas touché, aucun quota dépensé, aucune préférence réelle
 * écrite).
 *
 *   node scripts/verif-adresses-des-cartes.mjs
 *
 * C'est le trou que `verif-adresses.mjs` ne couvrait pas : il prouve que chaque
 * SERVICE a son adresse, mais jamais qu'une CARTE ouverte depuis un tableau de
 * bord a la sienne. Une carte ouverte sur « En route » laissait l'adresse sur
 * « #en-route » — recharger ou copier le lien ne ramenait pas sur la carte.
 *
 * Pour les deux endroits où une carte s'ouvre — la liste de « Tableaux de
 * bord » (qui mène désormais au projet de la carte, 30/10/2026) et la liste
 * des agents d'un projet —, il exige :
 *
 *  1. ouvrir la carte CHANGE l'adresse, et elle nomme le projet DE LA CARTE ;
 *  2. recharger la page ramène la carte ouverte au même endroit ;
 *  3. UN appui sur Précédent referme la carte, un appui sur Suivant la rouvre ;
 *  4. changer d'onglet dans la carte l'écrit dans l'adresse, sans entrée
 *     d'historique de plus ;
 *  5. l'adresse collée dans un onglet neuf ouvre la carte ;
 *  6. une carte « souvenir » (ouverte sur un tableau, puis quittée) ne fuit pas
 *     dans l'adresse d'un autre écran ;
 *  7. une adresse qui vise une carte DISPARUE ne bloque rien.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_ADRESSES_CARTES_PORT || 7197);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-adresses-cartes-',
  port: PORT,
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

/* Des UUID : l'adresse range « <identifiant>-<slug> », et seul un UUID en tête
   permet de séparer l'un de l'autre. */
const PROJET_A = 'p-alpha';
const PROJET_B = 'p-beta';
const CARTE_A = crypto.randomUUID();
const CARTE_B = crypto.randomUUID();
const CARTE_DISPARUE = crypto.randomUUID();
const TITRE_A = 'Ambiances renouvelées';
const TITRE_B = 'Refonte du coffre';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton), maintenant, maintenant + 3600_000, 'vérification adresses des cartes',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  const projet = (id, nom, rank) => {
    const data = {
      id, name: nom, path: DEPOT, defaultEngine: 'claude', isSelf: false, rank,
      archived: false, createdAt: maintenant, updatedAt: maintenant,
    };
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run(id, nom, DEPOT, JSON.stringify(data), maintenant, maintenant);
  };
  projet(PROJET_A, 'Projet Alpha', 1);
  projet(PROJET_B, 'Projet Beta', 2);
  const carte = (id, projectId, titre, position) => {
    const data = { id, projectId, title: titre, origin: 'user' };
    db.prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
       VALUES (?, ?, 'planned', ?, ?, ?, ?, ?)`,
    ).run(id, projectId, position, titre, JSON.stringify(data), maintenant, maintenant);
  };
  carte(CARTE_A, PROJET_A, TITRE_A, 1);
  carte(CARTE_B, PROJET_B, TITRE_B, 1);
  db.close();
}

const fragment = (page) => page.evaluate(() => window.location.hash.replace(/^#/, ''));

/** L'adresse une fois posée : l'écrivain peut poser le slug un instant après. */
async function adressePosee(page, { calme = 700, limite = 8000 } = {}) {
  let vu = await fragment(page);
  let depuis = Date.now();
  const fin = Date.now() + limite;
  while (Date.now() < fin && Date.now() - depuis < calme) {
    await page.waitForTimeout(100);
    const maintenant = await fragment(page);
    if (maintenant !== vu) {
      vu = maintenant;
      depuis = Date.now();
    }
  }
  return vu;
}

/** La carte est-elle affichée ? Sa page (`data-page-carte`) n'existe que carte ouverte. */
const carteOuverte = async (page) =>
  (await page.locator('[data-page-carte]:visible').count()) > 0;

/** La ligne d'un agent dans la liste (colonne d'un projet ou « Tableaux de bord »). */
const ligne = (page, portee, id) => page.locator(`${portee} [data-agent-en-liste="${id}"] :is(a, button)`).first();

async function attendreCarte(page, ouverte, limite = 10_000) {
  const fin = Date.now() + limite;
  while (Date.now() < fin) {
    if ((await carteOuverte(page)) === ouverte) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

const motif = (projectId, cardId) =>
  new RegExp(`^${projectId}/tache/${cardId}(-[a-z0-9-]*)?$`.replace(/^\^/, '^'));

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1600, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));

  /* ---------- « Tableaux de bord » : une liste, deux projets ----------
     DEPUIS LE 30/10/2026 (« projets sans kanban »), un agent ouvert depuis la
     liste de « Tableaux de bord » s'ouvre DANS SON PROJET : l'adresse devient
     « projet/<id>/tache/<carte> ». Les anciennes adresses « en-route/projet/…/
     tache/… », déjà partagées, ouvrent toujours la carte. */
  await page.goto(`${BASE}/#en-route`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const tous = '[data-page-en-route]';
  await ligne(page, tous, CARTE_A).waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
  const carteVue = await ligne(page, tous, CARTE_A).count();
  noter('« Tableaux de bord » montre les agents de tous les projets', carteVue === 1 && (await ligne(page, tous, CARTE_B).count()) === 1);
  if (!carteVue) {
    console.log('Journal du démon :\n' + journal.join(''));
    await navigateur.close();
    process.exit(1);
  }
  const nue = await adressePosee(page);
  noter('l’adresse de « Tableaux de bord » nu reste « en-route »', nue === 'en-route', nue);

  await ligne(page, tous, CARTE_A).click();
  noter('l’agent s’ouvre', await attendreCarte(page, true));
  const adresseA = await adressePosee(page);
  noter(
    'ouvrir un agent depuis « Tableaux de bord » mène à SON projet, et l’adresse le nomme',
    motif(`projet/${PROJET_A}`, CARTE_A).test(adresseA),
    adresseA,
  );

  /* Recharger : même adresse, même carte ouverte. */
  await page.reload({ waitUntil: 'domcontentloaded' });
  noter('recharger rouvre la même carte', await attendreCarte(page, true, 30_000));
  const apresRecharge = await adressePosee(page);
  noter('…à la même adresse', apresRecharge === adresseA, `${apresRecharge} / ${adresseA}`);

  /* GitHub, par « Voir la branche » : un tiroir, que l'adresse nomme. */
  await page.locator('[data-page-carte] [data-bouton-de-branche]:visible').first().click();
  await page.locator('[data-voir-la-branche]:visible').first().click();
  await page.waitForTimeout(500);
  const surOnglet = await adressePosee(page);
  noter('le tiroir GitHub d’une carte s’écrit dans l’adresse', surOnglet.endsWith('/volet/github-de-la-carte'), surOnglet);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  /* Une carte d'un AUTRE projet nomme SON projet, pas celui de la précédente. */
  await page.goto(`${BASE}/#en-route`, { waitUntil: 'domcontentloaded' });
  await ligne(page, tous, CARTE_B).waitFor({ state: 'visible', timeout: 30_000 });
  await attendreCarte(page, false, 5000);
  await ligne(page, tous, CARTE_B).click();
  noter('la carte de l’autre projet s’ouvre', await attendreCarte(page, true));
  const adresseB = await adressePosee(page);
  noter('l’adresse nomme le projet de CETTE carte', motif(`projet/${PROJET_B}`, CARTE_B).test(adresseB), adresseB);

  /* Précédent ramène à « Tableaux de bord », Suivant rouvre — un seul appui chacun. */
  await page.goBack();
  const fermee = await attendreCarte(page, false);
  const apresRetour = await adressePosee(page);
  noter('un appui sur Précédent referme la carte', fermee && apresRetour === 'en-route', `${apresRetour || '(vide)'}`);
  await page.goForward();
  const rouverte = await attendreCarte(page, true);
  noter('un appui sur Suivant la rouvre', rouverte && (await adressePosee(page)) === adresseB);

  /* L'adresse se partage : un onglet neuf ouvre la carte, son projet dessous. */
  const neuf = await contexte.newPage();
  await neuf.goto(`${BASE}/#${adresseB}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const rouvertDansNeuf = await attendreCarte(neuf, true, 30_000);
  noter('l’adresse collée dans un onglet neuf ouvre la carte', rouvertDansNeuf);
  noter('…avec son projet dessous', (await neuf.locator(`[data-page-du-projet="${PROJET_B}"]`).count()) > 0);
  /* Une ANCIENNE adresse, prise sur « En route » avant la refonte, ouvre toujours la carte. */
  await neuf.goto(`${BASE}/#en-route/projet/${PROJET_A}/tache/${CARTE_A}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await neuf.reload({ waitUntil: 'domcontentloaded' });
  noter('une ancienne adresse « en-route/projet/…/tache/… » ouvre toujours la carte', await attendreCarte(neuf, true, 30_000));
  await neuf.close();

  /* Une carte disparue ne bloque rien. */
  await page.goto(`${BASE}/#en-route/projet/${PROJET_A}/tache/${CARTE_DISPARUE}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  noter('une carte disparue laisse « Tableaux de bord » utilisable', (await page.locator('[data-page-en-route]').count()) > 0);

  /* ---------- Un projet : la liste de sa colonne ---------- */
  await page.goto(`${BASE}/#projet/${PROJET_A}`, { waitUntil: 'domcontentloaded' });
  const colonne = 'aside[data-zone="gauche"]';
  const tuile = ligne(page, colonne, CARTE_A);
  await tuile.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
  if (await tuile.count()) {
    await tuile.click();
    noter('la carte s’ouvre depuis la liste du projet', await attendreCarte(page, true));
    const adresseProjet = await adressePosee(page);
    noter('l’adresse d’un projet nomme la carte', motif(`projet/${PROJET_A}`, CARTE_A).test(adresseProjet), adresseProjet);
    await page.reload({ waitUntil: 'domcontentloaded' });
    noter('recharger rouvre la carte', await attendreCarte(page, true, 30_000));

    /* ---------- Une carte « souvenir » ne fuit pas ---------- */
    await page.goto(`${BASE}/#en-route`, { waitUntil: 'domcontentloaded' });
    await ligne(page, tous, CARTE_A).waitFor({ state: 'visible', timeout: 30_000 });
    await attendreCarte(page, false, 5000);
    const surEnRoute = await adressePosee(page);
    noter(
      'la carte restée ouverte dans un projet n’entre pas dans l’adresse de « Tableaux de bord »',
      surEnRoute === 'en-route' && !(await carteOuverte(page)),
      surEnRoute,
    );
  } else {
    noter('une ligne d’agent est disponible dans la colonne du projet', false);
  }

  noter('aucune erreur JavaScript de page', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));
  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis.`);
  if (echecs.length) console.log('Journal du démon :\n' + journal.join('').slice(-2000));
  process.exit(echecs.length ? 1 : 0);
}

main().catch((erreur) => {
  console.error('ÉCHEC :', erreur);
  console.log('Journal du démon :\n' + journal.join('').slice(-2000));
  process.exit(1);
});
