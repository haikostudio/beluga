#!/usr/bin/env node
/**
 * LA SURVEILLANCE DES SITES, dans un VRAI navigateur, sur son PROPRE démon
 * (base neuve, port libre, dossier de projets à part : le démon de production
 * n'est pas touché, aucun moteur appelé, aucun quota dépensé).
 *
 * Deux sites d'essai sont montés ici même : l'un répond, l'autre casse — et il
 * se répare à la demande. Aucun appel ne sort de la machine.
 *
 * Ce qu'il exige, un contrôle par promesse de la carte :
 *
 *  1. le bouton « Surveillance » est DANS la grille des services (bouton du fil d'Ariane), APRÈS le
 *     coffre-fort, et il ouvre sa page ;
 *  2. deux surveillances reprises d'avant les recettes (lignes posées en base, sans recette) sont
 *     listées et jouées en simple appel ;
 *  3. le site cassé est vu « en panne » avec sa raison, le site valide « en ligne » ;
 *  4. la PASTILLE de sa tuile compte les sites tombés, et un POINT sur le bouton des services le dit
 *     grille fermée ;
 *  5. l'ALERTE part vraiment vers l'application, avec le motif « site-indisponible » ;
 *  6. une seule alerte par chute : une seconde tournée sur un site toujours à terre n'en pousse pas d'autre ;
 *  7. le site réparé éteint la pastille, et le BANDEAU d'apaisement le dit ;
 *  8. « Nouvelle surveillance » ouvre un tiroir de CONVERSATION empilé (plus aucun champ d'adresse),
 *     dont le bouton reste éteint tant que la demande est vide — aucun agent n'est lancé ici ;
 *  9. un clic sur une ligne ouvre SON tiroir par-dessus la fenêtre restée ouverte, avec la frise des
 *     24 heures remplie par les passages, et le détail d'une tranche au clic ;
 * 10. une surveillance retirée disparaît, avec son historique ;
 * 11. un site au contrôle WordPress qui a relevé des soucis passe « à surveiller » (pastille jaune),
 *     et son tiroir dit le dernier allègement du journal d'erreurs,
 *     et son tiroir montre la partie « État WordPress » avec ses soucis ;
 * 12. le bloc « État WordPress » se replie par son en-tête : replié d'office sans faille ni erreur
 *     grave, ouvert d'office avec, et le choix fait à la main tient malgré un nouveau relevé ;
 * 13. le tiroir DÉFILE D'UN SEUL TENANT (titre, infos, WordPress, frise, puis la conversation de
 *     l'agent quand il en a une), au doigt sur téléphone ; seul le champ d'écriture reste fixe et
 *     visible, sur téléphone (390×844) comme sur ordinateur, WordPress déplié comme replié.
 *
 *   node scripts/verif-surveillance.mjs
 *
 * RECALÉ SUR LA REFONTE (11/10/2026). Les services ne sont plus des lignes de la colonne de gauche :
 * une grille, ouverte par le bouton du fil d'Ariane (`scripts/lib/navigation.mjs`). La surveillance est
 * une PAGE de la zone principale (`[data-ecran-plein]`), la fiche d'un site une page ouverte par-dessus ;
 * leurs gestes (`GestesDePage`) montent à droite de la barre d'en-tête sur ordinateur — HORS de la page
 * et de la fiche — et restent en tête de la fiche sur téléphone.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allerVers, ouvrirNavigation } from './lib/navigation.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_SURVEILLANCE_PORT || 7213);
const PORT_SITES = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-surveillance-'));

/* LA GRILLE DES SERVICES : son bouton dans la barre d'en-tête, et son panneau,
   qui n'est dans le document qu'OUVERT (`web/src/components/services.tsx`). */
const BOUTON = '[data-entete-de-zone] [data-navigation-compacte]';
const PANNEAU_OUVERT = '[data-navigation-panneau="ouvert"]';

/**
 * Referme la grille sans rien choisir. Ouverte, elle retient les clics du reste
 * de l'écran ; et on attend qu'elle soit DÉMONTÉE, pas seulement « fermée » :
 * un clic sur son bouton pendant qu'elle s'efface ne la rouvre pas.
 */
async function fermerNavigation(page) {
  if (!(await page.locator(PANNEAU_OUVERT).count())) return;
  await page.keyboard.press('Escape');
  await page.locator('[data-navigation-panneau]').first().waitFor({ state: 'detached', timeout: 5000 });
}

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
for (const dossier of [DATA, PROJETS]) fs.mkdirSync(dossier, { recursive: true });

/*
 * LES DEUX SITES D'ESSAI, servis ici même. « /casse » rend 500 tant qu'on ne
 * l'a pas réparé : c'est ce qui permet de rejouer une CHUTE puis un RETOUR sans
 * jamais dépendre d'internet.
 */
let casseRepare = false;
const sites = http.createServer((req, res) => {
  if (req.url.startsWith('/ok')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<html><body>Tout va bien</body></html>');
  }
  if (req.url.startsWith('/casse')) {
    if (casseRepare) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html><body>Réparé</body></html>');
    }
    res.writeHead(500, { 'content-type': 'text/html' });
    return res.end('<html><body>Panne interne</body></html>');
  }
  res.writeHead(404);
  res.end('rien ici');
});

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_WEB: process.env.BELUGA_WEB_ESSAI || path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const journal = [];
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));

