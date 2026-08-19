#!/usr/bin/env node
/**
 * INITIER LE DÉPLOIEMENT ET LA MISE EN PRODUCTION DEPUIS LES COLONNES.
 *
 * Un projet NEUF n'arrive plus avec une procédure toute faite : les deux étapes
 * sont vides, les deux colonnes proposent de l'INITIER, et rien ne part tant
 * qu'aucune procédure n'existe. Une fois écrite, le bouton d'action revient et
 * une icône de réglages, en haut à DROITE de la colonne, rouvre le même tiroir.
 *
 * Deux parties :
 *
 *  1. SANS NAVIGATEUR, sur une base neuve : un projet neuf n'a de procédure
 *     pour aucune étape, `startDeploy` refuse les deux en renvoyant au bouton
 *     qui les initie, et l'écriture d'une procédure ne touche QUE sa cible.
 *  2. DANS UN VRAI NAVIGATEUR, sur son PROPRE démon (base neuve, port libre) :
 *     les deux colonnes proposent d'initier, le tiroir s'ouvre, la réponse
 *     envoyée fait écrire la procédure, puis le bouton d'action et l'icône de
 *     réglages prennent la place du bouton d'initiation.
 *
 * Le tour d'agent est INTERCEPTÉ dans le navigateur : aucun vrai agent n'est
 * lancé, aucun quota dépensé, aucun projet réel touché.
 *
 *   node scripts/verif-procedure-publication.mjs
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
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7196);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-procedure-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* Le dossier de CE processus (partie 1) et celui du démon (partie 2) sont
   séparés : ni l'un ni l'autre ne touche la base réelle. */
const DATA_LOCAL = path.join(TMP, 'local');
const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
for (const dossier of [DATA_LOCAL, DATA, PROJETS, DEPOT]) fs.mkdirSync(dossier, { recursive: true });

execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
  cwd: DEPOT,
});

process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));

/* ------------------------------------------------------------------ */
/* 1. Sans navigateur : la règle, le refus, l'écriture                  */
/* ------------------------------------------------------------------ */

process.env.HAIKODEV_DATA = DATA_LOCAL;
const { procedureEnPlace } = await import(path.join(RACINE, 'shared/dist/index.js'));
const store = await import(path.join(RACINE, 'server/dist/store.js'));
const { startDeploy } = await import(path.join(RACINE, 'server/dist/deploy.js'));
const { enregistrerProcedure } = await import(path.join(RACINE, 'server/dist/procedure-publication.js'));

const maintenant = Date.now();
const neuf = store.saveProject({
  id: store.newId(),
  name: 'Projet neuf',
  path: DEPOT,
  defaultEngine: 'claude',
  isSelf: false,
  rank: 1000,
  archived: false,
  createdAt: maintenant,
  updatedAt: maintenant,
});

noter(
  'un projet neuf n’a de procédure ni pour le déploiement ni pour la production',
  !procedureEnPlace(neuf, 'dev') && !procedureEnPlace(neuf, 'production'),
);

const refusDev = await startDeploy(neuf.id, { cible: 'dev' });
noter(
  'sans procédure, le déploiement est refusé et renvoie au bouton qui l’initie',
  refusDev.ok === false && /Initier le déploiement/.test(refusDev.error ?? ''),
  refusDev.error,
);

const refusProd = await startDeploy(neuf.id, { cible: 'production' });
noter(
  'sans procédure, la mise en production est refusée elle aussi',
  refusProd.ok === false && /mise en production/i.test(refusProd.error ?? ''),
  refusProd.error,
);

enregistrerProcedure(neuf.id, 'dev', '1. Construire.\n2. Relancer le service.', 'Comme HaikoDev.');
const apresDev = store.getProject(neuf.id);
noter(
  'écrire la procédure de DÉPLOIEMENT ne touche que le déploiement',
  procedureEnPlace(apresDev, 'dev') && !procedureEnPlace(apresDev, 'production'),
  JSON.stringify({ dev: !!apresDev.deploiement?.prompt, prod: !!apresDev.miseEnProduction?.prompt }),
);

