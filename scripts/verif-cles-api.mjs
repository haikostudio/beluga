#!/usr/bin/env node
/**
 * UN SERVICE EXTÉRIEUR PEUT-IL VRAIMENT POSER UNE CARTE, ET LA RÉVOCATION
 * FERME-T-ELLE VRAIMENT LA PORTE ?
 *
 * Le contrôle demandé par la carte, joué EN ENTIER et dans l'ordre, sur un
 * démon à soi et dans un vrai navigateur :
 *
 *   1. une clé est GÉNÉRÉE depuis les réglages, à la souris, et son secret
 *      s'affiche UNE fois ;
 *   2. un appel HTTP réel, depuis le dehors, pose une carte avec cette clé ;
 *   3. la carte apparaît dans « Planifié » du BON projet, à l'écran comme en
 *      base — et AUCUN agent n'est né, rien n'est parti au moteur ;
 *   4. la clé est RÉVOQUÉE depuis les réglages, et le même appel est refusé ;
 *   5. les refus ordinaires sont refusés en le DISANT : sans clé, clé inventée,
 *      projet inconnu, envoi sans titre, mauvaise méthode.
 *
 *   node scripts/verif-cles-api.mjs
 *
 * Démon à soi, base jetable, dossier temporaire : aucune donnée réelle n'est
 * touchée, aucun quota dépensé, aucun moteur appelé. Le script juge le dépôt
 * d'où il PART, jamais le dossier principal.
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

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKO_CLES_API_PORT || 7196);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-cles-api-'));

const { ROUTE_CARTE_EXTERNE, PREFIXE_CLE_API } = await import(path.join(RACINE, 'shared/dist/index.js'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

console.log(`  …  dépôt jugé : ${RACINE}`);

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
for (const dossier of [DATA, PROJETS]) fs.mkdirSync(dossier, { recursive: true });

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

let navigateur;
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
/* Le décor : deux projets et une session d'une heure                  */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-chez-dupont';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification clés API',
  );

  /* Plafond d'agents à ZÉRO : aucun tour réel ne peut partir, quoi qu'il arrive. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const poser = (id, nom) =>
    db
      .prepare(
        `INSERT INTO projects (id, name, path, archived, data, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(
        id,
        nom,
        path.join(PROJETS, id),
        JSON.stringify({
          id,
          name: nom,
          path: path.join(PROJETS, id),
          defaultEngine: 'claude',
          isSelf: false,
          branchesDePublication: {},
          rank: 1000,
          archived: false,
          createdAt: maintenant,
          updatedAt: maintenant,
        }),
        maintenant,
        maintenant,
      );

  poser(PROJET_ID, 'Chez Dupont');
  poser('p-boulangerie', 'Boulangerie Léa');
  db.close();
}

function baseLecture() {
  return new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
}

/* ------------------------------------------------------------------ */
/* L'appel du dehors                                                   */
/* ------------------------------------------------------------------ */

async function appeler(corps, entetes = {}, methode = 'POST') {
  const reponse = await fetch(`${BASE}${ROUTE_CARTE_EXTERNE}`, {
    method: methode,
    headers: { 'content-type': 'application/json', ...entetes },
    body: methode === 'POST' ? JSON.stringify(corps) : undefined,
  });
  return { statut: reponse.status, corps: await reponse.json().catch(() => ({})) };
}
const avecCle = (corps, cle) => appeler(corps, { 'x-haikodev-cle': cle });

/* Les réglages s'ouvrent par l'adresse « #reglages » (`appliquerEcran`, app.tsx) :
   une couche par-dessus l'écran en cours, atteignable sans chercher un bouton. */
async function ouvrirLesReglages(page) {
  await page.evaluate(() => {
    window.location.hash = 'reglages';
  });
  await page.getByRole('tab', { name: 'Accès API' }).click({ timeout: 20000 });
}

/* ------------------------------------------------------------------ */
/* Le déroulé                                                          */
/* ------------------------------------------------------------------ */