const ranger = () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  try {
    sites.close();
  } catch {
    /* déjà fermé */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
};
process.on('exit', ranger);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    ranger();
    process.exit(130);
  });
}

async function attendrePort(port, limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(port, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function attendreLaBase(limiteMs = 30000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
      const table = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sites_surveilles'")
        .get();
      db.close();
      if (table) return true;
    } catch {
      /* base pas encore là */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

/** Une session d'une heure, fabriquée à la main : aucun mot de passe en jeu. */
function poserLaSession() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification de la surveillance',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.close();
}

/** L'état d'un site, lu dans la base : la vérité du serveur, pas celle de l'écran. */
function etatsEnBase() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const lignes = db.prepare('SELECT id, nom, url, etat, raison, code FROM sites_surveilles').all();
  db.close();
  return lignes;
}

/** Les passages gardés pour une surveillance. */
function controlesEnBase(siteId) {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const { n } = db.prepare('SELECT count(*) AS n FROM controles_surveillance WHERE site_id = ?').get(siteId);
  db.close();
  return n;
}

async function main() {
  fs.mkdirSync(path.join(RACINE, 'data', 'verification'), { recursive: true });
  sites.listen(PORT_SITES, '127.0.0.1');
  if (!(await attendrePort(PORT_SITES, 10000))) throw new Error("les sites d'essai n'ont pas démarré");

  if (!(await attendrePort(PORT))) throw new Error(`le démon d'essai n'a jamais ouvert le port ${PORT}`);
  if (!(await attendreLaBase()))
    throw new Error('la table des sites surveillés n’est jamais apparue : la migration n’a pas tourné');
  noter('La table des sites surveillés est créée par la migration', true);
  poserLaSession();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-CH' });
    await contexte.addCookies([
      { name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));

    /*
     * L'ALERTE se lit là où elle passe VRAIMENT : dans le canal ouvert entre le
     * démon et l'application. On ne se fie donc ni au journal ni à l'écran pour
     * dire qu'une notification est partie.
     */
    const alertes = [];
    page.on('websocket', (ws) => {
      ws.on('framereceived', ({ payload }) => {
        try {
          const event = JSON.parse(String(payload));
          if (event?.type === 'notify') alertes.push(event);
        } catch {
          /* trame binaire ou illisible : rien à en tirer */
        }
      });
    });

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-column="planned"]', { timeout: 30000 });
    await page.waitForTimeout(600);

    /* 1. Le bouton vit dans la GRILLE DES SERVICES, après le coffre-fort. La
       grille n'est dans le document qu'OUVERTE : on l'ouvre pour le compter. */
    await ouvrirNavigation(page);
    const bouton = page.locator(`${PANNEAU_OUVERT} [data-ouvrir-surveillance]`);
    noter('Le bouton « Surveillance » est dans la grille des services', (await bouton.count()) === 1);

    const ordre = await page.evaluate((panneau) => {
      const coffre = document.querySelector(`${panneau} [data-ouvrir-coffre]`);
      const veille = document.querySelector(`${panneau} [data-ouvrir-surveillance]`);
      if (!coffre || !veille) return 'absent';
      // La tuile d'après suit celle d'avant dans l'ordre du document.
      return coffre.compareDocumentPosition(veille) & Node.DOCUMENT_POSITION_FOLLOWING ? 'dessous' : 'dessus';
    }, PANNEAU_OUVERT);
    noter('Il est posé APRÈS le coffre-fort', ordre === 'dessous', ordre);
    await fermerNavigation(page);

    /*
     * 2. Deux surveillances REPRISES d'avant les recettes : des lignes posées en
     * base sans recette ni rythme, exactement comme les adresses déjà présentes
     * au passage à la nouvelle version. L'écran n'a plus de champ d'adresse.
     */
    {
      const db = new Database(path.join(DATA, 'beluga.db'));
      const poser = db.prepare(
        'INSERT INTO sites_surveilles (id, url, nom, etat, verifie_le, depuis, derniere_panne, cree_le) VALUES (?, ?, ?, ?, 0, 0, 0, ?)',
      );
      poser.run('site-ok', `http://127.0.0.1:${PORT_SITES}/ok`, 'Site debout', 'inconnu', Date.now());
      poser.run('site-casse', `http://127.0.0.1:${PORT_SITES}/casse`, 'Site cassé', 'inconnu', Date.now() + 1);
      db.close();
    }

    await allerVers(page, 'surveillance');
    /* LA SURVEILLANCE EST UNE PAGE de la zone principale, sous son grand titre.
       Ses deux gestes — « Vérifier maintenant », « Nouvelle surveillance » —
       montent dans la barre d'en-tête (`GestesDePage`) : ils ne sont plus DANS
       la page, on les vise donc dans le document. */
    const fenetre = page.locator('[data-ecran-plein][data-state="open"]', {
      has: page.locator('[data-titre-de-page]', { hasText: 'Surveillance' }),
    });
    const verifierTout = page.locator('[data-surveillance-verifier]');
    const nouvelleSurveillance = page.locator('[data-surveillance-nouvelle]');
    await fenetre.waitFor({ state: 'visible', timeout: 15000 });
    await nouvelleSurveillance.waitFor({ state: 'visible', timeout: 15000 });
    noter('La fenêtre de surveillance s’ouvre au clic', true);
    noter('Plus aucun champ d’adresse dans la fenêtre', (await page.locator('[data-surveillance-url]').count()) === 0);

    await verifierTout.click();
    await page.waitForTimeout(2500);
    const lignes = await page.locator('[data-surveillance-site]').count();
    noter('Les deux surveillances reprises sont listées', lignes === 2, `${lignes} ligne(s)`);

    // 3. Reprises sans recette, elles tournent en simple appel.
    const enBase = etatsEnBase();
    const casse = enBase.find((l) => l.url.includes('/casse'));
    const debout = enBase.find((l) => l.url.includes('/ok'));
    noter(
      'Une surveillance reprise tourne en simple appel',
      casse?.etat !== 'inconnu' && debout?.etat !== 'inconnu',
      `ok=${debout?.etat} cassé=${casse?.etat}`,
    );
    noter(
      'Le site en erreur 500 est vu « en panne », avec sa raison',
      casse?.etat === 'panne' && casse?.raison === 'serveur' && casse?.code === 500,
      `état=${casse?.etat} raison=${casse?.raison} code=${casse?.code}`,
    );
    noter('Le site valide est vu « en ligne »', debout?.etat === 'ok', `état=${debout?.etat}`);

    const etiquette = await fenetre.locator('[data-surveillance-etat="panne"]').first().textContent();
    noter(
      'La fenêtre affiche l’état de chaque site',
      (await fenetre.locator('[data-surveillance-etat="ok"]').count()) === 1 &&
        (await fenetre.locator('[data-surveillance-etat="panne"]').count()) === 1,
      `étiquette de panne : ${etiquette?.trim()}`,
    );

    /* 4. La pastille du menu. LE COMPTE SE LIT SUR LA TUILE « Surveillance »,
       grille OUVERTE. Grille fermée, le bouton des services ne porte plus de
       chiffre (`data-surveillance-pastille-compacte` a disparu avec la colonne
       repliée) : un POINT sur son coin dit qu'un site est tombé
       (`data-alerte-navigation`) — la base d'essai n'a aucun message en attente. */
    const pointDuBouton = page.locator(`${BOUTON}:visible [data-alerte-navigation]`);
    const pointVu = await pointDuBouton.count();
    await ouvrirNavigation(page);
    const pastille = page.locator(`${PANNEAU_OUVERT} [data-surveillance-pastille]`);
    const texte = (await pastille.count()) ? (await pastille.first().textContent())?.trim() : '';
    await fermerNavigation(page);
    noter('La pastille du menu compte les sites tombés', texte === '1', `pastille = « ${texte} »`);
    noter('La panne se voit aussi sur le bouton des services, grille fermée', pointVu === 1, `${pointVu} point(s) d’alerte`);

    /*
     * 5. L'alerte est vraiment partie vers l'application. On lui laisse passer
     * la FENÊTRE DE GROUPEMENT du guichet des notifications (quatre secondes,
     * `server/src/notify.ts`) : plus tôt, on constaterait une absence qui n'en
     * est pas une.
     */
    await page.waitForTimeout(5500);
    const alerte = alertes.find((a) => a.motif === 'site-indisponible');
    noter(
      'Une alerte « site indisponible » part vers l’application',
      Boolean(alerte),
      alerte ? `${alerte.title} — ${alerte.body}` : `aucune alerte reçue (${alertes.length} au total)`,
    );
    noter(
      'Elle NOMME le site et ce qui cloche',
      Boolean(alerte && /cassé/i.test(alerte.title) && /500/.test(alerte.body)),
      alerte ? alerte.title : '',
    );

    /* 6. Une seule alerte par chute. */
    const avant = alertes.filter((a) => a.motif === 'site-indisponible').length;
    await verifierTout.click();
    // Même attente : si une seconde alerte devait partir, elle aurait eu tout
    // le temps d'arriver.
    await page.waitForTimeout(6000);
    const apres = alertes.filter((a) => a.motif === 'site-indisponible').length;
    noter(
      'Un site toujours à terre ne réveille personne une seconde fois',
      apres === avant,
      `${avant} alerte(s) avant, ${apres} après une nouvelle tournée`,
    );

    /* 7. Le site réparé : pastille éteinte, bandeau d'apaisement. */
    noter(
      'Tant qu’un site est tombé, le bandeau rouge le nomme',
      (await fenetre.locator('[data-surveillance-bandeau="panne"]').count()) === 1,
    );
    casseRepare = true;
    await verifierTout.click();
    await page.waitForTimeout(3000);

    /* Même lecture qu'au point 4 : la tuile grille ouverte, le point grille fermée. */
    await ouvrirNavigation(page);
    const restant = await page.locator(`${PANNEAU_OUVERT} [data-surveillance-pastille]`).count();
    await fermerNavigation(page);
    const pointRestant = await pointDuBouton.count();
    noter(
      'Le site réparé éteint la pastille',
      restant === 0 && pointRestant === 0,
      `${restant} pastille(s) restante(s), ${pointRestant} point(s) d’alerte`,
    );
    noter(
      'Le bandeau d’apaisement annonce le retour à la normale',
      (await fenetre.locator('[data-surveillance-bandeau="apaise"]').count()) === 1,
    );

    /* 8. « Nouvelle surveillance » : un tiroir de conversation, bouton éteint tant que c'est vide. */
    await nouvelleSurveillance.click();
    const nouvelle = page.locator('[data-surveillance-tiroir="nouvelle"]');
    await nouvelle.waitFor({ state: 'visible', timeout: 10000 });
    noter(
      '« Nouvelle surveillance » ouvre un tiroir empilé avec la demande à l’agent',
      (await nouvelle.locator('[data-surveillance-demande]').count()) === 1 &&
        (await page.locator('[data-tiroir-empile="oui"]').count()) >= 1,
    );
    noter(
      'Le bouton de l’agent reste éteint tant que la demande est vide',
      await nouvelle.locator('[data-surveillance-demander]').isDisabled(),
    );
    await page.keyboard.press('Escape');
    await nouvelle.waitFor({ state: 'hidden', timeout: 10000 });

    /* 9. Le tiroir d'une surveillance : par-dessus la fenêtre, avec sa frise. */
    await fenetre.locator('[data-surveillance-site="site-ok"]').click();
    const tiroir = page.locator('[data-surveillance-tiroir="site-ok"]');
    await tiroir.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForFunction(
      () => Number(document.querySelector('[data-surveillance-tiroir="site-ok"] [data-surveillance-frise]')?.getAttribute('data-surveillance-frise')) >= 1,
      null,
      { timeout: 10000 },
    ).catch(() => undefined);
    const passages = Number(await tiroir.locator('[data-surveillance-frise]').getAttribute('data-surveillance-frise'));
    const casesPleines = await tiroir.locator('[data-surveillance-case="ok"]').count();
    noter(
      'Un clic sur une ligne ouvre son tiroir, la fenêtre restant ouverte derrière',
      (await fenetre.isVisible()) && (await tiroir.isVisible()),
    );
    noter(
      'La frise des 24 heures montre les passages de la surveillance',
      passages >= 1 && casesPleines >= 1 && (await tiroir.locator('[data-surveillance-case]').count()) === 48,
      `${passages} passage(s), ${casesPleines} tranche(s) en ligne`,
    );
    await tiroir.locator('[data-surveillance-case="ok"]').last().click();
    noter('Le détail d’une tranche s’affiche au clic', (await tiroir.locator('[data-surveillance-detail] li').count()) >= 1);
    noter(
      'Une surveillance sans agent propose de parler à l’agent pour la modifier',
      (await tiroir.locator('[data-surveillance-demande]').count()) === 1,
    );
    await page.screenshot({ path: path.join(RACINE, 'data', 'verification', 'surveillance-tiroir.png') }).catch(() => undefined);
    await page.keyboard.press('Escape');
    await tiroir.waitFor({ state: 'hidden', timeout: 10000 });

    /* 10. Une surveillance retirée disparaît, avec son historique. */
    const premier = await page.locator('[data-surveillance-supprimer]').first().getAttribute('data-surveillance-supprimer');
    await page.locator(`[data-surveillance-supprimer="${premier}"]`).click();
    await page.locator('button:has-text("Retirer")').last().click();
    await page.waitForTimeout(1000);
    noter(
      'Une surveillance retirée disparaît de la liste, avec son historique',
      (await page.locator('[data-surveillance-site]').count()) === 1 && etatsEnBase().length === 1 && controlesEnBase(premier) === 0,
    );

    /*
     * 11. LE CONTRÔLE WORDPRESS. Aucun serveur SSH ici : la configuration et le
     * suivi d'un passage sont posés en base, exactement comme le contrôle les
     * écrit, puis une tournée les rediffuse à l'écran.
     */
    {
      const reste = etatsEnBase()[0];
      const maintenant = Date.now();
      const db = new Database(path.join(DATA, 'beluga.db'));
      db.prepare('UPDATE sites_surveilles SET wordpress = ?, wp_suivi = ? WHERE id = ?').run(
        JSON.stringify({ acces: { id: 'fiche-ssh' }, racine: '~/sites/wp', wpCli: 'wp', journaux: [], extensionsAttendues: ['hello'] }),
        JSON.stringify({
          extensionsLe: maintenant,
          journauxLe: maintenant,
          positions: {},
          echecsJournaux: 0,
          faillesActives: false,
          journauxNettoyesLe: maintenant,
          dernierNettoyage: { le: maintenant, journaux: [{ chemin: 'wp-content/debug.log', avant: 44_958_295, apres: 22_055_419 }] },
          soucis: [
            { cle: 'desactivee:hello', genre: 'desactivee', sujet: 'hello', depuis: maintenant },
            { cle: 'maj:plugin:seo', genre: 'maj', sujet: 'seo', version: '1.0', versionCible: '1.1', depuis: maintenant },
          ],
        }),
        reste.id,
      );
      db.close();
      await verifierTout.click();
      await page.locator(`[data-surveillance-site="${reste.id}"] [data-surveillance-etat="attention"]`).waitFor({ timeout: 10000 }).catch(() => undefined);
      noter(
        'Un site WordPress avec des soucis passe « à surveiller »',
        (await page.locator(`[data-surveillance-site="${reste.id}"] [data-surveillance-etat="attention"]`).count()) === 1,
      );
      await fenetre.locator(`[data-surveillance-site="${reste.id}"]`).click();
      const tiroirWp = page.locator(`[data-surveillance-tiroir="${reste.id}"]`);
      await tiroirWp.waitFor({ state: 'visible', timeout: 10000 });
      const ouvert = () => tiroirWp.locator('[data-surveillance-wordpress]').getAttribute('data-surveillance-wordpress-ouvert');
      noter(
        '12. Sans faille ni erreur grave, le bloc « État WordPress » s’ouvre replié, en-tête seul',
        (await ouvert()) === 'non' &&
          (await tiroirWp.locator('[data-surveillance-souci]').count()) === 0 &&
          (await tiroirWp.locator('[data-surveillance-wordpress-bascule][aria-expanded="false"]').count()) === 1,
        `ouvert=${await ouvert()}`,
      );
      await tiroirWp.locator('[data-surveillance-wordpress-bascule]').click();
      noter('12. Un appui sur son en-tête le déplie', (await ouvert()) === 'oui');
      noter(
        'Son tiroir montre l’état WordPress, ses soucis et le geste pour accepter les extensions actuelles',
        (await tiroirWp.locator('[data-surveillance-wordpress="2"]').count()) === 1 &&
          (await tiroirWp.locator('[data-surveillance-souci]').count()) === 2 &&
          (await tiroirWp.locator('[data-surveillance-accepter]').count()) === 1 &&
          (await tiroirWp.locator('[data-surveillance-failles-inactives]').count()) === 1,
      );
      noter(
        'Son tiroir dit le dernier allègement du journal d’erreurs, avant → après',
        /42[,.]9 Mo → 21[,.]0 Mo/.test((await tiroirWp.locator('[data-surveillance-nettoyage]').textContent().catch(() => '')) ?? ''),
        (await tiroirWp.locator('[data-surveillance-nettoyage]').textContent().catch(() => '')) ?? '',
      );
      /* LE BLOC « ÉTAT WORDPRESS » SE DÉTACHE DU TIROIR PAR SES FONDS, sans
         aucun trait (`panneau.tsx`) : tiroir → panneau, panneau → en-tête et
         panneau → rangée d'un souci doivent garder un rapport de contraste
         ≥ 1,10, dans CHAQUE palette (deux depuis la refonte : clair, sombre). On mesure la couleur calculée, en
         lisant les deux écritures (`rgb(0..255)` et `color(srgb 0..1)` d'un
         `color-mix`). Chaque souci porte aussi son étiquette de gravité. */
      const { THEMES } = await import(path.join(RACINE, 'shared', 'dist', 'themes.js'));
      const themeAvant = await page.evaluate(() => ({ id: document.documentElement.dataset.theme, sombre: document.documentElement.classList.contains('dark') }));
      const faibles = [];
      for (const theme of THEMES) {
        const m = await page.evaluate(
          ({ id, sombre }) => {
            document.documentElement.dataset.theme = id;
            document.documentElement.classList.toggle('dark', sombre);
            const bloc = document.querySelector('[data-surveillance-wordpress]');
            const entete = bloc?.querySelector('[data-en-tete-de-panneau]');
            const panneau = bloc?.querySelector('[data-panneau]');
            const rangee = bloc?.querySelector('[data-surveillance-souci]');
            if (!bloc || !entete || !panneau || !rangee) return null;
            const transparent = (c) => !c || c === 'transparent' || /rgba\(0,\s*0,\s*0,\s*0\)/.test(c);
            let zone = bloc.parentElement;
            while (zone && transparent(getComputedStyle(zone).backgroundColor)) zone = zone.parentElement;
            const lire = (el) => {
              const brut = getComputedStyle(el).backgroundColor;
              const n = (brut.match(/[\d.]+/g) ?? []).map(Number).slice(0, 3);
              const c = /^color\(/.test(brut) ? n : n.map((v) => v / 255);
              const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
              return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
            };
            const r = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            const lp = lire(panneau);
            return { zonePanneau: zone ? r(lire(zone), lp) : 0, panneauEntete: r(lp, lire(entete)), panneauRangee: r(lp, lire(rangee)) };
          },
          { id: theme.id, sombre: theme.clarte === 'sombre' },
        );
        if (!m) faibles.push(`${theme.id} : bloc introuvable`);
        else
          for (const [cle, v] of Object.entries(m)) if (!(v >= 1.1)) faibles.push(`${theme.id} ${cle} ${v.toFixed(3)}`);
        if (theme.id === 'sombre' || theme.id === 'clair')
          await tiroirWp
            .locator('[data-surveillance-wordpress]')
            .screenshot({ path: path.join(RACINE, 'data', 'verification', `surveillance-wordpress-bloc-${theme.id}.png`) })
            .catch(() => undefined);
      }
      await page.evaluate(({ id, sombre }) => {
        document.documentElement.dataset.theme = id;
        document.documentElement.classList.toggle('dark', sombre);
      }, themeAvant);
      noter('Le bloc « État WordPress » se détache du tiroir, et chaque souci du bloc, dans chaque palette (≥ 1,10)', faibles.length === 0, faibles.join(' | '));
      noter(
        'Chaque souci porte son étiquette de gravité',
        (await tiroirWp.locator('[data-surveillance-souci] [data-gravite]').count()) === 2 &&
          (await tiroirWp.locator('[data-surveillance-souci="desactivee"] [data-gravite="importante"]').count()) === 1 &&
          (await tiroirWp.locator('[data-surveillance-souci="maj"] [data-gravite="simple"]').count()) === 1,
      );
      await page.screenshot({ path: path.join(RACINE, 'data', 'verification', 'surveillance-wordpress.png') }).catch(() => undefined);

      /* 12. Replié à la main, il le RESTE quand un nouveau relevé arrive — même
         s'il apporte une faille. Cinq soucis, dont une faille et une erreur grave. */
      await tiroirWp.locator('[data-surveillance-wordpress-bascule]').click();
      {
        const db = new Database(path.join(DATA, 'beluga.db'));
        const suivi = JSON.parse(db.prepare('SELECT wp_suivi FROM sites_surveilles WHERE id = ?').get(reste.id).wp_suivi);
        suivi.soucis = [
          { cle: 'faille:plugin:forms', genre: 'faille', sujet: 'forms', version: '2.0', versionCible: '2.1', detail: 'Injection SQL authentifiée', depuis: maintenant },
          { cle: 'fatale', genre: 'fatale', sujet: 'php', detail: 'PHP Fatal error: Uncaught Error in wp-content/plugins/forms/forms.php:42', depuis: maintenant },
          { cle: 'desactivee:hello', genre: 'desactivee', sujet: 'hello', depuis: maintenant },
          { cle: 'maj:plugin:seo', genre: 'maj', sujet: 'seo', version: '1.0', versionCible: '1.1', depuis: maintenant },
          { cle: 'maj:plugin:cache', genre: 'maj', sujet: 'cache', version: '3.4', versionCible: '3.5', depuis: maintenant },
        ];
        db.prepare('UPDATE sites_surveilles SET wp_suivi = ? WHERE id = ?').run(JSON.stringify(suivi), reste.id);
        db.close();
      }
      /* Sur ordinateur, les gestes de la fiche sont dans SA barre d'en-tête, hors de la fiche. */
      await page.locator('[data-surveillance-verifier-site]').click();
      await page
        // Sans vrai serveur SSH, ce passage peut ajouter un souci « accès » : cinq AU MOINS.
        .waitForFunction(
          (id) => Number(document.querySelector(`[data-surveillance-tiroir="${id}"] [data-surveillance-wordpress]`)?.getAttribute('data-surveillance-wordpress')) >= 5,
          reste.id,
          { timeout: 15000 },
        )
        .catch(() => undefined);
      noter(
        '12. Replié à la main, le bloc le reste quand un nouveau relevé apporte une faille',
        Number(await tiroirWp.locator('[data-surveillance-wordpress]').getAttribute('data-surveillance-wordpress')) >= 5 && (await ouvert()) === 'non',
        `soucis=${await tiroirWp.locator('[data-surveillance-wordpress]').getAttribute('data-surveillance-wordpress')} ouvert=${await ouvert()}`,
      );
      await page.keyboard.press('Escape');
      await tiroirWp.waitFor({ state: 'hidden', timeout: 10000 });

      /* À la réouverture, le choix est oublié : la faille l'ouvre d'office. */
      await fenetre.locator(`[data-surveillance-site="${reste.id}"]`).click();
      await tiroirWp.waitFor({ state: 'visible', timeout: 10000 });
      noter(
        '12. Rouvert sur une faille ou une erreur grave, le bloc s’ouvre déplié avec ses soucis',
        (await ouvert()) === 'oui' &&
          (await tiroirWp.locator('[data-surveillance-souci="faille"]').count()) === 1 &&
          (await tiroirWp.locator('[data-surveillance-souci]').count()) >= 5,
      );
      // Le détail d'une tranche s'affiche EN TÊTE de la partie qui défile.
      // (Ce site a pu tomber en panne au « Vérifier maintenant » : toute case pleine fait l'affaire.)
      await tiroirWp.locator('[data-surveillance-case]:not([data-surveillance-case="vide"])').last().click().catch(() => undefined);
      await page.waitForTimeout(400);

      /*
       * 13. LA TÊTE ET LA FRISE RESTENT FIXES, LE RESTE DÉFILE. Titre, adresse,
       * gestes, projet du site et frise des 24 heures sont HORS de la zone qui
       * défile ; le détail d'une case, WordPress — puis la conversation quand
       * l'agent en a une — vivent dans UNE zone ; le champ d'écriture reste fixe.
       */
      const mesurerVolet = () =>
        page.evaluate((id) => {
          const tiroir = document.querySelector(`[data-surveillance-tiroir="${id}"]`);
          const tete = tiroir?.querySelector('[data-surveillance-tete-fixe]');
          const frise = tiroir?.querySelector('[data-surveillance-frise]');
          const infos = tiroir?.querySelector('[data-surveillance-defilement-tete]');
          const champ = tiroir?.querySelector('[data-surveillance-demande], [data-composer]');
          if (!tiroir || !tete || !frise || !infos || !champ) return null;
          const defile = (el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY);
          let zone = infos.parentElement;
          while (zone && zone !== tiroir && !defile(zone)) zone = zone.parentElement;
          if (!zone || zone === tiroir) return { sansZone: true };
          const debordantes = [...tiroir.querySelectorAll('*')].filter((el) => defile(el) && el.scrollHeight > el.clientHeight + 1);
          const c = champ.getBoundingClientRect();
          const z = zone.getBoundingClientRect();
          const messages = [...tiroir.querySelectorAll('[data-message]')];
          const dernier = messages[messages.length - 1];
          const d = dernier?.getBoundingClientRect();
          const f = frise.getBoundingClientRect();
          /* LES GESTES DE LA FICHE passent par `GestesDePage` : sur ordinateur ils
             montent à droite de la barre d'en-tête de SA page (`barre`), donc hors
             du bloc repéré ; sur téléphone ils restent en tête de la fiche
             (`page`). On les cherche dans la page entière de la fiche. */
          const feuille = tiroir.closest('[data-page-de-zone]') ?? tiroir;
          const verifierEl = feuille.querySelector('[data-surveillance-verifier-site]');
          const verifier = verifierEl?.getBoundingClientRect();
          const retirerEl = feuille.querySelector('[data-surveillance-retirer-site]');
          const retirer = retirerEl?.getBoundingClientRect();
          const rangeeEl = verifierEl?.closest('[data-gestes-de-page]');
          const rangee = rangeeEl?.getBoundingClientRect();
          const detail = tiroir.querySelector('[data-surveillance-detail]');
          return {
            teteHorsZone: !zone.contains(tete) && !zone.contains(frise),
            teteTop: Math.round(tete.getBoundingClientRect().top),
            friseVisible: f.height > 10 && f.top >= 0 && f.bottom <= z.top + 1,
            gestes:
              Boolean(verifier && retirer && rangee) &&
              (verifierEl.textContent ?? '').trim() !== '' &&
              (retirerEl.textContent ?? '').trim() === '' &&
              retirer.left >= verifier.right &&
              Math.abs(retirer.right - rangee.right) < 2,
            gestesOu: rangeeEl?.getAttribute('data-gestes-de-page') ?? null,
            detailDansZone: detail ? zone.contains(detail) : null,
            scrollHeight: zone.scrollHeight,
            clientHeight: zone.clientHeight,
            scrollTop: zone.scrollTop,
            debordantes: debordantes.length,
            autreQueLaZone: debordantes.filter((el) => el !== zone).length,
            champHorsZone: !zone.contains(champ),
            champVisible: c.height > 20 && c.top >= 0 && c.bottom <= window.innerHeight,
            infosEnHaut: zone.contains(infos) && infos.getBoundingClientRect().top - z.top + zone.scrollTop < 200,
            messages: messages.length,
            messagesDansZone: messages.length > 0 && messages.every((m) => zone.contains(m)),
            dernierVisible: d ? d.top < c.top && d.bottom > z.top : null,
            centre: { x: z.left + z.width / 2, y: z.top + z.height / 2 },
          };
        }, reste.id);
      const glisser = async (cdp, centre, fois = 1) => {
        const doigt = (type, x, y) =>
          cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 8, radiusY: 8, force: 1 }],
          });
        for (let n = 0; n < fois; n += 1) {
          const { x, y } = centre;
          await doigt('touchStart', x, y + 120);
          for (let i = 1; i <= 12; i += 1) {
            await doigt('touchMove', x, y + 120 - i * 20);
            await page.waitForTimeout(25);
          }
          await doigt('touchEnd', x, y - 120);
          await page.waitForTimeout(500);
        }
      };

      const surOrdinateur = await mesurerVolet();
      noter(
        '13. Sur ordinateur, la tête et la frise sont fixes hors de la zone qui défile, le détail et WordPress dedans, la demande à l’agent fixe et visible',
        Boolean(surOrdinateur?.teteHorsZone && surOrdinateur.friseVisible && surOrdinateur.infosEnHaut && surOrdinateur.detailDansZone && surOrdinateur.champHorsZone && surOrdinateur.champVisible) &&
          surOrdinateur.autreQueLaZone === 0,
        JSON.stringify(surOrdinateur),
      );
      /* « Vérifier maintenant » ne prend plus la largeur d'une rangée de la
         fiche : la rangée a disparu, les deux gestes sont des boutons de la
         barre d'en-tête. Ce qui tient toujours : « Vérifier » garde son nom,
         « Retirer » n'est qu'une corbeille, la dernière à droite. */
      noter(
        '13. Dans la barre d’en-tête de la fiche, « Vérifier maintenant » garde son nom, « Retirer » n’est plus qu’une corbeille tout à droite',
        Boolean(surOrdinateur?.gestes) && surOrdinateur.gestesOu === 'barre',
        JSON.stringify(surOrdinateur),
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(500);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      const avant = await mesurerVolet();
      noter(
        '13. Sur téléphone, sous la tête fixe, une seule zone qui défile, plus grande que 40 % de l’écran',
        Boolean(avant?.teteHorsZone) && avant.clientHeight > 844 * 0.4 && avant.scrollHeight > avant.clientHeight + 20 && avant.autreQueLaZone === 0,
        JSON.stringify(avant),
      );
      noter('13. Sur téléphone, la demande à l’agent reste fixe et visible', Boolean(avant?.champHorsZone && avant.champVisible), JSON.stringify(avant));
      if (avant) await glisser(cdp, avant.centre);
      const apres = await mesurerVolet();
      noter(
        '13. Au doigt, la partie basse défile et la tête et la frise ne bougent pas',
        Boolean(apres?.friseVisible) && apres.scrollTop > (avant?.scrollTop ?? 0) + 20 && apres.teteTop === avant?.teteTop,
        `scrollTop ${avant?.scrollTop} → ${apres?.scrollTop}, tête ${avant?.teteTop} → ${apres?.teteTop}`,
      );
      await page.screenshot({ path: path.join(RACINE, 'data', 'verification', 'surveillance-telephone-defilement-unique.png') }).catch(() => undefined);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.keyboard.press('Escape');
      await tiroirWp.waitFor({ state: 'hidden', timeout: 10000 });

      /*
       * 13 bis. AVEC LA CONVERSATION DE L'AGENT : une conversation posée en
       * base sur ce site. L'état ET les messages vivent dans la MÊME zone, le
       * volet s'ouvre sur l'état, et le doigt va du haut jusqu'au dernier
       * message, WordPress déplié comme replié.
       */
      {
        const db = new Database(path.join(DATA, 'beluga.db'));
        const projetId = db.prepare('SELECT id FROM projects LIMIT 1').get()?.id ?? 'verif-surveillance';
        const t0 = Date.now() - 3600_000;
        const agentId = 'agent-verif-surveillance';
        db.prepare(
          'INSERT INTO agents (id, project_id, card_id, role, status, session_id, data, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, ?)',
        ).run(
          agentId,
          projetId,
          'task',
          'idle',
          JSON.stringify({ id: agentId, projectId: projetId, role: 'task', title: 'Agent du site', run: { engine: 'claude' }, status: 'idle', createdAt: t0, updatedAt: t0 }),
          t0,
          t0,
        );
        const poserMessage = db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)');
        for (let i = 0; i < 14; i += 1) {
          const role = i % 2 ? 'assistant' : 'user';
          const id = `msg-verif-${i}`;
          const content = `${role === 'user' ? 'Question' : 'Réponse'} ${i + 1} : ${'le contrôle de la page de connexion passe, la frise est verte. '.repeat(3)}`;
          poserMessage.run(id, agentId, role, JSON.stringify({ id, agentId, role, content, createdAt: t0 + i * 1000 }), t0 + i * 1000);
        }
        db.prepare('UPDATE sites_surveilles SET agent_id = ?, project_id = ? WHERE id = ?').run(agentId, projetId, reste.id);
        db.close();
      }
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('[data-column="planned"]', { timeout: 30000 }).catch(() => undefined);
      await page.waitForTimeout(600);
      await allerVers(page, 'surveillance');
      await fenetre.locator(`[data-surveillance-site="${reste.id}"]`).click();
      await tiroirWp.waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForFunction((id) => document.querySelectorAll(`[data-surveillance-tiroir="${id}"] [data-message]`).length >= 14, reste.id, { timeout: 15000 }).catch(() => undefined);
      await page.waitForTimeout(600);
      const alOuverture = await mesurerVolet();
      noter(
        '13 bis. Le volet s’ouvre sur WordPress, en haut de la partie qui défile, pas au bas de la conversation',
        Boolean(alOuverture) && alOuverture.scrollTop === 0 && alOuverture.messages >= 14,
        `scrollTop ${alOuverture?.scrollTop}, ${alOuverture?.messages} messages`,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(RACINE, 'data', 'verification', 'surveillance-telephone-ouverture.png') }).catch(() => undefined);
      for (const taille of [
        { width: 1280, height: 900 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(taille);
        await page.waitForTimeout(500);
        const cdp2 = await page.context().newCDPSession(page);
        await cdp2.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        for (const etatWp of ['oui', 'non']) {
          if ((await ouvert()) !== etatWp) await tiroirWp.locator('[data-surveillance-wordpress-bascule]').click();
          await page.evaluate((id) => {
            const infos = document.querySelector(`[data-surveillance-tiroir="${id}"] [data-surveillance-defilement-tete]`);
            let zone = infos?.parentElement;
            while (zone && !['auto', 'scroll'].includes(getComputedStyle(zone).overflowY)) zone = zone.parentElement;
            if (zone) zone.scrollTop = 0;
          }, reste.id);
          await page.waitForTimeout(300);
          const haut = await mesurerVolet();
          const nom = `${taille.width}×${taille.height}, WordPress ${etatWp === 'oui' ? 'déplié' : 'replié'}`;
          noter(
            `13 bis. ${nom} : tête et frise fixes, WordPress puis les ${haut?.messages ?? 0} messages dans UNE zone, le champ d’écriture fixe et visible`,
            Boolean(haut?.teteHorsZone && haut.friseVisible && haut.infosEnHaut && haut.messagesDansZone && haut.champHorsZone && haut.champVisible) &&
              haut.messages >= 14 &&
              haut.autreQueLaZone === 0,
            JSON.stringify(haut),
          );
          if (haut) await glisser(cdp2, haut.centre, 12);
          const bas = await mesurerVolet();
          noter(
            `13 bis. ${nom} : au doigt, on descend jusqu’au dernier message, la tête et la frise restent en place`,
            Boolean(bas?.dernierVisible && bas.friseVisible) && bas.scrollTop > (haut?.scrollTop ?? 0) + 20 && bas.champVisible && bas.teteTop === haut?.teteTop,
            `scrollTop ${haut?.scrollTop} → ${bas?.scrollTop}, dernier visible : ${bas?.dernierVisible}, tête ${haut?.teteTop} → ${bas?.teteTop}`,
          );
        }
        if (taille.width === 390)
          await page.screenshot({ path: path.join(RACINE, 'data', 'verification', 'surveillance-telephone-conversation.png') }).catch(() => undefined);
        await cdp2.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.keyboard.press('Escape');
      await tiroirWp.waitFor({ state: 'hidden', timeout: 10000 });
    }

    const SHOTS = path.join(RACINE, 'data', 'verification');
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'surveillance.png') });

    noter('Aucune erreur JavaScript de page pendant le scénario', erreurs.length === 0, erreurs.join(' | '));
  } finally {
    await navigateur.close();
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis.`);
  if (echecs.length) console.log('Journal du démon :\n' + journal.join(''));
  /*
   * On SORT explicitement : le démon d'essai et les sites d'essai tiennent la
   * boucle d'événements éveillée. Un contrôle qui ne rend pas la main passe
   * pour un contrôle qui n'a pas fini.
   */
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error('ÉCHEC :', error);
  console.log('Journal du démon :\n' + journal.join(''));
  process.exit(1);
});
