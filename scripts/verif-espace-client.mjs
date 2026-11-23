#!/usr/bin/env node
/**
 * L'ESPACE CLIENT DANS UN VRAI NAVIGATEUR.
 *
 *   npm run build && node scripts/verif-espace-client.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et un
 * compte client fabriqué pour l'occasion. Il ouvre ensuite Chrome sur l'ADRESSE
 * CLIENTE — `my.test`, ramenée sur 127.0.0.1 par le résolveur du navigateur,
 * pour qu'aucun DNS ne soit nécessaire — et rejoue le parcours entier.
 *
 * Ce qui est vérifié :
 *   1. LA PORTE — le formulaire client, pas celui de l'administration ;
 *   2. LE KANBAN — QUATRE colonnes (« Validé / recette » comprise), une demande
 *      créée sur un MODÈLE s'y pose ;
 *   3. L'ENVOI D'UN FICHIER — sa barre de progression est suivie À L'ÉTAT
 *      (`data-progression`), jamais à une hauteur en pixels : la mesure suit le
 *      téléversement réel, pas une animation ;
 *   4. LA FICHE — ouverte dans une PAGE de l'application (le `Drawer`, devenu
 *      page ; plus de volet ancré à droite), en blocs repliables, ses étapes
 *      ajoutées à la main (aucune trame n'en livre), puis le commentaire qui
 *      s'ajoute au fil ;
 *   5. LE DÉPLACEMENT — une demande se prend par APPUI LONG sur la vignette
 *      entière (la poignée a disparu), passe d'une colonne à l'autre et y reste ;
 *   6. L'ONGLET « DISCUSSION » — glissé à l'horizontale seulement, ouvert au
 *      clic dans une fenêtre flottante au-dessus de lui ;
 *   7. AUCUNE LISTE NATIVE — plus un seul `select` dans tout l'espace ;
 *   8. LE CLOISONNEMENT VU DE L'ÉCRAN — rien du tableau de Beluga n'apparaît ;
 *   9. CHEZ HAIKO — la Messagerie est une TUILE de la grille des services (ses
 *      pastilles se lisent grille ouverte, un point sur le bouton grille
 *      fermée) ; sur téléphone, le client, sa cloche et le menu à trois points
 *      tiennent sur le rang de la barre d'en-tête, et la liste des clients
 *      monte du bas dans un panneau, sans ouvrir de page.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ouvrirNavigation } from './lib/navigation.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_ESPACE_PORT || 7213);
/** L'adresse cliente, ramenée sur la machine par le résolveur du navigateur. */
const HOTE = 'my.test';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-espace-client-'));
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
/* Le décor : un projet, un compte client                              */
/* ------------------------------------------------------------------ */

const PROJET = 'p-espace';
const IDENTIFIANT = 'client-essai';
const MOT_DE_PASSE = 'mot-de-passe-essai-2026';

{
  const comptes = await import(path.join(RACINE, 'server/dist/comptes.js'));
  process.env.BELUGA_DATA = DATA;

  fs.mkdirSync(path.join(PROJETS, 'espace'), { recursive: true });
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  /*
   * LE PROJET EST ÉCRIT ENTIER : le démon relit ce bloc avec son modèle, et un
   * champ manquant le fait échouer à chaque passage de l'ordonnanceur — une
   * panne en boucle qui n'a rien à voir avec l'espace client.
   */
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
    PROJET,
    'Projet espace',
    path.join(PROJETS, 'espace'),
    0,
    JSON.stringify({
      id: PROJET,
      name: 'Projet espace',
      path: path.join(PROJETS, 'espace'),
      archived: false,
      createdAt: maintenant,
      updatedAt: maintenant,
    }),
    maintenant,
    maintenant,
  );
  const sel = crypto.randomBytes(16);
  db.prepare(
    `INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le)
     VALUES ('u-essai', ?, 'client', 'Client d’essai', ?, ?, 1, ?)`,
  ).run(IDENTIFIANT, sel.toString('hex'), comptes.empreinte(MOT_DE_PASSE, sel), maintenant);
  db.prepare('INSERT INTO user_projects (user_id, project_id) VALUES (?, ?)').run('u-essai', PROJET);
  db.close();
}

/* ------------------------------------------------------------------ */
/* Le navigateur                                                       */
/* ------------------------------------------------------------------ */

const RACINE_CLIENTE = `http://${HOTE}:${PORT}`;

navigateur = await chromium.launch({
  channel: 'chrome',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    // Aucun DNS n'est nécessaire : l'adresse cliente est ramenée sur la machine.
    `--host-resolver-rules=MAP ${HOTE} 127.0.0.1`,
  ],
});

const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));
page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));

/* ---------------- 1. La porte ---------------- */

await page.goto(RACINE_CLIENTE, { waitUntil: 'domcontentloaded', timeout: 60000 });
const formulaireClient = await page.locator('form[data-porte="client"]').count();
const texteDeLaPage = await page.content();
noter(
  "la porte cliente montre SON formulaire, pas celui de l'administration",
  formulaireClient === 1 && !texteDeLaPage.includes('Pilotage de projets'),
);