try {
  if (!(await attendrePort())) {
    console.error(`Le démon d'essai n'a pas démarré.\n${journal.join('')}`);
    process.exit(1);
  }
  poserLeDecor();

  navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
  await contexte.addCookies([
    { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Chez Dupont', { timeout: 30000 });

  /* -------- 1. Générer une clé depuis les réglages -------- */

  await ouvrirLesReglages(page);
  noter("l'onglet « Accès API » s'ouvre dans les réglages", await page.getByText('Clés des services extérieurs').isVisible());

  await page.getByPlaceholder(/Nom du service/i).fill('boîte mail');
  await page.getByRole('button', { name: /Générer une clé/i }).click();

  const bloc = page.locator('code', { hasText: new RegExp(`^${PREFIXE_CLE_API}[0-9a-f]{64}$`) }).first();
  await bloc.waitFor({ timeout: 15000 });
  const SECRET = (await bloc.textContent())?.trim() ?? '';
  noter('la clé générée est montrée EN CLAIR, une fois', /^hkd_[0-9a-f]{64}$/.test(SECRET), `${SECRET.slice(0, 10)}…`);
  noter(
    "l'écran prévient qu'elle ne sera plus jamais affichée",
    await page.getByText(/ne sera plus jamais affichée/i).isVisible(),
  );
  noter(
    'la clé apparaît dans la liste, nommée et datée, avec son seul aperçu',
    (await page.getByText('boîte mail').count()) > 0 &&
      (await page.getByText('active', { exact: true }).count()) > 0 &&
      (await page.getByText(/jamais utilisée/i).count()) > 0,
  );

  /* -------- 2 et 3. L'appel du dehors pose la carte -------- */

  const pose = await avecCle(
    { projet: 'chez dupont', titre: 'Mail de M. Dupont', description: 'Il demande un devis pour la rénovation.' },
    SECRET,
  );
  noter('un appel extérieur avec cette clé est accepté', pose.statut === 201, `statut ${pose.statut}`);

  const db = baseLecture();
  const carte = db.prepare('SELECT * FROM cards WHERE id = ?').get(pose.corps?.carte?.id ?? '');
  noter('la carte existe vraiment en base', !!carte, pose.corps?.error ?? '');
  noter('elle est posée dans le BON projet, retrouvé par son nom malgré la casse et les accents',
    carte?.project_id === PROJET_ID, carte?.project_id ?? '(aucun)');
  noter('elle naît en « Planifié »', carte?.column_key === 'planned', carte?.column_key ?? '(aucune)');
  noter('son titre et sa description sont ceux de l’envoi',
    carte?.title === 'Mail de M. Dupont' && String(carte?.description).startsWith('Il demande un devis'));
  /* Le chef d'orchestre d'un projet ouvert existe toujours : ce qu'on contrôle,
     c'est qu'AUCUN agent d'EXÉCUTION n'est né, et que la carte n'en porte pas. */
  noter('RIEN n’est parti au moteur : aucun agent d’exécution, aucune carte au travail',
    db.prepare("SELECT COUNT(*) AS n FROM agents WHERE role = 'task'").get().n === 0 &&
      !carte?.agent_id &&
      carte?.column_key === 'planned');
  const cartesAvantRevocation = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE project_id = ?').get(PROJET_ID).n;
  db.close();

  /* La carte se VOIT dans « Planifié » du projet, sans recharger la page. */
  await page.keyboard.press('Escape');
  await page.getByText('Chez Dupont').first().click();
  noter(
    'la carte apparaît à l’écran, dans la colonne « Planifié »',
    await page
      .locator('text=Mail de M. Dupont')
      .first()
      .isVisible({ timeout: 15000 })
      .catch(() => false),
  );

  /* -------- 5. Les refus ordinaires, dits en clair -------- */

  const sansCle = await appeler({ projet: 'Chez Dupont', titre: 'Sans clé' });
  noter('sans clé : refusé en le disant', sansCle.statut === 401 && !!sansCle.corps.error, sansCle.corps.error ?? '');

  const inventee = await avecCle({ projet: 'Chez Dupont', titre: 'Clé inventée' }, `${PREFIXE_CLE_API}${'b'.repeat(64)}`);
  noter('clé inconnue : refusée', inventee.statut === 401, inventee.corps.error ?? '');

  const projetInconnu = await avecCle({ projet: 'Jamais vu', titre: 'Projet inconnu' }, SECRET);
  noter(
    'projet inconnu : refusé, et le message NOMME le projet cherché',
    projetInconnu.statut === 404 && String(projetInconnu.corps.error).includes('Jamais vu'),
    projetInconnu.corps.error ?? '',
  );

  const sansTitre = await avecCle({ projet: 'Chez Dupont' }, SECRET);
  noter('envoi sans titre : refusé, et le message dit quoi corriger', sansTitre.statut === 400, sansTitre.corps.error ?? '');

  const enLecture = await appeler(null, {}, 'GET');
  noter('un GET sur cette adresse est refusé', enLecture.statut === 405);

  /* -------- 4. La révocation, depuis les réglages -------- */

  await ouvrirLesReglages(page);
  await page.getByRole('button', { name: /Révoquer/i }).first().click();
  await page.getByRole('button', { name: 'Révoquer', exact: true }).last().click();
  noter(
    'la clé est marquée révoquée dans la liste, et non effacée',
    await page
      .getByText(/révoquée/i)
      .first()
      .isVisible({ timeout: 15000 })
      .catch(() => false),
  );

  const apres = await avecCle({ projet: 'Chez Dupont', titre: 'Après révocation' }, SECRET);
  noter(
    'clé révoquée : le MÊME appel est refusé, et la raison le dit',
    apres.statut === 403 && String(apres.corps.error).toLowerCase().includes('révoqu'),
    apres.corps.error ?? '',
  );

  const fin = baseLecture();
  noter(
    'aucune carte de plus n’a été créée après la révocation',
    fin.prepare('SELECT COUNT(*) AS n FROM cards WHERE project_id = ?').get(PROJET_ID).n === cartesAvantRevocation,
  );
  const ligne = fin.prepare('SELECT * FROM api_keys').get();
  noter(
    'la clé garde son nom, sa date et son compteur — son histoire ne disparaît pas',
    ligne?.nom === 'boîte mail' && !!ligne?.revoquee_le && ligne?.cartes_creees === 1,
  );
  noter(
    "le SECRET n'est conservé nulle part : seule son empreinte l'est",
    ligne?.empreinte === crypto.createHash('sha256').update(SECRET, 'utf8').digest('hex') &&
      !JSON.stringify(ligne).includes(SECRET),
  );
  fin.close();
} finally {
  if (navigateur) await navigateur.close().catch(() => {});
}

const rates = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés.`);
if (rates.length) console.log(`Échecs : ${rates.map((r) => r.nom).join(' · ')}`);

/* On SORT franchement : le démon d'essai est un fils avec ses tuyaux ouverts,
   il retiendrait le script pour toujours. Le crochet `exit` le tue et efface le
   dossier temporaire. */
process.exit(rates.length ? 1 : 0);
