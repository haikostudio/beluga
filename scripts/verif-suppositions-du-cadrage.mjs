#!/usr/bin/env node
/**
 * PLUS AUCUNE SUPPOSITION NE S'ÉCRIT NI NE S'AFFICHE, NULLE PART. AVEC UN
 * TÉMOIN, LE DOUTE SE POSE AVEC « ask_user » ; SANS TÉMOIN, IL SE PRÉPARE EN
 * QUESTIONS GARDÉES SUR LA CARTE, POSÉES UNE PAR UNE À L'ÉCRAN.
 *
 *   BELUGA_SUPPOSITIONS_PORT=<port libre> env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-suppositions-du-cadrage.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre (`BELUGA_SUPPOSITIONS_PORT`,
 * jamais `BELUGA_URL`), avec une base neuve et un FAUX moteur qui passe par les
 * vrais outils du démon. Trois tours :
 *   - PREMIER TOUR, avec un témoin : la compréhension est rendue cinq fois, une
 *     vraie question posée (et répondue à l'écran) entre la première et la
 *     deuxième ; seule la dernière, au tableau VIDE, passe ;
 *   - DEUXIÈME TOUR, sans témoin (sa demande interdit « ask_user ») : des
 *     suppositions sont REFUSÉES aussi, puis deux questions préparées passent ;
 *   - TROISIÈME TOUR, la reprise lancée par la DERNIÈRE réponse : il reçoit les
 *     réponses comme décisions ; « questions » y est refusé (témoin présent),
 *     le tableau vide passe.
 *
 * Ce qui est vérifié :
 *   1. avec un témoin : chaînes nues, lignes « produit » après une question,
 *      trois lignes « techniques » puis UNE seule sont toutes refusées ; un
 *      tableau vide passe, et rien ne s'affiche ;
 *   2. sans témoin : les suppositions sont refusées et renvoient à « questions » ;
 *      les questions préparées passent, aucune supposition ne s'affiche ;
 *   3. la première question paraît au-dessus du champ, réponse conseillée
 *      marquée ; le lancement est éteint et DIT pourquoi ;
 *   4. une réponse fait paraître la suivante, et tient après un rechargement ;
 *   5. la dernière réponse relance le cadrage, avec les décisions ; la
 *      compréhension est réécrite et le lancement se rallume.
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
const PORT = Number(process.env.BELUGA_SUPPOSITIONS_PORT || 7217);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-suppositions-'));
const PROJET_ID = 'projet-suppositions';
const DEMANDE = 'Ajoute un pack de formation payant pour les agents.';
const HYPOTHESES = [
  'Je suppose que le pack coûte 50 CHF.',
  'Je suppose que seul l’administrateur voit les conversations.',
  'Je suppose que le crédit est partagé entre les agents.',
];
/*
 * LA DEMANDE D'UN CADRAGE SANS TÉMOIN : elle porte la phrase qui interdit
 * « ask_user », lue dans les règles CONSTRUITES de ce dépôt — la même que celle
 * de la nuit, de la carte posée sans témoin et du site tombé.
 */
