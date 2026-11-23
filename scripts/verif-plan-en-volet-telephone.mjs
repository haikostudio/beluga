#!/usr/bin/env node
/**
 * LE PLAN SE LIT DANS LE FIL SUR TÉLÉPHONE, SANS VOLET — dans un vrai navigateur.
 *
 *   node scripts/verif-plan-en-volet-telephone.mjs
 *
 * (Le nom du script garde l'ancien intitulé, « plan en volet » : depuis le
 * 12/10/2026 le plan n'ouvre plus de volet plein écran sur téléphone, il se lit
 * dans le fil comme une réponse, exactement comme sur grand écran.)
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve : le
 * démon de production n'est pas touché. Le plafond d'agents est mis à ZÉRO et le
 * décor est posé EN BASE — aucun moteur n'est appelé, pas un jeton dépensé.
 *
 * Ce qui est prouvé, bout en bout, sous 639 px :
 *   1. le plan est un TEXTE posé dans le fil : aucune entrée de volet, aucun
 *      volet plein écran, aucun pied de volet ;
 *   2. il porte le plan ENTIER — du résumé jusqu'à sa dernière ligne ;
 *   3. aucune décision ne se prend dans le plan : elle est sous le champ ;
 *   4. « Refuser » n'existe plus, et rien n'est parti tant qu'on n'a rien décidé ;
 *   5. « Programmer » date le lancement, et la date se lit en base ;
 *   6. sur grand écran, c'est le MÊME texte, au même endroit.
 *
 * On juge sur l'ÉTAT lu (attributs, valeurs en base) et sur des POSITIONS là où
 * la question EST une question de position : un pied fixe, ça se mesure.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

/* La racine se déduit du script LUI-MÊME : lancé depuis une copie de travail
   (`.worktrees/…`), il juge le code de CETTE copie, jamais celui du dossier
   principal — sinon il déclare bon un changement jamais exécuté. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VOLET_PORT || 7203);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

const { TMP, DATA, PROJETS, DEPOT, demon, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-plan-volet-',
  port: PORT,
  messageCommit: 'plan',
});

/* ------------------------------------------------------------------ */
/* Le décor : un projet, une carte, son plan                            */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const CARTE_ID = 'c-essai-volet';
const AGENT_ID = 'a-essai-cadrage';
const TITRE = 'Carte d’essai — plan en volet';
const PHRASE_DU_PLAN = 'Ce plan sert au contrôle du volet.';

/* Un plan LONG : le retour collant ne paraît que si le contenu dépasse la
   hauteur visible, et c'est justement ce qu'on veut éprouver. */
