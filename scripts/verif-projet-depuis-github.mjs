#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur sur le serveur de développement, du
 * TROISIÈME chemin de la fenêtre « Projets du serveur » : ajouter un projet
 * depuis GitHub.
 *
 *  - l'onglet « Depuis GitHub » existe, à côté de « Déjà sur le serveur » et
 *    « Nouveau projet » ;
 *  - il demande l'ADRESSE PUBLIQUE (sous-domaine + port) AVANT le montage, et
 *    ces deux valeurs partent avec la demande ;
 *  - les dépôts du compte connecté s'affichent et se cherchent ;
 *  - un dépôt choisi dans la liste part sous la forme « compte/depot » ;
 *  - un LIEN collé part de même, quelle que soit sa forme ;
 *  - un lien mal formé est refusé EN CLAIR, sans qu'aucune demande ne parte ;
 *  - le déroulé du montage s'affiche, et une étape en échec garde la fenêtre
 *    ouverte.
 *
 * Tout est SIMULÉ : les commandes `github.depots` et `project.fromGithub` sont
 * interceptées dans le navigateur et on répond à leur place — aucun dépôt
 * cloné, aucun dossier créé, aucun nom enregistré chez le fournisseur. Rien
 * n'est écrit en base à part la session d'essai, retirée en partant.
 *
 *   HAIKO_GITHUB_URL=http://localhost:7099 node scripts/verif-projet-depuis-github.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_GITHUB_URL || 'http://localhost:7099';
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
    'vérification projet depuis GitHub',
  );
  db.close();
  return { cookie, retirer: () => retirerSession(cookie) };
}

