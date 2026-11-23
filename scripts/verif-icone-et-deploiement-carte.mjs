#!/usr/bin/env node
/**
 * LE RETOUR AU TABLEAU DU PROJET ET LE BOUTON « DÉPLOYER LE LOT » DE LA PAGE
 * D'UNE CARTE, vérifiés dans un vrai navigateur, sur téléphone puis sur
 * ordinateur :
 *
 *  1. le projet du fil d'Ariane, devant le titre, referme la carte et montre le
 *     TABLEAU du projet (adresse « projet/<id> », colonne « À déployer » à
 *     l'écran) — sur téléphone, où le fil ne garde que le titre, c'est la
 *     flèche de retour de la barre d'en-tête qui y ramène ;
 *  2. une carte « À déployer » porte le bouton « Déployer » (un seul clic, sans
 *     liste) ; une carte d'une autre colonne ne le porte pas ;
 *  3. allumé, le bouton ouvre la fenêtre de SÉLECTION du lot, toutes les cases
 *     cochées — et on la referme sans jamais cliquer « Déployer » ;
 *  4. un agent du projet mis « au travail » (dans le seul magasin du
 *     navigateur, `belugaEssai.agent`) éteint le bouton, qui dit pourquoi.
 *
 * RECALÉ SUR LA REFONTE (11/10/2026). La carte s'ouvre en PAGE
 * (`[data-page-carte]`) : l'icône du projet (`data-ouvrir-tableau-projet`) a
 * laissé la place au cran du projet dans le fil d'Ariane. Et depuis le
 * 02/10/2026 la fin de tâche n'avait qu'un bouton « Actions de la tâche » ;
 * il est devenu « Déployer » (`data-geste="deployer-lot"`), sans liste.
 *
 * Rien ne part au démon hormis des lectures : `deploy.selection` ne fait que
 * prévoir. Une session d'une heure est fabriquée puis retirée.
 *
 *   HAIKO_CARTE_URL=http://localhost:7099 node scripts/verif-icone-et-deploiement-carte.mjs
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADRESSE = process.env.HAIKO_CARTE_URL || 'http://localhost:7099';
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';
const require = createRequire(import.meta.url);
const ouvrirBase = (options) =>
  require(path.join(DONNEES, '../node_modules/better-sqlite3'))(cheminDeLaBaseServie(DONNEES), options);

const echecs = [];
const constats = [];
const verifier = (ok, message) => (ok ? constats.push(message) : echecs.push(message));

/* Une carte « À déployer » d'un projet dont la procédure de déploiement est
   écrite, et une carte d'une autre colonne du même projet. */
const lecture = ouvrirBase({ readonly: true });
const candidates = lecture
  .prepare("SELECT id, project_id AS projectId, title FROM cards WHERE column_key = 'to_deploy' ORDER BY updated_at DESC")
  .all();
const autreCarte = (projectId) =>
  lecture
    .prepare("SELECT id FROM cards WHERE project_id = ? AND column_key != 'to_deploy' ORDER BY updated_at DESC LIMIT 1")
    .get(projectId);
/* Les agents les plus récents : l'écran ne charge pas les vieux, et le point
   d'essai ne patche qu'un agent qu'il connaît. */
const agentsDuProjet = (projectId) =>
  lecture.prepare('SELECT id FROM agents WHERE project_id = ? ORDER BY rowid DESC LIMIT 30').all(projectId);
const agentDuProjet = (projectId) => agentsDuProjet(projectId)[0];
const carte = candidates.find((c) => autreCarte(c.projectId) && agentDuProjet(c.projectId)) ?? candidates[0];
if (!carte) {
  console.error('Aucune carte « À déployer » dans la base servie : rien à vérifier.');
  process.exit(1);
}
const planifiee = autreCarte(carte.projectId);
/* L'ICÔNE DU PROJET ne se dessine que pour un projet ACTIF : la carte « À
   déployer » ci-dessus peut appartenir à un projet archivé, qui n'est plus
   dans la liste. Les points 1, 1 bis et 1 ter lisent donc la carte la plus
   récente d'un projet actif (la même, à défaut). */
