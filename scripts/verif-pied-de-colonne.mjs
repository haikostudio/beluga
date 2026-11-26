#!/usr/bin/env node
/**
 * LA COLONNE DE GAUCHE : LE LOGO DE BELUGA ET LE PIED DE COLONNE
 * (`web/src/components/sidebar.tsx`), dans un VRAI navigateur, sur son PROPRE
 * démon (base neuve, port libre : le démon de production n'est pas touché,
 * aucun moteur appelé).
 *
 *   node scripts/verif-pied-de-colonne.mjs
 *
 * LA COLONNE EST CONTEXTUELLE (retouches du 11/10/2026) : elle ne liste les
 * projets que sur les TABLEAUX DE BORD (`#en-route`) ; dans un projet, elle
 * laisse la place à ses options. Les mesures de la liste se prennent donc là.
 *
 * Ce qui est prouvé, colonne dépliée puis rétrécie :
 *  1. la ligne de Beluga (l'espace de développement) garde son favicon quand
 *     un repère d'état s'affiche : le repère se pose EN INCRUSTATION sur son
 *     coin, il ne prend plus sa place ;
 *  2. « Nouvel agent » est en tête, au-dessus de l'intitulé « Projets » ; plus de bouton « Tableaux de bord » ;
 *  3. le bouton des services (quatre carrés) a QUITTÉ la colonne : il ouvre le
 *     fil d'Ariane, tout à gauche de la barre d'en-tête, et son panneau — un
 *     menu, ouvert au clic — se pose sous lui, entier dans l'écran ;
 *  4. « Redémarrer » a quitté le pied de colonne, puis le bandeau, puis le menu
 *     des trois points (demande du 11/10/2026) : c'est un bouton de la page
 *     « Serveur » des réglages. Son état se lit fenêtre fermée, sur
 *     un point de 8 px à cheval sur le coin haut droit du bouton des RÉGLAGES,
 *     au pied de la colonne — dans les deux états de la colonne ;
 *  5. les options d'un projet — dans la colonne de gauche, qui a remplacé le
 *     bouton « … » du tableau sur ordinateur — ne portent ni ce point, ni le
 *     redémarrage, ni le terminal.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_PIED_PORT || 7236);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-pied-de-colonne-',
  port: PORT,
});
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const ASIDE = 'aside[data-zone="gauche"]';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton), maintenant, maintenant + 3600_000, 'vérification pied de colonne',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  // LE DÉMON D'ESSAI DÉCLARE LUI-MÊME SON ESPACE DE DÉVELOPPEMENT au démarrage
  // (le dépôt d'où il part, marque `isSelf`) : c'est SA ligne que la colonne
  // affiche. En poser un second ici laissait la carte rendue sur un projet que
  // la colonne ne montre pas comme espace de développement — « repère 0 ».
  const dejaLa = db
    .prepare('SELECT id, data FROM projects WHERE archived = 0')
    .all()
    .find((ligne) => JSON.parse(ligne.data).isSelf === true);
  const beluga = dejaLa?.id ?? 'p-beluga';
  const projets = [
    ...(dejaLa ? [] : [{ id: 'p-beluga', name: 'Beluga essai', isSelf: true }]),
    { id: 'p-client', name: 'Projet client', isSelf: false },
  ];
  projets.forEach((p, i) => {
    const projet = {
      ...p, path: DEPOT, defaultEngine: 'claude', rank: i + 1, archived: false,
      createdAt: maintenant, updatedAt: maintenant,
    };
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);
  });
  // Un rendu non consulté sur Beluga : le repère d'état s'affiche sur sa ligne.
  const carte = { id: 'c-rendue', projectId: beluga, title: 'Carte rendue', renduA: maintenant - 1000 };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, 'to_deploy', 1, ?, ?, ?, ?)`,
  ).run(carte.id, carte.projectId, carte.title, JSON.stringify(carte), maintenant, maintenant);
  db.close();
}

function replier(reduite) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  // La clé du réglage : `CLE_COLONNE_REDUITE` (`web/src/components/quota-bar.tsx`),
  // qui a remplacé « sidebar.reduite » avec la colonne à bande d'icônes.
  db.prepare(
    `INSERT INTO preferences (key, value, updated_at) VALUES ('colonne.reduite', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(reduite), Date.now());
  db.close();
}

const boite = (page, selecteur) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { haut: r.top, bas: r.bottom, gauche: r.left, droite: r.right, centre: r.left + r.width / 2, largeur: r.width };
  }, selecteur);

async function logoDeBeluga(page, forme) {
  const favicon = await page.locator(`${ASIDE} [data-espace-dev] [data-espace-dev-favicon]`).count();
  const repere = await page.locator(`${ASIDE} [data-espace-dev] [data-repere-robot]`).count();
  noter(`${forme} : le favicon de Beluga reste affiché`, favicon === 1, `favicon ${favicon}`);
  noter(`${forme} : le repère d'état est posé à côté, en incrustation`, repere >= 1, `repère ${repere}`);
  const logo = await boite(page, `${ASIDE} [data-espace-dev-favicon]`);
  const pastille = await boite(page, `${ASIDE} [data-espace-dev] [data-repere-robot]`);
  noter(
    `${forme} : le repère chevauche le coin haut droit du logo`,
    !!logo && !!pastille && pastille.gauche > logo.gauche && pastille.haut < logo.haut + 2,
    JSON.stringify({ logo, pastille }),
  );
}

const REGLAGES = `${ASIDE} [data-pied-colonne] [data-reglages-menu]`;

/**
 * « Redémarrer » vit dans les RÉGLAGES (page « Serveur »), plus dans
 * le menu des trois points, et son état se lit fenêtre fermée : un point de
 * 8 px à cheval sur le coin haut droit du bouton des réglages, au pied de la
 * colonne — comme celui de la cloche.
 */
