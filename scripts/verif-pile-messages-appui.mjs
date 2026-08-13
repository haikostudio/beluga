#!/usr/bin/env node
/**
 * La pile des vignettes d'agents, en bas à droite, s'ouvre-t-elle au DOIGT ?
 *
 * Sur un écran tactile il n'y a pas de survol : sans appui, la pile resterait
 * fermée et les vignettes du dessous seraient inatteignables. On essaie donc
 * pour de vrai, sur deux appareils :
 *   — un téléphone (écran tactile, aucun survol) : appui qui déploie, second
 *     appui qui referme, appui ailleurs qui referme, croix atteignable ;
 *   — un ordinateur (souris) : le survol ouvre et la sortie referme.
 *
 * Les messages d'information passagers (les « toasts ») ne passent plus par
 * cette pile — ils sont en haut au centre, toujours entièrement visibles,
 * vérifiés par `scripts/verif-messages-info.mjs`.
 *
 *   HAIKO_PILE_URL=http://localhost:7099 node scripts/verif-pile-messages-appui.mjs
 *
 * Le serveur de DÉVELOPPEMENT est visé : un script de vérification ne reprend
 * jamais HAIKODEV_URL, qui désigne l'application déjà publiée, ni
 * HAIKODEV_TOKEN, qui est le jeton d'un agent.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';

const BASE = process.env.HAIKO_PILE_URL || 'http://localhost:7099';
const SHOTS = '/root/haikodev/data/verification';

const base = new Database('/root/haikodev/data/haikodev.db');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

// Les jetons de session sont stockés hachés : on s'en fabrique un, une heure,
// retiré en partant.
const jeton = crypto.randomBytes(32).toString('base64url');
base
  .prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)')
  .run(sha(jeton), Date.now(), Date.now() + 3600_000, 'vérification pile de vignettes');
process.on('exit', () => base.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton)));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function ouvrirPage(contexte) {
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  /*
    Le bloc garde la position où on l'a traîné (préférence « dock »), commune
    à tous les appareils : un décalage pris sur grand écran le pousse hors du
    téléphone. Ce n'est pas ce qu'on juge ici — on le ramène à sa place, le
    temps du contrôle, sans rien écrire dans les préférences.
  */
  await page.addStyleTag({ content: '[data-bloc="dock"] { transform: none !important; }' });
  // Sur téléphone, l'application rouvre là où on l'a quittée : un panneau peut
  // recouvrir le bas de l'écran. On le referme avant de juger la pile.
  for (let essai = 0; essai < 3 && (await page.locator('[role="dialog"]').count()); essai += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
  return { page, erreurs };
}

const etatVignettes = (page) =>
  page.evaluate(() => {
    const pile = document.querySelector('[data-pile="agents"]');
    if (!pile) return null;
    const rangs = Array.from(document.querySelectorAll('[data-vignette-pile]'));
    return {
      ouverte: pile.getAttribute('data-pile-ouverte') === 'oui',
      geste: pile.getAttribute('data-pile-geste'),
      hauteur: Math.round(pile.getBoundingClientRect().height),
      rangs: rangs.length,
      visibles: rangs.filter((el) => Number(getComputedStyle(el).opacity) > 0).length,
    };
  });

/* ---------- 1. Au doigt : l'appui déploie ---------- */

