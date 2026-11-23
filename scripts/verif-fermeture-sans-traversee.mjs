#!/usr/bin/env node
/**
 * Fermer un menu du bas ne doit RIEN faire d'autre que le fermer.
 *
 * Sur téléphone, le menu des quotas (posé depuis la colonne des projets) se
 * ferme à l'APPUI sur la zone sombre au-dessus de lui ; le clic du même
 * toucher tombait ensuite sur le bouton « Nouvel agent » placé dessous et
 * ouvrait « Dans quel projet ? ». Ce contrôle rejoue le geste avec un toucher
 * LONG (plus long que les 200 ms de sortie du tiroir, sinon la couche vit encore
 * et le défaut se cache), puis vérifie : le menu est fermé, la colonne des
 * projets est toujours ouverte, aucune fenêtre « Dans quel projet ? » n'est
 * apparue — et qu'un clic ordinaire fonctionne juste après (l'écouteur qui
 * attrape la tape de fermeture ne doit pas survivre à son geste).
 *
 *   BELUGA_VERIF_URL=http://localhost:7099 node scripts/verif-fermeture-sans-traversee.mjs
 *
 * `BELUGA_URL` désigne l'application PUBLIÉE : on ne la reprend jamais ici.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const BASE = process.env.BELUGA_VERIF_URL || 'http://localhost:7099';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Une session valable, posée directement en base : on vérifie l'écran, pas le mur d'accès. */
function jeton() {
  const db = new Database(cheminDeLaBaseServie());
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification fermeture sans traversée',
  );
  db.close();
  return { token, empreinte };
}

function retirer(empreinte) {
  const db = new Database(cheminDeLaBaseServie());
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

const PANNEAU = '[data-radix-popper-content-wrapper] [role="menu"]';
const BOUTON_QUOTAS = '[data-pied-colonne] button[data-essai="badge-quota"]:visible';
const LIGNE_NOUVEL_AGENT = '[data-ligne-nouvel-agent]:visible';
const FENETRE_NOUVEL_AGENT = '[data-tiroir-nouvel-agent], [data-recherche-nouvel-agent]';

async function main() {
  const { token, empreinte } = jeton();
  process.on('exit', () => {
    try {
      retirer(empreinte);
    } catch {
      /* déjà retirée */
    }
  });
  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await navigateur.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'beluga_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  const cdp = await context.newCDPSession(page);

  /** Un toucher qui dure : appui, attente, relâché — `touchscreen.tap` clique trop vite. */
  async function toucherLong(x, y, dureeMs) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(dureeMs);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  async function ouvrirLesQuotas() {
    await page.locator(BOUTON_QUOTAS).first().tap();
    await page.waitForTimeout(700);
    return (await page.locator(PANNEAU).count()) > 0;
  }

  async function etat() {
    return {
      menu: await page.locator(PANNEAU).count(),
      fenetre: await page.locator(FENETRE_NOUVEL_AGENT).count(),
      colonne: await page.locator(LIGNE_NOUVEL_AGENT).isVisible().catch(() => false),
    };
  }

  /** Le point de la ligne « Nouvel agent », libre de tout tiroir. */
  async function pointDeLaLigne() {
    const ligne = await page.locator(LIGNE_NOUVEL_AGENT).boundingBox();
    const panneau = await page.locator(PANNEAU).boundingBox();
    if (!ligne || !panneau) return null;
    return {
      x: ligne.x + ligne.width / 2,
      y: ligne.y + ligne.height / 2,
      libre: ligne.y + ligne.height < panneau.y - 4,
    };
  }

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  // Un tiroir de carte restauré d'une session précédente couvrirait l'écran.
  for (let i = 0; i < 3 && (await page.locator('[role="dialog"]').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  // La colonne des projets, par le bouton en haut à gauche.
  await page.locator('button[aria-label="Projets"]').first().tap();
  await page.waitForTimeout(800);
  noter('la colonne des projets s\'ouvre avec sa ligne « Nouvel agent »', await page.locator(LIGNE_NOUVEL_AGENT).isVisible().catch(() => false));

  // 1. Toucher LONG sur la zone sombre, à l'endroit de « Nouvel agent ».
  const ouvert = await ouvrirLesQuotas();
  noter('le volet des quotas s\'ouvre depuis la colonne', ouvert);
  let point = await pointDeLaLigne();
  noter('la ligne « Nouvel agent » reste visible au-dessus du volet', !!point?.libre);
  if (point) {
    await toucherLong(point.x, point.y, 450);
    await page.waitForTimeout(900);
    const e = await etat();
    noter('toucher long : le volet des quotas est fermé', e.menu === 0);
    noter('toucher long : « Dans quel projet ? » ne s\'ouvre pas', e.fenetre === 0);
    noter('toucher long : la colonne des projets reste ouverte', e.colonne);
  }

  // 2. Un clic ordinaire juste après fonctionne : l'écouteur n'a pas survécu.
  noter('juste après, le volet se rouvre au toucher (rien n\'est avalé)', await ouvrirLesQuotas());

  // 3. Toucher bref, au même endroit.
  point = await pointDeLaLigne();
  if (point) {
    await page.touchscreen.tap(point.x, point.y);
    await page.waitForTimeout(900);
    const e = await etat();
    noter('toucher bref : volet fermé, rien d\'ouvert dessous', e.menu === 0 && e.fenetre === 0 && e.colonne);
  }

  // 4. La poignée tirée vers le bas ne laisse rien traverser non plus.
  await ouvrirLesQuotas();
  const poignee = await page.evaluate((selecteur) => {
    const p = document.querySelector(selecteur)?.querySelector(':scope > div:first-child');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, PANNEAU);
  if (poignee) {
    await page.mouse.move(poignee.x, poignee.y);
    await page.mouse.down();
    for (let pas = 1; pas <= 8; pas += 1) await page.mouse.move(poignee.x, poignee.y + pas * 25);
    await page.mouse.up();
    await page.waitForTimeout(900);
  }
  {
    const e = await etat();
    noter('poignée tirée : volet fermé, colonne ouverte, rien d\'autre', e.menu === 0 && e.fenetre === 0 && e.colonne);
  }

  // 5. Un vrai clic sur « Nouvel agent », ensuite, fait ce qu'il doit faire.
  await page.locator(LIGNE_NOUVEL_AGENT).tap();
  await page.waitForTimeout(900);
  noter(
    'un clic ordinaire sur « Nouvel agent » ouvre bien « Dans quel projet ? »',
    (await page.locator(FENETRE_NOUVEL_AGENT).count()) > 0,
  );

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await context.close();
  await navigateur.close();
  retirer(empreinte);

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
