#!/usr/bin/env node
/**
 * BELUGA CONNECT POUR LINUX, POUR DE VRAI (carte « Beluga Connect : installation simplifiée », 21/11/2026) — sur un
 * démon d'ESSAI monté depuis cette copie (base neuve, aucun moteur), dans un dossier personnel JETABLE.
 *
 *  1. un code est émis comme le fait le bouton « Lier » (relaisMac.code, sans ordinateur visé) ;
 *  2. la commande affichée par la page est jouée telle quelle (`curl …/installer-linux.sh?code=… | sh`) : le vrai
 *     binaire Go est téléchargé AVEC sa remorque, se range dans ~/.local/share/beluga, s'inscrit au démarrage
 *     (autostart XDG) et au lien beluga-connect://, puis se relie SEUL ;
 *  3. le démon voit un ordinateur Linux, nommé d'après la machine, Beluga Connect en marche ;
 *  4. il lui confie l'extension : le dossier fixe reçoit l'extension 1.0.14, config.json vers CE Beluga et
 *     liaison.json ; Chrome est ouvert sur chrome://extensions (un faux Chrome note ses arguments) et le chemin copié ;
 *  5. l'extension est chargée dans le Chromium de Playwright depuis CE dossier : elle lit liaison.json et se relie
 *     seule, rattachée au même ordinateur ;
 *  6. sur une page de ce Beluga, elle pose son identifiant d'appareil (`data-beluga-navigateur`) : la page reconnaît
 *     l'ordinateur sur lequel on est ;
 *  7. le fichier Windows servi avec un code porte la même remorque, relue telle qu'écrite ;
 * (carte « Liaison Chrome automatique et suivie », 22/11/2026)
 *  8. des codes émis ailleurs (fenêtre Safari, code de secours) n'annulent pas celui de liaison.json ;
 *  9. le démon redémarre : le même Chrome revient, sa clé gardée, aucune fiche neuve ;
 * 10. Chrome délié ouvert : Beluga Connect repose un code et l'extension se relie seule de nouveau ;
 * 11. Chrome délié FERMÉ (refus 401 à la réouverture) : l'extension demande si sa clé vaut encore, l'oublie, et se
 *     relie seule par liaison.json ;
 * 12. liaison automatique empêchée (Beluga Connect arrêté) : le code de secours, saisi dans le vrai volet de
 *     l'extension, relie Chrome.
 * Tout est arrêté et effacé en partant.
 *
 *   NODE_ENV=development npm run build && (cd connect/go && ./fabriquer.sh) && node scripts/verif-connect-linux.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7329);
const VERSION_ATTENDUE = JSON.parse(fs.readFileSync(path.join(RACINE, 'extension-chrome/manifest.json'), 'utf8')).version;
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.VERIF_CAPTURES || '/tmp/captures-connect-linux';
fs.mkdirSync(CAPTURES, { recursive: true });

let echecs = 0;
let total = 0;
function noter(nom, ok, detail = '') {
  total += 1;
  if (!ok) echecs += 1;
  console.log(`${ok ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
}
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
async function jusqua(lire, ms, pas = 1000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const v = await lire();
    if (v) return v;
    await attendre(pas);
  }
  return null;
}

const { DATA, PROJETS, demon, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-connect-linux-', port: PORT, signaux: true });
/* Le démon d'essai redémarré sur la MÊME base (scénario 9). */
let demonRedemarre = null;
async function redemarrerLeDemon() {
  const courant = demonRedemarre ?? demon;
  courant.kill('SIGKILL');
  await attendre(1500);
  demonRedemarre = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
    env: { ...process.env, BELUGA_PORT: String(PORT), BELUGA_HOST: '127.0.0.1', BELUGA_DATA: DATA, BELUGA_PROJECTS_ROOT: PROJETS, BELUGA_WEB: path.join(RACINE, 'web', 'dist'), BELUGA_SANS_AMORCE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  demonRedemarre.stdout.on('data', (d) => journal.push(String(d)));
  demonRedemarre.stderr.on('data', (d) => journal.push(String(d)));
  process.on('exit', () => demonRedemarre?.kill('SIGKILL'));
  return attendrePort();
}
if (!(await attendrePort())) {
  console.error(`Le démon d’essai n’a pas démarré :\n${journal.join('')}`);
  process.exit(1);
}

const jeton = crypto.randomBytes(32).toString('hex');
const db = new Database(path.join(DATA, 'beluga.db'));
const T = Date.now();
db.prepare("INSERT OR IGNORE INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le) VALUES ('u-essai', 'essai', 'admin', 'Essai', 's', 'h', 1, ?)").run(T);
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'verif connect linux', 'u-essai');

