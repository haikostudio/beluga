#!/usr/bin/env node
/**
 * Deux retouches de l'aspect, vues dans un vrai navigateur :
 *
 *   1. L'ONGLET ACTIF DE LA BARRE D'ONGLETS D'UNE CARTE N'A PLUS D'OMBRE.
 *      Il se distingue par son fond et sa couleur de texte, jamais par un
 *      creux dessiné — l'interface est plate.
 *   2. LE RÉGLAGE « PLAN » EST UNE LIGNE COMME LES AUTRES : nom, valeur,
 *      flèche vers sa liste. Plus aucun petit interrupteur au milieu de
 *      lignes qui n'en ont pas ; le choix se fait dans la liste
 *      « Activé / Désactivé », comme pour le moteur ou le modèle.
 *
 * Une carte d'essai est posée en base le temps du relevé, puis retirée, et le
 * projet ouvert au départ est remis en place en partant.
 *
 *   BELUGA_VERIF_URL=http://localhost:7099 node scripts/verif-onglet-actif-et-ligne-plan.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const BASE = process.env.BELUGA_VERIF_URL || 'http://localhost:7099';
const BASE_DB = cheminDeLaBaseServie();
const CLE_PROJET_ACTIF = 'project.active';
const TITRE_ESSAI = 'Essai — onglet actif et ligne Plan';
/* Le titre affiché peut être replié : on ne cherche que son début. */
const EXTRAIT = 'Essai — onglet actif';

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

function poserSession(db) {
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification onglet actif et ligne Plan',
  );
  return { cookie, empreinte };
}

