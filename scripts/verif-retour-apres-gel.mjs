#!/usr/bin/env node
/**
 * LE TABLEAU SE REMET À JOUR AU RETOUR D'UN GEL SILENCIEUX DU TÉLÉPHONE.
 *
 * Demande du 14/10/2026 : l'application ouverte sur l'iPhone, le téléphone se
 * verrouille, on travaille sur l'ordinateur, on revient — le tableau ne bouge
 * plus, il faut fermer l'application. Le système gèle la page SANS toujours
 * prévenir (`visibilitychange`, `pagehide`, `freeze`) et coupe la route de son
 * canal sans le fermer : au retour, la page croit n'être jamais partie.
 *
 * Ce contrôle rejoue exactement ça, dans un vrai navigateur, sur son PROPRE
 * démon (base neuve, port à soi, aucun quota) :
 *
 *   1. le tableau est affiché, une carte « Avant le gel » ;
 *   2. le canal de la page devient MUET dans les deux sens, sans se fermer
 *      (la route morte d'un téléphone qui dort) ;
 *   3. les minuteries de la page s'arrêtent net (horloge factice en pause),
 *      AUCUN événement de visibilité n'est émis ;
 *   4. pendant ce temps, un autre client (l'ordinateur) renomme la carte ;
 *   5. le temps saute de vingt secondes et la page reprend — on mesure le délai
 *      avant que le tableau montre « Après le gel ».
 *
 * Deux appareils : un iPhone émulé dans WebKit, un Android émulé dans Chrome.
 * Exigence : le tableau à jour en moins de `DELAI_EXIGE_MS`. Avant correction,
 * il fallait attendre que le battement déclare le canal muet (~40 s).
 *
 *   npm run build && node scripts/verif-retour-apres-gel.mjs
 *   node scripts/verif-retour-apres-gel.mjs --appareil android   # un seul appareil
 *
 * Pour comparer à une autre version de l'interface : BELUGA_GEL_WEB=/…/web/dist.
 */
import { chromium, webkit, devices } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_GEL_PORT || 7233);
const BASE = `http://127.0.0.1:${PORT}`;
const DELAI_EXIGE_MS = 6_000;
/** La durée du gel, en temps de la page : bien au-delà du seuil de détection. */
const GEL_MS = 20_000;

const choix = (() => {
  const i = process.argv.indexOf('--appareil');
  return i === -1 ? null : process.argv[i + 1];
})();

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-retour-apres-gel-',
  port: PORT,
  signaux: true,
  env: process.env.BELUGA_GEL_WEB ? { BELUGA_WEB: process.env.BELUGA_GEL_WEB } : {},
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET = 'p-gel';
const CARTE = 'c-gel';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

