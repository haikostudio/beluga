#!/usr/bin/env node
/**
 * RIEN NE FIGE À L'ENVOI, ET UN AFFINAGE OUVRE SON PROPRE POINT.
 *
 *   node scripts/verif-rien-ne-fige-a-l-envoi.mjs
 *
 * Deux défauts se voyaient au même endroit — la conversation d'une carte — et
 * ce contrôle les mesure tous les deux, sur un démon À SOI avec un FAUX moteur :
 * le démon de production n'est pas touché, et pas un jeton n'est dépensé.
 *
 *  1. À L'ENVOI, L'ÉCRAN BASCULE TOUT DE SUITE. Le bloc de configuration
 *     attendait l'écho du serveur pour se replier : entre le clic et le premier
 *     mouvement, l'écran semblait planté. Le DÉLAI entre le clic « envoyer » et
 *     le premier changement visible est chronométré, et ce contrôle ÉCHOUE
 *     au-delà d'UNE SECONDE.
 *  2. UN TOUR D'AFFINAGE OUVRE UN POINT « PLAN » NEUF, EN BAS DU FLUX. L'état
 *     « en cours » se posait sur le passage du plan DÉJÀ RENDU, plus haut dans
 *     la ligne de temps : l'ancien plan avait l'air de se réécrire. Pendant
 *     l'écriture du second plan, le point qui tourne doit être le DERNIER de la
 *     ligne de temps, et le passage antérieur être à l'état « fait ».
 *
 * Sont vérifiés au passage : l'absence de bulle en DOUBLE, la ligne d'attente
 * sous le point « Demande », la numérotation des passages (« 2/2 »), et la
 * frise cliquable vers le DERNIER passage AU FORMAT TÉLÉPHONE.
 *
 * Ce script ne reprend JAMAIS `BELUGA_URL` ni `BELUGA_TOKEN` : il monte son
 * propre serveur, sur un port à lui (`BELUGA_FIGE_PORT`).
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

/* Le dépôt d'où PART ce script — jamais un chemin écrit en dur : lancé depuis
   une copie de travail, il jugerait sinon le code du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_FIGE_PORT || 7211);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-fige-'));
const PROJET_ID = 'projet-fige';
const DEMANDE = 'Ajouter un bouton pour exporter la liste en CSV';
/* LE PLAFOND DU DÉLAI : au-delà d'une seconde entre le clic et le premier
   changement visible, l'écran passe pour planté. */
const PLAFOND_MS = Number(process.env.BELUGA_FIGE_PLAFOND_MS || 1000);
/* Le faux moteur prend son temps : c'est PENDANT qu'il écrit le second plan
   qu'on regarde la ligne de temps. */
const LENTEUR_MS = Number(process.env.BELUGA_FIGE_LENTEUR_MS || 6000);

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le décor : un dépôt git, un faux moteur LENT, un compte d'essai      */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
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
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], { cwd: DEPOT });

const FAUX_MOTEUR = path.join(TMP, 'faux-claude.mjs');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/usr/bin/env node
import fs from 'node:fs';

/* LA LIGNE DES ÉTAPES SE DÉROULE AVANT QU'ON TOUCHE UNE ÉTAPE (13/11/2026) : repliée, ses étapes ont une hauteur nulle. */
async function deroulerLesEtapes(page) {
  const ligne = page.locator('[data-ligne-etapes]:not([data-ligne-ouverte]) [data-barre-en-ligne]:visible').first();
  if (await ligne.count()) {
    await ligne.click().catch(() => undefined);
    await page.waitForTimeout(300);
  }
}

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

