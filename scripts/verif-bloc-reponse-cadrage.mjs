#!/usr/bin/env node
/**
 * LA RÉPONSE À UNE SIMPLE QUESTION SE LIT SANS DÉPLIER.
 *
 *   node scripts/verif-bloc-reponse-cadrage.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre (`BELUGA_BLOC_REPONSE_PORT`,
 * jamais `BELUGA_URL`), avec une base neuve et un FAUX moteur qui RÉPOND au lieu
 * de cadrer : il lit deux fichiers, puis rend un long texte, sans compréhension
 * ni plan. Le parcours est joué dans un vrai navigateur, sur ordinateur PUIS sur
 * téléphone.
 *
 * Ce qui est vérifié, sans un seul clic sur le flux :
 *   1. le bloc de réponse (`[data-bloc-reponse]`) est là, à l'écran, dans le
 *      passage « Compréhension » ;
 *   2. le HAUT du bloc est dans la fenêtre du fil : l'écran est calé sur son
 *      début, pas sur le bas d'un long texte ;
 *   3. la réflexion est REPLIÉE derrière une seule ligne : aucun carton d'action
 *      ne se montre, et la réponse n'en est plus un. DEPUIS LA REFONTE DU
 *      11/10/2026 (« le détail de chaque passage dans une carte repliée »),
 *      cette ligne est la CARTE du passage (`[data-carte-du-passage]`) —
 *      ouverte d'office depuis le 26/10/2026 dès qu'elle porte des actions —,
 *      où la ligne « Réflexions » reste repliée d'office ;
 *   4. un clic sur la ligne « Réflexions » rouvre les cartons ;
 *   5. la réponse est un MESSAGE de l'agent : à gauche, le texte entier À PLAT,
 *      AUCUN fond sous le texte (demande du 01/11/2026, qui retire la bulle
 *      grise du 22/10/2026), sans panneau ni bordure, et SANS TITRE au-dessus
 *      (13/11/2026 : plus de « Réponse · … », le fil est une discussion) ; la carte du passage
 *      (`[data-carte-du-passage]`) n'a pas de fond non plus.
 *
 * LE DÉBUT DU TEXTE RENDU EST TENU, À L'ARRIVÉE ET À LA RÉOUVERTURE (07/11/2026) :
 *   8. 2,5 s après l'arrivée, le haut du bloc est TOUJOURS en tête du fil (le
 *      recollage au bas ne l'a pas repris) ;
 *   9. la carte refermée puis rouverte se pose au début du même bloc, et après
 *      un rechargement de la page aussi (aucune lecture retenue) ;
 *  10. un lecteur remonté pendant le tour n'est pas déplacé par la
 *      compréhension qui arrive ;
 *  11. la compréhension qui arrive (lecteur en bas) se lit par son début.
 *
 * LE CADRAGE EST UNE DISCUSSION (30/09/2026) — sur une carte neuve, à
 * l'ordinateur :
 *   6. une question répondue en texte ne déclenche AUCUNE relance « Compréhension
 *      réclamée » : le moteur n'est lancé qu'une fois ;
 *   7. un message qui fait avancer le travail rend une réponse ET une
 *      compréhension : seule la compréhension s'affiche — elle EST la réponse ;
 *      le texte écrit reste dans la réflexion repliée, jamais en double.
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

// Le dépôt d'où PART ce script — jamais un chemin écrit en dur.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { construireFragment } = await import(path.join(RACINE, 'shared/dist/index.js'));
const PORT = Number(process.env.BELUGA_BLOC_REPONSE_PORT || 7213);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-bloc-reponse-'));
const PROJET_ID = 'projet-bloc-reponse';
const QUESTION = 'Quelle est l’adresse de l’admin ?';
/** Le mot qui fait CADRER le faux moteur : il rend alors aussi sa compréhension. */
const PRECISION = 'Cadre ça : ajoute un bouton pour copier cette adresse.';
const REPONSE_CADREE = 'Bonne idée : le bouton se posera à côté de l’adresse.';
const LANCEMENTS = path.join(TMP, 'lancements.log');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le décor : un vrai dépôt git, un faux moteur qui RÉPOND              */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
/* Un dossier personnel à soi : le démon d'essai n'adopte pas le compte réel. */
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

