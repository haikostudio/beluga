/**
 * LES SERVICES, DERRIÈRE LA GRILLE — PREMIER CRAN DU FIL D'ARIANE (06/11/2026).
 *
 * Depuis la carte « Finitions du lecteur de charte » : sur ordinateur, le bouton
 * `[data-navigation-compacte]` est la grille en tête du fil d'Ariane (il a quitté
 * la colonne, où le bouton violet « Tableaux de bord » reste seul).
 * SUR TÉLÉPHONE, DEPUIS LE 13/11/2026 (carte « Onglets et menu service sur mobile ») : plus de ☰ ni de grille des
 * services derrière le nom du haut. Le NOM CENTRÉ (`[data-menu-principal]`) ouvre le menu principal ; les outils d'un
 * projet montent dans la feuille « Outils » (`[data-feuille-des-services="projet"]`), ouverte par l'entrée
 * « Outils du projet » des trois points du haut (`[data-ouvrir-outils-du-projet]`).
 * Les tuiles gardent `data-ouvrir-*` et `data-destination`. Le texte d'avant suit.
 *
 * Les destinations (résumé, statistiques, coffre-fort, mémoire, messagerie,
 * backup, surveillance, marketing, studio, notes) vivent derrière UN bouton, en
 * tête de la colonne de gauche (`[data-navigation-compacte]`, 30/10/2026 : il a
 * quitté la barre d'en-tête). Il ouvre une GRILLE — un menu
 * (`[data-navigation-panneau="ouvert"]`), une tuile par service — AU CLIC.
 *
 * LE CONTENU D'UN MENU EST DÉMONTÉ TANT QU'IL EST FERMÉ : les tuiles
 * (`data-ouvrir-*`, `data-destination`) et leurs pastilles n'existent dans le
 * document qu'une fois la grille ouverte. On ne peut donc plus les compter ni
 * lire leurs compteurs grille fermée ; fermé, le bouton ne porte qu'un point
 * (`[data-alerte-navigation]`) quand un message attend ou qu'un site est tombé.
 *
 * Sur téléphone, la colonne vit dans le menu (`[data-menu-du-telephone]`, la seule
 * porte de la barre du haut) : `ouvrirNavigation` l'ouvre d'abord, puis touche le
 * bouton ; sa grille monte du bas de l'écran. Elle ne touche jamais une grille déjà
 * ouverte (le geste bascule). Sans bouton, elle rend `false`.
 *
 *   import { ouvrirNavigation, allerVers } from './lib/navigation.mjs';
 *   await ouvrirNavigation(page);
 *   await page.click('[data-ouvrir-coffre]:visible');
 *   // ou, d'un seul geste :
 *   await allerVers(page, 'coffre');
 *
 * OUVRIR UNE CARTE (08/11/2026) : le tableau et ses `article` ont disparu de
 * l'accueil ; une carte s'ouvre par sa ligne de la colonne de gauche
 * (`[data-agent-en-liste="<id de la CARTE>"]`, jamais l'id de l'agent), après
 * avoir ouvert son projet si la ligne n'y est pas. `ouvrirLaCarte(page, { id,
 * titre, projetId })` : `id` (celui de la carte) ou, à défaut, `titre`.
 */

const BOUTON = '[data-navigation-compacte]';
const PANNEAU_OUVERT = '[data-navigation-panneau="ouvert"]';

/* Le nom centré du haut, qui a remplacé le ☰ (13/11/2026) : celui de la page posée par-dessus s'il y en a une. */
const BOUTON_DU_MENU = '[data-menu-principal]:visible';

/** Sur téléphone : ouvre le menu, s'il ne l'est pas. Rend `true` s'il a fallu l'ouvrir. */
export async function ouvrirLeMenuDuTelephone(page, { timeout = 15000 } = {}) {
  if (await page.locator('[data-menu-du-telephone]:visible').count()) return false;
  const bouton = page.locator(BOUTON_DU_MENU).first();
  if (!(await bouton.count())) return false;
  const tactile = await page.evaluate(() => navigator.maxTouchPoints > 0);
  if (tactile) await bouton.tap();
  else await bouton.click();
  await page.locator('[data-menu-du-telephone]').first().waitFor({ state: 'visible', timeout });
  await page.waitForTimeout(300);
  return true;
}

