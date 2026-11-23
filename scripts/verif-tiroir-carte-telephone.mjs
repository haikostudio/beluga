#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur, de la PAGE d'une carte ÉPURÉE sur
 * téléphone (`web/src/components/card-panel.tsx`) — l'ancien « tiroir de
 * carte », d'où le nom du script :
 *
 *  - les tags (état, étiquettes, « modifiée », archivage) sont REPLIÉS par
 *    défaut ; sur un écran de 390 px un appui sur le « i » de la barre du titre
 *    (`BulleInfo`) les déplie, un second les replie ; sur un écran large ils
 *    sont repliés derrière le même « i », que la souris ouvre en passant ;
 *  - les quatre destinations de la carte (conversation, commentaires,
 *    facturation, GitHub) restent à portée sur téléphone : en tête de son menu
 *    à trois points ;
 *  - LES DEUX ZONES SÛRES sont respectées : avec une barre d'état de 47 ou
 *    59 px et une barre d'accueil de 34 px, rien de la page — barre d'en-tête,
 *    titre, barre des étapes, champ d'écriture — ne passe sous l'un des deux
 *    bords, et la page ne perd QUE ce que le système lui prend : sa barre
 *    d'en-tête commence au ras de l'écran sans zone sûre, au ras de la barre
 *    d'état avec (`scripts/lib/zone-sure.mjs`).
 *
 * RECALÉ SUR LA REFONTE (11/10/2026). « PLUS AUCUN TIROIR : TOUT S'OUVRE EN
 * PAGE » : la carte s'ouvre en page (`[data-page-carte]`). Ce qui a changé ici :
 *  - le chevron à droite du titre n'existe plus — état, étiquettes et date
 *    vivent derrière le « i » de la barre d'en-tête, sur téléphone ET sur
 *    ordinateur. L'affirmation « ordinateur : les tags sont visibles d'emblée »
 *    est donc retirée (elle dirait le contraire de la règle), remplacée par
 *    « repliés, et le « i » les montre » ;
 *  - la rangée d'onglets a disparu de la page : sur téléphone les quatre
 *    destinations sont des lignes du menu à trois points
 *    (`[data-onglet-carte]`), sur ordinateur des lignes de la colonne de
 *    gauche. L'affirmation est traduite, pas retirée ;
 *  - le PLAFOND du tiroir (« écran moins 10 px », « ne perd que la barre
 *    d'état ») portait sur la forme de la feuille du bas. Une page couvre
 *    l'écran et retient son contenu par sa marge : les deux affirmations sont
 *    traduites sur le haut de la barre d'en-tête, mêmes tolérances.
 * Le même terrain est aussi parcouru, sur une vraie carte, par
 * `scripts/verif-parcours-telephone.mjs`.
 *
 * Tout est SIMULÉ : la carte est injectée dans le canal temps réel, comme le
 * font `verif-signal-attention.mjs` et `verif-carte-sans-suite.mjs`. Rien n'est
 * écrit en base à part la session d'essai, retirée en partant.
 *
 *   HAIKO_TIROIR_URL=http://localhost:7099 node scripts/verif-tiroir-carte-telephone.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  ZONES_SURES_TYPES,
  formaterReleve,
  poserZonesSures,
  relever,
  retirerZonesSures,
  verifierLesDeuxBords,
} from './lib/zone-sure.mjs';
import { cheminDeLaBaseServie } from './base-servie.mjs';

/* La racine se déduit du script : lancé depuis une copie de travail, il juge CE
   code-là, jamais celui du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_TIROIR_URL || 'http://localhost:7099';
/* La base se résout comme le démon la résout (`base-servie.mjs`) : viser une
   copie de carte faisait échouer ce contrôle sur « no such table: sessions ». */
const FICHIER_BASE = cheminDeLaBaseServie();

function poserSession() {
  const db = new Database(FICHIER_BASE);
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification tiroir téléphone',
  );
  db.close();
  return { cookie, retirer: () => retirerSession(cookie) };
}