const { MARQUEUR_DU_CADRAGE_SANS_QUESTION } = await import(path.join(RACINE, 'shared', 'dist', 'index.js'));
const SANS_TEMOIN = `Reprends ce cadrage sans moi. ${MARQUEUR_DU_CADRAGE_SANS_QUESTION} : personne n’est devant l’écran.`;
const QUESTION = 'Combien coûte le pack ?';
const PREPAREES = [
  {
    question: 'Le pack se renouvelle-t-il chaque année ?',
    description: 'Un renouvellement automatique facture chaque année sans nouveau geste.',
    options: [{ label: 'Oui, chaque année' }, { label: 'Non, achat unique' }],
    recommandee: 'Non, achat unique',
  },
  {
    question: 'Qui voit les conversations des agents ?',
    description: 'L’administrateur seul, ou chaque agent pour lui-même.',
    options: [{ label: 'L’administrateur seul' }, { label: 'Chaque agent aussi' }],
    recommandee: 'L’administrateur seul',
  },
];
const TRACE = path.join(TMP, 'trace.log');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* Le décor : un vrai dépôt git, un faux moteur */

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
 * LE FAUX MOTEUR : les vrais outils du démon, par son pont — titre, mémoire,
 * puis la compréhension. PREMIER TOUR : chaînes nues, une question (l'appel
 * attend la réponse de l'écran), lignes « produit », trois lignes « techniques »,
 * une seule ligne « technique », enfin un tableau vide. DEUXIÈME TOUR (sans
 * témoin) : trois suppositions, une seule fois. TROISIÈME TOUR : tableau vide.
 * Il note chaque réponse d'outil et chaque demande reçue.
 */
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
const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const noter = (o) => fs.appendFileSync(${JSON.stringify(TRACE)}, JSON.stringify(o) + '\\n');
async function jouer() {
  const chemin = process.argv[process.argv.indexOf('--mcp-config') + 1];
  const pont = chemin && fs.existsSync(chemin) ? JSON.parse(fs.readFileSync(chemin, 'utf8')).mcpServers?.beluga?.env : null;
  const appeler = async (name, args) => {
    const res = await fetch(pont.BELUGA_URL + '/internal/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-beluga-token': pont.BELUGA_TOKEN, 'x-beluga-agent': pont.BELUGA_AGENT, 'x-beluga-tour': pont.BELUGA_TOUR },
      body: JSON.stringify({ name, args }),
    }).catch(() => null);
    let rendu = res ? await res.json().catch(() => null) : null;
    /* UNE QUESTION ATTEND SA RÉPONSE, comme le vrai pont d'outils : on sonde
       « /internal/attente », tranche après tranche, jusqu'à l'issue. */
    while (rendu?.attente?.questionId) {
      const tranche = await fetch(pont.BELUGA_URL + '/internal/attente', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-beluga-token': pont.BELUGA_TOKEN, 'x-beluga-agent': pont.BELUGA_AGENT, 'x-beluga-tour': pont.BELUGA_TOUR },
        body: JSON.stringify({ questionId: rendu.attente.questionId }),
      }).then((r) => r.json()).catch(() => ({ etat: 'perdue' }));
      if (tranche.etat !== 'attente') rendu = tranche;
    }
    noter({ outil: name, rendu });
    return rendu;
  };
  dire({ type: 'system', subtype: 'init', session_id: 'session-essai' });
  noter({ demande: demande + '\\n' + process.argv.join(' ') });
  const cardId = /Identifiant de cette carte[^:]*:\\s*([0-9a-f-]{36})/i.exec(demande)?.[1];
  if (cardId) fs.writeFileSync(${JSON.stringify(TRACE)} + '.carte', cardId);
  const carte = cardId ?? (fs.existsSync(${JSON.stringify(TRACE)} + '.carte') ? fs.readFileSync(${JSON.stringify(TRACE)} + '.carte', 'utf8') : null);
  if (carte) await appeler('board_update_card', { cardId: carte, title: 'Pack de formation', resumeDemande: 'Un pack de formation payant.' });
  await appeler('memoire', { geste: 'chercher', demande: 'pack formation' });
  const rendre = (hypotheses, questions) =>
    appeler('rendre_comprehension', {
      texte: 'Je vais ajouter un pack de formation payant.',
      resumeDemande: 'Un pack de formation payant.',
      resumeComprehension: 'Un pack payant pour former les agents.',
      hypotheses,
      ...(questions ? { questions } : {}),
      sujets: ['interface'],
      partieTechnique: { taches: [{ titre: 'Poser le pack', description: 'Dans les réglages.' }], faits: ['Aucun.'], risques: 'Le paiement.' },
    });
  const lignes = ${JSON.stringify(HYPOTHESES)};
  const compteur = ${JSON.stringify(TRACE)} + '.tours';
  const tour = (fs.existsSync(compteur) ? Number(fs.readFileSync(compteur, 'utf8')) : 0) + 1;
  fs.writeFileSync(compteur, String(tour));
  if (tour === 1) {
    await rendre(lignes);
    await appeler('ask_user', { question: ${JSON.stringify(QUESTION)}, description: 'Le prix décide de la suite.', options: [{ label: '50 CHF' }, { label: '80 CHF' }] });
    await rendre(lignes.map((texte) => ({ texte, nature: 'produit' })));
    await rendre(lignes.map((texte) => ({ texte, nature: 'technique' })));
    await rendre(lignes.slice(0, 1).map((texte) => ({ texte, nature: 'technique' })));
    await rendre([]);
  } else if (tour === 2) {
    await rendre(lignes.map((texte) => ({ texte, nature: 'technique' })));
    await rendre([], ${JSON.stringify(PREPAREES)});
  } else {
    await rendre([], ${JSON.stringify(PREPAREES.slice(0, 1))});
    await rendre([]);
  }
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'J’ai mis la compréhension à jour.' }] } });
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
    'vérification suppositions',
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai suppositions',
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

