#!/usr/bin/env node
/**
 * LA TÊTE DE LA COLONNE DE GAUCHE ET SON TÉMOIN DU SERVEUR (carte « Colonne repliée et témoin du serveur », 18/11/2026).
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-temoin-du-serveur.mjs
 *
 * Démon d'essai jetable (base neuve, port à soi — jamais BELUGA_URL), navigateur Chrome du système :
 *  1. en tête de colonne, l'icône de l'application porte le témoin `stable`, et le pied n'a plus de point de liaison ;
 *  2. la préparation d'un déploiement listée dans « En cours » ouvre le menu « Publier » du haut, jamais un tiroir ;
 *  3. colonne repliée : toutes les icônes de la bande sont sur le même axe (±1 px), le point d'alerte de « Services »
 *     est posé sur le coin de son icône, et la tête est le témoin (bouton « Déplier le menu ») ;
 *  4. téléphone (390 px) : la tête de la liste des projets porte le même témoin ;
 *  5. le démon coupé : le témoin passe à l'orange (`redemarrage`) puis au rouge (`eteint`) après le seuil durable.
 * Captures 1440 / 390, clair et sombre, dans /tmp/verif-temoin-du-serveur.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7389);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = '/tmp/verif-temoin-du-serveur';
fs.mkdirSync(CAPTURES, { recursive: true });
const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, demon, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-temoin-du-serveur-', port: PORT });
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const MAINTENANT = Date.now();
const H = 3600_000;

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), MAINTENANT, MAINTENANT + H, 'vérification témoin du serveur');
  const p = {
    id: 'p-alpha', name: 'Alpha', path: `${DEPOT}-alpha`, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false,
    createdAt: MAINTENANT, updatedAt: MAINTENANT,
    /* Le projet désigne l'agent qui ÉCRIT sa procédure de déploiement (`etapeDeLAgentDeConfiguration`). */
    deploiement: { agentId: 'ag-config' },
  };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(p.id, p.name, p.path, JSON.stringify(p), MAINTENANT, MAINTENANT);
  const config = { id: 'ag-config', projectId: 'p-alpha', role: 'deploy', title: 'Configuration du déploiement', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'running', tourVivantDepuis: MAINTENANT - 30_000, startedAt: MAINTENANT, createdAt: MAINTENANT, updatedAt: MAINTENANT };
  db.prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)').run(config.id, config.projectId, config.role, config.status, JSON.stringify(config), config.createdAt, config.updatedAt);
  /* Un site en panne : « Services » porte son point d'alerte. */
  db.prepare('INSERT INTO sites_surveilles (id, url, nom, etat, verifie_le, depuis, derniere_panne, cree_le) VALUES (?, ?, ?, ?, 0, 0, 0, ?)').run('site-casse', 'http://127.0.0.1:9/casse', 'Site cassé', 'panne', MAINTENANT);
  db.close();
}

const visible = (page, selecteur) => page.locator(`${selecteur} >> visible=true`).first();
const theme = async (page, sombre) => {
  await page.evaluate((s) => document.documentElement.classList.toggle('dark', s), sombre);
  await page.waitForTimeout(300);
};
const capturerDansLesDeuxThemes = async (page, nom) => {
  for (const sombre of [false, true]) {
    await theme(page, sombre);
    await page.screenshot({ path: path.join(CAPTURES, `${nom}-${sombre ? 'sombre' : 'clair'}.png`) });
  }
};

