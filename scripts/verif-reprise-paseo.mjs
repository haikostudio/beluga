#!/usr/bin/env node
/**
 * Contrôle de la reprise des tâches Paseo, dans un vrai navigateur.
 * Ouvre le projet etsigna-dev, compte les cartes reprises dans « À faire »,
 * puis ouvre une carte et compare son titre, sa description et ses étiquettes
 * avec l'original resté chez Paseo.
 *
 *   node scripts/verif-reprise-paseo.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';

const BASE = process.env.HAIKODEV_URL || 'http://127.0.0.1:7070';
const SHOTS = '/root/haikodev/data/verification';

const base = new Database('/root/haikodev/data/haikodev.db');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

/**
 * Les jetons de session sont stockés hachés : impossible d'en réutiliser un.
 * Le script s'en fabrique donc un, valable une heure, et le retire en partant.
 */
const jeton = process.env.HAIKODEV_TOKEN || crypto.randomBytes(32).toString('base64url');
const jetonJetable = !process.env.HAIKODEV_TOKEN;
if (jetonJetable) {
  base
    .prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)')
    .run(sha(jeton), Date.now(), Date.now() + 3600_000, 'vérification reprise Paseo');
}
const rendre = () => {
  if (jetonJetable) base.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton));
};
process.on('exit', rendre);

/** L'original, lu chez Paseo — jamais écrit. */
const paseo = JSON.parse(
  fs.readFileSync(
    '/home/paseo/.paseo/tasks/' +
      Buffer.from('remote:github.com/haikostudio/etsigna-dev').toString('base64url') +
      '.json',
    'utf8',
  ),
);
const temoin = paseo.tasks.find((t) => t.column === 'validated' && t.order === 0);

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
});
const contexte = await navigateur.newContext({
  viewport: { width: 1400, height: 900 },
  locale: 'fr-CH',
  ignoreHTTPSErrors: true,
  serviceWorkers: 'block',
});
if (jeton) {
  await contexte.addCookies([
    { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
}
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

// Le projet etsigna-dev, dans la colonne de gauche.
const projet = page.getByText('etsigna-dev', { exact: true }).first();
await projet.click();
await page.waitForTimeout(2000);

// Les douze titres repris doivent tous être posés sur le tableau.
const tableau = await page.locator('body').innerText();
const reprises = paseo.tasks.filter((t) => t.column === 'validated');
const vues = reprises.filter((t) => tableau.includes(t.title.slice(0, 40)));
noter('les douze titres repris sont sur le tableau', vues.length === reprises.length, `${vues.length}/${reprises.length}`);
noter('ils sont dans la colonne « À faire »', /À FAIRE\s*\n?\s*1[0-9]/i.test(tableau) || tableau.includes('À FAIRE'));

const carte = page.getByText(temoin.title, { exact: false }).first();
await carte.click();
await page.waitForTimeout(1500);

const entete = await page.locator('body').innerText();
noter('le titre de la carte témoin est là', entete.includes(temoin.title));
noter('la carte est bien « À faire »', entete.includes('À faire'));
for (const etiquette of [...temoin.tags, 'à valider', 'repris de Paseo']) {
  noter(`étiquette « ${etiquette} »`, entete.includes(etiquette));
}

// La description vit sous l'onglet « Détails ».
await page.getByRole('tab', { name: 'Détails' }).first().click().catch(async () => {
  await page.getByText('Détails', { exact: true }).first().click();
});
await page.waitForTimeout(1200);
// La description est dans un champ de saisie : son texte n'est pas dans la page.
const champs = await page.locator('textarea').all();
const valeurs = await Promise.all(champs.map((c) => c.inputValue()));
noter('la description entière est là', valeurs.some((v) => v.trim() === temoin.description.trim()));

const details = await page.locator('body').innerText();
if (temoin.estimate?.billingHours) {
  noter(`estimation reprise (${temoin.estimate.billingHours} h)`, details.includes(`${temoin.estimate.billingHours} h`));
}
noter('aucune erreur de page', erreurs.length === 0, erreurs.join(' | '));

fs.mkdirSync(SHOTS, { recursive: true });
await page.screenshot({ path: `${SHOTS}/reprise-paseo.png`, fullPage: false });

await navigateur.close();
const rates = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôle(s) au vert.`);
process.exit(rates.length ? 1 : 0);
