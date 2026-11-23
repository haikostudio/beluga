#!/usr/bin/env node
/**
 * LA VEILLE PRIVÉE ET LE RÉVEIL « DIS JARVIS », DANS UN VRAI NAVIGATEUR, AVEC UN VRAI SON.
 *
 * Carte « Veille privée et réveil « Dis Jarvis » » (16/11/2026). Le module de voix n'a plus que deux boutons
 * (« Voix », « Micro ») ; micro ouvert et conversation fermée, le mot est attendu SUR L'APPAREIL (Vosk en
 * WebAssembly) et AUCUN son ne part. Ce contrôle le prouve avec un FAUX MICRO qui parle vraiment : des phrases
 * fabriquées par la voix du serveur (Piper), posées dans un fichier son que Chrome joue comme un micro
 * (`--use-file-for-fake-audio-capture`). Il juge :
 *
 *   1. les boutons « Voix » et « Micro » ([data-interrupteur-voix], [data-interrupteur-micro]) vivent dans Réglages ›
 *      Voix depuis le retrait de l'ancien module (16/11/2026, Jarvis au bord partout) ; les anciens repères
 *      (conversation, oreille, muet) ont disparu ;
 *   2. Voix désactivée : aucune parole (annonce provoquée), aucun micro, aucune connexion, Micro inerte, et l'état
 *      survit au rechargement ;
 *   3. Micro ouvert, conversation fermée, ~25 s de parole AMBIANTE : aucune requête de transcription, aucune
 *      commande `voix.direct.*`, aucune connexion WebRTC, aucun réveil ;
 *   4. un vrai « Dis Jarvis, quelles tâches sont en cours ? » ouvre la conversation (`voix.direct.demarrer`) ;
 *   5. 30 s de silence la referment TOUT ENTIÈRE (connexion « closed », `voix.direct.arreter`) avec le petit son,
 *      et l'attente du mot reprend ;
 *   6. « mets-toi en veille » (point d'essai) la referme de même ;
 *   7. après rechargement, le Micro repart coupé.
 *
 * Un DÉMON D'ESSAI (base neuve, aucun compte Codex : le direct échoue avant tout moteur, aucun quota) et le serveur
 * de développement de la copie, branché sur lui (`BELUGA_DEMON_PORT`) — le point d'essai `belugaEssai` n'existe
 * qu'hors production. Jamais BELUGA_URL, jamais BELUGA_TOKEN.
 *
 *   env -u BELUGA_TOKEN node scripts/verif-veille-jarvis.mjs
 *   VERIF_CAPTURES=/chemin node scripts/verif-veille-jarvis.mjs   # + captures 1440/390, clair/sombre
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7203);
const PORT_WEB = Number(process.env.BELUGA_VERIF_PORT_WEB || 7104);
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ---------------- Les sons : la voix du serveur, dans un fichier que Chrome joue comme un micro ---------------- */

