#!/usr/bin/env node
/**
 * LES TRAVAUX DES SERVICES DANS LA COLONNE, DANS UN VRAI NAVIGATEUR (carte « Agents des services dans la colonne »,
 * 25/11/2026, maquette #cdea).
 *
 * Sur un démon d'essai (base neuve, aucun compte moteur : aucun tour ne part), posés APRÈS le démarrage : un agent
 * marketing qui répond et l'étude de son dossier qui tourne (projet Beluga), un export vidéo du Studio à 42 % (projet
 * Toogo). Puis :
 *  1. « En cours » montre UNE ligne pour l'agent marketing ET son étude (fusion), une pour la vidéo ; chacune porte
 *     l'icône de son projet ; le compteur les compte ; la vidéo dit « 42 % » ;
 *  2. sous le projet déplié, la ligne de la vidéo paraît aussi ; l'avancement suit en direct (60 %) ;
 *  3. l'export fini : la ligne reste, EN GRAS, état « termine-non-vu » ;
 *  4. un clic mène au Studio de la création ; la ligne disparaît, et ne revient pas au rechargement (vu au démon) ;
 *  5. un export qui TOMBE sort de la liste sans passer pour fini ;
 *  6. l'étude close : en gras, puis ouvrir le dossier marketing la retire ;
 *  7. sur téléphone (390 px), dans le menu : la ligne paraît, rien ne déborde ;
 *  8. en clair et en sombre, sans erreur de page.
 *
 *   node scripts/verif-travaux-des-services.mjs        (après `npm run build`, depuis la copie de la carte)
 *   VERIF_CAPTURES=/tmp/captures-travaux node scripts/verif-travaux-des-services.mjs   (écrit les captures)
 *
 * Jamais `BELUGA_URL` ni `BELUGA_TOKEN` : la session d'une heure est fabriquée en base jetable, et part avec elle.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7213);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-travaux-services-', port: PORT, signaux: true });
const jeton = crypto.randomBytes(32).toString('hex');
const T = Date.now();
const P1 = 'p-beluga';
const P2 = 'p-toogo';

const base = () => new Database(path.join(DATA, 'beluga.db'));
const executer = (sql, ...valeurs) => {
  const db = base();
  try {
    db.prepare(sql).run(...valeurs);
  } finally {
    db.close();
  }
};

function poserLeDecor() {
  const db = base();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai');
  for (const [id, nom, rang] of [
    [P1, 'Beluga', 1],
    [P2, 'Toogo', 2],
  ]) {
    const p = { id, name: nom, path: DEPOT, defaultEngine: 'claude', isSelf: id === P1, rank: rang, archived: false, createdAt: T, updatedAt: T };
    db.prepare('INSERT OR REPLACE INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(id, nom, DEPOT, JSON.stringify(p), T, T);
  }
  db.close();
}

/** APRÈS le démarrage : le démon met en pause les études actives et efface les états « au travail » en démarrant. */
function poserLesTravaux() {
  const db = base();
  const dossier = { id: 'd1', type: 'tpe', sujet: { nom: 'Wogo', genre: 'entreprise', projectId: P1 }, axes: [], jauges: [], creeLe: T, majLe: T };
  db.prepare('INSERT OR REPLACE INTO strategie_dossiers (id, data, cree_le, maj_le) VALUES (?, ?, ?, ?)').run('d1', JSON.stringify(dossier), T, T);
  db.prepare("INSERT OR REPLACE INTO strategie_missions (id, dossier_id, genre, etat, profil, plafond, agents, cree_le, debut) VALUES ('m1', 'd1', 'complete', 'running', 'economique', 10, '[]', ?, ?)").run(T, T);
  const agent = {
    id: 'ag-marketing',
    projectId: P1,
    role: 'task',
    title: 'Marketing — Wogo',
    workdir: DEPOT,
    run: { engine: 'claude' },
    status: 'running',
    startedAt: T - 30_000,
    tourVivantDepuis: T - 30_000,
    service: { id: 'strategie', nom: 'Marketing', adresse: 'strategie/d1/marketing2' },
    createdAt: T - 60_000,
    updatedAt: T,
  };
  db.prepare('INSERT OR REPLACE INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)').run(agent.id, agent.projectId, agent.role, agent.status, JSON.stringify(agent), agent.createdAt, agent.updatedAt);
  db.prepare("INSERT OR REPLACE INTO studio_creations (id, project_id, titre, cree_le, maj_le) VALUES ('c1', ?, 'Teaser hiver', ?, ?)").run(P2, T, T);
  db.prepare("INSERT OR REPLACE INTO studio_exports (id, creation_id, project_id, format, genre, etat, progression, version, cree_le, maj_le) VALUES ('e1', 'c1', ?, '9:16', 'video', 'en-cours', 0.42, 1, ?, ?)").run(P2, T, T);
  db.close();
}

function poserLeTheme(clarte) {
  executer('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)', 'theme', JSON.stringify(clarte), Date.now());
}

