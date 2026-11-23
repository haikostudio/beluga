#!/usr/bin/env node
/**
 * UN PLAN S'AFFICHE EN TEXTE SIMPLE — dans un vrai navigateur.
 *
 * Le plan était dessiné en RAPPORT : entête encadré, sommaire de quatre lignes
 * numérotées, trois parties sur quatre repliées d'office. Il se lit désormais
 * comme n'importe quelle réponse — du texte, sans icône, sans couleur, sans
 * repli (`PlanRapport`, `web/src/components/plan-rapport.tsx`).
 *
 * OÙ LE PLAN VIT AUJOURD'HUI : sur la CARTE (`parcours.plans`), écrit par
 * l'outil `rendre_plan` — plus dans le fil des messages. Ce contrôle pose donc
 * son décor EN BASE : un projet d'essai, une carte par écriture de plan, et il
 * ouvre chaque tiroir pour lire ce que l'écran montre. Aucun moteur n'est
 * appelé, pas un jeton dépensé.
 *
 * CE QUI EST VÉRIFIÉ :
 *   - le gabarit est remis d'aplomb avant d'être rendu (`rangerLePlan`) : un
 *     plan écrit EN GRAS se lit exactement comme un plan écrit en titres ;
 *   - LE PLAN NEUF S'OUVRE SUR SON BLOC « Liste des tâches », chaque tâche avec
 *     sa description détaillée, et plus aucune phrase de résumé en italique ;
 *   - un plan ENREGISTRÉ AVANT ce bloc garde son résumé en italique ;
 *   - le sommaire dépliant ne reparaît jamais, et les améliorations restent
 *     cliquables.
 *
 *   HAIKO_PLAN_URL=http://localhost:7099 node scripts/verif-rapport-plan.mjs
 *
 * Le serveur de DÉVELOPPEMENT est visé : un script de vérification ne reprend
 * jamais BELUGA_URL, qui désigne l'application déjà publiée, ni BELUGA_TOKEN,
 * qui est le jeton d'un agent.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie } from './base-servie.mjs';

const BASE = process.env.HAIKO_PLAN_URL || 'http://localhost:7099';
const SHOTS = `${process.env.BELUGA_DATA || '/root/beluga/data'}/verification`;
fs.mkdirSync(SHOTS, { recursive: true });

/* LA BASE RÉELLEMENT SERVIE, jamais le `data/` vide d'une copie de travail de
   carte : sinon la table `sessions` manque et le contrôle tombe sur un faux
   diagnostic. */
const db = new Database(process.env.BELUGA_DB || cheminDeLaBaseServie());
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

// Jeton de session, une heure, haché en base et retiré en partant.
const jeton = crypto.randomBytes(32).toString('base64url');
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
  sha(jeton),
  Date.now(),
  Date.now() + 3600_000,
  'vérification rapport de plan',
);

const dossier = fs.mkdtempSync('/tmp/rapport-plan-');
const projetId = crypto.randomUUID();
const maintenant = Date.now();
const projet = {
  id: projetId,
  name: 'Essai — rapport de plan',
  path: dossier,
  defaultEngine: 'claude',
  isSelf: false,
  miseEnProduction: {},
  archived: false,
  createdAt: maintenant,
  updatedAt: maintenant,
};
db.prepare(
  'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const nettoyer = () => {
  try {
    for (const carte of db.prepare('SELECT id FROM cards WHERE project_id = ?').all(projetId)) {
      db.prepare('DELETE FROM card_journal WHERE card_id = ?').run(carte.id);
    }
    for (const agent of db.prepare('SELECT id FROM agents WHERE project_id = ?').all(projetId)) {
      db.prepare('DELETE FROM messages WHERE agent_id = ?').run(agent.id);
      db.prepare('DELETE FROM queue WHERE agent_id = ?').run(agent.id);
    }
    db.prepare('DELETE FROM agents WHERE project_id = ?').run(projetId);
    db.prepare('DELETE FROM cards WHERE project_id = ?').run(projetId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projetId);
    db.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton));
  } catch (err) {
    console.error('ménage : ', err);
  }
  fs.rmSync(dossier, { recursive: true, force: true });
};
process.on('exit', nettoyer);

/* ------------------------------------------------------------------ */
/* Les plans d'essai — la même matière, trois écritures                */
/* ------------------------------------------------------------------ */

const CORPS = {
  titre: 'Refonte du tableau de bord',
  resume: 'Trois écrans à revoir, sans toucher au reste.',
  faisabilite: 'Le tableau affiche aujourd’hui ses cartes sans repère de colonne.',
  chemin: '1. Poser le gabarit.',
  consequences: 'Rien d’autre ne bouge.',
  idees: ['Ajoute un export au format tableur.', 'Retiens le dernier dossier choisi.', 'Préviens quand c’est prêt.'],
};

