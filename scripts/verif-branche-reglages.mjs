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
 *  - rien de choisi est la première option, et la phrase dessous dit la branche
 *    IMPOSÉE qui s'appliquera alors — « dev » d'un côté, « main » de l'autre ;
 *  - une branche choisie HORS de ce schéma est suivie, mais signalée comme un
 *    écart, sous la liste ;
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
import { choisirDansLaListe, optionsDeLaListe, valeurDeLaListe } from './lib/liste-deroulante.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_BRANCHES_URL || 'http://localhost:7099';
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';
const PRINCIPAL = path.resolve(DONNEES, '..');

/** Les branches que le faux dépôt rend, dans l'ordre où le serveur les range. */
const BRANCHES = ['dev', 'livraison', 'main', 'tache/quelque-chose'];

function base() {
  const require = createRequire(import.meta.url);
  return require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(path.join(DONNEES, 'beluga.db'));
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
    { name: 'beluga_session', value: session.cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
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

  /* LA CONFIGURATION S'OUVRE PAR L'ADRESSE, comme n'importe quel écran depuis
     qu'elle en porte une : plus besoin de retrouver une icône de la colonne de
     gauche, qui se cache quand la colonne est repliée. */
  const ouvrirReglages = async () => {
    await page.evaluate((id) => {
      window.location.hash = `projet/${id}/config`;
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, projectId);
    await page.waitForSelector('[data-config-projet]', { timeout: 15000 });
    await page.waitForTimeout(800);
  };
  /* LA CONFIGURATION EST UNE FENÊTRE À RUBRIQUES : les deux branches ne sont
     plus l'une sous l'autre dans une longue page. Celle du déploiement vit
     dans sa rubrique, celle de la production dans la sienne — c'est justement
     ce qui empêche de les confondre. */
  /* LA BRANCHE EST UN RÉGLAGE AVANCÉ (11/10/2026) : dans chaque rubrique, seule
     l'adresse reste à vue, et la liste des branches se range derrière
     « Réglages avancés », fermé par défaut. On le déplie donc en arrivant. */
  const avances = (rubrique) => page.locator(`[data-rubrique-contenu="${rubrique}"] [data-reglages-avances]`);
  const basculerAvances = async (rubrique, ouvert) => {
    const bouton = avances(rubrique);
    if ((await bouton.count()) && (await bouton.getAttribute('aria-expanded')) !== String(ouvert)) await bouton.click();
    await page.waitForTimeout(250);
  };
  const allerA = async (rubrique, { deplier = true } = {}) => {
    await page.locator(`[data-rubrique-config="${rubrique}"]`).click({ force: true });
    await page.waitForSelector(`[data-rubrique-contenu="${rubrique}"]`, { timeout: 10000 });
    await page.waitForTimeout(400);
    if (deplier) await basculerAvances(rubrique, true);
  };
  const fermerReglages = async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  };

  await ouvrirReglages();

  const listeDev = page.locator('[data-branche-dev] [data-liste-deroulante]');
  const listeProd = page.locator('[data-branche-production] [data-liste-deroulante]');
  await allerA('deploiement', { deplier: false });
  record(
    'la branche est rangée derrière « Réglages avancés », fermé par défaut',
    (await avances('deploiement').getAttribute('aria-expanded')) === 'false' && (await listeDev.count()) === 0,
  );
  await basculerAvances('deploiement', true);
  const vuDev = await listeDev.count();
  await allerA('production');
  const vuProd = await listeProd.count();
  record(
    'chaque étape a sa liste de branches, dans sa propre rubrique',
    vuDev === 1 && vuProd === 1,
    `déploiement : ${vuDev} · production : ${vuProd}`,
  );
  await allerA('deploiement');

  const options = (await optionsDeLaListe(listeDev)).map((o) => o.texte.trim());
  record(
    'la liste propose les branches du dépôt, « rien de choisi » en tête',
    options[0]?.includes('défaut') && BRANCHES.every((b) => options.includes(b)),
    options.join(' | '),
  );

  const choixDev = await valeurDeLaListe(listeDev);
  const mentionDev = (await page.locator('[data-branche-dev] p').first().textContent()) ?? '';
  await allerA('production');
  const choixProd = await valeurDeLaListe(listeProd);
  const mentionProd = (await page.locator('[data-branche-production] p').first().textContent()) ?? '';
  record('rien n’est choisi au départ, pour les deux étapes', choixDev === '' && choixProd === '');
  record(
    'la phrase dit que le déploiement ira sur « dev » tant que rien n’est choisi',
    /dev/.test(mentionDev),
    mentionDev.trim().slice(0, 110),
  );
  record(
    'et que la mise en production ira sur « main », la branche imposée',
    /main/.test(mentionProd),
    mentionProd.trim().slice(0, 110),
  );

  /* -------- Choisir, enregistrer, retrouver -------- */

  await choisirDansLaListe(listeProd, 'main');
  await allerA('deploiement');
  await choisirDansLaListe(listeDev, 'livraison');
  await page.waitForTimeout(200);
  const apresChoix = (await page.locator('[data-branche-dev] p').first().textContent()) ?? '';
  record(
    'la phrase suit le choix et nomme la branche visée',
    apresChoix.includes('livraison'),
    apresChoix.trim().slice(0, 110),
  );
  // Le schéma est imposé : une branche hors « dev » / « main » est SUIVIE, mais DITE.
  const ecart = (await page.locator('[data-branche-dev] [data-ecart-schema]').textContent()) ?? '';
  record(
    '« livraison » est signalée comme un écart à la règle des deux branches',
    /Écart à la règle/.test(ecart) && /« dev »/.test(ecart),
    ecart.trim().slice(0, 110),
  );
  /* UN AVERTISSEMENT NE SE RANGE PAS : le repli refermé, l'écart reste écrit
     juste dessous — une seule fois, jamais en double. */
  await basculerAvances('deploiement', false);
  const ecartReplie = page.locator('[data-rubrique-contenu="deploiement"] [data-ecart-schema]');
  record(
    'repli fermé, l’écart reste lisible sous « Réglages avancés »',
    (await listeDev.count()) === 0 &&
      (await ecartReplie.count()) === 1 &&
      (await ecartReplie.isVisible()) &&
      /Écart à la règle/.test((await ecartReplie.textContent()) ?? ''),
  );
  await basculerAvances('deploiement', true);
  record(
    'repli rouvert, la branche choisie est toujours là, et l’écart n’est écrit qu’une fois',
    (await valeurDeLaListe(listeDev)) === 'livraison' &&
      (await page.locator('[data-rubrique-contenu="deploiement"] [data-ecart-schema]').count()) === 1,
  );
  await allerA('production');
  record(
    'et « main » en production ne déclenche aucun avertissement',
    (await page.locator('[data-branche-production] [data-ecart-schema]').count()) === 0,
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
  await allerA('deploiement');
  const reluDev = await valeurDeLaListe(listeDev);
  await allerA('production');
  const reluProd = await valeurDeLaListe(listeProd);
  record(
    'rouvrir la configuration retrouve les branches choisies',
    reluDev === 'livraison' && reluProd === 'main',
    `${reluDev} / ${reluProd}`,
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
