#!/usr/bin/env node
/**
 * LE REPÈRE DE L'HEURE, CE QUE L'IPHONE LIT POUR TEINTER SA BARRE (`web/src/lib/barre-de-l-heure.ts`).
 *
 * Verrouille la géométrie exigée par WebKit (plus de 10 px de haut, opacité d'au moins 0,1, fond opaque, au sommet
 * du point à 4 px) et la mécanique : couleur de la page, assombrie sous un voile, rétablie à sa fermeture, relecture
 * forcée, rien sur ordinateur. CE CONTRÔLE NE PROUVE PAS LA BARRE ELLE-MÊME : Chrome n'a ni cette barre ni son gel,
 * seul un essai sur iPhone tranche.
 *
 *   HAIKO_BARRE_URL=http://localhost:7099 node scripts/verif-barre-de-l-heure.mjs
 *
 * (serveur de développement lancé depuis la copie de travail ; jamais BELUGA_URL). Une session d'une heure est
 * fabriquée puis retirée (jeton HACHÉ en base).
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';
import { THEMES, couleurDeBandeau, estThemeSombre } from '../shared/dist/themes.js';

const ADRESSE = process.env.HAIKO_BARRE_URL || 'http://localhost:7099';
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';
const ID = 'repere-de-l-heure';
const TELEPHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' };

async function avecSession(travail) {
  const require = createRequire(import.meta.url);
  const ouvrir = () => require(path.join(DONNEES, '../node_modules/better-sqlite3'))(cheminDeLaBaseServie(DONNEES));
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const db = ouvrir();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(empreinte, maintenant, maintenant + 3_600_000, 'vérification de la barre de l’heure');
  db.close();
  try {
    return await travail(cookie);
  } finally {
    const fin = ouvrir();
    fin.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    fin.close();
  }
}

const refus = [];
const verifier = (ok, texte) => {
  console.log(`${ok ? '✓' : '✗'} ${texte}`);
  if (!ok) refus.push(texte);
};

const enHex = (rvb) => `#${rvb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
const proche = (a, b) => {
  const canaux = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [canaux(a), canaux(b)];
  return x.every((v, i) => Math.abs(v - y[i]) <= 1);
};

/** Le repère tel qu'il est, et ce qu'un test de position qui ignore `pointer-events` (celui de WebKit) trouverait à 4 px. */
const lireLeRepere = (page) => page.evaluate((id) => {
  const tous = document.querySelectorAll(`#${id}`);
  const r = tous[0];
  if (!r) return { nombre: 0 };
  const s = getComputedStyle(r);
  const b = r.getBoundingClientRect();
  const avant = r.style.pointerEvents;
  r.style.pointerEvents = 'auto';
  const sommet = document.elementFromPoint(window.innerWidth / 2, 4);
  r.style.pointerEvents = avant;
  const lignee = [];
  for (let n = r.parentElement; n; n = n.parentElement) {
    const st = getComputedStyle(n);
    if (st.transform !== 'none' || st.filter !== 'none' || st.backdropFilter !== 'none') lignee.push(n.tagName);
  }
  return {
    nombre: tous.length,
    parentBody: r.parentElement === document.body,
    position: s.position,
    haut: b.top,
    hauteur: b.height,
    largeur: b.width,
    fenetre: window.innerWidth,
    opacite: Number(s.opacity),
    fond: s.backgroundColor,
    affiche: s.display,
    couleur: r.dataset.couleur,
    relectures: Number(r.dataset.relectures ?? 0),
    auSommet: sommet === r,
    lignee,
    pointeurs: avant,
    caché: r.getAttribute('aria-hidden'),
  };
}, ID);

const attendreLaCouleur = (page, couleur) =>
  page.waitForFunction(([id, c]) => document.getElementById(id)?.dataset.couleur === c, [ID, couleur], { timeout: 3000, polling: 30 }).then(() => true, () => false);

