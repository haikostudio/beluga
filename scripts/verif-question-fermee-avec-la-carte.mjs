#!/usr/bin/env node
/**
 * UNE QUESTION D'AGENT S'ANNULE AVEC LA CARTE, ET SON « ANNULER » EST VISIBLE.
 *
 * Deux relevés, du plus profond au plus visible :
 *   1. le DÉMON, par la vraie liaison : une carte déplacée hors du travail
 *      (« À déployer », « Archivé ») ferme d'office ses questions restées
 *      ouvertes — celle de l'outil `ask_user` comme celle écrite en texte
 *      ordinaire — tandis que « En cours » les garde ;
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
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

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

const DOSSIER = path.join(TMP, 'projet');
const { DATA, PROJETS, demon, attendrePort } = demarrerDemonDEssai({
  tmp: TMP,
  port: PORT,
  depot: false,
  dossiers: [DOSSIER],
});
fs.mkdirSync(SHOTS, { recursive: true });

/* ------------------------------------------------------------------ */
/* Le décor : un projet, des cartes, une session                       */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const base = () => new Database(path.join(DATA, 'beluga.db'));

const marque = Date.now();
const QUESTION_OUTIL = `Vérification ${marque} — quelle formule retenir ?`;
/* L'énumération après le deux-points est VOULUE : c'est elle qui doit devenir
   deux pastilles cliquables (`choixDeQuestionEnTexte`). */
const QUESTION_TEXTE = `Vérification ${marque} — quelle mise en page faut-il garder : l’ancienne ou la nouvelle ?`;

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
/* Relevé 1 : le démon                                                 */
/* ------------------------------------------------------------------ */

async function releveDuDemon() {
  // Les trois colonnes qui ferment, chacune avec sa question d'outil.
  for (const colonne of ['to_deploy', 'archived']) {
    const { cardId, messageId } = await carteQuiAttend(`Question puis ${colonne}`, 'running', 'outil');
    await appelDemon({ type: 'card.move', id: cardId, column: colonne });
    const question = lireMessage(messageId)?.questions?.[0];
    noter(`démon : passer en « ${colonne} » ferme la question de l’outil`, question?.cancelled === true);
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
    await appelDemon({ type: 'card.move', id: cardId, column: 'archived' });
    noter(
      'démon : passer en « En production » ferme le choix de reprise de compte',
      lireMessage(messageId)?.repriseCompte?.abandonnee === true,
    );
  }

  {
    const { messageId } = await carteQuiAttend('Reprise née en archive', 'archived', 'reprise');
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
      headers: { cookie: `beluga_session=${JETON}` },
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
    { name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' },
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

    /*
     * LES BOUTONS « RÉPONDRE » ET « ANNULER » NE VIVENT PLUS SUR LA CARTE : ils
     * ont été retirés du tableau, la réponse et la sortie vivant désormais dans
     * la BULLE de la question, à l'intérieur du fil. Le relevé garde donc de la
     * carte ce qui la concerne encore — elle s'ouvre —, et juge la bulle plus
     * bas.
     */
    noter(`${nom} : la carte en attente ne porte plus de bouton « Répondre »`, (await carte.locator('[data-repondre-carte]').count()) === 0);
    await page.screenshot({ path: `${SHOTS}/question-carte-${nom}.png`, fullPage: true });

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
      /* DANS QUELLE COLONNE la carte est-elle posée ? On remonte depuis la
         carte elle-même (`closest`), comme le fait le tableau : viser d'abord
         la colonne puis la carte dépend d'une mise en page qui n'est pas la
         même sur téléphone et sur ordinateur. */
      const colonneDeLaCarte = () =>
        carteDuTableau(page, titreVivant)
          .evaluate((el) => el.closest('[data-column]')?.getAttribute('data-column') ?? null)
          .catch(() => null);
      const avant = await colonneDeLaCarte();
      noter(`${nom} : ${etiquette} montre bien sa carte sur le tableau`, !!avant, `colonne lue : ${avant}`);

      await appelDemon({ type: 'card.move', id: cardId, column: 'archived' });
      await page.waitForTimeout(3000);
      const apres = await colonneDeLaCarte();
      /* « Archivé » n'est plus une colonne du tableau : rangée sous les yeux,
         la carte QUITTE le tableau. Elle n'est pas perdue pour autant — le
         tiroir « Archives » la retrouve, et c'est ce qu'on vérifie ensuite. */
      noter(
        `${nom} : rangée sous les yeux, ${etiquette} quitte le tableau sans rechargement`,
        apres === null,
        `colonne lue : ${apres}`,
      );
      await page.click('[data-menu-colonne="to_deploy"]');
      await page.waitForTimeout(600);
      await page.click('[data-ouvrir-archives]');
      await page.waitForTimeout(1500);
      const dansLesArchives = await page.evaluate(
        (titre) => !!document.querySelector('[data-liste-archives]')?.textContent?.includes(titre),
        titreVivant,
      );
      noter(`${nom} : et elle se retrouve dans le tiroir « Archives »`, dansLesArchives);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
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
      /* Le tiroir s'ouvre en cliquant la carte elle-même : elle n'a plus de
         bouton « Répondre » à viser. */
      await carteTexte.click({ force: true });
      await page.waitForTimeout(4000);

      const bulle = page.locator('[data-question-en-texte]').first();
      await bulle.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
      noter(`${nom} : la question en texte ordinaire porte sa propre bulle`, (await bulle.count()) === 1);
      const sortie = bulle.locator('[data-annuler-question]');
      noter(
        `${nom} : son « Annuler » est DANS la bulle, et visible`,
        (await sortie.count()) === 1 && (await sortie.first().isVisible().catch(() => false)),
      );
      /*
       * LA RÉPONSE SE TAPE DANS LA BULLE. Le bloc se contentait de renvoyer à
       * la barre d'écriture (« écrivez-la ci-dessous ») : un écriteau sans
       * champ. Il porte désormais son propre champ et son bouton « Répondre ».
       */
      const champ = bulle.locator('[data-champ-reponse-question]');
      noter(
        `${nom} : le champ de réponse est DANS la bulle`,
        (await champ.count()) === 1 && (await champ.first().isVisible().catch(() => false)),
      );
      const boutonRepondre = bulle.locator('[data-repondre-question]');
      noter(
        `${nom} : la bulle porte son bouton « Répondre »`,
        (await boutonRepondre.count()) === 1,
      );
      /*
       * UNE SEULE FAÇON DE POSER UNE QUESTION : les choix énumérés dans la
       * phrase de l'agent deviennent des pastilles cliquables, exactement comme
       * ceux d'une question de l'outil. Le champ libre reste à côté, les choix
       * étant DEVINÉS et non déclarés.
       */
      const pastilles = bulle.locator('[data-option-question]');
      noter(
        `${nom} : les choix de la phrase s'affichent en pastilles`,
        (await pastilles.count()) === 2,
        `pastilles trouvées : ${await pastilles.count()}`,
      );
      noter(
        `${nom} : plus aucun renvoi « écrivez-la ci-dessous »`,
        !((await bulle.innerText().catch(() => '')) || '').includes('ci-dessous'),
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
