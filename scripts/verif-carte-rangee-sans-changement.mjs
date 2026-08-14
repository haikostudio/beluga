#!/usr/bin/env node
/**
 * RIEN NE RESTE COINCÉ DANS « EN COURS ».
 *
 * Le bogue rapporté : une carte dont l'agent avait rendu sa réponse — coche de
 * fin comprise — restait comptée dans « EN COURS 3 », sans un mot, parce que le
 * tour n'avait modifié aucun fichier : la correction demandée était DÉJÀ livrée.
 * Aucun agent ne travaillait plus, rien ne devait la reprendre, et elle n'en
 * sortait jamais.
 *
 * Le contrôle, joué dans un VRAI navigateur, sur son PROPRE démon (base neuve,
 * dossier de projets vide, port libre : le démon de production n'est pas touché,
 * aucun quota dépensé) :
 *
 *  1. trois cartes en « En cours » — une dont le travail était déjà livré, une
 *     neuve qui n'a jamais rien enregistré, une dont l'agent travaille encore ;
 *  2. les deux premiers tours se terminent VRAIMENT, par le code du démon
 *     (`carteApresFinDeTour`), avec le constat « le dépôt n'a pas bougé » ;
 *  3. on regarde le tableau : où sont les cartes, ce qu'elles disent, et ce que
 *     compte la tête de la colonne.
 *
 *   node scripts/verif-carte-rangee-sans-changement.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7197);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-carte-rangee-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
for (const dossier of [DATA, PROJETS, DEPOT]) fs.mkdirSync(dossier, { recursive: true });

execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
  cwd: DEPOT,
});

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
const journal = [];
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
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';

/*
 * Les cartes du contrôle, chacune avec son histoire.
 *
 * Les trois premières vivent un tour qui SE TERMINE sous nos yeux : elles
 * portent donc la MARQUE DE VOL (`tourEnVolDepuis`), comme toute carte qu'un
 * tour tient réellement.
 *
 * Les trois dernières sont les OUBLIÉES — celles de la capture d'origine : leur
 * tour est fini depuis longtemps, leur marque a été retirée, leur agent est
 * rendu, et plus aucune fin de tour ne viendra les ranger. Seul le balayage de
 * l'ordonnanceur (`rangerLesCartesOubliees`) peut encore les débloquer.
 */
const CARTES = [
  {
    id: 'c-deja-livre',
    titre: 'Essai — le travail était déjà livré',
    codeDejaEnregistre: true,
    statutAgent: 'done',
    enVol: true,
  },
  {
    id: 'c-neuve',
    titre: 'Essai — rien n’a jamais été enregistré',
    codeDejaEnregistre: false,
    statutAgent: 'done',
    enVol: true,
  },
  {
    id: 'c-au-travail',
    titre: 'Essai — un agent travaille encore',
    codeDejaEnregistre: false,
    statutAgent: 'running',
    enVol: true,
  },
  {
    id: 'c-oubliee-livree',
    titre: 'Essai — oubliée en « En cours », travail déjà livré',
    codeDejaEnregistre: true,
    statutAgent: 'done',
    enVol: false,
  },
  {
    id: 'c-oubliee-neuve',
    titre: 'Essai — oubliée en « En cours », rien jamais livré',
    codeDejaEnregistre: false,
    statutAgent: 'done',
    enVol: false,
  },
  {
    id: 'c-oubliee-echec',
    titre: 'Essai — oubliée en « En cours », mais son tour a échoué',
    codeDejaEnregistre: false,
    statutAgent: 'failed',
    enVol: false,
  },
];