enregistrerProcedure(neuf.id, 'production', 'Déposer chez le client.', 'Par SSH.');
const apresProd = store.getProject(neuf.id);
noter(
  'écrire la procédure de PRODUCTION laisse celle du déploiement intacte',
  procedureEnPlace(apresProd, 'production') &&
    apresProd.deploiement?.prompt === '1. Construire.\n2. Relancer le service.',
  JSON.stringify({ prod: apresProd.miseEnProduction?.prompt, dev: apresProd.deploiement?.prompt }),
);

noter(
  'la réponse de l’utilisateur est gardée à côté de la procédure',
  apresProd.deploiement?.base === 'Comme HaikoDev.' && apresProd.miseEnProduction?.base === 'Par SSH.',
);

/* ------------------------------------------------------------------ */
/* 2. Dans un vrai navigateur, sur son propre démon                     */
/* ------------------------------------------------------------------ */

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
const PROJET_ID = 'p-neuf';

if (!(await attendrePort())) {
  noter('le démon d’essai démarre', false, journal.join('').slice(-400));
  rendre();
}

{
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3600_000,
    'vérification procédure de publication',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  // Un projet NEUF : aucune clé de procédure, comme au sortir de son montage.
  const projet = {
    id: PROJET_ID,
    name: 'Projet neuf',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), t, t);
  db.close();
}

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH' });
await context.addCookies([
  { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
]);
const page = await context.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));

/*
 * Le tour d'agent est INTERCEPTÉ, et il est intercepté COMME EN VRAI : la
 * commande rend l'ÉTAT tout de suite (tour parti), puis l'issue arrive plus
 * tard par l'événement `procedure`. Le serveur n'est jamais appelé pour ces
 * commandes : aucun agent, aucun quota. Le `project.upsert` que le vrai serveur
 * émet à l'enregistrement est rejoué lui aussi, pour que la colonne change sous
 * les yeux comme en vrai.
 */
