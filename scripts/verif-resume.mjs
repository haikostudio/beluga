#!/usr/bin/env node
/**
 * LA PAGE « RÉSUMÉ », DANS UN VRAI NAVIGATEUR (refonte du 06/10/2026).
 *
 * Un démon JETABLE (base neuve, `scripts/lib/demon-d-essai.mjs`) sert la page
 * construite (`web/dist`) et le code de CETTE copie de travail : le démon en
 * service n'est jamais touché, aucun quota n'est dépensé. La base d'essai
 * reçoit un décor connu — 45 tâches réparties sur vingt jours, des
 * consultations de mémoire, des fiches de coffre dont un champ porte un
 * MARQUEUR — puis le navigateur vérifie :
 *
 *  1. la colonne des rubriques (onze entrées) et la période en haut à droite ;
 *  2. un vrai tableau : entête triable (sens naturel, inverse, ordre du
 *     serveur), pied « X–Y sur N », 10 · 20 · 50 lignes, flèches de page ;
 *  3. un changement de période relance la demande de la rubrique AVEC ses
 *     bornes, et la liste suit ;
 *  4. une période plus longue que les données le DIT (pas de faux zéros) ;
 *  5. les onze rubriques s'ouvrent sans erreur ;
 *  6. le coffre ne laisse sortir AUCUN champ de fiche ;
 *  7. sur téléphone (390 px) : la liste déroulante remplace la colonne, et la
 *     page ne déborde pas en largeur.
 *
 *   node scripts/verif-resume.mjs
 *   HAIKO_RESUME_PORT=7231 node scripts/verif-resume.mjs   (un autre port)
 *
 * Captures : data/verification/resume-*.png
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { Session } from './lib/session-beluga.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKO_RESUME_PORT || 7231);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(RACINE, 'data', 'verification');
fs.mkdirSync(SHOTS, { recursive: true });

const { RUBRIQUES_DU_RESUME } = await import(path.join(RACINE, 'shared/dist/index.js'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-resume-', port: PORT, signaux: true });

const JOUR = 86_400_000;
const MARQUEUR = 'MARQUEUR-SECRET-NE-DOIT-PAS-SORTIR';
const PROJET = 'p-resume-essai';
const jeton = crypto.randomBytes(32).toString('hex');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

/** Le décor : 45 tâches sur vingt jours (5 dans les sept derniers jours), de la mémoire, du coffre. */
function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), t, t + 3_600_000, 'vérification du résumé');
  const projet = { id: PROJET, name: 'Essai — résumé', path: DEPOT, defaultEngine: 'claude', isSelf: false, archived: false, createdAt: t, updatedAt: t };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
    projet.id,
    projet.name,
    projet.path,
    JSON.stringify(projet),
    t,
    t,
  );
  const usage = db.prepare(
    `INSERT INTO usage (project_id, card_id, agent_id, engine, tokens, seconds, created_at, project_name, input_tokens, output_tokens)
     VALUES (?, ?, ?, 'claude', ?, ?, ?, 'Essai — résumé', ?, ?)`,
  );
  for (let i = 0; i < 45; i += 1) {
    // Les cinq premières dans les sept derniers jours, les autres entre 8 et 20 jours.
    const age = i < 5 ? (i + 1) * 0.8 * JOUR : (8 + (i % 13)) * JOUR;
    const jetons = 1000 * (i + 1);
    usage.run(PROJET, `carte-essai-${String(i).padStart(2, '0')}`, `agent-${i}`, jetons, 60 * (i + 1), t - age, jetons / 2, jetons / 4);
  }
  const consultation = db.prepare(
    `INSERT INTO memoire_consultation (project_id, card_id, agent_id, sujet, duree_ms, blocs_demandes, blocs_rendus, signes_entiers, signes_servis, created_at)
     VALUES (?, 'carte-essai-00', 'agent-0', ?, 120, 4, ?, 1000, 800, ?)`,
  );
  for (let i = 0; i < 12; i += 1) consultation.run(PROJET, i % 2 ? 'interface' : 'cartes', i % 2 ? 4 : 2, t - (i + 1) * JOUR);
  const fiche = db.prepare('INSERT INTO secrets (id, nom, type, project_id, champs, note, cree_le, modifie_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  fiche.run('s1', `Nom ${MARQUEUR}`, 'cle-api', PROJET, JSON.stringify({ cle: MARQUEUR }), MARQUEUR, t - 3 * JOUR, t - 3 * JOUR);
  fiche.run('s2', `Autre ${MARQUEUR}`, 'mot-de-passe', null, JSON.stringify({ motDePasse: MARQUEUR }), '', t - 2 * JOUR, t - JOUR);
  db.close();
}

/** Les commandes `stats.resume` envoyées par la page, lues sur son canal. */
function ecouterLesDemandes(page) {
  const demandes = [];
  page.on('websocket', (ws) => {
    ws.on('framesent', (trame) => {
      try {
        const brut = JSON.parse(typeof trame.payload === 'string' ? trame.payload : trame.payload.toString());
        if (brut?.cmd?.type === 'stats.resume' || brut?.cmd?.type === 'stats.telemetrie') demandes.push(brut.cmd);
      } catch {
        /* une trame illisible ne nous regarde pas */
      }
    });
  });
  return demandes;
}

