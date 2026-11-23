#!/usr/bin/env node
/**
 * LE BANDEAU DE VEILLE ET LE SERVICE « TÂCHES RÉCURRENTES », DANS UN VRAI NAVIGATEUR.
 *
 *   npm run build && node scripts/verif-taches-recurrentes.mjs
 *
 * Le script monte son PROPRE démon (port libre, base neuve, interface construite
 * de CETTE copie) — jamais depuis le dépôt principal, jamais sur l'application
 * publiée. Le décor : un projet, une carte en veille (en pause sur place, avec
 * son résumé), et une veille déjà terminée sur une autre carte.
 *
 *   1. LE BANDEAU, À 390, 820 ET 1440 PX — sur téléphone et tablette, la phrase
 *      garde au moins 60 % de la largeur du bandeau (les gestes passent
 *      dessous) ; sur grand écran, phrase et gestes tiennent sur une ligne et
 *      la phrase garde au moins 320 px. Jamais la colonne d'un mot de la
 *      capture du 22/10/2026 ;
 *   2. LA TUILE — « Tâches récurrentes » est dans la grille des services, avec
 *      le nombre de veilles qui courent ;
 *   3. LE SERVICE SUR ORDINATEUR — le projet dans la colonne, la veille active
 *      en haut, l'historique replié dessous, puis déplié ;
 *   4. LE TIROIR — une ligne ouvre le détail, l'adresse le nomme, Échap le
 *      referme ;
 *   5. LE LIEN DU BANDEAU — il mène droit au tiroir de sa veille ;
 *   6. SUR TÉLÉPHONE — la page liste les projets tant qu'aucun n'est choisi.
 *
 * Les captures vont dans `BELUGA_CAPTURES` (par défaut un dossier temporaire).
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (path.resolve(RACINE) === '/root/beluga') {
  console.error('Ce contrôle monte un démon jetable : lance-le depuis la copie de travail d’une carte, jamais depuis le dépôt principal.');
  process.exit(2);
}
const PORT = Number(process.env.BELUGA_RECURRENTES_PORT || 7213);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-recurrentes-'));
const CAPTURES = process.env.BELUGA_CAPTURES || path.join(TMP, 'captures');
fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le décor, écrit par le magasin du démon lui-même, AVANT son lancement */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(PROJETS, { recursive: true });
process.env.BELUGA_DATA = DATA;
process.env.BELUGA_PROJECTS_ROOT = PROJETS;

const shared = await import(path.join(RACINE, 'shared/dist/index.js'));
const store = await import(path.join(RACINE, 'server/dist/store.js'));
const { getDb } = await import(path.join(RACINE, 'server/dist/db.js'));

const maintenant = Date.now();
const PROJET = 'p-recurrentes';
const CARTE = 'carte-apple';
const CARTE_FINIE = 'carte-domaine';
const VEILLE = 'veille-apple';
const VEILLE_FINIE = 'veille-domaine';
const RAISON = 'Apple accepte et publie la version iPhone 1.0.0';
const jeton = crypto.randomBytes(32).toString('hex');

