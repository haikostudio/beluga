#!/usr/bin/env node
/**
 * L'ÉQUIPE D'AGENTS DANS LE VRAI NAVIGATEUR (carte « Beluga piloté par des agents », 26/11/2026).
 *
 * Démon JETABLE (`scripts/lib/demon-d-essai.mjs`, garde `BELUGA_AGENTS_PERSO_SANS_MOTEUR=1` : aucun tour ne part au
 * moteur), session d'une heure fabriquée en base (jeton haché), deux projets dans un groupe. Ce qui est vérifié :
 *
 *  1. l'équipe par défaut est SEMÉE à la première ouverture d'un projet (cinq agents, visages tous différents) et celle
 *     du groupe (deux agents) ; rejouer la lecture n'en sème pas davantage ;
 *  2. la page d'un projet : discussion à gauche, volet à droite avec la barre d'onglets standard « Équipe | Tâches »,
 *     la table (agents, « Vous » au centre, liaisons tracées entre agents qui ont échangé), pied « Nouvel agent »
 *     pleine largeur ; « Tâches » montre ses groupes et le pied « Nouvelle tâche » ;
 *  3. la table à 3, 10 et 20 agents qui vous attendent : aucun prénom tronqué, aucun libellé superposé, rien ne déborde ;
 *  4. le « + » au survol d'un agent ;
 *  5. la page de chaque métier : ses onglets d'outil, la fiche en dernier, le fil d'Ariane avec visage, prénom, métier
 *     et état ; « Mise en ligne » chez l'agent de déploiement ;
 *  6. la barre du haut : « Déployer » nommé, UN seul menu à trois points ;
 *  7. la colonne : ni « Services » ni « Nouvel artefact », « Au travail », les agents sous le projet déplié, les
 *     services dans le menu à trois points ;
 *  8. un message à l'équipe entre au journal et paraît dans la discussion ;
 *  9. à 1440, 1024 et 390 px, en clair et en sombre, rien ne déborde en largeur.
 *
 * Jamais `BELUGA_URL` ni `BELUGA_TOKEN`. Depuis la copie de la carte, jamais depuis le dépôt principal :
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-equipe-d-agents.mjs   (VERIF_CAPTURES=/tmp/x pour les images)
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7211);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail && !ok ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-equipe-',
  port: PORT,
  signaux: true,
  env: { BELUGA_AGENTS_PERSO_SANS_MOTEUR: '1' },
});
const jeton = crypto.randomBytes(32).toString('hex');
const T = Date.now();
const PROJET = 'p-boutique';
const AUTRE = 'p-atelier';
const GROUPE = 'g-maison';
const base = () => new Database(path.join(DATA, 'beluga.db'));

function poserLeDecor() {
  const db = base();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai');
  const projet = (id, name, rank, extra = {}) => {
    const p = { id, name, path: DEPOT, defaultEngine: 'claude', isSelf: false, rank, archived: false, createdAt: T, updatedAt: T, ...extra };
    db.prepare('INSERT OR REPLACE INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(id, name, DEPOT, JSON.stringify(p), T, T);
  };
  projet(GROUPE, 'Maison', 1, { regroupement: true });
  projet(PROJET, 'Boutique', 2, { regroupementId: GROUPE });
  projet(AUTRE, 'Atelier', 3);
  db.close();
}

function poserLeTheme(clarte) {
  const db = base();
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('theme', JSON.stringify(clarte), Date.now());
  db.close();
}

/** Un agent qui VOUS ATTEND : une question ouverte dans sa conversation (comme une validation demandée). */
function faireAttendre(db, agentPersoId) {
  const agentId = `essai-${agentPersoId}`;
  db.prepare('UPDATE agents_perso SET agent_id = COALESCE(agent_id, ?) WHERE id = ?').run(agentId, agentPersoId);
  const reel = db.prepare('SELECT agent_id FROM agents_perso WHERE id = ?').get(agentPersoId).agent_id;
  const question = { id: crypto.randomUUID(), question: 'Je valide ce plan ?', kind: 'single', options: [{ id: 'oui', label: 'Oui' }], allowFreeText: false };
  const message = { id: crypto.randomUUID(), agentId: reel, role: 'assistant', content: 'À valider : le plan.', questions: [question], createdAt: Date.now(), attachments: [], todos: [] };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at, a_questions) VALUES (?, ?, ?, ?, ?, 1)').run(
    message.id,
    reel,
    'assistant',
    JSON.stringify(message),
    message.createdAt,
  );
}

