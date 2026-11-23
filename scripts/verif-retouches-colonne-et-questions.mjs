#!/usr/bin/env node
/**
 * RETOUCHES COLONNE, FIL ET QUESTIONS (carte du 15/11/2026), dans un vrai navigateur, sur le serveur de développement
 * de la copie (qui parle au démon servi). Rien ne part en base : le canal est intercepté, les lectures et écritures
 * de carte ne sont pas relayées, et les états absents du serveur (publication en cours, question de l'agent de
 * configuration, tâche déployée non vue) sont POUSSÉS à la page comme des événements du canal.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL nohup npm run dev --workspace web -- --port 7099 > /tmp/dev.log 2>&1 &
 *   env -u BELUGA_TOKEN -u BELUGA_URL HAIKO_RETOUCHES_URL=http://localhost:7099 HAIKO_RETOUCHES_PROJET=<id> \
 *     HAIKO_RETOUCHES_CARTE=<carte au travail> node scripts/verif-retouches-colonne-et-questions.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.HAIKO_RETOUCHES_URL || 'http://localhost:7099';
const PROJET = process.env.HAIKO_RETOUCHES_PROJET;
const CARTE_AU_TRAVAIL = process.env.HAIKO_RETOUCHES_CARTE;
const DATA = process.env.HAIKO_RETOUCHES_DATA || '/root/beluga/data';
const CAPTURES = process.env.HAIKO_RETOUCHES_CAPTURES;
if (!PROJET) throw new Error('HAIKO_RETOUCHES_PROJET manque');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
const attendre = async (fn, ms = 8000) => {
  for (const fin = Date.now() + ms; Date.now() < fin; await new Promise((r) => setTimeout(r, 150))) if (await fn()) return true;
  return false;
};

const cookie = crypto.randomBytes(32).toString('hex');
const jeton = crypto.createHash('sha256').update(cookie).digest('hex');
const db = new Database(path.join(DATA, 'beluga.db'));
const MAINTENANT = Date.now();
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(jeton, MAINTENANT, MAINTENANT + 3600_000, 'essai retouches', 'admin-premier');

const NON_RELAYES = ['prefs.set', 'card.read', 'card.update', 'card.create', 'deploy.start', 'procedure.tour', 'question.answer', 'question.cancel', 'project.read', 'annonces.vider', 'agent.prompt'];
const commandes = [];

async function ouvrirPage(contexte) {
  const page = await contexte.newPage();
  const pousser = { envoyer: null };
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const serveur = ws.connectToServer();
    pousser.envoyer = (obj) => ws.send(JSON.stringify(obj));
    ws.onMessage((message) => {
      try {
        const lu = JSON.parse(String(message));
        const cmd = lu?.cmd ?? lu;
        commandes.push(cmd);
        if (NON_RELAYES.includes(cmd?.type)) return;
        /* Une conversation demandée n'est jamais une lecture pendant l'essai. */
        if (cmd?.type === 'card.conversation') {
          serveur.send(JSON.stringify({ ...lu, cmd: { ...cmd, lire: false } }));
          return;
        }
      } catch {
        /* passe tel quel */
      }
      serveur.send(message);
    });
  });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  return { page, pousser, erreurs };
}

const theme = (page, c) =>
  page.evaluate((c) => {
    document.documentElement.dataset.theme = c;
    document.documentElement.classList.toggle('dark', c === 'sombre');
  }, c);
const capture = async (page, nom) => {
  if (!CAPTURES) return;
  await page.mouse.move(5, 5);
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
};

const RUN = {
  id: 'essai-retouches-run',
  projectId: PROJET,
  cible: 'dev',
  state: 'running',
  startedAt: MAINTENANT - 30_000,
  currentStep: 'commit',
  steps: [
    { key: 'merge', state: 'done', log: '' },
    { key: 'commit', state: 'running', log: '' },
    { key: 'push', state: 'todo', log: '' },
  ],
  actor: 'essai',
  cardIds: [],
};
const procedure = (questionId) => ({
  type: 'procedure',
  etat: {
    projectId: PROJET,
    cible: 'dev',
    agentId: 'agent-essai-configuration',
    enCours: false,
    echanges: [],
    ...(questionId
      ? {
          question: {
            messageId: 'message-essai',
            questionId,
            texte: 'Quel service faut-il relancer après la construction ?',
            options: [
              { id: 'a', label: 'Le service du projet', description: 'Celui qui sert la version de travail.' },
              { id: 'b', label: 'Aucun service', description: 'Les fichiers construits sont servis tels quels.' },
            ],
          },
        }
      : {}),
  },
});
const CARTE_DEPLOYEE = {
  id: 'essai-retouches-deployee',
  projectId: PROJET,
  title: 'Tâche déployée il y a trois jours (essai)',
  description: '',
  labels: [],
  column: 'archived',
  position: MAINTENANT,
  origin: 'user',
  attachments: [],
  run: { engine: 'claude', thinking: 'none', mode: 'direct' },
  excludedFromDeploy: false,
  horsTache: false,
  codeDejaEnregistre: false,
  createdAt: MAINTENANT - 4 * 86400_000,
  updatedAt: MAINTENANT - 3 * 86400_000,
  deployedAt: MAINTENANT - 3 * 86400_000,
  lastReadAt: MAINTENANT - 4 * 86400_000,
};

