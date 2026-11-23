#!/usr/bin/env node
/**
 * QUAND LE LIEN EST COUPÉ, L'INTERFACE LE DIT ET N'INVENTE RIEN.
 *
 *   node scripts/verif-canal-coupe.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et
 * un FAUX moteur, ouvre une carte de cadrage dans un vrai navigateur, joue un
 * tour de cadrage complet, puis COUPE le démon pour de bon — en pleine
 * conversation, brouillon écrit dans le champ. C'est le seul moyen de juger ce
 * qui se passe hors ligne : une simulation à l'intérieur de la page ne
 * prouverait rien.
 *
 * Ce qui est vérifié, la coupure faite :
 *   1. le MESSAGE PERSISTANT de coupure paraît dans la pile de messages, en
 *      haut au centre, dit ce qui se passe — et n'a POUSSÉ AUCUN pixel de la
 *      page : c'est tout l'objet du remplacement de l'ancien bandeau ;
 *   2. le bouton d'ENVOI est éteint, et il dit pourquoi ;
 *   3. le BROUILLON reste intact dans le champ — rien ne se perd ;
 *   4. la tuile « Nouvelle tâche » est éteinte ;
 *   5. le geste du parcours est éteint, avec la raison « état inconnu ».
 *
 * Puis le démon est REDÉMARRÉ sur le même port et la même base, et on vérifie
 * que tout revient : message parti, envoi et création de carte rallumés. Le
 * retour compte autant que la coupure — un bouton resté éteint après la
 * reconnexion serait pire que le défaut d'origine.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Le dépôt d'où PART ce script — jamais un chemin écrit en dur : lancé depuis
// une copie de travail, il jugerait sinon le code du dossier principal.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_CANAL_PORT || 7217);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-canal-'));
const PROJET_ID = 'projet-canal';
const BROUILLON = 'Un texte qui ne doit surtout pas disparaître pendant la coupure.';

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le décor : un vrai dépôt git, un faux moteur                        */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
/* Un dossier personnel à soi : sans lui, le démon d'essai adopterait le compte
   Claude RÉEL de la machine, et le contrôle dépendrait du quota du jour. */
const MAISON = path.join(TMP, 'maison');
const COMPTE = path.join(TMP, 'compte-claude');
for (const dossier of [DATA, PROJETS, DEPOT, MAISON, COMPTE]) fs.mkdirSync(dossier, { recursive: true });
fs.writeFileSync(
  path.join(COMPTE, '.credentials.json'),
  JSON.stringify({ claudeAiOauth: { accessToken: 'jeton-d-essai', expiresAt: Date.now() + 3600_000 } }),
);

execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
  cwd: DEPOT,
});

