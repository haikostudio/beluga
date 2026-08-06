#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur sur le serveur de développement, des
 * environnements de publication d'un projet :
 *
 *  - le volet de réglages liste les environnements du projet, un projet réglé à
 *    l'ancienne en montrant UN seul, « Interne », avec sa commande et son adresse ;
 *  - « Ajouter un environnement » en pose un de plus, qui se renomme et se range ;
 *  - le dernier environnement ne se retire pas ;
 *  - une fois enregistré, le nouvel environnement APPARAÎT dans le bloc de
 *    publication : menu de choix, état de chacun, nom sur le bouton ;
 *  - viser un environnement sans aucun moyen d'agir éteint le bouton et le
 *    refus NOMME cet environnement.
 *
 * Tout est SIMULÉ : `project.update` et `deploy.check` sont interceptés dans le
 * navigateur, on répond à leur place et la commande ne part JAMAIS au serveur.
 * Aucun projet réel n'est modifié ; rien n'est écrit en base à part la session
 * d'essai, retirée en partant.
 *
 *   HAIKO_ENVS_URL=http://localhost:7099 node scripts/verif-environnements-publication.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_ENVS_URL || 'http://localhost:7099';
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';
const PRINCIPAL = path.resolve(DONNEES, '..');

function base(cookie) {
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
    'vérification environnements de publication',
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
   * Le banc d'essai. On se place des deux côtés du canal :
   *  - en ENTRÉE, on garde les écouteurs pour pouvoir injecter des événements ;
   *  - en SORTIE, on intercepte `project.update` et `deploy.check`, auxquels on
   *    répond à la place du serveur — la commande ne part jamais.
   * Le projet du volet de réglages est donc modifié pour de faux : aucun projet
   * réel ne bouge.
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
    window.__injecter = (evenement) => {
      const donnees = JSON.stringify(evenement);
      for (const ecouteur of window.__ecouteurs) ecouteur({ data: donnees });
    };

    // L'état simulé du projet : ses environnements et ce qu'ils ont donné.
    window.__essaiEnvs = {
      projet: null,
      environnements: null,
      derniers: {},
      dernierVise: null,
      enregistrements: 0,
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
      const essai = window.__essaiEnvs;

      if (cmd?.type === 'project.update' && cmd.patch?.environments) {
        // On enregistre à la place du serveur, puis on renvoie le projet
        // modifié comme il le ferait : la boucle complète, sans écriture.
        essai.environnements = cmd.patch.environments;
        essai.enregistrements += 1;
        const projet = { ...(essai.projet ?? {}), ...cmd.patch, id: cmd.id };
        essai.projet = projet;
        window.__injecter({ id: enveloppe.id, type: 'ack', ok: true, data: { project: projet } });
        window.__injecter({ type: 'project.upsert', project: projet });
        return;
      }

      if (cmd?.type === 'deploy.check') {
        essai.dernierVise = cmd.environmentId ?? null;
        const liste = essai.environnements ?? [];
        const vise = liste.find((env) => env.id === cmd.environmentId) ?? liste[0];
        // Un environnement sans commande n'a, dans ce banc d'essai, aucun moyen
        // d'agir : c'est exactement le refus qu'on veut voir s'afficher.
        const possible = !!vise?.commande;
        window.__injecter({
          id: enveloppe.id,
          type: 'ack',
          ok: true,
          data: {
            /*
             * L'ÉTAPE de la colonne qui interroge. Le bloc de publication ne
             * s'affiche PLUS sans elle (règle des deux étapes) : une réponse
             * simulée qui l'oublie laisse la colonne nue. Ce banc d'essai ne
             * déclare aucun environnement de dev, donc UNE seule étape.
             */
            etape:
              (cmd.source ?? 'to_deploy') === 'to_deploy'
                ? {
                    cible: 'production',
                    libelle: 'Mise en production',
                    verbe: 'déployer',
                    source: 'to_deploy',
                    arrivee: 'archived',
                    clot: true,
                  }
                : null,
            conflicts: [],
            busy: [],
            enAttente: { nombre: 2, titres: ['Essai A', 'Essai B'] },
            environnements: liste,
            derniers: essai.derniers,
            miseEnLigne: possible
              ? {
                  possible: true,
                  construction: 'commande',
                  installation: 'commande',
                  redemarrage: 'commande',
                  raison: 'La commande de publication du projet porte la mise en ligne de bout en bout.',
                  environnement: vise?.nom,
                }
              : {
                  possible: false,
                  construction: 'aucune',
                  installation: 'aucune',
                  redemarrage: 'aucun',
                  raison: `L’environnement « ${vise?.nom ?? '?'} » n’a aucun moyen d’être mis en ligne : pas de commande de publication, aucun service système sur le dossier du projet, et ce dossier n’est servi par aucun serveur web.`,
                  environnement: vise?.nom,
                },
          },
        });
        return;
      }

      return envoiOriginal.call(this, donnees);
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

  /*
   * Le projet d'essai : un projet réglé à l'ANCIEN format, sans liste
   * d'environnements. C'est le cas de tous les projets d'aujourd'hui, et celui
   * qui doit continuer de se comporter exactement comme avant.
   */
  await page.evaluate((id) => {
    const projet = {
      id,
      name: 'Essai environnements',
      path: '/root/essai-environnements',
      defaultEngine: 'claude',
      isSelf: false,
      deployCommand: 'bash publier-interne.sh',
      deployUrl: 'https://interne.example',
      rank: 1,
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    window.__essaiEnvs.projet = projet;
    window.__essaiEnvs.environnements = [
      { id: 'interne', nom: 'Interne', role: 'interne', commande: 'bash publier-interne.sh', url: 'https://interne.example' },
    ];
    window.__essaiEnvs.derniers = { interne: { environmentId: 'interne', state: 'success', startedAt: Date.now() - 60000 } };
    window.__injecter({ type: 'project.upsert', project: projet });
  }, projectId);
  await page.waitForTimeout(700);

  /* -------- Le volet de réglages -------- */

  await page.locator('button[title="Réglages du projet"]').first().click({ force: true });
  await page.waitForTimeout(900);

  const bloc = page.locator('[data-environnements]');
  record('le volet de réglages porte le bloc des environnements', (await bloc.count()) === 1);

  const lignes = () => page.locator('[data-environnement]');
  record(
    'un projet réglé à l’ancienne montre UN environnement, « Interne »',
    (await lignes().count()) === 1 &&
      (await lignes().first().locator('[data-nom-environnement]').inputValue()) === 'Interne',
  );
  record(
    'cet environnement porte la commande et l’adresse du projet',
    (await lignes().first().locator('[data-commande-environnement]').inputValue()) === 'bash publier-interne.sh' &&
      (await lignes().first().locator('[data-url-environnement]').inputValue()) === 'https://interne.example',
  );
  record(
    'le dernier environnement ne se retire pas',
    await lignes().first().locator('button[aria-label="Retirer cet environnement"]').isDisabled(),
  );

  await page.locator('[data-ajouter-environnement]').click();
  await page.waitForTimeout(400);
  record('« Ajouter un environnement » en pose un de plus', (await lignes().count()) === 2);

  const seconde = lignes().nth(1);
  await seconde.locator('[data-nom-environnement]').fill('Production client');
  await seconde.locator('select').selectOption('production');
  await seconde.locator('[data-url-environnement]').fill('https://client.example');
  await page.waitForTimeout(300);
  record(
    'le nouvel environnement se renomme et prend son rôle',
    (await seconde.locator('[data-nom-environnement]').inputValue()) === 'Production client' &&
      (await seconde.locator('select').inputValue()) === 'production',
  );
  record(
    'une fois deux environnements, le retrait redevient possible',
    !(await seconde.locator('button[aria-label="Retirer cet environnement"]').isDisabled()),
  );

  // Ranger : le second monte, il devient celui que « Tout déployer » vise.
  await seconde.locator('button[aria-label="Monter cet environnement"]').click();
  await page.waitForTimeout(300);
  const ordre = await page.locator('[data-nom-environnement]').evaluateAll((champs) =>
    champs.map((champ) => champ.value),
  );
  record('monter un environnement le fait passer en tête', ordre[0] === 'Production client', ordre.join(' | '));

  // On le redescend : l'environnement par défaut reste « Interne », qui a une
  // commande — sinon le bouton s'éteindrait pour une autre raison que celle
  // qu'on veut observer ensuite.
  await page.locator('[data-environnement]').first().locator('button[aria-label="Descendre cet environnement"]').click();
  await page.waitForTimeout(300);

  await page.locator('button:has-text("Enregistrer")').first().click();
  await page.waitForTimeout(1200);
  const enregistres = await page.evaluate(() => window.__essaiEnvs.environnements);
  record(
    'l’enregistrement envoie les DEUX environnements, dans l’ordre',
    Array.isArray(enregistres) && enregistres.length === 2 && enregistres[0].nom === 'Interne',
    (enregistres ?? []).map((env) => env.nom).join(' | '),
  );

  /* -------- Le bloc de publication -------- */

  await page.waitForTimeout(2500);
  // Le bloc de publication vit en tête de la colonne « À déployer » : le rail du
  // tableau glisse, il faut donc l'amener sous les yeux avant de le juger.
  const menu = page.locator('[data-environnement-vise]');
  await menu.first().scrollIntoViewIfNeeded().catch(() => undefined);
  await page.waitForTimeout(500);
  record('le bloc de publication montre le menu des environnements', (await menu.count()) === 1);

  const options = await menu.locator('option').allTextContents();
  record(
    'le nouvel environnement APPARAÎT dans le bloc de publication',
    options.some((texte) => texte.includes('Production client')),
    options.join(' | '),
  );

  const etats = await page.locator('[data-etats-environnements] li').allTextContents();
  record(
    'chaque environnement dit où il en est',
    etats.length === 2 &&
      etats.some((t) => t.includes('réussie')) &&
      etats.some((t) => t.includes('jamais publié')),
    etats.join(' | '),
  );

  /*
   * Le bouton du BLOC de publication, jamais celui du pied de colonne
   * « Terminé » qui porte le même libellé : on vise `[data-bouton-publication]`
   * dans le bloc de « À déployer ».
   */
  const bouton = page.locator('[data-bloc-publication="to_deploy"] [data-bouton-publication]').first();
  record(
    'le bouton nomme l’environnement visé',
    (await bouton.textContent())?.includes('Interne') === true,
    (await bouton.textContent()) ?? '',
  );

  // Viser la production, qui n'a AUCUN moyen d'agir : bouton éteint, refus nommé.
  await menu.selectOption({ label: 'Production client — production' });
  await page.waitForTimeout(1500);
  record(
    'viser un environnement sans moyen éteint le bouton',
    await bouton.isDisabled(),
  );
  const avertissement = await page.locator('.text-warning').allTextContents();
  record(
    'le refus NOMME l’environnement visé',
    avertissement.some((texte) => texte.includes('Production client')),
    avertissement.join(' | ').slice(0, 160),
  );
  record(
    'le choix part bien au serveur avec l’environnement visé',
    (await page.evaluate(() => window.__essaiEnvs.dernierVise)) !== null,
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
