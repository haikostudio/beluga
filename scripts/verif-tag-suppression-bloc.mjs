#!/usr/bin/env node
/**
 * UN TAG « [fichier: …] » SE SUPPRIME D'UN BLOC, PAS CARACTÈRE PAR CARACTÈRE.
 *
 * Dans le champ de saisie, le tag doit se comporter comme une pastille :
 *  1. chaque tag porte une croix à sa droite ;
 *  2. un clic sur cette croix retire le tag ENTIER ;
 *  3. le retour arrière posé au milieu d'un tag emporte le tag ENTIER ;
 *  4. la même touche, hors d'un tag, n'efface toujours qu'une seule lettre.
 *
 * Se lance contre le serveur de développement :
 *   npm run dev --workspace web -- --port 7113
 *   node scripts/verif-tag-suppression-bloc.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { creerResultats } from './lib/verif-resultats.mjs';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

// Le dépôt d'où PART ce script — jamais /root/beluga en dur.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// PIÈGE : BELUGA_URL désigne l'application PUBLIÉE. L'essai a sa variable.
const BASE = process.env.BELUGA_VERIF_URL || 'http://localhost:7113';
/* PIÈGE : la base servie ne s'écrit pas en dur. Une copie de travail de carte a sous les pieds un `data/` vide — compétence
   partagée `trouver-la-base-reellement-servie`. */
const DB = process.env.BELUGA_DB || cheminDeLaBaseServie();

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
    'vérification suppression de tag',
  );
  return { cookie, empreinte };
}

/*
 * CE QUE LE CHAMP CONTIENT N'EST PAS CE QU'ON A ÉCRIT. Ses tags y sont MASQUÉS
 * (`tagsMasques`, shared/src/ancres.ts) : l'enrobage « [fichier: » et « ] » est
 * remplacé, caractère pour caractère, par des signes invisibles, et les espaces
 * du tag sont insécables. Seul le NOM du fichier reste écrit tel quel. On lit
 * donc la valeur en retirant ces signes — les LONGUEURS, elles, ne changent
 * pas : les index du champ et ceux du texte réel restent les mêmes.
 */
const lisible = (valeur) =>
  valeur.replace(/[\u2060\u2062\u2063\u2003]/g, '').replace(/\u00A0/g, ' ');

const TAG_A = '[fichier: premiere-capture.png]';
const TAG_B = '[fichier: seconde-capture.png]';
const TEXTE = `Regarde ${TAG_A} et aussi ${TAG_B} merci`;
/* Le NOM du fichier est la seule part du tag qui reste écrite dans le champ. */
const NOM_A = 'premiere-capture.png';
const NOM_B = 'seconde-capture.png';

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

    // PIÈGE : plusieurs barres d'écriture coexistent. On vise celle qu'on VOIT.
    const barre = page.locator('[data-composer]').filter({ has: page.locator('textarea:visible') }).last();
    const zone = barre.locator('textarea').last();
    await zone.waitFor({ state: 'visible', timeout: 20000 });

    /** Réécrire le texte d'essai et poser le curseur à un endroit précis. */
    const poser = async (curseur) => {
      /* PIÈGE : le calque des pastilles couvre le champ. Un clic ordinaire est
         intercepté — on prend le champ par le clavier, pas par la souris. */
      await zone.focus();
      await zone.fill(TEXTE);
      await page.waitForTimeout(400);
      await zone.evaluate((el, index) => el.setSelectionRange(index, index), curseur);
      await page.waitForTimeout(200);
    };

    /* -------- 1. Chaque tag porte sa croix -------- */
    await poser(TEXTE.length);
    const croix = barre.locator('[data-prompt-file-close]');
    record('Chaque tag porte une croix à sa droite', (await croix.count()) === 2, `${await croix.count()}/2`);

    /* -------- 2. Un clic sur la croix retire le tag entier -------- */
    await croix.first().click({ force: true });
    await page.waitForTimeout(500);
    let valeur = lisible(await zone.inputValue());
    record(
      'Un clic sur la croix retire le tag entier',
      !valeur.includes(NOM_A) && valeur.includes(NOM_B),
      valeur,
    );

    /* -------- 3. Le retour arrière au milieu d'un tag emporte tout -------- */
    // Curseur au milieu du nom du PREMIER tag.
    const milieu = TEXTE.indexOf(TAG_A) + Math.floor(TAG_A.length / 2);
    await poser(milieu);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);
    valeur = lisible(await zone.inputValue());
    record(
      'Le retour arrière au milieu d’un tag emporte le tag entier',
      !valeur.includes('premiere-capture') && !valeur.includes('[fichier: ]'),
      valeur,
    );
    record(
      'Le tag voisin, lui, reste intact',
      valeur.includes(NOM_B),
      valeur,
    );

    /* -------- 4. Hors d'un tag, la touche efface une seule lettre -------- */
    await poser(TEXTE.length);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(400);
    const brut = await zone.inputValue();
    valeur = lisible(brut);
    record(
      'Les espaces d’un tag sont insécables dans le champ',
      /\u2062[\u2060\u2003]*premiere-capture\.png\u2063/.test(brut),
      `${(brut.match(/\u2062/g) || []).length} tag(s) masqué(s)`,
    );
    record(
      'Hors d’un tag, le retour arrière n’efface qu’une lettre',
      valeur === lisible(TEXTE).replace(/\[fichier: ([^\]]+)\]/g, '$1').slice(0, -1),
      valeur.slice(-24),
    );

    /* -------- 5. La suppression avant, au bord du tag, l'emporte -------- */
    await poser(TEXTE.indexOf(TAG_A));
    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);
    valeur = lisible(await zone.inputValue());
    record(
      'La suppression avant, posée au début d’un tag, l’emporte en entier',
      !valeur.includes('premiere-capture') && valeur.includes(NOM_B),
      valeur,
    );

    // On ne laisse pas de brouillon derrière soi.
    await zone.focus();
    await zone.fill('');
    await page.waitForTimeout(800);

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
