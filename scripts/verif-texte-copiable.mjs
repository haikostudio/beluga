#!/usr/bin/env node
/**
 * UN TEXTE AFFICHÉ RESTE DANS SON CADRE, ET SE COPIE À LA SOURIS.
 *
 * Deux endroits vivent dans un conteneur volontairement « non sélectionnable »
 * — une carte du tableau se TIRE d'une colonne à l'autre, un message passager
 * se BALAIE vers la gauche. Leur texte héritait de ce refus : impossible de
 * surligner le titre d'une carte ni un message d'erreur pour le copier. Et
 * comme ce texte n'avait pas non plus de coupure de mot, un titre portant un
 * long chemin sans espace sortait du cadre de sa carte.
 *
 * Six constats, dans un vrai navigateur :
 *  1. le titre d'une carte au mot interminable tient dans la largeur du cadre ;
 *  2. il se surligne au glissé de souris, et la carte ne bouge pas de colonne ;
 *  3. ce glissé n'ouvre PAS le tiroir de la carte (il termine par un clic) ;
 *  4. un clic normal, lui, ouvre toujours le tiroir ;
 *  5. le texte d'un message passager tient dans son cadre et se surligne aussi ;
 *  6. un message d'ERREUR porte un bouton « copier » qui emporte tout son texte
 *     d'un seul clic, sans écarter le message.
 *
 * Se lance contre le serveur de développement :
 *   npm run dev --workspace web -- --port 7117
 *   node scripts/verif-texte-copiable.mjs
 *
 * PIÈGE : HAIKODEV_URL désigne l'application PUBLIÉE — on viserait l'ancienne
 * version. L'essai a sa propre variable.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { creerResultats } from './lib/verif-resultats.mjs';

// Le dépôt d'où PART ce script — jamais /root/haikodev en dur.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7117';
const DB = process.env.HAIKODEV_DB || '/root/haikodev/data/haikodev.db';

/* Un mot sans la moindre coupure : c'est lui qui faisait sortir le titre du
   cadre. Ni tiret ni barre oblique — le navigateur y couperait tout seul, et le
   contrôle passerait sans rien prouver. Le préfixe « Carte d'essai » est celui
   que le ménage (`scripts/nettoyer-essais.mjs`) sait retirer. */
const MOT_SANS_COUPURE = `IMG${'0987654321'.repeat(9)}capturedecranenregistree.jpeg`;
const TITRE = `Carte d'essai — texte copiable ${MOT_SANS_COUPURE}`;
const CARTE_ID = 'essai-texte-copiable';
const MESSAGE = `Échec de la commande /root/haikodev/${MOT_SANS_COUPURE} — impossible d'écrire`;

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
    'vérification texte copiable',
  );
  return { cookie, empreinte };
}