function verifierLaGeometrie(r, quand) {
  verifier(r.nombre === 1 && r.parentBody, `${quand} : un seul repère, enfant direct de body`);
  verifier(r.position === 'fixed' && r.haut === -7.5 && r.hauteur > 10 && r.largeur === r.fenetre, `${quand} : fixe, plus de 10 px de haut, pleine largeur (${r.haut} / ${r.hauteur} / ${r.largeur})`);
  verifier(r.opacite >= 0.1 && r.opacite < 0.2, `${quand} : lisible par l'iPhone (opacité ≥ 0,1) et invisible à l'œil (${r.opacite})`);
  verifier(/^rgb\(/.test(r.fond), `${quand} : fond opaque (${r.fond})`);
  verifier(r.auSommet, `${quand} : au sommet du point lu par l'iPhone (milieu, 4 px)`);
  verifier(r.lignee.length === 0, `${quand} : aucune transformation ni aucun flou dans sa lignée`);
  verifier(r.pointeurs === 'none' || r.pointeurs === '', `${quand} : laisse passer le toucher`);
  verifier(r.caché === 'true', `${quand} : ignoré des lecteurs d'écran`);
}

await avecSession(async (session) => {
  const navigateur = await chromium.launch({ channel: 'chrome' });
  const preparer = async (options, theme) => {
    const contexte = await navigateur.newContext(options);
    await contexte.addCookies([{ name: 'beluga_session', value: session, domain: new URL(ADRESSE).hostname, path: '/' }]);
    await contexte.addInitScript((t) => {
      try { window.localStorage.setItem('beluga-theme-flash', t); } catch { /* la pose d'après suffit */ }
    }, theme);
    const page = await contexte.newPage();
    /* AUCUNE TRACE : ni préférence, ni « lu » envoyés au serveur. */
    await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
      const serveur = ws.connectToServer();
      ws.onMessage((message) => {
        try {
          const lu = JSON.parse(String(message));
          if (['prefs.set', 'card.read', 'project.read', 'annonces.vider'].includes(lu?.cmd?.type ?? lu?.type)) return;
        } catch { /* passe tel quel */ }
        serveur.send(message);
      });
    });
    return { contexte, page };
  };
  try {
    for (const theme of THEMES) {
      const id = theme.id;
      const attendue = couleurDeBandeau(id);

      /* LE PREMIER AFFICHAGE : sans aucun module, le repère a déjà la bonne couleur. */
      {
        const { contexte, page } = await preparer(TELEPHONE, id);
        await page.route('**/src/main.tsx*', (route) => route.abort());
        await page.goto(ADRESSE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        const r = await lireLeRepere(page);
        const fond = (r.fond.match(/\d+/g) ?? []).slice(0, 3).map(Number);
        verifier(r.nombre === 1 && r.affiche === 'block' && enHex(fond) === attendue, `${id} : avant tout module, le repère est posé et de la couleur de la page (${r.fond})`);
        await contexte.close();
      }

      const { contexte, page } = await preparer(TELEPHONE, id);
      await page.goto(ADRESSE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForSelector('[data-zone="centre"]', { state: 'attached', timeout: 60_000 });
      for (let essai = 0; essai < 40; essai += 1) {
        if (await page.evaluate(() => !document.querySelector('.animate-silhouette'))) break;
        await page.waitForTimeout(500);
      }
      await page.evaluate(([t, sombre]) => {
        document.documentElement.dataset.theme = t;
        document.documentElement.classList.toggle('dark', sombre);
      }, [id, estThemeSombre(id)]);

      verifier(await attendreLaCouleur(page, attendue), `${id} : voile fermé, le repère a la couleur de la page (${attendue})`);
      verifierLaGeometrie(await lireLeRepere(page), `${id}, voile fermé`);

      /* DES VOILES OUVERTS PUIS REFERMÉS, plusieurs fois de suite. */
      for (let tour = 1; tour <= 3; tour += 1) {
        const avant = (await lireLeRepere(page)).relectures;
        await page.locator('[data-zone="centre"] [data-cloche-notifications], [data-zone="centre"] button[aria-label*="otification"]').first().click();
        await page.locator('[data-feuille-du-bas]').waitFor({ timeout: 10_000 });
        const melange = await page.evaluate(() => {
          const voile = document.querySelector('[data-voile-tiroir]');
          const m = getComputedStyle(voile).backgroundColor.match(/[\d.]+/g).map(Number);
          return { rvb: m.slice(0, 3), a: m[3] ?? 1 };
        });
        const page8 = [1, 3, 5].map((i) => parseInt(attendue.slice(i, i + 2), 16));
        const sousLeVoile = enHex(page8.map((c, i) => melange.rvb[i] * melange.a + c * (1 - melange.a)));
        await page.waitForFunction((i) => document.getElementById(i)?.dataset.couleur !== undefined, ID);
        /* LA BARRE SUIT LE FONDU (01/11/2026) : elle arrive au mélange à la fin du fondu, et pas d'un seul saut. */
        const arrivee = await page.waitForFunction(([i, c]) => {
          const lue = document.getElementById(i)?.dataset.couleur ?? '';
          const canaux = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
          return /^#[0-9a-f]{6}$/.test(lue) && canaux(lue).every((v, k) => Math.abs(v - canaux(c)[k]) <= 1);
        }, [ID, sousLeVoile], { timeout: 3000, polling: 30 }).then(() => true, () => false);
        const ouvert = await lireLeRepere(page);
        verifier(arrivee && proche(ouvert.couleur, sousLeVoile), `${id}, tour ${tour} : sous le voile, la barre est le mélange voile + page (${ouvert.couleur} / ${sousLeVoile})`);
        verifier(ouvert.relectures > avant, `${id}, tour ${tour} : l'ouverture force une relecture (${avant} → ${ouvert.relectures})`);
        verifier(ouvert.relectures - avant >= 3, `${id}, tour ${tour} : la barre suit le fondu d'ouverture image par image (${ouvert.relectures - avant} relectures)`);
        if (tour === 1) {
          verifierLaGeometrie(ouvert, `${id}, voile ouvert`);
          const pointeursDuCorps = await page.evaluate(() => document.body.style.pointerEvents);
          console.log(`· ${id} : pendant le voile, le blocage de la page par la fenêtre reste « ${pointeursDuCorps || 'aucun'} »`);
          await page.screenshot({ path: `/tmp/barre-de-l-heure-${id}-voile.png` });
        }
        await page.mouse.click(195, 40);
        await page.locator('[data-feuille-du-bas]').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
        verifier(await attendreLaCouleur(page, attendue), `${id}, tour ${tour} : à la fermeture, la barre retrouve exactement la couleur de la page`);
        const ferme = await lireLeRepere(page);
        verifier(ferme.relectures > ouvert.relectures, `${id}, tour ${tour} : la fermeture force une relecture (${ouvert.relectures} → ${ferme.relectures})`);
        verifier(ferme.affiche === 'block', `${id}, tour ${tour} : le repère est bien réaffiché après la relecture`);
      }

      /* UNE FERMETURE SANS CLIC (Échap) : la barre s'éclaircit PENDANT le fondu de sortie, pas après. */
      await page.locator('[data-zone="centre"] [data-cloche-notifications], [data-zone="centre"] button[aria-label*="otification"]').first().click();
      await page.locator('[data-feuille-du-bas]').waitFor({ timeout: 10_000 });
      await page.waitForTimeout(400);
      const couverte = (await lireLeRepere(page)).couleur;
      await page.keyboard.press('Escape');
      const pendant = await page.evaluate(
        ([i]) => new Promise((rendre) => setTimeout(() => rendre({
          couleur: document.getElementById(i)?.dataset.couleur,
          voileEncoreLa: !!document.querySelector('[data-voile-tiroir]'),
        }), 110)),
        [ID],
      );
      verifier(pendant.voileEncoreLa && pendant.couleur !== couverte, `${id} : fermé par Échap, la barre s'éclaircit pendant le fondu de sortie (${couverte} → ${pendant.couleur}, voile encore là : ${pendant.voileEncoreLa})`);
      verifier(await attendreLaCouleur(page, attendue), `${id} : …et finit exactement à la couleur de la page`);

      /* CE QUI COUVRE LE BORD DÉCIDE, LE RESTE NE COMPTE PAS. */
      const poser = (css) => page.evaluate((style) => {
        const e = document.createElement('div');
        e.dataset.essaiBarre = '';
        e.style.cssText = `position:fixed;z-index:60;${style}`;
        document.body.appendChild(e);
      }, css);
      const retirer = () => page.evaluate(() => document.querySelectorAll('[data-essai-barre]').forEach((e) => e.remove()));
      await poser('inset:0 0 auto 0;height:200px;background:#123456');
      verifier(await attendreLaCouleur(page, '#123456'), `${id} : une feuille qui monte jusqu'en haut donne sa propre couleur`);
      await retirer();
      verifier(await attendreLaCouleur(page, attendue), `${id} : son retrait rend la couleur de la page`);
      await poser('inset:0 0 auto 0;height:6px;background:#123456');
      await poser('top:0;left:40px;right:40px;height:200px;background:#123456');
      await page.waitForTimeout(120);
      verifier((await lireLeRepere(page)).couleur === attendue, `${id} : un trait mince ou un élément moins large que l'écran ne teinte pas la barre`);
      await retirer();

      /* LE RETOUR AU PREMIER PLAN RELIT SANS CONDITION, MÊME SI RIEN N'A CHANGÉ. */
      const avantRetour = (await lireLeRepere(page)).relectures;
      await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
      await page.waitForTimeout(120);
      verifier((await lireLeRepere(page)).relectures > avantRetour, `${id} : le retour dans l'application force une relecture`);

      /* LE THÈME CHANGÉ À LA VOLÉE. */
      const autre = THEMES.find((t) => t.id !== id)?.id;
      if (autre) {
        await page.evaluate(([t, sombre]) => {
          document.documentElement.dataset.theme = t;
          document.documentElement.classList.toggle('dark', sombre);
        }, [autre, estThemeSombre(autre)]);
        verifier(await attendreLaCouleur(page, couleurDeBandeau(autre)), `${id} → ${autre} : le repère suit le thème`);
      }
      await contexte.close();
    }

    /* SUR ORDINATEUR, AUCUN REPÈRE, ET LE HAUT DE LA PAGE NE CHANGE PAS. */
    const { contexte, page } = await preparer({ viewport: { width: 1400, height: 900 } }, 'clair');
    await page.goto(ADRESSE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('[data-zone="centre"]', { state: 'attached', timeout: 60_000 });
    await page.waitForTimeout(300);
    verifier((await page.locator(`#${ID}`).count()) === 0, 'ordinateur : aucun repère');
    /* Qu'un voile ne le recrée pas sur ordinateur : section 8 de verif-liste-des-agents.mjs, après ses tiroirs. */
    await contexte.close();
  } finally {
    await navigateur.close();
  }
});

if (refus.length) {
  console.log(`\n${refus.length} point(s) en échec.`);
  process.exit(1);
}
console.log('\nLe repère de l’heure est conforme. Le verdict sur la barre elle-même reste à prendre sur iPhone.');