function poserLeProjetEtLesCartes() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification carte rangée sans changement',
  );

  // Aucun agent ne doit partir : ce contrôle n'appelle aucun moteur.
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: 'Projet d’essai',
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

  CARTES.forEach((essai, rang) => {
    const agentId = `a-${essai.id}`;
    const carte = {
      id: essai.id,
      projectId: PROJET_ID,
      column: 'running',
      position: rang + 1,
      title: essai.titre,
      description: 'Carte d’essai',
      origin: 'user',
      labels: [],
      attachments: [],
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      agentId,
      codeDejaEnregistre: essai.codeDejaEnregistre,
      scheduling: {
        asap: false,
        attempts: 1,
        restarts: 0,
        // La marque de vol : posée au démarrage du tour, retirée quand la carte
        // est rangée. Une carte OUBLIÉE n'en porte plus.
        ...(essai.enVol ? { tourEnVolDepuis: maintenant } : {}),
      },
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(essai.id, PROJET_ID, 'running', rang + 1, carte.title, JSON.stringify(carte), maintenant, maintenant);

    const agent = {
      id: agentId,
      projectId: PROJET_ID,
      cardId: essai.id,
      role: 'task',
      title: essai.titre,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      status: essai.statutAgent,
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(agentId, PROJET_ID, essai.id, 'task', essai.statutAgent, JSON.stringify(agent), maintenant, maintenant);
  });

  db.close();
}

/**
 * LA VRAIE FIN DE TOUR, celle du démon : `carteApresFinDeTour` décide, le
 * magasin enregistre. Rien n'est imité ici — c'est le code qui tourne en
 * production, appelé avec le constat « le dépôt n'a pas bougé ».
 */
async function terminerLesTours() {
  process.env.HAIKODEV_DATA = DATA;
  const store = await import(path.join(RACINE, 'server/dist/store.js'));
  const { carteApresFinDeTour } = await import(path.join(RACINE, 'server/dist/deplacement-carte.js'));

  for (const essai of CARTES.filter((c) => c.enVol && c.statutAgent === 'done')) {
    const carte = store.getCard(essai.id);
    store.saveCard(
      carteApresFinDeTour(carte, {
        agentId: `a-${essai.id}`,
        role: 'task',
        reussi: true,
        trace: 'non',
        moteurMuet: false,
      }),
    );
  }
}

async function ouvrirLeTableau(navigateur) {
  const contexte = await navigateur.newContext({
    viewport: { width: 1500, height: 950 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([
    { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  return { page, erreurs };
}

/** Ce que le tableau montre : la colonne de chaque carte, et les compteurs. */
async function lireLeTableau(page) {
  return page.evaluate((ids) => {
    const compteur = (colonne) => {
      const tete = document.querySelector(`[data-column="${colonne}"] h2`);
      return tete?.nextElementSibling?.textContent?.trim() ?? null;
    };
    const cartes = {};
    for (const id of ids) {
      const noeud = document.querySelector(`[data-carte="${id}"]`);
      cartes[id] = noeud
        ? {
            colonne: noeud.closest('[data-column]')?.getAttribute('data-column') ?? null,
            texte: noeud.textContent ?? '',
          }
        : null;
    }
    return {
      cartes,
      enCours: compteur('running'),
      termine: compteur('done'),
      planifie: compteur('planned'),
    };
  }, CARTES.map((c) => c.id));
}

/**
 * On laisse le démon faire son tour de boucle (quinze secondes) et on relit le
 * tableau jusqu'à ce que les oubliées aient bougé — sans jamais dépasser la
 * limite, pour qu'un échec soit un échec et non une attente sans fin.
 */
async function attendreLeBalayage(page, limiteMs = 90000) {
  const fin = Date.now() + limiteMs;
  let vu = await lireLeTableau(page);
  while (Date.now() < fin) {
    if (vu.cartes['c-oubliee-livree']?.colonne !== 'running') return vu;
    await page.waitForTimeout(5000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    vu = await lireLeTableau(page);
  }
  return vu;
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeProjetEtLesCartes();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const { page, erreurs } = await ouvrirLeTableau(navigateur);

  const avant = await lireLeTableau(page);
  noter(
    `au départ, les ${CARTES.length} cartes sont dans « En cours »`,
    avant.enCours === String(CARTES.length),
    `compteur=${avant.enCours}`,
  );
  noter(
    'chacune est bien affichée dans la colonne « En cours »',
    CARTES.every((c) => avant.cartes[c.id]?.colonne === 'running'),
    JSON.stringify(Object.fromEntries(CARTES.map((c) => [c.id, avant.cartes[c.id]?.colonne]))),
  );

  await terminerLesTours();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const apres = await lireLeTableau(page);

  const dejaLivre = apres.cartes['c-deja-livre'];
  noter(
    'la carte dont le travail était déjà livré quitte « En cours »',
    dejaLivre?.colonne === 'done',
    `colonne=${dejaLivre?.colonne}`,
  );
  noter(
    '…et sa raison est lisible sur la carte',
    /déjà livré/.test(dejaLivre?.texte ?? ''),
    (dejaLivre?.texte ?? '').slice(0, 160),
  );

  const neuve = apres.cartes['c-neuve'];
  noter(
    'la carte qui n’a jamais rien enregistré redescend en file',
    neuve?.colonne === 'planned',
    `colonne=${neuve?.colonne}`,
  );
  noter(
    '…et elle n’est jamais annoncée terminée',
    neuve?.colonne !== 'done' && neuve?.colonne !== 'to_deploy',
    `colonne=${neuve?.colonne}`,
  );
  noter(
    '…avec sa raison écrite dessus',
    /aucun fichier/.test(neuve?.texte ?? ''),
    (neuve?.texte ?? '').slice(0, 160),
  );

  noter(
    'la carte dont l’agent travaille encore reste en « En cours »',
    apres.cartes['c-au-travail']?.colonne === 'running',
    `colonne=${apres.cartes['c-au-travail']?.colonne}`,
  );

  /*
   * LES OUBLIÉES, celles de la capture d'origine. Aucune fin de tour ne viendra
   * les ranger : on laisse tourner la boucle de l'ordonnanceur du démon d'essai
   * (quinze secondes) et on regarde le tableau. Rien n'est imité — c'est le
   * démon qui balaie, tout seul.
   */
  const balaye = await attendreLeBalayage(page);
  noter(
    'sans aucune fin de tour, le démon range la carte oubliée dont le code était livré',
    balaye.cartes['c-oubliee-livree']?.colonne === 'done',
    `colonne=${balaye.cartes['c-oubliee-livree']?.colonne}`,
  );
  noter(
    '…et sa raison est lisible sur la carte',
    /déjà livré/.test(balaye.cartes['c-oubliee-livree']?.texte ?? ''),
    (balaye.cartes['c-oubliee-livree']?.texte ?? '').slice(0, 160),
  );
  noter(
    'la carte oubliée qui n’avait rien livré redescend en file, avec sa raison',
    balaye.cartes['c-oubliee-neuve']?.colonne === 'planned' &&
      /sans ranger la carte/.test(balaye.cartes['c-oubliee-neuve']?.texte ?? ''),
    `colonne=${balaye.cartes['c-oubliee-neuve']?.colonne} — ${(balaye.cartes['c-oubliee-neuve']?.texte ?? '').slice(0, 120)}`,
  );
  noter(
    'une carte dont le tour a ÉCHOUÉ reste en « En cours », là où on la relance',
    balaye.cartes['c-oubliee-echec']?.colonne === 'running',
    `colonne=${balaye.cartes['c-oubliee-echec']?.colonne}`,
  );
  noter(
    'le compteur de la colonne suit',
    balaye.enCours === '2',
    `compteur=${balaye.enCours} (attendu 2 : l’agent au travail et le tour en échec)`,
  );
  noter('la colonne « Terminé » compte les cartes rangées', balaye.termine === '2', `compteur=${balaye.termine}`);

  await page.screenshot({ path: path.join(TMP, 'carte-rangee-sans-changement.png') });

  /*
   * La carte renvoyée en file ne doit pas repartir toute seule : sans cette
   * retenue, l'ordonnanceur relancerait le même tour vide toutes les quinze
   * secondes. On le relit dans la base, là où l'ordonnanceur le lit.
   */
  const partage = await import(path.join(RACINE, 'shared/dist/index.js'));
  const store = await import(path.join(RACINE, 'server/dist/store.js'));
  const enFile = store.getCard('c-neuve');
  noter(
    'la carte renvoyée en file ne repartira pas toute seule',
    partage.demarrageAutomatiqueAutorise(enFile?.scheduling) === false,
    JSON.stringify(enFile?.scheduling),
  );
  noter(
    'la carte rangée porte sa date de clôture',
    typeof store.getCard('c-deja-livre')?.doneAt === 'number',
    String(store.getCard('c-deja-livre')?.doneAt),
  );

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) console.log(`(captures et journal dans ${TMP})`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.slice(-20).join(''));
  process.exit(1);
});
