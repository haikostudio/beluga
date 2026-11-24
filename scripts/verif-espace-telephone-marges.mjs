#!/usr/bin/env node
/**
 * L'ESPACE CLIENT SUR UN IPHONE SIMULÉ : MARGES, EN-TÊTE DE FICHE, DISCUSSION.
 *
 *   npm run build && node scripts/verif-espace-telephone-marges.mjs
 *
 * Un démon JETABLE (dossier temporaire, port à soi : BELUGA_MARGES_PORT), une
 * vraie session cliente, Chrome à 390 × 844 avec des zones sûres POSÉES
 * (`scripts/lib/zone-sure.mjs` : 47 px en haut, 34 px en bas). Vérifié :
 *
 *   1. l'entête de l'espace commence SOUS la zone sûre du haut ;
 *   2. sous « Envoyer », il ne reste que la zone sûre du bas et un peu d'air ;
 *   3. l'en-tête de la fiche : titre, description, auteur · date, dans cet ordre
 *      et sur le même bord gauche — et plus aucun crayon ;
 *   4. toucher le titre ouvre la modification ;
 *   5. la description se replie quand on avance dans le fil, revient en haut,
 *      et s'ouvre ou se ferme d'un toucher ;
 *   6. la discussion montre sa silhouette avant le fil, puis « aucun message » ;
 *   7. sur ordinateur, l'entête reste collé au bord haut.
 *
 * Vérifications par ÉTAT (attributs `data-*`), les positions seulement là où la
 * position EST la demande. Jamais `BELUGA_URL` ni `BELUGA_TOKEN`.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import * as ws from 'ws';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { poserZonesSures } from './lib/zone-sure.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_MARGES_PORT || 7231);
const HOTE = 'my.test';
const ZONE = { haut: 47, bas: 34 };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-espace-marges-'));
const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
for (const dossier of [DATA, PROJETS]) fs.mkdirSync(dossier, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

let navigateur = null;
const journal = [];
const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
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

async function attendrePort(limiteMs = 90000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
if (!(await attendrePort())) {
  console.error('le démon n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Le décor : un projet, un client, une demande au long fil             */
/* ------------------------------------------------------------------ */

const PROJET = 'p-marges';
const IDENTIFIANT = 'client-marges';
const MOT_DE_PASSE = 'mot-de-passe-essai-2026';
const jetonClient = crypto.randomBytes(24).toString('hex');
const sha = (valeur) => crypto.createHash('sha256').update(valeur).digest('hex');
{
  const comptes = await import(path.join(RACINE, 'server/dist/comptes.js'));
  fs.mkdirSync(path.join(PROJETS, 'marges'), { recursive: true });
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  const projet = { id: PROJET, name: 'Projet marges', path: path.join(PROJETS, 'marges'), archived: false };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
    PROJET,
    projet.name,
    projet.path,
    0,
    JSON.stringify({ ...projet, createdAt: maintenant, updatedAt: maintenant }),
    maintenant,
    maintenant,
  );
  const sel = crypto.randomBytes(16);
  db.prepare(
    `INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le)
     VALUES (?, ?, 'client', ?, ?, ?, 1, ?)`,
  ).run('u-marges', IDENTIFIANT, 'Client des marges', sel.toString('hex'), comptes.empreinte(MOT_DE_PASSE, sel), maintenant);
  db.prepare('INSERT INTO user_projects (user_id, project_id) VALUES (?, ?)').run('u-marges', PROJET);
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?,?,?,?,?)').run(
    sha(jetonClient),
    maintenant,
    maintenant + 3600_000,
    'vérification marges',
    'u-marges',
  );
  db.close();
}