store.saveProject(shared.Project.parse({ id: PROJET, name: 'Application iPhone', path: PROJETS, createdAt: maintenant, updatedAt: maintenant }));
const recette = { url: 'https://exemple.ch/statut', leveeSi: 'reussite', recette: { type: 'appel', motAttendu: 'Ready for Sale' } };
const resume = {
  id: VEILLE,
  etat: 'en_cours',
  raison: RAISON,
  echeance: maintenant + 47 * 3_600_000,
  prochainControleA: maintenant + 3_600_000,
  dernierControle: { a: maintenant - 60_000, issue: 'pas-encore' },
};
for (const [id, titre, veille] of [
  [CARTE, 'Images traduites à poser chez Apple', resume],
  [CARTE_FINIE, 'Brancher le nom de domaine', undefined],
]) {
  store.saveAgent(
    shared.Agent.parse({ id: `agent-${id}`, projectId: PROJET, role: 'task', title: titre, cardId: id, run: { engine: 'claude' }, status: 'done', createdAt: maintenant, updatedAt: maintenant }),
  );
  store.saveCard(
    shared.Card.parse({
      id,
      projectId: PROJET,
      title: titre,
      column: veille ? 'running' : 'archived',
      position: 0,
      agentId: `agent-${id}`,
      run: { engine: 'claude' },
      createdAt: maintenant,
      updatedAt: maintenant,
      ...(veille
        ? {
            veille,
            scheduling: { asap: false, attempts: 0, restarts: 0, suspendu: true, enPause: true, waitingReason: `En veille : ${RAISON}` },
          }
        : {}),
    }),
  );
}
const db = getDb();
const inserer = db.prepare(
  `INSERT INTO veilles_de_carte (id, card_id, agent_id, raison, recette, intervalle_ms, echeance, etat, cree_a, prochain_controle_a, dernier_controle, termine_a)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
inserer.run(VEILLE, CARTE, `agent-${CARTE}`, RAISON, JSON.stringify(recette), 3_600_000, resume.echeance, 'en_cours', maintenant - 3_600_000, resume.prochainControleA, JSON.stringify(resume.dernierControle), null);
inserer.run(VEILLE_FINIE, CARTE_FINIE, `agent-${CARTE_FINIE}`, 'Le nom de domaine se propage', JSON.stringify(recette), 1_800_000, maintenant, 'levee', maintenant - 86_400_000, maintenant - 7_200_000, JSON.stringify({ a: maintenant - 7_200_000, issue: 'levee' }), maintenant - 7_200_000);
db.prepare('INSERT OR REPLACE INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
  crypto.createHash('sha256').update(jeton).digest('hex'),
  maintenant,
  maintenant + 3_600_000,
  'vérification des tâches récurrentes',
);
db.close();

/* ------------------------------------------------------------------ */
/* Le démon                                                             */
/* ------------------------------------------------------------------ */

const journal = [];
const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    BELUGA_TOKEN: '',
    BELUGA_URL: '',
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));
process.on('exit', () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  if (!process.env.BELUGA_CAPTURES) fs.rmSync(TMP, { recursive: true, force: true });
});

async function attendrePort(limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

if (!(await attendrePort())) {
  console.error(journal.join('').slice(-3000));
  throw new Error('le démon jetable n’a jamais ouvert son port');
}

/* ------------------------------------------------------------------ */
/* Le navigateur                                                        */
/* ------------------------------------------------------------------ */

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const erreurs = [];

async function pageA(largeur, hauteur) {
  const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-CH', hasTouch: largeur < 640 });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  page.on('pageerror', (e) => erreurs.push(String(e)));
  return page;
}

try {
  /* 1. LE BANDEAU, À TROIS LARGEURS. */
  for (const [largeur, hauteur] of [
    [390, 844],
    [820, 1180],
    [1440, 900],
  ]) {
    const page = await pageA(largeur, hauteur);
    await page.goto(`${BASE}/#${shared.construireFragment({ vue: 'projet', projectId: PROJET, cardId: CARTE })}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const bandeau = page.locator('[data-bandeau-veille]').first();
    const vu = await bandeau.waitFor({ state: 'visible', timeout: 30000 }).then(() => true, () => false);
    if (!vu) {
      noter(`Le bandeau de veille paraît à ${largeur} px`, false);
      await page.screenshot({ path: path.join(CAPTURES, `bandeau-${largeur}-absent.png`) });
      await page.context().close();
      continue;
    }
    await page.waitForTimeout(400);
    const mesure = await page.evaluate(() => {
      const b = document.querySelector('[data-bandeau-veille]').getBoundingClientRect();
      const t = document.querySelector('[data-bandeau-veille-texte]').getBoundingClientRect();
      return { bandeau: b.width, texte: t.width };
    });
    const part = mesure.texte / mesure.bandeau;
    noter(
      `À ${largeur} px, la phrase de la veille garde sa largeur`,
      /* Sur grand écran, la phrase et les gestes tiennent sur UNE ligne : la
         phrase n'a alors qu'à rester lisible (au moins 320 px). */
      (largeur < 1024 ? part >= 0.6 : true) && mesure.texte >= (largeur < 1024 ? 200 : 320),
      `${Math.round(mesure.texte)} px sur ${Math.round(mesure.bandeau)} (${Math.round(part * 100)} %)`,
    );
    noter(`À ${largeur} px, la raison se lit en entier`, (await bandeau.innerText()).includes(RAISON));
    await bandeau.screenshot({ path: path.join(CAPTURES, `bandeau-${largeur}.png`) });

    /* 5. LE LIEN DU BANDEAU mène droit au tiroir (une fois, sur ordinateur). */
    if (largeur === 1440) {
      await page.click('[data-veille-service]');
      const tiroir = page.locator(`[data-recurrentes-tiroir="${VEILLE}"]`);
      const ouvert = await tiroir.waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false);
      noter('Le lien du bandeau ouvre le tiroir de sa veille', ouvert && page.url().includes(`taches-recurrentes/${PROJET}/veille/${VEILLE}`), page.url());
    }
    await page.context().close();
  }

  /* 2 à 4. LE SERVICE SUR ORDINATEUR. */
  {
    const page = await pageA(1440, 900);
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-column="planned"], [data-ecran-plein]', { timeout: 30000 });
    await page.waitForTimeout(600);
    /* LE MENU EN GRILLE N'EXISTE PLUS (13/11/2026) : « Tâches récurrentes » de TOUS les projets s'ouvre par le menu ⋮
       de la colonne de gauche — ici, par son adresse —, en UN TABLEAU (plus de colonne de projets). */
    await page.evaluate(() => (window.location.hash = '#taches-recurrentes'));
    const tableau = page.locator('[data-recurrentes-tableau]');
    noter('Les tâches récurrentes se lisent en un tableau', await tableau.waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false));
    const active = page.locator(`[data-recurrentes-veille="${VEILLE}"]`);
    noter('La veille active est dans le tableau', await active.waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false));
    const finie = page.locator(`[data-recurrentes-veille="${VEILLE_FINIE}"]`);
    noter('La veille terminée aussi, avec son état', await finie.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false));
    await page.screenshot({ path: path.join(CAPTURES, 'service-1440.png') });

    await active.locator('button').first().click();
    const tiroir = page.locator(`[data-recurrentes-tiroir="${VEILLE}"]`);
    const ouvert = await tiroir.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
    noter('Une ligne ouvre le tiroir de sa veille, et l’adresse le nomme', ouvert && page.url().includes(`/veille/${VEILLE}`), page.url());
    const texte = ouvert ? await tiroir.innerText() : '';
    noter('Le tiroir dit ce qui est vérifié, la carte et les gestes', texte.includes('Ready for Sale') && texte.includes('Images traduites') && (await tiroir.locator('[data-veille-verifier]').count()) === 1);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(CAPTURES, 'tiroir-1440.png') });
    await page.keyboard.press('Escape');
    noter('Échap referme le tiroir', await tiroir.waitFor({ state: 'hidden', timeout: 5000 }).then(() => true, () => false));
    await page.context().close();
  }

  /* 6. SUR TÉLÉPHONE. */
  {
    const page = await pageA(390, 844);
    await page.goto(`${BASE}/#taches-recurrentes`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const active = page.locator(`[data-recurrentes-veille="${VEILLE}"]`);
    noter('Sur téléphone, le même tableau montre les veilles (plus de feuille par projet)', await active.waitFor({ state: 'visible', timeout: 30000 }).then(() => true, () => false));
    await page.screenshot({ path: path.join(CAPTURES, 'service-390.png') });
    await active.locator('button').first().click();
    const tiroir = page.locator(`[data-recurrentes-tiroir="${VEILLE}"]`);
    noter('…et le tiroir s’ouvre sur téléphone', await tiroir.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false));
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(CAPTURES, 'tiroir-390.png') });
    await page.context().close();
  }

  noter('Aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));
} finally {
  await navigateur.close();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis. Captures : ${CAPTURES}`);
process.exit(echecs.length ? 1 : 0);
