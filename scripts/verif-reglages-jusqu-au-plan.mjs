#!/usr/bin/env node
/**
 * LES RÉGLAGES DE L'AGENT RESTENT MODIFIABLES JUSQU'À LA VALIDATION DU PLAN,
 * ET LEUR RACCOURCI LES OUVRE OÙ QU'ON EN SOIT DANS LE FIL.
 *
 * Sur un démon d'essai (base neuve, aucun moteur appelé, plafond d'agents à
 * zéro), une carte porte une demande envoyée et un plan rendu, non validé :
 *
 *  1. la configuration de l'agent est MODIFIABLE, et son menu écrit (le modèle
 *     se change, la carte le retient en base) ;
 *  2. l'icône au BOUT DE LA RANGÉE D'ACTION de la carte (toujours la dernière
 *     à droite, fil en haut comme fil en bas, jamais dans la barre d'écriture)
 *     y mène et ouvre un MENU, jamais une page — ordinateur ET téléphone ;
 *  3. après « Valider le plan », l'icône annonce des réglages figés et le menu
 *     ne montre plus que la lecture, ses quatre lignes en entier.
 *
 * DEPUIS LA REFONTE DU 11/10/2026, le passage « Configuration » ne s'écrit plus
 * dans la discussion (`flux-en-points.tsx` : « les réglages de l'agent
 * s'ouvrent depuis l'en-tête de la page ») : son bloc reste monté mais caché.
 * Le raccourci (`[data-raccourci-reglages]`) n'est donc plus un secours qui
 * paraît quand le bloc quitte l'écran : c'est LA porte, toujours là — et
 * il est la moitié collée à droite du bouton principal de la rangée d'action
 * de la carte (décision du 21/10/2026), plus dans sa barre d'écriture ni dans
 * son en-tête. Les valeurs — moteur, modèle, réflexion, compte — se lisent dans son
 * menu (`[data-tiroir-reglages]`), plus dans le bloc.
 *
 *   node scripts/verif-reglages-jusqu-au-plan.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_REGLAGES_PORT || 7219);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-reglages-plan-',
  port: PORT,
  messageCommit: 'reglages',
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const TITRES = { 'c-ordinateur': 'Essai réglages sur ordinateur', 'c-telephone': 'Essai réglages sur téléphone' };
const LIGNES = Array.from({ length: 60 }, (_, i) => `- Ligne de plan numéro ${i + 1}, écrite pour occuper la hauteur.`);
const TEXTE_DU_PLAN = ['# Plan d’essai', '', '## Chemin à suivre', ...LIGNES].join('\n');
/* UNE DEMANDE LONGUE : c'est elle qui donne sa hauteur au fil. Le plan ne le
   fait plus — il se lit replié sur ordinateur et dans un volet sur téléphone —
   et sans hauteur, « l'icône reste là quand on a défilé » ne prouverait rien. */
const TEXTE_DE_LA_DEMANDE = [
  'Fais l’essai des réglages.',
  ...Array.from({ length: 60 }, (_, i) => `Ligne de demande numéro ${i + 1}, écrite pour occuper la hauteur.`),
].join('\n\n');

