#!/usr/bin/env node
/**
 * LES RÉGLAGES SONT UNE MODALE À MENU, ET CHAQUE PAGE S'OUVRE.
 *
 * Le tiroir à dix onglets a laissé place à une fenêtre en deux colonnes : le
 * menu par GROUPES à gauche, la SOUS-PAGE à droite. Ce contrôle parcourt
 * l'arborescence entière, essaie la recherche sur trois mots, et vérifie le
 * repli téléphone (le menu seul, la page qui le recouvre, un bouton de retour).
 *
 * Il fabrique une session d'UNE HEURE, la retire en partant, et n'écrit rien
 * d'autre en base. Il vise le serveur de DÉVELOPPEMENT par sa propre variable :
 * `BELUGA_URL` désigne l'application déjà publiée et n'a rien à faire ici.
 *
 *   HAIKO_REGLAGES_URL=http://localhost:7099 node scripts/verif-reglages-modale.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADRESSE = process.env.HAIKO_REGLAGES_URL || 'http://localhost:7099';
/* La base et ses dépendances natives vivent dans le dépôt PRINCIPAL, même quand
   ce script est lancé d'une copie de travail. */
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';

const echecs = [];
const constats = [];
const refuser = (message) => echecs.push(message);
const constater = (message) => constats.push(message);

/* ------------------------------------------------------------------ */
/* Première moitié : ce que la SOURCE promet                          */
/* ------------------------------------------------------------------ */

const fs = await import('node:fs');
const lire = (relatif) => fs.readFileSync(path.join(RACINE, relatif), 'utf8');

const vue = lire('web/src/components/settings-view.tsx');

if (/\bDrawer\b/.test(vue)) refuser('les réglages ouvrent encore un tiroir (Drawer) au lieu d’une modale');
else constater('les réglages s’ouvrent en modale, plus en tiroir');

if (/<Tabs\b|TabsTrigger/.test(vue)) refuser('la barre d’onglets horizontale est encore là');
else constater('plus aucune barre d’onglets');

/* L'ARBORESCENCE vit dans le socle partagé : les groupes, leurs pages et les
   mots qui y mènent. L'écran, lui, n'ajoute que l'icône et le module. */
const arbre = lire('shared/src/reglages-arborescence.ts');
/* Les PAGES sont indentées plus profond que les GROUPES qui les portent : on
   ne compte que les feuilles de l'arbre, jamais les branches. */
const declarees = [...arbre.matchAll(/^ {6,}cle: '([a-z0-9-]+)',$/gm)].map((m) => m[1]);
if (declarees.length < 15) refuser(`seulement ${declarees.length} sous-pages déclarées, 15 au moins attendues`);
else constater(`${declarees.length} sous-pages déclarées dans l’arborescence`);

/* CHAQUE SOUS-PAGE EST UN FICHIER À PART, CHARGÉ À L'OUVERTURE. Tout dans un
   seul morceau, on retéléchargerait les quinze écrans pour en ouvrir un. */