await page.fill('input[name="username"]', IDENTIFIANT);
await page.fill('input[name="password"]', MOT_DE_PASSE);
await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('button[type="submit"]')]);
const entre = await page
  .waitForSelector('[data-porte-client="ouverte"]', { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
noter(
  "l'entrée mène à l'espace du client",
  entre,
  entre ? '' : `écran : ${(await page.textContent('body').catch(() => '')) ?? ''} · ${erreurs.slice(0, 2).join(' | ')}`,
);
if (!entre) {
  console.error('\n--- démon ---\n' + journal.join('').slice(-2000));
  process.exit(1);
}

/* ---------------- 2. Le kanban ---------------- */

await page.waitForSelector('[data-espace-client]', { timeout: 20000 });
const colonnes = await page.locator('[data-colonne-kanban]').count();
noter('le kanban montre ses QUATRE colonnes', colonnes === 4, String(colonnes));
noter(
  'la quatrième colonne est « Validé / recette »',
  (await page.locator('[data-colonne-kanban="valide"]').count()) === 1,
);
noter(
  'les flèches ont disparu, et la poignée de glissement AUSSI',
  (await page.locator('[data-avancer], [data-reculer], [data-poignee-demande]').count()) === 0,
);

const traceDuTableau = await page.locator('[data-ouvrir-tableau-de-bord], [data-ouvrir-coffre]').count();
noter("rien de l'application d'administration n'apparaît", traceDuTableau === 0);

/*
 * L'ENTÊTE NE GARDE QUE LE NOM ET LE BURGER. Backups, Accès et la déconnexion
 * vivent dans le MENU du burger — un petit menu ancré sous lui, plus une page ; le « + » sur la colonne « À faire », le
 * filtre et la recherche dans la tête de CHAQUE colonne, la discussion dans un
 * onglet en bas du tableau. Les contrôles passent donc par ces aides plutôt que
 * par des commandes qui ne sont plus à l'écran.
 */
async function ouvrirLeFiltre(colonne) {
  await page.click(`[data-menu-actions="filtre-${colonne}"]`);
  await page.waitForSelector(`[data-tri-colonne="${colonne}"]`, { timeout: 10000 });
}

async function ouvrirLeBurger() {
  await page.click('[data-menu-actions="espace-menu"]');
  await page.waitForSelector('[data-basculer-backups]', { timeout: 10000 });
}

/*
 * LES DEMANDES ARCHIVÉES SONT UN FILTRE DE COLONNE, chacune indépendante : on
 * bascule donc les QUATRE pour retrouver une demande rangée, où qu'elle soit.
 */
const COLONNES_DU_TABLEAU = ['a-faire', 'en-cours', 'termine', 'valide'];

async function basculerLesArchives(colonnes = COLONNES_DU_TABLEAU) {
  for (const colonne of colonnes) {
    await ouvrirLeFiltre(colonne);
    await page.click(`[data-filtre-archivees]`);
    await fermerLeTiroir();
  }
  await page.waitForTimeout(400);
}

async function fermerLeTiroir() {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
}

/*
 * LA FICHE D'UNE DEMANDE N'A PLUS DE CROIX : c'est une page, on en sort par la
 * flèche de retour de SA barre d'en-tête (celle de la page qui porte la fiche,
 * pas celle d'une page ouverte par-dessus).
 */
async function quitterLaFiche() {
  await page.locator('[data-page-de-zone]:has([data-tiroir-demande]) [data-retour-de-page]').last().click();
}

const entete = await page.evaluate(() => {
  const bande = document.querySelector('[data-entete-espace]');
  return {
    burger: bande ? bande.querySelectorAll('[data-menu-actions="espace-menu"]').length : 0,
    /* LA CLOCHE EST LE SEUL AUTRE BOUTON ADMIS : elle a rejoint l'entête, sur
       le même rang, et n'est pas un reste de l'ancienne bande. */
    boutons: bande
      ? bande.querySelectorAll(
          'button:not([data-menu-actions="espace-menu"]):not([data-cloche-espace]):not([data-bouton-theme])',
        ).length
      : -1,
    anciens: document.querySelectorAll(
      '[data-basculer-backups], [data-basculer-acces], [data-se-deconnecter], [data-entete-espace] [data-nouvelle-demande], [data-basculer-discussion], [data-menu-actions="espace"]',
    ).length,
  };
});
noter(
  "l'entête ne garde que le nom et le burger",
  entete.burger === 1 && entete.boutons === 0 && entete.anciens === 0,
  JSON.stringify(entete),
);
await ouvrirLeBurger();
const tiroirDuBurger = await page.evaluate(() =>
  ['[data-basculer-backups]', '[data-basculer-acces]', '[data-se-deconnecter]'].map(
    /* DANS LE MENU DU BURGER, et pas dans une page : un bouton d'options ouvre un menu sous lui. */
    (repere) =>
      document.querySelector(repere) !== null &&
      !!document.querySelector(repere)?.closest('[role="menu"][data-menu-actions-contenu="espace-menu"]') &&
      !document.querySelector(repere)?.closest('[data-page-de-zone]'),
  ),
);
noter(
  'le burger range « Backups », « Accès » et la déconnexion',
  tiroirDuBurger.every(Boolean),
  JSON.stringify(tiroirDuBurger),
);
/*
 * « ACCÈS » ET « BACKUPS » S'OUVRENT DANS LE TIROIR DE L'APPLICATION, plus dans
 * un volet ancré à droite : même enveloppe que la fiche d'une demande, même
 * fermeture à la touche d'échappement, et aucune mécanique de volet à part.
 */
await page.click('[data-basculer-backups]');
await page.waitForTimeout(450);
noter(
  '« Backups » s’ouvre dans le TIROIR de l’application, plus dans un volet ancré',
  (await page.locator('[data-tiroir] [data-volet-espace="backups"]').count()) === 1 &&
    (await page.locator('[data-volet-ancre]').count()) === 0,
);
await fermerLeTiroir();
noter(
  'la touche d’échappement le referme, comme une fiche',
  (await page.locator('[data-volet-espace]').count()) === 0,
);
await ouvrirLeBurger();
await page.click('[data-basculer-acces]');
await page.waitForTimeout(450);
noter(
  '« Accès » emploie le MÊME tiroir',
  (await page.locator('[data-tiroir] [data-volet-espace="acces"]').count()) === 1,
);
await fermerLeTiroir();
noter(
  'le « + » vit sur la colonne « À faire », et nulle part ailleurs',
  (await page.locator('[data-colonne-kanban="a-faire"] [data-nouvelle-demande]').count()) === 1 &&
    (await page.locator('[data-nouvelle-demande]').count()) === 1,
);
noter(
  'chaque colonne porte SON filtre et SA recherche',
  (await page.locator('[data-filtre-colonne]').count()) === 4 &&
    /* La recherche d'une colonne est une LOUPE dans sa tête (carte « Refonte de l'espace Médias »), son champ s'ouvre sur demande. */
    (await page.locator('[data-recherche-colonne-bouton]').count()) === 4,
);
noter(
  'la discussion est un onglet en bas du tableau',
  (await page.locator('[data-bande-discussion] [data-onglet-discussion]').count()) === 1,
);

/* UNE DEMANDE NEUVE PART D'UN MODÈLE : la trame est proposée avant le titre. */
await page.click('[data-nouvelle-demande]');
await page.waitForSelector('[data-choix-modele]');
noter(
  'la création propose d’abord un modèle de demande',
  (await page.locator('[data-modele]').count()) >= 3,
  String(await page.locator('[data-modele]').count()),
);
await page.click('[data-modele="bug"]');
await page.waitForSelector('[data-formulaire-demande]');
noter(
  'le modèle choisi pré-remplit la trame de description',
  (await page.inputValue('[data-champ-description]')).length > 20,
);
await page.fill('[data-champ-titre]', 'Refaire la page d’accueil');
await page.fill('[data-champ-description]', 'Avec le nouveau logo et les nouvelles photos.');

/*
 * LES OPTIONS SONT UN ACCORDÉON DANS UN BLOC REPLIÉ, ici comme dans la fiche :
 * une ligne à chevron tant qu'on n'en veut pas, puis trois sections empilées,
 * une seule ouverte à la fois. On ouvre « Importance » pour la poser — c'est le
 * geste réel d'un client.
 */
noter(
  'le formulaire de création ne montre AUCUN réglage avant d’ouvrir « Options »',
  (await page.locator('[data-accordeon="options-creation"]').count()) === 0 &&
    (await page.locator('[data-bloc-fiche="options-creation"]').count()) === 1,
);
await page.click('[data-bloc-bascule="options-creation"]');
await page.waitForSelector('[data-accordeon="options-creation"]', { timeout: 10000 });
noter(
  'le bloc « Options » de la création déroule le MÊME accordéon que la fiche',
  (await page.locator('[data-accordeon="options-creation"]').count()) === 1 &&
    (await page.locator('[data-bloc-fiche="options-creation"][data-bloc-ouvert]').count()) === 1,
);
await page.click('[data-accordeon-bascule="importance"]');
await page.waitForSelector('[data-importance="haute"]', { timeout: 10000 });
await page.click('[data-importance="haute"]');
/* ET L'ÉCHÉANCE SE POSE AU DÉPÔT : il ne faut plus créer puis rouvrir. */
await page.click('[data-accordeon-bascule="dates"]');
await page.waitForSelector('[data-champ-echeance]', { timeout: 10000 });
noter('une échéance se pose DÈS le dépôt, sans rouvrir la fiche', true);

/* ---------------- 3. L'envoi d'un fichier, suivi À L'ÉTAT ---------------- */

/*
 * UNE IMAGE RÉELLE, assez grosse pour que le téléversement dure : une barre qui
 * saute de 0 à 100 ne prouverait rien. On lit `data-progression`, l'ÉTAT publié
 * par le composant, jamais une largeur en pixels — une retouche de mise en page
 * n'a alors aucune raison de casser ce contrôle.
 */
const FICHIER = path.join(TMP, 'plan.png');
fs.writeFileSync(FICHIER, Buffer.alloc(3 * 1024 * 1024, 7));

const progressions = [];
await page.setInputFiles('input[data-espace-fichier]', FICHIER);
for (let i = 0; i < 60; i += 1) {
  const vue = await page.locator('[data-envoi]').first().getAttribute('data-progression').catch(() => null);
  if (vue !== null) progressions.push(Number(vue));
  if (await page.locator('[data-pieces-deposees]').count()) break;
  await page.waitForTimeout(50);
}
noter(
  "la barre de progression suit le téléversement RÉEL, pas une animation",
  progressions.length > 0 || (await page.locator('[data-pieces-deposees]').count()) === 1,
  progressions.length ? `parts vues : ${[...new Set(progressions)].join(', ')}` : 'envoi instantané',
);

await page.waitForSelector('[data-pieces-deposees]', { timeout: 30000 });
noter('la pièce jointe est déposée avant la création', true);

await page.click('[data-creer-demande]');
await page.waitForSelector('[data-demande]', { timeout: 20000 });
const dansAFaire = await page.locator('[data-colonne-kanban="a-faire"] [data-demande]').count();
noter('la demande créée se pose dans « À faire »', dansAFaire === 1, String(dansAFaire));

/*
 * LA VIGNETTE : CHAQUE INFORMATION À SON COIN. Les compteurs (pièces jointes,
 * commentaires) en haut à droite du titre, la date alignée à droite dans la
 * ligne du bas, et les tâches dans un ONGLET SUSPENDU sous la carte — le
 * bandeau des cartes Beluga. La demande créée sur le modèle « anomalie » porte
 * une pièce jointe ; AUCUNE TRAME NE LIVRE PLUS D'ÉTAPE (`MODELES_DEMANDE`,
 * `taches: []`) : l'onglet se juge donc plus bas, une fois trois étapes
 * ajoutées à la main dans le « Todo » de la fiche.
 */
const dispositionVignette = await page.evaluate(() => {
  const vignette = document.querySelector('[data-colonne-kanban="a-faire"] [data-demande]');
  const cadre = vignette?.querySelector('[data-cadre-vignette]');
  const titre = cadre?.querySelector('h3');
  const compteurs = cadre?.querySelector('[data-compteurs-vignette]');
  const date = cadre?.querySelector('[data-date-vignette]');
  const pied = cadre?.querySelector('[data-pied-vignette]');
  const ouvrir = cadre?.querySelector('[data-ouvrir-demande]');
  if (!vignette || !cadre || !titre || !compteurs || !date || !pied || !ouvrir) return { ok: false, raison: 'repère absent' };
  /* LE RETRAIT NORMAL DE LA VIGNETTE se LIT (il valait 10 px, il en vaut 14) :
     un nombre écrit ici casserait à chaque retouche de la marge. */
  const retrait = parseFloat(getComputedStyle(ouvrir).paddingRight) || 0;
  const rc = cadre.getBoundingClientRect();
  const rt = titre.getBoundingClientRect();
  const rn = compteurs.getBoundingClientRect();
  const rd = date.getBoundingClientRect();
  const rp = pied.getBoundingClientRect();
  return {
    ok: true,
    compteursEnHaut: rn.top + rn.height / 2 < rc.top + rc.height / 2,
    compteursADroiteDuTitre: rn.left >= rt.right - 1,
    pieces: compteurs.querySelector('[data-compteur-pieces]')?.getAttribute('data-compteur-pieces') ?? null,
    dateADroite: Math.abs(rd.right - rp.right) <= 1 && rd.left > rp.left + rp.width / 2,
    /* La réserve du « ⋮ » ne vaut que pour la rangée du titre : la date touche
       le retrait normal de la vignette, sans la place des trois points en plus. */
    retrait,
    retraitDeLaDate: Math.round((rc.right - rd.right) * 10) / 10,
    dateAuBord: retrait > 0 && rc.right - rd.right <= retrait + 1,
    typeAffiche: document.querySelectorAll('[data-type-demande]').length,
  };
});
noter(
  'la vignette pose ses compteurs en HAUT À DROITE du titre',
  dispositionVignette.ok && dispositionVignette.compteursEnHaut && dispositionVignette.compteursADroiteDuTitre &&
    dispositionVignette.pieces === '1',
  JSON.stringify(dispositionVignette),
);
noter(
  '…la date alignée à droite dans la ligne du bas, jusqu’au retrait du bord',
  dispositionVignette.ok && dispositionVignette.dateADroite && dispositionVignette.dateAuBord,
  `date à ${dispositionVignette.retraitDeLaDate} px du bord, retrait de la vignette : ${dispositionVignette.retrait} px`,
);
noter(
  'une demande née d’une trame n’a aucune étape : sa vignette ne porte pas d’onglet de tâches',
  (await page.locator('[data-colonne-kanban="a-faire"] [data-demande] [data-onglet-taches]').count()) === 0,
);
noter('plus aucun type affiché sur une vignette', dispositionVignette.typeAffiche === 0);

/* ---------------- 4. La fiche : galerie et commentaire ---------------- */

/* LA FICHE S'OUVRE EN PAGE, plus en modale : le tableau reste monté dessous. */
await page.locator('[data-ouvrir-demande]').first().click();
await page.waitForSelector('[data-tiroir-demande]', { timeout: 20000 });
noter(
  'le tableau reste en place sous la page de la fiche',
  (await page.locator('[data-colonne-kanban="a-faire"]').isVisible()) === true,
);
/*
 * LA FICHE S'OUVRE DANS LE « TIROIR » DE L'APPLICATION (`Drawer`) — celui des
 * réglages de l'agent, du coffre-fort, du parcours d'une carte —, qui est
 * devenu une PAGE (refonte du 11/10/2026 : plus rien ne monte du bas). Plus de
 * volet maison ancré au bord droit : on la reconnaît à ce qu'elle occupe TOUTE
 * la zone (l'espace des clients n'a pas de colonne, donc tout l'écran), de haut
 * en bas, et à sa flèche de retour — qui porte le repère de l'ancienne poignée.
 */
const pageDeLaFiche = await page.evaluate(() => {
  const fiche = document.querySelector('[data-tiroir-demande]');
  const tiroir = fiche?.closest('[data-tiroir]');
  if (!tiroir) return null;
  const boite = tiroir.getBoundingClientRect();
  return {
    page: tiroir.hasAttribute('data-page-de-zone'),
    position: getComputedStyle(tiroir).position,
    haut: Math.round(boite.top),
    bas: Math.round(window.innerHeight - boite.bottom),
    gauche: Math.round(boite.left),
    droite: Math.round(window.innerWidth - boite.right),
    retour: tiroir.querySelectorAll('[data-retour-de-page][data-poignee-tiroir]').length,
    voletAncre: document.querySelectorAll('[data-volet-ancre]').length,
  };
});
noter(
  'la fiche s’ouvre dans une page de l’application, plus dans un volet ancré à droite',
  !!pageDeLaFiche &&
    pageDeLaFiche.page &&
    pageDeLaFiche.position === 'fixed' &&
    pageDeLaFiche.haut <= 2 &&
    pageDeLaFiche.bas <= 2 &&
    pageDeLaFiche.gauche <= 2 &&
    pageDeLaFiche.droite <= 2 &&
    pageDeLaFiche.retour === 1 &&
    pageDeLaFiche.voletAncre === 0,
  JSON.stringify(pageDeLaFiche),
);

/*
 * ON ATTEND L'ÉTAT, PAS UN DÉLAI : tant que la fiche n'est pas revenue du
 * serveur, le tiroir montre sa silhouette — et compter la galerie à cet
 * instant-là ne mesure que la vitesse de la machine.
 */
await page.waitForSelector('[data-fiche-chargee]', { timeout: 20000 });

/*
 * LES PIÈCES JOINTES ONT QUITTÉ LE CORPS DE LA FICHE. Elles ne poussent plus la
 * discussion vers le bas : un bouton dans l'ENTÊTE les ouvre dans un tiroir
 * empilé. On vérifie donc trois choses — plus aucun bloc « pieces » dans le
 * corps, un bouton d'entête, et la galerie qui paraît une fois ce bouton
 * cliqué.
 */
noter(
  'la galerie n’est plus posée dans le corps de la fiche',
  (await page.locator('[data-tiroir-demande] [data-galerie]').count()) === 0,
);
noter(
  'un bouton de l’entête ouvre les pièces jointes',
  (await page.locator('[data-ouvrir-pieces]').count()) === 1,
);
await page.click('[data-ouvrir-pieces]');
await page.waitForSelector('[data-tiroir-pieces]', { timeout: 10000 });
noter(
  'le tiroir des pièces jointes est EMPILÉ par-dessus la fiche, et porte la galerie',
  (await page.locator('[data-tiroir-empile="oui"] [data-tiroir-pieces] [data-galerie]').count()) === 1,
);
/* PLUS DE CROIX SUR CETTE PAGE : sa barre porte déjà la flèche de retour. */
noter(
  'la page des pièces jointes n’a pas de croix : on en sort par la flèche de retour de sa barre',
  (await page.locator('[data-fermer-pieces]').count()) === 0 &&
    (await page.locator('[data-page-de-zone]:has([data-tiroir-pieces]) [data-retour-de-page]').count()) === 1,
);
await page.locator('[data-page-de-zone]:has([data-tiroir-pieces]) [data-retour-de-page]').click();
await page.waitForTimeout(450);
noter(
  'refermer le tiroir des pièces rend la fiche',
  (await page.locator('[data-tiroir-pieces]').count()) === 0 &&
    (await page.locator('[data-tiroir-demande]').count()) === 1,
);

/*
 * LE CONTENU DE LA FICHE : LA DEMANDE, PUIS LES MESSAGES, SANS UN SEUL TITRE
 * INTERMÉDIAIRE. Le libellé « Discussion » a disparu — c'est pour elle qu'on
 * ouvre une fiche, elle n'a pas à s'annoncer. Il ne reste que DEUX blocs
 * repliables, tous les deux en pied et tous les deux FERMÉS : « Todo » puis
 * « Options ».
 */
noter(
  'le libellé « Discussion » a quitté la fiche, les messages suivent la description',
  (await page.locator('[data-tiroir-demande] [data-bloc-bascule="discussion"]').count()) === 0 &&
    (await page.locator('[data-tiroir-demande] [data-commentaires]').count()) === 1,
);

const blocs = await page.$$eval('[data-tiroir-demande] [data-bloc-fiche]', (els) =>
  els.map((e) => `${e.dataset.blocFiche}:${e.dataset.blocOuvert === undefined ? 'ferme' : 'ouvert'}`),
);
noter(
  'la fiche porte « Todo » puis « Options », tous deux repliés à l’ouverture',
  blocs.join(',') === 'todo:ferme,options:ferme',
  blocs.join(','),
);

/*
 * PLUS UN SEUL CADRE DANS LA FICHE. Ce qui détache un bloc ou une bulle est son
 * FOND, jamais un trait : on regarde donc les bordures RÉELLEMENT dessinées sur
 * chaque bulle et chaque bloc, et le fond de chacun, qui doit différer de celui
 * du tiroir qui le porte.
 */
noter(
  'plus aucun cadre ni trait dans la fiche : les fonds seuls font la hiérarchie',
  await page.evaluate(() => {
    const tiroir = document.querySelector('[data-tiroir-demande]');
    if (!tiroir) return false;
    const fondDuTiroir = getComputedStyle(tiroir.closest('[data-tiroir]') ?? tiroir).backgroundColor;
    const morceaux = [...tiroir.querySelectorAll('[data-bloc-fiche], [data-bulle]')];
    if (!morceaux.length) return false;
    return morceaux.every((el) => {
      const s = getComputedStyle(el);
      const traits = ['TopWidth', 'RightWidth', 'BottomWidth', 'LeftWidth'].map((c) =>
        parseFloat(s[`border${c}`]),
      );
      return traits.every((t) => !t) && s.backgroundColor !== fondDuTiroir;
    });
  }),
);

/*
 * ET LES DEUX CAMPS SE DISTINGUENT PAR LEUR FOND, plus par un liseré : c'est ce
 * qui portait l'information, et le retrait des cadres ne doit pas l'emporter.
 */
noter(
  'mes bulles et celles d’en face n’ont pas le même fond',
  await page.evaluate(() => {
    const mien = document.querySelector('[data-tiroir-demande] [data-bulle="moi"]');
    const autre = document.querySelector('[data-tiroir-demande] [data-bulle="autre"]');
    // Un seul camp présent : rien à comparer, la règle n'est pas en cause.
    if (!mien || !autre) return true;
    return getComputedStyle(mien).backgroundColor !== getComputedStyle(autre).backgroundColor;
  }),
);

/*
 * LE « TODO » SE POSE JUSTE SOUS LA DEMANDE, AVANT LES MESSAGES. Il vivait
 * SOUS le fil : sur une demande qui a vingt échanges, ce qui reste à faire
 * était à un long défilement de la description qui l'explique.
 */
noter(
  'le bloc « Todo » précède le fil de discussion dans la fiche',
  await page.evaluate(() => {
    const todo = document.querySelector('[data-tiroir-demande] [data-bloc-todo]');
    const fil = document.querySelector('[data-tiroir-demande] [data-commentaires]');
    if (!todo || !fil) return false;
    // Node.DOCUMENT_POSITION_FOLLOWING : le fil vient APRÈS le Todo.
    return Boolean(todo.compareDocumentPosition(fil) & Node.DOCUMENT_POSITION_FOLLOWING);
  }),
);

/* LE « TODO » S'OUVRE À LA DEMANDE, et son champ d'ajout vient avec lui. */
noter(
  'replié, le « Todo » ne laisse aucun champ joignable',
  (await page.locator('[data-bloc-todo] [data-champ-tache-neuve]').count()) === 0,
);
await page.click('[data-tiroir-demande] [data-bloc-bascule="todo"]');
await page.waitForTimeout(300);
noter(
  'le « Todo » s’ouvre d’un clic, avec son champ « Ajouter une étape… »',
  (await page.locator('[data-bloc-fiche="todo"][data-bloc-ouvert]').count()) === 1 &&
    (await page.locator('[data-bloc-todo] [data-champ-tache-neuve]').count()) === 1,
);
/* TROIS ÉTAPES, À LA MAIN — plus aucune trame n'en livre : c'est le geste réel,
   et c'est lui qui donne à la vignette son onglet de tâches (jugé plus bas). */
for (const etape of ['Reproduire', 'Corriger', 'Vérifier en ligne']) {
  await page.fill('[data-bloc-todo] [data-champ-tache-neuve]', etape);
  await page.press('[data-bloc-todo] [data-champ-tache-neuve]', 'Enter');
  await page.waitForTimeout(350);
}
noter(
  'une étape s’ajoute à la main, par « Entrée » dans ce champ',
  (await page.locator('[data-bloc-todo] [data-tache]').count()) === 3 &&
    (await page.getAttribute('[data-bloc-todo] [data-jauge-taches]', 'data-jauge-taches')) === '0/3',
  `${await page.locator('[data-bloc-todo] [data-tache]').count()} étape(s)`,
);
await page.click('[data-tiroir-demande] [data-bloc-bascule="todo"]');
await page.waitForTimeout(300);

/*
 * LES OPTIONS SONT FIXÉES AU-DESSUS DU CHAMP DE MESSAGE, ET S'OUVRENT EN
 * ACCORDÉON : les TROIS réglages empilés d'un coup (importance, dates,
 * étiquettes — le type a disparu), chacun disant sa valeur sans s'ouvrir. Hors
 * de la zone qui défile, juste avant le composeur, sans trait entre les deux.
 */
const placeDesOptions = await page.evaluate(() => {
  const fiche = document.querySelector('[data-tiroir-demande]');
  const options = fiche?.querySelector('[data-bloc-options]');
  const fil = fiche?.querySelector('[data-commentaires]');
  const composeur = fiche?.querySelector('[data-composeur-espace]');
  if (!options || !fil || !composeur) return { ok: false };
  // La zone qui défile : le premier ancêtre du fil dont le contenu défile.
  let zone = fil.parentElement;
  while (zone && !/(auto|scroll)/.test(getComputedStyle(zone).overflowY)) zone = zone.parentElement;
  const enveloppe = options.closest('[data-options-fixees]');
  return {
    ok: true,
    horsDefilement: Boolean(zone) && !zone.contains(options),
    justeAvantLeComposeur: enveloppe?.nextElementSibling === composeur,
    traitDuComposeur: getComputedStyle(composeur).borderTopWidth,
  };
});
noter(
  'les « Options » sont hors de la zone qui défile, juste avant le champ de message',
  placeDesOptions.ok && placeDesOptions.horsDefilement && placeDesOptions.justeAvantLeComposeur,
  JSON.stringify(placeDesOptions),
);
noter('aucun trait entre les « Options » et le champ de message', placeDesOptions.traitDuComposeur === '0px');
noter(
  'replié, le bloc « Options » ne montre aucun réglage',
  (await page.locator('[data-tiroir-demande] [data-accordeon="options-fiche"]').count()) === 0,
);
await page.click('[data-tiroir-demande] [data-bloc-bascule="options"]');
await page.waitForSelector('[data-accordeon="options-fiche"]', { timeout: 10000 });
noter(
  'ouvert, il empile les TROIS réglages, sans pagination ni section « type »',
  (await page.locator('[data-accordeon="options-fiche"] [data-accordeon-bascule]').count()) === 3 &&
    (await page.locator('[data-accordeon-bascule="type"], [data-champ-type]').count()) === 0 &&
    (await page.locator('[data-tiroir-demande] [data-carrousel]').count()) === 0,
  `sections : ${await page.locator('[data-accordeon="options-fiche"] [data-accordeon-bascule]').count()}`,
);
/* ET CHAQUE SECTION S'OUVRE SUR PLACE, sous sa propre ligne. */
await page.click('[data-accordeon="options-fiche"] [data-accordeon-bascule="importance"]');
await page.waitForTimeout(300);
noter(
  'une section s’ouvre là où elle est, sans chasser les autres de l’écran',
  (await page.locator('[data-accordeon="options-fiche"] [data-accordeon-bascule]').count()) === 3 &&
    (await page.locator('[data-importance="haute"]').count()) === 1,
);
await page.click('[data-tiroir-demande] [data-bloc-bascule="options"]');
await page.waitForTimeout(300);

/* LE COMPOSEUR, CALQUÉ SUR BELUGA : trombone DANS le coin du champ, envoi SOUS lui. */
noter(
  'le trombone est posé dans le coin du champ, pas dans une colonne à côté',
  await page.evaluate(() => {
    const champ = document.querySelector('[data-tiroir-demande] [data-champ-espace]');
    const trombone = document.querySelector('[data-tiroir-demande] [data-joindre-espace]');
    if (!champ || !trombone) return false;
    const c = champ.getBoundingClientRect();
    const b = trombone.getBoundingClientRect();
    // Dans le champ, en haut à droite.
    return b.right <= c.right + 2 && b.top >= c.top - 2 && b.top < c.top + c.height / 2;
  }),
);
/*
 * L'ENVOI PREND TOUTE LA LARGEUR, sous le champ. Un petit bouton poussé à
 * droite se cherchait, surtout au pouce. On compare sa largeur à celle de son
 * CONTENEUR — jamais à un nombre de pixels, qui dépendrait de la fenêtre.
 */
noter(
  'le bouton d’envoi est SOUS le champ, et prend toute la largeur',
  await page.evaluate(() => {
    const champ = document.querySelector('[data-tiroir-demande] [data-champ-espace]');
    const envoi = document.querySelector('[data-tiroir-demande] [data-envoyer="commentaire"]');
    if (!champ || !envoi) return false;
    const c = champ.getBoundingClientRect();
    const e = envoi.getBoundingClientRect();
    const parent = envoi.parentElement.getBoundingClientRect();
    return e.top >= c.bottom - 2 && e.width >= parent.width - 2;
  }),
);

await page.fill('[data-tiroir-demande] [data-champ-espace]', 'Merci, je vous envoie les photos demain.');
await page.click('[data-tiroir-demande] [data-envoyer="commentaire"]');
await page.waitForSelector('[data-message]', { timeout: 20000 });
const commentaires = await page.locator('[data-message]').count();
noter('un commentaire s’ajoute au fil de la demande', commentaires >= 1, String(commentaires));

await quitterLaFiche();
await page.waitForTimeout(500);

/*
 * L'ONGLET DES TÂCHES, SUSPENDU SOUS LA CARTE — jugé ICI, maintenant que la
 * demande porte les trois étapes ajoutées dans sa fiche.
 */
const ongletDesTaches = await page.evaluate(() => {
  const vignette = document.querySelector('[data-colonne-kanban="a-faire"] [data-demande]');
  const cadre = vignette?.querySelector('[data-cadre-vignette]');
  const onglet = vignette?.querySelector('[data-onglet-taches]');
  if (!vignette || !cadre || !onglet) return { onglet: null };
  return {
    onglet: onglet.getAttribute('data-onglet-taches'),
    ongletSous: onglet.getBoundingClientRect().bottom > cadre.getBoundingClientRect().bottom,
    ongletDansLaPrise: onglet.closest('[data-demande]') === vignette,
    jaugeDansLeCadre: cadre.querySelector('[data-jauge-taches]') !== null,
  };
});
noter(
  '…et ses tâches dans un ONGLET suspendu sous la carte, qui se prend avec elle',
  ongletDesTaches.onglet === '0/3' &&
    ongletDesTaches.ongletSous &&
    ongletDesTaches.ongletDansLaPrise &&
    !ongletDesTaches.jaugeDansLeCadre,
  JSON.stringify(ongletDesTaches),
);

/* ---------------- 5. LE GLISSER-DÉPOSER ---------------- */

/*
 * LE GLISSEMENT NE SE TESTE PAS À LA SOURIS DE PLAYWRIGHT : le composant écoute
 * `pointerdown` / `pointermove` / `pointerup` sur `window`, et la souris de
 * Playwright n'émet pas d'événements de POINTEUR exploitables ici. On les émet
 * donc soi-même, et la cible se lit par `elementFromPoint` — exactement ce que
 * fait le code de production.
 */
async function glisser(idDemande, versSelecteur, place = 'milieu') {
  await page.evaluate(
    async ({ idDemande, versSelecteur, place }) => {
      const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
      const vignette = document.querySelector(`[data-demande="${idDemande}"]`);
      const cible = document.querySelector(versSelecteur);
      if (!vignette || !cible) throw new Error('vignette ou cible introuvable');
      const depart = vignette.getBoundingClientRect();
      const boite = cible.getBoundingClientRect();
      const y =
        place === 'haut' ? boite.top + 4 : place === 'bas' ? boite.bottom - 4 : boite.top + boite.height / 2;
      const x = boite.left + boite.width / 2;
      // ON SONDE LE POINT D'APPUI : émettre sur un élément couvert par un autre
      // ne prouverait rien du geste réel.
      const px = depart.left + depart.width / 2;
      const py = depart.top + 10;
      const appui = document.elementFromPoint(px, py);
      if (!appui || !appui.closest(`[data-demande="${idDemande}"]`)) {
        throw new Error('la vignette n’est pas sous le point d’appui');
      }
      const emettre = (type, cx, cy, sur) =>
        sur.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: cx,
            clientY: cy,
            button: 0,
            pointerType: 'touch',
          }),
        );
      // L'APPUI LONG ARME LA PRISE : on tient le doigt immobile le temps qu'il
      // faut, puis seulement on bouge.
      emettre('pointerdown', px, py, appui);
      await attendre(600);
      // Deux mouvements : le premier franchit le seuil, le second vise.
      emettre('pointermove', px + 40, py + 40, window);
      await attendre(20);
      emettre('pointermove', x, y, window);
      await attendre(20);
      emettre('pointerup', x, y, window);
    },
    { idDemande, versSelecteur, place },
  );
  await page.waitForTimeout(1200);
}

