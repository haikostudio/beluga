#!/usr/bin/env node
/**
 * Joindre une IMAGE à la réponse d'une question posée par un agent.
 *
 * Deux relevés, du plus profond au plus visible :
 *   1. le TRANSPORT, par une vraie liaison au démon : une réponse envoyée avec
 *      des images retient leurs identifiants sur la question ;
 *   2. l'ÉCRAN, dans un vrai navigateur, sur téléphone puis sur ordinateur :
 *      bouton, collage, glisser-déposer, vignette retirable, refus d'un fichier
 *      qui n'est pas une image, et réponse déjà donnée qui montre son image.
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve : le
 * démon de production n'est pas touché, et il tourne sur le code qui vient
 * d'être construit — pas sur la version publiée.
 *
 * Aucun tour d'agent n'est lancé, donc aucun quota dépensé : la question du
 * relevé 1 est posée sous un agent qui n'existe pas (le démon range la réponse,
 * puis ne trouve personne à relancer), et le clic « Répondre » du relevé 2 est
 * retenu dans la page.
 *
 *   npm run build && node scripts/verif-image-reponse-question.mjs
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
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7191);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = `${RACINE}/data/verification`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-image-reponse-'));

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

/* ------------------------------------------------------------------ */
/* Le décor : un projet, une conversation, une session                 */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const AGENT_ID = 'a-essai';
const base = () => new Database(path.join(DATA, 'haikodev.db'));

const marque = Date.now();
const TEXTES = {
  transport: `Vérification ${marque} — transport des images`,
  enAttente: `Vérification ${marque} — que voyez-vous sur cette capture ?`,
  longueTelephone: `Vérification ${marque} — choix long sur téléphone`,
  longueOrdinateur: `Vérification ${marque} — choix long sur ordinateur`,
  sansReponseTelephone: `Vérification ${marque} — aucune réponse possible sur téléphone`,
  sansReponseOrdinateur: `Vérification ${marque} — aucune réponse possible sur ordinateur`,
  reponse: `Vérification ${marque} — voici la capture`,
  reponseLongue: `Vérification-${marque}-${'sans-espace-'.repeat(80)}`,
  reprise: `Vérification ${marque} — le tour a été coupé par la limite du compte`,
};

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(JETON),
    maintenant,
    maintenant + 3600_000,
    'vérification image en réponse',
  );

  // Plafond d'agents à ZÉRO : rien ne peut démarrer tout seul dans le dos.
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai image en réponse',
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

  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    role: 'cadrage',
    title: 'Chef d’orchestre',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(agent.id, PROJET_ID, 'cadrage', 'idle', JSON.stringify(agent), maintenant, maintenant);
  db.close();
}

function poserQuestion(agentId, question) {
  const db = base();
  const id = crypto.randomUUID();
  const message = {
    id,
    agentId,
    role: 'assistant',
    content: 'Question posée par le script de vérification.',
    steps: [],
    todos: [],
    proposals: [],
    questions: [question],
    downloads: [],
    attachments: [],
    streaming: false,
    createdAt: Date.now(),
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    agentId,
    'assistant',
    JSON.stringify(message),
    message.createdAt,
  );
  db.close();
  return id;
}

/**
 * UNE BULLE DE REPRISE DE COMPTE, restée sans choix. C'était la SEULE bulle
 * jaune du fil à n'offrir aucune sortie : quand plus aucun compte ne revenait,
 * elle restait allumée à vie et gardait « Répondre » sur sa carte.
 */
function poserRepriseDeCompte(agentId) {
  const db = base();
  const id = crypto.randomUUID();
  const message = {
    id,
    agentId,
    role: 'assistant',
    content: TEXTES.reprise,
    steps: [],
    todos: [],
    proposals: [],
    questions: [],
    repriseCompte: {
      engine: 'claude',
      compteEpuise: 'compte-essai',
      compteEpuiseLabel: 'Compte d’essai',
      motif: 'limite-structuree',
      at: Date.now(),
    },
    downloads: [],
    attachments: [],
    streaming: false,
    createdAt: Date.now(),
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    agentId,
    'assistant',
    JSON.stringify(message),
    message.createdAt,
  );
  db.close();
  return id;
}