const rendus = [...vue.matchAll(/^  '?([a-z0-9-]+)'?: \{$/gm)].map((m) => m[1]);
const sansRendu = declarees.filter((cle) => !rendus.includes(cle));
if (sansRendu.length) refuser(`pages sans écran à charger : ${sansRendu.join(', ')}`);

const paresseuses = [...vue.matchAll(/paresseux\(\(\) => import\('([^']+)'\)/g)].map((m) => m[1]);
if (paresseuses.length !== declarees.length) {
  refuser(`${declarees.length} pages déclarées mais ${paresseuses.length} chargements paresseux`);
} else {
  constater('chaque sous-page est chargée paresseusement');
}

for (const module of paresseuses) {
  const fichier = module.replace('@/', 'web/src/') + '.tsx';
  if (!fs.existsSync(path.join(RACINE, fichier))) refuser(`sous-page introuvable : ${fichier}`);
}

/* L'ancien fichier de 2 635 lignes est découpé : plus rien d'énorme ici. */
const lignes = vue.split('\n').length;
if (lignes > 600) refuser(`settings-view.tsx fait encore ${lignes} lignes — le découpage n’a pas eu lieu`);
else constater(`settings-view.tsx tient en ${lignes} lignes`);

/* LE MOT « CERVEAU » NE DOIT PLUS RIEN COMMANDER. */
for (const fichier of ['web/src/components/settings-view.tsx', 'shared/src/protocol.ts', 'shared/src/index.ts']) {
  if (/cerveau/i.test(lire(fichier))) refuser(`${fichier} parle encore du cerveau`);
}
constater('l’envoi au cerveau a disparu du protocole et des réglages');

/* ------------------------------------------------------------------ */
/* Seconde moitié : ce que le NAVIGATEUR montre                        */
/* ------------------------------------------------------------------ */

/**
 * Une session d'UNE HEURE, fabriquée puis retirée : la colonne `token` garde le
 * SHA-256 du cookie, jamais le cookie.
 */
async function avecSession(travail) {
  const { default: crypto } = await import('node:crypto');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const ouvrir = () =>
    require(path.join(DONNEES, '../node_modules/better-sqlite3'))(cheminDeLaBaseServie(DONNEES));

  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const db = ouvrir();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3_600_000,
    'vérification de la modale des réglages',
  );
  db.close();
  try {
    return await travail(cookie);
  } finally {
    const fin = ouvrir();
    fin.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    fin.close();
  }
}

/** On attend un ÉTAT, jamais une durée : le serveur de dev compile à la demande. */
async function attendrePret(page) {
  for (let essai = 0; essai < 60; essai += 1) {
    if (await page.evaluate(() => window.belugaEssai?.pret?.() === true)) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

/**
 * UN TIROIR LAISSÉ OUVERT N'EST PAS UN RÉGLAGE CASSÉ. Ce contrôle vise le démon
 * RÉEL : l'application y rouvre la dernière carte consultée, et le voile de ce
 * tiroir couvre tout l'écran — chaque clic du menu tomberait en attente. On
 * referme donc ce qui traîne avant d'ouvrir les réglages.
 */
async function refermerCeQuiTraine(page) {
  for (let essai = 0; essai < 6; essai += 1) {
    const ouvert = await page.evaluate(
      () => document.querySelectorAll('[role="dialog"],[role="alertdialog"]').length,
    );
    if (!ouvert && essai > 0) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }
}

/** Les réglages s'ouvrent par l'adresse : aucun clic à deviner dans le bandeau. */
async function ouvrirLesReglages(page, cle) {
  await page.evaluate((page_) => {
    window.location.hash = page_ ? `reglages/${page_}` : 'reglages';
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, cle ?? '');
  await page.waitForSelector('[data-modale-reglages]', { timeout: 20_000 });
  await page.waitForTimeout(500);
}

async function auNavigateur() {
  const { chromium } = await import('playwright');
  return avecSession(async (session) => {
    const navigateur = await chromium.launch({ channel: 'chrome' });
    try {
      /* --------- Grand écran : les deux colonnes, toutes les pages -------- */
      const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
      await contexte.addCookies([{ name: 'beluga_session', value: session, domain: 'localhost', path: '/' }]);
      const page = await contexte.newPage();
      try {
        await page.goto(ADRESSE, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      } catch (err) {
        return `serveur de développement injoignable sur ${ADRESSE} — ${err.message.split('\n')[0]}`;
      }
      if (!(await attendrePret(page))) return 'l’application n’a jamais été prête';

      await refermerCeQuiTraine(page);
      await ouvrirLesReglages(page);
      const menu = page.locator('[data-menu-reglages]');
      if (!(await menu.isVisible())) refuser('le menu des réglages n’est pas affiché');
      else constater('le menu latéral est affiché sur grand écran');

      const groupes = await page.locator('[data-groupe-reglages]').count();
      if (groupes < 5) refuser(`${groupes} groupes affichés, 5 au moins attendus`);
      else constater(`${groupes} groupes dans le menu`);

      /* CHAQUE PAGE DU MENU S'OUVRE, et l'écran de droite change vraiment. */
      const cles = await page.locator('[data-page-menu]').evaluateAll((noeuds) =>
        noeuds.map((n) => n.getAttribute('data-page-menu')),
      );
      for (const cle of cles) {
        try {
          await page.locator(`[data-page-menu="${cle}"]`).click({ timeout: 10_000 });
        } catch (err) {
          refuser(`la page « ${cle} » ne se clique pas — ${err.message.split('\n')[0]}`);
          continue;
        }
        try {
          await page.waitForSelector(`[data-page-reglages="${cle}"]`, { timeout: 10_000 });
        } catch {
          refuser(`la page « ${cle} » ne s’ouvre pas`);
          continue;
        }
        /* CHAQUE PAGE EST CHARGÉE À LA DEMANDE : le conteneur porte son repère
           dès le clic, mais son contenu arrive un aller-retour plus tard, et
           la silhouette d’attente occupe l’écran entre les deux. On attend donc
           un ÉTAT — la silhouette partie — et non un délai : lire tout de suite
           faisait passer une page saine pour une page vide. Mais chaque page arrive
           PARESSEUSEMENT : entre le clic et son module, la zone porte la silhouette
           d’attente. Lire le texte sans attendre sa disparition, c’est mesurer la
           silhouette et croire la page vide. Une page ouverte a du contenu : un
           écran vide passerait pour une panne. */
        try {
          await page.waitForSelector('[data-silhouette="page-reglages"]', { state: 'detached', timeout: 10_000 });
        } catch {
          refuser(`la page « ${cle} » reste sur sa silhouette d’attente`);
          continue;
        }
        const texte = (await page.locator(`[data-page-reglages="${cle}"]`).innerText()) ?? '';
        if (texte.trim().length < 20) refuser(`la page « ${cle} » s’ouvre vide`);
      }
      constater(`les ${cles.length} pages du menu s’ouvrent et affichent du contenu`);

      /* L'ADRESSE SUIT LA PAGE OUVERTE : un lien doit pouvoir en désigner une. */
      const fragment = await page.evaluate(() => window.location.hash);
      if (!/^#reglages\//.test(fragment)) refuser(`l’adresse ne porte pas la sous-page : « ${fragment} »`);
      else constater(`l’adresse porte la sous-page ouverte (${fragment})`);

      /* LA RECHERCHE, SUR TROIS MOTS ÉPROUVÉS. */
      const essais = [
        { mot: 'quota', attendu: 'comptes' },
        { mot: 'sombre', attendu: 'theme' },
        { mot: 'sauvegarde', attendu: 'sauvegardes' },
      ];
      for (const { mot, attendu } of essais) {
        await page.locator('[data-recherche-reglages]').fill(mot);
        await page.waitForTimeout(400);
        const trouves = await page.locator('[data-page-menu]').evaluateAll((noeuds) =>
          noeuds.map((n) => n.getAttribute('data-page-menu')),
        );
        if (!trouves.includes(attendu)) {
          refuser(`« ${mot} » ne mène pas à la page « ${attendu} » (trouvé : ${trouves.join(', ') || 'rien'})`);
        }
      }
      constater('la recherche mène aux bonnes pages sur « quota », « sombre » et « sauvegarde »');

      await page.locator('[data-recherche-reglages]').fill('xyzzy');
      await page.waitForTimeout(300);
      if ((await page.locator('[data-aucun-reglage-trouve]').count()) === 0) {
        refuser('une recherche sans résultat n’affiche pas son message');
      } else {
        constater('une recherche sans résultat le DIT');
      }

      /* --------------------- Repli téléphone ---------------------------- */
      const etroit = await navigateur.newContext({ viewport: { width: 390, height: 844 } });
      await etroit.addCookies([{ name: 'beluga_session', value: session, domain: 'localhost', path: '/' }]);
      const petit = await etroit.newPage();
      await petit.goto(ADRESSE, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      if (!(await attendrePret(petit))) return 'l’application étroite n’a jamais été prête';
      await refermerCeQuiTraine(petit);
      await ouvrirLesReglages(petit);

      const menuEtroit = petit.locator('[data-menu-reglages]');
      if (!(await menuEtroit.isVisible())) refuser('sur téléphone, le menu n’est pas affiché à l’ouverture');
      else constater('sur téléphone, la modale s’ouvre sur le menu');

      const premiere = await petit.locator('[data-page-menu]').first().getAttribute('data-page-menu');
      await petit.locator(`[data-page-menu="${premiere}"]`).click();
      await petit.waitForTimeout(500);
      if (await menuEtroit.isVisible()) refuser('sur téléphone, la page ne recouvre pas le menu');
      else constater('sur téléphone, la page choisie recouvre le menu');

      const retour = petit.locator('[data-retour-menu-reglages]');
      if (!(await retour.isVisible())) {
        refuser('sur téléphone, le bouton de retour est absent');
      } else {
        await retour.click();
        await petit.waitForTimeout(400);
        if (!(await menuEtroit.isVisible())) refuser('le retour ne ramène pas au menu');
        else constater('le bouton de retour ramène au menu');
      }
      return null;
    } finally {
      await navigateur.close();
    }
  });
}

let panne = null;
try {
  panne = await auNavigateur();
} catch (err) {
  panne = `contrôle au navigateur impossible — ${err.message.split('\n')[0]}`;
}

for (const message of constats) console.log(`  ok  ${message}`);
for (const message of echecs) console.log(`  NON ${message}`);
if (panne) {
  console.log(`\n${panne}`);
  process.exit(1);
}
console.log(`\n${constats.length} contrôles au vert, ${echecs.length} refus`);
process.exit(echecs.length ? 1 : 0);
