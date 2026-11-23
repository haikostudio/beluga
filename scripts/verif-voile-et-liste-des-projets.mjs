#!/usr/bin/env node
/**
 * LE VOILE DES FEUILLES DU BAS, LA LISTE DES PROJETS ET LA COLONNE DE GAUCHE —
 * vérifiés dans un VRAI navigateur, sur un démon JETABLE (base neuve, aucun
 * quota dépensé). Demande du 15/10/2026 :
 *
 *  1. Le VOILE d'une feuille du bas recouvre toute l'application : sur ce qui
 *     est dessous (colonne, barre du haut), `elementFromPoint` rend le voile, un
 *     clic dessus referme la feuille SANS déclencher le bouton touché.
 *  2. La LISTE des projets (le nom, en haut) : « Plan de travail » en tête,
 *     « Récents » après deux ouvertures, projets rangés par dernière ouverture,
 *     épingles qui s'ajoutent sans ouvrir le projet ni fermer la liste, groupes
 *     repliables avec le MÊME réglage que la colonne de gauche.
 *  3. La COLONNE de gauche : un bouton de tri par dernière ouverture, bascule
 *     éteinte par défaut ; allumé, le glisser-déposer est suspendu ; éteint,
 *     l'ordre manuel revient exactement.
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-voile-et-liste-des-projets.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7263);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-voile-liste-', port: PORT });

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const MAINTENANT = Date.now();
const H = 3600_000;

function projet(db, id, name, rank, extra = {}) {
  const p = { id, name, path: `${DEPOT}-${id}`, defaultEngine: 'claude', isSelf: false, rank, archived: false, createdAt: MAINTENANT, updatedAt: MAINTENANT, ...extra };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, name, p.path, p.archived ? 1 : 0, JSON.stringify(p), MAINTENANT, MAINTENANT,
  );
}

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), MAINTENANT, MAINTENANT + H, 'vérification voile et liste');
  db.prepare('DELETE FROM projects').run();
  db.prepare('DELETE FROM project_groups').run();
  // L'ordre manuel : Bêta (1), Alpha (2), le groupe « Clients » (3) et Gamma, Élodie (4).
  db.prepare('INSERT INTO project_groups (id, name, rank, collapsed, color, created_at) VALUES (?, ?, ?, 0, ?, ?)').run('g-clients', 'Clients', 3, null, MAINTENANT);
  projet(db, 'p-alpha', 'Alpha', 2, { deploiement: { herite: true } });
  projet(db, 'p-beta', 'Bêta', 1);
  projet(db, 'p-gamma', 'Gamma', 1, { groupId: 'g-clients' });
  projet(db, 'p-elodie', 'Élodie', 4);
  const c = {
    id: 'c-champ', projectId: 'p-alpha', title: 'Carte du champ', description: 'Une carte pour ouvrir une feuille.', labels: [], column: 'planned', position: 1,
    origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    excludedFromDeploy: false, horsTache: false, codeDejaEnregistre: false, createdAt: MAINTENANT - H, updatedAt: MAINTENANT - H,
  };
  db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    c.id, c.projectId, c.column, 1, c.title, JSON.stringify(c), null, c.createdAt, c.updatedAt,
  );
  const a = { id: 'ag-champ', projectId: 'p-alpha', cardId: 'c-champ', role: 'cadrage', title: 'Cadrage', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'done', createdAt: MAINTENANT - H, updatedAt: MAINTENANT - H,
    contextUsage: { usedTokens: 28000, capacityTokens: 200000, percentage: 14, measuredAt: MAINTENANT } };
  db.prepare(`INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, 'done', ?, ?, ?)`).run(
    a.id, a.projectId, a.cardId, a.role, JSON.stringify(a), a.createdAt, a.updatedAt,
  );
  db.close();
}

const lignesDuGroupe = (liste) =>
  liste.locator('[data-ligne-tiroir-projets]:not([data-ligne-tiroir-projets="plan-de-travail"])').evaluateAll((els) => els.map((e) => e.getAttribute('data-ligne-tiroir-projets')));
const recents = (liste) => liste.locator('[data-ligne-recent]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ligne-recent')));

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));
    await page.goto(`${BASE}/#projet/p-alpha`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('[data-titre-bandeau]').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });

    const titre = page.locator('[data-titre-bandeau]').first();
    const liste = page.locator('[data-tiroir-projets]');
    const ouvrirLaListe = async () => {
      await titre.click();
      await liste.waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(300);
    };
    const fermerLaListe = async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(350);
    };

    /* ----- 2. LA LISTE ----- */
    await ouvrirLaListe();
    const premiere = await liste.locator('[data-ligne-tiroir-projets]').first().getAttribute('data-ligne-tiroir-projets');
    noter('liste : « Plan de travail » est en tête, à la place de « Tableaux de bord »', premiere === 'plan-de-travail' && (await liste.locator('[data-ligne-tiroir-projets="en-route"]').count()) === 0, String(premiere));
    noter('liste : sans ouverture ni épingle, la section « Récents » n’existe pas', (await recents(liste)).length === 0);
    noter(
      'liste : sans ouverture, l’ordre est celui de la colonne',
      JSON.stringify(await lignesDuGroupe(liste)) === JSON.stringify(['p-beta', 'p-alpha', 'p-gamma', 'p-elodie']),
      (await lignesDuGroupe(liste)).join(', '),
    );

    await liste.locator('[data-ligne-tiroir-projets="p-gamma"]').click();
    await page.waitForTimeout(800);
    await ouvrirLaListe();
    noter(
      'liste : le projet ouvert passe en tête, avec son groupe',
      JSON.stringify(await lignesDuGroupe(liste)) === JSON.stringify(['p-gamma', 'p-beta', 'p-alpha', 'p-elodie']),
      (await lignesDuGroupe(liste)).join(', '),
    );
    noter('liste : un seul projet ouvert ne suffit pas pour « Récents »', (await recents(liste)).length === 0);

    await liste.locator('[data-ligne-tiroir-projets="p-elodie"]').click();
    await page.waitForTimeout(800);
    await ouvrirLaListe();
    noter(
      'liste : « Récents » paraît après deux ouvertures, le plus récent d’abord',
      JSON.stringify(await recents(liste)) === JSON.stringify(['p-elodie', 'p-gamma']),
      (await recents(liste)).join(', '),
    );
    noter(
      'liste : les projets récents restent aussi dans leur groupe, une seule ligne de groupe chacun',
      (await liste.locator('[data-ligne-tiroir-projets="p-gamma"]').count()) === 1 &&
        (await liste.locator('[data-ligne-tiroir-projets="p-elodie"]').count()) === 1,
    );
    noter('liste : le projet courant est marqué une seule fois', (await liste.locator('[aria-current="true"]').count()) === 1);

    /* L'ÉPINGLE : elle n'ouvre pas le projet et ne ferme pas la liste. */
    const titreAvant = (await titre.textContent())?.trim();
    await liste.locator('[data-ligne-tiroir-projets="p-alpha"]').hover();
    await liste.locator('[data-ligne-tiroir-projets="p-alpha"] [data-epingler-projet="p-alpha"]').click();
    await page.waitForTimeout(500);
    noter('épingle : la liste reste ouverte', await liste.isVisible());
    noter('épingle : le projet n’est pas ouvert', (await titre.textContent())?.trim() === titreAvant, `${titreAvant} → ${(await titre.textContent())?.trim()}`);
    noter(
      'épingle : le projet épinglé passe en tête de « Récents », sans repousser les récents',
      JSON.stringify(await recents(liste)) === JSON.stringify(['p-alpha', 'p-elodie', 'p-gamma']),
      (await recents(liste)).join(', '),
    );
    await liste.locator('[data-ligne-recent="p-alpha"] [data-epingler-projet="p-alpha"]').click();
    await page.waitForTimeout(400);
    noter('épingle : un second clic désépingle', JSON.stringify(await recents(liste)) === JSON.stringify(['p-elodie', 'p-gamma']), (await recents(liste)).join(', '));
    await liste.locator('[data-ligne-tiroir-projets="p-beta"] [data-epingler-projet="p-beta"]').click({ force: true });
    await page.waitForTimeout(300);

    /* LE REPLI : le même réglage que la colonne de gauche. */
    await liste.locator('button[data-groupe-du-menu="g-clients"]').click();
    await page.waitForTimeout(400);
    noter('repli : replier le groupe masque ses projets sans fermer la liste', (await liste.locator('[data-ligne-tiroir-projets="p-gamma"]').count()) === 0 && (await liste.isVisible()));
    noter(
      'repli : l’intertitre d’un groupe replié reste là, c’est lui qui le rouvre',
      (await liste.locator('button[data-groupe-du-menu="g-clients"][aria-expanded="false"]').count()) === 1,
    );
    await liste.locator('button[data-groupe-du-menu="g-clients"]').click();
    await page.waitForTimeout(300);
    noter('repli : un second clic sur l’intertitre rouvre le groupe', (await liste.locator('[data-ligne-tiroir-projets="p-gamma"]').count()) === 1);
    await liste.locator('button[data-groupe-du-menu="g-clients"]').click();
    await page.waitForTimeout(300);
    await liste.locator('[data-recherche-tiroir-projets]').fill('gam');
    await page.waitForTimeout(300);
    noter('repli : une recherche montre quand même le projet d’un groupe replié', (await liste.locator('[data-ligne-tiroir-projets="p-gamma"]').count()) === 1);
    await liste.locator('[data-recherche-tiroir-projets]').fill('');
    await page.waitForTimeout(200);
    await fermerLaListe();
    /* La liste des projets de la colonne vit sur « Tableaux de bord » : dans un
       projet, la colonne porte les options du lieu. */
    await page.evaluate(() => {
      location.hash = '#en-route';
    });
    await page.locator('[data-zone="gauche"] [data-groupe-projets="g-clients"]').first().waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(500);
    const enteteDuGroupe = page.locator('[data-zone="gauche"] [data-groupe-projets="g-clients"] button[aria-expanded]').first();
    noter('repli : la colonne de gauche montre le groupe replié (même réglage)', (await enteteDuGroupe.getAttribute('aria-expanded')) === 'false');
    await enteteDuGroupe.click();
    await page.waitForTimeout(400);
    await ouvrirLaListe();
    noter('repli : le déplier dans la colonne le déplie dans la liste', (await liste.locator('[data-ligne-tiroir-projets="p-gamma"]').count()) === 1);
    await fermerLaListe();

    /* ----- 3. LA COLONNE : bascule du tri ----- */
    const ordreColonne = () =>
      page.locator('[data-zone="gauche"] [data-drag-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-drag-id')));
    const bascule = page.locator('[data-zone="gauche"] [data-tri-par-ouverture]');
    const manuelle = await ordreColonne();
    noter(
      'colonne : par défaut, l’ordre manuel (bascule éteinte)',
      (await bascule.getAttribute('aria-pressed')) === 'false' &&
        JSON.stringify(manuelle) === JSON.stringify(['p-beta', 'p-alpha', 'g-clients', 'p-gamma', 'p-elodie']),
      manuelle.join(', '),
    );
    await page.locator('aside[data-zone="gauche"]').hover();
    await bascule.click();
    await page.waitForTimeout(500);
    const triee = await ordreColonne();
    noter(
      'colonne : bascule allumée, projets et groupes par dernière ouverture',
      (await bascule.getAttribute('aria-pressed')) === 'true' && JSON.stringify(triee) === JSON.stringify(['p-elodie', 'g-clients', 'p-gamma', 'p-beta', 'p-alpha']),
      triee.join(', '),
    );
    noter('colonne : le glisser-déposer est suspendu (plus de poignée)', (await page.locator('[data-zone="gauche"] [data-poignee-projet]:visible').count()) === 0);
    await bascule.click();
    await page.waitForTimeout(500);
    noter('colonne : éteinte, l’ordre manuel revient exactement', JSON.stringify(await ordreColonne()) === JSON.stringify(manuelle), (await ordreColonne()).join(', '));

    /* ----- 1. LE VOILE D'UNE FEUILLE DU BAS ----- */
    await page.goto(`${BASE}/#projet/p-alpha`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.locator('article').filter({ hasText: 'Carte du champ' }).first().click();
    await page.waitForTimeout(3500);
    /* La page d'une carte porte les MÊMES gestes que le tableau (24/10/2026) :
       le chevron de « Déployer » ouvre le déroulé, dans la feuille du bas. Le
       tableau reste monté dessous : le geste de la carte est le dernier du DOM. */
    const geste = page.locator('[role="dialog"] [data-bloc-publication="to_deploy"] [data-chevron-process]:visible').last();
    noter('voile : la carte ouverte porte le bouton « Déployer »', (await geste.count()) === 1);
    if (await geste.count()) {
      await geste.click();
      const feuille = page.locator('[data-feuille-du-bas]').first();
      await feuille.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(700);
      noter('voile : la feuille du bas s’ouvre', await feuille.isVisible().catch(() => false));
      /* Ce qui est dessous : la barre du haut, la colonne de gauche, l'en-tête de la carte. */
      const cibles = await page.evaluate(() => {
        const points = [
          ['barre du haut', 120, 24],
          ['en-tête de la carte', window.innerWidth - 180, 28],
          ['colonne de gauche', 30, 300],
          ['fond de la carte', window.innerWidth - 40, 400],
        ];
        return points.map(([nom, x, y]) => {
          const el = document.elementFromPoint(x, y);
          return { nom, voile: !!el?.closest('[data-voile-tiroir]'), balise: el?.tagName ?? null };
        });
      });
      noter('voile : il recouvre toute l’application, barre du haut et colonne comprises', cibles.every((c) => c.voile), JSON.stringify(cibles));
      const sansVolet = (h) => h.replace(/\/volet\/.*$/, '');
      const hashAvant = sansVolet(await page.evaluate(() => location.hash));
      /* Un clic sur un projet de la colonne : il ne mène nulle part, il ferme. */
      await page.mouse.click(30, 300);
      await page.waitForTimeout(900);
      noter('voile : un clic dessus referme la feuille', (await page.locator('[data-feuille-du-bas]').count()) === 0);
      const hashApres = sansVolet(await page.evaluate(() => location.hash));
      noter('voile : …sans déclencher ce qui était dessous (la colonne)', hashApres === hashAvant, `${hashAvant} → ${hashApres}`);
      /* Un clic sur le bouton « Déploiement » lui-même, recouvert par le voile : il ferme, il ne le rouvre pas. */
      await geste.click();
      await feuille.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(700);
      const boite = await geste.boundingBox();
      if (boite) await page.mouse.click(boite.x + boite.width / 2, boite.y + boite.height / 2);
      await page.waitForTimeout(1000);
      noter('voile : un clic sur le bouton recouvert referme la feuille et ne la rouvre pas', (await page.locator('[data-feuille-du-bas]').count()) === 0);
      /* Échap referme toujours. */
      await geste.click();
      await feuille.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(600);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
      noter('voile : Échap referme toujours la feuille', (await page.locator('[data-feuille-du-bas]').count()) === 0);
    }

    /* ----- LA BARRE D'ÉCRITURE : réglages après le trombone, rien ne déborde ----- */
    const barreEnOrdre = () =>
      page.evaluate(() => {
        const rangee = document.querySelector('[data-rangee-de-boutons="champ-gauche"]');
        const droite = document.querySelector('[data-rangee-de-boutons="champ-droite"]');
        if (!rangee || !droite) return null;
        const cadre = rangee.getBoundingClientRect();
        const dedans = [...rangee.querySelectorAll('button')].every((b) => {
          const x = b.getBoundingClientRect();
          return x.width === 0 || (x.left >= cadre.left - 1 && x.right <= cadre.right + 1);
        });
        const x = (selecteur) => document.querySelector(selecteur)?.getBoundingClientRect().left ?? null;
        return {
          dedans,
          sansDebordement: rangee.scrollWidth <= rangee.clientWidth + 1,
          joindre: x('[data-composer-joindre]'),
          /* Les réglages d'une carte ne sont JAMAIS dans la barre d'écriture :
             ils sont collés au bouton principal de la rangée d'action. */
          reglages: x('[data-rangee-de-boutons="champ-gauche"] [data-raccourci-reglages]'),
          auLancement: !!document.querySelector('[data-barre-action] [data-reglages-du-lancement]'),
          envoi: x('[data-composer-envoi]'),
          dansLEnTete: !!document.querySelector('[data-rangee-de-boutons="champ-gauche"] ~ [data-raccourci-reglages], header [data-raccourci-reglages]'),
        };
      });
    for (const [nom, taille] of [['ordinateur', { width: 1400, height: 900 }], ['téléphone', { width: 390, height: 844 }]]) {
      await page.setViewportSize(taille);
      await page.waitForTimeout(1200);
      const barre = await barreEnOrdre();
      noter(
        `barre d’écriture (${nom}) : plus de réglages dans la barre, ils sont collés au bouton principal, rien ne déborde`,
        !!barre && barre.dedans && barre.sansDebordement && barre.joindre !== null && barre.auLancement && barre.reglages === null,
        JSON.stringify(barre),
      );
    }
    /* LE CONTEXTE, juste à gauche du micro : dans le groupe de droite, avant l'envoi, et son infobulle reste dans l'écran. */
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForTimeout(1000);
    const anneau = page.locator('[data-anneau-contexte]').first();
    if (await anneau.count()) {
      const place = await page.evaluate(() => {
        const a = document.querySelector('[data-anneau-contexte]');
        const droite = document.querySelector('[data-rangee-de-boutons="champ-droite"]');
        const envoi = document.querySelector('[data-composer-envoi]');
        const enfants = droite ? [...droite.children] : [];
        const iAnneau = enfants.findIndex((e) => e === a || e.contains(a));
        const iEnvoi = enfants.findIndex((e) => e === envoi || e.contains(envoi));
        return { dansLeGroupeDeDroite: iAnneau >= 0, avantLEnvoi: iEnvoi < 0 || iAnneau < iEnvoi, ancienne: !!document.querySelector('[data-rangee-de-boutons="champ-gauche"] > [data-anneau-contexte]') };
      });
      noter('contexte : l’anneau est dans le groupe de droite, avant l’envoi, plus après le trombone', place.dansLeGroupeDeDroite && place.avantLEnvoi && !place.ancienne, JSON.stringify(place));
      await anneau.hover();
      await page.waitForTimeout(900);
      const bulle = await page.evaluate(() => {
        const el = [...document.querySelectorAll('[role="tooltip"], [data-radix-popper-content-wrapper]')].find((e) => /Contexte du modèle/.test(e.textContent ?? ''));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { gauche: Math.round(r.left), droite: Math.round(r.right), largeurEcran: window.innerWidth };
      });
      noter('contexte : l’infobulle reste dans l’écran', !!bulle && bulle.gauche >= 0 && bulle.droite <= bulle.largeurEcran, JSON.stringify(bulle));
    } else {
      noter('contexte : l’anneau paraît quand le moteur a rendu une mesure', false);
    }
    noter('barre d’écriture : le bouton des réglages n’est plus dans l’en-tête de la carte', (await page.locator('[data-emplacement-reglages]').count()) === 0);

    noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await navigateur.close();
  }
  const ratees = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - ratees.length}/${resultats.length} contrôles au vert`);
  process.exit(ratees.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
