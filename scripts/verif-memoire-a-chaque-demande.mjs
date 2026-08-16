#!/usr/bin/env node
/**
 * LA MÉMOIRE EST FOUILLÉE À CHAQUE DEMANDE, PAS SEULEMENT AU PREMIER TOUR.
 *
 *   npm run build && node scripts/verif-memoire-a-chaque-demande.mjs
 *
 * La recherche ne tournait qu'au LANCEMENT d'une session : la demande de la
 * carte servait de question, et tous les messages suivants ne cherchaient plus
 * rien. La bulle « Mémoire du projet retrouvée » ne portait donc, dès le
 * deuxième message, qu'un rappel générique — « reprise de session, la mémoire a
 * déjà été transmise » — qui ne dit RIEN de la question qu'on vient de poser.
 *
 * Ce script fait le tour ENTIER, pour de vrai : son propre démon, sa base
 * neuve, un FAUX MOTEUR (un vrai processus, aucun jeton dépensé), un dépôt
 * d'essai dont la documentation parle de DEUX sujets sans rapport. Il lance une
 * carte qui parle du premier sujet, puis écrit un message qui parle du SECOND,
 * et constate :
 *   1. le deuxième tour porte, lui aussi, des passages retrouvés ;
 *   2. ces passages répondent au SECOND sujet, pas au premier ;
 *   3. aucun passage déjà servi au premier tour n'est renvoyé ;
 *   4. le bloc parti au moteur nomme la DEMANDE, pas la session ;
 *   5. à l'écran, la bulle s'intitule « Mémoire retrouvée pour cette demande »
 *      et ne porte plus le rappel « Reprise de session ».
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { colonnesDeLaCarte } from '../shared/dist/carte-sql.js';
import { WebSocket } from 'ws';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Le dépôt d'où PART ce script — jamais un chemin écrit en dur.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-memoire-demande-'));
const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
for (const dossier of [DATA, PROJETS, DEPOT]) fs.mkdirSync(dossier, { recursive: true });

/* ------------------------------------------------------------------ */
/* UN PORT LIBRE, CHOISI À L'INSTANT — jamais un numéro écrit en dur    */
/* ------------------------------------------------------------------ */

/*
 * Ce contrôle partait sur le port 7203, fixe. Un démon d'essai OUBLIÉ par une
 * exécution précédente — tuée avant son ménage, ou coupée par le délai d'une
 * carte — reste pourtant à écouter dessus. `attendrePort` voyait alors ce
 * démon-là répondre, croyait le sien démarré, et le décor allait s'écrire dans
 * une base VIDE : « no such table: sessions », un message qui accuse une
 * migration alors que le vrai coupable est un voisin sur le port. Constaté le
 * 16/08/2026 (« haikodev-essai-7203 », resté d'un contrôle antérieur).
 *
 * On demande donc au système un port LIBRE, à l'instant du lancement : deux
 * contrôles peuvent tourner en même temps, un oublié ne gêne plus personne, et
 * plus rien n'est à nettoyer à la main. Un port imposé reste possible, et il
 * est alors ÉPROUVÉ avant de partir — occupé, on le dit et on s'arrête, au lieu
 * de juger le démon de quelqu'un d'autre.
 */
async function portOccupe(port) {
  return new Promise((resolve) => {
    const prise = net.connect(port, '127.0.0.1');
    prise.on('connect', () => (prise.end(), resolve(true)));
    prise.on('error', () => resolve(false));
  });
}

async function choisirLePort() {
  const impose = Number(process.env.HAIKODEV_MEMOIRE_DEMANDE_PORT || 0);
  if (impose) {
    if (await portOccupe(impose)) {
      console.error(
        `Le port ${impose} est déjà occupé — sans doute un démon d'essai oublié.\n` +
          `Ce contrôle jugerait alors le démon de quelqu'un d'autre : il s'arrête.\n` +
          `Laisse HAIKODEV_MEMOIRE_DEMANDE_PORT vide pour qu'il en choisisse un libre tout seul.`,
      );
      process.exit(1);
    }
    return impose;
  }
  // Le système attribue le port : c'est le seul moyen d'en avoir un VRAIMENT
  // libre, sans course entre le moment où on l'éprouve et celui où on le prend.
  return new Promise((resolve, reject) => {
    const serveur = net.createServer();
    serveur.on('error', reject);
    serveur.listen(0, '127.0.0.1', () => {
      const { port } = serveur.address();
      serveur.close(() => resolve(port));
    });
  });
}

