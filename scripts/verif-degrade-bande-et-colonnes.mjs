#!/usr/bin/env node
/**
 * LA BANDE D'ÉTAT ET LE CADRE DES COLONNES S'ÉTEIGNENT VERS LE BAS,
 * vérifié dans un VRAI navigateur, sur les DOUZE palettes.
 *
 *  - la bande d'état sous le bandeau du haut ne pose plus un aplat : son fond
 *    est un dégradé vertical qui tombe à 0 % d'opacité en bas, dans sa PROPRE
 *    teinte (`to-<jeton>/0`) et jamais vers `transparent` ;
 *  - son bouton « Reconnecter » garde un fond à lui : il ne s'appuie plus sur
 *    un fond qui n'existe plus à sa hauteur ;
 *  - le cadre d'une colonne du tableau se dessine en DEUX morceaux : le trait
 *    du HAUT reste sur `[data-column]` avec sa PLEINE couleur (c'est lui qui
 *    porte l'avancement, en gris depuis DEC-534), les trois autres
 *    côtés sont laissés transparents et peints par un calque
 *    `[data-cadre-colonne]` masqué par un dégradé ;
 *  - ce calque épouse l'arrondi de la colonne à un pixel près et n'attrape
 *    aucun clic, sans quoi le glisser-déposé ne trouverait plus sa colonne ;
 *  - PENDANT UN DÉPÔT, la colonne visée reprend son tour COMPLET : un contraste
 *    qui porte une information ne s'efface pas au nom de l'esthétique.
 *
 * Rien n'est écrit dans la base à part la session d'essai, retirée en partant,
 * et la carte tirée est relâchée à SON POINT DE DÉPART : aucune ne change de
 * colonne. Les captures vont dans /tmp.
 *
 *   HAIKO_DEGRADE_URL=http://localhost:7099 node scripts/verif-degrade-bande-et-colonnes.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { cheminDeLaBaseServie } from './base-servie.mjs';

const BASE = process.env.HAIKO_DEGRADE_URL || 'http://localhost:7099';
const CAPTURES = process.env.HAIKO_DEGRADE_CAPTURES || '/tmp';
/* La base et ses dépendances natives vivent dans le dépôt PRINCIPAL. */
const PRINCIPAL = path.resolve(process.env.BELUGA_DATA || '/root/beluga/data', '..');
const PALETTES = [
  ['sombre', true], ['sombre', false],
  ['sable', true], ['sable', false],
  ['ardoise', true], ['ardoise', false],
  ['givre', true], ['givre', false],
  ['sapin', true], ['sapin', false],
  ['contraste', true], ['contraste', false],
];

function base() {
  const require = createRequire(import.meta.url);
  return require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(cheminDeLaBaseServie());
}

/* Une session d'une heure, fabriquée puis retirée. Le jeton est HACHÉ en base :
   on ne garde en clair que le cookie posé au navigateur. */
const cookie = crypto.randomBytes(24).toString('hex');
const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
{
  const d = base();
  const n = Date.now();
  d.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?,?,?,?)')
    .run(empreinte, n, n + 3600_000, 'vérif dégradé bande et colonnes');
  d.close();
}
const retirerLaSession = () => {
  const d = base();
  d.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  d.close();
};

let echecs = 0;
const noter = (ok, texte) => { if (!ok) echecs += 1; console.log(`  ${ok ? ' OK  ' : 'ÉCHEC'} ${texte}`); };
/** L'opacité d'une couleur calculée, ou null si la chaîne n'en est pas une. */
const opacite = (couleur) => {
  const m = /rgba?\(([^)]+)\)/.exec(couleur || '');
  return m ? Number(m[1].split(',')[3] ?? 1) : null;
};

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
await contexte.addCookies([{ name: 'beluga_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' }]);
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
/* LE TABLEAU N'EST PAS TOUJOURS LÀ TOUT SEUL : quand aucun projet n'a été
   rouvert, l'écran s'arrête sur le tableau de bord et aucune colonne n'existe.
   On écarte ce qui se serait ouvert par-dessus, puis on ouvre l'espace de
   développement — c'est lui qui pose des colonnes à coup sûr. Sans ce geste, le
   contrôle tombait sur une attente de soixante secondes, sans rien juger. */
