#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur sur le serveur de développement, du
 * bloc « Mise en production » des RÉGLAGES DU PROJET :
 *
 *  - le bloc est là, et rappelle en une ligne l'environnement de production
 *    visé, sa branche et son adresse ;
 *  - on écrit le concept dans ses mots, on clique « Générer », un état
 *    d'attente s'affiche puis le prompt rédigé apparaît dans un champ
 *    MODIFIABLE ;
 *  - base ET prompt enregistrés SURVIVENT au rechargement de la page ;
 *  - vider les deux champs efface le réglage ;
 *  - le menu trois points des colonnes ne propose PLUS de consigne de
 *    déploiement : ce réglage a quitté le tableau.
 *
 * Tout est SIMULÉ : `project.update` ET `production.generer` sont interceptés
 * dans le navigateur, on répond à leur place — aucun vrai agent, aucun quota
 * dépensé, la commande ne part JAMAIS au serveur. La persistance est imitée par
 * le stockage local de la page — c'est ce qui permet de juger un VRAI
 * rechargement sans écrire dans aucun projet réel. Rien n'est écrit en base à
 * part la session d'essai, retirée en partant.
 *
 *   HAIKO_PRODUCTION_URL=http://localhost:7099 node scripts/verif-mise-en-production.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_PRODUCTION_URL || 'http://localhost:7099';
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';
const PRINCIPAL = path.resolve(DONNEES, '..');

function base() {
  const require = createRequire(import.meta.url);
  return require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(path.join(DONNEES, 'haikodev.db'));
}