function retirerSession(cookie) {
  const db = new Database(FICHIER_BASE);
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

const INIT_INJECTION = () => {
  window.__ecouteurs = [];
  const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
  Object.defineProperty(WebSocket.prototype, 'onmessage', {
    configurable: true,
    get() {
      return propriete.get.call(this);
    },
    set(ecouteur) {
      window.__ecouteurs.push(ecouteur);
      return propriete.set.call(this, ecouteur);
    },
  });
  window.__injecter = (evenement) => {
    const donnees = JSON.stringify(evenement);
    for (const ecouteur of window.__ecouteurs) ecouteur({ data: donnees });
  };
};

/** Poser la carte d'essai dans le projet ouvert, puis ouvrir sa page. */
async function ouvrirCarte(page, { mobile } = {}) {
  // Sur téléphone, l'app s'ouvre souvent sur le « Chef » : on ramène le tableau.
  if (mobile) {
    // LE BOUTON SE VISE PAR SON REPÈRE, PAS PAR SON LIBELLÉ : l'interface
    // existe en cinq langues, et « Tableau » ne s'affiche que dans l'une
    // d'elles — sur un compte réglé en anglais, ce clic ne trouvait rien et le
    // contrôle échouait sur « aucun projet affiché par le tableau ».
    for (let essai = 0; essai < 3 && !(await page.locator('[data-tableau]').count()); essai++) {
      await page
        .locator('[data-menu-bas] button')
        .first()
        .click()
        .catch(() => {});
      await page
        .locator('[data-tableau]')
        .first()
        .waitFor({ state: 'attached', timeout: 5000 })
        .catch(() => undefined);
    }
  }
  // LE TABLEAU DIT LE PROJET QU'IL MONTRE (`data-tableau`) : sur téléphone la
  // colonne de gauche est masquée, et sa rangée surlignée ne se lit pas.
  const projectId = await page.evaluate(() => {
    const tableau = document.querySelector('[data-tableau]')?.getAttribute('data-tableau');
    if (tableau) return tableau;
    const actif = Array.from(document.querySelectorAll('[data-drag-id]')).find((el) =>
      el.className.includes('bg-raised'),
    );
    return (
      actif?.getAttribute('data-drag-id') ??
      document.querySelector('[data-drag-kind="project"]')?.getAttribute('data-drag-id') ??
      null
    );
  });
  if (!projectId) throw new Error('aucun projet affiché par le tableau');

  const cardId = 'essai-tiroir-telephone';
  const description = 'Consigne volontairement longue pour rendre l’onglet Détails défilable. '.repeat(120);
  await page.evaluate(
    ([projectId, cardId, description]) => {
      window.__injecter({
        type: 'card.upsert',
        card: {
          id: cardId,
          projectId,
          title: 'Essai — tiroir épuré sur téléphone',
          description,
          labels: ['formation', 'RAG', 'illustrations', 'contenu'],
          column: 'running',
          position: 1,
          origin: 'user',
          run: { engine: 'codex', mode: 'direct' },
          excludedFromDeploy: false,
          horsTache: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
    },
    [projectId, cardId, description],
  );
  await page.waitForTimeout(700);
  // Une page restaurée d'un état précédent couvrirait le tableau : on la ferme.
  for (let i = 0; i < 3 && (await page.locator('[role="dialog"]').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  const colonne = page.locator('[data-column="running"]').first();
  await colonne.scrollIntoViewIfNeeded().catch(() => {});
  await page.locator(`[data-carte="${cardId}"]`).first().click();
  /*
   * LA PAGE S'OUVRE EN SILHOUETTE, ET C'EST LA VRAIE QU'ON JUGE. Le journal et
   * le fil d'une carte sont réclamés au serveur à l'ouverture ; cette carte-là
   * est INJECTÉE dans le canal, ils n'arriveront donc jamais, et la page
   * garde sa silhouette jusqu'à son délai de douze secondes
   * (`TiroirDeCarte`, `card-panel.tsx`). On ATTEND cet état — la silhouette
   * partie — au lieu de compter 900 ms : sans quoi les contrôles jugeaient un
   * entête gris, sans « i » ni étiquettes.
   */
  await page
    .locator('[data-silhouette="tiroir-carte"]')
    .waitFor({ state: 'detached', timeout: 20000 })
    .catch(() => undefined);
  await page.locator(`[data-page-carte="${cardId}"]`).first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(600);
  return cardId;
}

/*
 * LE DÉFILEMENT QUI CACHE LA BARRE D'ONGLETS n'est plus jugé ici : il l'était
 * sur un onglet « Détails » qui n'existe plus dans la rangée (Conversation,
 * Commentaires, Facturation, GitHub). Ce comportement est vérifié, sur un vrai
 * flux, par `scripts/verif-parcours-telephone.mjs`.
 */
const tagsPresents = (page) => page.locator('[data-tags-carte]').count();
/* L'ANCIEN CHEVRON : il ne doit plus exister nulle part. */
const chevron = (page) =>
  page.locator('button[aria-label="Afficher les étiquettes"], button[aria-label="Masquer les étiquettes"]');
/* LE « i » DE LA BARRE DU TITRE, qui range l'état, les étiquettes et la date. */
const PAGE_DE_CARTE = '[data-page-carte="essai-tiroir-telephone"]';
const boutonInfo = (page) => page.locator(`${PAGE_DE_CARTE} [data-entete-de-zone] [data-bulle-info-bouton]`);
/** Referme un menu ouvert sans jamais donner un Échap de trop : il refermerait la page. */
async function refermerLesMenus(page) {
  for (let i = 0; i < 3 && (await page.locator('[role="menu"][data-state="open"]').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  const session = poserSession();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });

  const nouvelOnglet = async (viewport, { tactile = false } = {}) => {
    const context = await browser.newContext({
      viewport,
      /* Le téléphone se joue AU DOIGT : le « i » s'ouvre d'un appui, pas d'un survol. */
      ...(tactile ? { isMobile: true, hasTouch: true } : {}),
      locale: 'fr-CH',
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    });
    await context.addCookies([
      {
        name: 'beluga_session',
        value: session.cookie,
        url: new URL(BASE).origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();
    await page.addInitScript(INIT_INJECTION);
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    page.setDefaultTimeout(8000);
    return { context, page };
  };

  const erreurs = [];

  /* ---------------- Téléphone ---------------- */
  {
    const { context, page } = await nouvelOnglet({ width: 390, height: 844 }, { tactile: true });
    page.on('pageerror', (e) => erreurs.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));

    await ouvrirCarte(page, { mobile: true });

    record('téléphone : les tags sont masqués par défaut', (await tagsPresents(page)) === 0);
    record(
      'téléphone : un « i » s’affiche à côté du titre, et plus aucun chevron',
      (await boutonInfo(page).count()) === 1 &&
        (await boutonInfo(page).isVisible()) &&
        (await chevron(page).count()) === 0,
    );

    await boutonInfo(page).tap();
    await page.waitForTimeout(400);
    record('un appui sur le « i » déplie les tags', (await tagsPresents(page)) > 0);

    await boutonInfo(page).tap();
    await page.waitForTimeout(400);
    record('un second appui les replie', (await tagsPresents(page)) === 0);

    /* LES QUATRE DESTINATIONS NE SONT PLUS UNE RANGÉE D'ONGLETS : sur téléphone
       ce sont les premières lignes du menu à trois points de la carte. */
    await page.locator(`${PAGE_DE_CARTE} [data-menu-de-carte]`).first().tap();
    await page.locator('[role="menu"][data-state="open"]').first().waitFor({ state: 'visible', timeout: 8000 });
    record(
      'les onglets sont là, sur leurs quatre lignes du menu de la carte',
      (await page.locator('[role="menu"] [data-onglet-carte]').count()) >= 3,
      `${await page.locator('[role="menu"] [data-onglet-carte]').count()} ligne(s)`,
    );
    await refermerLesMenus(page);

    /* ---------- LES DEUX ZONES SÛRES, RELEVÉES PAR LE MODULE COMMUN ----------
       La carte est une PAGE : son cadre (`[data-tiroir]`) couvre tout l'écran,
       barre d'état comprise, et c'est sa marge intérieure qui retient le
       contenu. Le repère « tiroir » du module vise donc le CONTENU de la page
       (`[data-page-carte]`), pas sa peinture. Tous les repères sont cherchés
       DANS la page de la carte : un champ d'écriture resté monté dessous ne
       doit pas répondre à sa place. */
    const reperes = {
      tiroir: PAGE_DE_CARTE,
      'barre d’en-tête': `${PAGE_DE_CARTE} [data-entete-de-zone]`,
      titre: `${PAGE_DE_CARTE} [data-titre-carte]`,
      'barre des étapes': `${PAGE_DE_CARTE} [data-barre-etapes]`,
      'champ d’écriture': `${PAGE_DE_CARTE} [data-composer]`,
    };

    for (const zone of ZONES_SURES_TYPES) {
      const releve = await verifierLesDeuxBords(page, {
        record,
        reperes,
        haut: zone.haut,
        bas: zone.bas,
        etiquette: `téléphone, ${zone.nom}`,
      });
      console.log(formaterReleve(releve, `    — relevé « ${zone.nom} » —`));
    }

    /* SANS ZONE SÛRE, LA PAGE NE PERD PAS UN PIXEL : c'est la garantie
       qu'aucun ordinateur ni Android sans encoche ne bouge. Avec une zone sûre,
       elle ne perd QUE ce que le système lui prend — la marge de la barre
       d'état se compte une fois, pas deux (la feuille la réserve, la barre
       d'en-tête ne la réserve plus). Le plafond d'un tiroir n'existe plus : on
       lit le haut de la barre d'en-tête de la page. */
    const enTete = { 'barre d’en-tête': `${PAGE_DE_CARTE} [data-entete-de-zone]` };
    await poserZonesSures(page, { haut: 0, bas: 0 });
    await page.waitForTimeout(300);
    const sansZone = (await relever(page, { reperes: enTete })).mesures['barre d’en-tête'];
    await poserZonesSures(page, { haut: 59, bas: 34 });
    await page.waitForTimeout(300);
    const avecZone = (await relever(page, { reperes: enTete })).mesures['barre d’en-tête'];
    const mesuree = !!sansZone?.visible && !!avecZone?.visible;
    const perte = mesuree ? avecZone.haut - sansZone.haut : NaN;
    record(
      'sans zone sûre, la page ne perd pas un pixel : sa barre d’en-tête touche le haut de l’écran',
      mesuree && sansZone.haut === 0,
      mesuree ? `barre d’en-tête à ${sansZone.haut} px du haut` : 'barre d’en-tête introuvable',
    );
    record(
      'la page ne perd que la hauteur de la barre d’état',
      mesuree && Math.abs(perte - 59) <= 2,
      mesuree ? `perdu ${perte} px pour 59 px de barre d’état` : 'barre d’en-tête introuvable',
    );
    await retirerZonesSures(page);

    await context.close();
  }

  /* ---------------- Ordinateur ---------------- */
  {
    const { context, page } = await nouvelOnglet({ width: 1440, height: 900 });
    page.on('pageerror', (e) => erreurs.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));

    await ouvrirCarte(page);
    /* Sur ordinateur aussi, état, étiquettes et date vivent derrière le « i » :
       ils ne s'étalent plus sous le titre. La souris l'ouvre en passant. */
    record(
      'ordinateur : les tags sont repliés derrière le « i » de la barre du titre',
      (await tagsPresents(page)) === 0 && (await boutonInfo(page).count()) === 1,
    );
    await boutonInfo(page).hover();
    await page.waitForTimeout(400);
    record('ordinateur : le « i » les montre', (await tagsPresents(page)) > 0);
    record('ordinateur : aucun chevron', (await chevron(page).count()) === 0);

    await context.close();
  }

  record('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await browser.close();
  session.retirer();

  const rates = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés.`);
  if (rates.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
