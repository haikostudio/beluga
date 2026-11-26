#!/usr/bin/env node
/**
 * L'ESPACE CLIENT QUI NE SE RELIE PAS — de bout en bout, dans un vrai navigateur.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL BELUGA_VERIF_PORT=7241 \
 *     CONNEXION_BLOQUEE_CAPTURES=/root/beluga/data/fichiers/essais/connexion-bloquee \
 *     node scripts/verif-espace-connexion-bloquee.mjs
 *
 * Carte « Accès client FishFlow bloqué » (26/11/2026). Le client voyait « Connexion à votre espace… » sans fin : sa
 * liaison partait mais n'aboutissait jamais. Un démon d'essai sur une base NEUVE (`demon-d-essai.mjs`, reconstruire
 * `web/dist` avant), et devant lui un PETIT RELAIS qui sert les pages normalement mais peut RETENIR la liaison `/ws`
 * sans jamais répondre — exactement la panne vue chez le client. Puis :
 *
 *   1. chemin normal : l'espace s'ouvre tout de suite, aucun délai ajouté ;
 *   2. liaison retenue : la tentative est abandonnée puis refaite (plusieurs tentatives en 30 s), l'écran « La
 *      connexion à votre espace n'aboutit pas » paraît à 30 s avec « Réessayer » et « Me déconnecter », pas avant ;
 *   3. le signalement part une fois, l'alerte « erreur » arrive aux administrateurs une seule fois ;
 *   4. « Réessayer », le relais rouvert, relie l'espace ; « Me déconnecter » ramène à la page de connexion ;
 *   5. en cours de session, une coupure qui dure fait paraître le bandeau avec les deux gestes ;
 *   6. la route refuse sans session (401), à un administrateur (403), un corps faux (400).
 *
 * Captures 1440 / 390 px, clair et sombre. Rien ne touche la base servie ; le démon part avec le script.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

for (const nom of ['BELUGA_URL', 'BELUGA_TOKEN', 'BELUGA_AGENT', 'BELUGA_TOUR']) delete process.env[nom];

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7241);
const PORT_RELAIS = PORT + 1;
const SORTIE = path.resolve(process.env.CONNEXION_BLOQUEE_CAPTURES || '/tmp/verif-connexion-bloquee');
fs.mkdirSync(SORTIE, { recursive: true });
const HOTE = 'my.test';
const RACINE_CLIENTE = `http://${HOTE}:${PORT_RELAIS}`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

const constats = [];
const echecs = [];
const noter = (nom, ok, detail = '') => {
  (ok ? constats : echecs).push(`${ok ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, PROJETS, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-connexion-bloquee-',
  port: PORT,
  depot: false,
  signaux: true,
});
if (!(await attendrePort(90_000))) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join('').slice(-3000));
  process.exit(1);
}
const base = () => new Database(path.join(DATA, 'beluga.db'));

/* ------------------------------------------------------------------ */
/* Le relais : pages servies, liaison retenue à la demande             */
/* ------------------------------------------------------------------ */

let retenir = false;
let tentatives = 0;
/* Les signalements vus PASSER : un envoi `keepalive` n'est pas montré par les événements de page de Playwright. */
const signalements = [];
const liaisonsOuvertes = new Set();
const relais = http.createServer((req, res) => {
  const amont = http.request({ host: '127.0.0.1', port: PORT, path: req.url, method: req.method, headers: req.headers }, (r) => {
    if (req.url === '/api/espace/blocage') signalements.push({ statut: r.statusCode, mobile: /Mobile/.test(String(req.headers['user-agent'])) });
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  amont.on('error', () => res.destroy());
  req.pipe(amont);
});
relais.on('upgrade', (req, socket, tete) => {
  tentatives += 1;
  socket.on('error', () => {});
  /* RETENUE : la demande d'ouverture arrive, rien ne lui répond jamais — le navigateur reste « en cours ». */
  if (retenir) return;
  const amont = net.connect(PORT, '127.0.0.1', () => {
    let entete = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) entete += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    amont.write(entete + '\r\n');
    if (tete?.length) amont.write(tete);
    socket.pipe(amont).pipe(socket);
  });
  amont.on('error', () => socket.destroy());
  const paire = { socket, amont };
  liaisonsOuvertes.add(paire);
  socket.on('close', () => {
    liaisonsOuvertes.delete(paire);
    amont.destroy();
  });
});
await new Promise((r) => relais.listen(PORT_RELAIS, '127.0.0.1', r));
const couperLesLiaisons = () => {
  for (const { socket, amont } of liaisonsOuvertes) {
    socket.destroy();
    amont.destroy();
  }
  liaisonsOuvertes.clear();
};

/* ------------------------------------------------------------------ */
/* Le décor                                                            */
/* ------------------------------------------------------------------ */

const P1 = 'p-fishflow-essai';
const jetonAdmin = crypto.randomBytes(24).toString('hex');
{
  const db = base();
  const maintenant = Date.now();
  const dossier = path.join(PROJETS, P1);
  fs.mkdirSync(dossier, { recursive: true });
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
    P1,
    'Poissonnerie Essai',
    dossier,
    0,
    JSON.stringify({ id: P1, name: 'Poissonnerie Essai', path: dossier, archived: false, createdAt: maintenant, updatedAt: maintenant }),
    maintenant,
    maintenant,
  );
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?,?,?,?,?)').run(
    sha(jetonAdmin),
    maintenant,
    maintenant + 3_600_000,
    'verif connexion bloquée',
    admin.id,
  );
  db.close();
}