/** Des agents de plus, chacun avec un portrait libre, tous en attente : la table se remplit. */
function ajouterDesAgents(projectId, nombre, prenoms) {
  const db = base();
  const pris = new Set(db.prepare('SELECT portrait FROM agents_perso WHERE project_id = ?').all(projectId).map((l) => l.portrait));
  const reserve = fs
    .readdirSync(path.join(process.cwd(), 'web', 'public', 'portraits'))
    .map((f) => f.replace(/\.webp$/, ''))
    .filter((id) => !pris.has(id));
  for (let i = 0; i < nombre; i++) {
    const id = crypto.randomUUID();
    const fiche = { nom: prenoms[i % prenoms.length], mission: 'Une mission d’essai.', declencheurs: [{ genre: 'manuel' }], faitSeul: [], demandeAccord: [], jamais: [], emporte: { competences: [], acces: [], memoire: true }, limite: 'aucune' };
    db.prepare('INSERT INTO agents_perso (id, project_id, agent_id, card_id, fiche, actif, cree_le, mis_a_jour_le, role, portrait, autonome) VALUES (?, ?, NULL, NULL, ?, 0, ?, ?, ?, ?, 1)').run(
      id,
      projectId,
      JSON.stringify(fiche),
      Date.now() + i,
      Date.now(),
      'libre',
      reserve[i],
    );
  }
  for (const { id } of db.prepare('SELECT id FROM agents_perso WHERE project_id = ?').all(projectId)) faireAttendre(db, id);
  db.close();
}

function poserDesEchanges(projectId) {
  const db = base();
  const ids = db.prepare('SELECT id, role FROM agents_perso WHERE project_id = ? ORDER BY cree_le').all(projectId);
  const parRole = Object.fromEntries(ids.map((l) => [l.role, l.id]));
  const ajouter = (de, a, texte, decalage) =>
    db.prepare('INSERT INTO agents_echanges (id, project_id, de, a, texte, date, profondeur) VALUES (?, ?, ?, ?, ?, ?, 0)').run(crypto.randomUUID(), projectId, de, a, texte, Date.now() - decalage);
  ajouter('vous', 'equipe', 'Objectif de la semaine : remplir le carnet de demandes pour janvier.', 40 * 60_000);
  ajouter(parRole.com, parRole.marketing, 'Quels arguments ressortent de ton étude pour l’offre complète ?', 30 * 60_000);
  ajouter(parRole.marketing, parRole.com, 'Prix fixe, un seul interlocuteur, en ligne en trois semaines.', 28 * 60_000);
  ajouter(parRole.com, parRole.dev, 'La page Portfolio dit encore « en cours de développement ». Tu corriges ?', 20 * 60_000);
  ajouter(parRole.dev, parRole.deploiement, 'Correction prête de mon côté. Tu vérifies et tu déploies ?', 10 * 60_000);
  ajouter(parRole.deploiement, 'vous', 'Tout est vérifié : deux tâches sont prêtes. Je déploie ?', 5 * 60_000);
  db.close();
}

