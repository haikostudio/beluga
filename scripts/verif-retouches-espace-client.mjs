#!/usr/bin/env node
/**
 * LES SEPT RETOUCHES DE L'ESPACE CLIENT, VÉRIFIÉES BOUT EN BOUT.
 *
 *   npm run build && node scripts/verif-retouches-espace-client.mjs
 *
 * Un vrai démon, une vraie session cliente, un vrai navigateur. Ce qui est
 * vérifié, dans l'ordre :
 *
 *   1. LES NON-LUS — le même fil rend DEUX chiffres : Haiko qui écrit trois
 *      messages voit zéro, le client en voit trois. Et réciproquement. C'est le
 *      défaut le plus visible du lot : chacun voyait grossir SA pastille en
 *      écrivant ;
 *   2. LES MESSAGES PASSAGERS — la pile COMMUNE, en haut au centre, plus la
 *      pile locale en bas à droite ;
 *   3. « ACCÈS » ET « BACKUPS » — le TIROIR de l'application (`Drawer`, qui
 *      rend une PAGE depuis la refonte du 11/10/2026 : même composant, même
 *      repère `data-tiroir`), et le tiroir PLEIN sur téléphone ;
 *   4. LES DEMANDES ARCHIVÉES — un filtre de CHAQUE colonne, chacune
 *      indépendante, et plus rien dans le menu burger ;
 *   5. LE THÈME — un bouton en icône seule qui parcourt trois états, gardé sur
 *      le COMPTE : un autre navigateur, le même compte, le même thème ;
 *   6. LE PROFIL — nom, adresse, identifiant, mot de passe ; un mauvais mot de
 *      passe actuel refuse, un identifiant déjà pris refuse, et aucune de ces
 *      commandes ne peut viser un AUTRE compte ;
 *   7. LE TITRE ET LA DESCRIPTION — du texte, un bouton d'édition, un champ qui
 *      s'ouvre à la place exacte sans décaler la fiche.
 *
 * `better-sqlite3` et `ws` s'importent normalement : le contrôle juge le dépôt
 * d'où il part, jamais le dépôt principal.
 *
 * LE CONTRÔLE REND LA MAIN PAR `process.exit` : le démon d'essai, encore vivant,
 * retiendrait sinon le processus indéfiniment (voir la fin du fichier).
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import * as ws from 'ws';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_RETOUCHES_PORT || 7215);
/** L'adresse cliente, ramenée sur la machine par le résolveur du navigateur. */
const HOTE = 'my.test';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-retouches-espace-'));
const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
for (const dossier of [DATA, PROJETS]) fs.mkdirSync(dossier, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

let demon = null;
let navigateur = null;
const journal = [];

function nettoyer() {
  try {
    demon?.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
}
process.on('exit', nettoyer);

/* ------------------------------------------------------------------ */
/* Le démon                                                            */
/* ------------------------------------------------------------------ */

demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));

async function attendrePort(limiteMs = 90000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

if (!(await attendrePort())) {
  console.error('le démon n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Le décor : un projet, deux clients, une session d'administration    */
/* ------------------------------------------------------------------ */

const PROJET = 'p-retouches';
const IDENTIFIANT = 'client-retouches';
const MOT_DE_PASSE = 'mot-de-passe-essai-2026';
/** Un SECOND client : il sert à prouver qu'un identifiant déjà pris est refusé. */
const VOISIN = 'voisin-retouches';
const jetonAdmin = crypto.randomBytes(24).toString('hex');
const jetonClient = crypto.randomBytes(24).toString('hex');
const sha = (valeur) => crypto.createHash('sha256').update(valeur).digest('hex');
const base = () => new Database(path.join(DATA, 'beluga.db'));

{
  const comptes = await import(path.join(RACINE, 'server/dist/comptes.js'));
  fs.mkdirSync(path.join(PROJETS, 'retouches'), { recursive: true });
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
    PROJET,
    'Projet retouches',
    path.join(PROJETS, 'retouches'),
    0,
    JSON.stringify({
      id: PROJET,
      name: 'Projet retouches',
      path: path.join(PROJETS, 'retouches'),
      archived: false,
      createdAt: maintenant,
      updatedAt: maintenant,
    }),
    maintenant,
    maintenant,
  );
  const poser = (id, identifiant, nom) => {
    const sel = crypto.randomBytes(16);
    db.prepare(
      `INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le)
       VALUES (?, ?, 'client', ?, ?, ?, 1, ?)`,
    ).run(id, identifiant, nom, sel.toString('hex'), comptes.empreinte(MOT_DE_PASSE, sel), maintenant);
    db.prepare('INSERT INTO user_projects (user_id, project_id) VALUES (?, ?)').run(id, PROJET);
  };
  poser('u-retouches', IDENTIFIANT, 'Client des retouches');
  poser('u-voisin', VOISIN, 'Voisin');

  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  for (const [jeton, userId] of [
    [jetonAdmin, admin?.id ?? null],
    [jetonClient, 'u-retouches'],
  ]) {
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?,?,?,?,?)').run(
      sha(jeton),
      maintenant,
      maintenant + 3600_000,
      'vérification retouches',
      userId,
    );
  }
  db.close();
}

