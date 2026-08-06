#!/usr/bin/env node
/**
 * LE MODULE DE VOIX SE DÉPLACE-T-IL, ET SA PLACE EST-ELLE RETENUE ?
 *
 * Le module était cloué en bas au centre. Il se tire désormais par son icône,
 * à la souris comme au doigt, et sa place est retenue dans le COMPTE (une
 * préférence serveur, clé « voix ») — donc la même dans une autre fenêtre, sur
 * un autre appareil, après un rechargement.
 *
 * Ce qu'on essaie pour de vrai, dans un vrai navigateur :
 *   — à la souris : tirer l'icône déplace le module ;
 *   — recharger la page : il est à la même place ;
 *   — une seconde fenêtre : la même place, sans rien avoir fait ;
 *   — tirer très loin : le module reste entièrement dans l'écran ;
 *   — un téléphone (écran tactile) : le doigt le déplace aussi, et une place
 *     prise sur grand écran revient dans les bords du petit ;
 *   — un appui immobile déplie toujours le module (le glissement ne mange pas
 *     le clic).
 *
 *   HAIKO_VOIX_URL=http://localhost:7099 node scripts/verif-position-voix.mjs
 *
 * Le serveur de DÉVELOPPEMENT est visé : un script de vérification ne reprend
 * jamais HAIKODEV_URL, qui désigne l'application déjà publiée, ni
 * HAIKODEV_TOKEN, le jeton (périmé) d'un agent.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';

const BASE = process.env.HAIKO_VOIX_URL || 'http://localhost:7099';
const SHOTS = '/root/haikodev/data/verification';
/** La clé de préférence où la place du module est rangée (CLE_VOIX_POSITION). */
const CLE = 'voix';

const base = new Database('/root/haikodev/data/haikodev.db');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

// Une session d'une heure, fabriquée pour ce contrôle et retirée en partant :
// les jetons sont stockés hachés, on n'en réutilise jamais un existant.
const jeton = crypto.randomBytes(32).toString('base64url');
base
  .prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)')
  .run(sha(jeton), Date.now(), Date.now() + 3600_000, 'vérification position de la voix');

// La place du module appartient à l'utilisateur : on la remet telle qu'on l'a
// trouvée, quoi qu'il arrive.
const placeAvant = base.prepare('SELECT value FROM preferences WHERE key = ?').get(CLE);
const rendreLaPlace = () => {
  if (placeAvant) {
    base
      .prepare('INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(CLE, placeAvant.value, Date.now());
  } else {
    base.prepare('DELETE FROM preferences WHERE key = ?').run(CLE);
  }
};
process.on('exit', () => {
  rendreLaPlace();
  base.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton));
});

/** Ce qui est réellement rangé côté serveur, lu dans la base. */
const placeRangee = () => {
  const ligne = base.prepare('SELECT value FROM preferences WHERE key = ?').get(CLE);
  if (!ligne) return null;
  try {
    return JSON.parse(ligne.value);
  } catch {
    return null;
  }
};

/** On repart d'une place NEUVE : le module au centre en bas, comme au premier jour. */
base.prepare('DELETE FROM preferences WHERE key = ?').run(CLE);

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
  await page.waitForSelector('[data-module-voix]', { timeout: 20000 });
  await page.waitForTimeout(1500);
  // Un panneau rouvert au démarrage peut recouvrir le bas de l'écran.
  for (let essai = 0; essai < 3 && (await page.locator('[role="dialog"]').count()); essai += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  return { page, erreurs };
}

/**
 * OÙ le module se trouve. On repère sa place par le CENTRE horizontal et le BAS
 * du bloc : ce sont les deux seules mesures stables — le module s'élargit quand
 * il parle et grandit vers le haut quand il se déplie, mais il reste centré sur
 * son point et ancré par le bas. Comparer les coins ferait croire à un
 * déplacement là où il n'y a qu'un changement d'aspect.
 *
 * La boîte de l'ICÔNE sert, elle, à juger que le module est bien dans l'écran.
 */
const boite = (page) =>
  page.evaluate(() => {
    const module = document.querySelector('[data-module-voix]');
    const icone = document.querySelector('[data-icone-voix]');
    if (!module || !icone) return null;
    const r = module.getBoundingClientRect();
    const i = icone.getBoundingClientRect();
    return {
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.bottom),
      icone: {
        x: Math.round(i.left),
        y: Math.round(i.top),
        largeur: Math.round(i.width),
        hauteur: Math.round(i.height),
      },
      largeur: Math.round(i.width),
      hauteur: Math.round(i.height),
      fenetre: { largeur: window.innerWidth, hauteur: window.innerHeight },
    };
  });

