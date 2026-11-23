#!/usr/bin/env node
/**
 * LA RUBRIQUE « CHARTE D'INTERFACE » DE LA CONFIGURATION D'UN PROJET, dans un
 * vrai navigateur, sur un démon d'essai à base neuve : les chartes du dépôt du
 * projet se lisent (titre, domaine, état), une charte proposée se VALIDE d'un
 * clic, et un projet sans charte propose de la faire rédiger. Ordinateur
 * (1440 px) et téléphone (390 px), clair et sombre.
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-chartes.mjs
 *   BELUGA_VERIF_CAPTURES=/tmp/chartes … pour garder les images
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7247);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.BELUGA_VERIF_CAPTURES;
const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
const attendre = async (fn, ms = 15000) => {
  for (const fin = Date.now() + ms; Date.now() < fin; await new Promise((r) => setTimeout(r, 150))) if (await fn()) return true;
  return false;
};

const { TMP, DATA, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-chartes-', port: PORT });
const jeton = crypto.randomBytes(32).toString('hex');
const MAINTENANT = Date.now();

/* Deux dépôts : l'un porte les chartes de Beluga (l'application repassée en « proposée »), l'autre n'en a aucune. */
const AVEC = path.join(TMP, 'avec-charte');
const SANS = path.join(TMP, 'sans-charte');
for (const depot of [AVEC, SANS]) {
  fs.mkdirSync(depot, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: depot });
}
fs.mkdirSync(path.join(AVEC, 'docs/chartes'), { recursive: true });
for (const f of fs.readdirSync(path.join(RACINE, 'docs/chartes'))) {
  const texte = fs.readFileSync(path.join(RACINE, 'docs/chartes', f), 'utf8');
  fs.writeFileSync(path.join(AVEC, 'docs/chartes', f), f === 'application.md' ? texte.replace('etat: validee', 'etat: proposee') : texte);
}

let code = 1;
let navigateur;
try {
  if (!(await attendrePort())) throw new Error(`Le démon d’essai n’a pas démarré :\n${journal.join('')}`);
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), MAINTENANT, MAINTENANT + 3600_000, 'essai');
  const projet = db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)');
  for (const [id, name, chemin] of [
    ['p-avec', 'Projet chartes', AVEC],
    ['p-sans', 'Projet nu', SANS],
  ]) {
    projet.run(id, name, chemin, JSON.stringify({ id, name, path: chemin, archived: false, createdAt: MAINTENANT, updatedAt: MAINTENANT }), MAINTENANT, MAINTENANT);
  }
  db.close();

  navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  for (const [taille, viewport] of [
    ['bureau', { width: 1440, height: 900 }],
    ['telephone', { width: 390, height: 844 }],
  ]) {
    for (const clarte of ['clair', 'sombre']) {
      const contexte = await navigateur.newContext({ viewport, colorScheme: clarte === 'sombre' ? 'dark' : 'light', isMobile: taille === 'telephone', hasTouch: taille === 'telephone' });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await contexte.newPage();
      const nom = `${taille}-${clarte}`;
      await page.goto(`${BASE}/#projet/p-avec/config/chartes`);
      const lignes = page.locator('[data-chartes-liste] [data-charte]');
      const lues = await attendre(async () => (await lignes.count()) === 3);
      if (!lues) {
        await page.screenshot({ path: path.join(TMP, 'echec.png') });
        console.log('URL', page.url(), 'contenu', (await page.locator('[data-rubrique-contenu]').allInnerTexts()).join(' | ').slice(0, 400));
        console.log(journal.join('').split('\n').filter((l) => /charte|erreur|error/i.test(l)).slice(-10).join('\n'));
      }
      noter(`${nom} : les trois chartes du dépôt se lisent`, lues, `${await lignes.count()} ligne(s)`);
      const deborde = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      noter(`${nom} : rien ne déborde en largeur`, !deborde);
      if (taille === 'bureau' && clarte === 'clair') {
        noter('la charte proposée offre « Valider »', (await page.locator('[data-charte-valider="application"]').count()) === 1);
        await page.locator('[data-charte-ouvrir="application"]').click();
        noter('une charte se déplie sur ses règles', await attendre(async () => (await page.locator('[data-charte="application"] [data-charte-contenu]').count()) === 1));
        if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `chartes-${nom}-depliee.png`) });
        await page.locator('[data-charte-valider="application"]').click();
        noter('« Valider » la passe en validée', await attendre(async () => (await page.locator('[data-charte="application"][data-charte-etat="validee"]').count()) === 1));
      }
      if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `chartes-${nom}.png`) });
      if (taille === 'bureau' && clarte === 'clair') {
        await page.goto(`${BASE}/#projet/p-sans/config/chartes`);
        noter('un projet sans charte le dit et propose « Faire rédiger »', await attendre(async () => (await page.locator('[data-chartes-vide]').count()) === 1 && (await page.locator('[data-chartes-rediger]').count()) === 1));
        if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `chartes-${nom}-vide.png`) });
      }
      await contexte.close();
    }
  }
  code = resultats.every((r) => r.ok) ? 0 : 1;
  console.log(`\n${resultats.filter((r) => r.ok).length}/${resultats.length} vérifications passent.`);
} catch (err) {
  console.error(err);
} finally {
  await navigateur?.close();
  process.exit(code);
}
