#!/usr/bin/env node
/**
 * LA PASTILLE « RENDU NON CONSULTÉ », L'ICÔNE D'ÉTAPE ET LE COMPTEUR DU PROJET
 * (`shared/src/travail-rendu.ts`, carte de `web/src/components/board.tsx`,
 * `CompteurNonConsulte` de `web/src/components/sidebar.tsx`) — vérifiés dans
 * un VRAI navigateur, sur son PROPRE démon (base neuve, port libre : le démon
 * de production n'est pas touché, aucun quota dépensé).
 *
 *   node scripts/verif-pastille-non-consulte.mjs
 *
 * Ce qui est prouvé : quatre cartes rendues (compréhension, plan, rapport, et
 * une quatrième qu'on fera glisser) allument quatre pastilles et un compteur
 * « 4 » ; la visite du projet n'éteint rien ; un clic sur la pastille l'éteint
 * SANS ouvrir la carte et laisse l'icône ; ouvrir une carte l'éteint aussi ;
 * GLISSER une carte vers une autre colonne l'éteint également, parce que tout
 * changement de colonne vaut consultation (`store.saveCard`) ; le compteur
 * baisse à chaque consultation. « Marquer comme non lu » (menu de la carte)
 * la rallume — au tableau, sur la page « Tableaux de bord » où elle doit
 * rester ENTIÈRE, et depuis la fiche ouverte, où elle doit TENIR — et le
 * compteur remonte. Non couvert ici : un rendu arrivé carte
 * ouverte (il faut un vrai tour d'agent).
 *
 * RECALÉ SUR LA REFONTE (11/10/2026) — LA NAVIGATION SEULEMENT. La colonne de
 * gauche suit le lieu : elle ne liste les projets (donc le compteur de la
 * ligne) que sur la page « Tableaux de bord » (`#en-route`) ; dans un projet
 * elle porte ses options sous une flèche de retour (`[data-menu-de-colonne]`).
 * Le compteur se lit donc sur la ligne AFFICHÉE : depuis le tableau, on remonte
 * par la flèche le temps de le lire, puis on revient par le nom du projet.
 *
 * DÉJÀ EN PANNE AVANT LA REFONTE, ET LAISSÉ TEL QUEL : la partie « Tableaux de
 * bord » date d'avant ses trois colonnes (Actifs / Terminer / Archiver). Elle
 * cherche un `h1`, attend deux pastilles dans `[data-liste-en-route]` (qui ne
 * tient plus que les cartes actives : celles d'« À déployer » sont sous
 * « Terminer ») et s'arrête sur le clic de la carte glissée, absente de cette
 * liste. Les points qui suivent ne sont donc jamais joués.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { ouvrirLesTableauxDeBord } from './lib/navigation.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7195);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { TMP, DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-pastille-',
  port: PORT,
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const TITRE = 'Essai — pastille non consultée';
const CARTES = [
  { id: 'c-comprehension', colonne: 'planned', etape: 'comprehension' },
  { id: 'c-plan', colonne: 'planned', etape: 'plan' },
  { id: 'c-rapport', colonne: 'to_deploy', etape: 'rapport' },
  // La quatrième ne sert qu'au GLISSER : un titre à elle, pour la viser sans
  // ambiguïté au moment du geste. La colonne « Terminé » (`done`) n'existe
  // plus : elle part de « Demande », rapport déjà rendu (`doneAt`).
  { id: 'c-glissee', colonne: 'planned', etape: 'rapport', titre: 'Carte a glisser' },
];

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton), maintenant, maintenant + 3600_000, 'vérification pastille',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  const projet = {
    id: PROJET_ID, name: TITRE, path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1,
    archived: false, createdAt: maintenant, updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

  const comprehension = { texte: 'Compris.', hypotheses: [], sujets: [], at: maintenant };
  const plan = { numero: 1, titre: 'Plan', resume: '', texte: '# Plan', at: maintenant };
  CARTES.forEach((c, i) => {
    const data = {
      id: c.id,
      projectId: PROJET_ID,
      title: c.titre ?? `Carte ${c.etape}`,
      renduA: maintenant - 1000,
      parcours: { comprehension, plans: c.etape === 'comprehension' ? [] : [plan] },
      ...(c.etape === 'rapport' ? { doneAt: maintenant } : {}),
    };
    db.prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(c.id, PROJET_ID, c.colonne, i + 1, data.title, JSON.stringify(data), maintenant, maintenant);
  });
  db.close();
}

function lu(cardId) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const row = db.prepare('SELECT last_read_at AS luA FROM cards WHERE id = ?').get(cardId);
  db.close();
  return row?.luA ?? null;
}

/*
 * LE COMPTEUR DE L'ICÔNE DU PROJET. Il ne porte plus de repère à lui
 * (`data-compteur-non-consulte` a disparu avec la refonte du badge de projet) :
 * la ligne du projet annonce son nombre de cartes non consultées, et l'icône
 * (`RepereRobot`) le dessine. On lit le nombre là où il est écrit.
 */