/** Ouvre la grille des services : clic à la souris, toucher sur écran tactile. Rend `true` s'il a fallu l'ouvrir. */
export async function ouvrirNavigation(page, { timeout = 30000 } = {}) {
  /* TÉLÉPHONE : les trois points du haut, puis « Outils du projet » — la feuille des outils monte du bas. */
  const troisPoints = page.locator('[data-entete-de-zone] [data-trois-points-du-haut]:visible').first();
  if (!(await page.locator(`${BOUTON}:visible`).count()) && (await troisPoints.count())) {
    if (await page.locator(`${PANNEAU_OUVERT}:visible`).count()) return false;
    const tactile = await page.evaluate(() => navigator.maxTouchPoints > 0);
    if (tactile) await troisPoints.tap();
    else await troisPoints.click();
    const entree = page.locator('[data-ouvrir-outils-du-projet]:visible').first();
    await entree.waitFor({ state: 'visible', timeout: 8000 });
    if (tactile) await entree.tap();
    else await entree.click();
    await page.locator(`${PANNEAU_OUVERT}:visible`).first().waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(350);
    return true;
  }
  await page.locator(BOUTON).first().waitFor({ state: 'attached', timeout });
  const bouton = page.locator(`${BOUTON}:visible`).first();
  if (!(await bouton.count())) return false;
  if ((await bouton.getAttribute('data-navigation-compacte')) === 'ouverte') return false;
  const tactile = await page.evaluate(() => navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);
  /* Une grille qui vient de servir se referme encore : le premier appui peut tomber
     pendant sa fermeture et être avalé. On le rejoue une fois avant de conclure. */
  for (let essai = 0; essai < 2; essai += 1) {
    if (tactile) await bouton.tap();
    else await bouton.click();
    const ouverte = await page
      .locator(`${PANNEAU_OUVERT}:visible`)
      .first()
      .waitFor({ state: 'visible', timeout: essai === 0 ? 3000 : 5000 })
      .then(() => true, () => false);
    if (ouverte) return true;
    if ((await bouton.getAttribute('data-navigation-compacte')) === 'ouverte') break;
  }
  await page.locator(`${PANNEAU_OUVERT}:visible`).first().waitFor({ state: 'visible', timeout: 5000 });
  return true;
}

/** Ouvre la grille, puis clique la tuile de repère `data-ouvrir-<repere>`. */
export async function allerVers(page, repere) {
  await ouvrirNavigation(page);
  await page.locator(`[data-ouvrir-${repere}]:visible`).first().click();
}

/*
 * LA COLONNE DE GAUCHE EST LA MÊME PARTOUT (ordinateur) : groupes, projets, tâches.
 * Seul un service qui a son menu la prend : on en sort par la flèche de retour de
 * sa tête (`[data-menu-de-colonne]`), d'un cran à la fois.
 */
const COLONNE = 'aside[data-zone="gauche"]';
const RETOUR_DE_COLONNE = `${COLONNE} [data-menu-de-colonne]:visible`;

/**
 * Vers la page « Tableaux de bord », par un vrai geste : le bouton violet de la grille des services (premier cran du
 * fil d'Ariane) — il a quitté la tête de la colonne (carte « Lecteur de charte : commentaires et barre »).
 */
export async function ouvrirLesTableauxDeBord(page, { timeout = 30000 } = {}) {
  /* DEPUIS LA REFONTE DU 13/11/2026, dans un projet, les tableaux de bord sont une entrée du menu à trois points de
     la colonne de gauche (le bouton aux quatre carrés ne porte que les outils du projet). Hors projet, la grille
     du fil d'Ariane les porte encore. */
  const troisPoints = page.locator('aside[data-zone="gauche"] [data-trois-points-colonne]:visible').first();
  if (await troisPoints.count()) {
    await troisPoints.click({ timeout });
    await page.locator('[data-menu-dossier-panneau] [data-ouvrir-en-route]').first().click({ timeout: 10000 });
    await page.locator('[data-page-en-route]').first().waitFor({ state: 'visible', timeout: 15000 });
    return;
  }
  await ouvrirNavigation(page, { timeout });
  await page.locator('[data-ouvrir-en-route]:visible').first().click();
  await page.locator('[data-page-en-route]').first().waitFor({ state: 'visible', timeout: 15000 });
}

