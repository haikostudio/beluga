#!/usr/bin/env node
/**
 * La colonne « En production » N'EXISTE PLUS, et la production se dit par sa
 * VERSION :
 *
 *   - aucune colonne « En production » sur le tableau : « À déployer » est
 *     suivie directement d'« Archivé », où le déploiement range ses cartes ;
 *   - les DEUX étapes de mise en ligne portent leur bloc, sans aucun
 *     réglage : « Tout déployer (n) » en tête d'« À déployer », « Mettre à jour
 *     la version prod » — SANS compteur — dans le bandeau bas du tableau ;
 *   - ce bloc dit l'ÉTAT de la production : l'enregistrement en ligne et
 *     l'écart avec le dépôt, jamais un silence ;
 *   - un clic dessus ne publie RIEN : il ouvre la confirmation, et « Annuler »
 *     ne lance aucune publication ;
 *   - sur écran de téléphone, « Archivé » a son onglet, avec son compte ;
 *   - une carte d'« À déployer » ne se reprend qu'à la main, et retombe alors
 *     en « Terminé » — l'étape juste avant, jamais deux d'un coup.
 *
 *   node scripts/verif-lot-production.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et
 * un dossier de projets vide : le démon de production n'est pas touché. Le
 * plafond d'agents est mis à ZÉRO : aucun tour n'est lancé, aucun quota dépensé.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

/* La racine se déduit du script LUI-MÊME : lancé depuis une copie de travail,
   il doit juger le code de cette copie, jamais celui du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* La résolution ordinaire de Node remonte les dossiers parents : elle trouve le
   `node_modules` de la copie de travail, et à défaut celui du dépôt principal. */
const Database = createRequire(import.meta.url)('better-sqlite3');

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7197);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* Les commandes « deploy.start » RÉELLEMENT envoyées au serveur, captées sur le
   fil WebSocket : c'est la preuve qu'un clic déclenche — ou non — une
   publication. On les vide avant chaque geste qu'on veut mesurer. */
const cadresDeployStart = [];
function guetterDeployStart(page) {
  page.on('websocket', (ws) => {
    ws.on('framesent', (cadre) => {
      const charge = typeof cadre.payload === 'string' ? cadre.payload : String(cadre.payload ?? '');
      if (charge.includes('deploy.start')) cadresDeployStart.push(charge);
    });
  });
}

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

const { TMP, DATA, PROJETS, DEPOT, demon, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-lot-production-',
  port: PORT,
});

/* ------------------------------------------------------------------ */
/* Le décor : un projet, trois cartes « À déployer », une session       */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const TITRES = ['Carte d’essai — lot A', 'Carte d’essai — lot B', 'Carte d’essai — lot C'];

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification de l’état de production',
  );

  /* Plafond d'agents à ZÉRO : rien ne peut se lancer pendant l'essai. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai production',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    /* Une mise en production non réglée est refusée : le bouton « Tout publier »
       s'éteint et le dit. Ce script vérifie la CONFIRMATION, pas ce refus — le
       projet d'essai est donc déclaré « Aucune » (projet local), le seul type
       qui n'appelle NI agent NI transfert : rien n'est dépensé, et le bouton
       est cliquable. */
    miseEnProduction: { type: 'aucune' },
    /* Un projet neuf n'a plus de procédure de déploiement : sans elle, la
       colonne propose de l'initier au lieu du bouton « Tout déployer ». Ce
       script juge les boutons de publication, pas cette proposition : le projet
       d'essai porte donc le marqueur « constaté » des projets d'avant. */
    deploiement: {},
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

  TITRES.forEach((titre, index) => {
    const carte = {
      id: `c-essai-${index}`,
      projectId: PROJET_ID,
      title: titre,
      description: 'Carte fabriquée par le script de vérification.',
      labels: [],
      column: 'to_deploy',
      position: index + 1,
      origin: 'user',
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      scheduling: { asap: false, attempts: 0, restarts: 0, suspendu: false },
      excludedFromDeploy: false,
      horsTache: false,
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(carte.id, PROJET_ID, 'to_deploy', carte.position, titre, JSON.stringify(carte), maintenant, maintenant);
  });
  db.close();
}

/** L'état des cartes en BASE : titre → colonne. */
function colonnesEnBase() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const lignes = db.prepare('SELECT title, column_key FROM cards').all();
  db.close();
  return Object.fromEntries(lignes.map((l) => [l.title, l.column_key]));
}

