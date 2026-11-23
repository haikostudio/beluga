#!/usr/bin/env node
/**
 * LES BACKUPS DES SITES EN PRODUCTION, dans un VRAI navigateur, sur son
 * PROPRE démon (base neuve, port libre, disque de stockage jetable : le démon
 * de production n'est pas touché, aucun moteur appelé, aucun quota dépensé).
 *
 * Ce qu'il exige, un contrôle par promesse de la carte :
 *
 *  1. la migration crée les tables des sites et des points de sauvegarde ;
 *  2. le bouton « Backup » est DANS la grille des services (bouton à quatre carrés de la barre
 *     d'en-tête) et ouvre la page des backups ;
 *  3. sans dossier de stockage réglé, la fenêtre le DIT au lieu d'empiler des échecs ;
 *  4. un site configuré paraît dans la liste avec sa base et ses fichiers ;
 *  5. « Sauvegarder » rejoue la recette POUR DE VRAI : une archive zip sur le disque de
 *     stockage, avec la base, les fichiers et le manifeste, jugée sur son inventaire relu ;
 *  6. la fenêtre d'HISTORIQUE montre le point pris, sa date et le volume du site ;
 *  7. « Nouveau site » ouvre l'ASSISTANT — une phrase, plus un formulaire —
 *     et les projets du serveur y sont proposés sans ressaisir leur nom ;
 *  8. les projets du serveur SANS fiche sont proposés d'un clic dans la fenêtre ;
 *  9. une fiche qui échoue porte son bouton « Réparer », et une fiche posée par
 *     l'assistant porte le bouton qui ROUVRE sa conversation ;
 * 10. « Restaurer » sur un point, confirmé, écrase POUR DE VRAI la base et les
 *     fichiers du site avec ceux du point — y compris un fichier apparu depuis
 *     (mirroir complet, pas une simple copie par-dessus) — après un FILET pris juste avant,
 *     qui reste dans l'historique.
 *
 *   node scripts/verif-backups.mjs
 *
 * RECALÉ SUR LA REFONTE (11/10/2026). Les services s'ouvrent par la grille du
 * bouton de la barre d'en-tête (`scripts/lib/navigation.mjs`), plus par une
 * ligne de la colonne de gauche. Les backups sont une PAGE de la zone
 * principale (`[data-ecran-plein]`), et ses gestes — « Tout sauvegarder »,
 * « Nouveau site » — montent dans la barre d'en-tête (`GestesDePage`) : ils ne
 * sont plus DANS la page, on les vise donc dans le document. L'assistant, la
 * fiche d'un site et la conversation sont des pages posées par-dessus, non
 * modales : celle des backups reste montée dessous.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ouvrirNavigation } from './lib/navigation.mjs';
import { optionsDeLaListe } from './lib/liste-deroulante.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const yauzl = createRequire(import.meta.url)('yauzl');

/** Les noms des entrées d'une archive zip, ou `null` si elle ne s'ouvre pas. */
function entreesDuZip(chemin) {
  return new Promise((resolve) => {
    yauzl.open(chemin, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return resolve(null);
      const noms = [];
      zip.on('entry', (entree) => {
        noms.push(entree.fileName);
        zip.readEntry();
      });
      zip.on('end', () => resolve(noms));
      zip.on('error', () => resolve(null));
      zip.readEntry();
    });
  });
}
const PORT = Number(process.env.BELUGA_BACKUPS_PORT || 7213);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-backups-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
/* Le « disque de stockage » : un dossier jetable qui joue le disque monté. */
const STOCKAGE = path.join(TMP, 'stockage');
/* Le site à sauvegarder : une base SQLite et un dossier de fichiers. */
const SITE = path.join(TMP, 'site');
for (const dossier of [DATA, PROJETS, STOCKAGE, SITE]) fs.mkdirSync(dossier, { recursive: true });

const BASE_DU_SITE = path.join(SITE, 'boutique.sqlite');
{
  const db = new Database(BASE_DU_SITE);
  db.exec('CREATE TABLE commandes (id INTEGER PRIMARY KEY, client TEXT)');
  db.prepare('INSERT INTO commandes (client) VALUES (?)').run('Chris');
  db.close();
}
const FICHIERS_DU_SITE = path.join(SITE, 'public');
fs.mkdirSync(FICHIERS_DU_SITE, { recursive: true });
fs.writeFileSync(path.join(FICHIERS_DU_SITE, 'index.html'), '<h1>Boutique</h1>\n'.repeat(200));

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_WEB: process.env.BELUGA_WEB_ESSAI || path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const journal = [];
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));

const ranger = () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
};
process.on('exit', ranger);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    ranger();
    process.exit(130);
  });
}

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

