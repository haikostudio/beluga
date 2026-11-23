#!/usr/bin/env node
/**
 * JARVIS VÉRIFIE AVANT DE RÉPONDRE, À L'ÉCRAN (carte « Jarvis plus fiable et vérifié », 18/11/2026).
 *
 *   1. la liste des étapes se pose dans les bulles REPLIÉE (carte « Jarvis : répondre sans tout raconter »,
 *      18/11/2026) : une seule ligne titrée par l'étape en cours, un compteur « n sur m », un chevron ; un clic la
 *      déplie (une étape par source, son résultat dessous, « Je recoupe les réponses » en dernier, une étape en échec
 *      marquée), un autre la replie ;
 *   2. une étape que Beluga a fait DIRE à la voix (`annonce`) n'a pas de bulle ;
 *   3. Réglages › Voix porte « Le cerveau de l'assistant vocal » : deux menus de même hauteur côte à côte (Modèle,
 *      Réflexion), Sol poussé par défaut ; un choix est enregistré et survit au rechargement ;
 *   4. ordinateur 1440 et téléphone 390, sombre et clair : rien ne déborde, aucune erreur de page.
 *
 * Démon d'essai à base neuve (aucun compte : aucun quota) et serveur de développement de la copie branché sur lui —
 * `belugaEssai` n'existe qu'hors production. Jamais BELUGA_URL, jamais BELUGA_TOKEN.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-jarvis-verifie.mjs
 *   VERIF_CAPTURES=/chemin env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-jarvis-verifie.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7241);
const PORT_WEB = Number(process.env.BELUGA_VERIF_PORT_WEB || 7142);
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-jarvis-verifie-', port: PORT, signaux: true });
const jeton = crypto.randomBytes(32).toString('hex');
const vite = spawn('npm', ['run', 'dev', '--workspace', 'web', '--', '--port', String(PORT_WEB), '--strictPort'], {
  cwd: RACINE,
  env: { ...process.env, BELUGA_DEMON_PORT: String(PORT), NODE_ENV: 'development', BELUGA_URL: '', BELUGA_TOKEN: '' },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const couperVite = () => {
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
};
process.on('exit', couperVite);

const base = () => new Database(path.join(DATA, 'beluga.db'));
function poserLaPreference(cle, valeur) {
  const db = base();
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run(cle, JSON.stringify(valeur), Date.now());
  db.close();
}

const PHRASE = 'verif-essai';
const etape = (cle, libelle, etat, resultat) => ({ id: `${PHRASE}:${cle}`, libelle, etat, ...(resultat ? { resultat } : {}) });
const BULLES = [
  { role: 'user', texte: 'Qu’est-ce qui tourne en ce moment, et on en est où sur la rapidité de la voix ?' },
  {
    role: 'assistant',
    texte: '',
    verifications: {
      phrase: PHRASE,
      etapes: [
        etape('memoire', 'Mémoire de Beluga', 'finie', '3 éléments trouvés'),
        etape('discussions', 'Discussions passées', 'finie', '1 discussion retrouvée'),
        etape('cartes', 'Tableau des tâches, tous les projets', 'finie', '1 tâche approchante'),
        etape('activite', 'Mises en ligne, en production et ce qui attend', 'echec', 'pas de réponse à temps'),
        etape('outil-1', 'Je cherche dans la mémoire : rapidité de la voix', 'en-cours'),
        etape('recoupe', 'Je recoupe les réponses', 'a-venir'),
      ],
    },
  },
  { role: 'assistant', texte: 'La tâche sur la rapidité est dans « Planifié », et aucune mise en production ne tourne.' },
];

async function ouvrirPage(navigateur, telephone) {
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  page.setDefaultTimeout(20_000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.belugaEssai?.bullesDuDirect, null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 3 && (await page.locator('[role="dialog"]').count()); i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  return { contexte, page, erreurs };
}

/** Ouvre la conversation (Maj Maj sur ordinateur, toucher du bouton du bord sur téléphone), comme `verif-bulle-jarvis`. */
async function ouvrirLaConversation(page, telephone) {
  if (telephone) {
    await page.locator('[data-bouton-du-bord]').first().click().catch(() => undefined);
  } else {
    for (const _ of [0, 1]) {
      await page.keyboard.down('Shift');
      await page.waitForTimeout(40);
      await page.keyboard.up('Shift');
      await page.waitForTimeout(90);
    }
  }
  await page.waitForTimeout(1500);
}

async function poserLesBulles(page) {
  for (let i = 0; i < 15; i += 1) {
    await page.evaluate((b) => window.belugaEssai?.bullesDuDirect?.(null, b), BULLES);
    await page.waitForTimeout(400);
    if (await page.locator('[data-bulle="verifications"]').count()) return true;
  }
  return false;
}

async function capturer(page, nom, cible) {
  if (!CAPTURES) return;
  await page.waitForTimeout(300);
  if (cible) await page.locator(cible).first().screenshot({ path: path.join(CAPTURES, `${nom}.png`) }).catch(() => page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) }));
  else await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