function retirerSession(cookie) {
  const db = base();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(crypto.createHash('sha256').update(cookie).digest('hex'));
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

  /*
   * Le banc d'essai : on retient `github.depots` et `project.fromGithub` au
   * lieu de les laisser partir, et on répond à la place du serveur. Aucun dépôt
   * n'est réellement récupéré.
   */
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
    const injecter = (evenement) => {
      const donnees = JSON.stringify(evenement);
      for (const ecouteur of window.__ecouteurs) ecouteur({ data: donnees });
    };

    window.__dernierAjout = null;
    window.__ajouts = 0;
    // Ce que le faux serveur renvoie : le montage tient debout ou une étape tombe.
    window.__montageTombe = false;

    const envoiOriginal = WebSocket.prototype.send;
    WebSocket.prototype.send = function (donnees) {
      let enveloppe = null;
      try {
        enveloppe = JSON.parse(donnees);
      } catch {
        /* pas du JSON : on laisse filer */
      }
      const cmd = enveloppe?.cmd;
      if (cmd?.type === 'github.depots') {
        injecter({
          id: enveloppe.id,
          type: 'ack',
          ok: true,
          data: {
            compte: 'haikostudio',
            depots: [
              {
                slug: 'haikostudio/site-vitrine',
                nom: 'site-vitrine',
                proprietaire: 'haikostudio',
                description: "Le site de l'atelier",
                prive: true,
              },
              {
                slug: 'haikostudio/api-compta',
                nom: 'api-compta',
                proprietaire: 'haikostudio',
                description: 'Facturation',
                prive: false,
              },
            ],
          },
        });
        return;
      }
      if (cmd?.type === 'project.fromGithub') {
        window.__dernierAjout = cmd;
        window.__ajouts += 1;
        const etapes = [
          { titre: 'Dépôt récupéré sur le serveur', fait: true, detail: `${cmd.lien} → /root/essai-github` },
        ];
        if (cmd.sousDomaine) {
          etapes.push(
            window.__montageTombe
              ? { titre: 'Adresse publique créée', fait: false, detail: 'le fournisseur a refusé (403)' }
              : {
                  titre: 'Adresse publique créée',
                  fait: true,
                  detail: `https://${cmd.sousDomaine}.haikostudio.cloud → port ${cmd.port}`,
                },
          );
        }
        etapes.push({ titre: 'Projet inscrit dans la colonne de gauche', fait: true });
        injecter({ id: enveloppe.id, type: 'ack', ok: true, data: { project: { id: 'essai-github' }, etapes } });
        return;
      }
      // Rien d'autre ne doit être détourné : le reste de l'application vit sa vie.
      return envoiOriginal.call(this, donnees);
    };
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  page.setDefaultTimeout(8000);

  const ouvrirGithub = async () => {
    await page.locator('[data-ouvrir-projets]').first().click({ force: true });
    await page.waitForTimeout(700);
    await page.getByRole('tab', { name: 'Depuis GitHub' }).click();
    await page.waitForTimeout(900);
  };

  await ouvrirGithub();

  /* -------- L'onglet et son adresse publique -------- */

  const bloc = page.locator('[data-adresse-depuis-github]');
  record("l'onglet « Depuis GitHub » existe et demande l'adresse publique", (await bloc.count()) === 1);
  record(
    'le champ du sous-domaine et celui du port sont là, avec la zone rappelée',
    (await page.locator('[data-sous-domaine-github]').count()) === 1 &&
      (await page.locator('[data-port-github]').count()) === 1 &&
      ((await bloc.textContent()) ?? '').includes('haikostudio.cloud'),
  );

  /* -------- Les dépôts du compte connecté -------- */

  record('les dépôts du compte connecté sont listés', (await page.locator('[data-depot-github]').count()) === 2);
  record(
    'le compte GitHub du serveur est nommé',
    ((await page.locator('[role="dialog"]').textContent()) ?? '').includes('haikostudio'),
  );

  await page.locator('[data-recherche-depot]').fill('compta');
  await page.waitForTimeout(400);
  record(
    'la recherche ne garde que les dépôts qui correspondent',
    (await page.locator('[data-depot-github]').count()) === 1 &&
      (await page.locator('[data-depot-github="haikostudio/api-compta"]').count()) === 1,
  );
  await page.locator('[data-recherche-depot]').fill('');
  await page.waitForTimeout(400);

  /* -------- Ajouter un dépôt CHOISI dans la liste -------- */

  await page.locator('[data-sous-domaine-github]').fill('essai-github');
  await page.locator('[data-port-github]').fill('4321');
  await page.evaluate(() => {
    window.__montageTombe = true;
  });
  await page
    .locator('[data-depot-github="haikostudio/site-vitrine"]')
    .getByRole('button', { name: 'Ajouter' })
    .click();
  await page.waitForTimeout(1500);

  const choisi = await page.evaluate(() => window.__dernierAjout);
  record(
    'le dépôt choisi part avec le sous-domaine et le port demandés',
    choisi?.lien === 'haikostudio/site-vitrine' && choisi?.sousDomaine === 'essai-github' && choisi?.port === 4321,
    JSON.stringify(choisi ?? {}),
  );

  const deroule = (await page.locator('[role="dialog"]').textContent()) ?? '';
  record(
    'le déroulé du montage se lit, étape par étape',
    deroule.includes('Dépôt récupéré sur le serveur') && deroule.includes('Projet inscrit dans la colonne de gauche'),
  );
  record(
    "une étape en échec garde la fenêtre ouverte et dit sa cause",
    deroule.includes('le fournisseur a refusé') && (await page.locator('[data-adresse-depuis-github]').count()) === 1,
  );

  /* -------- Un lien mal formé se refuse en clair, sans rien envoyer -------- */

  await page.evaluate(() => {
    window.__ajouts = 0;
    window.__montageTombe = false;
  });
  await page.locator('[data-lien-github]').fill('https://gitlab.com/moi/projet');
  await page.locator('[data-lien-github]').locator('xpath=following-sibling::button').first().click();
  await page.waitForTimeout(900);

  record(
    'un lien qui ne pointe pas vers GitHub ne fait partir aucune demande',
    (await page.evaluate(() => window.__ajouts)) === 0,
  );
  const refus = (await page.locator('body').textContent()) ?? '';
  record('le refus est dit en clair', refus.includes('ne pointe pas vers GitHub'), refus.slice(0, 0));

  /* -------- Un lien collé, sous sa forme complète -------- */

  await page.locator('[data-lien-github]').fill('https://github.com/quelquun/son-depot/tree/main');
  await page.locator('[data-lien-github]').locator('xpath=following-sibling::button').first().click();
  await page.waitForTimeout(1500);

  const colle = await page.evaluate(() => window.__dernierAjout);
  record(
    'un lien collé est ramené à « compte/depot » avant de partir',
    colle?.lien === 'quelquun/son-depot',
    JSON.stringify({ lien: colle?.lien }),
  );
  record(
    'un montage entièrement réussi referme la fenêtre',
    (await page.locator('[data-adresse-depuis-github]').count()) === 0,
  );

  record('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await browser.close();
  session.retirer();

  const rates = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés.`);
  process.exit(rates.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
