#!/usr/bin/env node
/**
 * LA CARTE DU RENDEZ-VOUS DE NUIT SE LIT DEMANDE, EXAMEN, PROPOSITIONS.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-carte-de-nuit.mjs
 *
 * Elle imitait une tâche : « Compréhension » sautée, « Travail fait », puis
 * « À déployer » et « Archivée » (capture du 07.10.2026). Ce contrôle ouvre
 * une carte de nuit rangée, sur téléphone puis sur ordinateur, et juge :
 *  - la barre d'étapes : trois ronds, Demande, Examen, Propositions ;
 *  - le fil : trois passages, chacun sous sa marque d'étape (Demande, Examen,
 *    Propositions), aucun « sautée », aucun point « Déploiement » ;
 *  - les cartes nées de la nuit : une ligne chacune, au titre de la carte
 *    réelle, qui l'ouvre d'un clic ;
 *  - le repère de la liste : « Points examinés — 3/3 » ;
 *  - une carte proposée par la nuit garde, elle, son parcours de tâche.
 *
 * Pour rejouer une VRAIE nuit (lue seule, jamais écrite), donner sa base et
 * sa carte : NUIT_BASE=/chemin/beluga.db NUIT_CARTE=<id> — son journal et son
 * fil sont recopiés dans la base neuve du démon d'essai.
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve :
 * aucun moteur appelé, aucun quota dépensé. Captures dans /tmp/verif-carte-de-nuit.
 *
 * RECALÉ SUR LA REFONTE (11/10/2026). Le fil d'une carte est une discussion :
 * le nom d'un passage ne s'écrit plus sur sa bascule (`data-point-bascule`, qui
 * n'existe que pour un passage ayant une carte à déplier — la « Demande » n'en
 * a pas) mais sur sa marque d'étape, centrée entre les messages
 * (`data-marque-d-etape`). Les passages se comptent donc sur les `[data-point]`
 * AFFICHÉS, et leurs noms se lisent sur leurs marques. Sur téléphone, la barre
 * d'étapes garde tous ses ronds mais n'ÉCRIT que le nom de l'étape mise en
 * avant (`barre-etapes.tsx`) : les trois noms y sont jugés sur ce que chaque
 * rond porte, et celui qui s'affiche doit être le bon. Enfin une étape
 * « sautée » ne se dessine plus dans le fil (`data-point-avenir="sautee"` a
 * disparu) : elle y reste cachée, « à venir », et c'est là qu'on la cherche.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_NUIT_PORT || 7243);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = '/tmp/verif-carte-de-nuit';

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-nuit-', port: PORT });

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-nuit';
const NUIT = { id: 'c-nuit', agent: 'ag-nuit', titre: 'Auto-amélioration — nuit d’essai' };
/* La première carte proposée EXISTE, et son titre a changé depuis la
   proposition : c'est celui de la carte qui doit se lire. La seconde n'existe
   plus : son lien reste, la page dira ce que le serveur répond. */