function lireQuestion(messageId) {
  const db = base();
  const ligne = db.prepare('SELECT data FROM messages WHERE id = ?').get(messageId);
  db.close();
  return ligne ? JSON.parse(ligne.data).questions[0] : null;
}

/** Une petite image PNG bien réelle, rendue unique (le serveur dédoublonne). */
function fabriqueImage(nom) {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAP0lEQVR42u3OMQEAAAgDoC252H0M' +
      'Ywm4mUryJgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgWQ0YMAAB8W8LqQAAAABJRU5ErkJggg==',
    'base64',
  );
  const fichier = path.join(TMP, nom);
  fs.writeFileSync(fichier, Buffer.concat([png, crypto.randomBytes(8)]));
  return fichier;
}

/** Envoyer une image au démon comme le ferait la page, et rendre son identifiant. */
async function envoyerImage(fichier) {
  const reponse = await fetch(`${BASE}/api/upload?project=${PROJET_ID}`, {
    method: 'POST',
    headers: {
      cookie: `haikodev_session=${JETON}`,
      'content-type': 'image/png',
      'x-file-name': encodeURIComponent(path.basename(fichier)),
    },
    body: fs.readFileSync(fichier),
  });
  const data = await reponse.json();
  return data.attachment?.id ?? null;
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
/* L'écran                                                             */
/* ------------------------------------------------------------------ */

/** Le bloc de la question, reconnu par son rôle stable puis par son texte. */
const blocQuestion = (page, texte) =>
  page.locator('[data-question-agent]').filter({ hasText: texte }).first();

const vignettes = (bloc) => bloc.locator('[data-images-reponse] img').count();

async function ecran(navigateur, telephone) {
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
  // La synthèse vocale est volontairement absente du démon isolé : son 503 ne
  // concerne ni la question ni son rendu. Les autres échecs réseau restent vus
  // par le relevé de réponse ci-dessous.
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
    if (telephone) {
      // Sur téléphone, la conversation du chef vit derrière son onglet.
      const ongletChef = page.getByRole('button', { name: /Chef/ }).first();
      if (await ongletChef.count()) {
        await ongletChef.click({ force: true });
        await page.waitForTimeout(2500);
      }
    }

    const bloc = blocQuestion(page, TEXTES.enAttente);
    // Le premier écran peut ouvrir la liaison pendant que le démon achève son
    // instantané initial : on attend la question au lieu de juger cet instant.
    await bloc.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    const vue = (await bloc.count()) > 0;
    noter(`${nom} : la question en attente est affichée`, vue);
    if (!vue) {
      await page.screenshot({ path: `${SHOTS}/reponse-image-${nom}-introuvable.png` });
      return { erreurs };
    }
    await bloc.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);

    /* ---- 0. Une question sans réponse possible peut toujours être quittée ---- */
    const texteSansReponse = telephone ? TEXTES.sansReponseTelephone : TEXTES.sansReponseOrdinateur;
    const sansReponse = blocQuestion(page, texteSansReponse);
    await sansReponse.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    noter(`${nom} : une question sans réponse montre Annuler`, (await sansReponse.getByRole('button', { name: 'Annuler' }).count()) === 1);
    noter(`${nom} : aucun champ de réponse ne paraît dans ce cas`, (await sansReponse.locator('textarea, input[data-champ-image]').count()) === 0);
    // Seule issue de la bulle : le bouton prend toute sa largeur, il ne se
    // cache pas en petit lien dans un coin.
    const pleineLargeur = await sansReponse
      .locator('[data-annuler-question]')
      .evaluate((bouton) => {
        const actions = bouton.closest('[data-actions-question]');
        if (!actions) return false;
        const b = bouton.getBoundingClientRect();
        const a = actions.getBoundingClientRect();
        return b.width > 0 && b.width >= a.width - 24;
      })
      .catch(() => false);
    noter(`${nom} : le bouton Annuler prend toute la largeur de la bulle`, pleineLargeur);
    await sansReponse.getByRole('button', { name: 'Annuler' }).click({ force: true });
    await sansReponse.getByText('Question annulée').waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    noter(`${nom} : Annuler permet de sortir de la question`, (await sansReponse.getByText('Question annulée').count()) === 1);

    /* ---- 1. Les issues d'une longue question restent à portée ---- */
    const texteLong = telephone ? TEXTES.longueTelephone : TEXTES.longueOrdinateur;
    const longue = blocQuestion(page, texteLong);
    await longue.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    const premiereOption = longue.getByRole('button', { name: /Option 1 —/ }).first();
    await premiereOption.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);
    const actionsVisibles = await longue.locator('[data-actions-question]').evaluate((actions) => {
      const fil = actions.closest('[data-fil="conversation"]');
      if (!fil) return false;
      const a = actions.getBoundingClientRect();
      const f = fil.getBoundingClientRect();
      return a.top >= f.top && a.bottom <= f.bottom;
    }).catch(() => false);
    noter(`${nom} : les options de la question sont visibles`, await premiereOption.isVisible().catch(() => false));
    noter(`${nom} : répondre et annuler restent visibles pendant la lecture`, actionsVisibles);
    await premiereOption.click({ force: true });
    const repondreLongue = longue.getByRole('button', { name: 'Répondre' }).first();
    noter(`${nom} : choisir une option permet de répondre`, await repondreLongue.isEnabled());
    await longue.getByRole('button', { name: 'Annuler' }).click({ force: true });
    await longue.getByText('Question annulée').waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    noter(
      `${nom} : annuler ferme la question sans blocage`,
      (await longue.getByText('Question annulée').count()) === 1,
    );

    /* ---- 1. Le bouton de sélection de fichier ---- */
    await bloc.locator('input[data-champ-image]').setInputFiles(fabriqueImage(`bouton-${nom}.png`));
    await page.waitForTimeout(2500);
    noter(`${nom} : le bouton joint une image, affichée en vignette`, (await vignettes(bloc)) === 1);
    await page.screenshot({ path: `${SHOTS}/reponse-image-${nom}-vignette.png` });

    /* ---- 2. Une image se retire avant l'envoi ---- */
    await bloc.locator('button[title="Retirer cette image"]').first().click({ force: true });
    await page.waitForTimeout(800);
    noter(`${nom} : la croix retire l'image jointe`, (await vignettes(bloc)) === 0);

    /* ---- 3. Le collage depuis le presse-papiers ---- */
    /* La bulle n'a plus de champ d'écriture à elle — la réponse écrite se tape
       dans la barre de la conversation. Une image collée se dépose donc sur le
       BLOC de la question. */
    const colle = [...fs.readFileSync(fabriqueImage(`collage-${nom}.png`))];
    await bloc.evaluate((node, octets) => {
      const transfert = new DataTransfer();
      transfert.items.add(new File([new Uint8Array(octets)], 'collage.png', { type: 'image/png' }));
      node.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfert }),
      );
    }, colle);
    await page.waitForTimeout(2500);
    noter(`${nom} : une image collée dans le champ se joint à la réponse`, (await vignettes(bloc)) === 1);

    /* ---- 4. Le glisser-déposer sur le bloc ---- */
    const lachee = [...fs.readFileSync(fabriqueImage(`depot-${nom}.png`))];
    await bloc.evaluate((node, octets) => {
      const transfert = new DataTransfer();
      transfert.items.add(new File([new Uint8Array(octets)], 'depot.png', { type: 'image/png' }));
      for (const genre of ['dragover', 'drop']) {
        node.dispatchEvent(new DragEvent(genre, { bubbles: true, cancelable: true, dataTransfer: transfert }));
      }
    }, lachee);
    await page.waitForTimeout(2500);
    noter(`${nom} : une image lâchée sur la question se joint aussi`, (await vignettes(bloc)) === 2);

    /* ---- 5. Un fichier qui n'est pas une image est refusé, et le dit ---- */
    await bloc.evaluate((node) => {
      const transfert = new DataTransfer();
      transfert.items.add(new File(['des notes'], 'notes.txt', { type: 'text/plain' }));
      for (const genre of ['dragover', 'drop']) {
        node.dispatchEvent(new DragEvent(genre, { bubbles: true, cancelable: true, dataTransfer: transfert }));
      }
    });
    await page.waitForTimeout(1500);
    const refus = await page.getByText(/Seules les images/i).count();
    noter(
      `${nom} : un fichier qui n'est pas une image est refusé, et le refus se dit`,
      (await vignettes(bloc)) === 2 && refus > 0,
      refus ? '' : 'aucun message de refus',
    );

    /* ---- 6. Une image seule suffit à répondre ---- */
    const repondre = bloc.getByRole('button', { name: 'Répondre' }).first();
    noter(`${nom} : le bouton « Répondre » s'allume avec une image seule`, await repondre.isEnabled());

    /* ---- 7. Ce qui part avec la réponse : le texte ET les images ---- */
    await page.evaluate(() => {
      // La trame est RETENUE, pas envoyée : aucun tour d'agent ne doit partir.
      window.__trames = [];
      const envoi = WebSocket.prototype.send;
      WebSocket.prototype.send = function (donnee) {
        if (typeof donnee === 'string' && donnee.includes('question.answer')) {
          window.__trames.push(donnee);
          return;
        }
        return envoi.call(this, donnee);
      };
    });
    await repondre.click({ force: true });
    await page.waitForTimeout(1500);
    const trames = await page.evaluate(() => window.__trames ?? []);
    const partie = trames.length ? JSON.parse(trames[0]).cmd : null;
    noter(
      `${nom} : la réponse part avec ses deux images`,
      partie?.attachments?.length === 2 && /2 images jointes/.test(partie.answer ?? ''),
      partie ? `« ${partie.answer} » + ${partie.attachments?.length ?? 0} image(s)` : 'aucune trame',
    );

    /* ---- 8. Une réponse déjà donnée montre son image ---- */
    const donnee = page
      .getByText(TEXTES.reponse)
      .first()
      .locator('xpath=ancestor::div[contains(@class,"bg-surface/60")][1]');
    if (await donnee.count()) {
      await donnee.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(1500);
      noter(`${nom} : la réponse déjà donnée montre son image`, (await donnee.locator('img').count()) > 0);
      const troncature = await donnee.locator('[data-reponse-question]').evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          contenuEntier: element.textContent?.length ?? 0,
          deborde: element.scrollWidth > element.clientWidth,
          ellipse: style.textOverflow === 'ellipsis',
          uneLigne: style.whiteSpace === 'nowrap',
        };
      });
      noter(
        `${nom} : une réponse longue reste dans sa carte et se termine par des points`,
        troncature.contenuEntier === TEXTES.reponseLongue.length &&
          troncature.deborde &&
          troncature.ellipse &&
          troncature.uneLigne,
        JSON.stringify(troncature),
      );
      await page.screenshot({ path: `${SHOTS}/reponse-image-${nom}-donnee.png` });
    } else {
      noter(`${nom} : la réponse déjà donnée montre son image`, false, 'bloc introuvable');
    }

    /* ---- 9. TOUTE bulle jaune du fil porte sa sortie ---- */
    const reprise = page.locator('[data-reprise-compte="attente"]').first();
    await reprise.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(800);
    const sortieReprise = reprise.locator('[data-annuler-reprise]');
    noter(`${nom} : la bulle de reprise de compte est affichée`, (await reprise.count()) === 1);
    noter(
      `${nom} : elle porte son Annuler À L'INTÉRIEUR de la bulle`,
      (await sortieReprise.count()) === 1 && (await sortieReprise.first().isVisible().catch(() => false)),
    );
    /*
     * LA FORME SUIT L'ÉTAT, PAS LA MISE EN PAGE. Ce démon d'essai voit les
     * comptes réellement configurés sur la machine : on ne peut donc pas
     * décider d'avance si un compte sera proposé. On lit l'ÉTAT — y a-t-il un
     * compte à cliquer ? — et on en déduit la forme attendue : seule issue,
     * « Annuler » prend toute la largeur ; sinon il reste discret à côté des
     * comptes proposés.
     */
    const comptesProposes = await reprise.locator('[data-compte-reprise]').count();
    const largeurReprise = await sortieReprise
      .evaluate((bouton) => {
        const bulle = bouton.closest('[data-reprise-compte]');
        if (!bulle) return null;
        const b = bouton.getBoundingClientRect();
        const a = bulle.getBoundingClientRect();
        return { bouton: Math.round(b.width), bulle: Math.round(a.width) };
      })
      .catch(() => null);
    const pleine = !!largeurReprise && largeurReprise.bouton >= largeurReprise.bulle - 32;
    noter(
      comptesProposes
        ? `${nom} : avec des comptes proposés, la sortie reste discrète`
        : `${nom} : seule issue, la sortie prend toute la largeur de la bulle`,
      comptesProposes ? !pleine && !!largeurReprise && largeurReprise.bouton > 0 : pleine,
      `${comptesProposes} compte(s) proposé(s), ${JSON.stringify(largeurReprise)}`,
    );

    return { erreurs };
  } finally {
    await context.close();
  }
}

