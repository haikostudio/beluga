#!/usr/bin/env node
/**
 * Le bloc de publication repart-il à zéro après une mise en ligne réussie ?
 *
 * On ouvre le tableau, sur téléphone, sur un projet dont la DERNIÈRE publication
 * a réussi et qui a de nouveau des cartes prêtes à partir. On vérifie que le
 * geste « Déployer » est là, et que le rapport du passage précédent — ses
 * étapes cochées, son pourcentage — a bien laissé la place.
 *
 * OÙ VIT LE GESTE (retouches du 11/10/2026) : sur téléphone, « À déployer »
 * n'a plus de pied « Tout déployer » ni d'onglet de colonne, et le bas de
 * l'écran ne porte plus de barre « Tableau ». Le geste est la PREMIÈRE LIGNE du
 * menu à trois points de la barre d'en-tête (`data-menu-general` →
 * `data-menu-deployer`) ; elle ouvre la page du déroulé, au pied de laquelle vit
 * le bouton qui lance (`data-lancer-depuis-la-page`). Menu fermé, c'est le
 * bouton à trois points qui dirait un avancement resté affiché
 * (`data-pourcent-menu`, `data-publication`).
 *
 * Rien n'est lancé : le contrôle ouvre un menu puis une page, il ne touche
 * jamais le bouton de lancement. (Refermer une carte restée ouverte, en
 * revanche, efface le souvenir de cette carte dans les réglages du serveur visé.)
 *
 *   BELUGA_VERIF_URL=http://localhost:7099 node scripts/verif-bloc-publication.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/* On vise le serveur de DÉVELOPPEMENT : BELUGA_URL, posée pour les agents,
   pointe l'application déjà publiée — on y verrait l'ancienne version. */
const BASE = process.env.BELUGA_VERIF_URL || 'http://localhost:7099';
/* LA BASE RÉELLEMENT SERVIE : `beluga.db`, dans le dossier de données du serveur
   (`server/src/config.ts`) — jamais celui, vide, d'une copie de carte. */
const BASE_DB = (() => {
  const dossier = process.env.BELUGA_DATA_REEL || '/root/beluga/data';
  return path.join(dossier, 'beluga.db');
})();

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Une session valable, posée directement en base : on vérifie l'écran, pas le mur d'accès. */
function poserSession() {
  const db = new Database(BASE_DB);
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification bloc de publication',
  );
  db.close();
  return { token, empreinte };
}