/** Ouvre un projet par sa ligne de la colonne de gauche, comme un utilisateur, et attend sa page. */
export async function ouvrirLeProjet(page, projetId, { timeout = 30000 } = {}) {
  const ligne = page.locator(`${COLONNE} [data-projet-cible="${projetId}"] button:visible`).first();
  const retour = page.locator(RETOUR_DE_COLONNE).first();
  await ligne.or(retour).first().waitFor({ state: 'visible', timeout });
  for (let cran = 0; cran < 3 && !(await ligne.count()) && (await retour.count()); cran += 1) {
    await retour.click();
    await page.waitForTimeout(600);
  }
  await ligne.click({ timeout: 20000 });
  /* PLUS DE TABLEAU (30/10/2026) : la page du projet est montée — son accueil,
     ou, par-dessus, son dernier agent rouvert. */
  await page.locator(`[data-page-du-projet="${projetId}"]`).first().waitFor({ state: 'attached', timeout: 20000 });
}

/**
 * Ouvre la page d'une carte par sa ligne de la colonne de gauche, comme un utilisateur, et attend `[data-page-carte]`.
 * `id` = id de la carte ; sans `id`, la ligne est trouvée par son `titre`. `projetId` : projet à ouvrir si la ligne
 * n'est pas encore dans la colonne.
 */
export async function ouvrirLaCarte(page, { id, titre, projetId, timeout = 30000 } = {}) {
  if (!id && !titre) throw new Error('ouvrirLaCarte : il faut un id ou un titre');
  const ligne = () =>
    id
      ? page.locator(`${COLONNE} [data-agent-en-liste="${id}"] :is(a, button)`).first()
      : page.locator(`${COLONNE} [data-agent-en-liste]`).filter({ hasText: titre }).locator(':is(a, button)').first();
  if (!(await ligne().count()) && projetId) {
    /* Le premier bouton de la ligne du projet est « Nouvel agent » : on vise le lien du projet, puis on déplie ses tâches. */
    const projet = page.locator(`${COLONNE} [data-projet-cible="${projetId}"]`).first();
    await projet.waitFor({ state: 'visible', timeout });
    await projet.locator('a[href^="#projet/"]').first().click({ timeout });
    await page.waitForTimeout(600);
    const plier = projet.locator('[data-deplier-taches][aria-expanded="false"]').first();
    if (!(await ligne().count()) && (await plier.count())) await plier.click({ timeout });
    await ligne().waitFor({ state: 'visible', timeout });
  }
  await ligne().click({ timeout });
  const ouverte = id ? `[data-page-carte="${id}"]` : '[data-page-carte]';
  await page.locator(ouverte).first().waitFor({ state: 'visible', timeout });
  await page.waitForTimeout(800);
}

/**
 * LA PAGE D'UN SERVICE SUR « TOUS LES PROJETS » (fil « Service / Projet / Fiche », 20/11/2026). Le cran du projet
 * (`[data-cran-a-menu="portee-du-service"]`) n'existe que si la page est limitée à un projet ; un clic sur le NOM du
 * service (`[data-nom-du-cran="service-de-la-page"]`) la remet sur tous les projets. Rend vrai quand c'est fait.
 */
export async function porteeSurTousLesProjets(page) {
  const service = page.locator('[data-nom-du-cran="service-de-la-page"]:visible').first();
  const projet = page.locator('[data-cran-a-menu="portee-du-service"]:visible');
  for (let essai = 0; essai < 3 && (await projet.count()); essai++) {
    await service.click().catch(() => undefined);
    await page.waitForTimeout(700);
  }
  return (await projet.count()) === 0;
}

/**
 * OUVRE UNE SECTION DES RÉGLAGES (colonne fixe, 24/11/2026) : la fenêtre n'a plus de menu de pages à cliquer — une
 * rubrique est une seule page qui empile ses sections. L'adresse `#reglages/<clé>` ouvre la rubrique et descend à la
 * section (ou ouvre la rubrique en haut pour une clé de rubrique). Attend que la section soit dans la page.
 */
export async function ouvrirSectionDesReglages(page, cle, { timeout = 15000 } = {}) {
  await page.evaluate((c) => {
    window.location.hash = `reglages/${c}`;
  }, cle);
  await page.locator('[data-modale-reglages] [data-menu-reglages]').first().waitFor({ state: 'attached', timeout });
  await page
    .locator(`[data-section-page="${cle}"], [data-page-rubrique="${cle}"]`)
    .first()
    .waitFor({ state: 'attached', timeout });
  await page.waitForTimeout(300);
}
