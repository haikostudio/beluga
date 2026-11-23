#!/usr/bin/env node
/**
 * LE JOURNAL D'UNE CARTE OUVERTE SE RATTRAPE APRÈS UNE COUPURE — dans un vrai
 * navigateur.
 *
 *   node scripts/verif-journal-apres-coupure.mjs
 *
 * La panne reproduite : un téléphone en veille pendant qu'un plan s'écrit. Les
 * lignes du journal sont diffusées sur un canal MORT : l'écran ne les reçoit
 * jamais, la carte connaît la v3, « Valider le plan v3 » s'affiche… et le plan
 * reste invisible (carte #88b9, 11.09.2026).
 *
 * Le script monte son PROPRE démon (`BELUGA_COUPURE_PORT`), base neuve, plafond
 * d'agents à zéro : aucun moteur appelé. Les lignes « perdues » sont écrites EN
 * BASE sans être diffusées — exactement ce qu'un canal mort laisse derrière lui.
 *
 * Ce qui est prouvé :
 *   1. un plan que la CARTE connaît s'affiche même quand son jalon manque au
 *      journal (`versionDuPassageDePlan`, versions connues) ;
 *   2. après une coupure du réseau et la reconnexion, les lignes écrites
 *      pendant la coupure paraissent SANS rouvrir la carte (`ready` redemande
 *      le journal de la carte ouverte) ;
 *   3. sans coupure, une ligne qui arrive avec un rang qui SAUTE fait
 *      redemander le journal entier (`journalATrou`) : la ligne manquante
 *      paraît aussi.
 *
 * Il ne reprend jamais `BELUGA_URL` : il vise son propre démon.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_COUPURE_PORT || 7231);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { TMP, DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-journal-coupure-',
  port: PORT,
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-coupure';
const CARTE_ID = 'c-coupure';
const AGENT_ID = 'a-coupure';
const TITRE = 'Carte d’essai — journal après coupure';

const base = (lecture = false) => new Database(path.join(DATA, 'beluga.db'), { readonly: lecture });

/** Une ligne de journal, écrite EN BASE sans être diffusée. */
function ecrireLigne(db, rang, libelle, resultat = '', donnees = null) {
  db.prepare(
    `INSERT INTO card_journal
       (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, resultat, reussie, donnees)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `j-${rang}`,
    CARTE_ID,
    rang,
    'cadrage',
    'jalon',
    Date.now() - 60_000 + rang * 1000,
    AGENT_ID,
    'cadrage',
    `tour-${rang}`,
    libelle,
    resultat,
    1,
    donnees ? JSON.stringify(donnees) : null,
  );
}

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification du journal après coupure',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai coupure',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

  /* LA CARTE CONNAÎT DEUX VERSIONS ; le journal ne porte le jalon QUE de la v1. */
  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    agentId: AGENT_ID,
    title: TITRE,
    description: 'Carte du contrôle.',
    labels: [],
    column: 'planned',
    position: 1,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none', mode: 'plan' },
    scheduling: { asap: false, attempts: 0, restarts: 0 },
    parcours: {
      plans: [
        { id: 'plan-1', numero: 1, titre: 'Plan v1', texte: '# Plan v1\n\nPremière version.', at: maintenant - 50_000 },
        { id: 'plan-2', numero: 2, titre: 'Plan v2', texte: '# Plan v2\n\nDeuxième version.', at: maintenant - 10_000 },
      ],
    },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(CARTE_ID, PROJET_ID, 'planned', 1, TITRE, JSON.stringify(carte), maintenant, maintenant);
  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    cardId: CARTE_ID,
    role: 'cadrage',
    title: TITRE,
    run: { engine: 'claude', thinking: 'none', mode: 'plan' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(AGENT_ID, PROJET_ID, CARTE_ID, 'cadrage', 'idle', JSON.stringify(agent), maintenant, maintenant);
  const demande = {
    id: 'm-demande',
    agentId: AGENT_ID,
    role: 'user',
    content: 'Fais l’essai de la coupure.',
    steps: [],
    todos: [],
    proposals: [],
    questions: [],
    downloads: [],
    attachments: [],
    createdAt: maintenant,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    demande.id,
    AGENT_ID,
    'user',
    JSON.stringify(demande),
    maintenant,
  );

  ecrireLigne(db, 0, 'Demande', 'Fais l’essai de la coupure.');
  ecrireLigne(db, 1, 'Tour lancé');
  ecrireLigne(db, 2, 'Compréhension', 'compris');
  ecrireLigne(db, 3, 'Plan demandé', 'Première version demandée.');
  ecrireLigne(db, 4, 'Plan proposé', '# Plan v1', { version: 1 });
  ecrireLigne(db, 5, 'Demande', 'Une première précision.');
  ecrireLigne(db, 6, 'Compréhension', 'mieux compris');
  ecrireLigne(db, 7, 'Plan demandé', 'Nouvelle version demandée.');
  /* …le jalon « Plan proposé » v2 s'est perdu : la carte connaît pourtant la v2. */
  db.close();
}

const combienDePoints = (page, etape) => page.locator(`[data-flux-points] [data-point="${etape}"]`).count();

async function attendre(condition, limiteMs) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  await new Promise((r) => setTimeout(r, 1500));

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  /* LES CANAUX DE LA PAGE, TENUS EN MAIN : on peut les couper, et leur injecter
     un événement exactement comme le démon le diffuse. */
  await page.addInitScript(() => {
    const Natif = window.WebSocket;
    window.__sockets = [];
    function Enveloppe(...args) {
      const prise = new Natif(...args);
      window.__sockets.push(prise);
      return prise;
    }
    Enveloppe.prototype = Natif.prototype;
    Object.assign(Enveloppe, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.WebSocket = Enveloppe;
    window.__ecouteurs = [];
    const propriete = Object.getOwnPropertyDescriptor(Natif.prototype, 'onmessage');
    Object.defineProperty(Natif.prototype, 'onmessage', {
      configurable: true,
      get() {
        return propriete.get.call(this);
      },
      set(ecouteur) {
        window.__ecouteurs.push(ecouteur);
        return propriete.set.call(this, ecouteur);
      },
    });
    window.__injecter = (evenement) => {
      const donnees = JSON.stringify(evenement);
      for (const ecouteur of window.__ecouteurs) ecouteur({ data: donnees });
    };
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(5000);
  await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });
  const onglet = page.getByRole('button', { name: /^Tableau$/ });
  if (await onglet.count()) {
    await onglet.first().click();
    await page.waitForTimeout(1500);
  }
  await page.locator('article').filter({ hasText: TITRE.slice(0, 24) }).first().click();
  await page.waitForSelector('[data-flux-points]', { timeout: 30_000 });
  await page.waitForTimeout(2000);

  /* -------- 1. Un plan connu de la carte ne se cache pas -------- */
  noter(
    'la v2, connue de la carte mais sans jalon au journal, se lit dans le fil',
    (await page.locator('[data-bloc-du-plan="2"]').count()) >= 1,
    `${await page.locator('[data-bloc-du-plan]').count()} bloc(s) de plan`,
  );

  /* -------- 2. La coupure, puis la reconnexion -------- */
  const demandesAvant = await combienDePoints(page, 'demande');
  await contexte.setOffline(true);
  {
    const db = base();
    ecrireLigne(db, 8, 'Plan proposé', '# Plan v2', { version: 2 });
    ecrireLigne(db, 9, 'Demande', 'Précision écrite pendant la coupure.');
    ecrireLigne(db, 10, 'Compréhension', 'compris encore');
    db.close();
  }
  await page.waitForTimeout(800);
  noter(
    'pendant la coupure, l’écran ne connaît pas les lignes écrites',
    (await combienDePoints(page, 'demande')) === demandesAvant,
    `${demandesAvant} point(s) « Demande »`,
  );
  await page.evaluate(() => window.__sockets.forEach((prise) => prise.close()));
  await page.waitForTimeout(1500);
  await contexte.setOffline(false);
  const rattrape = await attendre(async () => (await combienDePoints(page, 'demande')) === demandesAvant + 1, 30_000);
  noter(
    'après la reconnexion, les lignes écrites pendant la coupure paraissent, carte restée ouverte',
    rattrape,
    `${await combienDePoints(page, 'demande')} point(s) « Demande » (attendu ${demandesAvant + 1})`,
  );
  noter('le jalon de la v2 arrivé entre-temps ne double pas son plan', (await page.locator('[data-bloc-du-plan="2"]').count()) <= 1);

  /* -------- 3. Un rang qui saute, sans reconnexion -------- */
  const demandesMilieu = await combienDePoints(page, 'demande');
  {
    const db = base();
    ecrireLigne(db, 11, 'Demande', 'Deuxième précision, jamais diffusée.');
    db.close();
  }
  await page.evaluate(
    ({ carte, agent }) =>
      window.__injecter({
        type: 'journal.entree',
        entree: {
          id: 'j-injectee-12',
          cardId: carte,
          rang: 12,
          phase: 'cadrage',
          nature: 'jalon',
          at: Date.now(),
          agentId: agent,
          agentRole: 'cadrage',
          tourId: 'tour-12',
          libelle: 'Compréhension',
          resultat: 'compris une troisième fois',
          reussie: true,
        },
      }),
    { carte: CARTE_ID, agent: AGENT_ID },
  );
  const bouche = await attendre(async () => (await combienDePoints(page, 'demande')) === demandesMilieu + 1, 15_000);
  noter(
    'une ligne au rang qui saute fait redemander le journal : la ligne manquante paraît',
    bouche,
    `${await combienDePoints(page, 'demande')} point(s) « Demande » (attendu ${demandesMilieu + 1})`,
  );

  await page.screenshot({ path: path.join(TMP, 'journal-apres-coupure.png') });
  noter('aucune erreur de page pendant tout le parcours', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  if (echecs.length) console.log(`(capture dans ${TMP})`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  console.error(journal.slice(-30).join(''));
  process.exit(1);
});
