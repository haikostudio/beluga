#!/usr/bin/env node
/**
 * LES SERVICES D'IA DU VOLET DES QUOTAS, DANS UN VRAI NAVIGATEUR (carte « Quotas des services d'IA »).
 *
 * Monte un démon d'essai à base neuve (jamais celui en service), y recopie les fiches « clé d'API » des
 * services d'IA du coffre réel (`BELUGA_SERVICES_IA_SOURCE`, défaut `/root/beluga/data/beluga.db`), lance
 * l'interface de développement pointée sur lui, ouvre le volet des quotas et vérifie :
 *  - une section « Services d'IA » avec un bloc par service reconnu, chacun avec son lien de facturation
 *    (`target=_blank`) ;
 *  - un bloc lu porte des chiffres, un service sans solde dit « non communiqué » ;
 *  - aucune clé du coffre dans la page ;
 *  - chaque bloc porte le logo de SON service (`data-logo-service-ia`) ;
 *  - LE SEUIL : un bloc sous son seuil (2 $ par défaut) dit « Solde bas » (ou « À sec ») avec son restant en
 *    teinte d'alerte (`text-warning`, le texte fort de la palette monochrome), et le portefeuille d'alerte
 *    paraît au pied de la colonne, volet FERMÉ ; le menu à trois points d'un bloc change son seuil (10 000 $ :
 *    il passe en alerte), le réglage est enregistré, « Revenir à 2 $ » le défait ;
 *  - rien ne déborde à 390 px.
 * Captures à 1440 et 390 px, clair et sombre, dans `HAIKO_SERVICES_IA_CAPTURES` (défaut /tmp/verif-services-ia).
 *
 * Usage : node scripts/verif-services-ia.mjs
 *   BELUGA_SERVICES_IA_PORT (7147) · BELUGA_SERVICES_IA_WEB_PORT (7149)
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_SERVICES_IA_PORT || 7147);
const PORT_WEB = Number(process.env.BELUGA_SERVICES_IA_WEB_PORT || 7149);
const BASE = `http://localhost:${PORT_WEB}`;
const SOURCE = process.env.BELUGA_SERVICES_IA_SOURCE || '/root/beluga/data/beluga.db';
const CAPTURES = path.resolve(process.env.HAIKO_SERVICES_IA_CAPTURES || '/tmp/verif-services-ia');
const MOTIF = /openrouter|kie\.ai|heygen|agentik|groq|gemini api/i;

const resultats = [];
const noter = (ok, nom, detail = '') => {
  resultats.push(ok);
  console.log(`${ok ? 'OK ' : 'ÉCHEC'} ${nom}${detail ? ' — ' + detail : ''}`);
};
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

const { DATA, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-services-ia-', port: PORT, signaux: true });

const web = spawn('npm', ['run', 'dev', '--workspace', 'web', '--', '--port', String(PORT_WEB), '--strictPort'], {
  cwd: RACINE,
  env: { ...process.env, NODE_ENV: 'development', BELUGA_DEMON_PORT: String(PORT) },
  stdio: 'ignore',
  detached: true,
});
const retirerLeWeb = () => {
  try {
    process.kill(-web.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
};
process.on('exit', retirerLeWeb);

async function attendreLeWeb(limiteMs = 90_000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Recopie les fiches d'IA du coffre réel et pose une session d'une heure. Rend les clés, pour vérifier qu'aucune ne fuit. */
function poserLeDecor() {
  const source = new Database(SOURCE, { readonly: true, fileMustExist: true });
  const fiches = source
    .prepare("SELECT * FROM secrets WHERE archive_le IS NULL AND type = 'cle-api'")
    .all()
    .filter((f) => MOTIF.test(`${f.nom} ${JSON.parse(f.champs || '{}').service ?? ''}`));
  source.close();
  const db = new Database(path.join(DATA, 'beluga.db'));
  const colonnes = Object.keys(fiches[0] ?? {});
  const inserer = db.prepare(`INSERT INTO secrets (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`);
  for (const f of fiches) inserer.run(...colonnes.map((c) => (c === 'dossier_id' || c === 'project_id' ? null : f[c])));
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), t, t + 3600_000, 'vérification services d’IA');
  db.close();
  return fiches.map((f) => JSON.parse(f.champs || '{}').cle).filter((c) => c && c.length > 8);
}

