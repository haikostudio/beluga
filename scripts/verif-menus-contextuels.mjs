#!/usr/bin/env node
/**
 * LES MENUS CONTEXTUELS D'UN ÉLÉMENT (carte « Extension, rapport SEO-GEO et menus », 21/11/2026 : « quand je clique
 * droit sur un élément, il y a des options ; si je survole, il y a trois points… il faut les revoir pour simplifier »).
 *
 * Sur une ligne de tâche (tableau d'un projet), une ligne d'agent (colonne de gauche), une ligne de campagne, un dossier
 * du coffre-fort, un fichier lourd du serveur, un média du fil d'une tâche, une demande de l'espace client (validés en
 * avant / après le 21/11/2026), plus la piste et la création du Studio :
 *  - les trois points paraissent au survol, pas au repos ;
 *  - le clic droit et les trois points ouvrent le MÊME menu (mêmes entrées, même ordre) ;
 *  - chaque entrée porte son icône de 16 px ;
 *  - le geste qui détruit est le DERNIER, en rouge, après un trait.
 * LECTURE SEULE : aucune entrée n'est cliquée (Échap referme). Session d'une heure HACHÉE posée puis retirée.
 *
 *   MENUS_URL=http://localhost:7171 [MENUS_BASE=/root/beluga/data/beluga.db] [MENUS_PROJET=<id>] [MENUS_MARQUE=<id>] \
 *     [MENUS_CARTE=<carte dont le fil montre une image>] [MENUS_CREATION=<création du Studio>] \
 *     node scripts/verif-menus-contextuels.mjs
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(RACINE, 'server', 'package.json'));
const Database = require('better-sqlite3');
const ECRAN = process.env.MENUS_URL || 'http://localhost:7099';
const BASE = process.env.MENUS_BASE || '/root/beluga/data/beluga.db';

const echecs = [];
const noter = (nom, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : ' ÉCHEC'}  ${nom}${detail ? ` — ${detail}` : ''}`);
  if (!ok) echecs.push(nom);
};

const db = new Database(BASE);
const projet = process.env.MENUS_PROJET || db.prepare("SELECT project_id FROM cards GROUP BY project_id ORDER BY COUNT(*) DESC LIMIT 1").get()?.project_id;
const marque = process.env.MENUS_MARQUE || db.prepare('SELECT marque_id FROM communication_campagnes WHERE supprime_le IS NULL ORDER BY maj_le DESC LIMIT 1').get()?.marque_id;
const carteAImages =
  process.env.MENUS_CARTE ||
  db.prepare("SELECT a.card_id AS id, c.project_id AS projet FROM messages m JOIN agents a ON a.id = m.agent_id JOIN cards c ON c.id = a.card_id WHERE m.role = 'assistant' AND m.data LIKE '%\"attachments\":[\"%' GROUP BY a.card_id ORDER BY MAX(m.created_at) DESC LIMIT 1").get()?.id;
const projetDeLaCarte = carteAImages ? db.prepare('SELECT project_id FROM cards WHERE id = ?').get(carteAImages)?.project_id : null;
const creation = process.env.MENUS_CREATION || db.prepare('SELECT id FROM studio_creations ORDER BY maj_le DESC LIMIT 1').get()?.id;
const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' AND actif = 1 ORDER BY cree_le LIMIT 1").get()?.id ?? null;
const jeton = crypto.randomBytes(24).toString('hex');
const hache = crypto.createHash('sha256').update(jeton).digest('hex');
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(hache, Date.now(), Date.now() + 3600_000, 'verif-menus-contextuels', admin);
db.close();

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, domain: new URL(ECRAN).hostname, path: '/' }]);
  const page = await contexte.newPage();
  page.setDefaultTimeout(10_000);

  const lireLeMenu = async () => {
    const menu = page.locator('[role="menu"]:visible').first();
    await menu.waitFor({ state: 'visible', timeout: 3000 });
    await page.waitForTimeout(200);
    return menu.evaluate((m) =>
      [...m.querySelectorAll('[role="menuitem"], [role="separator"]')].map((el) =>
        el.getAttribute('role') === 'separator'
          ? { trait: true }
          : {
              texte: el.textContent.trim(),
              icone: (() => { const s = el.querySelector(':scope > svg') ?? el.querySelector(':scope > span > svg'); return s ? Math.round(s.getBoundingClientRect().width) : 0; })(),
              danger: el.hasAttribute('data-menu-danger'),
            },
      ),
    );
  };
  const fermer = async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  };
  const juger = (nom, viaClicDroit, viaPoints) => {
    const textes = (l) => l.filter((e) => !e.trait).map((e) => e.texte).join(' | ');
    noter(`${nom} : clic droit et trois points ouvrent le même menu`, textes(viaClicDroit) === textes(viaPoints), textes(viaClicDroit));
    const entrees = viaClicDroit.filter((e) => !e.trait);
    noter(`${nom} : une icône de 16 px devant chaque entrée`, entrees.every((e) => e.icone === 16), entrees.map((e) => `${e.texte}=${e.icone}`).join(', '));
    const dangers = entrees.filter((e) => e.danger);
    if (dangers.length) {
      const dernier = viaClicDroit[viaClicDroit.length - 1];
      const avant = viaClicDroit[viaClicDroit.length - 2];
      noter(`${nom} : le geste qui détruit est le dernier, après un trait`, !!dernier?.danger && !!avant?.trait);
    }
  };
  /* Un menu sans trois points (piste du Studio, au doigt par l'appui long) ou un menu de page (la création ouverte). */
  const verifierSeul = async (nom, ouvrir) => {
    await ouvrir();
    const entrees = await lireLeMenu();
    await fermer();
    juger(nom, entrees, entrees);
  };
  const verifierLigne = async (nom, ligne, pointsSel, ouvrirPar) => {
    await page.mouse.move(5, 5);
    await page.waitForTimeout(250);
    const points = ligne.locator(pointsSel).first();
    noter(`${nom} : trois points présents`, (await points.count()) === 1);
    const opaciteRepos = await points.evaluate((el) => getComputedStyle(el).opacity);
    await ligne.hover();
    await page.waitForTimeout(400);
    const opaciteSurvol = await points.evaluate((el) => getComputedStyle(el).opacity);
    noter(`${nom} : trois points cachés au repos, visibles au survol`, opaciteRepos === '0' && opaciteSurvol === '1', `${opaciteRepos} → ${opaciteSurvol}`);
    await ouvrirPar.click({ button: 'right' });
    const viaClicDroit = await lireLeMenu();
    await fermer();
    await ligne.hover();
    await points.click();
    const viaPoints = await lireLeMenu();
    await fermer();
    juger(nom, viaClicDroit, viaPoints);
  };

  await page.goto(`${ECRAN}/#projet/${projet}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-tableau-des-taches] tbody tr[data-ligne-de-tableau]').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  const tache = page.locator('[data-tableau-des-taches] tbody tr[data-ligne-de-tableau]').first();
  await verifierLigne('ligne de tâche', tache, '[data-menu-de-tache]', tache.locator('td').first());

  const agent = page.locator('[data-agent-en-cours], [data-agent-en-liste]').first();
  if (await agent.count()) await verifierLigne('ligne d’agent', agent, '[data-menu-agent]', agent.locator('button').first());
  else noter('ligne d’agent présente dans la colonne', false);

  if (marque) {
    await page.goto(`${ECRAN}/#communication2/${marque}`, { waitUntil: 'domcontentloaded' });
    const campagne = page.locator('tr[data-communication-ligne]').first();
    if (await campagne.waitFor({ timeout: 30_000 }).then(() => true, () => false)) {
      await page.waitForTimeout(1000);
      await verifierLigne('ligne de campagne', campagne, '[data-v2-trois-points]', campagne.locator('td').nth(1));
    } else noter('ligne de campagne présente', false, 'tableau des campagnes introuvable');
  }

  await page.goto(`${ECRAN}/#coffre`, { waitUntil: 'domcontentloaded' });
  const dossier = page.locator('[data-coffre-dossier]:visible').first();
  if (await dossier.waitFor({ timeout: 30_000 }).then(() => true, () => false)) {
    await page.waitForTimeout(800);
    /* En colonnes, la ligne EST le repère ; en liste, c'est sa première rangée. */
    const ligne = (await dossier.locator(':scope > div').count()) ? dossier.locator(':scope > div').first() : dossier;
    await verifierLigne('dossier du coffre-fort', ligne, '[data-coffre-dossier-actions]', ligne.locator('[data-coffre-dossier-bascule]'));
    await fermer();
  } else noter('dossier du coffre-fort présent', false);

  await page.goto(`${ECRAN}/#projet/${projet}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-reglages', { detail: { page: 'serveur' } })));
  const fichier = page.locator('[data-element-lourd]:visible').first();
  if (await fichier.waitFor({ timeout: 30_000 }).then(() => true, () => false)) {
    await fichier.scrollIntoViewIfNeeded();
    await verifierLigne('fichier lourd du serveur', fichier, '[data-menu-element]', fichier.locator('button').first());
    await fermer();
  } else noter('fichier lourd du serveur présent', false, 'relevé du disque absent');

  if (carteAImages && projetDeLaCarte) {
    await page.goto(`${ECRAN}/#projet/${projetDeLaCarte}/tache/${carteAImages}`, { waitUntil: 'domcontentloaded' });
    const calque = page.locator('[data-menu-du-media-du-fil]:visible').last();
    if (await calque.waitFor({ timeout: 30_000 }).then(() => true, () => false)) {
      await calque.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      const hote = calque.locator('xpath=..');
      await verifierLigne('média du fil', hote, '[data-menu-actions^="media-"]', hote);
    } else noter('média du fil présent', false);
  }

  await page.goto(`${ECRAN}/#espace`, { waitUntil: 'domcontentloaded' });
  const fiche = page.locator('[data-fiche-client]:visible').first();
  if (await fiche.waitFor({ timeout: 30_000 }).then(() => true, () => false)) {
    await fiche.click();
    await page.waitForTimeout(2500);
    const client = decodeURIComponent(new URL(page.url()).hash.split('/')[1] ?? '');
    /* La fiche ouverte au clic reste en volet : on recharge sur le tableau du client seul. */
    await page.goto(`${ECRAN}/#espace/${encodeURIComponent(client)}`, { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const vignette = page.locator('[data-cadre-vignette]:visible').first();
    if (await vignette.waitFor({ timeout: 30_000 }).then(() => true, () => false)) {
      await page.waitForTimeout(800);
      await verifierLigne('demande de l’espace client', vignette, '[data-menu-actions="vignette"]', vignette.locator('[data-ouvrir-demande]'));
    } else noter('demande de l’espace client présente', false);
  } else noter('fiche client présente dans l’espace', false);

  if (creation) {
    await page.goto(`${ECRAN}/#studio/${creation}`, { waitUntil: 'domcontentloaded' });
    const piste = page.locator('[data-studio-nom-piste]:visible').first();
    if (await piste.waitFor({ timeout: 30_000 }).then(() => true, () => false)) {
      await page.waitForTimeout(1000);
      await verifierSeul('piste du Studio (clic droit)', () => piste.locator('[data-studio-nom-de-piste]').click({ button: 'right' }));
      await verifierSeul('création ouverte du Studio', () => page.locator('[data-studio-menu-creation]:visible').first().click());
    } else noter('piste du Studio présente', false);
  }
} finally {
  await navigateur.close();
  const d = new Database(BASE);
  d.prepare('DELETE FROM sessions WHERE token = ?').run(hache);
  d.close();
}
console.log(echecs.length ? `\n${echecs.length} échec(s)` : '\nTout est bon.');
process.exit(echecs.length ? 1 : 0);
