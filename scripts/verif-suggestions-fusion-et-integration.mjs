#!/usr/bin/env node
/**
 * LE BLOC « SUGGESTION DE CARTE » D'UNE CARTE SAIT FUSIONNER ET INTÉGRER
 * (demande du 24/10/2026 : « fusionner la 3 et la 4 », et dire qu'une
 * suggestion doit être intégrée à l'agent actuel).
 *
 *   node scripts/verif-suggestions-fusion-et-integration.mjs
 *
 * Le script monte son PROPRE démon (`BELUGA_SUGGESTIONS_PORT`, jamais
 * `BELUGA_URL`), avec une base neuve : une carte dont l'agent a proposé QUATRE
 * cartes. Aucun moteur n'est appelé (`maxAgents: 0`).
 *
 * Ce qui est vérifié, sur ordinateur puis sur téléphone :
 *   1. chaque suggestion porte « Intégrer à cette carte », et l'en-tête du bloc
 *      porte « Fusionner » ;
 *   2. « Fusionner » ouvre une sélection VIDE ; cocher la 3 et la 4 puis
 *      « Fusionner (2) » réunit ces deux-là seulement, sans créer de carte ; les
 *      sources quittent la rangée, la réunie s'y ouvre en modification ;
 *   3. un DOUBLE clic sur « Intégrer à cette carte » n'envoie qu'UN message à
 *      l'agent de la carte (bulle ou file), la suggestion passe en
 *      « integrated » et quitte la rangée, et aucune carte n'est créée.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_SUGGESTIONS_PORT || 7236);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(RACINE, 'data', 'verification', 'suggestions-fusion-integration');
fs.mkdirSync(SHOTS, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-suggestions-', port: PORT });

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(24).toString('hex');
const PROJET_ID = 'p-suggestions';
const CARTE_ID = 'c-suggestions';
const AGENT_ID = 'a-suggestions';
const TITRES = ['Suggestion un', 'Suggestion deux', 'Suggestion trois', 'Suggestion quatre'];
/* La deuxième suggestion naîtra AILLEURS (`proposal.projectId`) : son icône
   doit être celle de ce projet-là, pas celui de la conversation. */
const AUTRE_PROJET_ID = 'p-suggestions-ailleurs';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now() - 120_000;
  for (const table of ['sessions', 'queue', 'proposals', 'messages', 'agents', 'cards', 'projects']) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton), t, t + 3600_000, 'vérification suggestions : fusion et intégration',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = { id: PROJET_ID, name: 'Essai suggestions', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: t, updatedAt: t };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)')
    .run(PROJET_ID, projet.name, DEPOT, JSON.stringify(projet), t, t);

  const ailleurs = { ...projet, id: AUTRE_PROJET_ID, name: 'Projet ailleurs', rank: 2 };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)')
    .run(AUTRE_PROJET_ID, ailleurs.name, DEPOT, JSON.stringify(ailleurs), t, t);

  const carte = { id: CARTE_ID, projectId: PROJET_ID, title: 'Carte qui reçoit les suggestions', origin: 'user', agentId: AGENT_ID };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, 'planned', 1, ?, ?, ?, ?)`,
  ).run(CARTE_ID, PROJET_ID, carte.title, JSON.stringify(carte), t, t);

  const agent = {
    id: AGENT_ID, projectId: PROJET_ID, cardId: CARTE_ID, role: 'cadrage', title: 'Cadrage — essai',
    run: { engine: 'claude', model: 'claude-opus-5', thinking: 'medium', mode: 'direct' }, status: 'done', createdAt: t, updatedAt: t,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, 'cadrage', 'done', ?, ?, ?)`,
  ).run(AGENT_ID, PROJET_ID, CARTE_ID, JSON.stringify(agent), t, t);

  const message = (id, role, data, quand) =>
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, AGENT_ID, role, JSON.stringify({ id, agentId: AGENT_ID, role, createdAt: quand, ...data }), quand);
  message('m-demande', 'user', { content: 'Une demande de départ.' }, t);
  const propositions = TITRES.map((title, i) => ({
    id: `prop-${i + 1}`, title, description: `Description de la ${title.toLowerCase()}.`, labels: ['interface'],
    attachments: [], decision: 'pending', ...(i === 1 ? { projectId: AUTRE_PROJET_ID } : {}),
  }));
  message('m-propositions', 'assistant', { content: 'Je propose quatre cartes.', steps: [], proposals: propositions }, t + 1000);
  for (const p of propositions) {
    db.prepare('INSERT INTO proposals (id, message_id, project_id, decision, data, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(p.id, 'm-propositions', PROJET_ID, 'pending', JSON.stringify(p), t + 1000);
  }
  db.close();
}

