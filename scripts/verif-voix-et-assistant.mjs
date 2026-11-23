#!/usr/bin/env node
/**
 * UNE SEULE VOIX, UN ASSISTANT À SON NOM (carte « En-tête collant et défilement des pages », 17/11/2026).
 *
 * Contrôle en vrai navigateur (Chrome du système), sur un démon d'essai à soi (base neuve) et le serveur de
 * développement de la copie branché dessus — jamais l'application publiée, jamais `BELUGA_URL` :
 *
 *   1. AUCUNE VOIX : après le chargement, un rechargement et une fin de tâche simulée, rien ne joue de son
 *      (`HTMLMediaElement.play`, `speechSynthesis.speak`, `/api/speak`) ; `/api/speak` et `/api/voice-sample`
 *      n'existent plus ;
 *   2. RÉGLAGES › VOIX : plus de liste des voix du serveur, de vitesse ni de « lire à voix haute » ; la section
 *      « Votre assistant » refuse « Zorglub » avec trois noms proposés, et un appui sur l'un d'eux le fait adopter :
 *      le titre du volet devient « Assistant <nom> » sans rechargement ;
 *   3. PREMIER DÉMARRAGE : la page « Votre assistant » est nécessaire (« Continuer » éteint sans prénom) ;
 *   4. TÉLÉPHONE (390 × 844) : le bouton du bord reste au-dessus d'un champ d'écriture posé en bas, même rangé tout
 *      en bas ; un appui ouvre l'assistant en FEUILLE DU BAS ;
 *   5. ORDINATEUR (1440) : le volet flottant ne change pas.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-voix-et-assistant.mjs
 *   VERIF_CAPTURES=/chemin  → captures 1440 / 390, clair et sombre.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VOIX_PORT || 7211);
const PORT_WEB = Number(process.env.BELUGA_VOIX_PORT_WEB || 7112);
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const { DATA, journal, attendrePort: attendreDemon } = demarrerDemonDEssai({ prefixe: 'verif-voix-assistant-', port: PORT, signaux: true });
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
process.on('exit', () => {
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
});

/** Le serveur de développement n'écoute qu'en IPv6 (`localhost`) : on l'attend par une vraie requête. */
async function attendreLeServeurWeb(limiteMs) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      if ((await fetch(BASE)).ok) return true;
    } catch {
      /* pas encore là */
    }
    await pause(500);
  }
  return false;
}

function base() {
  return new Database(path.join(DATA, 'beluga.db'));
}
function poserLaSession() {
  const db = base();
  const T = Date.now();
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(jeton).digest('hex'),
    T,
    T + 3600_000,
    'essai voix et assistant',
    admin?.id ?? null,
  );
  db.close();
}
function pref(cle, valeur) {
  const db = base();
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run(cle, JSON.stringify(valeur), Date.now());
  db.close();
}
function reglages(patch) {
  const db = base();
  const brut = db.prepare("SELECT value FROM meta WHERE key = 'settings'").get();
  const actuel = brut ? JSON.parse(brut.value) : {};
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...actuel, ...patch }));
  db.close();
}
function lireReglages() {
  const db = base();
  const brut = db.prepare("SELECT value FROM meta WHERE key = 'settings'").get();
  db.close();
  return brut ? JSON.parse(brut.value) : {};
}

/** Les espions : tout ce qui pourrait faire parler la page. */
const ESPIONS = () => {
  const w = window;
  w.__paroles = [];
  const noter = (quoi) => w.__paroles.push(quoi);
  const jouer = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    // Les ondes du direct ne jouent rien hors conversation : tout appel ici est une parole.
    noter(`play:${this.currentSrc || this.src || 'flux'}`);
    return jouer.apply(this, args);
  };
  if (w.speechSynthesis) {
    const dire = w.speechSynthesis.speak.bind(w.speechSynthesis);
    w.speechSynthesis.speak = (u) => {
      noter(`speechSynthesis:${u?.text ?? ''}`);
      return dire(u);
    };
  }
  const chercher = w.fetch.bind(w);
  w.fetch = (entree, init) => {
    const url = typeof entree === 'string' ? entree : entree?.url ?? '';
    if (/\/api\/(speak|voice-sample)|\/api\/digest\?audio/.test(url)) noter(`fetch:${url}`);
    return chercher(entree, init);
  };
};

