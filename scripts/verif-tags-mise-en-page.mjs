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
import { chromium, webkit, devices } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { creerResultats } from './lib/verif-resultats.mjs';
import { cheminDeLaBaseServie, dossierDesDonnees } from './lib/base-servie.mjs';

// Le dépôt d'où PART ce script — jamais /root/beluga en dur : lancé depuis
// une copie de travail, il doit juger cette copie.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// PIÈGE : BELUGA_URL désigne l'application PUBLIÉE. L'essai a sa variable.
const BASE = process.env.BELUGA_VERIF_URL || 'http://localhost:7113';
/* PIÈGE : la base servie ne s'écrit pas en dur. Une copie de travail de carte a sous les pieds un `data/` vide — compétence
   partagée `trouver-la-base-reellement-servie`. */
const DB = process.env.BELUGA_DB || cheminDeLaBaseServie();
const SHOTS = `${dossierDesDonnees()}/verification`;

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

/* LE CAS DE LA CAPTURE iPHONE : plusieurs lignes, guillemets français, deux
   tags EN AMONT du curseur, et le curseur en fin de texte. Un écart de
   largeur entre le champ et son calque s'y accumule de ligne en ligne. */
const TEXTE_LONG =
  'Dans la fenêtre « Installer le suivi » [fichier: capture-7cf6.png] le bouton est mal placé, ' +
  'il faudrait « Relancer » [fichier: capture-37b5.png] pour ouvrir l’agent en cours.\n' +
  'Aussi, montrer les étapes en direct, cochées au fur et à mesure, avec une icône i et les points';

/** Ouvre la barre d'écriture visible (conversation du chef). */
async function ouvrirBarre(page) {
  if (await page.locator('[role="dialog"]').first().isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
  }
  if (!(await page.locator('[data-composer] textarea:visible').count())) {
    const nouvelle = page.getByText('Nouvelle tâche', { exact: true }).first();
    if (await nouvelle.count()) {
      await nouvelle.click({ force: true });
      await page.waitForTimeout(3000);
    }
  }
  const barre = page.locator('[data-composer]').filter({ has: page.locator('textarea:visible') }).last();
  const zone = barre.locator('textarea').last();
  await zone.waitFor({ state: 'visible', timeout: 20000 });
  return { barre, zone };
}

/**
 * LA PREUVE AU PIXEL : ce que le CHAMP écrirait lui-même, contre ce que le
 * CALQUE écrit à sa place. Un miroir de mesure ne suffit pas — c'est un bloc
 * ordinaire, il ne voit pas ce que le champ fait en propre (sur iPhone, une
 * marge intérieure cachée). On photographie donc les deux textes, l'un puis
 * l'autre, pastilles ôtées et tags rendus visibles des deux côtés, et on
 * compte les points qui diffèrent. Le curseur est posé en fin de texte.
 *
 * LES DEUX PHOTOS MONTRENT UN TEXTE POSÉ, JAMAIS UN FONDU. Depuis la refonte du
 * 11/10/2026 le champ fond ses couleurs (`transition-colors`, `Textarea` de
 * `web/src/components/ui/index.tsx`) : rendu visible, son texte met 150 ms à
 * reprendre sa couleur. Photographié à cet instant il sortait à demi
 * transparent, au bon endroit mais trop pâle pour compter comme de l'encre —
 * des milliers de points « différents » sans un pixel de décalage. Le fondu est
 * donc coupé sur le champ avant de retirer la classe, puis rendu.
 */
