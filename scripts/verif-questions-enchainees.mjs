#!/usr/bin/env node
/**
 * DES QUESTIONS POSÉES COUP SUR COUP GARDENT CHACUNE SA RÉPONSE, ET LA BARRE
 * D'ÉCRITURE NE RÉPOND À AUCUNE.
 *
 * Le fil d'une carte réunissait à tort les traces de deux questions
 * voisines : une question disparaissait, sa réponse se lisait sous la
 * suivante, et la dernière paraissait deux fois. La barre d'écriture, elle,
 * ne répond JAMAIS à une question : ce qu'on y écrit se met en file.
 *
 * Trois relevés, du plus profond au plus visible :
 *   1. le TRANSPORT, par une vraie liaison au démon : un message écrit pendant
 *      qu'une question attend ne la répond pas ;
 *   2. le FIL D'UNE CARTE, dans un vrai navigateur, sur téléphone puis sur
 *      ordinateur : trois questions enchaînées se lisent en trois encadrés,
 *      chacun avec SA réponse marquée comme retenue (elle se détache des
 *      autres options par sa couleur de bordure — le gris du « terminé »
 *      depuis que l'interface est en noir et blanc, plus un bleu), et l'entête
 *      dit « Plusieurs choix » quand plusieurs étaient permis ;
 *   3. la BARRE D'ÉCRITURE, à l'écran, sur une carte dont l'agent attend une
 *      réponse : on coche dans la bulle, on écrit dans la barre, et la question
 *      reste ouverte (le message attend son tour).
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve : le
 * démon de production n'est pas touché. Aucun tour d'agent n'est lancé (plafond
 * d'agents à zéro), donc aucun quota dépensé.
 *
 * RECALÉ SUR LA REFONTE (11/10/2026). Le fil d'une carte est une discussion :
 * son premier `[data-point]` est le passage « Configuration », gardé caché dans
 * le document. Le fil s'attend donc sur son premier passage AFFICHÉ.
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-questions-enchainees.mjs
 */
import { chromium } from 'playwright';
import WebSocket from 'ws';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7193);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-questions-enchainees-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const DOSSIER = path.join(TMP, 'projet');
const { DATA, journal, attendrePort } = demarrerDemonDEssai({
  tmp: TMP,
  port: PORT,
  depot: false,
  dossiers: [DOSSIER],
});

/* ------------------------------------------------------------------ */
/* Le décor                                                            */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const CHEF_ID = 'a-chef';
const CARTE_ID = 'c-essai';
const TACHE_ID = 'a-tache';
/** Une SECONDE carte, dont l'agent attend une réponse : c'est là qu'on écrit dans la barre. */
const CARTE_BARRE_ID = 'c-barre';
const TACHE_BARRE_ID = 'a-barre';
const base = () => new Database(path.join(DATA, 'beluga.db'));

/** Les trois questions du fil : la première permet PLUSIEURS choix. */
const QUESTIONS = [
  {
    question: 'Quels champs sont concernés ?',
    kind: 'multiple',
    options: ['Le montant', 'La date', 'Le libellé'],
    reponse: 'Le montant, La date',
    retenues: ['Le montant', 'La date'],
  },
  {
    question: 'Sur la roulette, on avance de combien ?',
    kind: 'single',
    options: ['Minute par minute', 'Par pas de cinq minutes'],
    reponse: 'Minute par minute',
    retenues: ['Minute par minute'],
  },
  {
    question: 'Sans heure choisie, laquelle retenir ?',
    kind: 'single',
    options: ['L’heure qu’il est maintenant', 'Midi'],
    reponse: 'L’heure qu’il est maintenant',
    retenues: ['L’heure qu’il est maintenant'],
  },
];

const QUESTION_DE_LA_BARRE = {
  intitule: 'Vérification — on garde le bandeau du haut ?',
  options: ['Oui, on le garde', 'Non, on le retire'],
};