/* ------------------------------------------------------------------ */

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  if (!(await attendrePort())) {
    console.error(`Le démon d'essai n'a pas démarré :\n${journal.join('')}`);
    process.exit(1);
  }
  poserLeDecor();
  // La session et le projet sont écrits sous le démon : il relit sa base à
  // chaque commande, mais l'écran, lui, part d'un instantané au chargement.
  await new Promise((r) => setTimeout(r, 1500));

  const imageId = await envoyerImage(fabriqueImage('reponse-donnee.png'));
  noter('une image peut être envoyée au démon', !!imageId, imageId ?? '');

  /* ---------------- 1. Le transport ---------------- */
  const fantome = poserQuestion(`agent-inexistant-${marque}`, {
    id: crypto.randomUUID(),
    question: TEXTES.transport,
    kind: 'text',
    options: [],
    allowFreeText: true,
    answerAttachments: [],
  });
  const question = lireQuestion(fantome);
  const trame = await appelDemon({
    type: 'question.answer',
    messageId: fantome,
    questionId: question.id,
    answer: '1 image jointe',
    attachments: [imageId],
  });
  noter('le démon accepte une réponse portant des images', trame.ok === true, trame.error ?? '');
  const range = lireQuestion(fantome);
  noter(
    'la question retient les images de sa réponse',
    range?.answerAttachments?.length === 1 && range.answerAttachments[0] === imageId,
    JSON.stringify(range?.answerAttachments ?? []),
  );

  /* ---------------- 2. L'écran ---------------- */
  poserQuestion(AGENT_ID, {
    id: crypto.randomUUID(),
    question: TEXTES.enAttente,
    kind: 'text',
    options: [],
    allowFreeText: true,
    answerAttachments: [],
  });
  for (const question of [TEXTES.sansReponseTelephone, TEXTES.sansReponseOrdinateur]) {
    poserQuestion(AGENT_ID, {
      id: crypto.randomUUID(),
      question,
      kind: 'text',
      options: [],
      allowFreeText: false,
      answerAttachments: [],
    });
  }
  for (const question of [TEXTES.longueTelephone, TEXTES.longueOrdinateur]) {
    poserQuestion(AGENT_ID, {
      id: crypto.randomUUID(),
      question,
      kind: 'single',
      options: Array.from({ length: 12 }, (_, index) => ({
        id: `option-${index + 1}`,
        label: `Option ${index + 1} — choix proposé à l'utilisateur`,
        description: 'Une explication assez longue pour donner à la question la hauteur d’un écran.',
      })),
      allowFreeText: true,
      answerAttachments: [],
    });
  }
  poserQuestion(AGENT_ID, {
    id: crypto.randomUUID(),
    question: TEXTES.reponse,
    kind: 'text',
    options: [],
    allowFreeText: true,
    answer: TEXTES.reponseLongue,
    answerAttachments: [imageId],
    answeredAt: Date.now(),
  });
  // La bulle jaune qui n'avait AUCUNE sortie. Elle n'est pas refermée par le
  // relevé : les deux écrans doivent la trouver telle quelle.
  poserRepriseDeCompte(AGENT_ID);

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  try {
    for (const telephone of [true, false]) {
      const { erreurs } = await ecran(navigateur, telephone);
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