/* ------------------------------------------------------------------ */
/* Le canal                                                            */
/* ------------------------------------------------------------------ */

function ouvrirCanal(jeton) {
  return new Promise((resolve, reject) => {
    const socket = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { cookie: `beluga_session=${jeton}` },
    });
    const attentes = new Map();
    const recus = [];
    socket.on('message', (brut) => {
      const event = JSON.parse(brut.toString());
      recus.push(event);
      if (event.type === 'ack' && attentes.has(event.id)) {
        const { resoudre } = attentes.get(event.id);
        attentes.delete(event.id);
        resoudre(event);
      }
    });
    socket.on('open', () =>
      resolve({
        socket,
        recus,
        demander: (cmd, delaiMs = 10000) =>
          new Promise((resoudre) => {
            const id = crypto.randomBytes(6).toString('hex');
            attentes.set(id, { resoudre });
            socket.send(JSON.stringify({ id, cmd }));
            setTimeout(() => {
              if (attentes.has(id)) {
                attentes.delete(id);
                resoudre({ ok: false, error: 'sans réponse' });
              }
            }, delaiMs);
          }),
      }),
    );
    socket.on('error', reject);
  });
}

const canalAdmin = await ouvrirCanal(jetonAdmin);
const canalClient = await ouvrirCanal(jetonClient);
await new Promise((r) => setTimeout(r, 1500));

/* ------------------------------------------------------------------ */
/* 1. LE MÊME FIL REND DEUX CHIFFRES                                   */
/* ------------------------------------------------------------------ */

const FIL = 'u-retouches';
const comptesDuFil = async () => {
  const cote = await canalAdmin.demander({ type: 'espace.etat', projectId: PROJET, filId: FIL });
  const chez = await canalClient.demander({ type: 'espace.etat', projectId: PROJET });
  return { haiko: cote.data?.nonLus?.messages ?? -1, client: chez.data?.nonLus?.messages ?? -1 };
};

for (let i = 0; i < 3; i += 1) {
  await canalAdmin.demander({ type: 'espace.fil.envoyer', filId: FIL, texte: `Message de Haiko ${i + 1}` });
}
{
  const vus = await comptesDuFil();
  noter(
    'trois messages de Haiko : zéro pour lui, trois pour le client',
    vus.haiko === 0 && vus.client === 3,
    JSON.stringify(vus),
  );
}

await canalClient.demander({ type: 'espace.fil.envoyer', filId: FIL, texte: 'Réponse du client' });
{
  const vus = await comptesDuFil();
  noter(
    'la réponse du client compte pour Haiko, et jamais pour son auteur',
    vus.haiko === 1 && vus.client === 3,
    JSON.stringify(vus),
  );
}

await canalClient.demander({ type: 'espace.fil.vu', filId: FIL });
{
  const vus = await comptesDuFil();
  noter(
    'lire le fil éteint SA pastille, et laisse celle d’en face allumée',
    vus.client === 0 && vus.haiko === 1,
    JSON.stringify(vus),
  );
}