async function jouer() {
  dire({ type: 'system', subtype: 'init', session_id: 'session-' + Math.random().toString(16).slice(2) });
  const cheminMcp = process.argv[process.argv.indexOf('--mcp-config') + 1];
  const pont = cheminMcp && fs.existsSync(cheminMcp)
    ? JSON.parse(fs.readFileSync(cheminMcp, 'utf8')).mcpServers?.beluga?.env
    : null;
  const appeler = async (name, args) => {
    if (!pont) return null;
    try {
      const res = await fetch(pont.BELUGA_URL + '/internal/call', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-beluga-token': pont.BELUGA_TOKEN,
          'x-beluga-agent': pont.BELUGA_AGENT,
          'x-beluga-tour': pont.BELUGA_TOUR,
        },
        body: JSON.stringify({ name, args }),
      });
      return await res.json();
    } catch {
      return null;
    }
  };
  /* LE PLAN SE DEMANDE PAR LE CLIC « Générer le plan » : la première version
     (consigneDeRenduDuPlan), puis les suivantes (consigneDAffinageDuPlan). Un
     message de l'utilisateur, lui, rend une nouvelle compréhension. */
  /* L'INTERRUPTEUR « PLAN » ALLUMÉ demande les DEUX dans le même tour. */
  const interrupteur = /INTERRUPTEUR . PLAN . EST ALLUM/.test(demande);
  const planDemande = interrupteur || /rends maintenant le PLAN COMPLET|AFFINE LE PLAN/.test(demande);
  /* IL PREND SON TEMPS : c'est pendant ce silence qu'on lit la ligne de temps. */
  await new Promise((r) => setTimeout(r, ${LENTEUR_MS}));
  const cardId = /Identifiant de cette carte[^:]*:\\s*([0-9a-f-]{36})/i.exec(demande)?.[1];
  if (cardId) await appeler('board_update_card', { cardId, title: ${JSON.stringify(DEMANDE)} });
  if (interrupteur) {
    await appeler('rendre_comprehension', {
      texte: 'Vous voulez un bouton qui exporte la liste en CSV, dans la barre de la liste.',
      resumeDemande: 'Vous demandez un bouton d’export.',
      resumeComprehension: 'Je comprends qu’il faut un bouton d’export dans la barre de la liste.',
      hypotheses: [],
      sujets: [],
      partieTechnique: {
        taches: [{ titre: 'Poser le bouton', description: 'Dans la barre de la liste.' }],
        faits: [],
        risques: 'Le fichier produit peut être vide si la liste l’est.',
      },
    });
  }
  if (planDemande) {
    await appeler('rendre_plan', {
      titre: 'Export CSV de la liste',
      resume: 'Un bouton qui écrit la liste dans un fichier.',
      /* OBLIGATOIRES : sans « enClair » (200 signes, deux phrases) ni « synthese », le plan est refusé. */
      enClair: 'Je vais ajouter un bouton d’export dans la barre de la liste. Un clic suffira pour enregistrer toute la liste dans un fichier. Une fois en place, vous ouvrirez ce fichier dans votre tableur habituel, avec une ligne par élément. Cela vous servira à partager la liste ou à la garder à part.',
      synthese: 'Un bouton va être ajouté dans la barre de la liste. Un clic enregistre toute la liste dans un fichier qui s’ouvre dans un tableur.',
      /* « taches » est OBLIGATOIRE : sans elle, le plan est refusé et aucun
         point « Plan » ne passe jamais à « fait ». */
      taches: [
        { titre: 'Le bouton', description: 'Poser le bouton d’export dans la barre de la liste.' },
        { titre: 'Le fichier', description: 'Écrire une ligne par élément, séparées par des virgules.' },
      ],
      decisions: ['Version 1 : l’export se fait en CSV, décidé au premier message.'],
      faisabilite: 'La liste existe déjà ; il manque le bouton et l’écriture du fichier.',
      chemin: [
        { titre: 'Ajouter le bouton', detail: 'Dans la barre de la liste.' },
        { titre: 'Écrire le fichier', detail: 'Une ligne par élément, séparées par des virgules.' },
        { titre: 'Vérifier le résultat', detail: 'Ouvrir le fichier produit.' },
      ],
      consequences: 'Un bouton de plus, rien de retiré.',
      ameliorations: ['Choisir les colonnes exportées.', 'Exporter aussi en Excel.', 'Retenir le dernier dossier utilisé.'],
      verifications: ['Le fichier s’ouvre dans un tableur.'],
    });
  } else {
    await appeler('rendre_comprehension', {
      texte: 'Vous voulez un bouton qui exporte la liste en CSV, dans la barre de la liste.',
      hypotheses: [],
      sujets: [],
      /* LE SECOND REGISTRE EST OBLIGATOIRE : sans lui l'outil refuse. */
      partieTechnique: {
        taches: [{ titre: 'Poser le bouton', description: 'Dans la barre de la liste.' }],
        faits: ['La barre de la liste est un composant partagé.'],
        risques: 'Le fichier produit peut être vide si la liste l’est.',
      },
    });
  }
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: planDemande ? 'Le plan est rendu.' : 'Je comprends votre demande.' }] } });
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