/*
 * LE FAUX MOTEUR RÉPOND À LA QUESTION : deux lectures de fichier (la
 * réflexion), chacune annoncée par une PHRASE DE PASSAGE (« Je vérifie… »,
 * capture #47ac), puis un texte LONG — assez pour qu'un défilement vers le bas
 * du fil laisse le début de la réponse hors de l'écran. Les phrases de passage
 * doivent se lire dans « Réflexions », jamais en tête de la réponse.
 */
const PHRASE_DE_PASSAGE = 'Je vérifie le fichier numéro';
const FAUX_MOTEUR = path.join(TMP, 'faux-claude.mjs');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/usr/bin/env node
import fs from 'node:fs';
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
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/* LE TOUR QUI FAIT AVANCER LE TRAVAIL : les vrais outils du démon, par son
   pont (« --mcp-config ») — titre, mémoire, compréhension —, puis une réponse
   en texte. */
async function cadrer() {
  /* Le temps, pour le contrôle, de remonter lire pendant le tour (point 10). */
  await attendre(2500);
  const chemin = process.argv[process.argv.indexOf('--mcp-config') + 1];
  const pont = chemin && fs.existsSync(chemin) ? JSON.parse(fs.readFileSync(chemin, 'utf8')).mcpServers?.beluga?.env : null;
  const appeler = async (name, args) => {
    if (!pont) return null;
    const res = await fetch(pont.BELUGA_URL + '/internal/call', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-beluga-token': pont.BELUGA_TOKEN,
        'x-beluga-agent': pont.BELUGA_AGENT,
        'x-beluga-tour': pont.BELUGA_TOUR,
      },
      body: JSON.stringify({ name, args }),
    }).catch(() => null);
    const rendu = res ? await res.json().catch(() => null) : null;
    fs.appendFileSync(${JSON.stringify(LANCEMENTS)} + '.pont', JSON.stringify({ name, statut: res?.status, rendu, pont: !!pont }) + '\\n');
    return rendu;
  };
  fs.appendFileSync(${JSON.stringify(LANCEMENTS)} + '.pont', JSON.stringify({ argv: process.argv.slice(2), chemin, pont: !!pont }) + '\\n');
  /* L'identifiant de la carte n'est donné qu'au PREMIER tour de la session :
     le tour-question l'a noté (voir « jouer »). */
  const cardId = fs.existsSync(${JSON.stringify(LANCEMENTS)} + '.carte') ? fs.readFileSync(${JSON.stringify(LANCEMENTS)} + '.carte', 'utf8') : null;
  if (cardId) await appeler('board_update_card', { cardId, title: 'Bouton de copie', resumeDemande: 'Un bouton pour copier l’adresse.' });
  await appeler('memoire', { geste: 'chercher', demande: 'adresse admin bouton copier' });
  await appeler('rendre_comprehension', {
    /* La seconde précision rend une compréhension LONGUE : plus haute que le fil, elle doit s'y lire par son début. */
    texte: demande.includes('Encore une précision')
      ? ['### Le bouton', 'Je vais poser un bouton à côté de l’adresse de l’admin ; un clic la copie.', '']
          .concat(Array.from({ length: 30 }, (_, i) => 'Point ' + (i + 1) + ' de la compréhension, pour qu’elle soit longue.\\n'))
          .join('\\n')
      : 'Je vais poser un bouton à côté de l’adresse de l’admin ; un clic la copie.',
    resumeDemande: 'Vous demandez un bouton pour copier l’adresse.',
    resumeComprehension: 'Un bouton de copie à côté de l’adresse.',
    hypotheses: [],
    sujets: ['interface'],
    partieTechnique: {
      taches: [{ titre: 'Poser le bouton', description: 'À côté de l’adresse.' }],
      faits: ['Aucun fait particulier.'],
      risques: 'Le presse-papiers peut être refusé par le navigateur.',
    },
  });
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: ${JSON.stringify(REPONSE_CADREE)} + ' J’ai mis la compréhension à jour.' }] } });
  dire({ type: 'result', subtype: 'success', session_id: 'session-essai', usage: { input_tokens: 10, output_tokens: 5 } });
  process.exit(0);
}