const pageDuTableau = (page, repere) => page.locator(`[data-tableau="${repere}"] [data-page]`).getAttribute('data-page');

let navigateur;
async function main() {
  if (!(await attendrePort())) {
    noter('le démon jetable démarre', false, journal.join('').slice(-800));
    return;
  }
  poserLeDecor();

  /* 6. LE COFFRE, À LA SOURCE : la réponse du démon ne porte aucun champ de fiche. */
  const session = new Session(BASE, `beluga_session=${jeton}`);
  await session.connect();
  const coffre = await session.call({ type: 'stats.resume', rubrique: 'coffre' });
  const texteCoffre = JSON.stringify(coffre);
  /* Le MARQUEUR est dans le nom, les champs et la note des fiches : il ne doit paraître nulle part.
     (`nom` reste permis : c'est celui du PROJET, dans `parProjet`.) */
  noter('le coffre ne laisse sortir ni nom, ni champ, ni note de fiche', !texteCoffre.includes(MARQUEUR) && !/"(champs|note|images)"/.test(texteCoffre));
  noter('le coffre compte bien les deux fiches', coffre.fiches === 2 && coffre.parType.length === 2, `${coffre.fiches} fiches`);
  session.ws.close();

  navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  const demandes = ecouterLesDemandes(page);

  await page.goto(`${BASE}/#tableau-de-bord`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-resume]', { timeout: 40_000 });

  /* 1. La coquille. */
  const rubriques = await page.locator('nav [data-rubrique]').count();
  noter('la colonne des rubriques porte les onze rubriques', rubriques === RUBRIQUES_DU_RESUME.length, `${rubriques}`);
  const boiteEntete = await page.locator('header:has(h1) [data-selecteur-periode]').first().boundingBox();
  noter('la période est posée en haut à droite', !!boiteEntete && boiteEntete.x + boiteEntete.width > 1440 - 40, boiteEntete ? `bord droit à ${Math.round(boiteEntete.x + boiteEntete.width)} px` : 'absente');
  noter('30 jours à l’ouverture', (await page.locator('[data-echelle-periode="30"]').getAttribute('aria-pressed')) === 'true');

  // La rubrique gardée d'un essai précédent n'existe pas sur une base neuve : on part de la vue d'ensemble.
  await page.locator('nav [data-rubrique="ensemble"]').click();
  await page.waitForSelector('[data-tableau="projets"]', { timeout: 20_000 });
  noter('la vue d’ensemble montre ses tuiles et son tableau des projets', (await page.locator('[data-tuile-resume]').count()) === 4);
  noter('la vue d’ensemble garde la barre de part de chaque projet', (await page.locator('[data-barre-projet]').count()) >= 1);
  await page.screenshot({ path: path.join(SHOTS, 'resume-ensemble.png') });

  /* 2. Un vrai tableau. */
  await page.locator('nav [data-rubrique="taches"]').click();
  const historique = page.locator('[data-tableau="historique"]');
  await historique.waitFor({ timeout: 20_000 });
  noter('l’historique des tâches est un vrai tableau (entête, corps, pied)', (await historique.locator('thead th').count()) >= 5 && (await historique.locator('[data-tableau-pied]').count()) === 1);
  noter('les 45 tâches de la période sont comptées', (await historique.getAttribute('data-tableau-lignes')) === '45');
  noter('20 lignes par page, trois pages', (await historique.locator('tbody tr').count()) === 20 && (await pageDuTableau(page, 'historique')) === '1/3');
  noter('le pied dit « 1–20 sur 45 »', /1–20 sur 45/.test(await historique.locator('[data-tableau-pied]').innerText()));
  await historique.locator('[data-page-suivante] button').click();
  noter('la flèche passe à la page 2', (await pageDuTableau(page, 'historique')) === '2/3' && /21–40 sur 45/.test(await historique.locator('[data-tableau-pied]').innerText()));
  await historique.locator('[data-taille-page="50"]').click();
  /* Une seule page : les flèches se retirent, le choix de taille reste (carte « Audits absents et Sécurité sur mobile »). */
  noter('50 lignes par page : tout tient sur une page, sans flèches', (await historique.locator('[data-page]').count()) === 0 && (await historique.locator('tbody tr').count()) === 45);
  await historique.locator('[data-taille-page="10"]').click();
  noter('10 lignes par page : cinq pages', (await pageDuTableau(page, 'historique')) === '1/5');

  await historique.locator('[data-tri-colonne="jetons"]').click();
  const premiere = async () => (await historique.locator('tbody tr').first().innerText()).replace(/\s+/g, ' ');
  noter('premier clic : les jetons du plus grand au plus petit', (await historique.getAttribute('data-tableau-tri')) === 'jetons:desc' && /45 k/.test(await premiere()), await premiere());
  noter('l’entête trié le dit aux lecteurs d’écran', (await historique.locator('th[aria-sort="descending"]').count()) === 1);
  await historique.locator('[data-tri-colonne="jetons"]').click();
  noter('second clic : du plus petit au plus grand', (await historique.getAttribute('data-tableau-tri')) === 'jetons:asc' && /\b1 k\b|1 000/.test(await premiere()), await premiere());
  await historique.locator('[data-tri-colonne="jetons"]').click();
  noter('troisième clic : retour à l’ordre du serveur', (await historique.getAttribute('data-tableau-tri')) === '');
  await page.screenshot({ path: path.join(SHOTS, 'resume-taches.png') });

  /* 3. La période. */
  const avant = demandes.length;
  await page.locator('[data-echelle-periode="7"]').click();
  await page.waitForFunction(() => document.querySelector('[data-tableau="historique"]')?.getAttribute('data-tableau-lignes') === '5', null, { timeout: 20_000 }).catch(() => undefined);
  const nouvelles = demandes.slice(avant).filter((d) => d.type === 'stats.resume' && d.rubrique === 'taches');
  const bornes = nouvelles.at(-1);
  noter('changer de période relance la demande de la rubrique avec ses bornes', !!bornes && typeof bornes.debut === 'number' && typeof bornes.fin === 'number' && Math.round((bornes.fin - bornes.debut) / JOUR) === 7, bornes ? `${Math.round((bornes.fin - bornes.debut) / JOUR)} jours` : 'aucune demande');
  noter('la télémétrie suit la même période', demandes.slice(avant).some((d) => d.type === 'stats.telemetrie' && d.debut === bornes?.debut));
  noter('sur 7 jours, la liste ne garde que les 5 tâches récentes', (await historique.getAttribute('data-tableau-lignes')) === '5');

  /* 4. Une période plus longue que les données le dit. */
  await page.locator('[data-echelle-periode="90"]').click();
  await page.waitForSelector('[data-periode-partielle]', { timeout: 20_000 }).catch(() => undefined);
  noter('sur 90 jours, la page dit depuis quand les données existent', (await page.locator('[data-periode-partielle]').count()) === 1);

  /* 5. Les onze rubriques s'ouvrent. */
  for (const rubrique of RUBRIQUES_DU_RESUME) {
    await page.locator(`nav [data-rubrique="${rubrique}"]`).click();
    const ok = await page
      .waitForSelector('[data-rubrique-chargee]', { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    const echec = await page.getByText('Les statistiques n\'ont pas pu être chargées').count();
    noter(`la rubrique « ${rubrique} » s’ouvre`, ok && echec === 0 && (await page.getAttribute('[data-resume]', 'data-resume')) === rubrique);
    if (rubrique === 'memoire') {
      const pertinence = await page.locator('[data-tuile-resume="pertinence"]').innerText();
      noter('la mémoire dit la pertinence des consultations', /75 %/.test(pertinence), pertinence.replace(/\s+/g, ' '));
      await page.screenshot({ path: path.join(SHOTS, 'resume-memoire.png') });
    }
    if (rubrique === 'coffre') {
      noter('l’écran du coffre ne montre aucun secret', !(await page.locator('[data-fil="tableau-de-bord"]').innerText()).includes(MARQUEUR));
    }
  }
  noter('aucune erreur de page sur ordinateur', erreurs.length === 0, erreurs[0] ?? '');

  /* 7. Le téléphone. */
  const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-CH', isMobile: true, hasTouch: true });
  await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const mobile = await tel.newPage();
  mobile.on('pageerror', (e) => erreurs.push(String(e)));
  await mobile.goto(`${BASE}/#tableau-de-bord`, { waitUntil: 'domcontentloaded' });
  await mobile.waitForSelector('[data-rubrique-choix]', { timeout: 40_000 });
  noter('sur téléphone, la colonne des rubriques laisse place à une liste déroulante', (await mobile.locator('[data-rubrique-choix]').isVisible()) && !(await mobile.locator('nav [data-rubrique]').first().isVisible()));
  await mobile.locator('[data-rubrique-choix]').click();
  await mobile.locator('[data-liste-option="taches"]').click();
  await mobile.waitForSelector('[data-tableau="historique"]', { timeout: 20_000 });
  const largeur = await mobile.evaluate(() => document.documentElement.scrollWidth);
  noter('la page ne déborde pas en largeur sur 390 px', largeur <= 390, `${largeur} px`);
  await mobile.screenshot({ path: path.join(SHOTS, 'resume-telephone.png') });
  noter('aucune erreur de page sur téléphone', erreurs.length === 0, erreurs[0] ?? '');
}

try {
  await main();
} catch (erreur) {
  noter('le contrôle va au bout', false, String(erreur?.stack ?? erreur));
} finally {
  await navigateur?.close().catch(() => undefined);
  nettoyer();
}
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications réussies.`);
process.exit(echecs ? 1 : 0);
