#!/usr/bin/env node
/**
 * UN TAG « [fichier: …] » EST EN LECTURE SEULE : SEULE SA CROIX LE RETIRE.
 *
 * Cliquer au milieu d'une pastille posait le curseur DANS le texte qu'elle
 * recouvre : la frappe suivante changeait le nom du fichier, le tag ne
 * désignait plus rien, et la pièce jointe partait sans que rien ne le dise. Un
 * clic sur le corps de la pastille, lui, RETIRAIT le tag — un geste dangereux,
 * juste à côté du glisser.
 *
 * Quatre constats ferment la porte :
 *  1. un clic au milieu d'un tag ne le retire pas ;
 *  2. …et une frappe qui suit ce clic laisse le tag INTACT ;
 *  3. une sélection qui n'entame un tag qu'à moitié ne peut pas l'amputer ;
 *  4. la croix, elle, retire toujours le tag entier ;
 *  5. les flèches, avec ou sans Maj, franchissent un tag d'un seul pas.
 *
 * Se lance contre le serveur de développement :
 *   npm run dev --workspace web -- --port 7113
 *   node scripts/verif-tag-lecture-seule.mjs
 *   (BELUGA_VERIF_CARTE=<id d'une carte à soi> si aucune barre d'écriture
 *   n'est ouverte d'emblée)
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
    'vérification tag en lecture seule',
  );
  return { cookie, empreinte };
}

/*
 * CE QUE LE CHAMP CONTIENT N'EST PAS CE QU'ON A ÉCRIT. Ses tags y sont MASQUÉS
 * (`tagsMasques`, shared/src/ancres.ts) : l'enrobage « [fichier: » et « ] » est
 * remplacé, caractère pour caractère, par des signes invisibles, et les espaces
 * du tag sont insécables. Seul le NOM du fichier reste écrit tel quel. On lit
 * donc la valeur en retirant ces signes — sinon tout constat échoue sur des
 * caractères qu'on ne voit pas. Les LONGUEURS, elles, ne changent pas : les
 * index du champ et ceux du texte réel restent les mêmes.
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
  /* Les « Warning: » de React en développement (une ref posée sur un composant
     du tiroir de carte, par exemple) ne sont pas des erreurs de page : ils
     n'existent pas en production, et ce contrôle ne les vise pas. */
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Warning:') && erreurs.push(m.text()));

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

    /* Dernier repli : « Nouvelle tâche » peut ouvrir une fenêtre sans barre
       d'écriture. Le tiroir d'une carte en porte une — on la remplit puis on
       la vide, rien ne part. JAMAIS une carte prise au hasard : son agent
       travaille peut-être, et son brouillon est à lui. On nomme la carte
       (`BELUGA_VERIF_CARTE`, identifiant de carte). */
    if (!(await page.locator('[data-composer] textarea:visible').count()) && process.env.BELUGA_VERIF_CARTE) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
      const carte = page.locator(`[data-carte="${process.env.BELUGA_VERIF_CARTE}"]`).first();
      await carte.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      if (await carte.count()) {
        await carte.click();
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

    /** Remettre le texte d'essai en place, champ propre. */
    const remettre = async () => {
      /* PIÈGE : le calque des pastilles couvre le champ. Un clic ordinaire est
         intercepté — on prend le champ par le clavier, pas par la souris. */
      await zone.focus();
      await zone.fill(TEXTE);
      await page.waitForTimeout(500);
    };

    /* -------- 1. La pastille est ANNONCÉE en lecture seule -------- */
    await remettre();
    const pastilles = barre.locator('[data-prompt-file-lecture-seule="oui"]');
    record(
      'Chaque tag se dit en lecture seule, et sa croix reste à part',
      (await pastilles.count()) === 2 && (await barre.locator('[data-prompt-file-close]').count()) === 2,
      `${await pastilles.count()} pastille(s), ${await barre.locator('[data-prompt-file-close]').count()} croix`,
    );

    /* -------- 2. Un clic au milieu d'un tag ne le retire plus -------- */
    // On vise le CORPS de la pastille, pas sa croix : à gauche du centre.
    const cadre = await pastilles.first().boundingBox();
    await page.mouse.click(cadre.x + cadre.width * 0.35, cadre.y + cadre.height / 2);
    await page.waitForTimeout(600);
    let valeur = lisible(await zone.inputValue());
    record(
      'Un clic sur le corps de la pastille ne retire plus le tag',
      valeur.includes(NOM_A) && valeur.includes(NOM_B),
      valeur,
    );

    /* -------- 3. …et la frappe qui suit laisse le tag INTACT -------- */
    await page.keyboard.type('X');
    await page.waitForTimeout(600);
    valeur = lisible(await zone.inputValue());
    record(
      'Une frappe après ce clic n’ampute pas le tag',
      valeur.includes(NOM_A) && valeur.includes(NOM_B),
      valeur,
    );

    /* -------- 4. Le curseur posé DANS un tag est repoussé dehors -------- */
    // Un vrai geste de clavier : la flèche fait remonter le garde-fou.
    await remettre();
    const DEBUT_A = TEXTE.indexOf(TAG_A);
    const FIN_A = DEBUT_A + TAG_A.length;
    await zone.evaluate((el, index) => el.setSelectionRange(index, index), DEBUT_A + 12);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    const place = await zone.evaluate((el) => el.selectionStart);
    record(
      'Le curseur posé au milieu d’un tag est repoussé à son bord',
      place <= DEBUT_A || place >= FIN_A,
      `curseur en ${place} (tag ${DEBUT_A}–${FIN_A})`,
    );

    /* -------- 4 bis. Les flèches franchissent un tag d'un seul pas -------- */
    // Demande du 28/09/2026 : posée devant le tag, la flèche droite ne
    // bougeait plus, et Maj+flèche revenait en arrière.
    const poser = (debut, fin = debut) => zone.evaluate((el, [a, b]) => el.setSelectionRange(a, b), [debut, fin]);
    const selection = () => zone.evaluate((el) => [el.selectionStart, el.selectionEnd, el.selectionDirection]);
    await remettre();
    await poser(DEBUT_A);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    let sel = await selection();
    record('La flèche droite posée devant un tag saute derrière lui', sel[0] === FIN_A && sel[1] === FIN_A, JSON.stringify(sel));
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    sel = await selection();
    record('La flèche gauche posée derrière un tag saute devant lui', sel[0] === DEBUT_A && sel[1] === DEBUT_A, JSON.stringify(sel));
    await poser(DEBUT_A);
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(300);
    sel = await selection();
    record('Maj+flèche droite sélectionne le tag entier', sel[0] === DEBUT_A && sel[1] === FIN_A, JSON.stringify(sel));
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(300);
    sel = await selection();
    record('…et le pas suivant continue au-delà, sans revenir en arrière', sel[0] === DEBUT_A && sel[1] === FIN_A + 1, JSON.stringify(sel));
    await poser(FIN_A);
    await page.keyboard.press('Shift+ArrowLeft');
    await page.waitForTimeout(300);
    await page.keyboard.press('Shift+ArrowLeft');
    await page.waitForTimeout(300);
    sel = await selection();
    record('Maj+flèche gauche franchit le tag vers l’arrière, puis continue', sel[0] === DEBUT_A - 1 && sel[1] === FIN_A, JSON.stringify(sel));

    /* -------- 5. Une frappe posée dans un tag ne le coupe pas en deux -------- */
    await remettre();
    await zone.evaluate((el, index) => el.setSelectionRange(index, index), DEBUT_A + 12);
    await page.keyboard.type('Z');
    await page.waitForTimeout(600);
    valeur = lisible(await zone.inputValue());
    record(
      'Une frappe posée au milieu d’un tag ne coupe pas son nom en deux',
      !/premiere-Zcapture|premiereZ|captureZ\.png|premiere-capture\.pngZ/.test(valeur) &&
        (valeur.includes(NOM_A) || !valeur.includes('premiere-')),
      valeur,
    );

    /* -------- 6. La croix, elle, retire toujours le tag entier -------- */
    await remettre();
    await barre.locator('[data-prompt-file-close]').first().click({ force: true });
    await page.waitForTimeout(700);
    valeur = lisible(await zone.inputValue());
    record(
      'La croix retire le tag entier, et elle seule',
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
