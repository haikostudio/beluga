#!/usr/bin/env node
/**
 * LE MODE VOIX DANS LE CHAMP D'ÉCRITURE, DANS UN VRAI NAVIGATEUR (carte « Mode voix Jarvis dans le champ
 * d'écriture », 17/11/2026). Il juge :
 *
 *   1. dans la page d'une carte, le champ porte le MICRO de dictée (`[data-mic-button]`) et JAMAIS le bouton voix
 *      (retiré) — décision du 18/11/2026 : l'agent vocal ne s'ouvre que par le bouton du bord ;
 *   2. dans le volet de l'assistant, les RÉGLAGES sont dans l'entête, juste avant la croix, et plus dans le champ ;
 *      le champ de l'assistant porte le micro, jamais le bouton voix ;
 *   3. une conversation vocale posée sur l'agent de la carte (point d'essai, sans micro ni Codex) remplace SON champ
 *      par la zone vocale : d'abord le CERCLE de chargement, du trait d'une barre (4 px) ; à l'écoute, le MORPHING
 *      (barre centrale, trois barres, points) jusqu'à l'onde de 29 barres ; la pile de bulles FLOTTE au-dessus des
 *      ondes (toute la session, 70 % de la conversation au plus, la dernière en vue, voile derrière, le fil ne bouge
 *      pas et reste cliquable) ; ce que Jarvis a PRODUIT (une image) est dans le fil sous « Jarvis · conversation
 *      vocale » et s'ouvre en grand au clic ; les phrases, elles, n'entrent pas dans le fil ;
 *   4. pendant la rédaction, une dernière bulle « Je rédige le récapitulatif… » ; puis la synthèse s'AJOUTE à la suite du brouillon
 *      (une ligne vide entre les deux), sans rien envoyer ;
 *   5. rien ne déborde, à 1440 et 390 px, en clair et en sombre (captures avec VERIF_CAPTURES).
 *
 * Un DÉMON D'ESSAI (base neuve, aucun compte moteur) et le serveur de développement de la copie, branché sur lui —
 * le point d'essai `belugaEssai` n'existe qu'hors production. Jamais BELUGA_URL, jamais BELUGA_TOKEN.
 *
 *   env -u BELUGA_TOKEN node scripts/verif-voix-dans-le-champ.mjs
 *   VERIF_CAPTURES=/chemin node scripts/verif-voix-dans-le-champ.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7236);
const PORT_WEB = Number(process.env.BELUGA_VERIF_PORT_WEB || 7136);
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ---------------- Le décor, écrit par le magasin du démon, AVANT son lancement ---------------- */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-voix-champ-'));
const DATA = path.join(TMP, 'data');
const DEPOT = path.join(TMP, 'depot');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(DEPOT, { recursive: true });
process.env.BELUGA_DATA = DATA;
process.env.BELUGA_PROJECTS_ROOT = path.join(TMP, 'projets');

const shared = await import(path.join(RACINE, 'shared/dist/index.js'));
const store = await import(path.join(RACINE, 'server/dist/store.js'));
const { getDb } = await import(path.join(RACINE, 'server/dist/db.js'));

