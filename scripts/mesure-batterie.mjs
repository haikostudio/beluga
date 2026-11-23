#!/usr/bin/env node
/**
 * MESURE DE BATTERIE — combien l'écran TRAVAILLE quand on ne lui demande rien.
 *
 * Mesuré dans un VRAI navigateur, sur son PROPRE démon (base neuve, port à soi,
 * plafond d'agents à zéro : le démon de production n'est pas touché, aucun
 * quota dépensé). Trois temps, de DUREE secondes chacun :
 *
 *   1. AU REPOS — le tableau affiché, aucun agent ne parle : ce qui reste,
 *      ce sont les minuteries et les relevés que l'écran lance tout seul ;
 *   2. EN RAFALE — un agent d'un AUTRE projet écrit sa réponse (CADENCE
 *      événements par seconde, injectés dans le canal de la page) : ce que
 *      coûte à l'écran un travail qu'il n'affiche même pas ;
 *   3. CACHÉ — la page passe hors de l'écran (onglet caché, téléphone
 *      verrouillé) : le canal doit se fermer, les minuteries se taire, et le
 *      retour doit tout rouvrir sans phrase d'alerte.
 *
 * Les chiffres viennent du navigateur lui-même (`Performance.getMetrics` :
 * temps de tâche, de script, recalculs de style et mises en page) et d'un
 * compteur posé sur `setInterval` / `setTimeout`. Ce serveur rend SANS carte
 * graphique : on compare DEUX VERSIONS entre elles, jamais une valeur absolue.
 *
 *   npm run build && node scripts/mesure-batterie.mjs
 *   node scripts/mesure-batterie.mjs --duree 10 --cadence 30
 *   node scripts/mesure-batterie.mjs --controle     # échoue si la veille ne tient pas
 *
 * Sans `--controle`, le script AFFICHE et rend 0 : il sert à comparer un avant
 * et un après. Avec, les lignes « veille » deviennent des contrôles.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_BATTERIE_PORT || 7231);
const BASE = `http://127.0.0.1:${PORT}`;

const lire = (nom, defaut) => {
  const i = process.argv.indexOf(nom);
  return i === -1 ? defaut : Number(process.argv[i + 1]);
};
const DUREE = lire('--duree', 10);
const CADENCE = lire('--cadence', 30);
const CARTES = lire('--cartes', 60);
const CONTROLE = process.argv.includes('--controle');
/**
 * LE TÉMOIN : la même rafale, mais d'un type que l'écran ne connaît pas. Ce
 * qu'elle coûte est le prix du TRANSPORT (lecture du message, tuyau de mesure) ;
 * la différence avec la vraie rafale est ce que l'écran fait de l'événement.
 */
const TEMOIN = process.argv.includes('--temoin');
/** Le délai de mise en veille (`DELAI_AVANT_VEILLE_MS`, `shared`) plus une marge. */
const ATTENTE_VEILLE_MS = 8_000;

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'mesure-batterie-',
  port: PORT,
  signaux: true,
  // Pour comparer deux versions de l'interface sur le MÊME démon : le dossier
  // construit d'une autre copie du dépôt (`BELUGA_BATTERIE_WEB=/…/web/dist`).
  env: process.env.BELUGA_BATTERIE_WEB ? { BELUGA_WEB: process.env.BELUGA_BATTERIE_WEB } : {},
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_VU = 'p-batterie-vu';
const PROJET_AILLEURS = 'p-batterie-ailleurs';
const AGENT_AILLEURS = 'a-batterie-ailleurs';

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
    sha(jeton), t, t + 3_600_000, 'mesure de batterie',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  const poserProjet = db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  );
  for (const [rang, [id, name]] of [[PROJET_VU, 'Projet regardé'], [PROJET_AILLEURS, 'Projet ailleurs']].entries()) {
    const projet = { id, name, path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: rang + 1, archived: false, createdAt: t, updatedAt: t };
    poserProjet.run(id, name, DEPOT, JSON.stringify(projet), t, t);
  }
  const poserCarte = db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, description, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const colonnes = ['planned', 'running', 'to_deploy', 'archived'];
  db.transaction(() => {
    for (let i = 0; i < CARTES; i += 1) {
      poserCarte.run(`c-batterie-${i}`, PROJET_VU, colonnes[i % colonnes.length], i, `Carte ${i}`, 'Carte de mesure.', '{}', t, t);
    }
  })();
  db.close();
}

/** Les compteurs du navigateur, relus par CDP : des cumuls depuis l'ouverture. */
async function compteurs(cdp, page) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const lu = Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  const minuteries = await page.evaluate(() => ({
    ...window.__mesureBatterie,
    // Les animations qui tournent réellement, à cet instant (CSS et autres).
    animations: document.getAnimations().filter((a) => a.playState === 'running').length,
  }));
  return {
    tache: lu.TaskDuration,
    script: lu.ScriptDuration,
    styles: lu.RecalcStyleCount,
    misesEnPage: lu.LayoutCount,
    battementsIntervalle: minuteries.battementsIntervalle,
    battementsMinuteur: minuteries.battementsMinuteur,
    intervallesVivants: minuteries.vivants,
    redessins: minuteries.redessins,
    animations: minuteries.animations,
  };
}

