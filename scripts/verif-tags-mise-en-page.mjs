#!/usr/bin/env node
/**
 * LES TAGS « [fichier: …] » NE DÉCALENT PAS LE TEXTE DE LA BARRE D'ÉCRITURE.
 *
 * Le champ de saisie est un vrai `textarea` : c'est LUI qui décide des retours
 * à la ligne et de l'endroit du curseur. Par-dessus, un calque redessine les
 * tags en couleur. Si ce calque n'a pas EXACTEMENT les mêmes réglages (police,
 * hauteur de ligne, marges, largeur utile), ses lignes tombent à côté des
 * vraies : le texte paraît décalé, une ligne vide s'ajoute en bas, et le
 * curseur clignote ailleurs qu'à l'endroit où le texte se termine.
 *
 * Trois constats, dans un vrai navigateur :
 *  1. le calque et le champ occupent le MÊME nombre de lignes ;
 *  2. chaque tag est dessiné exactement là où il se trouve dans le texte ;
 *  3. le curseur posé juste après un tag tombe au bout du tag affiché.
 *
 * Se lance contre le serveur de développement :
 *   npm run dev --workspace web -- --port 7113
 *   node scripts/verif-tags-mise-en-page.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { creerResultats } from './lib/verif-resultats.mjs';

// Le dépôt d'où PART ce script — jamais /root/haikodev en dur : lancé depuis
// une copie de travail, il doit juger cette copie.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// PIÈGE : HAIKODEV_URL désigne l'application PUBLIÉE. L'essai a sa variable.
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7113';
const DB = process.env.HAIKODEV_DB || '/root/haikodev/data/haikodev.db';
const SHOTS = '/root/haikodev/data/verification';

const { results, record } = creerResultats();

/** Une session d'une heure : la colonne « token » garde le SHA-256 du cookie. */
function poserSession(db) {
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification tags mise en page',
  );
  return { cookie, empreinte };
}

/* Deux tags dans une phrase assez longue pour passer à la ligne : c'est le cas
   de la capture d'écran d'origine, où le second tag repoussait tout. */
const TEXTE =
  'dans cette partie les onglets [fichier: capture-longue-mise-en-page.png] doivent ' +
  'avoir la meme interface que la [fichier: seconde-capture-du-controle.png] du haut';

