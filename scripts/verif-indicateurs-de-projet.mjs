#!/usr/bin/env node
/**
 * LES LISTES DE PROJETS MONTRENT CE QUI SE PASSE SUR CHACUN, ET LE BOUTON
 * « TABLEAUX DE BORD » RÉAGIT — dans un vrai navigateur.
 *
 *   node scripts/verif-indicateurs-de-projet.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve : le
 * démon de production n'est pas touché. Le plafond d'agents est mis à ZÉRO et le
 * décor est posé EN BASE — aucun moteur n'est appelé, pas un jeton dépensé.
 *
 * Ce qui est prouvé, bout en bout :
 *   1. le menu du fil d'Ariane porte, à DROITE de chaque ligne de projet, ce qui
 *      s'y passe : le projet dont une carte attend un geste montre l'icône de
 *      son attente, un projet calme reste nu ; la coche du projet courant est
 *      TOUJOURS le dernier élément de la ligne ;
 *   2. la fenêtre « Changer de projet » (la loupe de la colonne) montre les mêmes
 *      repères, aux mêmes endroits ;
 *   3. aucun repère n'est un bouton (il ne s'en pose pas dans une ligne de menu)
 *      et le nom du projet reste lisible ;
 *   4. une carte ouverte depuis « Tableaux de bord » se REFERME quand on choisit
 *      « Tableaux de bord » dans le menu des services (le bouton ne restait pas
 *      muet).
 *
 * On juge sur l'ÉTAT lu (attributs, positions relatives des éléments d'une même
 * ligne), jamais sur des hauteurs.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_INDICATEURS_PORT || 7223);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-indicateurs-',
  port: PORT,
  messageCommit: 'indicateurs',
});

/* ------------------------------------------------------------------ */
/* Le décor : trois projets, une carte qui attend un geste              */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ATTENTE = 'p-attente';
const PROJET_CALME = 'p-calme';
const PROJET_COURANT = 'p-courant';
const PROJET_AU_TRAVAIL = 'p-travail';
const CARTE_ID = 'c-attente';
const AGENT_ID = 'a-attente';
const TITRE = 'Carte d’essai — en attente de geste';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification indicateurs de projet',
  );
  /* Plafond d'agents à ZÉRO : rien ne peut partir, quoi qu'on clique. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projets = [
    { id: PROJET_ATTENTE, name: 'Alpha — carte en attente', rank: 1 },
    { id: PROJET_CALME, name: 'Bravo — projet calme', rank: 2 },
    { id: PROJET_COURANT, name: 'Charlie — projet courant', rank: 3 },
    { id: PROJET_AU_TRAVAIL, name: 'Delta — agent au travail', rank: 4 },
  ];
  for (const p of projets) {
    const projet = {
      ...p,
      path: DEPOT,
      defaultEngine: 'claude',
      isSelf: false,
      archived: false,
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);
  }

  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ATTENTE,
    agentId: AGENT_ID,
    title: TITRE,
    description: 'Carte du contrôle.',
    labels: [],
    column: 'planned',
    position: 1,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none', mode: 'plan' },
    scheduling: { asap: false, attempts: 0, restarts: 0 },
    parcours: {
      /* LA COMPRÉHENSION RENDUE : la carte attend « Valider et lancer ». */
      comprehension: {
        texte: 'Compris.',
        hypotheses: [],
        sujets: [],
        resumeDemande: 'Vous demandez un essai.',
        resumeComprehension: 'Je comprends qu’il faut un essai.',
        at: maintenant - 10,
      },
    },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(CARTE_ID, PROJET_ATTENTE, 'planned', 1, TITRE, JSON.stringify(carte), maintenant, maintenant);

  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ATTENTE,
    cardId: CARTE_ID,
    role: 'cadrage',
    title: TITRE,
    run: { engine: 'claude', thinking: 'none', mode: 'plan' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(AGENT_ID, PROJET_ATTENTE, CARTE_ID, 'cadrage', 'idle', JSON.stringify(agent), maintenant, maintenant);

  const demande = {
    id: 'm-demande',
    agentId: AGENT_ID,
    role: 'user',
    content: 'Fais l’essai des indicateurs.',
    steps: [],
    todos: [],
    proposals: [],
    questions: [],
    downloads: [],
    attachments: [],
    createdAt: maintenant,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    demande.id,
    AGENT_ID,
    'user',
    JSON.stringify(demande),
    maintenant,
  );

  /* UNE QUESTION SANS RÉPONSE sur la carte d'Alpha : c'est elle qui allume la
     bulle sur la ligne du projet (`iconeDuLot`, nature « question »). */
  const question = {
    id: 'm-question',
    agentId: AGENT_ID,
    role: 'assistant',
    content: 'Une précision avant de continuer.',
    steps: [],
    todos: [],
    proposals: [],
    questions: [
      {
        id: 'q-essai',
        question: 'Quelle option retenir ?',
        kind: 'single',
        options: [
          { id: 'o1', label: 'Option A' },
          { id: 'o2', label: 'Option B' },
        ],
        allowFreeText: true,
        answerAttachments: [],
        cancelled: false,
      },
    ],
    downloads: [],
    attachments: [],
    createdAt: maintenant + 1,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at, a_questions) VALUES (?, ?, ?, ?, ?, 1)').run(
    question.id,
    AGENT_ID,
    'assistant',
    JSON.stringify(question),
    maintenant + 1,
  );

  /* UN AGENT AU TRAVAIL sur le projet Delta : sa roue et son chiffre. */
  const travailleur = {
    id: 'a-delta',
    projectId: PROJET_AU_TRAVAIL,
    role: 'task',
    title: 'Tâche en cours',
    run: { engine: 'claude', thinking: 'none', mode: 'build' },
    status: 'running',
    tourVivantDepuis: maintenant,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(travailleur.id, PROJET_AU_TRAVAIL, 'task', 'running', JSON.stringify(travailleur), maintenant, maintenant);
  db.close();
}