function poserLaCarte(db, carteId, agentId, maintenant) {
  const TITRE = TITRES[carteId];
  const carte = {
    id: carteId,
    projectId: PROJET_ID,
    agentId,
    title: TITRE,
    description: TEXTE_DE_LA_DEMANDE,
    labels: [],
    column: 'planned',
    position: 1,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none' },
    scheduling: { asap: false, attempts: 0, restarts: 0 },
    parcours: {
      comprehension: { texte: 'Compris.', at: maintenant - 10, hypotheses: [], sujets: [] },
      plans: [{ id: 'plan-1', numero: 1, titre: 'Plan d’essai', texte: TEXTE_DU_PLAN, resume: '', at: maintenant }],
    },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(carteId, PROJET_ID, 'planned', 1, TITRE, JSON.stringify(carte), maintenant, maintenant);
  const agent = {
    id: agentId,
    projectId: PROJET_ID,
    cardId: carteId,
    role: 'cadrage',
    title: TITRE,
    run: { engine: 'claude', thinking: 'none' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(agentId, PROJET_ID, carteId, 'cadrage', 'idle', JSON.stringify(agent), maintenant, maintenant);
  const demande = {
    id: `m-${carteId}`,
    agentId,
    role: 'user',
    content: TEXTE_DE_LA_DEMANDE,
    steps: [],
    todos: [],
    proposals: [],
    questions: [],
    downloads: [],
    attachments: [],
    createdAt: maintenant - 20,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    demande.id,
    agentId,
    'user',
    JSON.stringify(demande),
    maintenant - 20,
  );
  const jalon = db.prepare(
    `INSERT INTO card_journal
       (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, resultat, reussie, donnees)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  jalon.run(`j-comp-${carteId}`, carteId, 0, 'cadrage', 'jalon', maintenant - 10, agentId, 'cadrage', 'tour-1', 'Compréhension rendue', 'Compris.', 1, '{}');
  jalon.run(`j-plan-${carteId}`, carteId, 1, 'cadrage', 'jalon', maintenant, agentId, 'cadrage', 'tour-2', 'Plan proposé', TEXTE_DU_PLAN.slice(0, 400), 1, JSON.stringify({ version: 1, titre: 'Plan d’essai' }));
}

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification réglages jusqu’au plan',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai réglages',
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
  poserLaCarte(db, 'c-ordinateur', 'a-ordinateur', maintenant);
  poserLaCarte(db, 'c-telephone', 'a-telephone', maintenant);
  db.close();
}

function carteEnBase(id) {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const ligne = db.prepare('SELECT data, run_engine, run_model, run_thinking FROM cards WHERE id = ?').get(id);
  db.close();
  if (!ligne) return {};
  // Le réglage vit dans de VRAIES colonnes : elles font foi sur le JSON.
  const carte = JSON.parse(ligne.data);
  return { ...carte, run: { ...(carte.run ?? {}), engine: ligne.run_engine ?? carte.run?.engine, model: ligne.run_model ?? carte.run?.model, thinking: ligne.run_thinking ?? carte.run?.thinking } };
}

const visible = async (loc) => (await loc.count()) > 0 && (await loc.first().isVisible());

async function parcourir(navigateur, taille, nom, carteId) {
  const contexte = await navigateur.newContext({ viewport: taille, locale: 'fr-CH', serviceWorkers: 'block' });
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
  // Le dernier tiroir ouvert peut revenir tout seul : on le referme d'abord.
  for (let i = 0; i < 3 && (await page.locator('[role="dialog"]').count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
  await page.locator('article').filter({ hasText: TITRES[carteId] }).first().click();
  await page.waitForTimeout(4000);

  /* L’icône des réglages : la moitié collée du bouton principal de la rangée d’action. */
  const raccourci = page.locator('[data-barre-action] [data-reglages-du-lancement]');
  const fil = page.locator('[data-fil="parcours"]').first();
  const menuOuvert = '[role="menu"][data-state="open"]';
  /* Refermer tant qu'un menu reste ouvert — et jamais un Échap de plus : il
     refermerait la page de la carte. */
  const refermerLesMenus = async () => {
    for (let i = 0; i < 3 && (await page.locator(menuOuvert).count()); i += 1) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(300);
  };
  /* UNE LIGNE DE RÉGLAGE, TELLE QU'ELLE SE LIT : son nom, sa valeur affichée
     (le second élément de la ligne, après le libellé), et si cette valeur est
     coupée — une valeur repliée par « … » ne se lit pas en entier. */
  const lignesLues = (selecteurDesLignes, attributDuNom) =>
    page.evaluate(
      ([selecteur, attribut]) =>
        [...document.querySelectorAll(selecteur)].map((ligne) => {
          const valeur = ligne.children[1];
          const cadre = ligne.getBoundingClientRect();
          return {
            nom: ligne.getAttribute(attribut),
            valeur: (valeur?.textContent ?? '').trim(),
            attendue: ligne.getAttribute('data-valeur'),
            coupe: !!valeur && valeur.scrollWidth > valeur.clientWidth + 1,
            visible: cadre.width > 0 && cadre.height > 0,
          };
        }),
      [selecteurDesLignes, attributDuNom],
    );

  // En haut du fil : la configuration ne s'écrit plus dans la discussion, son
  // icône est dans l'en-tête — une seule porte vers les réglages, pas deux.
  await fil.evaluate((zone) => zone.scrollTo(0, 0));
  await page.waitForTimeout(1200);
  noter(
    `${nom} : pas de « Rien à raconter » sous un point Configuration qui montre ses réglages`,
    (await page.locator('[data-point="configuration"] [data-blocs-racontes="0"], [data-point-contenu="configuration"] [data-blocs-racontes="0"]').count()) === 0,
  );
  noter(`${nom} : fil en haut, l’icône des réglages est dans la rangée d’action`, await visible(raccourci), `${await raccourci.count()} icône(s)`);
  const jour = await page.evaluate(() => {
    const bouton = document.querySelector('[data-barre-action] [data-geste-principal]')?.getBoundingClientRect();
    const icone = document.querySelector('[data-barre-action] [data-reglages-du-lancement]')?.getBoundingClientRect();
    return bouton && icone ? Math.round((icone.left - bouton.right) * 10) / 10 : null;
  });
  noter(
    `${nom} : l’icône des réglages est collée au bouton principal, plus dans la barre d’écriture`,
    (await page.locator('[data-rangee-de-boutons] [data-raccourci-reglages]').count()) === 0 &&
      (await page.locator('[data-groupe-reglages] [data-reglages-du-lancement]').count()) === 1 &&
      jour !== null && jour >= 0 && jour <= 2,
    `jour ${jour} px`,
  );
  noter(
    `${nom} : une seule porte vers les réglages — le bloc du fil ne s’affiche plus à côté de l’icône`,
    (await page.locator('[data-raccourci-reglages]:visible').count()) === 1 && (await page.locator('[data-reglages-agent]:visible').count()) === 0,
    `${await page.locator('[data-raccourci-reglages]:visible').count()} icône(s), ${await page.locator('[data-reglages-agent]:visible').count()} bloc(s) affiché(s)`,
  );

  // Défiler jusqu'en bas : l'icône reste, les réglages s'ouvrent sans remonter.
  await fil.evaluate((zone) => zone.scrollTo(0, zone.scrollHeight));
  await page.waitForTimeout(1200);
  const defile = await fil.evaluate((zone) => Math.round(zone.scrollTop));
  noter(`${nom} : le fil défile vraiment, le haut de la discussion a quitté l’écran`, defile > 200, `${defile} px`);
  noter(`${nom} : fil en bas, l’icône est toujours collée au bouton principal`, await visible(raccourci), `${await raccourci.count()} icône(s)`);
  noter(`${nom} : l’icône annonce un réglage modifiable`, (await raccourci.first().getAttribute('data-raccourci-reglages').catch(() => null)) === 'modifiable');

  if (await visible(raccourci)) {
    await raccourci.first().click();
    await page.waitForTimeout(900);
    const tiroir = page.locator('[data-tiroir-reglages="modifiable"]');
    noter(`${nom} : l’icône ouvre le menu de configuration, qui écrit`, await visible(tiroir));
    noter(
      `${nom} : c’est un menu sous l’icône, pas une page`,
      (await page.locator(`${menuOuvert} [data-tiroir-reglages="modifiable"]`).count()) === 1 &&
        (await page.locator('[data-page-de-zone] [data-tiroir-reglages]').count()) === 0,
    );
    /* LES VALEURS SE LISENT, PAS SEULEMENT LE LIBELLÉ : une entrée par réglage
       — moteur et modèle toujours, réflexion et compte dès qu'il y a un choix à
       faire —, libellé à gauche et valeur à droite, et rien n'est coupé ; le
       compte n'est jamais un tiret. Elles se lisaient dans le bloc du fil : le
       menu en est désormais le seul porteur. */
    const entrees = await lignesLues(`${menuOuvert} [data-tiroir-reglages="modifiable"] [data-selecteur]`, 'data-selecteur');
    const noms = entrees.map((e) => e.nom);
    const ordre = ['moteur', 'modele', 'reflexion', 'compte'].filter((n) => noms.includes(n));
    noter(
      `${nom} : les valeurs de la configuration se lisent en entier dans le menu`,
      noms.includes('moteur') &&
        noms.includes('modele') &&
        noms.join(',') === ordre.join(',') &&
        entrees.every((e) => e.visible && !e.coupe && !!e.valeur && e.valeur === e.attendue) &&
        !(entrees.find((e) => e.nom === 'compte')?.valeur ?? '').endsWith('—'),
      JSON.stringify(entrees.map((e) => `${e.nom} : ${e.valeur}${e.coupe ? ' (coupée)' : ''}${e.visible ? '' : ' (cachée)'}`)),
    );

    // Changer de modèle, si le catalogue en offre un autre : l'entrée « Modèle »
    // déplie sa liste en sous-menu.
    await page.locator('[data-tiroir-reglages="modifiable"] [data-selecteur="modele"]').first().click().catch(() => {});
    await page.waitForTimeout(900);
    const avant = carteEnBase(carteId).run?.model;
    const autre = page
      .locator(`[role="menuitem"][data-modele-id]:not([data-modele-id="${avant ?? '§'}"])`)
      .filter({ hasText: /Opus/ });
    if (await autre.count()) {
      const vise = await autre.first().getAttribute('data-modele-id');
      await autre.first().click();
      await page.waitForTimeout(1500);
      noter(`${nom} : le modèle choisi après le plan est retenu sur la carte`, carteEnBase(carteId).run?.model === vise, `${avant ?? '—'} → ${carteEnBase(carteId).run?.model ?? '—'}`);
    } else {
      console.log(`  (${nom} : aucun autre modèle au catalogue de ce démon d’essai, changement non rejoué)`);
    }
    // Le choix a replié le sous-menu, pas le menu.
    await refermerLesMenus();
  }

  // Valider la compréhension : les réglages se figent (plafond d'agents à zéro, rien ne tourne).
  const valider = page.locator('[data-geste-principal="valider-et-lancer"]');
  if (await valider.count()) {
    await valider.first().click();
    await page.waitForTimeout(2500);
    noter(`${nom} : la validation est écrite sur la carte`, !!carteEnBase(carteId).parcours?.comprehensionValidee);
    /* Le bloc du fil n'est plus affiché : c'est l'icône qui dit que c'est figé. */
    noter(
      `${nom} : après « Valider », les réglages sont FIGÉS`,
      (await raccourci.first().getAttribute('data-raccourci-reglages').catch(() => null)) === 'lecture' &&
        (await page.locator('[data-reglages-agent="modifiable"]').count()) === 0,
      `icône « ${await raccourci.first().getAttribute('data-raccourci-reglages').catch(() => null)} »`,
    );
    await raccourci.first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(900);
    noter(`${nom} : le menu figé ne montre que la lecture`, (await visible(page.locator('[data-tiroir-reglages="lecture"]'))) && (await page.locator('[data-tiroir-reglages="modifiable"]').count()) === 0);
    const lues = await lignesLues(`${menuOuvert} [data-tiroir-reglages="lecture"] [data-reglage-lu]`, 'data-reglage-lu');
    noter(
      `${nom} : figé, il n’offre plus aucune entrée à cliquer`,
      (await page.locator(`${menuOuvert} [role="menuitem"]`).count()) === 0 && lues.length >= 4,
    );
    /* FIGÉ, LES QUATRE VALEURS SE LISENT TOUJOURS, EN ENTIER : moteur, modèle,
       réflexion, compte — une ligne chacune, aucune coupée. */
    noter(
      `${nom} : figé, les quatre valeurs de la configuration se lisent en entier`,
      lues.slice(0, 4).map((l) => l.nom).join(',') === 'Moteur,Modèle,Réflexion,Compte' &&
        lues.slice(0, 4).every((l) => l.visible && !l.coupe && !!l.valeur),
      JSON.stringify(lues.map((l) => `${l.nom} : ${l.valeur}${l.coupe ? ' (coupée)' : ''}`)),
    );
    await refermerLesMenus();
  } else {
    noter(`${nom} : le bouton « Valider le plan » est présent`, false);
  }

  noter(`${nom} : aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await contexte.close();
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  await new Promise((r) => setTimeout(r, 1500));
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  await parcourir(navigateur, { width: 1400, height: 700 }, 'ordinateur', 'c-ordinateur');

  await parcourir(navigateur, { width: 375, height: 667 }, 'téléphone', 'c-telephone');

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
