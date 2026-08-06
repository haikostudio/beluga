#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur sur le serveur de développement, du
 * réglage du déroulé de déploiement depuis le menu des colonnes :
 *
 *  - le bouton trois points est présent sur « À déployer » et « En production »
 *    MÊME sans aucune carte non lue, et absent ailleurs dans ce cas ;
 *  - l'entrée « Configurer le déploiement » ouvre la fenêtre, qui rappelle en
 *    une ligne l'environnement visé et la branche installée ;
 *  - on saisit une BASE de texte, on clique « Générer », un état d'attente
 *    s'affiche puis la consigne rédigée apparaît dans un champ modifiable ;
 *  - base ET consigne enregistrées SURVIVENT au rechargement de la page ;
 *  - la consigne de « À déployer » n'est PAS celle de « En production ».
 *
 * Tout est SIMULÉ : `project.update` ET `consigne.generer` sont interceptés dans
 * le navigateur, on répond à leur place — aucun vrai agent, aucun quota dépensé,
 * la commande ne part JAMAIS au serveur. La persistance
 * est imitée par le stockage local de la page — c'est ce qui permet de juger un
 * VRAI rechargement sans écrire dans aucun projet réel. Rien n'est écrit en
 * base à part la session d'essai, retirée en partant.
 *
 *   HAIKO_CONSIGNE_URL=http://localhost:7099 node scripts/verif-consigne-deploiement.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_CONSIGNE_URL || 'http://localhost:7099';
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
    'vérification consigne de déploiement',
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