const canal = await new Promise((resolve, reject) => {
  const socket = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie: `beluga_session=${jetonClient}` } });
  const attentes = new Map();
  socket.on('message', (brut) => {
    const event = JSON.parse(brut.toString());
    if (event.type === 'ack' && attentes.has(event.id)) {
      attentes.get(event.id)(event);
      attentes.delete(event.id);
    }
  });
  socket.on('open', () =>
    resolve({
      socket,
      demander: (cmd) =>
        new Promise((resoudre) => {
          const id = crypto.randomBytes(6).toString('hex');
          attentes.set(id, resoudre);
          socket.send(JSON.stringify({ id, cmd }));
          setTimeout(() => attentes.has(id) && (attentes.delete(id), resoudre({ ok: false })), 10000);
        }),
    }),
  );
  socket.on('error', reject);
});
await new Promise((r) => setTimeout(r, 1000));

const creee = await canal.demander({
  type: 'espace.demande.creer',
  projectId: PROJET,
  titre: 'Refaire la page d’accueil',
  description: 'Avec le nouveau logo, les nouvelles photos et un texte plus court sur la première ligne.',
});
const demandeId = creee.data?.id ?? creee.data?.demande?.id ?? null;
for (let i = 0; i < 25; i += 1) {
  await canal.demander({ type: 'espace.demande.commenter', id: demandeId, texte: `Commentaire numéro ${i + 1}, assez long pour remplir le fil.` });
}
noter('le décor porte une demande et un long fil', Boolean(demandeId));
canal.socket.close();

/* ------------------------------------------------------------------ */
/* Le navigateur                                                       */
/* ------------------------------------------------------------------ */

navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', `--host-resolver-rules=MAP ${HOTE} 127.0.0.1`],
});
const erreurs = [];
async function entrer(contexte, zones) {
  const page = await contexte.newPage();
  page.on('pageerror', (e) => erreurs.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));
  await page.goto(`http://${HOTE}:${PORT}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('input[name="username"]', IDENTIFIANT);
  await page.fill('input[name="password"]', MOT_DE_PASSE);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('button[type="submit"]')]);
  await page.waitForSelector('[data-espace-client]', { timeout: 30000 });
  /* APRÈS la connexion : posées avant, elles tombaient avec la page de connexion. */
  if (zones) await poserZonesSures(page, zones);
  await page.waitForTimeout(600);
  return page;
}

/** La marche que tout bas de page garde sur téléphone (`web/src/styles.css`). */
const MARCHE_DU_BAS = 10;

const mobile = await navigateur.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'fr-CH',
  hasTouch: true,
  isMobile: true,
});
const page = await entrer(mobile, ZONE);

/* 1. L'ENTÊTE SOUS LA BARRE D'ÉTAT */
{
  const haut = await page.evaluate(() => document.querySelector('[data-entete-espace]').getBoundingClientRect().top);
  noter('l’entête de l’espace commence sous la zone sûre du haut', haut >= ZONE.haut - 0.5, `${haut} px`);
}

/* 2. LE PIED DE LA FICHE */
await page.locator('[data-ouvrir-demande]').first().click();
await page.waitForSelector('[data-fiche-chargee]', { timeout: 20000 });
await page.waitForTimeout(700);
{
  const vide = await page.evaluate(
    /* L'envoi vit DANS le champ depuis le 24/11/2026 : le bas de la fiche est celui du champ. */
    () => window.innerHeight - document.querySelector('[data-tiroir-demande] [data-champ-espace]').getBoundingClientRect().bottom,
  );
  noter(
    'sous le champ de commentaire, seulement la zone sûre du bas et un peu d’air',
    /* + la marche du bas du téléphone (10 px, `--marche-du-bas`, 31/10/2026). */
    vide >= ZONE.bas + MARCHE_DU_BAS && vide <= ZONE.bas + MARCHE_DU_BAS + 20,
    `${Math.round(vide)} px`,
  );
}

/* 3. L'ORDRE ET L'ALIGNEMENT DE L'EN-TÊTE */
{
  const entete = await page.evaluate(() => {
    const boite = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
    const titre = boite('[data-entete-fiche] [data-texte-lu="titre"]');
    const description = boite('[data-entete-fiche] [data-texte-lu="description"]');
    const auteur = boite('[data-entete-fiche] [data-ligne-auteur]');
    return {
      trouves: Boolean(titre && description && auteur),
      ordre: Boolean(titre && description && auteur && titre.top < description.top && description.top < auteur.top),
      ecartGauche: titre && description && auteur
        ? Math.round(Math.max(titre.left, description.left, auteur.left) - Math.min(titre.left, description.left, auteur.left))
        : -1,
      crayons: document.querySelectorAll('[data-tiroir-demande] .lucide-pencil').length,
    };
  });
  noter('l’en-tête montre titre, description, puis auteur · date', entete.trouves && entete.ordre, JSON.stringify(entete));
  noter('les trois partent du même bord gauche', entete.ecartGauche === 0, `écart ${entete.ecartGauche} px`);
  noter('plus aucun crayon dans la fiche', entete.crayons === 0, String(entete.crayons));
}

/* 4. TOUCHER LE TITRE OUVRE LA MODIFICATION */
await page.locator('[data-texte-lu="titre"]').tap();
{
  const ouvert = await page.waitForSelector('[data-champ-edition="titre"]', { timeout: 5000 }).then(() => true, () => false);
  noter('toucher le titre ouvre la modification', ouvert);
  if (ouvert) await page.click('[data-annuler-edition="titre"]');
  await page.waitForTimeout(300);
}

/* 5. LE REPLI AU DÉFILEMENT */
{
  const etat = () => page.getAttribute('[data-description-entete]', 'data-description-entete');
  noter('à l’ouverture, la description est dépliée', (await etat()) === 'depliee', await etat());
  await page.evaluate(() => {
    document.querySelector('[data-fil-fiche]').scrollTop = 10;
  });
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    document.querySelector('[data-fil-fiche]').scrollTop = 260;
  });
  await page.waitForTimeout(500);
  noter('avancer dans le fil replie la description', (await etat()) === 'repliee', await etat());
  await page.evaluate(() => {
    document.querySelector('[data-fil-fiche]').scrollTop = 0;
  });
  await page.waitForTimeout(500);
  noter('revenir tout en haut la redéplie', (await etat()) === 'depliee', await etat());
  await page.locator('[data-basculer-description]').tap();
  await page.waitForTimeout(400);
  const fermee = await etat();
  await page.locator('[data-basculer-description]').tap();
  await page.waitForTimeout(400);
  noter('le chevron ferme puis rouvre la description', fermee === 'repliee' && (await etat()) === 'depliee', `${fermee} → ${await etat()}`);
}

/* 6. LA DISCUSSION MONTRE QU'ELLE CHARGE */
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
{
  await page.evaluate(() => {
    window.__silhouetteVue = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-silhouette="discussion"]')) window.__silhouetteVue = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.click('[data-onglet-discussion]');
  const pret = await page
    .waitForSelector('[data-volet-discussion][data-discussion-chargement="pret"]', { timeout: 15000 })
    .then(() => true, () => false);
  const vue = await page.evaluate(() => window.__silhouetteVue);
  noter('la silhouette de la discussion paraît avant le fil', vue);
  noter(
    'un fil vide le dit en clair',
    pret && (await page.locator('[data-volet-discussion] [data-discussion-vide]').count()) === 1,
  );
}
await mobile.close();

/* 7. SUR ORDINATEUR, RIEN NE BOUGE EN HAUT */
{
  const bureau = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
  const grand = await entrer(bureau, null);
  const haut = await grand.evaluate(() => document.querySelector('[data-entete-espace]').getBoundingClientRect().top);
  noter('sur ordinateur, l’entête reste collé au bord haut', haut <= 1, `${haut} px`);
  await bureau.close();
}

const graves = erreurs.filter((e) => !/favicon|manifest|service worker/i.test(e));
noter('aucune erreur dans la console du navigateur', graves.length === 0, graves.slice(0, 3).join(' | '));

await navigateur.close();
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles réussis`);
process.exit(echecs ? 1 : 0);
