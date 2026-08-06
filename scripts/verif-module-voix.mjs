#!/usr/bin/env node
/**
 * Le module de voix se MÉTAMORPHOSE-t-il ?
 *
 * Un seul objet doit passer du petit rond au panneau large : pas un panneau qui
 * surgit à côté d'un bouton. On le juge sur du concret, dans un vrai navigateur :
 *   — au repos, c'est un rond (largeur = hauteur, coins à la moitié) ;
 *   — au survol, la MÊME boîte grandit PROGRESSIVEMENT (mesure prise en cours de
 *     route : une taille intermédiaire, donc une interpolation, pas un saut) ;
 *   — dépliée, elle porte l'historique, et le contenu est en fondu ;
 *   — en sortant, elle redevient un rond ;
 *   — pendant une parole, elle s'ouvre d'elle-même en bloc rectangulaire ;
 *   — au doigt, l'appui fait la même chose que le survol à la souris.
 *
 *   HAIKO_VOIX_URL=http://localhost:7099 node scripts/verif-module-voix.mjs
 *
 * Le serveur de DÉVELOPPEMENT est visé : un script de vérification ne reprend
 * jamais HAIKODEV_URL, qui désigne l'application déjà publiée, ni
 * HAIKODEV_TOKEN, qui est le jeton d'un agent.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';

// La racine se déduit du script lui-même : lancé depuis une copie de travail, il
// doit juger CE dépôt, jamais le dossier principal.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_VOIX_URL || 'http://localhost:7099';
const SHOTS = '/root/haikodev/data/verification';

const base = new Database('/root/haikodev/data/haikodev.db');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

// Les jetons de session sont stockés hachés : on s'en fabrique un, une heure,
// retiré en partant.
const jeton = crypto.randomBytes(32).toString('base64url');
base
  .prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)')
  .run(sha(jeton), Date.now(), Date.now() + 3600_000, 'vérification module de voix');
process.on('exit', () => base.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton)));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

console.log(`Dépôt jugé : ${RACINE}`);

const navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});

/** La géométrie du module, telle que l'écran la donne à l'instant t. */
const forme = (page) =>
  page.evaluate(() => {
    const module = document.querySelector('[data-module-voix]');
    if (!module) return null;
    const boite = module.getBoundingClientRect();
    const style = getComputedStyle(module);
    const icone = module.querySelector('[data-icone-voix]');
    const liste = module.querySelector('[data-liste-voix]');
    return {
      largeur: Math.round(boite.width),
      hauteur: Math.round(boite.height),
      rayon: Math.round(parseFloat(style.borderTopLeftRadius)),
      parle: module.hasAttribute('data-parle'),
      ouvert: module.hasAttribute('data-ouvert'),
      // Un seul objet : l'icône comme l'historique vivent DEDANS.
      iconeDedans: Boolean(icone),
      listeDedans: Boolean(liste),
      opaciteIcone: icone ? Number(getComputedStyle(icone).opacity) : -1,
      opaciteListe: liste ? Number(getComputedStyle(liste).opacity) : -1,
      messages: module.querySelectorAll('[data-message-voix]').length,
      ondes: Boolean(module.querySelector('[data-onde-vocale]')),
      repos: Boolean(module.querySelector('[data-icone-repos]')),
      pied: Boolean(module.querySelector('[data-pied-ondes]')),
      // La transition est-elle vraiment déclarée sur la boîte elle-même ?
      transition: style.transitionProperty,
      duree: style.transitionDuration,
    };
  });

/**
 * Ouvrir le panneau au SURVOL, sans passer par `.hover()` : le bloc en bas à
 * droite (messages courts, vignettes d'agents) flotte au-dessus de l'écran et
 * peut recouvrir la boîte du module, ce qui fait échouer le contrôle
 * d'actionabilité de `.hover()`. On vise le milieu de ce qui est VISIBLE et l'on
 * bouge la souris nous-mêmes — comme le fait `verif-reveil-vocal`.
 */
async function survolerModule(page) {
  const boite = await page.evaluate(() => {
    const m = document.querySelector('[data-module-voix]');
    if (!m) return null;
    const b = m.getBoundingClientRect();
    return { x: (Math.max(b.left, 0) + Math.min(b.right, window.innerWidth)) / 2, y: (Math.max(b.top, 0) + Math.min(b.bottom, window.innerHeight)) / 2 };
  });
  if (boite) await page.mouse.move(boite.x, boite.y);
}

