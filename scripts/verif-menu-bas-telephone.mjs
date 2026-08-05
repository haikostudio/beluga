#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur de téléphone (390×844), du menu de
 * navigation du bas :
 *
 *  - le bloc est DÉTACHÉ des trois bords (marge à gauche, à droite, en bas) ;
 *  - aucun filet horizontal sur toute la largeur au-dessus du menu ;
 *  - les trois icônes sont différentes les unes des autres ;
 *  - les trois libellés tiennent sur UNE ligne, sans coupure ;
 *  - le contenu du tableau s'arrête au-dessus du menu (place réservée) ;
 *  - ni le module de voix ni le bloc en bas à droite ne recouvrent le menu ;
 *  - au-dessus du seuil téléphone, aucun menu du bas.
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

    // La position mémorisée du bloc en bas à droite est commune à tous les
    // appareils : on la neutralise pour juger de sa place NATURELLE.
    await page.addStyleTag({ content: '[data-bloc="dock"] { transform: none !important; }' });
    // Le bloc en bas à droite est vide au repos : sans message court, sa boîte
    // est plate et l'on ne prouverait rien sur le recouvrement.
    await page.evaluate(() => window.haikodevEssai?.message('info', 'Essai — menu du bas'));
    await page.waitForTimeout(500);

    const mesures = await page.evaluate(() => {
      const nav = document.querySelector('nav[data-menu-bas]');
      if (!nav) return null;
      const bloc = nav.firstElementChild;
      const styleNav = getComputedStyle(nav);
      const styleBloc = getComputedStyle(bloc);
      const boutons = [...bloc.querySelectorAll('button')].map((bouton) => {
        const icone = bouton.querySelector('svg');
        return {
          texte: bouton.textContent.trim(),
          icone: icone ? icone.getAttribute('class') || '' : '',
          formes: icone ? icone.innerHTML : '',
          hauteur: bouton.getBoundingClientRect().height,
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
        boutons,
        contenu: cadreDe(document.querySelector('[data-zone="Tableau"], main')),
        voix: cadreDe(document.querySelector('[data-module-voix]')),
        dock: cadreDe(document.querySelector('[data-bloc="dock"]')),
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
    record(
      'aucun filet horizontal au-dessus du menu',
      mesures.filetNav === 0,
      `bordure haute ${mesures.filetNav} px`,
    );

    const icones = mesures.boutons.map((bouton) => bouton.formes);
    record(
      'les trois icônes sont différentes',
      new Set(icones).size === 3,
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

    const chevauche = (a, b) =>
      !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    record(
      'le module de voix ne recouvre pas le menu',
      !chevauche(mesures.voix, bloc),
      mesures.voix ? `voix bas ${Math.round(mesures.voix.bottom)}` : 'module de voix non repéré',
    );
    record(
      'le bloc en bas à droite ne recouvre pas le menu',
      !chevauche(mesures.dock, bloc),
      mesures.dock ? `dock bas ${Math.round(mesures.dock.bottom)}` : 'dock non repéré',
    );

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
