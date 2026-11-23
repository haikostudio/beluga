#!/usr/bin/env node
/**
 * LE CAHIER DES CHARGES NE PARAÎT QUE DANS LE PLAN, EN ENCADRÉ — dans un vrai navigateur.
 *
 *   node scripts/verif-cahier-du-plan.mjs
 *
 * Demande du 17/10/2026 (« pareil qu'avant ») : les réponses du fil sont du
 * texte seul, et le cahier vivant se lit d'un bloc sous le plan, dans un
 * encadré ouvert (`CahierDesChargesDuPlan`). Démon d'essai à soi, base neuve,
 * plafond d'agents à zéro : aucun moteur appelé.
 *
 * Ce qui est prouvé, sur un téléphone de 390 px :
 *   1. la compréhension porte son texte, et RIEN du cahier dessous — même si
 *      son jalon porte un cahier vivant ;
 *   2. le plan porte UN encadré, ouvert d'office, avec toutes ses rubriques,
 *      sans bouton à déplier ni pastille « mise à jour » ;
 *   3. l'encadré tient dans l'écran (aucun débordement) et son fond tranche
 *      sur celui de la page ;
 *   4. le titre « Cahier des charges » n'apparaît plus en titre du texte du plan.
 * Une capture est écrite dans /tmp/verif-cahier-du-plan.png.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_CAHIER_PORT || 7219);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-cahier-plan-',
  port: PORT,
  messageCommit: 'cahier',
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const CARTE_ID = 'c-essai-cahier';
const AGENT_ID = 'a-essai-cadrage';
const TITRE = 'Carte d’essai — cahier du plan';
const PHRASE_DU_PLAN = 'Ce plan sert au contrôle du cahier.';
const COMPRIS = 'J’ai compris qu’il faut un essai du cahier.';
const RUBRIQUES = [
  { titre: 'Objectif', contenu: 'Lire le cahier d’un bloc, sur téléphone comme sur ordinateur, avec un très long mot comme anticonstitutionnellementanticonstitutionnellement.' },
  { titre: 'Contraintes', contenu: '- Rien sous les réponses du fil.\n- Aucun encadré vide.' },
];

const TEXTE_DU_PLAN = [
  '# Plan d’essai',
  `_${PHRASE_DU_PLAN}_`,
  '',
  '## Liste des tâches',
  '- Première tâche.',
  '- Seconde tâche.',
  '',
  '## Cahier des charges',
  ...RUBRIQUES.flatMap((r) => [`### ${r.titre}`, r.contenu, '']),
].join('\n');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification cahier du plan',
  );

  /* Plafond d'agents à ZÉRO : rien ne peut partir, quoi qu'on clique. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai cahier du plan',
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
        texte: COMPRIS,
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
    content: 'Fais l’essai du cahier.',
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

  /* LE JALON « Compréhension » PORTE UN CAHIER VIVANT : l'écran ne doit plus
     rien en montrer sous la réponse. */
  db.prepare(
    `INSERT INTO card_journal
       (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, resultat, reussie, donnees)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'j-comprehension-1',
    CARTE_ID,
    0,
    'cadrage',
    'jalon',
    maintenant - 10,
    AGENT_ID,
    'cadrage',
    'tour-0',
    'Compréhension',
    COMPRIS,
    1,
    JSON.stringify({ cahierDesCharges: RUBRIQUES, rubriquesTouchees: ['Objectif'] }),
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
    1,
    'cadrage',
    'jalon',
    maintenant,
    AGENT_ID,
    'cadrage',
    'tour-1',
    'Plan proposé',
    TEXTE_DU_PLAN,
    1,
    JSON.stringify({ version: 1, titre: 'Plan d’essai' }),
  );
  db.close();
}

const TELEPHONE = { width: 390, height: 844 };

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  await new Promise((r) => setTimeout(r, 1500));

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: TELEPHONE, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
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

  /* -------- 1. La compréhension : du texte, rien dessous -------- */
  const comprehension = page.locator('[data-moment="comprehension"]');
  noter('le fil porte la compréhension', (await comprehension.count()) >= 1, `${await comprehension.count()}`);
  const texteCompris = (await comprehension.count()) ? await comprehension.first().innerText() : '';
  noter('elle porte son texte', texteCompris.includes(COMPRIS));
  noter(
    'AUCUN cahier sous la compréhension, alors que son jalon en porte un',
    (await comprehension.locator('[data-cahier-du-plan], [data-cahier-contenu], [data-cahier-rubrique]').count()) === 0 &&
      !texteCompris.includes('Cahier des charges') && !texteCompris.includes('Contraintes'),
  );

  /* -------- 2. Le plan porte UN encadré ouvert -------- */
  const plan = page.locator('[data-bloc-du-plan-corps]');
  const encadre = plan.locator('[data-cahier-du-plan]');
  noter('le plan porte UN encadré « Cahier des charges »', (await encadre.count()) === 1, `${await encadre.count()}`);
  noter('il est ouvert d’office : ses deux rubriques sont visibles', (await encadre.locator('[data-cahier-rubrique]').count()) === 2 && (await encadre.locator('[data-cahier-rubrique="Contraintes"]').isVisible()));
  noter('aucun bouton à déplier, aucune pastille « mise à jour »', (await page.locator('[data-cahier-bascule], [data-cahier-touchee], [data-cahier-replie]').count()) === 0 && (await encadre.locator('button').count()) === 0);
  const texteDuPlan = await plan.first().innerText();
  noter('le reste du plan se lit en texte, sans titre « Cahier des charges » en double', texteDuPlan.includes('Seconde tâche') && texteDuPlan.split('Cahier des charges').length === 2);

  /* -------- 3. Il tient dans l'écran et son fond tranche -------- */
  const mesure = await encadre.first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    let parent = el.parentElement;
    let fondParent = 'rgba(0, 0, 0, 0)';
    while (parent && (fondParent === 'rgba(0, 0, 0, 0)' || fondParent === 'transparent')) {
      fondParent = getComputedStyle(parent).backgroundColor;
      parent = parent.parentElement;
    }
    return { gauche: r.left, droite: r.right, deborde: el.scrollWidth > el.clientWidth + 1, fond: getComputedStyle(el).backgroundColor, fondParent, largeur: innerWidth };
  });
  noter('l’encadré tient dans les 390 px, sans débordement', mesure.gauche >= 0 && mesure.droite <= mesure.largeur && !mesure.deborde, JSON.stringify(mesure));
  noter('son fond tranche sur celui de la page', mesure.fond !== mesure.fondParent, `${mesure.fond} sur ${mesure.fondParent}`);

  await encadre.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/verif-cahier-du-plan.png' });

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
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
