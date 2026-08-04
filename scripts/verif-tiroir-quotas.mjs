#!/usr/bin/env node
/**
 * Le volet des quotas est-il un TIROIR comme les autres ?
 *
 * Sur écran de téléphone, on ouvre la jauge ronde de la barre du haut et on
 * vérifie trois choses : le volet est posé en bas sur toute la largeur, son
 * contenu défile tout seul (la poignée ne part pas avec le défilement), et on
 * le referme en tirant la poignée vers le bas.
 *
 *   node scripts/verif-tiroir-quotas.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

/* On vise le serveur de DÉVELOPPEMENT : HAIKODEV_URL, posée pour les agents,
   pointe l'application déjà publiée — on y verrait l'ancienne version. */
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7099';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Une session valable, posée directement en base : on vérifie l'écran, pas le mur d'accès. */
function jeton() {
  const db = new Database('/root/haikodev/data/haikodev.db');
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification tiroir des quotas',
  );
  db.close();
  return { token, empreinte };
}

function retirer(empreinte) {
  const db = new Database('/root/haikodev/data/haikodev.db');
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

const panneau = '[data-radix-popper-content-wrapper] [role="menu"]';

async function main() {
  const { token, empreinte } = jeton();
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
    { name: 'haikodev_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  // La jauge ronde de la barre du haut : le seul bouton nommé « Quotas… ».
  await page.locator('button[title="Quotas des moteurs"]').click();
  await page.waitForTimeout(900);

  const boite = await page.locator(panneau).boundingBox();
  noter(
    'le volet est posé en bas, sur toute la largeur',
    !!boite && Math.abs(boite.width - 390) < 2 && Math.abs(boite.y + boite.height - 844) < 2,
    boite ? `x=${Math.round(boite.x)} l=${Math.round(boite.width)} bas=${Math.round(boite.y + boite.height)}` : 'absent',
  );

  // Le contenu défile SEUL : c'est le bloc sous la poignée qui bouge.
  const defilement = await page.evaluate((selecteur) => {
    const menu = document.querySelector(selecteur);
    /* Le corps est enveloppé par la zone à fondu : on prend le premier
       descendant qui défile réellement. */
    const corps = menu
      ? [...menu.querySelectorAll('*')].find((n) => getComputedStyle(n).overflowY === 'auto')
      : null;
    if (!corps) return null;
    const avant = corps.scrollTop;
    corps.scrollTop = 260;
    return { debordement: corps.scrollHeight > corps.clientHeight + 8, avant, apres: corps.scrollTop };
  }, panneau);
  noter(
    'le contenu du volet défile tout seul',
    !!defilement && defilement.debordement && defilement.apres > defilement.avant,
    defilement ? `scrollTop ${defilement.avant} → ${defilement.apres}` : 'corps introuvable',
  );

  // La poignée reste en haut, sous le doigt, même après ce défilement.
  const poigneeFixe = await page.evaluate((selecteur) => {
    const menu = document.querySelector(selecteur);
    const poignee = menu?.querySelector(':scope > div:first-child');
    if (!menu || !poignee) return null;
    const a = menu.getBoundingClientRect();
    const b = poignee.getBoundingClientRect();
    return b.top - a.top;
  }, panneau);
  noter('la poignée reste en haut du volet', poigneeFixe !== null && poigneeFixe < 12, `écart ${poigneeFixe} px`);

  // On tire la poignée vers le bas : au-delà de 110 px, le volet se referme.
  const cible = await page.evaluate((selecteur) => {
    const p = document.querySelector(selecteur)?.querySelector(':scope > div:first-child');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, panneau);
  if (cible) {
    await page.mouse.move(cible.x, cible.y);
    await page.mouse.down();
    for (let pas = 1; pas <= 8; pas += 1) await page.mouse.move(cible.x, cible.y + pas * 25);
    await page.mouse.up();
    await page.waitForTimeout(700);
  }
  noter('la poignée tirée vers le bas referme le volet', (await page.locator(panneau).count()) === 0);

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