const carteIcone =
  lecture
    .prepare(
      "SELECT c.id, c.project_id AS projectId FROM cards c JOIN projects p ON p.id = c.project_id WHERE p.archived = 0 AND c.column_key != 'archived' ORDER BY c.updated_at DESC LIMIT 1",
    )
    .get() ?? carte;
const agents = agentsDuProjet(carte.projectId).map((a) => a.id);
lecture.close();

const cookie = crypto.randomBytes(24).toString('hex');
const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
{
  const db = ouvrirBase();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3_600_000,
    'vérification icône et déploiement de carte',
  );
  db.close();
}

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const [nom, viewport] of [
    ['téléphone', { width: 390, height: 844 }],
    ['ordinateur', { width: 1400, height: 900 }],
  ]) {
    const contexte = await navigateur.newContext({ viewport });
    await contexte.addCookies([{ name: 'beluga_session', value: cookie, domain: 'localhost', path: '/' }]);
    const page = await contexte.newPage();
    const telephone = viewport.width < 640;
    const ouvrirLaCarte = async (cardId, projectId = carte.projectId) => {
      await page.goto(`${ADRESSE}/#projet/${projectId}/tache/${cardId}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.belugaEssai?.pret?.(), null, { timeout: 60_000 });
      await page.waitForSelector(`[data-page-carte="${cardId}"]`, { timeout: 30_000 });
    };
    /* LE CHEMIN VERS LE TABLEAU. Sur ordinateur : l'icône du projet, devant le
       titre, dans le fil d'Ariane de la carte (le NOM du projet, lui, ouvre la
       liste des projets). Sur téléphone, la flèche de retour de la barre
       d'en-tête referme la carte sur le tableau de son projet — et l'icône,
       seul repère du projet à cette largeur, y mène aussi (point 1 bis). */
    /* Plus de flèche de retour sur téléphone (15/10/2026) : l'icône du projet,
       dans le fil d'Ariane, mène au tableau, sur les deux tailles d'écran. */
    const VERS_LE_TABLEAU = '[data-page-carte] [data-fil-d-ariane] [data-icone-du-cran]';
    /* « DÉPLOYER » EST DIRECTEMENT SUR LA CARTE, sans liste. Rend le bouton,
       ou `null` quand la carte ne le porte pas. */
    const boutonDuLot = async () => {
      return page.waitForSelector('[data-geste="deployer-lot"]', { timeout: 5_000 }).catch(() => null);
    };

    /* 1. Le projet du fil d'Ariane mène au tableau. */
    await ouvrirLaCarte(carteIcone.id, carteIcone.projectId);
    /* Sur téléphone (06/11/2026), l'icône est dans l'angle du ☰ : la carte se referme par Échap. */
    if (telephone) await page.keyboard.press('Escape');
    else await page.click(VERS_LE_TABLEAU);
    await page.waitForSelector('[data-page-carte]', { state: 'detached', timeout: 10_000 }).catch(() => {});
    const apresIcone = await page.evaluate(() => ({
      hash: window.location.hash.replace(/^#/, ''),
      tiroir: !!document.querySelector('[data-page-carte]'),
      /* Le pied de rangée (`data-pied-rangee`) a disparu avec les rangées :
         le tableau ne se lit plus qu'en colonnes. */
      rangee: !!document.querySelector('[data-column="to_deploy"]'),
    }));
    verifier(!apresIcone.tiroir, `${nom} : ${telephone ? 'Échap' : 'le projet du fil d’Ariane'} referme la carte`);
    verifier(apresIcone.hash === `projet/${carteIcone.projectId}`, `${nom} : l'adresse est celle du tableau du projet (${apresIcone.hash})`);
    verifier(apresIcone.rangee, `${nom} : la colonne « À déployer » du tableau est à l'écran`);

    /* 1 bis. L'ICÔNE DU PROJET PRÉCÈDE SON NOM DANS LA BARRE, sur téléphone
       comme sur ordinateur (où le nom du cran est masqué sous 640 px), tient
       dans la hauteur de la barre, et son clic ouvre le même tableau. */
    await ouvrirLaCarte(carteIcone.id, carteIcone.projectId);
    if (telephone) {
      /* SUR TÉLÉPHONE, L'ICÔNE DU PROJET SE POSE DANS L'ANGLE DU BOUTON MENU (06/11/2026). */
      const dansLAngle = await page.evaluate(
        () => !!document.querySelector('[data-page-carte] [data-menu-principal] [data-insigne-du-menu] :is([data-favicon-projet],[data-initiales-projet],[data-pile-favicons])'),
      );
      verifier(dansLAngle, `${nom} : l'icône du projet est dans l'angle du bouton menu`);
      await page.screenshot({ path: '/tmp/icone-projet-telephone.png', clip: { x: 0, y: 0, width: viewport.width, height: 70 } });
    }
    const icone = page.locator('[data-page-carte] [data-fil-d-ariane] [data-icone-du-cran]');
    if (!telephone) verifier((await icone.count()) === 1, `${nom} : l'icône du projet est dans la barre de la carte`);
    if (!telephone && (await icone.count())) {
      const mesures = await page.evaluate(() => {
        const bouton = document.querySelector('[data-page-carte] [data-fil-d-ariane] [data-icone-du-cran]');
        const barre = bouton.closest('[data-entete-de-zone]').getBoundingClientRect();
        const titre = document.querySelector('[data-page-carte] [data-titre-bandeau]').getBoundingClientRect();
        const b = bouton.getBoundingClientRect();
        return {
          nom: bouton.getAttribute('aria-label'),
          visible: b.width > 0 && b.height > 0,
          dansLaBarre: b.top >= barre.top && b.bottom <= barre.bottom,
          avantLeTitre: b.right <= titre.left + 1,
          titreVisible: titre.width > 40 && titre.right <= window.innerWidth,
          image: !!bouton.querySelector('[data-favicon-projet],[data-initiales-projet],[data-pile-favicons]'),
        };
      });
      verifier(mesures.visible && mesures.image, `${nom} : l'icône est dessinée (favicon, pile ou initiales)`);
      verifier(!!mesures.nom, `${nom} : le bouton porte le nom du projet pour les lecteurs d'écran (${mesures.nom})`);
      verifier(mesures.dansLaBarre, `${nom} : l'icône tient dans la hauteur de la barre`);
      verifier(mesures.avantLeTitre, `${nom} : l'icône est posée avant le titre`);
      verifier(mesures.titreVisible, `${nom} : le titre reste lisible et dans l'écran`);
      await page.screenshot({ path: `/tmp/icone-projet-${telephone ? 'telephone' : 'ordinateur'}.png`, clip: { x: 0, y: 0, width: viewport.width, height: 70 } });
      await icone.click();
      await page.waitForSelector('[data-page-carte]', { state: 'detached', timeout: 10_000 }).catch(() => {});
      const hash = await page.evaluate(() => window.location.hash.replace(/^#/, ''));
      verifier(hash === `projet/${carteIcone.projectId}`, `${nom} : un clic sur l'icône ouvre le tableau du projet (${hash})`);
    }

    /* 1 ter. LE NOM DU PROJET GARDE SA LISTE : sur ordinateur, un clic sur le
       nom n'emmène pas au tableau, il ouvre la liste des projets, et la carte
       reste à l'écran. */
    if (!telephone) {
      await ouvrirLaCarte(carteIcone.id, carteIcone.projectId);
      const nomDuProjet = page.locator('[data-page-carte] [data-fil-d-ariane] button[data-chemin-a-menu]');
      verifier((await nomDuProjet.count()) === 1, `${nom} : le nom du projet est un bouton à liste`);
      if (await nomDuProjet.count()) {
        await nomDuProjet.click();
        await page.waitForSelector('[data-chemin-a-menu][data-state="open"]', { timeout: 5_000 }).catch(() => {});
        const etat = await page.evaluate(() => ({
          ouvert: !!document.querySelector('[data-chemin-a-menu][data-state="open"]'),
          carte: !!document.querySelector('[data-page-carte]'),
        }));
        verifier(etat.ouvert, `${nom} : un clic sur le nom du projet ouvre la liste des projets`);
        verifier(etat.carte, `${nom} : la carte reste à l'écran derrière la liste`);
        await page.keyboard.press('Escape');
      }
    }

    /* 2. Seule une carte « À déployer » porte le bouton. */
    if (planifiee) {
      await ouvrirLaCarte(planifiee.id);
      verifier(
        !(await boutonDuLot()),
        `${nom} : une carte d'une autre colonne ne porte pas « Déployer »`,
      );
    }
    await ouvrirLaCarte(carte.id);
    if (process.env.HAIKO_CAPTURE) await page.screenshot({ path: `${process.env.HAIKO_CAPTURE}-${viewport.width}.png` });
    const bouton = await boutonDuLot();
    verifier(!!bouton, `${nom} : la carte « À déployer » porte « Déployer », sans liste`);
    if (!bouton) {
      await contexte.close();
      continue;
    }

    /* 3. Allumé, il ouvre la sélection du lot, tout coché. */
    const eteint = await bouton.getAttribute('data-raison-eteint');
    if (eteint === null) {
      await bouton.click();
      const fenetre = await page
        .waitForSelector('[data-selection-deploiement]', { timeout: 15_000 })
        .catch(() => null);
      verifier(!!fenetre, `${nom} : le bouton ouvre la fenêtre de sélection du lot`);
      if (fenetre) {
        const cases = await page.$$eval('[data-case-selection]', (els) =>
          els.map((el) => el.getAttribute('aria-checked') ?? String(el.checked)),
        );
        verifier(cases.length > 0 && cases.every((v) => v === 'true'), `${nom} : toutes les cartes du lot sont cochées (${cases.length})`);
        verifier(
          !(await page.$('[data-page-carte]')),
          `${nom} : la carte s'est refermée pour laisser voir la fenêtre`,
        );
        await page.keyboard.press('Escape');
      }
      await ouvrirLaCarte(carte.id);
      await boutonDuLot();
    } else {
      constats.push(`${nom} : bouton éteint au départ (« ${await bouton.getAttribute('title')} ») — sélection non essayée`);
    }

    /* 4. Un agent au travail l'éteint, et le bouton dit pourquoi. */
    const patche = await page.evaluate(
      (ids) => ids.some((id) => window.belugaEssai.agent(id, { status: 'running', title: 'Agent d’essai' })),
      agents,
    );
    verifier(patche, `${nom} : un agent du projet a pu être mis au travail dans le navigateur`);
    if (patche) {
      await page.waitForSelector('[data-geste="deployer-lot"][data-raison-eteint]', { timeout: 5_000 }).catch(() => {});
      const titre = await page.getAttribute('[data-geste="deployer-lot"]', 'title', { timeout: 5_000 }).catch(() => null);
      verifier(/travaille encore/.test(titre ?? ''), `${nom} : un agent au travail éteint le bouton et le nomme (${titre})`);
    }
    await contexte.close();
  }
} finally {
  await navigateur.close();
  const db = ouvrirBase();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

for (const c of constats) console.log(`✓ ${c}`);
for (const e of echecs) console.log(`✗ ${e}`);
process.exit(echecs.length ? 1 : 0);
