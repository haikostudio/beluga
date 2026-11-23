#!/usr/bin/env node
/**
 * LES ORDINATEURS NOMMÉS, DE BOUT EN BOUT (carte « Choisir l'ordinateur visé depuis le téléphone », 15/11/2026).
 *
 * Un démon d'ESSAI monté depuis CETTE copie (base neuve, port à lui, `web/dist` reconstruit avant) :
 *  - deux ordinateurs créés, l'un avec un FAUX CHROME relié par code puis connecté par la voie signée (/ws/chrome) et
 *    un FAUX PROGRAMME DU MAC (relais) en longue attente, l'autre avec un Safari relié mais fermé ;
 *  - Réglages → Extension : les deux lignes, la pastille allumée / éteinte, le renommage par la fenêtre de nom ;
 *  - la barre d'écriture d'une carte : le bouton « Ordinateur », sa liste, le choix retenu pour la carte ;
 *  - le menu « / » : « /ordinateur » puis son second niveau, la pastille d'un bloc, l'effacement d'un bloc ;
 *  - captures à 1440 et 390 px, en clair et en sombre (HAIKO_ORDINATEURS_CAPTURES=<dossier>).
 * Aucun moteur n'est joint : aucun message n'est envoyé.
 *
 *   NODE_ENV=development npm run build && node scripts/verif-ordinateurs.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { WebSocket } from 'ws';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKO_ORDINATEURS_PORT || 7243);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.HAIKO_ORDINATEURS_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok: !!ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
console.log(`  …  dépôt jugé : ${RACINE}`);

const { DATA, attendrePort, journal, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-ordinateurs-',
  port: PORT,
  depot: false,
  signaux: true,
  env: { BELUGA_ADRESSE_PUBLIQUE: BASE, BELUGA_COULISSES_ESSAI: '1' },
});
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const b64url = (b) => Buffer.from(b).toString('base64url');
const hmac = (secret, message) => b64url(crypto.createHmac('sha256', secret).update(message).digest());
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET = 'p-ordi';

if (!(await attendrePort(60_000))) {
  console.log(journal.join('').slice(-3000));
  process.exit(1);
}
const db = new Database(path.join(DATA, 'beluga.db'));
for (let i = 0; i < 60 && !db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'ordinateurs'").get(); i++) await attendre(500);
const maintenant = Date.now();
db.prepare("INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le) VALUES ('u-essai', 'essai', 'admin', 'Essai', 's', 'h', 1, ?)").run(maintenant);
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(sha(jeton), maintenant, maintenant + 3600_000, 'verif ordinateurs', 'u-essai');
const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));
const dossierProjet = path.join(DATA, '..', 'projets', PROJET);
fs.mkdirSync(dossierProjet, { recursive: true });
db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
  PROJET,
  'Atelier Lumen',
  dossierProjet,
  JSON.stringify({ id: PROJET, name: 'Atelier Lumen', path: dossierProjet, defaultEngine: 'claude', branchesDePublication: {}, rank: 1, archived: false, createdAt: maintenant, updatedAt: maintenant }),
  maintenant,
  maintenant,
);

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const w = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie: `beluga_session=${jeton}` } });
    const id = crypto.randomUUID();
    const fin = setTimeout(() => (w.close(), reject(new Error(`sans réponse : ${cmd.type}`))), 30000);
    w.on('open', () => w.send(JSON.stringify({ id, cmd })));
    w.on('message', (brut) => {
      const ev = JSON.parse(String(brut));
      if (ev.type === 'ack' && ev.id === id) {
        clearTimeout(fin);
        w.close();
        ev.ok === false ? reject(new Error(ev.error)) : resolve(ev.data);
      }
    });
    w.on('error', reject);
  });
}
const poster = async (route, corps, entetes = {}) => (await fetch(`${BASE}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...entetes }, body: JSON.stringify(corps) })).json();

let fauxChrome = null;
let relaisVivant = true;
try {
  /* LE DÉCOR : deux ordinateurs, un Chrome en ligne et un programme du Mac sur le premier, un Safari fermé sur le second. */
  const mini = await commande({ type: 'ordinateur.creer', nom: 'Mac' });
  const air = await commande({ type: 'ordinateur.creer', nom: 'MacBook Air' });
  const codeChrome = await commande({ type: 'extension.code', ordinateurId: mini.id });
  const chrome = await poster('/api/extension-chrome/relier', { code: codeChrome.code, nom: 'macOS', version: '1.0.8' });
  noter('un Chrome se relie par un code qui vise un ordinateur', chrome.ok, chrome.raison);
  const codeSafari = await commande({ type: 'extension.code', ordinateurId: air.id });
  const safari = await poster('/api/extension-chrome/relier', { code: codeSafari.code, nom: 'Safari · macOS', navigateur: 'safari', version: '1.0.8' });
  noter('un Safari se relie au second ordinateur', safari.ok, safari.raison);
  const ts = Math.floor(Date.now() / 1000);
  fauxChrome = new WebSocket(`ws://127.0.0.1:${PORT}/ws/chrome?id=${encodeURIComponent(chrome.identifiant)}&ts=${ts}&sig=${encodeURIComponent(hmac(chrome.secret, `${ts}.${chrome.identifiant}.`))}`);
  await new Promise((r, j) => (fauxChrome.once('open', r), fauxChrome.once('error', j)));
  fauxChrome.send(JSON.stringify({ type: 'bonjour', version: '1.0.8' }));
  const codeRelais = await commande({ type: 'relaisMac.code', ordinateurId: mini.id });
  const relais = await poster('/api/relais-mac/relier', { code: codeRelais.code, nom: 'Mac mini du bureau' });
  noter('le programme du Mac se relie au premier ordinateur', relais.ok, relais.raison);
  /* Le faux relais tient sa longue attente, comme le vrai. */
  void (async () => {
    while (relaisVivant) {
      const t = Math.floor(Date.now() / 1000);
      const sig = hmac(relais.secret, `${t}.${relais.identifiant}.${sha('')}`);
      await fetch(`${BASE}/api/relais-mac/attendre?recopie=0&verrouille=0`, { headers: { 'x-relais-id': relais.identifiant, 'x-relais-ts': String(t), 'x-relais-sig': sig } }).catch(() => attendre(1000));
    }
  })();
  await attendre(1500);
  const etat = await commande({ type: 'ordinateur.etat' });
  const leMini = etat.ordinateurs.find((o) => o.id === mini.id);
  noter('le vrai nom du Mac remplace le nom par défaut', leMini?.nom === 'Mac mini du bureau', leMini?.nom);
  noter('le premier ordinateur porte son Chrome et son programme', leMini?.navigateurs.length === 1 && !!leMini?.programme, JSON.stringify(leMini?.programme));
  noter('le second porte un Safari', etat.ordinateurs.find((o) => o.id === air.id)?.navigateurs[0]?.genre === 'safari');

  /* Une carte, sans tour de cadrage (MEM-7274). */
  const { card } = await commande({ type: 'card.create', projectId: PROJET, title: 'Relevé des factures' });
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(`premier-tour-cadrage:${card.id}`, String(Date.now()));

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = async (largeur, hauteur, theme) => {
    const ctx = await navigateur.newContext({
      viewport: { width: largeur, height: hauteur },
      colorScheme: theme,
      serviceWorkers: 'block',
      ...(largeur < 640 ? { isMobile: true, hasTouch: true } : {}),
    });
    await ctx.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await ctx.newPage();
    /* Le thème de l'application suit son réglage, pas le système : on pose la classe du thème voulu à chaque page. */
    await page.addInitScript((sombre) => {
      const poser = () => {
        const racine = document.documentElement;
        if (!racine) return;
        racine.classList.toggle('dark', sombre);
        new MutationObserver(() => {
          if (racine.classList.contains('dark') !== sombre) racine.classList.toggle('dark', sombre);
        }).observe(racine, { attributes: true, attributeFilter: ['class'] });
      };
      document.addEventListener('DOMContentLoaded', poser);
    }, theme === 'dark');
    page.erreurs = [];
    page.on('pageerror', (e) => page.erreurs.push(String(e)));
    return { ctx, page };
  };
  const capturer = async (page, nom) => {
    if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
  };

  for (const [largeur, hauteur, appareil] of [
    [1440, 900, 'ordinateur'],
    [390, 844, 'telephone'],
  ]) {
    for (const theme of ['light', 'dark']) {
      const nomTheme = theme === 'dark' ? 'sombre' : 'clair';
      const { ctx, page } = await contexte(largeur, hauteur, theme);
      const premier = appareil === 'ordinateur' && theme === 'light';

      /* ─── Réglages → Extension ─── */
      await page.goto(`${BASE}/#reglages/extension`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.locator('[data-ordinateur]').first().waitFor({ timeout: 30000 });
      await attendre(800);
      if (premier) {
        const lignes = await page.locator('[data-ordinateur]').evaluateAll((n) => n.map((x) => ({ id: x.getAttribute('data-ordinateur'), enLigne: x.getAttribute('data-en-ligne'), nom: x.querySelector('[data-nom-ordinateur]')?.textContent })));
        noter('Réglages → Extension montre les deux ordinateurs', lignes.length === 2, JSON.stringify(lignes));
        noter('le Mac mini est allumé, le MacBook éteint', lignes.find((l) => l.id === mini.id)?.enLigne === 'oui' && lignes.find((l) => l.id === air.id)?.enLigne === 'non');
        noter('chaque navigateur relié garde son repère', (await page.locator('[data-chrome-relie]').count()) === 2);
        /* Renommer par le menu de la ligne, puis la fenêtre de nom. */
        await page.locator(`[data-ordinateur="${air.id}"] [data-options-ordinateur]`).click();
        await page.locator('[data-renommer-ordinateur]').click();
        await page.locator('[data-champ-nom-ordinateur]').fill('MacBook de Léa');
        await page.locator('[data-valider-nom-ordinateur]').click();
        const renomme = await page.waitForFunction((id) => document.querySelector(`[data-ordinateur="${id}"] [data-nom-ordinateur]`)?.textContent === 'MacBook de Léa', air.id, { timeout: 10000 }).then(() => true, () => false);
        noter('renommer un ordinateur met sa ligne à jour', renomme);
        /* LA PAGE D'UN ORDINATEUR (carte « Beluga Connect : installation simplifiée », 21/11/2026) : la liaison se
           fait depuis l'ordinateur lui-même (« Ajouter cet ordinateur » → « Lier ») ; sa page dit Beluga Connect et ses navigateurs. */
        await page.locator(`[data-ouvrir-ordinateur="${air.id}"]`).click();
        const fiche = await page.locator(`[data-page-ordinateur="${air.id}"]`).waitFor({ timeout: 10000 }).then(() => true, () => false);
        noter('la page de l’ordinateur s’ouvre, avec ses navigateurs reliés', fiche && (await page.locator('[data-delier-navigateur]').count()) >= 1);
        await capturer(page, 'page-ordinateur-clair');
        await page.locator('[data-retour-ordinateurs]:visible').first().click();
        await attendre(400);
      }
      noter(`rien ne déborde en largeur (réglages, ${appareil}, ${nomTheme})`, (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
      await page.locator('[data-ordinateur]').first().scrollIntoViewIfNeeded();
      await capturer(page, `reglages-extension-${appareil}-${nomTheme}`);

      /* ─── La barre d'écriture d'une carte ─── */
      await page.goto('about:blank');
      await page.goto(`${BASE}/#projet/${PROJET}/tache/${card.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const bouton = page.locator('[data-choix-ordinateur]:visible').last();
      const vu = await bouton.waitFor({ timeout: 30000 }).then(() => true, () => false);
      noter(`le bouton « Ordinateur » paraît dans la barre d'écriture (${appareil}, ${nomTheme})`, vu);
      if (!vu) {
        await capturer(page, `echec-barre-${appareil}-${nomTheme}`);
        await ctx.close();
        continue;
      }
      await bouton.click();
      const options = page.locator('[data-liste-panneau="ordinateur"] [data-liste-option]');
      await options.first().waitFor({ timeout: 10000 });
      noter(`la liste des ordinateurs s'ouvre (${appareil}, ${nomTheme})`, (await options.count()) === 2);
      await attendre(700); /* la fin de l'animation d'ouverture */
      await capturer(page, `barre-ordinateur-${appareil}-${nomTheme}`);
      if (premier) {
        await page.locator(`[data-liste-panneau="ordinateur"] [data-liste-option="${air.id}"]`).click();
        await attendre(1200);
        const agentId = db.prepare('SELECT agent_id FROM cards WHERE id = ?').get(card.id)?.agent_id;
        const retenu = db.prepare('SELECT ordinateur_id FROM chrome_cartes WHERE cle = ?').get(`carte:${card.id}`)?.ordinateur_id;
        noter('le choix est retenu pour la carte', retenu === air.id, `${retenu} (agent ${agentId})`);
        noter('le bouton montre l’ordinateur choisi', (await bouton.getAttribute('data-choix-ordinateur')) === air.id);

        /* ─── « /ordinateur » et son second niveau ─── */
        const zone = page.locator('[data-composer]').filter({ has: page.locator('textarea:visible') }).last().locator('textarea').last();
        await zone.click();
        await zone.fill('');
        await zone.type('Ouvre Mail /ordi', { delay: 40 });
        await attendre(1200);
        const menu = await page.locator('[data-menu-slash] [data-commande]').evaluateAll((n) => n.map((x) => x.getAttribute('data-commande')));
        noter('« /ordi » propose la commande « ordinateur »', menu.includes('ordinateur'), menu.join(', '));
        await page.locator('[data-menu-slash] [data-commande="ordinateur"]').first().click();
        await attendre(1000);
        const second = await page.locator('[data-menu-slash] [data-commande]').evaluateAll((n) => n.map((x) => x.getAttribute('data-commande')));
        noter('choisir « ordinateur » ouvre la liste des ordinateurs', second.includes('ordinateur:mac-mini-du-bureau') && second.includes('ordinateur:macbook-de-lea'), second.join(', '));
        await capturer(page, 'menu-ordinateur-second-niveau');
        await page.locator('[data-menu-slash] [data-commande="ordinateur:mac-mini-du-bureau"]').first().click();
        await attendre(800);
        noter('le choix écrit « /ordinateur:mac-mini-du-bureau »', (await zone.inputValue()).includes('/ordinateur:mac-mini-du-bureau '), await zone.inputValue());
        const pastilles = await page.locator('[data-prompt-calque] [data-commande-pastille]').evaluateAll((n) => n.map((x) => x.getAttribute('data-commande-pastille')));
        noter('elle se lit en UNE pastille', pastilles.length === 1 && pastilles[0] === 'ordinateur:mac-mini-du-bureau', pastilles.join(', '));
        await capturer(page, 'pastille-ordinateur');
        /* Le curseur JUSTE DERRIÈRE la pastille (comme `verif-commandes-slash.mjs`) : un retour arrière l'emporte entière. */
        await zone.fill('Ouvre Mail /ordinateur:mac-mini-du-bureau vite');
        await attendre(400);
        const fin = 'Ouvre Mail /ordinateur:mac-mini-du-bureau'.length;
        await zone.evaluate((el, n) => el.setSelectionRange(n, n), fin);
        await zone.press('Backspace');
        await attendre(400);
        noter('le retour arrière l’efface d’un bloc', (await zone.inputValue()) === 'Ouvre Mail vite', await zone.inputValue());
        await zone.fill('');
      }
      noter(`rien ne déborde en largeur (barre, ${appareil}, ${nomTheme})`, (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
      noter(`aucune erreur de page (${appareil}, ${nomTheme})`, page.erreurs.length === 0, page.erreurs.join(' | ').slice(0, 300));
      await ctx.close();
    }
  }
  await navigateur.close();
} catch (err) {
  noter('déroulé complet', false, String(err?.stack ?? err).slice(0, 800));
} finally {
  relaisVivant = false;
  fauxChrome?.close();
  db.close();
  nettoyer();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.${CAPTURES ? ` Captures : ${CAPTURES}` : ''}`);
if (echecs.length) console.log(journal.join('').split('\n').filter((l) => /erreur|error|ordinateur/i.test(l)).slice(-20).join('\n'));
process.exit(echecs.length ? 1 : 0);
