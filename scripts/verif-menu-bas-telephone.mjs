#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur de téléphone (390×844, tactile), du menu
 * de navigation du bas :
 *
 *  - le bloc est DÉTACHÉ des trois bords (marge à gauche, à droite, en bas) ;
 *  - aucun filet horizontal sur toute la largeur au-dessus du menu ;
 *  - le menu ne montre plus que DEUX boutons (« Tableau », « Chef »), la colonne
 *    du milieu étant laissée au module de voix ; leurs deux icônes diffèrent et
 *    leurs libellés tiennent sur une ligne ;
 *  - le module de voix se pose AU CENTRE du menu, centré horizontalement, et
 *    déborde un peu en haut et en bas de la barre ;
 *  - le rond ne recouvre pas les deux boutons (ils restent cliquables), et un
 *    appui déplie le panneau ;
 *  - le contenu du tableau s'arrête au-dessus du menu (place réservée) ;
 *  - au-dessus du seuil téléphone, aucun menu du bas, et le module redevient
 *    flottant (déplaçable, poignée présente).
 *
 * Rien n'est écrit dans la base à part la session d'essai, retirée en partant.
 *
 *   HAIKO_MENU_URL=http://localhost:7099 node scripts/verif-menu-bas-telephone.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_MENU_URL || 'http://localhost:7099';
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';
const PRINCIPAL = path.resolve(DONNEES, '..');

function ouvrirBase() {
  const require = createRequire(import.meta.url);
  return require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(
    path.join(DONNEES, 'haikodev.db'),
  );
}

function poserSession() {
  const db = ouvrirBase();
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification menu du bas',
  );
  db.close();
  return cookie;
}

function retirerSession(cookie) {
  const db = ouvrirBase();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
  );
  db.close();
}

