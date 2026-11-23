#!/usr/bin/env node
/**
 * DÉPANNAGE DE PUBLICATION DISCRET ET « RELIER CE MAC ? » (carte du 21/11/2026), dans un vrai navigateur, sur le
 * serveur de développement de la copie (qui parle au démon servi). Rien ne part en base : le canal est intercepté, les
 * réponses aux questions et les gestes de liaison ne sont pas relayés, et les états absents du serveur (dépanneur au
 * travail, sa question, publication tombée, demande de liaison) sont POUSSÉS à la page comme des événements du canal.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL nohup npm run dev --workspace web -- --port 7099 > /tmp/dev.log 2>&1 &
 *   env -u BELUGA_TOKEN -u BELUGA_URL HAIKO_DEPANNAGE_URL=http://localhost:7099 HAIKO_DEPANNAGE_PROJET=<id> \
 *     HAIKO_DEPANNAGE_CAPTURES=/tmp/captures node scripts/verif-depannage-discret.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.HAIKO_DEPANNAGE_URL || 'http://localhost:7099';
const PROJET = process.env.HAIKO_DEPANNAGE_PROJET;
const DATA = process.env.HAIKO_DEPANNAGE_DATA || '/root/beluga/data';
const CAPTURES = process.env.HAIKO_DEPANNAGE_CAPTURES;
if (!PROJET) throw new Error('HAIKO_DEPANNAGE_PROJET manque');
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

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
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(jeton, MAINTENANT, MAINTENANT + 3600_000, 'essai dépannage discret', 'admin-premier');

const NON_RELAYES = ['prefs.set', 'card.read', 'card.update', 'deploy.start', 'deploy.relancer', 'deploy.depanner', 'question.answer', 'question.cancel', 'agent.prompt'];
const JETON_DE_LIAISON = crypto.randomBytes(24).toString('base64url');

async function ouvrirPage(contexte) {
  const page = await contexte.newPage();
  const canal = { envoyer: null, commandes: [] };
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const serveur = ws.connectToServer();
    canal.envoyer = (obj) => ws.send(JSON.stringify(obj));
    ws.onMessage((message) => {
      try {
        const lu = JSON.parse(String(message));
        const cmd = lu?.cmd ?? lu;
        canal.commandes.push(cmd);
        /* LA DEMANDE DE LIAISON : le démon servi ne la connaît pas encore, la page reçoit la réponse du démon neuf. */
        if (cmd?.type === 'relaisMac.liaison.lire') {
          ws.send(JSON.stringify({ type: 'ack', id: lu.id, ok: true, data: { demande: cmd.jeton === JETON_DE_LIAISON ? { nom: 'Mac mini', systeme: 'mac', expireLe: Date.now() + 600_000 } : null } }));
          return;
        }
        if (cmd?.type === 'relaisMac.liaison.accepter') {
          ws.send(JSON.stringify({ type: 'ack', id: lu.id, ok: true, data: { ok: true, nom: 'Mac mini' } }));
          return;
        }
        if (cmd?.type === 'relaisMac.liaison.refuser') {
          ws.send(JSON.stringify({ type: 'ack', id: lu.id, ok: true, data: { ok: true } }));
          return;
        }
        if (NON_RELAYES.includes(cmd?.type)) {
          if (lu?.id) ws.send(JSON.stringify({ type: 'ack', id: lu.id, ok: true, data: { ok: true } }));
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
  return { page, canal, erreurs };
}

const theme = (page, c) =>
  page.evaluate((c) => {
    document.documentElement.dataset.theme = c;
    document.documentElement.classList.toggle('dark', c === 'sombre');
  }, c);
const capture = async (page, nom) => {
  if (!CAPTURES) return;
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
};
const visible = (page, sel) => page.locator(sel).evaluateAll((els) => els.some((el) => el.getClientRects().length > 0));