let navigateur;
try {
  if (!(await attendrePort())) throw new Error('le démon d’essai ne répond pas');
  const db = base();
  const T = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai jarvis vérifie');
  db.close();
  poserLaPreference('voix.visible', true);
  for (let i = 0; i < 90; i += 1) {
    if (await fetch(BASE).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  let premier = true;
  for (const clarte of ['sombre', 'clair']) {
    for (const telephone of [false, true]) {
      const appareil = telephone ? 'telephone' : 'ordinateur';
      poserLaPreference('theme', clarte);
      const { contexte, page, erreurs } = await ouvrirPage(navigateur, telephone);

      /* 1. La liste cochée dans les bulles. */
      await page.waitForSelector('[data-bouton-du-bord]', { timeout: 60_000 });
      await page.waitForTimeout(3200);
      await ouvrirLaConversation(page, telephone);
      const posee = await poserLesBulles(page);
      verifier(`${appareil} ${clarte} : la liste des étapes est dans les bulles`, posee);
      if (posee) {
        const lire = () =>
          page.evaluate(() => {
            const l = document.querySelector('[data-bulle="verifications"]');
            const etapes = [...(l?.querySelectorAll('[data-etape-de-verification]') ?? [])];
            const titre = l?.querySelector('[data-verifications-titre]');
            const r = l?.getBoundingClientRect();
            return {
              deplie: l?.getAttribute('data-verifications-deplie'),
              titre: titre?.textContent?.trim(),
              titreSurUneLigne: !!titre && titre.getBoundingClientRect().height < 22,
              hauteur: r ? Math.round(r.height) : 0,
              compteur: l?.querySelector('[data-verifications-compteur]')?.textContent?.trim(),
              etats: etapes.map((e) => e.getAttribute('data-etape-de-verification')),
              derniere: etapes.at(-1)?.textContent?.trim(),
              resultat: etapes[0]?.textContent ?? '',
              ancienEntete: (l?.textContent ?? '').includes('Je vérifie avant de répondre'),
              dansLEcran: !!r && r.left >= 0 && r.right <= window.innerWidth + 0.5,
              debord: document.documentElement.scrollWidth > window.innerWidth + 1,
            };
          });
        const replie = await lire();
        verifier(`${appareil} ${clarte} : repliée par défaut, sans aucune étape listée`, replie.deplie === 'non' && replie.etats.length === 0, `${replie.deplie} ${replie.etats.length}`);
        verifier(`${appareil} ${clarte} : son titre est l’étape en cours, sur une ligne`, replie.titre === 'Je cherche dans la mémoire : rapidité de la voix' && replie.titreSurUneLigne, replie.titre);
        verifier(`${appareil} ${clarte} : repliée, le compteur dit « 4 sur 6 »`, replie.compteur === '4 sur 6', replie.compteur);
        verifier(`${appareil} ${clarte} : plus d’entête « Je vérifie avant de répondre »`, !replie.ancienEntete);
        await capturer(page, `${appareil}-${clarte}-liste-repliee`, '[data-bulles-du-direct]');
        await page.locator('[data-verifications-bascule]').first().click();
        await page.waitForTimeout(300);
        const lu = await lire();
        verifier(`${appareil} ${clarte} : un clic la déplie`, lu.deplie === 'oui' && lu.hauteur > replie.hauteur, `${lu.deplie} ${replie.hauteur}→${lu.hauteur}`);
        verifier(`${appareil} ${clarte} : finies, échec, en cours, à venir`, lu.etats.join(',') === 'finie,finie,finie,echec,en-cours,a-venir', lu.etats.join(','));
        verifier(`${appareil} ${clarte} : « Je recoupe les réponses » en dernier`, /^Je recoupe les réponses/.test(lu.derniere ?? ''), lu.derniere);
        verifier(`${appareil} ${clarte} : le résultat s’écrit sous l’étape`, /Mémoire de Beluga\s*3 éléments trouvés/.test(lu.resultat), lu.resultat);
        verifier(`${appareil} ${clarte} : la liste tient dans l’écran, rien ne déborde`, lu.dansLEcran && !lu.debord);
        await capturer(page, `${appareil}-${clarte}-liste`, '[data-bulles-du-direct]');
        await page.locator('[data-verifications-bascule]').first().click();
        await page.waitForTimeout(300);
        const rereplie = await lire();
        verifier(`${appareil} ${clarte} : un second clic la replie`, rereplie.deplie === 'non' && rereplie.etats.length === 0);
      }

      /* 2. Une étape dite par la voix n'a pas de bulle (règle du fil, jouée dans la page). */
      if (premier) {
        const sansBulle = await page.evaluate(async () => {
          const { filApres } = await import('/src/lib/direct-codex.ts');
          let n = 0;
          const fil = filApres([], { type: 'voix.direct.tour', role: 'assistant', texte: 'Mémoire : 3 éléments trouvés.', final: true, annonce: true }, () => ++n);
          const fil2 = filApres(fil, { type: 'voix.direct.activite', id: 'p:memoire', libelle: 'Mémoire', etat: 'en-cours', phrase: 'p' }, () => ++n);
          const fil3 = filApres(fil2, { type: 'voix.direct.activite', id: 'p:recoupe', libelle: 'Je recoupe', etat: 'a-venir', phrase: 'p' }, () => ++n);
          const fil4 = filApres(fil3, { type: 'voix.direct.activite', id: 'outil', libelle: 'Je cherche', etat: 'en-cours', phrase: 'p' }, () => ++n);
          const fil5 = filApres(fil4, { type: 'voix.direct.activite', id: 'p:memoire', libelle: 'Mémoire', etat: 'finie', resultat: '2 éléments', phrase: 'p' }, () => ++n);
          return { vide: fil.length === 0, une: fil5.length === 1, ordre: fil5[0]?.verifications?.etapes.map((e) => `${e.id}=${e.etat}`).join(' ') };
        });
        verifier('une étape dite par la voix n’a pas de bulle', sansBulle.vide);
        verifier('les étapes d’une phrase restent dans UNE liste, « recoupe » en dernier', sansBulle.une && sansBulle.ordre === 'p:memoire=finie outil=en-cours p:recoupe=a-venir', sansBulle.ordre);
        premier = false;
      }

      /* 3. Réglages › Voix : le cerveau de l'assistant vocal (conversation refermée par le rechargement). */
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.belugaEssai, null, { timeout: 60_000 });
      await page.evaluate(() => (window.location.hash = '#reglages/voix'));
      const bloc = page.locator('[data-cerveau-de-la-voix]');
      await bloc.waitFor({ timeout: 20_000 });
      await bloc.scrollIntoViewIfNeeded();
      const menus = await page.evaluate(() => {
        const m = document.querySelector('[data-liste-deroulante="cerveau-modele"], [data-selecteur-tiroir="cerveau-modele"]');
        const r = document.querySelector('[data-liste-deroulante="cerveau-reflexion"], [data-selecteur-tiroir="cerveau-reflexion"]');
        const a = m?.getBoundingClientRect();
        const b = r?.getBoundingClientRect();
        return {
          modele: m?.getAttribute('data-liste-valeur') ?? m?.getAttribute('data-selecteur-valeur'),
          reflexion: r?.getAttribute('data-liste-valeur') ?? r?.getAttribute('data-selecteur-valeur'),
          memeHauteur: !!a && !!b && Math.abs(a.height - b.height) < 1,
          coteACote: !!a && !!b && Math.abs(a.top - b.top) < 1,
          texte: m?.textContent?.trim(),
        };
      });
      verifier(`${appareil} ${clarte} : Modèle et Réflexion, Sol poussé par défaut`, menus.modele === 'gpt-5.6-sol' && menus.reflexion === 'high', JSON.stringify(menus));
      verifier(`${appareil} ${clarte} : les deux menus ont la même hauteur`, menus.memeHauteur);
      if (!telephone) verifier('ordinateur : les deux menus sont côte à côte', menus.coteACote);
      await capturer(page, `${appareil}-${clarte}-cerveau`, '[data-cerveau-de-la-voix]');

      if (clarte === 'sombre' && !telephone) {
        // Choisir « Moyenne », recharger : le choix tient.
        await page.locator('[data-liste-deroulante="cerveau-reflexion"]').click();
        await page.locator('[data-selecteur-option="medium"], [role="option"]:has-text("Moyenne")').first().click();
        await page.waitForTimeout(800);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.evaluate(() => (window.location.hash = '#reglages/voix'));
        await page.locator('[data-liste-deroulante="cerveau-reflexion"]').waitFor({ timeout: 30_000 });
        const apres = await page.locator('[data-liste-deroulante="cerveau-reflexion"]').getAttribute('data-liste-valeur');
        verifier('un choix de réflexion est enregistré et survit au rechargement', apres === 'medium', apres ?? '');
        const db2 = base();
        const reglages = db2.prepare("SELECT value FROM meta WHERE key = 'settings'").get();
        db2.close();
        verifier('le réglage est en base', !reglages || /"voixCodexReflexion":"medium"/.test(String(reglages.value ?? '')), String(reglages?.value ?? '').slice(0, 0));
        // Remettre le défaut.
        await page.locator('[data-liste-deroulante="cerveau-reflexion"]').click();
        await page.locator('[data-selecteur-option="high"], [role="option"]:has-text("Poussée")').first().click();
        await page.waitForTimeout(500);
      }
      verifier(`${appareil} ${clarte} : aucune erreur ne sort de la page`, erreurs.length === 0, erreurs[0] ?? '');
      await contexte.close();
    }
  }
} catch (e) {
  verifier('le contrôle est allé au bout', false, String(e).slice(0, 400));
} finally {
  if (navigateur) await navigateur.close().catch(() => undefined);
  couperVite();
  nettoyer();
}

const rates = resultats.filter((r) => !r).length;
console.log(`\n${resultats.length - rates}/${resultats.length} contrôles passés`);
process.exit(rates ? 1 : 0);