function ouvrirCanal(jeton) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie: `beluga_session=${jeton}` } });
    const attentes = new Map();
    const evenements = [];
    socket.on('message', (brut) => {
      const event = JSON.parse(brut.toString());
      evenements.push(event);
      if (event.type === 'ack' && attentes.has(event.id)) {
        const suite = attentes.get(event.id);
        attentes.delete(event.id);
        suite(event);
      }
    });
    socket.on('open', () =>
      resolve({
        evenements,
        fermer: () => socket.close(),
        demander: (cmd, delaiMs = 15_000) =>
          new Promise((resoudre, refuser) => {
            const id = crypto.randomBytes(6).toString('hex');
            const minuteur = setTimeout(() => refuser(new Error(`${cmd.type} : sans réponse`)), delaiMs);
            attentes.set(id, (event) => {
              clearTimeout(minuteur);
              if (event.ok === false) refuser(new Error(`${cmd.type} : ${event.error ?? 'refusée'}`));
              else resoudre(event.data ?? {});
            });
            socket.send(JSON.stringify({ id, cmd }));
          }),
      }),
    );
    socket.on('error', reject);
  });
}

const haiko = await ouvrirCanal(jetonAdmin);
await pause(500);
const cree = await haiko.demander({ type: 'comptes.creer', identifiant: 'client-essai', nomAffiche: 'Jean Essai', projets: [P1] });
const CLIENT = cree.compte.id;
const sessionClient = () => {
  const jeton = crypto.randomBytes(24).toString('hex');
  const db = base();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?,?,?,?,?)').run(
    sha(jeton),
    Date.now(),
    Date.now() + 3_600_000,
    'verif connexion bloquée',
    CLIENT,
  );
  db.close();
  return jeton;
};
const jetonClient = sessionClient();
const client = await ouvrirCanal(jetonClient);
await pause(300);
await client.demander({ type: 'espace.demande.creer', projectId: P1, titre: 'Ajouter les horaires de Noël', description: 'Du 20 au 31 décembre.' }).catch(
  () => haiko.demander({ type: 'espace.demande.creer', projectId: P1, titre: 'Ajouter les horaires de Noël', description: 'Du 20 au 31 décembre.' }),
);
const alertesDeBlocage = () => haiko.evenements.filter((e) => e.type === 'notify' && e.motif === 'espace-connexion-bloquee');

/* ------------------------------------------------------------------ */
/* Le navigateur                                                       */
/* ------------------------------------------------------------------ */

const navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', `--host-resolver-rules=MAP ${HOTE} 127.0.0.1`],
});
const erreursDePage = [];
const ORDI = { viewport: { width: 1440, height: 900 } };
const TEL = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

async function pageClient(tenue, clarte, jeton = jetonClient) {
  const contexte = await navigateur.newContext({ ...tenue, locale: 'fr-CH', colorScheme: clarte === 'sombre' ? 'dark' : 'light', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, domain: HOTE, path: '/' }]);
  const page = await contexte.newPage();
  page.on('pageerror', (e) => erreursDePage.push(String(e)));
  return { contexte, page };
}

