#!/usr/bin/env node
/**
 * LA CHARTE AVEC SON AGENT, DANS UN VRAI NAVIGATEUR (refonte du service Charte graphique, 17/11/2026). Il juge :
 *
 *   1. une charte ouverte montre la CONVERSATION avec son agent à gauche (`[data-charte-conversation]`, l'agent créé à
 *      la première ouverture) et le DOCUMENT dans le volet à droite (`[data-charte-volet="volet"]`), en aperçu compact ;
 *      la ligne d'étapes de la charte est collée au champ, et le champ porte le bouton voix ;
 *   2. AUCUN premier message ne part d'un essai (garde `BELUGA_CHARTE_SANS_PREMIER_MESSAGE`) ;
 *   3. une écriture du document COMME L'AGENT (« plaquettes.modifier ») se voit dans le volet sans recharger ;
 *   4. « Agrandir » pose le document entier — ses gestes compris — par-dessus la conversation (gardée montée), et le
 *      même bouton puis Échap le remettent dans le volet ; la croix replie le volet, « Afficher la charte » le rouvre ;
 *   5. sur téléphone, la conversation occupe l'écran et « Voir la charte » ouvre le document dans la feuille du bas ;
 *   6. « Créer la charte graphique » d'un projet sans charte ouvre un document neuf avec son agent, SANS carte ;
 *   7. rien ne déborde, à 1440 et 390 px, en clair et en sombre (captures avec VERIF_CAPTURES) ;
 *   8. LES OPTIONS D'AFFICHAGE EN UN MENU (18/11/2026) : dans l'entête du volet, avant « Agrandir », un menu qui montre
 *      le format en cours et propose les trois formats, « Télécharger le PDF » et « Copier le lien du client » ; le
 *      même dans le document agrandi et dans la feuille du téléphone ;
 *   9. LE FORMAT SUIT, EN VOLET COMME EN GRAND : A4 → Diapositives (et retour), volet ↔ agrandi, la feuille prend la
 *      forme du format et tient dans la largeur de la zone, sans rester mesurée comme l'ancien format.
 *
 * Un DÉMON D'ESSAI (base neuve, aucun compte moteur) et le serveur de développement de la copie, branché sur lui —
 * le point d'essai `belugaEssai` n'existe qu'hors production. Jamais BELUGA_URL, jamais BELUGA_TOKEN.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-charte-avec-agent.mjs
 *   VERIF_CAPTURES=/chemin node scripts/verif-charte-avec-agent.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7238);
const PORT_WEB = Number(process.env.BELUGA_VERIF_PORT_WEB || 7138);
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* LA PREMIÈRE FEUILLE DU DOCUMENT (dans l'ombre de l'éditeur) et la zone d'aperçu qui la porte. */
async function mesurerLaFeuille(page) {
  return page.evaluate(() => {
    const zone = document.querySelector('[data-charte-volet] [data-plaquette-apercu-zone]');
    /* L'ombre du DOCUMENT porte `.pages` à sa racine ; celle des miniatures, non. */
    const pagesDe = (n) => [...(n.shadowRoot?.children ?? [])].find((c) => c.classList.contains('pages'));
    const hote = [...(zone?.querySelectorAll('*') ?? [])].find((n) => pagesDe(n)?.querySelector(':scope > .feuille'));
    const f = hote ? pagesDe(hote).querySelector(':scope > .feuille')?.getBoundingClientRect() : null;
    const z = zone?.getBoundingClientRect();
    if (!f || !z) return null;
    return { ratio: Math.round((f.width / f.height) * 100) / 100, largeur: Math.round(f.width), zone: Math.round(z.width), tient: f.width <= z.width + 1 && f.width >= z.width * 0.45 };
  });
}
/* Ouvre le menu des options d'affichage (menu Radix : focus puis Entrée) et choisit un format. */
async function choisirLeFormat(page, ou, format) {
  await page.locator(`[data-plaquette-options-affichage="${ou}"]`).first().focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-plaquette-menu-affichage]', { timeout: 5000 });
  await page.click(`[data-plaquette-menu-affichage] [data-plaquette-choix-format="${format}"]`);
  await page.waitForFunction(
    ([o, f]) => document.querySelector(`[data-plaquette-options-affichage="${o}"]`)?.getAttribute('data-plaquette-format') === f,
    [ou, format],
    { timeout: 5000 },
  ).catch(() => undefined);
  await page.waitForTimeout(1800);
  /* Le menu rend le focus à son bouton : son anneau de clavier n'a rien à faire sur une capture. */
  await page.evaluate(() => document.activeElement?.blur?.());
}

