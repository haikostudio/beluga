#!/usr/bin/env node
/**
 * L'APPLICATION INSTALLÉE NE DÉPASSE JAMAIS CE QUI SE VOIT.
 *
 *   npm run build && env -u BELUGA_TOKEN node scripts/verif-hauteur-app-installee.mjs
 *
 * Un iPhone Pro Max n'a pas montré le bas de l'interface (boutons, pied) : la
 * hauteur de l'écran physique était posée telle quelle alors que la fenêtre
 * était plus basse, et `overflow: hidden` coupait le reste. Ce contrôle rejoue
 * l'iPhone sur un Chrome de serveur — l'écran annoncé, le mode « installée »
 * et les zones sûres se POSENT, ils ne se simulent pas autrement — et vérifie,
 * dans un démon JETABLE (base neuve, aucun moteur appelé) :
 *
 *   1. portrait, sous les barres du système : l'application prend tout l'écran ;
 *   2. fenêtre plus basse que l'écran, sans zones sûres : elle suit la fenêtre
 *      (le bas reste visible) ;
 *   3. paysage — iOS annonce encore l'écran en portrait : elle suit la fenêtre ;
 *   4. démarrage à froid (la fenêtre manque une barre) : elle prend l'écran,
 *      la recette de la « bande vide en bas » reste intacte ;
 *   5. dans un onglet de navigateur : aucune hauteur n'est posée à la main.
 *
 * Dans chaque cas on vérifie que le bas de l'application ne passe JAMAIS sous
 * le bord visible, hors le cas 4 où l'écart est précisément la barre d'accueil.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { poserZonesSures } from './lib/zone-sure.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_HAUTEUR_APP_PORT || 7243);
const BASE = `http://127.0.0.1:${PORT}`;
const { DATA, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-hauteur-app-', port: PORT, signaux: true });

const echecs = [];
const noter = (nom, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : ' ÉCHEC'}  ${nom}${detail ? ` — ${detail}` : ''}`);
  if (!ok) echecs.push(nom);
};

if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}

const JETON = crypto.randomBytes(32).toString('hex');
{
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare(
    `INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le) VALUES ('u-essai', 'essai', 'admin', 'Essai', ?, 'x', 1, ?)`,
  ).run(crypto.randomBytes(16).toString('hex'), maintenant);
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(JETON).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'verif-hauteur-app',
    'u-essai',
  );
  db.close();
}

const SCENARIOS = [
  {
    nom: '1. portrait, sous les barres du système',
    viewport: { width: 430, height: 932 },
    ecran: { width: 430, height: 932 },
    zones: { haut: 59, bas: 34 },
    installee: true,
    attendu: 932,
  },
  {
    nom: '2. fenêtre plus basse que l’écran, sans zones sûres',
    viewport: { width: 430, height: 839 },
    ecran: { width: 430, height: 932 },
    zones: { haut: 0, bas: 0 },
    installee: true,
    attendu: 839,
  },
  {
    nom: '3. paysage, l’écran annoncé reste en portrait',
    viewport: { width: 932, height: 430 },
    ecran: { width: 430, height: 932 },
    zones: { haut: 0, bas: 21 },
    installee: true,
    attendu: 430,
  },
  {
    nom: '4. démarrage à froid, la fenêtre manque la barre d’accueil',
    viewport: { width: 430, height: 898 },
    ecran: { width: 430, height: 932 },
    zones: { haut: 59, bas: 34 },
    installee: true,
    attendu: 932,
    ecartAdmis: true,
  },
  {
    nom: '5. onglet de navigateur',
    viewport: { width: 430, height: 839 },
    ecran: { width: 430, height: 932 },
    zones: { haut: 0, bas: 0 },
    installee: false,
    attendu: null,
  },
];

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const cas of SCENARIOS) {
    const contexte = await navigateur.newContext({
      viewport: cas.viewport,
      deviceScaleFactor: 1,
      hasTouch: true,
      isMobile: true,
      locale: 'fr-CH',
      serviceWorkers: 'block',
    });
    await contexte.addCookies([{ name: 'beluga_session', value: JETON, domain: '127.0.0.1', path: '/' }]);
    const page = await contexte.newPage();
    await page.addInitScript(
      ([ecran, installee]) => {
        Object.defineProperty(window.screen, 'width', { get: () => ecran.width });
        Object.defineProperty(window.screen, 'height', { get: () => ecran.height });
        Object.defineProperty(window.navigator, 'standalone', { get: () => installee });
      },
      [cas.ecran, cas.installee],
    );
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.locator('#root > *').first().waitFor({ timeout: 30_000 });
    /* Posées APRÈS le chargement : au tout début d'une page, la racine n'existe pas encore. */
    await poserZonesSures(page, cas.zones);
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(500);

    const lu = await page.evaluate(() => {
      const brut = document.documentElement.style.getPropertyValue('--hauteur-app');
      const corps = document.body.getBoundingClientRect();
      return { variable: brut, corpsBas: Math.round(corps.bottom), corpsHauteur: Math.round(corps.height), fenetre: window.innerHeight };
    });
    if (cas.attendu === null) {
      noter(`${cas.nom} : aucune hauteur posée à la main`, lu.variable === '', `variable « ${lu.variable} »`);
    } else {
      noter(`${cas.nom} : l’application mesure ${cas.attendu} px`, lu.variable === `${cas.attendu}px` && lu.corpsHauteur === cas.attendu, `variable ${lu.variable}, corps ${lu.corpsHauteur}`);
    }
    if (!cas.ecartAdmis) {
      noter(`${cas.nom} : le bas de l’application reste visible`, lu.corpsBas <= lu.fenetre + 1, `bas ${lu.corpsBas} / fenêtre ${lu.fenetre}`);
    }
    await contexte.close();
  }
} finally {
  await navigateur.close();
}

if (echecs.length) {
  console.error(`\n${echecs.length} échec(s) :\n- ${echecs.join('\n- ')}\n\nJournal du démon :\n${journal.join('').slice(-1500)}`);
  process.exit(1);
}
console.log('\nLe bas de l’application installée reste visible, et la bande vide ne revient pas.');
process.exit(0);
