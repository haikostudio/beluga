#!/usr/bin/env node
/**
 * LE BOUTON « NOUVEL AGENT » DU TABLEAU DE BORD, SUR TÉLÉPHONE ET SUR ORDINATEUR.
 *
 * Le tableau de bord n'est dans aucun projet : le bas de son écran ne porte
 * qu'un bouton plein, « Nouvel agent » (44 px, toute la largeur — plus de
 * barre). Il ouvre la fenêtre des projets (non archivés, du plus récemment
 * actif au plus ancien —
 * `projetsParActivite`, relevé `projects.activite`) ; toucher un projet ouvre
 * une carte d'agent de ce projet, et la refermer vide la range.
 *
 * Un champ de recherche fixe, au-dessus de la liste, la filtre par nom (sans
 * accents ni majuscules, `filtrerProjetsParNom`) ; il ne prend le focus que sur
 * ordinateur, et dit quand aucun projet ne correspond.
 *
 * Un PROJET RÉUNI et ses membres se tiennent ensemble (`projetsEnArbre`) : le
 * bloc prend la place du plus récemment actif des siens, le projet réuni porte
 * la pile des icônes de ses membres, chaque membre est en retrait et relié par
 * une branche ; un membre trouvé seul par la recherche reste une ligne seule.
 *
 * Sur ordinateur, le même geste est la PREMIÈRE LIGNE de la colonne de gauche
 * (`data-ligne-nouvel-agent`), au-dessus de « Tableaux de bord » : elle ouvre
 * la même fenêtre, et n'existe pas dans un projet, où la colonne porte les
 * options du projet. (Le bouton qui flottait au centre bas de la zone du
 * milieu, `data-bouton-nouvel-agent-bureau`, a été retiré à la refonte.)
 *
 * Rien n'est laissé en base : la session d'essai et la carte vide repartent.
 *
 *   HAIKO_NOUVEL_AGENT_URL=http://localhost:7099 node scripts/verif-nouvel-agent-tableau-de-bord.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_NOUVEL_AGENT_URL || 'http://localhost:7099';
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';
const PRINCIPAL = path.resolve(DONNEES, '..');
/** La règle de rangement « un projet réuni, puis ses membres », telle que l'écran jugé l'applique. */
const { projetsEnArbre } = await import(path.join(RACINE, 'shared/dist/index.js'));

/** La base réellement servie : `beluga.db` du dépôt principal (`cheminDeLaBase`, `server/src/config.ts`). */
function cheminDeLaBase() {
  return path.join(DONNEES, 'beluga.db');
}

function ouvrirBase() {
  const require = createRequire(import.meta.url);
  return require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(cheminDeLaBase());
}

function poserSession() {
  const db = ouvrirBase();
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification nouvel agent',
  );
  db.close();
  return cookie;
}

function retirerSession(cookie) {
  const db = ouvrirBase();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
  );
  db.close();
}