/* ------------------------------------------------------------------ */
/* 6 bis. MON COMPTE NE VISE QUE LE MIEN                               */
/* ------------------------------------------------------------------ */

{
  const refus = await canalClient.demander({ type: 'comptes.renommer', id: 'u-voisin', nomAffiche: 'Pirate' });
  noter('un client ne renomme pas le compte du voisin', refus.ok === false, refus.error ?? '');

  const mauvais = await canalClient.demander({
    type: 'espace.moi.motDePasse',
    actuel: 'ce-n-est-pas-le-bon',
    nouveau: 'un-mot-de-passe-tout-neuf',
  });
  noter('un mauvais mot de passe actuel refuse le changement', mauvais.ok === false, mauvais.error ?? '');

  const pris = await canalClient.demander({
    type: 'espace.moi.identifiant',
    identifiant: VOISIN,
    motDePasse: MOT_DE_PASSE,
  });
  noter('un identifiant déjà pris est refusé', pris.ok === false, pris.error ?? '');

  const ok = await canalClient.demander({
    type: 'espace.moi.profil',
    nomAffiche: 'Nom changé par moi',
    courriel: 'moi@exemple.test',
  });
  noter(
    'mon nom et mon adresse se changent, sur MON compte',
    ok.ok === true && ok.data?.nomAffiche === 'Nom changé par moi' && ok.data?.courriel === 'moi@exemple.test',
    JSON.stringify(ok.data ?? ok.error),
  );

  const voisin = base().prepare("SELECT nom_affiche FROM users WHERE id = 'u-voisin'").get();
  noter('…et le compte du voisin n’a pas bougé d’un signe', voisin.nom_affiche === 'Voisin', voisin.nom_affiche);
}

/* Le THÈME s'enregistre sur le compte : c'est lui qu'un autre appareil relira. */
{
  const pose = await canalClient.demander({ type: 'espace.moi.apparence', apparence: 'clair' });
  const ligne = base().prepare("SELECT apparence FROM users WHERE id = 'u-retouches'").get();
  noter(
    'le thème choisi s’enregistre sur le COMPTE, pas dans le navigateur',
    pose.ok === true && ligne.apparence === 'clair',
    String(ligne?.apparence),
  );
  const refus = await canalClient.demander({ type: 'espace.moi.apparence', apparence: 'violet-fluo' });
  noter('une apparence inconnue est refusée, jamais gardée', refus.ok === false, refus.error ?? '');
}

/* Une demande à ouvrir dans le navigateur, et une autre à archiver. */
let demandeOuverte = null;
{
  const creee = await canalClient.demander({
    type: 'espace.demande.creer',
    projectId: PROJET,
    titre: 'Refaire la page d’accueil',
    description: 'Avec le nouveau logo et les nouvelles photos.',
  });
  demandeOuverte = creee.data?.id ?? creee.data?.demande?.id ?? null;
  const rangee = await canalClient.demander({
    type: 'espace.demande.creer',
    projectId: PROJET,
    titre: 'Une demande déjà réglée',
    description: 'Elle sera rangée.',
  });
  const idRangee = rangee.data?.id ?? rangee.data?.demande?.id ?? null;
  if (idRangee) await canalClient.demander({ type: 'espace.demande.archiver', id: idRangee, archivee: true });
  noter('le décor porte une demande vivante et une demande rangée', Boolean(demandeOuverte && idRangee));
}

canalAdmin.socket.close();
canalClient.socket.close();

/* ------------------------------------------------------------------ */
/* Le navigateur                                                       */
/* ------------------------------------------------------------------ */

const RACINE_CLIENTE = `http://${HOTE}:${PORT}`;

navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', `--host-resolver-rules=MAP ${HOTE} 127.0.0.1`],
});

const erreurs = [];
async function entrer(contexte) {
  const page = await contexte.newPage();
  page.on('pageerror', (e) => erreurs.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));
  await page.goto(RACINE_CLIENTE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('input[name="username"]', IDENTIFIANT);
  await page.fill('input[name="password"]', MOT_DE_PASSE);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('button[type="submit"]')]);
  await page.waitForSelector('[data-espace-client]', { timeout: 30000 });
  return page;
}