/*
 * UN MOUVEMENT FRANC AVANT LA FIN DU DÉLAI RESTE UN DÉFILEMENT. C'est le point
 * délicat de l'appui long : sans ce garde-fou, le rail des colonnes serait
 * confisqué par la première vignette touchée.
 */
async function glisserTropTot(idDemande) {
  return page.evaluate(async (idDemande) => {
    const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
    const vignette = document.querySelector(`[data-demande="${idDemande}"]`);
    if (!vignette) throw new Error('vignette introuvable');
    const boite = vignette.getBoundingClientRect();
    const px = boite.left + boite.width / 2;
    const py = boite.top + 10;
    const emettre = (type, cx, cy, sur) =>
      sur.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: cx,
          clientY: cy,
          button: 0,
          pointerType: 'touch',
        }),
      );
    emettre('pointerdown', px, py, document.elementFromPoint(px, py) ?? vignette);
    await attendre(60);
    emettre('pointermove', px + 60, py, window);
    await attendre(60);
    const tenue = document.querySelectorAll('[data-vignette-tenue]').length;
    emettre('pointerup', px + 60, py, window);
    return tenue;
  }, idDemande);
}

const premiere = await page.locator('[data-demande]').first().getAttribute('data-demande');

const tenueTropTot = await glisserTropTot(premiere);
await page.waitForTimeout(400);
noter(
  'un mouvement franc AVANT le délai ne prend pas la vignette',
  tenueTropTot === 0,
  String(tenueTropTot),
);
noter(
  'et la demande n’a pas bougé de colonne',
  (await page.locator('[data-colonne-kanban="a-faire"] [data-demande]').count()) === 1,
);