async function ouvrirPage(contexte) {
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  // Un panneau rouvert d'une session précédente recouvrirait le bas de l'écran.
  for (let essai = 0; essai < 3 && (await page.locator('[role="dialog"]').count()); essai += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
  // La voix ne doit pas être muette : le module se juge en train de parler.
  await page.evaluate(() => localStorage.removeItem('voix.muet'));
  return { page, erreurs };
}

/**
 * On attend que la voix se TAISE avant de mesurer le repos : une parole ouvre le
 * module d'elle-même, et sa durée dépend du moteur de voix — la mesurer en
 * pleine phrase, c'est juger le module ouvert en le croyant fermé.
 */
async function attendreSilence(page) {
  await page
    .waitForFunction(() => !document.querySelector('[data-module-voix]')?.hasAttribute('data-parle'), null, {
      timeout: 60_000,
    })
    .catch(() => {});
  // Le temps que la boîte ait fini de se refermer.
  await page.waitForTimeout(700);
}

/** Trois annonces provoquées depuis la page, comme le démon en émet. */
async function troisAnnonces(page) {
  await page.evaluate(() => {
    const essai = window.haikodevEssai;
    essai.annonce('Première annonce de vérification');
    essai.annonce('Deuxième annonce de vérification');
    essai.annonce('Troisième annonce de vérification');
  });
  await page.waitForTimeout(1200);
}

/* ---------- 1. À la souris : le rond grandit en panneau ---------- */

const ordinateur = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
await ordinateur.addCookies([
  { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
]);
const { page: bureau, erreurs: erreursBureau } = await ouvrirPage(ordinateur);

if (!(await bureau.evaluate(() => Boolean(window.haikodevEssai?.annonce)))) {
  noter('la page est bien celle du serveur de développement', false, 'viser le serveur de développement');
} else {
  await troisAnnonces(bureau);
  await bureau.mouse.move(40, 120);
  await attendreSilence(bureau);

  const repos = await forme(bureau);
  if (!repos) {
    noter('le module de voix est à l’écran', false, 'aucun bloc [data-module-voix]');
  } else {
    noter('l’icône et l’historique vivent dans le MÊME objet', repos.iconeDedans && repos.listeDedans);
    noter('au repos, le module est un rond', repos.largeur === repos.hauteur, `${repos.largeur} × ${repos.hauteur} px`);
    noter(
      'au repos, les coins font la moitié : c’est un cercle',
      Math.abs(repos.rayon - repos.hauteur / 2) <= 1,
      `rayon ${repos.rayon} px pour ${repos.hauteur} px de haut`,
    );
    noter('au repos, l’historique est effacé', repos.opaciteListe === 0, `opacité ${repos.opaciteListe}`);
    noter('au repos, l’icône de vibration se voit', repos.repos && repos.opaciteIcone === 1);
    noter('la boîte elle-même porte la transition', /all|width/.test(repos.transition), repos.transition);
    await bureau.screenshot({ path: `${SHOTS}/voix-module-repos.png` });

    // Le morphisme : on regarde EN COURS DE ROUTE. Une taille intermédiaire
    // prouve l'interpolation ; un saut donnerait la taille finale d'emblée.
    await survolerModule(bureau);
    await bureau.waitForTimeout(120);
    const enRoute = await forme(bureau);
    await bureau.waitForTimeout(900);
    const ouvert = await forme(bureau);
    noter(
      'la boîte grandit progressivement, sans saut',
      enRoute.largeur > repos.largeur && enRoute.largeur < ouvert.largeur,
      `${repos.largeur} → ${enRoute.largeur} → ${ouvert.largeur} px`,
    );
    noter(
      'la hauteur suit le même mouvement',
      enRoute.hauteur > repos.hauteur && enRoute.hauteur <= ouvert.hauteur,
      `${repos.hauteur} → ${enRoute.hauteur} → ${ouvert.hauteur} px`,
    );
    noter('les coins se dénouent avec la boîte', ouvert.rayon < repos.rayon, `${repos.rayon} → ${ouvert.rayon} px`);
    noter('déplié, le module porte l’historique', ouvert.messages >= 3, `${ouvert.messages} messages`);
    noter('déplié, le contenu est bien visible', ouvert.opaciteListe === 1, `opacité ${ouvert.opaciteListe}`);
    noter('déplié, l’icône seule s’est effacée', ouvert.opaciteIcone === 0, `opacité ${ouvert.opaciteIcone}`);
    noter('déplié, la ligne d’ondes est en dessous', ouvert.pied);
    await bureau.screenshot({ path: `${SHOTS}/voix-module-deplie.png` });

    // Le contenu ne doit PAS surgir avant que la place soit faite.
    noter(
      'le contenu se dévoile après la boîte, pas avant',
      enRoute.opaciteListe < 1,
      `opacité en cours de route ${enRoute.opaciteListe}`,
    );

    // Réversible : en sortant, le même objet redevient un rond.
    await bureau.mouse.move(40, 120);
    await attendreSilence(bureau);
    const referme = await forme(bureau);
    noter(
      'en sortant, le module redevient le rond de départ',
      referme.largeur === repos.largeur && referme.hauteur === repos.hauteur,
      `${referme.largeur} × ${referme.hauteur} px`,
    );
    noter('refermé, l’historique est de nouveau effacé', referme.opaciteListe === 0);

    // La parole ouvre le module d'elle-même.
    await bureau.evaluate(() => window.haikodevEssai.annonce('Le module parle pour la vérification'));
    await bureau.waitForTimeout(700);
    const parlant = await forme(bureau);
    noter('une parole marque le module', parlant.parle);
    noter(
      'en parlant, le rond s’ouvre en bloc rectangulaire',
      parlant.largeur > repos.largeur && parlant.rayon < repos.rayon,
      `${parlant.largeur} px, rayon ${parlant.rayon} px`,
    );
    noter('en parlant, l’icône devient un flux d’ondes', parlant.ondes);
    await bureau.screenshot({ path: `${SHOTS}/voix-module-parle.png` });
  }
  noter('aucune erreur dans la page, à la souris', erreursBureau.length === 0, erreursBureau[0] ?? '');
}

/* ---------- 2. Au doigt : l'appui fait le même travail ---------- */

const telephone = await navigateur.newContext({
  viewport: { width: 402, height: 874 },
  isMobile: true,
  hasTouch: true,
});
await telephone.addCookies([
  { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
]);
const { page: mobile, erreurs: erreursMobile } = await ouvrirPage(telephone);

if (await mobile.evaluate(() => Boolean(window.haikodevEssai?.annonce))) {
  await troisAnnonces(mobile);
  await attendreSilence(mobile);
  const repos = await forme(mobile);
  if (!repos) {
    noter('le module de voix est à l’écran, au doigt', false);
  } else {
    noter('au doigt, le module est un rond au repos', repos.largeur === repos.hauteur && !repos.ouvert);
    await mobile.locator('[data-module-voix]').tap();
    await mobile.waitForTimeout(900);
    const deplie = await forme(mobile);
    noter('un appui déplie le module', deplie.ouvert && deplie.largeur > repos.largeur, `${deplie.largeur} px`);
    noter('déplié au doigt, l’historique se lit', deplie.messages >= 3, `${deplie.messages} messages`);
    noter('déplié au doigt, le module tient dans l’écran', deplie.largeur <= 402, `${deplie.largeur} px`);
    await mobile.screenshot({ path: `${SHOTS}/voix-module-doigt.png` });

    await mobile.touchscreen.tap(20, 300);
    await mobile.waitForTimeout(900);
    const referme = await forme(mobile);
    noter('un appui ailleurs referme le module', !referme.ouvert && referme.largeur === repos.largeur);
    await mobile.keyboard.press('Escape');
    await mobile.waitForTimeout(400);
  }
  noter('aucune erreur dans la page, au doigt', erreursMobile.length === 0, erreursMobile[0] ?? '');
}

await navigateur.close();

const tombes = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - tombes.length}/${resultats.length} contrôles passés.`);
if (tombes.length) {
  console.log('Contrôles tombés :');
  for (const t of tombes) console.log(`  - ${t.nom}`);
}
process.exit(tombes.length ? 1 : 0);