const telephone = await navigateur.newContext({
  viewport: { width: 402, height: 874 },
  isMobile: true,
  hasTouch: true,
});
await telephone.addCookies([
  { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
]);
const { page: mobile, erreurs: erreursMobile } = await ouvrirPage(telephone);

if (!(await mobile.evaluate(() => Boolean(window.haikodevEssai)))) {
  noter('la page est bien celle du serveur de développement', false, 'viser le serveur de développement');
} else {
  const vignettes = mobile.locator('[data-pile="agents"]');
  if (!(await vignettes.count())) {
    console.log('  (aucun agent en cours : la pile des vignettes n’a pas pu être jugée au doigt)');
  } else {
    const repos = await etatVignettes(mobile);
    noter('au doigt, les vignettes s’empilent aussi', repos.geste === 'appui' && !repos.ouverte);
    noter(
      'la pile des vignettes tient dans la hauteur d’une seule',
      repos.rangs <= 1 || repos.hauteur < 40 * repos.rangs,
      `${repos.hauteur} px pour ${repos.rangs} vignettes`,
    );
    noter('au repos, trois vignettes au plus se voient', repos.visibles <= 3, `${repos.visibles} visibles`);
    await vignettes.tap();
    await mobile.waitForTimeout(400);
    const deployees = await etatVignettes(mobile);
    noter('un appui déploie la pile des vignettes', deployees.ouverte);
    noter(
      'déployée, toutes les vignettes se voient',
      deployees.visibles === deployees.rangs,
      `${deployees.visibles}/${deployees.rangs}`,
    );
    await mobile.screenshot({ path: `${SHOTS}/pile-vignettes-deployee.png` });

    // Pile ouverte, chaque vignette répond de nouveau pour elle-même : sa croix
    // la retire, sans que l'agent s'arrête.
    const croix = mobile.locator('[data-vignette-pile="0"] button').last();
    const cible = await croix.boundingBox();
    noter(
      'la croix d’une vignette reste atteignable au doigt',
      cible && Math.round(cible.height) >= 32 && Math.round(cible.width) >= 32,
      cible ? `${Math.round(cible.width)} × ${Math.round(cible.height)} px` : 'introuvable',
    );
    await croix.tap();
    await mobile.waitForTimeout(400);
    const apres = await etatVignettes(mobile);
    noter(
      'pile ouverte, la croix retire bien sa vignette',
      (apres?.rangs ?? 0) === deployees.rangs - 1,
      `${deployees.rangs} → ${apres?.rangs ?? 0}`,
    );

    if (apres) {
      // Un appui ailleurs referme : au centre d'une vignette on toucherait le
      // bouton qui ouvre l'agent, et c'est très bien ainsi.
      await mobile.touchscreen.tap(20, 300);
      await mobile.waitForTimeout(400);
      noter('un appui ailleurs referme la pile des vignettes', !(await etatVignettes(mobile))?.ouverte);
      await mobile.keyboard.press('Escape');
      await mobile.waitForTimeout(400);
    } else {
      console.log('  (la dernière vignette retirée : plus rien à refermer)');
    }
  }

  noter('aucune erreur dans la page, au doigt', erreursMobile.length === 0, erreursMobile[0] ?? '');
}

/* ---------- 2. À la souris : le survol ouvre toujours ---------- */

const ordinateur = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
await ordinateur.addCookies([
  { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
]);
const { page: bureau, erreurs: erreursBureau } = await ouvrirPage(ordinateur);

if (await bureau.evaluate(() => Boolean(window.haikodevEssai))) {
  const vignettes = bureau.locator('[data-pile="agents"]');
  if (!(await vignettes.count())) {
    console.log('  (aucun agent en cours : la pile des vignettes n’a pas pu être jugée à la souris)');
  } else {
    const repos = await etatVignettes(bureau);
    noter('à la souris, le geste retenu est le survol', repos.geste === 'survol', repos.geste ?? '');
    noter('au repos, la pile est fermée', !repos.ouverte);

    await vignettes.hover();
    await bureau.waitForTimeout(400);
    const survolee = await etatVignettes(bureau);
    noter('le survol déploie la pile des vignettes', survolee.ouverte);
    await bureau.screenshot({ path: `${SHOTS}/pile-vignettes-survol.png` });

    await bureau.mouse.move(40, 120);
    await bureau.waitForTimeout(400);
    const sortie = await etatVignettes(bureau);
    noter('le curseur qui s’en va referme la pile', !sortie.ouverte);
  }
  noter('aucune erreur dans la page, à la souris', erreursBureau.length === 0, erreursBureau[0] ?? '');
}

await navigateur.close();
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
process.exit(echecs ? 1 : 0);