async function redemarrerDansLesReglages(page, etat) {
  noter(`${etat} : plus de « Redémarrer » au pied de la colonne`, (await page.locator(`${ASIDE} [data-bouton-redemarrage]`).count()) === 0);
  noter(`${etat} : plus de « Redémarrer » à l'écran, réglages fermés`, (await page.locator('[data-bouton-redemarrage]').count()) === 0);
  noter(
    `${etat} : le bouton des réglages est au pied de la colonne, visible`,
    (await page.locator(REGLAGES).count()) === 1 &&
      (await page.locator(REGLAGES).isVisible()) &&
      (await page.locator(REGLAGES).getAttribute('aria-label')) === 'Réglages',
  );
  const constat = await page.evaluate((selecteur) => {
    const bouton = document.querySelector(selecteur);
    const point = bouton?.querySelector('[data-point-redemarrage]');
    if (!bouton || !point) return null;
    const rb = bouton.getBoundingClientRect();
    const rp = point.getBoundingClientRect();
    // Le cadre INTÉRIEUR du bouton : sa boîte moins son liseré, s'il en a un.
    const style = getComputedStyle(bouton);
    const droite = rb.right - parseFloat(style.borderRightWidth);
    const haut = rb.top + parseFloat(style.borderTopWidth);
    return {
      // À cheval sur le coin : 2 px hors du cadre intérieur, le reste dedans.
      coinHautDroit:
        Math.abs(rp.right - droite - 2) <= 0.5 && Math.abs(haut - rp.top - 2) <= 0.5 && rp.left < droite && rp.bottom > haut,
      taille: Math.round(rp.width),
      etat: point.getAttribute('data-etat-redemarrage'),
      ailleurs: document.querySelectorAll('[data-point-redemarrage]').length - 1,
    };
  }, REGLAGES);
  noter(`${etat} : le point d'état est à cheval sur le coin haut droit du bouton des réglages`, !!constat?.coinHautDroit && constat.taille === 8, JSON.stringify(constat));
  noter(`${etat} : ce point est le seul à l'écran, plus aucun dans la barre d'en-tête`, constat?.ailleurs === 0 && (await page.locator('header [data-point-redemarrage]').count()) === 0, JSON.stringify(constat));

  await page.locator(REGLAGES).click();
  await page.locator('[data-modale-reglages]').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('[data-menu-reglages] [data-page-menu="serveur"]').click();
  await page.locator('[data-page-reglages="serveur"] [data-reglages-serveur]').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(500);
  const bouton = page.locator('[data-reglages-serveur] [data-bouton-redemarrage="reglages"]');
  noter(
    `${etat} : « Redémarrer » est un bouton de la page « Serveur » des réglages, au même état que le point`,
    (await bouton.count()) === 1 &&
      (await page.locator('[data-bouton-redemarrage]').count()) === 1 &&
      (await bouton.getAttribute('data-etat-redemarrage')) === constat?.etat,
    `${await bouton.count()} bouton(s), état « ${await bouton.getAttribute('data-etat-redemarrage').catch(() => '')} »`,
  );
  noter(
    `${etat} : …juste au-dessus du terminal du serveur`,
    await page.evaluate(() => {
      const zone = document.querySelector('[data-reglages-serveur]');
      const redemarrer = zone?.querySelector('[data-bouton-redemarrage="reglages"]');
      const terminal = zone?.querySelector('[data-terminal-bouton]');
      if (!redemarrer || !terminal) return false;
      // La LIGNE du redémarrage : son plus haut ancêtre qui ne contient pas le terminal.
      let ligne = redemarrer;
      while (ligne.parentElement && !ligne.parentElement.contains(terminal)) ligne = ligne.parentElement;
      return ligne.nextElementSibling?.contains(terminal) ?? false;
    }),
  );
  if (etat === 'dépliée') await page.screenshot({ path: '/tmp/pied-de-colonne-reglages-serveur.png' });
  await page.keyboard.press('Escape');
  await page.locator('[data-modale-reglages]').waitFor({ state: 'detached', timeout: 10000 });
  await page.waitForTimeout(300);
}