await page.addInitScript((id) => {
  window.__idProjet = id;
  window.__projet = null;
  window.__ecouteurs = [];
  const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
  Object.defineProperty(WebSocket.prototype, 'onmessage', {
    configurable: true,
    get() {
      return propriete.get.call(this);
    },
    set(ecouteur) {
      window.__ecouteurs.push(ecouteur);
      /* On CAPTURE au passage le projet tel que le serveur l'envoie : c'est sur
         LUI qu'on posera la procédure, pour que le projet réémis reste un vrai
         projet et pas un objet fabriqué de toutes pièces. */
      const capteur = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          const id = window.__idProjet;
          if (id && !window.__projet) {
            if (Array.isArray(msg?.projects)) {
              const trouve = msg.projects.find((p) => p?.id === id);
              if (trouve) window.__projet = trouve;
            }
            if (msg?.type === 'project.upsert' && msg.project?.id === id) window.__projet = msg.project;
          }
        } catch {
          /* pas du JSON : on laisse filer */
        }
        return ecouteur(evt);
      };
      return propriete.set.call(this, capteur);
    },
  });
  window.__injecter = (evenement) => {
    const donnees = JSON.stringify(evenement);
    for (const ecouteur of window.__ecouteurs) ecouteur({ data: donnees });
  };
  window.__tours = [];
  window.__etats = {};
  /* Les réponses données AUX QUESTIONS de l'agent : elles ne passent pas par
     `procedure.tour` (aucun tour de plus n'est payé) mais par la commande des
     questions, celle qui rend la main à l'appel d'outil arrêté. */
  window.__reponses = [];
  /* De quoi jouer les cas qui font mal : un tour LENT (le témoin doit vivre et
     s'éteindre), un tour qui TOMBE (il doit le dire), un tour PERDU (serveur
     redémarré : l'état disparaît). */
  window.__delai = 300;
  window.__echec = null;
  window.__perdre = false;

  const cle = (projectId, cible) => `${projectId}:${cible}`;

  const envoiOriginal = WebSocket.prototype.send;
  WebSocket.prototype.send = function (donnees) {
    let enveloppe = null;
    try {
      enveloppe = JSON.parse(donnees);
    } catch {
      /* pas du JSON */
    }
    const cmd = enveloppe?.cmd;

    if (cmd?.type === 'procedure.etat') {
      const etat = window.__perdre ? null : (window.__etats[cle(cmd.projectId, cmd.cible)] ?? null);
      setTimeout(() => window.__injecter({ id: enveloppe.id, type: 'ack', ok: true, data: { etat } }), 20);
      return;
    }

    if (cmd?.type === 'question.answer') {
      window.__reponses.push({ questionId: cmd.questionId, answer: cmd.answer });
      const k = window.__cleQuestion;
      const courant = k ? window.__etats[k] : null;
      if (courant) {
        /* Le serveur retire la question et note l'échange : on fait pareil. */
        const suite = {
          ...courant,
          question: undefined,
          echanges: [
            ...(courant.echanges ?? []),
            { qui: 'agent', texte: courant.question?.texte ?? '' },
            { qui: 'moi', texte: cmd.answer },
          ],
        };
        window.__etats[k] = suite;
        setTimeout(() => window.__injecter({ type: 'procedure', etat: suite }), 30);
      }
      setTimeout(() => window.__injecter({ id: enveloppe.id, type: 'ack', ok: true, data: {} }), 20);
      return;
    }

    if (cmd?.type === 'procedure.tour') {
      window.__tours.push({ cible: cmd.cible, message: cmd.message ?? null });
      const k = cle(cmd.projectId, cmd.cible);
      const courant = window.__etats[k];
      if (courant?.enCours) {
        setTimeout(() => window.__injecter({ id: enveloppe.id, type: 'ack', ok: true, data: { etat: courant } }), 20);
        return;
      }
      const echanges = cmd.message
        ? [...(courant?.echanges ?? []), { qui: 'moi', texte: cmd.message }]
        : [];
      const parti = {
        projectId: cmd.projectId,
        cible: cmd.cible,
        agentId: 'a-essai',
        enCours: true,
        echanges,
        depuis: Date.now(),
      };
      window.__etats[k] = parti;
      setTimeout(() => window.__injecter({ id: enveloppe.id, type: 'ack', ok: true, data: { etat: parti } }), 20);

      setTimeout(() => {
        if (window.__echec) {
          const tombe = { ...parti, enCours: false, depuis: undefined, raison: window.__echec };
          window.__etats[k] = tombe;
          window.__injecter({ type: 'procedure', etat: tombe });
          return;
        }
        /* L'AGENT ANALYSE ET ÉCRIT, il ne fait plus trancher : un tour SANS
           message aboutit à une procédure, précédée de son explication. */
        const procedure = `Procédure ${cmd.cible} :: ${cmd.message ?? 'analyse automatique'}`;
        const explication = cmd.message
          ? `J’ai repris la procédure avec ce que vous demandez (${cmd.cible}).`
          : `J’ai lu le projet : il se construit puis tourne en service, je relance donc le service (${cmd.cible}).`;
        const projet = window.__projet ?? { id: window.__idProjet };
        const suite =
          cmd.cible === 'dev'
            ? { ...projet, deploiement: { base: cmd.message, prompt: procedure } }
            : { ...projet, miseEnProduction: { ...projet.miseEnProduction, base: cmd.message, prompt: procedure } };
        window.__projet = suite;
        const ecrite = {
          ...parti,
          enCours: false,
          depuis: undefined,
          procedure,
          echanges: [...echanges, { qui: 'agent', texte: explication }],
        };
        window.__etats[k] = ecrite;
        window.__injecter({ type: 'procedure', etat: ecrite });
        window.__injecter({ type: 'project.upsert', project: suite });
      }, window.__delai);
      return;
    }
    return envoiOriginal.call(this, donnees);
  };
}, PROJET_ID);

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
page.setDefaultTimeout(8000);
/* L'identifiant du projet ouvert est posé AVANT le chargement : c'est lui qui
   permet de capturer le projet réel au passage, puis de le réémettre enrichi. */

