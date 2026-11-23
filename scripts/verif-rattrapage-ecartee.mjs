#!/usr/bin/env node
/**
 * UNE CARTE ÉCARTÉE D'UNE PUBLICATION SE RÉPARE D'ELLE-MÊME — VÉRIFIÉ SUR UN
 * DÉMON D'ESSAI, DANS UN VRAI NAVIGATEUR, SANS DÉPENSER UN JETON.
 *
 * Le décor : une publication réussie dont trois cartes ont été écartées.
 *   - « Sans rattrapage » : la ligne dit la phrase nommée et offre
 *     « Réconcilier ». Le clic part au démon, qui ne trouve AUCUN agent de tâche
 *     à relancer (c'est voulu : rien ne doit tourner) et écrit l'échec — la
 *     ligne doit le dire, et garder son bouton de secours.
 *   - « Revenue » : rattrapage lancé, carte revenue dans « À déployer » après
 *     son départ — la ligne dit « réconciliée », sans bouton.
 *   - « Prévue » : rattrapage `prevu`, posé en base comme le fait la fin de
 *     publication. Le démon d'essai vient de démarrer : il doit le REPRENDRE
 *     seul (c'est ce qui survit au redémarrage de Beluga), sans agent à
 *     relancer ici non plus — la ligne passe à l'échec.
 *
 *   node scripts/verif-rattrapage-ecartee.mjs     (BELUGA_RATTRAPAGE_PORT pour changer de port)
 *
 * Ne vise jamais l'application publiée : le démon est jetable, sa base aussi.
 */

import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_RATTRAPAGE_PORT || 7231);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${String(detail).slice(0, 200)}` : ''}`);
};