function poserAgent(db, id, role, cardId, maintenant) {
  const agent = {
    id,
    projectId: PROJET_ID,
    ...(cardId ? { cardId } : {}),
    role,
    title: role === 'cadrage' ? 'Chef d’orchestre' : 'Carte d’essai',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: role === 'task' ? 'done' : 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, PROJET_ID, cardId ?? null, role, agent.status, JSON.stringify(agent), maintenant, maintenant);
}

function poserMessage(db, agentId, role, partiel) {
  const id = crypto.randomUUID();
  const message = {
    id,
    agentId,
    role,
    content: '',
    steps: [],
    todos: [],
    proposals: [],
    questions: [],
    downloads: [],
    attachments: [],
    streaming: false,
    createdAt: Date.now(),
    ...partiel,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    agentId,
    role,
    JSON.stringify(message),
    message.createdAt,
  );
  return id;
}

/** Une question ouverte, à choix ET à réponse écrite, sous cet agent. */
function poserQuestionOuverte(agentId) {
  const db = base();
  const id = poserMessage(db, agentId, 'assistant', {
    content: 'Question posée par le script de vérification.',
    questions: [
      {
        id: crypto.randomUUID(),
        question: QUESTION_DE_LA_BARRE.intitule,
        kind: 'single',
        options: QUESTION_DE_LA_BARRE.options.map((label, rang) => ({ id: `o${rang}`, label })),
        allowFreeText: true,
        answerAttachments: [],
      },
    ],
  });
  db.close();
  return id;
}

function lireQuestion(messageId) {
  const db = base();
  const ligne = db.prepare('SELECT data FROM messages WHERE id = ?').get(messageId);
  db.close();
  return ligne ? JSON.parse(ligne.data).questions[0] : null;
}

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(JETON),
    maintenant,
    maintenant + 3600_000,
    'vérification des questions enchaînées',
  );

  // Plafond d'agents à ZÉRO : rien ne peut démarrer tout seul dans le dos.
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai questions enchaînées',
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

  poserAgent(db, CHEF_ID, 'cadrage', null, maintenant);

  /* LA CARTE NAÎT DANS « PLANIFIÉ » : rien ne la balaie, rien ne la déploie. */
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description, agent_id)
     VALUES (?, ?, 'planned', 1, ?, '{}', ?, ?, ?, ?)`,
  ).run(CARTE_ID, PROJET_ID, 'Carte d’essai — questions enchaînées', maintenant, maintenant, 'Carte posée par un contrôle automatique.', TACHE_ID);
  poserAgent(db, TACHE_ID, 'task', CARTE_ID, maintenant);
  /* Sans une demande partie, l'écran resterait sur la configuration de l'agent. */
  poserMessage(db, TACHE_ID, 'user', { content: 'Carte d’essai : ne rien exécuter.' });
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description, agent_id)
     VALUES (?, ?, 'planned', 2, ?, '{}', ?, ?, ?, ?)`,
  ).run(CARTE_BARRE_ID, PROJET_ID, 'Carte d’essai — réponse par la barre', maintenant, maintenant, 'Carte posée par un contrôle automatique.', TACHE_BARRE_ID);
  poserAgent(db, TACHE_BARRE_ID, 'task', CARTE_BARRE_ID, maintenant);
  poserMessage(db, TACHE_BARRE_ID, 'user', { content: 'Carte d’essai : ne rien exécuter.', createdAt: maintenant - 1000 });

  /*
   * LE JOURNAL, TEL QU'IL S'ÉCRIT VRAIMENT : pour chaque question, la trace du
   * PONT à la pose (nom brut, sans résultat), puis celle du MOTEUR à la réponse
   * — et les trois questions se suivent sans rien entre elles.
   */
  const poser = db.prepare(
    `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, outil, params, resultat, reussie, duree_ms, etat, donnees)
     VALUES (?, ?, ?, 'execution', 'requete', ?, ?, 'execution', ?, ?, ?, ?, ?, 1, ?, NULL, NULL)`,
  );
  let rang = 0;
  const debut = maintenant - 600_000;
  const trace = (libelle, outil, params, resultat, duree) => {
    rang += 1;
    poser.run(`${CARTE_ID}-j${rang}`, CARTE_ID, rang, debut + rang * 20_000, TACHE_ID, `${CARTE_ID}-tour`, libelle, outil, params, resultat, duree);
  };
  trace('Bash', 'Bash', JSON.stringify({ command: 'git status' }), 'ok', 100);
  for (const q of QUESTIONS) {
    const params = JSON.stringify(
      { question: q.question, kind: q.kind, options: q.options.map((label) => ({ label })) },
      null,
      2,
    );
    trace('ask_user', 'ask_user', params, null, 1);
    trace(
      'Question posée',
      'mcp__beluga__ask_user',
      params,
      `Réponse de l’utilisateur : ${q.reponse}\nReprends ton travail à partir de cette réponse.`,
      18_000,
    );
  }
  db.close();
}

