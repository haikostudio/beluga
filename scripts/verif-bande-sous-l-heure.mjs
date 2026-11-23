#!/usr/bin/env node
/**
 * LA BANDE SOUS L'HEURE ET LA FEUILLE DES NOTIFICATIONS, AU TÉLÉPHONE.
 *
 * iOS 26/27 pose un flou sous l'heure d'une application installée, SAUF quand
 * un élément fixe et opaque touche le bord du haut (`bande-sous-l-heure.tsx`).
 * Le flou ne se voit pas dans Chrome : ce contrôle vérifie ce qui se mesure.
 *
 *  1. sur un téléphone (390 × 844, zone sûre de 59 px posée), en clair ET en
 *     sombre, la bande `[data-bande-sous-l-heure]` existe, est fixe, touche le
 *     haut, couvre toute la largeur sur 59 px, et sa couleur est EXACTEMENT
 *     celle de la zone principale dessous — jamais un bandeau à part ;
 *  2. la barre d'en-tête commence juste sous la zone sûre (aucune marge en plus) ;
 *  3. la cloche ouvre une FEUILLE DU BAS (`[data-feuille-du-bas]`) dont l'en-tête
 *     commun porte le titre au centre et « Tout effacer » à droite, sur la même
 *     ligne (quand il y a des notifications) ;
 *  4. feuille ouverte, la bande du VOILE (`[data-bande-du-voile]`) est elle-même
 *     FIXE (WebKit n'échantillonne que l'élément fixe collé au bord : une bande
 *     `absolute` laissait iOS lire le voile translucide et remettre son flou),
 *     haute de la zone sûre, et peinte d'un aplat OPAQUE égal au mélange du
 *     voile sur le fond de la zone ;
 *  5. un clic sur le voile referme la feuille ;
 *  6. LA BARRE « DEFAULT » (30/10/2026) : la page la demande, sans
 *     `viewport-fit=cover`, et dans les douze palettes la couleur que reçoit la
 *     bande de l'heure (`theme-color`) est exactement le fond de la zone ; à
 *     encart nul, la bande du haut n'a aucune hauteur. C'est tout ce qui se
 *     mesure ici : le flou d'iOS ne se juge que sur l'iPhone.
 *
 * Usage : HAIKO_BANDE_URL=http://localhost:7099 node scripts/verif-bande-sous-l-heure.mjs
 * (serveur de développement lancé depuis la copie de travail ; jamais BELUGA_URL).
 * Une session d'une heure est fabriquée puis retirée (jeton HACHÉ en base).
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';
import { poserZonesSures } from './lib/zone-sure.mjs';
import { THEMES, couleurDeBandeau, estThemeSombre } from '../shared/dist/themes.js';

const ADRESSE = process.env.HAIKO_BANDE_URL || 'http://localhost:7099';
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';
const HAUT = 59;

async function avecSession(travail) {
  const require = createRequire(import.meta.url);
  const ouvrir = () => require(path.join(DONNEES, '../node_modules/better-sqlite3'))(cheminDeLaBaseServie(DONNEES));
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const db = ouvrir();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3_600_000,
    'vérification de la bande sous l’heure',
  );
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

await avecSession(async (session) => {
  const navigateur = await chromium.launch({ channel: 'chrome' });
  try {
    for (const clarte of ['clair', 'sombre']) {
      const contexte = await navigateur.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      await contexte.addCookies([{ name: 'beluga_session', value: session, domain: new URL(ADRESSE).hostname, path: '/' }]);
      await contexte.addInitScript((c) => {
        try {
          window.localStorage.setItem('beluga-theme-flash', c);
        } catch {
          /* la pose d'après suffit */
        }
      }, clarte);
      const page = await contexte.newPage();
      /* AUCUNE TRACE : ni préférence, ni « lu » envoyés au serveur. */
      await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
        const serveur = ws.connectToServer();
        ws.onMessage((message) => {
          try {
            const lu = JSON.parse(String(message));
            if (['prefs.set', 'card.read', 'project.read', 'annonces.vider'].includes(lu?.cmd?.type ?? lu?.type)) return;
          } catch {
            /* passe tel quel */
          }
          serveur.send(message);
        });
      });
      await poserZonesSures(page, { haut: HAUT, bas: 34 });
      await page.goto(ADRESSE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForSelector('[data-bande-sous-l-heure]', { state: 'attached', timeout: 60_000 });
      /* ON ATTEND UN ÉTAT, PAS UNE DURÉE : les silhouettes de chargement parties. */
      for (let essai = 0; essai < 40; essai += 1) {
        if (await page.evaluate(() => !document.querySelector('.animate-silhouette'))) break;
        await page.waitForTimeout(500);
      }
      /* Reposée une fois l'application montée : le premier affichage réécrit le style de la racine. */
      await poserZonesSures(page, { haut: HAUT, bas: 34 });
      await page.evaluate((c) => {
        const racine = document.documentElement;
        racine.dataset.theme = c;
        racine.classList.toggle('dark', c === 'sombre');
      }, clarte);
      await page.waitForTimeout(400);

      const lu = await page.evaluate(() => {
        const bande = document.querySelector('[data-bande-sous-l-heure]');
        const zone = bande?.closest('[data-zone="centre"]');
        const sombre = document.documentElement.classList.contains('dark');
        const entete = zone?.querySelector('[data-entete-de-zone]');
        const r = bande?.getBoundingClientRect();
        return {
          position: bande ? getComputedStyle(bande).position : null,
          rect: r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null,
          fondBande: bande ? getComputedStyle(bande).backgroundColor : null,
          fondZone: zone ? getComputedStyle(zone).backgroundColor : null,
          largeur: window.innerWidth,
          sombre,
          enteteHaut: entete ? parseFloat(getComputedStyle(entete).paddingTop) : null,
        };
      });
      verifier(lu.sombre === (clarte === 'sombre'), `${clarte} : la clarté voulue est bien posée`);
      verifier(lu.position === 'fixed', `${clarte} : bande fixe (${lu.position})`);
      verifier(
        lu.rect && lu.rect.top === 0 && lu.rect.left === 0 && lu.rect.width === lu.largeur && Math.round(lu.rect.height) === HAUT,
        `${clarte} : bande au bord du haut, pleine largeur, ${HAUT} px (${JSON.stringify(lu.rect)})`,
      );
      verifier(lu.fondBande === lu.fondZone && !/rgba\(.*,\s*0\)/.test(lu.fondBande ?? ''), `${clarte} : couleur de la bande = fond de la zone (${lu.fondBande} / ${lu.fondZone})`);
      verifier(Math.round(lu.enteteHaut ?? -1) === HAUT, `${clarte} : la barre d'en-tête démarre juste sous la zone sûre (${lu.enteteHaut} px)`);

      /* LA FEUILLE DES NOTIFICATIONS. */
      await page.locator('[data-zone="centre"] [data-cloche-notifications], [data-zone="centre"] button[aria-label*="otification"]').first().click();
      const feuille = page.locator('[data-feuille-du-bas]');
      await feuille.waitFor({ timeout: 10_000 });
      /* La feuille monte en glissant : on attend qu'elle soit posée au bas. */
      await page.waitForFunction(() => {
        const r = document.querySelector('[data-feuille-du-bas]')?.getBoundingClientRect();
        return r && Math.abs(window.innerHeight - r.bottom) < 1;
      }, null, { timeout: 5_000 }).catch(() => {});
      const enTete = await page.evaluate(() => {
        const f = document.querySelector('[data-feuille-du-bas]');
        const titre = f?.querySelector('[data-entete-titre]')?.getBoundingClientRect();
        const effacer = f?.querySelector('[data-vider-notifications]')?.getBoundingClientRect();
        const r = f?.getBoundingClientRect();
        return {
          bas: r ? Math.round(window.innerHeight - r.bottom) : null,
          titre: titre ? { centre: titre.left + titre.width / 2, milieu: titre.top + titre.height / 2 } : null,
          effacer: effacer ? { gauche: effacer.left, milieu: effacer.top + effacer.height / 2 } : null,
          largeur: window.innerWidth,
          entete: !!f?.querySelector('[data-entete-notifications]'),
        };
      });
      verifier(enTete.entete && enTete.bas === 0, `${clarte} : la cloche ouvre une feuille du bas avec l'en-tête commun`);
      verifier(enTete.titre && Math.abs(enTete.titre.centre - enTete.largeur / 2) < 2, `${clarte} : titre au centre`);
      if (enTete.effacer) {
        verifier(
          enTete.effacer.gauche > enTete.largeur / 2 && Math.abs(enTete.effacer.milieu - enTete.titre.milieu) < 3,
          `${clarte} : « Tout effacer » à droite, sur la ligne du titre`,
        );
      } else {
        console.log(`· ${clarte} : aucune notification, « Tout effacer » absent (attendu)`);
      }
      /* LA BANDE DU VOILE, une fois le fondu d'ouverture fini. */
      await page.waitForTimeout(300);
      const voile = await page.evaluate(() => {
        const bande = document.querySelector('[data-voile-tiroir] [data-bande-du-voile]');
        const zone = document.querySelector('[data-zone="centre"]');
        const parent = bande?.parentElement;
        const r = bande?.getBoundingClientRect();
        return {
          position: bande ? getComputedStyle(bande).position : null,
          rect: r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null,
          fond: bande ? getComputedStyle(bande).backgroundColor : null,
          teinte: parent ? getComputedStyle(parent).backgroundColor : null,
          dessous: zone ? getComputedStyle(zone).backgroundColor : null,
          largeur: window.innerWidth,
        };
      });
      const rgba = (c) => {
        const m = String(c).match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return [p[0], p[1], p[2], p[3] ?? 1];
      };
      const [t, d, f] = [rgba(voile.teinte), rgba(voile.dessous), rgba(voile.fond)];
      const attendu = t && d ? [0, 1, 2].map((i) => Math.round(t[i] * t[3] + d[i] * (1 - t[3]))) : null;
      verifier(voile.position === 'fixed', `${clarte} : bande du voile fixe (${voile.position})`);
      verifier(
        voile.rect && voile.rect.top === 0 && voile.rect.width === voile.largeur && Math.round(voile.rect.height) === HAUT,
        `${clarte} : bande du voile au bord du haut, pleine largeur, ${HAUT} px (${JSON.stringify(voile.rect)})`,
      );
      verifier(
        f && f[3] === 1 && attendu && attendu.every((v, i) => Math.abs(v - f[i]) <= 1),
        `${clarte} : bande du voile opaque, du mélange voile + zone (${voile.fond} / attendu rgb(${attendu}))`,
      );
      await page.screenshot({ path: `/tmp/bande-sous-l-heure-${clarte}.png` });
      await page.mouse.click(195, 40);
      await feuille.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
      verifier((await feuille.count()) === 0, `${clarte} : un clic sur le voile referme la feuille`);

      if (clarte === 'sombre') {
        /* LA BARRE « DEFAULT » : la balise, la couleur par palette, l'encart nul. */
        const balises = await page.evaluate(() => ({
          barre: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content'),
          vue: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
        }));
        verifier(balises.barre === 'default', `barre d'état demandée : « ${balises.barre} »`);
        verifier(!balises.vue.includes('viewport-fit'), 'plus de viewport-fit=cover : l’application commence sous la barre d’état');
        /* La couleur que l'iPhone lit vraiment se contrôle à part : scripts/verif-barre-de-l-heure.mjs. */
        for (const theme of THEMES) {
          const fond = await page.evaluate(([id, sombre]) => {
            const racine = document.documentElement;
            racine.dataset.theme = id;
            racine.classList.toggle('dark', sombre);
            return getComputedStyle(document.querySelector('[data-zone="centre"]')).backgroundColor;
          }, [theme.id, estThemeSombre(theme.id)]);
          const hex = couleurDeBandeau(theme.id);
          const rvb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
          const lu = rgba(fond);
          verifier(/^#[0-9a-f]{6}$/i.test(hex) && lu && rvb.every((v, i) => Math.abs(v - lu[i]) <= 1), `${theme.id} : la bande de l'heure (${hex}) a le fond de la zone (${fond})`);
        }
        await poserZonesSures(page, { haut: 0, bas: 34 });
        await page.waitForTimeout(200);
        const hauteurBande = await page.evaluate(() => document.querySelector('[data-bande-sous-l-heure]')?.getBoundingClientRect().height);
        verifier(hauteurBande === 0, `encart à 0 : la bande du haut n'a aucune hauteur (${hauteurBande})`);
      }
      await contexte.close();
    }
  } finally {
    await navigateur.close();
  }
});

if (refus.length) {
  console.log(`\n${refus.length} point(s) en échec.`);
  process.exit(1);
}
console.log('\nBande sous l’heure et feuille des notifications : tout est conforme.');
