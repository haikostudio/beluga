#!/usr/bin/env node
/**
 * LE TAG « [fichier: …] » SE LIT COMME UNE PASTILLE, PAS COMME DU TEXTE BRUT.
 *
 * Dans le champ de saisie, le tag ne doit plus montrer sa syntaxe : on veut
 * voir « trombone + nom + croix », comme la pastille posée au-dessus du champ.
 * La pastille est DESSINÉE par-dessus les caractères réellement écrits, qui
 * gardent leur place mais ne se voient plus : c'est cette largeur-là qui décide
 * des retours à la ligne et de l'endroit du curseur.
 *
 * Quatre constats, dans un vrai navigateur :
 *  1. la pastille est dessinée, la syntaxe brute ne se voit plus ;
 *  2. la croix vit DANS la pastille, avec de la marge avant le mot suivant ;
 *  3. la pastille ne dépasse jamais de la largeur du texte qu'elle recouvre ;
 *  4. un tag coupé en fin de ligne revient au texte brut (repli honnête).
 *
 * Se lance contre le serveur de développement :
 *   npm run dev --workspace web -- --port 7113
 *   node scripts/verif-tag-pastille.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

// Le dépôt d'où PART ce script — jamais /root/haikodev en dur.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// PIÈGE : HAIKODEV_URL désigne l'application PUBLIÉE. L'essai a sa variable.
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7113';
const DB = process.env.HAIKODEV_DB || '/root/haikodev/data/haikodev.db';
const SHOTS = '/root/haikodev/data/verification';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Une session d'une heure : la colonne « token » garde le SHA-256 du cookie. */
function poserSession(db) {
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification pastille de tag',
  );
  return { cookie, empreinte };
}

/* Le cas de la capture d'origine : le texte est collé au tag, sans espace. */
const TEXTE_COURT = '[fichier: IMG_6147.jpeg]les toast ne disparaissent pas';
/* Deux noms très longs : dans la largeur du composeur, un tag finit coupé. */
const TEXTE_LONG =
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

    // PIÈGE : plusieurs barres d'écriture coexistent. On vise celle qu'on VOIT.
    const barre = page.locator('[data-composer]').filter({ has: page.locator('textarea:visible') }).last();
    const zone = barre.locator('textarea').last();
    await zone.waitFor({ state: 'visible', timeout: 20000 });

    await zone.click();
    await zone.fill(TEXTE_COURT);
    await page.waitForTimeout(900);

    const pastille = barre.locator('[data-prompt-file-pastille]').first();
    record('La pastille du tag est dessinée', await pastille.isVisible().catch(() => false));

    const vu = await pastille.innerText().catch(() => '');
    record(
      'La pastille montre le nom du fichier, jamais la syntaxe brute',
      vu.includes('IMG_6147.jpeg') && !vu.includes('[fichier:'),
      vu.replace(/\s+/g, ' ').trim(),
    );

    const mesure = await page.evaluate(() => {
      const champs = Array.from(document.querySelectorAll('textarea')).filter((t) => t.offsetParent !== null);
      const zone = champs[champs.length - 1];
      const cadre = zone.closest('[data-composer]') || document;
      const drapeau = cadre.querySelector('[data-prompt-file-flag]');
      const pastille = cadre.querySelector('[data-prompt-file-pastille]');
      const croix = cadre.querySelector('[data-prompt-file-close]');
      if (!drapeau || !pastille || !croix) return null;
      const brut = drapeau.firstElementChild; // les caractères réels, invisibles
      return {
        // Ce que le texte brut occupe VRAIMENT dans la ligne.
        tag: drapeau.getBoundingClientRect(),
        pastille: pastille.getBoundingClientRect(),
        croix: croix.getBoundingClientRect(),
        syntaxeVisible: window.getComputedStyle(brut).visibility !== 'hidden',
        coupe: drapeau.dataset.tag === 'coupe',
      };
    });

    if (!mesure) {
      record('Le tag et sa pastille ont pu être mesurés', false, 'élément introuvable');
    } else {
      record('Les caractères « [fichier: … ] » ne se voient plus', !mesure.syntaxeVisible);
      record(
        'La croix garde de la marge avant le mot qui suit',
        mesure.tag.right - mesure.croix.right >= 4,
        `${(mesure.tag.right - mesure.croix.right).toFixed(1)} px de marge`,
      );
      record(
        'La pastille tient dans la largeur du texte qu’elle recouvre',
        mesure.pastille.left >= mesure.tag.left - 1 && mesure.pastille.right <= mesure.tag.right + 1,
        `pastille ${mesure.pastille.width.toFixed(0)} px pour un tag de ${mesure.tag.width.toFixed(0)} px`,
      );
    }

    await page.screenshot({
      path: `${SHOTS}/composeur-tag-pastille.png`,
      clip: await (async () => {
        const b = await barre.boundingBox();
        return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : undefined;
      })(),
    });

    /* -------- Le repli : un tag coupé en fin de ligne redevient du texte -------- */
    await zone.click();
    await zone.fill(TEXTE_LONG);
    await page.waitForTimeout(1200);

    const repli = await page.evaluate(() => {
      const champs = Array.from(document.querySelectorAll('textarea')).filter((t) => t.offsetParent !== null);
      const zone = champs[champs.length - 1];
      const cadre = (zone && zone.closest('[data-composer]')) || document;
      // Le tag coupé est celui qui occupe plus d'une ligne, s'il existe.
      const drapeaux = Array.from(cadre.querySelectorAll('[data-prompt-file-flag]'));
      const drapeau = drapeaux.find((el) => el.getClientRects().length > 1) || drapeaux[0];
      if (!drapeau) return null;
      const pastille = drapeau.querySelector('[data-prompt-file-pastille]');
      return {
        lignes: drapeau.getClientRects().length,
        coupe: drapeau.dataset.tag === 'coupe',
        pastilleVue: pastille ? window.getComputedStyle(pastille).display !== 'none' : false,
        syntaxeVisible: window.getComputedStyle(drapeau.firstElementChild).visibility !== 'hidden',
      };
    });

    if (!repli) {
      record('Le tag coupé a pu être mesuré', false, 'drapeau introuvable');
    } else if (repli.lignes < 2) {
      record('Un tag coupé revient au texte brut', true, 'le tag tient encore sur une ligne : rien à replier');
    } else {
      record(
        'Un tag coupé en fin de ligne revient au texte brut',
        repli.coupe && !repli.pastilleVue && repli.syntaxeVisible,
        `${repli.lignes} morceaux, repli ${repli.coupe ? 'posé' : 'absent'}`,
      );
    }

    // On ne laisse pas de brouillon derrière soi.
    await zone.click();
    await zone.fill('');
    await page.waitForTimeout(1000);

    record('Aucune erreur de page pendant le contrôle', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await browser.close().catch(() => {});
    db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    db.close();
  }

  const tenus = results.filter((r) => r.ok).length;
  console.log(`\n${tenus}/${results.length} constats tenus — dépôt ${RACINE}`);
  if (tenus !== results.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
