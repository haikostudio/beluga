#!/usr/bin/env node
/**
 * LA CARTE PERMANENTE « NOUVELLE TÂCHE » OUVRE UNE CONVERSATION.
 *
 *   node scripts/verif-carte-fil-cadrage.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et
 * un FAUX moteur : le démon de production n'est pas touché, et pas un jeton
 * n'est dépensé. Tout le parcours est joué à la souris, dans un vrai navigateur.
 *
 * Ce qui est vérifié :
 *   1. le bouton « Nouvelle tâche » est en haut à droite de l'entête de
 *      « Planifié » (le même repère est porté par le bouton du bas de l'écran
 *      du téléphone, monté mais caché ici), et le clic dessus crée la carte
 *      TOUT DE SUITE en ouvrant sa PAGE sur la conversation ; le bouton reste
 *      en place, prêt pour la fois suivante ;
 *   2. rien n'est encore parti au moteur : la conversation invite à dire ce
 *      qu'on veut faire, et AUCUN geste de lancement ne s'affiche encore ;
 *   3. un message ouvre un tour de CADRAGE, sur le modèle économe, et la carte
 *      ne bouge pas de « Demande » — ni en base, NI À L'ÉCRAN pendant le tour ;
 *      la configuration se REPLIE alors et le PARCOURS de la carte prend toute
 *      la place, sous une barre d'étapes sans illustration. Depuis la refonte
 *      du 11/10/2026 ce parcours se lit comme une DISCUSSION : la demande est
 *      une bulle toujours à l'écran, chaque passage tient dans une carte d'une
 *      ligne qu'on ouvre, SEUL LE DERNIER RENDU s'ouvre de lui-même (et rouvrir
 *      un passage d'avant ne referme pas le dernier), le plan est un point du
 *      flux, la barre sert de raccourci ; les onglets de la carte sont les
 *      lignes de la colonne de gauche ;
 *   4. les gestes paraissent alors AU-DESSUS du champ de saisie : « Valider le
 *      plan » et son horloge de programmation sur la même rangée, le pied de
 *      la page ne les redit plus, et l'entête du plan n'en porte aucun ;
 *   5. le clic VALIDE PUIS LANCE, d'un seul geste : la carte passe en
 *      « En cours », prend son titre de la discussion, et l'agent d'exécution
 *      reçoit TOUTE la discussion en contexte de départ.
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

// Le dépôt d'où PART ce script — jamais un chemin écrit en dur : lancé depuis
// une copie de travail, il jugerait sinon le code du dossier principal.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_CADRAGE_PORT || 7207);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-cadrage-'));
const PROJET_ID = 'projet-cadrage';
const DEMANDE = 'Ajouter un bouton pour exporter la liste en CSV';

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le décor : un vrai dépôt git, un faux moteur qui garde ses demandes */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
const DEMANDES = path.join(TMP, 'demandes');
/*
 * UN DOSSIER PERSONNEL À SOI. Sans lui, le démon d'essai adopterait le compte
 * Claude RÉEL de la machine (`bootstrapAccounts` lit `~/.claude`) : le contrôle
 * passerait ou échouerait selon le quota du jour, ce qui n'a rien à voir avec
 * ce qu'il vérifie.
 */
const MAISON = path.join(TMP, 'maison');
const COMPTE = path.join(TMP, 'compte-claude');
for (const dossier of [DATA, PROJETS, DEPOT, DEMANDES, MAISON, COMPTE]) fs.mkdirSync(dossier, { recursive: true });
/* Un compte « connecté » : la lecture de quota partira, échouera faute de jeton
   valable, et laissera le compte DISPONIBLE — ce que fait déjà tout relevé
   illisible. Aucun quota réel n'est consulté. */
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
 * LE FAUX MOTEUR ÉCRIT CHAQUE DEMANDE REÇUE dans un dossier : c'est ainsi qu'on
 * prouve que la discussion de cadrage voyage vraiment jusqu'à l'exécution. Il
 * répond court, sans rien modifier — un tour de cadrage ne code pas.
 */
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