/** Où chaque carte se trouve À L'ÉCRAN : titre → colonne affichée. */
async function colonnesAffichees(page) {
  return page.evaluate((titres) => {
    const trouve = {};
    for (const col of document.querySelectorAll('[data-column]')) {
      for (const titre of titres) {
        if (col.textContent?.includes(titre)) trouve[titre] = col.getAttribute('data-column');
      }
    }
    return trouve;
  }, TITRES);
}

/** Les cases à cocher d'une colonne, dans l'ordre des cartes. */
async function cases(page, colonne) {
  return page.evaluate((colonne) => {
    const col = document.querySelector(`[data-column="${colonne}"]`);
    if (!col) return [];
    return [...col.querySelectorAll('button[aria-pressed]')].map((bouton) => {
      const carte = bouton.parentElement?.querySelector('article');
      return { titre: carte?.querySelector('h3')?.textContent ?? '', cochee: bouton.getAttribute('aria-pressed') === 'true' };
    });
  }, colonne);
}

/** Le texte des boutons du pied d'une colonne. */
async function pied(page, colonne) {
  return page.evaluate((colonne) => {
    const col = document.querySelector(`[data-column="${colonne}"]`);
    const bas = col?.lastElementChild;
    if (!bas || !bas.querySelector('button')) return [];
    return [...bas.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
  }, colonne);
}

/**
 * Le bloc de publication d'une étape, repéré par sa colonne d'origine : en tête
 * d'« À déployer » pour le déploiement, dans le BANDEAU BAS du tableau pour la
 * mise en production (`data-bloc-publication="archived"`). Son bouton, ce qu'il
 * dit, et s'il est éteint ; `null` quand il n'existe pas.
 */
async function blocPublication(page, colonne) {
  /* LA MISE EN PRODUCTION RANGE SON BOUTON DANS SON TIROIR : on l'ouvre par la ligne. */
  if (colonne === 'archived' && !(await page.locator('[data-pied-tiroir-production]').count())) {
    /* Au repos, le bouton ouvre la confirmation (22/10/2026) : la flèche accolée ouvre le volet. */
    const fleche = page.locator('[data-chevron-production]');
    await ((await fleche.count()) ? fleche : page.locator('[data-ouvrir-tiroir-production]')).click();
    await page.waitForTimeout(700);
  }
  return page.evaluate((colonne) => {
    const bloc = document.querySelector(`[data-bloc-publication="${colonne}"]`);
    if (!bloc) return null;
    const bouton =
      colonne === 'archived'
        ? document.querySelector('[data-pied-tiroir-production] [data-bouton-publication]')
        : bloc.querySelector('[data-bouton-publication]');
    return {
      colonne: bloc.getAttribute('data-bloc-publication'),
      bouton: bouton?.textContent?.trim() ?? null,
      eteint: bouton?.disabled === true,
      texte: bloc.textContent?.trim() ?? '',
    };
  }, colonne);
}

/**
 * LE GESTE DE LOT S'OUVRE DEPUIS LE MENU TROIS POINTS de la colonne : le
 * bandeau de titre ne porte plus de bouton « Tout archiver ». Rend le libellé
 * lu dans le menu, puis clique l'entrée.
 */
async function ouvrirGesteDeLot(page, colonne) {
  await page.locator(`[data-menu-colonne="${colonne}"]`).click();
  await page.waitForTimeout(400);
  const entree = page.locator('[data-geste-de-lot]');
  const libelle = (await entree.textContent())?.trim() ?? '';
  await entree.click();
  await page.waitForTimeout(400);
  return libelle;
}

/** Ce que propose le menu trois points d'une colonne, menu ouvert puis refermé. */
async function entreesDuMenu(page, colonne) {
  await page.locator(`[data-menu-colonne="${colonne}"]`).click();
  await page.waitForTimeout(400);
  const textes = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent?.trim() ?? ''),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return textes;
}

const cliquerPied = (page, motif, colonne) =>
  page.evaluate(
    ({ motif, colonne }) => {
      const col = document.querySelector(`[data-column="${colonne}"]`);
      const bouton = [...(col?.lastElementChild?.querySelectorAll('button') ?? [])].find((b) =>
        new RegExp(motif).test(b.textContent ?? ''),
      );
      if (!bouton) throw new Error(`bouton « ${motif} » introuvable au pied de « ${colonne} »`);
      bouton.click();
    },
    { motif, colonne },
  );

