#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur sur le serveur de développement, que
 * l'ADRESSE PUBLIQUE se demande AU MONTAGE du projet :
 *
 *  - l'onglet « Nouveau projet » porte le champ du sous-domaine, la zone
 *    rappelée à côté, et le champ du port ;
 *  - créer un projet emporte ces deux valeurs dans la commande `project.new` ;
 *  - le déroulé affiche l'étape d'adresse comme les autres, et une étape
 *    d'adresse en ÉCHEC n'empêche pas les suivantes de s'afficher ;
 *  - les champs laissés vides ne font partir NI sous-domaine NI port ;
 *  - les réglages du projet gardent « Adresse à contrôler » mais n'ont PLUS le
 *    créateur manuel de sous-domaine.
 *
 * Tout est SIMULÉ : la commande `project.new` est interceptée dans le
 * navigateur et on répond à sa place — aucun dossier créé, aucun dépôt GitHub,
 * aucun nom enregistré chez le fournisseur. Rien n'est écrit en base à part la
 * session d'essai, retirée en partant.
 *
 *   HAIKO_ADRESSE_URL=http://localhost:7099 node scripts/verif-adresse-nouveau-projet.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_ADRESSE_URL || 'http://localhost:7099';
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
    'vérification adresse nouveau projet',
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
   * Le banc d'essai : on retient la commande `project.new` au lieu de la
   * laisser partir, et on répond à la place du serveur avec un déroulé
   * d'étapes fabriqué — dont l'étape d'adresse, réussie ou en échec selon ce
   * que le contrôle veut voir. Aucun projet réel n'est monté.
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

    window.__dernierNouveau = null;
    // Ce que le faux serveur renvoie : l'étape d'adresse tient debout ou tombe.
    window.__adresseTombe = false;
    // Une AUTRE étape qui tombe : la fenêtre reste ouverte, donc son déroulé se lit.
    window.__githubTombe = false;

    const envoiOriginal = WebSocket.prototype.send;
    WebSocket.prototype.send = function (donnees) {
      let enveloppe = null;
      try {
        enveloppe = JSON.parse(donnees);
      } catch {
        /* pas du JSON : on laisse filer */
      }
      const cmd = enveloppe?.cmd;
      if (cmd?.type === 'project.new') {
        window.__dernierNouveau = cmd;
        const etapes = [
          { titre: 'Dossier créé sur le serveur', fait: true, detail: '/root/essai-adresse' },
          { titre: 'Fichiers de départ écrits', fait: true },
          { titre: 'Dépôt git démarré sur la branche « main »', fait: true },
        ];
        if (window.__githubTombe) {
          etapes.push({ titre: 'Dépôt GitHub créé et poussé', fait: false, detail: 'gh a refusé' });
        }
        if (cmd.sousDomaine) {
          etapes.push(
            window.__adresseTombe
              ? { titre: 'Adresse publique créée', fait: false, detail: 'le fournisseur a refusé (403)' }
              : {
                  titre: 'Adresse publique créée',
                  fait: true,
                  detail: `https://${cmd.sousDomaine}.haikostudio.cloud → port ${cmd.port}`,
                },
          );
        }
        etapes.push({ titre: 'Projet inscrit dans la colonne de gauche', fait: true });
        injecter({
          id: enveloppe.id,
          type: 'ack',
          ok: true,
          data: { project: { id: 'essai-adresse' }, etapes },
        });
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

  /* -------- L'onglet « Nouveau projet » -------- */

  const ouvrirNouveau = async () => {
    await page.locator('[data-ouvrir-projets]').first().click({ force: true });
    await page.waitForTimeout(700);
    await page.getByRole('tab', { name: 'Nouveau projet' }).click();
    await page.waitForTimeout(500);
  };

  await ouvrirNouveau();

  const bloc = page.locator('[data-adresse-nouveau-projet]');
  record("l'onglet « Nouveau projet » demande l'adresse publique", (await bloc.count()) === 1);
  record(
    'le champ du sous-domaine et celui du port sont là, avec la zone rappelée',
    (await page.locator('[data-sous-domaine]').count()) === 1 &&
      (await page.locator('[data-port-projet]').count()) === 1 &&
      ((await bloc.textContent()) ?? '').includes('haikostudio.cloud'),
  );

  /* -------- Créer AVEC une adresse -------- */

  await page.getByPlaceholder('Mon nouveau site').fill('Essai adresse');
  await page.locator('[data-sous-domaine]').fill('essai-adresse');
  await page.locator('[data-port-projet]').fill('3210');
  await page.getByRole('button', { name: 'Créer le projet' }).click();
  await page.waitForTimeout(1500);

  const envoye = await page.evaluate(() => window.__dernierNouveau);
  record(
    'le sous-domaine et le port partent avec la demande de création',
    envoye?.sousDomaine === 'essai-adresse' && envoye?.port === 3210,
    JSON.stringify({ sousDomaine: envoye?.sousDomaine, port: envoye?.port }),
  );

  // Tout est passé : la fenêtre se referme d'elle-même, comme avant.
  record(
    'un montage entièrement réussi referme la fenêtre',
    (await page.locator('[data-adresse-nouveau-projet]').count()) === 0,
  );

  /*
   * L'étape d'adresse RÉUSSIE, lue dans le déroulé. Il faut pour cela qu'une
   * AUTRE étape tombe, sinon la fenêtre se referme avant qu'on puisse la lire —
   * c'est justement ce que le contrôle précédent vient de constater.
   */
  await ouvrirNouveau();
  await page.evaluate(() => {
    window.__githubTombe = true;
  });
  await page.getByPlaceholder('Mon nouveau site').fill('Essai adresse lue');
  await page.locator('[data-sous-domaine]').fill('essai-adresse');
  await page.locator('[data-port-projet]').fill('3210');
  await page.getByRole('button', { name: 'Créer le projet' }).click();
  await page.waitForTimeout(1500);

  const deroule = (await page.locator('[role="dialog"]').textContent()) ?? '';
  record(
    "le déroulé nomme l'étape d'adresse comme les autres",
    deroule.includes('Adresse publique créée') && deroule.includes('essai-adresse.haikostudio.cloud'),
  );

  /* -------- Une adresse en échec n'arrête pas les autres étapes -------- */

  await page.evaluate(() => {
    window.__adresseTombe = true;
    window.__githubTombe = false;
  });
  await page.getByPlaceholder('Mon nouveau site').fill('Essai adresse tombée');
  await page.locator('[data-sous-domaine]').fill('essai-tombe');
  await page.locator('[data-port-projet]').fill('3211');
  await page.getByRole('button', { name: 'Créer le projet' }).click();
  await page.waitForTimeout(1500);

  const derouleEchec = (await page.locator('[role="dialog"]').textContent()) ?? '';
  record(
    "une adresse refusée se dit dans le déroulé, et les étapes suivantes s'affichent quand même",
    derouleEchec.includes('le fournisseur a refusé') &&
      derouleEchec.includes('Projet inscrit dans la colonne de gauche'),
  );
  record(
    'la fenêtre reste ouverte tant qu’une étape a échoué',
    (await page.locator('[data-adresse-nouveau-projet]').count()) === 1,
  );

  /* -------- Créer SANS adresse reste possible -------- */

  await page.evaluate(() => {
    window.__adresseTombe = false;
    window.__dernierNouveau = null;
  });
  await page.getByPlaceholder('Mon nouveau site').fill('Essai sans adresse');
  await page.locator('[data-sous-domaine]').fill('');
  await page.locator('[data-port-projet]').fill('');
  await page.getByRole('button', { name: 'Créer le projet' }).click();
  await page.waitForTimeout(1500);

  const sansAdresse = await page.evaluate(() => window.__dernierNouveau);
  record(
    'sans rien saisir, ni sous-domaine ni port ne partent',
    sansAdresse?.sousDomaine === undefined && sansAdresse?.port === undefined,
    JSON.stringify({ sousDomaine: sansAdresse?.sousDomaine, port: sansAdresse?.port }),
  );

  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  /* -------- Les réglages du projet -------- */

  const projectId = await page.evaluate(
    () => document.querySelector('[data-drag-kind="project"]')?.getAttribute('data-drag-id') ?? null,
  );
  if (projectId) {
    await page.locator(`[data-reglages-projet="${projectId}"]`).first().click({ force: true });
    await page.waitForTimeout(900);
    const deploiement = (await page.locator('[data-deploiement]').textContent()) ?? '';
    record(
      "les réglages gardent l'adresse à contrôler",
      (await page.locator('[data-url-dev]').count()) === 1 && deploiement.includes('Adresse à contrôler'),
    );
    record(
      'le créateur manuel de sous-domaine a quitté les réglages',
      !deploiement.includes('nom-du-site') && !/Pas encore d'adresse/.test(deploiement),
      deploiement.trim().slice(0, 90),
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  } else {
    record('un projet est ouvert pour juger ses réglages', false, 'aucun projet dans la colonne de gauche');
  }

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
