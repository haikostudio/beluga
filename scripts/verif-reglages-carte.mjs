#!/usr/bin/env node
/**
 * Le détail d'une carte montre-t-il avec quoi elle tourne ?
 *
 * Deux relevés, du plus profond au plus visible :
 *   1. la RÈGLE (`reglagesDeLaCarte`) : une carte à faire se laisse régler, une
 *      carte qui a tourné rend ce qui a RÉELLEMENT servi ;
 *   2. l'ÉCRAN, dans un vrai navigateur, sur ordinateur PUIS sur téléphone :
 *      une carte « Planifié » ouvre ses menus, une carte « Terminé » affiche
 *      moteur, modèle, réflexion et compte, figés, sur une ligne qui se replie.
 *
 * Une carte d'essai est posée en base le temps du relevé, puis retirée ; le
 * projet ouvert au départ est remis en place en partant.
 *
 *   node scripts/verif-reglages-carte.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { reglagesDeLaCarte } from '../shared/dist/reglages-carte.js';
import { carteDeLaLigne, lireCarteParId } from './carte-en-base.mjs';

/* On vise le serveur de DÉVELOPPEMENT : HAIKODEV_URL, posée pour les agents,
   pointe l'application déjà publiée — on y verrait l'ancienne version. */
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7099';
const BASE_DB = '/root/haikodev/data/haikodev.db';
const CLE_PROJET_ACTIF = 'project.active';
const TITRE_ESSAI = 'Essai — réglages visibles dans le détail';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

function poserSession(db) {
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification réglages de carte',
  );
  return { cookie, empreinte };
}

/** Une carte TERMINÉE dont l'agent d'exécution est encore en base. */
function carteTerminee(db) {
  const lignes = db
    .prepare(
      `SELECT c.*, p.name AS projet
         FROM cards c JOIN projects p ON p.id = c.project_id
        WHERE c.column_key IN ('done','to_deploy') AND p.archived = 0
        ORDER BY c.updated_at DESC LIMIT 12`,
    )
    .all();
  for (const ligne of lignes) {
    const carte = carteDeLaLigne(db, ligne);
    const agent = carte.agentId
      ? db.prepare('SELECT data FROM agents WHERE id = ?').get(carte.agentId)
      : null;
    if (!agent) continue;
    return { ...ligne, projectId: ligne.project_id, carte, agent: JSON.parse(agent.data) };
  }
  return null;
}

/** Une carte issue d'une proposition d'agent, posée dans le même projet puis retirée. */
function poserCarteEssai(db, projectId) {
  const id = crypto.randomUUID();
  const maintenant = Date.now();
  const carte = {
    id,
    projectId,
    title: TITRE_ESSAI,
    description:
      "Carte posée par un script de vérification. Elle disparaît toute seule à la fin du relevé.",
    labels: ['préparée'],
    column: 'planned',
    position: -1,
    origin: 'agent',
    attachments: ['image-de-la-demande'],
    run: { engine: 'claude', model: 'claude-opus-5', thinking: 'medium', mode: 'direct' },
    estimate: { machineSeconds: 600, failed: false },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, projectId, 'planned', -1, TITRE_ESSAI, JSON.stringify(carte), maintenant, maintenant);
  return id;
}