const PROPOSEE = { id: 'c-proposee', agent: 'ag-proposee', titre: 'Carte proposée — titre réel' };
const DISPARUE = 'c-disparue';
const POINTS = [
  'Relire les fiches de mémoire modifiées depuis hier',
  'Chercher du code inutilisé ou en double',
  'Vérifier chaque trouvaille et proposer les cartes',
];

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification carte de nuit',
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai nuit',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, 0, JSON.stringify(projet), maintenant, maintenant);

  const poserAgent = (cible, role, status = 'done') => {
    const agent = {
      id: cible.agent,
      projectId: PROJET_ID,
      cardId: cible.id,
      role,
      title: cible.titre,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      status,
      startedAt: maintenant - 600_000,
      endedAt: maintenant - 60_000,
      createdAt: maintenant - 600_000,
      updatedAt: maintenant,
    };
    db.prepare(
      `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(agent.id, PROJET_ID, cible.id, role, status, JSON.stringify(agent), agent.createdAt, maintenant);
  };
  const poserCarte = (cible, colonne, labels, enPlus = {}) => {
    const carte = {
      id: cible.id,
      projectId: PROJET_ID,
      title: cible.titre,
      description: 'Un agent d’analyse relit « Essai nuit » et propose au plus trois améliorations.',
      labels,
      column: colonne,
      position: 1,
      origin: 'agent',
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      scheduling: { asap: false, attempts: 1, restarts: 0 },
      agentId: cible.agent,
      createdAt: maintenant - 600_000,
      updatedAt: maintenant,
      ...enPlus,
    };
    db.prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description, agent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(carte.id, PROJET_ID, colonne, 1, carte.title, JSON.stringify(carte), carte.createdAt, maintenant, carte.description, cible.agent);
    labels.forEach((label, position) =>
      db.prepare('INSERT INTO card_labels (card_id, position, label) VALUES (?, ?, ?)').run(cible.id, position, label),
    );
  };

  poserAgent(NUIT, 'analysis');
  poserCarte(NUIT, 'archived', ['rendez-vous de nuit'], { archivedAt: maintenant, doneAt: maintenant });
  poserAgent(PROPOSEE, 'cadrage', 'idle');
  poserCarte(PROPOSEE, 'planned', ['auto amélioration'], { origin: 'agent' });

  const entree = db.prepare(
    `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id,
                               libelle, outil, params, resultat, reussie, duree_ms, etat, donnees)
     VALUES (@id, @card_id, @rang, @phase, @nature, @at, @agent_id, @agent_role, @tour_id,
             @libelle, @outil, @params, @resultat, @reussie, @duree_ms, @etat, @donnees)`,
  );
  const message = db.prepare(
    `INSERT INTO messages (id, agent_id, role, data, created_at, a_questions, streaming) VALUES (?, ?, ?, ?, ?, 0, 0)`,
  );

  /* UNE VRAIE NUIT, recopiée telle quelle : journal et fil de son agent. */
  if (process.env.NUIT_BASE && process.env.NUIT_CARTE) {
    const source = new Database(process.env.NUIT_BASE, { readonly: true });
    const vraie = source.prepare('SELECT agent_id FROM cards WHERE id = ?').get(process.env.NUIT_CARTE);
    for (const ligne of source.prepare('SELECT * FROM card_journal WHERE card_id = ? ORDER BY rang').all(process.env.NUIT_CARTE)) {
      entree.run({ ...ligne, id: `v-${ligne.id}`, card_id: NUIT.id, agent_id: NUIT.agent });
    }
    const messages = source.prepare('SELECT * FROM messages WHERE agent_id = ? ORDER BY created_at').all(vraie.agent_id);
    let premiere = true;
    for (const ligne of messages) {
      const data = JSON.parse(ligne.data);
      data.agentId = NUIT.agent;
      for (const proposition of data.proposals ?? []) {
        if (proposition.cardId) proposition.cardId = premiere ? PROPOSEE.id : DISPARUE;
        if (proposition.cardId) premiere = false;
      }
      message.run(`v-${ligne.id}`, NUIT.agent, ligne.role, JSON.stringify(data), ligne.created_at);
    }
    source.close();
    db.close();
    return;
  }

  /* UNE NUIT D'ESSAI, sur le modèle de celle du 07.10.2026. */
  let rang = 0;
  const poser = (partiel) =>
    entree.run({
      id: `j-${rang}`,
      card_id: NUIT.id,
      rang: rang++,
      phase: 'execution',
      nature: 'requete',
      at: maintenant - 500_000 + rang * 1000,
      agent_id: NUIT.agent,
      agent_role: 'analysis',
      tour_id: 't-nuit',
      libelle: '',
      outil: null,
      params: null,
      resultat: null,
      reussie: 1,
      duree_ms: null,
      etat: null,
      donnees: null,
      ...partiel,
    });
  poser({ nature: 'jalon', libelle: 'Tour lancé' });
  for (const point of POINTS) poser({ nature: 'point', libelle: point, etat: 'done' });
  poser({ outil: 'memoire', libelle: 'memoire', params: '{"geste":"lire","id":"MEM-1"}', resultat: '# MEM-1 — Une fiche' });
  poser({ nature: 'jalon', libelle: 'Note de l’agent', resultat: 'Je cherche du code mort.' });
  poser({ phase: 'rapport', nature: 'jalon', libelle: 'Réponse rendue', resultat: 'Cette nuit, j’ai retenu deux propositions.' });

  const proposition = (id, titre, cardId) => ({
    id,
    title: titre,
    description: 'Proposée par la nuit.',
    labels: ['auto amélioration'],
    attachments: [],
    sourceProposalIds: [],
    decision: 'accepted',
    cardId,
  });
  const fil = {
    id: 'm-nuit',
    agentId: NUIT.agent,
    role: 'assistant',
    content: 'Cette nuit, j’ai retenu deux propositions. Je n’ai modifié aucun fichier.',
    steps: [],
    todos: POINTS.map((label, i) => ({ id: `t${i}`, label, state: 'done' })),
    proposals: [
      proposition('p1', 'Titre de la proposition, changé depuis', PROPOSEE.id),
      proposition('p2', 'Proposition dont la carte a disparu', DISPARUE),
    ],
    questions: [],
    createdAt: maintenant - 60_000,
  };
  message.run(fil.id, NUIT.agent, 'assistant', JSON.stringify(fil), fil.createdAt);
  db.close();
}

const ouvrir = async (page, cardId) => {
  await page.goto(`${BASE}/#projet/${PROJET_ID}/tache/${cardId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
};