const FAUX_MOTEUR = path.join(TMP, 'faux-claude.mjs');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/usr/bin/env node
if (process.argv.includes('--version')) {
  process.stdout.write('faux-moteur 0.0.0 (essai)\\n');
  process.exit(0);
}
let demande = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (demande += d));
process.stdin.on('end', () => jouer());
setTimeout(() => process.stdin.readable && process.stdin.read(), 50);
const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
async function jouer() {
  dire({ type: 'system', subtype: 'init', session_id: 'session-' + Math.random().toString(16).slice(2) });
  await new Promise((r) => setTimeout(r, 150));
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Bien reçu, je regarde.' }] } });
  dire({ type: 'result', subtype: 'success', session_id: 'session-essai', usage: { input_tokens: 10, output_tokens: 5 } });
  process.exit(0);
}
`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

/* ------------------------------------------------------------------ */
/* Le démon : on doit pouvoir le TUER puis le relancer                 */
/* ------------------------------------------------------------------ */

let demon = null;
const journal = [];

/*
 * LE DÉMON D'ESSAI VIT DANS SON PROPRE GROUPE DE PROCESSUS.
 *
 * Sans `detached`, il partage le groupe du script : un `timeout`, un Ctrl-C ou
 * un `kill` sur le script tue le script SEUL, et le démon d'essai reste vivant,
 * orphelin, à tourner sur le dépôt d'où il a été lancé — c'est-à-dire, quand le
 * contrôle est joué depuis une copie de travail, sur le dépôt de TOUS les
 * agents. Son propre groupe permet de l'emporter en entier
 * (`process.kill(-pid)`), avec tout ce qu'il aurait lui-même lancé.
 */
function lancerLeDemon() {
  demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
    detached: true,
    env: {
      ...process.env,
      BELUGA_PORT: String(PORT),
      BELUGA_HOST: '127.0.0.1',
      BELUGA_DATA: DATA,
      BELUGA_PROJECTS_ROOT: PROJETS,
      BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
      BELUGA_CLAUDE_BIN: FAUX_MOTEUR,
      HOME: MAISON,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  demon.stdout.on('data', (d) => journal.push(String(d)));
  demon.stderr.on('data', (d) => journal.push(String(d)));
}

const portOuvert = () =>
  new Promise((resolve) => {
    const prise = net.connect(PORT, '127.0.0.1');
    prise.on('connect', () => (prise.end(), resolve(true)));
    prise.on('error', () => resolve(false));
  });

/*
 * COUPER LE DÉMON D'ESSAI, ET LUI SEUL. On tue le processus qu'on a nous-mêmes
 * lancé, par son identifiant : jamais une commande qui viserait « le démon »
 * par son nom, qui emporterait le VRAI serveur de la machine.
 */
async function couperLeDemon() {
  const parti = new Promise((resolve) => demon.once('exit', resolve));
  tuerLeGroupe(demon);
  await parti;
  demon = null;
  /* Et on attend que le port soit VRAIMENT refermé : tant qu'il répond, le
     navigateur se reconnecte aussitôt et il n'y a pas de coupure à juger. */
  const fin = Date.now() + 15000;
  while (Date.now() < fin) {
    if (!(await portOuvert())) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * TUER LE DÉMON D'ESSAI ET TOUT SON GROUPE, jamais le seul processus de tête :
 * ce qu'il a lancé lui survivrait. L'identifiant reste celui du processus qu'on
 * a nous-mêmes ouvert — aucune commande ne vise « le démon » par son nom.
 */
function tuerLeGroupe(processus) {
  if (!processus?.pid) return;
  try {
    process.kill(-processus.pid, 'SIGKILL');
  } catch {
    /* le groupe est déjà parti : on retente sur le seul processus de tête */
    try {
      processus.kill('SIGKILL');
    } catch {
      /* déjà parti */
    }
  }
}

function nettoyer() {
  tuerLeGroupe(demon);
  demon = null;
  fs.rmSync(TMP, { recursive: true, force: true });
}

/*
 * ET LE NETTOYAGE RÉPOND AUX SIGNAUX, PAS SEULEMENT À UNE SORTIE ORDINAIRE.
 *
 * `process.on('exit')` ne s'exécute PAS quand le processus est tué par un
 * signal : un `timeout 480 node …` qui expire, un Ctrl-C, un `kill` de fin de
 * tour laissaient donc le démon d'essai vivant derrière eux. On intercepte les
 * trois signaux d'arrêt, on emporte le groupe, puis on sort avec le code que le
 * signal impose.
 */
process.on('exit', nettoyer);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    console.error(`\nContrôle interrompu (${signal}) : démon d’essai emporté, décor effacé — aucun bilan rendu.`);
    nettoyer();
    /* Un contrôle interrompu n'est JAMAIS un succès : il n'a pas rendu son
       bilan, et une chaîne qui lirait « 0 » le croirait passé. */
    process.exit(1);
  });
}
process.on('uncaughtException', (err) => {
  console.error(err);
  nettoyer();
  process.exit(1);
});

async function attendrePort(limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (await portOuvert()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* La base : une session d'une heure, un projet, un compte              */
/* ------------------------------------------------------------------ */

const jeton = crypto.randomBytes(24).toString('hex');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
/* La base du démon d'essai : `beluga.db` dans son dossier de données (`cheminDeLaBase`, `server/src/config.ts`). */
const cheminDeLaBase = () => path.join(DATA, 'beluga.db');
const base = (lecture = false) => new Database(cheminDeLaBase(), { readonly: lecture });

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification canal coupé',
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai canal',
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
  db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    'compte-essai',
    'claude',
    JSON.stringify({ id: 'compte-essai', engine: 'claude', label: 'Compte d’essai', priority: 1, configDir: COMPTE }),
    maintenant,
  );
  db.close();
}

const cartes = () => {
  const db = base(true);
  const lignes = db.prepare('SELECT id, column_key, title, data FROM cards').all();
  db.close();
  return lignes;
};

/* ------------------------------------------------------------------ */
/* Les repères de l'écran                                              */
/* ------------------------------------------------------------------ */

const messageDuLien = (page) => page.locator('[data-toast-persistant="canal"]');
const bandeau = (page) => page.locator('[data-bandeau-canal]');

/** Où commence le contenu de la page : c'est ce repère qui ne doit pas bouger. */
const hauteurDuContenu = (page) =>
  page.evaluate(() => {
    const zone = document.querySelector('main') ?? document.body;
    return Math.round(zone.getBoundingClientRect().top);
  });
const boutonEnvoi = (page) => page.locator('[data-composer-envoi]');
/* DEUX BOUTONS PORTENT CE REPÈRE depuis la refonte du 11/10/2026 : celui de la
   tête de « Demande » (ordinateur) et celui du bas de l'écran (téléphone, monté
   mais caché ici). Celui qu'on juge est celui de l'entête de la colonne. */
const tuileNouvelle = (page) => page.locator('[data-tete-colonne="planned"] [data-nouvelle-carte="planned"]');
const gestePrincipal = (page) => page.locator('[data-geste-principal]').first();
const champ = (page) => page.locator('textarea').first();

async function ecarterLAssistantDesMoteurs(page) {
  await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });
}

/** Attend qu'une condition devienne vraie, ou rend faux au bout du délai. */
async function attendre(condition, limiteMs = 20000, pas = 300) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, pas));
  }
  return false;
}

async function main() {
  /*
   * LE PORT DOIT ÊTRE LIBRE AVANT DE COMMENCER. Un démon d'essai resté vivant
   * d'un passage précédent répond sur ce port : `attendrePort` réussirait
   * aussitôt, le décor serait posé dans une base qui n'existe pas encore, et
   * le contrôle tomberait sur un « no such table: sessions » incompréhensible.
   * On le dit en clair, avec le geste qui débloque.
   */
  if (await portOuvert()) {
    console.error(
      `Le port ${PORT} est déjà occupé — sans doute un démon d’essai d’un passage précédent.\n` +
        `Repérez-le par « ss -ltnp | grep ${PORT} » et arrêtez-le par son identifiant, ` +
        `ou choisissez un autre port par BELUGA_CANAL_PORT.`,
    );
    process.exit(1);
  }
  lancerLeDemon();
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const contexte = await navigateur.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([
    { name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await ecarterLAssistantDesMoteurs(page);

  /* -------- 1. Une carte de cadrage, un vrai tour, un brouillon -------- */

  await tuileNouvelle(page).click();
  await page.waitForTimeout(3000);
  noter('une carte de cadrage est ouverte', cartes().length === 1, `${cartes().length} carte(s)`);

  /* UN VRAI TOUR DE CADRAGE D'ABORD. Sans lui, le geste « Générer le plan »
     serait déjà éteint pour une raison plus ancienne (« dites d'abord ce que
     vous voulez faire ») : on ne jugerait rien du lien. Le faux moteur répond,
     la compréhension est rendue, et le geste devient POSSIBLE. */
  await champ(page).fill('Je veux exporter la liste en CSV.');
  await boutonEnvoi(page).click();
  const gestePret = await attendre(
    /* PENDANT LE TOUR, le grand bouton est « Annuler » (geste `arreter`), allumé :
       on n'attend donc le lancement qu'une fois « Valider et lancer » revenu. */
    async () =>
      (await gestePrincipal(page).getAttribute('data-geste-principal')) === 'valider-et-lancer' &&
      (await gestePrincipal(page).getAttribute('aria-disabled')) !== 'true',
    30000,
  );
  noter('le lien vivant : le geste du parcours est possible', gestePret);

  await champ(page).fill(BROUILLON);
  await page.waitForTimeout(800);
  noter('le lien vivant : le bouton d’envoi est allumé', !(await boutonEnvoi(page).isDisabled()));
  noter('… et aucun message de coupure', (await messageDuLien(page).count()) === 0);
  const contenuAvant = await hauteurDuContenu(page);

  /* -------- 2. On coupe le démon POUR DE BON -------- */

  const coupe = await couperLeDemon();
  noter('le démon d’essai est bien coupé, port refermé', coupe);

  const messageParu = await attendre(async () => (await messageDuLien(page).count()) > 0, 60000);
  noter('un message paraît en haut au centre', messageParu);
  if (messageParu) {
    const texte = (await messageDuLien(page).innerText()).trim();
    noter('… et il dit ce qui se passe', /ne répond pas|redémarre|ne dit plus rien/i.test(texte), texte.slice(0, 80));
    const boite = await messageDuLien(page).boundingBox();
    const largeur = page.viewportSize().width;
    const centre = boite ? Math.round(boite.x + boite.width / 2) : 0;
    noter('… posé au centre, pas en travers', boite != null && Math.abs(centre - largeur / 2) <= 40, `centre ${centre}px`);
    noter('… sans bouton « reconnecter » qui ne ferait rien', (await page.locator('[data-toast-reconnecter]').count()) === 0);
    noter('… sans compte à rebours qui l’effacerait', (await messageDuLien(page).locator('[data-barre-message]').count()) === 0);
  }
  noter('PLUS AUCUN BANDEAU EN FLUX', (await bandeau(page).count()) === 0);
  const contenuPendant = await hauteurDuContenu(page);
  noter(
    'la page n’a pas bougé d’un pixel',
    contenuAvant === contenuPendant,
    `avant ${contenuAvant}px, pendant ${contenuPendant}px`,
  );

  /* UN ÉTAT NE SE FERME PAS À LA MAIN : sa croix n'existe pas, et le geste de
     balayage ne l'emporte pas non plus. */
  if (messageParu) {
    const boite = await messageDuLien(page).boundingBox();
    if (boite) {
      await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2);
      await page.mouse.down();
      /* LE GESTE RESTE DANS LE MESSAGE : relâché en dehors, il traverserait
         jusqu'au tableau et y déplacerait une carte. */
      await page.mouse.move(boite.x + 10, boite.y + boite.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(600);
    }
    noter('le message ne se balaie pas : il dit un état', (await messageDuLien(page).count()) > 0);
  }

  const envoiEteint = await attendre(async () => await boutonEnvoi(page).isDisabled());
  noter('le bouton d’envoi est éteint', envoiEteint);
  if (envoiEteint) {
    const raison = (await boutonEnvoi(page).getAttribute('title')) ?? '';
    noter('… et il dit pourquoi', /ne répond pas/i.test(raison), raison.slice(0, 80));
  }

  /* LE BROUILLON EST LE CŒUR DU CONTRÔLE : un envoi refusé qui vide le champ
     perd le texte, et c'est précisément ce qu'on a choisi d'éviter — contre la
     mise en file. On CLIQUE quand même, pour prouver que le refus ne mange
     rien. */
  await boutonEnvoi(page).click({ force: true }).catch(() => {});
  await page.waitForTimeout(1200);
  const reste = await champ(page).inputValue();
  noter('le brouillon est resté intact', reste.trim() === BROUILLON, `« ${reste.slice(0, 40)}… »`);

  noter('la tuile « Nouvelle tâche » est éteinte', await tuileNouvelle(page).isDisabled());

  const geste = gestePrincipal(page);
  if (await geste.count()) {
    const eteint = (await geste.getAttribute('aria-disabled')) === 'true';
    const raison = (await geste.getAttribute('title')) ?? '';
    noter('le geste du parcours est éteint', eteint);
    noter('… avec la raison « état inconnu »', /état inconnu|ne répond plus/i.test(raison), raison.slice(0, 80));
  } else {
    noter('le geste du parcours est affiché', false, 'aucun bouton de geste trouvé');
  }

  /* -------- 3. Le démon revient : tout doit se rallumer -------- */

  lancerLeDemon();
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas redémarré :\n' + journal.join(''));
    process.exit(1);
  }

  const messageParti = await attendre(async () => (await messageDuLien(page).count()) === 0, 60000);
  noter('le message disparaît une fois le lien rétabli', messageParti);
  noter('… et le contenu est resté à sa place', (await hauteurDuContenu(page)) === contenuAvant);

  const envoiRevenu = await attendre(async () => !(await boutonEnvoi(page).isDisabled()), 40000);
  noter('le bouton d’envoi se rallume', envoiRevenu);
  noter('la tuile « Nouvelle tâche » se rallume', !(await tuileNouvelle(page).isDisabled()));
  noter('le brouillon a traversé toute la coupure', (await champ(page).inputValue()).trim() === BROUILLON);

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles au vert`);
  if (echecs.length) {
    console.log('Journal du démon :\n' + journal.join('').slice(-3000));
    process.exit(1);
  }
  /*
   * ET ON SORT POUR DE BON. Le démon d'essai relancé en fin de contrôle tient
   * ses tuyaux de sortie ouverts : la boucle d'événements ne se vide jamais, et
   * le script restait pendu APRÈS avoir tout affiché au vert — au point qu'un
   * `timeout` finissait par le tuer, rendant un échec sur un contrôle réussi.
   * `nettoyer()` part sur l'événement `exit`, donc le démon meurt avec nous.
   */
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  console.error(journal.join('').slice(-3000));
  process.exit(1);
});