function poserSession() {
  const db = base();
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification mise en production',
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

// Ce qu'on TAPE : le concept, dans les mots de l'utilisateur.
const CONCEPT =
  'Le site tourne sur le serveur du client. Construire, copier le dossier, relancer le service, contrôler l’adresse. Ne jamais toucher à la base de données.';
// Ce que l'agent factice RÉDIGE — même formule que `window.__promptFactice`.
const promptAttendu = (concept) => `Prompt de mise en production :: ${concept}`;
const PROMPT = promptAttendu(CONCEPT);

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  const session = poserSession();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
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

  /*
   * Le banc d'essai, posé AVANT chaque chargement (donc rejoué au rechargement) :
   *  - en ENTRÉE, on garde les écouteurs pour pouvoir injecter des événements ;
   *  - en SORTIE, on intercepte `project.update` et `production.generer`, et on
   *    répond à la place du serveur, en rangeant le patch dans le stockage local
   *    de la page.
   * Le stockage local tient lieu de base : c'est lui qui fait qu'un rechargement
   * retrouve le prompt, sans qu'aucun projet réel ne bouge.
   */
  await page.addInitScript(() => {
    const CLE = '__essaiProduction';
    window.__ecouteurs = [];
    const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get() {
        return propriete.get.call(this);
      },
      set(ecouteur) {
        window.__ecouteurs.push(ecouteur);
        /*
         * Le démon RÉEL continue de pousser SON projet (aucune mise en
         * production réglée) sous le même identifiant : sans garde, il
         * écraserait notre projet d'essai. Deux chemins l'apportent —
         * l'événement `ready` qui porte TOUTE la liste (`projects`) et le
         * `project.upsert` d'un seul. On REMPLACE notre projet dans les deux,
         * par celui qu'on fabrique (base et prompt rangés compris), sans
         * toucher aux autres projets ni aux autres événements.
         */
        const enveloppe = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            const id = window.__projetId;
            let change = false;
            if (id) {
              if (msg?.type === 'project.upsert' && msg.project?.id === id) {
                msg.project = window.__construireProjet(id);
                change = true;
              }
              if (Array.isArray(msg?.projects)) {
                msg.projects = msg.projects.map((p) => (p?.id === id ? window.__construireProjet(id) : p));
                change = true;
              }
            }
            if (change) return ecouteur({ data: JSON.stringify(msg) });
          } catch {
            /* pas du JSON : on laisse filer tel quel */
          }
          return ecouteur(evt);
        };
        return propriete.set.call(this, enveloppe);
      },
    });
    window.__injecter = (evenement) => {
      const donnees = JSON.stringify(evenement);
      for (const ecouteur of window.__ecouteurs) ecouteur({ data: donnees });
    };

    const lireRange = () => {
      try {
        return JSON.parse(localStorage.getItem(CLE) || '{}');
      } catch {
        return {};
      }
    };
    window.__productionRangee = () => lireRange().miseEnProduction ?? null;

    // Le prompt que « génère » l'agent factice : déterministe à partir de la
    // base, pour qu'un contrôle sache exactement quoi attendre. AUCUN vrai agent
    // n'est lancé, aucun quota touché.
    window.__promptFactice = (base) => `Prompt de mise en production :: ${base}`;
    // Délai de la réponse de génération, pour rendre l'état d'attente OBSERVABLE.
    window.__genererDelai = 500;

    // Le projet d'essai : on part du projet réel ouvert, dont on ne garde que
    // l'identifiant, et on lui pose des réglages de publication à nous. La base
    // et le prompt rangés (stockage local) le suivent à chaque fabrication.
    window.__construireProjet = (id) => {
      const projet = {
        id,
        name: 'Essai mise en production',
        path: '/root/essai-production',
        defaultEngine: 'claude',
        isSelf: false,
        rank: 1,
        archived: false,
        environments: [
          {
            id: 'prod',
            nom: 'Production client',
            role: 'production',
            branche: 'release',
            url: 'https://essai.example.com',
          },
        ],
        miseEnProduction: {},
        createdAt: 1,
        updatedAt: 1,
        ...lireRange(),
      };
      projet.id = id;
      return projet;
    };
    window.__poserProjet = (id) => {
      window.__projetId = id;
      const projet = window.__construireProjet(id);
      window.__injecter({ type: 'project.upsert', project: projet });
      return projet;
    };

    const envoiOriginal = WebSocket.prototype.send;
    WebSocket.prototype.send = function (donnees) {
      let enveloppe = null;
      try {
        enveloppe = JSON.parse(donnees);
      } catch {
        /* pas du JSON : on laisse filer */
      }
      const cmd = enveloppe?.cmd;
      if (cmd?.type === 'production.generer') {
        // On répond à la place du serveur, APRÈS un délai, avec un prompt
        // factice : jamais un vrai tour d'agent, jamais de quota dépensé.
        const prompt = window.__promptFactice(cmd.base);
        setTimeout(() => {
          window.__injecter({ id: enveloppe.id, type: 'ack', ok: true, data: { ok: true, prompt } });
        }, window.__genererDelai);
        return;
      }
      if (cmd?.type === 'project.update' && cmd.patch?.miseEnProduction) {
        const range = lireRange();
        const projet = { ...range, miseEnProduction: cmd.patch.miseEnProduction, id: cmd.id };
        localStorage.setItem(CLE, JSON.stringify(projet));
        window.__injecter({ id: enveloppe.id, type: 'ack', ok: true, data: { project: projet } });
        // La boucle complète, comme le ferait le serveur : le projet modifié
        // repart en `project.upsert`, donc l'écran relit ce qui est « rangé ».
        window.__poserProjet(cmd.id);
        return;
      }
      return envoiOriginal.call(this, donnees);
    };
  });

  const ouvrir = async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    page.setDefaultTimeout(8000);
    const id = await page.evaluate(
      () => document.querySelector('[data-drag-kind="project"]')?.getAttribute('data-drag-id') ?? null,
    );
    if (!id) throw new Error('aucun projet dans la colonne de gauche');
    await page.evaluate((projectId) => window.__poserProjet(projectId), id);
    await page.waitForTimeout(900);
    return id;
  };

  // On repart d'un stockage propre : le contrôle doit être rejouable.
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => localStorage.removeItem('__essaiProduction'));

  const projectId = await ouvrir();
  record('un projet est ouvert', !!projectId, projectId);

  /* -------- Le menu des colonnes ne règle plus le déploiement -------- */

  const restes = await page.evaluate(() => ({
    entrees: document.querySelectorAll('[data-configurer-deploiement]').length,
    fenetres: document.querySelectorAll('[data-fenetre-consigne]').length,
  }));
  record(
    'le menu trois points des colonnes ne propose plus de consigne de déploiement',
    restes.entrees === 0 && restes.fenetres === 0,
    JSON.stringify(restes),
  );

  const menusSansNonLue = await page.evaluate(() =>
    ['to_deploy', 'in_production'].map((cle) => ({
      cle,
      menu: !!document.querySelector(`[data-menu-colonne="${cle}"]`),
      nonLues: document.querySelectorAll(`[data-column="${cle}"] [data-carte-non-lue]`).length,
    })),
  );
  const contredit = menusSansNonLue.filter((col) => col.menu !== col.nonLues > 0);
  record(
    'les colonnes de publication suivent désormais la règle commune : menu seulement si non-lu',
    contredit.length === 0,
    menusSansNonLue.map((c) => `${c.cle}:${c.menu ? 'menu' : '—'}/${c.nonLues}`).join(' '),
  );

  /* -------- Le bloc des réglages du projet -------- */

  const ouvrirReglages = async (id) => {
    await page.locator(`[data-reglages-projet="${id}"]`).first().click({ force: true });
    await page.waitForTimeout(800);
    await page.locator('[data-mise-en-production]').scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(300);
  };

  const fermerReglages = async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  };

  await ouvrirReglages(projectId);

  record(
    'le bloc « Mise en production » est dans les réglages du projet',
    (await page.locator('[data-mise-en-production]').count()) === 1,
  );

  const rappel = (await page.locator('[data-rappel-production]').textContent()) ?? '';
  record(
    'le bloc rappelle l’environnement de production, sa branche et son adresse',
    rappel.includes('Production client') && rappel.includes('release') && rappel.includes('essai.example.com'),
    rappel.trim().slice(0, 130),
  );

  record(
    'la base ET le prompt partent VIDES quand rien n’a été réglé',
    (await page.locator('[data-base-production]').inputValue()) === '' &&
      (await page.locator('[data-prompt-production]').inputValue()) === '',
  );

  /* -------- Écrire, générer, enregistrer -------- */

  await page.locator('[data-base-production]').fill(CONCEPT);
  await page.waitForTimeout(150);
  await page.locator('[data-generer-production]').click();
  // L'état d'attente est bref (délai factice) : on l'attrape tout de suite.
  const enAttente = (await page.locator('[data-generer-production]').textContent()) ?? '';
  record('cliquer Générer montre un état d’attente', /Génération/i.test(enAttente), enAttente.trim().slice(0, 40));

  await page
    .waitForFunction(
      (attendu) => document.querySelector('[data-prompt-production]')?.value === attendu,
      PROMPT,
      { timeout: 8000 },
    )
    .catch(() => undefined);
  const affiche = await page.locator('[data-prompt-production]').inputValue();
  record('le prompt rédigé apparaît dans le champ modifiable', affiche === PROMPT, affiche.slice(0, 90));

  const modifiable = await page.evaluate(
    () => document.querySelector('[data-prompt-production]')?.disabled === false,
  );
  record('le champ du prompt reste modifiable après la génération', modifiable === true);

  const avantEnregistrement = await page.evaluate(() => window.__productionRangee());
  record(
    'générer n’enregistre RIEN tant qu’on n’a pas cliqué sur Enregistrer',
    !avantEnregistrement?.prompt,
    JSON.stringify(avantEnregistrement ?? {}).slice(0, 80),
  );

  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await page.waitForTimeout(1400);

  const range1 = await page.evaluate(() => window.__productionRangee());
  record(
    'l’enregistrement range la BASE et le PROMPT sur le projet',
    range1?.base === CONCEPT && range1?.prompt === PROMPT,
    JSON.stringify(range1 ?? {}).slice(0, 120),
  );

  /* -------- Le rechargement -------- */

  await ouvrir();
  await ouvrirReglages(projectId);

  const reluBase = await page.locator('[data-base-production]').inputValue();
  const reluPrompt = await page.locator('[data-prompt-production]').inputValue();
  record(
    'après rechargement, la base ET le prompt sont retrouvés',
    reluBase === CONCEPT && reluPrompt === PROMPT,
    `${reluBase.slice(0, 50)} | ${reluPrompt.slice(0, 50)}`,
  );

  const mention = (await page.locator('[data-mention-production]').textContent()) ?? '';
  record(
    'la mention dit l’état du réglage en une ligne',
    /signes/.test(mention),
    mention.trim().slice(0, 90),
  );

  /* -------- Vider efface le réglage -------- */

  await page.locator('[data-base-production]').fill('');
  await page.locator('[data-prompt-production]').fill('');
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await page.waitForTimeout(1400);

  const range2 = await page.evaluate(() => window.__productionRangee());
  record(
    'vider les deux champs efface le réglage au lieu de ranger du vide',
    !range2?.base && !range2?.prompt,
    JSON.stringify(range2 ?? {}).slice(0, 80),
  );

  record('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await page.evaluate(() => localStorage.removeItem('__essaiProduction'));
  await browser.close();
  session.retirer();

  const rates = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés.`);
  if (rates.length) process.exit(1);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
