#!/usr/bin/env node
/**
 * L'ASSISTANT GLOBAL ET LA FIN DE TÂCHE, dans un vrai navigateur.
 *
 *   1. le robot est en bas à droite, dans le coin (à gauche du rond marketing
 *      sur la seule page Marketing) ;
 *   2. il glisse À L'HORIZONTALE (événements de pointeur), sa place est
 *      retenue par le serveur et survit au rechargement ;
 *   3. un clic ouvre le chat juste au-dessus de lui, avec la barre d'écriture
 *      des tâches et son bouton de réglages (modèle, réflexion), comme pour
 *      tout agent — plus d'interrupteur « Validation automatique » ni de bande
 *      de niveau (18/10/2026) ;
 *   4. la poignée du coin haut gauche agrandit le chat ;
 *   6. une carte « À déployer » n'a plus qu'UN bouton de fin de tâche, qui
 *      ouvre ses actions (une page depuis la refonte, `data-tiroir-fin-de-tache`),
 *      sans « remettre en demande » ;
 *   8. sur téléphone (390 × 844, zone sûre du haut simulée à 47 px) : plus de
 *      robot flottant, un bouton dans l'entête juste avant le menu — depuis la
 *      refonte du 11/10/2026, le bouton « ⋮ » des options du projet
 *      (`[data-entete-de-zone] [data-menu-general]`), le bouton « Menu » général
 *      ayant disparu —, et le chat s'ouvre SOUS l'entête, sous la zone sûre,
 *      au-dessus du bas de l'écran (`nav[data-menu-bas]`, qui ne porte plus
 *      qu'un bouton, « Nouvelle tâche »).
 *
 * La porte d'accord elle-même (seuls suppression, envoi au client et effacement
 * sur un serveur restent soumis à l'accord) se vérifie sur la
 * règle pure et sur le registre des attentes, sans dépenser de quota :
 * `server/src/test/assistant-global.test.ts`, `attente-question.test.ts`.
 *
 *   node scripts/verif-assistant-global.mjs
 *
 * Le script monte son PROPRE démon (base neuve, plafond d'agents à zéro).
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7197);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* Les captures survivent au démon d'essai, qui efface son dossier en partant. */
const CAPTURES = fs.mkdtempSync(path.join(os.tmpdir(), 'captures-assistant-global-'));
const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-assistant-global-', port: PORT });

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const CARTE_LOT = { id: 'c-lot', titre: 'Carte d’essai — dans le lot' };

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification assistant global',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    JSON.stringify({ ...reglages, maxAgents: 0 }),
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai assistant',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
    projet.id,
    projet.name,
    projet.path,
    JSON.stringify(projet),
    maintenant,
    maintenant,
  );
  const carte = {
    id: CARTE_LOT.id,
    projectId: PROJET_ID,
    title: CARTE_LOT.titre,
    description: 'Carte fabriquée par le script de vérification.',
    labels: [],
    column: 'to_deploy',
    position: 1,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    scheduling: { asap: false, attempts: 0, restarts: 0, suspendu: false },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(carte.id, PROJET_ID, carte.column, carte.position, carte.title, JSON.stringify(carte), maintenant, maintenant);
  db.close();
}

function lireMeta(cle) {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const ligne = db.prepare('SELECT value FROM meta WHERE key = ?').get(cle);
  db.close();
  return ligne?.value ?? null;
}