function retirerSession(empreinte) {
  const db = new Database(BASE_DB);
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

/** Un projet dont la dernière publication a RÉUSSI : c'est le cas qui nous intéresse. */
function projetPublieRecemment() {
  const db = new Database(BASE_DB, { readonly: true });
  const ligne = db
    .prepare(
      `SELECT d.project_id AS id, d.state AS etat, p.name AS nom
         FROM deploys d JOIN projects p ON p.id = d.project_id
        ORDER BY d.started_at DESC LIMIT 1`,
    )
    .get();
  db.close();
  return ligne;
}

async function main() {
  const projet = projetPublieRecemment();
  if (!projet || projet.etat !== 'success') {
    console.log('Aucune publication réussie en base : rien à vérifier ici.');
    process.exit(0);
  }
  console.log(`Projet : ${projet.nom} (dernière publication : ${projet.etat})`);

  const { token, empreinte } = poserSession();
  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await navigateur.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'beluga_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  /* L'application rouvre là où on l'avait quittée : une carte restée ouverte se
     ROUVRE seule, en PAGE par-dessus le tableau (`data-page-de-zone` — plus de
     voile à chercher). On referme ce qui traîne, par sa flèche de retour, avant
     de viser quoi que ce soit. */
  for (let essai = 0; essai < 3; essai += 1) {
    if (!(await page.locator('[data-page-de-zone]:visible').count())) break;
    const retour = page.locator('[data-page-de-zone] [data-retour-carte]:visible').first();
    if (await retour.count()) await retour.click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
  }
  /* Plus de bouton « Tableau » à activer (le bas de l'écran ne porte plus qu'un
     bouton « Nouvelle tâche »), ni d'onglet « À déployer » : sur téléphone, les
     colonnes se suivent dans une bande qu'on fait glisser, et le geste de
     publication n'est dans aucune d'elles. */

  /* MENU FERMÉ : ce que le tableau montre d'une publication passée. Le bouton à
     trois points est le seul endroit où un avancement resterait affiché. */
  const options = page.locator('[data-entete-de-zone] [data-menu-general]:visible').first();
  const aOptions = (await options.count()) > 0;
  const repos = aOptions
    ? await options.evaluate((el) => ({
        publication: el.getAttribute('data-publication'),
        pourcent: el.querySelector('[data-pourcent-menu]')?.textContent?.trim() ?? null,
      }))
    : null;
  const texte = await page.locator('body').innerText();

  /* On vise la ligne par son attribut DOM, jamais par sa seule étiquette : elle
     porte, en valeur, le nombre de ce qui attend de partir. */
  if (aOptions) await options.click();
  const ligne = page.locator('[role="menu"] [data-menu-deployer]');
  const aLigne = aOptions && (await ligne.first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false));
  const libelle = aLigne ? ((await ligne.first().textContent()) ?? '').trim() : '';
  // Ce qui attend vraiment de partir : la valeur du repère, redite à droite de la ligne.
  const enAttente = aLigne ? Number((await ligne.first().getAttribute('data-menu-deployer')) ?? 0) : 0;
  const enTete = aLigne
    ? await page.locator('[role="menu"] [role="menuitem"]').first().evaluate((el) => el.hasAttribute('data-menu-deployer'))
    : false;
  noter(
    'la ligne « Déployer » est présente, en tête du menu à trois points',
    aLigne && enTete && /^Déployer/.test(libelle) && !/%/.test(libelle),
    aOptions ? libelle : 'pas de bouton à trois points dans la barre d’en-tête',
  );

  // Le déploiement sur l'instance de dev n'est pas touché : seule la MISE EN
  // PRODUCTION demande confirmation. La ligne ouvre la PAGE du déroulé, et le
  // bouton qui lance, au pied de cette page, n'est pas un déclencheur de modale —
  // on le CONSTATE sans le cliquer, pour ne rien publier sur ce serveur.
  let ouvreModale = false;
  let aLancement = false;
  let libelleLancement = '';
  if (aLigne) {
    ouvreModale = await ligne.first().evaluate((el) => el.getAttribute('aria-haspopup') === 'dialog');
    await ligne.first().click();
    const lancement = page.locator('[data-page-de-zone] [data-lancer-depuis-la-page]');
    aLancement = await lancement.first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
    if (aLancement) {
      libelleLancement = ((await lancement.first().textContent()) ?? '').trim();
      ouvreModale = ouvreModale || (await lancement.first().evaluate((el) => el.getAttribute('aria-haspopup') === 'dialog'));
    }
    /* On repart par la flèche de la page, sans rien avoir lancé. */
    const retour = page.locator('[data-page-de-zone] [data-retour-de-page]:visible').first();
    if (await retour.count()) await retour.click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  }
  noter(
    'la ligne ouvre la page du déroulé, qui porte le bouton « Déployer » à son pied',
    aLancement && /Déployer/.test(libelleLancement),
    libelleLancement,
  );
  noter('« Déployer » n’ouvre pas de modale de confirmation', aLancement && !ouvreModale);

  const rapport = /Publié\s*(\([^)]*\))?\s*:\s*\d+\s*tâche/.test(texte);
  const etapes = texte.includes('Redémarrage du serveur') && texte.includes('Fusion des branches');
  const suiviReste = !!repos && (repos.pourcent !== null || repos.publication === 'en-route' || repos.publication === 'tombee');

  // Une publication réussie repart VIERGE : sur le tableau, plus de compte rendu
  // ni d'étapes, plus de pourcentage sur le bouton à trois points, qu'un nouveau
  // lot attende (enAttente > 0) ou non.
  noter(
    'le rapport de la publication précédente a laissé la place',
    aOptions && !rapport && !etapes && !suiviReste,
    `lot en attente : ${enAttente}${repos ? ` — bouton à trois points : ${JSON.stringify(repos)}` : ''}`,
  );

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await context.close();
  await navigateur.close();
  retirerSession(empreinte);

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
