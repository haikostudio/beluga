#!/usr/bin/env node
/**
 * UN TEXTE LONG AVEC UNE PIÈCE JOINTE RESTE DANS LA BARRE D'ÉCRITURE, ET SE
 * SÉLECTIONNE À LA SOURIS.
 *
 * Dès qu'un fichier est joint, un tag « [fichier: …] » s'écrit dans le champ et
 * un CALQUE se pose par-dessus pour le redessiner en pastille. Ce calque
 * couvrait tout le cadre de la barre d'écriture — champ ET rangée de boutons —
 * et se DÉPLAÇAIT avec l'ascenseur, sa découpe comprise : un texte assez long
 * pour défiler s'écrivait alors par-dessus les boutons, sous le champ. Dans le
 * même temps, le champ rendait son texte transparent avec une règle
 * `::selection` sans couleur de fond, ce qui ôte à Chrome son fond de sélection
 * par défaut : sélectionner à la souris ne montrait plus rien.
 *
 * Cinq constats, dans un vrai navigateur, avec texte long + pièce jointe :
 *  1. le tag est écrit et le calque posé ;
 *  2. le calque ne dépasse jamais la part visible du champ ;
 *  3. il ne recouvre pas la rangée de boutons, et ce qui dépasse est coupé ;
 *  4. le texte affiché suit l'ascenseur, sans décalage ;
 *  5. la sélection à la souris existe ET se voit (fond de sélection réel).
 *
 * Se lance contre le serveur de développement :
 *   npm run dev --workspace web -- --port 7131
 *   node scripts/verif-composeur-jointe-debordement.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { creerResultats } from './lib/verif-resultats.mjs';

// Le dépôt d'où PART ce script — jamais /root/haikodev en dur : lancé depuis
// une copie de travail, il doit juger cette copie.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// PIÈGE : HAIKODEV_URL désigne l'application PUBLIÉE. L'essai a sa variable.
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7131';
const DB = process.env.HAIKODEV_DB || '/root/haikodev/data/haikodev.db';
const SHOTS = '/root/haikodev/data/verification';

/*
 * LE CHAMP ÉCRIT SES TAGS AVEC DES ESPACES INSÉCABLES (shared/src/ancres.ts) :
 * c'est ce qui empêche « [fichier: nom] » d'être coupé en fin de ligne. Toute
 * lecture du champ est donc ramenée aux espaces ordinaires avant comparaison.
 */
const lisible = (valeur) => (valeur || '').replace(/\u00A0/g, ' ');

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
    'vérification composeur avec pièce jointe',
  );
  return { cookie, empreinte };
}

/**
 * Un fichier bien réel : c'est lui qui écrit le tag dans le champ.
 *
 * PIÈGE : le serveur DÉDOUBLONNE les envois sur l'empreinte du CONTENU. Un
 * fichier au contenu déjà connu revient sous le nom qu'il portait la première
 * fois, et le tag attendu ne s'écrit jamais. Le contenu change donc à chaque
 * passage.
 */
const NOM_JOINT = 'notes-debordement.txt';
/* Le serveur peut renvoyer « notes-debordement (3).txt » : on reconnaît la racine. */
const RACINE_DU_NOM = 'notes-debordement';
function fabriqueFichier() {
  const fichier = path.join(os.tmpdir(), NOM_JOINT);
  fs.writeFileSync(fichier, `Contrôle du débordement — ${crypto.randomBytes(12).toString('hex')}\n`);
  return fichier;
}

/* Assez long pour que le champ atteigne sa hauteur maximale et défile : c'est
   exactement le cas où le texte débordait sur les boutons. */
const TEXTE = (
  'Voici une demande assez longue pour occuper plusieurs lignes dans la barre ' +
  "d'écriture, de manière à dépasser la hauteur maximale du champ et à faire " +
  'apparaître un ascenseur vertical. On répète des phrases pour être certain ' +
  'que le texte déborde vraiment du cadre visible et que le calque des tags ' +
  'doit se couper quelque part. Encore une phrase pour faire bonne mesure, et ' +
  'une autre derrière celle-là. Et une dernière ligne pour dépasser franchement. ' +
  /* Le champ du TIROIR D'UNE CARTE monte plus haut que celui du chef : il faut
     davantage de texte pour le faire vraiment défiler. */
  'On rallonge encore, parce que la barre d\u2019écriture d\u2019un tiroir de carte ' +
  'grimpe plus haut avant de céder la place à un ascenseur, et le contrôle ne ' +
  'vaut que si le texte déborde POUR DE BON de la part visible du champ. '
).repeat(3);