const trace = () =>
  fs.existsSync(TRACE)
    ? fs.readFileSync(TRACE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });
  const envoyer = async (texte) => {
    const champ = page.locator('[data-composer] textarea').last();
    await champ.click();
    await champ.fill(texte);
    await page.locator('[data-composer] button[title="Envoyer"]').last().click();
  };
  /* « NOUVEL ARTEFACT » TOUT EN HAUT DE LA COLONNE DE GAUCHE, « Programmation », puis le projet d'essai (l'ancien bouton
     `data-nouvelle-carte` du bandeau n'existe plus que sur téléphone). */
  const ancienBouton = page.locator('[data-nouvelle-carte="planned"]:visible').first();
  if (await ancienBouton.count()) await ancienBouton.click();
  else {
    await page.locator('[data-ligne-nouvel-agent]').first().click();
    await page.locator('[data-type-d-agent="programmation"]').first().click();
    await page.locator(`[data-projet-a-viser="${PROJET_ID}"][data-pour-le-type="programmation"]`).first().click();
  }
  await page.waitForTimeout(3000);
  await envoyer(DEMANDE);

  /* LA QUESTION DU FAUX MOTEUR ATTEND UNE VRAIE RÉPONSE : on la donne à l'écran. */
  const question = page.locator('[data-question-agent]').filter({ hasText: QUESTION }).first();
  const posee = await question
    .waitFor({ state: 'visible', timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  const rendus = () => trace().filter((t) => t.outil === 'rendre_comprehension');
  const attendreRendus = async (nombre, limiteMs = 45000) => {
    const fin = Date.now() + limiteMs;
    while (Date.now() < fin && rendus().length < nombre) await page.waitForTimeout(500);
    await page.waitForTimeout(1500);
    return rendus().length >= nombre;
  };
  const refuse = (appel, ...motifs) => appel?.rendu?.ok === false && motifs.every((motif) => motif.test(appel.rendu?.text ?? ''));
  noter(
    'des chaînes nues (ancien format) sont refusées avec la marche à suivre',
    posee && refuse(rendus()[0], /ask_user/, /tableau VIDE/, /50 CHF/),
  );
  noter('aucune supposition ne s’affiche tant que le garde-fou refuse', (await page.locator('[data-supposition]').count()) === 0);
  if (posee) {
    await question.locator('[data-option-question="o0"]').click();
    await question.locator('[data-repondre-question]').click();
  }

  /* LE PREMIER TOUR, AVEC UN TÉMOIN : cinq rendus, seul le tableau vide passe. */
  await attendreRendus(5);
  let appels = rendus();
  const reponse = trace().find((t) => t.outil === 'ask_user')?.rendu;
  noter('la question a reçu sa réponse dans le tour', /50 CHF/.test(JSON.stringify(reponse ?? '')), JSON.stringify(reponse ?? null).slice(0, 160));
  noter(
    'une question posée ne lève rien : les lignes « produit » sont refusées juste après',
    refuse(appels[1], /même si tu as déjà posé des questions/, /50 CHF/),
    JSON.stringify(appels.map((a) => a.rendu?.ok)),
  );
  noter(
    'trois lignes « techniques » sont refusées quand quelqu’un est devant l’écran',
    refuse(appels[2], /tableau VIDE/, /même technique/, /Ces 3 lignes restent à traiter/),
    JSON.stringify(appels.map((a) => a.rendu?.ok)),
  );
  noter(
    'une seule ligne « technique » est refusée elle aussi, avec ses trois issues',
    refuse(appels[3], /Cette ligne reste à traiter/, /la VÉRIFIER toi-même/, /l’écrire comme DÉCIDÉE/, /la POSER avec « ask_user »/, /la réponse que tu recommandes/),
    String(appels[3]?.rendu?.text ?? '').slice(0, 120),
  );
  noter(
    'un tableau vide passe : la compréhension s’enregistre sans supposition',
    appels.length === 5 && appels[4].rendu?.ok !== false,
    JSON.stringify(appels.map((a) => a.rendu?.ok)),
  );
  const comprise = page.locator('[data-moment="comprehension"]').first();
  await comprise.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  noter(
    'avec un témoin, la carte n’affiche aucune supposition',
    (await comprise.isVisible().catch(() => false)) && (await page.locator('[data-supposition]').count()) === 0,
    `${await page.locator('[data-supposition]').count()} ligne(s)`,
  );

  /* LE DEUXIÈME TOUR, SANS TÉMOIN : sa demande interdit « ask_user » — les suppositions sont refusées aussi. */
  await envoyer(SANS_TEMOIN);
  await attendreRendus(7);
  appels = rendus();
  noter(
    'sans personne devant l’écran, les suppositions sont refusées et renvoient aux questions préparées',
    refuse(appels[5], /même sans personne devant l’écran/, /la PRÉPARER dans « questions »/, /« recommandee »/),
    String(appels[5]?.rendu?.text ?? '').slice(0, 120),
  );
  noter('les questions préparées passent', appels.length === 7 && appels[6].rendu?.ok !== false, JSON.stringify(appels.map((a) => a.rendu?.ok)));
  const bloc = page.locator('[data-questions-de-carte]');
  const parue = await bloc
    .first()
    .waitFor({ state: 'visible', timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(1000);
  noter('aucune supposition ne s’affiche, nulle part', (await page.locator('[data-supposition], [data-hypotheses]').count()) === 0);
  noter(
    'la première question paraît au-dessus du champ, avec la réponse conseillée',
    parue &&
      (await bloc.getAttribute('data-question-de-carte-rang')) === '1' &&
      (await bloc.innerText()).includes(PREPAREES[0].question) &&
      (await bloc.locator('[data-option-conseillee]').count()) === 1 &&
      (await bloc.locator('[data-option-question="o1"] [data-option-conseillee]').count()) === 1,
  );
  const geste = page.locator('[data-geste-principal]').first();
  noter(
    'le lancement est éteint et dit pourquoi',
    (await geste.getAttribute('aria-disabled')) === 'true' && /questions que l’agent a laissées/.test((await geste.getAttribute('title')) ?? ''),
    String(await geste.getAttribute('title')),
  );
  fs.mkdirSync('/tmp/verif-suppositions', { recursive: true });
  await page.screenshot({ path: '/tmp/verif-suppositions/ordinateur.png' });
  /* AUCUN FOND DERRIÈRE LES QUESTIONS (capture #217c) : de la tête du bloc jusqu'au cadre de la
     question, aucun étage ne peint de fond — seul le cadre jaune se détache du fil. */
  const fondsDuBloc = await bloc.first().evaluate((racine) => {
    const bulle = racine.querySelector('[data-bulle-question]');
    const fonds = [];
    for (let el = bulle?.parentElement; el && el !== racine.parentElement; el = el.parentElement) {
      const fond = getComputedStyle(el).backgroundColor;
      if (fond !== 'rgba(0, 0, 0, 0)' && fond !== 'transparent') fonds.push(`${el.className}: ${fond}`);
    }
    return fonds;
  });
  noter('aucun fond derrière la question préparée, seul son cadre se détache', fondsDuBloc.length === 0, fondsDuBloc.join(' | '));
  for (const [nom, schema, largeur] of [
    ['ordinateur-clair', 'light', 1440],
    ['ordinateur-sombre', 'dark', 1440],
    ['telephone-clair', 'light', 390],
    ['telephone-sombre', 'dark', 390],
  ]) {
    await page.emulateMedia({ colorScheme: schema });
    /* La clarté forcée sur la page seulement (le démon d'essai garde son réglage) : la marque de `theme.ts`. */
    await page.evaluate((sombre) => document.documentElement.classList.toggle('dark', sombre), schema === 'dark');
    await page.setViewportSize({ width: largeur, height: largeur < 640 ? 844 : 1000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `/tmp/verif-suppositions/${nom}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(600);

  const demandesAvant = trace().filter((t) => t.demande).length;
  await bloc.locator('[data-option-question="o1"]').click();
  await bloc.locator('[data-repondre-question]').click();
  await page.waitForTimeout(2000);
  noter(
    'une réponse fait paraître la suivante, sans relancer l’agent',
    (await bloc.getAttribute('data-question-de-carte-rang').catch(() => null)) === '2' &&
      (await bloc.innerText().catch(() => '')).includes(PREPAREES[1].question) &&
      trace().filter((t) => t.demande).length === demandesAvant,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });
  await bloc.first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  noter('la question en attente tient après un rechargement', (await bloc.getAttribute('data-question-de-carte-rang').catch(() => null)) === '2');

  /* LA DERNIÈRE RÉPONSE RELANCE LE CADRAGE : le troisième tour, avec un témoin. */
  await bloc.locator('[data-option-question="o0"]').click();
  await bloc.locator('[data-repondre-question]').click();
  const fin = Date.now() + 45000;
  while (Date.now() < fin && trace().filter((t) => t.demande).length === demandesAvant) await page.waitForTimeout(500);
  const derniere = trace().filter((t) => t.demande).pop()?.demande ?? '';
  noter(
    'la dernière réponse relance le cadrage, avec les réponses comme décisions',
    /Le pack se renouvelle-t-il chaque année \? → Non, achat unique/.test(derniere) &&
      /Qui voit les conversations des agents \? → L’administrateur seul/.test(derniere),
    derniere.slice(0, 120),
  );
  await attendreRendus(9);
  const duTroisieme = rendus().slice(7);
  noter(
    'avec un témoin, « questions » est refusé, puis le tableau vide passe',
    duTroisieme.length === 2 && refuse(duTroisieme[0], /« questions » doit rester VIDE/, /ask_user/) && duTroisieme[1].rendu?.ok !== false,
    JSON.stringify(duTroisieme.map((a) => a.rendu?.ok)),
  );
  await page.waitForTimeout(2500);
  const comprehensions = page.locator('[data-moment="comprehension"]');
  noter(
    'la compréhension est réécrite et le lancement se rallume',
    (await page.locator('[data-questions-de-carte]').count()) === 0 &&
      (await comprehensions.last().getAttribute('data-comprehension-numero').catch(() => null)) === '3' &&
      (await page.locator('[data-geste-principal]').first().getAttribute('aria-disabled')) === 'false',
    `${await comprehensions.count()} compréhension(s)`,
  );
  noter('aucune supposition ne s’affiche dans le fil', (await page.locator('[data-supposition], [data-hypotheses]').count()) === 0);
  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await navigateur.close();
}

main()
  .catch((err) => {
    console.error(err);
    noter('le parcours est allé au bout', false, String(err).split('\n')[0]);
  })
  .finally(() => {
    const rates = resultats.filter((r) => !r.ok).length;
    if (rates && process.env.BELUGA_SUPPOSITIONS_JOURNAL) console.log(journal.join(''));
    console.log(`\n${resultats.length - rates}/${resultats.length} au vert`);
    process.exit(rates ? 1 : 0);
  });