async function comparerAuPixel(page, zone) {
  await zone.click();
  await zone.fill(TEXTE_LONG);
  await zone.press('End');
  await page.waitForTimeout(900);
  const cadre = await zone.boundingBox();
  const photo = async () => (await page.screenshot({ clip: cadre, caret: 'hide' })).toString('base64');
  await page.evaluate(() => {
    for (const e of document.querySelectorAll('[data-prompt-file-pastille]')) e.style.visibility = 'hidden';
    for (const e of document.querySelectorAll('[data-prompt-file-flag]')) e.style.color = 'inherit';
    for (const e of document.querySelectorAll('[data-prompt-file-flag] > span.invisible')) {
      e.style.visibility = 'visible';
      e.style.background = 'none';
      e.style.boxShadow = 'none';
    }
  });
  const calque = await photo();
  await page.evaluate(() => {
    const champ = [...document.querySelectorAll('[data-composer] textarea')].filter((t) => t.offsetParent).pop();
    champ.style.transition = 'none';
    champ.classList.remove('texte-sous-calque');
    document.querySelector('[data-prompt-calque-texte]').style.color = 'transparent';
  });
  const champ = await photo();
  await page.evaluate(() => {
    const champ = [...document.querySelectorAll('[data-composer] textarea')].filter((t) => t.offsetParent).pop();
    champ.style.transition = '';
  });
  const mesure = await page.evaluate(async ([a, b]) => {
    const charge = (s) =>
      new Promise((ok) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.src = `data:image/png;base64,${s}`;
      });
    const [ia, ib] = await Promise.all([charge(a), charge(b)]);
    const toile = document.createElement('canvas');
    toile.width = ia.width;
    toile.height = ia.height;
    const g = toile.getContext('2d');
    g.drawImage(ia, 0, 0);
    const da = g.getImageData(0, 0, toile.width, toile.height).data;
    g.clearRect(0, 0, toile.width, toile.height);
    g.drawImage(ib, 0, 0);
    const db = g.getImageData(0, 0, toile.width, toile.height).data;
    let differents = 0;
    let encre = 0;
    for (let i = 0; i < da.length; i += 4) {
      const ecart = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      if (ecart > 90) differents += 1;
      if (Math.abs(db[i] - db[0]) + Math.abs(db[i + 1] - db[1]) + Math.abs(db[i + 2] - db[2]) > 90) encre += 1;
    }
    const champ = [...document.querySelectorAll('[data-composer] textarea')].filter((t) => t.offsetParent).pop();
    const texte = document.querySelector('[data-prompt-calque-texte]');
    return {
      differents,
      encre,
      margeChamp: getComputedStyle(champ).paddingLeft,
      margeCalque: texte.style.paddingLeft,
    };
  }, [calque, champ]);
  await zone.fill('');
  await page.waitForTimeout(600);
  return mesure;
}

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
    { name: 'beluga_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
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

    /* LA BARRE D'ÉCRITURE S'OUVRE PAR LA CONVERSATION DU CHEF. L'onglet
       « Chef » a disparu de l'entête : c'est la carte « Nouvelle tâche », en
       tête de la colonne « Demande », qui ouvre le fil. On garde l'ancien
       chemin en repli, pour un écran resté à la version d'avant. */
    const ongletChef = page.getByRole('button', { name: 'Chef', exact: true }).first();
    if (await ongletChef.count()) {
      await ongletChef.click({ force: true });
      await page.waitForTimeout(2500);
    }
    if (!(await page.locator('[data-composer] textarea:visible').count())) {
      const nouvelle = page.getByText('Nouvelle tâche', { exact: true }).first();
      if (await nouvelle.count()) {
        await nouvelle.click({ force: true });
        await page.waitForTimeout(3000);
      }
    }

    /* L'ACCUEIL (« Tableaux de bord ») N'A PLUS DE BARRE D'ÉCRITURE NI DE « Nouvelle tâche » : on ouvre alors une carte
       de tâche par son TITRE (`HAIKO_VERIF_CARTE`), sans rien envoyer. */
    if (!(await page.locator('[data-composer] textarea:visible').count()) && process.env.HAIKO_VERIF_CARTE) {
      await page.getByText(process.env.HAIKO_VERIF_CARTE, { exact: true }).first().click({ force: true });
      await page.waitForTimeout(3500);
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

      /* LE CHAMP N'AFFICHE PAS « [fichier: … ] » : ses tags y sont MASQUÉS,
         bornés par deux signes invisibles (`tagsMasques`, shared/src/ancres.ts)
         et de MÊME LONGUEUR que le tag qu'ils remplacent. C'est donc le masque
         qu'on cherche dans la valeur du champ, pas la syntaxe d'origine. */
      const marque = /\u2062[^\u2062\u2063\n]*\u2063/g;
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

    /* CONSTAT DU 11/10/2026, EN RECALANT CE CONTRÔLE : sur Chrome ce point est
       ROUGE et il dit vrai — ce n'est PAS un décalage (les six mesures du haut
       donnent 0 px, WebKit donne 0 point différent), c'est le LISSAGE. La carte
       est devenue une page posée à plat : le champ y écrit son texte lissé en
       sous-pixels (franges colorées), alors que le calque, empilé par-dessus,
       reste lissé en gris. Le texte change donc de graisse quand le premier tag
       arrive. Défaut de l'application, laissé rouge : ne pas élargir le seuil. */
    const auPixel = await comparerAuPixel(page, zone);
    record(
      'Chrome : le texte redessiné tombe au pixel sur le texte du champ (long texte, 2 tags, guillemets)',
      auPixel.encre > 200 && auPixel.differents <= auPixel.encre * 0.02,
      `${auPixel.differents} point(s) différent(s) sur ${auPixel.encre} points d’encre`,
    );
    record(
      'Chrome : aucune marge cachée inventée (calque et champ à la même marge)',
      auPixel.margeCalque === auPixel.margeChamp,
      `${auPixel.margeCalque} / ${auPixel.margeChamp}`,
    );

    /* LE MOTEUR DE L'iPHONE. Le défaut a été vu sur iPhone : la preuve passe
       aussi par WebKit, en taille et en toucher d'iPhone. */
    const navigateurIphone = await webkit.launch().catch(() => null);
    if (!navigateurIphone) {
      record('WebKit (iPhone) disponible pour la preuve au pixel', false, 'moteur WebKit introuvable');
    } else {
      try {
        const contexteIphone = await navigateurIphone.newContext({
          ...devices['iPhone 13'],
          locale: 'fr-CH',
          serviceWorkers: 'block',
        });
        await contexteIphone.addCookies([
          { name: 'beluga_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
        ]);
        const pageIphone = await contexteIphone.newPage();
        pageIphone.on('pageerror', (error) => erreurs.push(`iPhone : ${String(error)}`));
        await pageIphone.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await pageIphone.waitForTimeout(4000);
        const { zone: zoneIphone } = await ouvrirBarre(pageIphone);
        const iphone = await comparerAuPixel(pageIphone, zoneIphone);
        record(
          'iPhone (WebKit) : le texte redessiné tombe au pixel sur le texte du champ',
          iphone.encre > 200 && iphone.differents <= iphone.encre * 0.02,
          `${iphone.differents} point(s) différent(s) sur ${iphone.encre} points d’encre`,
        );
      } finally {
        await navigateurIphone.close();
      }
    }

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