function lireEtat() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const proposals = db.prepare('SELECT decision, data FROM proposals WHERE project_id = ? ORDER BY created_at')
    .all(PROJET_ID).map((ligne) => ({ ...JSON.parse(ligne.data), decision: ligne.decision }));
  const cartes = db.prepare('SELECT id FROM cards WHERE project_id = ?').all(PROJET_ID).length;
  const textes = [
    ...db.prepare("SELECT data FROM messages WHERE role = 'user'").all().map((l) => JSON.parse(l.data).content ?? ''),
    ...db.prepare('SELECT data FROM queue').all().map((l) => JSON.parse(l.data).text ?? JSON.parse(l.data).prompt ?? ''),
  ];
  db.close();
  return { proposals, cartes, integrations: textes.filter((x) => /Intègre cette suggestion/.test(x)) };
}

const vignettes = (page) => page.locator('[data-cartes-du-fil] [data-vignette="proposition"]');

async function jouer(navigateur, telephone) {
  poserLeDecor();
  const ecran = telephone ? 'téléphone' : 'ordinateur';
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    ...(telephone ? { isMobile: true, hasTouch: true } : {}),
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  try {
    await page.goto(`${BASE}/#projet/${PROJET_ID}/tache/${CARTE_ID}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const vu = await vignettes(page).nth(3).waitFor({ timeout: 30_000 }).then(() => true, () => false);
    noter(`${ecran} : les quatre suggestions paraissent dans le bloc de la carte`, vu, `${await vignettes(page).count()} vignette(s)`);
    if (!vu) {
      await page.screenshot({ path: path.join(SHOTS, `${ecran}-0-absent.png`) });
      return;
    }
    const pied = page.locator('[data-cartes-du-fil]');

    /* 0. LE PROJET OÙ LA CARTE NAÎTRA (icône + nom) au-dessus de chaque titre : le
       projet noté sur la proposition, sinon celui de l'agent. Sans favicon,
       ce sont les initiales du projet. */
    const icones = await page.evaluate(() =>
      [...document.querySelectorAll('[data-cartes-du-fil] [data-vignette="proposition"]')].map((n) => {
        const icone = n.querySelector('[data-projet-de-proposition]');
        const titre = n.querySelector('[data-titre-de-proposition]');
        const i = icone?.getBoundingClientRect();
        const t = titre?.getBoundingClientRect();
        const v = n.getBoundingClientRect();
        return {
          titre: titre?.textContent ?? '',
          projet: icone?.getAttribute('data-projet-de-proposition') ?? '',
          initiales: !!icone?.querySelector('[data-initiales-projet]'),
          infobulle: icone?.getAttribute('title') ?? '',
          auDessus: !!(i && t && i.bottom <= t.top + 1) && (icone?.querySelector('[data-nom-projet-de-proposition]')?.textContent ?? '').length > 0,
          dansLeCadre: !!(i && t && i.left >= v.left && t.right <= v.right + 1),
        };
      }),
    );
    const attendu = (titre) => (titre === TITRES[1] ? AUTRE_PROJET_ID : PROJET_ID);
    noter(
      `${ecran} : chaque suggestion montre à gauche du titre l'icône du projet où elle naîtra`,
      icones.length === 4 && icones.every((i) => i.projet === attendu(i.titre) && i.initiales && i.auDessus && i.dansLeCadre),
      JSON.stringify(icones.map((i) => [i.titre, i.projet, i.auDessus, i.dansLeCadre])),
    );
    noter(
      `${ecran} : l'infobulle de l'icône nomme le projet`,
      icones.find((i) => i.titre === TITRES[1])?.infobulle.includes('Projet ailleurs') &&
        icones.find((i) => i.titre === TITRES[0])?.infobulle.includes('Essai suggestions'),
    );
    // Sur téléphone le pied peut replier le bloc : on le déplie.
    if ((await pied.getAttribute('data-suggestions-repli')) === 'ferme') await page.locator('[data-suggestions-bascule]').click();
    noter(
      `${ecran} : chaque suggestion porte « Intégrer à cette carte »`,
      (await pied.getByRole('button', { name: /Intégrer à cette carte/ }).count()) === 4,
    );
    const ouvrirFusion = pied.locator('[data-fusion-propositions="ouvrir"]');
    noter(`${ecran} : l'en-tête du bloc porte « Fusionner »`, await ouvrirFusion.isVisible());
    await page.screenshot({ path: path.join(SHOTS, `${ecran}-1-bloc.png`) });

    /* 2. La 3 et la 4, et elles seules. */
    await ouvrirFusion.click();
    const actions = pied.locator('[data-fusion-propositions="actions"]');
    noter(`${ecran} : la sélection s'ouvre vide`, await actions.getByRole('button', { name: /Fusionner \(0\)/ }).isDisabled());
    noter(
      `${ecran} : « Intégrer » est éteint pendant la sélection`,
      await pied.getByRole('button', { name: /Intégrer à cette carte/ }).first().isDisabled(),
    );
    for (const titre of [TITRES[2], TITRES[3]]) {
      const case_ = pied.getByRole('button', { name: `Ajouter « ${titre} » à la fusion` });
      await case_.scrollIntoViewIfNeeded();
      await case_.click();
    }
    await page.screenshot({ path: path.join(SHOTS, `${ecran}-2-selection.png`) });
    await actions.getByRole('button', { name: /Fusionner \(2\)/ }).click();
    await page.waitForTimeout(1500);
    const apresFusion = lireEtat();
    const sources = apresFusion.proposals.filter((p) => p.id === 'prop-3' || p.id === 'prop-4');
    const reunie = apresFusion.proposals.find((p) => p.sourceProposalIds?.length);
    noter(`${ecran} : la 3 et la 4 sont réunies`, sources.every((p) => p.decision === 'merged') && !!reunie);
    noter(
      `${ecran} : la 1 et la 2 restent en attente`,
      apresFusion.proposals.filter((p) => p.id === 'prop-1' || p.id === 'prop-2').every((p) => p.decision === 'pending'),
    );
    noter(`${ecran} : la fusion ne crée aucune carte`, apresFusion.cartes === 1);
    const titresVus = await vignettes(page).evaluateAll((n) => n.map((x) => x.textContent ?? ''));
    noter(
      `${ecran} : les sources quittent la rangée, la réunie y entre`,
      titresVus.length === 3 && !(await pied.locator('[data-carte-nee-du-fil]').count()),
      `${titresVus.length} vignette(s)`,
    );
    noter(`${ecran} : la réunie s'ouvre en modification`, (await pied.locator('[data-vignette="proposition"] input').count()) === 1);

    /* 3. Intégrer la 1, d'un double clic. */
    const premiere = vignettes(page).filter({ hasText: TITRES[0] });
    const integrer = premiere.getByRole('button', { name: /Intégrer à cette carte/ });
    await integrer.scrollIntoViewIfNeeded();
    await integrer.dblclick();
    await page.waitForTimeout(2500);
    const apresIntegration = lireEtat();
    noter(
      `${ecran} : la suggestion passe en « intégrée »`,
      apresIntegration.proposals.find((p) => p.id === 'prop-1')?.decision === 'integrated',
    );
    noter(
      `${ecran} : un seul message part à l'agent de la carte`,
      apresIntegration.integrations.length === 1 && apresIntegration.integrations[0].includes(TITRES[0]),
      `${apresIntegration.integrations.length} message(s)`,
    );
    noter(`${ecran} : intégrer ne crée aucune carte`, apresIntegration.cartes === 1);
    noter(`${ecran} : la suggestion intégrée quitte la rangée`, (await premiere.count()) === 0 && (await vignettes(page).count()) === 2);
    await page.screenshot({ path: path.join(SHOTS, `${ecran}-3-apres.png`) });

    /* 4. Créer la carte de la 2 : la carte acceptée garde l'icône de SON projet. */
    const deuxieme = vignettes(page).filter({ hasText: TITRES[1] });
    await deuxieme.getByRole('button', { name: /Créer la carte/ }).click();
    const acceptee = page.locator('[data-cartes-du-fil] [data-carte-proposee="validee"]').filter({ hasText: TITRES[1] });
    const nee = await acceptee.waitFor({ timeout: 15_000 }).then(() => true, () => false);
    noter(
      `${ecran} : la carte acceptée garde l'icône du projet où elle est née`,
      nee && (await acceptee.locator(`[data-projet-de-proposition="${AUTRE_PROJET_ID}"]`).count()) === 1,
    );
    await page.screenshot({ path: path.join(SHOTS, `${ecran}-4-acceptee.png`) });
    noter(`${ecran} : aucune erreur de page`, erreurs.length === 0, erreurs[0] ?? '');
  } finally {
    await contexte.close();
  }
}

if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}
const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  await jouer(navigateur, false);
  await jouer(navigateur, true);
} finally {
  await navigateur.close();
}
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