async function main() {
  const db = new Database(DB);
  const { cookie, empreinte } = poserSession(db);
  const joint = fabriqueFichier();

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

    /*
     * OÙ TROUVER UNE BARRE D'ÉCRITURE. Le script visait l'onglet « Chef » du
     * menu du bas : cet onglet n'existe plus (le menu ne porte que « Tableau »
     * et « Fichiers », et le volet de droite montre les FICHIERS). La barre
     * d'écriture sûrement présente est celle du TIROIR D'UNE CARTE, qui s'ouvre
     * sur sa conversation. Le brouillon écrit ici est effacé en fin de contrôle.
     */
    const carte = page.locator('[data-carte]').first();
    await carte.waitFor({ state: 'visible', timeout: 20000 });
    await carte.click({ force: true });
    await page.waitForTimeout(3000);

    // PIÈGE : plusieurs barres d'écriture coexistent (conversation, tiroir de
    // carte). On vise celle qu'on VOIT, champ de fichier compris.
    const barre = page.locator('[data-composer]').filter({ has: page.locator('textarea:visible') }).last();
    const zone = barre.locator('textarea').last();
    await zone.waitFor({ state: 'visible', timeout: 20000 });

    await zone.click();
    await zone.fill(TEXTE);
    await page.waitForTimeout(700);
    // Le tag se pose à l'endroit du curseur : on le veut au tout début.
    await zone.press('Control+Home');

    await barre.locator('input[data-composer-file]').setInputFiles(joint);
    // L'envoi du fichier passe par le serveur : on ATTEND le tag, on ne parie
    // pas sur un délai — une machine chargée met plusieurs secondes.
    const tagEcrit = await page
      .waitForFunction(
        (nom) => {
          const champs = Array.from(document.querySelectorAll('textarea')).filter((t) => t.offsetParent !== null);
          const z = champs[champs.length - 1];
          /*
           * LE TAG EST MASQUÉ DANS LE CHAMP (`shared/src/ancres.ts`) : entre
           * `\u2062` et `\u2063`, seul le NOM du fichier reste lisible — le
           * « [fichier: … ] » ne s'écrit plus en toutes lettres dans la valeur,
           * c'est le calque qui le dessine en pastille. On cherche donc le nom
           * entre ses deux marques de masque.
           */
          return Boolean(z && new RegExp(`\u2062[^\u2063]*${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\u2063]*\u2063`).test(z.value));

        },
        // Le serveur DÉDOUBLONNE par le nom : un fichier déjà connu revient en
        // « notes-debordement (3).txt ». On reconnaît donc le tag à la RACINE du
        // nom, jamais à son orthographe exacte.
        RACINE_DU_NOM,
        { timeout: 45000 },
      )
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(700);

    record('Le fichier joint écrit son tag dans le champ', tagEcrit);
    record('Le calque des tags se pose sur le champ', (await barre.locator('[data-prompt-calque]').count()) > 0);

    // Le champ est amené en bas du texte : c'est là que le débordement se voit.
    await zone.press('Control+End');
    await page.waitForTimeout(600);

    const mesure = await page.evaluate(() => {
      const champs = Array.from(document.querySelectorAll('textarea')).filter((t) => t.offsetParent !== null);
      const zone = champs[champs.length - 1];
      // Le CADRE du champ : le bloc qui porte le calque, le champ et la
      // rangée de boutons — pas la barre d'écriture entière.
      const cadre = zone.parentElement;
      const calque = cadre?.querySelector('[data-prompt-calque]');
      const contenu = cadre?.querySelector('[data-prompt-calque-texte]');
      if (!zone || !calque || !contenu) return null;

      const rz = zone.getBoundingClientRect();
      const rc = calque.getBoundingClientRect();
      const rt = contenu.getBoundingClientRect();
      const style = window.getComputedStyle(zone);
      const bordures = {
        haut: Number.parseFloat(style.borderTopWidth) || 0,
        bas: Number.parseFloat(style.borderBottomWidth) || 0,
        gauche: Number.parseFloat(style.borderLeftWidth) || 0,
      };
      // La rangée de boutons, juste sous le champ : rien ne doit la recouvrir.
      const boutons = Array.from(cadre.children).find(
        (e) => e !== calque && e !== zone && e.tagName === 'DIV' && e.getBoundingClientRect().top >= rz.top,
      );
      const rb = boutons ? boutons.getBoundingClientRect() : null;

      return {
        champ: { top: rz.top + bordures.haut, bottom: rz.bottom - bordures.bas, left: rz.left + bordures.gauche, right: rz.right },
        calque: { top: rc.top, bottom: rc.bottom, left: rc.left, right: rc.right },
        contenu: { top: rt.top },
        boutonsTop: rb ? rb.top : null,
        decoupe: window.getComputedStyle(calque).overflow,
        scrollTop: zone.scrollTop,
        scrollHeight: zone.scrollHeight,
        clientHeight: zone.clientHeight,
        paddingTop: Number.parseFloat(style.paddingTop) || 0,
      };
    });

    if (!mesure) {
      record('Le champ et son calque ont pu être mesurés', false, 'champ, calque ou contenu introuvable');
    } else {
      record(
        'Le texte est assez long pour faire défiler le champ',
        mesure.scrollHeight > mesure.clientHeight + 10 && mesure.scrollTop > 0,
        `${mesure.scrollHeight} px de texte pour ${mesure.clientHeight} px visibles, défilé de ${mesure.scrollTop} px`,
      );

      const debordeHaut = mesure.champ.top - mesure.calque.top;
      const debordeBas = mesure.calque.bottom - mesure.champ.bottom;
      record(
        'Le calque ne dépasse pas la part visible du champ',
        debordeHaut <= 1 && debordeBas <= 1,
        `${debordeHaut.toFixed(1)} px au-dessus, ${debordeBas.toFixed(1)} px en dessous`,
      );

      record(
        'Ce qui dépasse du calque est coupé net',
        mesure.decoupe === 'hidden',
        `overflow: ${mesure.decoupe}`,
      );

      record(
        'Le calque ne recouvre pas la rangée de boutons',
        mesure.boutonsTop !== null && mesure.calque.bottom <= mesure.boutonsTop + 1,
        mesure.boutonsTop === null
          ? 'rangée de boutons introuvable'
          : `bas du calque ${mesure.calque.bottom.toFixed(1)} px, boutons à ${mesure.boutonsTop.toFixed(1)} px`,
      );

      // Le texte affiché doit remonter EXACTEMENT du même nombre de pixels que
      // le texte réel : c'est le contenu qui glisse, pas la fenêtre qui coupe.
      const attendu = mesure.champ.top - mesure.scrollTop;
      const ecart = Math.abs(mesure.contenu.top - attendu);
      record(
        "Le texte affiché suit l'ascenseur, sans décalage",
        ecart <= 2,
        `écart ${ecart.toFixed(1)} px`,
      );
    }

    /* ---- La sélection à la souris ---- */
    const b = await zone.boundingBox();
    await page.mouse.move(b.x + 60, b.y + 45);
    await page.mouse.down();
    await page.mouse.move(b.x + 280, b.y + 110, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const selection = await page.evaluate(() => {
      const champs = Array.from(document.querySelectorAll('textarea')).filter((t) => t.offsetParent !== null);
      const z = champs[champs.length - 1];
      const fond = window.getComputedStyle(z, '::selection').backgroundColor;
      const transparent = !fond || fond === 'transparent' || /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(fond);
      return { signes: z.selectionEnd - z.selectionStart, fond, transparent };
    });

    record(
      'Un glissement de souris sélectionne bien du texte',
      selection.signes > 10,
      `${selection.signes} signe(s) sélectionné(s)`,
    );
    record(
      'La sélection se VOIT : le champ garde un fond de sélection',
      !selection.transparent,
      `fond de sélection ${selection.fond}`,
    );

    const boite = await barre.boundingBox();
    await page.screenshot({
      path: `${SHOTS}/composeur-jointe-debordement.png`,
      clip: boite ? { x: boite.x, y: boite.y, width: boite.width, height: boite.height } : undefined,
    });

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
