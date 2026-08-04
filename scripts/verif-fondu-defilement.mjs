#!/usr/bin/env node
/**
 * Le contenu s'efface-t-il en haut et en bas d'une zone qui défile ?
 *
 * Le fondu est réservé au défilement VERTICAL. On contrôle donc d'abord
 * qu'aucune zone qui glisse de CÔTÉ — rail du tableau, barres d'onglets — ne
 * porte le moindre voile, tout en continuant de défiler sur un seul axe.
 *
 * On ouvre ensuite la conversation du chef sur un écran de téléphone et on
 * vérifie trois choses : rien ne voile le haut tant qu'on est en haut, le
 * voile du haut s'allume dès qu'on a fait défiler, et il floute vraiment ce
 * qui passe derrière. On contrôle enfin le VOILE d'un tiroir : le volet des
 * quotas est un menu, et la bibliothèque n'en pose pas — il doit assombrir
 * l'écran derrière lui, puis s'effacer pendant que le tiroir redescend.
 *
 *   node scripts/verif-fondu-defilement.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

/* Le serveur de DÉVELOPPEMENT : HAIKODEV_URL désigne l'application publiée. */
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7099';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

function jeton() {
  const db = new Database('/root/haikodev/data/haikodev.db');
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification des fondus de défilement',
  );
  db.close();
  return { token, empreinte };
}

