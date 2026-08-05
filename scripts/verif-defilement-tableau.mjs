#!/usr/bin/env node
/**
 * Contrôle des axes de défilement du tableau, dans un vrai navigateur.
 * Le rail des colonnes ne doit glisser QUE de gauche à droite ; l'intérieur
 * d'une colonne ne doit glisser QUE de haut en bas. On mesure sur un écran
 * de téléphone, là où le débordement se voit le plus.
 *
 *   HAIKODEV_URL=http://localhost:7093 node scripts/verif-defilement-tableau.mjs
 *
 * Attention : HAIKODEV_URL par défaut désigne l'application PUBLIÉE. Pour
 * juger d'un code non publié, viser le serveur de développement.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';

const BASE = process.env.HAIKODEV_URL || 'http://127.0.0.1:7070';
const SHOTS = '/root/haikodev/data/verification';

const base = new Database('/root/haikodev/data/haikodev.db');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

/*
  Les jetons de session sont stockés hachés : impossible d'en reprendre un.
  Le script s'en fabrique donc un, valable une heure, et le retire en partant.
  On n'utilise SURTOUT pas HAIKODEV_TOKEN : c'est le jeton d'un agent, pas
  une session de navigateur — le raccourci fait échouer la connexion.
*/
const jeton = crypto.randomBytes(32).toString('base64url');
base
  .prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)')
  .run(sha(jeton), Date.now(), Date.now() + 3600_000, 'vérification défilement tableau');
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
const contexte = await navigateur.newContext({
  viewport: { width: 402, height: 874 },
  isMobile: true,
  hasTouch: true,
});
await contexte.addCookies([
  { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
]);
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
/*
  Les pièces jointes de la conversation laissent la page « en cours de
  navigation » : les attentes de Playwright ne rendent jamais la main. On
  patiente donc à la montre, et on clique dans la page.
*/
await page.waitForTimeout(7000);
// Sur téléphone, l'application peut s'ouvrir sur la conversation : on demande le tableau.
await page.evaluate(() => {
  const onglet = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Tableau');
  onglet?.click();
});
await page.waitForTimeout(2500);
console.log(`  (${await page.locator('[data-column]').count()} colonnes à l'écran)`);

const mesures = await page.evaluate(() => {
  const rail = document.querySelector('[data-column]')?.parentElement;
  if (!rail) return null;
  const colonnes = [...rail.querySelectorAll('[data-column]')].map((col) => {
    /* Le corps de la colonne est enveloppé par la zone à fondu : on cherche
       donc le premier descendant qui défile, pas seulement un enfant direct. */
    const corps = [...col.querySelectorAll('*')].find((n) => getComputedStyle(n).overflowY === 'auto');
    const st = corps ? getComputedStyle(corps) : null;
    return {
      nom: col.getAttribute('data-column'),
      hauteurColonne: col.getBoundingClientRect().height,
      hauteurRail: rail.getBoundingClientRect().height,
      corpsTrouve: Boolean(corps),
      corpsX: st?.overflowX ?? null,
      debordeX: corps ? corps.scrollWidth - corps.clientWidth : 0,
    };
  });
  const s = getComputedStyle(rail);
  return {
    railX: s.overflowX,
    railY: s.overflowY,
    railDebordeY: rail.scrollHeight - rail.clientHeight,
    railDebordeX: rail.scrollWidth - rail.clientWidth,
    colonnes,
  };
});

if (!mesures) {
  noter('le tableau est visible', false, 'aucune colonne trouvée');
} else {
  noter('le rail glisse de gauche à droite', mesures.railX === 'auto' || mesures.railX === 'scroll', mesures.railX);
  noter('le rail ne glisse PAS de haut en bas', mesures.railY === 'hidden', mesures.railY);
  noter('le rail ne déborde pas en hauteur', mesures.railDebordeY <= 1, `${mesures.railDebordeY} px`);
  noter('le rail déborde bien en largeur', mesures.railDebordeX > 0, `${mesures.railDebordeX} px`);

  for (const col of mesures.colonnes) {
    noter(`colonne « ${col.nom} » : un corps qui glisse verticalement`, col.corpsTrouve);
    noter(
      `colonne « ${col.nom} » : pas plus haute que le rail`,
      col.hauteurColonne <= col.hauteurRail + 1,
      `${Math.round(col.hauteurColonne)} px sur ${Math.round(col.hauteurRail)} px`,
    );
    noter(`colonne « ${col.nom} » : rien ne déborde de côté`, col.debordeX <= 1, `${col.debordeX} px`);
  }
}

/*
  La rangée d'onglets, propre au téléphone : un onglet par colonne, appui pour
  filer jusqu'à la colonne visée, onglet actif qui suit le bord gauche. Elle est
  un FRÈRE au-dessus du rail, jamais un enfant de la ZoneDefilement — on le
  vérifie en passant.
*/
const nbOnglets = await page.locator('[data-onglet-colonne]').count();
noter('la rangée d’onglets est présente', nbOnglets > 0, `${nbOnglets} onglet(s)`);

const ongletDansRail = await page.evaluate(() => {
  const rail = document.querySelector('[data-column]')?.parentElement;
  if (!rail) return true;
  return Boolean(rail.querySelector('[data-onglet-colonne]'));
});
noter('les onglets ne sont PAS dans le rail des colonnes', ongletDansRail === false);

if (nbOnglets > 0) {
  // Un appui sur « À déployer » doit amener cette colonne au bord gauche.
  await page.locator('[data-onglet-colonne="to_deploy"]').click();
  await page.waitForTimeout(1200); // le temps du défilement en douceur
  const bord = await page.evaluate(() => {
    const rail = document.querySelector('[data-column]')?.parentElement;
    const col = document.querySelector('[data-column="to_deploy"]');
    if (!rail || !col) return null;
    // Écart entre le bord gauche de la colonne et le bord gauche du rail.
    return Math.round(col.getBoundingClientRect().left - rail.getBoundingClientRect().left);
  });
  noter('un appui amène « À déployer » au bord gauche', bord !== null && Math.abs(bord) <= 20, `${bord} px`);

  const actifApresAppui = await page.getAttribute('[data-onglet-colonne="to_deploy"]', 'aria-current');
  noter('l’onglet « À déployer » devient actif', actifApresAppui === 'true', String(actifApresAppui));

  // Défilement manuel vers le début : l'onglet actif doit repasser au premier.
  await page.evaluate(() => {
    const rail = document.querySelector('[data-column]')?.parentElement;
    if (rail) rail.scrollTo({ left: 0 });
  });
  await page.waitForTimeout(300);
  const premier = await page.getAttribute('[data-column]', 'data-column');
  const actifApresDefil = await page.evaluate(() => {
    const actif = document.querySelector('[data-onglet-colonne][aria-current="true"]');
    return actif?.getAttribute('data-onglet-colonne') ?? null;
  });
  noter('l’onglet actif suit le défilement manuel', actifApresDefil === premier, `${actifApresDefil} (attendu ${premier})`);
}

// La colonne « À déployer » est la plus chargée : on la met sous les yeux.
const aDeployer = page.locator('[data-column="to_deploy"]');
if (await aDeployer.count()) {
  await aDeployer.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
}
await page.screenshot({ path: `${SHOTS}/defilement-tableau.png` });

/*
  Sur écran large, la rangée d'onglets ne doit PAS exister. On rouvre le tableau
  dans un contexte de bureau (survol, largeur ordinateur) et on recompte.
*/
const bureau = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
await bureau.addCookies([
  { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
]);
const pageBureau = await bureau.newPage();
await pageBureau.goto(BASE, { waitUntil: 'domcontentloaded' });
await pageBureau.waitForTimeout(7000);
await pageBureau.evaluate(() => {
  const onglet = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Tableau');
  onglet?.click();
});
await pageBureau.waitForTimeout(2500);
const ongletsBureau = await pageBureau.locator('[data-onglet-colonne]').count();
noter('aucun onglet de colonne sur écran large', ongletsBureau === 0, `${ongletsBureau} onglet(s)`);
await bureau.close();

noter("aucune erreur dans la page", erreurs.length === 0, erreurs[0] ?? '');

await navigateur.close();
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
process.exit(echecs ? 1 : 0);
