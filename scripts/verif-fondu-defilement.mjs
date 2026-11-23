#!/usr/bin/env node
/**
 * Le contenu s'efface-t-il en haut et en bas d'une zone qui défile ?
 *
 * Les bandes de cartes portent un fondu à leurs DEUX BOUTS et une barre
 * maison, sur l'axe où elles défilent : de côté en rangées (ordinateur), de
 * haut en bas en colonnes (le téléphone, par défaut). Les autres zones qui
 * glissent de CÔTÉ — le rail des colonnes, les barres d'onglets — n'ont pas
 * de fondu, mais portent la barre discrète commune à TOUTES les zones qui
 * défilent. Toutes défilent sur un seul axe.
 *
 * Voiles, barres et axes se reconnaissent à leurs REPÈRES
 * (`data-voile-defilement`, `data-barre-defilement`, `ZoneDefilement`), jamais
 * à leur place parmi les enfants : la barre dessinée est elle aussi
 * `aria-hidden`, et la compter comme un voile faisait échouer ce contrôle.
 *
 * On ouvre ensuite le tiroir « Fichiers » du téléphone (bouton du menu du bas)
 * et on juge sa plus grande zone qui défile de haut en bas : trois choses : rien ne voile le haut tant qu'on est en haut, le
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
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

/* Le serveur de DÉVELOPPEMENT : BELUGA_URL désigne l'application publiée. */
const BASE = process.env.BELUGA_VERIF_URL || 'http://localhost:7099';

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
    'vérification des fondus de défilement',
  );
  db.close();
  return { token, empreinte };
}

