#!/usr/bin/env node
/**
 * SUR TÉLÉPHONE, L'ÉCRAN EST RENDU AU FLUX DE LA CONVERSATION.
 *
 *   node scripts/verif-parcours-telephone.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et
 * un FAUX moteur (le même décor que `verif-carte-fil-cadrage.mjs`), et joue le
 * parcours dans un vrai navigateur, à la taille d'un téléphone (390 × 844).
 *
 * Ce qui est vérifié :
 *   1. le titre de la carte tient sur UNE ligne, dans la barre d'en-tête de la
 *      page, et la barre d'étapes est collée juste dessous : rien d'autre ne
 *      s'intercale (la configuration de l'agent et les étiquettes sont repliées
 *      derrière deux boutons de cette barre) ;
 *   2. le FLUX occupe au moins 60 % de la hauteur de l'écran ;
 *   3. toucher un segment de la barre d'étapes fait DÉFILER jusqu'au point et
 *      l'ouvre ;
 *   4. un geste sur le « i » déplie les étiquettes, un geste sur le raccourci
 *      des réglages ouvre la configuration de l'agent ;
 *   5. rien de la page ne passe sous la barre d'état ni sous la barre d'accueil,
 *      relevé par le module commun `scripts/lib/zone-sure.mjs` ;
 *   6. l'en-tête a deux rangs (boutons globaux en haut, flèche, titre et
 *      branche à droite dessous) ; en descendant, le rang du haut et la barre
 *      d'étapes se replient — même par petits pas, même dans l'élan après le
 *      doigt levé — et reviennent au moindre vrai retour ; un retour de 5 px,
 *      le fil qui défile tout seul et le recul causé par le repli en bas du fil
 *      ne changent rien ; un champ rempli qu'on laisse tient sur une ligne et
 *      se rouvre au toucher (demande du 14/10/2026).
 *
 * RECALÉ SUR LA REFONTE (11/10/2026). La carte s'ouvre en PAGE : son titre vit
 * dans la barre d'en-tête (`EnteteDeZone`), les étiquettes derrière le « i »,
 * la configuration derrière le raccourci des réglages. Deux règles ont disparu
 * avec leur élément, et leurs affirmations avec elles : la barre d'onglets qui
 * se masquait au défilement (les onglets sont des lignes du menu à trois
 * points), et les ronds resserrés du flux (le fil est une discussion, sans rond
 * ni décalage).
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { ZONES_SURES_TYPES, formaterReleve, retirerZonesSures, verifierLesDeuxBords } from './lib/zone-sure.mjs';
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
const PORT = Number(process.env.BELUGA_TELEPHONE_PORT || 7209);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-telephone-'));
const PROJET_ID = 'projet-cadrage';
const DEMANDE = 'Ajouter un bouton pour exporter la liste en CSV';

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le décor : un vrai dépôt git, un faux moteur qui garde ses demandes */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
const DEMANDES = path.join(TMP, 'demandes');
/*
 * UN DOSSIER PERSONNEL À SOI. Sans lui, le démon d'essai adopterait le compte
 * Claude RÉEL de la machine (`bootstrapAccounts` lit `~/.claude`) : le contrôle
 * passerait ou échouerait selon le quota du jour, ce qui n'a rien à voir avec
 * ce qu'il vérifie.
 */
const MAISON = path.join(TMP, 'maison');
const COMPTE = path.join(TMP, 'compte-claude');
for (const dossier of [DATA, PROJETS, DEPOT, DEMANDES, MAISON, COMPTE]) fs.mkdirSync(dossier, { recursive: true });
/* Un compte « connecté » : la lecture de quota partira, échouera faute de jeton
   valable, et laissera le compte DISPONIBLE — ce que fait déjà tout relevé
   illisible. Aucun quota réel n'est consulté. */
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

