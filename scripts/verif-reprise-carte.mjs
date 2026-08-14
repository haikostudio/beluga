#!/usr/bin/env node
/*
 * UNE CARTE INTERROMPUE SE « REPREND », ELLE NE REPART PAS DE ZÉRO.
 *
 * Trois promesses, jouées pour de vrai sur un DÉPÔT GIT JETABLE — aucun moteur
 * appelé, aucune base réelle touchée :
 *
 *  1. LE TRAVAIL DÉJÀ FAIT N'EST PAS PERDU. Une copie de travail de carte où
 *     traînent des fichiers modifiés est ENREGISTRÉE d'office sur la branche de
 *     la carte, puis la branche rejoint la principale : le travail est là,
 *     déployable, au lieu de dormir dans un dossier que rien ne referme.
 *  2. LE DÉMON SAIT QUE DU CODE EST DÉJÀ LÀ (`travailDejaSurLaBranche`) — c'est
 *     ce constat qui évite le « réponse rendue, mais aucun fichier n'a changé »
 *     sur une carte dont le code était bel et bien écrit.
 *  3. L'ÉCRAN LE DIT. Le bouton s'appelle « Reprendre », le pied de colonne
 *     « Tout reprendre », et la consigne envoyée à l'agent sépare ce qui est
 *     fait de ce qui reste.
 *
 *   node scripts/verif-reprise-carte.mjs
 */

import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const echecs = [];
function verifier(condition, message) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.error(`  ✗ ${message}`);
    echecs.push(message);
  }
}

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/* ------------------------------------------------------------------ */
console.log('\n1. Un dépôt jetable, une carte qui a travaillé sans enregistrer');
/* ------------------------------------------------------------------ */

const projet = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-reprise-'));
git(projet, 'init', '-b', 'main');
git(projet, 'config', 'user.email', 'essai@haikodev');
git(projet, 'config', 'user.name', 'Essai HaikoDev');
fs.writeFileSync(path.join(projet, 'depart.txt'), 'état de départ\n');
git(projet, 'add', 'depart.txt');
git(projet, 'commit', '-m', 'départ');

const partage = await import(path.join(RACINE, 'shared/dist/index.js'));
const dossiers = await import(path.join(RACINE, 'server/dist/dossier-de-carte.js'));
const {
  LIBELLE_LANCER,
  LIBELLE_REPRENDRE,
  RAISON_COUPE_EN_VOL,
  carteSeReprend,
  consigneDeReprise,
  libelleDeLancement,
  libelleDuLotDeLancement,
  mentionDeReprise,
  nomDeBranche,
  origineDeReprise,
} = partage;

const carte = { id: 'abc123def', title: 'Carte d’essai' };
const branche = nomDeBranche(carte.title, carte.id);
const ouvert = await dossiers.ouvrirDossierDeCarte(projet, carte);
verifier(ouvert.kind === 'pret', 'la copie de travail de la carte s’ouvre sur sa branche');
verifier(ouvert.branche === branche, `elle est bien sur « ${branche} »`);

/* L'agent a écrit deux fichiers, puis le serveur s'est arrêté : rien n'est enregistré. */
fs.writeFileSync(path.join(ouvert.dossier, 'travail.txt'), 'ce que l’agent avait écrit\n');
fs.writeFileSync(path.join(ouvert.dossier, 'depart.txt'), 'état de départ, modifié\n');
verifier(
  git(ouvert.dossier, 'status', '--porcelain').length > 0,
  'du travail non enregistré traîne dans la copie, comme après une coupure',
);

/* ------------------------------------------------------------------ */
console.log('\n2. Le travail en cours est enregistré d’office, jamais perdu');
/* ------------------------------------------------------------------ */

const enregistre = await dossiers.enregistrerLeTravailEnCours(ouvert.dossier);
verifier(enregistre === true, 'l’enregistrement d’office a bien eu lieu');
verifier(
  git(ouvert.dossier, 'status', '--porcelain').length === 0,
  'la copie est propre : plus rien ne traîne hors du dépôt',
);
verifier(
  git(ouvert.dossier, 'log', '-1', '--format=%s') === dossiers.MESSAGE_TRAVAIL_SAUVE,
  'l’enregistrement dit ce qu’il est, en toutes lettres',
);
verifier(
  git(projet, 'show', `${branche}:travail.txt`).includes('ce que l’agent avait écrit'),
  'le fichier écrit par l’agent vit sur la branche de la carte',
);

/* ------------------------------------------------------------------ */
console.log('\n3. Le démon voit que du code est DÉJÀ là');
/* ------------------------------------------------------------------ */

verifier(
  (await dossiers.travailDejaSurLaBranche(projet, branche, ouvert.dossier)) === true,
  'la branche porte du travail que la principale n’a pas',
);
verifier(
  (await dossiers.travailDejaSurLaBranche(projet, 'tache/jamais-vue-000000')) === false,
  'une branche qui n’existe pas ne fabrique aucune trace',
);