function nettoyer() {
  try {
    demon?.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  if (!process.env.BELUGA_FIGE_GARDER) fs.rmSync(TMP, { recursive: true, force: true });
}
process.on('exit', nettoyer);

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

const jeton = crypto.randomBytes(24).toString('hex');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const db = (lecture = false) => new Database(path.join(DATA, 'beluga.db'), { readonly: lecture });

function poserLeDecor() {
  const base = db();
  const maintenant = Date.now();
  base
    .prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)')
    .run(sha(jeton), maintenant, maintenant + 3600_000, 'vérification rien ne fige');
  base.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai envoi',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  base
    .prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)')
    .run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);
  base.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    'compte-essai',
    'claude',
    JSON.stringify({ id: 'compte-essai', engine: 'claude', label: 'Compte d’essai', priority: 1, configDir: COMPTE }),
    maintenant,
  );
  base.close();
}

/* ------------------------------------------------------------------ */

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/** L'état visible du parcours, lu d'un seul coup dans la page. */
const lireLEcran = (page) =>
  page.evaluate(() => {
    const points = Array.from(document.querySelectorAll('[data-flux-liste] > [data-point]')).map((n) => ({
      etape: n.getAttribute('data-point'),
      rang: Number(n.getAttribute('data-point-rang')),
      total: Number(n.getAttribute('data-point-total')),
      etat: n.getAttribute('data-point-etat'),
      ancre: n.getAttribute('data-point-ancre'),
      /* CE QUI TOURNE, depuis la refonte en discussion (11/10/2026) : le rond
         d'étape n'est plus dessiné (`[data-point-rond]` reste, caché et vide) ;
         le passage qui vit se reconnaît au POINT de la ligne de tête de sa
         carte, violet et pulsé (`[data-point-de-la-carte] .animate-pulse-soft`),
         ou à la roue de sa ligne d'attente (`[data-point-attente] .animate-spin`).
         On ne regarde que la ligne de tête : le détail ouvert a ses propres roues. */
      anime: !!n.querySelector('[data-point-rond] .animate-spin, [data-point-bascule] .animate-pulse-soft, [data-point-bascule] .animate-spin'),
      blocsDuPlan: n.querySelectorAll('[data-bloc-du-plan]').length,
    }));
    return {
      configuration: document.querySelectorAll('[data-carte-configuration]').length,
      flux: document.querySelectorAll('[data-flux-points]').length,
      demandes: document.querySelectorAll('[data-moment="demande"]').length,
      attente: document.querySelector('[data-point-attente]')?.getAttribute('data-point-attente') ?? null,
      rangs: Array.from(document.querySelectorAll('[data-point-rang-lu]')).map((n) => n.textContent.trim()),
      points,
    };
  });

async function attendreQue(page, juge, limiteMs = 60000, pas = 250) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const vu = await lireLEcran(page);
    if (juge(vu)) return vu;
    await attendre(pas);
  }
  return null;
}


/**
 * DEMANDER UN PLAN, PAR LE CHEMIN DE L'UTILISATEUR.
 *
 * Il n'y a plus de bouton « Générer le plan » ni d'interrupteur « Plan » (11/11/2026) :
 * le mode Plan se CONFIRME dans la discussion. L'essai le pose sur la carte par le
 * même geste du démon (`card.plan.souhaite`), puis écrit — le tour rend alors sa
 * compréhension ET son plan, sans second clic.
 */
