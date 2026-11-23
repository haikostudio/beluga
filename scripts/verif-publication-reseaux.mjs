#!/usr/bin/env node
/**
 * LA PUBLICATION OFFICIELLE SUR LES RÉSEAUX, DANS UN VRAI NAVIGATEUR.
 *
 * Démon à soi, base jetable : aucun réseau réel n'est appelé, aucun quota
 * dépensé (plafond d'agents à zéro). Ce qui est vérifié :
 *  1. le lieu Canaux de Communication liste les réseaux en tableau ;
 *  2. ses réglages avancés montrent en tête les neuf réseaux, chacun avec « Créer » tant
 *     qu'aucun compte n'est relié, et « Relier » éteint sans application ;
 *     « Créer » le dit dès le clic, puis laisse la place au STATUT de la carte, qui l'ouvre ;
 *  3. les identifiants d'une application se saisissent à la main : le secret
 *     part au COFFRE (jamais dans la table), et « Relier » s'allume ;
 *  4. « Relier » ouvre la connexion du réseau avec l'adresse de retour de
 *     Beluga ; un retour à l'état inventé est refusé ;
 *  5. un compte relié se coche dans « Où publier » d'un contenu, et l'envoi
 *     attend sur ce compte ; un contenu prêt montre « Publier maintenant » ;
 *  6. Messages montre un message relevé non lu, et l'ouvrir le marque lu ;
 *  7. à 390 px, ces réglages ne débordent pas de côté.
 *
 *   node scripts/verif-publication-reseaux.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKO_RESEAUX_PORT || 7211);
const BASE = `http://127.0.0.1:${PORT}`;
const PROJET = 'p-reseaux';
/* Des captures pour l'œil, si on les demande : HAIKO_RESEAUX_CAPTURES=/tmp/dossier. */
const CAPTURES = process.env.HAIKO_RESEAUX_CAPTURES || '';
const capturer = async (p, nom) => (CAPTURES ? p.screenshot({ path: path.join(CAPTURES, `${nom}.png`) }).catch(() => {}) : undefined);

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
console.log(`  …  dépôt jugé : ${RACINE}`);

const { DATA, PROJETS, attendrePort, journal } = demarrerDemonDEssai({
  prefixe: 'verif-reseaux-',
  port: PORT,
  depot: false,
  env: { BELUGA_ADRESSE_PUBLIQUE: BASE, BELUGA_MARKETING_NUIT: '0', BELUGA_PUBLICATION_SOCIALE: '0' },
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const base = () => new Database(path.join(DATA, 'beluga.db'));
const lire = (sql, ...args) => {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  try {
    return db.prepare(sql).get(...args);
  } finally {
    db.close();
  }
};

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), maintenant, maintenant + 3600_000, 'vérification réseaux');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
    PROJET,
    'Atelier Céramique',
    path.join(PROJETS, PROJET),
    JSON.stringify({ id: PROJET, name: 'Atelier Céramique', path: path.join(PROJETS, PROJET), defaultEngine: 'claude', isSelf: false, branchesDePublication: {}, rank: 1000, archived: false, createdAt: maintenant, updatedAt: maintenant }),
    maintenant,
    maintenant,
  );
  // Un agent attitré (inconnu du démon) : le voile « Initialiser » ne couvre pas l'atelier.
  db.prepare(
    `INSERT INTO marketing_espaces (project_id, agent_id, cle_suivi, nature, langue, fiche, cree_le, maj_le) VALUES (?, 'agent-fantome', 'clereseaux', 'boutique', 'fr', '{}', ?, ?)`,
  ).run(PROJET, maintenant, maintenant);
  db.prepare(
    `INSERT INTO marketing_contenus (id, project_id, genre, canal, canaux, titre, texte, etape, origine, lien_code, cree_le, maj_le)
     VALUES ('mc_pret', ?, 'post', 'facebook', '["facebook"]', 'Nouveaux bols', 'Nos bols d’automne sont arrivés.', 'pret', 'humain', 'lienpret', ?, ?)`,
  ).run(PROJET, maintenant, maintenant);
  db.close();
}