async function ouvrir(navigateur, { largeur, hauteur, telephone = false }) {
  const contexte = await navigateur.newContext({
    viewport: { width: largeur, height: hauteur },
    ...(telephone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE }]);
  await contexte.addInitScript(ESPIONS);
  const page = await contexte.newPage();
  return { contexte, page };
}

async function attendrePret(page) {
  await page.waitForFunction(() => !!document.querySelector('[data-module-voix], [data-cible-du-bord]'), null, { timeout: 60_000 });
}

async function capturer(page, nom) {
  if (!CAPTURES) return;
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

let navigateur;
try {
  if (!(await attendreDemon(90_000))) throw new Error(`Le démon d’essai n’a pas démarré :\n${journal.join('')}`);
  if (!(await attendreLeServeurWeb(90_000))) throw new Error(`Le serveur de développement n’a pas démarré :\n${journalVite.join('')}`);
  poserLaSession();
  pref('voix.visible', true);
  pref('theme', 'clair');

  navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });

  /* ---------------- 1. Aucune voix ---------------- */
  console.log('\n1. Aucune voix au chargement, au rechargement, ni à une fin de tâche');
  {
    const { contexte, page } = await ouvrir(navigateur, { largeur: 1440, hauteur: 900 });
    await page.goto(BASE);
    await attendrePret(page);
    await pause(2500);
    await page.reload();
    await attendrePret(page);
    await pause(2500);
    await page.evaluate(() => window.belugaEssai?.annonce?.('La tâche d’essai est terminée.'));
    await pause(2500);
    const paroles = await page.evaluate(() => window.__paroles);
    verifier('rien ne parle (chargement, rechargement, fin de tâche)', paroles.length === 0, paroles.join(', '));
    for (const route of ['/api/speak?text=bonjour', '/api/voice-sample?voice=fr_FR-siwis-medium']) {
      const r = await page.evaluate(async (u) => {
        const rep = await fetch(u);
        return { status: rep.status, type: rep.headers.get('content-type') ?? '' };
      }, route);
      verifier(`${route.split('?')[0]} ne rend plus de son`, !/audio/.test(r.type), `${r.status} ${r.type}`);
    }
    const historique = await page.evaluate(() => localStorage.getItem('beluga.voix.historique'));
    verifier('l’ancien historique des annonces est effacé', historique === null);
    await contexte.close();
  }

  /* ---------------- 2. Réglages › Voix ---------------- */
  console.log('\n2. Réglages › Voix : une seule voix, et « Votre assistant »');
  for (const clarte of ['clair', 'sombre']) {
    pref('theme', clarte);
    for (const [largeur, hauteur, telephone] of [[1440, 900, false], [390, 844, true]]) {
      const { contexte, page } = await ouvrir(navigateur, { largeur, hauteur, telephone });
      await page.goto(`${BASE}/#reglages/voix`);
      await page.waitForSelector('[data-votre-assistant]', { timeout: 60_000 });
      const etiquette = `${largeur} ${clarte}`;
      const texte = await page.evaluate(() => document.body.innerText);
      const reste = texte.match(/La voix sur ce serveur|La vitesse de la voix|Lire les réponses et notifications à voix haute|La voix du point du jour|Écouter le point/);
      verifier(`${etiquette} : plus de voix du serveur ni de vitesse`, !reste, reste?.[0] ?? '');
      verifier(`${etiquette} : la voix de Codex reste`, /Codex/.test(texte));
      const champ = page.locator('[data-nom-de-l-assistant]').first();
      verifier(`${etiquette} : le nom de l’assistant vaut Jarvis par défaut`, (await champ.inputValue()) === 'Jarvis');
      await champ.fill('Zorglub');
      await page.waitForSelector('[data-nom-refuse]', { timeout: 90_000 });
      const suggestions = await page.locator('[data-suggestion-de-nom]').allInnerTexts();
      verifier(`${etiquette} : « Zorglub » est refusé avec trois noms`, suggestions.length === 3, suggestions.join(', '));
      verifier(`${etiquette} : le refus n’a rien enregistré`, (lireReglages().assistantNom ?? '') !== 'Zorglub');
      await capturer(page, `reglages-voix-refus-${largeur}-${clarte}`);
      await champ.fill('Jarvis');
      await pause(600);
      await contexte.close();
    }
  }
  {
    pref('theme', 'clair');
    const { contexte, page } = await ouvrir(navigateur, { largeur: 1440, hauteur: 900 });
    await page.goto(`${BASE}/#reglages/voix`);
    await page.waitForSelector('[data-votre-assistant]', { timeout: 60_000 });
    const champ = page.locator('[data-nom-de-l-assistant]').first();
    await champ.fill('Zorglub');
    await page.waitForSelector('[data-suggestion-de-nom]', { timeout: 90_000 });
    const choisi = (await page.locator('[data-suggestion-de-nom]').first().innerText()).trim();
    await page.locator('[data-suggestion-de-nom]').first().click();
    let enregistre = '';
    for (let i = 0; i < 40 && enregistre !== choisi; i += 1) {
      await pause(250);
      enregistre = lireReglages().assistantNom ?? '';
    }
    verifier('une suggestion adoptée est enregistrée', enregistre === choisi, `${enregistre} / ${choisi}`);
    const phrase = await page.locator('[data-phrase-d-appel]').first().innerText();
    verifier('la phrase d’appel suit le nom', phrase.includes(`Dis ${choisi}`) && phrase.includes(`Assistant ${choisi}`), phrase);
    const prenom = page.locator('[data-prenom-de-l-utilisateur]').first();
    await prenom.fill('Chris');
    await prenom.blur();
    await pause(800);
    const db = base();
    const ligne = db.prepare("SELECT prenom FROM users WHERE role = 'admin' LIMIT 1").get();
    db.close();
    verifier('le prénom est rangé dans le compte', ligne?.prenom === 'Chris', String(ligne?.prenom));
    // Le titre du volet suit, sans rechargement.
    await page.keyboard.press('Escape');
    await page.goto(`${BASE}/#`);
    await page.waitForSelector('[data-cible-du-bord]', { timeout: 60_000 });
    await page.locator('[data-cible-du-bord]').first().click();
    await page.waitForSelector('[data-volet-de-jarvis] [data-titre-de-l-assistant]', { timeout: 30_000 });
    const titre = await page.locator('[data-volet-de-jarvis] [data-titre-de-l-assistant]').first().innerText();
    verifier('le titre du volet est « Assistant <nom> »', titre.trim() === `Assistant ${choisi}`, titre);
    const flottant = await page.evaluate(() => {
      const v = document.querySelector('[data-volet-de-jarvis]');
      return { feuille: !!v?.closest('[data-feuille-du-bas]'), ancre: v?.getAttribute('data-assistant-ancre') };
    });
    verifier('ordinateur : le volet reste flottant', !flottant.feuille && flottant.ancre !== 'feuille', JSON.stringify(flottant));
    await capturer(page, 'volet-ordinateur-1440-clair');
    // L'assistant ouvert est RETENU pour le compte : on le referme, sinon il couvrirait les écrans suivants.
    await page.locator('[data-volet-de-jarvis] button[aria-label="Fermer l’assistant"]').first().click();
    await pause(800);
    await contexte.close();
    reglages({ assistantNom: 'Jarvis' });
  }

  /* ---------------- 3. Premier démarrage ---------------- */
  console.log('\n3. Premier démarrage : la page « Votre assistant » est nécessaire');
  {
    const db = base();
    db.prepare("UPDATE users SET prenom = '' WHERE role = 'admin'").run();
    db.close();
    reglages({ assistant: { statut: 'a-faire', etapes: { bienvenue: 'faite', moteurs: 'faite', domaine: 'faite', projet: 'faite' } } });
    for (const clarte of ['clair', 'sombre']) {
      pref('theme', clarte);
      for (const [largeur, hauteur, telephone] of [[1440, 900, false], [390, 844, true]]) {
        const { contexte, page } = await ouvrir(navigateur, { largeur, hauteur, telephone });
        await page.goto(BASE);
        await page.waitForSelector('[data-assistant-demarrage][data-etape="assistant"] [data-votre-assistant]', { timeout: 60_000 });
        const etiquette = `${largeur} ${clarte}`;
        verifier(`${etiquette} : ni « Plus tard » ni « Continuer » sans prénom`, (await page.locator('[data-assistant-plus-tard]').count()) === 0 && (await page.locator('[data-assistant-continuer]').isDisabled()));
        await capturer(page, `demarrage-votre-assistant-${largeur}-${clarte}`);
        if (largeur === 390 && clarte === 'sombre') {
          await page.locator('[data-prenom-de-l-utilisateur]').fill('Chris');
          await page.locator('[data-prenom-de-l-utilisateur]').blur();
          await page.waitForFunction(() => !document.querySelector('[data-assistant-continuer]')?.hasAttribute('disabled'), null, { timeout: 15_000 }).catch(() => undefined);
          verifier('avec un prénom et un nom entendu, « Continuer » s’allume', !(await page.locator('[data-assistant-continuer]').isDisabled()));
        }
        await contexte.close();
      }
    }
    reglages({ assistant: { statut: 'termine', etapes: {} } });
  }

  /* ---------------- 4. Téléphone ---------------- */
  console.log('\n4. Téléphone : bouton au-dessus du champ, assistant en feuille');
  for (const clarte of ['clair', 'sombre']) {
    pref('theme', clarte);
    for (const place of [{ bord: 'droite', fraction: 1 }, { bord: 'bas', fraction: 0.9 }]) {
      pref('jarvis-bord-telephone', place);
      const { contexte, page } = await ouvrir(navigateur, { largeur: 390, hauteur: 844, telephone: true });
      await page.goto(BASE);
      await page.waitForSelector('[data-cible-du-bord]', { timeout: 60_000 });
      verifier(`${clarte} : l’assistant est fermé au départ`, (await page.locator('[data-volet-de-jarvis]').count()) === 0);
      // Un champ d'écriture posé au bas de l'écran, comme celui d'une conversation ouverte.
      await page.evaluate(() => {
        const champ = document.createElement('div');
        champ.setAttribute('data-composer', '');
        champ.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:120px;background:transparent;pointer-events:none;z-index:1';
        document.body.appendChild(champ);
      });
      await pause(1600);
      const m = await page.evaluate(() => {
        const cible = document.querySelector('[data-cible-du-bord]')?.getBoundingClientRect();
        const champ = document.querySelector('body > [data-composer]')?.getBoundingClientRect();
        return { bas: cible?.bottom ?? 0, champ: champ?.top ?? 0, hauteur: innerHeight };
      });
      verifier(`${clarte}, bord ${place.bord} au bout : le bouton reste au-dessus du champ`, m.bas <= m.champ + 0.5, `bas ${Math.round(m.bas)} / champ ${Math.round(m.champ)}`);
      if (place.bord === 'droite') await capturer(page, `bouton-au-dessus-du-champ-390-${clarte}`);
      await page.locator('[data-cible-du-bord]').first().click();
      await page.waitForSelector('[data-feuille-du-bas] [data-volet-de-jarvis]', { timeout: 30_000 }).catch(() => undefined);
      await pause(900); // la feuille finit de monter
      const feuille = await page.evaluate(() => {
        const v = document.querySelector('[data-volet-de-jarvis]');
        const f = v?.closest('[data-feuille-du-bas]');
        const r = f?.getBoundingClientRect();
        return { feuille: !!f, ancre: v?.getAttribute('data-assistant-ancre'), titre: f?.querySelector('[data-titre-de-l-assistant]')?.textContent ?? '', bas: r ? Math.round(innerHeight - r.bottom) : -1 };
      });
      verifier(`${clarte} : l’assistant s’ouvre en feuille du bas`, feuille.feuille && feuille.ancre === 'feuille' && Math.abs(feuille.bas) <= 1, JSON.stringify(feuille));
      verifier(`${clarte} : la feuille est titrée « Assistant Jarvis »`, feuille.titre.trim() === 'Assistant Jarvis', feuille.titre);
      verifier(`${clarte} : le bouton du bord s’efface sous la feuille ouverte`, (await page.locator('[data-cible-du-bord]').count()) === 0);
      if (place.bord === 'droite') await capturer(page, `assistant-en-feuille-390-${clarte}`);
      await page.locator('[data-feuille-du-bas] button[aria-label="Fermer l’assistant"]').first().click();
      await pause(900);
      verifier(`${clarte} : refermée, la feuille rend le bouton`, (await page.locator('[data-cible-du-bord]').count()) === 1);
      await contexte.close();
    }
  }
} catch (err) {
  verifier('le contrôle a pu aller au bout', false, err instanceof Error ? err.message : String(err));
} finally {
  await navigateur?.close();
}

const echecs = resultats.filter((r) => !r).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles réussis.`);
process.exit(echecs ? 1 : 0);
