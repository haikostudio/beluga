#!/usr/bin/env node
/**
 * LE COFFRE-FORT DES IDENTIFIANTS, dans un VRAI navigateur, sur son PROPRE
 * démon (base neuve, port libre, dossier de projets à part : le démon de
 * production n'est pas touché, aucun moteur appelé, aucun quota dépensé).
 *
 * Ce qu'il exige, un contrôle par promesse de la carte :
 *
 *  1. le bouton « Coffre-fort » est DANS la grille des services (bouton à quatre carrés de la barre
 *     d'en-tête, plus dans la colonne de gauche), et il ouvre la page du coffre ;
 *  2. un accès de CHAQUE type proposé se crée et se retrouve dans la liste ;
 *  3. la recherche trouve un accès par son NOM, par son PROJET et par son TYPE ;
 *  4. ouvrir un accès pose une SECONDE page PAR-DESSUS la première, qui reste ouverte ;
 *  5. l'ancienne fiche « accès SSH de la machine », reflet du réglage « Accès au
 *     VPS » retiré, n'existe plus : toutes les fiches viennent du coffre ;
 *  6. un champ secret est masqué tant qu'on ne demande pas à le voir ;
 *  7. RETIRER ARCHIVE : la fiche quitte la liste, paraît dans la PAGE des
 *     archives — posée par-dessus la liste, qui reste entière derrière — avec sa
 *     date d'effacement, et s'y restaure ; la page se referme et rend les
 *     accès actifs ;
 *  8. UNE FICHE PAR SECRET : un fichier .env collé en entier est refusé ;
 * 13. CHAQUE VALEUR DANS SA CASE : une fiche sans son secret principal est
 *     acceptée et dite « à compléter » (liste et tête de fiche), la mention
 *     tombe dès que le secret est tapé ; une case en plus se pose, s'enregistre
 *     et se relit ; une note qui porte un Team ID est refusée en NOMMANT la case ;
 *  9. UNE FICHE FERMÉE RESTE FERMÉE : enregistrer ou fermer un accès ne le
 *     rouvre pas aussitôt derrière (l'adresse ne se prend plus pour une demande) ;
 * 10. LES DOSSIERS : créer, ranger une fiche, replié par défaut, ouvert par la
 *     recherche ; retirer un dossier archive ses fiches, le restaurer les rend.
 * 12. LE LIEN COUPÉ ne vide jamais le coffre : liste chargée, elle reste
 *     affichée et se relit seule au retour du lien ; écran monté lien coupé,
 *     une silhouette (jamais « aucun accès enregistré »), puis la liste au
 *     retour ; une lecture REFUSÉE se dit « n'a pas pu être lu » + Réessayer.
 *
 *   node scripts/verif-coffre-fort.mjs
 *
 * RECALÉ SUR LA REFONTE (11/10/2026). Les services ne sont plus des lignes de la
 * colonne de gauche : une grille, ouverte par le bouton du fil d'Ariane
 * (`scripts/lib/navigation.mjs`). Plus aucun tiroir : le coffre est une PAGE de
 * la zone principale (`Drawer enPage`), la fiche d'un accès et les archives des
 * pages ouvertes PAR-DESSUS (`[data-page-de-zone]`), non modales — celle d'en
 * dessous reste montée. Les règles gardées sont les mêmes, dites en pages.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { ouvrirNavigation } from './lib/navigation.mjs';
import { choisirDansLaListe } from './lib/liste-deroulante.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_COFFRE_PORT || 7209);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { TMP, DATA, PROJETS, DEPOT, demon, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-coffre-',
  port: PORT,
  env: {
    BELUGA_WEB: process.env.BELUGA_WEB_ESSAI || path.join(RACINE, 'web', 'dist'),
  },
  signaux: true,
});

async function attendreLaBase(limiteMs = 30000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='secrets'").get();
      db.close();
      if (table) return true;
    } catch {
      /* base pas encore là */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/**
 * ÉCHAP, UNE FOIS LA PAGE DU DESSUS POSÉE. Pendant qu'elle se pose, la page
 * n'écoute pas encore la touche : un Échap envoyé à l'instant où elle devient
 * visible tombait sur la couche d'en dessous, qui l'ignore — d'où des
 * fermetures manquées au hasard (mesuré le 06/10/2026 : jusqu'à 5 sur 15, 0
 * une fois l'animation d'ouverture finie). On attend donc la fin de ses
 * animations, un ÉTAT et non une durée.
 */
/**
 * UN GESTE DE LIGNE DE DOSSIER vit derrière le bouton à trois points : on
 * ouvre le menu de CETTE ligne (le premier déclencheur, le sien — ceux des
 * sous-dossiers viennent après), puis on choisit l'entrée, posée dans un
 * portail hors de la ligne.
 */
async function gesteDeDossier(page, ligne, geste) {
  await ligne.locator('[data-coffre-dossier-actions]').first().click();
  const entree = page.locator(`[role="menuitem"][data-coffre-dossier-${geste}]`);
  await entree.waitFor({ state: 'visible', timeout: 5000 });
  await entree.click();
}

async function echap(page) {
  await page.evaluate(() =>
    Promise.all(
      [...document.querySelectorAll('[role="dialog"][data-state="open"]')].flatMap((d) => d.getAnimations().map((a) => a.finished.catch(() => undefined))),
    ),
  );
  await page.keyboard.press('Escape');
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-coffre';
const PROJET_NOM = 'Boutique en ligne';

function poserLeProjet() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification du coffre-fort',
  );

  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: PROJET_NOM,
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);
  db.close();
}

