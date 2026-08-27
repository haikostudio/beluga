#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur de téléphone (390×844), du repère posé
 * sur les onglets du tableau :
 *
 *  - une colonne dont une carte attend une décision montre le TRIANGLE orange
 *    sur son onglet ;
 *  - une colonne dont une carte est terminée non lue (et sans décision) montre
 *    le POINT BLEU clignotant ;
 *  - une colonne sans rien à signaler garde son onglet nu ;
 *  - décision et non-lu dans la même colonne : le triangle l'emporte ;
 *  - « lire » la carte (lastReadAt posé) éteint le point bleu.
 *
 * Tout est SIMULÉ : cartes, agents et décisions sont injectés dans le canal
 * temps réel, comme le fait `verif-progression-taches.mjs`. Rien n'est écrit
 * dans la base à part la session d'essai, retirée en partant.
 *
 *   HAIKO_ONGLETS_URL=http://localhost:7099 node scripts/verif-onglets-tableau.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_ONGLETS_URL || 'http://localhost:7099';
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';
const PRINCIPAL = path.resolve(DONNEES, '..');

function poserSession() {
  const require = createRequire(import.meta.url);
  const db = require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(
    path.join(DONNEES, 'haikodev.db'),
  );
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification onglets tableau',
  );
  db.close();
  return { cookie, retirer: () => retirerSession(cookie) };
}

function retirerSession(cookie) {
  const require = createRequire(import.meta.url);
  const db = require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(
    path.join(DONNEES, 'haikodev.db'),
  );
  db.prepare('DELETE FROM sessions WHERE token = ?').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
  );
  db.close();
}

