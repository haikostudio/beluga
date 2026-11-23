#!/usr/bin/env node
/**
 * LA CONFIGURATION D'UN PROJET EST UNE FENÊTRE À RUBRIQUES ADRESSABLES.
 *
 * Elle était une colonne de 1152 lignes qu'il fallait dérouler de bout en bout.
 * Ce contrôle vérifie, dans un vrai navigateur, que le découpage n'a rien perdu
 * et que chaque promesse tient :
 *
 *  1. chaque rubrique s'ouvre et affiche du contenu ;
 *  2. l'adresse porte la rubrique, et un lien collé dans un onglet neuf y
 *     retombe — rechargement compris ;
 *  3. une rubrique inconnue ne laisse pas un écran vide : elle retombe sur la
 *     première et le DIT ;
 *  4. un réglage modifié dans une rubrique survit au passage par une autre —
 *     c'est ce qui prouve qu'un seul « Enregistrer » commande tout ;
 *  5. les DEUX mises en ligne ont le même dispositif : décrire, faire établir,
 *     relire. Le déploiement n'avait pas de bouton du tout ;
 *  6. pendant qu'un agent travaille, ses étapes s'affichent, se cochent et
 *     portent leur temps ;
 *  7. les raccourcis des colonnes ouvrent la rubrique de leur étape, l'ancien
 *     écran séparé ayant disparu.
 *
 * Il fabrique une session d'UNE HEURE, la retire en partant, et n'écrit rien
 * d'autre en base. AUCUN tour d'agent n'est payé : le travail en cours est
 * rejoué par le point d'essai, comme le serveur le diffuse.
 *
 * Il vise le serveur de DÉVELOPPEMENT par sa propre variable : `BELUGA_URL`
 * désigne l'application déjà publiée et n'a rien à faire ici.
 *
 *   HAIKO_CONFIG_URL=http://localhost:7099 node scripts/verif-config-projet.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

/* La racine se déduit du script : lancé d'une copie de travail, il juge CE
   code-là, jamais le dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADRESSE = process.env.HAIKO_CONFIG_URL || 'http://localhost:7099';
/* La base et ses dépendances natives vivent dans le dépôt PRINCIPAL, même quand
   ce script est lancé d'une copie de travail. */
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';

const echecs = [];
const constats = [];
const refuser = (message) => echecs.push(message);
const constater = (message) => constats.push(message);
const lire = (relatif) => fs.readFileSync(path.join(RACINE, relatif), 'utf8');

/* ------------------------------------------------------------------ */
/* Première moitié : ce que la SOURCE promet                          */
/* ------------------------------------------------------------------ */

const rubriquesSource = lire('shared/src/config-projet-rubriques.ts');
const coquille = lire('web/src/components/project-settings.tsx');

/* LES RUBRIQUES VIVENT DANS LE SOCLE PARTAGÉ : leurs clés sont dans l'adresse,
   leurs titres sont des clés du dictionnaire. L'écran n'ajoute que l'icône et
   le bloc affiché. */
const declarees = [...rubriquesSource.matchAll(/^ {4}cle: (?:'([a-z-]+)'|(RUBRIQUE_[A-Z]+))/gm)].map(
  (m) => m[1] ?? { RUBRIQUE_DEPLOIEMENT: 'deploiement', RUBRIQUE_PRODUCTION: 'production' }[m[2]],
);
if (declarees.length < 6) refuser(`seulement ${declarees.length} rubriques déclarées, 6 au moins attendues`);
else constater(`${declarees.length} rubriques déclarées dans le socle partagé`);

for (const cle of declarees) {
  if (!new RegExp(`^  ${cle}: \\{`, 'm').test(coquille)) refuser(`la rubrique « ${cle} » n'a aucun bloc à afficher`);
}

/* L'ancienne colonne de 1152 lignes est découpée : plus rien d'énorme ici. */
const lignes = coquille.split('\n').length;
if (lignes > 600) refuser(`project-settings.tsx fait encore ${lignes} lignes — le découpage n'a pas eu lieu`);
else constater(`project-settings.tsx tient en ${lignes} lignes`);