/** Une commande envoyée au démon par la vraie liaison, et sa réponse. */
function appelDemon(commande) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { cookie: `beluga_session=${JETON}` },
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
/* L'écran                                                             */
/* ------------------------------------------------------------------ */

async function ouvrirUnePage(navigateur, telephone) {
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
    { name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  return { context, page, erreurs };
}

/** 2. Le fil de la carte : trois questions, trois encadrés, chacune SA réponse. */
async function filDeLaCarte(navigateur, telephone) {
  const nom = telephone ? 'téléphone' : 'ordinateur';
  const { context, page, erreurs } = await ouvrirUnePage(navigateur, telephone);
  try {
    /* LA CARTE S'OUVRE PAR SON ADRESSE, jamais à la souris. */
    await page.goto(`${BASE}/#projet/${PROJET_ID}/tache/${CARTE_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    /* LE FIL EST LÀ quand un passage AFFICHÉ l'est : le premier `[data-point]`
       du document est le passage « Configuration », que la discussion garde
       caché (`hidden`) — l'attendre « visible » n'aboutirait jamais. */
    await page.locator('[data-point]:not([hidden])').first().waitFor({ timeout: 30_000 });
    /* UN POINT S'OUVRE S'IL EST FERMÉ : un clic aveugle le refermerait. */
    const point = page.locator('[data-point="travail"]').last();
    for (let essai = 0; essai < 3; essai += 1) {
      if ((await point.getAttribute('data-point-ouvert')) === 'oui') break;
      await point.locator('[data-point-bascule="travail"]').click();
      await page.waitForTimeout(1_200);
    }
    const encadres = page.locator('[data-point-contenu="travail"] [data-encadre="question"]');
    await encadres.first().waitFor({ timeout: 15_000 }).catch(() => {});

    const lus = await encadres.evaluateAll((liste) =>
      liste.map((encadre) => ({
        question: encadre.querySelector('[data-encadre-question]')?.textContent?.trim() ?? '',
        bandeau: encadre.querySelector('[data-encadre-bandeau]')?.textContent ?? '',
        retenues: [...encadre.querySelectorAll('[data-encadre-question-option="retenue"]')].map(
          (option) => option.textContent?.trim() ?? '',
        ),
        complement: encadre.querySelector('[data-encadre-question-complement]')?.textContent?.trim() ?? '',
        sansReponse: !!encadre.querySelector('[data-encadre-question-sans-reponse]'),
      })),
    );
    noter(
      `${nom} : chaque question se lit UNE fois, dans l’ordre où elle a été posée`,
      lus.length === QUESTIONS.length && lus.every((lu, rang) => lu.question === QUESTIONS[rang].question),
      lus.map((lu) => lu.question).join(' | '),
    );
    noter(
      `${nom} : chacune porte SA réponse, marquée comme retenue`,
      lus.length === QUESTIONS.length &&
        lus.every((lu, rang) => JSON.stringify(lu.retenues) === JSON.stringify(QUESTIONS[rang].retenues)),
      lus.map((lu) => lu.retenues.join(' + ')).join(' | '),
    );
    noter(
      `${nom} : aucune réponse ne se lit comme une précision écrite à la main, aucune question « sans réponse »`,
      lus.length > 0 && lus.every((lu) => !lu.complement && !lu.sansReponse),
      lus.map((lu) => lu.complement).filter(Boolean).join(' | '),
    );
    noter(
      `${nom} : l’entête dit « Plusieurs choix » pour la première, « Un seul choix » pour les autres`,
      lus.length === QUESTIONS.length &&
        lus[0].bandeau.includes('Plusieurs choix') &&
        lus.slice(1).every((lu) => lu.bandeau.includes('Un seul choix')),
      lus.map((lu) => lu.bandeau).join(' | '),
    );
    /* LA MARQUE DU « RETENU » : la bordure de l'option retenue n'est pas celle des autres. */
    const couleurs = await page
      .locator('[data-point-contenu="travail"] [data-encadre="question"]')
      .nth(1)
      .evaluate((encadre) => {
        const bord = (attribut) => {
          const el = encadre.querySelector(`[data-encadre-question-option="${attribut}"]`);
          return el ? getComputedStyle(el).borderTopColor : '';
        };
        return { retenue: bord('retenue'), proposee: bord('proposee') };
      })
      .catch(() => ({ retenue: '', proposee: '' }));
    noter(
      `${nom} : l’option retenue se détache des autres par sa couleur`,
      !!couleurs.retenue && couleurs.retenue !== couleurs.proposee,
      `${couleurs.retenue} / ${couleurs.proposee}`,
    );
    noter(`${nom} : aucune erreur dans la page du fil`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await context.close().catch(() => {});
  }
}

/** 3. La barre d'écriture : on coche dans la bulle, on écrit dans la barre — rien ne répond. */
async function barreDEcriture(navigateur, messageId) {
  const { context, page, erreurs } = await ouvrirUnePage(navigateur, false);
  try {
    await page.goto(`${BASE}/#projet/${PROJET_ID}/tache/${CARTE_BARRE_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    const bulle = page.locator('[data-question-agent]').filter({ hasText: QUESTION_DE_LA_BARRE.intitule }).first();
    await bulle.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    const vue = (await bulle.count()) > 0;
    noter('barre : la question en attente est affichée', vue);
    if (!vue) {
      await page.screenshot({ path: path.join(os.tmpdir(), 'verif-questions-enchainees-introuvable.png') });
      return;
    }
    await bulle.scrollIntoViewIfNeeded().catch(() => {});
    await bulle.locator('[data-option-question="o1"]').click();
    const champ = page.locator('[data-composer] textarea').first();
    await champ.click();
    await champ.fill('mais on garde la cloche');
    await page.locator('[data-composer-envoi]').first().click();
    await page.waitForTimeout(2000);
    const question = lireQuestion(messageId);
    noter(
      'barre : un message écrit dans la barre ne répond pas à la question',
      !question?.answer && !question?.cancelled,
      String(question?.answer ?? 'question restée ouverte'),
    );
    noter('barre : aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  /* ---------------- 2 et 3. L'écran ---------------- */
  const messageDeLaCarte = poserQuestionOuverte(TACHE_BARRE_ID);
  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  try {
    for (const telephone of [true, false]) await filDeLaCarte(navigateur, telephone);
    await barreDEcriture(navigateur, messageDeLaCarte);
  } finally {
    await navigateur.close().catch(() => {});
  }

  /* ---------------- 1. Le transport ---------------- */
  /* EN DERNIER : la question ouverte du DERNIER message de l'agent reste ouverte. */
  const porteur = poserQuestionOuverte(CHEF_ID);
  const questionId = lireQuestion(porteur).id;
  const trame = await appelDemon({
    type: 'agent.prompt',
    agentId: CHEF_ID,
    text: 'sauf le week-end',
  });
  noter('transport : le démon accepte un message écrit pendant la question', trame.ok === true, trame.error ?? '');
  noter(
    'transport : la question n’est pas répondue par ce message',
    !lireQuestion(porteur)?.answer,
    String(lireQuestion(porteur)?.answer ?? 'restée ouverte'),
  );

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
