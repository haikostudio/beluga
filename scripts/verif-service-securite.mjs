#!/usr/bin/env node
/**
 * LE SERVICE « SÉCURITÉ », DANS UN VRAI NAVIGATEUR (carte « Service Sécurité des projets », 15/11/2026).
 *
 * Sur un démon d'essai (base neuve, dossier de projets à lui, jamais celui en service, aucun quota) et un petit dépôt
 * git qui porte une vraie requête SQL montée avec une saisie (le contrôle de sécurité la relève) :
 *  1. la page « Sécurité » montre Beluga Build, suivi dès le démarrage sans geste, et son bouton « Ajouter un projet » est en BAS de la page ;
 *  2. ajouter le projet ouvre sa page : la conversation de l'agent à gauche, le rapport à droite, classé par gravité ;
 *  3. les blocs graves sont ouverts, « Ce qui a été vérifié » est EN TÊTE du rapport et déplié ;
 *  4. cocher un point ÉCRIT sa ligne dans le champ d'écriture, décocher la RETIRE, et rien n'est envoyé ;
 *  5. la tête du rapport (choix de l'audit, « Lancer un audit ») tient sur une hauteur, au pixel près ;
 *  6. la liste montre le projet, et ses contrôles d'en-tête ont la même hauteur (32 px ordinateur) ;
 *  7. sur téléphone (390 px), la page d'un projet passe en deux onglets, sans débordement en largeur ;
 *  8. aucun rapport ne recopie la valeur d'une clé écrite dans le dépôt (DEC-501) ;
 *  9. la page d'un projet prend TOUT le cadre (capture #66c6), en clair et en sombre : le volet du rapport touche la
 *     barre du fil et le bord droit, la conversation se centre dans la place à gauche du volet, son champ est en bas ;
 *     la LISTE, elle, garde sa colonne centrée ;
 * 10. cocher une ligne fait du bouton du pied « Corriger la sélection (N) », sans ouvrir la page du projet ;
 * 11. un DOUBLE CLIC sur un cran à liste du fil (le service, la portée) ramène à l'accueil du service, liste refermée.
 *
 *   node scripts/verif-service-securite.mjs        (après `npm run build`, depuis la copie de la carte)
 *   VERIF_CAPTURES=/tmp/captures-securite node scripts/verif-service-securite.mjs   (écrit les captures)
 *
 * Jamais `BELUGA_URL` ni `BELUGA_TOKEN` : la session d'une heure est fabriquée en base jetable, et part avec elle.
 */
import { porteeSurTousLesProjets } from './lib/navigation.mjs';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7197);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-securite-', port: PORT, signaux: true });
const jeton = crypto.randomBytes(32).toString('hex');
const T = Date.now();
const SECRET = 'sk_live_' + 'Zx81Qw'.repeat(5);

function poserLeDecor() {
  // Le dépôt d'essai : une requête montée avec la saisie du visiteur, et une clé côté serveur (dépôt privé : tue).
  fs.mkdirSync(path.join(DEPOT, 'server'), { recursive: true });
  fs.writeFileSync(
    path.join(DEPOT, 'server', 'routes.js'),
    "export function lire(req, db) {\n  return db.query(`SELECT * FROM clients WHERE id = ${req.query.id}`);\n}\n",
  );
  fs.writeFileSync(path.join(DEPOT, 'server', 'config.js'), `export const STRIPE_SECRET_KEY = '${SECRET}';\n`);
  execFileSync('git', ['add', '-A'], { cwd: DEPOT });
  execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'code'], { cwd: DEPOT });

  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai');
  const p = { id: 'p-essai', name: 'Boutique', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: T, updatedAt: T };
  db.prepare('INSERT OR REPLACE INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run('p-essai', 'Boutique', DEPOT, JSON.stringify(p), T, T);
  db.close();
}

/** Le thème de l'essai : une préférence du serveur (`usePref('theme')`), posée avant d'ouvrir les pages. */
function poserLeTheme(clarte) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run(
    'theme',
    JSON.stringify(clarte),
    Date.now(),
  );
  db.close();
}

