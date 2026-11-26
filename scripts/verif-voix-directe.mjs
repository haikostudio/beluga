#!/usr/bin/env node
/**
 * LE DIRECT VOCAL AVEC CODEX ET L'EN-TÊTE APRÈS « NOUVEL ARTEFACT », DANS UN VRAI NAVIGATEUR
 * (carte « En-tête du projet et assistant vocal Codex », 15-16/11/2026).
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-voix-directe.mjs
 *   VERIF_CAPTURES=/chemin node scripts/verif-voix-directe.mjs     # garde les captures
 *   VERIF_SANS_DIRECT=1 …                                          # saute la vraie session vocale
 *
 * Démon d'essai à base neuve (port à soi). Le décor recopie UN compte Codex déclaré dans la base servie (lecture
 * seule) : la vraie session vocale passe par son ABONNEMENT, une vingtaine de secondes, sans clé payante. Une
 * phrase fabriquée par la voix du serveur (Piper) tient lieu de micro (`--use-file-for-fake-audio-capture`).
 *
 * Contrôles : 1) Nouvel artefact › Programmation › un AUTRE projet : le haut passe sur ce projet, la tâche reste
 * ouverte ; 2) le direct s'ouvre, la phrase dite et la réponse de Codex s'écrivent dans le module, la discussion
 * est gardée (flux « Discussions ») et marquée du projet cité ; 3) Réglages › Voix liste les voix du direct, un
 * toucher en retient une ; 4) sur téléphone, le module est au bord gauche (geste complet : verif-app-iphone-natif.mjs).
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7233);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });
const AVEC_DIRECT = !process.env.VERIF_SANS_DIRECT;

/* La base SERVIE (lecture seule) : celle du dépôt principal, dont cette copie de travail est une branche. */
const DEPOT_PRINCIPAL = path.resolve(execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: RACINE, encoding: 'utf8' }).trim(), '..');
const BASE_SERVIE = process.env.BELUGA_BASE_SERVIE || path.join(DEPOT_PRINCIPAL, 'data', 'beluga.db');

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-voix-directe-', port: PORT, signaux: true });
const jeton = crypto.randomBytes(32).toString('hex');
const T = Date.now();

function poserLeDecor() {
  /* La voix du serveur (Piper) est prêtée au démon d'essai, en lecture : « Écouter » s'en sert pour poser la question. */
  for (const piece of [['venv'], ['models', 'piper']]) {
    const source = path.join(DEPOT_PRINCIPAL, 'data', ...piece);
    const cible = path.join(DATA, ...piece);
    if (fs.existsSync(source) && !fs.existsSync(cible)) {
      fs.mkdirSync(path.dirname(cible), { recursive: true });
      fs.symlinkSync(source, cible);
    }
  }
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai');
  const autre = path.join(path.dirname(DEPOT), 'facturo');
  fs.mkdirSync(autre, { recursive: true });
  for (const [id, name, chemin, rang] of [['p-boutique', 'Boutique', DEPOT, 1], ['p-facturo', 'Facturo', autre, 2]]) {
    const p = { id, name, path: chemin, defaultEngine: 'claude', isSelf: false, rank: rang, archived: false, createdAt: T, updatedAt: T };
    db.prepare('INSERT OR REPLACE INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(id, name, chemin, JSON.stringify(p), T, T);
  }
  const pref = db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)');
  pref.run('voix.visible', JSON.stringify(true), T);
  pref.run('theme', JSON.stringify(process.env.VERIF_THEME || 'sombre'), T);
  if (AVEC_DIRECT && fs.existsSync(BASE_SERVIE)) {
    const servie = new Database(BASE_SERVIE, { readonly: true });
    const compte = servie.prepare("SELECT * FROM accounts WHERE json_extract(data, '$.engine') = 'codex' AND coalesce(json_extract(data, '$.disabled'), 0) = 0 ORDER BY id LIMIT 1").get();
    servie.close();
    if (compte) {
      const colonnes = Object.keys(compte);
      db.prepare(`INSERT OR REPLACE INTO accounts (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`).run(...colonnes.map((c) => compte[c]));
    }
  }
  db.close();
}

