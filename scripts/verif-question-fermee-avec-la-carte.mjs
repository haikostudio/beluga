#!/usr/bin/env node
/**
 * UNE QUESTION D'AGENT S'ANNULE AVEC LA CARTE, ET SON « ANNULER » EST VISIBLE.
 *
 * Deux relevés, du plus profond au plus visible :
 *   1. le DÉMON, par la vraie liaison : une carte déplacée hors du travail
 *      (« À déployer », « En production », « Archivé ») ferme d'office ses
 *      questions restées ouvertes — celle de l'outil `ask_user` comme celle
 *      écrite en texte ordinaire — tandis que « Terminé » les garde ;
 *   2. l'ÉCRAN, dans un vrai navigateur, sur téléphone puis sur ordinateur : la
 *      carte qui attend une réponse porte « Répondre » ET « Annuler », et le
 *      clic sur « Annuler » éteint les deux.
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve : le
 * démon de production n'est pas touché, et il tourne sur le code qui vient
 * d'être construit — pas sur la version publiée. Aucun tour d'agent n'est
 * lancé (plafond d'agents à zéro) : aucun jeton n'est dépensé.
 *
 *   npm run build && node scripts/verif-question-fermee-avec-la-carte.mjs
 */
import { chromium } from 'playwright';
import WebSocket from 'ws';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKO_QUESTION_CARTE_PORT || 7193);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = `${RACINE}/data/verification`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-question-carte-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DOSSIER = path.join(TMP, 'projet');
for (const dossier of [DATA, PROJETS, DOSSIER]) fs.mkdirSync(dossier, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

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
demon.stdout.on('data', () => {});
demon.stderr.on('data', () => {});

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

/* ------------------------------------------------------------------ */
/* Le décor : un projet, des cartes, une session                       */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const base = () => new Database(path.join(DATA, 'haikodev.db'));

const marque = Date.now();
const QUESTION_OUTIL = `Vérification ${marque} — quelle formule retenir ?`;
const QUESTION_TEXTE = `Vérification ${marque} — faut-il garder l’ancienne mise en page ou la nouvelle ?`;

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(JETON),
    maintenant,
    maintenant + 3600_000,
    'vérification question fermée avec la carte',
  );

  // Plafond d'agents à ZÉRO : rien ne peut démarrer tout seul dans le dos.
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai question fermée',
    path: DOSSIER,
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

/**
 * Une carte dans sa colonne, son agent, et la question qui attend dessus.
 *
 * La CARTE passe par la vraie commande du démon (`card.create` puis
 * `card.move`) : ses champs sont de vraies colonnes SQL, et les écrire à la
 * main casserait à la première évolution du modèle. L'agent et son message,
 * eux, sont posés directement — rien ne permet de fabriquer une question sans
 * lancer un tour, et c'est justement ce qu'on veut éviter.
 */
async function carteQuiAttend(titre, colonne, genre) {
  const creation = await appelDemon({ type: 'card.create', projectId: PROJET_ID, title: titre });
  const cardId =
    creation?.result?.card?.id ??
    creation?.data?.card?.id ??
    creation?.result?.id ??
    creation?.data?.id;
  if (!cardId) throw new Error(`carte non créée : ${JSON.stringify(creation).slice(0, 200)}`);
  if (colonne !== 'planned') await appelDemon({ type: 'card.move', id: cardId, column: colonne });

  const db = base();
  const maintenant = Date.now();
  const agentId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const questionId = crypto.randomUUID();

  const agent = {
    id: agentId,
    projectId: PROJET_ID,
    cardId,
    role: 'task',
    title: titre,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'done',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(agentId, PROJET_ID, cardId, 'task', 'done', JSON.stringify(agent), maintenant, maintenant);

  const message = {
    id: messageId,
    agentId,
    role: 'assistant',
    content: genre === 'outil' ? 'Un choix est nécessaire.' : `Le travail est prêt.\n\n${QUESTION_TEXTE}`,
    steps: [],
    todos: [],
    proposals: [],
    questions:
      genre === 'outil'
        ? [
            {
              id: questionId,
              question: QUESTION_OUTIL,
              kind: 'text',
              options: [],
              allowFreeText: true,
              answerAttachments: [],
            },
          ]
        : [],
    /*
     * LA TROISIÈME ATTENTE, longtemps oubliée : un tour coupé par la limite
     * d'un compte. Elle n'était filtrée par AUCUNE colonne — c'est elle qui
     * gardait « Répondre / Annuler » sur des cartes « En production » (deux
     * cartes en base le 23/08/2026, dont celle de la capture).
     */
    ...(genre === 'reprise'
      ? {
          repriseCompte: {
            engine: 'claude',
            compteEpuise: 'compte-essai',
            compteEpuiseLabel: 'Compte d’essai',
            motif: 'limite-structuree',
            at: maintenant,
          },
        }
      : {}),
    downloads: [],
    attachments: [],
    streaming: false,
    createdAt: maintenant,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    messageId,
    agentId,
    'assistant',
    JSON.stringify(message),
    maintenant,
  );
  db.close();
  return { cardId, agentId, messageId };
}

function lireMessage(messageId) {
  const db = base();
  const ligne = db.prepare('SELECT data FROM messages WHERE id = ?').get(messageId);
  db.close();
  return ligne ? JSON.parse(ligne.data) : null;
}

/** Une commande envoyée au démon par la vraie liaison, et sa réponse. */
function appelDemon(commande) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { cookie: `haikodev_session=${JETON}` },
    });
    const id = crypto.randomUUID();
    const minuteur = setTimeout(() => {
      socket.close();
      reject(new Error('le démon ne répond pas'));
    }, 20000);
    socket.on('open', () => socket.send(JSON.stringify({ id, cmd: commande })));
    socket.on('message', (brut) => {
      const trame = JSON.parse(String(brut));
      if (trame.id !== id) return;
      clearTimeout(minuteur);
      socket.close();
      resolve(trame);
    });
    socket.on('error', (souci) => {
      clearTimeout(minuteur);
      reject(souci);
    });
  });
}

