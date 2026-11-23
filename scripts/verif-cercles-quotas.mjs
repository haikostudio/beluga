#!/usr/bin/env node
/**
 * Le bouton des quotas montre-t-il DEUX RONDS séparés, côte à côte, et
 * passe-t-il d'un compte à l'autre toutes les 10 s ?
 *
 * Sur ordinateur puis sur téléphone, en clair puis en sombre : un rond pour la
 * fenêtre 5 h à gauche, un rond pour la semaine à droite, chacun avec son
 * propre chiffre — plus aucun cercle emboîté dans un autre —, le compte change
 * après 10 s, et chaque passage correspond au détail du menu.
 *
 *   HAIKO_ANNEAUX_URL=http://localhost:7099 node scripts/verif-cercles-quotas.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

/* Le serveur de DÉVELOPPEMENT, jamais BELUGA_URL (l'application publiée). */
const BASE = process.env.HAIKO_ANNEAUX_URL || 'http://localhost:7099';
const CAPTURES = process.env.HAIKO_ANNEAUX_CAPTURES || '/tmp';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

function jeton() {
  const db = new Database(cheminDeLaBaseServie());
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification cercles des quotas',
  );
  db.close();
  return { token, empreinte };
}

function retirer(empreinte) {
  const db = new Database(cheminDeLaBaseServie());
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

const BADGE = '[data-essai="badge-quota"]';

async function lireBadge(page) {
  return page.$eval(BADGE, (el) => {
    const ronds = [...el.querySelectorAll('span.relative.flex.h-5.w-5')];
    return {
      compte: el.getAttribute('data-compte'),
      session: Number(el.getAttribute('data-session')),
      semaine: Number(el.getAttribute('data-semaine')),
      nombreDeRonds: ronds.length,
      // Un rond par fenêtre : sa propre piste + son propre remplissage.
      cerclesParRond: ronds.map((r) => r.querySelectorAll('svg circle').length),
      chiffres: ronds.map((r) => r.querySelector('span.relative')?.textContent?.trim() ?? ''),
      // Les deux ronds ne se touchent pas et ne s'imbriquent pas : chacun a sa
      // propre boîte, séparée horizontalement de l'autre.
      boites: ronds.map((r) => r.getBoundingClientRect()).map((b) => ({ x: b.x, largeur: b.width })),
      // Le NOM du compte ne s'affiche plus dans le bouton : il vit dans son
      // `title` (bulle au survol). À sa place, le LOGO du moteur, à gauche des ronds.
      nom: el.getAttribute('title') ?? '',
      logo: el.querySelector('[data-logo-badge]')?.getAttribute('data-logo-badge') ?? '',
      logoAGauche: (() => {
        const logo = el.querySelector('[data-logo-badge]')?.getBoundingClientRect();
        const premierRond = ronds[0]?.getBoundingClientRect();
        return !!logo && !!premierRond && logo.width > 0 && logo.right <= premierRond.left + 0.5;
      })(),
      // Aucun texte hors des chiffres des ronds : plus de nom écrit en clair.
      texteHorsRonds: [...el.childNodes]
        .filter((n) => !(n instanceof Element && n.querySelector('span.relative.flex.h-5.w-5')))
        .map((n) => n.textContent ?? '')
        .join('')
        .trim(),
      largeur: el.getBoundingClientRect().width,
    };
  });
}

async function parcours(navigateur, { nom, mobile, sombre }, token) {
  const context = await navigateur.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: 2,
    colorScheme: sombre ? 'dark' : 'light',
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'beluga_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector(`${BADGE}[data-compte]`, { timeout: 30000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 3 && (await page.locator('[role="dialog"]').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  const passages = [await lireBadge(page)];
  await page.locator(BADGE).screenshot({ path: `${CAPTURES}/cercles-${nom}-1.png` });
  for (let i = 0; i < 2; i++) {
    await page.waitForTimeout(10_500);
    passages.push(await lireBadge(page));
  }
  await page.locator(BADGE).screenshot({ path: `${CAPTURES}/cercles-${nom}-3.png` });
  console.log(
    `  [${nom}]`,
    passages.map((p) => `${p.nom || p.compte} ${p.chiffres.join('/')} (${p.nombreDeRonds} ronds)`).join(' → '),
  );

  const premier = passages[0];
  const avecQuota = passages.filter((p) => p.nombreDeRonds === 2);
  noter(`${nom} : deux ronds séparés (pas un cercle imbriqué dans l'autre)`, avecQuota.length > 0 && avecQuota.every((p) => p.nombreDeRonds === 2));
  noter(
    `${nom} : chaque rond a sa propre piste et son propre remplissage`,
    avecQuota.every((p) => p.cerclesParRond.every((n) => n === 2)),
    avecQuota.map((p) => p.cerclesParRond.join('/')).join(' ; '),
  );
  noter(
    `${nom} : le rond de gauche porte la fenêtre 5 h, celui de droite la semaine`,
    avecQuota.every((p) => Number(p.chiffres[0]) === p.session && Number(p.chiffres[1]) === p.semaine),
    avecQuota.map((p) => `${p.chiffres.join('/')} vs ${p.session}/${p.semaine}`).join(' ; '),
  );
  // Deux ronds côte à côte : le second commence bien après la fin du premier,
  // jamais à la même abscisse (ce qui trahirait un cercle emboîté).
  noter(
    `${nom} : les deux ronds sont côte à côte, jamais l'un sur l'autre`,
    avecQuota.every((p) => p.boites.length === 2 && p.boites[1].x >= p.boites[0].x + p.boites[0].largeur - 1),
    avecQuota.map((p) => p.boites.map((b) => `${b.x.toFixed(0)}+${b.largeur.toFixed(0)}`).join(' / ')).join(' ; '),
  );
  noter(`${nom} : le compte change après 10 s`, passages[1].compte !== premier.compte, `${premier.compte} → ${passages[1].compte}`);
  // Largeur IDENTIQUE d'un compte à l'autre : la barre du haut ne bouge pas.
  noter(
    `${nom} : la largeur du bouton ne change pas d'un compte à l'autre`,
    passages.every((p) => Math.abs(p.largeur - premier.largeur) < 1),
    passages.map((p) => Math.round(p.largeur)).join('/'),
  );
  noter(`${nom} : le nom du compte est porté par l'infobulle`, passages.every((p) => p.nom.length > 0));
  noter(
    `${nom} : le logo du moteur est posé à gauche des deux ronds`,
    passages.every((p) => p.logo.length > 0 && p.logoAGauche),
    passages.map((p) => p.logo || '—').join(' → '),
  );
  noter(
    `${nom} : plus aucun nom écrit dans le bouton`,
    passages.every((p) => p.texteHorsRonds === ''),
    passages.map((p) => JSON.stringify(p.texteHorsRonds)).join(' ; '),
  );

  // Le menu détaillé : chaque passage doit correspondre à sa carte de compte.
  await page.locator(BADGE).click();
  await page.waitForTimeout(800);
  const cartes = await page.$$eval('[data-radix-popper-content-wrapper] [role="menu"] .space-y-2 > div, [role="dialog"] .space-y-2 > div', (els) =>
    els.map((el) => ({
      interrupteur: el.querySelector('[data-interrupteur-compte]')?.getAttribute('data-interrupteur-compte'),
      pourcents: [...el.querySelectorAll('.ml-auto')].map((s) => Number(s.textContent.replace(/[^0-9]/g, ''))),
    })),
  );
  let concordance = true;
  const detail = [];
  for (const p of avecQuota) {
    const carte = cartes.find((c) => c.interrupteur === p.compte);
    if (!carte || carte.pourcents.length < 2) continue;
    const ok = carte.pourcents[0] === p.session && carte.pourcents[1] === p.semaine;
    detail.push(`${p.compte}: ${p.session}/${p.semaine} vs ${carte.pourcents.join('/')}`);
    concordance &&= ok;
  }
  noter(`${nom} : ronds conformes au détail du menu`, concordance && detail.length > 0, detail.join(' ; '));
  noter(`${nom} : aucune erreur de page`, erreurs.length === 0, erreurs.join(' | '));
  await context.close();
}

async function main() {
  const { token, empreinte } = jeton();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    await parcours(navigateur, { nom: 'ordinateur-clair', mobile: false, sombre: false }, token);
    await parcours(navigateur, { nom: 'ordinateur-sombre', mobile: false, sombre: true }, token);
    await parcours(navigateur, { nom: 'telephone-sombre', mobile: true, sombre: true }, token);
  } finally {
    await navigateur.close();
    retirer(empreinte);
  }
  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(echecs ? `\n${echecs} échec(s)` : '\nTout est bon.');
  process.exit(echecs ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