function appelDemon(cmd) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie: `beluga_session=${jeton}` } });
    const id = crypto.randomUUID();
    const minuteur = setTimeout(() => {
      socket.close();
      reject(new Error('le démon ne répond pas'));
    }, 20000);
    socket.on('open', () => socket.send(JSON.stringify({ id, cmd })));
    socket.on('message', (brut) => {
      const m = JSON.parse(String(brut));
      if (m.id !== id) return;
      clearTimeout(minuteur);
      socket.close();
      if (m.error) reject(new Error(m.error));
      else resolve(m.result ?? m.data ?? {});
    });
    socket.on('error', (e) => {
      clearTimeout(minuteur);
      reject(e);
    });
  });
}

/* Un dossier personnel jetable, et un PATH réduit : un faux Chrome et un faux presse-papiers qui notent ce qu'on leur
   demande (aucun vrai Chrome ne s'ouvre sur ce serveur). */
const MAISON = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-connect-linux-maison-'));
const OUTILS = path.join(MAISON, 'outils');
fs.mkdirSync(OUTILS);
for (const n of ['curl', 'chmod', 'mkdir', 'uname', 'sh', 'cat', 'head']) {
  const vrai = execFileSync('sh', ['-c', `command -v ${n}`]).toString().trim();
  fs.symlinkSync(vrai, path.join(OUTILS, n));
}
fs.writeFileSync(path.join(OUTILS, 'google-chrome'), `#!/bin/sh\necho "$@" >> "${MAISON}/chrome-ouvert.txt"\n`, { mode: 0o755 });
fs.writeFileSync(path.join(OUTILS, 'xclip'), `#!/bin/sh\ncat > "${MAISON}/presse-papiers.txt"\n`, { mode: 0o755 });
const ENV = { HOME: MAISON, PATH: OUTILS, BELUGA_CONNECT_BAVARD: '' };
const PROGRAMME = path.join(MAISON, '.local/share/beluga/beluga-connect');
const EXTENSION = path.join(MAISON, '.local/share/beluga/extension-chrome');