/*
 * LE FAUX MOTEUR ÉCRIT CHAQUE DEMANDE REÇUE dans un dossier : c'est ainsi qu'on
 * prouve que la discussion de cadrage voyage vraiment jusqu'à l'exécution. Il
 * répond court, sans rien modifier — un tour de cadrage ne code pas.
 */
const FAUX_MOTEUR = path.join(TMP, 'faux-claude.mjs');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/usr/bin/env node
import fs from 'node:fs';

/* LA LIGNE DES ÉTAPES SE DÉROULE AVANT QU'ON TOUCHE UNE ÉTAPE (13/11/2026) : repliée, ses étapes ont une hauteur nulle. */
async function deroulerLesEtapes(page) {
  const ligne = page.locator('[data-ligne-etapes]:not([data-ligne-ouverte]) [data-barre-en-ligne]:visible').first();
  if (await ligne.count()) {
    await ligne.click().catch(() => undefined);
    await page.waitForTimeout(300);
  }
}

/* LE DÉMON ÉPROUVE D'ABORD LE MOTEUR (« --version »). Sans réponse, aucun
   moteur n'est vu « installé » : l'assistant de démarrage couvre alors tout
   l'écran (auMoinsUnMoteurEnLigne) et plus aucun clic n'atteint le tableau —
   le contrôle tombait au tout premier, sur le « + » de « Planifié ». */
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
  fs.writeFileSync(${JSON.stringify(DEMANDES)} + '/' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.txt', demande);
  dire({ type: 'system', subtype: 'init', session_id: 'session-' + Math.random().toString(16).slice(2) });
  await new Promise((r) => setTimeout(r, 200));
  /* LE CADRAGE REND UN PLAN : c'est lui qui allume « Lancer la tâche ». Un
     texte de discussion seul laisserait le bouton éteint, exactement comme
     dans l'application. */
  const PLAN = [
    '# Export CSV de la liste',
    '',
    '_Un bouton qui écrit la liste dans un fichier._',
    '',
    '## Faisabilité',
    'La liste est déjà en mémoire ; il manque l’écriture du fichier.',
    '',
    '## Chemin à suivre',
    '1. Ajouter le bouton.',
    '2. Écrire le fichier.',
    '3. Vérifier le résultat.',
    '',
    '## Conséquences',
    'Un bouton de plus, rien de retiré.',
    '',
    '## Améliorations apportées',
    '- Choisir les colonnes exportées.',
    '- Exporter aussi en Excel.',
    '- Retenir le dernier dossier utilisé.',
  ].join('\\n');
  const texte = /Réalise cette tâche/.test(demande)
    ? 'Travail rendu, tout est en place.'
    : PLAN;
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: texte }] } });
  dire({
    type: 'result',
    subtype: 'success',
    session_id: 'session-essai',
    usage: { input_tokens: 10, output_tokens: 5 },
  });
  process.exit(0);
}
`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

/* ------------------------------------------------------------------ */
/* Le démon                                                            */
/* ------------------------------------------------------------------ */

let demon = null;
const journal = [];

demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
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

function nettoyer() {
  try {
    demon?.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
}
process.on('exit', nettoyer);

async function attendrePort(limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* La base : une session d'une heure, un projet, rien d'autre           */
/* ------------------------------------------------------------------ */

const jeton = crypto.randomBytes(24).toString('hex');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const base = (lecture = false) => new Database(path.join(DATA, 'beluga.db'), { readonly: lecture });

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification carte-fil',
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai cadrage',
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

  /* Un compte d'essai, sans quoi rien ne part : une demande sans compte
     disponible attend en file, et le lancement est refusé faute de quota. */
  db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    'compte-essai',
    'claude',
    JSON.stringify({
      id: 'compte-essai',
      engine: 'claude',
      label: 'Compte d’essai',
      priority: 1,
      configDir: COMPTE,
    }),
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

const agents = () => {
  const db = base(true);
  const lignes = db.prepare('SELECT id, role, card_id, data FROM agents').all();
  db.close();
  return lignes;
};

const demandesRecues = () =>
  fs
    .readdirSync(DEMANDES)
    .sort()
    .map((nom) => fs.readFileSync(path.join(DEMANDES, nom), 'utf8'));

/* ------------------------------------------------------------------ */

/* LA BARRE D'ACTION porte le geste principal du chapitre (`parcours-carte.tsx`) :
   « Générer le plan » au cadrage, « Lancer la tâche » au plan — bouton SCINDÉ,
   dont le sous-bouton d'horloge ouvre le tiroir de programmation. */
/*
 * L'ASSISTANT DES MOTEURS NE SE JUGE PAS ICI. Le démon d'essai n'a qu'un compte
 * fabriqué, dont le relevé de quota est refusé par le fournisseur : l'assistant
 * de démarrage couvre alors tout l'écran, à raison — c'est SON contrôle
 * (`verif-assistant-moteurs.mjs`) qui le vérifie. Ici, il empêcherait
 * seulement le premier clic : on le retire de la surface, sans le contredire.
 */
async function ecarterLAssistantDesMoteurs(page) {
  await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });
}

const boutonLancer = (page) => page.locator('[data-geste-principal="lancer"]');
const rangeeLancement = (page) => page.locator('[data-barre-action="lancer"]');
/* Sur téléphone, « Nouvelle tâche » est LE bouton du bas de l'écran ; celui de
   la tête de « Demande » ne se dessine plus. */
const boutonPlus = (page) => page.locator('[data-nouvelle-carte="planned"]:visible').first();

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  /* UN TÉLÉPHONE : 390 × 844, tactile, échelle 3. */
  const contexte = await navigateur.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
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

  /* -------- 1. Une carte, une demande, un tour de cadrage -------- */

  await boutonPlus(page).click();
  await page.waitForTimeout(3000);
  const nees = cartes();
  noter('un clic sur « Nouvelle tâche » fait naître la carte', nees.length === 1, `${nees.length} carte(s)`);

  /* SUR UN ÉCRAN TACTILE, « Entrée » va à la ligne : la demande part par le bouton d'envoi. */
  const champ = page.locator('[data-composer] textarea').last();
  await champ.click();
  await champ.fill(DEMANDE);
  await page.locator('[data-composer] button[title="Envoyer"]').last().click();
  await page.waitForTimeout(7000);
  noter('le flux en points a pris la place du fil', (await page.locator('[data-flux-points]').count()) === 1);

  /* -------- 2. Titre sur une ligne, barre collée dessous -------- */

  /* LE TITRE VIT DANS LA BARRE D'EN-TÊTE DE LA PAGE (`EnteteDeZone`), au bout
     du fil d'Ariane : `[data-titre-bandeau]` porte le titre écrit
     (`[data-titre-carte]`) ou, tant que l'agent ne l'a pas rendu, « Titre en
     cours de création… ». Il n'a plus d'état « replié » : ce qui se repliait
     derrière lui vit derrière deux boutons de la même barre. */
  const entete = page.locator('[data-page-carte] [data-entete-de-zone]');
  const titre = entete.locator('[data-titre-bandeau]');
  const cadreTitre = await titre.boundingBox();
  noter(
    'le titre tient sur une ligne, dans la barre d’en-tête',
    !!cadreTitre && cadreTitre.height < 40,
    cadreTitre ? `${Math.round(cadreTitre.height)} px de haut` : 'titre introuvable',
  );
  /* La configuration n'est plus une bande posée au-dessus de la barre : elle
     est devenue le PREMIER POINT du parcours. Elle n'a donc plus rien à faire
     dans l'entête replié — mais elle doit bien vivre DANS le flux. */
  noter(
    'les étiquettes sont repliées, et la configuration a rejoint le flux',
    (await page.locator('[data-tags-carte]').count()) === 0 &&
      (await page.locator('[data-flux-points] [data-reglages-agent]').count()) === 1,
  );
  /* LA BARRE D'ÉTAPES EST COLLÉE SOUS LA BARRE D'EN-TÊTE, qui porte le titre :
     c'est le bas de cette barre qui fait la mesure, plus le bas du texte. */
  const cadreEntete = await entete.boundingBox();
  const cadreBarre = await page.locator('[data-barre-etapes]').boundingBox();
  noter(
    'la barre d’étapes est collée sous la barre du titre, rien ne s’intercale',
    !!cadreEntete && !!cadreBarre && cadreBarre.y - (cadreEntete.y + cadreEntete.height) >= 0 && cadreBarre.y - (cadreEntete.y + cadreEntete.height) < 16,
    cadreEntete && cadreBarre ? `${Math.round(cadreBarre.y - (cadreEntete.y + cadreEntete.height))} px entre les deux` : 'non mesuré',
  );

  /* Seul le dernier rendu s'ouvre de lui-même : on ouvre les autres passages
     qui ont une carte à déplier, pour qu'il y ait de quoi défiler. */
  for (const etape of ['demande', 'comprehension', 'plan', 'travail', 'rapport']) {
    const bascule = page.locator(`[data-point="${etape}"][data-point-ouvert="non"] [data-point-bascule][aria-disabled="false"]`).last();
    if (await bascule.count()) await bascule.click().catch(() => undefined);
  }
  const recit = page.locator('[data-point="comprehension"] [data-bloc-raconte-bascule]').last();
  if (await recit.count()) await recit.click().catch(() => undefined);
  await page.waitForTimeout(500);

  /* -------- 3. Le flux occupe au moins 60 % de la hauteur -------- */

  /* LA FEUILLE SUIT SON CONTENU : un flux court fait un tiroir court. La part
     rendue au flux se mesure donc en LECTURE, points ouverts, quand la feuille
     est à sa hauteur pleine. */

  const cadreFil = await page.locator('[data-fil="parcours"]').boundingBox();
  const part = cadreFil ? cadreFil.height / 844 : 0;
  /* CE QUI PREND LA PLACE, mesuré : c'est le détail qui dit où va la hauteur. */
  const hauteurs = await page.evaluate(() => {
    const h = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return '—';
      const r = el.getBoundingClientRect();
      return `${Math.round(r.height)}@${Math.round(r.y)}`;
    };
    return [
      `dialog ${h('[role="dialog"]')}`,
      `entete ${h('[role="dialog"] header')}`,
      `barre ${h('[data-barre-etapes]')}`,
      `fil ${h('[data-fil="parcours"]')}`,
      `panneau ${h('[data-panneau-decision]')}`,
      `composer ${h('[data-composer]')}`,
      `pied ${h('[role="dialog"] footer')}`,
    ].join(', ');
  });
  noter(
    'le flux occupe au moins 60 % de la hauteur de l’écran',
    part >= 0.6,
    `${Math.round(part * 100)} % — ${hauteurs}`,
  );
  fs.mkdirSync('/tmp/verif-telephone', { recursive: true });
  await page.screenshot({ path: '/tmp/verif-telephone/1-flux.png' });

  /* LA BARRE D'ONGLETS QUI SE MASQUAIT EN DESCENDANT N'EXISTE PLUS : la
     conversation n'a plus d'onglets au-dessus d'elle — ce sont des lignes du
     menu à trois points de la carte (`MenuCarte`, `data-onglet-carte`). Les
     deux affirmations « se masque en descendant » et « revient en remontant »
     sont retirées avec elle. */

  /* -------- 4. La barre est un raccourci -------- */

  await page.locator('[data-fil="parcours"]').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/verif-telephone/3-avant-segment.png' });
  await deroulerLesEtapes(page);
  await page.locator('[data-segment="demande"]').click({ timeout: 8000, force: true }).catch(async (err) => {
    noter('le segment « Demande » de la barre est atteignable', false, String(err).split('\n')[0]);
  });
  await page.waitForTimeout(900);
  const pointVise = await page.locator('[data-point="demande"]').last().boundingBox();
  const fil = await page.locator('[data-fil="parcours"]').boundingBox();
  noter(
    'toucher un segment fait défiler jusqu’au point, et l’ouvre',
    (await page.locator('[data-point="demande"]').last().getAttribute('data-point-ouvert')) === 'oui' &&
      !!pointVise && !!fil && pointVise.y >= fil.y - 2 && pointVise.y < fil.y + fil.height,
    pointVise && fil ? `point y=${Math.round(pointVise.y)}, fil y=${Math.round(fil.y)}` : 'non mesuré',
  );

  /* -------- 5. Un geste déplie les étiquettes, un autre la configuration -------- */

  /* LE TITRE N'EST PLUS UN BOUTON. La configuration de l'agent vit derrière le
     raccourci des réglages collé au bouton principal de la rangée d'action
     (`data-raccourci-reglages`), qui ouvre son menu (`data-tiroir-reglages`) — le
     panneau du bas, sur téléphone. */
  await page.locator('[data-raccourci-reglages]:visible').first().tap();
  await page.waitForTimeout(600);
  const configurationDepliee = await page.locator('[data-tiroir-reglages]').count();
  noter(
    'un geste sur les réglages déplie la configuration de l’agent',
    configurationDepliee >= 1,
    `${configurationDepliee} menu(s) de réglages`,
  );
  if (configurationDepliee) await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  /* -------- 5 bis. Deux rangs, repli au défilement, champ replié -------- */

  /* DEMANDE DU 14/10/2026 : en haut un EN-TÊTE MAÎTRE (les boutons globaux),
     dessous la flèche, le titre et la branche à droite ; un champ rempli qu'on
     ne touche pas tient sur une ligne, et se rouvre au toucher. DEMANDE DU
     24/10/2026 : en descendant, le maître se replie AVEC la barre d'étapes ;
     seul le rang du titre (projet, branche, titre) reste. */
  {
    /* UNE SEULE RANGÉE DEPUIS LE 01/11/2026 (capture #d6cd) : plus d'en-tête maître ; le menu à gauche du fil,
       les trois points à droite, sur la ligne du titre. */
    const rang = page.locator('[data-page-carte] [data-rang-du-titre]');
    const boiteMenu = await rang.locator('[data-menu-principal]').boundingBox().catch(() => null);
    const boiteTitre = await rang.locator('[data-titre-bandeau]').boundingBox().catch(() => null);
    const boiteOptions = await rang.locator('[data-menu-de-carte]').boundingBox().catch(() => null);
    noter(
      'une rangée : le menu à gauche du titre, les trois points à droite, sans en-tête au-dessus ni flèche de retour',
      (await page.locator('[data-page-carte] [data-entete-maitre]').count()) === 0 &&
        (await page.locator('[data-page-carte] [data-navigation-compacte]').count()) === 0 &&
        (await rang.locator('[data-retour-carte]').count()) === 0 &&
        Boolean(boiteMenu && boiteTitre && boiteOptions && boiteMenu.x + boiteMenu.width <= boiteTitre.x + 1 && boiteTitre.x + boiteTitre.width <= boiteOptions.x + 1),
      JSON.stringify({ menu: boiteMenu?.x, titre: boiteTitre?.x, options: boiteOptions?.x }),
    );
    /* DEPUIS LE 06/11/2026 : le logo du projet dans l'angle du ☰, le titre centré, la branche à droite juste
       avant les trois points. */
    const insigne = await rang.locator('[data-menu-principal] [data-insigne-du-menu]').count();
    const brancheBoite = await rang.locator('[data-bouton-de-branche]').boundingBox().catch(() => null);
    const titreBoite = await rang.locator('[data-titre-bandeau]').boundingBox().catch(() => null);
    noter(
      'le logo dans l’angle du menu, puis le titre, puis la branche avant les trois points',
      Boolean(
        insigne === 1 && brancheBoite && titreBoite && boiteOptions &&
          titreBoite.x + titreBoite.width <= brancheBoite.x + 1 &&
          brancheBoite.x + brancheBoite.width <= boiteOptions.x + 1,
      ),
      JSON.stringify({ insigne, branche: brancheBoite?.x, titre: titreBoite?.x }),
    );

    // Un fil assez long pour descendre : une cale d'essai, retirée ensuite.
    await page.evaluate(() => {
      const fil = document.querySelector('[data-fil="parcours"]');
      const cale = document.createElement('div');
      cale.style.height = '2400px';
      cale.style.flexShrink = '0';
      cale.dataset.caleEssai = '';
      fil?.appendChild(cale);
    });
    /* LE REPLI RÉPOND À CHAQUE GESTE, MÊME LENT (demande du 14/10/2026 : « ça
       doit être réactif dès le scroll »). La première version comparait chaque
       pas au précédent avec un seuil de 6 px : une descente lente ne repliait
       jamais rien. On rejoue donc des PETITS pas, puis les cas qui ne doivent
       RIEN changer : un retour de 5 px, le fil qui défile tout seul, et le
       recul de la page causé par le repli lui-même, en bas du fil. */
    /* Seule la barre des étapes se replie : le rang du titre reste toujours. */
    const etatDuRepli = async () => ({
      barre: (await page.locator('[data-page-carte] [data-barre-masquee]').count()) === 1,
    });
    const estReplie = (etat) => etat.barre;
    const estAffiche = (etat) => !etat.barre;
    const decrire = (etat) => `barre ${etat.barre ? 'repliée' : 'affichée'}`;
    const filDuParcours = page.locator('[data-fil="parcours"]');
    // Un saut posé par le code, hors de tout geste : comme le fil qui suit une réponse.
    const placerSansGeste = async (cible) => {
      await page.waitForTimeout(400);
      await filDuParcours.evaluate((el, y) => {
        el.scrollTop = y === 'bas' ? el.scrollHeight : y;
      }, cible);
      await page.waitForTimeout(450);
    };
    const molette = async (pas, fois, attente = 40) => {
      for (let i = 0; i < fois; i += 1) {
        await page.mouse.wheel(0, pas);
        await page.waitForTimeout(attente);
      }
      await page.waitForTimeout(400);
    };
    const centre = await filDuParcours.boundingBox();
    await page.mouse.move(centre.x + centre.width / 2, centre.y + Math.min(200, centre.height / 2));

    await placerSansGeste(0);
    await molette(4, 40);
    const apresLente = await etatDuRepli();
    await page.screenshot({ path: '/tmp/verif-telephone/5-entete-replie.png' });
    noter(
      'une descente LENTE, par pas de 4 px, replie l’en-tête et la barre d’étapes ; le rang du titre reste',
      estReplie(apresLente) && (await rang.isVisible()),
      `${decrire(apresLente)}, fil à ${Math.round(await filDuParcours.evaluate((el) => el.scrollTop))} px`,
    );
    await molette(-5, 1);
    const apresCinq = await etatDuRepli();
    noter('un retour de 5 px ne change rien', estReplie(apresCinq), decrire(apresCinq));
    await molette(-4, 5);
    const apresVingt = await etatDuRepli();
    noter('un retour de 20 px, même lent, les ramène', estAffiche(apresVingt), decrire(apresVingt));

    await placerSansGeste(900);
    const apresSaut = await etatDuRepli();
    noter('le fil qui descend tout seul, sans geste, ne replie rien', estAffiche(apresSaut), decrire(apresSaut));

    /* L'ÉLAN APRÈS LE DOIGT LEVÉ. L'inertie de l'iPhone ne se rejoue pas dans
       Chrome : on la mime — un pas de molette, puis une suite de défilements
       sans aucun geste, image après image, comme la page qui file encore. */
    await page.mouse.wheel(0, 3);
    await filDuParcours.evaluate(
      (el) =>
        new Promise((fini) => {
          let images = 0;
          const pas = () => {
            el.scrollTop += 12;
            images += 1;
            if (images < 25) requestAnimationFrame(pas);
            else fini(undefined);
          };
          requestAnimationFrame(pas);
        }),
    );
    await page.waitForTimeout(400);
    const apresElan = await etatDuRepli();
    noter('l’élan qui suit le geste compte comme le geste : il replie', estReplie(apresElan), decrire(apresElan));
    await molette(-30, 1);
    const apresRetour = await etatDuRepli();
    noter('et le moindre vrai retour les ramène', estAffiche(apresRetour), decrire(apresRetour));

    /* EN BAS DU FIL, LE REPLI AGRANDIT LA ZONE ET FAIT RECULER LA POSITION :
       ce recul ne doit pas ramener l'en-tête. On compte les bascules. */
    await placerSansGeste('bas');
    await filDuParcours.evaluate((el) => {
      el.scrollTop = el.scrollHeight - el.clientHeight - 40;
    });
    await page.waitForTimeout(450);
    await page.evaluate(() => {
      const cible = document.querySelector('[data-page-carte] [data-repli-des-etapes]');
      window.__bascules = 0;
      window.__observateurDeBascules = new MutationObserver(() => {
        window.__bascules += 1;
      });
      if (cible) window.__observateurDeBascules.observe(cible, { attributes: true, attributeFilter: ['data-barre-masquee'] });
    });
    await molette(8, 8, 30);
    await page.waitForTimeout(500);
    const auBas = await etatDuRepli();
    const bascules = await page.evaluate(() => {
      window.__observateurDeBascules?.disconnect();
      return window.__bascules;
    });
    noter(
      'en bas du fil, le repli tient : une seule bascule, aucun clignotement',
      estReplie(auBas) && bascules === 1,
      `${decrire(auBas)}, ${bascules} bascule(s)`,
    );
    await page.evaluate(() => document.querySelector('[data-cale-essai]')?.remove());
    await molette(-40, 1);

    const champ = page.locator('[data-composer] textarea').last();
    await champ.fill('Première ligne\nDeuxième ligne\nTroisième ligne\nQuatrième ligne');
    await page.waitForTimeout(200);
    const ouvert = (await champ.boundingBox())?.height ?? 0;
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
    await page.waitForTimeout(600);
    const replie = (await champ.boundingBox())?.height ?? 0;
    await page.screenshot({ path: '/tmp/verif-telephone/6-champ-replie.png' });
    noter(
      'rempli et laissé, le champ se replie sur une ligne',
      replie <= 40 && ouvert > replie + 20 && (await champ.getAttribute('data-champ-replie')) !== null,
      `${Math.round(ouvert)} px en écrivant, ${Math.round(replie)} px laissé`,
    );
    await champ.focus();
    await page.waitForTimeout(300);
    const rouvert = (await champ.boundingBox())?.height ?? 0;
    noter('au toucher, il se rouvre à sa hauteur', rouvert > 60, `${Math.round(rouvert)} px`);
    await champ.fill('');
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
    await page.waitForTimeout(400);
  }

  /* -------- 6. Les deux zones sûres -------- */

  /* LES RONDS RESSERRÉS DU FLUX N'EXISTENT PLUS : le fil est une discussion —
     des bulles et des marques d'étape —, le rond d'un point n'est plus dessiné
     (`data-point-rond` reste, caché, pour les contrôles) et son contenu n'a
     plus de décalage. Les deux affirmations « 32 px, pas 40 » et « 44 px, pas
     56 » sont retirées avec eux. */

  /* LES DEUX ZONES SÛRES, PAR LE MODULE COMMUN. La carte est une PAGE : son
     cadre (`[data-tiroir]`) couvre tout l'écran, barre d'état comprise, et
     c'est sa marge intérieure qui retient le contenu (`--zone-sure-haut`). Le
     repère « tiroir » du module vise donc ici le CONTENU de la page
     (`[data-page-carte]`), pas sa peinture. */
  for (const zone of ZONES_SURES_TYPES) {
    const releve = await verifierLesDeuxBords(page, {
      record: noter,
      reperes: {
        tiroir: '[data-page-carte]',
        'barre d’en-tête': '[data-page-carte] [data-entete-de-zone]',
        titre: '[data-page-carte] [data-titre-bandeau]',
        'barre des étapes': '[data-barre-etapes]',
        'champ d’écriture': '[data-composer]',
      },
      haut: zone.haut,
      bas: zone.bas,
      etiquette: `page de carte, ${zone.nom}`,
    });
    if (process.env.BELUGA_TELEPHONE_JOURNAL) console.log(formaterReleve(releve, `    — ${zone.nom} —`));
  }
  await retirerZonesSures(page);

  /* -------- 7. À l'ouverture, l'en-tête se replie si le fil est long -------- */

  /* DEMANDE DU 14/10/2026 : en entrant dans une tâche, le fil descend tout
     seul en bas et l'en-tête se replie « comme si on avait défilé » — une
     seule bascule, sans clignoter. Un fil court garde son en-tête. Le même
     fil est « court » sur un écran très haut, « long » sur un écran bas : on
     rouvre la carte deux fois. */
  {
    const idDeLaCarte = cartes()[0]?.id ?? '';
    const rouvrir = async () => {
      await page.keyboard.press('Escape');
      await page.locator('[data-page-carte]').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(800);
      await page.locator(`[data-page-du-projet] [data-agent-en-liste="${idDeLaCarte}"] :is(a, button)`).first().tap();
      await page.locator('[data-page-carte] [data-repli-des-etapes]').first().waitFor({ timeout: 8000 }).catch(() => undefined);
      /* Chaque état de l'en-tête pendant 3 s : une bascule de trop serait un clignotement. */
      return page.evaluate(async () => {
        const suite = [];
        const fin = performance.now() + 3000;
        while (performance.now() < fin) {
          const barre = document.querySelector('[data-page-carte] [data-repli-des-etapes]');
          const etat = barre ? (barre.hasAttribute('data-barre-masquee') ? 'masque' : 'visible') : null;
          if (etat && suite[suite.length - 1] !== etat) suite.push(etat);
          await new Promise((r) => setTimeout(r, 30));
        }
        const fil = document.querySelector('[data-fil="parcours"]');
        return { suite, bas: fil ? fil.scrollHeight - fil.clientHeight - fil.scrollTop : -1 };
      });
    };
    await page.setViewportSize({ width: 390, height: 2400 });
    const court = await rouvrir();
    noter('un fil court garde son en-tête à l’ouverture', court.suite.join('>') === 'visible', court.suite.join(' > '));
    await page.setViewportSize({ width: 390, height: 420 });
    const long = await rouvrir();
    await page.screenshot({ path: '/tmp/verif-telephone/7-ouverture-repliee.png' });
    noter(
      'un fil long se pose en bas et replie l’en-tête et la barre d’étapes, en UNE seule bascule',
      long.suite.join('>') === 'visible>masque' && long.bas >= 0 && long.bas <= 4,
      `${long.suite.join(' > ')}, ${Math.round(long.bas)} px du bas`,
    );
    await page.setViewportSize({ width: 390, height: 844 });
  }

  noter('aucune erreur de page pendant tout le parcours', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await navigateur.close();
}

main()
  .catch((err) => {
    console.error(err);
    noter('le parcours est allé au bout', false, String(err).split('\n')[0]);
  })
  .finally(() => {
    const rates = resultats.filter((r) => !r.ok).length;
    if (rates && process.env.BELUGA_TELEPHONE_JOURNAL) console.log(journal.join(''));
    console.log(`\n${resultats.length - rates}/${resultats.length} au vert`);
    process.exit(rates ? 1 : 0);
  });