const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
const page = await entrer(contexte);

async function ouvrirLeBurger() {
  await page.click('[data-menu-actions="espace-menu"]');
  await page.waitForSelector('[data-basculer-backups]', { timeout: 10000 });
}
async function ouvrirLeFiltre(colonne) {
  await page.click(`[data-menu-actions="filtre-${colonne}"]`);
  await page.waitForSelector(`[data-filtre-archivees]`, { timeout: 10000 });
}
async function fermerLeTiroir() {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
}

/* ------------------------------------------------------------------ */
/* 5. LE THÈME : UN BOUTON, TROIS ÉTATS, GARDÉ SUR LE COMPTE           */
/* ------------------------------------------------------------------ */

{
  const bouton = page.locator('[data-bouton-theme]');
  noter('l’entête porte un bouton de thème, en icône seule', (await bouton.count()) === 1);
  noter(
    'le bouton n’a aucun libellé écrit, seulement une icône et un nom accessible',
    ((await bouton.textContent()) ?? '').trim() === '' && Boolean(await bouton.getAttribute('aria-label')),
  );
  /* LE COMPTE DIT « clair » : c'est CE thème qui est posé, pas celui du système. */
  noter(
    'le thème du compte est appliqué dès l’arrivée',
    (await page.getAttribute('html', 'data-theme')) === 'clair' &&
      (await bouton.getAttribute('data-bouton-theme')) === 'clair',
    `${await page.getAttribute('html', 'data-theme')} · ${await bouton.getAttribute('data-bouton-theme')}`,
  );

  const parcours = [];
  for (let i = 0; i < 3; i += 1) {
    await bouton.click();
    await page.waitForTimeout(250);
    parcours.push(await bouton.getAttribute('data-bouton-theme'));
  }
  noter(
    'trois clics parcourent les trois états et reviennent au départ',
    JSON.stringify(parcours) === JSON.stringify(['sombre', 'auto', 'clair']),
    parcours.join(' → '),
  );

  /* UN AUTRE NAVIGATEUR, LE MÊME COMPTE : le choix suit la personne. */
  await page.locator('[data-bouton-theme]').click();
  await page.waitForTimeout(600);
  const voulu = await page.getAttribute('html', 'data-theme');
  const autre = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
  const pageAilleurs = await entrer(autre);
  await pageAilleurs.waitForTimeout(600);
  noter(
    'un autre navigateur, le même compte : le même thème',
    (await pageAilleurs.getAttribute('html', 'data-theme')) === voulu,
    `${voulu} contre ${await pageAilleurs.getAttribute('html', 'data-theme')}`,
  );
  await autre.close();
}

/* ------------------------------------------------------------------ */
/* 4. LES DEMANDES ARCHIVÉES, COLONNE PAR COLONNE                      */
/* ------------------------------------------------------------------ */

{
  await ouvrirLeBurger();
  noter(
    'la bascule « Demandes archivées » a quitté le menu burger',
    (await page.locator('[data-basculer-archivees]').count()) === 0,
  );
  await fermerLeTiroir();

  const vivantes = await page.locator('[data-demande]').count();
  await ouvrirLeFiltre('a-faire');
  await page.click('[data-filtre-archivees]');
  await fermerLeTiroir();
  await page.waitForTimeout(400);
  noter(
    '« À faire » montre ses archives, et les autres colonnes ne bougent pas',
    (await page.locator('[data-colonne-kanban="a-faire"] [data-demande]').count()) === 1 &&
      (await page.locator('[data-colonne-kanban="termine"] [data-demande]').count()) === 0,
    `à faire : ${await page.locator('[data-colonne-kanban="a-faire"] [data-demande]').count()}`,
  );
  noter(
    'le « + » s’efface tant que « À faire » regarde ses archives',
    (await page.locator('[data-nouvelle-demande]').count()) === 0,
  );
  await ouvrirLeFiltre('a-faire');
  await page.click('[data-filtre-archivees]');
  await fermerLeTiroir();
  await page.waitForTimeout(400);
  noter(
    'le filtre éteint, le tableau revient aux demandes vivantes',
    (await page.locator('[data-demande]').count()) === vivantes,
    `${await page.locator('[data-demande]').count()} contre ${vivantes}`,
  );
}

