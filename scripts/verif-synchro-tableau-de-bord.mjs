#!/usr/bin/env node
/**
 * LES TABLEAUX SE REMETTENT À JOUR AU RÉVEIL D'UN ÉCRAN : TABLEAU DE BORD ET PROJET.
 *
 * Demande du 16/10/2026 : « j'avais bossé sur mon téléphone, je suis revenu sur
 * l'ordinateur, aucune synchronisation, j'ai dû rafraîchir la page ». Un écran
 * caché plus de cinq secondes ferme son canal (la veille, `shared/src/veille-ecran.ts`) ;
 * à son retour, `ready` rend l'état complet — mais seul le projet AFFICHÉ était
 * relu. Les trois colonnes de la page « Tableaux de bord » (Actifs, Terminer,
 * Archiver) gardaient ce qu'elles avaient lu à l'ouverture de la page.
 *
 * Ce contrôle rejoue ça dans un vrai navigateur, sur son PROPRE démon (base
 * neuve, port à soi, aucun quota) :
 *
 *   1. l'écran est sur la page « Tableaux de bord » (ou sur un projet) ;
 *   2. la page se cache plus longtemps que le délai de veille : le canal se ferme ;
 *   3. pendant ce temps, un autre client renomme des cartes dans DEUX projets,
 *      en crée une et en supprime une ;
 *   4. la page revient — on mesure le délai avant que TOUT soit à jour.
 *
 * Exigence : en moins de `DELAI_EXIGE_MS`, sur un iPhone émulé (WebKit) et un
 * Android émulé (Chrome). Avant la correction, la page « Tableaux de bord »
 * restait sur l'ancien état.
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-synchro-tableau-de-bord.mjs
 *   node scripts/verif-synchro-tableau-de-bord.mjs --appareil android   # un seul appareil
 *
 * Pour comparer à une autre version de l'interface : BELUGA_SYNCHRO_WEB=/…/web/dist.
 */
import { chromium, webkit, devices } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_SYNCHRO_PORT || 7234);
const BASE = `http://127.0.0.1:${PORT}`;
const DELAI_EXIGE_MS = 6_000;
/** La page reste cachée bien au-delà du délai de veille (5 s). */
const SOMMEIL_MS = 8_000;

const choix = (() => {
  const i = process.argv.indexOf('--appareil');
  return i === -1 ? null : process.argv[i + 1];
})();

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-synchro-',
  port: PORT,
  signaux: true,
  env: process.env.BELUGA_SYNCHRO_WEB ? { BELUGA_WEB: process.env.BELUGA_SYNCHRO_WEB } : {},
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_A = 'p-synchro-a';
const PROJET_B = 'p-synchro-b';

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

/** Les cartes d'un scénario : son identifiant sert aussi de suffixe aux titres. */
function cartesDe(cle) {
  return {
    enA: { id: `c-${cle}-a`, projet: PROJET_A, colonne: 'planned', avant: `Alpha ${cle} avant`, apres: `Alpha ${cle} après` },
    enB: { id: `c-${cle}-b`, projet: PROJET_B, colonne: 'planned', avant: `Bravo ${cle} avant`, apres: `Bravo ${cle} après` },
    finie: { id: `c-${cle}-t`, projet: PROJET_A, colonne: 'to_deploy', avant: `Terminée ${cle} avant`, apres: `Terminée ${cle} après` },
    nouvelleA: { titre: `Nouvelle A ${cle}`, projet: PROJET_A },
    nouvelleB: { titre: `Nouvelle B ${cle}`, projet: PROJET_B },
  };
}

const SCENARIOS = ['iphone-tableau-de-bord', 'iphone-projet', 'android-tableau-de-bord', 'android-projet'];

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton), t, t + 3_600_000, 'contrôle de la synchro des tableaux',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  [[PROJET_A, 'Projet Alpha', 1], [PROJET_B, 'Projet Bravo', 2]].forEach(([id, name, rank]) => {
    const projet = { id, name, path: DEPOT, defaultEngine: 'claude', isSelf: false, rank, archived: false, createdAt: t, updatedAt: t };
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run(id, name, DEPOT, JSON.stringify(projet), t, t);
  });
  let position = 0;
  for (const cle of SCENARIOS) {
    for (const carte of [cartesDe(cle).enA, cartesDe(cle).enB, cartesDe(cle).finie]) {
      db.prepare(
        `INSERT INTO cards (id, project_id, column_key, position, title, description, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'Carte du contrôle.', '{}', ?, ?)`,
      ).run(carte.id, carte.projet, carte.colonne, (position += 1), carte.avant, t, t);
    }
  }
  db.close();
}

/** Un autre client (le téléphone) : une commande envoyée au démon par sa propre liaison. */
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

