#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur, de l'avancement « n/N faites » posé
 * dans le décroché des cartes de la colonne « En cours » :
 *
 *  - une carte en « En cours » dont l'agent a une liste 2/3 MONTRE « 2/3 » ;
 *  - le compteur change quand une étape passe à « faite » (l'agent renvoie
 *    3/3) ;
 *  - une carte sans liste de tâches ne montre rien ;
 *  - une carte d'une AUTRE colonne (Terminé) ne montre rien, même avec une
 *    liste : le décroché ne parle que pour « En cours » ;
 *  - la TÊTE de la colonne « En cours » affiche le pourcentage global, égal à
 *    la somme des « n/N faites » réellement affichés, dans l'ORANGE des
 *    travaux en cours.
 *
 * Tout est SIMULÉ : cartes et agents sont injectés dans le canal temps réel,
 * comme le fait `verif-carte-sans-suite.mjs`. Rien n'est écrit dans la base à
 * part la session d'essai, retirée en partant.
 *
 *   HAIKO_PROGRESSION_URL=http://localhost:7099 node scripts/verif-progression-taches.mjs
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
const BASE = process.env.HAIKO_PROGRESSION_URL || 'http://localhost:7099';
/*
 * La base et ses dépendances natives vivent dans le dépôt PRINCIPAL : une copie
 * de travail n'a qu'un `node_modules` réduit.
 */
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';
const PRINCIPAL = path.resolve(DONNEES, '..');

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
    'vérification progression tâches',
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

  /*
   * Le projet AFFICHÉ : c'est dans SON tableau qu'on pose les cartes d'essai.
   * L'espace de développement de HaikoDev ne vit plus dans la liste des projets
   * (il a son propre bouton) : sans lui, on posait les cartes dans le tableau
   * d'un AUTRE projet, où elles restaient invisibles.
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
  /** Une carte d'essai, avec l'agent de tâche qui va avec. */
  const poser = async (suffixe, { column, titre, statutAgent, todos, position }) => {
    const cardId = `essai-progression-${suffixe}`;
    const agentId = `essai-progression-agent-${suffixe}`;
    await page.evaluate(
      ([projectId, cardId, agentId, titre, column, statutAgent, todos, position]) => {
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
            todos: todos ?? undefined,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
      },
      [projectId, cardId, agentId, titre, column, statutAgent, todos ?? null, position],
    );
    return { cardId, agentId };
  };

  // Le décroché est FRÈRE de l'article `data-carte`, pas descendant : la valeur
  // de l'attribut porte l'identifiant de la carte, elle suffit à le viser.
  const texteProgression = (cardId) =>
    page
      .locator(`[data-progression-taches="${cardId}"]`)
      .first()
      .textContent()
      .catch(() => null);

  const deuxSurTrois = await poser('en-cours', {
    column: 'running',
    titre: 'Essai — liste 2/3',
    statutAgent: 'running',
    todos: { done: 2, total: 3 },
    position: maintenant + 0.1,
  });
  const sansListe = await poser('sans-liste', {
    column: 'running',
    titre: 'Essai — pas encore de liste',
    statutAgent: 'running',
    todos: undefined,
    position: maintenant + 0.2,
  });
  const terminee = await poser('terminee', {
    column: 'done',
    titre: 'Essai — Terminé avec liste',
    statutAgent: 'done',
    todos: { done: 3, total: 3 },
    position: maintenant + 0.3,
  });
  await page.waitForTimeout(900);

  // Le tableau peut s'ouvrir sur une autre colonne : on amène « En cours ».
  const colonne = page.locator('[data-column="running"]').first();
  await colonne.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);

  const t1 = await texteProgression(deuxSurTrois.cardId);
  record('une carte en cours avec une liste 2/3 montre « 2/3 »', /2\/3/.test(t1 ?? ''), t1 ?? 'absent');
  record('le mot « faites » accompagne le compte', /faites/.test(t1 ?? ''), t1 ?? '');

  record(
    'une carte sans liste de tâches ne montre rien',
    !(await texteProgression(sansListe.cardId)),
  );
  record(
    'une carte « Terminé » ne montre rien, même avec une liste',
    !(await texteProgression(terminee.cardId)),
  );

  /*
   * L'agent coche la dernière étape : il renvoie 3/3, le décroché doit suivre.
   * On repose la carte AVEC son agent : entre-temps, le serveur a pu rediffuser
   * la vraie liste des cartes du projet (un agent qui travaille pour de bon),
   * ce qui efface les cartes d'essai injectées.
   */
  await poser('en-cours', {
    column: 'running',
    titre: 'Essai — liste 2/3',
    statutAgent: 'running',
    todos: { done: 3, total: 3 },
    position: maintenant + 0.1,
  });
  await page.waitForTimeout(700);
  const t2 = await texteProgression(deuxSurTrois.cardId);
  record('le compteur passe à « 3/3 » quand une étape est cochée', /3\/3/.test(t2 ?? ''), t2 ?? 'absent');

  /*
   * L'avancement GLOBAL, en tête de la colonne « En cours ». On ne suppose rien
   * du contenu réel du tableau : on additionne les « n/N faites » RÉELLEMENT
   * affichés (ils n'existent que dans cette colonne) et on compare au
   * pourcentage de l'entête. Sa couleur doit être celle du jeton « en cours »,
   * jamais une teinte neuve : on la mesure contre un témoin `text-en-cours`.
   */
  const mesure = await page.evaluate(() => {
    const entete = document.querySelector('[data-avancement-colonne="running"]');
    let done = 0;
    let total = 0;
    for (const decroche of document.querySelectorAll('[data-progression-taches]')) {
      const trouve = /(\d+)\s*\/\s*(\d+)/.exec(decroche.textContent ?? '');
      if (!trouve) continue;
      done += Number(trouve[1]);
      total += Number(trouve[2]);
    }
    const temoin = document.createElement('span');
    temoin.className = 'text-en-cours';
    document.body.appendChild(temoin);
    const orange = getComputedStyle(temoin).color;
    temoin.remove();
    return {
      texte: entete?.textContent ?? null,
      couleur: entete ? getComputedStyle(entete).color : null,
      orange,
      done,
      total,
    };
  });
  const attendu = mesure.total > 0 ? Math.round((mesure.done / mesure.total) * 100) : null;
  record(
    'la tête de « En cours » affiche un pourcentage',
    attendu === null ? !mesure.texte : /^\s*\d+\s*%\s*$/.test(mesure.texte ?? ''),
    `${mesure.texte ?? 'absent'} (${mesure.done}/${mesure.total})`,
  );
  record(
    'ce pourcentage est bien la somme des étapes de toutes les cartes',
    attendu === null || Number((mesure.texte ?? '').replace(/[^\d]/g, '')) === attendu,
    attendu === null ? 'aucune étape comptée' : `attendu ${attendu} %`,
  );
  record(
    'il reprend l’ORANGE des travaux en cours, pas une teinte neuve',
    attendu === null || attendu === 100 || mesure.couleur === mesure.orange,
    `${mesure.couleur ?? 'absent'} / ${mesure.orange}`,
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