/* UN PROJET NE S'EFFACE JAMAIS DEPUIS L'ÉCRAN (22/09/2026) : ni bouton, ni commande. */
if (/project\.delete/.test(coquille) || /data-effacer-projet/.test(lire('web/src/components/config-projet/page-retrait.tsx')))
  refuser('les réglages du projet peuvent encore l’effacer');
else constater('les réglages du projet ne peuvent que le mettre de côté');

/* LES DEUX MARCHES À SUIVRE NE SE MÉLANGENT JAMAIS. */
const dev = lire('web/src/components/config-projet/page-deploiement.tsx');
const prod = lire('web/src/components/config-projet/page-production.tsx');
if (/cible="production"/.test(dev)) refuser('la rubrique du déploiement parle de la production');
if (/cible="dev"/.test(prod)) refuser('la rubrique de la production parle du déploiement');
if (!/data-generer-deploiement/.test(dev)) refuser('le déploiement n’a toujours pas son bouton d’établissement');
if (!/data-generer-production/.test(prod)) refuser('la mise en production a perdu son bouton d’établissement');
constater('les deux étapes ont le même dispositif, et ne se mélangent jamais');

/* L'ANCIEN ÉCRAN SÉPARÉ A DISPARU : plus deux écrans pour les mêmes consignes. */
if (fs.existsSync(path.join(RACINE, 'web/src/components/procedure-panel.tsx'))) {
  refuser('le panneau séparé de procédure existe encore');
} else {
  constater('le panneau séparé a disparu : un seul endroit dit la marche à suivre');
}
if (/TiroirProcedure/.test(lire('web/src/components/board.tsx'))) {
  refuser('le tableau ouvre encore l’ancien tiroir');
}

/* ------------------------------------------------------------------ */
/* Seconde moitié : ce que le NAVIGATEUR montre                        */
/* ------------------------------------------------------------------ */

/**
 * Une session d'UNE HEURE, fabriquée puis retirée : la colonne `token` garde le
 * SHA-256 du cookie, jamais le cookie.
 */
async function avecSession(travail) {
  const { default: crypto } = await import('node:crypto');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const ouvrir = () =>
    require(path.join(DONNEES, '../node_modules/better-sqlite3'))(cheminDeLaBaseServie(DONNEES));

  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const db = ouvrir();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3_600_000,
    'vérification de la configuration d’un projet',
  );
  db.close();
  try {
    return await travail(cookie);
  } finally {
    const fin = ouvrir();
    fin.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    fin.close();
  }
}