const AGENT_ID = 'agent-essai-depanneur';
const RUN_ID = 'essai-depannage-run';
const agent = (patch) => ({
  id: AGENT_ID,
  projectId: PROJET,
  role: 'deploy',
  title: 'Dépannage du déploiement',
  run: { engine: 'claude', model: 'claude-opus-5-5' },
  status: 'running',
  createdAt: MAINTENANT,
  startedAt: MAINTENANT,
  depannagePublication: { runId: RUN_ID, cible: 'dev' },
  ...patch,
});
const run = (depannage) => ({
  id: RUN_ID,
  projectId: PROJET,
  cible: 'dev',
  state: 'failed',
  startedAt: MAINTENANT - 90_000,
  endedAt: MAINTENANT - 30_000,
  currentStep: 'build',
  steps: [
    { key: 'merge', state: 'done', log: '' },
    { key: 'build', state: 'failed', log: 'erreur de construction', blocage: { raison: 'La construction a échoué.' } },
    { key: 'push', state: 'todo', log: '' },
  ],
  actor: 'essai',
  cardIds: [],
  error: 'La construction a échoué.',
  depannage: { agentId: AGENT_ID, at: MAINTENANT - 25_000, automatique: true, ...depannage },
});
const question = (id, answer) => ({
  type: 'message.upsert',
  message: {
    id: `message-${id}`,
    agentId: AGENT_ID,
    role: 'assistant',
    content: 'La construction échoue sur une dépendance manquante.',
    steps: [],
    todos: [],
    proposals: [],
    questions: [
      {
        id,
        question: 'Faut-il ajouter la dépendance manquante au projet ?',
        kind: 'single',
        allowFreeText: true,
        answerAttachments: [],
        options: [
          { id: 'a', label: 'Oui, l’ajouter', description: 'La construction repartira avec elle.' },
          { id: 'b', label: 'Non, retirer son usage', description: 'Le code qui l’appelle sera retiré.' },
        ],
        ...(answer ? { answer, answeredAt: Date.now() } : {}),
      },
    ],
    downloads: [],
    attachments: [],
    streaming: false,
    createdAt: Date.now(),
  },
});

const ouvrirPublier = (page) => page.evaluate((p) => window.dispatchEvent(new CustomEvent('beluga:ouvrir-publier', { detail: { projectId: p } })), PROJET);
const tiroirOuvert = (page) => visible(page, '[data-tiroir-depannage], [data-depannage-en-ligne]');

