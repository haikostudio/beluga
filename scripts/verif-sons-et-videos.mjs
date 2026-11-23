#!/usr/bin/env node
/**
 * LES VIDÉOS ET LES SONS DE L'AGENT DANS LA CONVERSATION, DANS UN VRAI NAVIGATEUR.
 *
 * Carte « Vidéos et sons dans la conversation ». Un démon d'essai (base neuve,
 * port à lui) sert l'interface construite de CETTE copie de travail. Le décor :
 * la conversation de l'Assistant, une réponse de l'agent qui porte un son (WAV
 * décodable), une vidéo et une image. Le navigateur vérifie :
 *  1. le son du fil passe par le lecteur à onde (lecture / pause à gauche),
 *     plus aucun lecteur du navigateur visible ; l'onde vient du VRAI fichier ;
 *  2. lecture → pause, et un clic au milieu de l'onde y emmène la lecture ;
 *  3. la bande « Ce que l'agent a vu » montre le son (lecteur), la vidéo
 *     (vignette + bouton lecture au centre) et l'image ;
 *  4. « agrandir » du son ouvre la visionneuse sur le lecteur en grand, la
 *     vidéo de la bande s'ouvre en grand sur son lecteur ;
 *  5. au téléphone (390 px), le lecteur tient dans la largeur.
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-sons-et-videos.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.HAIKO_SONS_VIDEOS_PORT || 7243);
const BASE = `http://127.0.0.1:${PORT}`;
const { TMP, DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-sons-videos-', port: PORT });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}

const PROJET = 'p-sons-videos';
const AGENT = 'a-sons-videos';
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

/* Une image PNG d'une couleur, pour que la vignette se dessine. */
function png(largeur, hauteur, [r, g, b]) {
  const crc = (buf) => {
    let c = ~0;
    for (const o of buf) {
      c ^= o;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const morceau = (type, donnees) => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(donnees.length);
    const t = Buffer.from(type);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([t, donnees])));
    return Buffer.concat([l, t, donnees, c]);
  };
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0);
  entete.writeUInt32BE(hauteur, 4);
  entete[8] = 8;
  entete[9] = 2;
  const ligne = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: largeur }, () => [r, g, b]).flat())]);
  const brut = Buffer.concat(Array.from({ length: hauteur }, () => ligne));
  const { deflateSync } = zlib;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), morceau('IHDR', entete), morceau('IDAT', deflateSync(brut)), morceau('IEND', Buffer.alloc(0))]);
}

/* Un son WAV de 2 s : un silence, puis un bip — l'onde n'est donc pas plate. */
function wav(secondes = 2, frequence = 440) {
  const taux = 8000;
  const n = taux * secondes;
  const donnees = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i += 1) {
    const v = i < n / 2 ? 0 : Math.sin((2 * Math.PI * frequence * i) / taux) * 0.8;
    donnees.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const tete = Buffer.alloc(44);
  tete.write('RIFF', 0);
  tete.writeUInt32LE(36 + donnees.length, 4);
  tete.write('WAVEfmt ', 8);
  tete.writeUInt32LE(16, 16);
  tete.writeUInt16LE(1, 20);
  tete.writeUInt16LE(1, 22);
  tete.writeUInt32LE(taux, 24);
  tete.writeUInt32LE(taux * 2, 28);
  tete.writeUInt16LE(2, 32);
  tete.writeUInt16LE(16, 34);
  tete.write('data', 36);
  tete.writeUInt32LE(donnees.length, 40);
  return Buffer.concat([tete, donnees]);
}