/** Le module tient-il entièrement dans l'écran ? */
const dansLEcran = (b) =>
  b.icone.x >= 0 &&
  b.icone.y >= 0 &&
  b.icone.x + b.icone.largeur <= b.fenetre.largeur &&
  b.icone.y + b.icone.hauteur <= b.fenetre.hauteur;

/**
 * Le module est-il AU MOINS partiellement visible ? Une pastille accrochée est à
 * moitié engagée hors de l'écran : elle ne tient pas entièrement dedans, mais sa
 * moitié visible reste attrapable.
 */
const partiellementVisible = (b) =>
  b.icone.x < b.fenetre.largeur &&
  b.icone.x + b.icone.largeur > 0 &&
  b.icone.y < b.fenetre.hauteur &&
  b.icone.y + b.icone.hauteur > 0;

/* ---------- 1. À la souris : tirer l'icône déplace le module ---------- */

const ordinateur = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
await ordinateur.addCookies([
  { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
]);
const { page: bureau, erreurs: erreursBureau } = await ouvrirPage(ordinateur);

const depart = await boite(bureau);
if (!depart) {
  noter('le module de voix est à l’écran', false, 'aucun [data-module-voix]');
} else {
  noter(
    'sans rien de retenu, le module part du bas de l’écran, centré',
    depart.y > depart.fenetre.hauteur / 2 && Math.abs(depart.x - depart.fenetre.largeur / 2) < 30,
    `centre=${depart.x} bas=${depart.y}`,
  );
  await bureau.screenshot({ path: `${SHOTS}/voix-place-origine.png` });

  // À la souris, c'est la POIGNÉE (en bas à droite) qui porte le glissement : le
  // bouton d'icône s'efface au survol et ne peut plus être attrapé. On survole
  // d'abord pour déplier — la poignée se pose alors au coin du panneau ouvert —,
  // puis on tire depuis elle.
  noter(
    'à la souris, une poignée de déplacement est présente',
    (await bureau.locator('[data-poignee-voix]').count()) > 0,
  );
  await bureau.mouse.move(depart.x, depart.y - 20);
  await bureau.waitForTimeout(400);
  const prise = await bureau.locator('[data-poignee-voix]').boundingBox();
  // On tire vers le haut à gauche : franchement, bien au-delà du seuil.
  const departPrise = { x: prise.x + prise.width / 2, y: prise.y + prise.height / 2 };
  const versX = departPrise.x - 420;
  const versY = departPrise.y - 320;
  await bureau.mouse.move(departPrise.x, departPrise.y);
  await bureau.mouse.down();
  await bureau.mouse.move(versX, versY, { steps: 20 });
  await bureau.mouse.up();
  await bureau.waitForTimeout(800);
  // Le curseur laissé sur le module le déplierait : on l'écarte avant de mesurer.
  await bureau.mouse.move(20, 120);
  await bureau.waitForTimeout(500);

  const tire = await boite(bureau);
  noter(
    'tirer l’icône déplace le module',
    Math.abs(tire.x - depart.x) > 300 && Math.abs(tire.y - depart.y) > 200,
    `${depart.x},${depart.y} → ${tire.x},${tire.y}`,
  );
  noter('déplacé, le module reste entièrement visible', dansLEcran(tire));
  await bureau.screenshot({ path: `${SHOTS}/voix-deplacee.png` });

  const rangee = placeRangee();
  noter(
    'la place est rangée côté serveur, sous la clé « voix »',
    rangee !== null && typeof rangee.x === 'number' && typeof rangee.y === 'number',
    JSON.stringify(rangee),
  );

  /* ---------- 2. Rechargée, la page la retrouve au même endroit ---------- */

  await bureau.reload({ waitUntil: 'domcontentloaded' });
  await bureau.waitForSelector('[data-module-voix]', { timeout: 20000 });
  await bureau.waitForTimeout(2000);
  const apresRechargement = await boite(bureau);
  noter(
    'après rechargement, le module est à la même place',
    Math.abs(apresRechargement.x - tire.x) <= 4 && Math.abs(apresRechargement.y - tire.y) <= 4,
    `${tire.x},${tire.y} → ${apresRechargement.x},${apresRechargement.y}`,
  );

  /* ---------- 3. Une autre fenêtre : la même place, sans rien faire ---------- */

  const autreFenetre = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
  await autreFenetre.addCookies([
    { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const { page: seconde } = await ouvrirPage(autreFenetre);
  const ailleurs = await boite(seconde);
  noter(
    'une seconde fenêtre ouvre le module à la même place',
    Math.abs(ailleurs.x - tire.x) <= 4 && Math.abs(ailleurs.y - tire.y) <= 4,
    `${tire.x},${tire.y} → ${ailleurs.x},${ailleurs.y}`,
  );
  await seconde.close();
  await autreFenetre.close();

  /* ---------- 4. Un simple survol déplie toujours ---------- */

  // On juge le survol PENDANT que le module est encore dans une zone dégagée
  // (avant de le pousser dans le coin, où le bloc du dock le recouvrirait). On
  // survole le HAUT du rond, à l'écart de la poignée posée en bas à droite.
  await bureau.mouse.move(20, 120);
  await bureau.waitForTimeout(400);
  const survol = await boite(bureau);
  await bureau.mouse.move(survol.x, survol.y - 36);
  await bureau.waitForTimeout(500);
  noter(
    'le module se déplie toujours au survol',
    (await bureau.locator('[data-module-voix][data-ouvert]').count()) > 0,
  );
  await bureau.mouse.move(20, 120);
  await bureau.waitForTimeout(400);

  /* ---------- 5. Tiré jusqu'à un bord, le module s'accroche ---------- */

  const avant4 = await boite(bureau);
  await bureau.mouse.move(avant4.x, avant4.y - 20);
  await bureau.waitForTimeout(400);
  const prise2 = await bureau.locator('[data-poignee-voix]').boundingBox();
  await bureau.mouse.move(prise2.x + prise2.width / 2, prise2.y + prise2.height / 2);
  await bureau.mouse.down();
  await bureau.mouse.move(3000, 2000, { steps: 20 });
  await bureau.mouse.up();
  await bureau.waitForTimeout(800);
  await bureau.mouse.move(60, 300);
  await bureau.waitForTimeout(500);
  const auBord = await boite(bureau);
  // Tiré jusqu'au coin, le module ne flotte plus au milieu de l'écran : il
  // s'accroche au bord le plus proche et n'en montre plus qu'une pastille, à
  // moitié dehors mais toujours attrapable.
  noter(
    'tiré jusqu’à un bord, le module s’accroche',
    (await bureau.locator('[data-module-voix][data-accrochee]').count()) > 0,
  );
  noter(
    'accroché, la pastille reste au moins à moitié visible',
    partiellementVisible(auBord),
    `x=${auBord.x} y=${auBord.y} (${auBord.fenetre.largeur}×${auBord.fenetre.hauteur})`,
  );
  await bureau.screenshot({ path: `${SHOTS}/voix-au-bord.png` });

  /* ---------- 6. Accroche à un bord, réduction, décrochage ---------- */

  // On repart d'une place libre, bien au centre. On accroche vers la GAUCHE : la
  // poignée vit en bas à DROITE du module, donc tirer vers la gauche a toute la
  // place voulue pour pousser le module contre ce bord (vers la droite, la
  // poignée butte contre le bord de l'écran avant d'y arriver).
  base
    .prepare('INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(CLE, JSON.stringify({ x: 0, y: -260 }), Date.now());
  await bureau.reload({ waitUntil: 'domcontentloaded' });
  await bureau.waitForSelector('[data-module-voix]', { timeout: 20000 });
  await bureau.waitForTimeout(1500);
  await bureau.mouse.move(700, 300);
  await bureau.waitForTimeout(300);

  const avantAccroche = await boite(bureau);
  // Déplier au survol pour saisir la poignée, puis la tirer contre le bord gauche.
  await bureau.mouse.move(avantAccroche.x, avantAccroche.y - 20);
  await bureau.waitForTimeout(500);
  const prise3 = await bureau.locator('[data-poignee-voix]').boundingBox();
  await bureau.mouse.move(prise3.x + prise3.width / 2, prise3.y + prise3.height / 2);
  await bureau.mouse.down();
  await bureau.mouse.move(6, avantAccroche.y - 60, { steps: 20 });
  await bureau.mouse.up();
  await bureau.waitForTimeout(800);
  // Écarter la souris pour que le module se referme en pastille.
  await bureau.mouse.move(700, 300);
  await bureau.waitForTimeout(700);

  const accroche = await boite(bureau);
  noter(
    'tiré contre le bord gauche, le module s’accroche',
    (await bureau.locator('[data-module-voix][data-accrochee][data-bord="gauche"]').count()) > 0,
  );
  noter('accroché, le module se réduit en pastille', accroche.largeur < 40, `largeur=${accroche.largeur}`);
  noter(
    'accroché, la pastille est à moitié hors de l’écran (bord gauche)',
    accroche.x <= 6,
    `centre x=${accroche.x}`,
  );
  await bureau.screenshot({ path: `${SHOTS}/voix-accrochee.png` });

  const rangeAccroche = placeRangee();
  noter(
    'l’accroche est retenue côté serveur, avec son bord',
    rangeAccroche !== null && rangeAccroche.bord === 'gauche',
    JSON.stringify(rangeAccroche),
  );

  // Rechargée, la page la retrouve accrochée au même bord.
  await bureau.reload({ waitUntil: 'domcontentloaded' });
  await bureau.waitForSelector('[data-module-voix]', { timeout: 20000 });
  await bureau.waitForTimeout(1500);
  await bureau.mouse.move(700, 300);
  await bureau.waitForTimeout(400);
  noter(
    'après rechargement, le module est toujours accroché à gauche',
    (await bureau.locator('[data-module-voix][data-accrochee][data-bord="gauche"]').count()) > 0,
  );

  // Au survol, il revient à sa taille normale et ouvre son panneau.
  const pastille = await boite(bureau);
  await bureau.mouse.move(pastille.x + 12, pastille.y - 14);
  await bureau.waitForTimeout(700);
  const ouvertAccroche = await boite(bureau);
  noter(
    'au survol, le module accroché revient à sa taille et s’ouvre',
    (await bureau.locator('[data-module-voix][data-ouvert]').count()) > 0 && ouvertAccroche.largeur > 40,
    `largeur=${ouvertAccroche.largeur}`,
  );
  await bureau.screenshot({ path: `${SHOTS}/voix-accrochee-ouverte.png` });

  // Ouvert, on saisit sa poignée et on le tire vers le centre : il se décroche.
  // On rejoint la poignée EN RESTANT dans le panneau (passer par son centre), pour
  // ne pas le refermer en route et perdre la prise.
  await bureau.mouse.move(ouvertAccroche.x, ouvertAccroche.y - 30);
  await bureau.waitForTimeout(300);
  const prise4 = await bureau.locator('[data-poignee-voix]').boundingBox();
  await bureau.mouse.move(prise4.x + prise4.width / 2, prise4.y + prise4.height / 2);
  await bureau.mouse.down();
  await bureau.mouse.move(ouvertAccroche.fenetre.largeur / 2, ouvertAccroche.fenetre.hauteur / 2, { steps: 20 });
  await bureau.mouse.up();
  await bureau.waitForTimeout(800);
  await bureau.mouse.move(700, 300);
  await bureau.waitForTimeout(600);
  const apresDecroche = placeRangee();
  noter(
    'tiré vers le centre, le module se décroche',
    (await bureau.locator('[data-module-voix][data-accrochee]').count()) === 0,
    JSON.stringify(apresDecroche),
  );

  noter('aucune erreur dans la page, à la souris', erreursBureau.length === 0, erreursBureau[0] ?? '');
}

/* ---------- 6. Au doigt, et une place venue d'un grand écran ---------- */

const telephone = await navigateur.newContext({
  viewport: { width: 402, height: 874 },
  isMobile: true,
  hasTouch: true,
});
await telephone.addCookies([
  { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
]);
const { page: mobile, erreurs: erreursMobile } = await ouvrirPage(telephone);

const surTelephone = await boite(mobile);
if (!surTelephone) {
  noter('le module de voix est à l’écran du téléphone', false);
} else {
  noter(
    'une place prise sur grand écran revient dans les bords du téléphone',
    dansLEcran(surTelephone),
    `x=${surTelephone.x} y=${surTelephone.y} (${surTelephone.fenetre.largeur}×${surTelephone.fenetre.hauteur})`,
  );
  await mobile.screenshot({ path: `${SHOTS}/voix-telephone-recadree.png` });

  // La place héritée du grand écran, ramenée dans les bords, pose parfois le
  // module au coin bas-droit, SOUS le bloc du dock qui capterait l'appui du
  // doigt. On le remonte au centre, bien dégagé, pour juger le glissement au
  // doigt sans interférence (le serveur relit les préférences en base à chaque
  // chargement, donc une écriture directe suffit).
  base
    .prepare('INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(CLE, JSON.stringify({ x: 0, y: -360 }), Date.now());
  await mobile.reload({ waitUntil: 'domcontentloaded' });
  await mobile.waitForSelector('[data-module-voix]', { timeout: 20000 });
  await mobile.waitForTimeout(2000);

  const avant = await boite(mobile);
  const departX = avant.icone.x + avant.icone.largeur / 2;
  const departY = avant.icone.y + avant.icone.hauteur / 2;
  /*
   * Un VRAI glissement du doigt : on passe par le navigateur lui-même
   * (Input.dispatchTouchEvent), qui fabrique les mêmes événements qu'un écran
   * tactile — un événement bricolé depuis la page ne prouverait rien.
   */
  const cdp = await mobile.context().newCDPSession(mobile);
  const doigt = (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 8, radiusY: 8, force: 1 }],
    });
  await doigt('touchStart', departX, departY);
  // Un doigt bouge sur plusieurs images : sans ces pauses, les mouvements
  // arrivent avant que la page n'ait vu l'appui et le contrôle serait instable.
  await mobile.waitForTimeout(120);
  for (let i = 1; i <= 10; i += 1) {
    await doigt('touchMove', departX, departY - i * 20);
    await mobile.waitForTimeout(60);
  }
  await doigt('touchEnd', departX, departY - 200);
  await mobile.waitForTimeout(800);
  const apres = await boite(mobile);
  noter(
    'au doigt, le module se déplace aussi',
    Math.abs(apres.y - avant.y) > 100,
    `y ${avant.y} → ${apres.y}`,
  );
  noter('déplacé au doigt, il reste entièrement visible', dansLEcran(apres));
  await mobile.screenshot({ path: `${SHOTS}/voix-telephone-deplacee.png` });

  // Le glissement ne mange pas le clic : un appui IMMOBILE déplie toujours.
  await mobile.touchscreen.tap(
    apres.icone.x + apres.icone.largeur / 2,
    apres.icone.y + apres.icone.hauteur / 2,
  );
  await mobile.waitForTimeout(600);
  noter(
    'un appui immobile déplie toujours le module',
    (await mobile.locator('[data-liste-voix]').count()) > 0,
  );

  // Aucune poignée au doigt : elle y volerait de la place, et le bouton lui-même
  // porte déjà le glissement.
  noter(
    'aucune poignée de déplacement sur téléphone',
    (await mobile.locator('[data-poignee-voix]').count()) === 0,
  );

  /* ---------- 7. Accroche au doigt, sur une fenêtre étroite ---------- */

  // On repart d'une place libre, dégagée, puis on tire le module contre le bord
  // droit du téléphone.
  base
    .prepare('INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(CLE, JSON.stringify({ x: 0, y: -320 }), Date.now());
  await mobile.reload({ waitUntil: 'domcontentloaded' });
  await mobile.waitForSelector('[data-module-voix]', { timeout: 20000 });
  await mobile.waitForTimeout(1500);

  const avantTactile = await boite(mobile);
  const dxTac = avantTactile.icone.x + avantTactile.icone.largeur / 2;
  const dyTac = avantTactile.icone.y + avantTactile.icone.hauteur / 2;
  const versBord = avantTactile.fenetre.largeur;
  await doigt('touchStart', dxTac, dyTac);
  await mobile.waitForTimeout(120);
  for (let i = 1; i <= 10; i += 1) {
    await doigt('touchMove', dxTac + ((versBord - dxTac) * i) / 10 + 6, dyTac);
    await mobile.waitForTimeout(60);
  }
  await doigt('touchEnd', versBord, dyTac);
  await mobile.waitForTimeout(800);

  noter(
    'au doigt, le module s’accroche au bord droit',
    (await mobile.locator('[data-module-voix][data-accrochee][data-bord="droite"]').count()) > 0,
  );
  const pastilleTactile = await boite(mobile);
  noter(
    'accroché au doigt, la pastille est réduite',
    pastilleTactile.largeur < 40,
    `largeur=${pastilleTactile.largeur}`,
  );
  await mobile.screenshot({ path: `${SHOTS}/voix-telephone-accrochee.png` });

  // Un appui sur la moitié visible de la pastille la rouvre à sa taille normale.
  await mobile.touchscreen.tap(pastilleTactile.x - 8, pastilleTactile.y - 10);
  await mobile.waitForTimeout(700);
  noter(
    'un appui rouvre le module accroché',
    (await mobile.locator('[data-module-voix][data-ouvert]').count()) > 0,
  );

  noter('aucune erreur dans la page, au doigt', erreursMobile.length === 0, erreursMobile[0] ?? '');
}

await navigateur.close();
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
process.exit(echecs ? 1 : 0);
