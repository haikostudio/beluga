#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur, du repère « tour terminé sans suite »
 * posé sur une carte du tableau :
 *
 *  - une carte en « En cours » dont le dernier tour s'est achevé il y a plus
 *    d'une heure, sans agent au travail, PORTE la mention ;
 *  - une carte dont l'agent travaille encore ne la porte pas (la roue le dit) ;
 *  - une carte dont le tour vient de finir ne la porte pas non plus ;
 *  - une carte qui attend une DÉCISION porte le triangle et pas la mention :
 *    deux repères pour une même carte ne feraient que du bruit.
 *
 * Tout est SIMULÉ : cartes et agents sont injectés dans le canal temps réel,
 * comme le fait `verif-signal-attention.mjs`. Rien n'est écrit dans la base à
 * part la session d'essai, retirée en partant.
 *
 *   HAIKODEV_URL=http://localhost:7099 node scripts/verif-carte-sans-suite.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/*
 * La racine se déduit du script lui-même : lancé depuis une copie de travail,
 * il doit juger CE code-là, jamais celui du dossier principal.
 */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_SANS_SUITE_URL || 'http://localhost:7099';
/*
 * La base et ses dépendances natives vivent dans le dépôt PRINCIPAL : une copie
 * de travail n'a qu'un `node_modules` réduit.
 */
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';
const PRINCIPAL = path.resolve(DONNEES, '..');

const HEURE = 60 * 60 * 1000;

/** Une session d'essai : la colonne « token » garde le SHA-256 du cookie. */
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
    'vérification carte sans suite',
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
    viewport: { width: 1440, height: 900 },
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

  // On se greffe sur le canal temps réel, sans rien remplacer de ce qui arrive
  // vraiment du serveur : `__injecter` rejoue un événement tel quel.
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

  // Le projet affiché : c'est dans SON tableau qu'on pose les cartes d'essai.
  const projectId = await page.evaluate(
    () => document.querySelector('[data-drag-kind="project"]')?.getAttribute('data-drag-id') ?? null,
  );
  record('un projet est ouvert', !!projectId, projectId ?? 'aucun');
  if (!projectId) throw new Error('aucun projet dans la colonne de gauche');

  const maintenant = Date.now();
  /** Une carte d'essai en « En cours », avec l'agent qui va avec. */
  const poser = async (suffixe, { finDuTour, statutAgent, titre }) => {
    const cardId = `essai-sans-suite-${suffixe}`;
    const agentId = `essai-agent-${suffixe}`;
    await page.evaluate(
      ([projectId, cardId, agentId, titre, finDuTour, statutAgent, position]) => {
        window.__injecter({
          type: 'card.upsert',
          card: {
            id: cardId,
            projectId,
            title: titre,
            description: '',
            labels: [],
            column: 'running',
            position,
            origin: 'user',
            run: { engine: 'codex', mode: 'direct' },
            excludedFromDeploy: false,
            horsTache: false,
            agentId,
            createdAt: finDuTour,
            updatedAt: finDuTour,
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
            endedAt: statutAgent === 'done' ? finDuTour : undefined,
            createdAt: finDuTour,
            updatedAt: finDuTour,
          },
        });
      },
      [projectId, cardId, agentId, titre, finDuTour, statutAgent, maintenant + Math.random()],
    );
    return cardId;
  };

  const mention = (cardId) =>
    page
      .locator(`[data-carte="${cardId}"] [data-mention-sans-suite]`)
      .first()
      .textContent()
      .catch(() => null);

  const figee = await poser('figee', {
    finDuTour: maintenant - 3 * HEURE,
    statutAgent: 'done',
    titre: 'Essai — tour achevé il y a trois heures',
  });
  const recente = await poser('recente', {
    finDuTour: maintenant - 5 * 60 * 1000,
    statutAgent: 'done',
    titre: 'Essai — tour achevé il y a cinq minutes',
  });
  const active = await poser('active', {
    finDuTour: maintenant - 3 * HEURE,
    statutAgent: 'running',
    titre: 'Essai — un agent travaille encore',
  });
  await page.waitForTimeout(900);

  // Le tableau peut s'ouvrir sur une autre colonne : on amène « En cours ».
  const colonne = page.locator('[data-column="running"]').first();
  await colonne.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);

  const texteFigee = await mention(figee);
  record('une carte en cours sans agent depuis 3 h porte la mention', !!texteFigee, texteFigee ?? 'absente');
  record(
    'la mention dit la durée et qu’aucun agent ne travaille',
    /3 h/.test(texteFigee ?? '') && /aucun agent/.test(texteFigee ?? ''),
    texteFigee ?? '',
  );
  record('un tour achevé il y a cinq minutes ne dit rien', !(await mention(recente)));
  record('un agent au travail : la roue le dit déjà, pas la mention', !(await mention(active)));

  /*
   * Une décision qui arrive sur la carte figée : le triangle orange doit la
   * prendre, et la mention s'effacer. Un seul repère par carte.
   */
  await page.evaluate(
    ([projectId, cardId]) => {
      window.__injecter({
        type: 'attention',
        byProject: { [projectId]: 1 },
        decisions: [{ projectId, agentId: `essai-agent-figee`, cardId, genre: 'question' }],
      });
    },
    [projectId, figee],
  );
  await page.waitForTimeout(700);
  const triangle = await page.locator(`[data-attention-carte="${figee}"]`).count();
  record('la carte porte alors le triangle de décision', triangle > 0);
  record('et la mention s’efface : un seul repère à la fois', !(await mention(figee)));

  /*
   * Le triangle DIT ; le bouton EMMÈNE. Il n'apparaît que sur la carte qui
   * attend, et son clic ouvre le tiroir DIRECTEMENT sur la conversation — pas
   * sur les détails, qu'il faudrait quitter à la main pour répondre.
   */
  const bouton = page.locator(`[data-repondre-carte="${figee}"]`);
  record('un bouton « Répondre » s’affiche sur la carte qui attend', (await bouton.count()) > 0);
  record(
    'aucune autre carte ne le porte',
    (await page.locator(`[data-repondre-carte="${recente}"]`).count()) === 0 &&
      (await page.locator(`[data-repondre-carte="${active}"]`).count()) === 0,
  );
  await bouton.first().click();
  await page.waitForTimeout(900);
  const etatDuTiroir = await page.evaluate(() => ({
    onglets: Array.from(document.querySelectorAll('[role="tab"]')).map((t) => ({
      texte: (t.textContent || '').trim(),
      actif: t.getAttribute('data-state') === 'active',
    })),
  }));
  const surLaConversation = etatDuTiroir.onglets.some(
    (o) => o.actif && o.texte.toLowerCase().includes('conversation'),
  );
  record('le clic ouvre le tiroir sur la conversation', surLaConversation);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

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
