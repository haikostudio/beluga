#!/usr/bin/env node
/**
 * LE MENU AU SURVOL, LA CONVERSATION DE L'AGENT DES RÉSEAUX SOCIAUX, « MISES EN LIGNE », LE GLISSER DES PROJETS REGROUPÉS ET
 * L'ICÔNE D'UN REGROUPEMENT (carte du 31/10/2026), dans un vrai navigateur, sur un démon d'essai à base neuve.
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-menus-et-mises-en-ligne.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7241);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.BELUGA_VERIF_CAPTURES;
const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-menus-', port: PORT });
const jeton = crypto.randomBytes(32).toString('hex');
const MAINTENANT = Date.now();
const FAVICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==';

const base = (options) => new Database(path.join(DATA, 'beluga.db'), options);
function projet(db, id, name, rank, extra = {}) {
  const p = { id, name, path: `${DEPOT}-${id}`, defaultEngine: 'claude', isSelf: false, rank, archived: false, createdAt: MAINTENANT, updatedAt: MAINTENANT, ...extra };
  fs.mkdirSync(p.path, { recursive: true });
  db.prepare('INSERT OR REPLACE INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(id, name, p.path, JSON.stringify(p), MAINTENANT, MAINTENANT);
}
function carte(db, id, projectId, title, extra = {}) {
  const c = { id, projectId, title, description: '', labels: [], column: 'planned', position: MAINTENANT, origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' }, excludedFromDeploy: false, horsTache: false, codeDejaEnregistre: false, createdAt: MAINTENANT, updatedAt: MAINTENANT, ...extra };
  db.prepare('INSERT OR REPLACE INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)').run(id, projectId, c.column, c.position, title, JSON.stringify(c), MAINTENANT, MAINTENANT);
}
function publication(db, id, projectId, cible, state, finie) {
  const run = { id, projectId, cible, state, startedAt: MAINTENANT - 60_000, ...(finie ? { endedAt: MAINTENANT - 10_000 } : {}), currentStep: 'commit', steps: [{ key: 'merge', state: 'done', log: '' }, { key: 'commit', state: finie ? 'done' : 'running', log: '' }, { key: 'push', state: finie ? 'done' : 'todo', log: '' }], actor: 'essai' };
  db.prepare('INSERT INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, projectId, state, JSON.stringify(run), run.startedAt, run.endedAt ?? null);
}
function poserLeDecor() {
  const db = base();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), MAINTENANT, MAINTENANT + 3600_000, 'essai');
  projet(db, 'p-seul', 'Seul', 10);
  projet(db, 'p-social', 'Social', 20);
  projet(db, 'p-reuni', 'Réuni', 30, { regroupement: true });
  projet(db, 'm-un', 'Membre un', 31, { regroupementId: 'p-reuni', favicon: FAVICON });
  projet(db, 'm-deux', 'Membre deux', 32, { regroupementId: 'p-reuni' });
  projet(db, 'm-trois', 'Membre trois', 33, { regroupementId: 'p-reuni' });
  publication(db, 'd-1', 'p-seul', 'dev', 'running', false);
  publication(db, 'd-2', 'p-social', 'production', 'success', true);
  /* UNE MISE EN LIGNE TOMBÉE (17/11/2026) : elle reste active, rouge, logo du projet et point rouge. */
  publication(db, 'd-3', 'p-social', 'dev', 'failed', true);
  carte(db, 'c-reuni', 'p-reuni', 'Vidéo du regroupement');
  /* L'agent attitré du suivi des réseaux sociaux, arrêté sur une question. */
  carte(db, 'c-social', 'p-social', 'Réseaux sociaux — Social', { labels: ['marketing'], agentId: 'a-social' });
  const a = { id: 'a-social', projectId: 'p-social', cardId: 'c-social', role: 'task', title: 'Réseaux sociaux', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'idle', attendReponse: true, createdAt: MAINTENANT, updatedAt: MAINTENANT };
  db.prepare('INSERT OR REPLACE INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(a.id, a.projectId, a.cardId, a.role, a.status, JSON.stringify(a), MAINTENANT, MAINTENANT);
  const question = { id: 'q-social', question: 'Quel ton pour les publications ?', kind: 'single', options: [{ id: 'o0', label: 'Chaleureux' }, { id: 'o1', label: 'Sérieux' }], allowFreeText: true };
  const message = { id: 'msg-social', agentId: a.id, role: 'assistant', content: 'Une question avant de continuer.', createdAt: MAINTENANT, attachments: [], todos: [], questions: [question] };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at, a_questions, streaming) VALUES (?, ?, ?, ?, ?, 1, 0)').run(message.id, a.id, 'assistant', JSON.stringify(message), MAINTENANT);
  db.prepare('INSERT OR REPLACE INTO marketing_espaces (project_id, agent_id, card_id, cle_suivi, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?)').run('p-social', a.id, 'c-social', 'cle-essai', MAINTENANT, MAINTENANT);
  db.close();
}
const lireProjet = (id) => {
  const db = base({ readonly: true });
  const p = JSON.parse(db.prepare('SELECT data FROM projects WHERE id = ?').get(id).data);
  db.close();
  return p;
};
const attendre = async (fn, ms = 6000) => {
  for (const fin = Date.now() + ms; Date.now() < fin; await new Promise((r) => setTimeout(r, 100))) if (await fn()) return true;
  return false;
};

