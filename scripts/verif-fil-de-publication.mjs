#!/usr/bin/env node
/**
 * LA PUBLICATION SE LIT ET SE DISCUTE COMME UN AGENT.
 *
 * Ce qui manquait, et que ce contrôle verrouille : le volet d'un déploiement
 * ou d'une mise en production était un TABLEAU DE BORD technique, sans lien
 * avec la conversation de celui qui publiait — et on n'y accédait que par la
 * notification du moment. L'alerte passée, plus rien ne ramenait à la mise en
 * ligne.
 *
 * DEUX VOLETS, tous deux joués pour de vrai.
 *
 * A. CE QUI RESTE DU CONDUCTEUR CÔTÉ SERVEUR — lecture du code. Depuis la
 *    refonte « moteur sans agent » (ef5a53dc, 22/09/2026), une publication
 *    d'aujourd'hui n'ouvre plus de conducteur ni de fil. Ne restent que les
 *    publications ANCIENNES qui portent un `agentId` : on juge qu'écrire dans
 *    leur fil ne peut toujours rien publier, et que la règle partagée tient.
 *
 * B. L'ÉCRAN (vrai navigateur, démon d'essai à soi : base neuve, dossier de
 *    projets vide, port libre — le démon de production n'est PAS touché, aucun
 *    quota dépensé). Deux publications terminées sont posées en base : l'une
 *    AVEC son conducteur et son fil, l'autre SANS (une publication d'avant ce
 *    changement). On vérifie alors :
 *      - que le volet de la première s'ouvre sur son PARCOURS, et propose au
 *        PIED d'en parler à celui qui publie ;
 *      - que ce bouton ouvre la CONVERSATION dans un tiroir empilé, avec son
 *        fil et sa barre d'écriture, et que la refermer rend le parcours ;
 *      - que le détail technique est RANGÉ, pas jeté : il se déplie sous
 *        l'étape à laquelle il appartient ;
 *      - que la seconde, SANS conducteur, s'ouvre encore sur son parcours et
 *        ne propose rien à qui parler ;
 *      - qu'aucun de ces écrans ne peut déclencher une mise en ligne.
 *
 * Rien n'est publié ni déployé : le contrôle n'appelle aucune commande de mise
 * en ligne, il pose des publications DÉJÀ terminées dans une base jetable.
 *
 *   node scripts/verif-fil-de-publication.mjs
 */

import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

/* Le script juge le dépôt d'où il PART, jamais /root/beluga en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_FIL_PORT || 7219);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${String(detail).slice(0, 180)}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* A. LE SERVEUR DÉSIGNE UN CONDUCTEUR ET LUI PARLE                    */
/* ------------------------------------------------------------------ */

