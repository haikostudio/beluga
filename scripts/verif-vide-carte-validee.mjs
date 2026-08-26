#!/usr/bin/env node
/**
 * Sous le bloc d'une carte VALIDÉE, un interligne — jamais un grand vide.
 *
 * Le fil d'une conversation occupe toute la hauteur laissée entre l'en-tête et
 * le volet des tâches. Quand l'échange est court — le cas d'un chef qui répond
 * une phrase et propose une carte —, le contenu restait collé EN HAUT et le
 * bas de l'écran était noir sur plus d'un écran de haut. On vérifie ici que la
 * conversation se termine juste sous son dernier bloc, sur téléphone comme sur
 * ordinateur, la proposition ayant été acceptée puis refusée.
 *
 *   node scripts/verif-vide-carte-validee.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve :
 * le démon de production n'est pas touché, et aucun moteur n'est appelé.
 */
import { chromium, webkit } from 'playwright';
import Database from 'better-sqlite3';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script : lancé depuis une copie de travail
   (« .worktrees/… »), il doit juger CE code-là, jamais celui du dossier
   principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7196);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-vide-'));
const SHOTS = path.join(RACINE, 'data', 'verification');
/** L'interligne du fil : « space-y-4 » (16 px) plus la marge basse (12 px). */
const INTERLIGNE_MAX = 36;

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

/* ------------------------------------------------------------------ */
/* Le décor : un projet, un chef, un échange court qui finit sur une   */
/* carte validée — et sa liste de tâches, comme sur les captures.      */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const AGENT_ID = 'a-chef-essai';
const TITRE_CARTE = 'Carte d’essai — proposition validée';

/** Combien d'échanges dorment derrière le repli, dans le cas « fil long ». */
const PRECEDENTS = 40;

/** La description de la carte proposée : longue, comme une vraie. */
const DESCRIPTION_LONGUE = [
  '**Attendu** : le bloc d’une carte validée reprend une hauteur normale, sans laisser',
  'un grand vide sous lui dans la conversation.',
  '',
  '**Limites** : rien d’autre ne bouge dans le fil ; la carte en attente garde son bandeau.',
  '',
  '**Vérification** : valider une carte proposée depuis un téléphone, puis mesurer ce qui',
  'sépare la pastille du reste du message — il ne doit rester qu’un interligne. Parcourir',
  'ensuite la conversation entière, du premier échange au dernier, sur téléphone comme sur',
  'ordinateur, et vérifier qu’aucun autre bloc n’a bougé : la carte refusée, la carte réunie,',
  'la liste des tâches et la barre d’écriture gardent exactement la place qu’elles avaient.',
].join('\n');

