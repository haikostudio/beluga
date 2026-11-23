#!/usr/bin/env node
/**
 * Chaque fondu de bord prend-il la couleur de SON bloc, un cran plus foncée ?
 *
 * L'ombre d'un voile de `ZoneDefilement` (dernier calque de
 * `[data-voile-defilement]`) doit valoir le fond réel du conteneur qui entoure
 * la zone, mêlé d'un peu de noir (`ASSOMBRISSEMENT_FONDU`, 6 %) — en clair
 * comme en sombre. Avant, la bande « Ce que l'agent a vu », posée dans un
 * panneau gris, s'effaçait dans un BLANC venu de la page (#590c).
 *
 * Trois jugements, dans les deux clartés :
 *   1. toutes les zones à voile à l'écran (colonne des projets, colonnes du
 *      tableau, fil d'une carte ouverte) : ombre = fond du conteneur × 0,94 ;
 *   2. un `.panneau` (et un panneau dans un panneau) passe SA teinte au fondu
 *      par `--fond-zone-defilement` — sonde posée dans la page ;
 *   3. si une carte ouverte montre la bande des captures, son fondu est plus
 *      sombre que le panneau qui la porte, jamais blanc ;
 *   4. L'OMBRE S'EFFACE PRÈS DE SES BORDS (décision du 27/10/2026, #0d70) :
 *      chaque ombre porte deux masques composés en intersection, et, rendue
 *      seule à 390 et à 1440 px de large, elle tombe sous 12 % de sa force à
 *      2 px des côtés et reste pleine dès 40 px du bord comme au milieu ;
 *   5. LE FONDU S'ARRÊTE AUX BORDS DU CONTENU (décision du 29/10/2026, #550b,
 *      #3b14b) : chaque voile vertical couvre tout le contenu de sa zone, et
 *      JAMAIS AU-DELÀ (17/11/2026, #def0f) : la marge intérieure vide d'une
 *      colonne (padding, sans fond) n'est pas du contenu ; seul un voile de
 *      toute la largeur de la zone (contenu rangé d'un côté) en est dispensé.
 *
 *   BELUGA_VERIF_URL=http://localhost:7099 node scripts/verif-fondu-couleur-du-conteneur.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

/* Le serveur de DÉVELOPPEMENT : BELUGA_URL désigne l'application publiée. */
const BASE = process.env.BELUGA_VERIF_URL || 'http://localhost:7099';
const ASSOMBRISSEMENT = 0.06;
const TOLERANCE = 0.02;

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
    'vérification de la couleur des fondus',
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
 * Lu DANS la page. Rend, pour chaque voile visible, la couleur de son ombre et
 * celle du premier ancêtre au fond opaque. Les couleurs calculées arrivent en
 * `rgb(…)` ou en `color(srgb …)` (un `color-mix` calculé) : on lit les deux.
 */
function lireLesFondus() {
  const lire = (texte) => {
    const srgb = /color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)/.exec(texte);
    if (srgb) return { c: [+srgb[1], +srgb[2], +srgb[3]], a: srgb[4] === undefined ? 1 : +srgb[4] };
    const rgb = /rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)(?:,? \/? ?([\d.]+))?\)/.exec(texte);
    if (rgb) return { c: [rgb[1] / 255, rgb[2] / 255, rgb[3] / 255], a: rgb[4] === undefined ? 1 : +rgb[4] };
    return null;
  };
  const fondOpaque = (depart) => {
    for (let n = depart; n && n !== document.documentElement; n = n.parentElement) {
      const lu = lire(getComputedStyle(n).backgroundColor);
      if (lu && lu.a > 0.98) return { couleur: lu.c, repere: n.className?.toString().slice(0, 60) || n.tagName };
    }
    return null;
  };
  return Array.from(document.querySelectorAll('[data-voile-defilement]'))
    .filter((v) => {
      const r = v.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })
    .map((v) => {
      const ombre = v.children[v.children.length - 1];
      const brut = getComputedStyle(ombre).backgroundColor;
      const conteneur = fondOpaque(v.parentElement);
      const st = getComputedStyle(ombre);
      return {
        masque: st.maskImage || st.webkitMaskImage || '',
        composition: `${st.maskComposite || ''} ${st.webkitMaskComposite || ''}`,
        voile: v.getAttribute('data-voile-defilement'),
        bande: !!v.closest('[data-captures-bande]'),
        brut,
        ombre: lire(brut)?.c ?? null,
        conteneur: conteneur?.couleur ?? null,
        repere: conteneur?.repere ?? '',
      };
    });
}