/** LA FORME NEUVE : le plan s'ouvre sur sa liste de tâches. */
const TACHES = [
  { titre: 'Poser le gabarit', description: 'Découper l’écran en trois zones et fixer leurs marges.' },
  { titre: 'Brancher l’affichage', description: 'Relier chaque zone à sa source de données.' },
];

const QUATRE_PARTIES = [
  '## Faisabilité',
  CORPS.faisabilite,
  '',
  '## Chemin à suivre',
  CORPS.chemin,
  '',
  '## Conséquences',
  CORPS.consequences,
  '',
  '## Améliorations apportées',
  ...CORPS.idees.map((i) => `- ${i}`),
];

const EN_TITRES = [`# ${CORPS.titre}`, `_${CORPS.resume}_`, '', ...QUATRE_PARTIES].join('\n');

const EN_GRAS = [
  `# ${CORPS.titre}`,
  `_${CORPS.resume}_`,
  '',
  '**Faisabilité**',
  CORPS.faisabilite,
  '',
  '**Chemin à suivre :**',
  CORPS.chemin,
  '',
  '**Conséquences**',
  CORPS.consequences,
  '',
  '**Améliorations apportées**',
  ...CORPS.idees.map((i) => `- ${i}`),
].join('\n');

const AVEC_TACHES = [
  `# ${CORPS.titre}`,
  '',
  '## Liste des tâches',
  ...TACHES.flatMap((tache) => [`**${tache.titre}**`, tache.description, '']),
  ...QUATRE_PARTIES,
].join('\n');

/* ------------------------------------------------------------------ */
/* Le décor : une carte par écriture de plan                           */
/* ------------------------------------------------------------------ */

const CAS = [
  { cle: 'titres', titre: 'Essai plan en titres', texte: EN_TITRES },
  { cle: 'gras', titre: 'Essai plan en gras', texte: EN_GRAS },
  { cle: 'taches', titre: 'Essai plan avec taches', texte: AVEC_TACHES },
];