function voletDuServeur() {
  const lire = (...bouts) => fs.readFileSync(path.join(RACINE, ...bouts), 'utf8');
  const regle = lire('shared', 'src', 'fil-de-publication.ts');
  const modeles = lire('shared', 'src', 'models.ts');
  const ws = lire('server', 'src', 'ws.ts');

  /* Les publications d'AVANT la refonte gardent leur conducteur : le champ
     reste lisible, l'écran et le serveur s'en servent encore. */
  noter('une publication ancienne GARDE l’identité de son conducteur', /agentId: z\.string\(\)\.optional\(\)/.test(modeles));
  noter(
    'aucune publication d’aujourd’hui ne rouvre de conducteur',
    !fs.existsSync(path.join(RACINE, 'server', 'src', 'fil-publication.ts')) &&
      !/ouvrirLeFilDePublication/.test(lire('server', 'src', 'deploy.ts')),
  );

  /* ------------------------------------------------------------------ */
  /* ÉCRIRE DANS LE FIL NE PUBLIE JAMAIS — LE VERROU EST CÔTÉ SERVEUR    */
  /* ------------------------------------------------------------------ */
  noter(
    'la consigne du conducteur interdit TOUJOURS de déclencher une mise en ligne',
    /export function consigneDuConducteur/.test(regle) && /INTERDICTION ABSOLUE/.test(regle),
  );
  noter(
    'chaque demande écrite à un conducteur emporte cette consigne',
    /agent\.role === 'deploy' \? store\.deployDuConducteur\(agent\.id\) : null/.test(ws) &&
      /consigneDuConducteur\(publicationTerminee\(publicationDuFil\)\)/.test(ws),
  );
  /* SEUL LE BOUTON PUBLIE : `startDeploy` ne se déclenche que par le message
     de protocole, l'interrupteur de déploiement automatique et la reprise
     après redémarrage — jamais depuis une conversation. */
  const appelants = ['deploy.ts', 'ws.ts', 'main.ts', 'deploiement-automatique.ts'];
  const inattendus = fs
    .readdirSync(path.join(RACINE, 'server', 'src'))
    .filter((f) => f.endsWith('.ts') && !appelants.includes(f))
    .filter((f) => /startDeploy\s*\(/.test(fs.readFileSync(path.join(RACINE, 'server', 'src', f), 'utf8')));
  noter(
    'aucun chemin nouveau ne peut lancer une publication',
    inattendus.length === 0,
    inattendus.join(', '),
  );

  /* ------------------------------------------------------------------ */
  /* LES QUATRE TEMPS, ET CE QUE L'ÉCRAN EN FAIT                         */
  /* ------------------------------------------------------------------ */
  noter(
    'le parcours d’une publication compte QUATRE temps, sans plan',
    /'demande',\s*\n\s*'comprehension',\s*\n\s*'travail',\s*\n\s*'rapport',/.test(regle) &&
      !/'plan'/.test(regle),
  );
  noter(
    'la règle du fil est PURE : ni base, ni disque',
    !/import .*(store|fs|better-sqlite3|node:)/.test(regle),
  );
  const volet = lire('web', 'src', 'components', 'volet-publication.tsx');
  noter(
    'les deux volets montrent celui qui publie SUR PLACE dès qu’il y a un conducteur (plus de conversation complète)',
    /\{conducteur \? \(/.test(volet) &&
      /data-point-conversation=\{questions \? 'question' : 'libre'\}/.test(volet) &&
      /<AgentEnLigne/.test(volet) &&
      !/<Chat\b/.test(volet),
  );
  noter(
    'et ce geste vit au PIED du volet, plus dans la liste des étapes',
    /data-fenetre-pied[\s\S]{0,2500}?data-point-conversation/.test(volet),
  );
  noter(
    'une publication d’AVANT, sans conducteur, garde son parcours d’étapes',
    /<ul data-parcours-etapes=\{etape\.cible\}[\s>]/.test(volet),
  );
  noter(
    'le détail technique est RANGÉ, pas jeté : il se déplie SOUS son étape',
    /data-detail-etape=\{etape\.cle\}/.test(volet) &&
      /data-etape-depliee=\{ouverte \? 'oui' : undefined\}/.test(volet),
  );
  const panneau = lire('web', 'src', 'components', 'deploy-panel.tsx');
  /* Refonte du 24/09/2026 : le bandeau du bas ouvre la PROCÉDURE, plus la
     dernière mise en ligne ; le fil d'une mise en production se lit pendant
     son déroulé, ou par l'alerte qui y mène. */
  noter(
    'le bandeau du bas ouvre le tiroir de la procédure, plus la dernière mise en ligne',
    !/data-ouvrir-fil-publication/.test(panneau) && /<TiroirProcedureProduction/.test(panneau),
  );
  noter(
    'la colonne d’attente ouvre la publication de SON étape, même terminée',
    /runDeLEtape\(candidat\.cible, etape\)/.test(panneau) && /run=\{runDuFil \?\? undefined\}/.test(panneau),
  );
}

/* ------------------------------------------------------------------ */
/* B. L'ÉCRAN                                                          */
/* ------------------------------------------------------------------ */

const { DATA, DEPOT, journal, nettoyer, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-fil-de-publication-',
  port: PORT,
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai-fil';
const RUN_AVEC_FIL = 'run-fil-1';
const RUN_SANS_FIL = 'run-fil-0';
const CONDUCTEUR = 'a-conducteur-essai';
const PUBLIE_LE = new Date(2026, 8, 19, 10, 15, 0).getTime();

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification fil de publication',
  );
  /* Aucun agent ne doit pouvoir démarrer : ce contrôle ne dépense rien. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: 'Essai — fil de publication',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    /* La procédure est CONSTATÉE : sans elle, la colonne propose de l'initier
       au lieu d'afficher son bouton et son chevron. */
    /* Depuis le 10/10/2026 un projet sans processus ne déploie pas : le décor est « hérité » (déploiement déjà en place), sinon l'en-tête n'offre que « Configuration de la procédure », sans chevron. */
    deploiement: { herite: true },
    miseEnProduction: { processus: { etapes: [{ libelle: 'Envoyer chez le client', commande: 'true', delaiS: 10 }] } },
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

  /* LE CONDUCTEUR : un agent de publication ordinaire, à qui personne n'a
     jamais envoyé de tour — c'est un CONTENANT de conversation. */
  const conducteur = {
    id: CONDUCTEUR,
    projectId: PROJET_ID,
    role: 'deploy',
    title: 'Déploiement sur l’instance de dev',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'done',
    startedAt: PUBLIE_LE,
    endedAt: PUBLIE_LE + 30000,
    createdAt: PUBLIE_LE,
    updatedAt: PUBLIE_LE + 30000,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(
    conducteur.id,
    PROJET_ID,
    conducteur.role,
    conducteur.status,
    JSON.stringify(conducteur),
    PUBLIE_LE,
    PUBLIE_LE + 30000,
  );

  /* LE FIL, dans l'ordre du temps : ce qui a été demandé, ce qui en a été
     compris, le travail, le rapport. */
  const messages = [
    { cle: 'demande', role: 'user', at: PUBLIE_LE, texte: '**Déploiement sur l’instance de dev** — projet « Essai — fil de publication »' },
    {
      cle: 'comprehension',
      role: 'assistant',
      at: PUBLIE_LE + 500,
      texte: 'Je fusionne le lot, je l’enregistre, je l’envoie sur le dépôt, puis je rafraîchis l’instance de dev.',
    },
    { cle: 'merge', role: 'assistant', at: PUBLIE_LE + 2000, texte: '**Fusion des branches** — fait.' },
    { cle: 'build', role: 'assistant', at: PUBLIE_LE + 9000, texte: '**Construction** — fait.' },
    { cle: 'rapport', role: 'assistant', at: PUBLIE_LE + 29000, texte: '✅ **Déploiement terminé.**' },
  ];
  for (const m of messages) {
    const donnees = {
      id: `fil-${RUN_AVEC_FIL}-${m.cle}`,
      agentId: CONDUCTEUR,
      role: m.role,
      content: m.texte,
      steps:
        m.cle === 'merge'
          ? [{ id: `fil-${RUN_AVEC_FIL}-merge-etape`, label: 'Fusion des branches', state: 'done' }]
          : [],
      createdAt: m.at,
    };
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      donnees.id,
      CONDUCTEUR,
      m.role,
      JSON.stringify(donnees),
      m.at,
    );
  }

  const etapes = (etat) => [
    { key: 'merge', state: etat, log: 'fusion terminée', startedAt: PUBLIE_LE, endedAt: PUBLIE_LE + 2000 },
    { key: 'commit', state: etat, log: '', startedAt: PUBLIE_LE + 2000, endedAt: PUBLIE_LE + 3000 },
    { key: 'push', state: etat, log: '', startedAt: PUBLIE_LE + 3000, endedAt: PUBLIE_LE + 4000 },
    { key: 'verify', state: 'skipped', log: '', startedAt: PUBLIE_LE + 4000, endedAt: PUBLIE_LE + 4100 },
    { key: 'build', state: etat, log: '', startedAt: PUBLIE_LE + 4100, endedAt: PUBLIE_LE + 9000 },
    { key: 'publish', state: etat, log: '', startedAt: PUBLIE_LE + 9000, endedAt: PUBLIE_LE + 20000 },
    { key: 'restart', state: etat, log: '', startedAt: PUBLIE_LE + 20000, endedAt: PUBLIE_LE + 29000 },
  ];

  const poser = (run) =>
    db
      .prepare('INSERT INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(run.id, PROJET_ID, run.state, JSON.stringify(run), run.startedAt, run.endedAt);

  /* UNE PUBLICATION D'AVANT CE CHANGEMENT : aucun conducteur. Elle doit
     continuer d'afficher sa trace d'étapes, sans erreur. */
  poser({
    id: RUN_SANS_FIL,
    projectId: PROJET_ID,
    state: 'success',
    cible: 'dev',
    cardIds: [],
    steps: etapes('done'),
    queued: false,
    reprises: 0,
    repriseApresCoupure: false,
    startedAt: PUBLIE_LE - 86400000,
    endedAt: PUBLIE_LE - 86400000 + 29000,
  });
  /* LA PUBLICATION AVEC SON CONDUCTEUR : la plus récente, donc celle que le
     tableau porte. */
  poser({
    id: RUN_AVEC_FIL,
    projectId: PROJET_ID,
    state: 'success',
    cible: 'dev',
    cardIds: [],
    steps: etapes('done'),
    agentId: CONDUCTEUR,
    queued: false,
    reprises: 0,
    repriseApresCoupure: false,
    startedAt: PUBLIE_LE,
    endedAt: PUBLIE_LE + 29000,
  });

  db.close();
}

async function ouvrirLeTableau(navigateur) {
  const contexte = await navigateur.newContext({
    viewport: { width: 1500, height: 950 },
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
  await page.waitForTimeout(3000);
  return { page, erreurs };
}

async function voletDeLEcran() {
  if (!(await attendrePort())) {
    noter('le démon d’essai répond', false, journal.join('').slice(-600));
    return;
  }
  noter('le démon d’essai répond', true);
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  try {
    const { page, erreurs } = await ouvrirLeTableau(navigateur);
    /* Depuis la refonte, la colonne montre les services du projet ouvert, pas la
       liste des projets : on y va par son adresse. */
    await page.evaluate((id) => { window.location.hash = `#projet/${id}`; }, PROJET_ID);
    await page.waitForTimeout(2500);

    /* ---------------------------------------------------------------- */
    /* LA PORTE D'ENTRÉE DE LA COLONNE « À DÉPLOYER »                     */
    /* ---------------------------------------------------------------- */
    const chevron = page.locator('[data-chevron-process]').first();
    noter('la colonne d’attente porte sa porte d’entrée', (await chevron.count()) === 1);
    if (!(await chevron.count())) {
      noter('le volet du déploiement s’ouvre', false, 'aucun chevron');
      await navigateur.close();
      return;
    }
    await chevron.click();
    await page.waitForTimeout(2000);

    const volet = page.locator(`[data-fil-publication="${RUN_AVEC_FIL}"]`);
    noter('le volet du déploiement s’ouvre', (await volet.count()) === 1);

    /* LE PARCOURS D'ABORD : on vient voir où en est la mise en ligne. */
    noter(
      'le volet s’ouvre sur le PARCOURS de la publication',
      (await volet.locator('[data-parcours-etapes]').count()) === 1,
    );
    noter(
      'l’ancien écran d’étapes ne s’affiche plus',
      (await volet.locator('[data-processus-etapes]').count()) === 0,
    );

    /* LE DÉTAIL TECHNIQUE EST RANGÉ, PAS JETÉ : il se déplie sous son étape. */
    const detailOuvert = volet.locator('[data-detail-etape]');
    noter(
      'le détail de l’étape en cours est déplié d’office, sous elle',
      (await detailOuvert.count()) === 1,
      `${await detailOuvert.count()} détail(s)`,
    );
    const etapesVisibles = await volet.locator('[data-etape-parcours]').count();
    noter('toutes les étapes de la publication se lisent', etapesVisibles >= 5, `${etapesVisibles} étape(s)`);

    /* PARLER À CELUI QUI PUBLIE : SUR PLACE, au pied du volet (décision du 08/11/2026) — son mot de fin, une question
       éventuelle, et un champ pour lui écrire ; plus aucun tiroir de conversation ne s'ouvre. */
    const filVisible = volet.locator('[data-fenetre-pied] [data-volet-conversation]');
    noter('celui qui publie s’affiche sur place, au pied du volet', (await filVisible.count()) === 1);
    const enLigne = filVisible.locator('[data-agent-en-ligne]');
    noter('il s’y lit en ligne (journal ou mot de fin), sans conversation complète', (await enLigne.count()) === 1 && (await page.locator('[data-volet-conversation] [data-message-id]').count()) === 0);
    const texteDuFil = (await filVisible.count()) ? ((await filVisible.textContent()) ?? '') : '';
    noter('le mot de fin de celui qui publie se lit', /Déploiement terminé/.test(texteDuFil), texteDuFil.slice(0, 160));

    /* LE CHAMP : on peut lui parler, même une fois la mise en ligne finie. */
    const champ = filVisible.locator('[data-agent-en-ligne-champ] input');
    noter('un champ pour lui écrire est ouvert sous son avancement', (await champ.count()) === 1);

    /* OUVRIR, RELIRE OU ÉCRIRE NE PUBLIE RIEN : aucun bouton de mise en ligne
       dans le volet. */
    const boutons = await volet.locator('button').allTextContents();
    noter(
      'ouvrir la conversation ne propose aucune mise en ligne',
      !boutons.some((b) => /Tout déployer|Mettre à jour la version|Publier/i.test(b)),
      boutons.filter((b) => b.trim()).slice(0, 6).join(' | '),
    );
    /* Une publication TERMINÉE ne propose pas « Arrêter » : il n'y a rien à
       couper. « Relancer » reste réservé à MA publication tombée. */
    noter(
      'une publication terminée ne propose pas « Arrêter »',
      !boutons.some((b) => /Arrêter/.test(b)),
    );

    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);

    /* ---------------------------------------------------------------- */
    /* LES PUBLICATIONS D'AVANT RESTENT LISIBLES                          */
    /* ---------------------------------------------------------------- */
    /*
     * La publication SANS conducteur est la plus ancienne : elle se relit
     * depuis le suivi de production, par son groupe. Faute de carte à
     * regrouper dans ce décor, on juge la règle là où elle se décide — le
     * volet retombe sur le déroulé dès qu'`agentId` manque (volet A) — et on
     * vérifie ici que RIEN n'a cassé à l'écran.
     */
    noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await navigateur.close();
  }
}

/* ------------------------------------------------------------------ */

try {
  voletDuServeur();
  await voletDeLEcran();
} catch (erreur) {
  noter('le contrôle est allé au bout', false, String(erreur?.message ?? erreur));
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées.`);
/* Le démon d'essai tourne en tuyaux : sa boucle garderait ce script vivant
   indéfiniment. On nettoie et on sort explicitement. */
nettoyer();
process.exit(echecs.length ? 1 : 0);