const SONS = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-veille-sons-'));
function dataDesOutils() {
  return fs.existsSync(path.join(RACINE, 'data', 'venv')) ? path.join(RACINE, 'data') : '/root/beluga/data';
}
function dire(texte, fichier) {
  const outils = dataDesOutils();
  execFileSync(path.join(outils, 'venv', 'bin', 'python'), ['-m', 'piper', '--model', path.join(outils, 'models', 'piper', 'fr_FR-tom-medium.onnx'), '--output_file', fichier], {
    input: texte,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
}
/** Assemble des morceaux (fichiers ou silences en secondes) en un wav 48 kHz mono. */
function assembler(sortie, morceaux) {
  const entrees = [];
  for (const m of morceaux) {
    if (typeof m === 'number') entrees.push('-f', 'lavfi', '-t', String(m), '-i', 'anullsrc=r=44100:cl=mono');
    else entrees.push('-i', m);
  }
  const filtre = `${morceaux.map((_, i) => `[${i}]`).join('')}concat=n=${morceaux.length}:v=0:a=1`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...entrees, '-filter_complex', filtre, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', sortie]);
}
const mot = path.join(SONS, 'mot.wav');
const demande = path.join(SONS, 'demande.wav');
const ambiance = path.join(SONS, 'ambiance.wav');
dire('Dis Jarvis.', mot);
dire('Quelles tâches sont en cours ?', demande);
dire(
  "Bon, on reprend la réunion. Le client veut revoir les couleurs du site et la page d'accueil. Il faudrait aussi relancer le devis de la semaine dernière, et vérifier les factures du mois. Ensuite on parlera du planning des vacances et de la nouvelle imprimante du bureau.",
  ambiance,
);
const SON_REVEIL = path.join(SONS, 'reveil-demande.wav');
const SON_AMBIANCE = path.join(SONS, 'ambiance-longue.wav');
// Douze secondes de silence d'abord : le temps de charger le modèle après l'ouverture du micro.
assembler(SON_REVEIL, [12, mot, 0.15, demande, 60]);
assembler(SON_AMBIANCE, [8, ambiance, ambiance, 20]);

/* ---------------- Le démon d'essai et le serveur de développement branché sur lui ---------------- */

const { DATA, journal, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-veille-', port: PORT, signaux: true });
const jeton = crypto.randomBytes(32).toString('hex');

const vite = spawn('npm', ['run', 'dev', '--workspace', 'web', '--', '--port', String(PORT_WEB), '--strictPort'], {
  cwd: RACINE,
  env: { ...process.env, BELUGA_DEMON_PORT: String(PORT), NODE_ENV: 'development', BELUGA_URL: '', BELUGA_TOKEN: '' },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const journalVite = [];
vite.stdout.on('data', (d) => journalVite.push(String(d)));
vite.stderr.on('data', (d) => journalVite.push(String(d)));
const couperVite = () => {
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
};
process.on('exit', () => {
  couperVite();
  fs.rmSync(SONS, { recursive: true, force: true });
});

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const T = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai veille');
  const pref = db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)');
  pref.run('voix.visible', 'true', T);
  db.close();
}
function poserLeTheme(clarte) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('theme', JSON.stringify(clarte), Date.now());
  db.close();
}

/* ---------------- Les espions posés dans la page ---------------- */

async function ouvrirNavigateur(son) {
  return chromium.launch({
    channel: 'chrome',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${son}%noloop`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
}

async function ouvrirPage(navigateur, { telephone = false } = {}) {
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
    permissions: ['microphone'],
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  await contexte.addInitScript(() => {
    // Les connexions WebRTC créées, et leur état final.
    window.__connexions = [];
    const PC = window.RTCPeerConnection;
    if (PC) {
      window.RTCPeerConnection = function (...a) {
        const pc = new PC(...a);
        window.__connexions.push(pc);
        return pc;
      };
      window.RTCPeerConnection.prototype = PC.prototype;
    }
    // Les commandes envoyées au démon par le canal.
    window.__commandes = [];
    const envoyer = WebSocket.prototype.send;
    WebSocket.prototype.send = function (donnees) {
      try {
        const cmd = JSON.parse(donnees)?.cmd;
        const type = cmd?.type;
        if (type) window.__commandes.push(type);
        // Le salut demandé à chaque ouverture voulue — geste ET mot de réveil (décision du 18/11/2026).
        if (type === 'voix.direct.demarrer') (window.__appels ??= []).push(cmd.appel === true);
      } catch {
        /* pas du JSON */
      }
      return envoyer.call(this, donnees);
    };
  });
  const page = await contexte.newPage();
  page.setDefaultTimeout(20_000);
  const erreurs = [];
  const requetes = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/')) requetes.push(u.pathname);
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-module-voix]', { timeout: 60_000 });
  await page.waitForTimeout(1500);
  for (let essai = 0; essai < 3 && (await page.locator('[role="dialog"]').count()); essai += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  return { contexte, page, erreurs, requetes };
}

/**
 * LES BOUTONS « VOIX » ET « MICRO » VIVENT DANS RÉGLAGES › VOIX depuis le 16/11/2026 : l'ancien module flottant (et son
 * panneau) a été retiré au profit de Jarvis au bord. « Ouvrir le module » = poser la page Réglages › Voix, où ils sont.
 */
async function ouvrirModule(page) {
  await page.evaluate(() => (window.location.hash = '#reglages/voix'));
  return page
    .locator('[data-interrupteur-voix]')
    .first()
    .waitFor({ state: 'attached', timeout: 15_000 })
    .then(() => true, () => false);
}

const lire = (page) =>
  page.evaluate(() => {
    const m = document.querySelector('[data-module-voix]');
    return {
      etat: m?.getAttribute('data-etat-reveil') ?? null,
      conversation: m?.hasAttribute('data-conversation') ?? false,
      voixActive: m?.hasAttribute('data-voix-active') ?? false,
      // Les interrupteurs de Réglages › Voix : leur état coché, dit en toutes lettres comme l'ancien module le disait.
      voix: (() => {
        const b = document.querySelector('[data-interrupteur-voix]');
        return b ? (b.getAttribute('aria-checked') === 'true' ? 'Voix activée' : 'Voix désactivée') : null;
      })(),
      micro: (() => {
        const b = document.querySelector('[data-interrupteur-micro]');
        return b ? (b.getAttribute('aria-checked') === 'true' ? 'Micro ouvert' : 'Micro coupé') : null;
      })(),
      microInerte: document.querySelector('[data-interrupteur-micro]')?.hasAttribute('disabled') ?? null,
      micros: window.belugaEssai?.micros?.() ?? null,
      connexions: (window.__connexions ?? []).map((pc) => pc.connectionState + '/' + pc.signalingState),
      commandes: [...(window.__commandes ?? [])],
      appels: [...(window.__appels ?? [])],
      sons: window.__belugaSonsDeVeille ?? 0,
    };
  });
const clic = (page, selecteur) => page.locator(selecteur).first().dispatchEvent('click');
const attendreConversation = (page, ouverte, delai = 5000) =>
  page
    .waitForFunction((o) => document.querySelector('[data-module-voix]')?.hasAttribute('data-conversation') === o, ouverte, { timeout: delai })
    .then(() => true)
    .catch(() => false);
const attendreEtat = (page, etat, delai = 60_000) =>
  page
    .waitForFunction((e) => document.querySelector('[data-module-voix]')?.getAttribute('data-etat-reveil') === e, etat, { timeout: delai })
    .then(() => true)
    .catch(() => false);

async function capturer(page, nom) {
  if (!CAPTURES) return;
  // La souris sur l'en-tête du module (il reste ouvert), jamais sur les ondes : leur infobulle masquerait la phrase.
  const haut = await page.evaluate(() => {
    const r = document.querySelector('[data-module-voix]')?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + 4 } : null;
  });
  if (haut) await page.mouse.move(haut.x, haut.y);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

/* ---------------- Le déroulé ---------------- */

let navigateurs = [];
try {
  if (!(await attendrePort())) throw new Error('le démon d’essai n’a pas démarré :\n' + journal.join('').slice(-2000));
  poserLeDecor();
  const viteOk = await fetch(BASE).then(() => true).catch(() => false);
  for (let i = 0; i < 60 && !(await fetch(BASE).then(() => true).catch(() => false)); i += 1) await new Promise((r) => setTimeout(r, 1000));
  void viteOk;

  /* ===== A. Parole ambiante ===== */
  const navAmbiance = await ouvrirNavigateur(SON_AMBIANCE);
  navigateurs.push(navAmbiance);
  let { page, erreurs, requetes } = await ouvrirPage(navAmbiance);

  // 1. Deux boutons seulement, nommés.
  verifier('le module de voix s’ouvre', await ouvrirModule(page));
  let l = await lire(page);
  // Les anciens repères, recomposés ici pour ne pas les citer : ils n'existent plus nulle part dans l'interface.
  const anciens = await page.evaluate(() =>
    ['interrupteur-conversation', 'interrupteur-ecoute', 'muet-voix', 'dictee'].map((n) => `[data-${n}]`).filter((s) => document.querySelector(s)),
  );
  verifier('Réglages › Voix porte les boutons « Voix » et « Micro » (activée, coupé)', l.voix === 'Voix activée' && l.micro === 'Micro coupé', `${l.voix} / ${l.micro}`);
  verifier('les anciens boutons (conversation, oreille, muet) et la bande de dictée ont disparu', anciens.length === 0, anciens.join(', '));
  // Retiré le 17/11/2026 : il ne faisait que refléter la conversation en cours — ce n'était pas un réglage.
  const interrupteurCodex = await page.evaluate(() => document.body.innerText.includes(['Conversation en direct', 'avec Codex'].join(' ')));
  verifier('Réglages › Voix n’a plus l’interrupteur « Conversation en direct avec Codex »', !interrupteurCodex);
  verifier('micro fermé : Jarvis au bord n’attend rien', l.etat === 'eteint', String(l.etat));
  await capturer(page, 'ordinateur-micro-coupe');

  // 2. Voix désactivée : tout est coupé.
  await clic(page, '[data-interrupteur-voix]');
  await page.waitForTimeout(800);
  const avantAnnonce = requetes.filter((r) => r === '/api/speak').length;
  await page.evaluate(() => window.belugaEssai?.annonce?.('Annonce qui ne doit pas être dite'));
  await page.waitForTimeout(1500);
  l = await lire(page);
  verifier('Voix désactivée : le bouton le dit, le Micro est grisé et inerte', l.voix === 'Voix désactivée' && l.microInerte === true, `${l.voix} / inerte=${l.microInerte}`);
  verifier('une fin de tâche n’est jamais dite à voix haute (la voix du serveur est retirée)', requetes.filter((r) => r === '/api/speak').length === avantAnnonce);
  await clic(page, '[data-interrupteur-micro]');
  await page.waitForTimeout(800);
  l = await lire(page);
  verifier('Voix désactivée : aucun micro ouvert, aucune connexion', l.micros === 0 && l.connexions.length === 0, `micros=${l.micros} connexions=${l.connexions.length}`);
  verifier('Voix désactivée : Jarvis au bord le dit (rond pâli)', !l.voixActive, String(l.voixActive));
  await capturer(page, 'ordinateur-voix-desactivee');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-module-voix]', { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await ouvrirModule(page);
  l = await lire(page);
  verifier('Voix désactivée : l’état survit au rechargement', l.voix === 'Voix désactivée', l.voix);
  await clic(page, '[data-interrupteur-voix]');
  await page.waitForTimeout(800);

  // 3. Micro ouvert, parole ambiante : rien ne part.
  requetes.length = 0;
  await page.evaluate(() => (window.__commandes.length = 0));
  await clic(page, '[data-interrupteur-micro]');
  const chargementVu = await page
    .waitForFunction(() => ['ouverture', 'chargement', 'attente'].includes(document.querySelector('[data-module-voix]')?.getAttribute('data-etat-reveil') ?? ''), null, { timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  verifier('dès le clic, l’écoute de « Dis Jarvis » se prépare', chargementVu);
  const enAttente = await attendreEtat(page, 'attente');
  l = await lire(page);
  verifier('le détecteur local se charge et attend le mot', enAttente, `état « ${l.etat} »`);
  verifier('Jarvis au bord montre qu’il attend le mot (repère d’attente)', await page.locator('[data-attente-du-mot]').count() === 1);
  await capturer(page, 'ordinateur-attente-du-mot');
  await page.waitForTimeout(25_000);
  l = await lire(page);
  const transcriptions = requetes.filter((r) => r === '/api/transcribe').length;
  // « Jarvis prêt à l'avance » (`voix.direct.preparer`) ne porte aucun son et n'ouvre aucune ligne : il est permis.
  const directes = l.commandes.filter((c) => c.startsWith('voix.direct') && c !== 'voix.direct.preparer');
  verifier('25 s de parole ambiante : AUCUNE requête de transcription', transcriptions === 0, `${transcriptions}`);
  verifier('25 s de parole ambiante : AUCUNE commande voix.direct.*', directes.length === 0, directes.join(', '));
  verifier('25 s de parole ambiante : AUCUNE connexion WebRTC, aucun réveil', l.connexions.length === 0 && l.etat === 'attente' && !l.conversation, `connexions=${l.connexions.length} état=${l.etat}`);
  verifier('une seule prise de micro ouverte', l.micros === 1, `${l.micros}`);

  // 7. Rechargement : le micro repart coupé.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-module-voix]', { timeout: 60_000 });
  await page.waitForTimeout(3000);
  l = await lire(page);
  verifier('après rechargement, le micro repart coupé, aucune prise', l.etat === 'eteint' && l.micros === 0, `état=${l.etat} micros=${l.micros}`);
  verifier('aucune erreur ne sort de la page (ambiance)', erreurs.length === 0, erreurs[0] ?? '');
  await navAmbiance.close();
  navigateurs = [];

  /* ===== B. « Dis Jarvis, quelles tâches sont en cours ? » ===== */
  const navReveil = await ouvrirNavigateur(SON_REVEIL);
  navigateurs.push(navReveil);
  ({ page, erreurs, requetes } = await ouvrirPage(navReveil));
  await ouvrirModule(page);
  await clic(page, '[data-interrupteur-micro]');
  verifier('micro ouvert : le détecteur attend le mot', await attendreEtat(page, 'attente'));
  const t0 = Date.now();
  const reveille = await page
    .waitForFunction(() => (window.__commandes ?? []).includes('voix.direct.demarrer'), null, { timeout: 45_000 })
    .then(() => true)
    .catch(() => false);
  l = await lire(page);
  verifier('« Dis Jarvis » dit au micro ouvre la conversation (voix.direct.demarrer)', reveille && l.conversation, `${Math.round((Date.now() - t0) / 100) / 10} s après l’attente, état ${l.etat}, voix ${l.voixActive}`);
  verifier('la conversation emprunte le micro du réveil : une seule prise', l.micros === 1, `${l.micros}`);
  verifier('réveil par le mot : le salut est demandé aussi (« Salut <prénom>, je t’écoute. », 18/11/2026)', l.appels.length === 1 && l.appels[0] === true, JSON.stringify(l.appels));
  verifier('une connexion WebRTC est créée pour la conversation', l.connexions.length === 1, l.connexions.join(', '));
  await page.waitForTimeout(1500);
  await capturer(page, 'ordinateur-conversation');

  // 5. Le silence : la conversation se referme tout entière, avec le petit son.
  await page.evaluate(() => window.belugaEssai?.silenceDeVeille?.());
  const refermee = (await attendreConversation(page, false)) && (await attendreEtat(page, 'attente', 5000));
  await page.waitForTimeout(500);
  l = await lire(page);
  verifier('30 s de silence : la conversation se referme et l’attente du mot reprend', refermee, `état ${l.etat}`);
  verifier('30 s de silence : la connexion est COMPLÈTEMENT fermée', l.connexions.length >= 1 && l.connexions.every((c) => c.startsWith('closed') || c.endsWith('/closed')), l.connexions.join(', '));
  verifier('30 s de silence : la session du démon est arrêtée (voix.direct.arreter)', l.commandes.includes('voix.direct.arreter'));
  verifier('30 s de silence : le petit son de veille est joué', l.sons === 1, `${l.sons}`);
  await page.waitForTimeout(3000);
  l = await lire(page);
  verifier('rien ne relance la conversation après la veille', l.etat === 'attente' && l.commandes.filter((c) => c === 'voix.direct.demarrer').length === 1, `état ${l.etat}`);

  // 6. « Mets-toi en veille ».
  await page.evaluate(() => window.belugaEssai?.reveil?.());
  const rouverte = await page
    .waitForFunction(() => (window.__commandes ?? []).filter((c) => c === 'voix.direct.demarrer').length === 2, null, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(1000);
  verifier('le point d’essai réveille par le même chemin que le mot', rouverte);
  const demandee = await page.evaluate(() => window.belugaEssai?.demanderLaVeille?.('Mets-toi en veille, s’il te plaît'));
  const refermee2 = (await attendreConversation(page, false)) && (await attendreEtat(page, 'attente', 5000));
  l = await lire(page);
  verifier('« mets-toi en veille » referme la conversation, avec le son', !!demandee && refermee2 && l.sons === 2, `demandée=${demandee} état=${l.etat} sons=${l.sons}`);

  // Ouverte d'un GESTE (bouton du bord, raccourci, bouton voix d'un champ) : l'appel « Jarvis ? » est demandé (salut).
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:parler-a-jarvis', { detail: { agentId: null } })));
  const parGeste = await page
    .waitForFunction(() => (window.__appels ?? []).length === 3, null, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  l = await lire(page);
  verifier('ouverte d’un geste : le salut est demandé', parGeste && l.appels[2] === true, JSON.stringify(l.appels));
  await page.evaluate(() => window.belugaEssai?.demanderLaVeille?.('Mets-toi en veille, s’il te plaît'));
  await attendreConversation(page, false, 15_000);
  await attendreEtat(page, 'attente', 5000);

  // Voix désactivée en pleine attente : tout se ferme.
  await clic(page, '[data-interrupteur-voix]');
  await page.waitForTimeout(1000);
  l = await lire(page);
  verifier('Voix désactivée en pleine attente : micro fermé', l.micros === 0 && l.etat === 'eteint', `micros=${l.micros} état=${l.etat}`);
  await clic(page, '[data-interrupteur-voix]');
  verifier('aucune erreur ne sort de la page (réveil)', erreurs.length === 0, erreurs[0] ?? '');
  await navReveil.close();
  navigateurs = [];

  /* ===== Captures demandées par la charte : 1440 et 390, clair et sombre ===== */
  if (CAPTURES) {
    for (const clarte of ['clair', 'sombre']) {
      poserLeTheme(clarte);
      const nav = await ouvrirNavigateur(SON_AMBIANCE);
      navigateurs.push(nav);
      for (const telephone of [false, true]) {
        const o = await ouvrirPage(nav, { telephone });
        const p = o.page;
        await ouvrirModule(p);
        const appareil = telephone ? 'telephone' : 'ordinateur';
        await capturer(p, `${appareil}-${clarte}-micro-coupe`);
        await clic(p, '[data-interrupteur-micro]');
        await attendreEtat(p, 'attente');
        await ouvrirModule(p);
        await capturer(p, `${appareil}-${clarte}-attente`);
        await clic(p, '[data-interrupteur-voix]');
        await p.waitForTimeout(600);
        await ouvrirModule(p);
        await capturer(p, `${appareil}-${clarte}-voix-desactivee`);
        await clic(p, '[data-interrupteur-voix]');
        await p.waitForTimeout(600);
        const deborde = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        verifier(`${appareil} ${clarte} : rien ne déborde en largeur`, deborde <= 0, `${deborde} px`);
        await o.contexte.close();
      }
      await nav.close();
      navigateurs = [];
    }
  }
} catch (e) {
  verifier('le contrôle est allé au bout', false, String(e).slice(0, 400));
} finally {
  for (const n of navigateurs) await n.close().catch(() => undefined);
  couperVite();
  nettoyer();
}

const rates = resultats.filter((r) => !r).length;
console.log(`\n${resultats.length - rates}/${resultats.length} contrôles passés`);
process.exit(rates ? 1 : 0);