/* Un accès par type, avec le champ qu'on remplira et ce qu'on y écrit. */
const A_CREER = [
  { type: 'cle-api', nom: 'Clé Stripe', champ: 'service', valeur: 'Stripe' },
  { type: 'mot-de-passe', nom: 'Console OVH', champ: 'identifiant', valeur: 'admin-ovh' },
  { type: 'ssh', nom: 'Serveur de secours', champ: 'hote', valeur: '203.0.113.10' },
  { type: 'jeton', nom: 'Jeton Vercel', champ: 'service', valeur: 'Vercel' },
  { type: 'base-de-donnees', nom: 'Base des commandes', champ: 'base', valeur: 'commandes' },
  { type: 'compte-bancaire', nom: 'Compte de la boutique', champ: 'titulaire', valeur: 'Boutique SA' },
  { type: 'carte-paiement', nom: 'Carte des achats', champ: 'titulaire', valeur: 'Jeanne Martin' },
  { type: 'carte-identite', nom: 'Carte d’identité de Jeanne', champ: 'nom', valeur: 'Jeanne Martin' },
  { type: 'passeport', nom: 'Passeport de Jeanne', champ: 'nom', valeur: 'Jeanne Martin' },
  { type: 'permis-conduire', nom: 'Permis de Jeanne', champ: 'nom', valeur: 'Jeanne Martin' },
  { type: 'autre', nom: 'Code du coffre physique', champ: 'valeur', valeur: '4821' },
];

