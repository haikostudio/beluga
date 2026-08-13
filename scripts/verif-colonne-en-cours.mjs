#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur, qu'une carte au travail ne retombe
 * jamais dans « Planifié », et que l'alerte « le serveur ne répond pas » ne
 * paraît plus sur une requête isolée :
 *
 *  - une carte enregistrée en « Planifié » dont un agent TRAVAILLE s'affiche
 *    dans la colonne « En cours », avec sa mention d'anomalie ;
 *  - la tête de « Planifié » ne la compte plus, celle de « En cours » la compte ;
 *  - une carte en « Planifié » SANS agent au travail ne bouge pas ;
 *  - une carte « Terminé » dont un agent tourne (chiffrage discuté) ne bouge
 *    pas non plus : un tour de discussion ne déplace pas une carte ;
 *  - une carte DÉJÀ enregistrée en « En cours » dont un agent travaille ne
 *    porte AUCUNE mention : la colonne réellement enregistrée est déjà celle
 *    qu'on voit, l'anomalie n'aurait rien à apprendre ;
 *  - une requête isolée restée sans réponse n'affiche AUCUNE alerte, alors
 *    qu'un vrai refus métier s'affiche toujours.
 *
 * Tout est SIMULÉ : cartes et agents sont injectés dans le canal temps réel,
 * comme le fait `verif-progression-taches.mjs`. Rien n'est écrit dans la base à
 * part la session d'essai, retirée en partant.
 *
 *   HAIKO_COLONNE_URL=http://localhost:7099 node scripts/verif-colonne-en-cours.mjs
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
const BASE = process.env.HAIKO_COLONNE_URL || 'http://localhost:7099';
/*
 * La base et ses dépendances natives vivent dans le dépôt PRINCIPAL : une copie
 * de travail n'a qu'un `node_modules` réduit.
 */
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';
const PRINCIPAL = path.resolve(DONNEES, '..');

function base() {
  const require = createRequire(import.meta.url);
  return require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(
    path.join(DONNEES, 'haikodev.db'),
  );
}

/** Une session d'essai : la colonne « token » garde le SHA-256 du cookie. */
function poserSession() {
  const db = base();
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification colonne en cours',
  );
  db.close();
  return { cookie, retirer: () => retirerSession(cookie) };
}

