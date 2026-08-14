#!/usr/bin/env node
/**
 * LE MICRO AU REPOS — il ne s'ouvre que si on l'a demandé, et il se referme.
 *
 * Sur téléphone, le repère orange du système s'allumait pendant une simple
 * navigation, sans que personne n'ait appuyé sur un bouton de dictée. Deux
 * causes, toutes deux rejouées ici dans un vrai navigateur :
 *
 *   1. les interrupteurs d'écoute étaient RETENUS SUR LE SERVEUR : allumés une
 *      fois n'importe où, ils rouvraient le micro tout seuls au chargement
 *      suivant, sur n'importe quel appareil ;
 *   2. le micro de la dictée n'était refermé que par les deux boutons du
 *      bandeau : quitter l'écran en pleine dictée le laissait ouvert.
 *
 * Ce que le script vérifie, dans l'ordre :
 *   1. les deux interrupteurs LAISSÉS ALLUMÉS en base n'ouvrent AUCUN micro ;
 *   2. parcourir l'application sans toucher au micro n'en ouvre aucun ;
 *   3. l'écoute allumée À LA MAIN ouvre bien un micro (le geste marche encore) ;
 *   4. éteinte, plus AUCUNE piste vivante ;
 *   5. rechargée alors qu'elle était allumée, la page repart micro fermé ;
 *   6. une dictée commencée puis abandonnée en changeant d'écran referme tout.
 *
 *   HAIKO_MICRO_URL=http://localhost:7099 node scripts/verif-micro-au-repos.mjs
 *
 * Le serveur de DÉVELOPPEMENT est visé : un script de vérification ne reprend
 * jamais HAIKODEV_URL, qui désigne l'application déjà publiée. Le micro est
 * FACTICE et muet, la transcription est INTERCEPTÉE : ni Whisper ni le moteur
 * de voix ne sont appelés, aucun quota n'est dépensé. Les préférences touchées
 * sont relevées au départ et reposées à l'identique en partant.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_MICRO_URL || 'http://localhost:7099';
const SHOTS = '/root/haikodev/data/verification';

const base = new Database('/root/haikodev/data/haikodev.db');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

const jeton = crypto.randomBytes(32).toString('base64url');
base
  .prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)')
  .run(sha(jeton), Date.now(), Date.now() + 3600_000, 'vérification micro au repos');
process.on('exit', () => base.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton)));

const CLES_RENDUES = ['voix.ecoute', 'voix.conversation', 'voix'];
const avant = new Map(
  CLES_RENDUES.map((cle) => [
    cle,
    base.prepare('SELECT value FROM preferences WHERE key = ?').get(cle)?.value ?? null,
  ]),
);
const poser = (cle, valeur) =>
  base
    .prepare(
      'INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    )
    .run(cle, valeur, Date.now());
process.on('exit', () => {
  for (const [cle, valeur] of avant) {
    if (valeur === null) base.prepare('DELETE FROM preferences WHERE key = ?').run(cle);
    else poser(cle, valeur);
  }
});

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

console.log(`Dépôt jugé : ${RACINE}`);

const navigateur = await chromium.launch({
  channel: 'chrome',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ],
});

/**
 * Une page de téléphone qui COMPTE les micros. On enveloppe `getUserMedia` pour
 * relever chaque ouverture et garder les flux rendus : c'est le nombre de PISTES
 * ENCORE VIVANTES qui dit si le repère du système resterait allumé — un flux
 * qu'on a oublié de refermer se voit là, et nulle part ailleurs.
 */