/* ---------------- Le décor, écrit par le magasin du démon, AVANT son lancement ---------------- */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-charte-agent-'));
const DATA = path.join(TMP, 'data');
const DEPOT = path.join(TMP, 'depot');
const DEPOT_VIDE = path.join(TMP, 'depot-vide');
for (const d of [DATA, DEPOT, DEPOT_VIDE]) fs.mkdirSync(d, { recursive: true });
process.env.BELUGA_DATA = DATA;
process.env.BELUGA_PROJECTS_ROOT = path.join(TMP, 'projets');

const shared = await import(path.join(RACINE, 'shared/dist/index.js'));
const store = await import(path.join(RACINE, 'server/dist/store.js'));
const { getDb } = await import(path.join(RACINE, 'server/dist/db.js'));
const plaquettes = await import(path.join(RACINE, 'server/dist/plaquettes.js'));

const T = Date.now();
const PROJET = 'p-charte-agent';
const PROJET_VIDE = 'p-charte-vide';
const jeton = crypto.randomBytes(32).toString('hex');
store.saveProject(shared.Project.parse({ id: PROJET, name: 'Facturo', path: DEPOT, createdAt: T, updatedAt: T }));
store.saveProject(shared.Project.parse({ id: PROJET_VIDE, name: 'Toogo', path: DEPOT_VIDE, createdAt: T, updatedAt: T }));
const BLOCS = [
  { genre: 'couverture', titre: 'Facturo', texte: 'La facturation simple des indépendants.' },
  { genre: 'sommaire', titre: 'Sommaire' },
  { genre: 'partie', titre: 'Charte graphique' },
  { genre: 'couleurs', titre: 'Couleurs', elements: [{ valeur: '#1d4ed8', libelle: 'Bleu Facturo — principal' }] },
  { genre: 'typographies', titre: 'Typographies', elements: [{ valeur: 'Inter', libelle: 'Titres et texte — 400 à 700' }] },
];
const cree = plaquettes.creerPlaquette({
  projectId: PROJET,
  projetMarqueId: PROJET,
  titre: 'Charte graphique — Facturo',
  blocs: BLOCS,
  marque: { nom: 'Facturo', couleur: '#1d4ed8', texte: '#1f2328', fond: '#ffffff' },
  format: 'a4-portrait',
  adresse: 'vous',
});
if (!cree.ok) throw new Error(cree.raison);
const DOC = cree.plaquette.id;
const db = getDb();
db.prepare('INSERT OR REPLACE INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
  crypto.createHash('sha256').update(jeton).digest('hex'),
  T,
  T + 3_600_000,
  'essai charte avec agent',
);
db.close();

/* ---------------- Le démon d'essai et le serveur de développement branché sur lui ---------------- */