const boite = (page, selecteur) => page.locator(selecteur).first().boundingBox();

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-bouton-du-bord]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);

  /* -------- 1. L'entrée : le bouton du bord, plus de robot (carte « Jarvis : volet, voix et rapidité », 16/11/2026) -------- */
  noter('une seule entrée vers l’assistant, le bouton du bord', (await page.getByRole('button', { name: /Ouvrir l’assistant/ }).count()) === 1);
  const bouton = await boite(page, '[data-bouton-du-bord]');
  noter('le bouton du bord est affiché, collé au bord gauche', !!bouton && bouton.x < 1, bouton ? `x ${Math.round(bouton.x)}` : '');

  /* -------- 3. Le volet s'ouvre du côté du bouton (en texte : le toucher du bouton lance la voix) -------- */
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant')));
  await page.waitForSelector('[data-assistant-conversation="oui"]', { timeout: 20000 }).catch(() => {});
  const chat = await boite(page, '[data-assistant-chat]');
  noter('le volet s’ouvre (en texte : le toucher du bouton lance la voix)', !!chat);
  noter('le volet est posé à droite du bouton, contre lui', !!chat && !!bouton && chat.x >= bouton.x + bouton.width && chat.x - (bouton.x + bouton.width) < 24);
  noter('la conversation de l’assistant est chargée', (await page.locator('[data-assistant-conversation="oui"]').count()) === 1);
  noter('elle porte la barre d’écriture des tâches', (await page.locator('[data-assistant-chat] textarea').count()) >= 1);
  noter('plus d’interrupteur « Validation automatique »', (await page.locator('[data-assistant-validation]').count()) === 0);
  noter('plus de bande de niveau en tête du chat', (await page.locator('[data-assistant-reglages]').count()) === 0);
  noter(
    'le modèle se règle dans la barre d’écriture, comme pour tout agent',
    (await page.locator('[data-assistant-chat] [data-raccourci-reglages-agent]').count()) >= 1,
  );

  /* -------- 4. La poignée (coin opposé à l'ancrage : en haut à droite) agrandit le volet -------- */
  const poignee = await boite(page, '[data-assistant-poignee]');
  await page.mouse.move(poignee.x + 4, poignee.y + 4);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(poignee.x + 4 + i * 15, poignee.y + 4 - i * 10);
  await page.mouse.up();
  await page.waitForTimeout(1000);
  const grand = await boite(page, '[data-assistant-chat]');
  noter('la poignée élargit le volet', !!grand && grand.width > chat.width + 100, `${Math.round(chat.width)} → ${Math.round(grand?.width ?? 0)}`);
  noter('…et le grandit en hauteur', !!grand && grand.height > chat.height + 60, `${Math.round(chat.height)} → ${Math.round(grand?.height ?? 0)}`);

  await page.screenshot({ path: path.join(CAPTURES, 'assistant-ouvert.png') });
  await page.locator('[data-bouton-du-bord]').click();
  await page.waitForTimeout(800);
  noter('après un redimensionnement, le bouton du bord referme bien le volet', (await page.locator('[data-assistant-chat]').count()) === 0);

  /* -------- 6. Une fin de tâche n'a qu'un bouton -------- */
  const onglet = page.getByRole('button', { name: /^Tableau$/ });
  if (await onglet.count()) await onglet.first().click();
  await page.waitForTimeout(1500);
  await page.locator(`article:has-text(${JSON.stringify(CARTE_LOT.titre)})`).first().click();
  await page.waitForSelector('[data-titre-carte]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  noter('la carte « À déployer » a un seul bouton, « Déployer »', (await page.locator('[data-geste="deployer-lot"]').count()) === 1);
  noter('plus de liste d’actions de fin de tâche', (await page.locator('[data-bouton-fin-de-tache], [data-tiroir-fin-de-tache]').count()) === 0);
  noter('« remettre en demande » a disparu', (await page.locator('[data-geste="reprendre"]').count()) === 0);
  await page.screenshot({ path: path.join(CAPTURES, 'tiroir-fin.png') });

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  /* -------- 8. Sur téléphone : le bouton du bord, le volet sous l'entête -------- */
  const ZONE_SURE = 47;
  const mobile = await navigateur.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await mobile.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const tel = await mobile.newPage();
  await tel.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await tel.waitForSelector('[data-bouton-du-bord]', { timeout: 30000 }).catch(() => {});
  await tel.waitForTimeout(1500);
  /* La fiche ouverte à l'étape 6 se rouvre sur ce compte : elle passe DEVANT
     l'écran (une fenêtre modale le couvre). On la referme d'abord. */
  for (let i = 0; i < 3 && (await tel.locator('[role="dialog"]').count()); i++) {
    await tel.keyboard.press('Escape');
    await tel.waitForTimeout(700);
  }
  // La barre d'état d'un iPhone en application installée : 47 px de zone sûre.
  await tel.evaluate((px) => document.documentElement.style.setProperty('--zone-sure-haut', `${px}px`), ZONE_SURE);
  noter('sur téléphone, une seule entrée vers l’assistant, le bouton du bord', (await tel.getByRole('button', { name: /Ouvrir l’assistant/ }).count()) === 1);
  const titre = await tel.locator('[data-titre-bandeau]').first().evaluate((el) => el.scrollWidth <= el.clientWidth + 1 || getComputedStyle(el).textOverflow === 'ellipsis').catch(() => true);
  noter('l’entête ne déborde pas', titre && (await tel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)));
  await tel.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant')));
  await tel.waitForSelector('[data-assistant-chat]', { timeout: 20000 }).catch(() => {});
  await tel.waitForTimeout(1200);
  const chatTel = (await tel.locator('[data-assistant-chat]').count()) ? await boite(tel, '[data-assistant-chat]') : null;
  noter('sur téléphone, le volet prend toute la largeur', !!chatTel && Math.round(chatTel.width) === 390 - 16);
  noter('…il s’ouvre sous l’entête et sous la zone sûre', !!chatTel && chatTel.y >= ZONE_SURE + 44, `haut ${Math.round(chatTel?.y ?? -1)}`);
  const enteteChat = await boite(tel, '[data-assistant-chat] header');
  noter('…son entête est entièrement visible', !!enteteChat && enteteChat.y >= ZONE_SURE && enteteChat.y + enteteChat.height <= 844);
  const menuBas = await boite(tel, 'nav[data-menu-bas]');
  noter('…et il s’arrête au-dessus du menu du bas', !!chatTel && (!menuBas || chatTel.y + chatTel.height <= menuBas.y + 1));
  await tel.screenshot({ path: path.join(CAPTURES, 'telephone.png') });
  await tel.locator('[data-bouton-du-bord]').click();
  await tel.waitForTimeout(800);
  noter('le bouton du bord referme le volet', (await tel.locator('[data-assistant-chat]').count()) === 0);
  await mobile.close();

  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées (captures dans ${CAPTURES})`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.slice(-20).join(''));
  process.exit(1);
});