function retirer(empreinte) {
  const db = new Database(cheminDeLaBaseServie());
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

/**
 * L'état des deux voiles d'une zone : présents ? visibles ? flous ? On juge la
 * plus grande zone verticale qui DÉBORDE (sinon la plus grande tout court) :
 * c'est elle qui a de quoi faire défiler. Écrite sans dépendance extérieure,
 * elle est aussi rejouée telle quelle après le défilement.
 */
function lireVoiles() {
  const zones = Array.from(document.querySelectorAll('[data-voile-defilement="vertical-debut"]'))
    .map((haut) => {
      const enveloppe = haut.parentElement;
      return {
        haut,
        bas: enveloppe.querySelector(':scope > [data-voile-defilement="vertical-fin"]'),
        corps: Array.from(enveloppe.children).find((e) => !e.hasAttribute('aria-hidden')),
      };
    })
    .filter((z) => z.bas && z.corps && z.corps.clientHeight > 0);
  const deborde = (z) => z.corps.scrollHeight > z.corps.clientHeight + 8;
  const zone = zones.sort(
    (a, b) => Number(deborde(b)) - Number(deborde(a)) || b.corps.clientHeight - a.corps.clientHeight,
  )[0];
  if (!zone) return null;
  const { haut, corps, bas } = zone;
  const style = (n) => getComputedStyle(n);
  return {
    debordement: deborde(zone),
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

/** Fait défiler la zone que juge `lireVoiles` jusqu'au milieu de sa course. */
function defilerLaZoneJugee() {
  const zones = Array.from(document.querySelectorAll('[data-voile-defilement="vertical-debut"]'))
    .map((haut) => Array.from(haut.parentElement.children).find((e) => !e.hasAttribute('aria-hidden')))
    .filter((corps) => corps && corps.clientHeight > 0);
  const deborde = (c) => c.scrollHeight > c.clientHeight + 8;
  const corps = zones.sort((a, b) => Number(deborde(b)) - Number(deborde(a)) || b.clientHeight - a.clientHeight)[0];
  if (!corps) return false;
  /* Le milieu de la course réelle : du contenu reste au-dessus ET au-dessous. */
  const course = Math.max(0, corps.scrollHeight - corps.clientHeight);
  corps.scrollTop = Math.max(1, Math.floor(course / 2));
  corps.dispatchEvent(new Event('scroll'));
  return true;
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
        ? n.parentElement.querySelectorAll(':scope > [data-voile-defilement^="vertical-"]').length
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
        ? Array.from(enveloppe.querySelectorAll(':scope > [data-voile-defilement^="horizontal-"]'))
        : [];
      const barres = enveloppe
        ? enveloppe.querySelectorAll(':scope > [data-barre-defilement="horizontal"]').length
        : 0;
      return {
        repere: (n.textContent || '').trim().slice(0, 40) || '(sans texte)',
        bande: n.hasAttribute('data-bande-cartes'),
        voiles: voiles.length,
        barres,
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

/**
 * Les BANDES DE CARTES, sur l'axe où elles défilent : ce que porte leur
 * enveloppe — deux voiles de cet axe, flous, et une barre maison.
 */
function lireBandes() {
  return Array.from(document.querySelectorAll('[data-bande-cartes]')).map((n) => {
    const s = getComputedStyle(n);
    const axe = s.overflowY === 'auto' || s.overflowY === 'scroll' ? 'vertical' : 'horizontal';
    const enveloppe = n.parentElement;
    const voiles = Array.from(enveloppe.querySelectorAll(`:scope > [data-voile-defilement^="${axe}-"]`));
    return {
      repere: n.getAttribute('data-bande-cartes'),
      axe,
      unSeulAxe: axe === 'vertical' ? s.overflowX === 'hidden' : s.overflowY === 'hidden',
      voiles: voiles.length,
      flous: voiles.filter((v) =>
        Array.from(v.querySelectorAll('*')).some((c) => {
          const st = getComputedStyle(c);
          return (st.backdropFilter || st.webkitBackdropFilter || '').includes('blur');
        }),
      ).length,
      barres: enveloppe.querySelectorAll(`:scope > [data-barre-defilement="${axe}"]`).length,
    };
  });
}

/** Les bandes d'une disposition portent-elles leurs voiles et leur barre ? */
function jugerBandes(bandes, etiquette) {
  noter(
    `${etiquette} : les bandes de cartes portent deux ombres et leur barre maison`,
    bandes.length >= 4 && bandes.every((z) => z.voiles === 2 && z.flous === 2 && z.barres === 1),
    bandes.map((z) => `« ${z.repere} » (${z.axe}) : ${z.voiles} ombre(s), ${z.flous} floue(s), ${z.barres} barre`).join(' | '),
  );
  noter(
    `${etiquette} : chaque bande défile sur un seul axe`,
    bandes.length >= 4 && bandes.every((z) => z.unSeulAxe),
    bandes.map((z) => `${z.repere} ${z.axe}`).join(', '),
  );
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
    { name: 'beluga_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  /* --- Les bandes de cartes ont leurs ombres et leur barre maison. --- */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const onglet = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Tableau');
    onglet?.click();
  });
  await page.waitForTimeout(2000);

  const laterales = await page.evaluate(lireZonesLaterales);
  const bandesTelephone = await page.evaluate(lireBandes);
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
  /* Le téléphone s'ouvre en COLONNES : ses bandes défilent de haut en bas. */
  jugerBandes(bandesTelephone, 'téléphone (colonnes)');
  const autres = toutes.filter((z) => !z.bande);
  /* Plus de voile sur ces zones-là, mais la barre fine et discrète, elle, est
     COMMUNE à toutes les zones qui défilent (invisible au repos). */
  noter(
    'les autres zones latérales restent sans ombre, avec la barre discrète commune',
    autres.every((z) => z.voiles === 0 && z.flous === 0 && z.barres === 1),
    autres.filter((z) => z.voiles > 0 || z.flous > 0 || z.barres !== 1)
      .map((z) => `« ${z.repere} » : ${z.voiles} ombre(s), ${z.barres} barre`).join(' | '),
  );
  noter(
    'chaque zone latérale bloque la hauteur',
    toutes.every((z) => z.overflowY === 'hidden'),
    toutes.map((z) => z.overflowY).join(', '),
  );

  /* On referme ce qu'une session précédente aurait laissé ouvert, puis on se
     ouvre le tiroir « Fichiers » (le bouton de droite du menu du bas) : son
     arbre déborde assez pour juger. */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const onglet = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Fichiers');
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
  noter('la zone qui défile de haut en bas porte bien deux voiles', !!repos, repos ? '' : 'aucune zone trouvée');

  if (repos) {
    noter(
      'le flou est progressif : plusieurs calques empilés',
      repos.flou >= 3 && repos.masque.includes('gradient'),
      `${repos.flou} calques flous sur ${repos.couches}`,
    );
    noter("l’ombre prend la couleur du fond", /^(rgb|color\(srgb)/.test(repos.degrade), repos.degrade);
    /* La liste des agents, souvent la zone jugée, pose une bande de 16 px. */
    noter('le voile fait une bande fine', repos.hauteur > 12 && repos.hauteur < 72, `${Math.round(repos.hauteur)} px`);
  }

  // On fait défiler : le voile du haut doit s'allumer.
  await page.evaluate(defilerLaZoneJugee);
  await page.waitForTimeout(500);
  const apres = await page.evaluate(lireVoiles);

  if (apres && apres.debordement) {
    noter('le voile du haut s\'allume une fois le contenu remonté', apres.opaciteHaut > 0.9, `opacité ${apres.opaciteHaut}`);
    noter('le voile du bas reste allumé tant qu\'il reste à lire', apres.opaciteBas > 0.9, `opacité ${apres.opaciteBas}`);
  } else {
    noter('la zone jugée déborde assez pour juger du voile', false, 'contenu trop court');
  }

  /* Le volet des quotas : un menu devenu tiroir. Il doit poser son voile.
     On referme d'abord ce qu'une session précédente aurait laissé ouvert. */
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
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

  /* --- Sur ordinateur, en RANGÉES : les bandes glissent de côté. --- */
  const bureau = await navigateur.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await bureau.addCookies([
    { name: 'beluga_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const pageBureau = await bureau.newPage();
  await pageBureau.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pageBureau.locator('[data-bande-cartes]').first().waitFor({ state: 'attached', timeout: 30000 }).catch(() => undefined);
  await pageBureau.waitForTimeout(800);
  jugerBandes(await pageBureau.evaluate(lireBandes), 'ordinateur (rangées)');
  await bureau.close();
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