function viserProjet(db, projectId) {
  const avant = db.prepare('SELECT value FROM preferences WHERE key = ?').get(CLE_PROJET_ACTIF);
  db.prepare(
    'INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(CLE_PROJET_ACTIF, JSON.stringify(projectId), Date.now());
  return avant ? avant.value : null;
}

function nettoyer(db, { carteId, empreinte, projetAvant }) {
  if (carteId) db.prepare('DELETE FROM cards WHERE id = ?').run(carteId);
  if (empreinte) db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  if (projetAvant === null) db.prepare('DELETE FROM preferences WHERE key = ?').run(CLE_PROJET_ACTIF);
  else if (projetAvant !== undefined)
    db.prepare(
      'INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    ).run(CLE_PROJET_ACTIF, projetAvant, Date.now());
}

/** Ouvre le tiroir d'une carte, onglet « Détails ». */
async function ouvrirDetails(context, titre, projetNom, mobile) {
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  // L'application peut rouvrir le dernier panneau. La poignée est son bouton
  // de fermeture le plus stable, sur ordinateur comme sur téléphone.
  const panneauOuvert = page.locator('[role="dialog"]').last();
  if (await panneauOuvert.count()) {
    await panneauOuvert.locator('button').first().click({ force: true });
    await panneauOuvert.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  const extrait = titre.slice(0, 30);
  if (!(await page.locator(`article:has-text(${JSON.stringify(extrait)})`).count())) {
    if (mobile) {
      await page.locator('header button[aria-label="Projets"]').click();
      await page.waitForTimeout(1200);
    }
    const ligne = page.getByText(projetNom, { exact: true }).first();
    await ligne.waitFor({ state: 'visible', timeout: 15000 });
    await ligne.click();
    await page.waitForTimeout(3000);
  }

  const dejaOuvert = await page.locator('[role="dialog"]').filter({ hasText: extrait }).count();
  if (!dejaOuvert) {
    const carteVue = page.locator('article').filter({ hasText: extrait }).first();
    await carteVue.scrollIntoViewIfNeeded().catch(() => {});
    await carteVue.waitFor({ state: 'visible', timeout: 15000 });
    await carteVue.click();
    await page.waitForTimeout(1800);
  }

  const tiroir = page.locator('[role="dialog"]').last();
  await tiroir.getByRole('tab', { name: 'Détails' }).click();
  await page.waitForTimeout(900);
  return { page, tiroir, erreurs };
}

/** Le bloc des réglages : le cadre coiffé par son titre. */
function blocReglages(tiroir) {
  return tiroir
    .locator('div.rounded-md.border')
    .filter({ hasText: /Réglages (de l'agent|de l’agent|qui ont servi)/ })
    .first();
}

async function main() {
  /* ---------------- 1. La règle, jouée seule ---------------- */

  const prevu = { engine: 'claude', model: 'claude-opus-5', thinking: 'medium' };
  const aFaire = reglagesDeLaCarte({ colonne: 'planned', carte: prevu });
  noter('une carte à faire se laisse régler', aFaire.modifiable && aFaire.source === 'prevu');
  noter('avant le départ, aucun compte n’est annoncé', aFaire.compte === undefined);

  const terminee = reglagesDeLaCarte({
    colonne: 'done',
    carte: prevu,
    agent: { engine: 'codex', model: 'gpt-5.6-sol', thinking: 'high', compte: 'codex-principal' },
  });
  noter(
    'une carte terminée rend ce qui a réellement servi',
    !terminee.modifiable && terminee.source === 'reel' && terminee.engine === 'codex' && terminee.compte === 'codex-principal',
    `${terminee.engine} / ${terminee.model} / ${terminee.thinking} / ${terminee.compte}`,
  );

  /* ---------------- 2. L'écran, dans un vrai navigateur ---------------- */

  const db = new Database(BASE_DB);
  const finie = carteTerminee(db);
  if (!finie) {
    db.close();
    console.log('Aucune carte terminée avec son agent en base : rien à montrer à l’écran.');
    process.exit(resultats.some((r) => !r.ok) ? 1 : 0);
  }
  console.log(`Carte terminée d’essai : « ${finie.title.slice(0, 50)} » (${finie.projet}).`);

  const attendu = reglagesDeLaCarte({
    colonne: 'done',
    carte: finie.carte.run,
    agent: {
      engine: finie.agent.run?.engine,
      model: finie.agent.run?.model,
      thinking: finie.agent.run?.thinking,
      compte: finie.agent.account,
    },
    compteMesure: finie.carte.consumption?.account,
  });

  let carteId;
  let empreinte;
  let projetAvant;
  let navigateur;
  try {
    projetAvant = viserProjet(db, finie.projectId);
    carteId = poserCarteEssai(db, finie.projectId);
    const session = poserSession(db);
    empreinte = session.empreinte;

    navigateur = await chromium.launch({
      channel: 'chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
    });

    for (const ecran of [
      { nom: 'ordinateur', viewport: { width: 1440, height: 900 }, mobile: false },
      { nom: 'téléphone', viewport: { width: 390, height: 844 }, mobile: true },
    ]) {
      const context = await navigateur.newContext({
        viewport: ecran.viewport,
        locale: 'fr-CH',
        ignoreHTTPSErrors: true,
        serviceWorkers: 'block',
        isMobile: ecran.mobile,
        hasTouch: ecran.mobile,
      });
      await context.addCookies([
        { name: 'haikodev_session', value: session.cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
      ]);

      /* ---------- Une carte « Planifié » : réglages modifiables ---------- */
      {
        const { page, tiroir, erreurs } = await ouvrirDetails(context, TITRE_ESSAI, finie.projet, ecran.mobile);
        const bloc = blocReglages(tiroir);
        const vu = (await bloc.count()) > 0;
        noter(`${ecran.nom} — la carte à faire montre ses réglages`, vu);
        if (vu) {
          const texte = (await bloc.innerText()).replace(/\s+/g, ' ');
          noter(
            `${ecran.nom} — le compte est annoncé comme choisi au lancement`,
            /choisi au lancement/i.test(texte),
            texte.slice(0, 120),
          );
          // Le point d'entrée unique des réglages s'ouvre sur un aperçu, dont
          // la ligne « Moteur » creuse vers la liste verticale des moteurs.
          const entree = bloc.locator('[data-selecteur="config"]').first();
          await entree.click({ force: true });
          await page.waitForTimeout(800);
          const ligneMoteur = page.locator('[data-selecteur="moteur"]').first();
          const moteurAffiche = ((await ligneMoteur.getAttribute('data-valeur')) || '').trim();
          await ligneMoteur.click({ force: true });
          await page.waitForTimeout(1200);
          const entrees = page.getByRole('menu').last().getByRole('menuitem');
          const combien = await entrees.count();
          noter(`${ecran.nom} — les réglages d’une carte à faire s’ouvrent`, combien > 0);

          /* Un changement doit ARRIVER EN BASE : un menu qui s'ouvre sans rien
             enregistrer laisserait croire que la carte est réglable. On vise
             l'AUTRE moteur que celui déjà affiché, sinon rien ne bougerait. */
          let autre = null;
          for (let index = 0; index < combien; index += 1) {
            const texte = (await entrees.nth(index).innerText()).trim();
            if (!texte.startsWith(moteurAffiche)) autre = entrees.nth(index);
          }
          if (autre) {
            const avant = lireCarteParId(db, carteId).run;
            await autre.click({ force: true });
            await page.waitForTimeout(1800);
            const apres = lireCarteParId(db, carteId).run;
            noter(
              `${ecran.nom} — un changement de moteur est enregistré sur la carte`,
              apres.engine !== avant.engine && !!apres.model,
              `${avant.engine}/${avant.model} → ${apres.engine}/${apres.model}`,
            );
          } else {
            await page.keyboard.press('Escape');
          }
          await page.waitForTimeout(500);

          // Une ligne d'étiquettes, pas un tableau : le bloc reste bas.
          const hauteur = await bloc.evaluate((n) => n.getBoundingClientRect().height);
          noter(`${ecran.nom} — le bloc tient sur peu de hauteur`, hauteur < 120, `${Math.round(hauteur)} px`);
        }
        // L'encart « préparé depuis la proposition du chef » a été retiré avec
        // le chef d'orchestre : la ligne de temps du parcours dit désormais
        // seule ce qui précédait l'exécution.
        noter(
          `${ecran.nom} — plus aucun encart de préparation du chef`,
          (await tiroir.locator('[data-preparation-chef]').count()) === 0,
        );
        noter(`${ecran.nom} — aucune erreur de page (carte à faire)`, erreurs.length === 0, erreurs.slice(0, 1).join(''));
        await page.close();
      }

      /* ---------- Une carte terminée : réglages figés ---------- */
      {
        const { page, tiroir, erreurs } = await ouvrirDetails(context, finie.title, finie.projet, ecran.mobile);
        const bloc = blocReglages(tiroir);
        const vu = (await bloc.count()) > 0;
        noter(`${ecran.nom} — la carte terminée montre ses réglages`, vu);
        if (vu) {
          const texte = (await bloc.innerText()).replace(/\s+/g, ' ');
          noter(`${ecran.nom} — le titre dit que ces réglages ont servi`, /qui ont servi/i.test(texte), texte.slice(0, 140));
          noter(
            `${ecran.nom} — les quatre étiquettes sont là`,
            /Moteur/.test(texte) && /Modèle/.test(texte) && /Niveau/.test(texte) && /Compte/.test(texte),
            texte.slice(0, 200),
          );
          noter(
            `${ecran.nom} — le compte réellement utilisé est affiché`,
            !!attendu.compte && texte.includes(attendu.compte),
            `attendu : ${attendu.compte}`,
          );
          // Plus aucun menu : les réglages ne se changent plus.
          noter(`${ecran.nom} — les réglages figés n’offrent aucun menu`, (await bloc.locator('button').count()) === 0);

          const hauteur = await bloc.evaluate((n) => n.getBoundingClientRect().height);
          // Sur téléphone, les quatre réglages et les deux quotas se replient
          // naturellement sur plusieurs lignes tout en restant compacts.
          const hauteurMaximale = ecran.mobile ? 180 : 140;
          noter(
            `${ecran.nom} — le bloc figé tient sur peu de hauteur`,
            hauteur < hauteurMaximale,
            `${Math.round(hauteur)} px`,
          );
        }
        noter(`${ecran.nom} — aucune erreur de page (carte terminée)`, erreurs.length === 0, erreurs.slice(0, 1).join(''));
        await page.close();
      }

      await context.close();
    }
  } finally {
    if (navigateur) await navigateur.close().catch(() => {});
    nettoyer(db, { carteId, empreinte, projetAvant });
    db.close();
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