/* ------------------------------------------------------------------ */
/* 3. « ACCÈS » ET « BACKUPS » SONT DES TIROIRS                        */
/* ------------------------------------------------------------------ */

for (const [nom, repere] of [
  ['Backups', 'backups'],
  ['Accès', 'acces'],
]) {
  await ouvrirLeBurger();
  await page.click(`[data-basculer-${repere}]`);
  await page.waitForTimeout(500);
  noter(
    `« ${nom} » s’ouvre dans le TIROIR de l’application`,
    (await page.locator(`[data-tiroir] [data-volet-espace="${repere}"]`).count()) === 1 &&
      (await page.locator('[data-volet-ancre]').count()) === 0,
  );
  await fermerLeTiroir();
  noter(`« ${nom} » se referme à la touche d’échappement`, (await page.locator('[data-volet-espace]').count()) === 0);
}

/* ------------------------------------------------------------------ */
/* 6. L'ÉCRAN DE PROFIL                                                */
/* ------------------------------------------------------------------ */

{
  await ouvrirLeBurger();
  await page.click('[data-ouvrir-profil]');
  await page.waitForSelector('[data-profil-charge]', { timeout: 15000 });
  noter(
    'le profil s’ouvre en tiroir, comme les autres écrans',
    (await page.locator('[data-tiroir] [data-tiroir-profil]').count()) === 1,
  );
  noter(
    'il porte les trois blocs : informations, identifiant, mot de passe',
    (await page.locator('[data-bloc-profil]').count()) === 3,
    String(await page.locator('[data-bloc-profil]').count()),
  );
  noter(
    'il montre l’identifiant et l’adresse déjà enregistrés',
    (await page.inputValue('[data-champ-identifiant-profil]')) === IDENTIFIANT &&
      (await page.inputValue('[data-champ-courriel-profil]')) === 'moi@exemple.test',
  );

  /* UN IDENTIFIANT DÉJÀ PRIS EST REFUSÉ, ET L'ÉCRAN LE DIT. */
  await page.fill('[data-champ-identifiant-profil]', VOISIN);
  await page.fill('[data-champ-mot-de-passe-identifiant]', MOT_DE_PASSE);
  await page.click('[data-enregistrer-identifiant]');
  await page.waitForTimeout(900);
  noter(
    'un identifiant déjà pris est refusé, et la raison s’affiche',
    /déjà pris/i.test((await page.textContent('[data-erreur-profil]').catch(() => '')) ?? ''),
    ((await page.textContent('[data-erreur-profil]').catch(() => '')) ?? '').trim(),
  );

  /* ET UN IDENTIFIANT LIBRE PASSE, SANS METTRE PERSONNE DEHORS. */
  await page.fill('[data-champ-identifiant-profil]', 'client-renomme');
  await page.fill('[data-champ-mot-de-passe-identifiant]', MOT_DE_PASSE);
  await page.click('[data-enregistrer-identifiant]');
  await page.waitForTimeout(900);
  noter(
    'un identifiant libre passe, et la session reste ouverte',
    (await page.inputValue('[data-champ-identifiant-profil]')) === 'client-renomme' &&
      (await page.locator('[data-espace-client]').count()) === 1,
  );

  /* ON REMET L'IDENTIFIANT DE DÉPART : la suite du contrôle s'y connecte, et
     l'aller-retour prouve au passage qu'un identifiant libéré se reprend. */
  await page.fill('[data-champ-identifiant-profil]', IDENTIFIANT);
  await page.fill('[data-champ-mot-de-passe-identifiant]', MOT_DE_PASSE);
  await page.click('[data-enregistrer-identifiant]');
  await page.waitForTimeout(900);
  noter(
    'l’identifiant libéré se reprend',
    (await page.inputValue('[data-champ-identifiant-profil]')) === IDENTIFIANT,
  );
  await fermerLeTiroir();
}

