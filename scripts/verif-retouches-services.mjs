#!/usr/bin/env node
/**
 * NAVIGATION, SERVICES ET VUE D'ENSEMBLE DES RÉSEAUX, DANS UN VRAI NAVIGATEUR.
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-retouches-services.mjs
 *
 * Démon jetable, base neuve, aucun quota dépensé. On juge : le bouton menu de la colonne
 * d'un service, le fil d'Ariane (« Tableaux de bord » puis le service en menu), « Déployer »
 * sous une carte, le groupe en jeu de cartes, la Surveillance, les Sauvegardes, les
 * logos, l'ordre des rubriques, et l'ancienne adresse des réseaux qui mène à Communication.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';
import { siteVierge } from '../shared/dist/backups.js';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7236);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = path.join(RACINE, 'data/verification');
fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok: !!ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-retouches-services-', port: PORT });
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const MAINTENANT = Date.now();
const H = 3600_000;
const jour = (n) => new Date(MAINTENANT - n * 24 * H).toISOString().slice(0, 10);

function projet(db, id, name, rank) {
  /* `herite` : « Déployer » n'est pas éteint faute de procédure. */
  const p = { id, name, path: `${DEPOT}-${id}`, defaultEngine: 'claude', isSelf: false, rank, archived: false, deploiement: { herite: true }, createdAt: MAINTENANT, updatedAt: MAINTENANT };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(id, name, p.path, JSON.stringify(p), MAINTENANT, MAINTENANT);
}
function carte(db, id, projectId, column, title, extra = {}) {
  const c = { id, projectId, title, description: '', labels: [], column, position: MAINTENANT, origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' }, excludedFromDeploy: false, horsTache: false, createdAt: MAINTENANT, updatedAt: MAINTENANT, ...extra };
  db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, projectId, column, MAINTENANT, title, JSON.stringify(c), null, MAINTENANT, MAINTENANT);
}
function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), MAINTENANT, MAINTENANT + H, 'vérification services');
  db.prepare('DELETE FROM projects').run();
  projet(db, 'p-alpha', 'Alpha', 1);
  projet(db, 'p-beta', 'Beta', 2);
  carte(db, 'c-simple', 'p-alpha', 'planned', 'Une tâche simple');
  carte(db, 'c-lot', 'p-alpha', 'to_deploy', 'Prête à déployer');
  carte(db, 'c-mere', 'p-alpha', 'planned', 'Travail commun', {
    cartesFilles: [1, 2, 3, 4].map((n) => ({ projectId: 'p-beta', cardId: `c-fille-${n}` })),
  });
  for (const n of [1, 2, 3, 4]) carte(db, `c-fille-${n}`, 'p-beta', 'planned', `Sous-carte ${n}`, { carteMereId: 'c-mere' });
  /* Les réseaux : un compte aux chiffres ouverts, un autre qui ne les ouvre pas. */
  /* Un agent et son rapport : sans eux, le voile « Initialiser » couvre la rubrique. */
  const agent = { id: 'ag-rs', projectId: 'p-alpha', role: 'task', title: 'Agent des réseaux', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'done', createdAt: MAINTENANT, updatedAt: MAINTENANT };
  db.prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)').run(agent.id, agent.projectId, agent.role, agent.status, JSON.stringify(agent), MAINTENANT, MAINTENANT);
  db.prepare(`INSERT INTO marketing_espaces (project_id, cle_suivi, langue, agent_id, rapport, rapport_le, cree_le, maj_le) VALUES ('p-alpha', 'clealpha', 'fr', 'ag-rs', 'Le produit vise les artisans.', ?, ?, ?)`).run(MAINTENANT, MAINTENANT, MAINTENANT);
  const compte = db.prepare(`INSERT INTO marketing_comptes (id, project_id, reseau, distant_id, nom, etat, cree_le, maj_le) VALUES (?, 'p-alpha', ?, ?, ?, 'relie', ?, ?)`);
  compte.run('cp-fb', 'facebook', 'fb1', 'Page Alpha', MAINTENANT, MAINTENANT);
  compte.run('cp-li', 'linkedin', 'li1', 'Alpha sur LinkedIn', MAINTENANT, MAINTENANT);
  const releve = db.prepare(`INSERT INTO marketing_audience (compte_id, project_id, reseau, publication, jour, abonnes, vues, commentaires, reactions, releve_le) VALUES ('cp-fb', 'p-alpha', 'facebook', ?, ?, ?, ?, ?, ?, ?)`);
  releve.run('', jour(40), 90, null, null, null, MAINTENANT);
  releve.run('', jour(0), 120, null, null, null, MAINTENANT);
  releve.run('post1', jour(40), null, 100, 2, 4, MAINTENANT);
  releve.run('post1', jour(0), null, 350, 9, 30, MAINTENANT);
  db.prepare(`INSERT INTO marketing_messages (id, project_id, compte_id, reseau, genre, distant_id, fil, auteur, texte, instant, sortant, lu) VALUES ('m1', 'p-alpha', 'cp-fb', 'facebook', 'message', 'd1', 'f1', 'Lina', 'Bonjour', ?, 0, 0)`).run(MAINTENANT);
  const site = { ...siteVierge(null, 'Site à sauvegarder'), id: 'site-essai' };
  db.prepare('INSERT INTO backup_sites (id, project_id, nom, actif, data, cree_le, modifie_le) VALUES (?, NULL, ?, 1, ?, ?, ?)').run(site.id, site.nom, JSON.stringify(site), MAINTENANT, MAINTENANT);
  /* Un site surveillé sous contrôle WordPress. */
  db.prepare(`INSERT INTO sites_surveilles (id, url, nom, etat, verifie_le, depuis, derniere_panne, cree_le, wordpress) VALUES ('s1', 'https://exemple.ch', 'Site Essai', 'ok', ?, 0, 0, ?, ?)`).run(MAINTENANT, MAINTENANT, JSON.stringify({ acces: { id: 'fiche-ssh' }, racine: '~/sites/wp', wpCli: 'wp', journaux: [], extensionsAttendues: ['hello'] }));
  db.close();
}