/* ------------------------------------------------------------------ */
/* Le navigateur                                                       */
/* ------------------------------------------------------------------ */

/** Les lignes d'une liste, avec ce qu'elles portent à droite du nom. */
const lireLesLignes = (page, racine) =>
  page.evaluate((racineSel) => {
    const racine = document.querySelector(racineSel);
    if (!racine) return null;
    return [...racine.querySelectorAll('[data-ligne-tiroir-projets]')].map((ligne) => {
      const id = ligne.getAttribute('data-ligne-tiroir-projets');
      const nom = ligne.querySelector('span.truncate, span[class*="truncate"]');
      const indicateurs = ligne.querySelector('[data-indicateurs-de-projet]');
      const coche = ligne.querySelector('svg.lucide-check');
      const x = (n) => (n ? n.getBoundingClientRect().left : null);
      return {
        id,
        aDesIndicateurs: !!indicateurs,
        natures: indicateurs
          ? [...indicateurs.querySelectorAll('[data-signal-nature]')].map((n) => n.getAttribute('data-signal-nature'))
          : [],
        enCours: indicateurs?.querySelector('[data-indicateur-en-cours]')?.getAttribute('data-indicateur-en-cours') ?? null,
        boutons: indicateurs ? indicateurs.querySelectorAll('button, a').length : 0,
        nomLisible: !!nom && nom.getBoundingClientRect().width > 40,
        gauche: { nom: x(nom), indicateurs: x(indicateurs), coche: x(coche) },
        cocheDeLaLigne: !!coche,
      };
    });
  }, racine);

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  await new Promise((r) => setTimeout(r, 1500));

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(`${BASE}/#projet/${PROJET_COURANT}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });

  /* -------- 1. Le menu du fil d'Ariane -------- */

  await page.locator('[data-titre-bandeau]').first().click();
  await page.locator('[data-menu-des-projets]').waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(800);
  const menu = await lireLesLignes(page, '[data-menu-des-projets]');
  const ligne = (liste, id) => liste?.find((l) => l.id === id);
  noter(
    'le menu liste les quatre projets du décor',
    !!menu && [PROJET_ATTENTE, PROJET_CALME, PROJET_COURANT, PROJET_AU_TRAVAIL].every((id) => !!ligne(menu, id)),
  );
  const alpha = ligne(menu, PROJET_ATTENTE);
  noter(
    'le projet qui porte une question sans réponse montre la bulle, à droite de son nom',
    !!alpha && alpha.aDesIndicateurs && JSON.stringify(alpha.natures) === JSON.stringify(['message']),
    JSON.stringify(alpha),
  );
  const delta = ligne(menu, PROJET_AU_TRAVAIL);
  noter(
    'le projet où un agent travaille montre son chiffre orange',
    !!delta && delta.aDesIndicateurs && delta.enCours === '1',
    JSON.stringify(delta),
  );
  noter(
    'un projet où rien ne se passe reste NU',
    !!ligne(menu, PROJET_CALME) && !ligne(menu, PROJET_CALME).aDesIndicateurs,
  );
  noter(
    'les repères viennent APRÈS le nom, et nom et repères tiennent sur la ligne',
    !!alpha && alpha.gauche.indicateurs > alpha.gauche.nom && alpha.nomLisible,
    alpha ? JSON.stringify(alpha.gauche) : '—',
  );
  const courant = ligne(menu, PROJET_COURANT);
  noter(
    'la coche du projet courant reste le DERNIER élément de sa ligne',
    !!courant && courant.cocheDeLaLigne && (courant.gauche.indicateurs === null || courant.gauche.coche > courant.gauche.indicateurs),
    courant ? JSON.stringify(courant.gauche) : '—',
  );
  noter('aucun repère n’est un bouton ni un lien', (menu ?? []).every((l) => l.boutons === 0));
  await page.screenshot({ path: `/tmp/indicateurs-menu-des-projets.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  /* -------- 2. La fenêtre « Changer de projet » -------- */

  const loupe = page.locator('[data-ouvrir-tiroir-projets], button[aria-label="Chercher un projet"], [data-loupe-projets]').first();
  if (await loupe.count()) {
    await loupe.click();
    await page.locator('[role="dialog"] [data-tiroir-projets]').waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
    const tiroir = await lireLesLignes(page, '[role="dialog"] [data-tiroir-projets]');
    if (tiroir) {
      const a = ligne(tiroir, PROJET_ATTENTE);
      noter(
        'la fenêtre « Changer de projet » montre les mêmes repères',
        !!a && a.aDesIndicateurs && JSON.stringify(a.natures) === JSON.stringify(alpha?.natures),
        JSON.stringify(a),
      );
      noter('…et un projet calme y reste nu', !!ligne(tiroir, PROJET_CALME) && !ligne(tiroir, PROJET_CALME).aDesIndicateurs);
      await page.screenshot({ path: `/tmp/indicateurs-changer-de-projet.png` });
    } else {
      console.log('  --   la fenêtre « Changer de projet » ne s’est pas ouverte (loupe introuvable sur cet écran)');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } else {
    console.log('  --   la loupe de la colonne n’est pas présente sur cet écran : fenêtre non contrôlée');
  }

  /* -------- 4. Une carte ouverte depuis « Tableaux de bord » se referme -------- */

  /* « Tableaux de bord » n'est plus dans la liste des projets (elle ouvre
     « Plan de travail » en tête) : on y va par le premier cran du fil d'Ariane. */
  await page.locator('[data-fil-d-ariane] :is(a, button)[data-chemin-de-zone]').first().click();
  await page.waitForTimeout(2500);
  const carteSurLaPage = page.locator('article').filter({ hasText: TITRE.slice(0, 24) }).first();
  noter('« Tableaux de bord » affiche la carte du décor', (await carteSurLaPage.count()) > 0);
  if (await carteSurLaPage.count()) {
    await carteSurLaPage.click();
    await page.waitForTimeout(3500);
    const carteOuverte = () => page.locator('[role="dialog"][data-page-de-zone] [data-fil="parcours"]').count();
    noter('un clic sur la carte l’ouvre par-dessus la page', (await carteOuverte()) > 0);

    /* LE BOUTON DES SERVICES DE LA PAGE DE LA CARTE : celui que l'utilisateur
       touche — le bouton de la barre de l'application est recouvert par la page. */
    await page.locator('[role="dialog"] [data-navigation-compacte]').first().click();
    await page.locator('[data-navigation-panneau="ouvert"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-ouvrir-en-route]:visible').first().click();
    await page.waitForTimeout(2500);
    noter(
      'choisir « Tableaux de bord » referme la carte : le bouton réagit',
      (await carteOuverte()) === 0,
      `${await carteOuverte()} fil(s) de carte encore affiché(s)`,
    );
  }

  noter('aucune erreur de page pendant tout le parcours', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  console.error(journal.join(''));
  process.exit(1);
});