const PORT = await choisirLePort();

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le dépôt d'essai : DEUX sujets sans rapport, pour qu'on voie lequel  */
/* la recherche remonte à chaque question                              */
/* ------------------------------------------------------------------ */

const PROJET_ID = 'p-memoire-demande';
const CARTE_ID = 'c-memoire-demande';
const TITRE_CARTE = 'Le déploiement doit fusionner le lot avant de mettre en ligne';
const DESCRIPTION_CARTE =
  "Le déploiement fusionne la branche du lot « À déployer », enregistre, pousse, puis met en ligne selon la procédure du projet.";
// La SECONDE demande, écrite dans la conversation une fois le premier tour fini.
const SECONDE_DEMANDE =
  "Change la voix de la synthèse vocale : je veux le timbre lent, et que la lecture à voix haute d’un message s’arrête au clic.";

fs.mkdirSync(path.join(DEPOT, 'docs', 'regles'), { recursive: true });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# Projet d’essai\n\nUn dépôt monté pour la vérification.\n');
fs.writeFileSync(
  path.join(DEPOT, 'CLAUDE.md'),
  '# Instructions du moteur\n\nCourt et factuel : comment lancer, comment vérifier.\n',
);
fs.writeFileSync(
  path.join(DEPOT, 'docs', 'regles', 'publication.md'),
  [
    '# Publication — règles du moteur',
    '',
    '## Déployer, c’est fusionner le lot « À déployer » puis mettre en ligne',
    '',
    "Le déploiement fusionne la branche du lot « À déployer », enregistre, pousse, puis met en ligne",
    'selon la procédure définie du projet. La mise en production suit ensuite, sur son propre prompt.',
    'Sans procédure écrite, aucune des deux étapes ne part.',
    '',
    '## Ne jamais redémarrer le serveur pendant une publication',
    '',
    'Le démon porte toutes les publications : le couper en tranche une en plein vol. Un redémarrage',
    'demandé est retenu, puis rejoué tout seul dès le dernier travail terminé.',
    '',
  ].join('\n'),
);
fs.writeFileSync(
  path.join(DEPOT, 'docs', 'regles', 'voix.md'),
  [
    '# Voix — règles du moteur',
    '',
    '## Le timbre et la vitesse de la synthèse vocale se règlent',
    '',
    'Trois crans de vitesse sont proposés, du plus lent au plus rapide ; un cran inconnu retombe sur la',
    'vitesse normale, jamais sur un son muet. Le timbre choisi vit dans les réglages du projet.',
    '',
    '## La lecture à voix haute d’un message s’arrête au clic',
    '',
    'Un second clic sur le haut-parleur coupe la lecture en cours : on ne attend jamais la fin du',
    'message pour reprendre la main. Une lecture coupée ne laisse aucun son résiduel.',
    '',
  ].join('\n'),
);
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
execFileSync('git', ['add', '.'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
  cwd: DEPOT,
});

/* ------------------------------------------------------------------ */
/* Un faux moteur : un vrai processus, le vrai flux de Claude          */
/* ------------------------------------------------------------------ */

const FAUX_MOTEUR = path.join(TMP, 'faux-claude.mjs');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/usr/bin/env node
import fs from 'node:fs';
let demande = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (demande += d));
process.stdin.on('end', () => jouer());
setTimeout(() => process.stdin.readable && process.stdin.read(), 50);

const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');

