#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur de téléphone (390×844, tactile), du menu
 * de navigation du bas :
 *
 *  - le bloc est DÉTACHÉ des trois bords (marge à gauche, à droite, en bas) ;
 *  - aucun filet horizontal sur toute la largeur au-dessus du menu ;
 *  - le menu montre TROIS boutons : « Tableau », le rond du centre (nouvel
 *    agent), « Fichiers » ; les deux libellés tiennent sur une ligne et leurs
 *    icônes diffèrent ;
 *  - LA BARRE RESPIRE AUTANT EN HAUT ET EN BAS QU'À GAUCHE ET À DROITE : les
 *    blancs mesurés sur ses quatre côtés sont égaux à un pixel près, et les
 *    trois boutons ont la même hauteur ;
 *  - LE ROND DU CENTRE EST PLUS FONCÉ QUE LA BARRE, sinon on ne le voit pas ;
 *  - la barre se DISTINGUE de la bande qui la porte (fonds différents), la bande
 *    reprenant elle le fond de la zone affichée au-dessus ;
 *  - le contenu du tableau s'arrête au-dessus du menu (place réservée) ;
 *  - au-dessus du seuil téléphone, aucun menu du bas.
 *
 * Le module de voix ne vit PLUS dans ce menu (ses réglages sont passés dans
 * Réglages › Voix) : la place du centre revient au bouton « nouvel agent ».
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
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          fond: getComputedStyle(bouton).backgroundColor,
          rond: parseFloat(getComputedStyle(bouton).borderTopLeftRadius) >= 999,
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
    // LE FOND DE LA BANDE PROLONGE CELUI DU CONTENU. La bande qui porte le menu
    // reprend la teinte de la zone affichée au-dessus : plus de bande `--bg`
    // noire sous un tableau gris.
    record(
      'le fond du menu reprend celui du contenu au-dessus',
      !!mesures.fondContenu && mesures.fondNav === mesures.fondContenu,
      `menu ${mesures.fondNav} / contenu ${mesures.fondContenu}`,
    );
    // …ET LA BARRE, ELLE, SE VOIT : c'est le bloc intérieur (`--surface`) qui
    // dessine le menu. Même teinte que la bande, il disparaîtrait.
    record(
      'la barre se distingue de la bande qui la porte',
      mesures.fondBloc !== mesures.fondNav,
      `barre ${mesures.fondBloc} / bande ${mesures.fondNav}`,
    );

    record(
      'aucun filet horizontal au-dessus du menu',
      mesures.filetNav === 0,
      `bordure haute ${mesures.filetNav} px`,
    );

    record(
      'le menu montre trois boutons : Tableau, le rond du centre, Fichiers',
      mesures.boutons.length === 3,
      mesures.boutons.map((bouton) => bouton.texte || '(rond)').join(' / ') || 'aucun',
    );
    const nommes = mesures.boutons.filter((bouton) => bouton.texte);
    const icones = nommes.map((bouton) => bouton.formes);
    record(
      'les deux icônes de destination sont différentes',
      new Set(icones).size === nommes.length && nommes.length === 2,
      nommes.map((bouton) => bouton.texte).join(' / '),
    );
    for (const bouton of nommes) {
      record(
        `le libellé « ${bouton.texte} » tient sur une ligne`,
        !bouton.debordement && bouton.hauteur <= 40,
        `hauteur ${Math.round(bouton.hauteur)} px${bouton.debordement ? ', déborde' : ''}`,
      );
    }

    /*
     * LA BARRE RESPIRE PAREIL SUR SES QUATRE CÔTÉS. La hauteur du menu était
     * dictée par le rond du centre, bien plus grand que les deux boutons : il
     * restait 12 px de blanc en haut et en bas contre 4 px sur les côtés. Les
     * trois boutons partagent maintenant la même hauteur, et les blancs mesurés
     * sur les quatre côtés du bloc se valent.
     */
    const hauts = mesures.boutons.map((bouton) => bouton.top - bloc.top);
    const bas = mesures.boutons.map((bouton) => bloc.bottom - bouton.bottom);
    const gaucheBloc = mesures.boutons[0] ? mesures.boutons[0].left - bloc.left : NaN;
    const droiteBloc = mesures.boutons.length
      ? bloc.right - mesures.boutons[mesures.boutons.length - 1].right
      : NaN;
    const cotes = [...hauts, ...bas, gaucheBloc, droiteBloc];
    const ecartCotes = Math.max(...cotes) - Math.min(...cotes);
    record(
      'la barre respire autant en haut et en bas qu\u2019à gauche et à droite',
      Number.isFinite(ecartCotes) && ecartCotes <= 1,
      `haut ${hauts.map((v) => Math.round(v)).join('/')} px, bas ${bas
        .map((v) => Math.round(v))
        .join('/')} px, gauche ${Math.round(gaucheBloc)} px, droite ${Math.round(droiteBloc)} px`,
    );
    const hauteurs = mesures.boutons.map((bouton) => Math.round(bouton.hauteur));
    record(
      'les trois boutons ont la même hauteur',
      new Set(hauteurs).size === 1,
      `${hauteurs.join(' / ')} px`,
    );

    /*
     * LE ROND DU CENTRE EST PLUS FONCÉ QUE LA BARRE. Il portait exactement le
     * fond de la barre : le rond ne se voyait pas. On le juge sur la LUMINOSITÉ
     * réellement peinte — le fond du rond est translucide, on le recompose donc
     * sur celui de la barre — pour que le contrôle tienne dans les douze
     * palettes, claires comprises.
     */
    const rond = mesures.boutons.find((bouton) => bouton.rond && !bouton.texte);
    record('le bouton du centre est un rond', !!rond, rond ? '' : 'rond introuvable');
    if (rond) {
      const lire = (couleur) => {
        const n = (couleur || '').match(/[\d.]+/g);
        if (!n || n.length < 3) return null;
        return { r: +n[0], v: +n[1], b: +n[2], a: n.length > 3 ? +n[3] : 1 };
      };
      const fondBarre = lire(mesures.fondBloc);
      const dessus = lire(rond.fond);
      const clarte = (c) => 0.2126 * c.r + 0.7152 * c.v + 0.0722 * c.b;
      const pose =
        fondBarre && dessus
          ? {
              r: dessus.r * dessus.a + fondBarre.r * (1 - dessus.a),
              v: dessus.v * dessus.a + fondBarre.v * (1 - dessus.a),
              b: dessus.b * dessus.a + fondBarre.b * (1 - dessus.a),
            }
          : null;
      record(
        'le rond du centre est plus foncé que la barre',
        !!pose && !!fondBarre && clarte(pose) < clarte(fondBarre) - 2,
        pose && fondBarre
          ? `rond ${clarte(pose).toFixed(1)} / barre ${clarte(fondBarre).toFixed(1)}`
          : `rond ${rond.fond} / barre ${mesures.fondBloc}`,
      );
    }

    record(
      'le contenu s’arrête au-dessus du menu',
      mesures.contenu !== null && mesures.contenu.bottom <= mesures.nav.top + 1,
      mesures.contenu ? `contenu ${Math.round(mesures.contenu.bottom)} / menu ${Math.round(mesures.nav.top)}` : 'contenu introuvable',
    );

    // LE ROND DU CENTRE RESTE DANS LA BARRE, entre les deux destinations : il ne
    // les recouvre pas, elles restent cliquables.
    if (rond) {
      const gaucheBouton = mesures.boutons[0];
      const droiteBouton = mesures.boutons[2];
      record(
        'le rond du centre ne recouvre pas les deux destinations',
        !!gaucheBouton &&
          !!droiteBouton &&
          rond.left >= gaucheBouton.right &&
          rond.right <= droiteBouton.left,
        gaucheBouton && droiteBouton
          ? `rond ${Math.round(rond.left)}\u2013${Math.round(rond.right)}, boutons \u2264${Math.round(
              gaucheBouton.right,
            )} et \u2265${Math.round(droiteBouton.left)}`
          : 'boutons introuvables',
      );
      const centreRond = (rond.left + rond.right) / 2;
      record(
        'le rond du centre est centré sur l\u2019écran',
        Math.abs(centreRond - ecran.largeur / 2) <= 2,
        `centre rond ${Math.round(centreRond)} / écran ${Math.round(ecran.largeur / 2)}`,
      );
    }

    // Au-dessus du seuil téléphone : plus aucun menu du bas.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(600);
    record('aucun menu du bas sur ordinateur', !(await menu.isVisible()));
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