/** La carte d'essai, posée en « Notes » : aucune ne s'y lance toute seule. */
function poserLaCarte(db, projet) {
  const maintenant = Date.now();
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, 'notes', 999999, ?, '{}', ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, column_key = 'notes', updated_at = excluded.updated_at`,
  ).run(CARTE_ID, projet.id, TITRE, maintenant, maintenant);
}

function retirerLaCarte(db) {
  db.prepare('DELETE FROM cards WHERE id = ?').run(CARTE_ID);
}

async function main() {
  const db = new Database(DB);
  const projet = db.prepare("SELECT id, name FROM projects WHERE path = '/root/haikodev'").get();
  if (!projet) throw new Error("le projet HaikoDev est introuvable dans la base : rien à afficher");
  const { cookie, empreinte } = poserSession(db);
  poserLaCarte(db, projet);

  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    // Le presse-papiers, pour juger le bouton « copier » d'un message d'erreur.
    permissions: ['clipboard-read', 'clipboard-write'],
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
    await page.waitForTimeout(4500);

    if (await page.locator('[role="dialog"]').first().isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }

    /*
     * HaikoDev ne vit PAS dans la liste des projets : c'est l'espace de
     * développement, épinglé tout en haut de la colonne sous le nom
     * « Développement » (`data-espace-dev`). Le chercher par son nom de base ne
     * donnait rien — d'où le repli, qui vaut pour un projet ordinaire.
     */
    const espaceDev = page.locator(`[data-espace-dev="${projet.id}"]`).first();
    const ligneProjet = (await espaceDev.count())
      ? espaceDev
      : page.getByText(projet.name, { exact: true }).first();
    if (!(await ligneProjet.count())) {
      throw new Error(`le projet « ${projet.name} » reste introuvable dans la colonne de gauche`);
    }
    await ligneProjet.click({ force: true });
    await page.waitForTimeout(3000);

    const carte = page.locator(`[data-carte="${CARTE_ID}"]`).first();
    await carte.waitFor({ state: 'visible', timeout: 20000 });
    await carte.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);

    /* -------------------- 1. Le titre tient dans le cadre -------------------- */
    const mesure = await page.evaluate((id) => {
      const article = document.querySelector(`[data-carte="${id}"]`);
      const titre = article?.querySelector('[data-carte-texte]');
      if (!article || !titre) return null;
      const cadre = article.getBoundingClientRect();
      const style = window.getComputedStyle(article);
      return {
        droiteCadre: cadre.right - parseFloat(style.paddingRight || '0'),
        droiteTitre: titre.getBoundingClientRect().right,
        debordement: titre.scrollWidth - titre.clientWidth,
        hauteur: titre.getBoundingClientRect().height,
      };
    }, CARTE_ID);

    if (!mesure) {
      record('Le titre de la carte a pu être mesuré', false, 'titre introuvable');
    } else {
      record(
        'Le titre au mot interminable reste dans le cadre de sa carte',
        mesure.debordement <= 1 && mesure.droiteTitre <= mesure.droiteCadre + 1,
        `${mesure.debordement.toFixed(0)} px hors champ, titre haut de ${mesure.hauteur.toFixed(0)} px`,
      );
    }

    /* --------- 2 et 3. Le glissé surligne, il ne déplace ni n'ouvre --------- */
    const boite = await carte.locator('[data-carte-texte]').first().boundingBox();
    if (!boite) {
      record('Le titre a pu être visé à la souris', false, 'cadre introuvable');
    } else {
      // La PREMIÈRE ligne du titre : c'est là que vivent les mots ordinaires.
      // Le milieu vertical tomberait au cœur du mot insécable, que le
      // navigateur coupe où il veut — un point de départ qui ne prouve rien.
      const y = boite.y + 8;
      await page.mouse.move(boite.x + 4, y);
      await page.mouse.down();
      await page.mouse.move(boite.x + Math.min(boite.width - 6, 220), y, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(600);

      const surligne = await page.evaluate(() => (window.getSelection()?.toString() || '').trim());
      record(
        'Le titre d’une carte se surligne au glissé de souris',
        surligne.length > 2,
        surligne ? `« ${surligne.slice(0, 40)} »` : 'aucune sélection',
      );

      const tiroir = await page.locator('[role="dialog"]').first().isVisible().catch(() => false);
      record('Surligner un titre n’ouvre pas le tiroir de la carte', !tiroir);
      if (tiroir) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(800);
      }

      const colonne = await page.evaluate(
        (id) => document.querySelector(`[data-carte="${id}"]`)?.closest('[data-column]')?.getAttribute('data-column'),
        CARTE_ID,
      );
      record('La carte n’a pas changé de colonne pendant le surlignage', colonne === 'notes', String(colonne));
    }

    /* ------------------- 4. Un clic normal ouvre toujours ------------------- */
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await carte.click({ position: { x: 8, y: 6 } });
    await page.waitForTimeout(1500);
    const ouvert = await page.locator('[role="dialog"]').first().isVisible().catch(() => false);
    record('Un clic simple ouvre toujours la carte', ouvert);
    if (ouvert) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }

    /* ------------------ 5. Le message passager, même règle ------------------ */
    await page.evaluate((texte) => {
      window.haikodevEssai?.message('error', texte);
    }, MESSAGE);
    await page.waitForTimeout(900);

    const texteMessage = page.locator('[data-toast-texte]').first();
    const vu = await texteMessage.isVisible().catch(() => false);
    if (!vu) {
      record('Le message passager s’affiche', false, 'point d’essai absent (mode production ?)');
    } else {
      const cadreMessage = await page.evaluate(() => {
        const bloc = document.querySelector('[data-toast-texte]');
        const toast = bloc?.closest('[data-toast]');
        if (!bloc || !toast) return null;
        return {
          debordement: bloc.scrollWidth - bloc.clientWidth,
          droiteBloc: bloc.getBoundingClientRect().right,
          droiteToast: toast.getBoundingClientRect().right,
        };
      });
      record(
        'Le texte d’un message tient dans son cadre',
        !!cadreMessage && cadreMessage.debordement <= 1 && cadreMessage.droiteBloc <= cadreMessage.droiteToast + 1,
        cadreMessage ? `${cadreMessage.debordement.toFixed(0)} px hors champ` : 'introuvable',
      );

      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      const boiteMessage = await texteMessage.boundingBox();
      if (boiteMessage) {
        const y = boiteMessage.y + 6;
        await page.mouse.move(boiteMessage.x + 3, y);
        await page.mouse.down();
        await page.mouse.move(boiteMessage.x + Math.min(boiteMessage.width - 5, 200), y, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(400);
        const surligneMessage = await page.evaluate(() => (window.getSelection()?.toString() || '').trim());
        record(
          'Le texte d’un message se surligne à la souris',
          surligneMessage.length > 2,
          surligneMessage ? `« ${surligneMessage.slice(0, 40)} »` : 'aucune sélection',
        );
      }

      /* ------ 6. Le bouton « copier » d'un message d'erreur, d'un clic ------ */
      const bouton = page.locator('[data-toast-copier]').first();
      const boutonVu = await bouton.isVisible().catch(() => false);
      record('Un message d’erreur porte son bouton « copier »', boutonVu);
      if (boutonVu) {
        await page.evaluate(() => navigator.clipboard.writeText('presse-papiers vide'));
        await bouton.click();
        await page.waitForTimeout(500);
        const emporte = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
        record(
          'Le clic emporte le texte entier du message',
          emporte.trim() === MESSAGE.trim(),
          emporte ? `« ${emporte.slice(0, 40)} »` : 'presse-papiers vide',
        );
        // Le message reste : copier n'est pas écarter.
        record('Copier n’écarte pas le message', await page.locator('[data-toast]').first().isVisible());
      }
    }

    record('Aucune erreur de page pendant le contrôle', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await browser.close().catch(() => {});
    retirerLaCarte(db);
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