/* ---- Le décor ---- */
const t0 = Date.now() - 600_000;
{
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), t0, Date.now() + 3_600_000, 'verif-sons-videos');
  const projet = { id: PROJET, name: 'Essai sons et vidéos', path: DEPOT, defaultEngine: 'codex', isSelf: false, rank: 1, archived: false, createdAt: t0, updatedAt: t0 };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(PROJET, projet.name, DEPOT, JSON.stringify(projet), t0, t0);
  const agent = { id: AGENT, projectId: PROJET, role: 'deploy', title: 'Assistant', run: { engine: 'claude' }, status: 'idle', assistantGlobal: true, createdAt: t0, updatedAt: t0 };
  db.prepare(`INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, NULL, 'deploy', 'idle', ?, ?, ?)`).run(AGENT, PROJET, JSON.stringify(agent), t0, t0);
  db.prepare("INSERT INTO meta (key, value) VALUES ('assistant.agent', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(AGENT);
  db.close();
}
process.env.BELUGA_DATA = DATA;
const { joindreUnFichier } = await import(pathToFileURL(path.join(RACINE, 'server/dist/joindre-fichier.js')).href);
const fichiers = path.join(TMP, 'fichiers');
fs.mkdirSync(fichiers, { recursive: true });
const poser = async (nom, contenu) => {
  const chemin = path.join(fichiers, nom);
  fs.writeFileSync(chemin, contenu);
  const r = await joindreUnFichier({ projectId: PROJET, agentId: AGENT, fichier: chemin, nom, deLAgent: true });
  if (!r.ok) throw new Error(`pièce refusée : ${r.refus}`);
  return r.attachment.id;
};
const son = await poser('voix-off.wav', wav());
const video = await poser('rendu.mp4', crypto.randomBytes(4096));
const image = await poser('vue.png', png(64, 40, [40, 120, 200]));
{
  const db = new Database(path.join(DATA, 'beluga.db'));
  const message = (id, role, content, quand, attachments = []) =>
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(id, AGENT, role, JSON.stringify({ id, agentId: AGENT, role, content, createdAt: quand, attachments }), quand);
  message('m1', 'user', 'Fabrique une voix off et une vidéo, sur ce modèle.', t0 + 1_000, [son, video]);
  message('m2', 'assistant', 'Voici la voix off, la vidéo et une vue.', t0 + 60_000, [son, video, image]);
  db.close();
}

