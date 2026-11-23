#!/usr/bin/env node
/**
 * LES FRISES D'ÉTAPES OCCUPENT TOUTE LA LARGEUR.
 *
 * - Page d'une carte (`BarreDEtapes`, `web/src/components/barre-etapes.tsx`) :
 *   une rangée de ronds, leur nom À CÔTÉ, reliés par un trait. Le premier rond
 *   tombe sur le bord gauche de la conversation, la dernière étape sur son bord
 *   droit ; aucun nom écrit ne recouvre le rond suivant. Sur ordinateur, les
 *   étapes ont des largeurs égales : les cinq ronds sont à pas réguliers. Sur
 *   téléphone (360 px), seul le nom de l'étape mise en avant s'écrit, chaque
 *   étape prend la place de son contenu et les traits se partagent le reste.
 * - Cartes de « Tableaux de bord » (`FriseDeSuivi`) : premier et dernier rond
 *   sur les bords du contenu de la carte.
 *
 * RETIRÉ AVEC L'ANCIEN DESSIN (refonte du 11/10/2026) : la barre n'est plus
 * « cinq icônes, leur nom DESSOUS, à 0 / 25 / 50 / 75 / 100 % », et la carte
 * s'ouvre en PAGE, sans rangée d'onglets au-dessus de la conversation (ses
 * onglets sont passés dans la colonne de gauche). Trois assertions sont donc
 * parties : « les ronds du milieu à 25 / 50 / 75 % » sur téléphone (gardée sur
 * ordinateur sous la forme « pas réguliers »), « Demande s'aligne à gauche
 * SOUS son rond » et « Archivée s'aligne à droite SOUS son rond » (remplacées
 * par « chaque nom écrit suit son rond » et par le bord droit de la dernière
 * étape). Le repère des bords n'est plus `[data-barre-onglets]` mais la boîte
 * de contenu du conteneur de la barre — la même marge que le champ d'écriture.
 *
 * Tolérance : 2 px. Rien n'est écrit en base hormis la session d'essai, retirée.
 *
 *   HAIKO_FRISE_URL=http://localhost:7099 node scripts/verif-frise-pleine-largeur.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const BASE = process.env.HAIKO_FRISE_URL || 'http://localhost:7099';
const TOLERANCE = 2;

function ouvrirBase() {
  return new Database(cheminDeLaBaseServie());
}

const hacher = (cookie) => crypto.createHash('sha256').update(cookie).digest('hex');

function poserSession() {
  const db = ouvrirBase();
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    hacher(cookie),
    maintenant,
    maintenant + 3600_000,
    'vérification frise pleine largeur',
  );
  db.close();
  return cookie;
}

function retirerSession(cookie) {
  const db = ouvrirBase();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(hacher(cookie));
  db.close();
}

const resultats = [];
function record(nom, ok, detail = '') {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}
const proche = (a, b) => Math.abs(a - b) <= TOLERANCE;

async function essayer(browser, cookie, nom, viewport) {
  const context = await browser.newContext({
    viewport,
    hasTouch: viewport.width < 640,
    isMobile: viewport.width < 640,
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'beluga_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  try {
    await page.goto(`${BASE}/#/en-route`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('[data-frise-suivi]').first().waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(800);
    for (let essai = 0; essai < 3 && (await page.locator('[role="dialog"][data-state="open"]').count()); essai++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
    }

    // --- La frise d'une carte de « Tableaux de bord » ---
    const carte = await page.evaluate(() => {
      const frise = document.querySelector('[data-frise-suivi]');
      const ronds = [...frise.querySelectorAll('[data-etape-suivi]')].map((r) => r.getBoundingClientRect());
      const f = frise.getBoundingClientRect();
      // Le contenu de la carte : le parent de la frise, moins son padding.
      const parent = frise.parentElement;
      const style = getComputedStyle(parent);
      const p = parent.getBoundingClientRect();
      return {
        gauche: ronds[0].left,
        droite: ronds[ronds.length - 1].right,
        friseGauche: f.left,
        friseDroite: f.right,
        contenuGauche: p.left + parseFloat(style.paddingLeft),
        contenuDroite: p.right - parseFloat(style.paddingRight),
      };
    });
    record(
      `${nom} : tableaux de bord, le premier rond touche le bord gauche du contenu`,
      proche(carte.gauche, carte.contenuGauche),
      `${carte.gauche.toFixed(1)} / ${carte.contenuGauche.toFixed(1)}`,
    );
    record(
      `${nom} : tableaux de bord, le dernier rond touche le bord droit du contenu`,
      proche(carte.droite, carte.contenuDroite),
      `${carte.droite.toFixed(1)} / ${carte.contenuDroite.toFixed(1)}`,
    );

    // --- La barre de la page d'une carte ---
    // Une page déjà rouverte par l'application (dernière carte vue) sert telle quelle.
    const dejaOuverte = await page.locator('[data-barre-etapes]').first().isVisible().catch(() => false);
    if (!dejaOuverte) {
      // Une carte déjà avancée : une carte neuve montre sa configuration à la place de la barre.
      await page.locator('[data-frise-suivi]:not([data-frise-courante="demande"])').first().click();
    }
    await page
      .locator('[data-barre-etapes]')
      .first()
      .waitFor({ state: 'visible', timeout: 20000 })
      .catch(async (e) => {
        await page.screenshot({ path: `/tmp/frise-${viewport.width}.png` });
        throw e;
      });
    await page.waitForTimeout(800);
    const barre = await page.evaluate(() => {
      const barre = [...document.querySelectorAll('[data-barre-etapes]')].find((b) => b.getBoundingClientRect().width > 0);
      /* LA LARGEUR À OCCUPER : la boîte de contenu du conteneur de la barre —
         la marge de la conversation, celle du champ d'écriture. (La rangée
         d'onglets qui servait de repère n'existe plus.) */
      const conteneur = barre.parentElement;
      const style = getComputedStyle(conteneur);
      const c = conteneur.getBoundingClientRect();
      const segments = [...barre.querySelectorAll('[data-segment]')];
      return {
        contenuGauche: c.left + parseFloat(style.paddingLeft),
        contenuDroite: c.right - parseFloat(style.paddingRight),
        attributs: segments.every((s) => s.hasAttribute('data-segment-etat')),
        etapes: segments.map((s) => {
          /* Le bouton d'une étape : son rond, puis son nom (caché sur téléphone
             quand l'étape n'est pas mise en avant). */
          const rond = s.firstElementChild.getBoundingClientRect();
          const nom = s.lastElementChild;
          const ecrit = getComputedStyle(nom).display !== 'none' && nom.getBoundingClientRect().width > 0;
          let texte = null;
          if (ecrit) {
            const plage = document.createRange();
            plage.selectNodeContents(nom);
            const r = plage.getBoundingClientRect();
            const boite = nom.getBoundingClientRect();
            /* Un nom tronqué s'arrête à sa boîte ; un nom qui déborde, à son texte réel. */
            texte =
              getComputedStyle(nom).textOverflow === 'ellipsis' && getComputedStyle(nom).overflowX !== 'visible'
                ? { gauche: Math.max(r.left, boite.left), droite: Math.min(r.right, boite.right) }
                : { gauche: r.left, droite: r.right };
          }
          return {
            etape: s.getAttribute('data-segment'),
            rondGauche: rond.left,
            rondDroite: rond.right,
            rondLargeur: rond.width,
            fin: s.getBoundingClientRect().right,
            texte,
          };
        }),
      };
    });
    const n = barre.etapes.length;
    record(`${nom} : page d'une carte, cinq étapes et leurs repères gardés`, n === 5 && barre.attributs, `${n}`);
    record(
      `${nom} : page d'une carte, « Demande » : rond sur le bord gauche de la conversation`,
      proche(barre.etapes[0].rondGauche, barre.contenuGauche) && barre.etapes[0].rondLargeur > 0,
      `${barre.etapes[0].rondGauche.toFixed(1)} / ${barre.contenuGauche.toFixed(1)}`,
    );
    /* La dernière étape finit sur le bord droit : son nom quand il s'écrit
       (ordinateur, ou étape mise en avant), son rond sinon. */
    const fin = Math.max(barre.etapes[n - 1].fin, barre.etapes[n - 1].texte?.droite ?? 0);
    record(
      `${nom} : page d'une carte, « Archivée » : la dernière étape touche le bord droit de la conversation`,
      proche(fin, barre.contenuDroite),
      `${fin.toFixed(1)} / ${barre.contenuDroite.toFixed(1)}`,
    );
    if (viewport.width >= 640) {
      /* SUR ORDINATEUR, DES ÉTAPES DE LARGEURS ÉGALES : les cinq ronds sont à pas
         réguliers (l'ancien « 25 / 50 / 75 % », le nom de la dernière en moins). */
      const debut = barre.etapes[0].rondGauche;
      const pas = (barre.etapes[n - 1].rondGauche - debut) / (n - 1);
      const ecarts = barre.etapes.map((e, i) => Math.abs(e.rondGauche - (debut + pas * i)));
      record(
        `${nom} : page d'une carte, les cinq ronds à pas réguliers`,
        pas > 0 && ecarts.every((e) => e <= TOLERANCE + 2),
        `pas de ${pas.toFixed(1)} px, écarts ${ecarts.map((e) => e.toFixed(1)).join(' / ')}`,
      );
    }
    const ecrits = barre.etapes.filter((e) => e.texte);
    record(
      `${nom} : page d'une carte, chaque nom écrit suit son rond`,
      ecrits.length >= 1 && ecrits.every((e) => e.texte.gauche >= e.rondDroite - 0.5),
      ecrits.map((e) => `${e.etape} : rond jusqu'à ${e.rondDroite.toFixed(0)}, nom dès ${e.texte.gauche.toFixed(0)}`).join(' · '),
    );
    // Les noms ne chevauchent rien : chacun finit avant le rond de l'étape suivante.
    const chevauchements = barre.etapes.filter(
      (e, i) => e.texte && i < n - 1 && e.texte.droite > barre.etapes[i + 1].rondGauche + 0.5,
    );
    record(
      `${nom} : page d'une carte, aucun nom ne chevauche l'étape suivante`,
      chevauchements.length === 0,
      barre.etapes
        .map((e) => (e.texte ? `${e.rondGauche.toFixed(0)}–${e.texte.droite.toFixed(0)}` : `${e.rondGauche.toFixed(0)}–${e.rondDroite.toFixed(0)}`))
        .join(' · '),
    );
    await page.screenshot({ path: `/tmp/frise-ok-${viewport.width}.png`, clip: { x: 0, y: 0, width: viewport.width, height: 260 } });

    /* ON REFERME CE QU'ON A OUVERT : la carte ouverte est retenue côté serveur,
       et sa page se rouvrirait dans la fenêtre suivante. */
    if (!dejaOuverte) {
      await page.keyboard.press('Escape');
      await page.locator('[data-page-carte]').first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
    }
  } finally {
    await context.close();
  }
}

async function main() {
  const cookie = poserSession();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  try {
    await essayer(browser, cookie, 'ordinateur', { width: 1440, height: 900 });
    await essayer(browser, cookie, 'téléphone 360', { width: 360, height: 780 });
  } finally {
    await browser.close();
    retirerSession(cookie);
  }
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  if (echecs.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