async function main() {
  const pretPort = await attendrePort();
  if (!pretPort) throw new Error(`le démon d'essai n'a jamais ouvert le port ${PORT}`);
  const preteBase = await attendreLaBase();
  if (!preteBase) throw new Error('la table du coffre n’est jamais apparue : la migration n’a pas tourné');
  noter('La table du coffre est créée par la migration', true);
  poserLeProjet();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-CH' });
    /* UN ESPION DU CANAL, posé avant l'application : il compte les lectures du
       coffre, sait COUPER le lien (les nouvelles ouvertures visent un port
       mort) et REFUSER une lecture (réponse d'échec fabriquée). Le point
       d'essai de l'application n'existe pas dans la version construite. */
    await contexte.addInitScript(() => {
      const Natif = window.WebSocket;
      const lien = {
        coupe: sessionStorage.getItem('essai-coupe') === '1',
        refuser: sessionStorage.getItem('essai-refuser') === '1',
        sockets: [],
        listes: 0,
      };
      window.__essaiLien = lien;
      class Espion extends Natif {
        constructor(url, protocoles) {
          super(lien.coupe ? 'ws://127.0.0.1:9/' : url, protocoles);
          lien.sockets.push(this);
        }
        send(donnees) {
          if (typeof donnees === 'string' && donnees.includes('"coffre.lister"')) {
            lien.listes += 1;
            if (lien.refuser) {
              const { id } = JSON.parse(donnees);
              setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'ack', id, ok: false, error: 'refus d’essai' }) }), 50);
              return;
            }
          }
          return super.send(donnees);
        }
      }
      window.WebSocket = Espion;
    });
    await contexte.addCookies([
      { name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-column="planned"]', { timeout: 30000 });
    await page.waitForTimeout(600);

    /* 1. Le bouton vit dans la GRILLE DES SERVICES (bouton à quatre carrés de
       la barre d'en-tête), et il ouvre la page du coffre. La grille n'est dans
       le document qu'OUVERTE : on l'ouvre pour le compter. */
    const boutonDesServices = page.locator('[data-entete-de-zone] [data-navigation-compacte]:visible');
    noter(
      'Le bouton des services est dans la barre d’en-tête, plus dans la colonne de gauche',
      (await boutonDesServices.count()) === 1 &&
        (await page.locator('aside[data-zone="gauche"] [data-navigation-compacte]').count()) === 0,
    );
    await ouvrirNavigation(page);
    const bouton = page.locator('[data-navigation-panneau="ouvert"] [data-ouvrir-coffre]');
    const dansLaGrille = (await bouton.count()) === 1;
    noter('Le bouton « Coffre-fort » est dans la grille des services', dansLaGrille);
    await bouton.click();
    const tiroirListe = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-coffre-recherche]') });
    await tiroirListe.waitFor({ state: 'visible', timeout: 15000 });
    noter('La page du coffre s’ouvre au clic', true);

    /* 2. Un accès de CHAQUE type. */
    for (const item of A_CREER) {
      await page.click('[data-coffre-creer]');
      await page.click(`[data-coffre-type="${item.type}"]`);
      const fiche = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-coffre-enregistrer]') });
      await fiche.waitFor({ state: 'visible', timeout: 10000 });
      await fiche.locator('[data-coffre-nom]').fill(item.nom);
      await fiche.locator(`[data-coffre-champ="${item.champ}"]`).fill(item.valeur);
      await choisirDansLaListe(fiche.locator('[data-coffre-projet]'), PROJET_ID);
      await fiche.locator('[data-coffre-enregistrer]').click();
      await fiche.waitFor({ state: 'hidden', timeout: 10000 });
    }
    const lignes = await page.locator('[data-coffre-acces]').count();
    noter(
      `Les ${A_CREER.length} types d’accès se créent et paraissent dans la liste`,
      lignes === A_CREER.length,
      `${lignes} ligne(s) affichée(s), ${A_CREER.length} attendues (les accès créés)`,
    );

    /* 13. Chaque valeur dans sa case. Seule la fiche « autre » a son secret principal (4821). */
    const badges = await page.locator('[data-coffre-acces] [data-coffre-a-completer]').count();
    noter(
      'Une fiche sans son secret principal est acceptée et dite « à compléter » dans la liste',
      badges === A_CREER.length - 1,
      `${badges} mention(s), ${A_CREER.length - 1} attendues`,
    );
    await page.locator('[data-coffre-acces]', { hasText: 'Console OVH' }).click();
    const ficheOvh = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-coffre-enregistrer]') });
    await ficheOvh.waitFor({ state: 'visible', timeout: 10000 });
    const enTete = await page.locator('[data-coffre-fiche-a-completer]:visible').count();
    await ficheOvh.locator('[data-coffre-champ="motDePasse"]').fill('m0t-de-passe');
    await page.waitForTimeout(150);
    const tombee = (await page.locator('[data-coffre-fiche-a-completer]:visible').count()) === 0;
    noter('La tête de la fiche dit « à compléter », et la mention tombe dès que le secret est tapé', enTete === 1 && tombee, `en tête : ${enTete}, tombée : ${tombee}`);
    await ficheOvh.locator('[data-coffre-ajouter-case]').click();
    await ficheOvh.locator('[data-coffre-case-libelle]').first().fill('Code client');
    await ficheOvh.locator('[data-coffre-champ="libre-0"]').fill('C-77');
    await ficheOvh.locator('[data-coffre-note]').fill('Console OVH, Team ID ABCD123456');
    await ficheOvh.locator('[data-coffre-enregistrer]').click();
    const refusNote = await page
      .getByText('La note n’est pas un champ', { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(async () => (await page.getByText('Numéro de compte ou d’équipe', { exact: false }).count()) > 0)
      .catch(() => false);
    noter('Une note qui porte un Team ID est refusée, et le refus nomme la case', refusNote && (await ficheOvh.isVisible()));
    await ficheOvh.locator('[data-coffre-note]').fill('Console d’administration de la boutique.');
    await ficheOvh.locator('[data-coffre-enregistrer]').click();
    await ficheOvh.waitFor({ state: 'hidden', timeout: 10000 });
    await page.locator('[data-coffre-acces]', { hasText: 'Console OVH' }).click();
    await ficheOvh.waitFor({ state: 'visible', timeout: 10000 });
    const caseRelue = await ficheOvh.locator('[data-coffre-case-libelle]').first().inputValue().catch(() => '');
    const valeurRelue = await ficheOvh.locator('[data-coffre-champ="libre-0"]').inputValue().catch(() => '');
    noter('Une case en plus s’enregistre et se relit', caseRelue === 'Code client' && valeurRelue === 'C-77', `${caseRelue} = ${valeurRelue}`);
    await echap(page);
    await ficheOvh.waitFor({ state: 'hidden', timeout: 10000 });
    noter(
      'Complétée, la fiche n’est plus « à compléter » dans la liste',
      (await page.locator('[data-coffre-acces]', { hasText: 'Console OVH' }).locator('[data-coffre-a-completer]').count()) === 0,
    );

    /* 3. La recherche : par NOM, par PROJET, par TYPE. */
    const chercher = async (texte) => {
      await page.fill('[data-coffre-recherche]', texte);
      await page.waitForTimeout(200);
      return page.locator('[data-coffre-acces]').allTextContents();
    };

    const parNom = await chercher('stripe');
    noter(
      'La recherche trouve un accès par son NOM',
      parNom.length === 1 && parNom[0].includes('Clé Stripe'),
      `${parNom.length} résultat(s)`,
    );

    const parProjet = await chercher('boutique');
    noter(
      'La recherche trouve les accès par leur PROJET',
      parProjet.length === A_CREER.length,
      `${parProjet.length} résultat(s) pour « ${PROJET_NOM} »`,
    );

    const parType = await chercher('base de données');
    noter(
      'La recherche trouve un accès par son TYPE',
      parType.length === 1 && parType[0].includes('Base des commandes'),
      `${parType.length} résultat(s)`,
    );

    const parSecret = await chercher('4821');
    noter(
      'La recherche ne mord PAS sur une valeur secrète',
      parSecret.length === 0,
      `${parSecret.length} résultat(s) pour un contenu secret`,
    );

    /* 4. La page EMPILÉE : la première reste ouverte derrière. */
    await chercher('');
    await page.click('[data-coffre-acces]');
    const fiche = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-coffre-enregistrer]') });
    await fiche.waitFor({ state: 'visible', timeout: 10000 });
    const ouverts = await page.locator('[role="dialog"][data-state="open"]').count();
    const listeEncoreLa = await tiroirListe.isVisible();
    noter(
      'Un accès s’ouvre dans une page EMPILÉE, la liste restant ouverte dessous',
      ouverts === 2 && listeEncoreLa && (await fiche.getAttribute('data-tiroir-empile')) === 'oui',
      `${ouverts} page(s) ouverte(s), liste ${listeEncoreLa ? 'visible' : 'refermée'}`,
    );

    /* 6. Un champ secret est masqué tant qu'on ne demande pas à le voir. */
    const typeAvant = await fiche.locator('input[data-coffre-champ][type="password"]').count();
    noter('Un champ secret est masqué par défaut', typeAvant >= 1, `${typeAvant} champ(s) masqué(s)`);
    const oeil = fiche.locator('[data-coffre-oeil]').first();
    if (await oeil.count()) {
      await oeil.click();
      await page.waitForTimeout(150);
      const typeApres = await fiche.locator('input[data-coffre-champ][type="password"]').count();
      noter('L’œil dévoile le champ secret', typeApres < typeAvant, `${typeApres} champ(s) encore masqué(s)`);
    }
    await echap(page);
    await fiche.waitFor({ state: 'hidden', timeout: 10000 });

    /* 5. L'ancienne fiche des accès SSH centraux (réglage « Accès au VPS »,
       retiré) n'a plus sa place dans la liste. */
    noter(
      'Plus aucune fiche « accès SSH de la machine » venue des réglages',
      (await page.locator('[data-coffre-acces="reglages:vps"]').count()) === 0,
    );

    /* 7. Retirer ARCHIVE : hors de la liste, dans « Archives », puis restauré. */
    const ligneJeton = page.locator('[data-coffre-acces]', { hasText: 'Jeton Vercel' });
    await ligneJeton.click();
    const ficheJeton = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-coffre-supprimer]') });
    await ficheJeton.waitFor({ state: 'visible', timeout: 10000 });
    await ficheJeton.locator('[data-coffre-supprimer]').click();
    await page.getByRole('button', { name: 'Retirer' }).last().click();
    await ficheJeton.waitFor({ state: 'hidden', timeout: 10000 });
    // On attend l'ÉTAT (la liste relue après le retrait), pas une durée : sous
    // charge, la réponse du démon arrive après 300 ms.
    await ligneJeton.waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
    noter('Une fiche retirée quitte la liste des accès', (await ligneJeton.count()) === 0);

    /* Le bouton « Archives » OUVRE UNE PAGE par-dessus : il ne retourne plus la
       liste sur place, et la liste des accès actifs reste entière derrière. */
    await page.click('[data-coffre-voir-archives]');
    const tiroirArchives = page.locator('[role="dialog"][data-state="open"]', {
      has: page.locator('[data-coffre-recherche-archives]'),
    });
    await tiroirArchives.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForSelector('[data-coffre-liste="archives"]', { timeout: 10000 });
    noter(
      'Le bouton « Archives » ouvre une PAGE par-dessus, la liste des accès restant ouverte dessous',
      (await page.locator('[data-coffre-liste="actifs"]').count()) === 1 && (await tiroirListe.isVisible()),
    );
    const SHOTS = path.join(RACINE, 'data', 'verification');
    fs.mkdirSync(SHOTS, { recursive: true });
    /* La page se pose : sans cette pause, la capture fige une animation à
       mi-chemin et ne la montre pas telle qu'on la voit. */
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOTS, 'coffre-fort-archives.png') });
    const archivee = tiroirArchives.locator('[data-coffre-acces]', { hasText: 'Jeton Vercel' });
    const dateEffacement = (await archivee.locator('[data-coffre-effacement]').textContent().catch(() => '')) ?? '';
    noter(
      'Elle paraît dans « Archives » avec sa date d’effacement',
      (await archivee.count()) === 1 && /\d/.test(dateEffacement),
      dateEffacement,
    );

    /* La recherche des archives est la SIENNE : elle filtre les archives sans
       toucher à la liste des accès actifs, derrière. */
    await tiroirArchives.locator('[data-coffre-recherche-archives]').fill('vercel');
    await page.waitForTimeout(200);
    const archivesFiltrees = await tiroirArchives.locator('[data-coffre-acces]').count();
    const actifsIntacts = await page.locator('[data-coffre-liste="actifs"] [data-coffre-acces]').count();
    noter(
      'La recherche des archives filtre les archives sans toucher aux accès actifs',
      archivesFiltrees === 1 && actifsIntacts > 1,
      `${archivesFiltrees} archive(s), ${actifsIntacts} accès actif(s) derrière`,
    );

    await archivee.click();
    const ficheArchivee = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-coffre-restaurer]') });
    await ficheArchivee.waitFor({ state: 'visible', timeout: 10000 });
    noter(
      'La fiche archivée s’ouvre PAR-DESSUS la page des archives, qui reste ouverte',
      await tiroirArchives.isVisible(),
    );
    await ficheArchivee.locator('[data-coffre-restaurer]').click();
    await ficheArchivee.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(300);
    noter(
      'Restaurer referme la fiche sans refermer la page des archives',
      await tiroirArchives.isVisible(),
    );

    /* On revient aux accès actifs en REFERMANT la page des archives, pas en recliquant. */
    await echap(page);
    await tiroirArchives.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(300);
    noter(
      'Restaurée, elle revient parmi les accès une fois la page des archives refermée',
      (await page.locator('[data-coffre-liste="actifs"] [data-coffre-acces]', { hasText: 'Jeton Vercel' }).count()) === 1,
    );

    /* 8. Une fiche par secret : un .env collé en entier est refusé, avec l'explication. */
    await page.click('[data-coffre-creer]');
    await page.click('[data-coffre-type="autre"]');
    const ficheEnv = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-coffre-enregistrer]') });
    await ficheEnv.waitFor({ state: 'visible', timeout: 10000 });
    await ficheEnv.locator('[data-coffre-nom]').fill('Boutique — .env');
    await ficheEnv.locator('[data-coffre-champ="valeur"]').fill('APP_NAME=Boutique\nDB_PASSWORD=s3cr3t\nSTRIPE_SECRET_KEY=sk_test_abc');
    await ficheEnv.locator('[data-coffre-enregistrer]').click();
    const refus = await page
      .getByText('Une fiche par secret', { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    noter('Un fichier .env collé en entier est refusé, « une fiche par secret »', refus && (await ficheEnv.isVisible()));
    await echap(page);
    await ficheEnv.waitFor({ state: 'hidden', timeout: 10000 });

    /*
     * 9. UNE FICHE FERMÉE RESTE FERMÉE. L'adresse porte la fiche ouverte pour
     * qu'un lien la rouvre ; à la fermeture, ce reste d'adresse était pris pour
     * une demande d'ouverture et la fiche se rouvrait aussitôt derrière.
     */
    const detailOuvert = page.locator('[role="dialog"][data-state="open"]', {
      has: page.locator('[data-coffre-enregistrer]'),
    });
    const ligneStripe = page.locator('[data-coffre-liste="actifs"] [data-coffre-acces]', { hasText: 'Clé Stripe' });
    await ligneStripe.click();
    await detailOuvert.waitFor({ state: 'visible', timeout: 10000 });
    await detailOuvert.locator('[data-coffre-enregistrer]').click();
    await detailOuvert.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(800);
    noter(
      'Enregistrer un accès referme sa fiche, qui ne se rouvre pas derrière',
      (await detailOuvert.count()) === 0,
      `${await detailOuvert.count()} fiche(s) encore ouverte(s)`,
    );

    await ligneStripe.click();
    await detailOuvert.waitFor({ state: 'visible', timeout: 10000 });
    await echap(page);
    await detailOuvert.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(800);
    noter(
      'Fermer un accès referme sa fiche, qui ne se rouvre pas derrière',
      (await detailOuvert.count()) === 0 && !/#coffre\//.test(page.url()),
      `${await detailOuvert.count()} fiche(s) encore ouverte(s) — ${page.url()}`,
    );

    /* …ET LE LIEN DIRECT MARCHE TOUJOURS : c'est ce que sert l'adresse. */
    const idStripe = await ligneStripe.getAttribute('data-coffre-acces');
    await page.goto(`${BASE}#coffre/${idStripe}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const ouverteParLien = await detailOuvert
      .waitFor({ state: 'visible', timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    const nomParLien = ouverteParLien ? await detailOuvert.locator('[data-coffre-nom]').inputValue() : '';
    noter(
      'Un lien « #coffre/<id> » collé dans un onglet neuf ouvre toujours la fiche',
      ouverteParLien && nomParLien === 'Clé Stripe',
      `fiche ouverte : ${nomParLien || 'aucune'}`,
    );
    if (ouverteParLien) {
      await echap(page);
      await detailOuvert.waitFor({ state: 'hidden', timeout: 10000 });
      await page.waitForTimeout(800);
      noter(
        'Refermer une fiche venue d’un lien ne la rouvre pas non plus',
        (await detailOuvert.count()) === 0,
        `${await detailOuvert.count()} fiche(s) encore ouverte(s)`,
      );
    }

    /* 10. LES DOSSIERS : un nom, un projet, un parent. Créer, ranger une
       fiche depuis son formulaire, replié par défaut, ouvert par la recherche ;
       retirer le dossier archive ses fiches avec lui, et le restaurer les rend. */
    await page.locator('[data-coffre-nouveau-dossier]:visible').first().click();
    const ficheDossier = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-coffre-dossier-enregistrer]') });
    await ficheDossier.waitFor({ state: 'visible', timeout: 10000 });
    await ficheDossier.locator('[data-coffre-dossier-champ-nom]').fill('Serveur OVH');
    await choisirDansLaListe(ficheDossier.locator('[data-coffre-dossier-projet]'), PROJET_ID);
    await ficheDossier.locator('[data-coffre-dossier-enregistrer]').click();
    await ficheDossier.waitFor({ state: 'hidden', timeout: 10000 });
    const ligneDossier = page.locator('[data-coffre-dossier]', { hasText: 'Serveur OVH' });
    await ligneDossier.waitFor({ state: 'visible', timeout: 10000 });
    noter(
      'Un dossier se crée et paraît dans la liste, vide, replié',
      (await ligneDossier.count()) === 1 &&
        (await ligneDossier.getAttribute('data-ouvert')) === 'non' &&
        (await ligneDossier.locator('[data-coffre-dossier-nombre]').textContent()) === '0',
    );
    const idDossier = await ligneDossier.getAttribute('data-coffre-dossier');

    const ligneConsole = page.locator('[data-coffre-acces]', { hasText: 'Console OVH' });
    await ligneConsole.click();
    const ficheRangee = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-coffre-enregistrer]') });
    await ficheRangee.waitFor({ state: 'visible', timeout: 10000 });
    await choisirDansLaListe(ficheRangee.locator('[data-coffre-dossier-choix]'), idDossier);
    await ficheRangee.locator('[data-coffre-enregistrer]').click();
    await ficheRangee.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(300);
    noter(
      'Ranger une fiche dans le dossier : il la compte et la cache tant qu’il est replié',
      (await ligneDossier.locator('[data-coffre-dossier-nombre]').textContent()) === '1' &&
        (await page.locator('[data-coffre-acces]', { hasText: 'Console OVH' }).count()) === 0,
    );
    await ligneDossier.locator('[data-coffre-dossier-bascule]').click();
    await page.locator('[data-coffre-acces]', { hasText: 'Console OVH' }).waitFor({ state: 'visible', timeout: 5000 });
    noter('Le chevron déplie le dossier et montre sa fiche', true);
    await ligneDossier.locator('[data-coffre-dossier-bascule]').click();

    /* La recherche trouve la fiche PAR LE NOM DU DOSSIER et l'ouvre avec lui. */
    const parDossier = await chercher('serveur ovh');
    noter(
      'La recherche par nom de dossier montre la fiche avec son dossier ouvert',
      parDossier.length === 1 && (await ligneDossier.getAttribute('data-ouvert')) === 'oui',
      `${parDossier.length} résultat(s)`,
    );
    await chercher('');

    /* Retirer le dossier : ses fiches partent avec lui, et reviennent avec lui. */
    await gesteDeDossier(page, ligneDossier, 'modifier');
    const ficheDossier2 = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-coffre-dossier-supprimer]') });
    await ficheDossier2.waitFor({ state: 'visible', timeout: 10000 });
    await ficheDossier2.locator('[data-coffre-dossier-supprimer]').click();
    await page.getByRole('button', { name: 'Retirer' }).last().click();
    await ficheDossier2.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(300);
    noter(
      'Retirer le dossier archive le dossier ET sa fiche',
      (await page.locator('[data-coffre-dossier]', { hasText: 'Serveur OVH' }).count()) === 0 &&
        (await page.locator('[data-coffre-acces]', { hasText: 'Console OVH' }).count()) === 0,
    );
    await page.click('[data-coffre-voir-archives]');
    const archivesDossiers = page.locator('[role="dialog"][data-state="open"]', {
      has: page.locator('[data-coffre-recherche-archives]'),
    });
    await archivesDossiers.waitFor({ state: 'visible', timeout: 10000 });
    const dossierArchive = archivesDossiers.locator('[data-coffre-dossier]', { hasText: 'Serveur OVH' });
    noter(
      'Le dossier archivé paraît dans les archives avec sa fiche',
      (await dossierArchive.count()) === 1 &&
        (await dossierArchive.locator('[data-coffre-acces]', { hasText: 'Console OVH' }).count()) === 1,
    );
    await dossierArchive.locator('[data-coffre-dossier-restaurer]').click();
    await page.waitForTimeout(500);
    await echap(page);
    await archivesDossiers.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(300);
    const dossierRendu = page.locator('[data-coffre-dossier]', { hasText: 'Serveur OVH' });
    noter(
      'Restaurer le dossier le rend avec sa fiche',
      (await dossierRendu.count()) === 1 && (await dossierRendu.locator('[data-coffre-dossier-nombre]').textContent()) === '1',
    );

    /* 11. DES DOSSIERS DANS DES DOSSIERS : un sous-dossier se crée depuis la ligne
       de son parent, hérite de son projet, reçoit une fiche, et chaque niveau
       compte ce qu'il contient (le parent compte aussi le sous-arbre). */
    await gesteDeDossier(page, dossierRendu, 'sous-dossier');
    const ficheSous = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-coffre-dossier-parent]') });
    await ficheSous.waitFor({ state: 'visible', timeout: 10000 });
    await ficheSous.locator('[data-coffre-dossier-champ-nom]').fill('Production');
    await ficheSous.locator('[data-coffre-dossier-enregistrer]').click();
    await ficheSous.waitFor({ state: 'hidden', timeout: 10000 });
    const ligneSous = dossierRendu.locator('[data-coffre-dossier]', { hasText: 'Production' });
    await ligneSous.waitFor({ state: 'visible', timeout: 10000 });
    const idSous = await ligneSous.getAttribute('data-coffre-dossier');
    noter(
      'Un sous-dossier se crée sous son parent, dans le parent déplié',
      (await ligneSous.count()) === 1 && Boolean(idSous),
    );
    await page.locator('[data-coffre-acces]', { hasText: 'Console OVH' }).click();
    const ficheDansSous = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-coffre-enregistrer]') });
    await ficheDansSous.waitFor({ state: 'visible', timeout: 10000 });
    await choisirDansLaListe(ficheDansSous.locator('[data-coffre-dossier-choix]'), idSous);
    await ficheDansSous.locator('[data-coffre-enregistrer]').click();
    await ficheDansSous.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(300);
    noter(
      'La fiche rangée dans le sous-dossier : il la compte, et son parent compte le sous-arbre',
      (await ligneSous.locator('[data-coffre-dossier-nombre]').first().textContent()) === '1' &&
        (await dossierRendu.locator('[data-coffre-dossier-nombre]').first().textContent()) === '1',
    );
    if ((await ligneSous.getAttribute('data-ouvert')) !== 'oui') await ligneSous.locator('[data-coffre-dossier-bascule]').first().click();
    await page.locator('[data-coffre-acces]', { hasText: 'Console OVH' }).first().click();
    const ficheChemin = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-coffre-enregistrer]') });
    await ficheChemin.waitFor({ state: 'visible', timeout: 10000 });
    noter(
      'La fiche dit le chemin complet de son dossier',
      ((await ficheChemin.locator('[data-coffre-fiche-chemin]').textContent()) ?? '').includes('Serveur OVH › Production'),
    );
    await echap(page);
    await ficheChemin.waitFor({ state: 'hidden', timeout: 10000 });

    /* 11 bis. LES GESTES À LEUR PLACE (carte « Boutons du coffre-fort à ranger ») :
       « Nouveau dossier » à droite du titre de la page, plus dans la colonne ;
       plus de rubrique « Dossiers » ; une icône par dossier qui a des
       sous-dossiers ouvre ou ferme TOUTE sa branche, et rien d'autre. */
    const nouveauDossier = page.locator('[data-coffre-nouveau-dossier]:visible');
    const placeDuBouton = await nouveauDossier.first().evaluate((bouton) => {
      const titre = bouton.parentElement?.querySelector('[data-titre-de-page]');
      if (!titre) return null;
      const a = titre.getBoundingClientRect();
      const b = bouton.getBoundingClientRect();
      return { dansLaColonne: Boolean(bouton.closest('[data-colonne-coffre]')), aDroite: b.left >= a.right - 1, memeLigne: Math.abs(a.top - b.top) < 12 };
    });
    noter(
      '« Nouveau dossier » est à droite du titre, sur sa ligne, et plus dans la colonne',
      (await nouveauDossier.count()) === 1 && placeDuBouton?.aDroite === true && placeDuBouton.memeLigne && !placeDuBouton.dansLaColonne,
      JSON.stringify(placeDuBouton),
    );
    noter(
      'La colonne n’a plus de rubrique « Dossiers »',
      (await page.locator('[data-coffre-rubrique="dossiers"]').count()) === 0 && (await page.locator('[data-coffre-rubrique="tous"]:visible').count()) === 1,
    );
    const toutDuParent = dossierRendu.locator('[data-coffre-dossier-tout]').first();
    noter(
      'L’icône « tout ouvrir / tout fermer » est sur le parent, pas sur un dossier sans sous-dossier',
      (await dossierRendu.locator('[data-coffre-dossier-tout]').count()) === 1 && (await ligneSous.locator('[data-coffre-dossier-tout]').count()) === 0,
    );
    const nomDuParent = await dossierRendu.locator('[data-coffre-dossier-nom]').first().boundingBox();
    const nombreDuParent = await dossierRendu.locator('[data-coffre-dossier-nombre]').first().boundingBox();
    const boiteTout = await toutDuParent.boundingBox();
    noter(
      'Le nombre suit le nom du dossier, et l’icône suit le nombre',
      Boolean(
        nomDuParent &&
          nombreDuParent &&
          boiteTout &&
          nombreDuParent.x >= nomDuParent.x + nomDuParent.width - 1 &&
          nombreDuParent.x - (nomDuParent.x + nomDuParent.width) < 12 &&
          boiteTout.x >= nombreDuParent.x + nombreDuParent.width - 1 &&
          boiteTout.x - (nombreDuParent.x + nombreDuParent.width) < 24,
      ),
      `nom ${JSON.stringify(nomDuParent)}, nombre ${JSON.stringify(nombreDuParent)}, icône ${JSON.stringify(boiteTout)}`,
    );
    // Parent et sous-dossier ouverts : l'icône referme TOUTE la branche.
    if ((await toutDuParent.getAttribute('data-coffre-dossier-tout')) !== 'ouvert') await toutDuParent.click();
    await toutDuParent.click();
    noter(
      'L’icône referme le dossier ET ses sous-dossiers',
      (await dossierRendu.getAttribute('data-ouvert')) === 'non' && (await toutDuParent.getAttribute('data-coffre-dossier-tout')) === 'ferme',
    );
    await toutDuParent.click();
    await ligneSous.waitFor({ state: 'visible', timeout: 5000 });
    noter(
      '…puis rouvre toute la branche d’un clic, fiches comprises',
      (await dossierRendu.getAttribute('data-ouvert')) === 'oui' &&
        (await ligneSous.getAttribute('data-ouvert')) === 'oui' &&
        (await page.locator('[data-coffre-acces]:visible', { hasText: 'Console OVH' }).count()) === 1 &&
        (await toutDuParent.getAttribute('data-coffre-dossier-tout')) === 'ouvert',
    );
    await chercher('ovh');
    noter('Pendant une recherche, l’icône s’efface : tout est déjà ouvert', (await page.locator('[data-coffre-dossier-tout]').count()) === 0);
    await chercher('');
    await page.screenshot({ path: path.join(SHOTS, 'coffre-fort-dossiers.png') });

    /* 12. LE LIEN COUPÉ. */
    const couper = () =>
      page.evaluate(() => {
        window.__essaiLien.coupe = true;
        for (const socket of window.__essaiLien.sockets) if (socket.readyState <= 1) socket.close();
      });
    const retablir = () =>
      page.evaluate(() => {
        window.__essaiLien.coupe = false;
        sessionStorage.removeItem('essai-coupe');
        window.dispatchEvent(new Event('online'));
      });
    const lectures = () => page.evaluate(() => window.__essaiLien.listes);
    const attendreLectures = async (au_dela, limiteMs = 25000) => {
      const fin = Date.now() + limiteMs;
      while (Date.now() < fin) {
        if ((await lectures()) > au_dela) return true;
        await page.waitForTimeout(250);
      }
      return false;
    };
    const vide = page.getByText('Aucun accès enregistré pour l’instant.');
    const illisible = page.locator('[data-coffre-illisible]');

    // a. Liste chargée, lien coupé, un dossier ouvert : la liste reste là.
    const avantCoupure = await lectures();
    await couper();
    await page.waitForTimeout(1500);
    // Le dossier était déplié : on le replie puis on le rouvre, lien coupé.
    await dossierRendu.locator('[data-coffre-dossier-bascule]').first().click();
    if ((await dossierRendu.getAttribute('data-ouvert')) !== 'oui') await dossierRendu.locator('[data-coffre-dossier-bascule]').first().click();
    await page.waitForTimeout(400);
    noter(
      'Lien coupé, ouvrir un dossier garde la liste affichée',
      (await page.locator('[data-coffre-acces]').count()) > 0 && (await vide.count()) === 0 && (await illisible.count()) === 0,
      `${await page.locator('[data-coffre-acces]').count()} fiche(s) visibles`,
    );
    await retablir();
    noter('Au retour du lien, le coffre se relit seul', await attendreLectures(avantCoupure));
    await page.waitForTimeout(500);
    noter(
      'La relecture garde les dossiers dépliés',
      (await dossierRendu.getAttribute('data-ouvert')) === 'oui',
    );

    // b. Écran monté lien coupé : silhouette, puis la liste au retour du lien.
    await page.evaluate(() => sessionStorage.setItem('essai-coupe', '1'));
    await page.goto(`${BASE}#coffre`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    const silhouette = page.locator('[data-silhouette="coffre"]');
    await silhouette.first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    noter(
      'Coffre ouvert lien coupé : une silhouette, jamais « aucun accès enregistré »',
      (await silhouette.count()) > 0 && (await vide.count()) === 0 && (await illisible.count()) === 0,
      `silhouette ${await silhouette.count()}, vide ${await vide.count()}`,
    );
    await retablir();
    const listeRevenue = await page
      .locator('[data-coffre-acces]')
      .first()
      .waitFor({ state: 'visible', timeout: 25000 })
      .then(() => true)
      .catch(() => false);
    noter('…et la liste paraît seule au retour du lien', listeRevenue);

    // c. Une lecture REFUSÉE : un message et « Réessayer », pas un coffre vide.
    await page.evaluate(() => sessionStorage.setItem('essai-refuser', '1'));
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    const refusDit = await illisible
      .waitFor({ state: 'visible', timeout: 25000 })
      .then(() => true)
      .catch(() => false);
    noter(
      'Une lecture refusée dit « n’a pas pu être lu », jamais « aucun accès »',
      refusDit && (await vide.count()) === 0 && ((await illisible.textContent()) ?? '').includes('refus d’essai'),
    );
    await page.evaluate(() => {
      sessionStorage.removeItem('essai-refuser');
      window.__essaiLien.refuser = false;
    });
    if (refusDit) await page.click('[data-coffre-relire]');
    const relue = await page
      .locator('[data-coffre-acces]')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    noter('« Réessayer » relit le coffre', relue && (await illisible.count()) === 0);

    await page.screenshot({ path: path.join(SHOTS, 'coffre-fort.png') });

    /* 13. SUR TÉLÉPHONE, RIEN N'A BOUGÉ : pas de titre dessiné, pas de bouton
       « Nouveau dossier » posé dans la page — il vit dans le menu à trois points. */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    noter(
      'Téléphone : ni titre dessiné ni « Nouveau dossier » dans la page',
      // Le titre reste lu à voix haute (`sr-only`, 1 px) : on regarde sa taille, pas sa présence.
      (await page.evaluate(() => [...document.querySelectorAll('[data-titre-de-page]')].every((titre) => titre.getBoundingClientRect().height <= 2))) &&
        (await page.locator('[data-coffre-nouveau-dossier]:visible').count()) === 0,
    );
    /* 13 bis. LA LIGNE D'UN DOSSIER SUR TÉLÉPHONE (carte « Coffre-fort :
       qualité, menu et alignement ») : le nombre collé au nom, plus aucun nom
       de projet, et un seul bouton à trois points qui ouvre deux gestes. */
    const ligneTel = page.locator('[data-coffre-dossier]', { hasText: 'Serveur OVH' }).first();
    await ligneTel.waitFor({ state: 'visible', timeout: 10000 });
    const rangee = await ligneTel.evaluate((dossier) => {
      const rang = dossier.firstElementChild;
      const nom = rang.querySelector('[data-coffre-dossier-nom]').getBoundingClientRect();
      const nombre = rang.querySelector('[data-coffre-dossier-nombre]').getBoundingClientRect();
      return {
        texte: rang.textContent.replace(/\s+/g, ''),
        nom: dossier.querySelector('[data-coffre-dossier-nom]').textContent + dossier.querySelector('[data-coffre-dossier-nombre]').textContent,
        ecart: nombre.left - nom.right,
        declencheurs: rang.querySelectorAll('[data-coffre-dossier-actions]').length,
        boutonsVisibles: rang.querySelectorAll('[data-coffre-dossier-sous-dossier], [data-coffre-dossier-modifier]').length,
      };
    });
    noter(
      'Téléphone : le nombre est collé au nom, et la ligne ne dit plus le projet',
      rangee.ecart >= 0 && rangee.ecart < 12 && rangee.texte === rangee.nom.replace(/\s+/g, ''),
      JSON.stringify(rangee),
    );
    const ouvertAvant = await ligneTel.getAttribute('data-ouvert');
    await ligneTel.locator('[data-coffre-dossier-actions]').first().click();
    const menu = page.locator('[role="menu"]');
    await menu.waitFor({ state: 'visible', timeout: 5000 });
    noter(
      'Téléphone : un seul bouton à trois points par ligne, qui ouvre « Nouveau sous-dossier » et « Modifier »',
      rangee.declencheurs === 1 &&
        rangee.boutonsVisibles === 0 &&
        (await menu.locator('[role="menuitem"]').count()) === 2 &&
        (await menu.locator('[data-coffre-dossier-sous-dossier]').count()) === 1 &&
        (await menu.locator('[data-coffre-dossier-modifier]').count()) === 1 &&
        // Ouvrir le menu ne replie ni ne déplie le dossier.
        (await ligneTel.getAttribute('data-ouvert')) === ouvertAvant,
    );
    await menu.evaluate((m) => Promise.all(m.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))));
    await page.screenshot({ path: path.join(SHOTS, 'coffre-fort-telephone-menu.png') });
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden', timeout: 5000 });
    await page.screenshot({ path: path.join(SHOTS, 'coffre-fort-telephone.png') });

    noter('Aucune erreur JavaScript de page pendant le scénario', erreurs.length === 0, erreurs.join(' | '));
  } finally {
    await navigateur.close();
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis.`);
  if (echecs.length) console.log('Journal du démon :\n' + journal.join(''));
  /*
   * On SORT explicitement : le démon d'essai est un enfant aux tuyaux ouverts,
   * il tient la boucle d'événements éveillée tant qu'il vit. Sans ce départ
   * franc, le script reste pendu APRÈS avoir tout vérifié — et un contrôle qui
   * ne rend pas la main passe pour un contrôle qui n'a pas fini.
   */
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error('ÉCHEC :', error);
  console.log('Journal du démon :\n' + journal.join(''));
  process.exit(1);
});