async function capturer(page, nom) {
  if (!CAPTURES) return;
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

/** Rien ne déborde en largeur sur la page. */
async function sansDebord(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/** Les libellés de la table : aucun prénom tronqué, aucun libellé superposé à un autre. */
async function libellesDeLaTable(page) {
  return page.evaluate(() => {
    const boites = [...document.querySelectorAll('[data-libelle-a-table]')].map((el) => {
      const nom = el.querySelector('span > span');
      const r = (el.querySelector('span') ?? el).getBoundingClientRect();
      return { r, tronque: nom ? nom.scrollWidth > nom.clientWidth + 1 : true };
    });
    let superposes = 0;
    for (let i = 0; i < boites.length; i++)
      for (let j = i + 1; j < boites.length; j++) {
        const a = boites[i].r;
        const b = boites[j].r;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) superposes++;
      }
    return { nombre: boites.length, tronques: boites.filter((b) => b.tronque).length, superposes };
  });
}

async function ouvrir(page, adresse, attendre) {
  /* La même adresse ne recharge rien (seul le fragment change) : on recharge pour relire la base. */
  if (page.url() === `${BASE}/#${adresse}`) await page.reload({ waitUntil: 'domcontentloaded' });
  else await page.goto(`${BASE}/#${adresse}`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector(attendre, { timeout: 30000 });
  } catch (err) {
    if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `echec-${adresse.replace(/\W+/g, '-')}.png`) });
    throw err;
  }
  await page.waitForTimeout(700);
}