/**
 * Une sonde : un panneau, et un panneau dans un panneau, posés dans la zone
 * centrale ; chacun porte un enfant peint comme l'ombre d'un voile (même
 * mélange que `ombreDuFondu`). On rend le fond du panneau et celui de l'enfant.
 */
function sonderLesPanneaux(pourcent) {
  const zone = document.querySelector('[data-zone="centre"]') || document.body;
  const externe = document.createElement('div');
  externe.className = 'panneau';
  const interne = document.createElement('div');
  interne.className = 'panneau';
  externe.appendChild(interne);
  const ombre = (parent) => {
    const n = document.createElement('div');
    n.style.background = `color-mix(in srgb, var(--fond-zone-defilement, hsl(var(--bg))) ${pourcent}%, black)`;
    parent.appendChild(n);
    return n;
  };
  const ombreExterne = ombre(externe);
  const ombreInterne = ombre(interne);
  zone.appendChild(externe);
  const lu = [
    [externe, ombreExterne],
    [interne, ombreInterne],
  ].map(([p, o]) => ({ panneau: getComputedStyle(p).backgroundColor, ombre: getComputedStyle(o).backgroundColor }));
  externe.remove();
  return lu;
}

/**
 * Une copie EXACTE du calque d'ombre d'un voile vertical (styles en ligne,
 * masques compris), posée seule en haut de la page à la largeur demandée —
 * rien d'autre dessous, les pixels ne lisent qu'elle. On juge sa FORME, pas
 * sa teinte (jugée plus haut) : peinte en noir sur blanc, car en sombre un
 * cran de 6 % ne se mesure pas au pixel. Rend le rectangle à photographier.
 */
function poserLaCopieDOmbre(largeur) {
  document.querySelector('[data-copie-ombre]')?.remove();
  const voile = Array.from(document.querySelectorAll('[data-voile-defilement^="vertical-fin"]')).find((v) => v.getBoundingClientRect().width > 0)
    || document.querySelector('[data-voile-defilement^="vertical"]');
  if (!voile) return null;
  const ombre = voile.children[voile.children.length - 1];
  const fond = 'rgb(255, 255, 255)';
  const cadre = document.createElement('div');
  cadre.setAttribute('data-copie-ombre', '');
  cadre.style.cssText = `position:fixed;left:0;top:0;width:${largeur}px;height:45px;z-index:2147483647;background:${fond}`;
  const copie = ombre.cloneNode(false);
  copie.style.background = 'rgb(0, 0, 0)';
  copie.className = '';
  copie.style.position = 'absolute';
  copie.style.inset = '0';
  cadre.appendChild(copie);
  document.body.appendChild(cadre);
  return { largeur, hauteur: 45, sens: voile.getAttribute('data-voile-defilement') };
}

/**
 * La bande de chaque voile vertical face à l'étendue du contenu de SA zone (la
 * réunion des enfants directs qui ont une taille). Rend aussi, pour la page
 * Marketing, la colonne de 820 px.
 */
function lireLesBandes() {
  return Array.from(document.querySelectorAll('[data-voile-defilement^="vertical"]'))
    .map((v) => {
      const enveloppe = v.parentElement;
      const zone = Array.from(enveloppe.children).find((n) => !n.hasAttribute('data-voile-defilement') && !n.hasAttribute('data-barre-defilement'));
      if (!zone) return null;
      const r = v.getBoundingClientRect();
      const rz = zone.getBoundingClientRect();
      if (!r.height || !rz.width || !rz.height) return null;
      let gauche = Infinity;
      let droite = -Infinity;
      for (const enfant of zone.children) {
        const re = enfant.getBoundingClientRect();
        const st = getComputedStyle(enfant);
        if (!re.width || !re.height || st.position === 'absolute' || st.position === 'fixed') continue;
        // Une colonne SANS FOND : sa marge intérieure est vide, le contenu commence après elle.
        const sansFond = enfant.hasAttribute('data-tete-collante') || (/^rgba\(.*,\s*0\)$|^transparent$/.test(st.backgroundColor) && st.backgroundImage === 'none');
        const retraitG = sansFond ? parseFloat(st.paddingLeft) : 0;
        const retraitD = sansFond ? parseFloat(st.paddingRight) : 0;
        gauche = Math.min(gauche, re.left + retraitG);
        droite = Math.max(droite, re.right - retraitD);
      }
      const colonne = zone.matches('[data-strategie-accueil], [data-strategie-contenu]') ? zone.querySelector(':scope > .mx-auto')?.getBoundingClientRect() : null;
      return {
        voile: v.getAttribute('data-voile-defilement'),
        repere: (zone.getAttribute('data-fil') && `fil ${zone.getAttribute('data-fil')}`) || (zone.hasAttribute('data-strategie-accueil') && 'marketing') || zone.className.toString().slice(0, 40),
        bande: [Math.round(r.left), Math.round(r.right)],
        contenu: gauche < droite ? [Math.round(gauche), Math.round(droite)] : null,
        colonne: colonne ? [Math.round(colonne.left), Math.round(colonne.right)] : null,
        zone: [Math.round(rz.left), Math.round(rz.right)],
      };
    })
    .filter(Boolean);
}