/* ------------------------------------------------------------------ */
/* 2. LES MESSAGES PASSAGERS, EN HAUT AU CENTRE                        */
/* ------------------------------------------------------------------ */

{
  const canal = await ouvrirCanal(jetonAdmin);
  await new Promise((r) => setTimeout(r, 800));
  await canal.demander({ type: 'espace.fil.envoyer', filId: FIL, texte: 'Un mot qui fait paraître un message.' });
  await page.waitForSelector('[data-toast-client]', { timeout: 15000 }).catch(() => undefined);
  const place = await page.evaluate(() => {
    const bloc = document.querySelector('[data-bloc="toasts"]');
    const message = document.querySelector('[data-toast-client]');
    if (!bloc || !message) return null;
    const b = bloc.getBoundingClientRect();
    return {
      dansLaPileCommune: bloc.contains(message),
      enHaut: b.top < window.innerHeight / 3,
      centre: Math.abs(b.left + b.width / 2 - window.innerWidth / 2) < 4,
      ancienneePile: document.querySelectorAll('[data-toasts-client]').length,
    };
  });
  noter(
    'les messages passagers du client sont dans la pile COMMUNE, en haut au centre',
    Boolean(place) && place.dansLaPileCommune && place.enHaut && place.centre && place.ancienneePile === 0,
    JSON.stringify(place),
  );
  canal.socket.close();
}

/* ------------------------------------------------------------------ */
/* 7. LE TITRE ET LA DESCRIPTION : LECTURE, PUIS ÉDITION EN PLACE      */
/* ------------------------------------------------------------------ */

{
  await page.locator('[data-ouvrir-demande]').first().click();
  await page.waitForSelector('[data-fiche-chargee]', { timeout: 20000 });
  await page.waitForTimeout(400);

  noter(
    'le titre et la description se LISENT, ce ne sont plus des champs ouverts',
    (await page.locator('[data-texte-lu="titre"]').count()) === 1 &&
      (await page.locator('[data-texte-lu="description"]').count()) === 1 &&
      (await page.locator('[data-champ-edition]').count()) === 0,
  );

  const avant = await page.evaluate(() => {
    const bloc = document.querySelector('[data-texte-editable="description"]');
    const r = bloc.getBoundingClientRect();
    return { haut: r.top, hauteur: r.height };
  });

  await page.locator('[data-ouvrir-edition="description"]').click();
  await page.waitForSelector('[data-champ-edition="description"]', { timeout: 10000 });
  const apres = await page.evaluate(() => {
    const bloc = document.querySelector('[data-texte-editable="description"]');
    const r = bloc.getBoundingClientRect();
    return { haut: r.top, hauteur: r.height };
  });
  noter(
    'le champ s’ouvre à la place exacte du texte, sans décaler ce qui l’entoure',
    Math.abs(apres.hauteur - avant.hauteur) <= 4,
    `${JSON.stringify(avant)} → ${JSON.stringify(apres)}`,
  );

  /* ANNULER REMET LE TEXTE D'AVANT, jamais celui qu'on tapait. */
  await page.fill('[data-champ-edition="description"]', 'Un texte qu’on ne gardera pas.');
  await page.click('[data-annuler-edition="description"]');
  await page.waitForTimeout(300);
  noter(
    'annuler remet le texte d’avant',
    ((await page.textContent('[data-texte-lu="description"]')) ?? '').includes('nouveau logo'),
  );

  /* ET VALIDER L'ENREGISTRE POUR DE BON. */
  await page.locator('[data-ouvrir-edition="titre"]').click();
  await page.waitForSelector('[data-champ-edition="titre"]', { timeout: 10000 });
  await page.fill('[data-champ-edition="titre"]', 'Titre changé sur place');
  await page.click('[data-valider-edition="titre"]');
  await page.waitForTimeout(900);
  noter(
    'valider enregistre le titre, qui redevient du texte',
    ((await page.textContent('[data-texte-lu="titre"]')) ?? '').trim() === 'Titre changé sur place' &&
      (await page.locator('[data-champ-edition="titre"]').count()) === 0,
  );
  await fermerLeTiroir();
}

