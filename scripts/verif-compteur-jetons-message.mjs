#!/usr/bin/env node
/**
 * LE COMPTEUR SOUS UNE BULLE, SUR UN VRAI ÉCHANGE.
 *
 * Contrairement aux autres contrôles du fil (`verif-heure-jetons-messages.mjs`,
 * `verif-contexte-envoye.mjs`), qui posent des messages FABRIQUÉS en base pour
 * juger l'affichage, celui-ci pose un VRAI message dans le composeur et attend
 * la VRAIE réponse du moteur Claude — c'est la seule façon de prouver que le
 * chiffre affiché reste correct sur un tour réellement exécuté, pas seulement
 * sur des données de test choisies à l'avance.
 *
 * Un démon jetable est lancé SANS toucher à `HOME` : `bootstrapAccounts()`
 * (`server/src/accounts.ts`) retrouve alors tout seul le compte Claude déjà
 * connecté sur la machine (`~/.claude/.credentials.json`), exactement comme le
 * ferait le démon principal. Base et dossier de projets sont jetables ; le
 * démon principal n'est pas touché, et le seul coût réel est celui des deux
 * petits tours de conversation envoyés au moteur (quelques centimes).
 *
 * Deux tours, dans la MÊME session :
 *   1. un premier message ouvre la conversation (la consigne système entière
 *      part avec lui — son chiffre n'a donc rien à voir avec sa propre taille,
 *      ce n'est pas ce qu'on juge) ;
 *   2. un second message, court, suit dans le MÊME fil — la consigne système
 *      est alors rejouée depuis le cache et n'entre plus dans le chiffre
 *      affiché (`jetonsMessageEnvoye`, `shared/src/couches-tokens.ts`). C'est
 *      SON compteur, sous SA bulle, qui doit rester proche de sa taille tapée
 *      — pas des dizaines de milliers de jetons comme avant le correctif.
 *
 * On vérifie aussi que la bulle de RÉPONSE porte un chiffre lisible (loin des
 * centaines de milliers de jetons que rejouait l'ancien bogue du cache).
 *
 *   node scripts/verif-compteur-jetons-message.mjs
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

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKO_COMPTEUR_JETONS_PORT || 7199);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-compteur-jetons-'));
const SHOTS = path.join(RACINE, 'data', 'verification');
fs.mkdirSync(SHOTS, { recursive: true });

const { jetonsApproches } = await import(path.join(RACINE, 'shared/dist/index.js'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le décor : un démon jetable, un dépôt git jetable                   */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
for (const dossier of [DATA, PROJETS, DEPOT]) fs.mkdirSync(dossier, { recursive: true });

execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
  cwd: DEPOT,
});

// Aucune variable HOME imposée : le démon jetable hérite du HOME du système,
// pour que `bootstrapAccounts()` retrouve le compte Claude déjà connecté.
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

async function attendrePort(limiteMs = 60_000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-compteur-jetons';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3_600_000,
    'vérification compteur de jetons',
  );
  const projet = {
    id: PROJET_ID,
    name: 'Essai — compteur de jetons',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), t, t);
  db.close();
}

function baseLecture() {
  return new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
}