let navigateur;
try {
  if (!(await attendrePort())) {
    console.error(`Le démon d'essai n'a pas démarré.\n${journal.join('')}`);
    process.exit(1);
  }
  poserLeDecor();
  navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e?.message ?? e)));

  /* -------- 1-2. Les rubriques et l'onglet Comptes -------- */
  /* Communication a repris l'atelier : le lieu Canaux, et ses réglages avancés qui portent les comptes et les identifiants. */
  await page.goto(`${BASE}/#reseaux-sociaux/${PROJET}/canaux`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-communication-canaux]', { timeout: 30000 });
  noter('le lieu Canaux liste les réseaux dans son tableau', (await page.locator('[data-communication-tableau="canaux"] [data-communication-ligne]').count()) >= 9);
  await page.goto(`${BASE}/#reseaux-sociaux/${PROJET}/canaux/reglages`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-marketing-comptes]', { timeout: 15000 });
  const reseaux = await page.locator('[data-marketing-reseau]').evaluateAll((els) => els.map((e) => e.getAttribute('data-marketing-reseau')));
  noter('les neuf réseaux sont listés', reseaux.length === 9, reseaux.join(', '));
  noter('chaque réseau sans compte propose « Créer »', (await page.locator('[data-marketing-creer-compte]').count()) === 9);
  noter('« Relier » est éteint sans application', await page.locator('[data-marketing-relier="facebook"]').isDisabled());

  /* -------- 2 bis. « Créer » laisse la place au statut de la carte (20/10/2026) -------- */
  await page.locator('[data-marketing-creer-compte="pinterest"]').click();
  await page.waitForSelector('[data-marketing-statut-creation="pinterest"]', { timeout: 20000 }).catch(() => {});
  const statut = page.locator('[data-marketing-statut-creation="pinterest"]');
  noter('après « Créer », le statut de la carte prend sa place', (await statut.count()) === 1, (await statut.count()) ? await statut.innerText() : 'absent');
  const carteCreation = lire("SELECT id, column_key FROM cards WHERE project_id = ? AND title LIKE 'Ouvrir Pinterest%'", PROJET);
  noter('la carte de création existe, née sur le tableau', !!carteCreation, JSON.stringify(carteCreation));
  if ((await statut.count()) === 1) {
    await statut.click();
    await page.waitForSelector('[data-titre-carte]', { timeout: 15000 }).catch(() => {});
    noter('un clic sur le statut ouvre la carte de création', (await page.locator('[data-titre-carte]').first().innerText().catch(() => '')).includes('Pinterest'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.goto(`${BASE}/#reseaux-sociaux/${PROJET}/canaux/reglages`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-marketing-comptes]', { timeout: 15000 });
  }

  /* -------- 3. Les identifiants d'une application -------- */
  await page.locator('[data-marketing-identifiants="facebook"]').click();
  await page.waitForSelector('[data-marketing-fenetre-identifiants="facebook"]', { timeout: 10000 });
  await page.locator('[data-marketing-client-id]').fill('1234567890');
  await page.locator('[data-marketing-secret]').fill('secret-de-l-application-meta');
  await page.locator('[data-marketing-enregistrer-identifiants]').click();
  await page.waitForSelector('[data-marketing-fenetre-identifiants]', { state: 'detached', timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('[data-marketing-relier="facebook"]')?.hasAttribute('disabled'), null, { timeout: 15000 }).catch(() => {});
  noter('« Relier » s’allume une fois l’application saisie', !(await page.locator('[data-marketing-relier="facebook"]').isDisabled()));
  noter('Facebook et Instagram partagent l’application Meta', (await page.locator('[data-marketing-reseau="instagram"]').getAttribute('data-application')) === 'en_validation');
  const app = lire("SELECT * FROM marketing_applications WHERE application = 'meta'");
  const secret = lire("SELECT * FROM secrets WHERE champs LIKE '%secret-de-l-application-meta%'");
  noter('le secret est au coffre, jamais dans la table', !!secret && !JSON.stringify(app ?? {}).includes('secret-de-l-application-meta') && app?.secret_ref === secret?.id);

  /* -------- 4. « Relier » ouvre la connexion du réseau -------- */
  // Le réseau n'est jamais joint : sa première requête est retenue puis coupée.
  let demandee = '';
  await contexte.route(/facebook\.com/, (route) => {
    demandee ||= route.request().url();
    return route.abort();
  });
  const [onglet] = await Promise.all([contexte.waitForEvent('page', { timeout: 15000 }), page.locator('[data-marketing-relier="facebook"]').click()]);
  for (let i = 0; i < 40 && !demandee; i++) await new Promise((r) => setTimeout(r, 250));
  const adresse = new URL(demandee || 'about:blank');
  noter('« Relier » ouvre la connexion du réseau avec l’adresse de retour de Beluga', adresse.hostname.endsWith('facebook.com') && adresse.searchParams.get('redirect_uri') === `${BASE}/m/oauth/retour` && !!adresse.searchParams.get('state'), adresse.origin);
  await onglet.close();
  const retour = await fetch(`${BASE}/m/oauth/retour?state=invente&code=x`);
  noter('un retour à l’état inventé est refusé', retour.status === 400 && (await retour.text()).includes('data-retour-reseau="echec"'));

  /* -------- 5. « Où publier » -------- */
  {
    const db = base();
    const maintenant = Date.now();
    db.prepare(
      `INSERT INTO marketing_comptes (id, project_id, reseau, distant_id, nom, etat, details, cree_le, maj_le) VALUES ('sc_page', ?, 'facebook', 'page-1', 'Page Atelier', 'relie', '{}', ?, ?)`,
    ).run(PROJET, maintenant, maintenant);
    db.prepare(
      `INSERT INTO marketing_messages (id, project_id, compte_id, reseau, genre, distant_id, fil, auteur, texte, instant, sortant, lu) VALUES ('sm_1', ?, 'sc_page', 'facebook', 'commentaire', 'c-1', 'post-1', 'Lina', 'Très beaux bols !', ?, 0, 0)`,
    ).run(PROJET, maintenant);
    db.close();
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-marketing-comptes]', { timeout: 30000 });
  await page.waitForSelector('[data-marketing-compte="sc_page"]', { timeout: 15000 });
  await capturer(page, 'comptes');
  noter('le compte relié paraît sous son réseau, et « Créer » laisse la place', (await page.locator('[data-marketing-creer-compte="facebook"]').count()) === 0);
  // UN COMPTE RELIÉ VAUT CHOIX DU CANAL : coché d'office, et compté par l'agent.
  noter('un compte relié coche son canal d’office', (await page.locator('[data-marketing-comptes] [data-marketing-canal="facebook"][data-choisi="oui"]').count()) === 1);
  await page.goto(`${BASE}/#reseaux-sociaux/${PROJET}/contenus`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-communication-ligne="mc_pret"]').first().click({ timeout: 15000 });
  await page.waitForSelector('[data-marketing-ou-publier]', { timeout: 15000 });
  await page.locator('[data-marketing-cible="sc_page"] button').click();
  await page.waitForSelector('[data-marketing-cible="sc_page"][data-etat="en_attente"]', { timeout: 15000 }).catch(() => {});
  noter('un compte coché attend l’envoi', !!lire("SELECT 1 FROM marketing_publications WHERE contenu_id = 'mc_pret' AND compte_id = 'sc_page' AND etat = 'en_attente'"));
  await capturer(page, 'ou-publier');
  noter('un contenu prêt propose « Publier maintenant »', (await page.locator('[data-marketing-publier-maintenant]').count()) === 1);
  await page.keyboard.press('Escape');

  /* -------- 6. Messages -------- */
  await page.goto(`${BASE}/#reseaux-sociaux/${PROJET}/messages`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-communication-ligne="sm_1"]', { timeout: 15000 });
  noter('le message non lu le montre', (await page.locator('[data-communication-ligne="sm_1"] [data-communication-non-lu]').count()) === 1);
  await page.locator('[data-communication-ligne="sm_1"]').first().click();
  await page.waitForSelector('[data-communication-fil-ouvert="sm_1"]', { timeout: 10000 });
  let lu = false;
  for (let i = 0; i < 20 && !lu; i++) {
    await new Promise((r) => setTimeout(r, 250));
    lu = lire("SELECT lu FROM marketing_messages WHERE id = 'sm_1'")?.lu === 1;
  }
  await capturer(page, 'messages');
  noter('ouvrir un message le marque lu, et propose la réponse', lu && (await page.locator('[data-communication-champ-reponse]').count()) === 1);

  /* -------- 7. Téléphone -------- */
  const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-CH' });
  await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const telPage = await tel.newPage();
  /* Au tout premier chargement sur téléphone, l'adresse « #reseaux-sociaux/… » peut
     être lue avant que l'application ne soit prête : on la repose, au besoin. */
  await telPage.goto(`${BASE}/#reseaux-sociaux/${PROJET}/canaux/reglages`, { waitUntil: 'domcontentloaded' });
  for (let essai = 0; essai < 3; essai++) {
    const ouvert = await telPage.waitForSelector('[data-marketing-comptes]', { state: 'attached', timeout: 10000 }).then(() => true).catch(() => false);
    if (ouvert) break;
    await telPage.evaluate((h) => {
      window.location.hash = '';
      window.location.hash = h;
    }, `#reseaux-sociaux/${PROJET}/canaux/reglages`);
  }
  await telPage.waitForSelector('[data-marketing-reseau="linkedin"]', { timeout: 15000 });
  await capturer(telPage, 'comptes-telephone');
  const deborde = await telPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  noter('à 390 px, l’onglet Canaux et ses comptes ne débordent pas de côté', !deborde);
  await tel.close();

  noter('aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));
} catch (err) {
  noter('déroulé de l’essai', false, String(err?.stack ?? err));
} finally {
  await navigateur?.close().catch(() => {});
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications réussies.`);
process.exit(echecs.length ? 1 : 0);