/* ------------------------------------------------------------------ */

async function ouvrirLeTableau(navigateur, viewport = { width: 1400, height: 900 }) {
  const contexte = await navigateur.newContext({ viewport, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([
    { name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  guetterDeployStart(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  const onglet = page.getByRole('button', { name: /^Tableau$/ });
  if (await onglet.count()) {
    await onglet.first().click();
    await page.waitForTimeout(2000);
  }
  return { page, contexte, erreurs };
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const { page, contexte, erreurs } = await ouvrirLeTableau(navigateur);

  /* -------- La colonne « En production » a disparu -------- */

  noter(
    'aucune colonne « En production » sur le tableau',
    (await page.locator('[data-column="in_production"]').count()) === 0,
  );

  const ordre = await page.evaluate(() =>
    [...document.querySelectorAll('[data-column]')].map((c) => c.getAttribute('data-column')),
  );
  /* « Archivé » n'est plus une colonne DESSINÉE : ses cartes se lisent dans le
     tiroir « Archives », ouvert depuis le menu à trois points d'« À déployer ».
     Le tableau se termine donc sur « À déployer ». */
  noter(
    'le tableau se termine sur « À déployer », « Archivé » n’est plus dessinée',
    ordre.at(-1) === 'to_deploy' && !ordre.includes('archived'),
    ordre.join(' → '),
  );

  /* -------- Les deux blocs de mise en ligne, chacun avec son verbe -------- */

  await page.locator('[data-column="to_deploy"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const depart = await colonnesAffichees(page);
  noter(
    'les trois cartes d’essai sont dans « À déployer »',
    TITRES.every((t) => depart[t] === 'to_deploy'),
    JSON.stringify(depart),
  );

  const blocDeploy = await blocPublication(page, 'to_deploy');
  noter(
    '« À déployer » garde son bloc et son bouton « Tout déployer »',
    !!blocDeploy && /Tout déployer/.test(blocDeploy.bouton ?? ''),
    JSON.stringify(blocDeploy),
  );
  noter(
    'le bouton compte exactement les trois cartes du lot',
    /\(3\)/.test(blocDeploy?.bouton ?? ''),
    blocDeploy?.bouton ?? '—',
  );

  const blocProduction = await blocPublication(page, 'archived');
  noter(
    'le bandeau bas du tableau porte le bloc de la MISE EN PRODUCTION',
    !!blocProduction &&
      (await page.evaluate(() => !!document.querySelector('[data-pied-tiroir-production] [data-bouton-publication]'))),
    JSON.stringify(blocProduction),
  );
  noter(
    '« Archivé » n’a plus de bloc de publication en tête',
    (await page.locator('[data-column="archived"] [data-bloc-publication]').count()) === 0,
  );
  noter(
    'son bouton dit « Mettre à jour la version prod », sans aucun compteur',
    /Mettre à jour la version prod/.test(blocProduction?.bouton ?? '') &&
      !/\(\d/.test(blocProduction?.bouton ?? ''),
    blocProduction?.bouton ?? '—',
  );
  noter(
    'il reste ALLUMÉ alors qu’aucune carte n’est à publier',
    blocProduction?.eteint === false,
    String(blocProduction?.eteint),
  );

  /* -------- L'ÉTAT de la version en production se lit -------- */

  const etatProd = await page.evaluate(() => {
    const bloc = document.querySelector('[data-pied-tiroir-production] [data-etat-production]');
    if (!bloc) return null;
    return {
      commit: bloc.querySelector('[data-commit-production]')?.textContent?.trim() ?? null,
      ecart: bloc.querySelector('[data-ecart-production]')?.textContent?.trim() ?? null,
    };
  });
  noter('le bloc affiche l’état de la version en production', !!etatProd, JSON.stringify(etatProd));
  noter(
    'sans mise en production, il le DIT au lieu de se taire',
    etatProd?.commit === 'Aucune version en production' &&
      etatProd?.ecart === 'Jamais mise en production',
    JSON.stringify(etatProd),
  );
  await page.screenshot({ path: path.join(TMP, 'etat-production.png') });

  /* -------- La mise à jour de la prod demande CONFIRMATION -------- */

  // Le bouton n'envoie rien au premier clic : il ouvre une modale. Aucune
  // commande deploy.start ne doit partir tant que « Mettre à jour » n'est pas
  // cliqué.
  cadresDeployStart.length = 0;
  await page.evaluate(() => {
    document.querySelector('[data-pied-tiroir-production] [data-bouton-publication]')?.click();
  });
  await page.waitForTimeout(700);
  /* La modale s'ouvre PAR-DESSUS le tiroir de production : c'est la dernière fenêtre. */
  const modale = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    if (!dlg) return null;
    const boutons = [...dlg.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
    return {
      texte: dlg.textContent ?? '',
      confirmer: boutons.some((t) => t === 'Mettre à jour'),
      annuler: boutons.some((t) => t === 'Annuler'),
    };
  });
  noter(
    'un clic ouvre la modale de confirmation « Mise en production »',
    !!modale && modale.texte.includes('Mise en production') && modale.confirmer && modale.annuler,
    JSON.stringify(modale),
  );
  noter(
    'elle annonce ce qui va partir chez le client',
    !!modale && /chez le client/.test(modale.texte),
    modale?.texte?.slice(0, 160) ?? '—',
  );
  noter(
    'aucune commande deploy.start n’est partie à l’ouverture de la modale',
    cadresDeployStart.length === 0,
    `${cadresDeployStart.length} envoi(s)`,
  );

  // « Annuler » referme sans rien lancer.
  await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    [...(dlg?.querySelectorAll('button') ?? [])].find((b) => (b.textContent?.trim() ?? '') === 'Annuler')?.click();
  });
  await page.waitForTimeout(600);
  noter(
    '« Annuler » referme la modale',
    await page.evaluate(
      () =>
        ![...document.querySelectorAll('[role="dialog"]')].some((dlg) =>
          [...dlg.querySelectorAll('button')].some((b) => (b.textContent?.trim() ?? '') === 'Mettre à jour'),
        ),
    ),
  );
  noter(
    '« Annuler » n’a lancé aucune publication',
    cadresDeployStart.length === 0,
    `${cadresDeployStart.length} envoi(s)`,
  );
  /* Le tiroir de production se referme avant de revenir aux colonnes. */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  /* -------- Le pied de « À déployer » archive, à la main -------- */

  await page.locator('[data-column="to_deploy"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const auRepos = (await entreesDuMenu(page, 'to_deploy')).join(' | ');
  noter('le menu de « À déployer » propose « Tout archiver »', auRepos.includes('Tout archiver'), auRepos);
  noter(
    'il ne propose PLUS « Tout mettre en production »',
    !auRepos.includes('Tout mettre en production'),
    auRepos,
  );
  noter(
    'le bandeau de titre ne porte plus de bouton « Tout archiver »',
    !(await page.evaluate(() =>
      [...(document.querySelector('[data-tete-colonne="to_deploy"]')?.querySelectorAll('button') ?? [])].some((b) =>
        /Tout archiver/.test(b.textContent ?? ''),
      ),
    )),
  );

  await ouvrirGesteDeLot(page, 'to_deploy');
  await page.waitForTimeout(800);
  const sorties = await cases(page, 'to_deploy');
  noter(
    'un premier clic sort une case par carte, toutes cochées',
    sorties.length === 3 && sorties.every((c) => c.cochee),
    `${sorties.length} case(s)`,
  );

  // La colonne trie du plus récent au plus ancien : la première case est la
  // carte C. On la décoche — elle seule doit rester dans « À déployer ».
  const gardee = sorties[0]?.titre ?? '';
  await page.evaluate(() => {
    document.querySelector('[data-column="to_deploy"]')?.querySelectorAll('button[aria-pressed]')[0]?.click();
  });
  await page.waitForTimeout(500);
  noter(
    'le compteur du pied suit la sélection',
    (await pied(page, 'to_deploy')).some((t) => /Archiver \(2\)/.test(t)),
    (await pied(page, 'to_deploy')).join(' | '),
  );

  await cliquerPied(page, 'Archiver', 'to_deploy');
  await page.waitForTimeout(4000);

  const apres = colonnesEnBase();
  noter(
    'les cartes cochées sont passées en « Archivé »',
    TITRES.filter((t) => t !== gardee).every((t) => apres[t] === 'archived'),
    JSON.stringify(apres),
  );
  noter(`la carte décochée (« ${gardee} ») est restée dans « À déployer »`, apres[gardee] === 'to_deploy', apres[gardee]);

  /* -------- Une carte reprise retombe à l’étape juste avant -------- */

  await page.locator('[data-column="to_deploy"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const col = document.querySelector('[data-column="to_deploy"]');
    col?.querySelector('article h3')?.closest('article')?.click();
  });
  await page.waitForTimeout(1500);
  const reprise = await page.evaluate(() => {
    const bouton = document.querySelector('[data-geste="reprendre"]');
    return bouton ? (bouton.textContent ?? '') : null;
  });
  /* La colonne d'avant « À déployer » s'appelle « Rapport » à l'écran
     (`COLUMN_LABELS.done`) : le contrôle attendait encore « Terminé ». */
  /* « Remettre en demande » a disparu (demande du 02.10.2026) : écrire à
     l'agent ramène déjà la carte. La fin de tâche n'a qu'un bouton. */
  noter('une carte « À déployer » ne propose plus de retomber en « Demande »', reprise === null, reprise ?? '—');
  noter(
    'une carte « À déployer » n’a qu’un bouton « Déployer », sans liste',
    await page.evaluate(
      () =>
        document.querySelectorAll('[data-geste="deployer-lot"]').length === 1 &&
        document.querySelectorAll('[data-bouton-fin-de-tache]').length === 0,
    ),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  /* -------- « Tout déployer » ouvre l'ÉCRAN DE SÉLECTION, puis part -------- */

  // Le déploiement passe désormais par un écran de sélection des tâches
  // (cases cochées d'avance) : le premier clic l'OUVRE, et c'est le bouton
  // « Déployer (n) » de cet écran qui envoie `deploy.start`. Ce qui compte —
  // et qui manquait — c'est que le clic finisse RÉELLEMENT par partir : un
  // bouton qui n'envoie rien est le bogue qu'on verrouille ici. (Fait en
  // dernier : le run lancé sur ce dépôt d'essai isolé n'importe plus.)
  cadresDeployStart.length = 0;
  await page.evaluate(() => {
    document.querySelector('[data-bloc-publication="to_deploy"] [data-bouton-publication]')?.click();
  });
  await page.waitForTimeout(900);
  const ecranSelection = await page.evaluate(() => !!document.querySelector('[data-selection-deploiement]'));
  noter('« Tout déployer » ouvre l’écran de sélection des tâches', ecranSelection);
  noter(
    'l’écran de sélection n’a rien envoyé tant qu’on n’a pas confirmé',
    cadresDeployStart.length === 0,
    `${cadresDeployStart.length} envoi(s)`,
  );

  await page.evaluate(() => {
    document.querySelector('[data-bouton-deployer-selection]')?.click();
  });
  await page.waitForTimeout(1200);
  noter(
    'le bouton « Déployer » de l’écran envoie RÉELLEMENT deploy.start',
    cadresDeployStart.length >= 1,
    `${cadresDeployStart.length} envoi(s)`,
  );

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await contexte.close();

  /* -------- Sur téléphone -------- */

  /*
   * LA RANGÉE D'ONGLETS DE COLONNES N'EXISTE PLUS (`board.tsx`) : sous
   * l'entête, elle prenait la place que le bandeau de mise en production et le
   * menu du bas se disputent déjà. Les trois contrôles qui la lisaient
   * (`data-onglet-colonne`) sont retirés — et « Archivé » n'est de toute façon
   * plus une colonne du tableau : ses cartes vivent dans le tiroir
   * « Archives », éprouvé par `verif-sortie-archive.mjs`.
   */
  const { page: tel, contexte: ctxTel } = await ouvrirLeTableau(navigateur, { width: 390, height: 844 });
  noter(
    'sur téléphone, aucune rangée d’onglets de colonnes ne revient',
    (await tel.locator('[data-onglet-colonne]').count()) === 0,
  );
  noter(
    'sur téléphone, la colonne « Archivé » n’est pas dessinée non plus',
    (await tel.locator('[data-column="archived"]').count()) === 0,
  );
  await tel.screenshot({ path: path.join(TMP, 'telephone.png') });
  await ctxTel.close();

  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) console.log(`(captures et journal dans ${TMP})`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.slice(-20).join(''));
  process.exit(1);
});