/** Attend que le tour en cours de CET agent soit vraiment terminé. */
async function attendreLaFinDuTour(agentId, limiteMs = 180_000) {
  const fin = Date.now() + limiteMs;
  let statut = 'running';
  while (Date.now() < fin) {
    statut = JSON.parse(baseLecture().prepare('SELECT data FROM agents WHERE id = ?').get(agentId).data).status;
    if (statut !== 'running') return statut;
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return statut;
}

/**
 * Lit, dans le DOM, le chiffre affiché sous la DERNIÈRE bulle d'un rôle donné.
 * L'application n'étiquette pas le rôle du message sur la ligne de repères :
 * c'est l'alignement à DROITE (`justify-end`, posé uniquement pour les
 * demandes de l'utilisateur — `aDroite` dans `LigneReperes`) qui distingue les
 * deux côtés du fil.
 */
async function dernierCompteurAffiche(page, role) {
  return page.evaluate((role) => {
    const visible = (n) => n.getBoundingClientRect().height > 0;
    const lignes = Array.from(document.querySelectorAll('[data-ligne-reperes]')).filter(visible);
    const duBonCote = lignes.filter((l) => (role === 'user') === l.classList.contains('justify-end'));
    const derniere = duBonCote.at(-1);
    if (!derniere) return null;
    const noeud = derniere.querySelector('[data-jetons-message]');
    return noeud ? (noeud.textContent ?? '').trim() : null;
  }, role);
}

const nombreDepuisAffichage = (texte) => {
  if (!texte) return null;
  const chiffres = texte.replace(/[^\d]/g, '');
  return chiffres ? Number(chiffres) : null;
};

async function main() {
  if (!(await attendrePort())) {
    noter('le démon jetable démarre', false, journal.join('').slice(-800));
    process.exitCode = 1;
    return;
  }
  poserLeDecor();

  navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
  await contexte.addCookies([{ name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));

  await page.goto(`${BASE}/#projet/${PROJET_ID}`, { waitUntil: 'domcontentloaded' });
  const composeur = page.locator('textarea[placeholder="Écrivez votre demande…"]:visible').first();
  await composeur.waitFor({ timeout: 40_000 });

  /* Le chef d'orchestre du projet d'essai naît à l'ouverture de la conversation. */
  let AGENT = null;
  for (let essai = 0; essai < 40 && !AGENT; essai += 1) {
    AGENT =
      baseLecture().prepare("SELECT id FROM agents WHERE project_id = ? AND role = 'cadrage' LIMIT 1").get(PROJET_ID)
        ?.id ?? null;
    if (!AGENT) await page.waitForTimeout(500);
  }
  noter("la conversation d'essai a bien un chef d'orchestre", !!AGENT, AGENT ?? 'aucun');
  if (!AGENT) {
    await navigateur.close();
    process.exitCode = 1;
    return;
  }

  /* -------- 1. Premier message : ouvre la session -------- */

  await composeur.fill("Bonjour, réponds uniquement par le mot D'ACCORD, sans rien ajouter.");
  await page.keyboard.press('Enter');
  const statut1 = await attendreLaFinDuTour(AGENT);
  noter('le premier tour se termine de lui-même', statut1 !== 'running', `statut « ${statut1} »`);

  /* -------- 2. Second message, court, dans le même fil -------- */

  const SECOND_MESSAGE = 'Merci beaucoup, à bientôt.';
  await composeur.fill(SECOND_MESSAGE);
  await page.keyboard.press('Enter');
  const statut2 = await attendreLaFinDuTour(AGENT);
  noter('le second tour se termine de lui-même', statut2 !== 'running', `statut « ${statut2} »`);

  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, 'compteur-jetons-message.png') });

  /* -------- 3. Le compteur sous la bulle de la DEMANDE -------- */

  const texteDemande = await dernierCompteurAffiche(page, 'user');
  const jetonsDemande = nombreDepuisAffichage(texteDemande);
  noter('la bulle de la demande porte un compteur de jetons', jetonsDemande !== null, texteDemande ?? 'absent');

  // Repère : ce que pèserait le seul texte tapé, à 2,2 signes par jeton — le
  // gabarit HaikoDev (rappel de forme, séparateurs) ajoute une marge fixe,
  // jamais un multiple qui grossirait avec la conversation.
  const attenduMinimal = jetonsApproches(SECOND_MESSAGE.length);
  const MARGE_GABARIT = 1_000;
  if (jetonsDemande !== null) {
    noter(
      'le chiffre reste proche de la taille du message tapé (pas un cumul de session)',
      jetonsDemande >= attenduMinimal && jetonsDemande <= attenduMinimal + MARGE_GABARIT,
      `${jetonsDemande} jetons affichés, ${attenduMinimal} attendus pour le seul texte (+${MARGE_GABARIT} de marge)`,
    );
    noter(
      'le chiffre reste loin des valeurs absurdes de l’ancien bogue (dizaines de milliers)',
      jetonsDemande < 3_000,
      `${jetonsDemande} jetons`,
    );
  }

  /* -------- 4. Le compteur sous la bulle de RÉPONSE -------- */

  const texteReponse = await dernierCompteurAffiche(page, 'assistant');
  const jetonsReponse = nombreDepuisAffichage(texteReponse);
  noter('la bulle de réponse porte un compteur de jetons', jetonsReponse !== null, texteReponse ?? 'absent');
  if (jetonsReponse !== null) {
    noter(
      'le compteur de la bulle de réponse reste lisible, loin de l’ancien bogue du cache',
      jetonsReponse < 20_000,
      `${jetonsReponse} jetons`,
    );
  }

  noter('aucune erreur de page pendant l’essai', erreurs.length === 0, erreurs[0] ?? '');

  await navigateur.close();
}

await main();

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles au vert`);
process.exitCode = echecs ? 1 : 0;