const etatColonnes = async () =>
  page.evaluate(() => ({
    initierDev: !!document.querySelector('[data-initier-procedure="dev"]'),
    initierProd: !!document.querySelector('[data-initier-procedure="production"]'),
    boutonAction: document.querySelectorAll('[data-bouton-publication]').length,
    reglages: document.querySelectorAll('[data-reglages-procedure]').length,
  }));

const avant = await etatColonnes();
noter(
  'les DEUX colonnes proposent d’initier, et aucun bouton de publication ne paraît',
  avant.initierDev && avant.initierProd && avant.boutonAction === 0,
  JSON.stringify(avant),
);
noter('aucune icône de réglages tant qu’aucune procédure n’existe', avant.reglages === 0);

/* ------------------------------------------------------------------ */
/* Le tour dure des MINUTES : le tiroir doit vivre, se rattraper, et    */
/* dire ses échecs — jamais tourner sans fin sur « L'agent travaille… ».*/
/* ------------------------------------------------------------------ */

const texteDe = (selecteur) =>
  page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? '', selecteur);
const present = (selecteur) => page.evaluate((s) => !!document.querySelector(s), selecteur);
const compterTours = () => page.evaluate(() => window.__tours.length);

/* Un tour LENT, comme en vrai : l'agent lit tout le projet avant d'écrire. */
await page.evaluate(() => {
  window.__delai = 2500;
});
await page.click('[data-initier-procedure="dev"]');
await page.waitForSelector('[data-tiroir-procedure="dev"]', { timeout: 8000 });
await page.waitForTimeout(1400);

const temoin = await texteDe('[data-procedure-en-cours]');
noter(
  'pendant le tour, le témoin dit ce qui se passe ET depuis combien de temps',
  /L’agent travaille…/.test(temoin) && /\d+ s/.test(temoin),
  temoin,
);
noter('pendant le tour, le bouton « Envoyer » attend', await page.isDisabled('[data-envoyer-procedure]'));

/* ON REFERME PENDANT QUE ÇA TOURNE : c'est le geste qui perdait tout. */
await page.keyboard.press('Escape');
await page.waitForTimeout(2400);

/* ------------------------------------------------------------------ */
/* L'AGENT ANALYSE ET TRANCHE : AUCUN CHOIX TECHNIQUE NE REMONTE       */
/*                                                                      */
/* L'ouverture demandait de choisir entre reconstruire sur place,       */
/* reprendre une version déjà construite ou faire passer les contrôles. */
/* Elle rend maintenant la procédure ÉCRITE, avec l'explication de ce   */
/* qui a été constaté et décidé.                                        */
/* ------------------------------------------------------------------ */

const apresAnalyse = await etatColonnes();
noter(
  'le seul fait d’initier suffit : le déploiement est configuré, sans rien demander',
  !apresAnalyse.initierDev && apresAnalyse.boutonAction === 1 && apresAnalyse.reglages === 1,
  JSON.stringify(apresAnalyse),
);
noter('la mise en production, elle, propose toujours d’initier : jamais l’une pour l’autre', apresAnalyse.initierProd);

await page.click('[data-reglages-procedure="dev"]');
await page.waitForSelector('[data-tiroir-procedure="dev"]', { timeout: 8000 });
await page.waitForTimeout(900);
const rattrapee = await texteDe('[data-tiroir-procedure="dev"] [data-procedure-actuelle]');
noter(
  'une procédure écrite tiroir REFERMÉ se retrouve à la réouverture',
  rattrapee.includes('Procédure dev ::'),
  rattrapee.trim().slice(0, 80),
);
noter('la rouvrir ne repaie AUCUN tour : un seul est parti', (await compterTours()) === 1);
noter(
  'le témoin est éteint dès que plus rien ne tourne',
  !(await present('[data-procedure-en-cours]')),
);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