let navigateur;
let code = 1;
try {
  navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: cookie, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const { page, pousser, erreurs } = await ouvrirPage(contexte);

  /* 1. UN SEUL MENU « PUBLIER », À DROITE, AU CLIC DE LA LIGNE DE LA COLONNE — avec deux écrans gardés montés. */
  await page.goto(`${BASE}/#projet/${PROJET}`);
  await page.locator('[data-bouton-publier]').first().waitFor({ timeout: 60_000 });
  if (CARTE_AU_TRAVAIL) {
    await page.goto(`${BASE}/#projet/${PROJET}/tache/${CARTE_AU_TRAVAIL}`);
    await page.waitForTimeout(2500);
    await page.goto(`${BASE}/#projet/${PROJET}`);
    await page.waitForTimeout(1500);
  }
  pousser.envoyer({ type: 'deploy.upsert', run: RUN });
  const ligne = page.locator('[data-taches-en-cours-colonne] [data-ligne-mise-en-ligne="deploiement"], [data-ligne-mise-en-ligne="deploiement"]').first();
  const ligneVue = await attendre(async () => (await ligne.count()) > 0 && (await ligne.isVisible()));
  noter('1. la ligne « Déploiement » du déploiement simulé paraît dans la colonne', ligneVue);
  if (ligneVue) await ligne.click();
  else await page.evaluate((p) => window.dispatchEvent(new CustomEvent('beluga:ouvrir-publier', { detail: { projectId: p } })), PROJET);
  await attendre(async () => (await page.locator('[data-menu-publier]').count()) > 0, 4000);
  await page.waitForTimeout(1200);
  const menus = await page.locator('[data-menu-publier]').evaluateAll((els) =>
    els.map((el) => {
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), largeur: Math.round(b.width), visible: b.width > 0 && b.height > 0 };
    }),
  );
  noter('1. un seul menu « Publier » ouvert', menus.length === 1, JSON.stringify(menus));
  noter('1. le menu est ancré à droite, jamais en haut à gauche', menus.length === 1 && menus[0].x > 700, JSON.stringify(menus));
  await capture(page, 'menu-publier-1440-clair');
  await page.locator('[data-bouton-publier]:visible').first().click();
  await attendre(async () => (await page.locator('[data-menu-publier]').count()) === 0, 3000);

  /* 2. L'AVANCEMENT NE SE LIT QUE DANS « PUBLIER ». */
  const texteBouton = (await page.locator('[data-bouton-publier]:visible').first().textContent()) ?? '';
  noter('2. le bouton « Publier » dit l’avancement', /%/.test(texteBouton), texteBouton.trim());
  const pourcentDouble = await page.locator('[data-pourcent-menu]:visible').count();
  noter('2. aucun second pourcentage à côté (trois points du projet)', pourcentDouble === 0, `${pourcentDouble}`);
  await capture(page, 'barre-du-projet-1440-clair');

  /* 3. LA QUESTION DE L'AGENT DE CONFIGURATION S'OUVRE SEULE, AU CENTRE. */
  pousser.envoyer(procedure('q-essai-1'));
  const fenetre = page.locator('[data-question-de-configuration]');
  noter('3. la fenêtre de la question s’ouvre d’elle-même', await attendre(async () => (await fenetre.count()) > 0 && (await fenetre.isVisible()), 10_000));
  const boite = (await fenetre.count()) ? await fenetre.boundingBox() : null;
  noter('3. elle est centrée', !!boite && Math.abs(boite.x + boite.width / 2 - 720) < 40, JSON.stringify(boite));
  noter('3. elle montre la question et ses choix', ((await fenetre.textContent()) ?? '').includes('Quel service') && ((await fenetre.textContent()) ?? '').includes('Aucun service'));
  noter('3. elle mène à la conversation', (await page.locator('[data-voir-la-conversation-configuration]').count()) === 1);
  await capture(page, 'question-configuration-1440-clair');
  await theme(page, 'sombre');
  await page.waitForTimeout(300);
  await capture(page, 'question-configuration-1440-sombre');
  await theme(page, 'clair');
  await page.keyboard.press('Escape');
  await attendre(async () => (await fenetre.count()) === 0, 3000);
  pousser.envoyer(procedure('q-essai-1'));
  await page.waitForTimeout(2500);
  noter('3. fermée, la même question ne revient pas', (await fenetre.count()) === 0);
  pousser.envoyer(procedure('q-essai-2'));
  noter('3. une nouvelle question rouvre la fenêtre', await attendre(async () => (await fenetre.count()) > 0, 8000));
  pousser.envoyer(procedure(null));
  noter('3. la question répondue (partie de l’état) referme la fenêtre', await attendre(async () => (await fenetre.count()) === 0, 5000));

  /* 4. TÂCHE DÉPLOYÉE NON VUE, VIEILLE DE TROIS JOURS : TOUJOURS DANS « EN COURS ». */
  pousser.envoyer({ type: 'card.upsert', card: CARTE_DEPLOYEE });
  const zone = page.locator('[data-taches-en-cours-colonne]');
  noter(
    '4. la tâche déployée il y a trois jours, jamais ouverte, reste dans « En cours »',
    await attendre(async () => ((await zone.textContent().catch(() => '')) ?? '').includes('Tâche déployée il y a trois jours'), 8000),
  );
  await capture(page, 'colonne-en-cours-1440-clair');

  /* 5. LA BARRE D'ÉTAPES D'UNE CARTE AU TRAVAIL : NI POINT CLIGNOTANT NI SECONDE ROUE. */
  if (CARTE_AU_TRAVAIL) {
    await page.goto(`${BASE}/#projet/${PROJET}/tache/${CARTE_AU_TRAVAIL}`);
    const barre = page.locator('[data-barre-en-ligne]:visible').first();
    if (await attendre(async () => (await barre.count()) > 0, 20_000)) {
      const resume = page.locator('[data-resume-du-travail]:visible');
      await attendre(async () => (await resume.count()) > 0, 10_000);
      noter('5. la ligne d’étapes dit ce que fait l’agent', (await resume.count()) > 0);
      noter('5. aucune roue dans le résumé du travail', (await resume.locator('svg').count()) === 0);
      noter('5. aucun témoin posé hors du rang, à gauche du rond', (await barre.locator(':scope > span.absolute').count()) === 0);
      await capture(page, 'barre-etapes-1440-clair');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(800);
      await capture(page, 'barre-etapes-390-clair');
      await theme(page, 'sombre');
      await capture(page, 'barre-etapes-390-sombre');
      await theme(page, 'clair');
      await page.setViewportSize({ width: 1440, height: 900 });
    } else noter('5. la barre d’étapes de la carte au travail est visible', false);
  }

  /* 6. TÉLÉPHONE : LA MÊME FENÊTRE DE QUESTION, DANS L'ÉCRAN. */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/#projet/${PROJET}`);
  await page.waitForTimeout(2500);
  pousser.envoyer(procedure('q-essai-3'));
  noter('6. au téléphone, la fenêtre s’ouvre aussi', await attendre(async () => (await fenetre.count()) > 0, 10_000));
  const deborde = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  noter('6. rien ne déborde en largeur', deborde === 0, `${deborde}`);
  await capture(page, 'question-configuration-390-clair');
  await theme(page, 'sombre');
  await capture(page, 'question-configuration-390-sombre');

  const lectures = commandes.filter((c) => c?.type === 'card.read');
  noter('aucune lecture de carte n’est partie vers le démon servi (bloquées)', true, `${lectures.length} interceptée(s)`);
  noter('aucune erreur de page', erreurs.length === 0, erreurs.join(' | '));
  code = resultats.every((r) => r.ok) ? 0 : 1;
} catch (err) {
  console.error(err);
} finally {
  await navigateur?.close();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(jeton);
  db.close();
  const ok = resultats.filter((r) => r.ok).length;
  console.log(`\n${ok}/${resultats.length} contrôles réussis`);
  process.exit(code);
}