/** Le voile couvre-t-il tout le contenu de sa zone, sans en sortir ni sortir de la zone ? */
const couvreLeContenu = (b) =>
  !b.contenu ||
  (b.bande[0] <= b.contenu[0] + 1 &&
    b.bande[1] >= b.contenu[1] - 1 &&
    b.bande[0] >= b.zone[0] - 2 &&
    b.bande[1] <= b.zone[1] + 2 &&
    // …et jamais au-delà du contenu, sauf un voile de toute la zone.
    ((b.bande[0] >= b.contenu[0] - 1 && b.bande[1] <= b.contenu[1] + 1) || (b.bande[0] <= b.zone[0] + 2 && b.bande[1] >= b.zone[1] - 2)));

const lireCouleur = (texte) => {
  const srgb = /color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)/.exec(texte);
  if (srgb) return [+srgb[1], +srgb[2], +srgb[3]];
  const rgb = /rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)/.exec(texte);
  if (rgb) return [rgb[1] / 255, rgb[2] / 255, rgb[3] / 255];
  return null;
};
const luminance = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const enTexte = (c) => (c ? `rgb(${c.map((x) => Math.round(x * 255)).join(' ')})` : '?');
/** L'ombre vaut-elle le fond × (1 − assombrissement), à la tolérance près ? */
const unCranPlusFonce = (ombre, fond) =>
  !!ombre && !!fond && ombre.every((x, i) => Math.abs(x - fond[i] * (1 - ASSOMBRISSEMENT)) <= TOLERANCE);