/** La ligne du projet dans la colonne de gauche. */
const LIGNE = `aside[data-zone="gauche"] [data-drag-id="${PROJET_ID}"]`;

/**
 * DEPUIS LA REFONTE, LA COLONNE DE GAUCHE NE LISTE LES PROJETS QUE SUR LA PAGE
 * « TABLEAUX DE BORD » : dans un projet elle porte ses options, et la liste,
 * toujours montée, est cachée. Le compteur se lit donc sur une ligne AFFICHÉE
 * (`cachee` sinon) — jamais sur la liste cachée derrière les options.
 */
const compteur = (page) =>
  page.evaluate((selecteur) => {
    const ligne = document.querySelector(selecteur);
    if (!ligne || ligne.getBoundingClientRect().height === 0) return 'cachee';
    return ligne.getAttribute('data-projet-rendus') ?? null;
  }, LIGNE);

/** Du tableau du projet à la page de tous les projets, par la flèche en tête de la colonne. */
async function versLesTableauxDeBord(page) {
  if (!(await page.locator(LIGNE).isVisible().catch(() => false))) {
    await page.locator('[data-menu-de-colonne]:visible').first().click();
  }
  await page.locator(LIGNE).waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(400);
}

/** Des tableaux de bord au tableau du projet, par le NOM de sa ligne (le badge, lui, ouvrirait une carte). */
async function versLeProjet(page) {
  await page.click(`${LIGNE} button:has-text("${TITRE}")`);
  await page.locator('[data-column="planned"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(800);
}

/**
 * Le compteur, lu DEPUIS LE TABLEAU DU PROJET : on remonte à la liste le temps
 * de lire la ligne affichée, puis on revient au tableau. Rien n'est rechargé.
 */
async function compteurDepuisLeProjet(page) {
  await versLesTableauxDeBord(page);
  const nombre = await compteur(page);
  await versLeProjet(page);
  return nombre;
}
const pastille = (page, id) => page.locator(`[data-carte-non-lue="${id}"]`).count();
const etape = (page, id) =>
  page.evaluate((cid) => document.querySelector(`[data-etape-carte="${cid}"]`)?.getAttribute('data-etape') ?? null, id);

/**
 * LE TABLEAU N'UTILISE PAS LE GLISSER-DÉPOSER NATIF : il suit les événements de
 * pointeur. On amène la carte à l'écran en dernier (sinon elle sort du cadre),
 * on sonde le rail des colonnes pour ne pas relâcher sur la colonne de gauche,
 * puis on dispatche appui / déplacements / relâchement à la main.
 */
async function glisser(page, titre, versColonne) {
  const carte = page.locator(`article:has-text(${JSON.stringify(titre)})`).first();
  const colonne = page.locator(`[data-column="${versColonne}"]`);
  await colonne.scrollIntoViewIfNeeded();
  await carte.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const depart = await carte.boundingBox();
  const arrivee = await colonne.boundingBox();
  if (!depart || !arrivee) throw new Error('carte ou colonne introuvable à l’écran');
  const rail = await page.evaluate(() => {
    const boite = document.querySelector('[data-column]')?.parentElement?.getBoundingClientRect();
    return boite ? { gauche: boite.left, droite: boite.right } : null;
  });
  if (!rail) throw new Error('le tableau n’a aucune colonne à l’écran');
  const x0 = depart.x + depart.width / 2;
  const y0 = depart.y + 12;
  const gauche = Math.max(arrivee.x, rail.gauche);
  const droite = Math.min(arrivee.x + arrivee.width, rail.droite);
  if (droite - gauche < 60) throw new Error(`la colonne « ${versColonne} » n’est pas assez visible pour y déposer`);
  const x1 = (gauche + droite) / 2;
  const y1 = arrivee.y + Math.min(140, arrivee.height / 2);
  await page.evaluate(
    async ([x0, y0, x1, y1]) => {
      const commun = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 };
      const cible = document.elementFromPoint(x0, y0);
      cible?.dispatchEvent(new PointerEvent('pointerdown', { ...commun, clientX: x0, clientY: y0 }));
      for (let i = 1; i <= 12; i++) {
        const x = x0 + ((x1 - x0) * i) / 12;
        const y = y0 + ((y1 - y0) * i) / 12;
        window.dispatchEvent(new PointerEvent('pointermove', { ...commun, clientX: x, clientY: y }));
        await new Promise((r) => setTimeout(r, 25));
      }
      window.dispatchEvent(new PointerEvent('pointerup', { ...commun, buttons: 0, clientX: x1, clientY: y1 }));
    },
    [x0, y0, x1, y1],
  );
  await page.waitForTimeout(2500);
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1600, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  // La page de tous les projets : c'est là que la colonne de gauche les liste.
  await page.goto(`${BASE}/#en-route`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator(LIGNE).waitFor({ state: 'visible', timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(2500);

  noter('la ligne du projet annonce 4 cartes non consultées', (await compteur(page)) === '4', String(await compteur(page)));
  noter('aucun ancien point bleu sur la ligne', (await page.locator('[data-repere-termine], [data-signal-termine]').count()) === 0);

  await versLeProjet(page);
  await page.waitForTimeout(700);
  const apresLaVisite = await compteurDepuisLeProjet(page);
  noter('la visite du projet n’éteint PAS le compteur', apresLaVisite === '4', String(apresLaVisite));
  noter('…et ne marque aucune carte consultée', CARTES.every((c) => lu(c.id) == null));

  for (const c of CARTES) {
    noter(`carte ${c.etape} : pastille allumée`, (await pastille(page, c.id)) === 1);
    noter(`carte ${c.etape} : icône d’étape « ${c.etape} »`, (await etape(page, c.id)) === c.etape, String(await etape(page, c.id)));
  }
  await page.screenshot({ path: path.join(TMP, 'pastilles-allumees.png') });

  // Le survol grossit nettement le point.
  const point = page.locator('[data-carte-non-lue="c-plan"] > span');
  const avant = (await point.boundingBox())?.width ?? 0;
  await page.hover('[data-carte-non-lue="c-plan"]');
  await page.waitForTimeout(400);
  const apres = (await point.boundingBox())?.width ?? 0;
  noter('le survol grossit la pastille', apres > avant * 1.5, `${avant} → ${apres}`);
  const zone = await page.locator('[data-carte-non-lue="c-plan"]').boundingBox();
  noter('la zone de clic fait au moins 24 px', (zone?.width ?? 0) >= 24, String(zone?.width));

  // Clic sur la pastille : éteinte, carte NON ouverte, icône conservée.
  const urlAvant = page.url();
  await page.click('[data-carte-non-lue="c-plan"]');
  await page.waitForTimeout(1200);
  noter('un clic sur la pastille l’éteint', (await pastille(page, 'c-plan')) === 0);
  noter('…sans ouvrir la carte', page.url() === urlAvant && (await page.locator('[role="dialog"]').count()) === 0, page.url());
  noter('…et l’icône « plan » reste', (await etape(page, 'c-plan')) === 'plan');
  noter('…la carte est marquée consultée en base', lu('c-plan') != null);
  const apresLaPastille = await compteurDepuisLeProjet(page);
  noter('le compteur baisse à 3', apresLaPastille === '3', String(apresLaPastille));

  // Ouvrir la carte : même effet.
  await page.click('[data-carte="c-comprehension"]');
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  noter('ouvrir la carte éteint sa pastille', (await pastille(page, 'c-comprehension')) === 0);
  noter('…et laisse l’icône « compréhension »', (await etape(page, 'c-comprehension')) === 'comprehension');
  const apresLOuverture = await compteurDepuisLeProjet(page);
  noter('le compteur baisse à 2', apresLOuverture === '2', String(apresLOuverture));
  await page.screenshot({ path: path.join(TMP, 'pastilles-apres.png') });

  /*
   * GLISSER UNE CARTE VAUT CONSULTATION. La règle est posée dans `saveCard`,
   * donc TOUT changement de colonne l'applique — le glisser à la main comme
   * les rangements du démon (fin de tour, archivage, publication…). On
   * l'éprouve ici sur le geste de l'utilisateur, le seul qu'un navigateur
   * puisse produire sans dépenser un agent : « Demande » → « À déployer », qui
   * ne déclenche aucun geste payant à l'arrivée (un simple rangement).
   *
   * Les deux colonnes SIGNALENT un rendu et donnent la même icône d'étape : le
   * glisser ne doit changer que la CONSULTATION, jamais l'icône.
   */
  const avantGlisser = lu('c-glissee');
  await glisser(page, 'Carte a glisser', 'to_deploy');
  noter('glisser la carte la marque consultée en base', avantGlisser == null && lu('c-glissee') != null, String(lu('c-glissee')));
  noter('…et sa pastille s’éteint à l’écran', (await pastille(page, 'c-glissee')) === 0);
  noter('…et l’icône « rapport » reste', (await etape(page, 'c-glissee')) === 'rapport');
  const apresLeGlisser = await compteurDepuisLeProjet(page);
  noter('le compteur baisse à 1 sans recharger', apresLeGlisser === '1', String(apresLeGlisser));
  await page.screenshot({ path: path.join(TMP, 'pastille-apres-glisser.png') });

  /*
   * « MARQUER COMME NON LU » : le geste inverse, au menu de la carte (clic
   * droit). Il rallume la pastille ET le compteur du projet, sans recharger ;
   * il n'est offert que sur une carte déjà lue.
   */
  const menuNonLu = (id) => page.locator(`[data-menu-non-lu="${id}"]`);
  await page.click('[data-carte="c-rapport"]', { button: 'right' });
  await page.waitForTimeout(500);
  noter('une carte encore non lue n’offre pas « Marquer comme non lu »', (await menuNonLu('c-rapport').count()) === 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.click('[data-carte="c-plan"]', { button: 'right' });
  await menuNonLu('c-plan').waitFor({ state: 'visible', timeout: 5000 });
  await menuNonLu('c-plan').click();
  await page.waitForTimeout(1200);
  noter('tableau : « Marquer comme non lu » rallume la pastille', (await pastille(page, 'c-plan')) === 1);
  noter('…retire le repère de lecture en base', lu('c-plan') == null, String(lu('c-plan')));
  // Lu sur la page de tous les projets — où la suite se joue justement.
  await versLesTableauxDeBord(page);
  noter('…et le compteur remonte à 2', (await compteur(page)) === '2', String(await compteur(page)));

  /*
   * LA PAGE « TABLEAUX DE BORD » (vue `en-route`) : la même pastille, ENTIÈRE
   * — elle déborde de 12 px au-dessus de la carte, et la zone qui défile la
   * coupait sur la première carte — et le même menu au clic droit.
   */
  await ouvrirLesTableauxDeBord(page);
  await page.locator('[data-liste-en-route]').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1000);
  const titrePage = (await page.locator('[data-zone="en-route"] h1, h1:has-text("Tableaux de bord")').first().innerText().catch(() => '')).trim();
  noter('la page s’intitule « Tableaux de bord »', titrePage === 'Tableaux de bord', titrePage);
  const pastillesEntieres = () => page.evaluate(() => {
    const zone = document.querySelector('[data-fil="en-route"]')?.getBoundingClientRect();
    const points = [...document.querySelectorAll('[data-liste-en-route] [data-carte-non-lue]')];
    return {
      nombre: points.length,
      toutes: points.every((bouton) => {
        const r = bouton.querySelector('span')?.getBoundingClientRect();
        if (!zone || !r) return false;
        const dedans = r.top >= zone.top && r.bottom <= zone.bottom && r.left >= zone.left && r.right <= zone.right;
        const sous = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return dedans && !!sous && bouton.contains(sous);
      }),
      premiere: !!document.querySelector('[data-liste-en-route] > :first-child [data-carte-non-lue]'),
      ordre: [...document.querySelectorAll('[data-liste-en-route] > *')].map((e) => (e.getAttribute('data-carte-en-route') ?? e.tagName) + (e.querySelector('[data-carte-non-lue]') ? '*' : '')),
    };
  });
  const entieres = await pastillesEntieres();
  noter('tableaux de bord : les deux pastilles allumées sont affichées', entieres.nombre === 2, String(entieres.nombre));
  noter('…entières et cliquables', entieres.toutes);
  await page.screenshot({ path: '/tmp/pastille-tableaux-de-bord.png' });

  /* Deux cartes sont encore lues ici : « c-glissee » et « c-comprehension ».
     On rallume celle qui est EN TÊTE de la liste si c'en est une (l'ordre
     entre cartes de même dernière action n'est pas garanti), pour éprouver la
     pastille de la première carte ; l'autre sert à la fiche ouverte. */
  const premiere = await page.evaluate(
    () => document.querySelector('[data-liste-en-route] > :first-child')?.getAttribute('data-carte-en-route') ?? null,
  );
  const cible = premiere === 'c-comprehension' ? 'c-comprehension' : 'c-glissee';
  const pourLaFiche = cible === 'c-glissee' ? 'c-comprehension' : 'c-glissee';
  await page.click(`[data-liste-en-route] [data-carte="${cible}"]`, { button: 'right' });
  await menuNonLu(cible).waitFor({ state: 'visible', timeout: 5000 });
  await menuNonLu(cible).click();
  await page.waitForTimeout(1200);
  noter('tableaux de bord : le clic droit offre « Marquer comme non lu », qui rallume la pastille', (await pastille(page, cible)) === 1);
  noter('…et le compteur du projet remonte à 3', (await compteur(page)) === '3', String(await compteur(page)));
  const enTete = await pastillesEntieres();
  noter('la pastille de la PREMIÈRE carte de la liste est entière, elle aussi', enTete.premiere && enTete.toutes, JSON.stringify(enTete));
  await page.screenshot({ path: '/tmp/pastille-tableaux-de-bord-premiere.png' });

  /*
   * DEPUIS LA FICHE OUVERTE : ouvrir la carte la lit ; « Marquer comme non
   * lu », choisi dans son menu, doit TENIR pendant que la fiche reste ouverte
   * et après l'avoir refermée — la lecture automatique ne rejoue pas.
   */
  await page.click(`[data-liste-en-route] [data-carte="${pourLaFiche}"]`);
  await page.waitForTimeout(2000);
  const fiche = page.locator('[role="dialog"]').last();
  await fiche.locator('button[aria-label="Autres actions"]').first().click();
  await menuNonLu(pourLaFiche).waitFor({ state: 'visible', timeout: 5000 });
  await menuNonLu(pourLaFiche).click();
  await page.waitForTimeout(2500);
  noter('fiche ouverte : la carte reste non lue', lu(pourLaFiche) == null, String(lu(pourLaFiche)));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  noter('…et le reste une fois la fiche refermée', lu(pourLaFiche) == null && (await pastille(page, pourLaFiche)) === 1);
  noter('…le compteur du projet est à 4', (await compteur(page)) === '4', String(await compteur(page)));

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) console.log(`(captures et journal dans ${TMP})`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.slice(-20).join(''));
  process.exit(1);
});