/* ------------------------------------------------------------------ */
/* 3 bis. SUR TÉLÉPHONE, LE TIROIR EST PLEIN                           */
/* ------------------------------------------------------------------ */

{
  const mobile = await navigateur.newContext({
    viewport: { width: 390, height: 780 },
    locale: 'fr-CH',
    hasTouch: true,
    isMobile: true,
  });
  const petit = await entrer(mobile);
  await petit.click('[data-menu-actions="espace-menu"]');
  await petit.waitForSelector('[data-basculer-backups]', { timeout: 10000 });
  await petit.click('[data-basculer-backups]');
  await petit.waitForTimeout(800);
  const feuille = await petit.evaluate(() => {
    const tiroir = document.querySelector('[data-volet-espace]')?.closest('[data-tiroir]');
    if (!tiroir) return null;
    const boite = tiroir.getBoundingClientRect();
    return { mode: tiroir.dataset.tiroir, part: boite.height / window.innerHeight };
  });
  noter(
    'sur téléphone, « Backups » occupe le tiroir PLEIN',
    Boolean(feuille) && feuille.mode === 'plein' && feuille.part > 0.95,
    JSON.stringify(feuille),
  );

  /* L'ENTÊTE TIENT TOUJOURS SUR UN SEUL RANG, BOUTON DE THÈME COMPRIS. */
  await petit.keyboard.press('Escape');
  await petit.waitForTimeout(400);
  const rang = await petit.evaluate(() => {
    const entete = document.querySelector('[data-entete-espace]');
    const reperes = [...entete.querySelectorAll('[data-bouton-theme], [data-menu-actions="espace-menu"]')];
    const hauts = reperes.map((el) => el.getBoundingClientRect().top);
    return { reperes: reperes.length, ecart: Math.round(Math.max(...hauts) - Math.min(...hauts)) };
  });
  noter(
    'l’entête tient sur UN SEUL rang, bouton de thème compris',
    rang.reperes >= 2 && rang.ecart <= 12,
    `repères : ${rang.reperes} · écart : ${rang.ecart} px`,
  );

  /* LE BOUTON D'ÉDITION RESTE ATTEIGNABLE LÀ OÙ LE SURVOL N'EXISTE PAS. */
  await petit.locator('[data-ouvrir-demande]').first().click();
  await petit.waitForSelector('[data-fiche-chargee]', { timeout: 20000 });
  await petit.waitForTimeout(500);
  const visible = await petit.evaluate(() => {
    const bouton = document.querySelector('[data-ouvrir-edition="description"]');
    if (!bouton) return null;
    return Number(getComputedStyle(bouton).opacity);
  });
  noter(
    'sur téléphone, le bouton d’édition reste visible — il n’y a pas de survol',
    visible !== null && visible > 0.2,
    String(visible),
  );
  await mobile.close();
}

/* ------------------------------------------------------------------ */
/* La console                                                          */
/* ------------------------------------------------------------------ */

const graves = erreurs.filter((e) => !/favicon|manifest|service worker/i.test(e));
noter('aucune erreur dans la console du navigateur', graves.length === 0, graves.slice(0, 3).join(' | '));

await contexte.close();
await navigateur.close();

const rates = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés.`);
if (rates.length) {
  console.error('\n--- démon ---\n' + journal.join('').slice(-2000));
  process.exit(1);
}
/*
 * LA SORTIE SE DEMANDE, ELLE NE VIENT PAS TOUTE SEULE. Le démon d'essai est un
 * processus enfant encore vivant, ses deux tuyaux de journal sont ouverts :
 * tant qu'ils le sont, Node ne rend pas la main. Sans cette ligne, un contrôle
 * entièrement vert restait suspendu jusqu'à ce qu'on le coupe (420 s au
 * passage du 11/10/2026) — et passait pour une panne. `nettoyer`, branché sur
 * `exit`, tue le démon et retire le dossier temporaire.
 */
process.exit(0);