async function juger(page, nom) {
  await ouvrir(page, NUIT.id);
  const segments = await page.locator('[data-barre-etapes] [data-segment]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-segment')),
  );
  noter(`${nom} : la barre a trois ronds, Demande, Examen, Propositions`, segments.join(',') === 'demande,examen,propositions', segments.join(','));
  /* LES NOMS DES RONDS. Sur ordinateur les trois s'écrivent à côté de leur
     rond. Sur téléphone la barre n'ÉCRIT que celui de l'étape mise en avant
     (trois noms ne tiennent pas à côté de trois ronds sur 390 px) : chaque
     rond PORTE toujours son nom — c'est lui qu'on juge —, et tout nom affiché
     doit être celui de son rond, celui de l'étape mise en avant l'étant. */
  const ronds = await page.locator('[data-barre-etapes] [data-segment]').evaluateAll((els) =>
    els.map((el) => ({
      porte: (el.textContent ?? '').trim(),
      affiche: (el.innerText ?? '').trim(),
      infobulle: el.getAttribute('title') ?? '',
      enAvant: el.getAttribute('aria-current') === 'step',
    })),
  );
  const portes = ronds.map((r) => r.porte).join(',');
  const affiches = ronds.map((r) => r.affiche).join(',');
  if (nom === 'telephone') {
    noter(
      `${nom} : les ronds portent Demande, Examen, Propositions, et celui mis en avant écrit son nom`,
      portes === 'Demande,Examen,Propositions' &&
        ronds.map((r) => r.infobulle).join(',') === 'Demande,Examen,Propositions' &&
        ronds.filter((r) => r.enAvant).length === 1 &&
        ronds.every((r) => (r.enAvant ? r.affiche === r.porte : r.affiche === '' || r.affiche === r.porte)),
      `portés : ${portes} — affichés : ${affiches}`,
    );
  } else {
    noter(`${nom} : leurs noms se lisent à côté des ronds`, affiches === 'Demande,Examen,Propositions', affiches);
  }

  /* LES PASSAGES DU FIL : un `[data-point]` AFFICHÉ par passage (ce qui n'est
     pas arrivé reste dans le document, caché), chacun sous sa marque d'étape. */
  const passages = await page.locator('[data-point]:not([hidden])').evaluateAll((els) =>
    els.map((el) => ({
      etape: el.getAttribute('data-point'),
      marque: (el.querySelector(':scope > [data-marque-d-etape]')?.innerText ?? '').trim(),
    })),
  );
  const points = passages.map((p) => p.etape);
  noter(`${nom} : le fil n’a que trois points`, points.join(',') === 'demande,travail,rapport', points.join(','));
  const titres = passages.map((p) => p.marque);
  noter(
    `${nom} : ils s’intitulent Demande, Examen, Propositions`,
    titres.length === 3 && titres[0] === 'Demande' && titres[1] === 'Examen' && titres[2] === 'Propositions',
    titres.join(' | '),
  );
  /* AUCUNE ÉTAPE « SAUTÉE ». Le repère d'avant (`data-point-avenir="sautee"`,
     sur le point du fil) n'existe plus : une étape sautée est un passage
     « à venir » sans contenu, que la discussion garde CACHÉ dans le document
     (`[data-point][data-point-etat="avenir"]`), et que la barre dit non
     atteinte (`[data-point-avenir]` sur son rond). La carte de nuit rangée
     n'en a aucune, ni dans le fil ni dans la barre. */
  const nonFranchies = await page.evaluate(() => ({
    fil: [...document.querySelectorAll('[data-point][data-point-etat="avenir"]')].map((el) => el.getAttribute('data-point')),
    barre: [...document.querySelectorAll('[data-barre-etapes] [data-point-avenir]')].map((el) => el.getAttribute('data-segment')),
  }));
  noter(
    `${nom} : aucune étape « sautée »`,
    nonFranchies.fil.length === 0 && nonFranchies.barre.length === 0,
    [...nonFranchies.fil.map((e) => `fil : ${e}`), ...nonFranchies.barre.map((e) => `barre : ${e}`)].join(', '),
  );
  noter(`${nom} : aucun point « Déploiement »`, (await page.locator('[data-point="deploiement"]').count()) === 0);

  const liens = page.locator('[data-ouvrir-proposition]');
  noter(`${nom} : une ligne par carte née de la nuit`, (await liens.count()) === 2, `${await liens.count()} ligne(s)`);
  if (!process.env.NUIT_CARTE) {
    /* Le titre ACTUEL de la carte, lu en base : le démon peut l'avoir réécrit. */
    const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
    const reel = db.prepare('SELECT title FROM cards WHERE id = ?').get(PROPOSEE.id)?.title;
    db.close();
    const premier = (await liens.first().innerText()).split('\n')[0].trim();
    noter(`${nom} : la ligne porte le titre de la carte réelle, pas celui de la proposition`, !!reel && premier === reel, `${premier} / ${reel}`);
  }
  const repere = await page.getByText(/Points examinés — \d+\/\d+/).count();
  noter(`${nom} : la liste s’intitule « Points examinés »`, repere > 0);
  noter(`${nom} : plus de « Liste des tâches — n/N faites »`, (await page.getByText(/Liste des tâches — \d/).count()) === 0);
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`), fullPage: false });
  await page.locator('[data-point-bascule="rapport"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(CAPTURES, `${nom}-propositions.png`), fullPage: false });

  /* LE CLIC OUVRE LA CARTE PROPOSÉE. */
  await liens.first().click();
  await page.waitForTimeout(3000);
  noter(`${nom} : le clic ouvre la carte proposée`, decodeURIComponent(page.url()).includes(`/tache/${PROPOSEE.id}`), page.url());
  /* …QUI GARDE SON PARCOURS DE TÂCHE. */
  const segmentsProposee = await page.locator('[data-barre-etapes] [data-segment]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-segment')),
  );
  noter(
    `${nom} : la carte proposée garde ses cinq ronds de tâche`,
    segmentsProposee.join(',') === 'demande,comprehension,travail,a_deployer,archivee',
    segmentsProposee.join(','),
  );
}

async function main() {
  fs.mkdirSync(CAPTURES, { recursive: true });
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const erreurs = [];
  for (const [nom, options] of [
    ['telephone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ['ordinateur', { viewport: { width: 1440, height: 900 } }],
  ]) {
    const contexte = await navigateur.newContext({ ...options, locale: 'fr-CH', serviceWorkers: 'block' });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    page.on('pageerror', (e) => erreurs.push(String(e)));
    await juger(page, nom);
    await contexte.close();
  }
  noter('aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await navigateur.close();
  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} au vert — captures dans ${CAPTURES}`);
  process.exit(echecs ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