function poserCarteEssai(db, projectId) {
  const id = crypto.randomUUID();
  const maintenant = Date.now();
  const carte = {
    id,
    projectId,
    title: TITRE_ESSAI,
    description: 'Carte posée par un script de vérification. Elle disparaît à la fin du relevé.',
    labels: [],
    column: 'planned',
    position: -1,
    origin: 'agent',
    run: { engine: 'claude', model: 'claude-opus-5', thinking: 'medium', mode: 'direct' },
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

async function main() {
  const db = new Database(BASE_DB);
  const projet = db
    .prepare(
      `SELECT p.id, p.name, COUNT(c.id) AS cartes
         FROM projects p LEFT JOIN cards c ON c.project_id = p.id
        WHERE p.archived = 0
        GROUP BY p.id
        ORDER BY cartes DESC LIMIT 1`,
    )
    .get();
  if (!projet) throw new Error('aucun projet ouvert en base');

  const session = poserSession(db);
  const avantProjet = db.prepare('SELECT value FROM preferences WHERE key = ?').get(CLE_PROJET_ACTIF);
  db.prepare(
    'INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(CLE_PROJET_ACTIF, JSON.stringify(projet.id), Date.now());
  const carteId = poserCarteEssai(db, projet.id);

  const navigateur = await chromium.launch({ channel: 'chrome' });
  try {
    const context = await navigateur.newContext({
      viewport: { width: 1400, height: 900 },
      locale: 'fr-CH',
      serviceWorkers: 'block',
    });
    await context.addCookies([
      { name: 'beluga_session', value: session.cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // L'application peut rouvrir le dernier panneau : on le referme d'abord.
    const panneauOuvert = page.locator('[role="dialog"]').last();
    if (await panneauOuvert.count()) {
      await panneauOuvert.locator('button').first().click({ force: true });
      await panneauOuvert.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }

    // Ouvrir le projet de la carte d'essai : c'est ce clic qui fait relire les
    // cartes au serveur, et donc paraître celle qu'on vient de poser en base.
    if (!(await page.locator('article').filter({ hasText: EXTRAIT }).count())) {
      const ligneProjet = page.getByText(projet.name, { exact: true }).first();
      await ligneProjet
        .waitFor({ state: 'visible', timeout: 15000 })
        .catch(() => page.screenshot({ path: '/tmp/verif-plan-ecran.png', fullPage: true }));
      await ligneProjet.click({ timeout: 10000 });
      await page.waitForTimeout(3000);
    }

    const carte = page.locator('article').filter({ hasText: EXTRAIT }).first();
    await carte.waitFor({ state: 'visible', timeout: 20000 });
    await carte.click();
    await page.waitForTimeout(2000);

    /* ---------- 1. L'onglet actif n'a plus d'ombre ---------- */
    const onglet = page.locator('[data-barre-onglets] [role="tab"][data-state="active"]').first();
    await onglet.waitFor({ state: 'visible', timeout: 15000 });
    const ombre = await onglet.evaluate((el) => getComputedStyle(el).boxShadow);
    noter("l'onglet actif ne porte aucune ombre", ombre === 'none', ombre);
    const fond = await onglet.evaluate((el) => getComputedStyle(el).backgroundColor);
    noter(
      "l'onglet actif garde tout de même un fond à lui",
      fond !== 'rgba(0, 0, 0, 0)' && fond !== 'transparent',
      fond,
    );

    /* ---------- 2. Le réglage « Plan » est une ligne à flèche ---------- */
    /* La ligne « Plan » vit à deux endroits, avec le même dessin : la carte de
       configuration d'une tâche neuve, et le tiroir des réglages ouvert depuis
       la barre d'écriture. On prend celle qui est là. */
    let lignePlan = page.locator('[data-ligne-configuration="Plan"]').first();
    if (!(await lignePlan.count())) {
      // La bulle « Réglages du moteur » de la carte pas encore lancée ouvre
      // le même tiroir de réglages que la barre d'écriture.
      const entree = page.locator('[data-reglages-avant-lancement], [data-selecteur="config"]').first();
      await entree.click({ timeout: 10000 });
      await page.waitForTimeout(1200);
      lignePlan = page.locator('[data-selecteur="plan"]').first();
    }
    await lignePlan
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => page.screenshot({ path: '/tmp/verif-plan-ecran.png', fullPage: true }));
    noter(
      'la ligne « Plan » annonce son état, éteint par défaut',
      (await lignePlan.getAttribute('data-mode-plan')) === 'inactif',
      (await lignePlan.innerText()).replace(/\s+/g, ' '),
    );
    noter(
      'la ligne « Plan » ne porte plus d’interrupteur',
      (await lignePlan.locator('[role="switch"]').count()) === 0,
    );
    noter(
      'la ligne « Plan » porte une flèche, comme « Moteur »',
      (await lignePlan.locator('svg.lucide-chevron-right').count()) === 1,
    );

    await page.screenshot({ path: '/tmp/verif-plan-tiroir.png' });
    await lignePlan.click();
    await page.waitForTimeout(1200);
    const liste = page.locator('[role="menu"]').last();
    noter('le clic ouvre la liste du réglage « Plan »', (await liste.count()) === 1);
    const options = liste.locator('[role="menuitem"]');
    noter('la liste propose deux états, éteint puis allumé', (await options.count()) === 2);

    await options.nth(1).click();
    await page.waitForTimeout(1800);
    const etat = await page
      .locator('[data-ligne-configuration="Plan"], [data-selecteur="plan"]')
      .first()
      .getAttribute('data-mode-plan');
    noter('choisir « Activé » allume le mode plan sur la carte', etat === 'actif', etat ?? 'introuvable');
  } finally {
    await navigateur.close();
    db.prepare('DELETE FROM cards WHERE id = ?').run(carteId);
    db.prepare('DELETE FROM sessions WHERE token = ?').run(session.empreinte);
    if (avantProjet) {
      db.prepare('UPDATE preferences SET value = ?, updated_at = ? WHERE key = ?').run(
        avantProjet.value,
        Date.now(),
        CLE_PROJET_ACTIF,
      );
    } else {
      db.prepare('DELETE FROM preferences WHERE key = ?').run(CLE_PROJET_ACTIF);
    }
    db.close();
  }

  const ok = resultats.filter((r) => r.ok).length;
  console.log(`\n${ok}/${resultats.length} contrôles passés`);
  process.exit(ok === resultats.length ? 0 : 1);
}

main().catch((erreur) => {
  console.error(erreur);
  process.exit(1);
});
