#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur, que l'application montre des
 * SILHOUETTES de contenu pendant son chargement — au lieu d'un écran vide qui
 * annonce « Aucun projet inscrit » et « Aucun projet sélectionné » avant même
 * d'avoir reçu quoi que ce soit.
 *
 * Trois moments, dans l'ordre où ils arrivent vraiment :
 *
 *  1. RIEN N'EST ENCORE ARRIVÉ du serveur : la colonne de gauche et la zone
 *     principale portent des silhouettes, et AUCUNE phrase d'écran vide.
 *  2. LA LISTE DES PROJETS EST LÀ, PAS ENCORE LES CARTES : la colonne de gauche
 *     montre ses vrais projets, le tableau garde ses silhouettes.
 *  3. TOUT EST ARRIVÉ : plus une seule silhouette, les vraies colonnes sont là.
 *
 * Rien n'est écrit ni modifié : on RETIENT simplement les messages du canal
 * temps réel dans la page, puis on les relâche. Seule une session d'essai d'une
 * heure est posée en base, retirée en partant.
 *
 *   HAIKODEV_VERIF_URL=http://localhost:7099 node scripts/verif-silhouettes-chargement.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/* La racine se déduit du script : lancé depuis une copie de travail, il juge CE
   code-là, jamais celui du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7099';
/* La base et ses dépendances natives vivent dans le dépôt PRINCIPAL. */
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';
const PRINCIPAL = path.resolve(DONNEES, '..');

function base() {
  const require = createRequire(import.meta.url);
  return require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(
    path.join(DONNEES, 'haikodev.db'),
  );
}

function poserSession() {
  const db = base();
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification silhouettes de chargement',
  );
  db.close();
  return cookie;
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
  console.log(`Adresse visée : ${BASE}`);
  const cookie = poserSession();
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
      value: cookie,
      url: new URL(BASE).origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const page = await context.newPage();

  /*
   * LE ROBINET. On se greffe sur le canal temps réel AVANT le premier script de
   * la page : chaque message reçu est mis de côté tant que son type est
   * « retenu ». `__relacher(filtre)` change le filtre puis rejoue tout ce qui
   * attendait et qui n'est plus retenu — l'ordre d'arrivée est préservé.
   */
  await page.addInitScript(() => {
    window.__retenus = ['*'];
    window.__file = [];
    const retenu = (type) => window.__retenus.includes('*') || window.__retenus.includes(type);
    const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get() {
        return propriete.get.call(this);
      },
      set(ecouteur) {
        /* Seul le canal de l'application est retenu. Le serveur de
           développement en ouvre un autre pour son rechargement à chaud : le
           retenir bloquerait la page pour rien, et son écouteur n'est pas
           celui de l'application. */
        if (!String(this.url ?? '').endsWith('/ws')) return propriete.set.call(this, ecouteur);
        return propriete.set.call(this, (evenement) => {
          let type = '';
          try {
            type = JSON.parse(evenement.data).type ?? '';
          } catch {
            type = '';
          }
          if (retenu(type)) window.__file.push({ ecouteur, donnees: evenement.data });
          else ecouteur(evenement);
        });
      },
    });
    window.__relacher = (retenus) => {
      window.__retenus = retenus;
      const attente = window.__file;
      window.__file = [];
      for (const entree of attente) {
        let type = '';
        try {
          type = JSON.parse(entree.donnees).type ?? '';
        } catch {
          type = '';
        }
        if (retenu(type)) window.__file.push(entree);
        else entree.ecouteur({ data: entree.donnees });
      }
      return window.__file.length;
    };
  });

  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && erreurs.push(message.text()));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  page.setDefaultTimeout(8000);

  const compter = (zone) => page.locator(`[data-silhouette="${zone}"]`).count();
  const texteVisible = (texte) => page.getByText(texte, { exact: false }).count();

  /* --- 1. Rien n'est encore arrivé ------------------------------------ */

  record('silhouettes des projets pendant le chargement', (await compter('projets')) > 0);
  record('silhouette du tableau pendant le chargement', (await compter('tableau')) > 0);
  record(
    'aucun « Aucun projet inscrit » pendant le chargement',
    (await texteVisible('Aucun projet inscrit')) === 0,
  );
  record(
    'aucun « Aucun projet sélectionné » pendant le chargement',
    (await texteVisible('Aucun projet sélectionné')) === 0,
  );
  record(
    'l\'attente est annoncée aux lecteurs d\'écran',
    (await page.locator('[data-silhouette][aria-busy="true"]').count()) > 0,
  );

  /* --- 2. Les projets sont là, pas encore les cartes ------------------- */

  await page.evaluate(() => window.__relacher(['project.snapshot']));
  await page.waitForTimeout(1200);

  const projets = await page.locator('[data-drag-kind="project"]').count();
  record('les projets réels remplacent leurs silhouettes', projets > 0 && (await compter('projets')) === 0, `${projets} projet(s)`);
  record('le tableau garde ses silhouettes tant que ses cartes manquent', (await compter('tableau')) > 0);
  record('aucune colonne réelle n\'est encore posée', (await page.locator('[data-column]').count()) === 0);

  /* --- 3. Tout est arrivé --------------------------------------------- */

  await page.evaluate(() => window.__relacher([]));
  await page.waitForTimeout(1500);

  const colonnes = await page.locator('[data-column]').count();
  record('les vraies colonnes sont posées', colonnes >= 7, `${colonnes} colonne(s)`);

  /* Le fil d'une carte arrive par un aller-retour de plus (`card.open`
     puis `agent.open`) : on lui laisse le temps avant de juger. */
  await page
    .locator('[data-silhouette]')
    .first()
    .waitFor({ state: 'detached', timeout: 15000 })
    .catch(() => undefined);
  const restantes = await page.locator('[data-silhouette]').evaluateAll((noeuds) =>
    noeuds.map((n) => n.getAttribute('data-silhouette')),
  );
  record('plus aucune silhouette une fois tout arrivé', restantes.length === 0, restantes.join(', '));

  record('aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await browser.close();
  retirerSession(cookie);

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  if (echecs.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