function poserLeDecor(decision, replie = false) {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const t = Date.now() - 60_000;

  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3600_000,
    'vérification vide sous carte validée',
  );

  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  for (const table of ['proposals', 'messages', 'agents', 'cards', 'projects']) {
    db.prepare(`DELETE FROM ${table}`).run();
  }

  const projet = {
    id: PROJET_ID,
    name: 'Essai vide',
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

  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    role: 'cadrage',
    title: 'Chef d’orchestre — Essai vide',
    run: { engine: 'claude', model: 'claude-opus-5', thinking: 'medium', mode: 'direct' },
    status: 'done',
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, 'cadrage', 'done', ?, ?, ?)`,
  ).run(AGENT_ID, PROJET_ID, JSON.stringify(agent), t, t);

  const message = (id, role, data, quand) => {
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      AGENT_ID,
      role,
      JSON.stringify({ id, agentId: AGENT_ID, role, createdAt: quand, ...data }),
      quand,
    );
  };

  /* La proposition vit DANS le message : c'est de là que l'interface la
     lit. La table « proposals » ne sert qu'aux décisions en attente. */
  const proposition = {
    id: 'prop-essai',
    title: TITRE_CARTE,
    /* Une description AUSSI LONGUE qu'une vraie (une carte en règle en fait au
       moins 320 signes) : c'est elle qui est repliée à deux lignes dans la
       pastille, et c'est exactement ce repli qui faisait mentir la hauteur du
       bloc sous Safari. Une description courte ne verrait rien. */
    description: DESCRIPTION_LONGUE,
    /* AUCUNE étiquette, et c'est le cas qui compte : le texte replié est alors
       le DERNIER enfant de la pastille — la forme exacte où Safari réservait la
       hauteur du texte entier. Une étiquette posée dessous masquait le défaut,
       et les cartes du chef n'en portent presque jamais. */
    labels: [],
    decision,
    cardId: decision === 'accepted' ? 'c-essai' : undefined,
    decidedAt: t + 2000,
  };

  /* Le cas des captures : des CENTAINES d'échanges dorment derrière un
     nouveau départ (« Voir les N messages précédents »), et seul le dernier
     échange — court — s'affiche. */
  db.prepare('DELETE FROM meta WHERE key = ?').run(`chat.depart.${AGENT_ID}`);
  if (replie) {
    for (let i = 0; i < PRECEDENTS; i += 1) {
      message(
        `m-vieux-${i}`,
        i % 2 ? 'assistant' : 'user',
        { content: `Échange d’avant le nouveau départ n° ${i + 1}.` },
        t - 600_000 + i * 1000,
      );
    }
    db.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(`chat.depart.${AGENT_ID}`, String(t - 1));
  }

  message('m-1', 'user', { content: 'Le bas de la conversation est tout noir.' }, t);
  message(
    'm-2',
    'assistant',
    {
      content: 'Je propose une carte pour corriger cet affichage.',
      steps: [],
      proposals: [proposition],
      todos: [
        { label: 'Lire l’affichage de la conversation', state: 'done', startedAt: t, endedAt: t },
        { label: 'Mesurer l’écart sous le dernier bloc', state: 'done', startedAt: t, endedAt: t },
        { label: 'Proposer la carte', state: 'done', startedAt: t, endedAt: t },
      ],
    },
    t + 1000,
  );
  const db2 = db;
  db2
    .prepare(
      'INSERT INTO proposals (id, message_id, project_id, decision, data, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run('prop-essai', 'm-2', PROJET_ID, decision, JSON.stringify(proposition), t + 1000, t + 2000);

  if (decision === 'accepted') {
    const carte = {
      id: 'c-essai',
      projectId: PROJET_ID,
      title: TITRE_CARTE,
      description: proposition.description,
      labels: ['interface'],
      column: 'planned',
      position: 1,
      /* « agent », la seule origine que le modèle accepte à côté de « user » :
         une carte d'essai mal formée fait tomber la lecture des cartes, et le
         fil reste alors en silhouette — on mesurerait le vide d'un écran de
         chargement. */
      origin: 'agent',
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      scheduling: { asap: false, attempts: 0, restarts: 0, suspendu: false },
      excludedFromDeploy: false,
      horsTache: false,
      createdAt: t + 2000,
      updatedAt: t + 2000,
    };
    db2
      .prepare(
        `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
         VALUES (?, ?, 'planned', 1, ?, ?, ?, ?)`,
      )
      .run('c-essai', PROJET_ID, TITRE_CARTE, JSON.stringify(carte), t + 2000, t + 2000);
  }
  db2.close();
}

/* ------------------------------------------------------------------ */
/* La mesure                                                           */
/* ------------------------------------------------------------------ */

/**
 * Le haut du fil reste-t-il atteignable ? Un fil rangé par le bas ne doit
 * jamais rendre son premier message inaccessible : on remonte tout en haut et
 * on vérifie que le premier bloc est bien visible dans la zone.
 */
async function hautAtteignable(page) {
  return page.evaluate(() => {
    const zone = document.querySelector('[data-fil="conversation"]');
    if (!zone) return false;
    zone.scrollTop = 0;
    const dedans = zone.firstElementChild ?? zone;
    const premier = [...dedans.children].find((n) => n.getBoundingClientRect().height > 0);
    if (!premier) return false;
    const r = premier.getBoundingClientRect();
    const z = zone.getBoundingClientRect();
    return r.top >= z.top - 1 && r.top < z.bottom;
  });
}

/** L'écart entre le bas du dernier bloc du fil et ce qui vient dessous. */
async function mesurer(page) {
  return page.evaluate(() => {
    const zone = document.querySelector('[data-fil="conversation"]');
    if (!zone) return { erreur: 'fil de la conversation introuvable' };
    zone.scrollTop = zone.scrollHeight;
    /* Les messages vivent dans un bloc unique, poussé vers le bas quand
       l'échange est court : on mesure le dernier message qu'il porte. */
    const dedans = zone.firstElementChild ?? zone;
    const blocs = [...dedans.children].filter((n) => n.getBoundingClientRect().height > 0);
    const dernier = blocs[blocs.length - 1];
    if (!dernier) return { erreur: 'aucun bloc dans le fil' };
    const volet = document.querySelector('[data-volet="taches"]');
    const bas = dernier.getBoundingClientRect().bottom;
    const suite = volet ? volet.getBoundingClientRect().top : zone.getBoundingClientRect().bottom;
    return {
      ecart: Math.round(suite - bas),
      volet: Boolean(volet),
      hauteurZone: Math.round(zone.clientHeight),
      hauteurContenu: Math.round(zone.scrollHeight),
      /* De quoi NOMMER la cause quand l'écart est là : le bloc des messages
         est-il plus court que la zone (donc mal poussé vers le bas), ou la
         zone garde-t-elle une hauteur de contenu qu'aucun enfant n'occupe ? */
      hauteurBloc: Math.round(dedans.getBoundingClientRect().height),
      margeHaute: Math.round(parseFloat(getComputedStyle(dedans).marginTop) || 0),
      restePlusBas: Math.round(zone.scrollHeight - zone.scrollTop - zone.clientHeight),
      texte: (dernier.textContent || '').trim().slice(0, 40),
    };
  });
}

/**
 * La pastille d'une carte VALIDÉE et le bloc qui la porte font-ils la même
 * hauteur ?
 *
 * Sous WebKit — Safari, donc tous les navigateurs de l'iPhone —, un `button`
 * qui porte un texte replié à deux lignes réclame à la mise en page la hauteur
 * du texte ENTIER : la pastille se dessinait sur trois lignes, son bloc en
 * réservait vingt, et le reste du message était repoussé de plusieurs centaines
 * de pixels plus bas. On compare donc ce qui est DESSINÉ à ce qui est RÉSERVÉ.
 */
async function mesurerLaPastille(page) {
  return page.evaluate(() => {
    const pastille = document.querySelector('[data-carte-proposee="validee"]');
    if (!pastille) return { erreur: 'aucune pastille de carte validée' };
    const bloc = pastille.parentElement;
    return {
      pastille: Math.round(pastille.getBoundingClientRect().height),
      bloc: Math.round(bloc.getBoundingClientRect().height),
    };
  });
}

async function ouvrir(navigateur, telephone) {
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1400, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
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
  await page.waitForTimeout(6000);
  return { contexte, page, erreurs };
}

/** La conversation du chef : l'entrée « Chef » du projet ouvert. */
async function ouvrirLeChef(page) {
  const chef = page.getByRole('button', { name: /^Chef/ });
  if (await chef.count()) {
    await chef.first().click();
    await page.waitForTimeout(2500);
  }
  /* Sur grand écran la conversation du chef est déjà ouverte : ce qui compte
     est qu'elle soit à l'écran, pas qu'on ait eu à cliquer. */
  return (await page.locator('[data-volet="taches"]').count()) > 0;
}

/* ------------------------------------------------------------------ */

fs.mkdirSync(SHOTS, { recursive: true });

if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}
/* La base n'existe qu'une fois le démon levé : on pose le décor après. */
poserLeDecor('accepted');

const navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
});

try {
  const CAS = [
    { decision: 'accepted', replie: false, nom: 'carte validée', fichier: 'accepted' },
    { decision: 'refused', replie: false, nom: 'carte refusée', fichier: 'refused' },
    /* Le cas des captures : le fil ANNONCE des centaines d'échanges repliés,
       et pourtant ce qu'il montre est court. Il doit finir collé en bas
       exactement comme un fil neuf. */
    {
      decision: 'accepted',
      replie: true,
      nom: 'carte validée, échanges précédents repliés',
      fichier: 'replie',
    },
  ];

  let premier = true;
  for (const { decision, replie, nom: cas, fichier } of CAS) {
    if (!premier) poserLeDecor(decision, replie);
    premier = false;
    for (const telephone of [true, false]) {
      const ecran = telephone ? 'téléphone 390×844' : 'ordinateur 1400×900';
      const { contexte, page, erreurs } = await ouvrir(navigateur, telephone);
      try {
        noter(`${cas} — ${ecran} : la conversation du chef s’ouvre`, await ouvrirLeChef(page));
        if (replie) {
          noter(
            `${cas} — ${ecran} : le bouton « voir les échanges précédents » est là`,
            (await page.getByRole('button', { name: /messages? précédents?/i }).count()) > 0,
          );
        }
        noter(`${cas} — ${ecran} : le haut du fil reste atteignable`, await hautAtteignable(page));
        const m = await mesurer(page);
        await page.screenshot({
          path: path.join(
            SHOTS,
            `vide-carte-${fichier}-${telephone ? 'telephone' : 'ordinateur'}.png`,
          ),
        });
        if (m.erreur) {
          noter(`${cas} — ${ecran} : mesure de l’écart`, false, m.erreur);
          continue;
        }
        noter(
          `${cas} — ${ecran} : sous le dernier bloc, un interligne et non un vide`,
          m.ecart <= INTERLIGNE_MAX,
          `écart ${m.ecart} px (max ${INTERLIGNE_MAX}) — fil ${m.hauteurZone} px, contenu ${m.hauteurContenu} px,` +
            ` bloc ${m.hauteurBloc} px, marge haute ${m.margeHaute} px, reste plus bas ${m.restePlusBas} px`,
        );
        if (decision === 'accepted') {
          const p = await mesurerLaPastille(page);
          noter(
            `${cas} — ${ecran} : la pastille et son bloc font la même hauteur`,
            !p.erreur && Math.abs(p.bloc - p.pastille) <= 2,
            p.erreur ?? `pastille ${p.pastille} px, bloc ${p.bloc} px`,
          );
        }
        if (telephone) {
          noter(`${cas} — ${ecran} : le volet des tâches est bien là`, m.volet === true);
        }
        noter(`${cas} — ${ecran} : aucune erreur de page`, erreurs.length === 0, erreurs[0] ?? '');
      } finally {
        await contexte.close();
      }
    }
  }
} finally {
  await navigateur.close();
}

/* ------------------------------------------------------------------ */
/* La VALIDATION EN DIRECT, sur le moteur de Safari                    */
/*                                                                     */
/* Le défaut ne se voyait NI sous Chrome, NI sur une page ouverte une   */
/* fois la carte déjà validée : il fallait le moteur de l'iPhone ET le  */
/* clic qui remplace la vignette en attente par la pastille. On rejoue  */
/* donc ce geste-là, sur les deux moteurs quand les deux sont posés.    */
/* ------------------------------------------------------------------ */

/** Sous Safari, le bloc réservait la hauteur du texte entier : 428 px de trop. */
const ECART_PASTILLE_MAX = 2;

async function validerEnDirect(navigateur, moteur) {
  poserLeDecor('pending', true);
  const { contexte, page, erreurs } = await ouvrir(navigateur, true);
  try {
    noter(`validation en direct (${moteur}) : la conversation du chef s’ouvre`, await ouvrirLeChef(page));
    const bouton = page.getByRole('button', { name: /Créer la carte/ });
    if (!(await bouton.count())) {
      noter(`validation en direct (${moteur}) : la carte à valider est proposée`, false, 'bouton absent');
      return;
    }
    await bouton.first().click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(SHOTS, `vide-carte-validee-${moteur}.png`) });

    const p = await mesurerLaPastille(page);
    noter(
      `validation en direct (${moteur}) : la pastille et son bloc font la même hauteur`,
      !p.erreur && Math.abs(p.bloc - p.pastille) <= ECART_PASTILLE_MAX,
      p.erreur ?? `pastille ${p.pastille} px, bloc ${p.bloc} px`,
    );

    const m = await mesurer(page);
    noter(
      `validation en direct (${moteur}) : sous le dernier bloc, un interligne et non un vide`,
      !m.erreur && m.ecart <= INTERLIGNE_MAX,
      m.erreur ?? `écart ${m.ecart} px (max ${INTERLIGNE_MAX})`,
    );
    noter(`validation en direct (${moteur}) : aucune erreur de page`, erreurs.length === 0, erreurs[0] ?? '');
  } finally {
    await contexte.close();
  }
}

for (const [moteur, lanceur, options] of [
  ['Safari', webkit, {}],
  ['Chrome', chromium, { channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] }],
]) {
  let navigateur = null;
  try {
    navigateur = await lanceur.launch(options);
  } catch (err) {
    /* Un moteur absent se DIT — il ne se tait pas : le cas n'est pas joué, et
       la ligne le nomme. `npx playwright install webkit` le pose. */
    noter(`validation en direct (${moteur}) : moteur disponible`, false, `non joué — ${String(err).slice(0, 120)}`);
    continue;
  }
  try {
    await validerEnDirect(navigateur, moteur);
  } finally {
    await navigateur.close();
  }
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