const aside = 'aside[data-zone="gauche"] ';

async function principal() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));

    /* --- 1. Le bouton menu d'une colonne de service --- */
    await page.goto(`${BASE}/#coffre`);
    const menu = page.locator(`${aside}[data-menu-de-colonne]`).first();
    await menu.waitFor({ state: 'visible', timeout: 30000 });
    /* Les projets chargés : le projet actif ne bougera plus sous le clic. */
    await page.locator(`${aside}[data-projet-cible="p-alpha"]`).waitFor({ state: 'attached', timeout: 30000 });
    await page.waitForTimeout(800);
    noter('1. la flèche de retour a laissé la place au bouton menu', (await page.locator(`${aside}[data-retour-de-colonne]`).count()) === 0);
    const projetsVisibles = () => page.locator(`${aside}[data-projet-cible="p-alpha"]`).isVisible();
    noter('1. fermé, la colonne montre le menu du service', !(await projetsVisibles()));
    await menu.click();
    noter('1. le bouton montre les agents et les projets par-dessus', await projetsVisibles());
    noter('1. sans quitter le service', (await page.locator('[data-titre-bandeau]').first().innerText()).includes('Coffre-fort'));
    await page.screenshot({ path: path.join(CAPTURES, 'services-surcouche.png') });
    await page.keyboard.press('Escape');
    noter('1. Échap referme la surcouche', !(await projetsVisibles()));
    await menu.click();
    await page.mouse.click(1000, 500);
    noter('1. un clic dehors aussi', !(await projetsVisibles()));
    await menu.click();
    await page.locator(`${aside}[data-projet-cible="p-alpha"] button:visible`).first().click();
    await page.locator('[data-page-du-projet="p-alpha"]').first().waitFor({ state: 'attached', timeout: 15000 });
    noter('1. choisir un projet y mène', true);

    /* --- 2. Le fil d'Ariane --- */
    noter('2. un projet a « Tableaux de bord » en tête', (await page.locator('[data-fil-d-ariane]').first().innerText()).startsWith('Tableaux de bord'));
    await page.goto(`${BASE}/#surveillance`);
    await page.locator('[data-titre-bandeau]', { hasText: 'Surveillance' }).first().waitFor({ state: 'visible', timeout: 20000 });
    const fil = await page.locator('[data-fil-d-ariane]').first().innerText();
    noter('2. un service aussi, et « Services » a disparu', fil.startsWith('Tableaux de bord') && !fil.includes('Services'), fil.replace(/\n/g, ' / '));
    /* LES SERVICES VIVENT EN BAS DE LA COLONNE depuis le 14/11/2026 (`services-de-la-colonne.tsx`) : Surveillance et
       Backup sont sous « Voir plus ». */
    await page.locator(`${aside}[data-voir-plus-services]`).first().click();
    await page.locator('[data-menu-des-services]').waitFor({ state: 'visible', timeout: 5000 });
    const courant = page.locator('[data-menu-des-services] [data-service-de-la-colonne="surveillance"]');
    const couleur = (loc) => loc.evaluate((e) => getComputedStyle(e).color);
    noter('2. le service en cours est en violet', (await courant.getAttribute('aria-current')) === 'page' && (await couleur(courant)) !== (await couleur(page.locator('[data-menu-des-services] [data-service-de-la-colonne="backups"]'))));
    noter('2. les tableaux de bord ne sont pas dans la liste', (await page.locator('[data-menu-des-services] [data-service-de-la-colonne="en-route"]').count()) === 0);
    await page.locator('[data-menu-des-services] [data-service-de-la-colonne="backups"]').click();
    await page.locator('[data-titre-bandeau]', { hasText: 'Backup' }).first().waitFor({ state: 'visible', timeout: 10000 });
    noter('2. la liste change de service', true);
    await page.locator('[data-fil-d-ariane] button', { hasText: 'Tableaux de bord' }).first().click();
    await page.locator('[data-page-en-route]').first().waitFor({ state: 'visible', timeout: 15000 });
    noter('2. le premier cran mène aux tableaux de bord', true);
    noter('2. sur eux-mêmes, le cran n’est pas redoublé', (await page.locator('[data-fil-d-ariane] button', { hasText: 'Tableaux de bord' }).count()) === 0);

    /* --- 3. Déployer sous une carte --- */
    await page.goto(`${BASE}/#en-route`);
    await page.locator('[data-liste-des-agents] [data-agent-en-liste="c-lot"] :is(a, button)').first().click();
    await page.locator('[data-page-carte="c-lot"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-geste="deployer-lot"]').first().click();
    await page.waitForTimeout(1200);
    noter('3. « Déployer » ne referme pas la carte', await page.locator('[data-page-carte="c-lot"]').isVisible());
    noter('3. il ouvre la fenêtre du déploiement', await page.locator('[data-selection-deploiement]').isVisible());
    noter('3. avec la carte du lot cochée', (await page.locator('[data-selection-deploiement]').innerText()).includes('Prête à déployer'));
    await page.screenshot({ path: path.join(CAPTURES, 'services-deployer.png') });

    /* --- 4. Le groupe en jeu de cartes --- */
    await page.goto(`${BASE}/#en-route`);
    await page.reload();
    const paquet = page.locator('[data-liste-des-agents] [data-paquet-de-cartes]').first();
    await paquet.waitFor({ state: 'visible', timeout: 20000 }).catch(async (err) => {
      console.log(page.url(), (await page.locator('[data-agent-en-liste]').evaluateAll((els) => els.map((e) => e.getAttribute('data-agent-en-liste')))).join(','));
      await page.screenshot({ path: path.join(CAPTURES, 'services-paquet-absent.png') });
      throw err;
    });
    noter('4. le groupe est un paquet fermé', (await paquet.getAttribute('data-paquet-de-cartes')) === 'ferme');
    const tranches = paquet.locator('[data-tranche-du-paquet]');
    noter('4. trois bords de cartes au plus, pour quatre filles', (await tranches.count()) === 3);
    const hauteurTranche = () => tranches.first().evaluate((e) => e.getBoundingClientRect().height);
    noter('4. les bords se voient, fermé', (await hauteurTranche()) >= 4);
    const fond = await paquet.locator('[data-cadre-du-paquet]').evaluate((e) => getComputedStyle(e).backgroundColor);
    noter('4. le cadre a un fond', fond !== 'rgba(0, 0, 0, 0)', fond);
    await paquet.screenshot({ path: path.join(CAPTURES, 'services-paquet-ferme.png') });
    const chevron = paquet.locator('[data-deplier-filles] svg');
    const rotation = () => chevron.evaluate((e) => getComputedStyle(e).transform);
    const avant = await rotation();
    await paquet.locator('[data-deplier-filles]').click();
    await page.waitForTimeout(150);
    const auMilieu = await page.locator('[data-fille-du-paquet]').first().evaluate((e) => e.getBoundingClientRect().height > 0);
    await page.waitForTimeout(900);
    noter('4. le chevron se retourne', (await rotation()) !== avant);
    noter('4. les filles sortent du paquet', auMilieu && (await paquet.locator('[data-fille-du-paquet]').count()) === 4 && (await paquet.locator('[data-fille-du-paquet]').last().isVisible()));
    noter('4. leurs bords se rangent', (await hauteurTranche()) === 0);
    await paquet.screenshot({ path: path.join(CAPTURES, 'services-paquet-ouvert.png') });
    await paquet.locator('[data-deplier-filles]').click();
    await page.waitForTimeout(800);
    noter('4. le paquet se replie', (await paquet.getAttribute('data-paquet-de-cartes')) === 'ferme' && !(await paquet.locator('[data-fille-du-paquet]').first().isVisible()));

    /* --- 5. Surveillance --- */
    await page.goto(`${BASE}/#surveillance/s1`);
    const titre = page.locator('[data-surveillance-titre-et-etat]');
    await titre.waitFor({ state: 'visible', timeout: 20000 });
    noter('5. le badge d’état suit le nom du site', (await titre.locator('[data-surveillance-etat]').count()) === 1);
    const barre = page.locator('[data-surveillance-wordpress-colle]');
    await barre.waitFor({ state: 'visible', timeout: 10000 });
    const colle = await barre.evaluate((e) => {
      const styles = getComputedStyle(e);
      /* Rien ne l'enferme : son parent réel est le fil, à travers des `contents`. */
      let p = e.parentElement;
      while (p && getComputedStyle(p).display === 'contents') p = p.parentElement;
      return { position: styles.position, top: styles.top, fond: styles.backgroundColor, parent: p ? p.getBoundingClientRect().height : 0, enContents: getComputedStyle(e.parentElement).display };
    });
    noter('5. le bloc État WordPress reste collé en haut', colle.position === 'sticky' && colle.top === '0px' && colle.enContents === 'contents', JSON.stringify(colle));
    noter('5. sur un fond opaque', !/rgba\(.*, 0\)/.test(colle.fond), colle.fond);
    await page.screenshot({ path: path.join(CAPTURES, 'services-surveillance.png') });

    /* --- 6. Sauvegardes : la fiche s'ouvre sur ce qui est récupéré, les réglages derrière leur bouton --- */
    await page.goto(`${BASE}/#backups`);
    await page.reload();
    await page.locator('[data-backups-colonne-site="site-essai"]').click();
    await page.locator('[data-backups-recette-site="site-essai"]').waitFor({ state: 'visible', timeout: 15000 });
    noter('6. la fiche montre la recette et l’historique', await page.locator('[data-backups-historique-site="site-essai"]').isVisible());
    noter('6. les champs ne sont pas sur la page', (await page.locator('[data-backups-nom]').count()) === 0 && (await page.locator('[data-backups-enregistrer]').count()) === 0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(CAPTURES, 'services-sauvegardes.png') });
    await page.locator('[data-backups-ouvrir-reglages]').click();
    await page.locator('[data-backups-reglages] [data-backups-nom]').waitFor({ state: 'visible', timeout: 10000 });
    noter('6. « Réglages » les ouvre, avec Enregistrer et Retirer', (await page.locator('[data-backups-reglages] [data-backups-enregistrer]').count()) === 1 && (await page.locator('[data-backups-reglages] [data-backups-supprimer]').count()) === 1);
    noter('6. l’interrupteur du site y est aussi', (await page.locator('[data-backups-reglages] [data-backups-actif]').count()) === 1);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(CAPTURES, 'services-sauvegardes-reglages.png') });
    await page.locator('[data-backups-nom]').fill('Nom modifié puis abandonné');
    await page.keyboard.press('Escape');
    await page.locator('[data-backups-reglages]').waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
    await page.locator('[data-backups-ouvrir-reglages]').click();
    await page.locator('[data-backups-nom]').waitFor({ state: 'visible', timeout: 10000 });
    noter('6. fermer sans enregistrer abandonne', (await page.locator('[data-backups-nom]').inputValue()) === 'Site à sauvegarder');
    await page.keyboard.press('Escape');

    /* --- 7. L'ancien atelier des réseaux mène à Communication (l'ancien espace est retiré le 11/11/2026) --- */
    await page.goto(`${BASE}/#reseaux-sociaux/p-alpha`);
    await page.locator('[data-communication2]').waitFor({ state: 'visible', timeout: 30000 });
    noter('7. l’ancienne adresse des réseaux ouvre Communication', page.url().includes('#communication'), page.url());
    await page.screenshot({ path: path.join(CAPTURES, 'services-communication.png'), fullPage: false });

    noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

    /* --- 9. Téléphone : la flèche et le menu ne changent pas --- */
    const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-CH', serviceWorkers: 'block', hasTouch: true });
    await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const p = await tel.newPage();
    await p.goto(`${BASE}/#surveillance/s1`);
    await p.locator('[data-surveillance-titre-et-etat]').waitFor({ state: 'visible', timeout: 20000 });
    noter('9. téléphone : pas de débordement sur la fiche d’un site', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await p.goto(`${BASE}/#reseaux-sociaux/p-alpha/canaux`);
    await p.locator('[data-communication-canaux]').waitFor({ state: 'visible', timeout: 30000 });
    noter('9. téléphone : pas de débordement sur les canaux d’une marque', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await p.screenshot({ path: path.join(CAPTURES, 'services-vue-d-ensemble-telephone.png') });
    await tel.close();
  } finally {
    await navigateur.close();
  }
  const passes = resultats.filter((r) => r.ok).length;
  console.log(`\n${passes}/${resultats.length} vérifications passent.`);
  process.exitCode = passes === resultats.length ? 0 : 1;
}

principal()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