await glisser(premiere, '[data-colonne-kanban="en-cours"]');
const dansEnCours = await page.locator('[data-colonne-kanban="en-cours"] [data-demande]').count();
noter('une demande se GLISSE d’une colonne à l’autre', dansEnCours === 1, String(dansEnCours));

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-espace-client]', { timeout: 30000 });
const resteEnCours = await page.locator('[data-colonne-kanban="en-cours"] [data-demande]').count();
noter('et elle y reste après un rechargement', resteEnCours === 1, String(resteEnCours));

/* LA RÉORDINATION DANS UNE COLONNE — le second piquet du glisser-déposer. */
await page.click('[data-nouvelle-demande]');
await page.waitForSelector('[data-choix-modele]');
await page.click('[data-modele="vierge"]');
await page.waitForSelector('[data-formulaire-demande]');
await page.fill('[data-champ-titre]', 'Deuxième demande');
await page.click('[data-creer-demande]');
await page.waitForTimeout(1200);
await page.click('[data-nouvelle-demande]');
await page.waitForSelector('[data-choix-modele]');
await page.click('[data-modele="vierge"]');
await page.waitForSelector('[data-formulaire-demande]');
await page.fill('[data-champ-titre]', 'Troisième demande');
await page.click('[data-creer-demande]');
await page.waitForTimeout(1200);

const ordreAvant = await page.$$eval('[data-colonne-kanban="a-faire"] [data-demande]', (els) =>
  els.map((e) => e.dataset.demande),
);
if (ordreAvant.length >= 2) {
  // On prend la DERNIÈRE et on la pose tout en haut de sa propre colonne.
  await glisser(ordreAvant[ordreAvant.length - 1], '[data-colonne-kanban="a-faire"]', 'haut');
  const ordreApres = await page.$$eval('[data-colonne-kanban="a-faire"] [data-demande]', (els) =>
    els.map((e) => e.dataset.demande),
  );
  noter(
    'une demande se réordonne À L’INTÉRIEUR de sa colonne',
    ordreApres[0] === ordreAvant[ordreAvant.length - 1] && ordreApres.length === ordreAvant.length,
    `${ordreAvant.join(',')} → ${ordreApres.join(',')}`,
  );
} else {
  noter('une demande se réordonne À L’INTÉRIEUR de sa colonne', false, 'moins de deux demandes en colonne');
}

/*
 * LE GLISSER À LA SOURIS, ET LE DÉPÔT DANS LE VIDE D'UNE COLONNE.
 *
 * Deux trous que le contrôle laissait passer, et par où la panne est entrée :
 * il ne rejouait que le DOIGT (`pointerType: 'touch'`, avec appui long), et il
 * ne lâchait qu'au MILIEU d'une colonne — là où une carte se trouve déjà. À la
 * souris la prise est immédiate (aucun délai d'appui), et le dépôt doit réussir
 * dans le VIDE sous la dernière vignette : c'est le geste naturel pour poser
 * une carte dans une colonne encore déserte.
 *
 * On en profite pour vérifier l'APERÇU : pendant le port, un bloc suit le
 * curseur et porte le TITRE de la demande, jamais son identifiant. Sans lui,
 * on ne voit rien bouger et le glisser passe pour cassé.
 */
async function glisserALaSouris(idDemande, versSelecteur) {
  return page.evaluate(
    async ({ idDemande, versSelecteur }) => {
      const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
      const vignette = document.querySelector(`[data-demande="${idDemande}"]`);
      const cible = document.querySelector(versSelecteur);
      if (!vignette || !cible) throw new Error('vignette ou cible introuvable');
      const titre = vignette.querySelector('h3')?.textContent?.trim() ?? '';
      const depart = vignette.getBoundingClientRect();
      const boite = cible.getBoundingClientRect();
      // ON VISE LE VIDE : quelques pixels au-dessus du bas de la colonne, donc
      // SOUS la dernière vignette qu'elle contient.
      const x = boite.left + boite.width / 2;
      const y = boite.bottom - 6;
      const px = depart.left + depart.width / 2;
      const py = depart.top + 10;
      // ON SONDE LE POINT D'APPUI : émettre sur un élément couvert par un autre
      // ne prouverait rien du geste réel.
      const appui = document.elementFromPoint(px, py);
      if (!appui || !appui.closest(`[data-demande="${idDemande}"]`)) {
        throw new Error('la vignette n’est pas sous le point d’appui');
      }
      // ET ON SONDE LE POINT D'ARRIVÉE : s'il ne tombe pas dans la colonne,
      // c'est que la colonne ne fait pas toute la hauteur — la panne même.
      const sousLArrivee = document.elementFromPoint(x, y);
      const dansLaColonne = Boolean(sousLArrivee && sousLArrivee.closest(versSelecteur));
      const emettre = (type, cx, cy, sur) =>
        sur.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: cx,
            clientY: cy,
            button: 0,
            pointerType: 'mouse',
          }),
        );
      emettre('pointerdown', px, py, appui);
      // À LA SOURIS, AUCUN DÉLAI : le premier mouvement franchit le seuil.
      emettre('pointermove', px + 40, py + 40, window);
      await attendre(40);
      emettre('pointermove', x, y, window);
      await attendre(40);
      const apercu = document.querySelector('[data-apercu-glisse]');
      const vu = {
        dansLaColonne,
        apercuVisible: Boolean(apercu),
        apercuPorteLeTitre: Boolean(apercu && titre && apercu.textContent.trim() === titre),
        colonneVisee: Boolean(document.querySelector(`${versSelecteur}[data-colonne-visee]`)),
      };
      emettre('pointerup', x, y, window);
      return vu;
    },
    { idDemande, versSelecteur },
  );
}

const aGlisser = await page.$$eval('[data-colonne-kanban="a-faire"] [data-demande]', (els) =>
  els.map((e) => e.dataset.demande),
);
if (aGlisser.length) {
  const vu = await glisserALaSouris(aGlisser[0], '[data-colonne-kanban="valide"]');
  await page.waitForTimeout(1200);
  noter(
    'le bas d’une colonne VIDE est bien une surface de dépôt',
    vu.dansLaColonne === true,
    JSON.stringify(vu),
  );
  noter("un aperçu suit le curseur pendant le port", vu.apercuVisible === true);
  noter(
    "et cet aperçu porte le TITRE de la demande, pas son identifiant",
    vu.apercuPorteLeTitre === true,
  );
  noter('la colonne visée se signale pendant le port', vu.colonneVisee === true);
  const dansValide = await page.locator('[data-colonne-kanban="valide"] [data-demande]').count();
  noter(
    'une demande se glisse À LA SOURIS, et tombe dans le VIDE d’une colonne',
    dansValide === 1,
    String(dansValide),
  );
  /* L'APERÇU NE SURVIT PAS AU RELÂCHEMENT : sinon il resterait collé à l'écran. */
  noter(
    "l’aperçu disparaît dès qu’on lâche",
    (await page.locator('[data-apercu-glisse]').count()) === 0,
  );
} else {
  noter('une demande se glisse À LA SOURIS, et tombe dans le VIDE d’une colonne', false, 'aucune demande à glisser');
}

/* ---------------- 5 bis. Filtre, recherche et compteur, PAR COLONNE ---------------- */

/*
 * LES ICÔNES DE LA VIGNETTE SONT SUR LA LIGNE DU « ⋮ ». Le trombone et la bulle
 * tombaient une ligne plus bas que les trois points : on mesure le centre
 * vertical de chacun, au pixel près, sur chaque vignette qui porte des compteurs.
 */
const alignement = await page.evaluate(() => {
  const ecarts = [];
  for (const vignette of document.querySelectorAll('[data-demande]')) {
    const menu = vignette.querySelector('[data-menu-actions="vignette"]');
    const icones = vignette.querySelectorAll('[data-compteur-pieces], [data-compteur-commentaires]');
    if (!menu || !icones.length) continue;
    const centre = (el) => {
      const b = el.getBoundingClientRect();
      return b.top + b.height / 2;
    };
    for (const icone of icones) ecarts.push(Math.abs(centre(icone) - centre(menu)));
  }
  return { mesures: ecarts.length, pire: ecarts.length ? Math.max(...ecarts) : -1 };
});
noter(
  'le trombone et la bulle sont centrés sur la ligne du « ⋮ »',
  alignement.mesures > 0 && alignement.pire <= 1,
  JSON.stringify(alignement),
);

const compter = (colonne) => page.locator(`[data-colonne-kanban="${colonne}"] [data-demande]`).count();
const avantRecherche = await compter('a-faire');
const valideAvant = await compter('valide');
await page.locator('[data-recherche-colonne-bouton="a-faire"]').click();
await page.fill('[data-recherche-colonne="a-faire"]', 'Deuxième');
await page.waitForTimeout(500);
const apresRecherche = await compter('a-faire');
noter(
  'la recherche d’une colonne garde ce qu’elle nomme',
  apresRecherche === 1 && avantRecherche >= 1,
  `${avantRecherche} → ${apresRecherche}`,
);
await page.fill('[data-recherche-colonne="a-faire"]', 'introuvable-nulle-part');
await page.waitForTimeout(500);
noter(
  'la pastille du filtre compte les demandes masquées',
  (await compter('a-faire')) === 0 &&
    (await page.getAttribute('[data-filtre-colonne="a-faire"]', 'data-masquees')) === String(avantRecherche) &&
    (await page.getAttribute('[data-menu-actions="filtre-a-faire"]', 'data-actifs')) === String(avantRecherche),
  `masquées : ${await page.getAttribute('[data-filtre-colonne="a-faire"]', 'data-masquees')} sur ${avantRecherche}`,
);
noter('les autres colonnes ne bougent pas', (await compter('valide')) === valideAvant);
await page.fill('[data-recherche-colonne="a-faire"]', '');
await page.waitForTimeout(400);
noter(
  'le champ vidé, la pastille disparaît',
  (await page.getAttribute('[data-filtre-colonne="a-faire"]', 'data-masquees')) === '0' &&
    (await page.getAttribute('[data-menu-actions="filtre-a-faire"]', 'data-actifs')) === null,
);

/* LE TRI EST PAR COLONNE, sous le filtre de SA tête. */
await ouvrirLeFiltre('a-faire');
noter(
  'chaque colonne garde SON tri, rangé sous son filtre',
  (await page.locator('[data-tri-colonne="a-faire"]').count()) === 4,
);
noter(
  'plus aucune liste de tri dans l’entête d’une colonne',
  (await page.locator('[data-colonne-kanban] select').count()) === 0,
);

/*
 * CE QUI M'ATTEND SE LIT, IL NE SE DÉCLARE PLUS. Il n'y a plus de drapeau
 * « réponse attendue » : une demande dont les messages sont tous ouverts ne
 * paraît nulle part dans le filtre des non-lus — et ce filtre ne vide QUE sa
 * colonne.
 */
await page.click('[data-filtre-non-lues]');
await page.waitForTimeout(500);
await fermerLeTiroir();
noter(
  'le filtre « Messages non lus » écarte ce que j’ai déjà lu, dans SA colonne seulement',
  (await compter('a-faire')) === 0 && (await compter('valide')) === valideAvant,
  `à faire : ${await compter('a-faire')} · validé : ${await compter('valide')}`,
);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-espace-client]', { timeout: 30000 });
await page.waitForTimeout(800);
noter(
  'le filtre d’une colonne revient après un rechargement',
  (await compter('a-faire')) === 0 && Number(await page.getAttribute('[data-filtre-colonne="a-faire"]', 'data-masquees')) > 0,
);
await ouvrirLeFiltre('a-faire');
await page.click('[data-vider-filtres]');
await page.waitForTimeout(500);
noter(
  'plus aucun réglage de « réponse attendue » nulle part',
  (await page.locator('[data-attente-de]').count()) === 0 &&
    (await page.locator('[data-filtre-attente]').count()) === 0,
);

/* ---------------- 5 ter. L'archivage ---------------- */

await page.locator('[data-ouvrir-demande]').first().click();
await page.waitForSelector('[data-tiroir-demande]', { timeout: 20000 });
await page.waitForSelector('[data-fiche-chargee]', { timeout: 20000 });
const avantArchivage = await page.locator('[data-demande]').count();

/*
 * LES OPTIONS SONT DES BLOCS SUR FOND CONTRASTÉ, SANS TRAIT — et un changement
 * d'importance se lit dans l'historique avec ses DEUX bouts.
 */