const resultats = [];
function record(nom, ok, detail = '') {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  const cookie = poserSession();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    // Un vrai téléphone : tactile et pointeur GROSSIER, pour que `useSurvol` soit
    // faux et que l'ouverture du module se fasse bien à l'APPUI (et non au survol).
    hasTouch: true,
    isMobile: true,
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([
    {
      name: 'haikodev_session',
      value: cookie,
      url: new URL(BASE).origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const page = await context.newPage();
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    page.setDefaultTimeout(8000);

    const menu = page.locator('nav[data-menu-bas]');
    record('le menu du bas est là sur téléphone', await menu.isVisible());

    const mesures = await page.evaluate(() => {
      const nav = document.querySelector('nav[data-menu-bas]');
      if (!nav) return null;
      const bloc = nav.firstElementChild;
      const styleNav = getComputedStyle(nav);
      const styleBloc = getComputedStyle(bloc);
      const boutons = [...bloc.querySelectorAll('button')].map((bouton) => {
        const icone = bouton.querySelector('svg');
        const r = bouton.getBoundingClientRect();
        return {
          texte: bouton.textContent.trim(),
          icone: icone ? icone.getAttribute('class') || '' : '',
          formes: icone ? icone.innerHTML : '',
          hauteur: r.height,
          left: r.left,
          right: r.right,
          debordement: bouton.scrollWidth > bouton.clientWidth + 1,
          lignes: bouton.getClientRects().length,
        };
      });
      const cadreDe = (element) => {
        if (!element) return null;
        const { left, right, top, bottom } = element.getBoundingClientRect();
        return { left, right, top, bottom };
      };
      return {
        nav: cadreDe(nav),
        bloc: cadreDe(bloc),
        rayon: parseFloat(styleBloc.borderTopLeftRadius),
        ombre: styleBloc.boxShadow,
        filetNav: parseFloat(styleNav.borderTopWidth) || 0,
        fondNav: styleNav.backgroundColor,
        fondBloc: styleBloc.backgroundColor,
        fondContenu: (() => {
          // L'écran affiché sur téléphone : le tableau (`main`) ou la
          // conversation (`aside`) — l'autre est replié, hauteur nulle.
          const zone = [...document.querySelectorAll('main[data-zone], aside[data-zone]')].find(
            (element) => element.getBoundingClientRect().height > 0,
          );
          return zone ? getComputedStyle(zone).backgroundColor : null;
        })(),
        boutons,
        contenu: cadreDe(document.querySelector('[data-zone="Tableau"], main')),
        voix: cadreDe(document.querySelector('[data-module-voix]')),
        ecran: { largeur: window.innerWidth, hauteur: window.innerHeight },
      };
    });

    if (!mesures) throw new Error('menu du bas introuvable');

    const { bloc, ecran } = mesures;
    record(
      'le bloc est détaché des bords gauche et droit',
      bloc.left >= 6 && ecran.largeur - bloc.right >= 6,
      `gauche ${Math.round(bloc.left)} px, droite ${Math.round(ecran.largeur - bloc.right)} px`,
    );
    record(
      'le bloc est détaché du bord du bas',
      ecran.hauteur - bloc.bottom >= 4,
      `${Math.round(ecran.hauteur - bloc.bottom)} px`,
    );
    record('les coins du bloc sont arrondis', mesures.rayon >= 8, `${mesures.rayon} px`);
    record('le bloc porte une ombre', mesures.ombre !== 'none', mesures.ombre);
    // LE FOND DU MENU PROLONGE CELUI DU CONTENU. La bande du menu ET la barre
    // elle-même reprennent la teinte de la zone affichée au-dessus : plus de
    // bande `--bg` noire sous un tableau gris.
    record(
      'le fond du menu reprend celui du contenu au-dessus',
      !!mesures.fondContenu && mesures.fondNav === mesures.fondContenu,
      `menu ${mesures.fondNav} / contenu ${mesures.fondContenu}`,
    );
    record(
      'la barre du menu a le même fond que la bande qui la porte',
      mesures.fondBloc === mesures.fondNav,
      `barre ${mesures.fondBloc} / bande ${mesures.fondNav}`,
    );

    record(
      'aucun filet horizontal au-dessus du menu',
      mesures.filetNav === 0,
      `bordure haute ${mesures.filetNav} px`,
    );

    record(
      'le menu ne montre plus que deux boutons',
      mesures.boutons.length === 2,
      mesures.boutons.map((bouton) => bouton.texte).join(' / ') || 'aucun',
    );
    const icones = mesures.boutons.map((bouton) => bouton.formes);
    record(
      'les deux icônes sont différentes',
      new Set(icones).size === mesures.boutons.length && mesures.boutons.length === 2,
      mesures.boutons.map((bouton) => bouton.texte).join(' / '),
    );
    for (const bouton of mesures.boutons) {
      record(
        `le libellé « ${bouton.texte} » tient sur une ligne`,
        !bouton.debordement && bouton.hauteur <= 40,
        `hauteur ${Math.round(bouton.hauteur)} px${bouton.debordement ? ', déborde' : ''}`,
      );
    }

    record(
      'le contenu s’arrête au-dessus du menu',
      mesures.contenu !== null && mesures.contenu.bottom <= mesures.nav.top + 1,
      mesures.contenu ? `contenu ${Math.round(mesures.contenu.bottom)} / menu ${Math.round(mesures.nav.top)}` : 'contenu introuvable',
    );

    // LE MODULE DE VOIX AU CENTRE DU MENU. Il se pose sur la barre, centré, et
    // déborde un peu en haut comme en bas — un bouton d'action, pas une pièce du
    // menu. Il ne recouvre pas les deux boutons : ils restent cliquables.
    const voix = mesures.voix;
    record('le module de voix est repéré', !!voix && !!voix.top, voix ? '' : 'non repéré');
    if (voix) {
      const centreVoix = (voix.left + voix.right) / 2;
      const centreEcran = ecran.largeur / 2;
      record(
        'le module de voix est centré horizontalement',
        Math.abs(centreVoix - centreEcran) <= 2,
        `centre voix ${Math.round(centreVoix)} / écran ${Math.round(centreEcran)}`,
      );
      const centreVoixY = (voix.top + voix.bottom) / 2;
      const centreBloc = (bloc.top + bloc.bottom) / 2;
      record(
        'le rond est centré sur la barre du menu',
        Math.abs(centreVoixY - centreBloc) <= 3,
        `centre voix ${Math.round(centreVoixY)} / barre ${Math.round(centreBloc)}`,
      );
      record(
        'le rond déborde en haut et en bas de la barre',
        voix.top < bloc.top - 1 && voix.bottom > bloc.bottom + 1,
        `voix ${Math.round(voix.top)}–${Math.round(voix.bottom)} / barre ${Math.round(bloc.top)}–${Math.round(bloc.bottom)}`,
      );
      const gauche = mesures.boutons[0];
      const droite = mesures.boutons[1];
      record(
        'le rond ne recouvre pas les deux boutons',
        !!gauche && !!droite && voix.left > gauche.right && voix.right < droite.left,
        gauche && droite
          ? `rond ${Math.round(voix.left)}–${Math.round(voix.right)}, boutons ≤${Math.round(gauche.right)} et ≥${Math.round(droite.left)}`
          : 'boutons introuvables',
      );
    }

    // Un appui déplie le panneau du module (le module n'est pas déplaçable ici :
    // l'appui sert donc bien à ouvrir).
    const module = page.locator('[data-module-voix]');
    await module.tap();
    await page.waitForTimeout(500);
    record(
      'un appui déplie le module de voix',
      (await module.getAttribute('data-ouvert')) !== null,
      `data-ancre-menu ${(await module.getAttribute('data-ancre-menu')) !== null ? 'oui' : 'non'}`,
    );
    // On referme pour ne pas fausser la mesure de recadrage au changement d'écran.
    await page.tap('body', { position: { x: 10, y: 200 } });
    await page.waitForTimeout(400);

    // Au-dessus du seuil téléphone : plus aucun menu du bas, et le module de voix
    // redevient flottant et déplaçable (la poignée revient à la souris).
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(600);
    record('aucun menu du bas sur ordinateur', !(await menu.isVisible()));
    record(
      'le module de voix n’est plus ancré au menu sur ordinateur',
      (await module.getAttribute('data-ancre-menu')) === null,
    );
  } finally {
    await browser.close();
    retirerSession(cookie);
  }

  const echecs = resultats.filter((resultat) => !resultat.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  if (echecs.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