async function main() {
  const db = new Database(DB);
  const { cookie, empreinte } = poserSession(db);

  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    // Sinon c'est la version publiée qui s'affiche.
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'haikodev_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);

  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    if (await page.locator('[role="dialog"]').first().isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1200);
    }

    const ongletChef = page.getByRole('button', { name: 'Chef', exact: true }).first();
    if (await ongletChef.count()) {
      await ongletChef.click({ force: true });
      await page.waitForTimeout(2500);
    }

    // PIÈGE : plusieurs barres d'écriture coexistent (conversation, tiroir de
    // carte). On vise celle qu'on VOIT.
    const barre = page.locator('[data-composer]').filter({ has: page.locator('textarea:visible') }).last();
    const zone = barre.locator('textarea').last();
    await zone.waitFor({ state: 'visible', timeout: 20000 });

    await zone.click();
    await zone.fill(TEXTE);
    await page.waitForTimeout(900);

    record('Le calque des tags se pose sur le champ', (await barre.locator('[data-prompt-calque]').count()) > 0);

    const mesure = await page.evaluate(() => {
      const champs = Array.from(document.querySelectorAll('textarea')).filter((t) => t.offsetParent !== null);
      const zone = champs[champs.length - 1];
      const cadre = zone.closest('[data-composer]') || document;
      const calque = cadre.querySelector('[data-prompt-calque]');
      if (!zone || !calque) return null;

      /* Un miroir du champ : mêmes réglages, mêmes retours à la ligne. Il dit
         où se trouve VRAIMENT chaque caractère du texte saisi. */
      const style = window.getComputedStyle(zone);
      const miroir = document.createElement('div');
      for (const nom of [
        'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'letterSpacing',
        'lineHeight', 'textIndent', 'textTransform', 'wordSpacing',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      ]) miroir.style[nom] = style[nom];
      miroir.style.boxSizing = 'border-box';
      miroir.style.width = `${zone.clientWidth}px`;
      miroir.style.position = 'fixed';
      miroir.style.left = '0';
      miroir.style.top = '0';
      miroir.style.whiteSpace = 'pre-wrap';
      miroir.style.overflowWrap = 'break-word';
      miroir.style.visibility = 'hidden';
      const noeud = document.createTextNode(zone.value);
      miroir.appendChild(noeud);
      document.body.appendChild(miroir);
      const repereMiroir = miroir.getBoundingClientRect();
      const repereCalque = calque.getBoundingClientRect();

      const boiteDuTexte = (debut, fin) => {
        const r = document.createRange();
        r.setStart(noeud, debut);
        r.setEnd(noeud, fin);
        const b = r.getBoundingClientRect();
        return { x: b.left - repereMiroir.left, y: b.top - repereMiroir.top, droite: b.right - repereMiroir.left };
      };

      const drapeaux = Array.from(calque.querySelectorAll('[data-prompt-file-flag]')).map((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const b = r.getBoundingClientRect();
        return { x: b.left - repereCalque.left, y: b.top - repereCalque.top, droite: b.right - repereCalque.left };
      });

      const marque = /\[fichier:\s*[^\]\n]+\]/g;
      const tags = [];
      let trouve;
      while ((trouve = marque.exec(zone.value))) {
        tags.push({ debut: trouve.index, fin: trouve.index + trouve[0].length });
      }

      const ecarts = tags.map((tag, i) => {
        const vrai = boiteDuTexte(tag.debut, tag.fin);
        const vu = drapeaux[i];
        if (!vu) return null;
        return { dx: Math.abs(vrai.x - vu.x), dy: Math.abs(vrai.y - vu.y), dFin: Math.abs(vrai.droite - vu.droite) };
      });

      /* LA DERNIÈRE LETTRE DIT TOUT : si le calque prend une ligne de plus ou
         de moins que le champ, la fin du texte affiché ne tombe plus au même
         endroit que la fin du texte réel — c'est la ligne vide en bas et le
         curseur qui clignote ailleurs. */
      const promeneur = document.createTreeWalker(calque, NodeFilter.SHOW_TEXT);
      let dernierTexte = null;
      while (promeneur.nextNode()) if (promeneur.currentNode.data.length) dernierTexte = promeneur.currentNode;
      let finAffichee = null;
      if (dernierTexte) {
        const r = document.createRange();
        r.setStart(dernierTexte, dernierTexte.data.length - 1);
        r.setEnd(dernierTexte, dernierTexte.data.length);
        const b = r.getBoundingClientRect();
        finAffichee = { x: b.right - repereCalque.left, y: b.top - repereCalque.top };
      }
      const finReelle = boiteDuTexte(zone.value.length - 1, zone.value.length);
      const ecartFinTexte = finAffichee
        ? { dx: Math.abs(finReelle.droite - finAffichee.x), dy: Math.abs(finReelle.y - finAffichee.y) }
        : null;

      const hauteurLigne = Number.parseFloat(style.lineHeight) || 20;
      const hautChamp =
        zone.scrollHeight - (Number.parseFloat(style.paddingTop) || 0) - (Number.parseFloat(style.paddingBottom) || 0);

      const hautDuTexte = Number.parseFloat(style.paddingTop) || 0;
      const resultat = {
        ecartFinTexte,
        lignesReelles: Math.round(hautChamp / hauteurLigne),
        lignesAffichees: finAffichee ? Math.round((finAffichee.y - hautDuTexte) / hauteurLigne) + 1 : 0,
        hauteurLigne,
        nbTags: tags.length,
        nbDrapeaux: drapeaux.length,
        ecarts,
      };
      miroir.remove();
      return resultat;
    });

    if (!mesure) {
      record('Le champ et son calque ont pu être mesurés', false, 'champ ou calque introuvable');
    } else {
      record(
        'Le texte affiché occupe le même nombre de lignes que le texte réel',
        mesure.lignesAffichees === mesure.lignesReelles,
        `${mesure.lignesAffichees} ligne(s) affichée(s) pour ${mesure.lignesReelles} réelle(s)`,
      );
      record(
        'La fin du texte est affichée là où elle se trouve vraiment',
        Boolean(mesure.ecartFinTexte) && mesure.ecartFinTexte.dx <= 2 && mesure.ecartFinTexte.dy <= 2,
        mesure.ecartFinTexte
          ? `écart ${mesure.ecartFinTexte.dx.toFixed(1)} px à l’horizontale, ${mesure.ecartFinTexte.dy.toFixed(1)} px à la verticale`
          : 'fin du texte introuvable',
      );
      record('Chaque tag du texte a son drapeau à l’écran', mesure.nbDrapeaux === mesure.nbTags, `${mesure.nbDrapeaux}/${mesure.nbTags}`);

      const pires = mesure.ecarts.filter(Boolean);
      const pireDebut = Math.max(0, ...pires.map((e) => Math.max(e.dx, e.dy)));
      record(
        'Chaque tag est dessiné là où il se trouve vraiment dans le texte',
        pires.length === mesure.nbTags && pireDebut <= 2,
        `écart maximal ${pireDebut.toFixed(1)} px`,
      );

      const pireFin = Math.max(0, ...pires.map((e) => e.dFin));
      record(
        'Le curseur posé après un tag tombe au bout du tag affiché',
        pires.length === mesure.nbTags && pireFin <= 2,
        `écart maximal ${pireFin.toFixed(1)} px`,
      );
    }

    await page.screenshot({ path: `${SHOTS}/composeur-tags-mise-en-page.png`, clip: await (async () => {
      const b = await barre.boundingBox();
      return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : undefined;
    })() });

    // Le brouillon est conservé côté serveur : on ne laisse pas ce texte
    // d'essai dans la conversation du chef.
    await zone.fill('');
    await page.waitForTimeout(1200);

    record('Aucune erreur de page pendant le contrôle', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    db.close();
  }

  const ratés = results.filter((r) => !r.ok);
  console.log(`\n${results.length - ratés.length}/${results.length} constats tenus — dépôt ${RACINE}`);
  process.exit(ratés.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