const { journal, attendrePort, nettoyer } = demarrerDemonDEssai({
  tmp: TMP,
  prefixe: 'verif-charte-agent-',
  port: PORT,
  signaux: true,
  depot: false,
  env: { BELUGA_CHARTE_SANS_PREMIER_MESSAGE: '1' },
});
const vite = spawn('npm', ['run', 'dev', '--workspace', 'web', '--', '--port', String(PORT_WEB), '--strictPort'], {
  cwd: RACINE,
  env: { ...process.env, BELUGA_DEMON_PORT: String(PORT), NODE_ENV: 'development', BELUGA_URL: '', BELUGA_TOKEN: '' },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
process.on('exit', () => {
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
});

const Database = createRequire(import.meta.url)('better-sqlite3');
function lireLaBase(lire) {
  const base = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  try {
    return lire(base);
  } finally {
    base.close();
  }
}
function poserLeTheme(clarte) {
  const base = new Database(path.join(DATA, 'beluga.db'));
  base.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('theme', JSON.stringify(clarte), Date.now());
  base.close();
}

/** Le texte du document dans une zone (il vit dans une ombre ouverte). */
const texteDuDocument = (page, zone) =>
  page.evaluate((sel) => {
    const racine = document.querySelector(sel);
    if (!racine) return '';
    return [...racine.querySelectorAll('*')]
      .filter((n) => n.shadowRoot)
      .map((n) => n.shadowRoot.textContent ?? '')
      .join(' ');
  }, zone);

let navigateur;
let creationFaite = false;
try {
  if (!(await attendrePort())) throw new Error(`le démon d’essai n’a pas ouvert son port\n${journal.join('').slice(-2000)}`);
  for (let i = 0; i < 90 && !(await fetch(BASE).then(() => true).catch(() => false)); i += 1) await new Promise((r) => setTimeout(r, 1000));
  navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  let tour = 0;
  for (const [largeur, hauteur] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const clarte of ['clair', 'sombre']) {
      tour += 1;
      poserLeTheme(clarte);
      const telephone = largeur < 640;
      const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, isMobile: telephone, hasTouch: telephone, serviceWorkers: 'block', locale: 'fr-CH' });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await contexte.newPage();
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(String(e)));
      const tag = `${largeur}-${clarte}`;
      await page.goto(`${BASE}/#charte/${PROJET}/${DOC}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-charte-rangee]', { timeout: 60_000 }).catch(() => undefined);
      await page.waitForSelector('[data-charte-conversation]:not([data-charte-conversation="chargement"]) [data-composer]', { timeout: 30_000 }).catch(() => undefined);
      await page.waitForTimeout(1500);

      /* 1. La conversation à gauche, avec son agent ; le document à droite (ordinateur). */
      const vue = await page.evaluate(() => {
        const conv = document.querySelector('[data-charte-conversation]');
        const volet = document.querySelector('[data-charte-volet]');
        const rc = conv?.getBoundingClientRect();
        const rv = volet?.getBoundingClientRect();
        return {
          etat: document.querySelector('[data-charte-rangee]')?.getAttribute('data-charte-etat'),
          agent: conv?.getAttribute('data-charte-conversation'),
          volet: volet?.getAttribute('data-charte-volet') ?? null,
          aGauche: !!rc && !!rv && rc.right <= rv.left + 1,
          compact: !!volet?.querySelector('[data-plaquette-editeur][data-plaquette-compact]'),
          voix: conv?.querySelectorAll('[data-composer] [data-mic-button]').length ?? 0,
          etapes: document.querySelector('[data-charte-conversation] [data-ligne-de-parcours="charte"]')?.getAttribute('data-etape-ici') ?? null,
          messages: conv?.querySelectorAll('[data-message]').length ?? -1,
          deborde: document.documentElement.scrollWidth - window.innerWidth,
          titre: document.querySelector('[data-plaquette-titre-cran]')?.textContent?.trim() ?? null,
        };
      });
      verifier(`${tag} : l’agent de la charte est créé et sa conversation s’affiche`, !!vue.agent && vue.agent !== 'chargement', JSON.stringify(vue));
      verifier(`${tag} : le champ de la charte porte le micro de dictée (18/11/2026)`, vue.voix >= 1);
      verifier(`${tag} : la ligne d’étapes est collée au champ, à l’étape Logo`, vue.etapes === 'logo');
      verifier(`${tag} : aucun premier message ne part d’un essai`, vue.messages === 0);
      verifier(`${tag} : le fil d’Ariane porte le titre du document`, vue.titre === 'Charte graphique — Facturo', String(vue.titre));
      verifier(`${tag} : rien ne déborde en largeur`, vue.deborde <= 0, String(vue.deborde));
      const agentEnBase = lireLaBase((b) => b.prepare('SELECT agent_id FROM plaquettes WHERE id = ?').get(DOC)?.agent_id);
      verifier(`${tag} : le document garde son agent (un seul, retrouvé à chaque ouverture)`, agentEnBase === vue.agent, `${agentEnBase} / ${vue.agent}`);

      if (!telephone) {
        verifier(`${tag} : la conversation à gauche, la charte à droite dans le volet`, vue.etat === 'volet' && vue.volet === 'volet' && vue.aGauche && vue.compact);
        await page.waitForSelector('[data-charte-volet] [data-plaquette-document-zone][data-plaquette-pret="1"]', { timeout: 20_000 }).catch(() => undefined);
        await page.waitForTimeout(800);
        if (CAPTURES) {
          await page.mouse.move(5, 5);
          await page.screenshot({ path: path.join(CAPTURES, `charte-volet-${tag}.png`) });
        }

        /* 3. Une écriture comme l'agent : le volet suit, sans recharger. */
        const marqueur = `Un ton direct et chaleureux ${tour}`;
        await page.evaluate(
          ([id, blocs, texte]) =>
            window.belugaEssai.commande({ type: 'plaquettes.modifier', id, blocs: [...blocs, { genre: 'texte', titre: 'Ton et voix', texte }] }),
          [DOC, BLOCS, marqueur],
        );
        const suivi = await page
          .waitForFunction(
            (t) =>
              [...(document.querySelector('[data-charte-volet]')?.querySelectorAll('*') ?? [])].some((n) => n.shadowRoot && (n.shadowRoot.textContent ?? '').includes(t)),
            marqueur,
            { timeout: 15_000 },
          )
          .then(() => true, () => false);
        verifier(`${tag} : une écriture de l’agent se voit dans le volet, sans recharger`, suivi);

        /* 8. Le menu des options d'affichage, dans l'entête du volet, avant « Agrandir ». */
        const entete = await page.evaluate(() => {
          const m = document.querySelector('[data-charte-entete-du-volet] [data-plaquette-options-affichage="volet"]')?.getBoundingClientRect();
          const a = document.querySelector('[data-charte-agrandir="volet"]')?.getBoundingClientRect();
          return { menu: !!m, avant: !!m && !!a && m.right <= a.left + 1, memeLigne: !!m && !!a && Math.abs(m.top + m.height / 2 - (a.top + a.height / 2)) <= 2, format: document.querySelector('[data-plaquette-options-affichage="volet"]')?.getAttribute('data-plaquette-format') };
        });
        verifier(`${tag} : le menu des options d’affichage est dans l’entête du volet, avant « Agrandir »`, entete.menu && entete.avant && entete.memeLigne, JSON.stringify(entete));
        await page.locator('[data-plaquette-options-affichage="volet"]').focus();
        await page.keyboard.press('Enter');
        await page.waitForSelector('[data-plaquette-menu-affichage]', { timeout: 5000 }).catch(() => undefined);
        const lignes = await page.evaluate(() => {
          const m = document.querySelector('[data-plaquette-menu-affichage]');
          return {
            formats: [...(m?.querySelectorAll('[data-plaquette-choix-format]') ?? [])].map((n) => n.getAttribute('data-plaquette-choix-format')),
            telecharger: m?.querySelectorAll('[data-plaquette-telecharger]').length ?? 0,
            copier: m?.querySelectorAll('[data-plaquette-copier]').length ?? 0,
          };
        });
        verifier(`${tag} : …il propose les trois formats, « Télécharger le PDF » et « Copier le lien du client »`, lignes.formats.length === 3 && lignes.telecharger === 1 && lignes.copier === 1, JSON.stringify(lignes));
        if (CAPTURES) {
          await page.waitForTimeout(500); // le menu arrive en fondu
          await page.screenshot({ path: path.join(CAPTURES, `charte-menu-affichage-${tag}.png`) });
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);

        /* 9. Le format suit, dans le volet. */
        const a4Volet = await mesurerLaFeuille(page);
        await choisirLeFormat(page, 'volet', 'diapositives');
        const diapoVolet = await mesurerLaFeuille(page);
        verifier(`${tag} : en volet, Diapositives donne des feuilles larges qui tiennent dans le volet`, !!diapoVolet && diapoVolet.ratio > 1.5 && diapoVolet.tient, JSON.stringify({ a4Volet, diapoVolet }));
        if (CAPTURES) {
          await page.mouse.move(5, 5);
          await page.screenshot({ path: path.join(CAPTURES, `charte-volet-diapo-${tag}.png`) });
        }
        await choisirLeFormat(page, 'volet', 'a4-portrait');

        /* 4. Agrandir : le document entier par-dessus la conversation, gardée montée. */
        await page.click('[data-charte-agrandir="volet"]');
        await page.waitForSelector('[data-charte-volet="agrandi"]', { timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(800);
        const grand = await page.evaluate(() => {
          const volet = document.querySelector('[data-charte-volet]')?.getBoundingClientRect();
          const rangee = document.querySelector('[data-charte-rangee]')?.getBoundingClientRect();
          const conv = document.querySelector('[data-charte-conversation]');
          return {
            volet: document.querySelector('[data-charte-volet]')?.getAttribute('data-charte-volet'),
            couvre: !!volet && !!rangee && Math.abs(volet.width - rangee.width) <= 1 && Math.abs(volet.left - rangee.left) <= 1,
            conversationMontee: !!conv?.querySelector('[data-composer]'),
            conversationCachee: !!conv && getComputedStyle(conv).visibility === 'hidden',
            pleineSurface: !!document.querySelector('[data-plaquette-editeur][data-pleine-surface]'),
            gestes: document.querySelectorAll('[data-plaquette-options-affichage="agrandi"]').length,
            remettre: document.querySelectorAll('[data-charte-agrandir="agrandie"]').length,
            miniatures: (() => {
              const m = document.querySelector('[data-plaquette-miniatures]');
              return !!m && m.getBoundingClientRect().width > 0;
            })(),
            editeurs: document.querySelectorAll('[data-plaquette-editeur]').length,
          };
        });
        verifier(`${tag} : « Agrandir » pose le document en grand par-dessus la conversation`, grand.volet === 'agrandi' && grand.couvre && grand.pleineSurface, JSON.stringify(grand));
        verifier(`${tag} : …avec tous ses gestes (le menu des options d’affichage) et ses miniatures`, grand.gestes === 1 && grand.miniatures);
        verifier(`${tag} : …la conversation reste montée, cachée dessous`, grand.conversationMontee && grand.conversationCachee);
        verifier(`${tag} : …un seul éditeur monté`, grand.editeurs === 1);
        if (CAPTURES) {
          await page.mouse.move(5, 5);
          await page.screenshot({ path: path.join(CAPTURES, `charte-agrandie-${tag}.png`) });
        }
        /* 9. Le format suit en grand : A4 → Diapositives (la capture #6c39), puis retour au volet. */
        const a4Grand = await mesurerLaFeuille(page);
        await choisirLeFormat(page, 'agrandi', 'diapositives');
        const diapoGrand = await mesurerLaFeuille(page);
        verifier(`${tag} : en grand, A4 → Diapositives remet les feuilles à la forme et à la largeur de la zone`, !!a4Grand && a4Grand.ratio < 0.8 && !!diapoGrand && diapoGrand.ratio > 1.5 && diapoGrand.tient, JSON.stringify({ a4Grand, diapoGrand }));
        if (CAPTURES) {
          await page.mouse.move(5, 5);
          await page.screenshot({ path: path.join(CAPTURES, `charte-agrandie-diapo-${tag}.png`) });
        }
        await page.click('[data-charte-agrandir="agrandie"]');
        await page.waitForSelector('[data-charte-volet="volet"]', { timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(1800);
        const diapoRetour = await mesurerLaFeuille(page);
        verifier(`${tag} : …et de retour dans le volet, les diapositives tiennent dans sa largeur`, !!diapoRetour && diapoRetour.ratio > 1.5 && diapoRetour.tient, JSON.stringify(diapoRetour));
        await choisirLeFormat(page, 'volet', 'a4-paysage');
        const paysage = await mesurerLaFeuille(page);
        verifier(`${tag} : …A4 paysage aussi`, !!paysage && paysage.ratio > 1.3 && paysage.ratio < 1.5 && paysage.tient, JSON.stringify(paysage));
        await choisirLeFormat(page, 'volet', 'a4-portrait');
        /* Changer de format pose un BROUILLON : l'abandonner, sinon le tour suivant ne verrait pas l'écriture de l'agent. */
        await page.waitForTimeout(1200);
        await page.evaluate((id) => window.belugaEssai.commande({ type: 'plaquettes.abandonner', id }), DOC).catch(() => undefined);
        await page.click('[data-charte-agrandir="volet"]');
        await page.waitForSelector('[data-charte-volet="agrandi"]', { timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(600);
        await page.click('[data-charte-agrandir="agrandie"]');
        verifier(`${tag} : le même bouton remet le document dans son volet`, await page.waitForSelector('[data-charte-volet="volet"]', { timeout: 5000 }).then(() => true, () => false));
        await page.click('[data-charte-agrandir="volet"]');
        await page.waitForSelector('[data-charte-volet="agrandi"]', { timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(400);
        await page.keyboard.press('Escape');
        const parEchap = await page.waitForSelector('[data-charte-volet="volet"]', { timeout: 5000 }).then(() => true, () => false);
        verifier(`${tag} : Échap le remet aussi, la page reste ouverte`, parEchap, parEchap ? '' : JSON.stringify(await page.evaluate(() => ({ hash: location.hash, etat: document.querySelector('[data-charte-rangee]')?.getAttribute('data-charte-etat'), actif: document.activeElement?.outerHTML?.slice(0, 120) }))));
        verifier(`${tag} : …la conversation est de nouveau visible`, await page.evaluate(() => getComputedStyle(document.querySelector('[data-charte-conversation]')).visibility === 'visible'));

        /* La croix replie le volet ; « Afficher la charte » le rouvre. */
        await page.click('[data-croix-du-volet="charte"]');
        const replie = await page.waitForSelector('[data-charte-afficher]', { timeout: 5000 }).then(() => true, () => false);
        verifier(`${tag} : la croix replie le volet`, replie && (await page.locator('[data-charte-volet]').count()) === 0);
        await page.click('[data-charte-afficher]');
        verifier(`${tag} : « Afficher la charte » le rouvre`, await page.waitForSelector('[data-charte-volet="volet"]', { timeout: 5000 }).then(() => true, () => false));
      } else {
        /* 5. Téléphone : la conversation plein écran, la charte dans la feuille du bas. */
        verifier(`${tag} : sur téléphone, la conversation occupe l’écran, sans volet`, vue.etat === 'feuille' && vue.volet === null);
        if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `charte-conversation-${tag}.png`) });
        await page.click('[data-options-de-page="menu"], [aria-label="Plus d’options"]');
        await page.locator('[data-charte-voir]').first().click({ timeout: 5000 }).catch(() => undefined);
        const feuille = await page.waitForSelector('[data-charte-feuille]', { timeout: 5000 }).then(() => true, () => false);
        await page.waitForTimeout(1500);
        const dansLaFeuille = await page.evaluate(() => {
          const f = document.querySelector('[data-charte-feuille]')?.closest('[role="dialog"]');
          return { editeur: !!f?.querySelector('[data-plaquette-editeur][data-plaquette-compact]'), deborde: document.documentElement.scrollWidth - window.innerWidth };
        });
        verifier(`${tag} : « Voir la charte » ouvre le document dans la feuille du bas`, feuille && dansLaFeuille.editeur, JSON.stringify(dansLaFeuille));
        verifier(`${tag} : la feuille porte le menu des options d’affichage dans son entête`, (await page.locator('[data-charte-feuille] [data-plaquette-options-affichage="feuille"]').count()) === 1);
        if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `charte-feuille-${tag}.png`) });
        await page.click('[data-charte-agrandir="feuille"]');
        const agrandi = await page.waitForSelector('[data-charte-volet="agrandi"] [data-plaquette-editeur]:not([data-plaquette-compact])', { timeout: 5000 }).then(() => true, () => false);
        const feuilleFermee = await page.waitForSelector('[data-charte-feuille]', { state: 'detached', timeout: 5000 }).then(() => true, () => false);
        await page.waitForTimeout(800);
        verifier(`${tag} : « Agrandir » mène au document entier, la feuille refermée`, agrandi && feuilleFermee);
        if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `charte-agrandie-${tag}.png`) });
        await page.click('[data-options-de-page="menu"], [aria-label="Plus d’options"]');
        await page.locator('[data-charte-agrandir="agrandie-ligne"]').first().click({ timeout: 5000 }).catch(() => undefined);
        verifier(`${tag} : « Revenir à la conversation », dans les trois points, remet la conversation`, await page.waitForSelector('[data-charte-etat="feuille"]', { timeout: 5000 }).then(() => true, () => false));
      }

      /* 6. « Créer la charte graphique » : un document neuf et son agent, sans carte (une seule fois). */
      if (!creationFaite && !telephone) {
        creationFaite = true;
        const cartesAvant = lireLaBase((b) => b.prepare('SELECT COUNT(*) AS n FROM cards').get().n);
        await page.goto('about:blank');
        await page.goto(`${BASE}/#projet/${PROJET_VIDE}/plaquettes`, { waitUntil: 'domcontentloaded' });
        let bouton = await page.waitForSelector('[data-plaquettes-vide-projet] button', { timeout: 20_000 }).then(() => true, () => false);
        if (!bouton) {
          await page.evaluate((p) => (window.location.hash = `#charte/${p}`), PROJET_VIDE);
          bouton = await page.waitForSelector('[data-plaquettes-vide-projet] button', { timeout: 10_000 }).then(() => true, () => false);
        }
        verifier(`${tag} : un projet sans charte propose « Créer la charte graphique »`, bouton);
        if (bouton) {
          await page.locator('[data-plaquettes-vide-projet] button').last().click();
          const ouverte = await page.waitForSelector('[data-charte-rangee]', { timeout: 20_000 }).then(() => true, () => false);
          await page.waitForSelector('[data-charte-conversation]:not([data-charte-conversation="chargement"])', { timeout: 20_000 }).catch(() => undefined);
          await page.waitForTimeout(1500);
          const neuve = lireLaBase((b) => b.prepare('SELECT id, agent_id, titre FROM plaquettes WHERE project_id = ?').all(PROJET_VIDE));
          const cartesApres = lireLaBase((b) => b.prepare('SELECT COUNT(*) AS n FROM cards').get().n);
          const hash = await page.evaluate(() => window.location.hash);
          verifier(
            `${tag} : « Créer la charte graphique » ouvre un document neuf avec son agent`,
            ouverte && neuve.length === 1 && !!neuve[0].agent_id && hash.includes(neuve[0].id),
            JSON.stringify({ neuve, hash }),
          );
          verifier(`${tag} : …et aucune carte n’est posée sur le tableau`, cartesApres === cartesAvant, `${cartesAvant} → ${cartesApres}`);
          verifier(`${tag} : …la charte neuve commence à l’étape Marque`, (await page.getAttribute('[data-ligne-de-parcours="charte"]', 'data-etape-ici').catch(() => null)) === 'marque');
          if (CAPTURES) {
            await page.waitForTimeout(800);
            await page.mouse.move(5, 5);
            await page.screenshot({ path: path.join(CAPTURES, `charte-neuve-${tag}.png`) });
          }
        }
      }
      verifier(`${tag} : aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
      await contexte.close();
    }
  }
} catch (err) {
  console.error(err);
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