/* ------------------------------------------------------------------ */
console.log('\n4. Refermer : le travail rejoint la principale, donc le déploiement');
/* ------------------------------------------------------------------ */

const bilan = await dossiers.refermerDossierDeCarte(projet, ouvert.dossier, branche);
verifier(bilan.fusionnee === true, 'la branche de la carte a été fusionnée dans la principale');
verifier(bilan.retire === true, 'la copie de travail a été refermée');
verifier(
  fs.readFileSync(path.join(projet, 'travail.txt'), 'utf8').includes('ce que l’agent avait écrit'),
  'le travail interrompu est bien dans la principale — il partira au déploiement',
);

/* Une copie sale se referme désormais toute seule : plus de dossier zombie. */
const second = await dossiers.ouvrirDossierDeCarte(projet, carte);
fs.writeFileSync(path.join(second.dossier, 'reste.txt'), 'oublié en route\n');
const bilan2 = await dossiers.refermerDossierDeCarte(projet, second.dossier, branche);
verifier(bilan2.enregistre === true, 'une seconde coupure enregistre elle aussi ce qui traînait');
verifier(bilan2.retire === true, 'et le dossier ne reste pas ouvert pour toujours');

/* ------------------------------------------------------------------ */
console.log('\n5. L’écran dit « Reprendre », et la consigne dit où reprendre');
/* ------------------------------------------------------------------ */

const neuve = { column: 'planned', scheduling: { attempts: 0, restarts: 0 } };
const interrompue = {
  column: 'planned',
  scheduling: { attempts: 1, restarts: 1, waitingReason: RAISON_COUPE_EN_VOL },
};

verifier(carteSeReprend(neuve) === false, 'une carte jamais lancée n’est pas une reprise');
verifier(libelleDeLancement(neuve) === LIBELLE_LANCER, `son bouton dit « ${LIBELLE_LANCER} »`);
verifier(carteSeReprend(interrompue) === true, 'une carte coupée en vol est une reprise');
verifier(libelleDeLancement(interrompue) === LIBELLE_REPRENDRE, `son bouton dit « ${LIBELLE_REPRENDRE} »`);
verifier(origineDeReprise(interrompue) === 'coupure', 'et la cause de l’interruption est reconnue');
verifier(!!mentionDeReprise(interrompue), 'la carte porte une phrase qui dit que le travail est gardé');
verifier(
  libelleDuLotDeLancement([interrompue, interrompue]) === 'Tout reprendre',
  'le pied de « Planifié » dit « Tout reprendre » quand toutes se reprennent',
);
verifier(
  libelleDuLotDeLancement([interrompue, neuve]) === 'Tout lancer',
  'et redit « Tout lancer » dès qu’une carte part de zéro',
);

const consigne = consigneDeReprise({
  origine: 'coupure',
  raison: RAISON_COUPE_EN_VOL,
  branche,
  dossier: ouvert.dossier,
  codeDejaEnregistre: true,
  etapes: [
    { label: 'Lire le projet', etat: 'done' },
    { label: 'Écrire le code', etat: 'running' },
    { label: 'Vérifier', etat: 'todo' },
  ],
});
verifier(consigne.includes('ÉTAPES DÉJÀ FAITES'), 'la consigne liste ce qui est déjà fait');
verifier(consigne.includes('ÉTAPES QUI RESTENT'), 'et ce qui reste à faire');
verifier(
  !consigne.split('ÉTAPES QUI RESTENT')[1].includes('Lire le projet'),
  'une étape faite n’est jamais redemandée',
);
verifier(consigne.includes(branche), 'elle nomme la branche que l’agent retrouve');

/* ------------------------------------------------------------------ */
console.log('\n6. Le repère dans l’interface : les boutons lisent la règle');
/* ------------------------------------------------------------------ */

const volet = fs.readFileSync(path.join(RACINE, 'web/src/components/card-panel.tsx'), 'utf8');
const tableau = fs.readFileSync(path.join(RACINE, 'web/src/components/board.tsx'), 'utf8');
verifier(
  volet.includes('libelleDeLancement(card)') && !volet.includes('> Lancer maintenant'),
  'le bouton du tiroir prend son libellé de la règle, jamais d’un texte figé',
);
verifier(
  tableau.includes('libelleDuLotDeLancement(cartes)'),
  'le pied de colonne aussi',
);
verifier(tableau.includes('data-mention-reprise'), 'la carte du tableau porte le repère de reprise');

/* ------------------------------------------------------------------ */
console.log('\n7. À L’ÉCRAN, dans un vrai navigateur : deux cartes, deux boutons');
/* ------------------------------------------------------------------ */