/** Un temps de mesure : ce qui s'est passé pendant `pendant()`, ramené à la seconde. */
async function mesurer(nom, cdp, page, pendant) {
  const avant = await compteurs(cdp, page);
  const debut = Date.now();
  await pendant();
  const secondes = (Date.now() - debut) / 1000;
  const apres = await compteurs(cdp, page);
  const parSeconde = (cle) => (apres[cle] - avant[cle]) / secondes;
  const ligne = {
    nom,
    tacheMsParS: Math.round(parSeconde('tache') * 1000),
    scriptMsParS: Math.round(parSeconde('script') * 1000),
    stylesParS: +parSeconde('styles').toFixed(1),
    misesEnPageParS: +parSeconde('misesEnPage').toFixed(1),
    intervallesParS: +parSeconde('battementsIntervalle').toFixed(1),
    minuteursParS: +parSeconde('battementsMinuteur').toFixed(1),
    intervallesVivants: apres.intervallesVivants,
    redessinsParS: +parSeconde('redessins').toFixed(1),
    animations: apres.animations,
  };
  console.log(
    `  ${nom.padEnd(10)} travail ${String(ligne.tacheMsParS).padStart(4)} ms/s · script ${String(ligne.scriptMsParS).padStart(4)} ms/s · ` +
      `redessins ${ligne.redessinsParS}/s · styles ${ligne.stylesParS}/s · mises en page ${ligne.misesEnPageParS}/s · ` +
      `minuteries ${(ligne.intervallesParS + ligne.minuteursParS).toFixed(1)}/s (${ligne.intervallesVivants} intervalles vivants) · ` +
      `${ligne.animations} animation(s) en cours`,
  );
  return ligne;
}