/* ------------------------------------------------------------------ */
/* Relevé 1 : le démon                                                 */
/* ------------------------------------------------------------------ */

async function releveDuDemon() {
  // Les trois colonnes qui ferment, chacune avec sa question d'outil.
  for (const colonne of ['to_deploy', 'in_production', 'archived']) {
    const { cardId, messageId } = await carteQuiAttend(`Question puis ${colonne}`, 'running', 'outil');
    await appelDemon({ type: 'card.move', id: cardId, column: colonne });
    const question = lireMessage(messageId)?.questions?.[0];
    noter(`démon : passer en « ${colonne} » ferme la question de l’outil`, question?.cancelled === true);
  }

  // « Terminé » ne ferme rien : le travail peut y être repris.
  {
    const { cardId, messageId } = await carteQuiAttend('Question puis Terminé', 'running', 'outil');
    await appelDemon({ type: 'card.move', id: cardId, column: 'done' });
    const question = lireMessage(messageId)?.questions?.[0];
    noter('démon : « Terminé » garde la question ouverte', question?.cancelled !== true);
  }

  // La question écrite en TEXTE ORDINAIRE s'éteint elle aussi.
  {
    const { cardId, messageId } = await carteQuiAttend('Question en texte puis archivage', 'running', 'texte');
    await appelDemon({ type: 'card.move', id: cardId, column: 'archived' });
    noter('démon : l’archivage ferme la question écrite en texte libre', lireMessage(messageId)?.texteLibreAnnulee === true);
  }

  // Le bouton « Annuler » de la carte, sans déplacer la carte.
  {
    const { cardId, messageId } = await carteQuiAttend('Question annulée à la main', 'running', 'outil');
    const trame = await appelDemon({ type: 'question.cancelCarte', cardId });
    const question = lireMessage(messageId)?.questions?.[0];
    noter('démon : « question.cancelCarte » ferme la question sans ranger la carte', question?.cancelled === true && trame.ok !== false);
  }

  /*
   * LA REPRISE DE COMPTE, LA TROISIÈME ATTENTE. Elle échappait aux deux règles
   * ci-dessus : rien ne la fermait au rangement, et rien ne l'écartait à la
   * lecture. Les deux moitiés sont vérifiées — celle qui répare l'avenir, et
   * celle qui rattrape ce qui dort déjà en base.
   */
  {
    const { cardId, messageId } = await carteQuiAttend('Reprise puis production', 'running', 'reprise');
    await appelDemon({ type: 'card.move', id: cardId, column: 'in_production' });
    noter(
      'démon : passer en « En production » ferme le choix de reprise de compte',
      lireMessage(messageId)?.repriseCompte?.abandonnee === true,
    );
  }

  {
    const { cardId, messageId } = await carteQuiAttend('Reprise puis Terminé', 'running', 'reprise');
    await appelDemon({ type: 'card.move', id: cardId, column: 'done' });
    noter(
      'démon : « Terminé » garde le choix de reprise ouvert',
      lireMessage(messageId)?.repriseCompte?.abandonnee !== true,
    );
  }

  {
    const { messageId } = await carteQuiAttend('Reprise née en production', 'in_production', 'reprise');
    // Née DANS une colonne close : aucun déplacement ne viendra jamais la
    // fermer. Seul le garde-fou de lecture peut l'écarter — c'est le cas des
    // cartes déjà en base avant ce correctif.
    const decisions = await decisionsDuServeur();
    noter(
      'démon : une reprise dormant sur une carte rangée ne compte plus comme décision',
      !decisions.some((d) => d.lieuTitre === 'Reprise née en production'),
      `${decisions.length} décision(s) diffusée(s), message ${messageId.slice(0, 8)} écarté`,
    );
  }

  {
    const { messageId } = await carteQuiAttend('Reprise annulée à la main', 'running', 'reprise');
    const trame = await appelDemon({ type: 'reprise.abandon', messageId });
    noter(
      'démon : « reprise.abandon » referme la bulle sans reprendre le travail',
      lireMessage(messageId)?.repriseCompte?.abandonnee === true && trame.ok !== false,
    );
  }
}