await page.waitForTimeout(2500);
await page.keyboard.press('Escape').catch(() => {});
if (!(await page.locator('[data-column="planned"]').count())) {
  await page.click('[data-ouvrir-espace-dev]').catch(() => {});
}
await page.waitForSelector('[data-column="planned"]', { timeout: 60000 });
await page.waitForTimeout(1500);

/* LA BANDE D'ÉTAT ne paraît que sur un lien perdu. On la fait naître dans la
   page même, avec les MÊMES classes que `bandeau-canal.tsx`, plutôt que de
   saboter le canal : ce qu'on relève ici est le FOND de la bande, pas la
   mécanique de reconnexion, déjà couverte par `verif-canal-coupe.mjs`. */
const CLASSES = {
  perte: 'flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs bg-gradient-to-b from-warning/25 to-warning/0 text-warning',
  calme: 'flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs bg-gradient-to-b from-raised to-raised/0 text-muted',
};
await page.evaluate((classes) => {
  const hote = document.querySelector('[data-column="planned"]')?.closest('main') ?? document.body;
  for (const [cle, cls] of Object.entries(classes)) {
    const n = document.createElement('div');
    n.setAttribute('data-releve-bande', cle);
    n.className = cls;
    n.innerHTML = '<span class="min-w-0 flex-1 truncate">Lien perdu</span>'
      + '<button type="button" class="flex shrink-0 items-center gap-1 rounded bg-raised/70 px-1.5 py-0.5 hover:bg-raised">Reconnecter</button>';
    hote.prepend(n);
  }
}, CLASSES);

const poser = (id, sombre) => page.evaluate(({ id, sombre }) => {
  document.documentElement.dataset.theme = id;
  document.documentElement.classList.toggle('dark', sombre);
}, { id, sombre });

for (const [id, sombre] of PALETTES) {
  await poser(id, sombre);
  await page.waitForTimeout(150);
  const vu = await page.evaluate(() => {
    const lire = (n) => (n ? getComputedStyle(n) : null);
    const colonne = (cle) => {
      const n = document.querySelector(`[data-column="${cle}"]`);
      if (!n) return { absente: true };
      const s = lire(n);
      const c = lire(n.querySelector('[data-cadre-colonne]'));
      return {
        haut: s.borderTopColor,
        cotes: [s.borderRightColor, s.borderBottomColor, s.borderLeftColor],
        largeurs: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
        calque: c ? c.borderTopColor : null,
        arrondi: c ? c.borderTopLeftRadius : null,
        arrondiColonne: s.borderTopLeftRadius,
        masque: c ? (c.maskImage || c.webkitMaskImage || 'aucun') : null,
        clics: c ? c.pointerEvents : null,
      };
    };
    const bande = (cle) => {
      const n = document.querySelector(`[data-releve-bande="${cle}"]`);
      const s = lire(n);
      const b = lire(n?.querySelector('button'));
      return { image: s.backgroundImage, texte: s.color, boutonFond: b?.backgroundColor };
    };
    return {
      running: colonne('running'), to_deploy: colonne('to_deploy'), planned: colonne('planned'),
      perte: bande('perte'), calme: bande('calme'),
    };
  });
  console.log(`\n— ${id} ${sombre ? 'sombre' : 'clair'} —`);
  /* LA BANDE : deux teintes au moins, la dernière à opacité nulle, et jamais
     le mot-clé `transparent` — qui vaut `rgba(0,0,0,0)` et salit la teinte au
     milieu du dégradé sur les palettes claires. */
  for (const cle of ['perte', 'calme']) {
    const image = vu[cle].image || '';
    const arrets = image.match(/rgba?\([^)]*\)/g) || [];
    noter(
      image.startsWith('linear-gradient') && arrets.length >= 2
        && opacite(arrets[arrets.length - 1]) === 0 && !/\btransparent\b/.test(image),
      `bande « ${cle} » : dégradé vertical qui tombe à 0 — ${arrets.join(' → ') || image.slice(0, 60)}`,
    );
    noter(!!vu[cle].boutonFond && opacite(vu[cle].boutonFond) !== 0,
      `bande « ${cle} » : le bouton garde son propre fond — ${vu[cle].boutonFond}`);
    noter(opacite(vu[cle].texte) !== 0, `bande « ${cle} » : le texte garde sa couleur pleine — ${vu[cle].texte}`);
  }
  /* LES COLONNES : trait du haut PLEIN (il porte l'avancement), côtés confiés
     au calque masqué, arrondi conservé, clics transmis. */
  for (const cle of ['running', 'to_deploy', 'planned']) {
    const c = vu[cle];
    if (c.absente) { noter(false, `colonne « ${cle} » absente`); continue; }
    noter(opacite(c.haut) !== 0, `« ${cle} » : le trait du haut garde sa couleur — ${c.haut}`);
    noter(c.cotes.every((x) => opacite(x) === 0), `« ${cle} » : les trois autres côtés sont laissés au calque`);
    noter(c.largeurs.every((x) => x === '1px'), `« ${cle} » : la largeur du cadre reste posée partout — ${c.largeurs.join('/')}`);
    noter(!!c.calque && opacite(c.calque) !== 0, `« ${cle} » : le calque porte le tour — ${c.calque}`);
    noter(/linear-gradient/.test(c.masque || ''), `« ${cle} » : le tour s'éteint vers le bas`);
    /* Le calque déborde d'UN pixel (`-inset-px`) : pour épouser le bord
       extérieur de la colonne, sa courbe vaut un pixel de plus. */
    noter(Number.parseFloat(c.arrondi) === Number.parseFloat(c.arrondiColonne) + 1,
      `« ${cle} » : le calque épouse l'arrondi de la colonne — ${c.arrondiColonne} + 1 px = ${c.arrondi}`);
    noter(c.clics === 'none', `« ${cle} » : le calque n'attrape aucun clic`);
  }
  await page.screenshot({ path: path.join(CAPTURES, `degrade-${id}-${sombre ? 'sombre' : 'clair'}.png`) });
}