async function principal() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    /* ------------------------------ ORDINATEUR ------------------------------ */
    const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    await page.goto(`${BASE}/#en-route`);
    const temoin = visible(page, 'aside[data-zone="gauche"] [data-titre-projets] [data-temoin-serveur]');
    const vu = await temoin.waitFor({ timeout: 30000 }).then(() => true, () => false);
    await page.waitForTimeout(2500);
    noter('1. la tête de colonne porte l’icône et son témoin « stable »', vu && (await temoin.getAttribute('data-temoin-serveur')) === 'stable', vu ? await temoin.getAttribute('data-temoin-serveur') : 'absent');
    noter('1. le nom « Beluga » n’est plus écrit en tête', !/Beluga/.test((await visible(page, 'aside[data-zone="gauche"] [data-titre-projets]').innerText().catch(() => '')) ?? ''));
    noter('1. le pied n’a plus de point de liaison', (await page.locator('[data-essai="badge-quota"] [data-point-etat]').count()) === 0);
    const point = await page.evaluate(() => {
      const icone = [...document.querySelectorAll('aside [data-titre-projets] [data-temoin-serveur]')].find((e) => e.getBoundingClientRect().width > 0);
      const p = icone?.querySelector('[data-point-du-serveur]')?.getBoundingClientRect();
      const i = icone?.getBoundingClientRect();
      return p && i ? { dx: p.right - i.right, dy: i.top - p.top, l: p.width } : null;
    });
    noter('1. le point est au coin haut droit de l’icône', !!point && Math.abs(point.dx) <= 4 && Math.abs(point.dy) <= 4 && point.l >= 8, JSON.stringify(point));
    await capturerDansLesDeuxThemes(page, '1440-tete');

    /* 2. LA PRÉPARATION D'UN DÉPLOIEMENT → MENU « PUBLIER » */
    const ligne = visible(page, '[data-taches-en-cours-colonne] [data-agent-sans-carte="ag-config"]');
    const ligneVue = await ligne.waitFor({ timeout: 15000 }).then(() => true, () => false);
    noter('2. la préparation du déploiement paraît dans « En cours »', ligneVue);
    if (ligneVue) {
      await ligne.click();
      const menu = await page.locator('[data-menu-publier]').first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
      await page.waitForTimeout(500);
      const tiroirs = await page.locator('[data-tiroir-agent-configuration]').count();
      noter('2. son clic ouvre le menu « Publier » du haut, sans tiroir', menu && tiroirs === 0, `menu ${menu}, tiroirs ${tiroirs}`);
      noter('2. le menu montre la préparation', /Préparation/.test(await page.locator('[data-menu-publier]').first().innerText().catch(() => '')));
      await capturerDansLesDeuxThemes(page, '1440-menu-publier');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    /* 3. LA BANDE REPLIÉE */
    await visible(page, '[data-replier-colonne="depliee"]').click();
    await page.mouse.move(900, 450);
    await page.locator('aside[data-colonne-projets="reduite"]').waitFor({ timeout: 8000 });
    await page.waitForTimeout(500);
    const bande = await page.evaluate(() => {
      const aside = document.querySelector('aside[data-colonne-projets="reduite"]');
      const centre = (r) => r.left + r.width / 2;
      const icones = [...aside.querySelectorAll('[data-bouton-services] svg, [data-service-epingle] svg, [data-bouton-tableaux-de-bord] svg, [data-tete-de-colonne] button svg')]
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 0);
      const temoin = aside.querySelector('[data-deplier-colonne] [data-temoin-serveur]')?.getBoundingClientRect();
      const services = aside.querySelector('[data-bouton-services] svg')?.getBoundingClientRect();
      const pointServices = aside.querySelector('[data-bouton-services] [data-alerte-navigation]')?.getBoundingClientRect();
      return {
        centres: icones.map(centre),
        temoin: temoin ? centre(temoin) : null,
        services: services ? centre(services) : null,
        point: pointServices && services ? { droite: pointServices.right - services.right, haut: services.top - pointServices.top } : null,
      };
    });
    const etendue = Math.max(...bande.centres) - Math.min(...bande.centres);
    noter('3. bande : les icônes sont sur le même axe', bande.centres.length >= 2 && etendue <= 1, `${bande.centres.length} icônes, écart ${etendue.toFixed(2)} px`);
    noter('3. bande : « Services » est centrée comme les autres', bande.services != null && Math.abs(bande.services - bande.centres[0]) <= 1, String(bande.services));
    noter('3. bande : son point d’alerte est posé sur le coin de l’icône', !!bande.point && bande.point.droite > 0 && bande.point.droite <= 6 && bande.point.haut >= 0, JSON.stringify(bande.point));
    noter('3. bande : la tête est le témoin, centré sur le même axe', bande.temoin != null && Math.abs(bande.temoin - bande.centres[0]) <= 1.5, String(bande.temoin));
    await capturerDansLesDeuxThemes(page, '1440-bande');
    /* Au clavier, le témoin cède la place au bouton qui déplie. */
    await visible(page, '[data-deplier-colonne][data-replier-colonne="reduite"]').focus();
    await page.keyboard.press('Shift');
    await page.screenshot({ path: path.join(CAPTURES, '1440-bande-focus.png') });
    await visible(page, '[data-deplier-colonne][data-replier-colonne="reduite"]').click();
    await page.mouse.move(900, 450);
    await page.locator('aside[data-colonne-projets="depliee"]').waitFor({ timeout: 8000 });
    noter('3. son clic déplie la colonne', true);

    /* ------------------------------ TÉLÉPHONE ------------------------------ */
    const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-CH', serviceWorkers: 'block' });
    await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const telephone = await tel.newPage();
    await telephone.goto(`${BASE}/#en-route`);
    await telephone.waitForTimeout(3000);
    await telephone.locator('button[aria-label="Projets"] >> visible=true').first().click().catch(() => {});
    const temoinTel = visible(telephone, '[data-titre-projets] [data-temoin-serveur]');
    const vuTel = await temoinTel.waitFor({ timeout: 10000 }).then(() => true, () => false);
    noter('4. téléphone : la tête de la liste des projets porte le témoin', vuTel && (await temoinTel.getAttribute('data-temoin-serveur')) === 'stable');
    const deborde = await telephone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    noter('4. téléphone : rien ne déborde en largeur', !deborde);
    await capturerDansLesDeuxThemes(telephone, '390-projets');
    await tel.close();

    /* 5. LE DÉMON COUPÉ : orange, puis rouge passé le seuil durable. */
    await theme(page, true);
    demon.kill('SIGKILL');
    const teinte = () => visible(page, 'aside [data-titre-projets] [data-temoin-serveur]').getAttribute('data-temoin-serveur');
    await page.waitForTimeout(4000);
    const orange = await teinte();
    noter('5. coupure courte : orange qui clignote', orange === 'redemarrage', orange);
    await page.screenshot({ path: path.join(CAPTURES, '1440-coupure-courte-sombre.png') });
    await page.waitForTimeout(14000);
    const rouge = await teinte();
    noter('5. coupure durable : rouge', rouge === 'eteint', rouge);
    await page.screenshot({ path: path.join(CAPTURES, '1440-coupure-durable-sombre.png') });
    await theme(page, false);
    await page.screenshot({ path: path.join(CAPTURES, '1440-coupure-durable-clair.png') });
  } finally {
    await navigateur.close();
  }
  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles réussis — captures dans ${CAPTURES}`);
  process.exit(echecs ? 1 : 0);
}

principal().catch((erreur) => {
  console.error(erreur);
  process.exit(1);
});