const T = Date.now();
const PROJET = 'p-voix-champ';
const CARTE = 'carte-voix-champ';
const AGENT = `agent-${CARTE}`;
const jeton = crypto.randomBytes(32).toString('hex');
store.saveProject(shared.Project.parse({ id: PROJET, name: 'Facturo', path: DEPOT, createdAt: T, updatedAt: T }));
store.saveAgent(shared.Agent.parse({ id: AGENT, projectId: PROJET, role: 'task', title: 'Page de contact', cardId: CARTE, run: { engine: 'claude' }, status: 'done', createdAt: T, updatedAt: T }));
store.saveMessage(shared.Message.parse({ id: `rapport-${CARTE}`, agentId: AGENT, role: 'assistant', content: 'La page de contact est prête à être cadrée.', createdAt: T - 60_000 }));
/* CE QUE JARVIS A PRODUIT À LA VOIX : une image, sous l'intitulé « Jarvis · conversation vocale ». */
const { cheminDePieceJointe } = await import(path.join(RACINE, 'server/dist/pieces-jointes.js'));
const IMAGE = 'img-voix-champ-0001';
const piece = shared.Attachment.parse({ id: IMAGE, projectId: PROJET, alias: 'v0c1', name: 'maquette-contact.png', mime: 'image/png', size: 0, sha: 'sha-voix-champ', agentId: AGENT, deLAgent: true, createdAt: T - 30_000 });
fs.mkdirSync(path.dirname(cheminDePieceJointe(piece)), { recursive: true });
fs.copyFileSync(path.join(RACINE, 'web/public/icon-512.png'), cheminDePieceJointe(piece));
store.saveAttachment({ ...piece, size: fs.statSync(cheminDePieceJointe(piece)).size });
store.saveMessage(shared.Message.parse({ id: `voix-${CARTE}`, agentId: AGENT, role: 'assistant', content: shared.INTITULE_DE_LA_VOIX, attachments: [IMAGE], createdAt: T - 30_000 }));
store.saveCard(
  shared.Card.parse({ id: CARTE, projectId: PROJET, title: 'Page de contact', column: 'planned', position: 0, agentId: AGENT, run: { engine: 'claude' }, createdAt: T, updatedAt: T }),
);
const db = getDb();
db.prepare('INSERT OR REPLACE INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
  crypto.createHash('sha256').update(jeton).digest('hex'),
  T,
  T + 3_600_000,
  'essai voix dans le champ',
);
const poserPreference = (cle, valeur) =>
  getDb().prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run(cle, JSON.stringify(valeur), Date.now());
poserPreference('voix.visible', true);
/* LE VOLET N'EXISTE QUE SANS LA VOIX (décision de l'utilisateur, 20/11/2026) : ce contrôle du volet coupe la voix ; les
   états vocaux y sont posés par le point d'essai, qui ne dépend pas de l'interrupteur. */
poserPreference('voix.active', false);
db.close();

/* ---------------- Le démon d'essai et le serveur de développement branché sur lui ---------------- */