async function scenario({ nom, type, appareil, cle, ecran }) {
  const cartes = cartesDe(cle);
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
    await page.clock.install();

    const canal = { ouvertures: 0, fermetures: 0, envoyes: [], recus: [] };
    await page.routeWebSocket(/\/ws$/, (ws) => {
      canal.ouvertures += 1;
      const serveur = ws.connectToServer();
      ws.onMessage((message) => {
        canal.envoyes.push(String(message));
        serveur.send(message);
      });
      serveur.onMessage((message) => {
        canal.recus.push(String(message));
        ws.send(message);
      });
      ws.onClose(() => {
        canal.fermetures += 1;
        serveur.close();
      });
    });

    // 1. L'écran est sur la page « Tableaux de bord » ou sur le projet Alpha.
    const adresse = ecran === 'projet' ? `#projet/${PROJET_A}` : '#en-route';
    await page.goto(`${BASE}/${adresse}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const vus = ecran === 'projet' ? [cartes.enA.avant, cartes.finie.avant] : [cartes.enA.avant, cartes.enB.avant, cartes.finie.avant];
    try {
      for (const titre of vus) await page.getByText(titre).first().waitFor({ timeout: 30_000 });
    } catch (err) {
      await page.screenshot({ path: `/tmp/verif-synchro-depart-${cle}.png` }).catch(() => {});
      throw err;
    }
    await page.waitForTimeout(2_000);
    if (ecran === 'projet') {
      // Le projet Bravo est consulté puis quitté : ses cartes restent en mémoire (quinze minutes).
      await page.evaluate((id) => { location.hash = `#projet/${id}`; }, PROJET_B);
      await page.getByText(cartes.enB.avant).first().waitFor({ timeout: 30_000 });
      await page.evaluate((id) => { location.hash = `#projet/${id}`; }, PROJET_A);
      await page.getByText(cartes.enA.avant).first().waitFor({ timeout: 30_000 });
    }
    noter(`${nom} : l'écran affiche l'état de départ`, true);

    // 2. La page se cache plus longtemps que le délai de veille.
    await page.evaluate(() => {
      window.__cachee = false;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__cachee ? 'hidden' : 'visible') });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__cachee });
      window.__cachee = true;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(SOMMEIL_MS);
    await page.waitForTimeout(500);
    noter(`${nom} : l'écran caché a fermé son canal (veille)`, canal.fermetures >= 1, `${canal.fermetures} fermeture(s)`);

    // 3. L'autre client bouge des cartes dans deux projets.
    await appelDemon({ type: 'card.update', id: cartes.enA.id, patch: { title: cartes.enA.apres } });
    await appelDemon({ type: 'card.update', id: cartes.finie.id, patch: { title: cartes.finie.apres } });
    await appelDemon({ type: 'card.create', projectId: cartes.nouvelleA.projet, title: cartes.nouvelleA.titre });
    await appelDemon({ type: 'card.create', projectId: cartes.nouvelleB.projet, title: cartes.nouvelleB.titre });
    if (ecran === 'projet') await appelDemon({ type: 'card.update', id: cartes.enB.id, patch: { title: cartes.enB.apres } });
    else await appelDemon({ type: 'card.delete', id: cartes.enB.id });

    // 4. Le retour : on mesure le délai avant que tout soit à jour.
    const ouverturesAvant = canal.ouvertures;
    const retourA = Date.now();
    await page.evaluate(() => {
      window.__cachee = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const attendus = ecran === 'projet'
      ? [cartes.enA.apres, cartes.finie.apres, cartes.nouvelleA.titre]
      : [cartes.enA.apres, cartes.finie.apres, cartes.nouvelleA.titre, cartes.nouvelleB.titre];
    const delais = {};
    await Promise.all(
      attendus.map(async (titre) => {
        try {
          await page.getByText(titre).first().waitFor({ timeout: 20_000 });
          delais[titre] = Date.now() - retourA;
        } catch {
          delais[titre] = null;
        }
      }),
    );
    for (const titre of attendus) {
      noter(
        `${nom} : « ${titre} » est à jour au retour`,
        delais[titre] != null && delais[titre] <= DELAI_EXIGE_MS,
        delais[titre] == null ? 'jamais en 20 s' : `${(delais[titre] / 1000).toFixed(1)} s (exigé : ${DELAI_EXIGE_MS / 1000} s)`,
      );
    }
    if (ecran === 'tableau-de-bord') {
      // La carte supprimée ne doit plus rester sur la page.
      await page.waitForTimeout(500);
      noter(`${nom} : la carte supprimée a disparu de la page`, (await page.getByText(cartes.enB.avant).count()) === 0);
      noter(`${nom} : les anciens titres ont disparu`, (await page.getByText(cartes.enA.avant).count()) === 0);
    }
    if (ecran === 'projet') {
      // Le projet Bravo, gardé en mémoire mais pas affiché, est relu lui aussi, par une réponse pour cet écran seul.
      const demande = canal.envoyes.some((m) => m.includes('"projects.relire"') && m.includes(PROJET_B));
      const reponse = canal.recus.some((m) => m.includes(cartes.enB.apres));
      noter(`${nom} : le projet gardé en mémoire est relu au retour`, demande && reponse, `demande ${demande ? 'partie' : 'absente'}, réponse ${reponse ? 'reçue' : 'absente'}`);
    }
    noter(`${nom} : le canal a été refait`, canal.ouvertures > ouverturesAvant, `${canal.ouvertures - ouverturesAvant} ouverture(s) au retour`);
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
  console.log('\nSynchronisation des tableaux au retour d’une veille\n');
  const appareils = [
    { cle: 'iphone', court: 'iphone', nom: 'iPhone (WebKit)', type: 'webkit', appareil: 'iPhone 13' },
    { cle: 'android', court: 'android', nom: 'Android (Chrome)', type: 'chromium', appareil: 'Pixel 7' },
  ].filter((a) => !choix || a.cle === choix);
  for (const a of appareils) {
    for (const ecran of ['tableau-de-bord', 'projet']) {
      await scenario({ nom: `${a.nom}, ${ecran === 'projet' ? 'projet' : 'tableau de bord'}`, type: a.type, appareil: a.appareil, cle: `${a.court}-${ecran}`, ecran });
    }
  }
  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles réussis`);
  process.exit(echecs ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