/* UN TOUR QUI TOMBE : il doit DIRE ce qui s'est passé, et laisser relancer. */
await page.evaluate(() => {
  window.__delai = 400;
  window.__echec = 'Le tour de l’agent s’est arrêté : quota';
});
await page.click('[data-initier-procedure="production"]');
await page.waitForSelector('[data-tiroir-procedure="production"]', { timeout: 8000 });
await page.waitForTimeout(1000);
const dit = await texteDe('[data-erreur-procedure]');
noter('un tour qui tombe dit sa cause au lieu de tourner', /quota/.test(dit), dit);
noter('et le témoin s’éteint aussi sur un échec', !(await present('[data-procedure-en-cours]')));
noter('un échec laisse un bouton pour relancer', await present('[data-relancer-procedure]'));

await page.evaluate(() => {
  window.__echec = null;
});
await page.click('[data-relancer-procedure]');
await page.waitForTimeout(1000);
const expliquee = await texteDe('[data-tiroir-procedure="production"] [data-bulle-procedure="agent"]');
noter(
  'relancer à la main refait l’analyse, et l’agent DIT ce qu’il a constaté et décidé',
  /J’ai lu le projet/.test(expliquee),
  expliquee.trim().slice(0, 90),
);
noter(
  '… la procédure est écrite dans la foulée, sans qu’aucun choix technique soit posé',
  (await texteDe('[data-tiroir-procedure="production"] [data-procedure-ecrite]')).includes('Procédure production ::') &&
    !(await present('[data-question-procedure]')),
);
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

const apresTout = await etatColonnes();
noter(
  'les deux étapes configurées : deux boutons d’action, deux icônes de réglages',
  !apresTout.initierDev && !apresTout.initierProd && apresTout.boutonAction === 2 && apresTout.reglages === 2,
  JSON.stringify(apresTout),
);

/* ------------------------------------------------------------------ */
/* L'ICÔNE DE RÉGLAGES NE PAIE PLUS UN AGENT À CHAQUE CLIC             */
/*                                                                      */
/* Elle relançait un agent complet, qui relisait tout le projet pour     */
/* réécrire une procédure déjà là. Elle montre maintenant ce qui existe, */
/* et rien ne part sans un geste.                                       */
/* ------------------------------------------------------------------ */

const avantReglages = await compterTours();
await page.click('[data-reglages-procedure="dev"]');
await page.waitForSelector('[data-tiroir-procedure="dev"]', { timeout: 8000 });
await page.waitForTimeout(900);
const relu = await texteDe('[data-tiroir-procedure="dev"] [data-procedure-actuelle]');
noter(
  'l’icône de réglages rouvre le tiroir sur la procédure déjà en place',
  relu.includes('Procédure dev ::'),
  relu.trim().slice(0, 80),
);
noter('… et n’envoie AUCUN agent relire le projet', (await compterTours()) === avantReglages);
noter(
  '… le tiroir dit qu’il attend un geste, et propose de refaire l’analyse',
  (await present('[data-procedure-en-attente]')) && (await present('[data-refaire-analyse]')),
);

/* Ce qu'on écrit ici n'est pas une réponse à une question : c'est un CHANGEMENT
   demandé sur une procédure déjà écrite, en français, sans rien à trancher. */
await page.fill('[data-reponse-procedure]', 'Ne redémarre rien le vendredi');
await page.click('[data-envoyer-procedure]');
await page.waitForTimeout(1000);
const ajustee = await texteDe('[data-tiroir-procedure="dev"] [data-procedure-ecrite]');
noter(
  'ce qu’on demande en français réécrit la procédure, sans question posée',
  ajustee.includes('Ne redémarre rien le vendredi'),
  ajustee.trim().slice(0, 90),
);

/* Refaire l'analyse reste possible — mais c'est un geste, et il est payé. Il
   se propose à la réouverture, quand le tiroir n'a rien lancé de lui-même. */
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.click('[data-reglages-procedure="dev"]');
await page.waitForSelector('[data-tiroir-procedure="dev"]', { timeout: 8000 });
await page.waitForTimeout(900);
await page.click('[data-refaire-analyse]');
await page.waitForTimeout(900);
noter('refaire l’analyse à la main paie un tour, et un seul', (await compterTours()) === avantReglages + 2);