await page.click('[data-bloc-bascule="options"]');
await page.waitForSelector('[data-accordeon="options-fiche"]', { timeout: 10000 });
noter(
  'les options de la fiche se posent en blocs contrastés, sans trait',
  await page.evaluate(() => {
    const accordeon = document.querySelector('[data-accordeon="options-fiche"]');
    const bloc = accordeon?.closest('[data-bloc-fiche]');
    const sections = [...(accordeon?.querySelectorAll('[data-accordeon-section]') ?? [])];
    return (
      accordeon?.dataset.accordeonVariante === 'blocs' &&
      sections.length === 3 &&
      sections.every(
        (s) =>
          getComputedStyle(s).borderBottomWidth === '0px' &&
          getComputedStyle(s).backgroundColor !== getComputedStyle(bloc).backgroundColor,
      )
    );
  }),
);
await page.click('[data-accordeon-bascule="importance"]');
await page.waitForSelector('[data-importance="basse"]', { timeout: 10000 });
await page.click('[data-importance="basse"]');
await page.waitForTimeout(700);
await page.click('[data-importance="urgente"]');
await page.waitForTimeout(1200);
// On replie les options : la suite vérifie qu'elles ne vivent pas dans le « ⋮ ».
await page.click('[data-bloc-bascule="options"]');
await page.waitForTimeout(300);

/* RANGER EST UN GESTE RARE : il vit sous le « … » du tiroir, plus en pied. */
await page.click('[data-menu-actions="fiche"]');
await page.waitForSelector('[data-archiver-demande]', { timeout: 10000 });
/*
 * LE MENU DE LA FICHE NE GARDE QUE LES GESTES RARES : les options en sont
 * parties (elles vivent au pied de la fiche), et l'historique y est en DERNIER
 * et REPLIÉ — sa ligne de titre disant seulement combien de lignes il porte.
 */
noter(
  'le « ⋮ » de la fiche n’a plus les options : elles sont dans la fiche',
  (await page.locator('[data-accordeon="options-fiche"]').count()) === 0 &&
    (await page.locator('[data-tiroir-demande] [data-bloc-fiche="options"]').count()) === 1,
);
noter(
  'l’historique est le DERNIER bloc du menu, et il est replié',
  (await page.locator('[data-bloc-repliable="historique"]').count()) === 1 &&
    (await page.locator('[data-bloc-repliable="historique"][data-bloc-ouvert]').count()) === 0 &&
    (await page.locator('[data-historique-liste]').count()) === 0,
);
await page.click('[data-bloc-bascule="historique"]');
await page.waitForTimeout(300);
noter(
  'ouvert, il rend sa liste',
  (await page.locator('[data-historique-liste]').count()) === 1,
);
{
  const ligne = page.locator('[data-activite-importance="basse>urgente"]').first();
  const texte = (await ligne.count()) ? ((await ligne.textContent()) ?? '') : '';
  noter(
    'l’historique dit « Basse → Urgente », avec son auteur',
    /Basse → Urgente/.test(texte) && /client/i.test(texte),
    texte.replace(/\s+/g, ' ').trim(),
  );
}
await page.click('[data-archiver-demande]');
await page.waitForTimeout(1400);
noter(
  'une demande archivée sort du tableau',
  (await page.locator('[data-demande]').count()) === avantArchivage - 1,
);
await basculerLesArchives();
noter(
  'le filtre « Demandes archivées » de chaque colonne la retrouve, hors du tableau',
  (await page.locator('[data-demande]').count()) === 1,
  String(await page.locator('[data-demande]').count()),
);
await basculerLesArchives();
noter(
  'le filtre d’archives éteint, le tableau revient aux demandes vivantes',
  (await page.locator('[data-demande]').count()) === avantArchivage - 1,
);

/* ---------------- 5 quater. Ce que je n'ai pas lu ---------------- */

/*
 * LE CHIFFRE DE LA TÊTE DE COLONNE COMPTE CE QUE JE N'AI PAS LU, pas ce que la
 * colonne contient. On écrit donc un message de HAIKO directement en base — le
 * client, seul devant son écran, ne peut pas s'en fabriquer un — puis on
 * recharge : la vignette et la tête de colonne doivent le dire toutes les deux.
 */
const visee = await page.locator('[data-demande]').first().getAttribute('data-demande');
{
  const base = new Database(path.join(DATA, 'beluga.db'));
  base
    .prepare('INSERT INTO demande_messages (id, demande_id, auteur_id, data, cree_le) VALUES (?, ?, ?, ?, ?)')
    .run(
      `m-${crypto.randomUUID()}`,
      visee,
      'u-haiko',
      JSON.stringify({ auteurNom: 'Haiko', auteurRole: 'admin', texte: 'Une question pour vous.', fichiers: [] }),
      Date.now(),
    );
  base.close();
}
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-espace-client]', { timeout: 30000 });
await page.waitForTimeout(800);
const compteur = await page.locator('[data-non-lues-colonne]').first().textContent();
noter(
  'la tête de colonne compte les demandes que je n’ai pas lues',
  (compteur ?? '').trim() === '1',
  String(compteur).trim(),
);
noter(
  '…et la vignette le dit elle aussi, en toutes lettres',
  (await page.locator(`[data-demande="${visee}"] [data-non-lus-vignette]`).count()) === 1,
);
/* LA PASTILLE EST À CHEVAL SUR LE COIN HAUT DROIT, BLEUE (« à lire »), et
   aucune zone qui défile ne la rogne. */
const coinVignette = await page.evaluate((id) => {
  const pastille = document.querySelector(`[data-demande="${id}"] [data-non-lus-vignette]`);
  const cadre = pastille?.closest('[data-cadre-vignette]');
  if (!pastille || !cadre) return null;
  const p = pastille.getBoundingClientRect();
  const c = cadre.getBoundingClientRect();
  let rognee = false;
  for (let el = pastille.parentElement; el; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (![style.overflowX, style.overflowY].some((o) => o !== 'visible')) continue;
    const r = el.getBoundingClientRect();
    if (p.top < r.top - 0.5 || p.right > r.right + 0.5) rognee = true;
  }
  return {
    surLeCoin: Math.abs(p.left + p.width / 2 - c.right) <= 2 && Math.abs(p.top + p.height / 2 - c.top) <= 2,
    ton: pastille.getAttribute('data-pastille'),
    rognee,
  };
}, visee);
noter(
  '…par une pastille bleue, à cheval sur le coin haut droit, jamais rognée',
  !!coinVignette && coinVignette.surLeCoin && coinVignette.ton === 'lire' && !coinVignette.rognee,
  JSON.stringify(coinVignette),
);

/* OUVRIR, C'EST AVOIR LU : le compte retombe, sans rien cocher. */
await page.click(`[data-ouvrir-demande="${visee}"]`);
await page.waitForSelector('[data-fiche-chargee]', { timeout: 20000 });
await page.waitForTimeout(900);
await quitterLaFiche();
await page.waitForTimeout(900);
noter(
  'ouvrir la fiche éteint le compte, sans qu’on ait rien à cocher',
  (await page.locator('[data-non-lues-colonne]').count()) === 0,
  String(await page.locator('[data-non-lues-colonne]').count()),
);

/*
 * LE LIEN D'UN COURRIEL OUVRE LA FICHE. On recharge la page sur l'adresse que
 * porte le courriel du lundi matin : le tiroir doit s'ouvrir tout seul, sur la
 * bonne demande.
 */