/* 1. Le chemin normal reste immédiat. */
{
  const { contexte, page } = await pageClient(ORDI, 'clair');
  const debut = Date.now();
  await page.goto(`${RACINE_CLIENTE}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const ouvert = await page.waitForSelector('[data-porte-client="ouverte"]', { timeout: 15_000 }).then(() => true).catch(() => false);
  const duree = Date.now() - debut;
  noter('chemin normal : l’espace s’ouvre tout de suite', ouvert && duree < 8_000, `${duree} ms`);
  await contexte.close();
}

/* 2 à 4. La liaison retenue, dans les deux clartés, ordinateur et téléphone EN MÊME TEMPS. */
for (const clarte of ['clair', 'sombre']) {
  await client.demander({ type: 'espace.moi.apparence', apparence: clarte });
  retenir = true;
  tentatives = 0;
  const pages = [];
  for (const [nom, tenue] of [
    ['1440', ORDI],
    ['390', TEL],
  ]) {
    const { contexte, page } = await pageClient(tenue, clarte);
    pages.push({ nom, contexte, page });
  }
  signalements.length = 0;
  const debut = Date.now();
  await Promise.all(pages.map(({ page }) => page.goto(`${RACINE_CLIENTE}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })));
  await pause(Math.max(0, 25_000 - (Date.now() - debut)));
  for (const { nom, page } of pages) {
    noter(`${clarte} ${nom} : à 25 s, toujours « Connexion à votre espace… »`, (await page.locator('[data-porte-client="connexion"]').count()) === 1);
  }
  for (const { nom, page } of pages) {
    const bloque = await page.waitForSelector('[data-porte-client="bloquee"]', { timeout: 15_000 }).then(() => true).catch(() => false);
    noter(`${clarte} ${nom} : l’écran « n’aboutit pas » paraît vers 30 s`, bloque, `${Date.now() - debut} ms`);
    noter(
      `${clarte} ${nom} : « Réessayer » et « Me déconnecter » sont là`,
      (await page.locator('[data-reessayer-connexion]').count()) === 1 && (await page.locator('[data-deconnexion-bloquee]').count()) === 1,
    );
    const deborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    noter(`${clarte} ${nom} : rien ne déborde en largeur`, deborde <= 0, `${deborde} px`);
    const hauteurs = await page.evaluate(() =>
      [...document.querySelectorAll('[data-reessayer-connexion],[data-deconnexion-bloquee]')].map((b) => Math.round(b.getBoundingClientRect().height)),
    );
    noter(`${clarte} ${nom} : les deux boutons ont la même hauteur`, hauteurs.length === 2 && hauteurs[0] === hauteurs[1], hauteurs.join(' / '));
    await page.waitForTimeout(1_500);
    const lesSiens = signalements.filter((s) => s.mobile === (nom === '390'));
    noter(`${clarte} ${nom} : le signalement est parti une fois et a été accepté`, lesSiens.length === 1 && lesSiens[0].statut === 200, JSON.stringify(lesSiens));
    await page.screenshot({ path: path.join(SORTIE, `client-bloque-${clarte}-${nom}.png`) });
  }
  noter(`${clarte} : la liaison retenue est abandonnée puis refaite`, tentatives >= 4, `${tentatives} tentatives pour 2 pages en ~32 s`);
  if (clarte === 'clair') {
    await pause(4_500); // la fenêtre de regroupement des alertes (4 s)
    noter('une seule alerte de blocage pour l’équipe, malgré deux écrans bloqués', alertesDeBlocage().length === 1, `${alertesDeBlocage().length}`);
    const alerte = alertesDeBlocage()[0];
    noter(
      'l’alerte nomme le client, son projet et son navigateur, et mène à sa fiche',
      !!alerte && alerte.body.includes('Jean Essai') && alerte.body.includes('Poissonnerie Essai') && /(Chrome sur Linux|Safari sur iOS)/.test(alerte.body) && alerte.url === `/#espace/${CLIENT}`,
      alerte ? `${alerte.title} — ${alerte.body} → ${alerte.url}` : 'aucune',
    );
  }

  /* 4. « Réessayer », le relais rouvert : l'espace se relie. */
  retenir = false;
  const [ordi, tel] = pages;
  const debutReessai = Date.now();
  await ordi.page.click('[data-reessayer-connexion]');
  const relie = await ordi.page.waitForSelector('[data-porte-client="ouverte"]', { timeout: 10_000 }).then(() => true).catch(() => false);
  noter(`${clarte} 1440 : « Réessayer » relie l’espace une fois la liaison rendue`, relie, `${Date.now() - debutReessai} ms`);

  /* « Me déconnecter » : une session à part, puisque la déconnexion l'efface pour de bon. */
  if (clarte === 'clair') {
    await tel.contexte.close();
    const jetonJetable = sessionClient();
    retenir = true;
    const { contexte, page } = await pageClient(TEL, clarte, jetonJetable);
    await page.goto(`${RACINE_CLIENTE}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('[data-porte-client="bloquee"]', { timeout: 45_000 });
    await page.click('[data-deconnexion-bloquee]');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1_500);
    const cookie = (await contexte.cookies()).find((c) => c.name === 'beluga_session');
    const formulaire = (await page.locator('input[type="password"]').count()) > 0;
    noter('« Me déconnecter » efface la session et ramène à la page de connexion', !cookie?.value && formulaire && new URL(page.url()).pathname === '/', page.url());
    const db = base();
    const reste = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token = ?').get(sha(jetonJetable)).n;
    db.close();
    noter('la session déconnectée n’existe plus en base', reste === 0);
    await page.screenshot({ path: path.join(SORTIE, `client-apres-deconnexion-${clarte}-390.png`) });
    await contexte.close();
    retenir = false;
  } else {
    await tel.contexte.close();
  }

  /* 5. En cours de session : la liaison tombe et ne revient pas → le bandeau prend les deux gestes. */
  if (relie) {
    retenir = true;
    couperLesLiaisons();
    const debutCoupure = Date.now();
    const bandeau = await ordi.page.waitForSelector('[data-bandeau-canal="bloque"]', { timeout: 45_000 }).then(() => true).catch(() => false);
    noter(`${clarte} 1440 : coupure durable en session → bandeau avec « Réessayer » et « Me déconnecter »`, bandeau, `${Date.now() - debutCoupure} ms`);
    noter(`${clarte} 1440 : le bandeau ne paraît pas avant 30 s`, Date.now() - debutCoupure >= 29_000);
    await ordi.page.screenshot({ path: path.join(SORTIE, `client-bandeau-${clarte}-1440.png`) });
    retenir = false;
    await ordi.page.click('[data-bandeau-canal="bloque"] [data-reessayer-connexion]');
    const revenu = await ordi.page.waitForSelector('[data-bandeau-canal="bloque"]', { state: 'detached', timeout: 10_000 }).then(() => true).catch(() => false);
    noter(`${clarte} 1440 : « Réessayer » du bandeau rend la liaison`, revenu);
  }
  await ordi.contexte.close();
}

/* 6. La route elle-même. */
function poster(cookie, corps) {
  return new Promise((resolve) => {
    const r = http.request(
      { host: '127.0.0.1', port: PORT, path: '/api/espace/blocage', method: 'POST', headers: { host: `${HOTE}:${PORT}`, 'content-type': 'application/json', ...(cookie ? { cookie: `beluga_session=${cookie}` } : {}) } },
      (res) => {
        let texte = '';
        res.on('data', (d) => (texte += d));
        res.on('end', () => resolve({ statut: res.statusCode, corps: texte }));
      },
    );
    r.end(corps);
  });
}
const bon = JSON.stringify({ etape: 'connexion', dureeMs: 30_500, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/131' });
noter('sans session : 401', (await poster(null, bon)).statut === 401);
const avantAdmin = alertesDeBlocage().length;
noter('un administrateur : 403', (await poster(jetonAdmin, bon)).statut === 403);
noter('un corps faux : 400', (await poster(jetonClient, JSON.stringify({ etape: 'autre' }))).statut === 400);
noter('un corps trop lourd : 400', (await poster(jetonClient, JSON.stringify({ etape: 'connexion', dureeMs: 1, userAgent: 'x'.repeat(10_000) }))).statut === 400);
const encore = await poster(jetonClient, bon);
noter('dans l’heure, le même compte ne relance pas d’alerte', encore.statut === 200 && JSON.parse(encore.corps).alerte === false, encore.corps);
await pause(4_500);
noter('aucune alerte de plus après les refus', alertesDeBlocage().length === avantAdmin, `${alertesDeBlocage().length}`);
noter('le journal du démon garde chaque signalement', journal.join('').includes('liaison bloquée pour client-essai'));

noter('aucune erreur de page', erreursDePage.length === 0, erreursDePage.slice(0, 3).join(' | '));

await navigateur.close();
haiko.fermer();
client.fermer();
relais.close();
console.log(`\n${constats.length} contrôles réussis, ${echecs.length} en échec. Captures : ${SORTIE}`);
if (echecs.length) {
  console.log(echecs.join('\n'));
  process.exitCode = 1;
}
process.exit();