const LIGNES = Array.from({ length: 40 }, (_, i) => `- Ligne de plan numéro ${i + 1}, écrite pour occuper la hauteur.`);
const TEXTE_DU_PLAN = [
  '# Plan d’essai',
  `_${PHRASE_DU_PLAN}_`,
  '',
  '## Faisabilité',
  ...LIGNES,
  '',
  '## Chemin à suivre',
  ...LIGNES,
  '',
  '## Conséquences',
  ...LIGNES,
  '',
  '## Améliorations apportées',
  '- Une idée à retenir.',
].join('\n');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification plan en volet',
  );

  /* Plafond d'agents à ZÉRO : rien ne peut partir, quoi qu'on clique. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai plan en volet',
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

  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
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
      /* LA COMPRÉHENSION EST LE PIVOT DE LA DÉCISION : sans elle, le bouton
         reste éteint, plan rendu ou non. */
      comprehension: {
        texte: 'Compris.',
        hypotheses: [],
        sujets: [],
        resumeDemande: 'Vous demandez un essai.',
        resumeComprehension: 'Je comprends qu’il faut un essai.',
        at: maintenant - 10,
      },
      plans: [{ id: 'plan-1', numero: 1, titre: 'Plan d’essai', texte: TEXTE_DU_PLAN, at: maintenant }],
    },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(CARTE_ID, PROJET_ID, 'planned', 1, TITRE, JSON.stringify(carte), maintenant, maintenant);

  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
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
  ).run(AGENT_ID, PROJET_ID, CARTE_ID, 'cadrage', 'idle', JSON.stringify(agent), maintenant, maintenant);

  /* UNE DEMANDE DÉJÀ ENVOYÉE : sans elle, le tiroir s'ouvre sur la carte de
     configuration de l'agent, et le flux n'est pas encore affiché. */
  const demande = {
    id: 'm-demande',
    agentId: AGENT_ID,
    role: 'user',
    content: 'Fais l’essai du plan en volet.',
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

  /* LE JALON « Plan proposé » DONNE SON POINT AU FLUX : c'est lui que le
     parcours range sous l'étape « plan » (`shared/src/journal-carte.ts`). */
  db.prepare(
    `INSERT INTO card_journal
       (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, resultat, reussie, donnees)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'j-plan-1',
    CARTE_ID,
    0,
    'cadrage',
    'jalon',
    maintenant,
    AGENT_ID,
    'cadrage',
    'tour-1',
    'Plan proposé',
    TEXTE_DU_PLAN.slice(0, 400),
    1,
    JSON.stringify({ version: 1, titre: 'Plan d’essai' }),
  );
  db.close();
}

/** L'ordonnancement de la carte, lu en base — la seule preuve qui vaille. */
function ordonnancement() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const ligne = db.prepare('SELECT data FROM cards WHERE id = ?').get(CARTE_ID);
  db.close();
  try {
    return JSON.parse(ligne?.data ?? '{}')?.scheduling ?? {};
  } catch {
    return {};
  }
}

/**
 * Combien de messages ont été envoyés à l'agent EN PLUS du décor ? Doit rester
 * à zéro : rien de ce contrôle ne parle à un moteur.
 */
function messagesEnvoyes() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const n = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE role = 'user'").get()?.n ?? 0;
  db.close();
  return Math.max(0, n - 1);
}

/** L'état de la carte, lu en base — la seule preuve qui vaille. */
function etatDeLaCarte() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const ligne = db.prepare('SELECT data FROM cards WHERE id = ?').get(CARTE_ID);
  db.close();
  return ligne ? JSON.parse(ligne.data) : {};
}

/* ------------------------------------------------------------------ */
/* Le navigateur                                                       */
/* ------------------------------------------------------------------ */

/** L'écran d'un téléphone courant : c'est sous ce seuil que le volet vit. */
const TELEPHONE = { width: 390, height: 844 };
const ORDINATEUR = { width: 1400, height: 900 };

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  await new Promise((r) => setTimeout(r, 1500));

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const contexte = await navigateur.newContext({
    viewport: TELEPHONE,
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
  await page.waitForTimeout(6000);
  await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });

  const onglet = page.getByRole('button', { name: /^Tableau$/ });
  if (await onglet.count()) {
    await onglet.first().click();
    await page.waitForTimeout(1500);
  }

  await page.locator('article').filter({ hasText: TITRE.slice(0, 24) }).first().click();
  await page.waitForTimeout(4000);

  /* -------- 1. Le plan est un texte du fil, il n'ouvre plus de volet -------- */

  const bloc = page.locator('[data-bloc-du-plan]');
  noter('le fil porte bien le plan de la carte', (await bloc.count()) === 1, `${await bloc.count()} bloc(s)`);
  noter(
    'sous 639 px, le plan est lu EN PLACE : ni entrée de volet, ni volet, ni repli',
    (await bloc.first().getAttribute('data-bloc-du-plan-repli')) === 'ouvert' &&
      (await page.locator('[data-plan-ouvrir-volet], [data-volet-plan-corps], [data-volet-plan-pied]').count()) === 0,
    (await bloc.first().getAttribute('data-bloc-du-plan-repli')) ?? '—',
  );

  /* -------- 2. Le fil porte le plan ENTIER -------- */

  const corps = page.locator('[data-bloc-du-plan-corps]');
  noter('son corps est monté et visible dans le fil', (await corps.count()) === 1 && (await corps.first().isVisible()));
  const texteDuPlan = await corps.first().innerText();
  noter('le plan s’y lit depuis son résumé', texteDuPlan.includes(PHRASE_DU_PLAN));
  noter(
    '…jusqu’à sa DERNIÈRE ligne : le fil porte le plan ENTIER',
    texteDuPlan.includes('Ligne de plan numéro 40') && texteDuPlan.includes('Une idée à retenir'),
  );
  noter(
    'AUCUN choix de niveau sous le plan : un plan validé part avec le modèle de sa configuration',
    (await page.locator('[data-niveau-plan], [data-pied-plan]').count()) === 0,
  );

  /* -------- 3. Le plan ne porte aucune décision -------- */

  noter(
    'le plan ne porte AUCUN bouton de décision',
    (await bloc.first().locator('[data-geste-principal], [data-plan-refuser], [data-plan-valider]').count()) === 0,
  );

  /* -------- 4. LA DÉCISION SE PREND SOUS LE CHAMP, ET NULLE PART AILLEURS -------- */

  const valider = page.locator('[data-barre-action] [data-geste-principal="valider-et-lancer"]');
  noter(
    '« Valider et lancer » attend sous le champ d’écriture',
    (await valider.count()) === 1 && (await valider.first().isVisible()),
  );
  noter('plus aucun bouton « Refuser » nulle part', (await page.locator('[data-plan-refuser]').count()) === 0);
  noter('rien n’est parti tant qu’on n’a rien décidé', messagesEnvoyes() === 0, `${messagesEnvoyes()} message(s)`);

  /* -------- 5. L'horloge de programmation a quitté l'écran (refonte du 13/11/2026) : plus rien à dater ici -------- */

  /* -------- 6. Sur grand écran, c'est le même texte -------- */

  await page.setViewportSize(ORDINATEUR);
  await page.waitForTimeout(1500);
  noter(
    'sur grand écran, le plan se lit au même endroit, en entier, sans volet',
    (await page.locator('[data-bloc-du-plan-corps]').count()) === 1 &&
      (await page.locator('[data-bloc-du-plan-corps]').first().isVisible()) &&
      (await page.locator('[data-volet-plan-corps]').count()) === 0 &&
      (await page.locator('[data-bloc-du-plan-corps]').first().innerText()).includes('Ligne de plan numéro 40'),
  );

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