/** La phrase qui tient lieu de micro : dite par la voix du serveur, suivie d'un long silence. */
function phraseParlee() {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-voix-phrase-'));
  const brut = path.join(dossier, 'brut.wav');
  const sortie = path.join(dossier, 'phrase.wav');
  const venv = path.join(DEPOT_PRINCIPAL, 'data', 'venv', 'bin', 'python');
  const modele = path.join(DEPOT_PRINCIPAL, 'data', 'models', 'piper', 'fr_FR-siwis-medium.onnx');
  execFileSync(venv, ['-m', 'piper', '-m', modele, '-f', brut], { input: 'Bonjour Codex. En une phrase, que sais-tu du projet Boutique ?' });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', brut, '-af', 'adelay=1500|1500,apad=pad_dur=40', '-ar', '48000', '-ac', '1', sortie]);
  return sortie;
}

async function nouvellePage(navigateur, { telephone = false } = {}) {
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    isMobile: telephone,
    hasTouch: telephone,
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE }]);
  const page = await contexte.newPage();
  page.on('pageerror', (e) => console.log(`    (erreur de page) ${e.message}`));
  return page;
}

async function capturer(page, nom) {
  if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

async function ouvrirLeModule(page) {
  /* Depuis la carte « Jarvis : volet, voix et rapidité » (16/11/2026) : le bouton du bord ouvre le volet de
     l'assistant, et son bouton du micro lance la conversation (`[data-module-voix][data-conversation]`). */
  const rond = page.locator('[data-bouton-du-bord]');
  await rond.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  for (let i = 0; i < 3 && !(await page.$('[data-module-voix][data-conversation]')); i++) {
    /* La voix ne s'ouvre plus d'un bouton du champ (18/11/2026) : l'événement du raccourci. */ await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:parler-a-jarvis', { detail: { agentId: null } })));
    await page.waitForTimeout(800);
  }
  return !!(await page.$('[data-module-voix][data-conversation]'));
}

try {
  if (!(await attendrePort())) throw new Error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  poserLeDecor();
  const fauxMicro = AVEC_DIRECT ? phraseParlee() : null;
  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', ...(fauxMicro ? [`--use-file-for-fake-audio-capture=${fauxMicro}`] : [])],
  });

  /* ---------- 1. L'en-tête suit le projet de l'artefact créé ---------- */
  /* « NOUVEL ARTEFACT » A QUITTÉ LA COLONNE (carte « Beluga piloté par des agents », 26/11/2026) : depuis Boutique, on
     passe au projet Facturo et on y crée la tâche par « Nouvelle tâche » (onglet « Tâches » de sa page). */
  console.log('1. Depuis un projet, « Nouvelle tâche » dans un autre projet');
  {
    const page = await nouvellePage(navigateur);
    await page.goto(`${BASE}/#projet/p-boutique`, { waitUntil: 'load' });
    await page.locator('[data-gabarit-equipe="projet"]').first().waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(1500);
    await page.goto(`${BASE}/#projet/p-facturo`, { waitUntil: 'load' });
    await page.locator('[data-barre-onglets="projet-onglets"] [data-onglet="taches"]').first().click();
    await page.locator('[data-nouvelle-tache-de-l-equipe]').first().click();
    await page.waitForTimeout(3500);
    /* Le fil d'Ariane VU : le texte de la barre du haut de la zone, lu au point où il s'affiche. */
    const fil = await page.evaluate(() => {
      let e = document.elementFromPoint(520, 22);
      while (e && e.parentElement && e.getBoundingClientRect().width < 400) e = e.parentElement;
      return e?.innerText?.replace(/\s+/g, ' ') ?? '';
    });
    verifier('le fil d’Ariane passe sur le projet choisi', /Facturo/.test(fil) && !/Boutique/.test(fil), fil);
    verifier('l’adresse vise le projet choisi', /p-facturo/.test(page.url()), page.url());
    const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
    const carte = db.prepare("SELECT id, project_id FROM cards WHERE project_id = 'p-facturo' ORDER BY created_at DESC LIMIT 1").get();
    db.close();
    verifier('la tâche est rangée dans le projet choisi', !!carte);
    verifier('la tâche reste ouverte après la bascule', !!carte && page.url().includes(carte.id), page.url());
    await capturer(page, 'entete-apres-nouvel-artefact');
    await page.context().close();
  }

  /* ---------- 2. Le direct ---------- */
  if (AVEC_DIRECT) {
    console.log('2. Le direct avec Codex, par l’abonnement');
    const page = await nouvellePage(navigateur);
    await page.goto(`${BASE}/#projet/p-boutique`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    /* Toucher Jarvis au bord ouvre la conversation (16/11/2026 : plus de bouton « conversation » dans un panneau). */
    verifier('Jarvis sort en barre d’appel', await ouvrirLeModule(page));
    const enDirect = await page
      .locator('[data-module-voix][data-etat-direct="ecoute"]')
      .waitFor({ state: 'attached', timeout: 70_000 })
      .then(() => true, () => false);
    verifier('le direct avec Codex est en écoute', enDirect, (await page.locator('[data-module-voix]').getAttribute('data-etat-direct').catch(() => '')) ?? '');
    const dite = await page.locator('[data-tour-fil][data-role="user"][data-tour-final]').first().waitFor({ timeout: 45_000 }).then(() => true, () => false);
    verifier('la phrase dite s’écrit dans le fil', dite, dite ? await page.locator('[data-tour-fil][data-role="user"]').first().textContent() : '');
    const repondu = await page.locator('[data-tour-fil][data-role="assistant"][data-tour-final]').first().waitFor({ timeout: 120_000 }).then(() => true, () => false);
    verifier('la réponse de Codex s’écrit dans le fil', repondu, repondu ? await page.locator('[data-tour-fil][data-role="assistant"][data-tour-final]').first().textContent() : '');
    await capturer(page, 'direct-ordinateur');
    await page.locator('[data-jarvis-raccrocher]').click();
    await page.waitForTimeout(3000);
    const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
    const disc = db.prepare('SELECT id, tours, projets, fin FROM discussions_vocales ORDER BY id DESC LIMIT 1').get();
    db.close();
    verifier('la discussion est gardée, close, avec ses tours', !!disc && disc.tours >= 2 && !!disc.fin, JSON.stringify(disc));
    verifier('la discussion est marquée du projet cité', !!disc && JSON.parse(disc.projets).includes('p-boutique'), disc?.projets);
    await page.context().close();
  }

  /* ---------- 3. Réglages › Voix ---------- */
  console.log('3. Réglages › Voix');
  for (const theme of ['sombre', 'clair']) {
    const db = new Database(path.join(DATA, 'beluga.db'));
    db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('theme', JSON.stringify(theme), Date.now());
    db.close();
    const page = await nouvellePage(navigateur);
    await page.goto(`${BASE}/#projet/p-boutique`, { waitUntil: 'load' });
    await page.locator('[data-reglages-menu]').click();
    await page.getByText('Voix', { exact: true }).first().click();
    await page.locator('[data-voix-directe]').first().waitFor({ timeout: 60_000 });
    const nb = await page.locator('[data-voix-directe]').count();
    if (theme === 'sombre') {
      verifier('les voix du direct sont listées', nb >= 9, `${nb} voix`);
      await page.locator('[data-voix-directe="sol"] button').first().click();
      const retenue = await page.locator('[data-voix-directe="sol"][aria-current="true"]').waitFor({ timeout: 10_000 }).then(() => true, () => false);
      verifier('un toucher sur le nom retient la voix', retenue);
      if (AVEC_DIRECT) {
        /* « Écouter » ouvre une courte session sans outils ; aucune erreur ne doit remonter. */
        const erreurs = [];
        page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));
        await page.locator('[data-voix-directe="cove"] button[aria-label="Écouter Cove"]').click();
        const enCours = await page.locator('[data-voix-directe="cove"]', { hasText: 'Arrêter' }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
        await page.waitForTimeout(12_000);
        const erreurAffichee = await page.locator('text=/Codex refuse|impossible|interrompu/').count();
        verifier('« Écouter » fait parler la voix sans erreur', enCours && !erreurAffichee, erreurs.slice(0, 2).join(' | '));
      }
    }
    await capturer(page, `reglages-voix-${theme}`);
    await page.context().close();
  }

  /* ---------- 4. Téléphone ---------- */
  console.log('4. Sur téléphone');
  for (const theme of ['sombre', 'clair']) {
    const db = new Database(path.join(DATA, 'beluga.db'));
    db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('theme', JSON.stringify(theme), Date.now());
    db.close();
    const page = await nouvellePage(navigateur, { telephone: true });
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    const module = page.locator('[data-module-voix]');
    await module.waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(1500);
    const rond = await module.boundingBox();
    if (theme === 'sombre') {
      /* Depuis le 16/11/2026 (carte « Assistant vocal rapide ») : le bouton vit au BORD GAUCHE, tiré du doigt
         (contrôle complet du geste : scripts/verif-app-iphone-natif.mjs). */
      verifier('le module est au bord gauche, à peine visible', !!rond && rond.x < 0 && rond.x + rond.width <= 14, JSON.stringify(rond));
      verifier('rien ne déborde en largeur', await page.evaluate(() => document.documentElement.scrollWidth - innerWidth === 0));
    }
    await capturer(page, `telephone-replie-${theme}`);
    await ouvrirLeModule(page);
    /* Le fil se montre sans vraie session : des nouvelles fabriquées, au format du démon. */
    await page.evaluate(() => {
      const envoyer = (detail) => window.dispatchEvent(new CustomEvent('beluga:voix-directe', { detail }));
      envoyer({ type: 'voix.direct.tour', role: 'user', texte: 'Où en est la facturation de Facturo ?', final: true, projets: [] });
      envoyer({ type: 'voix.direct.tour', role: 'assistant', texte: 'Les relances automatiques sont en ligne depuis jeudi. Il reste l’export des factures en PDF.', final: true, projets: ['Facturo'], sources: 3 });
      envoyer({ type: 'voix.direct.tache', titre: 'Export des factures en PDF', projet: 'Facturo', niveau: 'approfondi', moteur: 'codex', etat: 'proposee' });
      envoyer({ type: 'voix.direct.tache', titre: 'Export des factures en PDF', etat: 'creee' });
    });
    await page.waitForTimeout(800);
    if (theme === 'sombre') {
      const ouvert = await module.boundingBox();
      verifier('ouvert, il tient dans l’écran', !!ouvert && ouvert.x >= 15 && ouvert.x + ouvert.width <= 375 && ouvert.y + ouvert.height <= 844, JSON.stringify(ouvert));
      verifier('les bulles montrent la tâche créée', (await page.locator('[data-tache-du-direct="creee"]').count()) === 1);
    }
    await capturer(page, `telephone-ouvert-${theme}`);
    await page.context().close();

    /* Le même fil sur ordinateur, dans le module en bas à droite. */
    const bureau = await nouvellePage(navigateur);
    await bureau.goto(`${BASE}/#projet/p-boutique`, { waitUntil: 'load' });
    await bureau.waitForTimeout(2000);
    await ouvrirLeModule(bureau);
    await bureau.evaluate(() => {
      const envoyer = (detail) => window.dispatchEvent(new CustomEvent('beluga:voix-directe', { detail }));
      envoyer({ type: 'voix.direct.tour', role: 'user', texte: 'Où en est la facturation de Facturo ?', final: true, projets: [] });
      envoyer({ type: 'voix.direct.tour', role: 'assistant', texte: 'Les relances automatiques sont en ligne depuis jeudi. Il reste l’export des factures en PDF.', final: true, projets: ['Facturo'], sources: 3 });
      envoyer({ type: 'voix.direct.tache', titre: 'Export des factures en PDF', projet: 'Facturo', niveau: 'approfondi', moteur: 'codex', etat: 'proposee' });
      envoyer({ type: 'voix.direct.tour', role: 'user', texte: 'Oui, garde-la.', final: true, projets: [] });
      envoyer({ type: 'voix.direct.tache', titre: 'Export des factures en PDF', etat: 'creee' });
    });
    await bureau.waitForTimeout(800);
    if (theme === 'sombre') {
      const boite = await bureau.locator('[data-module-voix]').boundingBox();
      verifier('sur ordinateur, le fil ouvert prend la place d’une conversation', !!boite && boite.width >= 380 && boite.height >= 500, JSON.stringify(boite));
    }
    await capturer(bureau, `ordinateur-fil-${theme}`);
    await bureau.context().close();
  }

  await navigateur.close();
} catch (err) {
  console.error(err);
  resultats.push(false);
} finally {
  nettoyer();
}

const ok = resultats.filter(Boolean).length;
console.log(`\n${ok}/${resultats.length} contrôles au vert`);
process.exit(ok === resultats.length ? 0 : 1);