let code = 0;
try {
  if (!(await attendrePort(90_000))) throw new Error(`le démon d’essai ne répond pas\n${journal.join('').slice(-2000)}`);
  await new Promise((r) => setTimeout(r, 1500));
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  for (const clarte of ['dark', 'light']) {
    poserLeTheme(clarte);
    const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    page.on('pageerror', (err) => console.log(`  [erreur de page] ${err.message}`));
    page.on('console', (m) => m.type() === 'error' && console.log(`  [console] ${m.text().slice(0, 300)}`));
    console.log(`\n— ${clarte === 'dark' ? 'Sombre' : 'Clair'}`);

    /* 1. Le semis. */
    await ouvrir(page, `projet/${PROJET}`, '[data-table-de-l-equipe]');
    await page.waitForFunction(() => document.querySelectorAll('[data-agent-a-table], [data-agent-au-repos]').length >= 7, null, { timeout: 30000 }).catch(() => undefined);
    if (clarte === 'dark') {
      const db = base();
      const lignes = db.prepare('SELECT project_id, role, portrait FROM agents_perso').all();
      db.close();
      const duProjet = lignes.filter((l) => l.project_id === PROJET);
      const duGroupe = lignes.filter((l) => l.project_id === GROUPE);
      verifier('l’équipe par défaut est semée : cinq métiers dans le projet', ['dev', 'com', 'marketing', 'deploiement', 'production'].every((r) => duProjet.some((l) => l.role === r)) && duProjet.length === 5, JSON.stringify(duProjet));
      verifier('le groupe a ses deux agents', duGroupe.length === 2, JSON.stringify(duGroupe));
      verifier('deux agents d’une équipe n’ont jamais le même visage', new Set(duProjet.map((l) => l.portrait)).size === duProjet.length);
      await page.reload();
      await page.waitForSelector('[data-table-de-l-equipe]');
      await page.waitForTimeout(800);
      const db2 = base();
      const encore = db2.prepare('SELECT COUNT(*) AS n FROM agents_perso WHERE project_id = ?').get(PROJET).n;
      db2.close();
      verifier('relire l’équipe ne sème rien de plus', encore === 5, String(encore));
      poserDesEchanges(PROJET);
      await page.reload();
      await page.waitForSelector('[data-table-de-l-equipe]');
      await page.waitForTimeout(1200);
    }

    /* 2. La page du projet. */
    const forme = await page.evaluate(() => {
      const discussion = document.querySelector('[data-discussion-de-la-page="projet"]')?.getBoundingClientRect();
      const volet = document.querySelector('[data-volet-equipe="projet"]')?.getBoundingClientRect();
      const barre = document.querySelector('[data-barre-onglets="projet-onglets"]');
      return {
        discussionAGauche: !!discussion && !!volet && discussion.right <= volet.left + 2,
        voletPleineHauteur: !!volet && volet.height > window.innerHeight - 120,
        onglets: [...(barre?.querySelectorAll('[data-onglet]') ?? [])].map((o) => o.textContent?.trim()),
        variante: barre?.getAttribute('data-variante-onglets'),
        grandTitre: !!document.querySelector('[data-titre-de-page="accueil-du-projet"]'),
        pied: document.querySelector('[data-nouvel-agent-de-l-equipe]')?.getBoundingClientRect().width ?? 0,
        largeurVolet: volet?.width ?? 0,
        vous: !!document.querySelector('[data-vous-au-centre]'),
        liaisons: document.querySelectorAll('[data-liaison]').length,
        echanges: document.querySelectorAll('[data-echange]').length,
      };
    });
    verifier('discussion à gauche, volet pleine hauteur à droite', forme.discussionAGauche && forme.voletPleineHauteur, JSON.stringify(forme));
    verifier('la barre d’onglets standard porte « Équipe | Tâches »', forme.onglets.join('|') === 'Équipe|Tâches' && forme.variante === 'accueil', JSON.stringify(forme.onglets));
    verifier('plus de grand titre en doublon du fil d’Ariane', !forme.grandTitre);
    verifier('« Nouvel agent » en pied, sur toute la largeur du volet', forme.pied > forme.largeurVolet - 80, `${forme.pied} / ${forme.largeurVolet}`);
    verifier('« Vous » au centre de la table', forme.vous);
    verifier('les agents qui ont échangé sont reliés', forme.liaisons >= 3, String(forme.liaisons));
    verifier('la discussion de l’équipe montre les échanges', forme.echanges >= 6, String(forme.echanges));
    const fil = await page.evaluate(() => document.querySelector('[data-fil-du-projet]')?.textContent?.trim() ?? '');
    verifier('le fil d’Ariane dit le projet', fil.includes('Boutique'), fil);
    await capturer(page, `projet-equipe-1440-${clarte}`);

    /* 4. Le « + » au survol. */
    const premier = page.locator('[data-agent-a-table]').first();
    await premier.hover();
    await page.waitForTimeout(300);
    const plus = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[data-plus-au-survol]')].find((x) => getComputedStyle(x.parentElement.parentElement).opacity === '1' || getComputedStyle(x.closest('.absolute')).opacity === '1');
      return !!b;
    });
    verifier('un « + » paraît au survol d’un agent', plus);
    await capturer(page, `projet-survol-1440-${clarte}`);

    /* 6. La barre du haut. */
    const haut = await page.evaluate(() => ({
      deployer: document.querySelector('[data-bouton-deployer]')?.textContent?.trim() ?? '',
      troisPoints: [...document.querySelectorAll('[data-menu-general], [data-options-de-page="menu"]')].filter((el) => el.getClientRects().length).length,
    }));
    verifier('« Déployer » est nommé dans la barre du haut', /Déployer/.test(haut.deployer), haut.deployer);
    verifier('un seul menu à trois points en haut à droite', haut.troisPoints === 1, String(haut.troisPoints));

    /* 7. La colonne. */
    /* Par leur NOM affiché : les deux lignes ont quitté la colonne avec leurs repères. */
    const colonne = await page.evaluate(() => {
      const textes = [...document.querySelectorAll('aside[data-zone="gauche"] [data-tete-de-colonne] :is(a, button), aside[data-zone="gauche"] [data-drop-root] > div > :is(a, button)')].map((el) => (el.textContent ?? '').trim());
      return { services: textes.some((x) => /^Services/.test(x)), artefact: textes.some((x) => /Nouvel artefact/.test(x)) };
    });
    verifier('ni « Services » ni « Nouvel artefact » dans la colonne', !colonne.services && !colonne.artefact, JSON.stringify(colonne));
    /* Le projet est dans le groupe « Maison » : on déplie d'abord le groupe. */
    const groupe = page.locator(`[data-deplier-regroupement="${GROUPE}"]`).first();
    if ((await groupe.count()) && !(await page.locator(`[data-membres-regroupement="${GROUPE}"]`).count())) await groupe.click();
    await page.waitForTimeout(400);
    const fleche = page.locator(`[data-deplier-taches="${PROJET}"]`).first();
    if (await fleche.count()) {
      const deplie = (await fleche.getAttribute('aria-expanded')) === 'true';
      if (!deplie) await fleche.click();
      await page.waitForSelector(`[data-agents-du-projet-colonne="${PROJET}"] [data-agent-de-la-colonne]`, { timeout: 10000 }).catch(() => undefined);
    }
    const agentsColonne = await page.locator(`[data-agents-du-projet-colonne="${PROJET}"] [data-agent-de-la-colonne]`).count();
    verifier('les agents du projet sont listés sous lui dans la colonne', agentsColonne >= 4, String(agentsColonne));
    await page.click('[data-menu-dossier]');
    await page.waitForTimeout(250);
    const menu = await page.evaluate(() => ({
      coffre: !!document.querySelector('[data-service-du-menu-colonne="coffre"]'),
      memoire: !!document.querySelector('[data-service-du-menu-colonne="memoire"]'),
      tous: !!document.querySelector('[data-tous-les-services]'),
    }));
    verifier('Coffre-fort, Mémoire et « Tous les services » sont dans le menu à trois points de la colonne', menu.coffre && menu.memoire && menu.tous, JSON.stringify(menu));
    await page.keyboard.press('Escape');

    /* 2 bis. L'onglet Tâches. */
    await page.click('[data-barre-onglets="projet-onglets"] [data-onglet="taches"]');
    await page.waitForSelector('[data-taches-de-l-equipe], [data-nouvelle-tache-de-l-equipe]', { timeout: 10000 });
    await page.waitForTimeout(500);
    verifier('l’onglet « Tâches » a son pied « Nouvelle tâche »', (await page.locator('[data-nouvelle-tache-de-l-equipe]').count()) === 1);
    await capturer(page, `projet-taches-1440-${clarte}`);
    await page.click('[data-barre-onglets="projet-onglets"] [data-onglet="equipe"]');
    await page.waitForTimeout(400);

    /* 5. La page de chaque métier. */
    const db = base();
    const membres = db.prepare('SELECT id, role FROM agents_perso WHERE project_id = ?').all(PROJET);
    db.close();
    const ongletsAttendus = {
      dev: ['Tâches', 'Aperçu', 'Fiche'],
      com: ['Calendrier', 'Réseaux', 'Studio', 'Fiche'],
      marketing: ['Dossier', 'Référencement', 'Statistiques', 'Fiche'],
      deploiement: ['Mise en ligne', 'Fiche'],
      production: ['État du site', 'Sauvegardes', 'Sécurité', 'Fiche'],
    };
    for (const m of membres) {
      if (!ongletsAttendus[m.role]) continue;
      await ouvrir(page, `projet/${PROJET}/agents/${m.id}`, `[data-page-agent-perso="${m.id}"] [data-barre-onglets="agent-onglets"]`);
      const lu = await page.evaluate(() => ({
        onglets: [...document.querySelectorAll('[data-barre-onglets="agent-onglets"] [data-onglet]')].map((o) => o.textContent?.trim()),
        cran: !!document.querySelector('[data-cran-de-l-agent] [data-portrait-d-agent]'),
        etat: document.querySelector('[data-cran-de-l-agent]')?.getAttribute('data-cran-de-l-agent'),
        nom: document.querySelector('[data-nom-du-cran-agent]')?.textContent?.trim(),
      }));
      verifier(`(${m.role}) ses outils en onglets, la fiche en dernier`, lu.onglets.join('|') === ongletsAttendus[m.role].join('|'), lu.onglets.join('|'));
      verifier(`(${m.role}) le fil d’Ariane porte son visage, son prénom et son état`, lu.cran && !!lu.nom && !!lu.etat, JSON.stringify(lu));
      if (clarte === 'dark' || m.role === 'com') await capturer(page, `agent-${m.role}-1440-${clarte}`);
      if (m.role === 'deploiement') {
        const miseEnLigne = await page.locator('[data-outil-mise-en-ligne]').count();
        verifier('l’agent de déploiement montre la mise en ligne (le vrai bouton reste au clic)', miseEnLigne === 1);
      }
      if (m.role === 'dev') {
        await page.click('[data-barre-onglets="agent-onglets"] [data-onglet="fiche"]');
        await page.waitForSelector('[data-reglages-du-membre]');
        await page.waitForTimeout(300);
        verifier('la fiche porte le choix du visage et « libre avec ses collègues »', (await page.locator('[data-choix-du-portrait] [data-portrait-a-choisir]').count()) >= 50 && (await page.locator('[data-libre-avec-ses-collegues]').count()) === 1);
        if (clarte === 'dark') await capturer(page, `agent-dev-fiche-1440-${clarte}`);
        await page.click('[data-barre-onglets="agent-onglets"] [data-onglet="taches"]');
      }
    }

    /* 8. Un message à l'équipe. */
    if (clarte === 'dark') {
      await ouvrir(page, `projet/${PROJET}`, '[data-texte-de-l-equipe]');
      const avant = await page.locator('[data-echange]').count();
      await page.fill('[data-texte-de-l-equipe]', 'Prépare les posts LinkedIn de décembre.');
      await page.click('[data-envoyer-a-l-equipe]');
      await page.waitForFunction((n) => document.querySelectorAll('[data-echange]').length > n, avant, { timeout: 15000 }).catch(() => undefined);
      const apres = await page.locator('[data-echange]').count();
      verifier('un message à toute l’équipe entre dans la discussion', apres > avant, `${avant} → ${apres}`);
    }

    /* 3. La table à 3, 10 et 20 agents qui attendent. */
    if (clarte === 'dark') {
      ajouterDesAgents(PROJET, 5, ['Nora', 'Sam', 'Inès', 'Lina', 'Jade']);
      await ouvrir(page, `projet/${PROJET}`, '[data-table-de-l-equipe]');
      await page.waitForTimeout(1000);
      let l = await libellesDeLaTable(page);
      verifier('table à 10 agents : aucun prénom tronqué, aucun libellé superposé', l.nombre >= 10 && !l.tronques && !l.superposes, JSON.stringify(l));
      await capturer(page, 'table-10-1440-dark');
      ajouterDesAgents(PROJET, 10, ['Hugo', 'Claire', 'Paul', 'Rose', 'Yanis', 'Mila', 'Théo', 'Anna', 'Omar', 'Léon']);
      await ouvrir(page, `projet/${PROJET}`, '[data-table-de-l-equipe]');
      await page.waitForTimeout(1000);
      l = await libellesDeLaTable(page);
      verifier('table à 20 agents : aucun prénom tronqué, aucun libellé superposé', l.nombre >= 20 && !l.tronques && !l.superposes, JSON.stringify(l));
      await capturer(page, 'table-20-1440-dark');
      verifier('1440 px : rien ne déborde en largeur', (await sansDebord(page)) <= 0);
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.waitForTimeout(800);
      l = await libellesDeLaTable(page);
      verifier('1024 px : table à 20 agents lisible', !l.tronques && !l.superposes, JSON.stringify(l));
      verifier('1024 px : rien ne déborde en largeur', (await sansDebord(page)) <= 0);
      await capturer(page, 'table-20-1024-dark');
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await contexte.close();

    /* 9. Le téléphone. */
    const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const p = await tel.newPage();
    await ouvrir(p, `projet/${PROJET}`, '[data-gabarit-equipe="projet"]');
    const ongletsTel = await p.evaluate(() => [...document.querySelectorAll('[data-barre-onglets="projet-onglets"] [data-onglet]')].map((o) => o.textContent?.trim()));
    verifier('390 px : la discussion et le volet deviennent des onglets', ongletsTel.join('|') === 'Discussion|Équipe|Tâches', ongletsTel.join('|'));
    verifier('390 px : rien ne déborde en largeur (discussion)', (await sansDebord(p)) <= 0);
    await capturer(p, `projet-discussion-390-${clarte}`);
    await p.click('[data-barre-onglets="projet-onglets"] [data-onglet="equipe"]');
    await p.waitForTimeout(800);
    verifier('390 px : rien ne déborde en largeur (équipe)', (await sansDebord(p)) <= 0);
    const lt = await libellesDeLaTable(p);
    verifier(`390 px : la table (${lt.nombre} agents) garde ses libellés entiers et séparés`, !lt.tronques && !lt.superposes, JSON.stringify(lt));
    await capturer(p, `projet-equipe-390-${clarte}`);
    await tel.close();
  }
  await navigateur.close();
} catch (err) {
  console.error(err);
  code = 1;
} finally {
  nettoyer();
}
const echecs = resultats.filter((r) => !r).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles réussis`);
process.exit(code || (echecs ? 1 : 0));