async function parcours(navigateur, { largeur, hauteur, clarte, suffixe }) {
  const T = `[${suffixe}]`;
  const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: cookie, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const { page, canal, erreurs } = await ouvrirPage(contexte);
  await page.goto(`${BASE}/#projet/${PROJET}`);
  await attendre(() => !!canal.envoyer, 15_000);
  /* L'état du projet doit être arrivé : sinon il écraserait la publication injectée. */
  await attendre(() => visible(page, 'button:has-text("Publier")'), 20_000);
  await page.waitForTimeout(2500);
  await theme(page, clarte);

  /* 1. LA CHUTE : un dépanneur se lance tout seul — aucun tiroir ne s'ouvre. */
  canal.envoyer({ type: 'agent.upsert', agent: agent({}) });
  canal.envoyer({ type: 'deploy.upsert', run: run({}) });
  await page.waitForTimeout(1500);
  noter(`${T} à la chute, le dépannage tourne sans ouvrir de tiroir`, !(await tiroirOuvert(page)));

  /* 2. LE MENU « PUBLIER » : l'encadré de blocage, SANS « Relancer » tant que l'agent dépanne. */
  canal.envoyer({ type: 'agent.upsert', agent: agent({}) });
  canal.envoyer({ type: 'deploy.upsert', run: run({}) });
  await page.waitForTimeout(500);
  await ouvrirPublier(page);
  await attendre(() => visible(page, '[data-encadre-de-blocage]'));
  noter(
    `${T} menu « Publier » : agent au travail → pas de « Relancer », « Ouvrir le dépannage » seul`,
    (await visible(page, '[data-encadre-de-blocage]')) &&
      !(await visible(page, '[data-encadre-de-blocage] [data-relancer-la-publication]')) &&
      (await visible(page, '[data-ouvrir-le-depannage]')),
  );
  await capture(page, `menu-publier-agent-au-travail-${suffixe}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  /* 3. LA QUESTION : fenêtre au centre, d'elle-même, sans tiroir. */
  canal.envoyer({ type: 'message.upsert', ...question('q-1') });
  canal.envoyer({ type: 'agent.upsert', agent: agent({ status: 'idle', attendReponse: true }) });
  const fenetre = await attendre(() => visible(page, '[data-question-du-depanneur]'), 10_000);
  const titre = fenetre ? await page.locator('[data-question-du-depanneur]').innerText() : '';
  noter(`${T} la question du dépanneur s'ouvre au centre, avec « Déploiement en cours de dépannage »`, fenetre && /Déploiement en cours de dépannage/.test(titre), titre.slice(0, 80));
  if (fenetre && largeur >= 640) {
    const boite = await page.locator('[data-question-du-depanneur]').boundingBox();
    noter(`${T} la fenêtre est centrée`, !!boite && Math.abs(boite.x + boite.width / 2 - largeur / 2) < 30);
  }
  noter(`${T} aucun tiroir ouvert avec la question`, !(await tiroirOuvert(page)));
  await capture(page, `question-du-depanneur-${suffixe}`);

  /* 4. MENU PENDANT LA QUESTION : toujours pas de « Relancer ». */
  /* 5. LA RÉPONSE part à l'agent, puis la fenêtre se referme quand la question quitte le fil. */
  /* Au téléphone, la question est une bulle compacte : « Répondre » ouvre la feuille des choix (comme dans un fil). */
  if (largeur < 640) {
    await page.locator('[data-question-du-depanneur]').getByRole('button', { name: 'Répondre' }).first().click();
    await page.waitForTimeout(900);
    await capture(page, `question-du-depanneur-choix-${suffixe}`);
  }
  await page.getByText('Oui, l’ajouter').last().click();
  await page.waitForTimeout(400);
  /* Un choix unique part au clic ; la feuille du téléphone attend « Valider ». */
  if (!canal.commandes.some((c) => c?.type === 'question.answer')) {
    const valider = page.getByRole('button', { name: 'Valider' });
    if (await valider.count()) await valider.last().click().catch(() => undefined);
  }
  const repondu = await attendre(() => canal.commandes.some((c) => c?.type === 'question.answer'), 5000);
  const reponse = canal.commandes.find((c) => c?.type === 'question.answer');
  noter(`${T} le choix part à l'agent dépanneur`, repondu && JSON.stringify(reponse).includes('q-1'), JSON.stringify(reponse ?? {}).slice(0, 120));
  canal.envoyer({ type: 'message.upsert', ...question('q-1', 'Oui, l’ajouter') });
  canal.envoyer({ type: 'agent.upsert', agent: agent({ status: 'running', attendReponse: false }) });
  noter(`${T} la fenêtre se referme une fois répondu, sans tiroir`, (await attendre(async () => !(await visible(page, '[data-question-du-depanneur]')), 5000)) && !(await tiroirOuvert(page)));

  /* 6. « PLUS TARD » ferme sans répondre ; la cloche (même événement) la ROUVRE au lieu du tiroir. */
  canal.envoyer({ type: 'message.upsert', ...question('q-2') });
  canal.envoyer({ type: 'agent.upsert', agent: agent({ status: 'idle', attendReponse: true }) });
  await attendre(() => visible(page, '[data-question-du-depanneur]'), 10_000);
  const avant = canal.commandes.filter((c) => c?.type === 'question.answer').length;
  await page.locator('[data-plus-tard-depannage]').click();
  await page.waitForTimeout(2500);
  noter(
    `${T} « Plus tard » ferme sans répondre, et la fenêtre ne revient pas seule`,
    !(await visible(page, '[data-question-du-depanneur]')) && canal.commandes.filter((c) => c?.type === 'question.answer').length === avant,
  );
  await page.evaluate((id) => window.dispatchEvent(new CustomEvent('beluga:question-du-depanneur', { detail: id })), AGENT_ID);
  noter(`${T} depuis la cloche, la même question se rouvre en fenêtre`, await attendre(() => visible(page, '[data-question-du-depanneur]'), 5000));
  /* « Voir la conversation » : le tiroir s'ouvre, à la demande. */
  await page.locator('[data-voir-la-conversation-depannage]').click();
  noter(`${T} « Voir la conversation » ouvre le tiroir du dépanneur`, await attendre(() => tiroirOuvert(page), 8000));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  /* 7. LE DÉPANNAGE A FINI SANS REPRISE : « Relancer » revient. */
  canal.envoyer({ type: 'message.upsert', ...question('q-2', 'Non') });
  canal.envoyer({ type: 'agent.upsert', agent: agent({ status: 'done', attendReponse: false, endedAt: Date.now() }) });
  canal.envoyer({ type: 'deploy.upsert', run: run({ enAttenteDeVous: true }) });
  await page.waitForTimeout(800);
  await ouvrirPublier(page);
  await attendre(() => visible(page, '[data-encadre-de-blocage]'));
  noter(`${T} dépannage fini sans reprise : « Relancer » revient`, await attendre(() => visible(page, '[data-encadre-de-blocage] [data-relancer-la-publication]'), 4000));
  await capture(page, `menu-publier-relancer-revient-${suffixe}`);
  await page.keyboard.press('Escape');

  /* 8. « RELIER CE MAC ? » : Beluga Connect ouvre Beluga avec son jeton. */
  await page.goto(`${BASE}/?liaison=${JETON_DE_LIAISON}`);
  await theme(page, clarte);
  const liaison = await attendre(() => visible(page, '[data-fenetre-de-liaison]'), 15_000);
  noter(`${T} la fenêtre « Relier « Mac mini » à Beluga ? » s'ouvre`, liaison && /Relier « Mac mini » à Beluga/.test(await page.locator('[data-fenetre-de-liaison]').innerText()));
  noter(`${T} le jeton quitte l'adresse aussitôt lu`, !page.url().includes('liaison='), page.url());
  await capture(page, `relier-ce-mac-${suffixe}`);
  await page.locator('[data-accepter-la-liaison]').click();
  const accepte = await attendre(() => canal.commandes.some((c) => c?.type === 'relaisMac.liaison.accepter' && c.jeton === JETON_DE_LIAISON), 5000);
  noter(`${T} « Relier » accepte la demande, puis la fenêtre se ferme`, accepte && (await attendre(async () => !(await visible(page, '[data-fenetre-de-liaison]')), 5000)));
  noter(`${T} puis la page des ordinateurs s'ouvre`, await attendre(() => page.url().includes('#reglages/ordinateurs'), 5000), page.url());
  /* Recharger ne la rouvre pas : le jeton est oublié. */
  await page.reload();
  await page.waitForTimeout(3000);
  noter(`${T} rechargée, la page ne redemande rien`, !(await visible(page, '[data-fenetre-de-liaison]')));

  noter(`${T} aucune erreur de page`, erreurs.length === 0, erreurs.join(' | ').slice(0, 200));
  await contexte.close();
}

const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
try {
  await parcours(navigateur, { largeur: 1440, hauteur: 900, clarte: 'sombre', suffixe: '1440-sombre' });
  await parcours(navigateur, { largeur: 1440, hauteur: 900, clarte: 'clair', suffixe: '1440-clair' });
  await parcours(navigateur, { largeur: 390, hauteur: 844, clarte: 'sombre', suffixe: '390-sombre' });
  await parcours(navigateur, { largeur: 390, hauteur: 844, clarte: 'clair', suffixe: '390-clair' });
} finally {
  await navigateur.close();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(jeton);
  db.close();
}
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles réussis`);
process.exit(echecs ? 1 : 0);