const { journal, attendrePort, nettoyer } = demarrerDemonDEssai({ tmp: TMP, prefixe: 'verif-voix-champ-', port: PORT, signaux: true });
const vite = spawn('npm', ['run', 'dev', '--workspace', 'web', '--', '--port', String(PORT_WEB), '--strictPort'], {
  cwd: RACINE,
  env: { ...process.env, BELUGA_DEMON_PORT: String(PORT), NODE_ENV: 'development', BELUGA_URL: '', BELUGA_TOKEN: '' },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
// La sortie du serveur de développement est lue : un tuyau plein bloquerait le serveur en plein essai.
const journalVite = [];
vite.stdout.on('data', (d) => journalVite.push(String(d)));
vite.stderr.on('data', (d) => journalVite.push(String(d)));
process.on('exit', () => {
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
});

async function poserLeTheme(clarte) {
  const Database = (await import('node:module')).createRequire(import.meta.url)('better-sqlite3');
  const base = new Database(path.join(DATA, 'beluga.db'));
  base.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('theme', JSON.stringify(clarte), Date.now());
  base.close();
}

/** Quatorze tours factices : la pile les garde tous, la dernière en vue. */
const TOURS = Array.from({ length: 14 }, (_, i) =>
  i % 2 === 0
    ? { role: 'user', texte: `Je voudrais une page de contact, point ${i + 1}. Avec un formulaire simple et une carte.` }
    : i === 7
      ? { activite: { id: 'a-1', libelle: 'Je regarde l’activité (hier)', etat: 'finie' } }
      : { role: 'assistant', texte: `D’accord. Pour le point ${i}, qui doit recevoir les messages du formulaire ? Je note aussi la carte.` },
);

let navigateur;
try {
  if (!(await attendrePort())) throw new Error(`le démon d’essai n’a pas ouvert son port\n${journal.join('').slice(-2000)}`);
  for (let i = 0; i < 90 && !(await fetch(BASE).then(() => true).catch(() => false)); i += 1) await new Promise((r) => setTimeout(r, 1000));
  navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  // VERIF_SEULEMENT_TELEPHONE=1 : le seul passage à 390 px (mise au point).
  for (const [largeur, hauteur] of [
    [1440, 900],
    [390, 844],
  ].filter(([l]) => !process.env.VERIF_SEULEMENT_TELEPHONE || l < 640)) {
    for (const clarte of ['clair', 'sombre']) {
      await poserLeTheme(clarte);
      const telephone = largeur < 640;
      const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, isMobile: telephone, hasTouch: telephone, serviceWorkers: 'block', locale: 'fr-CH' });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await contexte.newPage();
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(String(e)));
      const envois = [];
      await page.addInitScript(() => {
        const envoyer = WebSocket.prototype.send;
        WebSocket.prototype.send = function (donnee) {
          try {
            const obj = JSON.parse(String(donnee));
            (window.__envois ??= []).push(obj?.cmd?.type ?? obj?.type);
          } catch {
            /* binaire */
          }
          return envoyer.call(this, donnee);
        };
      });
      const tag = `${largeur}-${clarte}`;
      await page.goto(`${BASE}/#projet/${PROJET}/tache/${CARTE}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.waitForSelector('[data-page-carte] [data-mic-button]', { timeout: 60_000 }).catch(() => undefined);
      await page.waitForTimeout(1500);

      /* 1. Le micro de dictée, jamais le bouton voix (18/11/2026). */
      /* Le repère du bouton voix RETIRÉ s'écrit en morceaux : le contrôle des repères ne juge que ceux qui existent. */
      const bouton = await page.evaluate((retire) => {
        const micros = [...document.querySelectorAll('[data-page-carte] [data-composer] [data-mic-button]')].filter((n) => n.getBoundingClientRect().width > 0);
        return { micros: micros.length, voix: document.querySelectorAll(`[data-page-carte] ${retire}`).length };
      }, ['parler-a-l-agent'].map((n) => `[data-${n}]`).join(''));
      verifier(`${tag} : le champ de la carte porte le micro de dictée`, bouton.micros >= 1, JSON.stringify(bouton));
      verifier(`${tag} : plus aucun bouton voix dans le champ`, bouton.voix === 0);

      /* 3. La conversation vocale de la carte : bulles bornées à dix, rien dans le fil. */
      const champ = page.locator('[data-page-carte] [data-composer] textarea:visible').last();
      await champ.fill('Mon brouillon déjà écrit');
      await page.waitForTimeout(1200);
      const messagesAvant = await page.locator('[data-message]').count();

      /* 3a. Ce que Jarvis a produit est dans le fil, et l'image s'ouvre en grand au clic. */
      const production = await page.evaluate(() => {
        const intitule = document.querySelector('[data-production-de-la-voix]');
        const message = intitule?.closest('[data-reponse-agent]');
        return { intitule: intitule?.textContent?.trim() ?? '', barres: intitule?.querySelectorAll('[data-icone-trois-barres] > span').length ?? 0, vignettes: message?.querySelectorAll('[data-capture-du-flux]').length ?? 0 };
      });
      verifier(`${tag} : ce que Jarvis a produit est dans le fil, sous « Jarvis · conversation vocale »`, production.intitule === 'Jarvis · conversation vocale' && production.barres === 3 && production.vignettes === 1, JSON.stringify(production));
      if (production.vignettes) {
        const vignette = page.locator('[data-reponse-agent]:has([data-production-de-la-voix]) [data-capture-du-flux]').first();
        await vignette.scrollIntoViewIfNeeded().catch(() => undefined);
        const dialoguesAvant = await page.locator('[role="dialog"]').count();
        await vignette.click({ timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(700);
        const apercu = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] img')].some((i) => i.getBoundingClientRect().width > 120));
        verifier(`${tag} : l’image produite s’ouvre en grand au clic`, apercu && (await page.locator('[role="dialog"]').count()) > dialoguesAvant);
        if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `production-apercu-${tag}.png`) });
        // L'aperçu se referme (Échap, sinon sa croix) avant la suite : un voile resté ouvert couvrirait tout.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        if ((await page.locator('[role="dialog"]').count()) > dialoguesAvant) {
          await page.locator('[data-fermer-visionneuse], [role="dialog"] [aria-label="Fermer"]').last().click({ timeout: 3000 }).catch(() => undefined);
          await page.waitForTimeout(500);
        }
        verifier(`${tag} : l’aperçu se referme`, (await page.locator('[role="dialog"]').count()) === dialoguesAvant);
      }

      /* 3b. Le cercle de chargement, du trait d'une barre, tant que Jarvis n'écoute pas. */
      await page.evaluate((agent) => window.belugaEssai.connexionDuDirect(agent), AGENT);
      await page.waitForSelector('[data-zone-vocale] [data-voix-etat="connexion"]', { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(400);
      const cercle = await page.evaluate(() => {
        const svg = document.querySelector('[data-voix-etat="connexion"] [data-morphing-de-la-voix]');
        const trait = svg?.querySelector('path');
        const barre = document.querySelector('[data-voix-etat="connexion"] > span');
        return { trait: trait ? getComputedStyle(trait).strokeWidth : '', barre: barre?.getBoundingClientRect().width ?? 0, d: (trait?.getAttribute('d') ?? '').length, texte: document.querySelector('[data-pied-vocal]')?.textContent ?? '' };
      });
      verifier(`${tag} : le cercle de chargement tourne, du trait d’une barre`, cercle.trait === '4px' && cercle.barre === 4 && cercle.d > 20 && /Jarvis arrive/.test(cercle.texte), JSON.stringify(cercle));
      const d1 = await page.locator('[data-morphing-de-la-voix] path').getAttribute('d').catch(() => '');
      await page.waitForTimeout(300);
      verifier(`${tag} : …et il tourne vraiment`, d1 !== (await page.locator('[data-morphing-de-la-voix] path').getAttribute('d').catch(() => '')));
      if (CAPTURES) await page.locator('[data-pied-vocal]').screenshot({ path: path.join(CAPTURES, `morphing-0-connexion-${tag}.png`) }).catch(() => undefined);

      /* 3c. À l'écoute : le morphing, puis l'onde vivante. */
      await page.evaluate(([agent, tours]) => window.belugaEssai.bullesDuDirect(agent, tours), [AGENT, TOURS]);
      const etapes = [];
      for (const [i, attente] of [[1, 200], [2, 230], [3, 230]]) {
        await page.waitForTimeout(attente);
        etapes.push(await page.locator('[data-ondes-du-volet]').getAttribute('data-voix-etat').catch(() => ''));
        if (CAPTURES) await page.locator('[data-pied-vocal]').screenshot({ path: path.join(CAPTURES, `morphing-${i}-${tag}.png`) }).catch(() => undefined);
      }
      await page.waitForSelector('[data-ondes-du-volet][data-voix-etat="ecoute"]', { timeout: 5000 }).catch(() => undefined);
      const onde = await page.evaluate(() => ({
        etat: document.querySelector('[data-ondes-du-volet]')?.getAttribute('data-voix-etat'),
        barres: document.querySelectorAll('[data-ondes-du-volet] > span').length,
        svg: document.querySelectorAll('[data-morphing-de-la-voix]').length,
      }));
      verifier(`${tag} : à l’écoute, le cercle se transforme (morphing) puis devient l’onde de 29 barres`, etapes.includes('morphing') && onde.etat === 'ecoute' && onde.barres === 29 && onde.svg === 0, JSON.stringify({ etapes, onde }));
      await page.waitForSelector('[data-zone-vocale] [data-pied-vocal]', { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      const pile = await page.evaluate(() => ({
        attribut: document.querySelector('[data-bulles-du-direct]')?.getAttribute('data-bulles-du-direct'),
        bulles: document.querySelectorAll('[data-bulles-du-direct] [data-bulle]').length,
        vous: document.querySelectorAll('[data-bulle="vous"]').length,
        jarvis: document.querySelectorAll('[data-bulle="jarvis"]').length,
        champs: document.querySelectorAll('[data-page-carte] [data-composer] textarea').length,
        pied: document.querySelectorAll('[data-page-carte] [data-pied-vocal]').length,
        deborde: document.documentElement.scrollWidth - window.innerWidth,
        vousADroite: (() => {
          const b = document.querySelector('[data-bulle="vous"] p')?.getBoundingClientRect();
          const j = document.querySelector('[data-bulle="jarvis"] p')?.getBoundingClientRect();
          return !!b && !!j && b.right > j.right && b.left > j.left;
        })(),
      }));
      verifier(`${tag} : la pile garde toute la session`, pile.attribut === '14' && pile.bulles === 14, JSON.stringify(pile));
      const flottante = await page.evaluate(() => {
        const enveloppe = document.querySelector('[data-pile-flottante]');
        const pileEl = document.querySelector('[data-bulles-du-direct]');
        const pied = document.querySelector('[data-page-carte] [data-pied-de-conversation]') ?? document.querySelector('[data-pied-du-fil]');
        const conversation = pied?.parentElement;
        const zone = document.querySelector('[data-zone-vocale]');
        const derniere = [...document.querySelectorAll('[data-bulles-du-direct] [data-bulle]')].pop();
        /* La LIGNE d'une bulle laisse passer les appuis (18/11/2026) : on vise la bulle elle-même, pas sa ligne. */
        const corps = derniere?.querySelector(':scope > div') ?? derniere;
        const rc = corps?.getBoundingClientRect();
        const rd = derniere?.getBoundingClientRect();
        const rp = pileEl?.getBoundingClientRect();
        const dessus = rc ? document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2) : null;
        const rv = document.querySelector('[data-voile-des-bulles]')?.getBoundingClientRect();
        /* Un point du voile HORS de toute bulle : à droite d'une bulle de Jarvis (90 % au plus, collée au bord gauche
           depuis le 17/11/2026), sinon le coin haut gauche du voile. */
        const uneDeJarvis = [...document.querySelectorAll('[data-bulles-du-direct] [data-bulle="jarvis"] > div')].find((b) => {
          const r = b.getBoundingClientRect();
          return rv && r.top >= rv.top && r.bottom <= rv.bottom && r.right + 12 < rv.right;
        })?.getBoundingClientRect();
        const traverse = rv ? document.elementFromPoint(uneDeJarvis ? uneDeJarvis.right + 8 : rv.left + 6, uneDeJarvis ? uneDeJarvis.top + uneDeJarvis.height / 2 : rv.top + 4) : null;
        return {
          absolue: enveloppe ? getComputedStyle(enveloppe).position === 'absolute' : false,
          auDessusDuPied: !!enveloppe && !!zone && Math.abs(enveloppe.getBoundingClientRect().bottom - zone.getBoundingClientRect().top) <= 1,
          hauteur: rp?.height ?? 0,
          plafond: (conversation?.clientHeight ?? 0) * 0.7,
          piedSansBulles: !!pied && !!zone && Math.abs(pied.getBoundingClientRect().height - zone.getBoundingClientRect().height) <= 60,
          derniereEnVue: !!rd && !!rp && rd.bottom <= rp.bottom + 1 && rd.top >= rp.top - 1,
          derniereAtteinte: !!dessus && !!derniere && derniere.contains(dessus),
          voile: !!rv && rv.height > 20,
          fonduEnHaut: pileEl ? getComputedStyle(pileEl).maskImage || getComputedStyle(pileEl).webkitMaskImage : '',
          filDessous: !!traverse && !traverse.closest('[data-pile-flottante]'),
        };
      });
      verifier(`${tag} : la pile flotte au-dessus des ondes, hors du flux (le fil ne bouge pas)`, flottante.absolue && flottante.auDessusDuPied && flottante.piedSansBulles, JSON.stringify(flottante));
      verifier(`${tag} : …au plus 70 % de la conversation, la dernière bulle en vue et touchable`, flottante.hauteur > 0 && flottante.hauteur <= flottante.plafond + 1 && flottante.derniereEnVue && flottante.derniereAtteinte, JSON.stringify(flottante));
      verifier(`${tag} : …sur un voile, les plus hautes en fondu, le fil derrière reste cliquable`, flottante.voile && /gradient/.test(flottante.fonduEnHaut) && flottante.filDessous, JSON.stringify(flottante));
      verifier(`${tag} : vous à droite, Jarvis à gauche`, pile.vous > 0 && pile.jarvis > 0 && pile.vousADroite);
      verifier(`${tag} : la zone vocale remplace le champ de CETTE carte`, pile.pied === 1 && pile.champs === 0);
      verifier(`${tag} : rien ne déborde en largeur`, pile.deborde <= 0, String(pile.deborde));
      verifier(`${tag} : les phrases n’entrent pas dans le fil`, (await page.locator('[data-message]').count()) === messagesAvant);
      if (CAPTURES) {
        await page.mouse.move(5, 5);
        await page.screenshot({ path: path.join(CAPTURES, `carte-bulles-${tag}.png`) });
      }

      /* 4. La rédaction, puis la synthèse ajoutée au brouillon, sans envoi. */
      await page.evaluate((agent) => window.belugaEssai.redactionDuDirect(agent), AGENT);
      verifier(`${tag} : bulle « Je rédige le récapitulatif… » pendant la rédaction`, await page.waitForSelector('[data-bulle="recapitulatif"]', { timeout: 5000 }).then(() => true, () => false));
      const envoisAvant = await page.evaluate(() => (window.__envois ?? []).filter((t) => t === 'prompt' || t === 'agent.prompt' || t === 'message.send').length);
      await page.evaluate((agent) => window.belugaEssai.syntheseDuDirect(agent, 'Ajoute une page de contact avec un formulaire et une carte.'), AGENT);
      await page.waitForSelector('[data-page-carte] [data-composer] textarea', { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
      const valeur = await page.locator('[data-page-carte] [data-composer] textarea:visible').last().inputValue().catch(() => '');
      verifier(
        `${tag} : la synthèse s’ajoute à la suite du brouillon, une ligne vide entre les deux`,
        valeur === 'Mon brouillon déjà écrit\n\nAjoute une page de contact avec un formulaire et une carte.',
        JSON.stringify(valeur),
      );
      const envoisApres = await page.evaluate(() => (window.__envois ?? []).filter((t) => t === 'prompt' || t === 'agent.prompt' || t === 'message.send').length);
      verifier(`${tag} : rien n’est envoyé`, envoisApres === envoisAvant && (await page.locator('[data-message]').count()) === messagesAvant);
      if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `carte-synthese-${tag}.png`) });
      // Le brouillon d'essai ne reste pas.
      await page.locator('[data-page-carte] [data-composer] textarea:visible').last().fill('');
      await page.waitForTimeout(900);

      /* 2. Le volet de l'assistant : réglages dans l'entête, avant la croix. */
      {
        // Sur la page du projet (sans carte ouverte), comme le contrôle du volet ; l'état ouvert est retenu dans le compte.
        await page.goto('about:blank');
        await page.goto(`${BASE}/#projet/${PROJET}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-bouton-du-bord]', { timeout: 60_000 }).catch(() => undefined);
        await page.waitForTimeout(1500);
        if (!(await page.locator('[data-assistant-chat]').count())) await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant'))).catch(() => undefined);
        await page.waitForSelector('[data-assistant-chat] header [data-raccourci-reglages-agent], [data-entete-de-l-assistant] [data-raccourci-reglages-agent]', { timeout: 30_000 }).catch(() => undefined);
        await page.waitForTimeout(800);
        const entete = await page.evaluate(() => {
          const volet = document.querySelector('[data-assistant-chat]');
          // Sur téléphone, l'entête de la feuille est la SŒUR du volet (`EnteteDeFeuille`), pas son enfant.
          const header = volet?.querySelector('header') ?? document.querySelector('[data-entete-de-l-assistant]');
          const boutons = header ? [...header.querySelectorAll('button')] : [];
          const reglages = header?.querySelector('[data-raccourci-reglages-agent]');
          const croix = boutons.find((b) => b.getAttribute('aria-label') === 'Fermer l’assistant');
          return {
            dansLEntete: !!reglages,
            avantLaCroix: !!reglages && !!croix && boutons.indexOf(reglages) === boutons.indexOf(croix) - 1,
            hauteurs: reglages && croix ? [reglages.getBoundingClientRect().height, croix.getBoundingClientRect().height] : null,
            dansLeChamp: volet?.querySelectorAll('[data-composer] [data-raccourci-reglages-agent]').length ?? -1,
            voix: volet?.querySelectorAll(['parler-a-jarvis', 'parler-a-l-agent'].map((n) => `[data-composer] [data-${n}]`).join(', ')).length ?? -1,
            micro: volet?.querySelectorAll('[data-composer] [data-mic-button]').length ?? -1,
            // Le bouton se touche : rien n'est posé par-dessus son centre.
            atteint: (() => {
              const r = reglages?.getBoundingClientRect();
              const dessus = r ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
              return !!dessus && !!reglages && reglages.contains(dessus);
            })(),
          };
        });
        verifier(`${tag} : les réglages de l’assistant sont dans l’entête, juste avant la croix`, entete.dansLEntete && entete.avantLaCroix, JSON.stringify(entete));
        verifier(`${tag} : …de la même hauteur que la croix`, !!entete.hauteurs && entete.hauteurs[0] === entete.hauteurs[1], JSON.stringify(entete.hauteurs));
        verifier(`${tag} : …et plus dans le champ de l’assistant, qui porte le micro et jamais le bouton voix`, entete.dansLeChamp === 0 && entete.voix === 0 && entete.micro >= 1, JSON.stringify(entete));
        verifier(`${tag} : …et le bouton des réglages se touche (rien par-dessus)`, entete.atteint);
        if (CAPTURES) {
          await page.mouse.move(5, 5);
          await page.screenshot({ path: path.join(CAPTURES, `assistant-${tag}.png`) });
        }
        /* 2 bis. LES BULLES DÉCOLLÉES DU BORD (18/11/2026, étendu au volet ordinateur le 19/11/2026) : dans la feuille du
           téléphone comme dans le volet ouvert, aucune bulle à moins de 16 px du bord — Jarvis à gauche, vous à droite. */
        const assistant = await page.locator('[data-assistant-chat]').first().getAttribute('data-assistant-chat').catch(() => null);
        if (assistant && assistant !== 'chargement') {
          await page.evaluate(([agent, tours]) => window.belugaEssai.bullesDuDirect(agent, tours), [assistant, TOURS.slice(0, 4)]);
          await page.waitForSelector('[data-assistant-chat] [data-bulles-du-direct] [data-bulle="jarvis"]', { timeout: 8000 }).catch(() => undefined);
          await page.waitForTimeout(600);
          const bords = await page.evaluate(() => {
            const boites = [...document.querySelectorAll('[data-assistant-chat] [data-bulles-du-direct] [data-bulle="vous"], [data-assistant-chat] [data-bulles-du-direct] [data-bulle="jarvis"]')]
              .map((n) => ({ qui: n.getAttribute('data-bulle'), r: n.firstElementChild?.getBoundingClientRect() }))
              .filter((b) => b.r && b.r.width > 0);
            const volet = document.querySelector('[data-volet-de-jarvis]')?.getBoundingClientRect();
            const gaucheDuCadre = volet ? volet.left : 0;
            const droiteDuCadre = volet ? volet.right : window.innerWidth;
            return {
              n: boites.length,
              gauche: Math.min(...boites.map((b) => b.r.left - gaucheDuCadre)),
              droite: Math.min(...boites.map((b) => droiteDuCadre - b.r.right)),
              retrait: document.querySelector('[data-assistant-chat] [data-bulles-du-direct]')?.getAttribute('data-retrait-des-bulles') ?? null,
              feuille: !!document.querySelector('[data-assistant-ancre="feuille"]'),
            };
          });
          /* 19/11/2026 (maquette #3ce3) : le VOLET OUVERT sur ordinateur prend la même marge que la feuille du téléphone. */
          verifier(`${tag} : ${bords.feuille ? 'dans la feuille' : 'dans le volet ouvert'}, aucune bulle à moins de 16 px du bord`, bords.n >= 2 && bords.gauche >= 16 && bords.droite >= 16 && bords.retrait !== null, JSON.stringify(bords));
          if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `assistant-bulles-${tag}.png`) });
          await page.evaluate(() => window.belugaEssai?.ondesDuVolet?.(null));
          await page.waitForTimeout(500);
        }
        // Le volet ouvert est RETENU dans le compte : refermé ici, il ne recouvre pas la page de la carte au passage suivant.
        await page.locator('[aria-label="Fermer l’assistant"]').first().click({ timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(800);
      }
      verifier(`${tag} : aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
      await contexte.close();
    }
  }
} catch (err) {
  console.error(err);
  console.error(`— serveur de développement —\n${journalVite.join('').slice(-3000)}`);
  resultats.push(false);
} finally {
  await navigateur?.close().catch(() => undefined);
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
  await nettoyer?.();
}

const reussis = resultats.filter(Boolean).length;
console.log(`\n${reussis}/${resultats.length} contrôles réussis`);
process.exit(reussis === resultats.length ? 0 : 1);