const resultats = [];
function record(nom, ok, detail = '') {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  const cookie = poserSession();
  const depart = Date.now();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'beluga_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  let carteCreee = null;
  try {
    // Les deux écrans hors projet : les statistiques, puis les tableaux de
    // bord (« en-route »), où le volet est ensuite essayé.
    for (const vue of ['tableau-de-bord', 'en-route']) {
      await page.goto(`${BASE}/#/${vue}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(4500);
      for (let essai = 0; essai < 3; essai++) {
        if (!(await page.locator('[data-state="open"][aria-hidden="true"]').count())) break;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
      page.setDefaultTimeout(8000);
      /* LE BAS DE L'ÉCRAN (03/11/2026) : hors de tout projet, le + violet du centre EST « Nouvel agent ». */
      const centre = await page.evaluate(() => {
        const b = document.querySelector('nav[data-menu-bas] [data-centre-du-bas="action"]');
        const r = b?.getBoundingClientRect();
        return b ? { nouvelAgent: b.hasAttribute('data-bouton-nouvel-agent'), milieu: Math.abs(r.left + r.width / 2 - window.innerWidth / 2) <= 4, rond: Math.round(r.width) } : null;
      });
      record(`« ${vue} » : le + du centre est « Nouvel agent »`, !!centre && centre.nouvelAgent, JSON.stringify(centre));
      record(`« ${vue} » : il est au milieu de l’écran`, !!centre && centre.milieu, JSON.stringify(centre));
      await page.locator('nav[data-menu-bas] [data-centre-du-bas="action"]').tap();
      await page.waitForTimeout(700);
      if (vue !== 'en-route') {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
    }

    /* Le + du centre, touché sur « en-route », a déjà ouvert le choix du projet. */
    const liste = page.locator('[data-tiroir-nouvel-agent]');
    if (!(await liste.isVisible())) await page.locator('nav[data-menu-bas] [data-bouton-nouvel-agent]').tap();
    await liste.waitFor({ state: 'visible' });
    const affiches = await page.evaluate(() =>
      [...document.querySelectorAll('[data-projet-nouvel-agent]')].map((b) => b.getAttribute('data-projet-nouvel-agent')),
    );

    // L'ordre attendu se relit en base, avec la même règle que l'écran.
    const db = ouvrirBase();
    const projets = db
      .prepare('SELECT id, data FROM projects WHERE archived = 0')
      .all()
      .map((r) => ({ id: r.id, ...JSON.parse(r.data) }));
    const activite = Object.fromEntries(
      db.prepare('SELECT project_id AS id, MAX(updated_at) AS at FROM cards GROUP BY project_id').all().map((r) => [r.id, r.at]),
    );
    db.close();
    const date = (p) => Math.max(activite[p.id] ?? 0, p.lastVisitedAt ?? 0, p.updatedAt ?? 0);
    const parActivite = projets.sort((a, b) => date(b) - date(a) || a.name.localeCompare(b.name));
    const arbre = projetsEnArbre(parActivite);
    const attendus = arbre.map((l) => l.projet.id);
    record('le volet liste tous les projets non archivés', affiches.length === attendus.length, `${affiches.length} / ${attendus.length}`);
    record(
      'les projets vont du plus récemment actif au plus ancien, chaque projet réuni suivi de ses membres',
      affiches.join() === attendus.join(),
      `premiers affichés ${affiches.slice(0, 3).join(', ')} — attendus ${attendus.slice(0, 3).join(', ')}`,
    );

    /* ---------- UN PROJET RÉUNI, SA PILE D'ICÔNES ET SES MEMBRES EN BRANCHE ---------- */
    const membresAttendus = arbre.filter((l) => l.parentId);
    const reunisAttendus = [...new Set(membresAttendus.map((l) => l.parentId))];
    if (!reunisAttendus.length) {
      record('aucun projet réuni à membres dans cette base : rangement en arbre non jugé', true);
    } else {
      const vu = await page.evaluate(() =>
        [...document.querySelectorAll('[data-tiroir-nouvel-agent] > li')].map((li) => {
          const bouton = li.querySelector('[data-projet-nouvel-agent]');
          const icone = bouton.firstElementChild.getBoundingClientRect();
          const branche = li.querySelector('[data-branche-de-liste]');
          const traits = branche ? [...branche.children].map((t) => t.getBoundingClientRect()) : [];
          return {
            id: bouton.getAttribute('data-projet-nouvel-agent'),
            parent: li.getAttribute('data-membre-de'),
            pile: !!bouton.querySelector('[data-pile-favicons]'),
            hauteur: li.getBoundingClientRect().height,
            gaucheIcone: icone.left,
            milieuIcone: (icone.left + icone.right) / 2,
            basIcone: icone.bottom,
            milieuVertical: (icone.top + icone.bottom) / 2,
            branche: branche?.getAttribute('data-branche-de-liste') ?? null,
            gaucheTrait: traits.length ? Math.min(...traits.map((t) => t.left)) : null,
            droiteTrait: traits.length ? Math.max(...traits.map((t) => t.right)) : null,
            hautTrait: traits.length ? Math.min(...traits.map((t) => t.top)) : null,
            basTrait: traits.length ? Math.max(...traits.map((t) => t.bottom)) : null,
            couleurTrait: branche ? getComputedStyle(branche.firstElementChild).borderLeftColor : null,
          };
        }),
      );
      const ligne = (id) => vu.find((l) => l.id === id);
      const faint = await page.evaluate(() => {
        const temoin = document.createElement('span');
        temoin.className = 'border border-faint';
        document.body.appendChild(temoin);
        const couleur = getComputedStyle(temoin).borderLeftColor;
        temoin.remove();
        return couleur;
      });
      record(
        'chaque projet réuni porte la pile des icônes de ses membres, plus une simple initiale',
        reunisAttendus.every((id) => ligne(id)?.pile),
        reunisAttendus.filter((id) => !ligne(id)?.pile).join(', '),
      );
      record(
        'chaque membre dit sous quel projet réuni il est rangé, et porte sa branche',
        membresAttendus.every((l) => ligne(l.projet.id)?.parent === l.parentId && ligne(l.projet.id)?.branche === (l.dernier ? 'dernier' : 'milieu')),
        membresAttendus.filter((l) => ligne(l.projet.id)?.parent !== l.parentId).map((l) => l.projet.id).join(', '),
      );
      record(
        'aucune ligne ordinaire ne porte de branche',
        vu.filter((l) => !l.parent).every((l) => !l.branche),
      );
      record(
        'un membre est en retrait de 20 px par rapport à son projet réuni',
        membresAttendus.every((l) => Math.round(ligne(l.projet.id).gaucheIcone - ligne(l.parentId).gaucheIcone) === 20),
      );
      record(
        'la branche part du milieu de la pile du projet réuni et s’arrête à 2 px de l’icône du membre',
        membresAttendus.every((l) => {
          const m = ligne(l.projet.id);
          const p = ligne(l.parentId);
          return Math.abs(m.gaucheTrait - p.milieuIcone) <= 0.6 && Math.abs(m.gaucheIcone - m.droiteTrait - 2) <= 0.6;
        }),
      );
      record(
        'le trait du premier membre remonte jusque sous la pile, sans la toucher',
        membresAttendus.filter((l) => l.premier).every((l) => {
          const ecart = ligne(l.projet.id).hautTrait - ligne(l.parentId).basIcone;
          return ecart >= 0.5 && ecart <= 3;
        }),
      );
      record(
        'entre deux membres le trait vertical ne laisse aucun trou, et il s’arrête à l’icône du dernier',
        membresAttendus.every((l, i) => {
          const m = ligne(l.projet.id);
          if (l.dernier) return Math.abs(m.basTrait - m.milieuVertical) <= 1;
          const suivant = ligne(membresAttendus[i + 1].projet.id);
          return suivant.hautTrait <= m.basTrait + 0.1;
        }),
      );
      record(
        'la branche suit --faint, et les lignes gardent toutes 40 px',
        membresAttendus.every((l) => ligne(l.projet.id).couleurTrait === faint) && vu.every((l) => Math.round(l.hauteur) === 40),
        `trait ${ligne(membresAttendus[0].projet.id).couleurTrait} / --faint ${faint}`,
      );
      await page.screenshot({ path: path.join(process.env.HAIKO_NOUVEL_AGENT_CAPTURES || '/tmp', 'nouvel-agent-arbre.png') });
    }

    /* ---------- LA RECHERCHE AU-DESSUS DE LA LISTE ---------- */
    const champ = page.locator('[data-recherche-nouvel-agent]');
    record('un champ de recherche est posé au-dessus de la liste', await champ.isVisible());
    // Le fond d'une ligne (survolée ou choisie) a exactement les bords du champ :
    // ni plus large, ni décalé (carte « Coffre-fort : qualité, menu et alignement »).
    const boiteChamp = await champ.boundingBox();
    const boiteLigne = await page.locator(`[data-projet-nouvel-agent="${affiches[0]}"]`).boundingBox();
    record(
      'les lignes de la liste ont les bords du champ de recherche',
      Boolean(
        boiteChamp &&
          boiteLigne &&
          Math.abs(boiteChamp.x - boiteLigne.x) <= 1 &&
          Math.abs(boiteChamp.x + boiteChamp.width - (boiteLigne.x + boiteLigne.width)) <= 1,
      ),
      `champ ${JSON.stringify(boiteChamp)} / ligne ${JSON.stringify(boiteLigne)}`,
    );
    record(
      'sur téléphone, le champ ne prend pas le focus tout seul',
      !(await page.evaluate(() => document.activeElement?.hasAttribute('data-recherche-nouvel-agent'))),
    );
    const aplatir = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const noms = Object.fromEntries(projets.map((p) => [p.id, p.name]));
    const nomVise = noms[affiches[0]] ?? '';
    const morceau = nomVise.slice(0, 3).toUpperCase();
    await champ.fill(morceau);
    await page.waitForTimeout(300);
    const filtres = await page.evaluate(() =>
      [...document.querySelectorAll('[data-projet-nouvel-agent]')].map((b) => b.getAttribute('data-projet-nouvel-agent')),
    );
    // La recherche filtre l'ordre par activité, PUIS l'arbre se repose sur ce qui reste.
    const attendusFiltres = projetsEnArbre(parActivite.filter((p) => aplatir(p.name).includes(aplatir(morceau)))).map(
      (l) => l.projet.id,
    );
    record(
      `taper « ${morceau} » ne garde que les projets qui le contiennent, dans le même ordre`,
      filtres.length > 0 && filtres.join() === attendusFiltres.join(),
      `${filtres.length} affichés / ${attendusFiltres.length} attendus`,
    );
    const hautChamp = (await champ.boundingBox())?.y;
    await page.locator('[data-tiroir-nouvel-agent]').evaluate((ul) => ul.closest('[data-zone-defilement], .overflow-y-auto, [style*="overflow"]')?.scrollBy?.(0, 400));
    record('le champ reste fixe quand la liste défile', (await champ.boundingBox())?.y === hautChamp);
    // Un membre trouvé SANS son projet réuni reste une ligne seule, sans branche :
    // c'est ce qui garde « Entrée choisit la seule ligne restante ».
    const seul = membresAttendus.find(
      (l) => parActivite.filter((p) => aplatir(p.name).includes(aplatir(l.projet.name))).length === 1,
    );
    if (seul) {
      await champ.fill(seul.projet.name);
      await page.waitForTimeout(300);
      const restant = await page.evaluate(() =>
        [...document.querySelectorAll('[data-tiroir-nouvel-agent] > li')].map((li) => ({
          id: li.querySelector('[data-projet-nouvel-agent]').getAttribute('data-projet-nouvel-agent'),
          parent: li.getAttribute('data-membre-de'),
          branche: !!li.querySelector('[data-branche-de-liste]'),
        })),
      );
      record(
        `chercher le membre « ${seul.projet.name} » le laisse seul, sans branche ni projet réuni rappelé`,
        restant.length === 1 && restant[0].id === seul.projet.id && !restant[0].parent && !restant[0].branche,
        JSON.stringify(restant),
      );
    }
    await champ.fill('zzzqqq-aucun');
    await page.waitForTimeout(300);
    record(
      'sans correspondance, le volet le dit',
      (await page.getByText('Aucun projet ne correspond à cette recherche.').count()) === 1 &&
        (await page.locator('[data-projet-nouvel-agent]').count()) === 0,
    );
    await champ.fill('');
    await page.waitForTimeout(300);
    record('champ vidé, toute la liste revient', (await page.locator('[data-projet-nouvel-agent]').count()) === affiches.length);

    const vise = affiches[0];
    await page.locator(`[data-projet-nouvel-agent="${vise}"]`).tap();
    await page.waitForTimeout(2500);
    const db2 = ouvrirBase();
    carteCreee = db2
      .prepare('SELECT id, project_id AS projectId FROM cards WHERE created_at >= ? ORDER BY created_at DESC LIMIT 1')
      .get(depart);
    db2.close();
    record('toucher un projet crée une carte dans CE projet', carteCreee?.projectId === vise, carteCreee?.projectId ?? 'aucune carte');
    record('le volet des projets s’est refermé', !(await liste.isVisible().catch(() => false)));
    record('la carte s’ouvre en tiroir', !!carteCreee && page.url().includes(carteCreee.id), page.url());

    await page.keyboard.press('Escape');
    await page.waitForTimeout(2500);
    const db3 = ouvrirBase();
    const reste = carteCreee ? db3.prepare('SELECT id FROM cards WHERE id = ?').get(carteCreee.id) : null;
    db3.close();
    record('refermée vide, la carte est rangée', !!carteCreee && !reste);
    if (!reste) carteCreee = null;

    /* ---------- SUR ORDINATEUR : LE MÊME GESTE, EN TÊTE DE LA COLONNE DE GAUCHE ---------- */
    const bureau = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'fr-CH',
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    });
    await bureau.addCookies([
      { name: 'beluga_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
    ]);
    const pageBureau = await bureau.newPage();
    pageBureau.setDefaultTimeout(8000);
    const LIGNE = 'aside[data-zone="gauche"] [data-ligne-nouvel-agent]:visible';
    /* SEULS LES TABLEAUX DE BORD (« en-route ») SE JUGENT ICI. Le Résumé
       (« tableau-de-bord ») est un service à menu : sur ordinateur sa colonne
       de gauche porte SON menu, plus la liste des projets ni sa première ligne
       (`ColonneDeService`) — il n'y a donc plus de « Nouvel agent » à y chercher. */
    for (const vue of ['en-route']) {
      await pageBureau.goto(`${BASE}/#/${vue}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pageBureau.waitForTimeout(4500);
      for (let essai = 0; essai < 3 && (await pageBureau.locator('[role="dialog"][data-state="open"]:not([data-ecran-plein])').count()); essai++) {
        await pageBureau.keyboard.press('Escape');
        await pageBureau.waitForTimeout(500);
      }
      const mesure = await pageBureau.evaluate(() => {
        const visible = (el) => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
        const bouton = [...document.querySelectorAll('aside[data-zone="gauche"] [data-ligne-nouvel-agent]')].find(visible);
        /* La colonne n'a plus de ligne « Tableaux de bord » (12/10/2026) : le
           bouton est avant la liste des projets, et il est NOIR, écriture blanche. */
        const premierProjet = [...document.querySelectorAll('aside[data-zone="gauche"] [data-drag-id]')].find(visible);
        const tableaux = [...document.querySelectorAll('aside[data-zone="gauche"] [data-ouvrir-en-route]')].find(visible);
        const luminosite = (couleur) => {
          const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(couleur ?? '');
          return m ? (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255 : null;
        };
        const colonne = document.querySelector('aside[data-zone="gauche"]');
        const nav = document.querySelector('nav[data-menu-bas]');
        if (!bouton || !colonne) return null;
        const b = bouton.getBoundingClientRect();
        const c = colonne.getBoundingClientRect();
        return {
          visible: true,
          texte: bouton.textContent.trim(),
          dansLaColonne: b.left >= c.left && b.right <= c.right,
          hautBouton: b.top,
          hautTableaux: tableaux ? tableaux.getBoundingClientRect().top : null,
          hautPremierProjet: premierProjet ? premierProjet.getBoundingClientRect().top : null,
          fond: luminosite(getComputedStyle(bouton).backgroundColor),
          encre: luminosite(getComputedStyle(bouton).color),
          navVisible: !!nav && nav.getBoundingClientRect().height > 0,
        };
      });
      record(`ordinateur, « ${vue} » : le bouton « Nouvel agent » est affiché`, !!mesure?.visible && mesure.texte === 'Nouvel artefact', mesure?.texte ?? 'absent');
      /* Il ne flotte plus au centre bas de la zone du milieu : c'est la
         première ligne de la colonne de gauche, au-dessus de « Tableaux de bord ». */
      record(
        `ordinateur, « ${vue} » : en tête de la colonne de gauche, avant la liste des projets`,
        !!mesure && mesure.dansLaColonne && mesure.hautPremierProjet !== null && mesure.hautBouton < mesure.hautPremierProjet,
        mesure ? `ligne à ${Math.round(mesure.hautBouton)} px, premier projet à ${mesure.hautPremierProjet === null ? '—' : Math.round(mesure.hautPremierProjet)} px` : 'absent',
      );
      record(
        `ordinateur, « ${vue} » : plus de bouton « Tableaux de bord » dans la colonne`,
        !!mesure && mesure.hautTableaux === null,
        mesure ? String(mesure.hautTableaux) : 'absent',
      );
      record(
        `ordinateur, « ${vue} » : le bouton est NOIR, l'écriture blanche`,
        !!mesure && mesure.fond !== null && mesure.encre !== null && mesure.fond < 0.3 && mesure.encre > 0.8,
        mesure ? `fond ${mesure.fond?.toFixed(2)}, écriture ${mesure.encre?.toFixed(2)}` : 'absent',
      );
      record(`ordinateur, « ${vue} » : le bouton du bas du téléphone reste masqué`, !!mesure && !mesure.navVisible);
    }
    await pageBureau.locator(LIGNE).click();
    const listeBureau = pageBureau.locator('[data-tiroir-nouvel-agent]');
    record(
      'ordinateur : le bouton ouvre le volet des projets',
      await listeBureau.waitFor({ state: 'visible' }).then(() => true, () => false),
    );
    await pageBureau.waitForTimeout(400);
    record(
      'ordinateur : le champ de recherche a le focus à l’ouverture',
      await pageBureau.evaluate(() => document.activeElement?.hasAttribute('data-recherche-nouvel-agent')),
    );
    await pageBureau.keyboard.press('Escape');
    await pageBureau.waitForTimeout(600);
    // Dans un projet, la ligne n'a pas lieu d'être : on ouvre celui visé plus haut.
    await pageBureau.goto(`${BASE}/#projet/${vise}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    /* Le tableau du projet se reconnaît à ses COLONNES : `data-tableau` est
       aussi porté par le Résumé, il ne dit plus qu'un projet est ouvert. */
    await pageBureau.locator('[data-column]').first().waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
    if (await pageBureau.locator('[data-column]').count()) {
      record(
        'ordinateur, dans un projet : pas de « Nouvel agent » dans la colonne',
        !(await pageBureau.locator(LIGNE).count()),
      );
    } else {
      record('ordinateur : le projet visé s’ouvre sur son tableau', false, 'aucun tableau affiché');
    }
    await bureau.close();
  } finally {
    await browser.close();
    retirerSession(cookie);
    if (carteCreee) {
      const db = ouvrirBase();
      db.prepare('DELETE FROM cards WHERE id = ?').run(carteCreee.id);
      db.close();
    }
  }

  const echecs = resultats.filter((resultat) => !resultat.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  if (echecs.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