/** On attend un ÉTAT, jamais une durée : le serveur de dev compile à la demande. */
async function attendrePret(page) {
  for (let essai = 0; essai < 60; essai += 1) {
    if (await page.evaluate(() => window.belugaEssai?.pret?.() === true)) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

/** Un tiroir laissé ouvert couvre l'écran : on referme ce qui traîne. */
async function refermerCeQuiTraine(page) {
  for (let essai = 0; essai < 6; essai += 1) {
    const ouvert = await page.evaluate(
      () => document.querySelectorAll('[role="dialog"],[role="alertdialog"]').length,
    );
    if (!ouvert && essai > 0) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }
}

/** La configuration s'ouvre par l'ADRESSE : aucun clic à deviner dans l'écran. */
async function ouvrirLaConfig(page, projectId, rubrique) {
  await page.evaluate(
    ([id, cle]) => {
      window.location.hash = cle ? `projet/${id}/config/${cle}` : `projet/${id}/config`;
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    [projectId, rubrique ?? ''],
  );
  await page.waitForSelector('[data-config-projet]', { timeout: 20_000 });
  await page.waitForTimeout(500);
}

async function auNavigateur() {
  const { chromium } = await import('playwright');
  return avecSession(async (session) => {
    const navigateur = await chromium.launch({ channel: 'chrome' });
    try {
      const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
      await contexte.addCookies([{ name: 'beluga_session', value: session, domain: 'localhost', path: '/' }]);
      const page = await contexte.newPage();
      try {
        await page.goto(ADRESSE, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      } catch (err) {
        return `serveur de développement injoignable sur ${ADRESSE} — ${err.message.split('\n')[0]}`;
      }
      if (!(await attendrePret(page))) return 'l’application n’a jamais été prête';
      await refermerCeQuiTraine(page);

      const projets = await page.evaluate(() => window.belugaEssai.projets());
      if (!projets.length) return 'aucun projet en base : rien à configurer';
      const projet = projets[0];

      /* ---------------- 1. Chaque rubrique s'ouvre ------------------- */
      await ouvrirLaConfig(page, projet.id);
      if (!(await page.locator('[data-menu-config]').isVisible())) {
        refuser('le menu des rubriques n’est pas affiché sur grand écran');
      } else {
        constater('le menu des rubriques est affiché sur grand écran');
      }

      const cles = await page
        .locator('[data-rubrique-config]')
        .evaluateAll((noeuds) => noeuds.map((n) => n.getAttribute('data-rubrique-config')));
      const manquantes = declarees.filter((cle) => !cles.includes(cle));
      if (manquantes.length) refuser(`rubriques absentes du menu : ${manquantes.join(', ')}`);

      for (const cle of cles) {
        await page.locator(`[data-rubrique-config="${cle}"]`).click({ timeout: 10_000 });
        try {
          await page.waitForSelector(`[data-rubrique-contenu="${cle}"]`, { timeout: 10_000 });
        } catch {
          refuser(`la rubrique « ${cle} » ne s’ouvre pas`);
          continue;
        }
        const texte = (await page.locator(`[data-rubrique-contenu="${cle}"]`).innerText()) ?? '';
        if (texte.trim().length < 20) refuser(`la rubrique « ${cle} » s’ouvre vide`);
        /* L'ANCIEN BOUTON « EFFACER » N'EXISTE PLUS : la rubrique du retrait porte « Mettre de côté » (un seul)
           et la suppression DÉFINITIVE, qui passe par un dialogue à nom recopié (`verif-suppression-projet.mjs`). */
        /* L'ARCHIVAGE A SA RUBRIQUE depuis le 20/11/2026 : « Supprimer » ne porte plus que la suppression. */
        if (cle === 'retrait') {
          if ((await page.locator('[data-effacer-projet]').count()) > 0) refuser('l’ancien bouton « Effacer » est encore affiché');
          else if ((await page.locator('[data-archiver-projet]').count()) !== 0) refuser('l’archivage est encore caché sous « Supprimer »');
          else if ((await page.locator('[data-supprimer-projet]').count()) !== 1) refuser('le bouton « Supprimer définitivement… » manque');
          else constater('la rubrique « Supprimer » ne propose que « Supprimer définitivement… », jamais un effacement direct');
        }
        if (cle === 'archivage') {
          if ((await page.locator('[data-archiver-projet]').count()) !== 1) refuser('la rubrique « Archivage » n’a pas son bouton');
          else if ((await page.locator('[data-archivage-historique]').count()) !== 1) refuser('la rubrique « Archivage » n’a pas son historique');
          else constater('la rubrique « Archivage » porte son bouton et son historique');
        }
        /* 2. L'ADRESSE SUIT LA RUBRIQUE OUVERTE. */
        const fragment = await page.evaluate(() => window.location.hash);
        const attendu = cle === declarees[0] ? `#projet/${projet.id}/config` : `#projet/${projet.id}/config/${cle}`;
        if (fragment !== attendu) refuser(`l’adresse de « ${cle} » vaut « ${fragment} », attendu « ${attendu} »`);
      }
      constater(`les ${cles.length} rubriques s’ouvrent, affichent du contenu et portent leur adresse`);

      /* ---- 3. Un lien collé dans un onglet NEUF retombe au bon endroit ---- */
      const neuf = await contexte.newPage();
      await neuf.goto(`${ADRESSE}/#projet/${projet.id}/config/production`, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      });
      if (!(await attendrePret(neuf))) {
        refuser('l’onglet neuf n’a jamais été prêt');
      } else {
        try {
          await neuf.waitForSelector('[data-rubrique-contenu="production"]', { timeout: 20_000 });
          constater('un lien collé dans un onglet neuf rouvre le bon projet sur la bonne rubrique');
        } catch {
          refuser('un lien collé dans un onglet neuf ne rouvre pas la rubrique visée');
        }
      }
      await neuf.close();

      /* ---- 4. Une rubrique inconnue retombe sur la première, et le DIT ---- */
      await ouvrirLaConfig(page, projet.id, 'rubrique-qui-n-existe-plus');
      await page.waitForTimeout(800);
      const retombee = await page.locator(`[data-rubrique-contenu="${declarees[0]}"]`).count();
      if (!retombee) refuser('une rubrique inconnue laisse un écran vide au lieu de retomber sur la première');
      else constater('une rubrique inconnue retombe sur la première');

      /* ---- 5. Un réglage modifié survit au passage par une autre rubrique ---- */
      await page.locator('[data-rubrique-config="deploiement"]').click();
      await page.waitForSelector('[data-url-dev]');
      const marque = `https://essai-config-${Date.now()}.exemple`;
      await page.locator('[data-url-dev]').fill(marque);
      await page.locator('[data-rubrique-config="general"]').click();
      await page.waitForSelector('[data-nom-projet]');
      await page.locator('[data-rubrique-config="deploiement"]').click();
      await page.waitForSelector('[data-url-dev]');
      const relu = await page.locator('[data-url-dev]').inputValue();
      if (relu !== marque) refuser(`un réglage est perdu en changeant de rubrique : « ${relu} »`);
      else constater('un réglage modifié survit au passage par une autre rubrique');

      /* ---- 6. LES DEUX MISES EN LIGNE, MÊME DISPOSITIF ------------------ */
      const boutonDev = page.locator('[data-generer-deploiement]');
      if (!(await boutonDev.count())) refuser('la rubrique du déploiement n’a pas son bouton d’établissement');
      else {
        /* Le bouton ne PAIE rien tant qu'on n'a rien décrit : c'est ce qui
           empêche un tour d'agent lancé sur une page vide. */
        await page.locator('[data-consignes-deploiement]').fill('');
        await page.waitForTimeout(200);
        if (!(await boutonDev.isDisabled())) refuser('le bouton du déploiement part sans description');
        await page.locator('[data-consignes-deploiement]').fill('Reconstruire puis relancer le service.');
        await page.waitForTimeout(200);
        if (await boutonDev.isDisabled()) refuser('le bouton du déploiement reste éteint malgré une description');
        else constater('le déploiement a le bouton qui lui manquait, éteint tant que rien n’est décrit');
      }

      await page.locator('[data-rubrique-config="production"]').click();
      await page.waitForSelector('[data-mise-en-production]');
      await page.locator('[data-type-cible="consigne"]').click();
      await page.waitForTimeout(300);
      if (!(await page.locator('[data-generer-production]').count())) {
        refuser('la mise en production a perdu son bouton d’établissement');
      } else {
        constater('la mise en production garde le même bouton, au même endroit');
      }
      /* LES DEUX TEXTES SONT DISTINCTS : l'un ne peut pas servir pour l'autre. */
      const baseProd = `production-${Date.now()}`;
      await page.locator('[data-base-production]').fill(baseProd);
      await page.locator('[data-rubrique-config="deploiement"]').click();
      await page.waitForSelector('[data-consignes-deploiement]');
      const baseDev = await page.locator('[data-consignes-deploiement]').inputValue();
      if (baseDev === baseProd) refuser('les deux étapes partagent leur description');
      else constater('les deux étapes gardent chacune sa description');

      /* ---- 7. LES ÉTAPES DE L'AGENT SE COCHENT, AVEC LEUR TEMPS --------- */
      const depart = Date.now() - 40_000;
      await page.evaluate(
        ([id, debut]) =>
          window.belugaEssai.procedure(
            id,
            'dev',
            { projectId: id, cible: 'dev', agentId: 'essai-agent', enCours: true, echanges: [], depuis: debut },
            [
              { id: 'e1', label: 'Lecture des scripts du projet', state: 'done', startedAt: debut, endedAt: debut + 12_000 },
              { id: 'e2', label: 'Lecture du service système', state: 'done', startedAt: debut + 12_000, endedAt: debut + 25_000 },
              { id: 'e3', label: 'Rédaction de la marche à suivre', state: 'running', startedAt: debut + 25_000 },
            ],
          ),
        [projet.id, depart],
      );
      await page.waitForTimeout(600);
      const suivi = page.locator('[data-etapes-agent]');
      if (!(await suivi.count())) {
        refuser('les étapes de l’agent ne s’affichent pas pendant qu’il travaille');
      } else {
        const faites = await page.locator('[data-etape-agent="done"]').count();
        const enCours = await page.locator('[data-etape-agent="running"]').count();
        const texte = await suivi.innerText();
        if (faites !== 2 || enCours !== 1) refuser(`étapes mal cochées : ${faites} faites, ${enCours} en cours`);
        else if (!/\d/.test(texte)) refuser('les étapes n’affichent aucun temps');
        else constater('les étapes de l’agent se cochent une à une, chacune avec son temps');
      }
      /* Un tour PERDU se dit, avec de quoi le relancer. */
      await page.evaluate(
        ([id]) =>
          window.belugaEssai.procedure(id, 'dev', {
            projectId: id,
            cible: 'dev',
            enCours: false,
            echanges: [],
            raison: 'Le tour de l’agent ne tourne plus.',
          }),
        [projet.id],
      );
      await page.waitForTimeout(500);
      if (!(await page.locator('[data-erreur-procedure]').count())) {
        refuser('un tour tombé ne se dit pas');
      } else if (!(await page.locator('[data-relancer-procedure]').count())) {
        refuser('un tour tombé n’offre pas de le relancer');
      } else {
        constater('un tour tombé se dit en clair, avec un bouton pour le relancer');
      }
      await page.evaluate(([id]) => window.belugaEssai.procedure(id, 'dev', null), [projet.id]);

      /* ---- 8. LES RACCOURCIS DES COLONNES OUVRENT LA BONNE RUBRIQUE ----- */
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
      await page.evaluate(
        ([id]) => {
          window.location.hash = `projet/${id}`;
          window.dispatchEvent(new PopStateEvent('popstate'));
        },
        [projet.id],
      );
      await page.waitForTimeout(1500);
      const raccourci = page.locator('[data-initier-procedure], [data-reglages-procedure]').first();
      if (!(await raccourci.count())) {
        refuser('aucun raccourci de colonne vers la marche à suivre');
      } else {
        const cible = await raccourci.evaluate(
          (n) => n.getAttribute('data-initier-procedure') ?? n.getAttribute('data-reglages-procedure'),
        );
        await raccourci.click({ force: true });
        /* 29/09/2026 : les DEUX étapes ouvrent leur rubrique des réglages, où
           vivent leur agent de configuration et le processus qu'il écrit. */
        const rubrique = cible === 'dev' ? 'deploiement' : 'production';
        try {
          await page.waitForSelector(`[data-rubrique-contenu="${rubrique}"]`, { timeout: 10_000 });
          constater(`le raccourci de la colonne ouvre bien la rubrique « ${rubrique} »`);
        } catch {
          refuser(`le raccourci de la colonne n’ouvre pas la rubrique « ${rubrique} »`);
        }
      }

      return null;
    } finally {
      await navigateur.close();
    }
  });
}

if (!process.env.HAIKO_CONFIG_SOURCE) {
  try {
    const panne = await auNavigateur();
    if (panne) refuser(`la fenêtre n'a PAS pu être mesurée : ${panne}`);
  } catch (err) {
    refuser(`la mesure au navigateur est tombée — ${err.message.split('\n')[0]}`);
  }
}

/* ------------------------------------------------------------------ */

console.log('\nLA CONFIGURATION D’UN PROJET\n');
for (const ligne of constats) console.log(`  ✓ ${ligne}`);
if (echecs.length) {
  console.log('');
  for (const ligne of echecs) console.log(`  ✗ ${ligne}`);
  console.log(`\n${echecs.length} refus.`);
  process.exit(1);
}
console.log('\nTout tient.');