function retirer(empreinte) {
  const db = new Database('/root/haikodev/data/haikodev.db');
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

/** L'état des deux voiles d'une zone : présents ? visibles ? flous ? */
function lireVoiles() {
  const zones = Array.from(document.querySelectorAll('div')).filter((n) => {
    const enfants = Array.from(n.children);
    return (
      enfants.length === 3 &&
      enfants[0].getAttribute('aria-hidden') === 'true' &&
      enfants[2].getAttribute('aria-hidden') === 'true' &&
      enfants[1].scrollHeight > 0
    );
  });
  /* La plus haute des zones à voile : le fil de la conversation. Toutes sont
     verticales, un rail latéral ne porte plus rien. */
  const zone = zones.sort((a, b) => b.clientHeight - a.clientHeight)[0];
  if (!zone) return null;
  const [haut, corps, bas] = Array.from(zone.children);
  const style = (n) => getComputedStyle(n);
  return {
    debordement: corps.scrollHeight > corps.clientHeight + 8,
    scrollTop: corps.scrollTop,
    opaciteHaut: Number(style(haut).opacity),
    opaciteBas: Number(style(bas).opacity),
    /* Le voile est fait de plusieurs calques : des flous de plus en plus
       courts, puis l'ombre. On juge donc les calques, pas leur enveloppe. */
    couches: haut.children.length,
    flou: Array.from(haut.children)
      .map((n) => style(n).backdropFilter || style(n).webkitBackdropFilter || '')
      .filter((f) => f.includes('blur')).length,
    degrade: style(haut.children[haut.children.length - 1]).backgroundColor,
    masque: style(haut.children[0]).maskImage || style(haut.children[0]).webkitMaskImage || '',
    hauteur: haut.getBoundingClientRect().height,
  };
}

/**
 * Toutes les zones qui glissent de HAUT EN BAS, avec le nombre de voiles que
 * porte leur enveloppe. Il en faut deux : celui du début, celui de la fin.
 */
function lireZonesVerticales() {
  return Array.from(document.querySelectorAll('div'))
    .filter((n) => {
      const s = getComputedStyle(n);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && s.overflowX === 'hidden';
    })
    .map((n) => ({
      repere: (n.textContent || '').trim().slice(0, 40) || '(sans texte)',
      voiles: n.parentElement
        ? Array.from(n.parentElement.children).filter((e) => e.getAttribute('aria-hidden') === 'true').length
        : 0,
    }));
}

/**
 * Toutes les zones qui glissent de CÔTÉ, telles qu'elles sont à l'écran. Une
 * zone latérale se reconnaît à ses deux réglages : le côté libre, la hauteur
 * bloquée. On rend, pour chacune, ce que porte son enveloppe.
 */
function lireZonesLaterales() {
  return Array.from(document.querySelectorAll('div'))
    .filter((n) => {
      const s = getComputedStyle(n);
      return (s.overflowX === 'auto' || s.overflowX === 'scroll') && s.overflowY === 'hidden';
    })
    .map((n) => {
      const enveloppe = n.parentElement;
      const voiles = enveloppe
        ? Array.from(enveloppe.children).filter((e) => e.getAttribute('aria-hidden') === 'true')
        : [];
      return {
        repere: (n.textContent || '').trim().slice(0, 40) || '(sans texte)',
        voiles: voiles.length,
        flous: voiles.filter((v) =>
          Array.from(v.querySelectorAll('*')).some((c) => {
            const s = getComputedStyle(c);
            return (s.backdropFilter || s.webkitBackdropFilter || '').includes('blur');
          }),
        ).length,
        overflowY: getComputedStyle(n).overflowY,
        debordeDeCote: n.scrollWidth - n.clientWidth,
      };
    });
}

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
    deviceScaleFactor: 2,
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
  await page.waitForTimeout(6000);

  /* --- Les zones qui glissent de côté : aucun voile, jamais. --- */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const onglet = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Tableau');
    onglet?.click();
  });
  await page.waitForTimeout(2000);

  const laterales = await page.evaluate(lireZonesLaterales);
  noter('le rail du tableau glisse de côté', laterales.some((z) => z.debordeDeCote > 0), `${laterales.length} zone(s) latérale(s)`);

  /* La barre d'onglets des réglages est un second usage latéral : on l'ouvre
     pour la faire entrer dans le même contrôle. */
  try {
    await page.locator('header button').last().click({ timeout: 10000 });
    await page.waitForTimeout(500);
    await page.getByText('Réglages', { exact: true }).first().click({ timeout: 10000 });
    await page.waitForTimeout(1500);
  } catch {
    console.log('  (les réglages ne se sont pas ouverts : contrôle limité au rail)');
  }
  const laterales2 = await page.evaluate(lireZonesLaterales);
  const toutes = [...laterales, ...laterales2];

  noter('au moins deux zones latérales examinées', toutes.length >= 2, `${toutes.length} relevés`);
  const voilees = toutes.filter((z) => z.voiles > 0 || z.flous > 0);
  noter(
    'aucune zone latérale ne porte de voile',
    voilees.length === 0,
    voilees.map((z) => `« ${z.repere} » : ${z.voiles} voile(s)`).join(' | '),
  );
  noter(
    'chaque zone latérale bloque la hauteur',
    toutes.every((z) => z.overflowY === 'hidden'),
    toutes.map((z) => z.overflowY).join(', '),
  );

  /* On referme ce qu'une session précédente aurait laissé ouvert, puis on se
     place sur la conversation : c'est elle qui déborde assez pour juger. */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const onglet = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Chef');
    onglet?.click();
  });
  await page.waitForTimeout(2500);

  const verticales = await page.evaluate(lireZonesVerticales);
  const nues = verticales.filter((z) => z.voiles !== 2);
  noter(
    'chaque zone qui défile de haut en bas porte ses deux voiles',
    verticales.length > 0 && nues.length === 0,
    nues.length ? nues.map((z) => `« ${z.repere} » : ${z.voiles}`).join(' | ') : `${verticales.length} zone(s)`,
  );

  const repos = await page.evaluate(lireVoiles);
  noter('la zone de conversation porte bien deux voiles', !!repos, repos ? '' : 'aucune zone trouvée');

  if (repos) {
    noter(
      'le flou est progressif : plusieurs calques empilés',
      repos.flou >= 3 && repos.masque.includes('gradient'),
      `${repos.flou} calques flous sur ${repos.couches}`,
    );
    noter('l’ombre prend la couleur du fond', repos.degrade.startsWith('rgb'), repos.degrade);
    noter('le voile fait une bande fine', repos.hauteur > 24 && repos.hauteur < 72, `${Math.round(repos.hauteur)} px`);
  }

  // On fait défiler : le voile du haut doit s'allumer.
  const apres = await page.evaluate((lire) => {
    const zones = Array.from(document.querySelectorAll('div')).filter((n) => {
      const e = Array.from(n.children);
      return e.length === 3 && e[0].getAttribute('aria-hidden') === 'true' && e[2].getAttribute('aria-hidden') === 'true';
    });
    const zone = zones.sort((a, b) => b.clientHeight - a.clientHeight)[0];
    if (!zone) return null;
    const corps = zone.children[1];
    corps.scrollTop = Math.max(0, Math.floor(corps.scrollHeight / 2));
    corps.dispatchEvent(new Event('scroll'));
    return new Promise((r) => setTimeout(() => r(eval(`(${lire})`)()), 500));
  }, lireVoiles.toString());

  if (apres && apres.debordement) {
    noter('le voile du haut s\'allume une fois le contenu remonté', apres.opaciteHaut > 0.9, `opacité ${apres.opaciteHaut}`);
    noter('le voile du bas reste allumé tant qu\'il reste à lire', apres.opaciteBas > 0.9, `opacité ${apres.opaciteBas}`);
  } else {
    noter('la conversation déborde assez pour juger du voile', false, 'contenu trop court');
  }

  /* Le volet des quotas : un menu devenu tiroir. Il doit poser son voile.
     On referme d'abord ce qu'une session précédente aurait laissé ouvert. */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  await page.locator('button[title="Quotas des moteurs"]').click({ timeout: 15000 });
  await page.waitForTimeout(900);

  const lireVoileTiroir = () =>
    page.evaluate(() => {
      /* Le voile d'un menu se reconnaît à son plan : 55, entre les panneaux
         déjà ouverts (50) et le tiroir lui-même (60). */
      const voile = Array.from(document.body.children).find(
        (n) => getComputedStyle(n).zIndex === '55',
      );
      if (!voile) return null;
      const s = getComputedStyle(voile);
      return {
        opacite: Number(s.opacity),
        couvre: voile.getBoundingClientRect().height >= window.innerHeight - 2,
        flou: s.backdropFilter || s.webkitBackdropFilter || '',
        etat: voile.getAttribute('data-state'),
      };
    });

  const ouvert = await lireVoileTiroir();
  noter('le tiroir des quotas pose un voile sombre', !!ouvert, ouvert ? '' : 'aucun voile');
  if (ouvert) {
    noter('le voile couvre tout l’écran et floute le fond', ouvert.couvre && ouvert.flou.includes('blur'), ouvert.flou);
    noter('le voile est bien allumé tiroir ouvert', ouvert.opacite > 0.9, `opacité ${ouvert.opacite}`);
  }

  // On referme : le voile doit passer en « closed » et s'effacer.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(110);
  const enFermeture = await lireVoileTiroir();
  noter(
    'le voile s’efface pendant que le tiroir redescend',
    !!enFermeture && enFermeture.etat === 'closed' && enFermeture.opacite < 0.95,
    enFermeture ? `opacité ${enFermeture.opacite.toFixed(2)}` : 'voile déjà retiré',
  );
  await page.waitForTimeout(700);
  noter('le voile disparaît une fois le tiroir fermé', (await lireVoileTiroir()) === null);

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
