#!/usr/bin/env node
/**
 * LE CHOIX DE LA BRANCHE, DANS UN VRAI NAVIGATEUR.
 *
 * Les réglages du projet portent désormais DEUX listes de branches : celle du
 * déploiement (bloc « Déploiement ») et celle de la mise en production (bloc
 * « Mise en production »). Ce contrôle juge l'écran, pas la règle — la règle
 * pure a ses tests (`server/src/test/branche-de-publication.test.ts`) et le
 * déploiement réel le sien (`scripts/verif-branche-de-publication.mjs`) :
 *
 *  - les deux listes sont là, alimentées par les branches DU DÉPÔT ;
 *  - rien de choisi est la première option, et la phrase dessous dit ce qui
 *    s'appliquera alors — « dev » ici, puisque le dépôt en a une ;
 *  - choisir une branche puis enregistrer range bien les DEUX réglages sur le
 *    projet, séparément ;
 *  - rouvrir les réglages retrouve les branches choisies.
 *
 * Tout est SIMULÉ : `project.branches` et `project.update` sont interceptés
 * dans le navigateur — aucun appel à GitHub, aucun projet réel modifié. Rien
 * n'est écrit en base à part la session d'essai, retirée en partant.
 *
 *   HAIKO_BRANCHES_URL=http://localhost:7099 node scripts/verif-branche-reglages.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_BRANCHES_URL || 'http://localhost:7099';
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';
const PRINCIPAL = path.resolve(DONNEES, '..');

/** Les branches que le faux dépôt rend, dans l'ordre où le serveur les range. */
const BRANCHES = ['dev', 'livraison', 'main', 'tache/quelque-chose'];

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
    'vérification branches de publication',
  );
  db.close();
  return {
    cookie,
    retirer: () => {
      const db2 = base();
      db2.prepare('DELETE FROM sessions WHERE token = ?').run(
        crypto.createHash('sha256').update(cookie).digest('hex'),
      );
      db2.close();
    },
  };
}

const resultats = [];
function record(nom, ok, detail = '') {
  resultats.push({ nom, ok });
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
    viewport: { width: 1280, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'haikodev_session', value: session.cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);

  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && erreurs.push(message.text()));

  await page.addInitScript((branches) => {
    const CLE = '__essaiBranches';
    window.__ecouteurs = [];
    const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get() {
        return propriete.get.call(this);
      },
      set(ecouteur) {
        window.__ecouteurs.push(ecouteur);
        // Le démon réel repousse SON projet sous le même identifiant : on
        // remplace le nôtre partout où il passe, sans toucher aux autres.
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
            /* pas du JSON */
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
    window.__branchesRangees = () => lireRange().branchesDePublication ?? null;

    window.__construireProjet = (id) => {
      const projet = {
        id,
        name: 'Essai branches',
        path: '/root/essai-branches',
        defaultEngine: 'claude',
        isSelf: false,
        rank: 1,
        archived: false,
        devUrl: 'https://essai.example.com',
        miseEnProduction: {},
        branchesDePublication: {},
        createdAt: 1,
        updatedAt: 1,
        ...lireRange(),
      };
      projet.id = id;
      return projet;
    };
    window.__poserProjet = (id) => {
      window.__projetId = id;
      window.__injecter({ type: 'project.upsert', project: window.__construireProjet(id) });
    };

    const envoiOriginal = WebSocket.prototype.send;
    WebSocket.prototype.send = function (donnees) {
      let enveloppe = null;
      try {
        enveloppe = JSON.parse(donnees);
      } catch {
        /* pas du JSON */
      }
      const cmd = enveloppe?.cmd;
      if (cmd?.type === 'project.branches') {
        // On répond à la place du serveur : aucune lecture de GitHub.
        window.__injecter({
          id: enveloppe.id,
          type: 'ack',
          ok: true,
          data: { branches, source: 'github' },
        });
        return;
      }
      if (cmd?.type === 'project.update' && cmd.patch?.branchesDePublication) {
        const range = lireRange();
        const projet = { ...range, branchesDePublication: cmd.patch.branchesDePublication, id: cmd.id };
        localStorage.setItem(CLE, JSON.stringify(projet));
        window.__injecter({ id: enveloppe.id, type: 'ack', ok: true, data: { project: projet } });
        window.__poserProjet(cmd.id);
        return;
      }
      return envoiOriginal.call(this, donnees);
    };
  }, BRANCHES);

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

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => localStorage.removeItem('__essaiBranches'));

  const projectId = await ouvrir();
  record('un projet est ouvert', !!projectId, projectId);

  const ouvrirReglages = async () => {
    await page.locator(`[data-reglages-projet="${projectId}"]`).first().click({ force: true });
    await page.waitForTimeout(1200);
  };
  const fermerReglages = async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  };

  await ouvrirReglages();

  const listeDev = page.locator('[data-branche-dev] select');
  const listeProd = page.locator('[data-branche-production] select');
  record(
    'les deux listes de branches sont dans les réglages du projet',
    (await listeDev.count()) === 1 && (await listeProd.count()) === 1,
  );

  const options = await listeDev.locator('option').allTextContents();
  record(
    'la liste propose les branches du dépôt, « rien de choisi » en tête',
    options[0]?.includes('défaut') && BRANCHES.every((b) => options.includes(b)),
    options.join(' | '),
  );

  record(
    'rien n’est choisi au départ, pour les deux étapes',
    (await listeDev.inputValue()) === '' && (await listeProd.inputValue()) === '',
  );

  const mentionDev = (await page.locator('[data-branche-dev] p').textContent()) ?? '';
  record(
    'la phrase dit que le déploiement ira sur « dev » tant que rien n’est choisi',
    /dev/.test(mentionDev),
    mentionDev.trim().slice(0, 110),
  );
  const mentionProd = (await page.locator('[data-branche-production] p').textContent()) ?? '';
  record(
    'et que la mise en production reste sur la principale',
    /principale/.test(mentionProd),
    mentionProd.trim().slice(0, 110),
  );

  /* -------- Choisir, enregistrer, retrouver -------- */

  await listeDev.selectOption('livraison');
  await listeProd.selectOption('main');
  await page.waitForTimeout(200);
  const apresChoix = (await page.locator('[data-branche-dev] p').textContent()) ?? '';
  record(
    'la phrase suit le choix et nomme la branche visée',
    apresChoix.includes('livraison'),
    apresChoix.trim().slice(0, 110),
  );

  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.waitForTimeout(1200);
  const range = await page.evaluate(() => window.__branchesRangees());
  record(
    'les deux branches sont enregistrées séparément sur le projet',
    range?.dev === 'livraison' && range?.production === 'main',
    JSON.stringify(range),
  );

  await ouvrirReglages();
  record(
    'rouvrir les réglages retrouve les branches choisies',
    (await listeDev.inputValue()) === 'livraison' && (await listeProd.inputValue()) === 'main',
    `${await listeDev.inputValue()} / ${await listeProd.inputValue()}`,
  );
  await fermerReglages();

  record('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await browser.close();
  session.retirer();

  const rates = resultats.filter((r) => !r.ok).length;
  console.log(`\n${resultats.length - rates}/${resultats.length} contrôles passés.`);
  process.exit(rates ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