/* LE DÉMON ÉPROUVE D'ABORD LE MOTEUR (« --version »). Sans réponse, aucun
   moteur n'est vu « installé » : l'assistant de démarrage couvre alors tout
   l'écran (auMoinsUnMoteurEnLigne) et plus aucun clic n'atteint le tableau —
   le contrôle tombait au tout premier, sur le « + » de « Planifié ». */
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
  fs.writeFileSync(${JSON.stringify(DEMANDES)} + '/' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.txt', demande);
  dire({ type: 'system', subtype: 'init', session_id: 'session-' + Math.random().toString(16).slice(2) });
  await new Promise((r) => setTimeout(r, 200));
  /* LE FAUX MOTEUR APPELLE LES VRAIS OUTILS DU DÉMON, par son pont : la
     mémoire se cherche par « memoire », la compréhension se rend par
     « rendre_comprehension », le plan par « rendre_plan » — exactement ce
     qu'un vrai moteur fait. Le pont se lit dans la configuration MCP que le
     démon lui passe (« --mcp-config »). */
  const cheminMcp = process.argv[process.argv.indexOf('--mcp-config') + 1];
  const pont = cheminMcp && fs.existsSync(cheminMcp)
    ? JSON.parse(fs.readFileSync(cheminMcp, 'utf8')).mcpServers?.beluga?.env
    : null;
  fs.appendFileSync(${JSON.stringify(TMP)} + '/pont.log', JSON.stringify({ argv: process.argv.slice(2), cheminMcp, pont: !!pont }) + '\\n');
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
      const rendu = await res.json();
      fs.appendFileSync(${JSON.stringify(TMP)} + '/pont.log', JSON.stringify({ name, statut: res.status, rendu }) + '\\n');
      return rendu;
    } catch (err) {
      fs.appendFileSync(${JSON.stringify(TMP)} + '/pont.log', JSON.stringify({ name, erreur: String(err), argv: process.argv, pont: !!pont }) + '\\n');
      return null;
    }
  };
  const execution = /Réalise cette tâche/.test(demande);
  /* L'INTERRUPTEUR « PLAN » ALLUMÉ demande les DEUX dans le même tour : la
     compréhension d'abord, le plan ensuite. */
  const interrupteur = /INTERRUPTEUR . PLAN . EST ALLUM/.test(demande);
  const planDemande = interrupteur || /rends maintenant le PLAN COMPLET/.test(demande);
  if (!execution) {
    /* LE GESTE 1 DU CADRAGE : poser le titre de la carte, seul, avant tout
       autre outil (gesteAutoriseAvantLeTitreDeCadrage, shared/src/cadrage.ts).
       L'identifiant de la carte est écrit dans la demande. */
    const cardId = /Identifiant de cette carte[^:]*:\\s*([0-9a-f-]{36})/i.exec(demande)?.[1];
    if (cardId) await appeler('board_update_card', { cardId, title: ${JSON.stringify(DEMANDE)} });
    const trouve = await appeler('memoire', { geste: 'chercher', demande: 'bouton d’export de la liste' });
    /* …ET IL OUVRE L'UNITÉ TROUVÉE : c'est cette lecture que le relevé note
       (noterUneLecture) et que le point du fil raconte, en direct. */
    const unite = /\\b(?:MEM|DEC)-\\d+\\b/.exec(JSON.stringify(trouve ?? ''))?.[0];
    if (unite) await appeler('memoire', { geste: 'lire', id: unite });
    if (interrupteur) {
      /* Le même tour rend la compréhension PUIS le plan. */
      await appeler('rendre_comprehension', {
        texte: 'Vous voulez un bouton qui exporte la liste en CSV, dans la barre de la liste.',
        resumeDemande: 'Vous demandez un bouton qui enregistre la liste dans un fichier.',
        resumeComprehension: 'Je comprends qu’il faut un bouton d’export dans la barre de la liste.',
        questions_ouvertes: [],
        sujets: ['interface'],
        partieTechnique: {
          taches: [{ titre: 'Poser le bouton', description: 'Dans la barre de la liste.' }],
          faits: ['La barre de la liste est un composant partagé.'],
          risques: 'Le fichier produit peut être vide si la liste l’est.',
        },
      });
    }
    if (planDemande) {
      await appeler('rendre_plan', {
        titre: 'Export CSV de la liste',
        resume: 'Un bouton qui écrit la liste dans un fichier.',
        /* « synthese » et « enClair » (200 signes, deux phrases) sont OBLIGATOIRES : sans eux le plan est refusé. */
        enClair: 'Je vais ajouter un bouton d’export dans la barre de la liste. Un clic suffira pour enregistrer toute la liste dans un fichier. Une fois en place, vous ouvrirez ce fichier dans votre tableur habituel, avec une ligne par élément. Cela vous servira à partager la liste ou à la garder à part.',
        synthese: 'Un bouton va être ajouté dans la barre de la liste. Un clic enregistre toute la liste dans un fichier qui s’ouvre dans un tableur.',
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
        /* Les deux résumés sont OBLIGATOIRES : sans eux l'outil refuse, et le tour est rejoué. */
        resumeDemande: 'Vous demandez un bouton qui enregistre la liste dans un fichier.',
        resumeComprehension: 'Je comprends qu’il faut un bouton d’export dans la barre de la liste, qui écrit un fichier lisible par un tableur.',
        questions_ouvertes: [],
        sujets: ['interface'],
        partieTechnique: {
          taches: [{ titre: 'Poser le bouton', description: 'Dans la barre de la liste.' }],
          faits: ['La barre de la liste est un composant partagé.'],
          risques: 'Le fichier produit peut être vide si la liste l’est.',
        },
      });
    }
  }
  const texte = execution
    ? 'Travail rendu, tout est en place.'
    : planDemande
      ? 'Le plan est rendu.'
      : 'Je comprends votre demande.';
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: texte }] } });
  dire({
    type: 'result',
    subtype: 'success',
    session_id: 'session-essai',
    usage: { input_tokens: 10, output_tokens: 5 },
  });
  process.exit(0);
}
`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

/* ------------------------------------------------------------------ */
/* Le démon                                                            */
/* ------------------------------------------------------------------ */

let demon = null;
const journal = [];

demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
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
    if (fs.existsSync(path.join(TMP, 'pont.log'))) fs.copyFileSync(path.join(TMP, 'pont.log'), '/tmp/verif-cadrage-pont.log');
  } catch {
    /* pas de journal du pont */
  }
  try {
    demon?.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  /* BELUGA_CADRAGE_GARDER : le décor reste sur le disque, pour relire le faux moteur et son journal. */
  if (!process.env.BELUGA_CADRAGE_GARDER) fs.rmSync(TMP, { recursive: true, force: true });
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

/* ------------------------------------------------------------------ */
/* La base : une session d'une heure, un projet, rien d'autre           */
/* ------------------------------------------------------------------ */

const jeton = crypto.randomBytes(24).toString('hex');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const base = (lecture = false) => new Database(path.join(DATA, 'beluga.db'), { readonly: lecture });

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification carte-fil',
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai cadrage',
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

  /* Un compte d'essai, sans quoi rien ne part : une demande sans compte
     disponible attend en file, et le lancement est refusé faute de quota. */
  db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    'compte-essai',
    'claude',
    JSON.stringify({
      id: 'compte-essai',
      engine: 'claude',
      label: 'Compte d’essai',
      priority: 1,
      configDir: COMPTE,
    }),
    maintenant,
  );
  db.close();
}

const cartes = () => {
  const db = base(true);
  const lignes = db.prepare('SELECT id, column_key, title, data FROM cards').all();
  db.close();
  return lignes;
};

const agents = () => {
  const db = base(true);
  const lignes = db.prepare('SELECT id, role, card_id, data FROM agents').all();
  db.close();
  return lignes;
};

const demandesRecues = () =>
  fs
    .readdirSync(DEMANDES)
    .sort()
    .map((nom) => fs.readFileSync(path.join(DEMANDES, nom), 'utf8'));

/* ------------------------------------------------------------------ */

/* LA BARRE D'ACTION porte le geste principal du chapitre (`parcours-carte.tsx`) :
   « Générer le plan » au cadrage, « Lancer la tâche » au plan — devenu un bouton
   SCINDÉ, dont le sous-bouton d'horloge ouvre le tiroir de programmation. */
/*
 * L'ASSISTANT DES MOTEURS NE SE JUGE PAS ICI. Le démon d'essai n'a qu'un compte
 * fabriqué, dont le relevé de quota est refusé par le fournisseur : l'assistant
 * de démarrage couvre alors tout l'écran, à raison — c'est SON contrôle
 * (`verif-assistant-moteurs.mjs`) qui le vérifie. Ici, il empêcherait
 * seulement le premier clic : on le retire de la surface, sans le contredire.
 */
async function ecarterLAssistantDesMoteurs(page) {
  await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });
}

const boutonLancer = (page) => page.locator('[data-geste-principal="valider-et-lancer"]');
/* LA RANGÉE DU PLAN RENDU PORTE « VALIDER LE PLAN » : le geste qui valide PUIS
   lance, en un clic. L'ancien « Lancer la tâche » éteint qui réclamait une
   validation faite ailleurs a disparu. */
const rangeeLancement = (page) => page.locator('[data-barre-action="valider-et-lancer"]');
/* DEUX BOUTONS PORTENT CE REPÈRE depuis la refonte : celui de la tête de
   « Demande » (ordinateur) et celui du bas de l'écran (téléphone, monté mais
   caché ici). Celui qu'on juge est celui de l'entête de la colonne. */
const boutonPlus = (page) => page.locator('[data-tete-colonne="planned"] [data-nouvelle-carte="planned"]');


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
  /* UNE UNITÉ DE LA BASE DE CONNAISSANCES du projet d'essai : c'est elle que le
     cadrage cherche par « memoire ». Elle s'écrit dans la base du démon d'essai,
     une fois ses migrations passées — jamais dans celle de production. */
  process.env.BELUGA_DATA = DATA;
  const connaissances = await import(path.join(RACINE, 'server/dist/connaissances.js'));
  connaissances.proposerUnite(
    PROJET_ID,
    {
      type: 'component',
      importance: 'P2',
      titre: 'Bouton d’export de la liste',
      resume: 'Le bouton d’export vit dans la barre de la liste, à droite de la recherche.',
      sujets: ['interface'],
    },
    { auteur: 'verif-carte-fil-cadrage' },
  );

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
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
  await page.waitForTimeout(5000);
  await ecarterLAssistantDesMoteurs(page);

  /* -------- 1. Le « + » crée la carte et ouvre sa conversation -------- */

  noter(
    'le bouton « Nouvelle tâche » est dans l’entête de « Planifié »',
    (await page.locator('[data-column="planned"] [data-tete-colonne="planned"] [data-nouvelle-carte="planned"]').count()) === 1,
  );
  noter('et elle porte bien son nom', (await boutonPlus(page).innerText()).includes('Nouvelle tâche'));
  await boutonPlus(page).click();
  await page.waitForTimeout(3000);

  const nees = cartes();
  noter('un clic suffit à faire naître la carte', nees.length === 1, `${nees.length} carte(s)`);
  noter('elle naît dans « Planifié »', nees[0]?.column_key === 'planned', nees[0]?.column_key ?? '—');

  /* Le chef d'orchestre du projet existe toujours à côté : on ne juge que les
     agents attachés à LA carte. */
  const agentsDeLaCarte = agents().filter((a) => a.card_id === nees[0]?.id);
  noter(
    'elle naît avec SON agent de cadrage, et lui seul',
    agentsDeLaCarte.length === 1 && agentsDeLaCarte[0].role === 'cadrage',
    agentsDeLaCarte.map((a) => a.role).join(', ') || 'aucun',
  );
  const runCadrage = JSON.parse(agentsDeLaCarte[0]?.data ?? '{}').run ?? {};
  /* Le cadrage prend le MÊME modèle que le chef d'orchestre — épinglé économe.
     On le compare à celui du chef plutôt qu'à un nom écrit en dur : le
     catalogue d'une machine d'essai n'a pas les mêmes modèles qu'ailleurs. */
  const chef = agents().find((a) => a.role === 'cadrage');
  const runChef = JSON.parse(chef?.data ?? '{}').run ?? {};
  noter(
    'il tourne sur le modèle ÉCONOME du chef, pas sur celui d’exécution',
    !!chef && runCadrage.engine === runChef.engine && (runCadrage.model ?? null) === (runChef.model ?? null),
    `cadrage ${runCadrage.model ?? 'défaut'} / chef ${runChef.model ?? 'défaut'}`,
  );
  noter('rien n’est encore parti au moteur', demandesRecues().length === 0, `${demandesRecues().length} demande(s)`);

  /* -------- 2. Le tiroir s'ouvre sur la conversation -------- */

  const tiroir = await page.locator('body').innerText();
  /* PHASE 1 — LA CONFIGURATION D'ABORD. Une tâche neuve ne demande pas le
     besoin : elle demande AVEC QUOI travailler. La carte de configuration est
     posée en tête du fil, sans qu'aucun moteur n'ait été appelé, et la bulle
     compacte des réglages ne paraît pas encore — deux fois le même réglage à
     l'écran, ce serait deux endroits où le changer. */
  noter(
    'la tâche neuve s’ouvre sur la CONFIGURATION de son agent',
    (await page.locator('[data-carte-configuration]').count()) === 1 && tiroir.includes('Configurez l'),
  );
  noter(
    'elle porte les trois réglages en clair, chacun cliquable',
    (await page.locator('[data-ligne-configuration]').count()) >= 3,
  );
  noter(
    'et la bulle compacte des réglages ne double pas la carte',
    (await page.locator('[data-reglages-avant-lancement]').count()) === 0,
  );
  noter('cette carte n’a coûté aucun appel au moteur', demandesRecues().length === 0);
  noter(
    'le tiroir s’ouvre sur la conversation, et son champ invite à écrire la demande',
    /* L'invite « Dites ce que vous voulez faire » n'est plus affichée : la
       configuration passe d'abord, puis le champ d'écriture porte l'invite du chapitre « cadrage » (`LIBELLES_DU_CHAMP`). */
    (await page.locator('[data-composer] textarea').last().getAttribute('placeholder')) === 'Expliquez ou précisez votre besoin…',
  );
  /* LE GESTE EST LÀ, MAIS ÉTEINT : depuis que le cadrage n'a plus qu'une seule
     étape validable, la rangée d'action existe dès l'ouverture du tiroir et DIT
     pourquoi elle ne part pas, au lieu de disparaître. Ce qui est prouvé ici,
     c'est qu'on ne PEUT PAS lancer tant que rien n'est dit. */
  noter(
    'le lancement reste éteint tant que rien n’est dit',
    (await page.locator('[data-barre-action="valider-et-lancer"][data-geste-possible="non"]').count()) === 1 &&
      (await boutonLancer(page).first().isDisabled().catch(() => true)) === true,
  );
  /* Le bouton reste dans l'entête, PRÊT POUR LA FOIS SUIVANTE : la carte
     qui vient de naître se range dessous, dans la bande. */
  const placeTenue = await page.evaluate((id) => {
    const colonne = document.querySelector('[data-column="planned"]');
    if (!colonne) return null;
    const tuile = colonne.querySelector('[data-nouvelle-carte="planned"]');
    const carte = colonne.querySelector(`[data-carte="${id}"]`);
    if (!tuile || !carte) return null;
    return { tuile: tuile.getBoundingClientRect().top, carte: carte.getBoundingClientRect().top };
  }, nees[0]?.id);
  noter(
    'le bouton « Nouvelle tâche » reste en haut, au-dessus de la carte créée',
    !!placeTenue && placeTenue.tuile < placeTenue.carte,
    placeTenue ? `tuile ${Math.round(placeTenue.tuile)}, carte ${Math.round(placeTenue.carte)}` : 'non mesuré',
  );

  /* -------- 3. Un message ouvre le tour de cadrage -------- */

  const champ = page.locator('[data-composer] textarea').last();
  await champ.click();
  await champ.fill(DEMANDE);
  await page.keyboard.press('Enter');

  /*
   * PENDANT TOUT LE TOUR DE CADRAGE, la carte reste RANGÉE DANS « PLANIFIÉ » À
   * L'ÉCRAN. C'était le bug : discuter n'est pas travailler, et pourtant la
   * carte sautait dans « En cours » dès le premier tour — sans qu'on ait jamais
   * cliqué sur « Lancer la tâche ». On échantillonne le tableau PENDANT que le
   * tour tourne, au lieu de ne regarder qu'à la fin.
   */
  let vueAilleurs = null;
  for (let i = 0; i < 24 && vueAilleurs === null; i += 1) {
    await page.waitForTimeout(400);
    const ou = await page.evaluate((id) => {
      const carte = document.querySelector(`[data-carte="${id}"]`);
      return carte?.closest('[data-column]')?.getAttribute('data-column') ?? null;
    }, nees[0]?.id);
    if (ou && ou !== 'planned') vueAilleurs = ou;
  }
  noter(
    'pendant le cadrage, la carte reste AFFICHÉE dans « Planifié »',
    vueAilleurs === null,
    vueAilleurs ? `vue dans « ${vueAilleurs} »` : 'jamais vue ailleurs',
  );

  const apresCadrage = cartes()[0];
  noter('la carte n’a pas bougé de « Demande »', apresCadrage?.column_key === 'planned', apresCadrage?.column_key ?? '—');
  const recues = demandesRecues();
  noter('le tour de cadrage est bien parti', recues.length === 1, `${recues.length} demande(s)`);
  noter(
    'et ce tour ne réclame NI compte rendu à titres NI chiffrage',
    recues.length === 1 && !/Analyse de la demande/.test(recues[0]) && !/machineSeconds/.test(recues[0]),
  );
  noter(
    'l’agent de cadrage reçoit l’identifiant de SA carte, pour l’écrire',
    recues.length === 1 && recues[0].includes(apresCadrage.id),
  );
  /*
   * PHASE 2 — LA DEMANDE EST PARTIE : LA CONVERSATION DEVIENT LE PARCOURS.
   *
   * La carte de configuration s'efface, se REPLIE en une ligne verrouillée, et
   * le journal de la carte prend toute la place sous elle. Il n'y a plus ni fil
   * de bulles ni timeline de cadrage à cet endroit : ils racontaient la même
   * histoire que le parcours, en plus court et à côté.
   */
  noter(
    'la carte de configuration s’efface dès le premier échange',
    (await page.locator('[data-carte-configuration]').count()) === 0,
  );
  noter(
    '…et la configuration se REPLIE en une ligne, modifiable jusqu’à la validation du plan',
    (await page.locator('[data-reglages-agent="modifiable"]').count()) === 1 &&
      (await page.locator('[data-ligne-configuration]').count()) === 0,
  );
  noter(
    '…et l’ancienne bulle de réglages avant lancement n’existe plus',
    (await page.locator('[data-reglages-avant-lancement]').count()) === 0,
  );
  noter(
    'le PARCOURS de la carte prend la place du fil de messages',
    (await page.locator('[data-flux-points]').count()) === 1 &&
      (await page.locator('[data-flux-cadrage]').count()) === 0,
  );
  /*
   * LE PARCOURS SE LIT EN SIX GRANDS POINTS — configuration, demande,
   * compréhension, plan, travail, rapport —, sous une BARRE D'ÉTAPES
   * minimale de CINQ segments, ceux de la frise de « Tableaux de bord » :
   * demande, compréhension, travail, à déployer, archivée,
   * sans illustration. Rien de technique ne s'affiche tant qu'on n'ouvre pas un
   * point : les traces de la machine sont repliées dans le point de leur étape.
   */
  noter(
    'la barre d’étapes est en tête, avec ses cinq segments et sans illustration',
    (await page.locator('[data-barre-etapes]').count()) === 1 &&
      (await page.locator('[data-segment]').count()) === 5 &&
      (await page.locator('[data-barre-etapes] img').count()) === 0,
  );
  noter(
    'le flux porte un passage par étape, la configuration en tête, sans point « Plan » tant qu’aucun plan n’est rendu',
    /* Le point « Plan » n'existe que si la carte a un plan (`laCarteAUnPlan`) :
       cinq passages ici, le plan n'ayant pas été demandé. */
    (await page.locator('[data-flux-liste] > [data-point]').count()) >= 5 &&
      (await page.locator('[data-point="plan"]').count()) === 0 &&
      (await page.locator('[data-point]').first().getAttribute('data-point')) === 'configuration',
    `${await page.locator('[data-flux-liste] > [data-point]').count()} passages`,
  );
  noter(
    'la demande est faite, la compréhension est le point du moment',
    (await page.locator('[data-point="demande"][data-point-etat="fait"]').count()) >= 1 &&
      (await page.locator('[data-segment="comprehension"]').getAttribute('data-segment-etat')) !== 'avenir',
    `compréhension « ${(await page.locator('[data-segment="comprehension"]').getAttribute('data-segment-etat')) ?? '—'} »`,
  );
  /* LE FIL DU TOUR, FAÇON EXTENSION CHROME (13/11/2026) : le travail du cadrage se lit à plat, ses actions réunies
     en groupes repliés ; un clic déplie le détail d'un groupe en blocs racontés. */
  const rouvrirLaReflexion = async () => {
    const fermee = page.locator('[data-point="comprehension"] [data-groupe-bascule][aria-expanded="false"]');
    if (await fermee.count()) {
      await fermee.last().click().catch(() => undefined);
      await page.waitForTimeout(400);
    }
  };
  noter(
    'le travail du cadrage se lit à plat, ses actions groupées et repliées d’office',
    (await page.locator('[data-point="comprehension"] [data-flux-du-tour]').count()) >= 1 &&
      (await page.locator('[data-point="comprehension"] [data-groupe-d-actions]').count()) >= 1 &&
      (await page.locator('[data-point="comprehension"] [data-groupe-detail]').count()) === 0,
  );
  await rouvrirLaReflexion();
  noter(
    'le travail de machine du cadrage se raconte en blocs dans le point « Compréhension »',
    (await page.locator('[data-point="comprehension"] [data-blocs-racontes]').count()) >= 1 &&
      (await page.locator('[data-point="comprehension"] [data-bloc-raconte]').count()) >= 1,
  );
  noter(
    'plus aucun bouton « Détails techniques » de l’ancienne frise',
    (await page.locator('[data-details-techniques]').count()) === 0 &&
      (await page.locator('[data-frise-parcours]').count()) === 0,
  );

  /* LE TEXTE DE LA DEMANDE SE LIT SANS CLIC, ET PLUS RIEN NE LE REPLIE. Depuis
     que le fil est une discussion (refonte du 11/10/2026), ce que vous avez
     écrit est une BULLE, toujours à l'écran (`[data-point-demande]`, hors de
     la carte du passage) : « ouvert d'office » et « replié à la main, il ne
     montre que sa phrase » n'ont plus d'objet. Ce qui se replie, c'est la
     CARTE du passage — quand l'agent y a laissé une trace — et la basculer ne
     touche pas la bulle. */
  const pointDemande = page.locator('[data-point="demande"]:not([hidden])').first();
  const bulleDeLaDemande = pointDemande.locator('[data-point-demande] [data-moment="demande"]');
  const bulleALEcran = (await bulleDeLaDemande.count()) === 1 && (await bulleDeLaDemande.first().isVisible());
  const texteDeLaBulle = bulleALEcran ? await bulleDeLaDemande.first().innerText() : '';
  const horsDeLaCarte = await pointDemande
    .evaluate((point) => !point.querySelector('[data-carte-du-passage] [data-moment="demande"]'))
    .catch(() => false);
  const basculeDeLaDemande = pointDemande.locator('[data-point-bascule="demande"][aria-disabled="false"]');
  const lueApresBascule = [];
  if (await basculeDeLaDemande.count()) {
    for (let geste = 0; geste < 2; geste += 1) {
      await basculeDeLaDemande.first().click();
      await page.waitForTimeout(600);
      lueApresBascule.push((await bulleDeLaDemande.first().isVisible()) && (await bulleDeLaDemande.first().innerText()).includes(DEMANDE));
    }
  }
  noter(
    'le point « Demande » porte le texte exact de la demande dans sa bulle, sans clic, et basculer sa carte ne la replie pas',
    bulleALEcran && texteDeLaBulle.includes(DEMANDE) && horsDeLaCarte && lueApresBascule.every(Boolean),
    `bulle ${bulleALEcran ? 'à l’écran' : 'absente'}, ${texteDeLaBulle.length} signes, ${lueApresBascule.length ? `${lueApresBascule.length} bascule(s) de la carte` : 'passage sans carte à basculer'}`,
  );

  /* LES BOUTONS SECONDAIRES N'EXISTENT QUE DANS LE POINT OUVERT, un geste plus
     loin : ouvrir le point « Compréhension » ne suffit pas, il faut déplier ses
     détails techniques. */
  if ((await page.locator('[data-point="comprehension"][data-point-ouvert="non"]').count()) === 1) {
    await page.locator('[data-point-bascule="comprehension"]').last().click().catch(() => undefined);
    await page.waitForTimeout(400);
  }
  /* LE RÉCIT « MÉMOIRE » DU POINT : l'unité que le faux moteur a ouverte par
     « memoire » (geste « lire ») est notée au relevé des lectures, et le fil la
     raconte SANS RECHARGER la page (`carnet.lignes`). Ce contrôle avait été
     débranché le 13.09.2026 avec l'ancien arbre, et le bloc a disparu de
     l'écran six jours sans que rien ne le dise. */
  const recitMemoire = await page.locator('[data-point="comprehension"] [data-point-memoire-phrase]').last().innerText().catch(() => 'aucun récit');
  noter(
    'le point « Compréhension » raconte ce que l’agent a ouvert dans la mémoire, en direct',
    (await page.locator('[data-point="comprehension"] [data-point-memoire]').count()) >= 1 && /Bouton d’export de la liste/.test(recitMemoire),
    recitMemoire.slice(0, 100),
  );
  noter(
    '…et ce que l’agent a compris se lit dans le point, ouvert d’office',
    (await page.locator('[data-point="comprehension"] [data-moment="comprehension"]').count()) >= 1,
  );
  noter(
    'plus aucun bouton Copier / Exporter, nulle part',
    (await page.locator('[data-point-boutons-secondaires]').count()) === 0 &&
      (await page.locator('[data-point-copier]').count()) === 0 &&
      (await page.locator('[data-point-exporter]').count()) === 0,
  );
  await rouvrirLaReflexion();
  await page.locator('[data-point="comprehension"] [data-bloc-raconte-bascule]').last().click().catch(() => undefined);
  await page.waitForTimeout(500);
  noter(
    '…et le détail exact d’un bloc raconté reste atteignable d’un cran de plus',
    (await page.locator('[data-point="comprehension"] [data-trace]').count()) >= 1,
  );

  /*
   * LA PHRASE EST ELLE-MÊME LA BASCULE, ET SON CHEVRON EST À DROITE.
   *
   * Plus de ligne « voir les commandes exécutées (N) » sous la phrase : le clic
   * se fait SUR la phrase. Elle n'est pas enfermée dans un `button` — un texte
   * de récit se sélectionne à la souris —, donc c'est son CONTENEUR qui porte
   * le rôle et l'`aria-expanded`, et le chevron garde un vrai bouton nommé pour
   * le clavier et les lecteurs d'écran.
   *
   * On juge l'ÉTAT, jamais une hauteur en pixels : la compétence partagée
   * `verifs-navigateur-etat-plutot-que-hauteur` dit pourquoi un contrôle de
   * repliage mesuré en pixels casse à chaque retouche.
   */
  const bascule = page.locator('[data-point="comprehension"] [data-bloc-raconte-bascule]').last();
  const forme = await bascule
    .evaluate((zone) => ({
      balise: zone.tagName.toLowerCase(),
      role: zone.getAttribute('role'),
      phrase: !!zone.querySelector('[data-bloc-raconte-phrase]'),
      chevrons: zone.querySelectorAll('[data-bloc-raconte-chevron]').length,
      nomDuChevron: zone.querySelector('[data-bloc-raconte-chevron]')?.getAttribute('aria-label') ?? '',
    }))
    .catch(() => null);
  noter(
    'la phrase porte la bascule, hors d’un bouton, et son chevron est nommé pour les lecteurs d’écran',
    !!forme &&
      forme.balise !== 'button' &&
      forme.role === 'button' &&
      forme.phrase &&
      forme.chevrons === 1 &&
      forme.nomDuChevron.length > 0,
    JSON.stringify(forme),
  );
  const ouvertApresClic = await bascule.getAttribute('aria-expanded');
  await bascule.click().catch(() => undefined);
  await page.waitForTimeout(400);
  noter(
    '…et son état se lit dans `aria-expanded`, qui bascule au clic',
    ouvertApresClic === 'true' && (await bascule.getAttribute('aria-expanded')) === 'false',
    `${ouvertApresClic} → ${await bascule.getAttribute('aria-expanded')}`,
  );

  /*
   * LE RÉCIT NE MONTRE QUE DU TRAVAIL. Le jalon de lancement (« Tour lancé —
   * claude »), les chargements d'outils (« select:… ») et les identifiants
   * d'appel du pont (« mcp__… ») sont écartés par la règle pure
   * (`estDePlomberie`) : aucun bloc affiché ne doit plus les porter.
   */
  const ditsParLesBlocs = [
    ...(await page.locator('[data-bloc-raconte-titre]').allInnerTexts()),
    ...(await page.locator('[data-bloc-raconte-texte]').allInnerTexts()),
  ];
  const plomberie = ditsParLesBlocs.filter((texte) => /Tour lancé|select:|mcp__|rendre_(?:plan|comprehension)/.test(texte));
  noter(
    'aucun bloc raconté ne porte de plomberie : ni « Tour lancé », ni chargement d’outil, ni identifiant d’appel',
    plomberie.length === 0,
    plomberie.length ? plomberie.slice(0, 3).map((t) => `« ${t.slice(0, 60)} »`).join(', ') : `${ditsParLesBlocs.length} textes lus`,
  );
  /* L'ONGLET « PARCOURS » A DISPARU : la même histoire ne se lit plus à deux
     endroits. On juge les onglets eux-mêmes, pas le code — et ils ont quitté
     la barre du tiroir (`data-barre-onglets`) : sur ordinateur, les options de
     la tâche sont les lignes de la colonne de gauche (`data-options-de-carte`,
     une ligne `data-onglet-carte` par onglet). */
  const ongletsDeLaCarte = await page
    .locator(`aside[data-zone="gauche"] [data-options-de-carte="${nees[0]?.id}"] [data-onglet-carte]`)
    .evaluateAll((lignes) => lignes.map((ligne) => ({ cle: ligne.getAttribute('data-onglet-carte'), nom: (ligne.textContent ?? '').trim() })));
  noter(
    'plus aucun onglet « Parcours » ne double la conversation',
    ongletsDeLaCarte.some((onglet) => onglet.cle === 'chat') &&
      !ongletsDeLaCarte.some((onglet) => /parcours/i.test(`${onglet.cle} ${onglet.nom}`)),
    ongletsDeLaCarte.map((onglet) => onglet.nom).join(' / ') || 'aucun onglet trouvé dans la colonne',
  );
  /* LA BARRE D'ÉCRITURE SURVIT À TOUT : c'est par elle que part la demande
     suivante, que se répond une question et que se lance la tâche. */
  noter(
    '…et la barre d’écriture est toujours là, sous le parcours',
    (await page.locator('[data-composer] textarea').count()) >= 1,
  );

  /*
   * ET LE PARCOURS NE S'ARRÊTE PAS AU PREMIER PLAN. Un second message repart
   * dans la MÊME conversation, et le FLUX GRANDIT : une itération de plus,
   * c'est un point de plus — il ne recommence pas ailleurs, et il ne revient
   * pas s'empiler dans le point d'avant.
   */
  const passagesAvant = await page.locator('[data-flux-liste] > [data-point]').count();
  const comprehensionsAvant = await page.locator('[data-point="comprehension"]').count();
  await champ.click();
  await champ.fill('Ajoute aussi l’export en PDF');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(6000);
  const passagesApres = await page.locator('[data-flux-liste] > [data-point]').count();
  const comprehensionsApres = await page.locator('[data-point="comprehension"]').count();
  noter(
    'un second message ALLONGE le flux du même parcours : un point de plus, pas une conversation de plus',
    (await page.locator('[data-flux-points]').count()) === 1 && passagesApres > passagesAvant,
    `${passagesAvant} → ${passagesApres} passages`,
  );
  noter(
    'la deuxième compréhension a SON point, elle ne s’empile pas dans la première',
    comprehensionsApres > comprehensionsAvant,
    `${comprehensionsAvant} → ${comprehensionsApres} points « Compréhension »`,
  );
  /* SEUL LE DERNIER RENDU S'OUVRE DE LUI-MÊME (refonte du 11/10/2026, « des
     cartes qu'on ouvre ») : la compréhension d'avant tient en UNE ligne, sa
     carte repliée — elle ne reste plus dépliée sans clic. */
  const etatsDesComprehensions = () =>
    page.locator('[data-point="comprehension"]').evaluateAll((points) =>
      points.map((point) => ({
        ouvert: point.getAttribute('data-point-ouvert'),
        carte: !!point.querySelector('[data-carte-du-passage="comprehension"] [data-point-phrase]'),
      })),
    );
  const dOffice = await etatsDesComprehensions();
  noter(
    'seule la dernière compréhension s’ouvre d’elle-même ; celle d’avant tient en une ligne, dans sa carte',
    dOffice.length === comprehensionsApres &&
      dOffice.at(-1)?.ouvert === 'oui' &&
      dOffice.slice(0, -1).every((point) => point.ouvert === 'non' && point.carte),
    dOffice.map((point) => point.ouvert).join(' · '),
  );
  /* …ET TOUJOURS PAS D'ACCORDÉON : rouvrir un passage d'avant ne referme pas le
     dernier. Toutes les itérations se relisent dépliées, côte à côte. */
  for (const fermee of await page.locator('[data-point="comprehension"][data-point-ouvert="non"] [data-point-bascule="comprehension"]').all()) {
    await fermee.click();
    await page.waitForTimeout(400);
  }
  noter(
    'rouvrir une compréhension d’avant ne referme pas la dernière : toutes restent dépliées, d’une itération à l’autre',
    (await page.locator('[data-point="comprehension"][data-point-ouvert="oui"]').count()) === comprehensionsApres,
    `${await page.locator('[data-point="comprehension"][data-point-ouvert="oui"]').count()} déplié(s) sur ${comprehensionsApres}`,
  );
  /* LA BARRE NE COMPTE JAMAIS LES ITÉRATIONS : cinq segments, quoi qu'il arrive. */
  noter(
    'la barre garde ses cinq segments malgré les itérations',
    (await page.locator('[data-segment]').count()) === 5,
  );
  /* LE RÉSULTAT SE LIT APRÈS LE TRAVAIL QUI L'A PRODUIT. */
  const ordreDuPoint = await page.evaluate(() => {
    /* Le DERNIER passage : c'est celui du tour qu'on vient de rendre. */
    const points = document.querySelectorAll('[data-point="comprehension"]');
    const point = points[points.length - 1];
    if (!point) return null;
    const rang = (sel) => Array.from(point.children).findIndex((n) => n.matches(sel) || n.querySelector(sel));
    /* Le fil du tour, à plat (13/11/2026), puis la compréhension détachée. */
    return { traces: rang('[data-flux-du-tour]'), carton: rang('[data-moment="comprehension"]') };
  });
  noter(
    'le carton de compréhension se lit APRÈS les blocs racontés',
    !!ordreDuPoint && ordreDuPoint.traces >= 0 && ordreDuPoint.carton > ordreDuPoint.traces,
    ordreDuPoint ? `récit en ${ordreDuPoint.traces}, carton en ${ordreDuPoint.carton}` : 'point non ouvert',
  );
  /* PLUS AUCUNE PHRASE SOUS LES BOUTONS : la raison vit dans l'infobulle. */
  noter(
    'aucune phrase ne s’écrit sous les boutons d’action',
    (await page.locator('[data-raison-du-geste]').count()) === 0,
  );
  /* Le second tour a fini : on attend que le bouton se rallume avant de cliquer. */
  await page.waitForTimeout(1500);

  /* -------- 4. Le bouton s’allume, en pleine largeur, au-dessus du champ -------- */

  /* LE PLAN SE DEMANDE, ET C'EST L'UTILISATEUR QUI LE DÉCIDE. Le geste
     principal du cadrage est « Générer le plan » ; le clic marque la carte
     (`planDemandeA`), l'agent rend le plan par l'outil `rendre_plan`, et le
     chapitre passe au plan : la barre porte alors « Lancer la tâche ». */
  noter(
    'dès la compréhension rendue, le geste principal est « Valider et lancer »',
    (await page.locator('[data-geste-principal="valider-et-lancer"]').count()) === 1,
    `geste « ${(await page.locator('[data-geste-principal]').first().getAttribute('data-geste-principal').catch(() => null)) ?? '—'} »`,
  );
  await demanderUnPlan(page);
  await page.waitForTimeout(8000);
  noter(
    '…et une fois rendu, le plan est un POINT du flux, ouvert d’office, et « Compréhension » (qui le porte) est fait',
    (await page.locator('[data-point="plan"][data-point-ouvert="oui"] [data-bloc-du-plan]').count()) === 1 &&
      (await page.locator('[data-segment="comprehension"][data-segment-etat="fait"]').count()) === 1,
    `bloc ${await page.locator('[data-bloc-du-plan]').count()}, segment « ${(await page.locator('[data-segment="comprehension"]').getAttribute('data-segment-etat').catch(() => null)) ?? '—'} »`,
  );
  /* L'ORDRE DU PASSAGE « PLAN » : ce qui a DEMANDÉ la version en tête, le
     récit du travail, puis le CADRE du plan tout en bas. C'était l'inverse —
     le cadre se lisait avant le récit —, et le fil cessait d'être
     chronologique au seul endroit où on vient décider. */
  const ordreDuPlan = await page.evaluate(() => {
    /* UN POINT « PLAN » PEUT ÊTRE REPLIÉ : le flux en compte autant que de
       versions rendues, et seul celui qui PORTE un cadre de plan est celui
       qu'on mesure. Prendre le premier venu rendait le contrôle muet
       (« null ») au lieu de dire ce qu'il n'avait pas trouvé. */
    const points = [...document.querySelectorAll('[data-point="plan"]')];
    const point = points.find((n) => n.querySelector('[data-bloc-du-plan]')) ?? points[0] ?? null;
    const diagnostic = { points: points.length, cadre: null, recit: null, entete: null };
    if (!point) return diagnostic;
    const cadre = point.querySelector('[data-bloc-du-plan]');
    const recit = point.querySelector('[data-bloc-raconte], [data-blocs-racontes]');
    const entete = point.querySelector('[data-sous-point-flux="demande-du-plan"]');
    const haut = (n) => (n ? n.getBoundingClientRect().top : null);
    return { ...diagnostic, cadre: haut(cadre), recit: haut(recit), entete: haut(entete) };
  });
  noter(
    'le cadre du plan se lit APRÈS le récit du passage, plus avant',
    ordreDuPlan.cadre !== null && (ordreDuPlan.recit === null || ordreDuPlan.cadre > ordreDuPlan.recit),
    JSON.stringify(ordreDuPlan),
  );
  noter(
    '…et ce qui a demandé la version reste en TÊTE du passage',
    ordreDuPlan.cadre !== null && (ordreDuPlan.entete === null || ordreDuPlan.entete < ordreDuPlan.cadre),
    JSON.stringify(ordreDuPlan),
  );

  /* LA CARTE NE BOUGE PAS PENDANT QUE LE PLAN S'ÉCRIT : la colonne « Plan » a
     disparu du tableau, la carte reste posée dans « Demande » du premier
     message jusqu'au lancement. Le plan rendu se lit dans le FLUX de la carte,
     pas dans une colonne de plus. */
  const enPlan = cartes()[0];
  noter(
    'le plan rendu n’a pas fait bouger la carte : elle est restée en « Demande »',
    enPlan?.column_key === 'planned',
    enPlan?.column_key ?? '—',
  );

  /* LA BARRE EST UN RACCOURCI : toucher « Demande » fait défiler jusqu'au point et l'ouvre. */
  await deroulerLesEtapes(page);
  await page.locator('[data-segment="demande"]').click().catch(() => undefined);
  await page.waitForTimeout(800);
  const pointVise = await page.locator('[data-point="demande"]').last().boundingBox();
  const fil = await page.locator('[data-fil="parcours"]').boundingBox();
  noter(
    'toucher un segment de la barre fait défiler jusqu’au point et l’ouvre',
    (await page.locator('[data-point="demande"][data-point-ouvert="oui"]').count()) >= 1 &&
      !!pointVise && !!fil && pointVise.y >= fil.y - 2 && pointVise.y < fil.y + fil.height,
    pointVise && fil ? `point y=${Math.round(pointVise.y)}, fil y=${Math.round(fil.y)}` : 'non mesuré',
  );

  noter('les gestes de lancement paraissent une fois le plan rendu', (await rangeeLancement(page).count()) === 1);
  /* UN PLAN RENDU N'EST PAS UN PLAN ACCEPTÉ, ET LA DÉCISION EST ICI, EN BAS :
     le geste dit « Valider et lancer », il est ALLUMÉ, et son clic écrit la
     validation sur la carte PUIS lance la tâche. */
  noter(
    'le geste du bas est « Valider et lancer », allumé',
    (await boutonLancer(page).count()) === 1 && (await boutonLancer(page).getAttribute('aria-disabled')) === 'false',
    (await boutonLancer(page).getAttribute('aria-disabled')) ?? '—',
  );
  noter(
    'plus aucun bouton « Refuser » : faire affiner, c’est écrire un message',
    (await page.locator('[data-plan-refuser]').count()) === 0,
  );
  noter(
    'et l’entête du plan ne porte plus aucune décision',
    (await page.locator('[data-entete-plan] [data-boutons-plan]').count()) === 0 &&
      (await page.locator('[data-plan-valider]').count()) === 0,
  );
  const cadreRangee = await rangeeLancement(page).boundingBox();
  const cadreBouton = await boutonLancer(page).boundingBox();
  const cadreChamp = await champ.boundingBox();
  noter(
    'ils se tiennent AU-DESSUS du champ de saisie',
    !!cadreRangee && !!cadreChamp && cadreRangee.y + cadreRangee.height <= cadreChamp.y + 2,
    cadreRangee && cadreChamp ? `rangée ${Math.round(cadreRangee.y)}, champ ${Math.round(cadreChamp.y)}` : 'non mesuré',
  );
  noter(
    'la rangée prend TOUTE la largeur de la barre d’écriture',
    !!cadreRangee && !!cadreChamp && Math.abs(cadreRangee.width - cadreChamp.width) < 24,
    cadreRangee && cadreChamp ? `${Math.round(cadreRangee.width)} px contre ${Math.round(cadreChamp.width)} px` : 'non mesuré',
  );
  /* L'HORLOGE DE PROGRAMMATION A QUITTÉ L'ÉCRAN (refonte du 13/11/2026) : seul le lancement reste dans la rangée. */
  void cadreBouton;

  /* -------- 5. Le clic VALIDE PUIS LANCE, discussion comprise -------- */

  await boutonLancer(page).click();
  await page.waitForTimeout(12000);
  noter(
    'le même clic a écrit la validation du plan sur la carte',
    (() => {
      try {
        return !!JSON.parse(cartes()[0]?.data ?? '{}')?.parcours?.comprehensionValidee;
      } catch {
        return false;
      }
    })(),
  );

  const lancee = cartes()[0];
  /* Le faux moteur rend son travail en une seconde : la carte peut déjà être
     rangée en « Terminé » quand on la relit. Ce qui compte, c'est qu'elle ait
     QUITTÉ « Planifié » — le cycle complet a son propre contrôle. */
  noter(
    'la carte quitte « Planifié » pour le travail',
    lancee?.column_key !== undefined && lancee.column_key !== 'planned',
    lancee?.column_key ?? '—',
  );
  noter(
    'elle prend son titre de la discussion, plus « Nouvelle tâche »',
    lancee?.title === DEMANDE,
    lancee?.title ?? '—',
  );
  const roles = agents()
    .filter((a) => a.card_id === lancee?.id)
    .map((a) => a.role)
    .sort();
  noter(
    'un agent d’EXÉCUTION prend la suite du cadrage, et c’est le MÊME agent (un seul par carte, rôle « task »)',
    /* L'agent de cadrage PASSE EN EXÉCUTION : même identifiant, nouveau rôle. */
    roles.length === 1 && roles[0] === 'task',
    roles.join(', '),
  );

  const lancement = demandesRecues().find((texte) => /Réalise cette tâche/.test(texte));
  noter('la demande d’exécution est partie', !!lancement);
  noter(
    'elle emporte TOUTE la discussion de cadrage',
    !!lancement && lancement.includes(DEMANDE) && /FIN DE LA CONVERSATION DE CADRAGE/.test(lancement),
  );
  noter(
    'et elle dit d’où vient cette discussion, pour ne pas la prendre pour une étude',
    !!lancement && /n'a PAS ouvert le projet/.test(lancement),
  );

  noter('aucune erreur de page pendant tout le parcours', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await navigateur.close();
}

main()
  .catch((err) => {
    console.error(err);
    noter('le parcours est allé au bout', false, String(err).split('\n')[0]);
  })
  .finally(() => {
    const rates = resultats.filter((r) => !r.ok).length;
    if (rates && process.env.BELUGA_CADRAGE_JOURNAL) console.log(journal.join(''));
    console.log(`\n${resultats.length - rates}/${resultats.length} au vert`);
    process.exit(rates ? 1 : 0);
  });