async function capturer(page, nom) {
  if (!CAPTURES) return;
  await page.mouse.move(5, 5).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

async function ouvrir(page, fragment, repere) {
  for (let essai = 0; essai < 3; essai++) {
    await page.goto('about:blank');
    await page.goto(`${BASE}/#${fragment}`, { waitUntil: 'load' });
    if (await page.locator(repere).first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false)) return;
  }
  await page.locator(repere).first().waitFor({ state: 'visible', timeout: 15_000 });
}

const enCours = '[data-liste-taches-en-cours]';
const ligne = (id) => `${enCours} [data-travail-de-service="${id}"]`;
const attendre = (page, selecteur, etat = 'visible', delai = 15_000) => page.locator(selecteur).first().waitFor({ state: etat, timeout: delai }).then(() => true, () => false);
const debordement = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function principal() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  poserLesTravaux();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const theme of ['light', 'dark']) {
      const clair = theme === 'light';
      poserLeTheme(clair ? 'clair' : 'sombre');
      const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH', colorScheme: theme, serviceWorkers: 'block' });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await contexte.newPage();
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));

      if (clair) {
        /* 1. Une ligne par travail, l'agent marketing fondu dans son étude. */
        await ouvrir(page, `projet/${P1}`, '[data-taches-en-cours-colonne]');
        verifier('la vidéo du Studio paraît dans « En cours »', await attendre(page, ligne('studio:e1')));
        verifier('l’étude marketing paraît dans « En cours »', await attendre(page, ligne('marketing:m1')));
        await page.waitForTimeout(600);
        const ids = await page.locator(`${enCours} [data-travail-de-service]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-travail-de-service')));
        verifier('l’agent marketing et son étude ne font qu’une ligne', ids.length === 2 && !ids.includes('agent:ag-marketing'), ids.join(','));
        verifier('aucune ligne d’agent sans carte en double', (await page.locator(`${enCours} [data-agent-sans-carte="ag-marketing"]`).count()) === 0);
        verifier('chaque ligne porte l’icône de son projet', (await page.locator(`${ligne('studio:e1')} [data-icone-agent-projet]`).count()) === 1 && (await page.locator(`${ligne('marketing:m1')} [data-icone-agent-projet]`).count()) === 1);
        const libelle = (await page.locator(`${ligne('studio:e1')} [data-libelle-du-travail]`).textContent())?.trim();
        verifier('le libellé dit la nature et l’objet', libelle === 'Vidéo du Studio · Teaser hiver', libelle);
        const pourcent = (await page.locator(`${ligne('studio:e1')} [data-avancement-du-travail]`).textContent())?.trim();
        verifier('l’avancement de la vidéo se lit', pourcent === '42 %', pourcent);
        const compteur = Number(await page.locator('[data-nombre-taches-en-cours]').getAttribute('data-nombre-taches-en-cours'));
        const lignesMontrees = await page.locator(`${enCours} > *`).count();
        verifier('le compteur compte les lignes montrées', compteur === lignesMontrees && compteur >= 2, `${compteur} / ${lignesMontrees}`);
        await page.locator(`[data-deplier-taches="${P2}"]`).first().click();
        verifier('sous le projet déplié, la ligne de la vidéo paraît aussi', await attendre(page, `[data-taches-du-projet="${P2}"] [data-travail-de-service="studio:e1"]`));
        await capturer(page, `en-cours-1440-${theme}`);
        await page.locator(`[data-deplier-taches="${P2}"]`).first().click();

        /* 2. L'avancement en direct. */
        executer("UPDATE studio_exports SET progression = 0.6 WHERE id = 'e1'");
        await page.locator(`${ligne('studio:e1')} [data-avancement-du-travail]`, { hasText: '60 %' }).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
        verifier('l’avancement suit en direct', ((await page.locator(`${ligne('studio:e1')} [data-avancement-du-travail]`).textContent()) ?? '').trim() === '60 %');

        /* 3. Fini : en gras, jusqu'à l'ouverture. */
        executer("UPDATE studio_exports SET etat = 'pret', progression = 1 WHERE id = 'e1'");
        verifier('fini, la ligne reste avec l’état « termine-non-vu »', await attendre(page, `${ligne('studio:e1')}[data-etat="termine-non-vu"]`));
        const gras = await page.locator(`${ligne('studio:e1')} [data-libelle-du-travail]`).evaluate((e) => Number(getComputedStyle(e).fontWeight));
        verifier('fini, la ligne est en gras', gras >= 600, String(gras));
        verifier('fini, plus d’avancement', (await page.locator(`${ligne('studio:e1')} [data-avancement-du-travail]`).count()) === 0);
        await capturer(page, `en-cours-fini-1440-${theme}`);

        /* 4. Un clic mène au Studio ; la ligne disparaît, aussi après rechargement. */
        verifier('la ligne de la vidéo mène à sa création du Studio', (await page.locator(ligne('studio:e1')).getAttribute('href')) === '#studio/c1');
        await page.locator(ligne('studio:e1')).click();
        await page.waitForTimeout(800);
        verifier('un clic ouvre le Studio', /#.*studio/.test(page.url()), page.url());
        verifier('ouvert, le travail quitte la colonne', await attendre(page, ligne('studio:e1'), 'detached'));
        await ouvrir(page, `projet/${P1}`, ligne('marketing:m1'));
        await page.waitForTimeout(1500);
        verifier('vu au démon : il ne revient pas au rechargement', (await page.locator(ligne('studio:e1')).count()) === 0);

        /* 5. Un export qui tombe sort sans passer pour fini. */
        executer("INSERT OR REPLACE INTO studio_exports (id, creation_id, project_id, format, genre, etat, progression, version, cree_le, maj_le) VALUES ('e2', 'c1', ?, '9:16', 'image', 'en-cours', 0.1, 1, ?, ?)", P2, Date.now(), Date.now());
        verifier('un nouvel export paraît en direct', await attendre(page, ligne('studio:e2')));
        executer("UPDATE studio_exports SET etat = 'echoue' WHERE id = 'e2'");
        verifier('tombé, il sort de la liste', await attendre(page, ligne('studio:e2'), 'detached'));

        /* 6. L'étude close, puis le dossier ouvert. */
        executer("UPDATE strategie_missions SET etat = 'completed', fin = ? WHERE id = 'm1'", Date.now());
        verifier('l’étude close reste, en gras', await attendre(page, `${ligne('marketing:m1')}[data-etat="termine-non-vu"]`));
        const adresse = await page.locator(ligne('marketing:m1')).getAttribute('href');
        verifier('la ligne de l’étude mène au dossier marketing', adresse === '#marketing/d1', adresse ?? '');
        /* Le moment « fini » repasse au premier plan, pour la capture du téléphone et du sombre. */
        executer("UPDATE strategie_missions SET etat = 'running', fin = NULL WHERE id = 'm1'");
        await attendre(page, `${ligne('marketing:m1')}[data-etat="travail"]`);
      }

      /* 7. Sombre, puis téléphone : lignes en cours. */
      if (!clair) {
        await ouvrir(page, `projet/${P1}`, ligne('marketing:m1'));
        await capturer(page, `en-cours-1440-${theme}`);
      }
      const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-CH', colorScheme: theme, serviceWorkers: 'block' });
      await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const mobile = await tel.newPage();
      mobile.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));
      await mobile.goto(`${BASE}/#projet/${P1}`);
      await mobile.locator('[data-entete-de-zone] button[aria-label="Projets"]:visible').first().waitFor({ state: 'visible', timeout: 30_000 });
      await mobile.locator('[data-entete-de-zone] button[aria-label="Projets"]:visible').first().tap();
      await mobile.locator('[data-menu-du-telephone]').waitFor({ state: 'visible', timeout: 10_000 });
      verifier(`téléphone (${theme}) : la ligne paraît dans le menu`, await attendre(mobile, `[data-menu-du-telephone] [data-travail-de-service="marketing:m1"]`));
      await mobile.waitForTimeout(500);
      verifier(`téléphone (${theme}) : rien ne déborde`, (await debordement(mobile)) <= 0);
      const largeurLigne = await mobile.locator('[data-menu-du-telephone] [data-travail-de-service="marketing:m1"]').first().evaluate((e) => {
        const r = e.getBoundingClientRect();
        return r.right <= window.innerWidth + 0.5 && r.left >= 0;
      });
      verifier(`téléphone (${theme}) : la ligne tient dans l’écran`, largeurLigne);
      await capturer(mobile, `menu-390-${theme}`);
      await tel.close();

      if (!clair) {
        /* 6 bis. Close pour de bon, puis l'ouverture du dossier la retire. */
        executer("UPDATE strategie_missions SET etat = 'completed', fin = ? WHERE id = 'm1'", Date.now());
        verifier('l’étude close reste, en gras (sombre)', await attendre(page, `${ligne('marketing:m1')}[data-etat="termine-non-vu"]`));
        await capturer(page, `en-cours-fini-1440-${theme}`);
        await page.goto(`${BASE}/#marketing/d1`);
        await page.waitForTimeout(2000);
        await ouvrir(page, `projet/${P1}`, '[data-taches-en-cours-colonne], [data-sidebar], body');
        await page.waitForTimeout(1500);
        verifier('ouvrir le dossier marketing retire l’étude finie', (await page.locator(ligne('marketing:m1')).count()) === 0);
      }

      verifier(`aucune erreur de page (${theme})`, erreurs.length === 0, erreurs.join(' | '));
      await contexte.close();
    }
  } finally {
    await navigateur.close();
  }
  const moteur = journal.join('').match(/fil du moteur reparti|engine spawn/gi);
  verifier('aucun moteur joint pendant l’essai', !moteur, moteur?.join(', '));
}

principal()
  .catch((err) => {
    console.error(err);
    resultats.push(false);
  })
  .finally(() => {
    nettoyer();
    const ok = resultats.filter(Boolean).length;
    console.log(`\n${ok}/${resultats.length} contrôles passent.`);
    process.exit(ok === resultats.length && resultats.length ? 0 : 1);
  });