async function main() {
  if (!(await attendrePort()) || !(await attendreLaBase())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));

  /*
   * LE COMPTEUR DE MINUTERIES ET L'INTERRUPTEUR « PAGE CACHÉE », posés avant le
   * premier script de la page. Un navigateur sans fenêtre ne cache jamais sa
   * page de lui-même : on rejoue donc ce que l'application LIT
   * (`document.visibilityState`, `document.hidden`) et l'événement qu'elle
   * écoute (`visibilitychange`).
   */
  await page.addInitScript(() => {
    const mesure = { battementsIntervalle: 0, battementsMinuteur: 0, vivants: 0, redessins: 0 };
    window.__mesureBatterie = mesure;
    /* LES REDESSINS, COMPTÉS À LA SOURCE : React prévient ce crochet à chaque
       passe d'affichage qu'il valide, même dans une version de production. */
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      isDisabled: false,
      inject: () => 1,
      checkDCE: () => undefined,
      onCommitFiberRoot: () => {
        mesure.redessins += 1;
      },
      onPostCommitFiberRoot: () => undefined,
      onCommitFiberUnmount: () => undefined,
    };
    const vraiIntervalle = window.setInterval.bind(window);
    const vraiArret = window.clearInterval.bind(window);
    const vraiMinuteur = window.setTimeout.bind(window);
    const connus = new Set();
    window.setInterval = (geste, delai, ...reste) => {
      const id = vraiIntervalle(
        (...a) => {
          mesure.battementsIntervalle += 1;
          return typeof geste === 'function' ? geste(...a) : undefined;
        },
        delai,
        ...reste,
      );
      connus.add(id);
      mesure.vivants = connus.size;
      return id;
    };
    window.clearInterval = (id) => {
      connus.delete(id);
      mesure.vivants = connus.size;
      return vraiArret(id);
    };
    window.setTimeout = (geste, delai, ...reste) =>
      vraiMinuteur(
        (...a) => {
          mesure.battementsMinuteur += 1;
          return typeof geste === 'function' ? geste(...a) : undefined;
        },
        delai,
        ...reste,
      );
    let cache = false;
    Object.defineProperty(document, 'visibilityState', { get: () => (cache ? 'hidden' : 'visible'), configurable: true });
    Object.defineProperty(document, 'hidden', { get: () => cache, configurable: true });
    window.__cacherLaPage = (valeur) => {
      cache = valeur;
      document.dispatchEvent(new Event('visibilitychange'));
      if (!valeur) window.dispatchEvent(new Event('focus'));
    };
  });

  /*
   * LE CANAL DE LA PAGE, TENU PAR LE SCRIPT : tout passe au vrai démon, et le
   * script peut y glisser des événements comme s'ils venaient de lui. On compte
   * aussi les ouvertures, les fermetures et ce que le démon envoie réellement.
   */
  const canal = { ouvertures: 0, fermetures: 0, recus: 0, courant: null };
  await page.routeWebSocket(/\/ws$/, (ws) => {
    canal.ouvertures += 1;
    canal.courant = ws;
    const serveur = ws.connectToServer();
    ws.onMessage((message) => serveur.send(message));
    serveur.onMessage((message) => {
      canal.recus += 1;
      ws.send(message);
    });
    ws.onClose(() => {
      canal.fermetures += 1;
      if (canal.courant === ws) canal.courant = null;
      serveur.close();
    });
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('[data-column="planned"]', { timeout: 30_000 });
  await page.waitForTimeout(4_000);
  const cdp = await contexte.newCDPSession(page);
  await cdp.send('Performance.enable');

  console.log(`\nMesure de batterie — ${CARTES} cartes, ${DUREE} s par temps, rafale à ${CADENCE} événements/s\n`);

  const repos = await mesurer('au repos', cdp, page, () => page.waitForTimeout(DUREE * 1000));

  /* La rafale : la réponse d'un agent d'un AUTRE projet, qui s'allonge à chaque envoi. */
  let envoyes = 0;
  const rafale = await mesurer('en rafale', cdp, page, async () => {
    const fin = Date.now() + DUREE * 1000;
    let contenu = '';
    while (Date.now() < fin) {
      contenu += 'Un fragment de plus dans la réponse de cet agent. ';
      canal.courant?.send(
        JSON.stringify({
          type: TEMOIN ? 'temoin.inconnu' : 'message.upsert',
          message: {
            id: 'm-batterie-rafale',
            agentId: AGENT_AILLEURS,
            role: 'assistant',
            content: contenu,
            steps: [],
            todos: [],
            proposals: [],
            questions: [],
            downloads: [],
            attachments: [],
            streaming: true,
            plan: false,
            texteLibreAnnulee: false,
            createdAt: Date.now(),
          },
        }),
      );
      envoyes += 1;
      await new Promise((r) => setTimeout(r, 1000 / CADENCE));
    }
  });
  console.log(`             (${envoyes} événements injectés, soit ${(envoyes / DUREE).toFixed(0)}/s)`);

  /* La page cachée : on laisse à la veille le temps de s'installer, puis on mesure. */
  const fermeturesAvant = canal.fermetures;
  await page.evaluate(() => window.__cacherLaPage(true));
  await page.waitForTimeout(ATTENTE_VEILLE_MS);
  const recusAvant = canal.recus;
  const cache = await mesurer('cachée', cdp, page, () => page.waitForTimeout(DUREE * 1000));
  const recusCache = canal.recus - recusAvant;
  const canalFerme = canal.courant === null && canal.fermetures > fermeturesAvant;
  const alertePendant = await page.locator('[data-message-persistant], [data-cle-message="canal"]').count();

  console.log('');
  noter('veille : le canal se ferme quand la page est cachée', canalFerme, canalFerme ? 'fermé' : 'toujours ouvert');
  noter('veille : plus rien n’arrive du serveur', recusCache === 0, `${recusCache} message(s) en ${DUREE} s`);
  noter(
    'veille : plus aucune minuterie ne bat',
    cache.intervallesParS + cache.minuteursParS < 0.5,
    `${(cache.intervallesParS + cache.minuteursParS).toFixed(1)} battement(s)/s, ${cache.intervallesVivants} intervalle(s) vivant(s)`,
  );

  noter('veille : plus aucune animation ne tourne', cache.animations === 0, `${cache.animations} en cours`);

  /* Le retour : le canal doit se rouvrir tout seul, vite, et sans phrase d'alerte. */
  const ouverturesAvant = canal.ouvertures;
  const retourA = Date.now();
  await page.evaluate(() => window.__cacherLaPage(false));
  let rouvertEn = null;
  while (Date.now() - retourA < 10_000) {
    if (canal.ouvertures > ouverturesAvant || (!canalFerme && canal.courant)) {
      rouvertEn = Date.now() - retourA;
      break;
    }
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(2_500);
  const alerteApres = await page.getByText(/ne répond pas|ne dit plus rien/).count();
  noter('retour : le canal est rouvert', rouvertEn != null && canal.courant != null, rouvertEn != null ? `en ${rouvertEn} ms` : 'jamais');
  noter('retour : aucune phrase « le serveur ne répond pas »', alerteApres === 0 && alertePendant === 0, `${alerteApres} à l’écran`);
  noter('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  console.log(
    '\nRÉSUMÉ ' +
      JSON.stringify({
        repos: { tache: repos.tacheMsParS, minuteries: +(repos.intervallesParS + repos.minuteursParS).toFixed(1), intervalles: repos.intervallesVivants },
        rafale: { tache: rafale.tacheMsParS, script: rafale.scriptMsParS, redessins: rafale.redessinsParS },
        cachee: { tache: cache.tacheMsParS, minuteries: +(cache.intervallesParS + cache.minuteursParS).toFixed(1), recus: recusCache, canalFerme },
      }),
  );

  await navigateur.close();
  const echecs = resultats.filter((r) => !r.ok).length;
  process.exit(CONTROLE && echecs ? 1 : 0);
}

main().catch((err) => {
  console.error('ÉCHEC :', err);
  console.error('Journal du démon :\n' + journal.slice(-30).join(''));
  process.exit(1);
});