async function demanderUnPlan(page, texte = 'Fais-moi le plan complet.') {
  const cardId = await page.evaluate(() => location.pathname.match(/tache\/([^/?#]+)/)?.[1] ?? document.querySelector('[data-page-carte]')?.getAttribute('data-page-carte') ?? null);
  if (cardId) {
    /* La commande part par le canal du démon, depuis la page (même session, même origine). */
    await page
      .evaluate(
        (id) =>
          new Promise((fini) => {
            const prise = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`);
            const cle = Math.random().toString(36).slice(2);
            setTimeout(() => (prise.close(), fini(false)), 10000);
            prise.onopen = () => prise.send(JSON.stringify({ id: cle, cmd: { type: 'card.plan.souhaite', cardId: id, actif: true } }));
            prise.onmessage = (e) => {
              const ev = JSON.parse(String(e.data));
              if (ev.type === 'ack' && ev.id === cle) (prise.close(), fini(true));
            };
          }),
        cardId,
      )
      .catch(() => undefined);
    await page.waitForTimeout(800);
  }
  const champ = page.locator('[data-composer] textarea').last();
  await champ.click();
  await champ.fill(texte);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
}

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

  /* DEUX BOUTONS PORTENT CE REPÈRE depuis la refonte du 11/10/2026 : celui de
     la tête de « Demande » (ordinateur) et celui du bas de l'écran (téléphone,
     monté mais caché ici). On clique celui de l'entête de la colonne. */
  await page.locator('[data-tete-colonne="planned"] [data-nouvelle-carte="planned"]').click();
  await page.waitForTimeout(3000);
  const avant = await lireLEcran(page);
  noter('la carte neuve s’ouvre sur sa configuration', avant.configuration === 1 && avant.flux === 0);

  /* -------- 1. LE DÉLAI ENTRE LE CLIC ET LE PREMIER CHANGEMENT -------- */

  const champ = page.locator('[data-composer] textarea').last();
  await champ.click();
  await champ.fill(DEMANDE);
  /* LE GUETTEUR : la ligne d'attente est fugace, et un sondage de la page peut
     la manquer quand la machine est chargée. Un observateur posé AVANT l'envoi
     retient la première attente apparue, quelle que soit la charge. */
  await page.evaluate(() => {
    window.__attenteVue = null;
    const noter = () => {
      const n = document.querySelector('[data-point-attente]');
      if (n && !window.__attenteVue) window.__attenteVue = n.getAttribute('data-point-attente');
    };
    new MutationObserver(noter).observe(document.body, { childList: true, subtree: true, attributes: true });
    noter();
  });
  const depart = Date.now();
  await page.keyboard.press('Enter');
  let delai = null;
  /* L'ATTENTE EST FUGACE : elle se lit PENDANT la préparation, pas après. */
  let attenteVue = null;
  while (Date.now() - depart < 15000 && (delai === null || attenteVue === null)) {
    const vu = await page.evaluate(() => ({
      configuration: document.querySelectorAll('[data-carte-configuration]').length,
      flux: document.querySelectorAll('[data-flux-points]').length,
      attente: document.querySelector('[data-point-attente]')?.getAttribute('data-point-attente') ?? window.__attenteVue ?? null,
    }));
    if (vu.configuration === 0 && vu.flux === 1 && delai === null) delai = Date.now() - depart;
    if (vu.attente && attenteVue === null) attenteVue = vu.attente;
  }
  noter(
    `l’écran bascule sur le parcours en moins de ${PLAFOND_MS} ms`,
    delai !== null && delai <= PLAFOND_MS,
    delai === null ? 'jamais basculé' : `${delai} ms`,
  );

  /* La bulle de la demande est là, UNE SEULE FOIS : l'écho local se retire dès
     que la vraie entrée arrive, il ne s'ajoute pas à elle. Le point « Demande »
     est ouvert d'office : rien à cliquer pour la lire. */
  const auClic = await lireLEcran(page);
  noter(
    'la demande s’affiche aussitôt dans le parcours',
    auClic.demandes >= 1 && (await page.locator('[data-point="demande"]').first().innerText()).includes(DEMANDE),
  );
  noter(
    'et l’attente se dit en toutes lettres sous le point « Demande »',
    !!attenteVue,
    attenteVue ?? 'aucune ligne d’attente',
  );

  /* Le tour se termine : la bulle du serveur REMPLACE l'écho, elle ne le double pas. */
  const apresTour = await attendreQue(page, (v) => v.points.some((p) => p.etape === 'comprehension' && p.etat === 'fait'), 60000);
  noter('le premier tour a rendu sa compréhension', !!apresTour);
  const sansDouble = await lireLEcran(page);
  noter(
    'aucune bulle de demande en double',
    sansDouble.points.filter((p) => p.etape === 'demande').length === 1 && sansDouble.demandes === 1,
    `${sansDouble.demandes} bulle(s), ${sansDouble.points.filter((p) => p.etape === 'demande').length} passage(s)`,
  );

  /* -------- 2. LE PREMIER PLAN -------- */

  await demanderUnPlan(page);
  const planRendu = await attendreQue(page, (v) => v.points.some((p) => p.etape === 'plan' && p.etat === 'fait'), 60000);
  noter('le premier plan est rendu, et son point est fait', !!planRendu);

  /* -------- 3. L'AFFINAGE OUVRE UN POINT « PLAN » NEUF -------- */

  /* L'INTERRUPTEUR « PLAN » RESTE ALLUMÉ après le premier plan : la précision
     rend donc, dans le MÊME tour, sa compréhension ET la version 2 du plan,
     sans second clic. Trois demandes ont été écrites : la première, celle qui
     a allumé le plan, et la précision. */
  await champ.click();
  await champ.fill('Ajoute aussi l’export en PDF');
  await page.keyboard.press('Enter');
  const apresPrecision = await attendreQue(page, (v) => v.points.filter((p) => p.etape === 'demande').length === 3, 60000);
  noter(
    'la précision ouvre un point « Demande » NEUF, en bas du flux',
    !!apresPrecision,
    apresPrecision ? apresPrecision.points.map((p) => `${p.etape}${p.rang}`).join(' ') : 'non vue',
  );
  /* C'est PENDANT que la v2 s'écrit (le faux moteur se tait d'abord) qu'on
     regarde — le scénario de la carte « Snapshots ». */
  const pendant = await attendreQue(page, (v) => v.points.some((p) => p.etape === 'plan' && p.etat === 'encours'), 30000, 120);
  noter('pendant l’écriture du second plan, un point « Plan » tourne', !!pendant);
  const secondeComprehension = await attendreQue(
    page,
    (v) => v.points.filter((p) => p.etape === 'comprehension' && p.etat === 'fait').length === 3,
    60000,
  );
  noter('la précision rend une seconde compréhension', !!secondeComprehension);
  if (pendant) {
    const plans = pendant.points.filter((p) => p.etape === 'plan');
    const enCours = pendant.points.filter((p) => p.etat === 'encours');
    const dernier = plans[plans.length - 1];
    noter(
      'le point qui tourne est un passage NEUF, le DEUXIÈME',
      plans.length === 2 && dernier.etat === 'encours' && dernier.rang === 2 && dernier.ancre === 'point-plan-2',
      plans.map((p) => `${p.rang}/${p.total} ${p.etat}`).join(' · '),
    );
    /* …et le repère de l'animation n'est pas lu dans le vide : le passage qui
       s'écrit, lui, s'anime bel et bien. */
    noter(
      'le plan ANTÉRIEUR est à l’état « fait » et ne s’anime pas',
      plans[0]?.etat === 'fait' && plans[0]?.anime === false && dernier?.anime === true,
      `plan 1 « ${plans[0]?.etat} », animé : ${plans[0]?.anime ? 'oui' : 'non'} · plan 2 « ${dernier?.etat} », animé : ${dernier?.anime ? 'oui' : 'non'}`,
    );
    noter(
      'un seul point tourne, et c’est le DERNIER de la ligne de temps',
      enCours.length === 1 &&
        pendant.points.indexOf(dernier) ===
          pendant.points.findIndex((p) => p.etape === 'travail') - 1,
      `${enCours.length} point(s) en cours`,
    );
    /* LE POINT QUI TOURNE NE MONTRE AUCUNE VERSION : la v1 vit dans son point,
       elle ne se relit plus sous le récit du tour qui écrit la v2. */
    noter(
      'le point « Plan » qui s’écrit ne montre aucun bloc de plan',
      dernier?.blocsDuPlan === 0,
      `${dernier?.blocsDuPlan ?? '?'} bloc(s) dans le point ${dernier?.ancre}`,
    );
    /* LE RANG VIT DANS L'ANCRE ET L'ATTRIBUT, PLUS À L'ÉCRAN : la pastille
       « n/n » ne disait rien à l'utilisateur et a été retirée. */
    noter(
      'aucune pastille « n/n » à l’écran, et chaque passage garde son rang en attribut',
      pendant.rangs.length === 0 && plans.map((p) => p.rang).join(',') === '1,2',
      `${pendant.rangs.length} pastille(s) · rangs ${plans.map((p) => p.rang).join(',')}`,
    );
  }

  const plansRendus = await attendreQue(
    page,
    (v) => v.points.filter((p) => p.etape === 'plan').length === 2 && v.points.filter((p) => p.etape === 'plan' && p.etat === 'fait').length === 2,
    60000,
  );
  noter(
    'le plan rendu se FOND dans le point qui l’annonçait : deux versions, deux points',
    !!plansRendus,
    plansRendus ? plansRendus.points.filter((p) => p.etape === 'plan').map((p) => `${p.rang}/${p.total} ${p.etat}`).join(' · ') : 'non vu',
  );

  /* -------- 4. LA FRISE, AU FORMAT TÉLÉPHONE -------- */

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1200);
  /* CINQ segments, ceux de la frise : le plan se range sous « Compréhension »,
     dont le segment vise le dernier passage commencé — ici le dernier plan. */
  const segments = await page.locator('[data-segment]').count();
  noter('la barre d’étapes est là au format téléphone', segments === 5, `${segments} segment(s)`);
  await deroulerLesEtapes(page);
  await page.locator('[data-segment="comprehension"]').first().click();
  await page.waitForTimeout(1200);
  const surTelephone = await page.evaluate(() => {
    const plans = Array.from(document.querySelectorAll('[data-point="plan"]'));
    const dernier = plans[plans.length - 1];
    const fil = document.querySelector('[data-fil="parcours"]');
    if (!dernier || !fil) return null;
    const p = dernier.getBoundingClientRect();
    const f = fil.getBoundingClientRect();
    return {
      ancre: dernier.getAttribute('data-point-ancre'),
      ouvert: dernier.getAttribute('data-point-ouvert'),
      visible: p.top >= f.top - 4 && p.top < f.bottom,
    };
  });
  noter(
    'toucher la frise mène au DERNIER passage de l’étape, sur téléphone',
    !!surTelephone && surTelephone.ancre === 'point-plan-2' && surTelephone.ouvert === 'oui' && surTelephone.visible,
    surTelephone ? `${surTelephone.ancre}, ouvert ${surTelephone.ouvert}, visible ${surTelephone.visible}` : 'non mesuré',
  );

  noter('aucune erreur de page pendant tout le parcours', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  if (echecs.length) {
    console.log('Manquent : ' + echecs.map((e) => e.nom).join(' ; '));
    process.exit(1);
  }
  /* UN CONTRÔLE QUI NE REND PAS LA MAIN EST UNE PANNE : le démon d'essai tient
     l'événement en vie, et le script restait pendu APRÈS avoir tout affiché —
     son port ensuite occupé faisait échouer le passage suivant. On sort. */
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  console.error(journal.join('').slice(-4000));
  process.exit(1);
});