async function attendreLesTables(limiteMs = 30000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
      const sites = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='backup_sites'").get();
      const points = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='backup_points'").get();
      db.close();
      if (sites && points) return true;
    } catch {
      /* base pas encore là */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-backups';
const PROJET_NOM = 'Boutique en ligne';

/* Après un rechargement, l'adresse garde la vue « backups » : elle se rouvre
   d'elle-même. Sinon (tableau affiché), on l'ouvre par la grille des services. */
async function rouvrirLesBackups(page, fenetre) {
  await page.waitForSelector('[data-column="planned"], [data-backups-creer]', { timeout: 30000 });
  if (!(await fenetre.isVisible())) {
    await ouvrirNavigation(page);
    await page.click('[data-navigation-panneau="ouvert"] [data-ouvrir-backups]');
  }
  await fenetre.waitFor({ state: 'visible', timeout: 15000 });
  // La vue se monte en deux temps (page, puis données) : on laisse le second finir avant de saisir.
  await page.waitForTimeout(1000);
  // L'adresse garde aussi la fiche ouverte (#backups/<site>) : on la referme, la liste est ce qu'on veut.
  if (/#backups\//.test(page.url())) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
}

function poserLeDecor({ avecStockage }) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();

  db.prepare('INSERT OR REPLACE INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification des backups',
  );

  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(
    JSON.stringify({
      ...reglages,
      maxAgents: 0,
      // Le passage AUTOMATIQUE est éteint : ce contrôle vérifie les gestes, pas
      // l'horloge — un passage de nuit qui partirait au milieu fausserait tout.
      backupAuto: false,
      backupDossier: avecStockage ? STOCKAGE : '',
    }),
  );

  const dejaLa = db.prepare('SELECT 1 FROM projects WHERE id = ?').get(PROJET_ID);
  if (!dejaLa) {
    const projet = {
      id: PROJET_ID,
      name: PROJET_NOM,
      path: PROJETS,
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
  }
  db.close();
}

/** Les points de sauvegarde tels que la base les porte à cet instant. */
/**
 * LA FICHE D'UN SITE, POSÉE COMME L'ASSISTANT LA POSERAIT. Depuis que la
 * création passe par un agent, la remplir à la souris n'est plus possible : on
 * écrit donc la même ligne, dans la même table, avec les mêmes champs.
 */
function poserLeSite() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  const site = {
    id: 'site-boutique',
    nom: 'Boutique — production',
    projectId: null,
    actif: true,
    base: { moteur: 'sqlite', hote: '', port: '', nom: BASE_DU_SITE, utilisateur: '', motDePasse: '' },
    fichiers: { moyen: 'local', chemin: FICHIERS_DU_SITE, hote: '', port: '', utilisateur: '', motDePasse: '' },
    conservationJours: 14,
    note: '',
    creeLe: maintenant,
    modifieLe: maintenant,
  };
  db.prepare(
    `INSERT INTO backup_sites (id, project_id, nom, actif, data, cree_le, modifie_le)
     VALUES (?, NULL, ?, 1, ?, ?, ?)`,
  ).run(site.id, site.nom, JSON.stringify(site), maintenant, maintenant);
  db.close();
}

/**
 * TROIS SITES DE PLUS, pour que le TABLEAU montre au moins cinq lignes et que
 * la RECHERCHE ait de quoi filtrer. Chacun porte sa propre FRÉQUENCE.
 */
function poserSitesSupplementaires() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  const sites = [
    // Une fiche d'AVANT la cadence en minutes (elle ne porte que des jours) :
    // elle doit se relire sans migration.
    { id: 'site-vitrine', nom: 'Vitrine — production', frequenceJours: 3 },
    { id: 'site-blog', nom: 'Blog — production', frequenceMinutes: 42 },
    { id: 'site-intranet', nom: 'Intranet — interne', frequenceMinutes: 60 },
  ];
  for (const s of sites) {
    const site = {
      id: s.id,
      nom: s.nom,
      projectId: null,
      actif: true,
      base: { moteur: 'sqlite', hote: '', port: '', nom: BASE_DU_SITE, utilisateur: '', motDePasse: '' },
      fichiers: { moyen: 'local', chemin: FICHIERS_DU_SITE, hote: '', port: '', utilisateur: '', motDePasse: '' },
      conservationJours: 14,
      ...(s.frequenceJours ? { frequenceJours: s.frequenceJours } : {}),
      ...(s.frequenceMinutes ? { frequenceMinutes: s.frequenceMinutes } : {}),
      note: '',
      creeLe: maintenant,
      modifieLe: maintenant,
    };
    db.prepare(
      `INSERT INTO backup_sites (id, project_id, nom, actif, data, cree_le, modifie_le)
       VALUES (?, NULL, ?, 1, ?, ?, ?)`,
    ).run(site.id, site.nom, JSON.stringify(site), maintenant, maintenant);
  }
  db.close();
}