async function jouer() {
  fs.appendFileSync(${JSON.stringify(LANCEMENTS)}, 'lancement\\n');
  dire({ type: 'system', subtype: 'init', session_id: 'session-' + Math.random().toString(16).slice(2) });
  await attendre(200);
  const carteVue = /Identifiant de cette carte[^:]*:\\s*([0-9a-f-]{36})/i.exec(demande)?.[1];
  if (carteVue) fs.writeFileSync(${JSON.stringify(LANCEMENTS)} + '.carte', carteVue);
  if (demande.includes(${JSON.stringify(PRECISION)})) return cadrer();
  for (const [n, fichier] of [[1, '/depot/README.md'], [2, '/depot/config/admin.json']]) {
    dire({ type: 'assistant', message: { content: [{ type: 'text', text: '${PHRASE_DE_PASSAGE} ' + n + '.' }] } });
    dire({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'lecture-' + n, name: 'Read', input: { file_path: fichier } }] } });
    await attendre(150);
    dire({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'lecture-' + n, content: 'contenu ' + n }] } });
    await attendre(150);
  }
  const lignes = ['**L’adresse de l’admin est admin.essai.cloud.** Voici le détail.', ''];
  for (let i = 1; i <= 40; i += 1) lignes.push('Paragraphe ' + i + ' de la réponse, pour qu’elle soit longue.', '');
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: lignes.join('\\n') }] } });
  dire({ type: 'result', subtype: 'success', session_id: 'session-essai', usage: { input_tokens: 10, output_tokens: 5 } });
  process.exit(0);
}
`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

/* ------------------------------------------------------------------ */
/* Le démon                                                            */
/* ------------------------------------------------------------------ */

const journal = [];
const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
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
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* La base : une session d'une heure (jeton HACHÉ), un projet, un compte */
/* ------------------------------------------------------------------ */

const jeton = crypto.randomBytes(24).toString('hex');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification bloc de réponse',
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai réponse',
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

/* ------------------------------------------------------------------ */

/*
 * « NOUVELLE TÂCHE », LÀ OÙ L'APPAREIL LE MONTRE (refonte du 11/10/2026). Deux
 * boutons portent le repère : celui de la tête de « Demande » sur ordinateur,
 * celui du bas de l'écran sur téléphone (`[data-bouton-nouvel-agent]`, le + du centre, monté
 * mais caché sur ordinateur). On prend celui qui est à l'écran.
 */
const boutonNouvelleTache = (page) => page.locator('[data-nouvelle-carte="planned"]:visible').first();

/*
 * LA CARTE N'EST PLUS UN TIROIR (`[role="dialog"]`) MAIS UNE PAGE
 * (`[data-page-carte]`). Échap la referme ; on attend qu'elle soit partie avant
 * de viser le tableau.
 */
async function refermerLaCarteOuverte(page) {
  const ouverte = page.locator('[data-page-carte]');
  if (!(await ouverte.count())) return;
  await page.keyboard.press('Escape');
  await ouverte.first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}

/* Le haut d'un bloc par rapport au haut du fil (px) : ~64 quand le bloc est posé par son début, sous le fondu. */
const ecartAuHautDuFil = (page, selecteur) =>
  page.evaluate((sel) => {
    const blocs = document.querySelectorAll(sel);
    const bloc = blocs[blocs.length - 1];
    const fils = [...document.querySelectorAll('[data-fil="parcours"]')].filter((f) => f.offsetParent !== null);
    const fil = fils[fils.length - 1];
    if (!bloc || !fil) return null;
    return Math.round(bloc.getBoundingClientRect().top - fil.getBoundingClientRect().top);
  }, selecteur);
const auDebut = (ecart) => ecart !== null && ecart >= -4 && ecart <= 90;

async function jouer(navigateur, appareil) {
  const telephone = appareil === 'téléphone';
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1400, height: 900 },
    ...(telephone ? { deviceScaleFactor: 3, isMobile: true, hasTouch: true } : {}),
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(`${BASE}/#${construireFragment({ vue: 'projet', projectId: PROJET_ID })}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  /* L'assistant des moteurs a son propre contrôle : ici il masquerait le tableau. */
  await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });

  /* LA CARTE OUVERTE SUR L'APPAREIL PRÉCÉDENT SE ROUVRE ICI (le choix est
     partagé) : on referme sa page, sinon elle couvre « Nouvelle tâche ». */
  await refermerLaCarteOuverte(page);
  await boutonNouvelleTache(page).click();
  await page.waitForTimeout(3000);
  const champ = page.locator('[data-composer] textarea').last();
  await champ.click();
  await champ.fill(QUESTION);
  await page.locator('[data-composer] button[title="Envoyer"]').last().click();

  /* LE BLOC ARRIVE, SANS UN CLIC SUR LE FLUX. */
  const bloc = page.locator('[data-point="comprehension"] [data-bloc-reponse]').last();
  const arrive = await bloc
    .waitFor({ state: 'visible', timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  noter(`${appareil} : la réponse se lit dans son bloc, sans aucun clic`, arrive);
  if (!arrive) {
    fs.mkdirSync('/tmp/verif-bloc-reponse', { recursive: true });
    await page.screenshot({ path: `/tmp/verif-bloc-reponse/${telephone ? 'telephone' : 'ordinateur'}-echec.png` });
    await contexte.close();
    return;
  }
  /* Le temps du défilement doux. */
  await page.waitForTimeout(1500);
  fs.mkdirSync('/tmp/verif-bloc-reponse', { recursive: true });
  await page.screenshot({ path: `/tmp/verif-bloc-reponse/${telephone ? 'telephone' : 'ordinateur'}.png` });

  const cadreBloc = await bloc.boundingBox();
  const cadreFil = await page.locator('[data-fil="parcours"]').last().boundingBox();
  noter(
    `${appareil} : le haut du bloc est dans la fenêtre du fil`,
    !!cadreBloc && !!cadreFil && cadreBloc.y >= cadreFil.y - 4 && cadreBloc.y < cadreFil.y + cadreFil.height - 40,
    cadreBloc && cadreFil ? `bloc y=${Math.round(cadreBloc.y)}, fil ${Math.round(cadreFil.y)}→${Math.round(cadreFil.y + cadreFil.height)}` : 'non mesuré',
  );
  /* LA RÉPONSE AU-DESSUS DU SUIVI (22/10/2026, capture #40a5) : dans son
     passage, elle précède la carte qui raconte le travail. */
  const avantLeSuivi = await bloc.evaluate((el) => {
    const point = el.closest('[data-point]');
    const suivi = point?.querySelector(':scope > [data-carte-du-passage]');
    return !suivi || !!(el.compareDocumentPosition(suivi) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  noter(`${appareil} : la réponse se lit au-dessus du suivi du passage`, avantLeSuivi);

  /* 8. LE DÉBUT EST TENU : le recollage au bas ne reprend pas le bloc pendant qu'il se pose. */
  await page.waitForTimeout(2500);
  const SEL_REPONSE = '[data-point="comprehension"] [data-bloc-reponse]';
  const tenu = await ecartAuHautDuFil(page, SEL_REPONSE);
  noter(`${appareil} : 2,5 s après l’arrivée, le début de la réponse est toujours en tête du fil`, auDebut(tenu), `écart ${tenu} px`);

  /* 9. RÉOUVERTURE : refermée puis rouverte, la carte se pose au début du dernier texte rendu. */
  const idDeLaCarte = await page.locator('[data-page-carte]').first().getAttribute('data-page-carte').catch(() => null);
  /* Refermée (Échap), puis rouverte par son adresse — sans recharger : la lecture retenue en mémoire compte. */
  const fragmentDeLaCarte = `#${construireFragment({ vue: 'projet', projectId: PROJET_ID, cardId: idDeLaCarte ?? undefined })}`;
  await refermerLaCarteOuverte(page);
  await page.evaluate((f) => (window.location.hash = f), fragmentDeLaCarte);
  await bloc.waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(2000);
  const rouverte = await ecartAuHautDuFil(page, SEL_REPONSE);
  noter(`${appareil} : la carte rouverte se pose au début de la réponse`, auDebut(rouverte), `écart ${rouverte} px`);
  /* Rechargée sur son adresse : plus aucune lecture retenue, c'est l'ouverture qui vise le bloc. */
  await page.goto(`${BASE}/${fragmentDeLaCarte}`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });
  await page.locator(SEL_REPONSE).last().waitFor({ state: 'visible', timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(2000);
  const rechargee = await ecartAuHautDuFil(page, SEL_REPONSE);
  noter(`${appareil} : après un rechargement (aucune lecture retenue), la carte s’ouvre au début de la réponse`, auDebut(rechargee), `écart ${rechargee} px`);
  await page.screenshot({ path: `/tmp/verif-bloc-reponse/${telephone ? 'telephone' : 'ordinateur'}-rouverte.png` });
  noter(
    `${appareil} : le bloc porte le texte entier de la réponse`,
    ((await bloc.textContent()) ?? '').includes('Paragraphe 40'),
  );
  noter(
    `${appareil} : aucune phrase de passage en tête de la réponse`,
    !((await bloc.textContent()) ?? '').includes(PHRASE_DE_PASSAGE),
  );
  /* LA RÉPONSE EST UN MESSAGE DE L'AGENT, À PLAT ET TITRÉE (demande du
     01/11/2026, qui retire la bulle grise du 22/10/2026). On juge le dessin
     d'aujourd'hui : à gauche, le texte entier, AUCUN fond du paragraphe jusqu'au
     point du passage, aucun panneau ni bordure, AUCUN titre « Réponse · … » posé
     AU-DESSUS du texte, et la carte du passage elle-même transparente. */
  const dessin = await bloc.evaluate((el) => {
    const bulle = el.querySelector(':scope > [data-bulle="agent"]');
    const fond = (x) => (x ? getComputedStyle(x).backgroundColor : '');
    const transparent = (couleur) => couleur === 'transparent' || /rgba?\([^)]*,\s*0\)$/.test(couleur);
    /* AUCUN FOND SOUS LE TEXTE DE LA RÉPONSE : du paragraphe jusqu'au point du
       passage. (Un encart POSÉ DANS le texte garde le sien — l'avis « le pont
       d'outils… » que le démon ajoute ici parce que le faux moteur ne demande pas
       ses outils : ce n'est pas le fond de la réponse.) */
    const paragraphe = [...el.querySelectorAll('p')].find((n) => (n.textContent ?? '').includes('Paragraphe 40'));
    const point = el.closest('[data-point]') ?? el;
    const peints = [];
    for (let n = paragraphe ?? null; n; n = n === point ? null : n.parentElement) {
      if (!transparent(fond(n))) peints.push(n.tagName + (n.className ? `.${String(n.className).slice(0, 40)}` : ''));
    }
    /* Le titre « Réponse » n'existe plus nulle part (17/11/2026) : on cherche tout intitulé qui le redirait. */
    const titre = [...point.querySelectorAll('h4')].find((n) => /^R[ée]ponse(\s·|$)/.test((n.textContent ?? '').trim()));
    const carte = point.querySelector('[data-carte-du-passage]');
    const cadreDuBloc = el.getBoundingClientRect();
    const cadreDeLaBulle = bulle?.getBoundingClientRect();
    return {
      bulle: (bulle?.textContent ?? '').includes('Paragraphe 40'),
      aGauche: !!cadreDeLaBulle && Math.abs(cadreDeLaBulle.left - cadreDuBloc.left) <= 1,
      aucunFond: !!paragraphe && peints.length === 0,
      peints,
      titre: (titre?.textContent ?? '').trim(),
      titreAuDessus: !!titre && !!paragraphe && (titre.compareDocumentPosition(paragraphe) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      carteSansFond: !carte || transparent(fond(carte)),
      enTetes: el.querySelectorAll('[data-en-tete-de-panneau], [data-panneau]').length,
      bordure: getComputedStyle(el).borderTopWidth,
      bordureDeLaBulle: bulle ? getComputedStyle(bulle).borderTopWidth : '',
    };
  });
  noter(
    `${appareil} : la réponse est un message de l’agent, à gauche, à plat, sans fond, sans en-tête ni cadre`,
    dessin.bulle && dessin.aGauche && dessin.aucunFond && dessin.enTetes === 0 && dessin.bordure === '0px' && dessin.bordureDeLaBulle === '0px',
    JSON.stringify(dessin),
  );
  noter(
    `${appareil} : la réponse n’a plus de titre « Réponse · … » au-dessus de son texte (13/11/2026)`,
    !dessin.titre,
    dessin.titre,
  );
  noter(`${appareil} : la carte du passage n’a pas de fond`, dessin.carteSansFond);

  /* LE FIL DU TOUR, FAÇON EXTENSION CHROME (13/11/2026, captures #322f et #de1b) : les phrases de passage se lisent
     EN CLAIR, dans leur ordre ; entre elles, les actions sont réunies sur une ligne grise repliée qui dit ce qu'elle
     contient ; la réponse vient EN DERNIER, sous ce fil, et aucune de ces phrases ne s'y glisse. */
  const point = page.locator('[data-point="comprehension"]').last();
  const flux = point.locator('[data-flux-du-tour]');
  const groupes = point.locator('[data-groupe-d-actions]');
  const notes = (await point.locator('[data-note-du-flux]').allTextContents()).join(' ');
  const premiere = notes.indexOf(`${PHRASE_DE_PASSAGE} 1`);
  const seconde = notes.indexOf(`${PHRASE_DE_PASSAGE} 2`);
  noter(
    `${appareil} : les phrases de passage se lisent en clair, dans leur ordre`,
    premiere >= 0 && seconde > premiere,
    `positions ${premiere} / ${seconde}`,
  );
  const ordre = await point.evaluate((el) => {
    const f = el.querySelector('[data-flux-du-tour]');
    const r = el.querySelector('[data-bloc-reponse]');
    return f && r ? !!(f.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
  });
  noter(`${appareil} : la réponse vient après le fil du tour`, ordre === true, String(ordre));
  const groupesFermes = await groupes.count();
  const replies = await point.locator('[data-groupe-detail]').count();
  noter(
    `${appareil} : les actions sont réunies en groupes repliés`,
    (await flux.count()) === 1 && groupesFermes >= 1 && replies === 0,
    `${groupesFermes} groupe(s)`,
  );
  await groupes.first().locator('[data-groupe-bascule]').click();
  await page.waitForTimeout(400);
  const cartons = await point.locator('[data-groupe-detail] [data-bloc-raconte]').count();
  noter(
    `${appareil} : un clic déplie le détail du groupe, sans la réponse parmi ses cartons`,
    cartons >= 1 && !((await point.locator('[data-groupe-detail]').allTextContents()).join(' ').includes('Paragraphe 40')),
    `${cartons} carton(s)`,
  );
  noter(`${appareil} : aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await contexte.close();
}

/* ------------------------------------------------------------------ */
/* 6-7. UNE DISCUSSION : une question, puis un message qui fait cadrer   */
/* ------------------------------------------------------------------ */

async function jouerLaDiscussion(navigateur) {
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(`${BASE}/#${construireFragment({ vue: 'projet', projectId: PROJET_ID })}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });
  await refermerLaCarteOuverte(page);
  const lancements = () => (fs.existsSync(LANCEMENTS) ? fs.readFileSync(LANCEMENTS, 'utf8').split('\n').filter(Boolean).length : 0);
  const envoyer = async (texte) => {
    const champ = page.locator('[data-composer] textarea').last();
    await champ.click();
    await champ.fill(texte);
    await page.locator('[data-composer] button[title="Envoyer"]').last().click();
  };
  await boutonNouvelleTache(page).click();
  await page.waitForTimeout(3000);

  const avant = lancements();
  await envoyer(QUESTION);
  await page
    .locator('[data-point="comprehension"] [data-bloc-reponse]')
    .last()
    .waitFor({ state: 'visible', timeout: 45000 })
    .catch(() => {});
  /* Le temps qu'une relance éventuelle parte. */
  await page.waitForTimeout(4000);
  noter(
    'discussion : une question répondue en texte ne relance pas le moteur',
    lancements() - avant === 1,
    `${lancements() - avant} lancement(s) du moteur`,
  );

  /* 10. LECTEUR REMONTÉ PENDANT LE TOUR : la compréhension qui arrive ne le déplace pas. */
  const filDuParcours = page.locator('[data-fil="parcours"]').last();
  const hautDuFil = () => filDuParcours.evaluate((f) => Math.round(f.scrollTop));
  await envoyer(PRECISION);
  await page.waitForTimeout(700);
  const boite = await filDuParcours.boundingBox();
  await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2);
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(500);
  const lu = await hautDuFil();
  await page.locator('[data-moment="comprehension"]').first().waitFor({ state: 'attached', timeout: 45000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const apres = await hautDuFil();
  noter('discussion : remonté lire, la compréhension qui arrive ne déplace pas le lecteur', Math.abs(apres - lu) <= 2, `${lu} → ${apres}`);

  /* 11. LECTEUR EN BAS : une seconde compréhension se lit par son début. */
  await envoyer(PRECISION + ' Encore une précision.');
  await page.waitForTimeout(1200);
  const comprises = await page.locator('[data-moment="comprehension"]').count();
  await page
    .waitForFunction((n) => document.querySelectorAll('[data-moment="comprehension"]').length > n, comprises, { timeout: 45000 })
    .catch(() => undefined);
  await page.waitForTimeout(2500);
  const ecartComprise = await ecartAuHautDuFil(page, '[data-moment="comprehension"]');
  /* La compréhension est LONGUE (plus haute que le fil) : posée par son début, le fil n'est pas à son plus bas. */
  const entiere = await page.evaluate(() => {
    const blocs = document.querySelectorAll('[data-moment="comprehension"]');
    const bloc = blocs[blocs.length - 1];
    const fil = [...document.querySelectorAll('[data-fil="parcours"]')].filter((f) => f.offsetParent !== null).pop();
    if (!bloc || !fil) return false;
    const b = bloc.getBoundingClientRect();
    const f = fil.getBoundingClientRect();
    return fil.scrollHeight - fil.scrollTop - fil.clientHeight <= 2 && b.top >= f.top && b.bottom <= f.bottom;
  });
  noter(
    'discussion : en bas, une longue compréhension qui arrive se lit par son début, et y reste',
    auDebut(ecartComprise) && !entiere,
    `écart ${ecartComprise} px, au plus bas et entière : ${entiere}`,
  );
  await page.screenshot({ path: '/tmp/verif-bloc-reponse/comprehension-arrivee.png' });
  const point = page.locator('[data-point="comprehension"]').last();
  const arrivee = await point
    .locator('[data-moment="comprehension"]')
    .first()
    .waitFor({ state: 'visible', timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(1500);
  fs.mkdirSync('/tmp/verif-bloc-reponse', { recursive: true });
  /* La capture montre le passage jugé : le fil défile dans sa propre zone, une
     capture « pleine page » restait sur le haut de la conversation. */
  await point.evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => undefined);
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/tmp/verif-bloc-reponse/discussion.png' });
  const ordre = await point.evaluate((el, attendue) => {
    const reponse = el.querySelector('[data-bloc-reponse]');
    const comprise = el.querySelector('[data-moment="comprehension"]');
    const blocs = [...el.querySelectorAll('[data-bloc-reponse]')].filter((b) => (b.textContent ?? '').includes(attendue));
    const avant = !!reponse && !!comprise && !!(reponse.compareDocumentPosition(comprise) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { reponse: !!reponse, comprise: !!comprise, avant, exemplaires: blocs.length };
  }, REPONSE_CADREE);
  noter('discussion : le tour qui cadre rend sa compréhension', arrivee && ordre.comprise, JSON.stringify(ordre));
  /* LA COMPRÉHENSION EST LA RÉPONSE (14/10/2026) : un tour qui a cadré n'affiche
     qu'elle. Le texte écrit à côté reste dans la réflexion repliée, jamais lu
     en clair — on ne lit jamais deux réponses quasi semblables l'une sous
     l'autre (`reponseDuPassage`, `shared/src/parcours-en-points.ts`). */
  noter(
    'discussion : le tour qui cadre n’affiche que sa compréhension, sans réponse écrite en double',
    ordre.comprise && !ordre.reponse && ordre.exemplaires === 0,
    JSON.stringify(ordre),
  );
  /* LA COMPRÉHENSION RESTE À PLAT, comme la réponse depuis le 01/11/2026 : aucun
     fond sous le repère `data-bulle="agent"` qu'elles partagent. */
  const compriseSansBulle = await point.evaluate((el) => {
    const bulle = el.querySelector('[data-moment="comprehension"] [data-bulle="agent"]');
    if (!bulle) return true;
    const couleur = getComputedStyle(bulle).backgroundColor;
    return couleur === 'transparent' || /rgba?\([^)]*,\s*0\)$/.test(couleur);
  });
  noter('discussion : la compréhension n’a pas de fond', compriseSansBulle);
  if (!ordre.comprise && fs.existsSync(LANCEMENTS + '.pont')) console.log(fs.readFileSync(LANCEMENTS + '.pont', 'utf8'));
  noter('discussion : aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await contexte.close();
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  await jouer(navigateur, 'ordinateur');
  await jouer(navigateur, 'téléphone');
  await jouerLaDiscussion(navigateur);
  await navigateur.close();
}

main()
  .catch((err) => {
    console.error(err);
    noter('le parcours est allé au bout', false, String(err).split('\n')[0]);
  })
  .finally(() => {
    const rates = resultats.filter((r) => !r.ok).length;
    if (rates && process.env.BELUGA_BLOC_REPONSE_JOURNAL) console.log(journal.join(''));
    console.log(`\n${resultats.length - rates}/${resultats.length} au vert`);
    process.exit(rates ? 1 : 0);
  });