const arreter = () => spawnSync('pkill', ['-f', PROGRAMME]);
let contexte = null;
try {
  // 1. Le code, comme au clic sur « Lier ».
  const { code } = await appelDemon({ type: 'relaisMac.code' });
  noter('un code de liaison est émis sans ordinateur visé', /^\d{6}$/.test(code ?? ''), code);

  // 2. La commande de la page, jouée telle quelle.
  const commande = `curl -fsSL '${BASE}/api/connect/installer-linux.sh?code=${code}&base=${encodeURIComponent(BASE)}' | sh`;
  if (process.env.VERIF_BAVARD) {
    const r = await fetch(`${BASE}/api/connect/installer-linux.sh?code=${code}&base=${encodeURIComponent(BASE)}`);
    console.log(r.status, (await r.text()).slice(0, 600));
    console.log(spawnSync('sh', ['-c', 'echo moi; command -v curl; curl --version | head -1'], { env: ENV, encoding: 'utf8' }));
  }
  const sortie = spawnSync('sh', ['-c', commande], { env: ENV, encoding: 'utf8', timeout: 60_000 });
  noter('la commande installe Beluga Connect et rend la main', sortie.status === 0 && /installé et se relie/.test(sortie.stdout), `${sortie.status} ${sortie.error ?? ''} ${(sortie.stdout ?? '') + (sortie.stderr ?? '')}`.trim().slice(0, 400));
  noter('le programme est rangé dans ~/.local/share/beluga', fs.existsSync(PROGRAMME));
  const autostart = path.join(MAISON, '.config/autostart/beluga-connect.desktop');
  const lien = path.join(MAISON, '.local/share/applications/beluga-connect.desktop');
  noter(
    'il démarre avec la session et répond au lien beluga-connect://',
    fs.existsSync(autostart) && fs.readFileSync(autostart, 'utf8').includes(PROGRAMME) && /x-scheme-handler\/beluga-connect/.test(fs.existsSync(lien) ? fs.readFileSync(lien, 'utf8') : ''),
  );

  // 3. Le démon voit un ordinateur Linux, Beluga Connect en marche.
  const hote = os.hostname();
  const linux = await jusqua(async () => (await appelDemon({ type: 'extension.etat' })).ordinateurs?.find((o) => o.programme?.systeme === 'linux' && o.programme.etat === 'pret'), 40_000);
  noter('l’ordinateur se relie SEUL : Linux, Beluga Connect en marche, nommé d’après la machine', !!linux && linux.nom === hote && !!linux.programme?.connect, JSON.stringify(linux?.programme ?? null));

  // 4. L'extension posée par Beluga Connect.
  const prepare = await jusqua(async () => {
    const o = (await appelDemon({ type: 'extension.etat' })).ordinateurs?.find((x) => x.id === linux?.id);
    return o?.programme?.preparation?.etat === 'echec' ? o.programme.preparation : null;
  }, 90_000, 2000);
  const manifeste = fs.existsSync(path.join(EXTENSION, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(EXTENSION, 'manifest.json'), 'utf8')) : null;
  const config = fs.existsSync(path.join(EXTENSION, 'config.json')) ? JSON.parse(fs.readFileSync(path.join(EXTENSION, 'config.json'), 'utf8')) : null;
  const fiche = fs.existsSync(path.join(EXTENSION, 'liaison.json')) ? JSON.parse(fs.readFileSync(path.join(EXTENSION, 'liaison.json'), 'utf8')) : null;
  noter(
    `l’extension ${VERSION_ATTENDUE} est posée dans le dossier fixe, vers CE Beluga, avec son code de liaison et l’adresse qui l’a émis`,
    manifeste?.version === VERSION_ATTENDUE && config?.adresse === BASE && /^\d{6}$/.test(fiche?.code ?? '') && fiche?.adresse === BASE,
    JSON.stringify({ v: manifeste?.version, a: config?.adresse, f: fiche?.adresse }),
  );

  // 8. Des codes émis ailleurs n'annulent plus celui de liaison.json.
  const safari = await appelDemon({ type: 'extension.code', ordinateurId: linux?.id });
  const secoursAvant = await appelDemon({ type: 'relaisMac.codeDeSecours', ordinateurId: linux?.id });
  noter('une fenêtre Safari et un code de secours émettent leurs codes à côté', /^\d{6}$/.test(safari?.code ?? '') && /^\d{6}$/.test(secoursAvant?.code ?? ''));
  noter(
    'Chrome est ouvert sur chrome://extensions, le chemin copié, et le parcours connaît le dossier',
    /chrome:\/\/extensions/.test(fs.existsSync(path.join(MAISON, 'chrome-ouvert.txt')) ? fs.readFileSync(path.join(MAISON, 'chrome-ouvert.txt'), 'utf8') : '') &&
      (fs.existsSync(path.join(MAISON, 'presse-papiers.txt')) ? fs.readFileSync(path.join(MAISON, 'presse-papiers.txt'), 'utf8') : '') === EXTENSION &&
      prepare?.dossier === EXTENSION,
    JSON.stringify(prepare),
  );

  // 5. L'extension chargée depuis CE dossier se relie seule (Chromium de Playwright : il accepte une extension).
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-connect-linux-profil-'));
  contexte = await chromium.launchPersistentContext(profil, {
    /* Le Chromium complet de Playwright en mode sans écran : il accepte une extension chargée d'un dossier. */
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    viewport: { width: 1440, height: 900 },
  });
  const chromeRelie = await jusqua(async () => (await appelDemon({ type: 'extension.etat' })).ordinateurs?.find((o) => o.id === linux?.id)?.navigateurs?.find((n) => n.enLigne), 90_000, 2000);
  noter('l’extension lit liaison.json et se relie seule, au MÊME ordinateur — malgré les codes émis ailleurs', !!chromeRelie && chromeRelie.version === VERSION_ATTENDUE, JSON.stringify(chromeRelie ?? null));

  // 6. La page Beluga reconnaît l'ordinateur sur lequel on est.
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE }]);
  const page = await contexte.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const annonce = await jusqua(() => page.evaluate(() => document.documentElement.dataset.belugaNavigateur || null), 20_000, 500);
  /* Les réglages s'ouvrent comme le fait un bouton de l'application. */
  await page.waitForSelector('[data-colonne-projets], nav, main', { timeout: 60_000 }).catch(() => undefined);
  await jusqua(async () => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-reglages', { detail: { page: 'ordinateurs' } })));
    return (await page.locator('[data-page-ordinateurs]').count()) > 0;
  }, 30_000, 1500);
  noter('l’extension pose son identifiant d’appareil sur la page Beluga, sans secret', annonce === chromeRelie?.id && !/\./.test(annonce ?? ''), String(annonce));
  const ici = await page.locator(`[data-ordinateur="${linux?.id}"] [data-cet-ordinateur]`).waitFor({ timeout: 30_000 }).then(() => true, () => false);
  noter('Réglages › Ordinateurs marque cette ligne « Cet ordinateur »', ici);
  /* Reconnu : aucune ligne « Ajouter cet ordinateur » ni bouton « Lier » (carte « Liaison d'ordinateur simplifiée »). */
  await attendre(1500);
  const sansAjout = (await page.locator('[data-ajouter-cet-ordinateur], [data-lier-cet-ordinateur]').count()) === 0;
  noter('cet ordinateur reconnu : pas de ligne « Ajouter cet ordinateur » ni de bouton « Lier »', ici && sansAjout);
  await page.screenshot({ path: path.join(CAPTURES, 'linux-reel-deja-connecte-1440.png') });

  const navigateursDe = async () => (await appelDemon({ type: 'extension.etat' })).ordinateurs?.find((o) => o.id === linux?.id)?.navigateurs ?? [];
  const nouveauRelie = (avantId) => jusqua(async () => (await navigateursDe()).find((n) => n.enLigne && n.id !== avantId), 150_000, 2000);

  // 9. Le démon redémarre : le même Chrome revient, sa clé gardée (une indisponibilité ne délie rien).
  noter('le démon d’essai redémarre sur la même base', await redemarrerLeDemon());
  const revenu = await jusqua(async () => (await navigateursDe()).find((n) => n.enLigne), 90_000, 2000);
  noter('après le redémarrage, le MÊME Chrome revient en ligne, sans fiche neuve', revenu?.id === chromeRelie?.id && (await navigateursDe()).length === 1, JSON.stringify(await navigateursDe()));

  // 10. Délié pendant qu'il est ouvert : Beluga Connect repose un code, l'extension se relie seule.
  await appelDemon({ type: 'extension.delier', id: chromeRelie?.id });
  const relie2 = await nouveauRelie(chromeRelie?.id);
  noter('Chrome délié (ouvert) : il se relie seul de nouveau, au même ordinateur', !!relie2, JSON.stringify(await navigateursDe()));

  // 11. Délié pendant qu'il est FERMÉ : refus à la réouverture, clé oubliée, liaison seule.
  await contexte.close();
  contexte = null;
  await appelDemon({ type: 'extension.delier', id: relie2?.id });
  await attendre(8_000);
  contexte = await chromium.launchPersistentContext(profil, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`] });
  const relie3 = await nouveauRelie(relie2?.id);
  noter('Chrome délié FERMÉ : à la réouverture il oublie sa clé refusée et se relie seul', !!relie3, JSON.stringify(await navigateursDe()));

  // 12. Liaison automatique empêchée : le code de secours, saisi dans le vrai volet, relie Chrome.
  await contexte.close();
  contexte = null;
  arreter();
  await attendre(1500);
  await appelDemon({ type: 'extension.delier', id: relie3?.id });
  contexte = await chromium.launchPersistentContext(profil, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`] });
  const travailleur = contexte.serviceWorkers()[0] ?? (await contexte.waitForEvent('serviceworker', { timeout: 30_000 }));
  const idExtension = new URL(travailleur.url()).host;
  const volet = await contexte.newPage();
  await volet.goto(`chrome-extension://${idExtension}/panneau.html`);
  const formulaire = await volet.locator('[data-code-liaison]').waitFor({ timeout: 60_000 }).then(() => true, () => false);
  const toujoursDelie = !(await navigateursDe()).some((n) => n.enLigne);
  noter('sans Beluga Connect, Chrome reste délié et le volet demande un code', formulaire && toujoursDelie);
  const secours = await appelDemon({ type: 'relaisMac.codeDeSecours', ordinateurId: linux?.id });
  await volet.locator('[data-code-liaison]').fill(secours.code);
  await volet.locator('[data-relier]').click();
  const relie4 = await nouveauRelie(relie3?.id);
  noter('le code de secours saisi dans le volet de l’extension relie Chrome, au même ordinateur', !!relie4, JSON.stringify({ code: secours.code, n: await navigateursDe() }));
  await volet.screenshot({ path: path.join(CAPTURES, 'volet-relie-par-le-code-de-secours.png') });

  // 7. Le fichier Windows avec son code : la même remorque.
  const { lireLaRemorque } = await import(path.join(RACINE, 'shared/dist/index.js'));
  const exe = Buffer.from(await (await fetch(`${BASE}/api/connect/Beluga-Connect-Windows.exe?code=123456&base=${encodeURIComponent(BASE)}`)).arrayBuffer());
  const brut = Buffer.from(await (await fetch(`${BASE}/api/connect/Beluga-Connect-Windows.exe`)).arrayBuffer());
  noter(
    'le fichier Windows servi avec un code porte sa remorque, et sans code reste l’exécutable nu',
    exe.subarray(0, 2).toString() === 'MZ' && JSON.stringify(lireLaRemorque(new Uint8Array(exe))) === JSON.stringify({ base: BASE, code: '123456' }) && lireLaRemorque(new Uint8Array(brut)) === null,
  );
  const version = await (await fetch(`${BASE}/api/connect/version?systeme=windows`)).json();
  noter('la version servie pour Windows se lit', /^\d+\.\d+\.\d+$/.test(version?.version ?? ''), JSON.stringify(version));
} catch (err) {
  noter('déroulé complet', false, String(err?.stack ?? err).slice(0, 600));
  /* La fin du journal du démon d'essai : ce qu'il disait quand le déroulé est tombé. */
  console.log(`\n— fin du journal du démon —\n${journal.join('').slice(-3000)}`);
} finally {
  await contexte?.close().catch(() => {});
  arreter();
  demonRedemarre?.kill('SIGKILL');
  db.prepare("DELETE FROM sessions WHERE label = 'verif connect linux'").run();
  db.close();
  fs.rmSync(MAISON, { recursive: true, force: true });
}
console.log(`\n${total - echecs}/${total} contrôles verts`);
process.exit(echecs ? 1 : 0);