function frequenceEnBase(id) {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const ligne = db.prepare('SELECT data FROM backup_sites WHERE id = ?').get(id);
  db.close();
  return ligne ? JSON.parse(ligne.data).frequenceMinutes : undefined;
}

/**
 * UNE FICHE QUI ÉCHOUE NUIT APRÈS NUIT, posée avec ses points en échec et la
 * CONVERSATION de l'assistant qui l'a écrite. On ne clique pas sur ses boutons :
 * réparer ou rouvrir la conversation lancerait un vrai tour de moteur — ce qui
 * se vérifie ici, c'est que les deux chemins EXISTENT sur la bonne ligne.
 */
function poserLeSiteEnEchec() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  const site = {
    id: 'site-casse',
    nom: 'Site cassé — production',
    projectId: null,
    actif: true,
    base: { moteur: 'aucune', hote: '', port: '', nom: '', utilisateur: '', motDePasse: '' },
    fichiers: { moyen: 'local', chemin: path.join(TMP, 'dossier-parti'), hote: '', port: '', utilisateur: '', motDePasse: '' },
    conservationJours: 14,
    note: '',
    assistantId: 'agent-assistant',
    assistantProjectId: PROJET_ID,
    creeLe: maintenant,
    modifieLe: maintenant,
  };
  db.prepare(
    `INSERT INTO backup_sites (id, project_id, nom, actif, data, cree_le, modifie_le)
     VALUES (?, NULL, ?, 1, ?, ?, ?)`,
  ).run(site.id, site.nom, JSON.stringify(site), maintenant, maintenant);

  for (let i = 0; i < 3; i += 1) {
    const point = {
      id: `point-echec-${i}`,
      siteId: site.id,
      debut: maintenant - i * 86400000,
      fin: maintenant - i * 86400000 + 1000,
      statut: 'echec',
      octetsBase: 0,
      octetsFichiers: 0,
      chemin: '',
      detail: 'fichiers : dossier introuvable',
      origine: 'automatique',
    };
    db.prepare('INSERT INTO backup_points (id, site_id, debut, statut, data) VALUES (?, ?, ?, ?, ?)').run(
      point.id,
      point.siteId,
      point.debut,
      point.statut,
      JSON.stringify(point),
    );
  }
  db.close();
}

function pointsEnBase() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const lignes = db
    .prepare('SELECT data, chemin_archive, taille, inventaire FROM backup_points ORDER BY debut DESC')
    .all();
  db.close();
  // L'archive, son poids et son inventaire ont leurs colonnes : le bloc ne les porte pas.
  return lignes.map((l) => ({
    ...JSON.parse(l.data),
    cheminArchive: l.chemin_archive ?? '',
    taille: l.taille ?? 0,
    inventaire: l.inventaire ? JSON.parse(l.inventaire) : null,
  }));
}