async function jouer() {
  dire({ type: 'system', subtype: 'init', session_id: 'session-essai' });
  // Un vrai travail : sans fichier modifié, la carte repart en « Planifié ».
  try {
    fs.appendFileSync('travail.txt', 'un tour de plus\\n');
  } catch {
    /* dossier introuvable : le tour se juge quand même */
  }
  await new Promise((r) => setTimeout(r, 300));
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'C’est fait, tout est en place.' }] } });
  dire({ type: 'result', subtype: 'success', session_id: 'session-essai', usage: { input_tokens: 120, output_tokens: 20 } });
  process.exit(0);
}
`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

/* ------------------------------------------------------------------ */
/* Le démon d'essai                                                     */
/* ------------------------------------------------------------------ */

let demon = null;
const journal = [];

function lancerLeDemon() {
  demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
    env: {
      ...process.env,
      HAIKODEV_PORT: String(PORT),
      HAIKODEV_HOST: '127.0.0.1',
      HAIKODEV_DATA: DATA,
      HAIKODEV_PROJECTS_ROOT: PROJETS,
      HAIKODEV_WEB: path.join(RACINE, 'web', 'dist'),
      HAIKODEV_CLAUDE_BIN: FAUX_MOTEUR,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  demon.stdout.on('data', (d) => journal.push(String(d)));
  demon.stderr.on('data', (d) => journal.push(String(d)));
}

process.on('exit', () => {
  try {
    demon?.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function attendrePort(limiteMs = 60_000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    // Un démon MORT ne répondra jamais : on le dit tout de suite, avec son
    // journal, au lieu d'attendre une minute pour un « n'a pas démarré » muet.
    if (demon && demon.exitCode !== null) {
      console.error(`Le démon d’essai s’est arrêté (code ${demon.exitCode}) :\n${journal.join('')}`);
      return false;
    }
    if (await portOccupe(PORT)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function attendre(condition, limiteMs = 90_000, pasMs = 500) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, pasMs));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Le décor                                                             */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const base = (readonly = false) =>
  new Database(path.join(DATA, 'haikodev.db'), readonly ? { readonly: true } : undefined);

function poserLeDecor() {
  const db = base();
  const t = Date.now();

  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3_600_000,
    'vérification mémoire à chaque demande',
  );

  const projet = {
    id: PROJET_ID,
    name: 'Essai mémoire par demande',
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
  ).run(projet.id, projet.name, DEPOT, JSON.stringify(projet), t, t);

  db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    'compte-essai',
    'claude',
    JSON.stringify({
      id: 'compte-essai',
      engine: 'claude',
      label: 'Compte d’essai',
      priority: 1,
      configDir: path.join(TMP, 'claude-config'),
    }),
    t,
  );

  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    column: 'planned',
    position: 1,
    title: TITRE_CARTE,
    description: DESCRIPTION_CARTE,
    origin: 'user',
    labels: [],
    attachments: [],
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    createdAt: t,
    updatedAt: t,
  };
  const colonnes = colonnesDeLaCarte(carte);
  const noms = Object.keys(colonnes);
  db.prepare(`INSERT INTO cards (${noms.join(', ')}) VALUES (${noms.map(() => '?').join(', ')})`).run(
    ...noms.map((nom) => colonnes[nom]),
  );

  db.close();
}

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const prise = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { Cookie: `haikodev_session=${jeton}` },
    });
    const id = crypto.randomBytes(6).toString('hex');
    const minuteur = setTimeout(() => (prise.close(), reject(new Error('le démon ne répond pas'))), 90_000);
    prise.on('open', () => prise.send(JSON.stringify({ id, cmd })));
    prise.on('message', (brut) => {
      const evenement = JSON.parse(String(brut));
      if (evenement.type !== 'ack' || evenement.id !== id) return;
      clearTimeout(minuteur);
      prise.close();
      resolve(evenement);
    });
    prise.on('error', (e) => (clearTimeout(minuteur), reject(e)));
  });
}

function agentDeLaCarte() {
  const db = base(true);
  const ligne = db.prepare('SELECT id FROM agents WHERE card_id = ? ORDER BY created_at ASC LIMIT 1').get(CARTE_ID);
  db.close();
  return ligne?.id;
}

/** Les tours réellement partis : un par message qui porte un contexte envoyé. */
function toursEnvoyes() {
  const db = base(true);
  const lignes = db
    .prepare(
      `SELECT m.data FROM messages m JOIN agents a ON a.id = m.agent_id
       WHERE a.card_id = ? ORDER BY m.created_at ASC`,
    )
    .all(CARTE_ID);
  db.close();
  return lignes
    .map((l) => JSON.parse(l.data))
    .filter((m) => m.sentContext)
    .map((m) => m.sentContext);
}

/* ------------------------------------------------------------------ */

async function main() {
  lancerLeDemon();
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  // Le décor est posé après le démarrage : on relance pour que le démon le lise.
  demon.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 1500));
  lancerLeDemon();
  if (!(await attendrePort())) {
    console.error('Le démon n’a pas redémarré :\n' + journal.join(''));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1500));

  /* -------- 1. Le premier tour : la carte parle de PUBLICATION -------- */

  await commande({ type: 'card.start', id: CARTE_ID });
  const premierFini = await attendre(async () => {
    const etat = await commande({ type: 'daemon.status' });
    return (etat.data?.etat?.agentsEnCours ?? 1) === 0 && toursEnvoyes().length >= 1;
  });
  noter('le premier tour est allé jusqu’au bout', premierFini);
  await new Promise((r) => setTimeout(r, 1500));

  const tour1 = toursEnvoyes()[0];
  const sources1 = (tour1?.passages ?? []).map((p) => p.source);
  /*
   * Au LANCEMENT, la recherche remplace l'index de toute la mémoire : sur un
   * projet d'essai dont la mémoire tient en deux pages, l'index reste le moins
   * cher et la recherche s'efface d'elle-même (`rechercheRentable`). Les deux
   * issues sont donc justes — ce qui ne l'est pas, c'est que le tour n'emporte
   * NI passages NI mémoire du projet.
   */
  const memoire1 = (tour1?.blocks ?? []).find((b) => b.kind === 'memory');
  noter(
    'le premier tour emporte la mémoire du projet : ses passages, ou l’index en repli',
    sources1.some((s) => s.includes('publication.md')) || Boolean(memoire1?.text),
    sources1.join(', ') || (memoire1?.label ?? 'rien'),
  );
  noter(
    'le premier tour ne remonte pas la règle de VOIX : personne ne l’a demandée',
    !sources1.some((s) => s.includes('voix.md')),
    sources1.join(', ') || 'aucun passage',
  );

  /* -------- 2. Le second tour : un message qui parle de VOIX --------- */

  const agentId = agentDeLaCarte();
  noter('l’agent de la carte est retrouvé', !!agentId, agentId ?? '');
  await commande({ type: 'agent.prompt', agentId, text: SECONDE_DEMANDE });

  const secondFini = await attendre(async () => {
    const etat = await commande({ type: 'daemon.status' });
    return (etat.data?.etat?.agentsEnCours ?? 1) === 0 && toursEnvoyes().length >= 2;
  });
  noter('le second tour est allé jusqu’au bout', secondFini);
  await new Promise((r) => setTimeout(r, 2000));

  const tours = toursEnvoyes();
  const tour2 = tours[tours.length - 1];
  const passages2 = tour2?.passages ?? [];
  const sources2 = passages2.map((p) => p.source);

  noter(
    'LE SECOND TOUR CHERCHE AUSSI : il porte ses propres passages',
    passages2.length > 0,
    sources2.join(', ') || `aucun passage — raison : ${tour2?.passagesRaison ?? '(aucune)'}`,
  );
  noter(
    'ils répondent à LA demande envoyée (la voix), pas à la carte (la publication)',
    sources2.some((s) => s.includes('voix.md')),
    sources2.join(', ') || 'aucun passage',
  );
  noter(
    'plus aucun rappel générique « reprise de session » à la place de la recherche',
    !/Reprise de session/.test(tour2?.passagesRaison ?? ''),
    tour2?.passagesRaison ?? '(aucune raison : des passages ont été retrouvés)',
  );

  /* -------- 3. La MÊME question, reposée : rien n'est renvoyé deux fois --- */

  await commande({ type: 'agent.prompt', agentId, text: SECONDE_DEMANDE });
  const troisiemeFini = await attendre(async () => {
    const etat = await commande({ type: 'daemon.status' });
    return (etat.data?.etat?.agentsEnCours ?? 1) === 0 && toursEnvoyes().length >= 3;
  });
  noter('le troisième tour est allé jusqu’au bout', troisiemeFini);
  await new Promise((r) => setTimeout(r, 2000));

  const tour3 = toursEnvoyes()[2];
  const cles2 = new Set(passages2.map((p) => `${p.source}#${p.titre}`));
  noter(
    'un passage déjà servi dans la session ne repart JAMAIS une seconde fois',
    (tour3?.passages ?? []).every((p) => !cles2.has(`${p.source}#${p.titre}`)),
    (tour3?.passages ?? []).map((p) => p.titre).join(' | ') || 'aucun passage renvoyé',
  );
  noter(
    'et la raison le dit : la recherche a bien tourné, sans rien de neuf',
    (tour3?.passages ?? []).length > 0 || /a bien tourné sur cette demande/.test(tour3?.passagesRaison ?? ''),
    tour3?.passagesRaison ?? '(des passages ont été retrouvés)',
  );

  /* -------- 4. Le bloc parti au moteur nomme la DEMANDE -------- */

  const blocMemoire2 = (tour2?.blocks ?? []).find((b) => b.kind === 'memory');
  noter(
    'le bloc envoyé au moteur nomme la demande, pas la session',
    /cette demande/i.test(blocMemoire2?.label ?? ''),
    blocMemoire2?.label ?? 'aucun bloc de mémoire',
  );
  noter(
    'le bloc dit qu’il n’est qu’un complément, jamais toute la mémoire',
    /complément/i.test(blocMemoire2?.text ?? ''),
  );
  noter(
    'le second tour ne renvoie ni le briefing ni l’index complet',
    !(tour2?.blocks ?? []).some((b) => b.kind === 'briefing'),
    (tour2?.blocks ?? []).map((b) => b.kind).join(', '),
  );

  /* -------- 5. À l'écran : la bulle nomme la demande -------- */

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
    await contexte.addCookies([
      {
        name: 'haikodev_session',
        value: jeton,
        url: `http://127.0.0.1:${PORT}`,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(5000);

    // La conversation d'une carte vit dans son TIROIR : on l'ouvre comme un
    // utilisateur, en cliquant la carte, puis on passe sur « Conversation ».
    const carte = page.locator('article').filter({ hasText: TITRE_CARTE }).first();
    await carte.waitFor({ state: 'visible', timeout: 30_000 });
    await carte.click();
    await page.waitForTimeout(2000);
    const panneau = page.getByRole('dialog').last();
    const onglet = panneau.getByRole('tab', { name: 'Conversation' });
    if (await onglet.count()) await onglet.first().click();
    await page.waitForTimeout(2000);

    const bulles = panneau.locator('[data-bulle-prompt="memoire"]');
    const combien = await bulles.count();
    noter('les bulles de mémoire sont bien à l’écran, une par tour parti', combien >= 2, `${combien} bulle(s)`);

    const derniere = bulles.last();
    await derniere.locator('[data-voir-plus]').first().click().catch(() => {});
    await page.waitForTimeout(400);
    const texteBulle = combien ? await derniere.innerText() : '';
    noter(
      'la bulle du dernier tour s’intitule « Mémoire retrouvée pour cette demande »',
      /Mémoire retrouvée pour cette demande/.test(texteBulle),
      texteBulle.split('\n')[0] ?? '',
    );
    /*
     * LA BULLE DU SECOND TOUR — celle qui portait le rappel générique avant
     * cette carte. Elle doit nommer le fichier retrouvé pour CETTE demande.
     * (La dernière, elle, est celle du troisième tour : la même question
     * reposée, dont les passages ont déjà été transmis.)
     */
    const bulleDuSecond = bulles.nth(1);
    await bulleDuSecond.locator('[data-voir-plus]').first().click().catch(() => {});
    await page.waitForTimeout(400);
    const texteSecond = combien > 1 ? await bulleDuSecond.innerText() : '';
    noter(
      'la bulle du second tour nomme le fichier réellement retrouvé pour sa demande',
      /voix\.md/.test(texteSecond),
      texteSecond.slice(0, 140).replace(/\n/g, ' '),
    );
    noter(
      'et elle ne porte aucun rappel « Reprise de session »',
      !/Reprise de session/.test(texteSecond),
    );
    noter('aucune erreur de page', erreurs.length === 0, erreurs.join(' | '));
  } finally {
    await navigateur.close();
  }

  const rates = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - rates.length}/${resultats.length} vérifications passées`);
  if (rates.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  console.error(journal.slice(-40).join(''));
  process.exit(1);
});