const { DATA, DEPOT, journal, nettoyer, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-rattrapage-ecartee-',
  port: PORT,
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai-rattrapage';
const RUN_ID = 'run-rattrapage-1';
const SANS = 'c-ecartee-sans';
const REVENUE = 'c-ecartee-revenue';
const PREVUE = 'c-ecartee-prevue';
const PHRASE =
  'tache/sans-aaaaaa écartée du lot : heurt sur server/src/runtime.ts, contre « Carte passée » (tache/passee-pppppp) sur server/src/runtime.ts.';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification rattrapage après écartement',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: 'Essai — rattrapage',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    /* Depuis le 10/10/2026 un projet sans processus ne déploie pas : le décor est « hérité » (déploiement déjà en place), sinon l'en-tête n'offre que « Configuration de la procédure », sans chevron. */
    deploiement: { herite: true },
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

  /* Les cartes écartées sont restées dans « À déployer ». Leur agent de tâche
     N'EXISTE PAS : aucun tour ne peut partir de ce contrôle. */
  const carte = db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, description, data, created_at, updated_at)
     VALUES (?, ?, 'to_deploy', ?, ?, '', ?, ?, ?)`,
  );
  const cartes = [
    [SANS, 'Carte écartée sans rattrapage', {}],
    [REVENUE, 'Carte écartée revenue', { doneAt: maintenant - 1000 }],
    [PREVUE, 'Carte écartée prévue', {}],
  ];
  cartes.forEach(([id, titre, extra], i) =>
    carte.run(id, PROJET_ID, i, titre, JSON.stringify({ agentId: `a-absent-${id}`, ...extra }), maintenant, maintenant),
  );

  const etape = (key) => ({ key, state: 'done', log: '', startedAt: maintenant - 60000, endedAt: maintenant - 50000 });
  const run = {
    id: RUN_ID,
    projectId: PROJET_ID,
    state: 'success',
    cible: 'dev',
    cardIds: ['c-passee'],
    steps: ['merge', 'commit', 'push', 'build', 'publish', 'restart'].map(etape),
    taches: [
      { cardId: 'c-passee', titre: 'Carte passée', branche: 'tache/passee-pppppp', etat: 'en-ligne' },
      {
        cardId: SANS,
        titre: 'Carte écartée sans rattrapage',
        branche: 'tache/sans-aaaaaa',
        etat: 'ecartee',
        detail: PHRASE,
        ecart: {
          fichiers: ['server/src/runtime.ts'],
          brancheDAccueil: 'dev',
          contre: [{ cardId: 'c-passee', titre: 'Carte passée', branche: 'tache/passee-pppppp', fichiers: ['server/src/runtime.ts'] }],
        },
      },
      {
        cardId: REVENUE,
        titre: 'Carte écartée revenue',
        branche: 'tache/revenue-bbbbbb',
        etat: 'ecartee',
        detail: 'conflit sur a.ts',
        rattrapage: { etat: 'lance', at: maintenant - 5000, par: 'automatique' },
      },
      {
        cardId: PREVUE,
        titre: 'Carte écartée prévue',
        branche: 'tache/prevue-cccccc',
        etat: 'ecartee',
        detail: 'conflit sur b.ts',
        rattrapage: { etat: 'prevu', at: maintenant - 2000, par: 'automatique' },
      },
    ],
    queued: false,
    reprises: 0,
    repriseApresCoupure: false,
    startedAt: maintenant - 60000,
    endedAt: maintenant - 50000,
  };
  db.prepare('INSERT INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    run.id,
    PROJET_ID,
    run.state,
    JSON.stringify(run),
    run.startedAt,
    run.endedAt,
  );
  db.close();
}

function rattrapageEnBase(cardId) {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const run = JSON.parse(db.prepare('SELECT data FROM deploys WHERE id = ?').get(RUN_ID).data);
  db.close();
  return run.taches.find((t) => t.cardId === cardId)?.rattrapage;
}

async function main() {
  if (!(await attendrePort())) {
    noter('le démon d’essai répond', false, journal.join('').slice(-600));
    return;
  }
  noter('le démon d’essai répond', true);
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1500, height: 950 }, locale: 'fr-CH', serviceWorkers: 'block' });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    /* Depuis la refonte, la colonne montre les services du projet ouvert, pas la
       liste des projets : on y va par son adresse. */
    await page.evaluate((id) => { window.location.hash = `#projet/${id}`; }, PROJET_ID);
    await page.waitForTimeout(2500);

    const chevron = page.locator('[data-chevron-process]').first();
    if (!(await chevron.count())) {
      noter('le volet de publication s’ouvre', false, 'aucun chevron dans « À déployer »');
      return;
    }
    await chevron.click();
    await page.waitForTimeout(2000);

    const sans = page.locator(`[data-ecart-de-tache="${SANS}"]`);
    noter('la carte écartée dit la phrase nommée (fichiers ET carte heurtée)', (await sans.locator('[data-phrase-ecart]').innerText().catch(() => '')).includes('contre « Carte passée »'));
    noter('elle offre « Réconcilier »', (await sans.locator('[data-bouton-reconcilier]').count()) === 1);

    const revenue = page.locator(`[data-ecart-de-tache="${REVENUE}"]`);
    noter('une carte revenue dans « À déployer » après son départ se dit réconciliée', (await revenue.locator('[data-rattrapage="revenu"]').count()) === 1);
    noter('…et n’offre plus de bouton', (await revenue.locator('[data-bouton-reconcilier]').count()) === 0);

    if (process.env.RATTRAPAGE_CAPTURE) await page.screenshot({ path: process.env.RATTRAPAGE_CAPTURE }).catch(() => {});

    await sans.locator('[data-bouton-reconcilier]').click();
    await page.waitForTimeout(2500);
    const apres = rattrapageEnBase(SANS);
    noter('le clic part au démon, qui écrit l’issue sur la tâche', apres?.etat === 'echec' && apres?.par === 'humain', JSON.stringify(apres));
    noter('la ligne dit l’échec, et garde son bouton de secours', (await sans.locator('[data-rattrapage="echec"]').count()) === 1 && (await sans.locator('[data-bouton-reconcilier]').count()) === 1);

    /* Le démon reprend seul le rattrapage `prevu` ~30 s après son démarrage. */
    let prevue;
    for (let i = 0; i < 40; i += 1) {
      prevue = rattrapageEnBase(PREVUE);
      if (prevue?.etat !== 'prevu') break;
      await page.waitForTimeout(1500);
    }
    noter('au démarrage, le démon reprend seul un rattrapage prévu (il survit au redémarrage)', prevue?.etat === 'echec' && prevue?.par === 'automatique', JSON.stringify(prevue));
    noter('la reprise automatique ne touche jamais une tâche déjà revenue', rattrapageEnBase(REVENUE)?.etat === 'lance');
    noter('aucune erreur de page', erreurs.length === 0, erreurs.join(' | '));
  } finally {
    await navigateur.close();
  }
}

try {
  await main();
} catch (err) {
  noter('le contrôle a tourné jusqu’au bout', false, err?.stack ?? err);
} finally {
  nettoyer();
}
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passées.`);
process.exit(echecs ? 1 : 0);