async function attendreLaBase(limiteMs = 30_000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
      const pret = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cards'").get();
      db.close();
      if (pret) return true;
    } catch {
      /* la base n'existe pas encore */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton), t, t + 3_600_000, 'contrôle du retour après gel',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  const projet = { id: PROJET, name: 'Projet du téléphone', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: t, updatedAt: t };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(PROJET, projet.name, DEPOT, JSON.stringify(projet), t, t);
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, description, data, created_at, updated_at)
     VALUES (?, ?, 'planned', 0, ?, 'Carte du contrôle.', '{}', ?, ?)`,
  ).run(CARTE, PROJET, 'Avant le gel', t, t);
  db.close();
}

/** L'ordinateur : une commande envoyée au démon par sa propre liaison. */
function appelDemon(commande) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie: `beluga_session=${jeton}` } });
    const id = crypto.randomUUID();
    const minuteur = setTimeout(() => {
      socket.close();
      reject(new Error('le démon ne répond pas'));
    }, 20_000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id, cmd: commande })));
    socket.addEventListener('message', (evenement) => {
      const message = JSON.parse(String(evenement.data));
      if (message.id !== id) return;
      clearTimeout(minuteur);
      socket.close();
      if (message.error) reject(new Error(message.error));
      else resolve(message.result ?? {});
    });
    socket.addEventListener('error', (err) => {
      clearTimeout(minuteur);
      reject(err);
    });
  });
}

async function scenario({ nom, type, appareil, titreAvant, titreApres }) {
  let navigateur;
  try {
    navigateur =
      type === 'webkit'
        ? await webkit.launch()
        : await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  } catch (err) {
    noter(`${nom} : navigateur lancé`, false, String(err?.message ?? err).split('\n')[0]);
    return;
  }
  try {
    const contexte = await navigateur.newContext({ ...devices[appareil], locale: 'fr-CH', serviceWorkers: 'block' });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));

    /* L'HORLOGE DE LA PAGE, TENUE PAR LE SCRIPT : elle s'écoule normalement,
       puis s'arrête net (le gel), puis saute (le réveil). */
    await page.clock.install();

    /* LE CANAL DE LA PAGE, TENU PAR LE SCRIPT : un canal « muet » ne transmet
       plus rien dans aucun sens, et ne se ferme pas — une route morte. */
    const canal = { ouvertures: 0, courant: null, muets: new Set() };
    await page.routeWebSocket(/\/ws$/, (ws) => {
      canal.ouvertures += 1;
      canal.courant = ws;
      const serveur = ws.connectToServer();
      ws.onMessage((message) => {
        if (!canal.muets.has(ws)) serveur.send(message);
      });
      serveur.onMessage((message) => {
        if (!canal.muets.has(ws)) ws.send(message);
      });
      ws.onClose(() => serveur.close());
    });

    await page.goto(`${BASE}/#projet/${PROJET}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    try {
      await page.getByText(titreAvant).first().waitFor({ timeout: 30_000 });
    } catch (err) {
      await page.screenshot({ path: '/tmp/verif-gel-depart.png' }).catch(() => {});
      throw err;
    }
    await page.waitForTimeout(3_000);
    noter(`${nom} : le tableau s'affiche`, true);

    // 2. La route meurt, 3. la page gèle — sans le moindre événement de visibilité.
    const ouverturesAvant = canal.ouvertures;
    canal.muets.add(canal.courant);
    const heureDeLaPage = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(heureDeLaPage + 200);

    // 4. L'ordinateur renomme la carte pendant le gel.
    await appelDemon({ type: 'card.update', id: CARTE, patch: { title: titreApres } });
    await new Promise((r) => setTimeout(r, 1_000));

    // 5. Le réveil : le temps saute, les minuteries reprennent.
    const reveilA = Date.now();
    await page.clock.fastForward(GEL_MS);
    await page.clock.resume();
    let delai = null;
    try {
      await page.getByText(titreApres).first().waitFor({ timeout: 45_000 });
      delai = Date.now() - reveilA;
    } catch {
      delai = null;
    }
    noter(
      `${nom} : le tableau est à jour au retour, sans fermer l'application`,
      delai != null && delai <= DELAI_EXIGE_MS,
      delai == null ? 'jamais en 45 s' : `${(delai / 1000).toFixed(1)} s (exigé : ${DELAI_EXIGE_MS / 1000} s)`,
    );
    noter(`${nom} : le canal a été refait`, canal.ouvertures > ouverturesAvant, `${canal.ouvertures - ouverturesAvant} ouverture(s) au réveil`);
    const alerte = await page.getByText(/serveur ne répond pas/i).count();
    noter(`${nom} : aucune phrase « le serveur ne répond pas » au réveil`, alerte === 0);
    noter(`${nom} : aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await navigateur.close();
  }
}

async function main() {
  if (!(await attendrePort()) || !(await attendreLaBase())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  console.log('\nRetour après un gel silencieux du téléphone\n');
  const appareils = [
    { cle: 'iphone', nom: 'iPhone (WebKit)', type: 'webkit', appareil: 'iPhone 13' },
    { cle: 'android', nom: 'Android (Chrome)', type: 'chromium', appareil: 'Pixel 7' },
  ].filter((a) => !choix || a.cle === choix);
  let rang = 0;
  for (const appareil of appareils) {
    // Chaque appareil part d'un titre connu : le précédent a renommé la carte.
    const titreAvant = rang === 0 ? 'Avant le gel' : `Après le gel ${rang}`;
    rang += 1;
    await scenario({ ...appareil, titreAvant, titreApres: `Après le gel ${rang}` });
  }
  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles réussis`);
  process.exit(echecs ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