const resultats = [];
function record(nom, ok, detail = '') {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  const session = poserSession();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    // Un vrai téléphone : c'est le seul endroit où la rangée d'onglets existe.
    viewport: { width: 390, height: 844 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([
    {
      name: 'haikodev_session',
      value: session.cookie,
      url: new URL(BASE).origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && erreurs.push(message.text()));

  await page.addInitScript(() => {
    window.__ecouteurs = [];
    const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get() {
        return propriete.get.call(this);
      },
      set(ecouteur) {
        window.__ecouteurs.push(ecouteur);
        return propriete.set.call(this, ecouteur);
      },
    });
    window.__injecter = (evenement) => {
      const donnees = JSON.stringify(evenement);
      for (const ecouteur of window.__ecouteurs) ecouteur({ data: donnees });
    };
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  page.setDefaultTimeout(8000);

  const projectId = await page.evaluate(
    () => document.querySelector('[data-drag-kind="project"]')?.getAttribute('data-drag-id') ?? null,
  );
  record('un projet est ouvert', !!projectId, projectId ?? 'aucun');
  if (!projectId) throw new Error('aucun projet dans la colonne de gauche');

  const maintenant = Date.now();
  /** Une carte d'essai, avec l'agent qui va avec. */
  const poserCarte = async ({ suffixe, column, titre, statutAgent, finiA, luA, position }) => {
    const cardId = `essai-onglets-${suffixe}`;
    const agentId = `essai-onglets-agent-${suffixe}`;
    await page.evaluate(
      ([projectId, cardId, agentId, titre, column, statutAgent, finiA, luA, position]) => {
        window.__injecter({
          type: 'card.upsert',
          card: {
            id: cardId,
            projectId,
            title: titre,
            description: '',
            labels: [],
            column,
            position,
            origin: 'user',
            run: { engine: 'codex', mode: 'direct' },
            excludedFromDeploy: false,
            horsTache: false,
            agentId,
            lastReadAt: luA ?? undefined,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
        window.__injecter({
          type: 'agent.upsert',
          agent: {
            id: agentId,
            projectId,
            cardId,
            role: 'task',
            title: titre,
            run: { engine: 'codex', mode: 'direct' },
            status: statutAgent,
            endedAt: finiA ?? undefined,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
      },
      [projectId, cardId, agentId, titre, column, statutAgent, finiA ?? null, luA ?? null, position],
    );
    return { cardId, agentId };
  };

  // « running » : une carte terminée non lue → point bleu attendu.
  const carteRunning = await poserCarte({
    suffixe: 'running-nonlu',
    column: 'running',
    titre: 'Essai — running rendu non lu',
    statutAgent: 'done',
    finiA: maintenant,
    position: maintenant + 0.2,
  });
  // « done » : une carte terminée non lue ET une décision → triangle (priorité).
  const carteDecision = await poserCarte({
    suffixe: 'done-decision',
    column: 'to_deploy',
    titre: 'Essai — done, décision attendue',
    statutAgent: 'done',
    finiA: maintenant,
    position: maintenant + 0.3,
  });
  // « planned » : un agent AU TRAVAIL → l'onglet porte le robot d'activité.
  const carteTravail = await poserCarte({
    suffixe: 'planned-travail',
    column: 'planned',
    titre: 'Essai — agent au travail',
    statutAgent: 'running',
    position: maintenant + 0.4,
  });

  // Les décisions arrivent par l'événement `attention` : on en pose une sur la
  // carte de « done », en gardant le compte du projet cohérent.
  await page.evaluate(
    ([projectId, cardId, agentId]) => {
      window.__injecter({
        type: 'attention',
        byProject: { [projectId]: 1 },
        decisions: [
          {
            projectId,
            genre: 'question',
            agentId,
            cardId,
            poseeA: Date.now(),
          },
        ],
      });
    },
    [projectId, carteDecision.cardId, carteDecision.agentId],
  );
  await page.waitForTimeout(900);

  const aRepere = (sel) => page.locator(sel).count();

  record(
    'la colonne « running » (rendu non lu) montre le point bleu',
    (await aRepere('[data-onglet-non-lu="running"]')) === 1,
  );
  record(
    'la colonne « done » (décision + non lu) montre le triangle, pas le point',
    (await aRepere('[data-onglet-attention="done"]')) === 1 &&
      (await aRepere('[data-onglet-non-lu="done"]')) === 0,
  );
  record(
    'une colonne sans rien (« todo ») garde son onglet nu',
    (await aRepere('[data-onglet-attention="planned"]')) === 0 &&
      (await aRepere('[data-onglet-non-lu="planned"]')) === 0 &&
      (await aRepere('[data-onglet-travail="planned"]')) === 0,
  );
  record(
    'la colonne « planned » (agent au travail) montre le robot d’activité',
    (await aRepere('[data-onglet-travail="planned"]')) === 1,
  );

  /*
   * Le NOMBRE de cartes porté par chaque onglet doit valoir, au chiffre près,
   * celui de la tête de sa colonne : même source (`byColumn`), donc jamais deux
   * comptes qui se contredisent. Le chiffre de la tête est le frère du titre.
   */
  const comptesCompares = () =>
    page.evaluate(() => {
      const ecarts = [];
      for (const onglet of document.querySelectorAll('[data-onglet-compte]')) {
        const cle = onglet.getAttribute('data-onglet-compte');
        const titre = document.querySelector(`[data-column="${cle}"] h2`);
        const tete = titre?.nextElementSibling?.textContent?.trim() ?? null;
        const dit = onglet.textContent?.trim() ?? null;
        if (tete !== dit) ecarts.push(`${cle}: onglet ${dit} / colonne ${tete}`);
      }
      return { nombre: document.querySelectorAll('[data-onglet-compte]').length, ecarts };
    });

  const comptes = await comptesCompares();
  record(
    'chaque onglet porte le compte de sa colonne, égal à celui de la tête',
    comptes.nombre > 0 && comptes.ecarts.length === 0,
    comptes.ecarts.join(' | ') || `${comptes.nombre} onglet(s)`,
  );

  await page.screenshot({ path: `${DONNEES}/verification/onglets-tableau.png` });

  // « Lire » la carte de « running » : lastReadAt posé après la fin → le point
  // bleu doit disparaître de son onglet.
  await page.evaluate(
    ([projectId, cardId, agentId, quand]) => {
      window.__injecter({
        type: 'card.upsert',
        card: {
          id: cardId,
          projectId,
          title: 'Essai — running rendu non lu',
          description: '',
          labels: [],
          column: 'running',
          position: quand,
          origin: 'user',
          run: { engine: 'codex', mode: 'direct' },
          excludedFromDeploy: false,
          horsTache: false,
          agentId,
          lastReadAt: quand + 10_000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
    },
    [projectId, carteRunning.cardId, carteRunning.agentId, maintenant],
  );
  await page.waitForTimeout(700);
  record(
    'lire la carte éteint le point bleu de son onglet',
    (await aRepere('[data-onglet-non-lu="running"]')) === 0,
  );

  // Le travail s'achève : l'agent passe à « done », le robot d'activité doit
  // disparaître de l'onglet « planned ».
  await page.evaluate(
    ([projectId, cardId, agentId, quand]) => {
      window.__injecter({
        type: 'agent.upsert',
        agent: {
          id: agentId,
          projectId,
          cardId,
          role: 'task',
          title: 'Essai — agent au travail',
          run: { engine: 'codex', mode: 'direct' },
          status: 'done',
          endedAt: quand,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
    },
    [projectId, carteTravail.cardId, carteTravail.agentId, maintenant],
  );
  await page.waitForTimeout(700);
  record(
    'le travail achevé éteint le robot d’activité de son onglet',
    (await aRepere('[data-onglet-travail="planned"]')) === 0,
  );

  // Une carte change de colonne : les deux comptes doivent bouger ENSEMBLE.
  await page.evaluate(
    ([projectId, cardId, agentId, quand]) => {
      window.__injecter({
        type: 'card.upsert',
        card: {
          id: cardId,
          projectId,
          title: 'Essai — agent au travail',
          description: '',
          labels: [],
          column: 'planned',
          position: quand + 0.4,
          origin: 'user',
          run: { engine: 'codex', mode: 'direct' },
          excludedFromDeploy: false,
          horsTache: false,
          agentId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
    },
    [projectId, carteTravail.cardId, carteTravail.agentId, maintenant],
  );
  await page.waitForTimeout(700);
  const apresDeplacement = await comptesCompares();
  record(
    'déplacer une carte garde les deux comptes d’accord',
    apresDeplacement.ecarts.length === 0,
    apresDeplacement.ecarts.join(' | '),
  );

  record('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await browser.close();
  session.retirer();

  const rates = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés.`);
  if (rates.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