async function glisser(page, poignee, versX, versY) {
  const b = await poignee.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2 + 8, { steps: 3 });
  await page.mouse.move(versX, versY, { steps: 12 });
  await page.waitForTimeout(150);
  /* Le point d'appui, sondé : on sait ce qu'on lâche et où. */
  const sous = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-drag-id], [data-drop-root]')?.getAttribute('data-drag-id') ?? 'zone', [versX, versY]);
  await page.mouse.up();
  return sous;
}

let code = 1;
let navigateur;
try {
  if (!(await attendrePort())) throw new Error(`Le démon d’essai n’a pas démarré :\n${journal.join('')}`);
  poserLeDecor();
  navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  const contexte = await navigateur.newContext({ viewport: { width: 1600, height: 1000 } });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const capture = async (nom) => CAPTURES && (await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) }));

  /* 1. L'icône du regroupement et « Mises en ligne » au tableau de bord */
  await page.goto(`${BASE}/#en-route`);
  await page.locator('[data-page-en-route]').waitFor({ timeout: 30000 });
  await page.getByText('Vidéo du regroupement').first().waitFor({ timeout: 15000 });
  const ligneReuni = page.locator('[data-icone-agent-projet]').filter({ has: page.locator('[data-favicon-projet]') });
  noter('1. la carte d’un regroupement montre l’icône d’un de ses projets, pas une lettre', (await ligneReuni.count()) >= 1);
  /* CHAQUE LANCEMENT EST UNE LIGNE DATÉE DE LA LISTE UNIQUE (décision du 31/10/2026) : plus de groupe en tête. */
  noter('1. plus de groupe « Mises en ligne » en tête du tableau de bord', (await page.locator('[data-bande-productions]').count()) === 0);
  /* DEPUIS LE 16/11/2026, LES TABLEAUX DE BORD SUR ORDINATEUR SONT UN TABLEAU DE TÂCHES (`tableau-des-taches.tsx`) : la
     liste commune « tous projets » n'y vit plus. Les lignes de mise en ligne se lisent donc dans la colonne de leur
     projet — le déploiement en cours sous « Seul », la production finie et la tombée sous « Social ». */
  for (const id of ['p-seul', 'p-social']) {
    const bouton = page.locator(`[data-deplier-taches="${id}"]`).first();
    await bouton.waitFor({ timeout: 15000 }).catch(() => {});
    if ((await bouton.count()) && !(await page.locator(`[data-taches-du-projet="${id}"]`).count())) await bouton.click().catch(() => {});
  }
  const listeSeul = page.locator('[data-taches-du-projet="p-seul"]');
  const liste = page.locator('[data-taches-du-projet="p-social"]');
  const dep = listeSeul.locator('[data-ligne-mise-en-ligne="deploiement"][data-mise-en-ligne="d-1"]');
  await dep.first().waitFor({ timeout: 15000 });
  const pct = Number(await dep.locator('[data-avancement-mise-en-ligne]').first().getAttribute('data-avancement-mise-en-ligne').catch(() => '0'));
  noter('1. le déploiement en cours est une ligne de son projet, avec son pourcentage', pct > 0 && pct < 100, `${pct} %`);
  // La colonne d'un projet ne garde que les lignes récentes : la production finie peut s'y être rangée hors de vue.
  const finie = await liste.locator('[data-ligne-mise-en-ligne="production"][data-etat-mise-en-ligne="reussie"]').count();
  noter('1. la mise en production finie, si elle est montrée, reste une ligne archivée', finie <= 1, `${finie}`);
  const ordre = await liste.locator('[data-agent-en-liste], [data-mise-en-ligne]').evaluateAll((els) => els.map((el) => el.getAttribute('data-agent-en-liste') ?? el.getAttribute('data-mise-en-ligne')));
  const cadres = await page.locator('[data-taches-du-projet] [data-mise-en-ligne]').evaluateAll((els) =>
    Object.fromEntries(els.map((el) => {
      const c = el.querySelector('[data-cadre-mise-en-ligne]');
      return [el.getAttribute('data-mise-en-ligne'), c ? { genre: c.getAttribute('data-cadre-mise-en-ligne'), couleur: getComputedStyle(c).borderTopColor, largeur: getComputedStyle(c).borderTopWidth } : null];
    })),
  );
  /* LA TOMBÉE RESTE AU-DESSUS DU TRAIT, CADRE ROUGE, POINT ROUGE SUR LE LOGO DU PROJET (décision du 17/11/2026). */
  noter('1. la mise en ligne tombée reste avec les actives, au-dessus de la finie', ordre.indexOf('d-3') > -1 && (ordre.indexOf('d-2') === -1 || ordre.indexOf('d-3') < ordre.indexOf('d-2')), ordre.join(', '));
  noter('1. la tombée porte un cadre rouge et un point rouge sur le logo de son projet', cadres['d-3']?.genre === 'echec' && (await liste.locator('[data-mise-en-ligne="d-3"] [data-rond-d-etat="echec"] [data-point-rouge-echec]').count()) === 1, JSON.stringify(cadres['d-3']));
  noter('1. le déploiement en cours a un cadre violet, la mise en production finie aucun', cadres['d-1']?.genre === 'en-cours' && cadres['d-1']?.largeur === '1px' && !cadres['d-2'], JSON.stringify(cadres));
  /* La police de la sous-ligne d'un lancement se comparait à celle d'un agent dans la liste commune des tableaux de
     bord, qui n'existe plus sur ordinateur (16/11/2026) : contrôle retiré. */
  /* La colonne de gauche : la ligne vit sous son projet, plus en tête de colonne. */
  noter('1. la colonne de gauche n’a plus de groupe en tête', (await page.locator('[data-mises-en-ligne]').count()) === 0);
  if (!(await page.locator('[data-taches-du-projet="p-seul"]').count())) await page.locator('[data-deplier-taches="p-seul"]').click();
  const sousLeProjet = page.locator('[data-taches-du-projet="p-seul"] [data-ligne-mise-en-ligne="deploiement"]');
  noter('1. le déploiement est une ligne sous son projet, encadrée avec sa barre', await attendre(async () => (await sousLeProjet.count()) === 1) && (await sousLeProjet.getAttribute('data-etat-mise-en-ligne')) === 'en-cours');
  await capture('01-mises-en-ligne');
  /* LES TROIS VUES FINISSENT ENSEMBLE, MÊME SANS L'ÉVÉNEMENT DE FIN (capture #ebdf, 04/11/2026) : une publication de
     Beluga redémarre le démon, et l'événement de fin peut se perdre. La fin est écrite en base, SANS événement : la
     colonne « En cours », la ligne sous le projet et les tableaux de bord doivent tous la voir finie, sans recharger. */
  noter('1. le déploiement en cours paraît aussi dans « En cours »', await attendre(async () => (await page.locator('[data-mise-en-ligne-en-cours="d-1"]').count()) === 1));
  noter('1. la mise en ligne tombée paraît aussi dans « En cours »', await attendre(async () => (await page.locator('[data-mise-en-ligne-en-cours="d-3"]').count()) === 1));
  {
    const db = base();
    const run = JSON.parse(db.prepare('SELECT data FROM deploys WHERE id = ?').get('d-1').data);
    const fin = Date.now();
    Object.assign(run, { state: 'success', endedAt: fin, steps: run.steps.map((e) => ({ ...e, state: 'done' })) });
    db.prepare('UPDATE deploys SET state = ?, data = ?, ended_at = ? WHERE id = ?').run('success', JSON.stringify(run), fin, 'd-1');
    db.close();
  }
  const etatsDeD1 = () =>
    page.evaluate(() => ({
      enCours: document.querySelectorAll('[data-mise-en-ligne-en-cours="d-1"]').length,
      projet: document.querySelector('[data-taches-du-projet="p-seul"] [data-mise-en-ligne="d-1"]')?.getAttribute('data-etat-mise-en-ligne') ?? null,
    }));
  const finiPartout = await attendre(async () => {
    const e = await etatsDeD1();
    // Finie, elle quitte « En cours » ; sous le projet, elle se lit finie… ou s'est déjà rangée hors de vue.
    return e.enCours === 0 && (e.projet === 'reussie' || e.projet === null);
  }, 25000);
  noter('1. fin sans événement : « En cours » et le projet la voient finie ensemble', finiPartout, JSON.stringify(await etatsDeD1()));

  /* 2. Le glisser des projets regroupés */
  const deplier = page.locator('[data-deplier-regroupement="p-reuni"]');
  await deplier.click({ force: true });
  await page.locator('[data-drag-id="m-trois"]').waitFor({ timeout: 5000 });
  const poignee = (id) => page.locator(`[data-poignee-projet="${id}"]`);
  const milieu = async (id, part = 0.5) => {
    const b = await page.locator(`[data-drag-id="${id}"]`).boundingBox();
    return [b.x + b.width / 2, b.y + b.height * part];
  };
  await page.locator('[data-drag-id="m-trois"]').hover();
  noter('2. un projet regroupé a sa poignée', await poignee('m-trois').isVisible());
  let [x, y] = await milieu('m-un', 0.1);
  await glisser(page, poignee('m-trois'), x, y);
  noter('2. réordonner dans le regroupement écrit le rang', await attendre(() => lireProjet('m-trois').rank < lireProjet('m-un').rank && lireProjet('m-trois').regroupementId === 'p-reuni'));
  /* L'écriture du rang touche toute la liste : on repart d'une colonne posée, sinon on viserait une ligne encore en route. */
  await page.waitForTimeout(800);
  await page.locator('[data-drag-id="m-trois"]').hover();
  [x, y] = await milieu('p-seul', 0.1);
  const sous = await glisser(page, poignee('m-trois'), x, y);
  const sorti = await attendre(() => !lireProjet('m-trois').regroupementId);
  noter('2. un membre sort du regroupement', sorti, sorti ? '' : `lâché sur ${sous} : ${await page.locator('[data-sonner-toast], [role="status"]').allInnerTexts()}`);
  noter('2. sorti, il est une ligne ordinaire', await attendre(async () => (await page.locator('[data-drag-id="m-trois"][data-membre-de]').count()) === 0));
  await page.waitForTimeout(800);
  await page.locator('[data-drag-id="m-trois"]').hover();
  [x, y] = await milieu('p-reuni', 0.5);
  await glisser(page, poignee('m-trois'), x, y);
  noter('2. un projet extérieur entre dans le regroupement', await attendre(() => lireProjet('m-trois').regroupementId === 'p-reuni'));
  await page.reload();
  await page.locator('[data-drag-id="m-trois"]').waitFor({ timeout: 15000 });
  noter('2. l’appartenance survit au rechargement', (await page.locator('[data-drag-id="m-trois"][data-membre-de="p-reuni"]').count()) === 1);
  await capture('02-regroupement');

  /* 3. La carte de l'agent des réseaux ouvre SA conversation (son ancien volet a rejoint Communication, qui n'a que celle du directeur) */
  await page.goto(`${BASE}/#en-route`);
  await page.getByText('Réseaux sociaux — Social').first().click();
  const questionLue = await attendre(async () => (await page.getByText('Quel ton pour les publications ?').count()) > 0, 15000);
  noter('3. la carte du tableau de bord ouvre la conversation de l’agent, sa question s’y lit', questionLue, questionLue ? '' : journal.filter((l) => /ERROR|WARN|err/i.test(l)).slice(-3).join(' '));
  noter('3. on n’est pas renvoyé vers Communication, où elle ne se lirait pas', !page.url().includes('communication'), page.url());
  await capture('03-conversation-de-l-agent');
  await page.goto(`${BASE}/#reseaux-sociaux/p-social`);
  // Le repère de Communication est devenu `data-communication2` (Communication v2).
  await page.locator('[data-communication], [data-communication2]').first().waitFor({ timeout: 15000 });
  noter('3. l’ancienne adresse de l’atelier mène à Communication', page.url().includes('communication'), page.url());

  /* 4. Le menu au survol et le bord gauche */
  await page.mouse.move(900, 500);
  const menu = page.locator('[data-menu-de-colonne]');
  noter('4. fermé au départ', (await menu.getAttribute('data-menu-de-colonne')) === 'ferme');
  await page.mouse.move(600, 500);
  await page.mouse.move(2, 500, { steps: 6 });
  noter('4. toucher le bord gauche ouvre le menu', await attendre(async () => (await menu.getAttribute('data-menu-de-colonne')) === 'ouvert'));
  await capture('04-menu-ouvert');
  await page.mouse.move(120, 500);
  await page.mouse.move(900, 500, { steps: 6 });
  noter('4. quitter la colonne le referme', await attendre(async () => (await menu.getAttribute('data-menu-de-colonne')) === 'ferme'));
  await menu.click();
  noter('4. ouvert au bouton aussi', (await menu.getAttribute('data-menu-de-colonne')) === 'ouvert');
  await page.locator('[data-menu-dossier]').click();
  await page.locator('[data-menu-dossier-panneau]').waitFor();
  await page.mouse.move(900, 300, { steps: 6 });
  await page.waitForTimeout(700);
  noter('4. un sous-menu ouvert retient le menu', (await menu.getAttribute('data-menu-de-colonne')) === 'ouvert');
  await page.keyboard.press('Escape');
  await page.mouse.move(900, 500);
  noter('4. le sous-menu refermé, le menu se referme', await attendre(async () => (await menu.getAttribute('data-menu-de-colonne')) === 'ferme'));

  /* 5. Sur téléphone aussi, la carte de l'agent mène à sa question */
  const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const mobile = await tel.newPage();
  await mobile.goto(`${BASE}/#en-route`);
  await mobile.getByText('Réseaux sociaux — Social').locator('visible=true').first().click({ timeout: 30000 });
  noter('5. sur téléphone, la question de l’agent se lit', await attendre(async () => (await mobile.getByText('Quel ton pour les publications ?').count()) > 0, 15000));
  await tel.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passent.`);
  code = echecs.length ? 1 : 0;
} catch (err) {
  console.error(err);
  console.error(journal.slice(-20).join(''));
} finally {
  await navigateur?.close();
  process.exit(code);
}