function retirerSession(cookie) {
  const db = base();
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

  /*
   * Le projet AFFICHÉ : c'est dans SON tableau qu'on pose les cartes d'essai.
   * L'espace de développement de HaikoDev ne vit plus dans la liste des projets
   * (il a son propre bouton) : on le prend en premier, et on retombe sur la
   * première ligne de projet quand ce bouton n'existe pas.
   */
  const projectId = await page.evaluate(
    () =>
      document.querySelector('[data-espace-dev]')?.getAttribute('data-espace-dev') ??
      document.querySelector('[data-drag-kind="project"]')?.getAttribute('data-drag-id') ??
      null,
  );
  record('un projet est ouvert', !!projectId, projectId ?? 'aucun');
  if (!projectId) throw new Error('aucun projet dans la colonne de gauche');

  const maintenant = Date.now();
  /** Une carte d'essai, avec ou sans agent au travail. */
  const poser = async (suffixe, { column, titre, statutAgent, position }) => {
    const cardId = `essai-colonne-${suffixe}`;
    const agentId = `essai-colonne-agent-${suffixe}`;
    await page.evaluate(
      ([projectId, cardId, agentId, titre, column, statutAgent, position]) => {
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
            agentId: statutAgent ? agentId : undefined,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
        if (statutAgent) {
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
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          });
        }
      },
      [projectId, cardId, agentId, titre, column, statutAgent ?? null, position],
    );
    return { cardId, agentId };
  };

  /** Dans quelle colonne du tableau la carte est-elle RÉELLEMENT posée ? */
  const colonneDe = (cardId) =>
    page.evaluate((id) => {
      const carte = document.querySelector(`[data-carte="${id}"]`);
      return carte?.closest('[data-column]')?.getAttribute('data-column') ?? null;
    }, cardId);

  const auTravail = await poser('au-travail', {
    column: 'planned',
    titre: 'Essai — planifiée, agent au travail',
    statutAgent: 'running',
    position: maintenant + 0.1,
  });
  const auRepos = await poser('au-repos', {
    column: 'planned',
    titre: 'Essai — planifiée, personne dessus',
    position: maintenant + 0.2,
  });
  const discutee = await poser('discutee', {
    column: 'done',
    titre: 'Essai — terminée, chiffrage discuté',
    statutAgent: 'running',
    position: maintenant + 0.3,
  });
  const dejaEnCours = await poser('deja-en-cours', {
    column: 'running',
    titre: 'Essai — déjà en cours, agent au travail',
    statutAgent: 'running',
    position: maintenant + 0.4,
  });
  await page.waitForTimeout(1000);

  record(
    'une carte planifiée dont un agent travaille s’affiche en « En cours »',
    (await colonneDe(auTravail.cardId)) === 'running',
    (await colonneDe(auTravail.cardId)) ?? 'introuvable',
  );
  record(
    'la carte porte sa mention d’anomalie',
    !!(await page
      .locator(`[data-colonne-corrigee="${auTravail.cardId}"]`)
      .first()
      .textContent()
      .catch(() => null)),
    (await page
      .locator(`[data-colonne-corrigee="${auTravail.cardId}"]`)
      .first()
      .textContent()
      .catch(() => '')) ?? '',
  );
  record(
    'une carte planifiée sans agent reste dans « Planifié »',
    (await colonneDe(auRepos.cardId)) === 'planned',
    (await colonneDe(auRepos.cardId)) ?? 'introuvable',
  );
  record(
    'une carte « Terminé » dont l’agent tourne ne bouge pas',
    (await colonneDe(discutee.cardId)) === 'done',
    (await colonneDe(discutee.cardId)) ?? 'introuvable',
  );
  record(
    'une carte déjà en « En cours » reste sur place',
    (await colonneDe(dejaEnCours.cardId)) === 'running',
    (await colonneDe(dejaEnCours.cardId)) ?? 'introuvable',
  );
  record(
    'une carte déjà en « En cours » ne porte AUCUNE mention : rien à corriger',
    !(await page
      .locator(`[data-colonne-corrigee="${dejaEnCours.cardId}"]`)
      .first()
      .textContent()
      .catch(() => null)),
  );

  // Les têtes de colonne comptent sur la MÊME liste que les colonnes : la carte
  // corrigée doit être comptée en « En cours », plus en « Planifié ».
  const compte = (colonne) =>
    page.evaluate((c) => {
      const tete = document.querySelector(`[data-column="${c}"]`);
      return tete ? tete.querySelectorAll('[data-carte]').length : -1;
    }, colonne);
  const enCours = await compte('running');
  record('la colonne « En cours » compte au moins cette carte', enCours >= 1, String(enCours));

  /*
   * L'agent rend la main : la carte retourne à sa colonne enregistrée, sans
   * qu'on ait touché à quoi que ce soit côté serveur. On repose la carte AVEC
   * son agent : entre-temps, le serveur a pu rediffuser la vraie liste des
   * cartes du projet, ce qui efface les cartes d'essai injectées.
   */
  await poser('au-travail', {
    column: 'planned',
    titre: 'Essai — planifiée, agent au travail',
    statutAgent: 'done',
    position: maintenant + 0.1,
  });
  await page.waitForTimeout(800);
  record(
    'l’agent fini, la carte retrouve sa colonne enregistrée',
    (await colonneDe(auTravail.cardId)) === 'planned',
    (await colonneDe(auTravail.cardId)) ?? 'introuvable',
  );

  /* --------- L'alerte « le serveur ne répond pas » --------------------- */

  const messages = () =>
    page.evaluate(() => document.querySelector('[data-pile="messages"]')?.textContent ?? '');

  const disponible = await page.evaluate(() => typeof window.haikodevEssai?.refus === 'function');
  record('le point d’essai des refus est là', disponible);

  await page.evaluate(() => window.haikodevEssai.refus('le serveur ne répond pas'));
  await page.waitForTimeout(700);
  record(
    'une requête isolée sans réponse n’affiche aucune alerte',
    !/ne répond pas/.test(await messages()),
  );

  await page.evaluate(() => window.haikodevEssai.refus('le dossier est déjà pris par une autre carte'));
  await page.waitForTimeout(700);
  record('un vrai refus, lui, s’affiche toujours', /déjà pris/.test(await messages()));

  record('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await browser.close();
  session.retirer();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés`);
  if (echecs.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
