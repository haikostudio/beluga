#!/usr/bin/env node
/**
 * Le CRÉNEAU CONSEILLÉ : chaque carte posée dit QUAND il serait opportun de la
 * lancer — en SUGGESTION seulement. L'heure ne devient un départ programmé que
 * par un geste de l'utilisateur (« Retenir cette heure », horloge).
 *
 *   node scripts/verif-creneau-conseille.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et un
 * dossier de projets vide : le démon de production n'est pas touché. Le plafond
 * d'agents est mis à ZÉRO — AUCUN moteur n'est appelé, et c'est le cœur du
 * contrôle : le conseil doit naître du seul calcul du démon.
 *
 * Ce qui est prouvé, bout en bout :
 *   1. une carte créée par la porte extérieure (donc par le chemin `createCard`,
 *      celui du chef d'orchestre) NAÎT avec son créneau en base, et SANS aucun
 *      `departPrevu` : rien ne la fera partir seule ;
 *   2. le créneau gardé ne porte NI date NI phrase — seulement une plage, sa
 *      source et, le cas échéant, la reprise du quota : c'est ce qui le rend
 *      encore vrai trois jours plus tard ;
 *   3. une carte créée AVEC une date de départ n'en reçoit pas : elle a déjà
 *      une réponse ferme ;
 *   4. la carte du tableau affiche la case « créneau conseillé », et le geste
 *      « Retenir cette heure » de sa page pose, lui, la vraie date. DEPUIS LA
 *      REFONTE DU 11/10/2026 (« une carte du tableau ne montre que son titre et
 *      son heure »), le créneau conseillé et le départ programmé ne s'étalent
 *      plus sur la carte : ils se lisent dans la bulle de son « i », qu'on
 *      survole — c'est là que ce contrôle les compte ;
 *   5. aucun agent n'a été créé : rien n'a été dépensé.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { ouvrirLeProjet } from './lib/navigation.mjs';

/* La racine se déduit du script LUI-MÊME : lancé depuis une copie de travail
   (`.worktrees/…`), il doit juger le code de CETTE copie, jamais celui du
   dossier principal — sinon il déclare bon un changement jamais exécuté. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_CRENEAU_PORT || 7198);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

/*
 * UN FAUX MOTEUR, PAR PRUDENCE (ajout du 11/10/2026, en recalant ce contrôle).
 *
 * Ce contrôle promet « AUCUN moteur n'est appelé », et son dernier point le
 * vérifie — or ce point est ROUGE : la carte posée par la porte extérieure
 * reçoit aussitôt un agent de cadrage, dont le tour PART, plafond d'agents à
 * zéro ou non. Sans moteur d'essai, ce tour partait sur le VRAI Claude Code,
 * avec le vrai compte (« claude -p … --model claude-sonnet-… », compte
 * principal), à chaque passage du contrôle — et le moteur restait orphelin une
 * fois le démon d'essai coupé. Le faux moteur ne répare RIEN de ce défaut (le
 * dernier point reste rouge tant qu'un agent naît) : il empêche seulement le
 * contrôle de dépenser un vrai quota pendant qu'il le constate.
 */
