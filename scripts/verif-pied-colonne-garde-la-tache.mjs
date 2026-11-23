#!/usr/bin/env node
/**
 * Le PIED de la colonne de gauche (quotas, cloche, réglages) ne ferme PAS la
 * tâche ouverte.
 *
 * Une page de tâche se referme quand on clique dans la colonne des projets :
 * la colonne mène ailleurs. Le pied, lui, n'ouvre que des volets ou des
 * fenêtres par-dessus la page. Ce contrôle ouvre une tâche par son adresse
 * (`#projet/<id>/tache/<carte>`), clique chacun des trois boutons du pied et
 * vérifie que la tâche est toujours là une fois le volet refermé — puis, en
 * contre-épreuve, que la flèche « Retour » de la colonne ferme toujours la
 * tâche.
 *
 *   BELUGA_VERIF_URL=http://localhost:7099 node scripts/verif-pied-colonne-garde-la-tache.mjs
 *
 * `BELUGA_URL` désigne l'application PUBLIÉE : on ne la reprend jamais ici.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const BASE = process.env.BELUGA_VERIF_URL || 'http://localhost:7099';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Une session valable, posée directement en base : on vérifie l'écran, pas le mur d'accès. */
function jeton() {
  const db = new Database(cheminDeLaBaseServie());
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification pied de colonne',
  );
  db.close();
  return { token, empreinte };
}

function retirer(empreinte) {
  const db = new Database(cheminDeLaBaseServie());
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

/** Une carte réelle d'un projet, pour bâtir l'adresse de sa page. */
function uneCarte() {
  const db = new Database(cheminDeLaBaseServie(), { readonly: true });
  const ligne = db
    .prepare(
      `SELECT id, project_id FROM cards
        WHERE archived_at IS NULL AND project_id IS NOT NULL
        ORDER BY updated_at DESC LIMIT 1`,
    )
    .get();
  db.close();
  return ligne;
}

const PIED = '[data-pied-colonne]';
const BOUTON_QUOTAS = `${PIED} button[data-essai="badge-quota"]:visible`;
const BOUTON_REGLAGES = `${PIED} button[data-reglages-menu]:visible`;
const PANNEAU = '[data-radix-popper-content-wrapper] [role="menu"]';

async function main() {
  const carte = uneCarte();
  if (!carte) {
    console.log(' ÉCHEC aucune carte en base pour bâtir l\'adresse de la page');
    process.exit(1);
  }
  const { token, empreinte } = jeton();
  process.on('exit', () => {
    try {
      retirer(empreinte);
    } catch {
      /* déjà retirée */
    }
  });
  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await navigateur.newContext({
    viewport: { width: 1600, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'beluga_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));

  const adresse = `${BASE}/#projet/${carte.project_id}/tache/${carte.id}`;
  const surLaTache = () => page.evaluate(() => location.hash.includes('/tache/'));

  async function rouvrirLaTache() {
    await page.goto('about:blank');
    await page.goto(adresse, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    return surLaTache();
  }

  // 1. Les quotas.
  noter('la tâche s\'ouvre par son adresse', await rouvrirLaTache(), adresse.split('#')[1]);
  await page.locator(BOUTON_QUOTAS).first().click();
  await page.waitForTimeout(1200);
  noter('quotas : le volet s\'ouvre', (await page.locator(PANNEAU).count()) > 0);
  noter('quotas : l\'adresse garde la tâche', await surLaTache(), await page.evaluate(() => location.hash.slice(0, 90)));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  noter('quotas : la tâche est toujours là une fois le volet fermé', await surLaTache());

  // 2. La cloche (pied de colonne, ordinateur).
  noter('la tâche s\'ouvre de nouveau', await rouvrirLaTache());
  const cloche = page.locator(`${PIED} button`).nth(1);
  const etiquette = (await cloche.getAttribute('aria-label').catch(() => '')) ?? '';
  await cloche.click();
  await page.waitForTimeout(1200);
  noter(
    'cloche : la tâche reste dans l\'adresse',
    await surLaTache(),
    `${etiquette} — ${await page.evaluate(() => location.hash.slice(0, 110))}`,
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  noter('cloche : la tâche est toujours là une fois le volet fermé', await surLaTache());

  // 3. Les réglages.
  noter('la tâche s\'ouvre encore', await rouvrirLaTache());
  await page.locator(BOUTON_REGLAGES).first().click();
  await page.waitForTimeout(1500);
  noter('réglages : la fenêtre s\'ouvre', await page.evaluate(() => location.hash.includes('reglages')), await page.evaluate(() => location.hash.slice(0, 60)));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  noter('réglages : la tâche est toujours là une fois la fenêtre fermée', await surLaTache(), await page.evaluate(() => location.hash.slice(0, 90)));

  // 4. Contre-épreuve : ce qui mène ailleurs, dans la colonne, ferme toujours
  // la tâche. Sur la page d'une tâche, la colonne montre le menu de la page
  // (pas la liste des projets) : sa flèche « Retour » en est la sortie.
  noter('la tâche s\'ouvre pour la contre-épreuve', await rouvrirLaTache());
  await page.locator('[data-colonne-projets] button[data-menu-de-colonne]:visible').first().click();
  await page.waitForTimeout(1500);
  noter('la flèche « Retour » de la colonne referme la tâche', !(await surLaTache()), await page.evaluate(() => location.hash.slice(0, 90)));

  noter('aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await navigateur.close();
  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passent.`);
  process.exit(echecs ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