await page.goto(`${RACINE_CLIENTE}/#projet/${PROJET}/demande/${visee}`, {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.waitForSelector('[data-fiche-chargee]', { timeout: 30000 });
noter(
  'le lien d’un courriel ouvre directement la fiche de sa demande',
  (await page.locator(`[data-tiroir-demande="${visee}"]`).count()) === 1 ||
    (await page.locator('[data-tiroir-demande]').count()) === 1,
);
/*
 * L'ESPACE ÉCRIT SON ADRESSE, il ne fait plus que la lire. Un fragment reçu
 * d'un courriel doit RESTER tel quel (rien ne se réécrit par-dessus), refermer
 * la fiche doit rendre l'adresse nue, et ouvrir une fiche à la main doit
 * l'écrire — sans empiler d'entrée d'historique, une fiche n'étant qu'un détail
 * d'affichage dans l'espace.
 */
noter(
  '…et l’adresse reçue reste telle quelle, sans être réécrite',
  (await page.evaluate(() => window.location.hash)) === `#projet/${PROJET}/demande/${visee}`,
  await page.evaluate(() => window.location.hash),
);
const entreesAvant = await page.evaluate(() => window.history.length);
await quitterLaFiche();
await page.waitForTimeout(600);
noter(
  'refermer la fiche rend l’adresse nue, sans empiler d’entrée d’historique',
  (await page.evaluate(() => window.location.hash)) === '' &&
    (await page.evaluate(() => window.history.length)) === entreesAvant,
  `${await page.evaluate(() => window.location.hash || '(nue)')} · ${await page.evaluate(() => window.history.length)} entrée(s)`,
);

await page.locator('[data-ouvrir-demande]').first().click();
await page.waitForSelector('[data-tiroir-demande]', { timeout: 20000 });
await page.waitForTimeout(400);
const adresseDeLaFiche = await page.evaluate(() => window.location.hash);
noter(
  'ouvrir une fiche ÉCRIT son adresse : elle devient partageable',
  /^#projet\/[^/]+\/demande\/.+$/.test(adresseDeLaFiche),
  adresseDeLaFiche || '(nue)',
);
await quitterLaFiche();
await page.waitForTimeout(600);

/* ---------------- 6. L'onglet « Discussion » ---------------- */

/*
 * L'ONGLET SE GLISSE À L'HORIZONTALE SEULEMENT. Un vrai glisser à la souris
 * (événements de pointeur du navigateur), en DIAGONALE : il doit suivre le X et
 * ignorer le Y. On sonde d'abord le point d'appui — émettre sur un élément
 * couvert ne prouverait rien — et le clic que le navigateur émet au lâcher ne
 * doit pas ouvrir la fenêtre.
 */
/* L'ONGLET NE COLLE PAS AU BORD : à sa place par défaut, il garde la marge du menu du bas (12 px). */
const margeOnglet = await page.evaluate(() => {
  const onglet = document.querySelector('[data-onglet-discussion]');
  const bande = document.querySelector('[data-bande-discussion]');
  const o = onglet.getBoundingClientRect();
  const b = bande.getBoundingClientRect();
  return { position: onglet.getAttribute('data-position'), droite: Math.round(b.right - o.right), libelle: onglet.textContent.includes('Discussion') };
});
noter(
  'sur ordinateur, l’onglet garde son libellé et la marge du menu au bord droit',
  margeOnglet.libelle && (margeOnglet.position !== '1' || margeOnglet.droite >= 11),
  JSON.stringify(margeOnglet),
);
const avantGlisse = await page.locator('[data-onglet-discussion]').boundingBox();
const appuiX = avantGlisse.x + avantGlisse.width / 2;
const appuiY = avantGlisse.y + avantGlisse.height / 2;
noter(
  'l’onglet est bien sous le point d’appui',
  await page.evaluate(
    ([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('[data-onglet-discussion]')),
    [appuiX, appuiY],
  ),
);
await page.mouse.move(appuiX, appuiY);
await page.mouse.down();
await page.mouse.move(appuiX - 60, appuiY - 50, { steps: 4 });
await page.mouse.move(appuiX - 280, appuiY - 220, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(400);
const apresGlisse = await page.locator('[data-onglet-discussion]').boundingBox();
noter(
  'l’onglet suit le glisser à l’horizontale, jamais à la verticale',
  apresGlisse.x - avantGlisse.x < -150 && Math.abs(apresGlisse.y - avantGlisse.y) <= 1,
  `dx : ${Math.round(apresGlisse.x - avantGlisse.x)} px · dy : ${Math.round(apresGlisse.y - avantGlisse.y)} px`,
);
noter('lâcher l’onglet n’ouvre pas la discussion', (await page.locator('[data-fenetre-discussion]').count()) === 0);
const positionGlissee = await page.getAttribute('[data-onglet-discussion]', 'data-position');
/* L'adresse porte encore la fiche du lien de courriel : on revient à l'espace
   NU, sinon la fiche se rouvrirait par-dessus l'onglet. */
await page.goto(`${RACINE_CLIENTE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[data-onglet-discussion]', { timeout: 30000 });
await page.waitForTimeout(500);
noter(
  'la position de l’onglet revient après un rechargement',
  (await page.getAttribute('[data-onglet-discussion]', 'data-position')) === positionGlissee,
  String(positionGlissee),
);

await page.click('[data-onglet-discussion]');
await page.waitForSelector('[data-fenetre-discussion] [data-volet-discussion]', { timeout: 20000 });
const placeFenetre = await page.evaluate(() => {
  const o = document.querySelector('[data-onglet-discussion]').getBoundingClientRect();
  const f = document.querySelector('[data-fenetre-discussion]').getBoundingClientRect();
  return {
    auDessus: f.bottom <= o.top + 1,
    dansLEcran: f.left >= -1 && f.right <= window.innerWidth + 1,
    suitLOnglet: f.left <= o.right && f.right >= o.left,
  };
});
noter(
  'un clic ouvre la fenêtre juste au-dessus de l’onglet, sans sortir de l’écran',
  placeFenetre.auDessus && placeFenetre.dansLEcran && placeFenetre.suitLOnglet,
  JSON.stringify(placeFenetre),
);
noter('la discussion ne passe plus par le volet de droite', (await page.locator('[data-volet-ancre]').count()) === 0);
noter(
  'ouvrir la discussion écrit SON adresse, celle que porte le courriel',
  (await page.evaluate(() => window.location.hash)) === '#discussion',
  await page.evaluate(() => window.location.hash || '(nue)'),
);

await page.fill('[data-champ-message]', 'Bonjour, une question rapide.');
await page.click('[data-envoyer-message]');
await page.waitForSelector('[data-message-fil]', { timeout: 20000 });
noter('le message envoyé apparaît dans le fil', (await page.locator('[data-message-fil]').count()) >= 1);

/*
 * LA DISCUSSION DIT QUI PARLE, ET CE QUI RESTE À LIRE.
 *
 * Deux promesses tenues ensemble, parce qu'elles se vérifient sur le même
 * message : le NOM DE L'AUTEUR se lit SOUS les bulles REÇUES (jamais sous les
 * miennes), et la PASTILLE du bouton « Discussion » compte LES SEULS MESSAGES
 * NON LUS DE CE FIL — plus le compteur d'ensemble de l'espace, qui mélangeait
 * les commentaires des demandes.
 */
noter(
  'mes propres bulles restent nues : je sais qui les a écrites',
  (await page.locator('[data-volet-discussion] [data-bulle="moi"]').count()) >= 1 &&
    (await page.locator('[data-volet-discussion] [data-auteur-message]').count()) === 0,
);
/* La fenêtre se referme, puis Haiko écrit — par la base, comme partout ici. */
await page.click('[data-onglet-discussion]');
await page.waitForTimeout(300);
{
  const base = new Database(path.join(DATA, 'beluga.db'));
  base
    .prepare('INSERT INTO fil_messages (id, fil_id, auteur_id, data, cree_le) VALUES (?, ?, ?, ?, ?)')
    .run(
      `f-${crypto.randomUUID()}`,
      'u-essai',
      'u-haiko',
      JSON.stringify({ auteurNom: 'Haiko Studio', auteurRole: 'admin', texte: 'Bonjour, c’est noté.', fichiers: [] }),
      Date.now(),
    );
  base.close();
}
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-onglet-discussion]', { timeout: 30000 });
await page.waitForTimeout(1200);
const pastilleDuFil = await page.getAttribute('[data-non-lus-discussion]', 'data-non-lus-discussion');
noter(
  'la pastille du bouton « Discussion » compte le message non lu du fil',
  pastilleDuFil === '1',
  String(pastilleDuFil),
);
await page.click('[data-onglet-discussion]');
await page.waitForSelector('[data-fenetre-discussion] [data-volet-discussion]', { timeout: 20000 });
await page.waitForTimeout(1200);
const auteur = await page.evaluate(() => {
  const recue = [...document.querySelectorAll('[data-volet-discussion] [data-bulle="autre"]')].pop();
  /* La bulle vit dans sa rangée ; le nom est la rangée JUSTE APRÈS — hors de
     la bulle, c'est tout l'intérêt. */
  const nom = recue?.parentElement?.nextElementSibling?.querySelector('[data-auteur-message]');
  if (!recue || !nom) return null;
  const b = recue.getBoundingClientRect();
  const n = nom.getBoundingClientRect();
  return {
    texte: nom.textContent.trim(),
    sousLaBulle: n.top >= b.bottom - 1,
    horsDeLaBulle: !recue.contains(nom),
    aGauche: Math.abs(n.left - b.left) < 12,
  };
});
noter(
  'le nom de l’auteur se lit SOUS la bulle reçue, hors d’elle et de son côté',
  !!auteur && auteur.texte === 'Haiko Studio' && auteur.sousLaBulle && auteur.horsDeLaBulle && auteur.aGauche,
  JSON.stringify(auteur),
);
await page.waitForTimeout(1500);
noter(
  'la pastille s’éteint dès que la discussion est ouverte et lue',
  (await page.locator('[data-non-lus-discussion]').count()) === 0,
);

/*
 * Sur téléphone : les colonnes passent dans un RAIL ancré, et le volet devient
 * un tiroir montant. Le détail de cet écran-là se joue dans son propre
 * contrôle — `node scripts/verif-messagerie-mobile.mjs`.
 */
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
const wagons = await page.locator('[data-rail-colonnes] [data-colonne-kanban]').count();
noter('sur téléphone, les QUATRE colonnes passent dans un rail', wagons === 4, String(wagons));

const fenetreTelephone = await page.evaluate(() => {
  const f = document.querySelector('[data-fenetre-discussion]');
  if (!f) return null;
  const b = f.getBoundingClientRect();
  return { part: Math.round((b.width / window.innerWidth) * 100) / 100, dedans: b.left >= -1 && b.right <= window.innerWidth + 1 };
});
noter(
  'sur téléphone, la fenêtre de discussion prend presque toute la largeur',
  Boolean(fenetreTelephone) && fenetreTelephone.part > 0.9 && fenetreTelephone.dedans,
  JSON.stringify(fenetreTelephone),
);
if (await page.locator('[data-fenetre-discussion]').count()) {
  await page.click('[data-onglet-discussion]');
  await page.waitForTimeout(400);
}

/*
 * LE TIROIR D'UNE FICHE MONTE JUSQU'EN HAUT. Le mode « plein » ne donnait qu'un
 * PLAFOND : une fiche au contenu court s'arrêtait au milieu de l'écran et
 * laissait une bande morte en haut. On mesure donc la HAUTEUR RÉELLE de la
 * feuille, pas la valeur écrite dans la feuille de style.
 */
/* « ACCÈS » ET « BACKUPS » SONT DES TIROIRS DE L'APPLICATION : ils se referment
   à la touche d'échappement, comme la fiche d'une demande. */
if (await page.locator('[data-volet-espace]').count()) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}
await page.locator('[data-ouvrir-demande]').first().click();
await page.waitForSelector('[data-fiche-chargee]', { timeout: 20000 });
/* LA FEUILLE MONTE : on mesure sa place UNE FOIS POSÉE, pas en plein vol. */
await page.waitForTimeout(700);
const feuille = await page.evaluate(() => {
  const tiroir = document.querySelector('[data-tiroir-demande]')?.closest('[data-tiroir]');
  if (!tiroir) return null;
  const boite = tiroir.getBoundingClientRect();
  return { haut: Math.round(boite.top), part: boite.height / window.innerHeight, mode: tiroir.dataset.tiroir };
});
noter(
  'sur téléphone, la fiche occupe toute la hauteur et touche le haut de l’écran',
  Boolean(feuille) && feuille.mode === 'plein' && feuille.haut <= 14 && feuille.part > 0.95,
  feuille ? `haut : ${feuille.haut} px · part : ${feuille.part.toFixed(2)}` : 'tiroir introuvable',
);
await page.keyboard.press('Escape');
await page.waitForTimeout(450);

/*
 * ET L'ENTÊTE DE L'ESPACE TIENT SUR UN SEUL RANG — UN SEUL POUR TOUT. La porte
 * client posait le sien par-dessus (« Messagerie », le nom du client, un lien
 * « Se déconnecter ») : deux traits et deux hauteurs de rang avant le tableau.
 * Les repères qui restent — le nom du projet, celui du client et le burger —
 * vivent sur la même ligne, à quelques pixels près.
 */
const rangs = await page.evaluate(() => {
  const reperes = ['[data-nom-projet]', '[data-bouton-theme]', '[data-menu-actions="espace-menu"]'];
  const hauts = reperes
    .map((r) => document.querySelector(r)?.getBoundingClientRect().top)
    .filter((v) => typeof v === 'number');
  return { compte: hauts.length, ecart: hauts.length ? Math.max(...hauts) - Math.min(...hauts) : -1 };
});
noter(
  'l’entête de l’espace tient sur une seule ligne',
  rangs.compte === 3 && rangs.ecart <= 12,
  `repères trouvés : ${rangs.compte} · écart vertical : ${rangs.ecart} px`,
);

/*
 * LA DÉCONNEXION EST UNE ACTION DU BURGER, jamais un lien souligné : un
 * `button` de son menu, absent de l'entête.
 */
await ouvrirLeBurger();
noter(
  'la déconnexion est une action du burger, et non un lien de texte',
  await page.evaluate(() => {
    const bouton = document.querySelector('[data-se-deconnecter]');
    if (!bouton || bouton.tagName !== 'BUTTON') return false;
    if (bouton.closest('[data-entete-espace]') || !bouton.closest('[role="menu"]')) return false;
    return !document.querySelector('a[href="/auth/logout"]');
  }),
);
await fermerLeTiroir();

/*
 * ET LE RANG TIENT SUR UN TÉLÉPHONE ÉTROIT : le nom du projet et celui du
 * client cèdent en se tronquant, JAMAIS le burger, qui doit rester en entier
 * dans la fenêtre.
 */
await page.setViewportSize({ width: 320, height: 720 });
await page.waitForTimeout(400);
const etroit = await page.evaluate(() => {
  const boutons = ['[data-menu-actions="espace-menu"]']
    .map((r) => document.querySelector(r)?.getBoundingClientRect())
    .filter(Boolean);
  return {
    compte: boutons.length,
    dedans: boutons.every((b) => b.left >= -1 && b.right <= window.innerWidth + 1 && b.width > 10),
  };
});
noter(
  'à 320 px de large, le burger de l’entête reste entier dans l’écran',
  etroit.compte === 1 && etroit.dedans,
  `boutons : ${etroit.compte}`,
);

/* ---------------- 6 bis. PLUS AUCUNE LISTE NATIVE ---------------- */

/*
 * LE COMPTE EST À ZÉRO, PARTOUT. Les `select` de l'espace — projet, étiquette,
 * tri de colonne, client (le type a disparu) — sont remplacés par le sélecteur à tiroir
 * cherchable de l'application. Ce contrôle est le verrou de cette règle : il
 * regarde la page ENTIÈRE, tiroirs portés dans `body` compris.
 */
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(400);
noter('aucune liste native dans l’espace', (await page.locator('select').count()) === 0);
await ouvrirLeFiltre('a-faire');
noter(
  'aucune liste native non plus dans le tiroir du filtre',
  (await page.locator('select').count()) === 0,
);
noter(
  'le filtre d’une colonne range ses filtres et son tri',
  (await page.locator('[data-filtre-non-lues]').count()) === 1 &&
    (await page.locator('[data-filtre-importance]').count()) === 1 &&
    (await page.locator('[data-tri-colonne="a-faire"]').count()) === 4,
);
noter(
  'et la DISCUSSION n’a plus de bouton d’entête : un seul onglet sur la page',
  (await page.locator('[data-basculer-discussion]').count()) === 0 &&
    (await page.locator('[data-onglet-discussion]').count()) === 1,
);
noter('le filtre « Type » a disparu du menu', (await page.locator('[data-filtre-type]').count()) === 0);
await fermerLeTiroir();

/* ---------------- 6 ter. LA CLOCHE DU CLIENT, ET LES COMPTEURS DE HAIKO ---------------- */

/*
 * LES GESTES DE HAIKO PASSENT PAR SON VRAI CANAL. Un compte administrateur et
 * une session d'une heure (jeton HACHÉ) sont posés en base ; un second contexte
 * du navigateur ouvre l'administration et envoie ses commandes par `/ws`. Ce
 * qu'on regarde, c'est ce qui arrive CHEZ LE CLIENT : toast, cloche, fiche.
 */
const JETON_HAIKO = crypto.randomBytes(32).toString('hex');
{
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare(
    `INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le)
     VALUES ('u-haiko-essai', 'haiko-essai', 'admin', 'Haiko', ?, 'x', 1, ?)`,
  ).run(crypto.randomBytes(16).toString('hex'), maintenant);
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(JETON_HAIKO).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'verif-espace-client',
    'u-haiko-essai',
  );
  db.close();
}
const contexteHaiko = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
await contexteHaiko.addCookies([{ name: 'beluga_session', value: JETON_HAIKO, domain: '127.0.0.1', path: '/' }]);
const pageHaiko = await contexteHaiko.newPage();
await pageHaiko.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
/*
 * LA « LIGNE » MESSAGERIE EST UNE TUILE DE LA GRILLE DES SERVICES (refonte du
 * 11/10/2026) : elle a quitté la colonne de gauche pour le bouton tout à gauche
 * de la barre d'en-tête. LE CONTENU D'UN MENU EST DÉMONTÉ TANT QU'IL EST
 * FERMÉ : la tuile et ses pastilles ne se lisent donc que grille OUVERTE. On
 * l'ouvre avant chaque lecture (`ouvrirNavigation` ne touche pas une grille
 * déjà ouverte) ; la tuile redit alors ce que l'écran a reçu en direct.
 */
const tuileMessagerie = async (attente = 10000) => {
  await ouvrirNavigation(pageHaiko, { timeout: attente }).catch(() => undefined);
  return pageHaiko.evaluate(() => {
    const tuile = document.querySelector('[data-navigation-panneau="ouvert"] [data-ouvrir-espace-client]');
    if (!tuile) return null;
    const lire = (repere) => Number(tuile.querySelector(`[${repere}]`)?.getAttribute(repere) ?? 0);
    return { nonLu: lire('data-messagerie-non-lu'), aTraiter: lire('data-messagerie-a-traiter') };
  });
};
const ligneMessagerie = (await tuileMessagerie(30000)) !== null;
const aTraiterDeHaiko = async () => (await tuileMessagerie())?.aTraiter ?? 0;
const aTraiterAvant = ligneMessagerie ? await aTraiterDeHaiko() : 0;

const commandeHaiko = (cmd) =>
  pageHaiko.evaluate(
    (cmd) =>
      new Promise((resolve, reject) => {
        const canal = new WebSocket(`ws://${location.host}/ws`);
        const id = `essai-${Math.random().toString(36).slice(2)}`;
        const minuteur = setTimeout(() => {
          canal.close();
          reject(new Error('commande sans réponse'));
        }, 15000);
        canal.onopen = () => canal.send(JSON.stringify({ id, cmd }));
        canal.onmessage = (message) => {
          const event = JSON.parse(message.data);
          if (event.type !== 'ack' || event.id !== id) return;
          clearTimeout(minuteur);
          canal.close();
          if (event.ok) resolve(event.data);
          else reject(new Error(event.error));
        };
        canal.onerror = () => reject(new Error('canal refusé'));
      }),
    cmd,
  );
const pastilleCloche = () =>
  page.evaluate(() => Number(document.querySelector('[data-cloche-espace-pastille]')?.getAttribute('data-cloche-espace-pastille') ?? 0));

const cloche = page.locator('[data-cloche-espace]');
/* LA DÉCONNEXION A QUITTÉ L'ENTÊTE POUR LE BURGER : le repère du rang est donc
   le BURGER, seul bouton qui reste à droite de la cloche. */
const placeCloche = await page.evaluate(() => {
  const c = document.querySelector('[data-cloche-espace]')?.getBoundingClientRect();
  /* LE NOM DE LA PERSONNE A QUITTÉ L'ENTÊTE : le bouton de thème le remplace comme repère. */
  const nom = document.querySelector('[data-bouton-theme]')?.getBoundingClientRect();
  const burger = document.querySelector('[data-menu-actions="espace-menu"]')?.getBoundingClientRect();
  if (!c || !nom || !burger) return null;
  return { avantLeNom: c.right <= nom.left + 1, memeRang: Math.abs(c.top + c.height / 2 - (burger.top + burger.height / 2)) <= 6 };
});
noter(
  'la cloche est dans l’entête, sur le même rang que le burger, avant le bouton de thème',
  (await cloche.count()) === 1 && placeCloche?.avantLeNom && placeCloche?.memeRang,
  JSON.stringify(placeCloche),
);

const pastilleAvant = await pastilleCloche();
let demandeDeHaiko = null;
try {
  ({ demande: demandeDeHaiko } = await commandeHaiko({
    type: 'espace.demande.creer',
    projectId: PROJET,
    titre: 'Demande posée par Haiko',
  }));
} catch (err) {
  noter('Haiko pose une demande par son canal', false, err.message);
}
if (demandeDeHaiko) {
  const toast = await page
    .waitForSelector('[data-toast-cliquable]', { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  noter('une demande posée par Haiko fait paraître un toast cliquable chez le client', toast);
  const monte = await page
    .waitForFunction(
      (avant) => Number(document.querySelector('[data-cloche-espace-pastille]')?.getAttribute('data-cloche-espace-pastille') ?? 0) > avant,
      pastilleAvant,
      { timeout: 10000 },
    )
    .then(() => true)
    .catch(() => false);
  noter('…et la pastille de la cloche monte, sans rechargement', monte, `${pastilleAvant} → ${await pastilleCloche()}`);
  if (ligneMessagerie) {
    /* Sans rechargement : la page de Haiko n'a pas bougé, seule sa grille est rouverte pour lire la tuile. */
    let monteChezHaiko = false;
    for (const fin = Date.now() + 10000; Date.now() < fin && !monteChezHaiko; ) {
      monteChezHaiko = (await aTraiterDeHaiko()) > aTraiterAvant;
      if (!monteChezHaiko) await pageHaiko.waitForTimeout(300);
    }
    noter('chez Haiko, la pastille « à traiter » de la Messagerie monte en direct', monteChezHaiko, `${aTraiterAvant} → ${await aTraiterDeHaiko()}`);
  } else {
    noter('l’administration montre la ligne « Messagerie »', false);
  }

  /* UNE RAFALE : deux passes sur les cases, une seule ligne dans la cloche. */
  const taches = [{ id: 'k1', texte: 'Maquette', faite: false }];
  await commandeHaiko({ type: 'espace.demande.modifier', id: demandeDeHaiko.id, taches });
  await commandeHaiko({ type: 'espace.demande.modifier', id: demandeDeHaiko.id, taches: [{ ...taches[0], faite: true }] });
  await page.waitForTimeout(600);
  await cloche.click();
  await page.waitForSelector('[data-notification-espace]', { timeout: 10000 }).catch(() => undefined);
  noter(
    'deux mises à jour d’affilée ne font qu’une ligne dans la cloche',
    (await page.locator('[data-notification-espace="modification"]').count()) === 1,
    `${await page.locator('[data-notification-espace="modification"]').count()} ligne(s)`,
  );

  /* UN CLIC SUR LA LIGNE : la fiche s'ouvre, et ce qui en parlait est lu. */
  const pastilleAvantClic = await pastilleCloche();
  await page.locator('[data-notification-espace="nouvelle-demande"] [role="button"]').first().click();
  const ficheOuverte = await page
    .waitForSelector('[data-tiroir-demande]', { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  noter('un clic sur une ligne de la cloche ouvre la fiche de la demande', ficheOuverte);
  const retombe = await page
    .waitForFunction(
      (avant) => Number(document.querySelector('[data-cloche-espace-pastille]')?.getAttribute('data-cloche-espace-pastille') ?? 0) < avant,
      pastilleAvantClic,
      { timeout: 10000 },
    )
    .then(() => true)
    .catch(() => false);
  noter('…et la pastille retombe', retombe, `${pastilleAvantClic} → ${await pastilleCloche()}`);
  await fermerLeTiroir();

  /* LA PRISE EN CHARGE : un toast qui le dit. Le repère « Du nouveau » de la
     vignette, lui, n'existe plus — le badge bleu des non-lus reste seul. */
  await commandeHaiko({ type: 'espace.demande.enCarte', id: demandeDeHaiko.id }).catch((err) =>
    noter('Haiko transforme la demande en carte', false, err.message),
  );
  const toastPrise = await page
    .waitForFunction(
      () => [...document.querySelectorAll('[data-toast-client]')].some((t) => /pris en charge/.test(t.textContent ?? '')),
      null,
      { timeout: 10000 },
    )
    .then(() => true)
    .catch(() => false);
  noter('la prise en charge de sa demande prévient le client', toastPrise);

  /* TOUT MARQUER COMME LU. */
  await cloche.click();
  const toutLire = page.locator('[data-tout-lire-espace]');
  if (await toutLire.count()) await toutLire.click();
  const vide = await page
    .waitForFunction(() => !document.querySelector('[data-cloche-espace-pastille]'), null, { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  noter('« Tout marquer comme lu » éteint la pastille de la cloche', vide);
  await fermerLeTiroir();
}

/* À 320 px, la cloche tient encore dans l'écran. */
await page.setViewportSize({ width: 320, height: 700 });
await page.waitForTimeout(400);
const clocheEtroite = await page.evaluate(() => {
  const c = document.querySelector('[data-cloche-espace]')?.getBoundingClientRect();
  return c ? c.left >= -1 && c.right <= window.innerWidth + 1 && c.width > 10 : false;
});
noter('à 320 px de large, la cloche reste entière dans l’écran', clocheEtroite);
await page.setViewportSize({ width: 1280, height: 800 });
/* ------- Les deux pastilles de la Messagerie, client par client, dans la liste ------- */

{
  const totalTuile = (await tuileMessagerie()) ?? { nonLu: 0, aTraiter: 0 };
  /*
   * LE BOUTON DES SERVICES NE REDIT PLUS LES CHIFFRES (refonte du 11/10/2026) :
   * grille fermée, il porte un POINT dès qu'un message attend — une alerte ne
   * se cache jamais derrière lui —, et le compte se lit sur la tuile. Les deux
   * pastilles chiffrées du bouton ont disparu avec la colonne ; l'affirmation
   * qui les comparait passait à vide (zéro des deux côtés, faute de repère).
   */
  await pageHaiko.keyboard.press('Escape');
  await pageHaiko.waitForTimeout(400);
  const boutonDesServices = await pageHaiko.evaluate(() => {
    const bouton = document.querySelector('[data-entete-de-zone] [data-navigation-compacte]');
    return {
      present: !!bouton,
      ferme: bouton?.getAttribute('data-navigation-compacte') === 'fermee',
      point: !!bouton?.querySelector('[data-alerte-navigation]'),
      tuilesMontees: document.querySelectorAll('[data-ouvrir-espace-client]').length,
    };
  });
  noter(
    'grille fermée, le bouton des services porte un point dès que la Messagerie attend, et la tuile en donne le compte',
    boutonDesServices.present &&
      boutonDesServices.ferme &&
      boutonDesServices.tuilesMontees === 0 &&
      boutonDesServices.point &&
      totalTuile.nonLu + totalTuile.aTraiter > 0,
    `${JSON.stringify(boutonDesServices)} / tuile : ${JSON.stringify(totalTuile)}`,
  );

  let duServeur = null;
  try {
    const reponse = await commandeHaiko({ type: 'espace.clients' });
    duServeur = reponse?.clients ?? null;
  } catch (err) {
    noter('la commande « espace.clients » rend les compteurs par client', false, err.message);
  }
  noter(
    'la commande « espace.clients » rend les compteurs par client',
    Array.isArray(duServeur) &&
      duServeur.length > 0 &&
      duServeur.every((c) => Number.isInteger(c?.compteurs?.nonLu) && Number.isInteger(c?.compteurs?.aTraiter)),
    JSON.stringify(duServeur?.map((c) => [c.id, c.compteurs])),
  );

  await ouvrirNavigation(pageHaiko);
  await pageHaiko.click('[data-ouvrir-espace-client]:visible');
  /*
   * LA MESSAGERIE OUVRE SA VUE D'ENSEMBLE : le sélecteur de client, l'entête
   * d'un client et ses vignettes n'existent qu'une fois entré chez quelqu'un.
   * On entre donc par la première fiche, comme le ferait la main — juger
   * l'entête depuis l'accueil refusait un écran pourtant juste.
   */
  await pageHaiko.waitForSelector('[data-accueil-messagerie]', { timeout: 20000 }).catch(() => undefined);
  const premiereFiche = pageHaiko.locator('[data-fiche-client]').first();
  if (await premiereFiche.count()) {
    const vise = await premiereFiche.getAttribute('data-fiche-client');
    // On entre par l'adresse du client — le chemin d'une notification —, qui
    // n'ouvre pas la discussion : la suite compte justement les non-lus, que
    // la discussion ouverte marquerait lus.
    await pageHaiko.evaluate((id) => {
      history.pushState(null, '', `#espace/${id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, vise);
  }
  const tiroirOuvrable = await pageHaiko
    .waitForSelector('[data-choix-client]', { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  noter('la vue Haiko de la Messagerie montre le sélecteur de client', tiroirOuvrable);

  if (tiroirOuvrable && duServeur) {
    await pageHaiko.click('[data-choix-client]');
    await pageHaiko.waitForSelector('[data-liste-panneau="client"] [data-selecteur-option]', { timeout: 10000 }).catch(() => undefined);
    /*
     * LA LISTE EST UN PANNEAU ANCRÉ À SON BOUTON (`ListeDeroulante`,
     * `data-liste-panneau`), porté dans le `body` par portail : on la lit par
     * SON repère, plus par « le dernier dialogue de la page ».
     */
    const lignes = await pageHaiko.evaluate(() => {
      const tiroir = document.querySelector('[data-liste-panneau="client"]');
      if (!tiroir) return null;
      return [...tiroir.querySelectorAll('[data-selecteur-option]')].map((o) => ({
        client: o.getAttribute('data-selecteur-option'),
        nonLu: Number(o.querySelector('[data-messagerie-non-lu]')?.getAttribute('data-messagerie-non-lu') ?? 0),
        aTraiter: Number(o.querySelector('[data-messagerie-a-traiter]')?.getAttribute('data-messagerie-a-traiter') ?? 0),
        choisi: o.hasAttribute('data-selecteur-choisi'),
        detail: o.textContent ?? '',
      }));
    });
    noter('la liste « Clients » montre ses clients', Array.isArray(lignes) && lignes.length > 0, `${lignes?.length ?? 0} ligne(s)`);

    if (lignes?.length) {
      const attendu = new Map(duServeur.map((c) => [c.id, c.compteurs]));
      const fidele = lignes.every((l) => {
        const c = attendu.get(l.client);
        return c && l.nonLu === c.nonLu && l.aTraiter === c.aTraiter;
      });
      noter(
        'chaque ligne de la liste porte les chiffres que le serveur a rendus pour CE client',
        fidele,
        JSON.stringify(lignes.map((l) => [l.client, l.nonLu, l.aTraiter])),
      );

      /* Les lignes se somment vers le total, sans jamais le dépasser : un projet
         sans client compte pour l'administrateur et pour personne d'autre. */
      const somme = lignes.reduce(
        (t, l) => ({ nonLu: t.nonLu + l.nonLu, aTraiter: t.aTraiter + l.aTraiter }),
        { nonLu: 0, aTraiter: 0 },
      );
      noter(
        'la somme des lignes ne dépasse pas les pastilles de la tuile « Messagerie »',
        somme.nonLu <= totalTuile.nonLu && somme.aTraiter <= totalTuile.aTraiter,
        `${JSON.stringify(somme)} contre ${JSON.stringify(totalTuile)}`,
      );

      /* Un client sans rien n'affiche aucune pastille : le zéro ne s'écrit pas. */
      const zerosMuets = lignes.every((l) => {
        const c = attendu.get(l.client);
        return !c || ((c.nonLu > 0 || l.nonLu === 0) && (c.aTraiter > 0 || l.aTraiter === 0));
      });
      noter('un client sans rien n’affiche aucune pastille', zerosMuets);

      noter(
        'la coche du client retenu est toujours là, en bout de ligne',
        lignes.filter((l) => l.choisi).length === 1,
        `${lignes.filter((l) => l.choisi).length} coche(s)`,
      );

      /* Le chiffre gris sans légende a cédé la place aux pastilles légendées. */
      const auMoinsUnCompteur = lignes.some((l) => l.nonLu > 0 || l.aTraiter > 0);
      noter('au moins une ligne porte un compteur, dans le décor d’essai', auMoinsUnCompteur, JSON.stringify(lignes.map((l) => [l.nonLu, l.aTraiter])));
    }
    await pageHaiko.keyboard.press('Escape');
  }
}

/* ------- SUR TÉLÉPHONE, LA MESSAGERIE DE HAIKO TIENT SUR UN RANG ------- */

/*
 * RETOUCHE DU 11/10/2026. Le nom du client s'écrasait jusqu'à une lettre, et
 * ses deux boutons ouvraient une seconde rangée sous la barre. Le sélecteur de
 * client prend désormais la largeur qui reste (son icône masquée), la cloche
 * du client et le menu montent DANS la barre d'en-tête
 * (`data-gestes-de-page="barre"`, plus de rangée `="page"`), et le menu porte
 * trois points VERTICAUX dans l'application — le burger reste à la porte des
 * clients. La liste des clients, elle, n'ouvre plus une page : elle monte du
 * bas, dans le même panneau que sur ordinateur.
 */
if (await pageHaiko.locator('[data-choix-client]').count()) {
  await pageHaiko.setViewportSize({ width: 390, height: 844 });
  await pageHaiko.waitForTimeout(600);
  const rang = await pageHaiko.evaluate(() => {
    const barre = document.querySelector('[data-entete-de-zone]');
    const choix = barre?.querySelector('[data-choix-client]');
    const cloche = barre?.querySelector('[data-gestes-de-page="barre"] [data-cloche-espace]');
    const menu = barre?.querySelector('[data-gestes-de-page="barre"] [data-menu-actions="espace-menu"]');
    if (!barre || !choix || !cloche || !menu) return { ok: false, choix: !!choix, cloche: !!cloche, menu: !!menu };
    const nom = choix.querySelector('span');
    const icone = choix.querySelector('svg');
    const milieu = (el) => {
      const b = el.getBoundingClientRect();
      return b.top + b.height / 2;
    };
    const milieux = [choix, cloche, menu].map(milieu);
    const dedans = [choix, cloche, menu].every((el) => {
      const b = el.getBoundingClientRect();
      return b.left >= -1 && b.right <= window.innerWidth + 1 && b.width > 10;
    });
    return {
      ok: true,
      rangeeSousLaBarre: document.querySelectorAll('[data-gestes-de-page="page"]').length,
      ecartVertical: Math.round(Math.max(...milieux) - Math.min(...milieux)),
      dedans,
      nom: nom?.textContent?.trim() ?? '',
      nomEntier: !!nom && nom.scrollWidth <= nom.clientWidth + 1,
      iconeMasquee: !!icone && icone.getBoundingClientRect().width === 0,
      troisPoints: /ellipsis-vertical/.test(menu.querySelector('svg')?.getAttribute('class') ?? ''),
      deborde: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  noter(
    'sur téléphone, le client, sa cloche et le menu tiennent sur le rang de la barre d’en-tête, sans seconde rangée',
    rang.ok && rang.rangeeSousLaBarre === 0 && rang.ecartVertical <= 8 && rang.dedans && !rang.deborde,
    JSON.stringify(rang),
  );
  noter(
    'sur téléphone, le nom du client se lit en entier, son icône masquée',
    rang.ok && rang.nom.length > 1 && rang.nomEntier && rang.iconeMasquee,
    `« ${rang.nom ?? ''} »`,
  );
  noter('dans l’application, le menu de la Messagerie porte trois points verticaux', rang.ok && rang.troisPoints);

  await pageHaiko.click('[data-choix-client]');
  await pageHaiko.waitForSelector('[data-liste-panneau="client"]', { timeout: 10000 }).catch(() => undefined);
  await pageHaiko.waitForTimeout(500);
  const liste = await pageHaiko.evaluate(() => {
    const panneau = document.querySelector('[data-liste-panneau="client"]');
    if (!panneau) return null;
    const b = panneau.getBoundingClientRect();
    return {
      auBas: Math.round(window.innerHeight - b.bottom),
      largeur: Math.round(b.width),
      titre: panneau.querySelector('[data-liste-titre]')?.textContent?.trim() ?? null,
      poignee: !!panneau.querySelector('[data-liste-poignee]'),
      options: panneau.querySelectorAll('[data-selecteur-option]').length,
      /* Plus une page : la liste s'ouvre DANS la feuille commune du bas (`FeuilleDuBas`, 03/11/2026), celle du menu
         principal — qui porte elle-même `data-tiroir`, sans être une page de zone. */
      enPage: !!panneau.closest('[data-page-de-zone]') || !panneau.closest('[data-feuille-du-bas]'),
      adresse: window.location.hash,
      /* Le clavier ne monte pas tout seul : la recherche n'a pas le focus d'office. */
      focusDansUnChamp: ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? ''),
    };
  });
  noter(
    'sur téléphone, la liste des clients monte du bas dans un panneau (poignée, titre), et non dans une page',
    !!liste && liste.auBas <= 1 && liste.largeur >= 380 && liste.poignee && !!liste.titre && liste.options > 0 && !liste.enPage,
    JSON.stringify(liste),
  );
  noter(
    '…elle écrit son adresse (« /volet/choix ») et ne donne pas le focus à la recherche',
    !!liste && /\/volet\/choix$/.test(liste.adresse) && !liste.focusDansUnChamp,
    liste ? `${liste.adresse} · focus dans un champ : ${liste.focusDansUnChamp}` : 'liste introuvable',
  );
  /* « PRÉCÉDENT » LA REFERME, comme tout ce qui s'inscrit dans l'adresse. */
  await pageHaiko.goBack().catch(() => undefined);
  await pageHaiko.waitForTimeout(600);
  const refermee = (await pageHaiko.locator('[data-liste-panneau="client"]').count()) === 0;
  noter(
    '…et « Précédent » la referme, en laissant Haiko chez son client',
    refermee && (await pageHaiko.locator('[data-choix-client]').count()) === 1 && !/\/volet\//.test(await pageHaiko.evaluate(() => window.location.hash)),
    await pageHaiko.evaluate(() => window.location.hash),
  );
  if (!refermee) await pageHaiko.keyboard.press('Escape');
  await pageHaiko.setViewportSize({ width: 1440, height: 900 });
  await pageHaiko.waitForTimeout(600);
}

/* ------- LA PASTILLE DU BOUTON « DISCUSSION » CHEZ HAIKO, FENÊTRE FERMÉE ------- */

/*
 * LA SCÈNE EXACTE DE LA PANNE. L'écran de Haiko reste ouvert sur l'espace d'UN
 * client, sa fenêtre de discussion FERMÉE, et le client écrit. Seuls les
 * compteurs de la Messagerie partaient : la ligne de la colonne de gauche
 * montait, et le bouton « Discussion » restait nu tant qu'on ne l'ouvrait pas —
 * or la fenêtre fermée, rien n'écoutait le fil.
 */
{
  /* Le client écrit par SON canal : le geste est le même que dans la fenêtre,
     sans dépendre de l'écran qu'il a sous les yeux. */
  const commandeClient = (cmd) =>
    page.evaluate(
      (cmd) =>
        new Promise((resolve, reject) => {
          const canal = new WebSocket(`ws://${location.host}/ws`);
          const id = `essai-${Math.random().toString(36).slice(2)}`;
          const minuteur = setTimeout(() => {
            canal.close();
            reject(new Error('commande sans réponse'));
          }, 15000);
          canal.onopen = () => canal.send(JSON.stringify({ id, cmd }));
          canal.onmessage = (message) => {
            const event = JSON.parse(message.data);
            if (event.type !== 'ack' || event.id !== id) return;
            clearTimeout(minuteur);
            canal.close();
            if (event.ok) resolve(event.data);
            else reject(new Error(event.error));
          };
          canal.onerror = () => reject(new Error('canal refusé'));
        }),
      cmd,
    );

  /* La Messagerie est une VUE, pas un tiroir : elle est toujours là. */
  if (!(await pageHaiko.locator('[data-onglet-discussion]').count())) {
    await ouvrirNavigation(pageHaiko);
    await pageHaiko.click('[data-ouvrir-espace-client]:visible');
  }
  const ongletChezHaiko = await pageHaiko
    .waitForSelector('[data-onglet-discussion]', { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  noter('la vue Haiko d’un client porte le bouton « Discussion »', ongletChezHaiko);

  /** Le chiffre de la pastille, ou 0 quand elle n'est pas là. */
  const pastilleChezHaiko = () =>
    pageHaiko.evaluate(() =>
      Number(document.querySelector('[data-non-lus-discussion]')?.getAttribute('data-non-lus-discussion') ?? 0),
    );

  if (ongletChezHaiko) {
    const fenetreOuverte = await pageHaiko.locator('[data-fenetre-discussion]').count();
    if (fenetreOuverte) {
      await pageHaiko.click('[data-onglet-discussion]');
      await pageHaiko.waitForTimeout(400);
    }
    /* LE COMPTE DE DÉPART : le client a déjà écrit plus haut dans ce contrôle,
       la pastille doit donc être allumée SANS qu'on ouvre la fenêtre. */
    const auMontage = await pastilleChezHaiko();
    noter(
      'le compte des messages non lus s’affiche dès l’ouverture de l’espace du client',
      auMontage >= 1,
      String(auMontage),
    );

    await commandeClient({ type: 'espace.fil.envoyer', texte: 'Un mot de plus, fenêtre fermée.' }).catch((err) =>
      noter('le client écrit par son canal', false, err.message),
    );
    const monte = await pageHaiko
      .waitForFunction(
        (avant) =>
          Number(document.querySelector('[data-non-lus-discussion]')?.getAttribute('data-non-lus-discussion') ?? 0) >
          avant,
        auMontage,
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false);
    noter(
      'un message du client fait monter la pastille de Haiko, fenêtre FERMÉE et sans un geste',
      monte,
      `${auMontage} → ${await pastilleChezHaiko()}`,
    );

    /* OUVRIR LA FENÊTRE ÉTEINT LA PASTILLE — `espace.fil.vu` marque lus les
       messages d'en face, et le compte revient à zéro. */
    await pageHaiko.click('[data-onglet-discussion]');
    await pageHaiko.waitForSelector('[data-fenetre-discussion] [data-volet-discussion]', { timeout: 20000 });
    const eteinte = await pageHaiko
      .waitForFunction(() => !document.querySelector('[data-non-lus-discussion]'), null, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    noter('…et ouvrir la fenêtre l’éteint', eteinte, String(await pastilleChezHaiko()));

    /* FENÊTRE OUVERTE, UN MESSAGE RECU NE LA RALLUME PAS : on est en train de lire. */
    await commandeClient({ type: 'espace.fil.envoyer', texte: 'Et un dernier, fenêtre ouverte.' }).catch(() => undefined);
    const bulleArrivee = await pageHaiko
      .waitForFunction(
        () =>
          [...document.querySelectorAll('[data-fenetre-discussion] [data-bulle]')].some((b) =>
            /fenêtre ouverte/.test(b.textContent ?? ''),
          ),
        null,
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false);
    await pageHaiko.waitForTimeout(1200);
    noter(
      'un message reçu fenêtre OUVERTE se lit sans rallumer la pastille',
      bulleArrivee && (await pastilleChezHaiko()) === 0,
      `bulle : ${bulleArrivee}, pastille : ${await pastilleChezHaiko()}`,
    );
  }
}

/* ------- LE BADGE « DU NOUVEAU » A QUITTÉ LES VIGNETTES, DES DEUX CÔTÉS ------- */

/*
 * UNE ABSENCE NE PROUVE RIEN SANS SON PORTEUR : on vérifie d'abord qu'il y a
 * bien des vignettes à l'écran, chez le client comme chez Haiko.
 */
for (const [ou, ecran] of [
  ['client', page],
  ['Haiko', pageHaiko],
]) {
  const compte = await ecran.evaluate(() => ({
    vignettes: document.querySelectorAll('[data-demande]').length,
    badges: document.querySelectorAll('[data-nouveaute-vignette]').length,
    texte: /Du nouveau/.test(document.body.textContent ?? ''),
  }));
  noter(
    `côté ${ou}, aucune vignette ne porte plus le badge « Du nouveau »`,
    compte.vignettes > 0 && compte.badges === 0 && !compte.texte,
    JSON.stringify(compte),
  );
}

await contexteHaiko.close();

/* ---------------- 7. Aucune erreur dans la console ---------------- */

const graves = erreurs.filter((e) => !/favicon|manifest|service worker/i.test(e));
noter('aucune erreur dans la console du navigateur', graves.length === 0, graves.slice(0, 3).join(' | '));

await navigateur.close();

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
if (echecs.length) {
  console.error(`\n${echecs.length} contrôle(s) en échec :`);
  for (const e of echecs) console.error(`  - ${e.nom}`);
  process.exit(1);
}
process.exit(0);