const TMP_DU_CONTROLE = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-creneau-'));
const FAUX_MOTEUR = path.join(TMP_DU_CONTROLE, 'faux-claude.mjs');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/usr/bin/env node
if (process.argv.includes('--version')) {
  process.stdout.write('faux-moteur 0.0.0 (essai)\\n');
  process.exit(0);
}
process.stdin.resume();
process.stdin.on('end', () => {
  const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  dire({ type: 'system', subtype: 'init', session_id: 'session-essai' });
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Faux moteur : rien à faire.' }] } });
  dire({ type: 'result', subtype: 'success', session_id: 'session-essai', usage: { input_tokens: 0, output_tokens: 0 } });
  process.exit(0);
});
`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

const { TMP, DATA, PROJETS, DEPOT, demon, journal, attendrePort } = demarrerDemonDEssai({
  tmp: TMP_DU_CONTROLE,
  port: PORT,
  messageCommit: 'créneau',
  env: { BELUGA_CLAUDE_BIN: FAUX_MOTEUR },
});

/* ------------------------------------------------------------------ */
/* Le décor : un projet, une session, une clé d'API                     */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
/* Le préfixe et la longueur sont ceux de `shared/src/cles-api.ts` : une clé mal
   formée serait refusée AVANT même d'être cherchée en base. */
const cleApi = `hkd_${crypto.randomBytes(32).toString('hex')}`;
const PROJET_ID = 'p-essai';
const PROJET_NOM = 'Essai créneau';
const HEURE = 60 * 60 * 1000;

const SANS_DATE = 'Carte d’essai — sans date de départ';
const AVEC_DATE = 'Carte d’essai — déjà datée';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification créneau conseillé',
  );

  /* Plafond d'agents à ZÉRO : aucun tour réel, aucun quota dépensé. Les heures
     creuses sont posées en clair pour que le conseil attendu soit connu à
     l'avance : sans historique de quota, aucun creux n'est mesurable et c'est
     la plage RÉGLÉE qui doit sortir. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0, offPeakStart: 22, offPeakEnd: 7 }));

  db.prepare('DELETE FROM projects').run();
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

  /* La porte extérieure passe par le MÊME `createCard` que le chef d'orchestre :
     c'est donc bien ce chemin-là qu'on éprouve, sans lancer un seul agent. */
  db.prepare(
    'INSERT INTO api_keys (id, nom, empreinte, apercu, creee_le) VALUES (?, ?, ?, ?, ?)',
  ).run('k-essai', 'vérification créneau', sha(cleApi), cleApi.slice(0, 10), maintenant);

  /*
   * Une carte DÉJÀ DATÉE, posée à la main en base : elle n'a pas de créneau, et
   * l'écran ne doit rien lui conseiller — sa date est une réponse ferme, un
   * conseil ne ferait que la contredire.
   */
  const datee = {
    id: 'c-essai-datee',
    projectId: PROJET_ID,
    title: AVEC_DATE,
    description: 'Carte du contrôle, avec son heure.',
    labels: [],
    column: 'planned',
    position: 2,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    scheduling: { asap: false, attempts: 0, restarts: 0, departPrevu: maintenant + 5 * HEURE },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(datee.id, PROJET_ID, 'planned', 2, AVEC_DATE, JSON.stringify(datee), maintenant, maintenant);
  db.close();
}

async function poserUneCarte(titre, extra = {}) {
  const reponse = await fetch(`${BASE}/api/externe/carte`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-beluga-cle': cleApi },
    body: JSON.stringify({ projet: PROJET_NOM, titre, description: 'Carte du contrôle.', ...extra }),
  });
  return { statut: reponse.status, corps: await reponse.json().catch(() => null) };
}

/** L'état d'ordonnancement de chaque carte, lu en base : titre → scheduling. */
function ordonnancementsEnBase() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const lignes = db.prepare('SELECT title, data FROM cards').all();
  db.close();
  return Object.fromEntries(
    lignes.map((l) => {
      let scheduling = {};
      try {
        scheduling = JSON.parse(l.data)?.scheduling ?? {};
      } catch {
        /* carte illisible */
      }
      return [l.title, scheduling];
    }),
  );
}

/**
 * Combien d'agents de CARTE ont été créés ? Doit rester à zéro : c'est la
 * preuve qu'aucun tour de moteur n'a été payé pour porter le conseil. Le chef
 * d'orchestre du projet, lui, est créé d'office à l'inscription et ne dépense
 * rien tant qu'on ne lui parle pas — il n'entre donc pas dans le compte.
 */
function agentsDeCarte() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const n = db.prepare('SELECT COUNT(*) AS n FROM agents WHERE card_id IS NOT NULL').get()?.n ?? 0;
  if (n) {
    const qui = db
      .prepare('SELECT a.role, c.title FROM agents a LEFT JOIN cards c ON c.id = a.card_id WHERE a.card_id IS NOT NULL')
      .all();
    console.log(`  (agents de carte : ${qui.map((a) => `${a.role} sur « ${a.title} »`).join(', ')})`);
  }
  db.close();
  return n;
}

/* ------------------------------------------------------------------ */
/* Le navigateur                                                       */
/* ------------------------------------------------------------------ */

async function ouvrirLeTableau(navigateur) {
  const contexte = await navigateur.newContext({
    viewport: { width: 1400, height: 900 },
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
  await page.waitForTimeout(6000);
  const onglet = page.getByRole('button', { name: /^Tableau$/ });
  if (await onglet.count()) {
    await onglet.first().click();
    await page.waitForTimeout(2000);
  }
  /* Le tableau jugé est celui du projet d'essai : s'il n'est pas déjà à
     l'écran, on l'ouvre par sa ligne de la colonne de gauche. */
  if (!(await page.locator(`[data-tableau="${PROJET_ID}"]`).count())) await ouvrirLeProjet(page, PROJET_ID);
  await page.locator('[data-column="planned"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  return { page, erreurs };
}

/** L'identifiant de chaque carte, par son titre. */
function cartesEnBase() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const lignes = db.prepare('SELECT id, title FROM cards').all();
  db.close();
  return lignes;
}

/**
 * CE QUE CHAQUE CARTE DIT DE SON DÉPART, DERRIÈRE SON « i ».
 *
 * Depuis la refonte du 11/10/2026, une carte du tableau ne montre que son titre
 * et son heure : le créneau conseillé (`data-creneau-conseille`) et le départ
 * programmé (`data-depart-programme`) ont quitté le bandeau du bas de la carte
 * pour la bulle de sa pastille « i » (`[data-texte-coupe] button`), montée hors
 * de la carte et seulement ouverte. On survole donc la pastille de CHAQUE carte,
 * on lit sa bulle, puis on l'écarte avant la suivante.
 */
async function mentionsDeDepart(page) {
  const lues = [];
  for (const { id, title } of cartesEnBase()) {
    const carte = page.locator(`[data-column="planned"] [data-carte="${id}"]`).first();
    const lue = { id, titre: title, surLeTableau: (await carte.count()) > 0, pastille: false, depart: 0, texteDepart: '', creneau: 0, texteCreneau: '' };
    lues.push(lue);
    const pastille = carte.locator('[data-texte-coupe] button').first();
    if (!lue.surLeTableau || !(await pastille.count())) continue;
    lue.pastille = true;
    await pastille.hover();
    const bulle = page.locator('[data-bulle-info]').first();
    const ouverte = await bulle.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    if (ouverte) {
      const depart = bulle.locator(`[data-depart-programme="${id}"]`);
      const creneau = bulle.locator(`[data-creneau-conseille="${id}"]`);
      lue.depart = await depart.count();
      lue.texteDepart = lue.depart ? (await depart.first().innerText()).replace(/\n/g, ' ').trim() : '';
      lue.creneau = await creneau.count();
      lue.texteCreneau = lue.creneau ? (await creneau.first().innerText()).replace(/\n/g, ' ').trim() : '';
    }
    /* On écarte la souris, et on attend que la bulle soit partie : la suivante
       ne doit pas être lue dans celle-ci. */
    await page.mouse.move(700, 880);
    await bulle.waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined);
  }
  return lues;
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  await new Promise((r) => setTimeout(r, 1500));

  /* ---------------- 1. La carte naît avec son créneau DÉJÀ appliqué -------- */

  const sansDate = await poserUneCarte(SANS_DATE);
  noter(
    'la porte extérieure accepte la carte',
    sansDate.statut === 201,
    `HTTP ${sansDate.statut} ${JSON.stringify(sansDate.corps)}`,
  );
  await new Promise((r) => setTimeout(r, 1000));

  const enBase = ordonnancementsEnBase();
  const creneau = enBase[SANS_DATE]?.creneauConseille;
  const departAuto = enBase[SANS_DATE]?.departPrevu;
  const heureAuto = typeof departAuto === 'number' ? new Date(departAuto).getHours() : null;

  noter(
    'une carte posée NAÎT avec son créneau conseillé',
    !!creneau,
    creneau ? JSON.stringify(creneau) : 'aucun créneau en base',
  );
  noter(
    'sans historique de quota, c’est la plage RÉGLÉE qui sort (22 h → 7 h)',
    creneau?.source === 'heures-creuses' && creneau?.heureDebut === 22 && creneau?.heureFin === 7,
    JSON.stringify(creneau ?? null),
  );
  noter(
    'le créneau gardé ne porte NI date NI phrase : il reste vrai demain',
    !!creneau &&
      Object.keys(creneau).every((clef) =>
        ['source', 'heureDebut', 'heureFin', 'lourde', 'pasAvant'].includes(clef),
      ),
    Object.keys(creneau ?? {}).join(', ') || '(vide)',
  );
  noter(
    'le créneau N’EST PAS un départ : aucune date posée toute seule',
    departAuto === undefined && enBase[SANS_DATE]?.creneauAutomatique === undefined,
    departAuto ? `départ posé : ${new Date(departAuto).toLocaleString('fr-CH')}` : 'aucun départ',
  );

  /* ---------------- 2. Ce que l'écran en montre ---------------- */

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  const { page, erreurs } = await ouvrirLeTableau(navigateur);

  /* Les deux mentions se lisent dans la bulle du « i » de chaque carte. Les
     cartes se reconnaissent à leur IDENTIFIANT : un titre peut être réécrit
     entre-temps (le cadrage de la carte posée le fait). */
  const ID_SANS_DATE = sansDate.corps?.carte?.id;
  const ID_AVEC_DATE = 'c-essai-datee';
  const lues = await mentionsDeDepart(page);
  const avecDepart = lues.filter((lue) => lue.depart > 0);
  const avecCreneau = lues.filter((lue) => lue.creneau > 0);
  const nombreDepart = lues.reduce((somme, lue) => somme + lue.depart, 0);
  const nombreCreneau = lues.reduce((somme, lue) => somme + lue.creneau, 0);
  const texteDepart = avecDepart[0]?.texteDepart ?? '';
  noter(
    'seule la carte datée À LA MAIN affiche un départ programmé',
    nombreDepart === 1 && avecDepart[0]?.id === ID_AVEC_DATE && /Départ programmé/.test(texteDepart),
    `${nombreDepart} mention(s) — ${texteDepart ? `« ${texteDepart} » sur « ${avecDepart[0]?.titre} »` : 'aucune'}`,
  );
  noter(
    'la carte sans date affiche la case « créneau conseillé », en simple suggestion',
    nombreCreneau === 1 && !!ID_SANS_DATE && avecCreneau[0]?.id === ID_SANS_DATE,
    `${nombreCreneau} case(s)${avecCreneau[0] ? ` — « ${avecCreneau[0].texteCreneau} » sur « ${avecCreneau[0].titre} »` : ''}`,
  );

  /* Le geste humain qui pose la date (horloge → « Retenir cette heure ») se
     vérifie dans `scripts/verif-plan-replie-et-programmation.mjs` : ouvrir la
     carte ici lancerait un cadrage, et donc un agent, sur une carte sans plan. */

  /* ---------------- 3. Rien n'a été dépensé ---------------- */

  noter(
    'aucun agent de carte créé : pas un jeton dépensé',
    agentsDeCarte() === 0,
    `${agentsDeCarte()} agent(s)`,
  );
  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await page.screenshot({ path: path.join(TMP, 'creneau-conseille.png') });

  await navigateur.close();
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) console.log(`(journal dans ${TMP})`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.slice(-20).join(''));
  process.exit(1);
});