/*
 * Le repère statique ci-dessus dit que le bouton LIT la règle ; il ne dit pas
 * ce qu'on voit. On monte donc un démon à soi (base neuve, dossier de projets
 * vide, plafond d'agents à ZÉRO : rien ne part au moteur) avec deux cartes en
 * « Planifié » — une jamais lancée, une coupée en vol — et on regarde.
 */
const PORT = Number(process.env.HAIKODEV_REPRISE_PORT || 7196);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-reprise-ecran-'));
const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
for (const d of [DATA, PROJETS]) fs.mkdirSync(d, { recursive: true });

const Database = createRequire(import.meta.url)('better-sqlite3');
const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    HAIKODEV_PORT: String(PORT),
    HAIKODEV_HOST: '127.0.0.1',
    HAIKODEV_DATA: DATA,
    HAIKODEV_PROJECTS_ROOT: PROJETS,
    HAIKODEV_WEB: path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let navigateur;
process.on('exit', () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function attendrePort(limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

verifier(await attendrePort(), 'le démon d’essai répond');

const jeton = crypto.randomBytes(32).toString('hex');
const TITRE_NEUVE = 'Carte d’essai — jamais lancée';
const TITRE_REPRISE = 'Carte d’essai — coupée en vol';
{
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(jeton).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification reprise',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projetEcran = {
    id: 'p-reprise',
    name: 'Essai reprise',
    path: projet,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projetEcran.id, projetEcran.name, projetEcran.path, JSON.stringify(projetEcran), maintenant, maintenant);

  const poser = (id, titre, scheduling, position) => {
    const c = {
      id,
      projectId: 'p-reprise',
      title: titre,
      description: 'Carte fabriquée par le script de vérification.',
      labels: [],
      column: 'planned',
      position,
      origin: 'user',
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      scheduling,
      excludedFromDeploy: false,
      horsTache: false,
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, 'p-reprise', 'planned', position, titre, JSON.stringify(c), maintenant, maintenant);
  };
  poser('c-neuve', TITRE_NEUVE, { asap: false, attempts: 0, restarts: 0, suspendu: false }, 1);
  poser(
    'c-reprise',
    TITRE_REPRISE,
    { asap: false, attempts: 1, restarts: 1, suspendu: true, waitingReason: RAISON_COUPE_EN_VOL },
    2,
  );
  db.close();
}

const { chromium } = await import('playwright');
navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
await contexte.addCookies([{ name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
const ongletTableau = page.getByRole('button', { name: /^Tableau$/ });
if (await ongletTableau.count()) {
  await ongletTableau.first().click();
  await page.waitForTimeout(1500);
}

const reperes = await page.evaluate(() => {
  const trouve = {};
  for (const article of document.querySelectorAll('article')) {
    const titre = article.querySelector('h3')?.textContent ?? '';
    trouve[titre] = !!article.querySelector('[data-mention-reprise]');
  }
  return trouve;
});
verifier(reperes[TITRE_REPRISE] === true, 'la carte coupée porte le repère « reprise » sur le tableau');
verifier(reperes[TITRE_NEUVE] === false, 'la carte jamais lancée ne le porte pas');

const piedPlanifie = await page.evaluate(() => {
  const col = document.querySelector('[data-column="planned"]');
  return col?.lastElementChild?.querySelector('button')?.textContent?.trim() ?? '';
});
verifier(
  piedPlanifie.includes('Tout lancer'),
  `le pied dit « Tout lancer » tant qu’une carte part de zéro — vu : « ${piedPlanifie} »`,
);

async function libelleDuBouton(titre) {
  await page.locator(`article:has-text(${JSON.stringify(titre)})`).first().click();
  await page.waitForTimeout(1500);
  const texte = await page.evaluate(() => {
    const boutons = [...document.querySelectorAll('footer button')].map((b) => b.textContent?.trim() ?? '');
    return boutons.find((t) => /Reprendre|Lancer maintenant/.test(t)) ?? '';
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  return texte;
}

const boutonReprise = await libelleDuBouton(TITRE_REPRISE);
verifier(boutonReprise === LIBELLE_REPRENDRE, `le tiroir de la carte coupée dit « Reprendre » — vu : « ${boutonReprise} »`);
const boutonNeuf = await libelleDuBouton(TITRE_NEUVE);
verifier(boutonNeuf === LIBELLE_LANCER, `celui de la carte neuve dit « Lancer maintenant » — vu : « ${boutonNeuf} »`);
verifier(erreurs.length === 0, `aucune erreur de page${erreurs.length ? ` — ${erreurs[0]}` : ''}`);

await navigateur.close();
demon.kill('SIGKILL');

/* ------------------------------------------------------------------ */

fs.rmSync(projet, { recursive: true, force: true });

if (echecs.length) {
  console.error(`\n${echecs.length} contrôle(s) en échec.`);
  process.exit(1);
}
console.log('\nUne carte interrompue se reprend : le travail déjà fait est gardé, et l’écran le dit.');