async function main() {
  if (!(await attendrePort())) throw new Error(`le démon d'essai n'a jamais ouvert le port ${PORT}`);
  if (!(await attendreLesTables())) {
    throw new Error('les tables des backups ne sont jamais apparues : la migration n’a pas tourné');
  }
  noter('La migration crée les tables des sites et des points de sauvegarde', true);

  // Premier temps : AUCUN dossier de stockage réglé.
  poserLeDecor({ avecStockage: false });

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-CH' });
    await contexte.addCookies([
      { name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-column="planned"]', { timeout: 30000 });
    await page.waitForTimeout(600);

    /* 2. Le bouton vit dans la GRILLE DES SERVICES et ouvre la page. La grille
       n'est dans le document qu'OUVERTE : on l'ouvre pour le compter. */
    await ouvrirNavigation(page);
    const bouton = page.locator('[data-navigation-panneau="ouvert"] [data-ouvrir-backups]');
    noter('Le bouton « Backup » est dans la grille des services', (await bouton.count()) === 1);
    await bouton.click();
    /* LES BACKUPS SONT UNE PAGE de la zone principale, sous son grand titre.
       « Nouveau site » est monté dans la barre d'en-tête (`GestesDePage`) : il
       n'est plus DANS la page, on l'attend donc dans le document. */
    const fenetre = page.locator('[data-ecran-plein][data-state="open"]', {
      has: page.locator('[data-titre-de-page]', { hasText: 'Backups' }),
    });
    const nouveauSite = page.locator('[data-backups-creer]:visible').first();
    await fenetre.waitFor({ state: 'visible', timeout: 15000 });
    await nouveauSite.waitFor({ state: 'visible', timeout: 15000 });
    noter('La fenêtre des backups s’ouvre au clic', true);

    /* 3. SANS DOSSIER RÉGLÉ, UN DOSSIER « BACKUPS » EST CRÉÉ TOUT SEUL : la
       fenêtre n'avertit plus, elle DIT où les points vont se poser. */
    const avertissement = fenetre.locator('[data-backups-sans-destination]');
    const entete = (await fenetre.innerText()).trim();
    noter(
      'Sans dossier réglé, aucun avertissement : un dossier « Backups » est créé tout seul',
      (await avertissement.count()) === 0 && /Backups/.test(entete),
      entete.split('\n').find((l) => l.includes('Backups')) ?? entete.slice(0, 120),
    );
    noter(
      'Le dossier « Backups » existe vraiment sur le disque',
      fs.existsSync(path.join(DATA, 'Backups')),
    );

    /* On règle le disque de stockage, puis on recharge : l'avertissement part. */
    poserLeDecor({ avecStockage: true });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await rouvrirLesBackups(page, fenetre);
    await page.waitForTimeout(400);
    noter(
      'Le dossier de stockage réglé fait disparaître l’avertissement',
      (await fenetre.locator('[data-backups-sans-destination]').count()) === 0,
    );

    /* 7. « Nouveau site » ouvre l'ASSISTANT, et les projets du serveur y sont
       proposés sans ressaisir leur nom. Aucun tour de moteur n'est lancé ici :
       ce contrôle vérifie la porte, pas le travail de l'agent — les règles de
       lecture de sa fiche sont verrouillées par `backups-agent.test.ts`. */
    await nouveauSite.click();
    const assistant = page.locator('[role="dialog"][data-state="open"]', {
      has: page.locator('[data-backups-configurer]'),
    });
    await assistant.waitFor({ state: 'visible', timeout: 10000 });
    noter('« Nouveau site » ouvre l’assistant, plus un formulaire à remplir', true);

    const optionsProjet = (await optionsDeLaListe(assistant.locator('[data-backups-projet]'))).map((o) => o.texte);
    noter(
      'Les projets de ce serveur sont proposés sans ressaisir leur nom',
      optionsProjet.some((texte) => texte.includes(PROJET_NOM)),
      optionsProjet.join(' / ') || 'aucune option proposée',
    );

    const boutonConfigurer = assistant.locator('[data-backups-configurer]');
    noter('Sans description, l’assistant ne part pas', await boutonConfigurer.isDisabled());
    await assistant.locator('[data-backups-description]').fill('la boutique du client');
    noter('Une phrase suffit à rendre le bouton actif', await boutonConfigurer.isEnabled());
    await page.keyboard.press('Escape');
    await assistant.waitFor({ state: 'hidden', timeout: 10000 });

    /* 4. Le site à sauvegarder, avec sa base et ses fichiers. La fiche est posée
       comme l'assistant la poserait (mêmes champs, même table) : le tour de
       moteur qui l'aurait écrite coûterait un quota et n'apprendrait rien de
       plus sur la suite — ce qui est vérifié ici, c'est la SAUVEGARDE réelle. */
    poserLeSite();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await rouvrirLesBackups(page, fenetre);

    const lignes = page.locator('[data-backups-site]');
    await lignes.first().waitFor({ state: 'visible', timeout: 10000 });
    noter('Le site configuré paraît dans la liste', (await lignes.count()) === 1);

    /* 5. « Sauvegarder » copie POUR DE VRAI. */
    await page.click('[data-backups-lancer]');
    const finPrise = Date.now() + 60000;
    let points = [];
    while (Date.now() < finPrise) {
      points = pointsEnBase();
      if (points.length) break;
      await page.waitForTimeout(500);
    }
    const point = points[0];
    noter('Le clic « Sauvegarder » pose un point de sauvegarde', !!point, point?.detail ?? 'aucun point enregistré');
    noter(
      'Le point est RÉUSSI : base et fichiers ont été pris',
      point?.statut === 'reussi',
      `statut=${point?.statut} détail=${point?.detail}`,
    );

    /* Le point est UNE ARCHIVE ZIP sur le disque de stockage, rejouée depuis la
       recette déduite de la fiche (le site n'a pas été analysé), et c'est son
       inventaire RELU qui l'a jugée réussie. */
    const archive = point?.cheminArchive ?? '';
    const entrees = archive && fs.existsSync(archive) ? await entreesDuZip(archive) : null;
    noter(
      'Le point est une archive zip posée SUR le disque de stockage',
      archive.startsWith(STOCKAGE) && archive.endsWith('.zip') && !!entrees,
      archive,
    );
    noter('La base du site est dans l’archive', !!entrees?.includes('base/base.sqlite'), (entrees ?? []).slice(0, 6).join(', '));
    noter('Les fichiers du site sont dans l’archive', !!entrees?.includes('fichiers/index.html'));
    noter('L’archive porte son manifeste', !!entrees?.includes('manifeste.json'));
    noter(
      'L’inventaire relu dit chaque étape prise, et le poids de l’archive n’est pas nul',
      (point?.taille ?? 0) > 0 &&
        point?.inventaire?.etapes?.length === 2 &&
        point.inventaire.etapes.every((etape) => etape.ok),
      `taille=${point?.taille} étapes=${(point?.inventaire?.etapes ?? []).map((e) => `${e.id}:${e.ok}`).join(',')}`,
    );

    /* 6. LE BOUTON « HISTORIQUE » A DISPARU, et son contenu vit désormais dans
       la fiche du site, ouverte d'un clic sur le site lui-même. */
    noter(
      'Le bouton « Historique » n’existe plus',
      (await fenetre.locator('[data-backups-historique]').count()) === 0,
    );
    await fenetre.locator('[data-backups-site] button').first().click();
    const fiche = page.locator('[role="dialog"][data-state="open"]', {
      has: page.locator('[data-backups-point]'),
    });
    await fiche.waitFor({ state: 'visible', timeout: 10000 });
    const texte = (await fiche.innerText()).replace(/\s+/g, ' ');
    noter('La fiche du site montre le point pris', (await fiche.locator('[data-backups-point]').count()) === 1);
    noter(
      'La fiche porte le volume de l’historique du site',
      /point\(s\)/.test(texte) && /(o|Ko|Mo|Go)\b/.test(texte),
      texte.slice(0, 160),
    );
    noter(
      'La fiche dit la date de la sauvegarde',
      /\d{1,2}\s+\p{L}+.*\d{2}:\d{2}/u.test(texte),
      texte.slice(0, 160),
    );
    noter(
      'La fiche montre la recette qui tourne, étape par étape',
      (await fiche.locator('[data-backups-recette-site] [data-backups-etape]').count()) === 2,
    );
    noter('Le point montre ce que son archive contient', (await fiche.locator('[data-backups-inventaire]').count()) === 1);

    /* Les données de la fiche tombent en COLONNES : pastilles des étapes de la
       recette, et « n fichier(s) — volume » de l'historique, alignés à droite. */
    const bordsDroits = async (locator) => {
      const boites = await locator.evaluateAll((noeuds) => noeuds.map((n) => Math.round(n.getBoundingClientRect().right)));
      return boites;
    };
    const droitesPastilles = await bordsDroits(fiche.locator('[data-backups-etape] > span:first-child > span:last-child > *'));
    noter(
      'Les pastilles des étapes de la recette sont alignées',
      droitesPastilles.length >= 2 && droitesPastilles.every((x) => Math.abs(x - droitesPastilles[0]) <= 1),
      droitesPastilles.join(','),
    );
    const droitesVolumes = await bordsDroits(fiche.locator('[data-backups-inventaire] li > span:last-child'));
    noter(
      'Les volumes de l’historique sont alignés en colonne',
      droitesVolumes.length >= 2 && droitesVolumes.every((x) => Math.abs(x - droitesVolumes[0]) <= 1),
      droitesVolumes.join(','),
    );
    noter(
      'L’explication de la recette n’est plus un pavé sous son titre',
      (await fiche.locator('[data-backups-recette-site] > p.leading-relaxed.text-faint').count()) === 0,
    );

    await page.keyboard.press('Escape');
    await fiche.waitFor({ state: 'hidden', timeout: 10000 });

    /* 8. UN SEUL TABLEAU (carte « Services homogènes et centrés », 14/11/2026) : les projets de ce serveur qui n'ont
       pas encore de sauvegarde sont des LIGNES du même tableau, sous les sites, avec l'état « Sans sauvegarde » et
       « Configurer ». Plus de second tableau ni de seconde recherche : la recherche de la page les filtre aussi. */
    const proposes = page.locator('[data-backups-projet-ligne]');
    noter('Un seul tableau dans la page', (await page.locator('[data-tableau="backups"]').count()) === 1);
    noter('Plus aucun bloc dépliant pour les projets sans fiche', (await page.locator('[data-backups-projets-toggle]').count()) === 0);
    noter(
      'Les projets sans sauvegarde sont des lignes du tableau, avec « Configurer »',
      (await proposes.count()) >= 1 && (await page.locator('[data-backups-tableau] [data-backups-projet-ligne] [data-backups-projet-sans-fiche]').count()) >= 1,
      (await proposes.count()) ? await proposes.first().innerText() : 'aucun projet proposé',
    );
    noter('Une seule recherche dans la page', (await page.locator('[data-backups-recherche]').count()) === 1);
    await page.locator('[data-backups-recherche]').fill('zzz-introuvable');
    await page.waitForTimeout(200);
    noter('La recherche de la page filtre aussi les projets sans sauvegarde', (await proposes.count()) === 0);
    await page.locator('[data-backups-recherche]').fill('');
    await page.waitForTimeout(200);

    /* 10. « Restaurer » écrase POUR DE VRAI ce que le site porte aujourd'hui.
       On fait dériver la base et les fichiers depuis la prise — une commande
       de plus, un fichier intrus apparu depuis — puis on restaure le point et
       on vérifie que le site retrouve EXACTEMENT l'état de la sauvegarde. Le
       rechargement de la fiche 9, juste après, nettoie les fenêtres : pas
       besoin de refermer proprement celle-ci. */
    {
      const baseDerive = new Database(BASE_DU_SITE);
      baseDerive.prepare('INSERT INTO commandes (client) VALUES (?)').run('Intrus');
      baseDerive.close();
      fs.writeFileSync(path.join(FICHIERS_DU_SITE, 'index.html'), '<h1>Piraté</h1>\n');
      fs.writeFileSync(path.join(FICHIERS_DU_SITE, 'malware.txt'), 'intrus');

      await fenetre.locator('[data-backups-site] button').first().click();
      await fiche.waitFor({ state: 'visible', timeout: 10000 });
      await fiche.locator('[data-backups-restaurer]').click();
      const confirmation = page.locator('[role="dialog"][data-state="open"]', {
        has: page.locator('text=/Restaurer ce point/'),
      });
      await confirmation.waitFor({ state: 'visible', timeout: 10000 });
      await confirmation.getByRole('button', { name: 'Restaurer', exact: true }).click();

      const finRestauration = Date.now() + 60000;
      let restaure = false;
      let dernierEtat = '';
      while (Date.now() < finRestauration) {
        try {
          const lignes = new Database(BASE_DU_SITE, { readonly: true }).prepare('SELECT client FROM commandes').all();
          const html = fs.readFileSync(path.join(FICHIERS_DU_SITE, 'index.html'), 'utf8');
          const malwareParti = !fs.existsSync(path.join(FICHIERS_DU_SITE, 'malware.txt'));
          dernierEtat = `clients=${lignes.map((l) => l.client).join(',')} html=${html.slice(0, 20)} malware_parti=${malwareParti}`;
          if (lignes.length === 1 && lignes[0].client === 'Chris' && html.includes('Boutique') && malwareParti) {
            restaure = true;
            break;
          }
        } catch {
          /* base en cours de réécriture par la restauration : on réessaie */
        }
        await page.waitForTimeout(500);
      }
      noter(
        'Restaurer un point remet la base et les fichiers dans l’état de la sauvegarde',
        restaure,
        dernierEtat,
      );
      noter(
        'Un filet est pris juste avant d’écraser, et reste dans l’historique',
        pointsEnBase().some((p) => /filet avant la restauration/.test(p.detail ?? '') && p.cheminArchive),
      );
    }

    /* 9. Une fiche qui échoue porte son bouton de réparation, et celle qu'un
       assistant a posée rouvre sa conversation. */
    poserLeSiteEnEchec();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await rouvrirLesBackups(page, fenetre);
    await page.locator('[data-backups-site="site-casse"]').waitFor({ state: 'visible', timeout: 10000 });

    noter(
      'Une fiche qui échoue porte son bouton « Réparer »',
      await page.locator('[data-backups-relire="site-casse"]').isVisible(),
    );
    noter(
      'La conversation de l’assistant se rouvre d’un clic depuis la fiche',
      await page.locator('[data-backups-conversation="site-casse"]').isVisible(),
    );
    noter(
      'Une fiche qui n’a jamais échoué ne propose pas de réparation',
      (await page.locator('[data-backups-relire="site-boutique"]').count()) === 0,
    );
    noter(
      'Un site sans recette de l’agent propose son analyse d’un clic, et dit que sa recette est déduite',
      (await page.locator('[data-backups-analyser="site-boutique"]').isVisible()) &&
        (await page.locator('[data-backups-site="site-boutique"] [data-backups-recette="fiche"]').count()) === 1,
    );

    /* 10. LE TABLEAU : au moins cinq sites, colonnes nom / fréquence / dernière
       prise / volume / statut, et la RECHERCHE qui filtre en temps réel. */
    poserSitesSupplementaires();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await rouvrirLesBackups(page, fenetre);
    await page.locator('[data-backups-site="site-vitrine"]').waitFor({ state: 'visible', timeout: 10000 });

    const tableau = fenetre.locator('[data-backups-tableau]');
    noter('La liste des sites est un vrai tableau', (await tableau.count()) === 1);
    const nbLignes = await fenetre.locator('[data-backups-site]').count();
    noter('Le tableau affiche au moins cinq sites', nbLignes >= 5, `${nbLignes} ligne(s)`);
    noter(
      'La fréquence de chaque site est affichée',
      (await fenetre.getByText('tous les 3 j').count()) >= 1 &&
        (await fenetre.getByText('toutes les 42 min').count()) >= 1,
    );

    /* La recherche filtre EN TEMPS RÉEL, sans recharger la page. */
    await fenetre.locator('[data-backups-recherche]').fill('Vitrine');
    await page.waitForTimeout(200);
    noter(
      'La recherche ne garde que ce qui correspond',
      (await fenetre.locator('[data-backups-site]').count()) === 1 &&
        (await fenetre.locator('[data-backups-site="site-vitrine"]').isVisible()),
      `${await fenetre.locator('[data-backups-site]').count()} ligne(s) ; champ = « ${await fenetre.locator('[data-backups-recherche]').inputValue()} »`,
    );
    await fenetre.locator('[data-backups-recherche]').fill('zzz-introuvable');
    await page.waitForTimeout(200);
    noter(
      'La recherche dit quand rien ne correspond',
      (await fenetre.locator('[data-backups-site]').count()) === 0,
    );
    await fenetre.locator('[data-backups-recherche]').fill('');
    await page.waitForTimeout(200);

    /* À 390 px : la liste (fiches) et le tableau des projets ne débordent pas, chaque ligne de projet garde son bouton. */
    const tailleAvant = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const debordeTel = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    noter('à 390 px, la liste des backups ne déborde pas', !debordeTel);
    await page.locator('[data-backups-projet-ligne]').first().scrollIntoViewIfNeeded();
    const boutonsTel = await page.evaluate(() =>
      [...document.querySelectorAll('[data-backups-projet-sans-fiche]')].every((b) => b.getBoundingClientRect().right <= window.innerWidth),
    );
    noter('à 390 px, chaque projet sans sauvegarde garde son bouton dans l’écran', boutonsTel);
    await page.screenshot({ path: path.join(os.tmpdir(), 'verif-backups-liste-390.png') });
    await fenetre.locator('[data-backups-site="site-vitrine"] button').first().click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(os.tmpdir(), 'verif-backups-fiche-390.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    if (tailleAvant) await page.setViewportSize(tailleAvant);

    /* 11. LA FRÉQUENCE SE RÈGLE DANS LA FICHE, ET SE RETROUVE ENREGISTRÉE. */
    await page.locator('[data-backups-site="site-intranet"] button').first().click();
    const ficheOuverte = page.locator('[role="dialog"][data-state="open"]', {
      has: page.locator('[data-backups-frequence]'),
    });
    await ficheOuverte.waitFor({ state: 'visible', timeout: 10000 });
    await ficheOuverte.locator('[data-backups-frequence]').fill('15');
    await ficheOuverte.locator('[data-backups-enregistrer]').click();
    await ficheOuverte.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(300);
    noter(
      'La fréquence en MINUTES choisie dans la fiche est enregistrée sur le site',
      frequenceEnBase('site-intranet') === 15,
    );

    /* 11 bis. UNE FICHE D'AVANT, RÉGLÉE EN JOURS, SE LIT SANS MIGRATION, et une
       cadence en minutes s'affiche dans son unité. */
    const ligneVitrine = await page.locator('[data-backups-site="site-vitrine"]').innerText();
    const ligneBlog = await page.locator('[data-backups-site="site-blog"]').innerText();
    noter('Une fiche réglée en jours se lit encore « tous les 3 j »', /3\s*j/.test(ligneVitrine));
    noter('Une cadence de 42 minutes s’affiche en minutes', /42\s*min/.test(ligneBlog));

    /* 12. L'ASSISTANT S'OUVRE DANS SA PAGE, POSÉE PAR-DESSUS : la page des
       backups reste ouverte DERRIÈRE, on ne quitte jamais le service. */
    await page.locator('[data-backups-conversation="site-casse"]').click();
    const tiroirConversation = page.locator('[data-backups-conversation-tiroir]');
    await tiroirConversation.waitFor({ state: 'visible', timeout: 10000 });
    noter('La conversation de l’assistant s’ouvre dans une page posée par-dessus', true);
    noter(
      'La page des backups reste ouverte DERRIÈRE : on n’a pas quitté le service',
      await fenetre.isVisible(),
    );

    const SHOTS = path.join(RACINE, 'data', 'verification');
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'backups.png') });

    /* 13. SUR TÉLÉPHONE, LES SITES SONT DES FICHES, PAS UN TABLEAU. Six
       colonnes dans 390 px rognaient le statut et poussaient les boutons hors
       de l'écran. On repasse donc l'écran en largeur de téléphone et on juge
       trois choses : plus aucun tableau, une fiche par site, rien qui déborde
       de la largeur, et le TRI par menu (les entêtes cliquables n'existent
       plus) qui classe réellement. */
    /* On RÉTRÉCIT la fenêtre sans recharger : la page des backups, déjà
       ouverte, le reste, et le rendu bascule sur la largeur. */
    await page.keyboard.press('Escape');
    await tiroirConversation.waitFor({ state: 'hidden', timeout: 10000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.locator('[data-backups-fiches]').waitFor({ state: 'visible', timeout: 10000 });

    noter(
      'Sur téléphone, plus aucun tableau : une fiche par site',
      (await fenetre.locator('[data-backups-tableau]').count()) === 0 &&
        (await fenetre.locator('[data-backups-fiches]').count()) === 1,
    );
    const nbFiches = await fenetre.locator('[data-backups-site]').count();
    noter('Chaque site a sa fiche, aucune en double', nbFiches >= 5, `${nbFiches} fiche(s)`);

    /* RIEN N'EST COUPÉ : chaque fiche, sa pastille de statut et son bouton
       « Sauvegarder » tiennent DANS la largeur de l'écran. C'est un ÉTAT qu'on
       mesure (dedans / dehors), pas une hauteur. */
    const debordements = await page.evaluate(() => {
      const large = window.innerWidth;
      const hors = [];
      for (const fiche of document.querySelectorAll('[data-backups-fiches] [data-backups-site]')) {
        for (const element of [fiche, ...fiche.querySelectorAll('[data-backups-lancer], .badge, span')]) {
          const cadre = element.getBoundingClientRect();
          if (cadre.width > 0 && (cadre.left < -1 || cadre.right > large + 1)) {
            hors.push(`${element.tagName} ${Math.round(cadre.left)}→${Math.round(cadre.right)} / ${large}`);
          }
        }
      }
      return hors;
    });
    noter('Aucun contenu de fiche ne sort de la largeur du téléphone', debordements.length === 0, debordements.slice(0, 3).join(' | '));

    const boutonLancer = page.locator('[data-backups-fiches] [data-backups-lancer]').first();
    noter('Le bouton « Sauvegarder » d’une fiche est visible et cliquable', await boutonLancer.isVisible());

    /* LE TRI DES FICHES, SUR TÉLÉPHONE, VIT DANS LE MENU D'OPTIONS de la rangée unique de la feuille (carte
       « Services homogènes et centrés ») : les mêmes clés que les entêtes du tableau, et un second appui inverse le
       sens. Plus de bouton de tri à côté du champ. */
    const options = page.locator('[data-options-de-zone]:visible').first();
    noter('Le menu d’options est dans la rangée de la feuille', (await options.count()) === 1);
    const nomsDeFiches = async () =>
      (await page.locator('[data-backups-fiches] [data-backups-site]').evaluateAll((n) =>
        n.map((f) => f.getAttribute('data-backups-site')),
      )) ?? [];
    const choisirLeTri = async (cle) => {
      await options.click();
      await page.locator(`[data-backups-tri-choix="${cle}"]`).click();
      await page.waitForTimeout(200);
    };
    await options.click();
    const cles = await page.locator('[data-backups-tri-choix]').evaluateAll((n) =>
      n.map((e) => e.getAttribute('data-backups-tri-choix')),
    );
    noter(
      'Le menu propose les quatre tris du tableau',
      JSON.stringify(cles) === JSON.stringify(['nom', 'dernier', 'volume', 'statut']),
      cles.join(','),
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await choisirLeTri('nom');
    const croissant = await nomsDeFiches();
    await choisirLeTri('nom');
    const decroissant = await nomsDeFiches();
    noter(
      'Le tri par le menu classe, et un second appui inverse le sens',
      croissant.length > 1 && JSON.stringify(croissant) === JSON.stringify([...decroissant].reverse()),
      `${croissant.join(',')} puis ${decroissant.join(',')}`,
    );

    await page.screenshot({ path: path.join(SHOTS, 'backups-telephone.png') });

    noter('Aucune erreur JavaScript de page pendant le scénario', erreurs.length === 0, erreurs.join(' | '));
  } finally {
    await navigateur.close();
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis.`);
  if (echecs.length) console.log('Journal du démon :\n' + journal.join(''));
  // On SORT explicitement : le démon d'essai tiendrait la boucle éveillée.
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error('ÉCHEC :', error);
  console.log('Journal du démon :\n' + journal.join(''));
  process.exit(1);
});