async function main() {
  if (!(await attendrePort())) throw new Error('le démon d’essai n’a pas démarré :\n' + journal.join('').slice(-2000));
  const cles = poserLeDecor();
  noter(cles.length > 0, 'des fiches de services d’IA recopiées', `${cles.length} clés`);
  if (!(await attendreLeWeb())) throw new Error('le serveur web de développement n’a pas démarré');
  fs.mkdirSync(CAPTURES, { recursive: true });

  const navigateur = await chromium.launch({ channel: 'chrome' });
  try {
    for (const [nomAppareil, appareil] of [
      ['ordinateur', { viewport: { width: 1440, height: 900 } }],
      ['telephone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
    ]) {
      const contexte = await navigateur.newContext({ ...appareil, serviceWorkers: 'block' });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE }]);
      const page = await contexte.newPage();
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(e.message));
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      if (nomAppareil === 'telephone') {
        // Sur téléphone, le volet des quotas s'ouvre depuis la colonne des projets.
        await page.locator('button[aria-label="Projets"]:visible').first().click({ timeout: 30_000 });
      }
      const bouton = page.locator('button[aria-label^="Quotas des moteurs"]:visible').first();
      await bouton.waitFor({ timeout: 30_000 });
      await bouton.click();
      const section = page.locator('[data-services-ia]');
      await section.waitFor({ timeout: 20_000 });
      await page.locator('[data-service-ia]').first().waitFor({ timeout: 30_000 });
      const blocs = await page.locator('[data-service-ia]').evaluateAll((els) =>
        els.map((el) => ({
          id: el.getAttribute('data-service-ia'),
          etat: el.getAttribute('data-etat'),
          niveau: el.getAttribute('data-niveau'),
          logo: el.querySelector('[data-logo-service-ia]')?.getAttribute('data-logo-service-ia') ?? '',
          restantOrange: (() => {
            const r = el.querySelector('[data-restant-service-ia]');
            return r ? r.classList.contains('text-warning') : null;
          })(),
          mention: el.querySelector('[data-alerte-niveau]')?.textContent ?? '',
          texte: el.textContent ?? '',
          lien: el.querySelector('a[data-lien-service-ia]')?.getAttribute('href') ?? '',
          cible: el.querySelector('a[data-lien-service-ia]')?.getAttribute('target') ?? '',
        })),
      );
      noter(blocs.length > 0, `${nomAppareil} : un bloc par service`, blocs.map((b) => `${b.id}:${b.etat}`).join(', '));
      noter(blocs.every((b) => /^https:\/\//.test(b.lien) && b.cible === '_blank'), `${nomAppareil} : chaque bloc ouvre sa facturation dans un nouvel onglet`);
      const lus = blocs.filter((b) => b.etat === 'ok');
      noter(lus.every((b) => /\d/.test(b.texte)), `${nomAppareil} : les blocs lus portent des chiffres`, `${lus.length} lus`);
      noter(blocs.filter((b) => b.etat === 'non-communique').every((b) => /non communiqué/i.test(b.texte)), `${nomAppareil} : un service sans solde le dit`);
      noter(blocs.every((b) => b.logo === b.id), `${nomAppareil} : chaque bloc porte le logo de son service`, blocs.map((b) => `${b.id}→${b.logo}`).join(', '));
      const enAlerte = blocs.filter((b) => b.niveau === 'bas' || b.niveau === 'vide');
      noter(
        blocs.filter((b) => b.restantOrange !== null).every((b) => b.restantOrange === (b.niveau === 'bas' || b.niveau === 'vide')),
        `${nomAppareil} : seul un restant sous son seuil est en teinte d’alerte`,
        blocs.map((b) => `${b.id}:${b.niveau ?? '—'}`).join(', '),
      );
      noter(
        blocs.every((b) => (b.niveau === 'bas' ? /Solde bas/.test(b.mention) : b.niveau === 'vide' ? /À sec/.test(b.mention) : !b.mention)),
        `${nomAppareil} : l’alerte est dite en mots`,
        enAlerte.map((b) => `${b.id}:${b.mention}`).join(', '),
      );
      noter(
        blocs.filter((b) => b.etat !== 'ok').every((b) => !b.niveau),
        `${nomAppareil} : un service illisible n’est jamais dit bas ni à sec`,
      );

      // LE MENU DU SEUIL, sur un bloc lu qui n'est pas encore en alerte (sinon le premier bloc lu).
      const cible = blocs.find((b) => b.niveau === 'normal') ?? blocs.find((b) => b.niveau);
      if (cible) {
        await page.locator(`[data-menu-seuil-service-ia="${cible.id}"]`).click();
        const champ = page.locator(`[data-champ-seuil-service-ia="${cible.id}"]`);
        await champ.waitFor({ timeout: 10_000 });
        await champ.fill('');
        await champ.pressSequentially('10000');
        const valeurTapee = await champ.inputValue();
        noter(valeurTapee === '10000', `${nomAppareil} : le champ du seuil garde la frappe`, valeurTapee);
        await page.screenshot({ path: path.join(CAPTURES, `services-ia-${nomAppareil}-menu-du-seuil.png`) });
        await champ.press('Enter');
        await page.waitForFunction((id) => document.querySelector(`[data-service-ia="${id}"]`)?.getAttribute('data-niveau') === 'bas', cible.id, { timeout: 10_000 }).catch(() => {});
        const niveauApres = await page.locator(`[data-service-ia="${cible.id}"]`).getAttribute('data-niveau');
        noter(niveauApres === 'bas', `${nomAppareil} : un seuil de 10 000 $ met ${cible.id} en alerte`, String(niveauApres));
        await page.waitForTimeout(500);
        const lu = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
        const reglages = JSON.parse(lu.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
        lu.close();
        noter(reglages.seuilsServicesIa?.[cible.id] === 10000, `${nomAppareil} : le seuil est enregistré dans les réglages partagés`, JSON.stringify(reglages.seuilsServicesIa ?? {}));
        noter(await page.locator('[data-services-ia]').isVisible(), `${nomAppareil} : le volet reste ouvert après le réglage`);
      }
      const html = await page.content();
      noter(!cles.some((c) => html.includes(c)), `${nomAppareil} : aucune clé dans la page`);
      const deborde = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      noter(deborde <= 0, `${nomAppareil} : rien ne déborde`, `${deborde}px`);
      for (const theme of ['clair', 'sombre']) {
        await page.evaluate((sombre) => document.documentElement.classList.toggle('dark', sombre), theme === 'sombre');
        await section.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(CAPTURES, `services-ia-${nomAppareil}-${theme}.png`) });
      }
      // LE POINT DU PIED DE COLONNE, volet fermé.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      if (nomAppareil === 'telephone') {
        await page.locator('button[aria-label="Projets"]:visible').first().click({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(400);
      }
      const point = page.locator('[data-alerte-services-ia]:visible').first();
      /* Le portefeuille a disparu (15/11/2026) : le repère vit sur la ligne elle-même, et son texte dans sa bulle. */
      const pointVu = await point.isVisible().catch(() => false);
      noter(pointVu, `${nomAppareil} : l’alerte de solde bas est portée par la ligne du pied de colonne (bulle)`, pointVu ? String(await point.getAttribute('data-alerte-services-ia')) : `${enAlerte.length} en alerte avant le réglage`);
      await page.screenshot({ path: path.join(CAPTURES, `services-ia-${nomAppareil}-pied-de-colonne.png`) });

      // « Revenir à 2 $ » défait le réglage.
      if (cible) {
        const bouton2 = page.locator('button[aria-label^="Quotas des moteurs"]:visible').first();
        if (!(await page.locator('[data-services-ia]').isVisible().catch(() => false))) await bouton2.click();
        await page.locator(`[data-menu-seuil-service-ia="${cible.id}"]`).click();
        await page.locator(`[data-seuil-par-defaut-service-ia="${cible.id}"]`).click();
        await page.waitForTimeout(600);
        const lu = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
        const reglages = JSON.parse(lu.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
        lu.close();
        noter(!(cible.id in (reglages.seuilsServicesIa ?? {})), `${nomAppareil} : « Revenir à 2 $ » retire le seuil réglé`, JSON.stringify(reglages.seuilsServicesIa ?? {}));
        noter((await page.locator(`[data-service-ia="${cible.id}"]`).getAttribute('data-niveau')) === cible.niveau, `${nomAppareil} : ${cible.id} retrouve son niveau d’avant`);
        // Le volet tel qu'il est vraiment (seuils par défaut), en clair et en sombre.
        for (const theme of ['clair', 'sombre']) {
          await page.evaluate((sombre) => document.documentElement.classList.toggle('dark', sombre), theme === 'sombre');
          await page.locator('[data-services-ia]').scrollIntoViewIfNeeded();
          await page.waitForTimeout(300);
          await page.screenshot({ path: path.join(CAPTURES, `services-ia-${nomAppareil}-reel-${theme}.png`) });
        }
        await page.keyboard.press('Escape');
      }
      noter(!erreurs.length, `${nomAppareil} : aucune erreur de page`, erreurs.join(' | '));
      await contexte.close();
    }
  } finally {
    await navigateur.close();
  }
}

main()
  .catch((err) => {
    noter(false, 'déroulé', err?.message ?? String(err));
  })
  .finally(() => {
    const echecs = resultats.filter((ok) => !ok).length;
    console.log(echecs ? `\n${echecs} échec(s)` : `\nTout est bon (${resultats.length} contrôles). Captures : ${CAPTURES}`);
    retirerLeWeb();
    process.exit(echecs ? 1 : 0);
  });