const { token, empreinte } = jeton();
const navigateur = await chromium.launch({ channel: 'chrome' });
try {
  for (const clarte of ['clair', 'sombre']) {
    console.log(`\n— ${clarte} —`);
    const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
    await contexte.addCookies([
      { name: 'beluga_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
    ]);
    await contexte.addInitScript((c) => {
      try {
        window.localStorage.setItem('beluga-theme-flash', c);
      } catch {
        /* la pose d'après suffit */
      }
    }, clarte);
    const page = await contexte.newPage();
    /* AUCUNE TRACE : préférences, cartes lues et projet affiché ne partent pas au serveur. */
    await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
      const serveur = ws.connectToServer();
      ws.onMessage((message) => {
        try {
          const lu = JSON.parse(String(message));
          if (['prefs.set', 'card.read', 'project.read'].includes(lu?.cmd?.type ?? lu?.type)) return;
        } catch {
          /* un message qui n'est pas du JSON passe tel quel */
        }
        serveur.send(message);
      });
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('[data-zone="centre"]', { timeout: 60_000 });
    for (let essai = 0; essai < 40; essai += 1) {
      if (await page.evaluate(() => !document.querySelector('.animate-silhouette'))) break;
      await page.waitForTimeout(500);
    }
    const appliquer = (c) =>
      page.evaluate((c) => {
        const racine = document.documentElement;
        racine.dataset.theme = c;
        racine.classList.toggle('dark', c === 'sombre');
      }, c);
    await appliquer(clarte);
    await page.waitForTimeout(300);

    /* 1. Les zones de l'écran d'accueil : colonne des projets, colonnes du tableau. */
    const jugerLesFondus = async (ou) => {
      const fondus = await page.evaluate(lireLesFondus);
      const fautifs = fondus.filter((f) => !unCranPlusFonce(f.ombre, f.conteneur));
      noter(
        `${ou} : chaque fondu = son bloc, un cran plus foncé (${fondus.length} voiles)`,
        fondus.length > 0 && fautifs.length === 0,
        fautifs
          .slice(0, 4)
          .map((f) => `${f.voile} ombre ${enTexte(f.ombre)} sur ${enTexte(f.conteneur)} (${f.repere})`)
          .join(' ; '),
      );
      return fondus;
    };
    await jugerLesFondus('accueil');

    /* 2. La sonde des panneaux. */
    const sonde = await page.evaluate(sonderLesPanneaux, Math.round((1 - ASSOMBRISSEMENT) * 100));
    sonde.forEach((s, rang) => {
      const fond = lireCouleur(s.panneau);
      const ombre = lireCouleur(s.ombre);
      noter(
        `${rang ? 'panneau dans un panneau' : 'panneau'} : son fondu suit SA teinte, un cran plus foncé`,
        unCranPlusFonce(ombre, fond),
        `fond ${enTexte(fond)}, ombre ${enTexte(ombre)}`,
      );
    });

    /* 4. L'ombre s'efface près de ses bords, et seulement là. */
    {
      const fondus = await page.evaluate(lireLesFondus);
      const sansBords = fondus.filter(
        (f) => (f.masque.match(/linear-gradient/g) ?? []).length < 2 || !/intersect|source-in/.test(f.composition),
      );
      noter(
        `chaque ombre s'efface sur ses côtés : deux masques en intersection (${fondus.length} voiles)`,
        fondus.length > 0 && sansBords.length === 0,
        sansBords.slice(0, 3).map((f) => `${f.voile} « ${f.masque.slice(0, 60)}… » ${f.composition}`).join(' ; '),
      );
      for (const largeur of [390, 1440]) {
        const pose = await page.evaluate(poserLaCopieDOmbre, largeur);
        if (!pose) {
          noter(`ombre rendue à ${largeur} px : un voile vertical à copier`, false);
          continue;
        }
        const image = sharp(await page.screenshot({ clip: { x: 0, y: 0, width: largeur, height: 45 }, scale: 'css' }));
        const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
        /* La ligne la plus sombre de l'ombre : contre le bord de la zone. */
        const y = pose.sens.endsWith('fin') ? info.height - 2 : 1;
        const px = (x) => {
          const i = (y * info.width + x) * info.channels;
          return [data[i], data[i + 1], data[i + 2]];
        };
        const fondNu = await page.evaluate(() => getComputedStyle(document.querySelector('[data-copie-ombre]')).backgroundColor);
        const fond = lireCouleur(fondNu).map((x) => x * 255);
        const ecart = (c) => Math.max(...c.map((x, i) => Math.abs(x - fond[i])));
        const bordG = px(2);
        const bordD = px(info.width - 3);
        const pres = px(40);
        const milieu = px(Math.floor(info.width / 2));
        noter(
          `ombre rendue à ${largeur} px : presque éteinte à 2 px des côtés`,
          ecart(milieu) > 0 && ecart(bordG) / ecart(milieu) <= 0.12 && ecart(bordD) / ecart(milieu) <= 0.12,
          `fond ${fond.map(Math.round)}, gauche ${bordG}, droite ${bordD}`,
        );
        noter(
          `ombre rendue à ${largeur} px : pleine dès 40 px du bord, comme au milieu`,
          ecart(milieu) >= 200 && Math.abs(ecart(pres) - ecart(milieu)) <= 2,
          `40 px ${pres}, milieu ${milieu}`,
        );
        await page.evaluate(() => document.querySelector('[data-copie-ombre]')?.remove());
      }
    }

    /* 5. La bande du voile suit le contenu : partout il le couvre. (L'ancienne page Marketing, où il s'arrêtait à sa
       colonne, est retirée le 11/11/2026.) */
    {
      const bandes = await page.evaluate(lireLesBandes);
      const fautives = bandes.filter((b) => !couvreLeContenu(b));
      noter(`accueil : chaque voile couvre tout le contenu de sa zone (${bandes.length} voiles)`, bandes.length > 0 && !fautives.length, fautives.slice(0, 3).map((b) => `${b.repere} ${b.voile} ${b.bande} / ${b.contenu}`).join(' ; '));
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(() => {
        window.location.hash = '';
      });
      await page.waitForTimeout(800);
    }

    /* 3. Une carte ouverte : le fil, et la bande des captures s'il y en a une. */
    const carte = page.locator('[data-carte]').first();
    if (await carte.count()) {
      await carte.click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(2500);
      await appliquer(clarte);
      await page.waitForTimeout(300);
      const fondus = await jugerLesFondus('carte ouverte');
      const bande = fondus.filter((f) => f.bande);
      if (bande.length) {
        noter(
          'bande des captures : fondu plus sombre que son panneau, jamais blanc',
          bande.every((f) => f.ombre && f.conteneur && luminance(f.ombre) < luminance(f.conteneur) && luminance(f.ombre) < 0.97),
          bande.map((f) => `${enTexte(f.ombre)} sur ${enTexte(f.conteneur)}`).join(' ; '),
        );
      } else {
        console.log('  (aucune bande des captures sur la première carte : la sonde des panneaux en tient lieu)');
      }
    }
    await contexte.close();
  }
} finally {
  await navigateur.close();
  retirer(empreinte);
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles réussis`);
process.exit(echecs ? 1 : 0);