async function ouvrirPage() {
  const contexte = await navigateur.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    permissions: ['microphone'],
  });
  await contexte.addCookies([
    { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  await contexte.addInitScript(() => {
    window.__micros = 0;
    window.__flux = [];
    const gum = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (gum) {
      navigator.mediaDevices.getUserMedia = async (...a) => {
        window.__micros += 1;
        const flux = await gum(...a);
        window.__flux.push(flux);
        return flux;
      };
    }
  });
  const page = await contexte.newPage();
  page.setDefaultTimeout(15_000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.route('**/api/transcribe', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, text: '' }) }),
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  for (let essai = 0; essai < 3 && (await page.locator('[role="dialog"]').count()); essai += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  return { contexte, page, erreurs };
}

/** Ce que la page dit du micro : ouvertures demandées, pistes encore vivantes. */
const micros = (p) =>
  p.evaluate(() => ({
    ouvertures: window.__micros ?? 0,
    vivantes: (window.__flux ?? [])
      .flatMap((f) => f.getTracks())
      .filter((t) => t.readyState === 'live').length,
    // Le registre de la porte unique (`web/src/lib/micro.ts`), point d'essai.
    prises: window.haikodevEssai?.micros?.() ?? null,
    etatEcoute: document.querySelector('[data-module-voix]')?.getAttribute('data-etat-ecoute') ?? null,
  }));

/** Ouvrir le panneau du module de voix (au doigt, sur téléphone). */
const ouvrirPanneau = async (p) => {
  const ouvert = () =>
    p.evaluate(() => document.querySelector('[data-module-voix]')?.hasAttribute('data-ouvert') ?? false);
  for (let essai = 0; essai < 3 && !(await ouvert()); essai += 1) {
    await p.locator('[data-icone-voix]').first().tap({ force: true });
    await p.waitForTimeout(700);
  }
  return ouvert();
};

/** Basculer l'écoute par le VRAI chemin : le panneau, puis l'interrupteur. */
const basculerEcoute = async (p) => {
  await ouvrirPanneau(p);
  await p.locator('[data-interrupteur-ecoute]').dispatchEvent('click');
  await p.waitForTimeout(2500);
};

/** Changer d'écran par le menu du bas — le geste qui démonte la barre d'écriture. */
const allerA = async (p, nom) => {
  await p.locator('[data-menu-bas] button', { hasText: nom }).first().tap();
  await p.waitForTimeout(1500);
};

let ouverte = null;
try {
  /* ---------- 1. Les interrupteurs laissés ALLUMÉS en base ---------- */
  // C'est la panne d'origine : un réglage allumé une fois, retrouvé au
  // chargement, rouvrait le micro tout seul — sur le téléphone comme ailleurs.
  poser('voix.ecoute', 'true');
  poser('voix.conversation', 'true');

  ouverte = await ouvrirPage();
  const { page, erreurs } = ouverte;

  const auChargement = await micros(page);
  noter(
    'un réglage d’écoute laissé allumé n’ouvre AUCUN micro au chargement',
    auChargement.ouvertures === 0,
    `${auChargement.ouvertures} ouverture(s), état « ${auChargement.etatEcoute} »`,
  );
  noter(
    'la porte du micro tient un registre, et il est vide',
    auChargement.prises === 0,
    auChargement.prises === null ? 'point d’essai absent (viser le serveur de développement)' : `${auChargement.prises} prise(s)`,
  );
  noter(
    'l’écoute part bien d’un état éteint',
    auChargement.etatEcoute === 'eteinte',
    `état « ${auChargement.etatEcoute} »`,
  );
  // Le réglage resté allumé est ÉTEINT en base : il ne doit plus mentir.
  const enBase = base.prepare('SELECT value FROM preferences WHERE key = ?').get('voix.ecoute')?.value;
  noter('le réglage resté allumé est éteint en base', enBase === 'false', `valeur « ${enBase} »`);

  /* ---------- 2. Parcourir l'application sans rien demander ---------- */
  await allerA(page, 'Tableau');
  await allerA(page, 'Chef');
  await ouvrirPanneau(page);
  await page.waitForTimeout(1000);
  const apresParcours = await micros(page);
  noter(
    'parcourir l’application sans toucher au micro n’en ouvre aucun',
    apresParcours.ouvertures === 0 && apresParcours.vivantes === 0,
    `${apresParcours.ouvertures} ouverture(s), ${apresParcours.vivantes} piste(s) vivante(s)`,
  );
  await page.screenshot({ path: `${SHOTS}/micro-au-repos.png` });

  /* ---------- 3 & 4. Le geste, lui, marche toujours ---------- */
  await basculerEcoute(page);
  const enGuet = await micros(page);
  noter(
    'l’écoute allumée à la main ouvre bien un micro',
    enGuet.ouvertures === 1 && enGuet.vivantes === 1,
    `${enGuet.ouvertures} ouverture(s), ${enGuet.vivantes} vivante(s), état « ${enGuet.etatEcoute} »`,
  );

  await basculerEcoute(page);
  await page.waitForTimeout(1500);
  const apresExtinction = await micros(page);
  noter(
    'l’écoute éteinte, plus aucune piste ne reste vivante',
    apresExtinction.vivantes === 0 && apresExtinction.prises === 0,
    `${apresExtinction.vivantes} piste(s), ${apresExtinction.prises} prise(s)`,
  );

  /* ---------- 5. Rechargement : rien ne survit ---------- */
  await basculerEcoute(page);
  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const apresRechargement = await micros(page);
  noter(
    'rechargée alors que l’écoute tournait, la page repart micro fermé',
    apresRechargement.ouvertures === 0 && apresRechargement.vivantes === 0,
    `${apresRechargement.ouvertures} ouverture(s), ${apresRechargement.vivantes} vivante(s)`,
  );

  /* ---------- 6. Une dictée abandonnée en changeant d'écran ---------- */
  await allerA(page, 'Chef');
  const bouton = page.locator('button[title="Dicter"]').first();
  if ((await bouton.count()) === 0 || (await bouton.isDisabled())) {
    noter(
      'le bouton de dictée est atteignable pour être jugé',
      false,
      'bouton absent ou éteint — la suite n’a pas pu être jugée',
    );
  } else {
    await bouton.tap();
    await page.waitForTimeout(2000);
    const enDictee = await micros(page);
    noter(
      'le bouton de dictée ouvre le micro, et un seul',
      enDictee.vivantes === 1,
      `${enDictee.vivantes} piste(s) vivante(s)`,
    );
    // On QUITTE L'ÉCRAN sans valider ni jeter : c'est la fuite d'origine.
    await allerA(page, 'Tableau');
    await page.waitForTimeout(1500);
    const apresDepart = await micros(page);
    noter(
      'quitter l’écran en pleine dictée referme le micro',
      apresDepart.vivantes === 0 && apresDepart.prises === 0,
      `${apresDepart.vivantes} piste(s), ${apresDepart.prises} prise(s)`,
    );
  }

  noter('aucune erreur ne sort de la page', erreurs.length === 0, erreurs[0] ?? '');
} catch (e) {
  noter('le contrôle est allé au bout', false, String(e).slice(0, 200));
} finally {
  await ouverte?.contexte.close().catch(() => undefined);
  await navigateur.close().catch(() => undefined);
}

const rates = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés`);
process.exit(rates.length ? 1 : 0);