/* ------------------------------------------------------------------ */
/* LA QUESTION DE L'AGENT S'AFFICHE DANS LE TIROIR, ET S'Y RÉPOND      */
/*                                                                      */
/* Elle vient de l'outil `ask_user`, qui arrête le tour jusqu'à la      */
/* réponse : elle paraissait dans la cloche du bandeau et nulle part    */
/* dans le tiroir ouvert dessous.                                       */
/* ------------------------------------------------------------------ */

await page.evaluate(() => {
  const k = `${window.__idProjet}:dev`;
  window.__cleQuestion = k;
  const etat = {
    ...(window.__etats[k] ?? { projectId: window.__idProjet, cible: 'dev', echanges: [] }),
    agentId: 'a-essai',
    enCours: true,
    depuis: Date.now(),
    question: {
      messageId: 'm-essai',
      questionId: 'q-essai',
      texte: 'Quel service faut-il redémarrer ?',
      options: [{ id: 'o0', label: 'haikodev' }],
    },
  };
  window.__etats[k] = etat;
  window.__injecter({ type: 'procedure', etat });
});
await page.waitForTimeout(600);
const posee = await texteDe('[data-tiroir-procedure="dev"] [data-question-procedure]');
noter('la question de l’agent s’affiche DANS le tiroir', posee.includes('Quel service'), posee.slice(0, 80));
noter('… avec ses choix cliquables', await present('[data-option-procedure]'));

/*
 * ET LE TÉMOIN NE DIT PLUS « L'AGENT TRAVAILLE ». Un agent arrêté sur sa
 * question n'est pas au travail : le témoin dit l'attente, sa roue cesse de
 * tourner et son chronomètre s'arrête. Il affichait juste sous la question
 * « L'agent travaille… Outil ask_user » avec un temps qui défilait.
 */
const temoinDAttente = await page.textContent('[data-procedure-en-cours]');
noter(
  '… et le témoin dit l’ATTENTE, plus jamais « l’agent travaille »',
  temoinDAttente.includes('attend votre réponse') && !temoinDAttente.includes('travaille'),
  temoinDAttente.trim(),
);
noter('… la roue de travail est remplacée par le repère d’attente', await present('[data-procedure-attente]'));
await page.waitForTimeout(2200);
noter(
  '… et le chronomètre n’avance plus pendant qu’on réfléchit',
  (await page.textContent('[data-procedure-en-cours]')) === temoinDAttente,
  temoinDAttente.trim(),
);

/* Un tour tourne encore : c'est justement de cette réponse qu'il a besoin. */
await page.fill('[data-reponse-procedure]', 'le service haikodev');
await page.waitForTimeout(200);
noter(
  '… et le champ de réponse reste actif malgré le tour en cours',
  !(await page.isDisabled('[data-envoyer-procedure]')),
);

const avantReponse = await compterTours();
await page.click('[data-option-procedure]');
await page.waitForTimeout(700);
const reponses = await page.evaluate(() => window.__reponses);
noter(
  'un clic sur un choix répond à l’agent arrêté, sans payer de tour',
  reponses.length === 1 && reponses[0].answer === 'haikodev' && (await compterTours()) === avantReponse,
  JSON.stringify(reponses),
);
noter('la question répondue laisse sa trace dans le fil', !(await present('[data-question-procedure]')));

/*
 * TOUS les tours partis, dans l'ordre. Chacun porte la cible de la colonne d'où
 * il vient, et il n'y en a pas UN de trop : l'ouverture « dev », qui suffit à
 * elle seule (la réouverture pendant le tour n'en repaie aucun), la production
 * tombée puis relancée à la main, le changement demandé sur « dev », puis
 * l'analyse refaite à la demande. L'icône de réglages, elle, n'en paie aucun.
 */
const cibles = await page.evaluate(() => window.__tours.map((t) => t.cible).join(','));
noter(
  'chaque tour porte la cible de la colonne d’où il vient, et aucun tour de trop',
  cibles === 'dev,production,production,dev,dev',
  cibles,
);

noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

await browser.close();
rendre();

function rendre() {
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}