/* ---- LE GLISSER-DÉPOSÉ : la colonne visée reprend son tour COMPLET. ---- */
await poser('sombre', true);
await page.evaluate(() => document.querySelectorAll('[data-releve-bande]').forEach((n) => n.remove()));
await page.waitForTimeout(300);
console.log('\n— glisser-déposé —');
/* OÙ APPUYER : la carte doit être VISIBLE (le rail défile) et le point d'appui
   doit lui appartenir POUR DE VRAI. Deux pièges se cumulaient ici :
   au MILIEU, le pointeur tombe sur `[data-carte-texte]`, où un appui à la
   souris commence une sélection et ne décroche qu'une fois sorti de la carte
   (`commencerLeGeste`, board.tsx) ; sur le BORD, un bouton du décor passe
   par-dessus à certaines hauteurs, et l'appui allait dans le vide.
   On SONDE donc plusieurs points de la carte et on garde le premier que
   `elementFromPoint` rend vraiment à elle. */
const prise = await page.evaluate(() => {
  const cartes = [...document.querySelectorAll('[data-carte]')];
  for (let i = 0; i < cartes.length; i += 1) {
    const n = cartes[i];
    const r = n.getBoundingClientRect();
    const dansLeCadre =
      r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight && r.height > 20;
    if (!dansLeCadre) continue;
    for (const [dx, dy] of [[6, r.height / 2], [6, 8], [r.width - 6, 8], [6, r.height - 8], [r.width / 2, 6]]) {
      const x = r.x + dx;
      const y = r.y + dy;
      const sous = document.elementFromPoint(x, y);
      if (sous?.closest('[data-carte]') === n && !sous.closest('[data-carte-texte]')) {
        return { index: i, x, y, source: n.closest('[data-column]')?.getAttribute('data-column') ?? null };
      }
    }
  }
  return null;
});
if (prise) {
  const depart = { x: prise.x, y: prise.y };
  const source = prise.source;
  /* On vise une colonne qui n'est PAS la sienne — survoler sa propre colonne
     n'allume rien — et qui est VRAIMENT À L'ÉCRAN : le rail des colonnes
     défile, et une colonne nommée en dur peut être hors du cadre. Viser sa
     boîte revient alors à lâcher le pointeur dans le vide, et le contrôle
     accusait le produit d'un défaut qui n'était que le sien. */
  const cible = await page.evaluate((source) => {
    for (const n of document.querySelectorAll('[data-column]')) {
      const cle = n.getAttribute('data-column');
      if (cle === source) continue;
      const r = n.getBoundingClientRect();
      if (r.left >= 0 && r.right <= window.innerWidth && r.width > 100) return cle;
    }
    return null;
  }, source);
  if (!cible) noter(false, 'aucune colonne visible à viser');
  const boiteCible = cible ? await page.locator(`[data-column="${cible}"]`).boundingBox() : null;
  /* LE GESTE S'ÉMET DANS LA PAGE, il ne passe pas par la souris de Playwright :
     le tableau n'utilise pas le glisser-déposer natif, il suit les ÉVÉNEMENTS
     DE POINTEUR posés sur `window` (`usePointerDrag`, web/src/lib/dnd.ts), que
     la souris pilotée ne reproduit pas à l'identique. Même recette que
     `verif-sortie-archive.mjs`, seul chemin qui décroche vraiment une carte. */
  await page.evaluate(
    async ([x0, y0, x1, y1]) => {
      const commun = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 };
      document.elementFromPoint(x0, y0)?.dispatchEvent(new PointerEvent('pointerdown', { ...commun, clientX: x0, clientY: y0 }));
      for (let i = 1; i <= 14; i += 1) {
        window.dispatchEvent(new PointerEvent('pointermove', {
          ...commun,
          clientX: x0 + ((x1 - x0) * i) / 14,
          clientY: y0 + ((y1 - y0) * i) / 14,
        }));
        await new Promise((r) => setTimeout(r, 25));
      }
    },
    [depart.x, depart.y, boiteCible ? boiteCible.x + boiteCible.width / 2 : depart.x, boiteCible ? boiteCible.y + 150 : depart.y],
  );
  await page.waitForTimeout(400);
  const vu = await page.evaluate((cle) => {
    const visee = document.querySelector(`[data-column="${cle}"]`);
    const calque = visee?.querySelector('[data-cadre-colonne]');
    const c = calque ? getComputedStyle(calque) : null;
    return {
      geste: document.body.style.cursor || '(aucun)',
      masque: c ? (c.maskImage || c.webkitMaskImage || 'none') : 'ABSENT',
      tour: c ? c.borderTopColor : 'ABSENT',
    };
  }, cible);
  noter(vu.geste === 'grabbing', `la carte est bien décrochée — curseur « ${vu.geste} »`);
  noter(vu.masque === 'none', `la colonne visée reprend son tour COMPLET, sans masque — ${vu.masque}`);
  noter(!!vu.tour && opacite(vu.tour) !== 0, `son tour reste dessiné — ${vu.tour}`);
  await page.screenshot({ path: path.join(CAPTURES, 'degrade-glisser.png') });
  /* ON RELÂCHE AU POINT DE DÉPART : la carte retombe dans sa colonne, aucune
     donnée du projet n'est touchée par ce contrôle. */
  await page.evaluate(([x, y]) => {
    const commun = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0 };
    window.dispatchEvent(new PointerEvent('pointermove', { ...commun, buttons: 1, clientX: x, clientY: y }));
    window.dispatchEvent(new PointerEvent('pointerup', { ...commun, buttons: 0, clientX: x, clientY: y }));
  }, [depart.x, depart.y]);
  await page.mouse.up();
  await page.waitForTimeout(500);
} else noter(false, 'aucune carte visible à faire glisser');

noter(erreurs.length === 0, `aucune erreur de page — ${erreurs.length}`);
await navigateur.close();
retirerLaSession();
console.log(`\n${echecs === 0 ? 'TOUT PASSE' : `${echecs} ÉCHEC(S)`} · captures dans ${CAPTURES}/degrade-*.png`);
process.exit(echecs === 0 ? 0 : 1);