/** La page du service sur « Tous les projets » (elle s'ouvre sur le projet en cours). */
async function ouvrirTousLesProjets(page) {
  /* LE FIL « SERVICE / PROJET » (20/11/2026) : le nom du service remet la page sur tous les projets. */
  const service = page.locator('[data-cran-a-menu="service-de-la-page"]').first();
  /* Au tout premier chargement, l'arrivée sur « Tableaux de bord » (rôle pas encore connu) peut devancer l'adresse :
     on la redonne, trois fois au plus. */
  for (let essai = 0; essai < 3; essai++) {
    await page.goto(`${BASE}/#securite`, { waitUntil: 'load' });
    if (await service.waitFor({ state: 'visible', timeout: 12_000 }).then(() => true, () => false)) break;
    await page.goto(`${BASE}/#`, { waitUntil: 'load' });
  }
  await service.waitFor({ state: 'visible', timeout: 15_000 });
  if (!(await porteeSurTousLesProjets(page))) throw new Error('« Tous les projets » ne se choisit pas');
}

/** Les hauteurs des contrôles visibles d'une rangée. */
async function hauteurs(page, selecteur) {
  return page.$$eval(selecteur, (elements) =>
    elements
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => Math.round(e.getBoundingClientRect().height)),
  );
}

async function capturer(page, nom) {
  if (!CAPTURES) return;
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

/** La page ouverte, pour la capture d'un échec. */
let pageEnCours = null;

async function principal() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const theme of ['light', 'dark']) {
      poserLeTheme(theme === 'light' ? 'clair' : 'sombre');
      const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-CH', colorScheme: theme });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await contexte.newPage();
      pageEnCours = page;
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));

      if (theme === 'light') {
        /* 1. Le projet de Beluga Build est suivi dès le démarrage (sans geste) ; son bouton « Ajouter » est en bas. */
        await ouvrirTousLesProjets(page);
        const ajouter = page.locator('[data-securite-ajouter]').first();
        await ajouter.waitFor({ state: 'visible', timeout: 30_000 });
        verifier(
          'Beluga Build est suivi dès le démarrage, sans geste',
          await page.getByText('Beluga Build', { exact: true }).first().isVisible(),
        );
        const boite = await ajouter.boundingBox();
        verifier('« Ajouter un projet » est en bas de la page', !!boite && boite.y > 1000 * 0.75, boite ? `y = ${Math.round(boite.y)}` : 'introuvable');
        await capturer(page, 'liste-avant-ajout-ordinateur-clair');

        /* 2. Ajouter le projet : sa page s'ouvre, l'audit part. */
        await ajouter.click();
        await page.locator('[data-liste-option="p-essai"]').first().click();
        await page.locator('[data-securite-page="p-essai"]').waitFor({ state: 'visible', timeout: 30_000 });
        await page.locator('[data-securite-rapport]:not([data-securite-rapport="attente"])').waitFor({ state: 'visible', timeout: 120_000 });
        const rapport = await page.locator('[data-securite-rapport]').getAttribute('data-securite-rapport');
        verifier('le premier audit est rendu dans le volet de droite', rapport && rapport !== 'attente' && rapport !== 'erreur', rapport ?? '');
        const injection = page.locator('[data-securite-point*="injection"]').first();
        verifier('la requête montée avec une saisie est relevée', (await injection.count()) > 0);

        /* 3. Les blocs : « vérifié » en tête et ouvert, graves ouverts. */
        const blocs = await page.$$eval('[data-bloc-repliable^="securite-"]', (els) => els.map((e) => [e.getAttribute('data-bloc-repliable'), e.hasAttribute('data-bloc-ouvert')]));
        const graves = blocs.filter(([r]) => r === 'securite-critique' || r === 'securite-elevee');
        verifier('les blocs graves sont ouverts', graves.length > 0 && graves.every(([, o]) => o), JSON.stringify(blocs));
        verifier('« Ce qui a été vérifié » est déplié', blocs.some(([r, o]) => r === 'securite-verifie' && o));
        /* « ACCÈS DES ROBOTS » EN TÊTE (22/11/2026, maquette #9542), puis « Ce qui a été vérifié ». */
        verifier('« Accès des robots » ouvre le rapport, « Ce qui a été vérifié » le suit', blocs[0]?.[0] === 'securite-robots' && blocs[1]?.[0] === 'securite-verifie', JSON.stringify(blocs.map(([r]) => r)));

        /* 8. Aucune valeur secrète dans la page. */
        verifier('aucune valeur de clé recopiée dans le rapport', !(await page.content()).includes(SECRET));

        /* 4. Cocher écrit, décocher retire, rien ne part. */
        await page.locator('[data-securite-conversation] textarea').first().waitFor({ state: 'visible', timeout: 60_000 });
        const champ = page.locator('[data-securite-conversation] textarea').first();
        const caseDuPoint = injection.locator('[data-securite-case]');
        await caseDuPoint.click();
        await page.waitForTimeout(300);
        const apres = await champ.inputValue();
        verifier('cocher un point écrit sa ligne dans le champ', /^- Corriger : /m.test(apres), JSON.stringify(apres.slice(0, 80)));
        verifier('la case se lit cochée', (await caseDuPoint.getAttribute('data-securite-case')) === 'cochee');
        await capturer(page, 'projet-ordinateur-clair');
        await caseDuPoint.click();
        await page.waitForTimeout(300);
        verifier('décocher retire la ligne', (await champ.inputValue()).trim() === '', JSON.stringify(await champ.inputValue()));
        const messages = await page.locator('[data-securite-conversation] [data-message]').count();
        verifier('rien n’a été envoyé à l’agent', messages === 0, `${messages} message(s)`);
        await mesurerLePleinCadre(page, 'clair');

        /* 5. La tête du rapport sur une hauteur. */
        const tete = await hauteurs(page, '[data-securite-tete-du-rapport] > *');
        verifier('la tête du rapport : contrôles de même hauteur', tete.length >= 1 && tete.every((h) => h === tete[0]), JSON.stringify(tete));

        /* 6. La liste, ses contrôles d'en-tête. */
        await ouvrirTousLesProjets(page);
        await page.locator('[data-securite-ligne="p-essai"]').first().waitFor({ state: 'visible', timeout: 30_000 });
        verifier('la liste montre le projet suivi', true);
        /* LA RECHERCHE EST UNE LOUPE (22/11/2026) : la loupe fermée porte `data-recherche-en-icone`. */
        const entete = await hauteurs(page, '[data-tete-de-la-page-de-service] [data-recherche-en-icone], [data-bascule-tableau-cartes="vue-de-la-securite"]');
        verifier('les contrôles d’en-tête de la liste ont la même hauteur (32 px)', entete.length >= 2 && entete.every((h) => h === 32), JSON.stringify(entete));
        await capturer(page, 'liste-ordinateur-clair');
        await mesurerLaColonneDeLaListe(page, 'clair');

        /* 10. La sélection : cocher une ligne change le bouton du pied, sans ouvrir la page du projet. */
        const caseLigne = page.locator('[data-securite-choisir="p-essai"]').first();
        await caseLigne.click();
        await page.waitForTimeout(300);
        verifier('cocher une ligne n’ouvre pas la page du projet', (await page.locator('[data-securite-page]').count()) === 0);
        const corriger = page.locator('[data-securite-corriger]').first();
        verifier('le pied devient « Corriger la sélection (1) »', /Corriger la sélection \(1\)/.test((await corriger.textContent().catch(() => '')) ?? ''));
        verifier('la case se lit cochée', (await caseLigne.getAttribute('aria-checked')) === 'true');
        verifier('la case d’en-tête se lit cochée (toutes les lignes visibles)', (await page.locator('[data-securite-tout-choisir]').first().getAttribute('aria-checked')) === 'true');
        await capturer(page, 'selection-ordinateur-clair');
        await page.locator('[data-securite-tout-choisir]').first().click();
        await page.waitForTimeout(300);
        verifier('tout décocher rend « Ajouter un projet »', (await page.locator('[data-securite-corriger]').count()) === 0 && (await page.locator('[data-securite-ajouter]').count()) > 0);

        /* 11. Le double clic sur le cran du service ramène à son accueil, liste refermée. */
        await page.locator('[data-securite-ligne="p-essai"]').first().click();
        await page.locator('[data-securite-page="p-essai"]').waitFor({ state: 'visible', timeout: 30_000 });
        /* LE NOM DU SERVICE MÈNE À SA LISTE, LE CHEVRON (au survol) À LA LISTE DES SERVICES (20/11/2026). */
        await page.locator('[data-nom-du-cran="service-de-la-page"]').first().click();
        await page.locator('[data-securite-ligne="p-essai"]').first().waitFor({ state: 'visible', timeout: 15_000 });
        await page.waitForTimeout(400);
        verifier('clic sur « Sécurité » : retour à la liste', (await page.locator('[data-securite-page]').count()) === 0);
        verifier('clic sur « Sécurité » : aucune liste ouverte', (await page.locator('[data-liste-option]').count()) === 0);
        await page.locator('[data-cran-a-menu="service-de-la-page"]').first().hover();
        await page.locator('[data-voisins-du-cran="service-de-la-page"]').first().click();
        const listeOuverte = await page.locator('[data-liste-option]').first().waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
        verifier('le chevron du service ouvre la liste des services', listeOuverte);
        await page.keyboard.press('Escape');
      } else {
        await ouvrirTousLesProjets(page);
        await page.locator('[data-securite-ligne="p-essai"]').first().waitFor({ state: 'visible', timeout: 30_000 });
        await capturer(page, 'liste-ordinateur-sombre');
        await mesurerLaColonneDeLaListe(page, 'sombre');
        await page.locator('[data-securite-ligne="p-essai"]').first().click();
        await page.locator('[data-securite-rapport]').first().waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForTimeout(800);
        await capturer(page, 'projet-ordinateur-sombre');
        await mesurerLePleinCadre(page, 'sombre');
        await ouvrirTousLesProjets(page);
      }
      verifier(`aucune erreur de page (${theme})`, erreurs.length === 0, erreurs.join(' | '));

      /* 7. Téléphone : la même page rétrécie à 390 px (le service s'ouvre depuis l'écran déjà chargé). */
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(600);
      await page.locator('[data-securite-ligne="p-essai"]').first().waitFor({ state: 'visible', timeout: 30_000 });
      await capturer(page, `liste-telephone-${theme === 'light' ? 'clair' : 'sombre'}`);
      await page.locator('[data-securite-ligne="p-essai"]').first().click();
      await page.locator('[data-securite-page="p-essai"]').first().waitFor({ state: 'visible', timeout: 30_000 });
      await page.locator('[data-securite-rapport]').first().waitFor({ state: 'visible', timeout: 30_000 });
      await page.waitForTimeout(600);
      const largeur = await page.evaluate(() => document.documentElement.scrollWidth);
      verifier(`téléphone (${theme}) : rien ne déborde en largeur`, largeur <= 390, `${largeur} px`);
      verifier(`téléphone (${theme}) : deux onglets, Rapport et Conversation`, (await page.locator('[data-securite-page] [role="tab"]').count()) === 2);
      await capturer(page, `projet-telephone-${theme === 'light' ? 'clair' : 'sombre'}`);
      const barre = await page.locator('[data-securite-page] [role="tablist"]').first().boundingBox();
      verifier(`téléphone (${theme}) : les onglets gardent la marge de page`, !!barre && barre.x >= 12 && barre.x + barre.width <= 390 - 12, barre ? `${Math.round(barre.x)} → ${Math.round(barre.x + barre.width)}` : '');
      /* UNE SEULE MARGE DE 16 PX, LE RETOUR ET « LANCER UN AUDIT » DANS L'EN-TÊTE DE LA FEUILLE (22/11/2026, #7ae7, #ccad). */
      const feuille = await page.evaluate(() => {
        const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none';
        const bloc = [...document.querySelectorAll('[data-securite-page] .bloc-repliable')].find(vis);
        return {
          bord: bloc ? Math.round(bloc.getBoundingClientRect().left) : null,
          retour: !!document.querySelector('[data-entete-feuille] [data-entete-gauche] [data-retour-de-la-feuille]'),
          lancer: !!document.querySelector('[data-entete-feuille] [data-entete-droite] [data-securite-lancer]'),
          lancers: document.querySelectorAll('[data-securite-lancer]').length,
          rangeeVide: vis(document.querySelector('[data-tete-de-la-feuille-de-service]')),
        };
      });
      verifier(`téléphone (${theme}) : les blocs du rapport sont à 16 px du bord, une seule marge`, feuille.bord === 16, `${feuille.bord} px`);
      verifier(`téléphone (${theme}) : le retour est dans l’en-tête de la feuille`, feuille.retour);
      verifier(`téléphone (${theme}) : « Lancer un audit » est dans l’en-tête, en un seul exemplaire`, feuille.lancer && feuille.lancers === 1, `${feuille.lancers}`);
      verifier(`téléphone (${theme}) : aucune ligne vide sous l’en-tête de la feuille`, !feuille.rangeeVide);
      await page.locator('[data-securite-page] [role="tab"]').nth(1).click();
      await page.locator('[data-securite-conversation] textarea').first().waitFor({ state: 'visible', timeout: 30_000 });
      verifier(`téléphone (${theme}) : l’onglet « Conversation » se lit choisi`, (await page.locator('[data-securite-page] [role="tab"]').nth(1).getAttribute('aria-selected')) === 'true');
      await page.mouse.move(195, 600);
      await capturer(page, `conversation-telephone-${theme === 'light' ? 'clair' : 'sombre'}`);
      const champTel = await page.locator('[data-securite-conversation] textarea').first().boundingBox();
      verifier(`téléphone (${theme}) : le champ d’écriture est collé en bas`, !!champTel && champTel.y > 844 * 0.7, champTel ? `y = ${Math.round(champTel.y)}` : '');
      await contexte.close();
    }
  } catch (err) {
    if (CAPTURES && pageEnCours) await pageEnCours.screenshot({ path: path.join(CAPTURES, 'echec.png') }).catch(() => undefined);
    throw err;
  } finally {
    await navigateur.close();
  }
}