for (const [rang, cas] of CAS.entries()) {
  cas.carteId = crypto.randomUUID();
  cas.agentId = crypto.randomUUID();
  const carte = {
    id: cas.carteId,
    projectId: projetId,
    agentId: cas.agentId,
    title: cas.titre,
    description: 'Carte du contrôle.',
    labels: [],
    column: 'planned',
    position: rang + 1,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none' },
    scheduling: { asap: false, attempts: 0, restarts: 0 },
    parcours: {
      plans: [{ id: `plan-${cas.cle}`, numero: 1, titre: CORPS.titre, texte: cas.texte, at: maintenant }],
    },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(cas.carteId, projetId, 'planned', rang + 1, cas.titre, JSON.stringify(carte), maintenant, maintenant);

  const agent = {
    id: cas.agentId,
    projectId: projetId,
    cardId: cas.carteId,
    role: 'cadrage',
    title: cas.titre,
    run: { engine: 'claude', thinking: 'none' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(cas.agentId, projetId, cas.carteId, 'cadrage', 'idle', JSON.stringify(agent), maintenant, maintenant);

  /* UNE DEMANDE DÉJÀ ENVOYÉE : sans elle, le tiroir s'ouvre sur la carte de
     configuration de l'agent, et le flux n'est pas encore affiché. */
  const demande = {
    id: `m-${cas.cle}`,
    agentId: cas.agentId,
    role: 'user',
    content: 'Fais l’essai du rapport de plan.',
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
    cas.agentId,
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
    `j-${cas.cle}`,
    cas.carteId,
    0,
    'cadrage',
    'jalon',
    maintenant,
    cas.agentId,
    'cadrage',
    `tour-${cas.cle}`,
    'Plan proposé',
    cas.texte.slice(0, 400),
    1,
    JSON.stringify({ version: 1, titre: CORPS.titre }),
  );
}

/* ------------------------------------------------------------------ */
/* Le navigateur                                                       */
/* ------------------------------------------------------------------ */

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
await contexte.addCookies([
  { name: 'beluga_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
]);

const page = await contexte.newPage();
await page.goto(`${BASE}/#projet/${projetId}`, { waitUntil: 'domcontentloaded' });

/* LE SERVEUR DE DÉVELOPPEMENT COMPILE À LA DEMANDE : la première ouverture peut
   mettre une demi-minute avant que l'application soit montée et reliée au
   démon. On attend donc la première carte du décor. */
const premiere = await page
  .locator('article')
  .filter({ hasText: CAS[0].titre })
  .first()
  .waitFor({ state: 'visible', timeout: 120000 })
  .then(() => true)
  .catch(() => false);

if (!premiere) {
  noter('le tableau du projet d’essai est affiché', false, 'aucune carte du décor — viser le serveur de dev');
  await navigateur.close();
  process.exit(1);
}

/** Ce que l'écran montre, pour la carte d'un cas. */
async function rapportDe(cas) {
  await page.locator('article').filter({ hasText: cas.titre }).first().click();
  const bloc = page.locator('[data-bloc-du-plan]').first();
  await bloc.waitFor({ state: 'visible', timeout: 30000 });

  /* LE PLAN SE LIT EN PLACE, dans le fil, sans rien à ouvrir (12/10/2026) :
     il ne naît plus replié. */
  const vu = page.locator('[data-rapport-plan]').first();
  await vu.waitFor({ state: 'visible', timeout: 20000 });
  const lu = (await vu.innerText()).replace(/\s+/g, ' ').trim();
  /* LES QUATRE INTITULÉS SONT LISIBLES D'UN COUP : ce sont de vrais titres du
     texte, plus des lignes de sommaire à déplier. */
  /* CHAQUE TITRE DE SECTION PORTE SON ICÔNE et, pour les améliorations, son
     bouton « Tout ajouter » : on ne garde que le NOM de la partie. */
  const titres = (await vu.locator('h1, h2, h3').allInnerTexts()).map(
    (t) => t.split('\n').map((ligne) => ligne.trim()).filter((ligne) => /\p{L}/u.test(ligne))[0] ?? '',
  );
  const mesure = {
    enTexte: (await page.locator('[data-rapport-plan][data-plan-en-texte="oui"]').count()) === 1,
    sommaire: await page.locator('[data-entree-sommaire-plan]').count(),
    entete: await page.locator('[data-entete-rapport-plan]').count(),
    titre: titres.includes(CORPS.titre),
    resume: lu.includes(CORPS.resume),
    blocDesTaches: titres.includes('Liste des tâches'),
    descriptionsDesTaches: TACHES.filter((tache) => lu.includes(tache.description)).length,
    parties: ['Faisabilité', 'Chemin à suivre', 'Conséquences', 'Améliorations apportées'].filter((nom) =>
      titres.some((t) => t === nom),
    ).length,
    idees: await vu.locator('[data-suggestion-cliquable]').count(),
    /* UN TEXTE À TITRES NUS : aucune carte par partie, aucun sommaire (`nav`). */
    cartes: (await vu.locator('section').count()) + (await vu.locator('nav').count()),
    horsDeLaCarte: (await page.locator('[data-carte-du-passage] [data-bloc-du-plan]').count()) === 0,
  };
  await page.screenshot({ path: `${SHOTS}/rapport-plan-${cas.cle}.png` });
  /* LE TIROIR SE REFERME : la carte suivante s'ouvre sur un écran net. */
  await page.keyboard.press('Escape');
  await page
    .locator('[data-bloc-du-plan]')
    .first()
    .waitFor({ state: 'detached', timeout: 20000 })
    .catch(() => undefined);
  return mesure;
}

/* ---------- 1. Un plan en titres Markdown ---------- */

const parTitres = await rapportDe(CAS[0]);
noter('le plan est rendu en texte simple', parTitres.enTexte);
noter('plus aucun sommaire dépliant', parTitres.sommaire === 0, `${parTitres.sommaire}`);
noter('plus aucun entête encadré', parTitres.entete === 0, `${parTitres.entete}`);
noter('aucune carte ni sommaire dans le texte : des titres nus', parTitres.cartes === 0, `${parTitres.cartes}`);
noter('le plan est posé hors de la carte du passage', parTitres.horsDeLaCarte);
noter('le titre du plan est écrit en tête', parTitres.titre);
noter('un plan d’AVANT garde sa phrase de résumé en italique', parTitres.resume);
noter('les quatre intitulés sont lisibles sans un clic', parTitres.parties === 4, `${parTitres.parties}`);
noter('les améliorations restent cliquables', parTitres.idees === CORPS.idees.length, `${parTitres.idees}`);

/* ---------- 2. Le MÊME plan, écrit en lignes grasses ---------- */

const parGras = await rapportDe(CAS[1]);
noter(
  'un plan écrit en gras se lit exactement pareil',
  JSON.stringify(parGras) === JSON.stringify(parTitres),
  `${JSON.stringify(parGras)}`,
);

/* ---------- 3. LE PLAN NEUF : « Liste des tâches » en premier bloc ---------- */

const parTaches = await rapportDe(CAS[2]);
noter('le plan s’ouvre sur son bloc « Liste des tâches »', parTaches.blocDesTaches);
noter(
  'chaque tâche porte sa description détaillée',
  parTaches.descriptionsDesTaches === TACHES.length,
  `${parTaches.descriptionsDesTaches}/${TACHES.length}`,
);
noter('plus aucune phrase de résumé en italique', parTaches.resume === false);
noter('les quatre intitulés restent lisibles', parTaches.parties === 4, `${parTaches.parties}`);
noter('les améliorations restent cliquables sur un plan neuf', parTaches.idees === CORPS.idees.length, `${parTaches.idees}`);

await navigateur.close();

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles au vert`);
process.exit(echecs.length ? 1 : 0);
