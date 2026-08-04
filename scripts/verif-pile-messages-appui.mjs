#!/usr/bin/env node
/**
 * La pile des messages courts, en bas à droite, s'ouvre-t-elle au DOIGT ?
 *
 * Sur un écran tactile il n'y a pas de survol : sans appui, la pile resterait
 * fermée et les messages du dessous seraient inatteignables. On essaie donc
 * pour de vrai, sur deux appareils :
 *   — un téléphone (écran tactile, aucun survol) : appui qui déploie, second
 *     appui qui referme, appui ailleurs qui referme, croix atteignable ;
 *   — un ordinateur (souris) : le survol ouvre et la sortie referme.
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
  .run(sha(jeton), Date.now(), Date.now() + 3600_000, 'vérification pile de messages');
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

/** Trois messages courts, provoqués depuis la page comme le ferait le démon. */
async function troisMessages(page) {
  await page.evaluate(() => {
    const essai = window.haikodevEssai;
    essai.message('info', 'Premier message de vérification');
    essai.message('warning', 'Deuxième message de vérification');
    // Une erreur ne s'efface pas toute seule : elle tient la pile en place.
    essai.message('error', 'Troisième message de vérification');
  });
  await page.waitForTimeout(400);
}

const etat = (page) =>
  page.evaluate(() => {
    const pile = document.querySelector('[data-pile="messages"]');
    if (!pile) return null;
    const croix = pile.querySelector('button');
    const cible = croix?.getBoundingClientRect();
    const cadres = Array.from(pile.querySelectorAll('[class*="rounded-md"]'));
    return {
      ouverte: pile.getAttribute('data-pile-ouverte') === 'oui',
      geste: pile.getAttribute('data-pile-geste'),
      messages: cadres.length,
      // Ce qui se VOIT vraiment : au-delà de trois, l'empilement met à zéro.
      visibles: cadres.filter((el) => Number(getComputedStyle(el).opacity) > 0).length,
      hauteur: Math.round(pile.getBoundingClientRect().height),
      reste: pile.textContent?.includes('autre') ?? false,
      annonce: pile.getAttribute('aria-label') ?? '',
      croixHauteur: cible ? Math.round(cible.height) : 0,
      croixLargeur: cible ? Math.round(cible.width) : 0,
    };
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
  await troisMessages(mobile);
  const repos = await etat(mobile);
  if (!repos) {
    noter('la pile de messages est à l’écran', false, 'aucun bloc [data-pile="messages"]');
  } else {
    noter('au doigt, le geste retenu est l’appui', repos.geste === 'appui', repos.geste ?? '');
    noter('au repos, la pile est fermée', !repos.ouverte);
    // Combien se voient pile fermée est l'affaire de l'EMPILEMENT
    // (PILE_VISIBLES = 3) : à trois messages, les trois se voient et il n'y a
    // rien à compter. La pile n'en occupe pas moins la place d'un seul.
    noter('au repos, trois messages au plus se voient', repos.visibles === 3, `${repos.visibles} visibles`);
    noter('au repos, rien n’est annoncé comme caché : ils tiennent tous', !repos.reste);
    noter('au repos, la pile tient dans la hauteur d’un message', repos.hauteur < 90, `${repos.hauteur} px`);
    noter('l’annonce nomme le geste à faire', /Appuyer/.test(repos.annonce), repos.annonce);
    await mobile.screenshot({ path: `${SHOTS}/pile-messages-fermee.png` });

    await mobile.locator('[data-pile="messages"]').tap();
    await mobile.waitForTimeout(400);
    const deployee = await etat(mobile);
    noter('un appui déploie la pile', deployee.ouverte);
    noter('déployée, tous les messages se voient', deployee.messages === 3, `${deployee.messages} messages`);
    noter('déployée, plus rien n’est annoncé comme caché', !deployee.reste);
    noter(
      'la croix reste atteignable au doigt',
      deployee.croixHauteur >= 32 && deployee.croixLargeur >= 32,
      `${deployee.croixLargeur} × ${deployee.croixHauteur} px`,
    );
    await mobile.screenshot({ path: `${SHOTS}/pile-messages-deployee.png` });

    // L'appui qui déploie ne doit pas avoir emporté l'action du message de
    // devant : les trois messages sont toujours là.
    noter('l’appui d’ouverture n’a effacé aucun message', deployee.messages === 3);

    await mobile.locator('[data-pile="messages"]').tap();
    await mobile.waitForTimeout(400);
    const refermee = await etat(mobile);
    noter('un second appui referme la pile', !refermee.ouverte);

    await mobile.locator('[data-pile="messages"]').tap();
    await mobile.waitForTimeout(400);
    // Loin de la pile, dans le corps de la page.
    await mobile.touchscreen.tap(20, 400);
    await mobile.waitForTimeout(400);
    const dehors = await etat(mobile);
    noter('un appui ailleurs referme la pile', !dehors.ouverte);
    // Cet appui a pu ouvrir un panneau : on le referme avant la suite.
    await mobile.keyboard.press('Escape');
    await mobile.waitForTimeout(600);

    // Pile ouverte, la croix agit de nouveau pour elle-même.
    await mobile.locator('[data-pile="messages"]').tap();
    await mobile.waitForTimeout(400);
    const avant = (await etat(mobile)).messages;
    await mobile.locator('[data-pile="messages"] button').first().tap();
    await mobile.waitForTimeout(400);
    const apres = await etat(mobile);
    noter(
      'pile ouverte, la croix retire bien son message',
      !apres || apres.messages === avant - 1,
      `${avant} → ${apres ? apres.messages : 0}`,
    );
  }
  /* ---------- Les vignettes d'agents, même pile, même appui ---------- */
  const vignettes = mobile.locator('[data-pile="agents"]');
  if (!(await vignettes.count())) {
    console.log('  (aucun agent en cours : la pile des vignettes n’a pas pu être jugée au doigt)');
  } else {
    const etatVignettes = () =>
      mobile.evaluate(() => {
        const pile = document.querySelector('[data-pile="agents"]');
        const rangs = Array.from(document.querySelectorAll('[data-vignette-pile]'));
        return {
          ouverte: pile.getAttribute('data-pile-ouverte') === 'oui',
          geste: pile.getAttribute('data-pile-geste'),
          hauteur: Math.round(pile.getBoundingClientRect().height),
          rangs: rangs.length,
          visibles: rangs.filter((el) => Number(getComputedStyle(el).opacity) > 0).length,
        };
      });
    const repos = await etatVignettes();
    noter('au doigt, les vignettes s’empilent aussi', repos.geste === 'appui' && !repos.ouverte);
    noter(
      'la pile des vignettes tient dans la hauteur d’une seule',
      repos.rangs <= 1 || repos.hauteur < 40 * repos.rangs,
      `${repos.hauteur} px pour ${repos.rangs} vignettes`,
    );
    noter('au repos, trois vignettes au plus se voient', repos.visibles <= 3, `${repos.visibles} visibles`);
    await vignettes.tap();
    await mobile.waitForTimeout(400);
    const deployees = await etatVignettes();
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
    const apres = await etatVignettes();
    noter(
      'pile ouverte, la croix retire bien sa vignette',
      apres.rangs === deployees.rangs - 1,
      `${deployees.rangs} → ${apres.rangs}`,
    );

    // Un appui ailleurs referme : au centre d'une vignette on toucherait le
    // bouton qui ouvre l'agent, et c'est très bien ainsi.
    await mobile.touchscreen.tap(20, 300);
    await mobile.waitForTimeout(400);
    noter('un appui ailleurs referme la pile des vignettes', !(await etatVignettes()).ouverte);
    await mobile.keyboard.press('Escape');
    await mobile.waitForTimeout(400);
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
  await troisMessages(bureau);
  const repos = await etat(bureau);
  if (!repos) {
    noter('la pile de messages est à l’écran, à la souris', false);
  } else {
    noter('à la souris, le geste retenu est le survol', repos.geste === 'survol', repos.geste ?? '');
    noter('au repos, la pile est fermée', !repos.ouverte);

    await bureau.locator('[data-pile="messages"]').hover();
    await bureau.waitForTimeout(400);
    const survolee = await etat(bureau);
    noter('le survol déploie la pile', survolee.ouverte);
    noter('survolée, tous les messages se voient', survolee.messages === 3, `${survolee.messages} messages`);
    await bureau.screenshot({ path: `${SHOTS}/pile-messages-survol.png` });

    await bureau.mouse.move(40, 120);
    await bureau.waitForTimeout(400);
    const sortie = await etat(bureau);
    noter('le curseur qui s’en va referme la pile', !sortie.ouverte);
  }
  noter('aucune erreur dans la page, à la souris', erreursBureau.length === 0, erreursBureau[0] ?? '');
}

await navigateur.close();
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
process.exit(echecs ? 1 : 0);