// Ce qu'on TAPE : la base brute de chaque étape.
const BASE_DEV = 'Dev : construire, copier le dossier, contrôler l’adresse. Ne pas toucher au service.';
const BASE_PROD = 'Production : arrêter le service, installer, redémarrer, contrôler. Jamais de force.';
// Ce que l'agent factice RÉDIGE — même formule que `window.__consigneFactice`.
const genereAttendu = (colonne, base) => `Consigne générée pour ${colonne} :: ${base}`;
const CONSIGNE_DEV = genereAttendu('to_deploy', BASE_DEV);
const CONSIGNE_PROD = genereAttendu('in_production', BASE_PROD);

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
   *  - en SORTIE, on intercepte `project.update` et on répond à la place du
   *    serveur, en rangeant le patch dans le stockage local de la page.
   * Le stockage local tient lieu de base : c'est lui qui fait qu'un
   * rechargement retrouve la consigne, sans qu'aucun projet réel ne bouge.
   */
  await page.addInitScript(() => {
    const CLE = '__essaiConsigne';
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
         * Le démon RÉEL continue de pousser SON projet (environnements vides,
         * aucune consigne) sous le même identifiant : sans garde, il écraserait
         * notre projet d'essai. Deux chemins l'apportent — l'événement `ready`
         * qui porte TOUTE la liste (`projects`) et le `project.upsert` d'un seul.
         * On REMPLACE notre projet dans les deux, par celui qu'on fabrique
         * (base et consigne rangées comprises), sans toucher aux autres projets
         * ni aux autres événements.
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
    window.__consignesRangees = () => lireRange().consignesDeploiement ?? null;
    window.__basesRangees = () => lireRange().basesDeploiement ?? null;

    // La consigne que « génère » l'agent factice : déterministe à partir de la
    // colonne et de la base, pour qu'un contrôle sache exactement quoi attendre.
    // AUCUN vrai agent n'est lancé, aucun quota touché.
    window.__consigneFactice = (colonne, base) => `Consigne générée pour ${colonne} :: ${base}`;
    // Délai de la réponse de génération, pour rendre l'état d'attente OBSERVABLE.
    window.__genererDelai = 500;

    // Le projet d'essai : on part du projet réel ouvert, dont on ne garde que
    // l'identifiant, et on lui pose des réglages de publication à nous. La base
    // et la consigne rangées (stockage local) le suivent à chaque fabrication.
    window.__construireProjet = (id) => {
      const projet = {
        id,
        name: 'Essai consigne',
        path: '/root/essai-consigne',
        defaultEngine: 'claude',
        isSelf: false,
        rank: 1,
        archived: false,
        environments: [
          { id: 'interne', nom: 'Interne', role: 'interne', commande: 'bash publier.sh', branche: 'main' },
        ],
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
      if (cmd?.type === 'consigne.generer') {
        // On répond à la place du serveur, APRÈS un délai, avec une consigne
        // factice : jamais un vrai tour d'agent, jamais de quota dépensé.
        const consigne = window.__consigneFactice(cmd.colonne, cmd.base);
        setTimeout(() => {
          window.__injecter({ id: enveloppe.id, type: 'ack', ok: true, data: { ok: true, consigne } });
        }, window.__genererDelai);
        return;
      }
      if (cmd?.type === 'project.update' && cmd.patch?.consignesDeploiement) {
        const range = lireRange();
        const projet = { ...range, ...cmd.patch, id: cmd.id };
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
  await page.evaluate(() => localStorage.removeItem('__essaiConsigne'));

  const projectId = await ouvrir();
  record('un projet est ouvert', !!projectId, projectId);

  /* -------- Le bouton trois points -------- */

  const amener = async (colonne) => {
    const tete = page.locator(`[data-column="${colonne}"]`).first();
    await tete.scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(400);
    return tete;
  };

  const nonLues = async (colonne) => {
    await amener(colonne);
    return page.evaluate(
      (cle) => document.querySelectorAll(`[data-column="${cle}"] [data-carte-non-lue]`).length,
      colonne,
    );
  };

  /*
   * Le cœur de la carte : SANS carte non lue, le menu existe-t-il encore ? On
   * ne le suppose pas — on ouvre et on regarde ce qu'il porte. Zéro carte non
   * lue et une seule entrée, celle du déploiement : le bouton ne dépend donc
   * plus de ce qui traîne dans la colonne. Les cartes du projet ouvert sont
   * RÉELLES : si les deux colonnes en portent des non lues, on ne conclut pas,
   * on le dit.
   */
  let jugeSansNonLue = null;
  for (const colonne of ['to_deploy', 'in_production']) {
    const compte = await nonLues(colonne);
    record(
      `le menu trois points est présent sur « ${colonne} »`,
      (await page.locator(`[data-menu-colonne="${colonne}"]`).count()) === 1,
      `cartes non lues : ${compte}`,
    );
    if (compte === 0 && !jugeSansNonLue) {
      await page.locator(`[data-menu-colonne="${colonne}"]`).click();
      await page.waitForTimeout(500);
      const entrees = (await page.locator('[role="menuitem"]').allTextContents()).join(' | ');
      jugeSansNonLue = { colonne, entrees };
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
  }
  record(
    'sans aucune carte non lue, la colonne garde son menu et n’y montre que le déploiement',
    !!jugeSansNonLue &&
      jugeSansNonLue.entrees.includes('Configurer le déploiement') &&
      !jugeSansNonLue.entrees.includes('Marquer tout comme lu'),
    jugeSansNonLue
      ? `${jugeSansNonLue.colonne} → ${jugeSansNonLue.entrees.slice(0, 100)}`
      : 'non jugeable : les deux colonnes de publication portent des cartes non lues',
  );

  /*
   * Ailleurs, la règle d'avant ne bouge pas : le menu n'apparaît QUE s'il y a
   * des cartes non lues à marquer. On ne compare donc pas à zéro menu, mais à
   * ce que chaque colonne porte réellement — le tableau est celui d'un vrai
   * projet, où « Terminé » a souvent du non-lu.
   */
  const ailleurs = await page.evaluate(() =>
    ['notes', 'todo', 'validated', 'planned', 'running', 'done', 'archived'].map((cle) => ({
      cle,
      menu: !!document.querySelector(`[data-menu-colonne="${cle}"]`),
      nonLues: document.querySelectorAll(`[data-column="${cle}"] [data-carte-non-lue]`).length,
    })),
  );
  const contredit = ailleurs.filter((col) => col.menu !== col.nonLues > 0);
  record(
    'ailleurs, le menu ne s’affiche que s’il y a des cartes non lues',
    contredit.length === 0,
    ailleurs.map((c) => `${c.cle}:${c.menu ? 'menu' : '—'}/${c.nonLues}`).join(' '),
  );

  /* -------- Saisir une base, générer, enregistrer -------- */

  // Ouvre la fenêtre d'une colonne, saisit la base, clique Générer, attend la
  // consigne rédigée, puis enregistre. Rend l'état d'attente saisi au vol.
  const ouvrirFenetre = async (colonne) => {
    await amener(colonne);
    await page.locator(`[data-menu-colonne="${colonne}"]`).click();
    await page.waitForTimeout(500);
    await page.locator(`[data-configurer-deploiement="${colonne}"]`).click();
    await page.waitForTimeout(700);
  };

  const genererEtEnregistrer = async (colonne, base) => {
    await ouvrirFenetre(colonne);
    await page.locator('[data-consigne-base]').fill(base);
    await page.waitForTimeout(150);
    await page.locator('[data-generer-consigne]').click();
    // L'état d'attente est bref (délai factice) : on l'attrape tout de suite.
    const enAttente = (await page.locator('[data-generer-consigne]').textContent()) ?? '';
    // Puis la consigne rédigée arrive dans le champ modifiable.
    await page
      .waitForFunction(
        (attendu) => document.querySelector('[data-consigne-deploiement]')?.value === attendu,
        genereAttendu(colonne, base),
        { timeout: 8000 },
      )
      .catch(() => undefined);
    const consigneAffichee = await page.locator('[data-consigne-deploiement]').inputValue();
    await page.locator('[data-enregistrer-consigne]').click();
    await page.waitForTimeout(1200);
    return { enAttente, consigneAffichee };
  };

  await ouvrirFenetre('to_deploy');

  record(
    'la fenêtre s’ouvre et nomme l’étape réglée',
    (await page.locator('[data-fenetre-consigne="to_deploy"]').count()) === 1 &&
      (await page.locator('[data-fenetre-consigne="to_deploy"]').textContent())?.includes('À déployer') === true,
  );
  const rappel = (await page.locator('[data-rappel-consigne]').textContent()) ?? '';
  record(
    'la fenêtre rappelle l’environnement visé et la branche installée',
    rappel.includes('Interne') && rappel.includes('main'),
    rappel.trim().slice(0, 120),
  );
  record(
    'la base ET la consigne partent VIDES quand rien n’a été réglé',
    (await page.locator('[data-consigne-base]').inputValue()) === '' &&
      (await page.locator('[data-consigne-deploiement]').inputValue()) === '',
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  const devFait = await genererEtEnregistrer('to_deploy', BASE_DEV);
  record(
    'cliquer Générer montre un état d’attente',
    /Génération/i.test(devFait.enAttente),
    devFait.enAttente.trim().slice(0, 40),
  );
  record(
    'la consigne rédigée apparaît dans le champ modifiable',
    devFait.consigneAffichee === CONSIGNE_DEV,
    devFait.consigneAffichee.slice(0, 80),
  );

  const range1Base = await page.evaluate(() => window.__basesRangees());
  const range1 = await page.evaluate(() => window.__consignesRangees());
  record(
    'l’enregistrement range la BASE et la CONSIGNE de « À déployer »',
    range1Base?.to_deploy === BASE_DEV && range1?.to_deploy === CONSIGNE_DEV,
    `${JSON.stringify(range1Base ?? {}).slice(0, 80)} | ${JSON.stringify(range1 ?? {}).slice(0, 80)}`,
  );

  await genererEtEnregistrer('in_production', BASE_PROD);
  const range2Base = await page.evaluate(() => window.__basesRangees());
  const range2 = await page.evaluate(() => window.__consignesRangees());
  record(
    'les DEUX étapes coexistent, base et consigne chacune la sienne',
    range2Base?.to_deploy === BASE_DEV &&
      range2Base?.in_production === BASE_PROD &&
      range2?.to_deploy === CONSIGNE_DEV &&
      range2?.in_production === CONSIGNE_PROD,
    `${JSON.stringify(range2Base ?? {}).slice(0, 90)} | ${JSON.stringify(range2 ?? {}).slice(0, 90)}`,
  );
  record('la consigne de « À déployer » n’est PAS celle de « En production »', range2?.to_deploy !== range2?.in_production);

  /* -------- Le rechargement -------- */

  await ouvrir();

  const relire = async (colonne) => {
    await ouvrirFenetre(colonne);
    const base = await page.locator('[data-consigne-base]').inputValue();
    const consigne = await page.locator('[data-consigne-deploiement]').inputValue();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    return { base, consigne };
  };

  const reluDev = await relire('to_deploy');
  record(
    'après rechargement, la base ET la consigne de « À déployer » sont là',
    reluDev.base === BASE_DEV && reluDev.consigne === CONSIGNE_DEV,
    `${reluDev.base.slice(0, 50)} | ${reluDev.consigne.slice(0, 50)}`,
  );

  const reluProd = await relire('in_production');
  record(
    'après rechargement, la base ET la consigne de « En production » sont là',
    reluProd.base === BASE_PROD && reluProd.consigne === CONSIGNE_PROD,
    `${reluProd.base.slice(0, 50)} | ${reluProd.consigne.slice(0, 50)}`,
  );

  record('les deux consignes relues restent distinctes', reluDev.consigne !== reluProd.consigne);

  /* -------- Ré-éditer la base à la main, sans regénérer -------- */

  await ouvrirFenetre('to_deploy');
  await page.locator('[data-consigne-base]').fill('');
  await page.locator('[data-consigne-deploiement]').fill('');
  await page.locator('[data-enregistrer-consigne]').click();
  await page.waitForTimeout(1200);
  const range3Base = await page.evaluate(() => window.__basesRangees());
  const range3 = await page.evaluate(() => window.__consignesRangees());
  record(
    'vider une étape efface sa base ET sa consigne, l’autre reste',
    !range3Base?.to_deploy &&
      !range3?.to_deploy &&
      range3Base?.in_production === BASE_PROD &&
      range3?.in_production === CONSIGNE_PROD,
    `${JSON.stringify(range3Base ?? {}).slice(0, 80)} | ${JSON.stringify(range3 ?? {}).slice(0, 80)}`,
  );

  record('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await page.evaluate(() => localStorage.removeItem('__essaiConsigne'));
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