/* ---- Le navigateur ---- */
const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
const avertissements = [];
try {
  const essayer = async (largeur, hauteur, mobile) => {
    const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-CH', serviceWorkers: 'block', ...(mobile ? { hasTouch: true, isMobile: true } : {}) });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    page.on('console', (m) => m.type() === 'error' && avertissements.push(m.text()));
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(2500);
    if (!(await page.locator('[data-lecteur-son]').count())) await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant')));
    await page.waitForSelector('[data-lecteur-son]', { timeout: 20_000 }).catch(() => {});
    return { contexte, page };
  };

  const { contexte, page } = await essayer(1440, 900, false);
  if (process.env.DIAG) { await page.screenshot({ path: '/tmp/diag-sons.png' }); console.log(await page.evaluate(() => ({ lecteurs: [...document.querySelectorAll('[data-lecteur-son]')].map((e) => e.parentElement?.outerHTML.slice(0, 160)), texte: document.body.textContent.includes('Voici la voix off') }))); }
  const filSon = page.locator(`[data-audio-fil="${son}"] [data-lecteur-son]`);
  noter('le son du fil passe par le lecteur à onde', (await filSon.count()) === 1);
  noter('aucun lecteur du navigateur visible', await page.evaluate(() => [...document.querySelectorAll('audio')].every((a) => !a.controls && getComputedStyle(a).display === 'none')));
  const decodee = await page
    .waitForFunction((id) => document.querySelector(`[data-audio-fil="${id}"] [data-lecteur-son]`)?.getAttribute('data-son-onde') === 'decodee', son, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  noter("l'onde vient du vrai fichier", decodee, await filSon.getAttribute('data-son-onde'));
  const hauteurs = await filSon.locator('[data-son-onde-zone] > span').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  const moitie = Math.floor(hauteurs.length / 2);
  noter("l'onde suit le son : silence d'abord, bip ensuite", hauteurs.length > 20 && Math.max(...hauteurs.slice(0, moitie - 2)) < Math.min(...hauteurs.slice(moitie + 2)), `${hauteurs.length} bâtons`);
  const bouton = await filSon.locator('[data-son-bascule]').boundingBox();
  const zone = await filSon.locator('[data-son-onde-zone]').boundingBox();
  noter('le bouton lecture est à gauche de l’onde', !!bouton && !!zone && bouton.x + bouton.width <= zone.x + 1);
  await filSon.locator('[data-son-bascule]').click();
  const joue = await page.waitForFunction((id) => document.querySelector(`[data-audio-fil="${id}"] [data-lecteur-son]`)?.getAttribute('data-son-etat') === 'lecture', son, { timeout: 5_000 }).then(() => true).catch(() => false);
  noter('lecture au clic', joue);
  await filSon.locator('[data-son-bascule]').click();
  await page.waitForTimeout(300);
  noter('pause au second clic', (await filSon.getAttribute('data-son-etat')) === 'pause');
  // Par le repère lui-même : le fil le ramène à l'écran s'il est passé sous l'entête.
  await filSon.locator('[data-son-onde-zone]').click({ position: { x: zone.width * 0.75, y: zone.height / 2 } });
  await page.waitForTimeout(300);
  const valeur = Number(await filSon.locator('[data-son-onde-zone]').getAttribute('aria-valuenow'));
  noter("un clic aux trois quarts de l'onde y emmène la lecture", valeur >= 1 && valeur <= 2, String(valeur));

  const bande = page.locator('[data-captures-du-flux]').first();
  noter('la bande de l’agent porte les trois médias', (await bande.getAttribute('data-captures-du-flux')) === '3', await bande.getAttribute('data-captures-du-flux'));
  noter('le son y est un lecteur', (await bande.locator(`[data-capture-media="son"] [data-lecteur-son="${son}"]`).count()) === 1);
  noter('la vidéo y a son bouton lecture au centre', (await bande.locator('[data-capture-media="video"] [data-capture-lecture]').count()) === 1);
  noter("l'image y reste une vignette", (await bande.locator('[data-capture-media="image"] img').count()) === 1);
  await bande.locator('[data-capture-media="son"] [data-son-agrandir]').click();
  noter('« agrandir » du son ouvre la visionneuse sur le lecteur en grand', await page.locator(`[data-visionneuse-son="${son}"] [data-lecteur-son]`).waitFor({ timeout: 5_000 }).then(() => true).catch(() => false));
  const largeurGrand = (await page.locator(`[data-visionneuse-son="${son}"] [data-lecteur-son]`).boundingBox())?.width ?? 0;
  noter('le lecteur en grand prend la largeur', largeurGrand > 500, String(Math.round(largeurGrand)));
  await page.locator('[data-fermer-visionneuse]').click();
  await page.waitForTimeout(400);
  await bande.locator('[data-capture-media="video"]').click();
  noter('la vidéo de la bande s’ouvre en grand sur son lecteur', await page.locator('[role="dialog"] video').first().waitFor({ timeout: 5_000 }).then(() => true).catch(() => false));
  await page.screenshot({ path: path.join(TMP, 'sons-videos-ordinateur.png') });
  await contexte.close();

  const tel = await essayer(390, 844, true);
  const lecteurTel = tel.page.locator(`[data-audio-fil="${son}"] [data-lecteur-son]`);
  const boite = await lecteurTel.boundingBox();
  noter('au téléphone, le lecteur tient dans la largeur', !!boite && boite.x >= 0 && boite.x + boite.width <= 390, JSON.stringify(boite && { x: Math.round(boite.x), l: Math.round(boite.width) }));
  await tel.contexte.close();
} finally {
  await navigateur.close();
}

const etrangers = avertissements.filter((a) => !/favicon|WebSocket|Failed to load resource/i.test(a));
noter('aucune erreur dans la console', etrangers.length === 0, etrangers.slice(0, 3).join(' | '));
console.log(`Captures : ${TMP}`);
const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérification(s) réussie(s).`);
process.exit(echecs.length ? 1 : 0);