/**
 * LES OPTIONS D'UN PROJET NE PORTENT RIEN DU SERVEUR. Sur ordinateur, le bouton
 * « … » du tableau a laissé la place à la colonne de gauche, qui porte les
 * options du projet ouvert (`data-options-du-projet`) : absentes d'un service,
 * on les retrouve sur un projet, et on vérifie que ni le point de redémarrage,
 * ni l'entrée « Redémarrer », ni le terminal n'y sont restés.
 */
const OPTIONS = `${ASIDE} [data-colonne-de-service] [data-options-du-projet]`;

async function optionsDuProjetSansLeServeur(page) {
  // Un service n'a pas d'options de projet : ni bouton « … », ni lignes dans la colonne.
  await page.goto(`${BASE}/#surveillance`, { waitUntil: 'domcontentloaded' });
  const surLeService = await page
    .waitForFunction(() => location.hash === '#surveillance' && /Surveillance/.test(document.querySelector('[data-entete-de-zone]')?.textContent ?? ''), null, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(500);
  noter(
    'hors d’un projet (le service Surveillance), ni bouton « … » ni options de projet',
    surLeService &&
      (await page.locator('[data-menu-general]').count()) === 0 &&
      (await page.locator('[data-options-du-projet]').count()) === 0,
  );
  await page.goto(`${BASE}/#projet/p-client`, { waitUntil: 'domcontentloaded' });
  const la = await page
    .locator(`${OPTIONS} [data-menu-fichiers]`)
    .waitFor({ state: 'visible', timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  noter(
    'sur le tableau d’un projet, ses options sont dans la colonne ; un seul « … » en haut à droite range ses réglages',
    la && (await page.locator('[data-menu-general]').count()) === 1,
    `${await page.locator('[data-menu-general]').count()} bouton(s) « … »`,
  );
  if (!la) return;
  await page.waitForTimeout(800);
  noter(
    'les options du projet ne portent pas le point de redémarrage',
    (await page.locator(`${OPTIONS} [data-point-redemarrage], header [data-point-redemarrage], [data-entete-de-zone] [data-point-redemarrage]`).count()) === 0 &&
      (await page.locator('header button[aria-label="Menu"]').count()) === 0,
  );
  const lignes = await page.locator(`${OPTIONS} [data-option-du-projet]`).evaluateAll((els) => els.map((el) => el.textContent.trim()));
  noter(
    'elles ne portent ni « Redémarrer » ni le terminal du serveur',
    lignes.length > 0 &&
      (await page.locator(`${OPTIONS} [data-bouton-redemarrage], ${OPTIONS} [data-terminal-bouton]`).count()) === 0 &&
      lignes.filter((texte) => /redémarr|terminal/i.test(texte)).length === 0,
    lignes.join(' / '),
  );
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1500, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));

  /* ---------------------------- DÉPLIÉE ---------------------------- */
  // LA COLONNE NE LISTE LES PROJETS QUE SUR LES TABLEAUX DE BORD : à l'accueil,
  // le dernier projet s'ouvre et la colonne porte SES options.
  await page.goto(`${BASE}/#en-route`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator(`${ASIDE} [data-espace-dev]`).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1500);
  await logoDeBeluga(page, 'dépliée');

  /* La ligne « Tableaux de bord » a quitté la colonne (12/10/2026) : on y va par
     le fil d'Ariane, le menu du titre ou la grille des services. La colonne
     s'ouvre sur « Nouvel agent », puis sur l'intitulé « Projets ». */
  const nouvelAgent = await boite(page, `${ASIDE} [data-bouton-tableaux-de-bord]`);
  // L'intitulé « Projets » de la liste n'a pas de repère à lui : on le prend
  // par son texte. `data-titre-projets` désigne désormais la TÊTE de la colonne
  // (le nom de l'application), qui est au-dessus de tout.
  const titre = await page
    .locator(`${ASIDE} [data-drop-root] span`, { hasText: /^Projets$/ })
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { haut: r.top, bas: r.bottom };
    })
    .catch(() => null);
  noter(
    'la colonne n’a plus de bouton « Tableaux de bord »',
    (await page.locator(`${ASIDE} [data-ouvrir-en-route]`).count()) === 0,
  );
  noter(
    '« Nouvel agent » est au-dessus de l’intitulé « Projets »',
    !!nouvelAgent && !!titre && nouvelAgent.bas <= titre.haut + 1,
    JSON.stringify({ nouvelAgent: nouvelAgent && { haut: nouvelAgent.haut, bas: nouvelAgent.bas }, titre }),
  );

  // LE BOUTON DES SERVICES A QUITTÉ LA COLONNE (demande du 11/10/2026) : il
  // ouvre le fil d'Ariane, tout à gauche de la barre d'en-tête. L'affirmation
  // « le menu des services est sous les projets » visait son ancienne place.
  const SERVICES = '[data-entete-de-zone] [data-avant-le-fil] [data-navigation-compacte]';
  const nav = await boite(page, SERVICES);
  const fil = await boite(page, '[data-entete-de-zone] [data-fil-d-ariane]');
  noter(
    'le bouton des services n’est plus dans la colonne',
    (await page.locator(`${ASIDE} [data-navigation-compacte]`).count()) === 0 &&
      (await page.locator('[data-navigation-compacte]').count()) === 1,
    `${await page.locator('[data-navigation-compacte]').count()} bouton(s)`,
  );
  noter(
    'il ouvre le fil d’Ariane, tout à gauche de la barre d’en-tête',
    !!nav && !!fil && nav.droite <= fil.gauche + 1 && nav.haut < fil.bas && nav.bas > fil.haut,
    JSON.stringify({ bouton: nav, fil }),
  );
  await redemarrerDansLesReglages(page, 'dépliée');

  // Son panneau est un MENU : il s'ouvre au clic (plus au survol), hors de la
  // colonne, SOUS son bouton (il vit en haut de l'écran, plus au pied).
  // Un panneau qui ne s'ouvre pas est un REFUS noté, pas un arrêt du contrôle :
  // la colonne rétrécie et les options du projet doivent encore être jugées derrière.
  await page.locator(SERVICES).click();
  const ouvert = await page
    .locator('[data-navigation-panneau="ouvert"]')
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(400);
  noter(
    'le panneau des services s’ouvre au clic, hors de la colonne',
    ouvert && (await page.locator(`${ASIDE} [data-navigation-panneau]`).count()) === 0,
  );
  const panneau = await page.evaluate(() => {
    const el = document.querySelector('[data-navigation-panneau="ouvert"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { haut: r.top, bas: r.bottom, gauche: r.left, droite: r.right, ecran: { largeur: innerWidth, hauteur: innerHeight } };
  });
  const navOuvert = await boite(page, SERVICES);
  noter(
    'le panneau s’ouvre sous son bouton, entier dans l’écran',
    !!panneau &&
      !!navOuvert &&
      panneau.haut >= navOuvert.bas - 1 &&
      panneau.haut >= 0 &&
      panneau.gauche >= 0 &&
      panneau.droite <= panneau.ecran.largeur &&
      panneau.bas <= panneau.ecran.hauteur,
    JSON.stringify({ panneau, bouton: navOuvert }),
  );
  await page.screenshot({ path: '/tmp/pied-de-colonne-depliee.png' });
  await page.keyboard.press('Escape');
  await page.locator('[data-navigation-panneau]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined);
  await page.mouse.move(1200, 450);
  await page.waitForTimeout(600);

  /* ---------------------------- RÉTRÉCIE --------------------------- */
  replier(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator(`${ASIDE} [data-panneau-projets="bande"]`).waitFor({ state: 'attached', timeout: 30000 });
  await page.mouse.move(1200, 450);
  await page.waitForTimeout(1500);
  await logoDeBeluga(page, 'rétrécie');

  await redemarrerDansLesReglages(page, 'rétrécie');
  await page.screenshot({ path: '/tmp/pied-de-colonne-retrecie.png' });

  /* --------------- LES OPTIONS DU PROJET, EN DERNIER ---------------- */
  // En dernier : changer d'écran sous la colonne ne doit pas troubler les
  // mesures d'avant.
  await optionsDuProjetSansLeServeur(page);

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  console.log('(captures : /tmp/pied-de-colonne-depliee.png et -retrecie.png)');
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.slice(-20).join(''));
  process.exit(1);
});