/** 9. LA PAGE D'UN PROJET EN PLEIN CADRE : mesures au pixel, sur la page ouverte à 1440 × 1000. */
async function mesurerLePleinCadre(page, theme) {
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const boite = (s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, droite: r.right, bas: r.bottom, l: r.width };
    };
    return {
      zone: boite('[data-contenu-de-la-page-de-service]'),
      volet: boite('aside[data-securite-volet]'),
      rangee: boite('[data-securite-page]'),
      colonne: boite('[data-securite-conversation] > div'),
      champ: boite('[data-securite-conversation] textarea'),
      hauteur: window.innerHeight,
    };
  });
  const { zone, volet, rangee, colonne, champ, hauteur } = m;
  const ok = zone && volet && rangee && colonne && champ;
  verifier(`plein cadre (${theme}) : la page est mesurable`, ok, JSON.stringify(m).slice(0, 200));
  if (!ok) return;
  /* PAS DE LIGNE DE TITRE AU-DESSUS D'UNE CONVERSATION + VOLET (22/11/2026) : le volet touche le haut de la zone, et
     aucun grand titre n'est visible. */
  const titreVisible = await page.evaluate(() => {
    const h = document.querySelector('[data-titre-de-page-de-service]');
    return !!h && h.getBoundingClientRect().height > 0 && getComputedStyle(h.closest('[data-tete-de-la-page-de-service]') ?? h).display !== 'none';
  });
  verifier(`plein cadre (${theme}) : aucune ligne de titre au-dessus de la conversation`, !titreVisible);
  verifier(`plein cadre (${theme}) : le volet touche le haut de la zone`, Math.abs(volet.y - zone.y) <= 2, `volet ${Math.round(volet.y)} / zone ${Math.round(zone.y)}`);
  verifier(`plein cadre (${theme}) : le volet touche le bord droit, aucun vide à sa droite`, Math.abs(volet.droite - zone.droite) <= 1, `volet ${Math.round(volet.droite)} / zone ${Math.round(zone.droite)}`);
  verifier(`plein cadre (${theme}) : la rangée part du bord gauche de la zone`, Math.abs(rangee.x - zone.x) <= 1, `rangée ${Math.round(rangee.x)} / zone ${Math.round(zone.x)}`);
  const milieu = (zone.x + volet.x) / 2;
  const centre = colonne.x + colonne.l / 2;
  verifier(`plein cadre (${theme}) : la conversation est centrée dans la place restante`, Math.abs(centre - milieu) <= 4, `centre ${Math.round(centre)} / milieu ${Math.round(milieu)}`);
  verifier(`plein cadre (${theme}) : le champ d’écriture est collé en bas`, champ.y > hauteur * 0.85, `y = ${Math.round(champ.y)} / ${hauteur}`);
}

/** La LISTE garde sa colonne de service : ses marges de côté (40 px) et sa marge haute — le plein cadre ne la touche pas. */
async function mesurerLaColonneDeLaListe(page, theme) {
  const m = await page.evaluate(() => {
    const c = document.querySelector('[data-corps-de-la-page-de-service]');
    if (!c) return null;
    const st = getComputedStyle(c);
    return { gauche: parseFloat(st.paddingLeft), droite: parseFloat(st.paddingRight), haut: parseFloat(st.marginTop) };
  });
  verifier(`liste (${theme}) : elle garde sa colonne et ses marges`, !!m && m.gauche >= 32 && m.gauche === m.droite && m.haut >= 16, JSON.stringify(m));
}

try {
  await principal();
} catch (err) {
  verifier('le contrôle a pu aller au bout', false, String(err?.message ?? err).slice(0, 300));
  console.error(journal.slice(-30).join(''));
} finally {
  nettoyer();
}
const echecs = resultats.filter((ok) => !ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles réussis`);
process.exit(echecs ? 1 : 0);