/** Les décisions que le serveur diffuse à l'ouverture — la source des triangles. */
function decisionsDuServeur() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { cookie: `haikodev_session=${JETON}` },
    });
    const minuteur = setTimeout(() => {
      socket.close();
      reject(new Error('aucun signal d’attention reçu'));
    }, 20000);
    socket.on('message', (brut) => {
      const trame = JSON.parse(String(brut));
      if (trame.type !== 'attention') return;
      clearTimeout(minuteur);
      socket.close();
      resolve(trame.decisions ?? []);
    });
    socket.on('error', (souci) => {
      clearTimeout(minuteur);
      reject(souci);
    });
  });
}

/* ------------------------------------------------------------------ */
/* Relevé 2 : l'écran                                                  */
/* ------------------------------------------------------------------ */

const carteDuTableau = (page, titre) =>
  page.locator('[data-carte]').filter({ hasText: titre }).first();

async function ecran(navigateur, telephone, titre) {
  const nom = telephone ? 'téléphone' : 'ordinateur';
  const context = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
    deviceScaleFactor: telephone ? 2 : 1,
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'haikodev_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on(
    'console',
    (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && erreurs.push(m.text()),
  );
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().includes('/api/speak?')) {
      erreurs.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    const carte = carteDuTableau(page, titre);
    await carte.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    const vue = (await carte.count()) > 0;
    noter(`${nom} : la carte qui attend une réponse est affichée`, vue);
    if (!vue) {
      await page.screenshot({ path: `${SHOTS}/question-carte-${nom}-introuvable.png`, fullPage: true });
      return { erreurs };
    }
    await carte.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);

    const repondre = carte.locator('[data-repondre-carte]');
    const annuler = carte.locator('[data-annuler-question-carte]');
    noter(`${nom} : la carte porte « Répondre »`, (await repondre.count()) === 1);
    noter(`${nom} : la carte porte « Annuler », à côté`, (await annuler.count()) === 1);
    noter(
      `${nom} : « Annuler » est réellement visible et cliquable`,
      (await annuler.count()) === 1 && (await annuler.first().isVisible()),
    );
    await page.screenshot({ path: `${SHOTS}/question-carte-${nom}.png`, fullPage: true });

    await annuler.first().click({ force: true });
    await page.waitForTimeout(2500);
    noter(`${nom} : le clic éteint « Répondre »`, (await carte.locator('[data-repondre-carte]').count()) === 0);
    noter(`${nom} : et « Annuler » disparaît avec lui`, (await carte.locator('[data-annuler-question-carte]').count()) === 0);

    /*
     * L'ÉCRAN RESTE OUVERT, ET LA CARTE EST RANGÉE AILLEURS. C'est le cas du
     * défaut signalé : un téléphone posé sur le tableau depuis des heures.
     * Aucun rechargement, aucun clic — le serveur diffuse, l'écran suit. Deux
     * cartes, une par attente : la question de l'outil et la reprise de compte,
     * qui échappait à tout.
     */
    for (const [genre, etiquette] of [
      ['outil', 'la question de l’outil'],
      ['reprise', 'la reprise de compte'],
    ]) {
      const titreVivant = `Rangée sous les yeux ${genre} ${nom} ${marque}`;
      const { cardId } = await carteQuiAttend(titreVivant, 'running', genre);
      /*
       * UN RECHARGEMENT ICI, ET UN SEUL. Le décor est écrit DIRECTEMENT en base
       * — c'est le seul moyen de fabriquer une attente sans lancer un vrai tour
       * —, et une écriture en base ne diffuse rien : l'écran ne peut pas la
       * deviner. On recharge donc pour ÉTABLIR le point de départ (les boutons
       * sont là), et c'est seulement le DÉPLACEMENT qui suit qui doit se voir
       * sans rechargement. C'est exactement ce que le défaut mettait en cause.
       */
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(6000);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);

      const vivante = carteDuTableau(page, titreVivant);
      await vivante.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
      await vivante.scrollIntoViewIfNeeded().catch(() => {});
      noter(
        `${nom} : ${etiquette} allume « Répondre » sur la carte`,
        (await vivante.locator('[data-repondre-carte]').count()) === 1,
      );

      await appelDemon({ type: 'card.move', id: cardId, column: 'in_production' });
      await page.waitForTimeout(3000);
      const apres = carteDuTableau(page, titreVivant);
      noter(
        `${nom} : rangée sous les yeux, ${etiquette} perd « Répondre » sans rechargement`,
        (await apres.locator('[data-repondre-carte]').count()) === 0,
      );
      noter(
        `${nom} : …et perd « Annuler » avec lui`,
        (await apres.locator('[data-annuler-question-carte]').count()) === 0,
      );
    }

    /*
     * LA QUESTION ÉCRITE EN TOUTES LETTRES, DANS SA BULLE. Sa seule sortie
     * vivait dans une bande posée au-dessus du champ d'écriture, loin de ce
     * qu'elle fermait — introuvable dès qu'on lisait la conversation ailleurs
     * qu'en bas. On ouvre le tiroir de la carte et on juge la BULLE.
     */
    {
      const titreTexte = `Question en texte ${nom} ${marque}`;
      await carteQuiAttend(titreTexte, 'running', 'texte');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(6000);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);

      const carteTexte = carteDuTableau(page, titreTexte);
      await carteTexte.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
      await carteTexte.scrollIntoViewIfNeeded().catch(() => {});
      await carteTexte.locator('[data-repondre-carte]').first().click({ force: true });
      await page.waitForTimeout(4000);

      const bulle = page.locator('[data-question-en-texte]').first();
      await bulle.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
      noter(`${nom} : la question en texte ordinaire porte sa propre bulle`, (await bulle.count()) === 1);
      const sortie = bulle.locator('[data-annuler-question-texte]');
      noter(
        `${nom} : son « Annuler » est DANS la bulle, et visible`,
        (await sortie.count()) === 1 && (await sortie.first().isVisible().catch(() => false)),
      );
      await page.screenshot({ path: `${SHOTS}/question-texte-${nom}.png`, fullPage: true });

      if (await sortie.count()) {
        await sortie.first().click({ force: true });
        await page.waitForTimeout(2500);
        noter(
          `${nom} : le clic referme la bulle sans rechargement`,
          (await page.locator('[data-question-en-texte]').count()) === 0,
        );
      } else {
        noter(`${nom} : le clic referme la bulle sans rechargement`, false, 'bouton introuvable');
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1500);
    }
  } finally {
    await context.close().catch(() => {});
  }
  return { erreurs };
}

/* ------------------------------------------------------------------ */

async function main() {
  if (!(await attendrePort())) {
    console.error('le démon d’essai n’a pas démarré');
    process.exit(1);
  }
  poserLeDecor();
  // Le décor est posé dans la base sous le démon : on le relit d'un
  // redémarrage… non, le démon lit la base à chaque requête, il suffit
  // d'attendre son prochain instantané.
  await new Promise((r) => setTimeout(r, 1500));

  await releveDuDemon();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  try {
    for (const telephone of [true, false]) {
      // Une carte NEUVE par écran : le premier clic ferme la question, le
      // second écran ne trouverait plus rien à annuler.
      const titre = `Carte en attente ${telephone ? 'téléphone' : 'ordinateur'} ${marque}`;
      await carteQuiAttend(titre, 'running', 'outil');
      await new Promise((r) => setTimeout(r, 1000));
      const { erreurs } = await ecran(navigateur, telephone, titre);
      noter(
        `${telephone ? 'téléphone' : 'ordinateur'} : aucune erreur dans la page`,
        erreurs.length === 0,
        erreurs.slice(0, 2).join(' | '),
      );
    }
  } finally {
    await navigateur.close().catch(() => {});
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
