#!/usr/bin/env node
/**
 * LES RÉGLAGES EN COLONNE FIXE, DANS UN VRAI NAVIGATEUR (carte « Retrouver la gestion des accès clients », 24/11/2026 ;
 * le nom du fichier date des « deux niveaux » du 21/11, qu'il contrôlait avant d'être réécrit).
 *
 * Sur un DÉMON D'ESSAI (base neuve, jamais la production) qui sert l'interface construite de CETTE copie :
 *  - la colonne de gauche est toujours là : la recherche et SEPT rubriques, « Accès » en deuxième ; plus d'écran
 *    d'accueil à tuiles ni de « ‹ Réglages » sur ordinateur ;
 *  - une rubrique est UNE page qui empile ses sections titrées ; « Avancé » replié en bas, qui s'ouvre ;
 *  - la recherche ouvre la rubrique et descend jusqu'à la section, qu'elle marque ;
 *  - les anciennes adresses mènent toujours quelque part (page, alias, clé de rubrique) ;
 *  - aucun titre de section n'est redit par le bloc qui le suit ;
 *  - sur téléphone, deux crans : la liste des rubriques, puis la page ; la flèche de l'en-tête remonte ;
 *  - les champs posés dans un bloc sont CREUSÉS à la couleur de la page (rapport champ / bloc ≥ 1,07), et la recherche
 *    de la colonne garde son propre gris sur le fond de la fenêtre ; rien ne déborde en largeur sur téléphone ;
 *  - captures de chaque rubrique, 1440 / 390, clair / sombre.
 *
 *   npm run build   # l'interface de la copie
 *   VERIF_CAPTURES=/root/beluga/data/fichiers/verif-reglages node scripts/verif-reglages-deux-niveaux.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { monterLeDecorDesReglages } from './lib/decor-reglages.mjs';
import { contrasteDesChamps } from './lib/contraste-des-champs.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7319);
const CAPTURES = process.env.VERIF_CAPTURES || '/tmp/verif-reglages-colonne-fixe';
fs.mkdirSync(CAPTURES, { recursive: true });

const RUBRIQUES = ['moi', 'acces', 'agents-ia', 'ordinateurs', 'serveur', 'donnees', 'connexions'];

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const decor = await monterLeDecorDesReglages({ port: PORT, projets: [{ id: 'p-essai', name: 'Projet d’essai' }], prefixe: 'verif-reglages-' });
const navigateur = await chromium.launch({ channel: 'chrome' });

try {
  for (const largeur of [1440, 390]) {
    const telephone = largeur < 640;
    for (const theme of ['clair', 'sombre']) {
      const premier = theme === 'clair';
      const { page, ctx, erreurs } = await decor.ouvrirPage(navigateur, { largeur, theme });
      const capture = (n) => page.screenshot({ path: path.join(CAPTURES, `${n}-${largeur}-${theme}.png`) });
      const aller = async (cle) => {
        await page.goto(`${decor.ADRESSE}/#reglages${cle ? `/${cle}` : ''}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-modale-reglages] [data-menu-reglages]', { timeout: 45000, state: 'attached' });
        await pause(500);
      };

      await aller('');
      const sombre = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      noter(`${largeur}/${theme} : le thème demandé est appliqué`, sombre === (theme === 'sombre'));
      const rubriques = await page.locator('[data-rubrique-reglages]').evaluateAll((els) => els.map((e) => e.getAttribute('data-rubrique-reglages')));
      noter(`${largeur}/${theme} : sept rubriques, « Accès » en deuxième`, JSON.stringify(rubriques) === JSON.stringify(RUBRIQUES), rubriques.join(','));
      noter(
        `${largeur}/${theme} : plus d'écran d'accueil à tuiles ni de « ‹ Réglages »`,
        (await page.locator('[data-niveau-reglages="rubriques"]').count()) === 0 && (await page.locator('[data-modale-reglages] [data-retour-menu-reglages]:visible').count()) === 0,
      );
      const recherche = (await page.evaluate(contrasteDesChamps, '[data-modale-reglages]')).recherche;
      noter(`${largeur}/${theme} : la recherche de la colonne garde son gris sur le fond de la fenêtre`, recherche !== null && recherche >= 1.04, String(recherche));
      if (telephone) {
        noter('390 : la fenêtre s’ouvre sur la liste des rubriques', await page.locator('[data-menu-reglages]').isVisible());
        await capture('0-liste');
      } else {
        noter('1440 : la fenêtre s’ouvre sur la première rubrique, colonne et page côte à côte', (await page.locator('[data-page-reglages="moi"]').isVisible()) && (await page.locator('[data-menu-reglages]').isVisible()));
      }

      /* CHAQUE RUBRIQUE : sa page, ses sections, aucun titre redit. */
      for (const cle of RUBRIQUES) {
        await page.locator(`[data-rubrique-reglages="${cle}"]`).click();
        await page.waitForSelector(`[data-page-rubrique="${cle}"]`, { timeout: 20000 });
        await pause(1500);
        const etat = await page.evaluate(() => {
          const sections = [...document.querySelectorAll('[data-page-rubrique] [data-section-page]')];
          const redits = [];
          for (const s of sections) {
            const titre = s.querySelector(':scope > [data-titre-section]')?.textContent?.trim().toLowerCase();
            const premier = s.querySelector('[data-section-reglages] h3, [data-modele="reglages"] h3')?.textContent?.trim().toLowerCase();
            if (titre && premier && titre === premier) redits.push(titre);
          }
          return { sections: sections.length, redits };
        });
        noter(`${largeur}/${theme} : « ${cle} » est une page de sections`, etat.sections >= 1, String(etat.sections));
        noter(`${largeur}/${theme} : « ${cle} » ne redit aucun titre de section`, etat.redits.length === 0, etat.redits.join(', '));
        /* LES CHAMPS CREUSÉS : chaque champ d'un bloc se détache nettement de lui. */
        const champs = await page.evaluate(contrasteDesChamps, '[data-page-reglages]');
        if (champs.champs.length) {
          noter(
            `${largeur}/${theme} : « ${cle} » — chaque champ se détache de son bloc (≥ 1,07)`,
            champs.plusFaible >= 1.07,
            `${champs.champs.length} champ(s), le plus faible ${champs.plusFaible} ${champs.champs.find((c) => c.rapport === champs.plusFaible)?.champ ?? ''}`,
          );
        }
        if (cle === 'moi') noter(`${largeur}/${theme} : « moi » montre ses champs à l'ouverture`, champs.champs.length >= 2, String(champs.champs.length));
        if (telephone) {
          /* Ce qui sort de l'écran à droite, hors d'une zone qui défile en largeur (tableau) : rien. */
          const deborde = await page.evaluate(() => {
            const zone = document.querySelector('[data-page-reglages]');
            if (!zone) return ['(page absente)'];
            const dehors = [];
            for (const el of zone.querySelectorAll('*')) {
              const b = el.getBoundingClientRect();
              if (b.width < 1 || b.right <= innerWidth + 1) continue;
              let defile = false;
              for (let p = el.parentElement; p && p !== zone; p = p.parentElement) {
                const ox = getComputedStyle(p).overflowX;
                if (ox !== 'visible' && p.getBoundingClientRect().right <= innerWidth + 1) defile = true;
              }
              if (!defile) dehors.push(`<${el.tagName.toLowerCase()}> ${(el.textContent ?? '').trim().slice(0, 30)}`);
            }
            return dehors;
          });
          noter(`390/${theme} : « ${cle} » ne déborde pas en largeur`, deborde.length === 0, deborde.slice(0, 3).join(' | '));
        }
        await capture(`1-rubrique-${cle}`);
        if (telephone) {
          await page.locator('[data-retour-menu-reglages="rubriques"]').click();
          await pause(300);
          noter(`390/${theme} : la flèche remonte de « ${cle} » à la liste`, await page.locator('[data-menu-reglages]').isVisible());
        }
      }

      /* « AVANCÉ » replié en bas de Serveur, puis ouvert. */
      await aller('serveur');
      noter(`${largeur}/${theme} : « Avancé » est replié à l'ouverture`, (await page.locator('[data-avance-reglages="replie"]').count()) === 1);
      await page.locator('[data-basculer-avance]').click();
      await pause(400);
      const avancees = await page.locator('[data-avance-reglages="ouvert"] [data-section-page]').count();
      noter(`${largeur}/${theme} : « Avancé » ouvert montre ses deux sections`, avancees === 2, String(avancees));

      if (premier) {
        /* LA RECHERCHE descend jusqu'à la section et la marque. */
        await aller('');
        if (telephone) await pause(200);
        await page.locator('[data-recherche-reglages]').locator('input').first().fill('heures de silence').catch(async () => {
          await page.fill('input[data-recherche-reglages]', 'heures de silence');
        });
        await pause(400);
        noter(`${largeur} : la recherche trouve les notifications`, (await page.locator('[data-page-menu="notifications"]').count()) > 0);
        await page.locator('[data-page-menu="notifications"]').first().click();
        await page.waitForSelector('[data-section-page="notifications"][data-section-marquee="oui"]', { timeout: 5000 }).catch(() => undefined);
        await pause(600);
        const enVue = await page.evaluate(() => {
          const s = document.querySelector('[data-section-page="notifications"]');
          const z = document.querySelector('[data-page-reglages] [data-page-rubrique]')?.parentElement;
          if (!s || !z) return null;
          const haut = s.getBoundingClientRect().top - z.getBoundingClientRect().top;
          return Math.round(haut);
        });
        noter(`${largeur} : un résultat ouvre la rubrique et descend jusqu'à sa section`, enVue !== null && enVue >= -20 && enVue < 140, String(enVue));
        await capture('2-recherche-section');

        /* LES ANCIENNES ADRESSES. */
        for (const [cle, rubrique, section] of [
          ['langue', 'moi', 'theme'],
          ['sous-comptes', 'acces', null],
          ['comptes-clients', 'acces', null],
          ['extension', 'ordinateurs', null],
          ['donnees', 'donnees', null],
          ['gestes-serveur', 'serveur', 'gestes-serveur'],
        ]) {
          await aller(cle);
          const ouverte = await page.locator('[data-niveau-reglages]').getAttribute('data-rubrique-ouverte');
          const presente = section ? (await page.locator(`[data-section-page="${section}"]`).count()) === 1 : true;
          noter(`${largeur} : #reglages/${cle} mène à « ${rubrique} »${section ? ` › ${section}` : ''}`, ouverte === rubrique && presente, String(ouverte));
        }
        await aller('inconnue');
        noter(`${largeur} : une adresse inconnue n'ouvre pas un écran vide`, (await page.locator('[data-rubrique-reglages]').count()) === RUBRIQUES.length);

        /* LA PAGE DES ORDINATEURS s'ouvre ; la page d'un ordinateur s'ouvre ensuite dans le volet de droite (sous-page). */
        await aller('ordinateurs');
        noter(`${largeur} : la page des ordinateurs s'ouvre`, (await page.locator('[data-page-ordinateurs]').count()) === 1);
      }

      noter(`${largeur}/${theme} : aucune erreur de page`, erreurs.length === 0, erreurs.join(' | ').slice(0, 300));
      await ctx.close();
    }
  }
} catch (err) {
  noter('le contrôle va au bout', false, String(err?.stack ?? err).slice(0, 600));
} finally {
  await navigateur.close();
  decor.nettoyer();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} — captures dans ${CAPTURES}`);
process.exit(echecs.length ? 1 : 0);
