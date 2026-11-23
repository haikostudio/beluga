#!/usr/bin/env node
/**
 * LE TABLEAU DE BORD À BLOCS DU SERVICE STATISTIQUES, DANS UN VRAI NAVIGATEUR,
 * SUR UN DÉMON D'ESSAI (demande du 28/09/2026).
 *
 *  1. l'Audience rend chacun de ses blocs (chiffres clés, courbes, utilisateurs
 *     actifs, pays, provenance, appareils, heures, jours, pages d'entrée et de
 *     sortie…) à partir d'événements posés en base, pays compris ;
 *  2. glisser un bloc par sa poignée (événements de pointeur) change l'ordre,
 *     et l'ordre SURVIT au rechargement (préférence en base) ;
 *  3. masquer un bloc le retire, le menu « Blocs » le rend, « Rétablir la
 *     disposition » remet l'ordre d'origine ;
 *  4. le Parcours LISTE les parcours déclarés (conversion finale de chacun) ;
 *     un parcours ouvert montre son flux de conversion aux BONS TAUX, ses
 *     abandons et la nomenclature de ses étapes ; plus de bloc « Lecture » ni
 *     « Conversion par objectif » ; les chemins sont des barres ; le flux de
 *     comportement vit dans l'Audience, juste après « Visiteurs par jour » ;
 *  5. « Relancer l'analyse des objectifs » fait naître UNE carte dans le
 *     projet, et le bouton devient « Voir l'agent au travail » ;
 *  6. à 390 px, rien ne déborde ; captures en clair et en sombre ;
 *  7. LA LISTE EN TABLEAU : visites, visiteurs, objectifs atteints et flèche
 *     de tendance (28 jours contre les 28 d'avant), chiffres alignés à droite,
 *     tri par colonne (second clic inverse) gardé au rechargement ;
 *  8. LA BARRE D'OUTILS pleine largeur sous les onglets : résumé des parcours, bouton de
 *     l'agent, dates, puis « Blocs » tout à droite.
 *
 *   node scripts/verif-statistiques-tableau.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKO_STATS_TABLEAU_PORT || 7207);
const BASE = `http://127.0.0.1:${PORT}`;
const PROJET = 'p-tableau';
const SECOND = 'p-tableau-beta';
const INACTIF = 'p-tableau-dormant';
const AUTONOME = 'site:essai-autonome';

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
console.log(`  …  dépôt jugé : ${RACINE}`);

const { DATA, PROJETS, attendrePort, journal } = demarrerDemonDEssai({
  prefixe: 'verif-stats-tableau-',
  port: PORT,
  depot: false,
  env: { BELUGA_ADRESSE_PUBLIQUE: BASE, BELUGA_MARKETING_NUIT: '0', BELUGA_BASE_PAYS: '0' },
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const base = () => new Database(path.join(DATA, 'beluga.db'));

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), maintenant, maintenant + 3600_000, 'vérification tableau statistiques');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
    PROJET,
    'Atelier Tableau',
    path.join(PROJETS, PROJET),
    JSON.stringify({ id: PROJET, name: 'Atelier Tableau', path: path.join(PROJETS, PROJET), defaultEngine: 'claude', isSelf: false, branchesDePublication: {}, rank: 1000, archived: false, createdAt: maintenant, updatedAt: maintenant }),
    maintenant,
    maintenant,
  );
  db.prepare(
    `INSERT INTO marketing_espaces (project_id, cle_suivi, adresse, origines, methode_suivi, etat_suivi, langue, mode_suivi, cree_le, maj_le)
     VALUES (?, 'cletableau', 'https://tableau.exemple/', '["https://tableau.exemple"]', 'manuel', 'verifie', 'fr', 'visiteur', ?, ?)`,
  ).run(PROJET, maintenant, maintenant);
  const repere = db.prepare('INSERT INTO stats_reperes (project_id, nom, emplacement, raison, objectif, ordre, pose_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  repere.run(PROJET, 'voir-tarifs', 'Accueil, lien Tarifs', 'Qui s’intéresse aux prix', 1, 0, 'agent-essai', maintenant - 40 * 86_400_000);
  repere.run(PROJET, 'reserver', 'Page Tarifs, bouton Réserver', 'Le but du site', 1, 1, 'agent-essai', maintenant - 40 * 86_400_000);
  // Deux parcours déclarés par l'agent : réserver (6 → 4 → 2) et découvrir les tarifs (6 → 4).
  const parcours = db.prepare('INSERT INTO stats_parcours (project_id, id, nom, objectif, description, etapes, ordre, pose_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  parcours.run(PROJET, 'reserver-une-table', 'Réserver une table', 'La réservation est envoyée', 'Le but premier du site.', JSON.stringify([
    { repere: 'voir-tarifs', libelle: 'Voit les tarifs', description: 'Il clique sur « Tarifs » depuis l’accueil.' },
    { repere: 'reserver', libelle: 'Réserve', description: 'Il envoie sa réservation.' },
  ]), 0, 'agent-essai', maintenant - 40 * 86_400_000);
  parcours.run(PROJET, 'decouvrir-les-tarifs', 'Découvrir les tarifs', 'La page des tarifs est lue', '', JSON.stringify([{ repere: '/tarifs', libelle: 'Lit la page Tarifs', description: '' }]), 1, 'agent-essai', maintenant - 40 * 86_400_000);

  /* SIX sessions reconnues : toutes arrivent sur « / », quatre voient les tarifs, deux réservent.
     Flux de conversion attendu : 6 → 4 (66,7 %) → 2 (50 %). Plus trois visiteurs anonymes. */
  const ev = db.prepare(
    `INSERT INTO marketing_evenements (project_id, instant, type, chemin, source, visiteur, visite, duree_ms, appareil, visiteur_persistant, session, repere, pays)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const pays = ['CH', 'CH', 'FR', 'CH', 'DE', 'FR'];
  const sources = ['google', 'linkedin', 'direct', 'google', 'google', 'direct'];
  for (let i = 0; i < 6; i++) {
    const t = maintenant - (i + 1) * 86_400_000 + i * 3600_000;
    const vp = `persistant${String(i).padStart(6, '0')}`;
    const s = `session${String(i).padStart(9, '0')}`;
    const commun = [`jour${i}`, `v${i}`];
    ev.run(PROJET, t, 'vue', '/', sources[i], ...commun, null, i % 2 ? 'mobile' : 'ordinateur', vp, s, null, pays[i]);
    if (i < 4) ev.run(PROJET, t + 5000, 'repere', '/', null, ...commun, null, null, vp, s, 'voir-tarifs', pays[i]);
    if (i < 4) ev.run(PROJET, t + 8000, 'vue', '/tarifs', null, ...commun, null, null, vp, s, null, pays[i]);
    if (i < 2) ev.run(PROJET, t + 12000, 'repere', '/tarifs', null, ...commun, null, null, vp, s, 'reserver', pays[i]);
    ev.run(PROJET, t + 20000, 'sortie', '/', null, ...commun, 45_000, null, vp, s, null, pays[i]);
  }
  for (let i = 0; i < 3; i++) ev.run(PROJET, maintenant - (i + 2) * 3600_000, 'vue', '/contact', 'direct', `anonyme${i}`, `a${i}`, null, 'ordinateur', null, null, null, 'US');
  // Les 28 jours d'avant : trois visites (hors de la période de l'Audience) — tendance attendue +200 %.
  for (let i = 0; i < 3; i++) ev.run(PROJET, maintenant - 35 * 86_400_000, 'vue', '/', 'direct', `ancien${i}`, `x${i}`, null, 'ordinateur', null, null, null, 'CH');
  // Un second projet qui baisse : une visite maintenant, quatre avant.
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
    SECOND,
    'Boutique Bêta',
    path.join(PROJETS, SECOND),
    JSON.stringify({ id: SECOND, name: 'Boutique Bêta', path: path.join(PROJETS, SECOND), defaultEngine: 'claude', isSelf: false, branchesDePublication: {}, rank: 1001, archived: false, createdAt: maintenant, updatedAt: maintenant }),
    maintenant,
    maintenant,
  );
  db.prepare(
    `INSERT INTO marketing_espaces (project_id, cle_suivi, adresse, origines, methode_suivi, etat_suivi, langue, mode_suivi, cree_le, maj_le)
     VALUES (?, 'clebeta', 'https://beta.exemple/', '["https://beta.exemple"]', 'manuel', 'verifie', 'fr', 'anonyme', ?, ?)`,
  ).run(SECOND, maintenant, maintenant);
  ev.run(SECOND, maintenant - 86_400_000, 'vue', '/', 'direct', 'b0', 'b0', null, 'ordinateur', null, null, null, 'CH');
  for (let i = 0; i < 4; i++) ev.run(SECOND, maintenant - 40 * 86_400_000, 'vue', '/', 'direct', `bx${i}`, `bx${i}`, null, 'ordinateur', null, null, null, 'CH');
  // Un projet au suivi coupé et un site autonome : le menu de changement de site ne les propose pas.
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
    INACTIF,
    'Atelier Dormant',
    path.join(PROJETS, INACTIF),
    JSON.stringify({ id: INACTIF, name: 'Atelier Dormant', path: path.join(PROJETS, INACTIF), defaultEngine: 'claude', isSelf: false, branchesDePublication: {}, rank: 1002, archived: false, createdAt: maintenant, updatedAt: maintenant }),
    maintenant,
    maintenant,
  );
  db.prepare(
    `INSERT INTO marketing_espaces (project_id, cle_suivi, adresse, origines, methode_suivi, etat_suivi, langue, mode_suivi, actif, cree_le, maj_le)
     VALUES (?, 'clededormant', 'https://dormant.exemple/', '["https://dormant.exemple"]', 'manuel', 'verifie', 'fr', 'anonyme', 0, ?, ?)`,
  ).run(INACTIF, maintenant, maintenant);
  db.prepare(
    `INSERT INTO marketing_espaces (project_id, cle_suivi, adresse, origines, methode_suivi, etat_suivi, langue, mode_suivi, nom, cree_le, maj_le)
     VALUES (?, 'cleautonome', 'https://autonome.exemple/', '["https://autonome.exemple"]', 'manuel', 'verifie', 'fr', 'anonyme', 'Site Autonome', ?, ?)`,
  ).run(AUTONOME, maintenant, maintenant);
  db.close();
}

const ordre = (page) => page.locator('[data-stats-tableau="audience"] [data-stats-blocs]').getAttribute('data-stats-blocs').then((v) => (v ?? '').split(','));

/** Glisse un bloc par sa poignée jusqu'au-dessus d'un autre, avec de vrais événements de pointeur. */
/*
 * ALLER À UN ÉCRAN DES STATISTIQUES. Un `goto` sur « #statistiques… » ne suffit
 * plus : au premier chargement, l'application relit l'adresse plusieurs fois et
 * finit sur le tableau du projet actif (défaut constaté le 28/09/2026, hors du
 * service Statistiques). Une fois l'application montée, on repose le fragment
 * comme le ferait « Précédent/Suivant » — l'écran le suit alors.
 */
async function allerA(p, fragment) {
  await p.goto(`${BASE}/#${fragment}`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  if (decodeURIComponent(await p.evaluate(() => location.hash)) !== `#${fragment}`) {
    await p.evaluate((f) => {
      history.pushState(null, '', `#${f}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, fragment);
  }
}

async function glisser(page, id, cible) {
  const poignee = page.locator(`[data-stats-bloc-poignee="${id}"]`);
  await poignee.scrollIntoViewIfNeeded();
  const a = await poignee.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 12, { steps: 3 });
  const b = await page.locator(`[data-stats-bloc-place="${cible}"]`).boundingBox();
  const point = { x: b.x + b.width / 2, y: b.y + Math.min(20, b.height / 4) };
  await page.mouse.move(point.x, point.y, { steps: 12 });
  // Le point d'appui est sondé : c'est bien le bloc visé qui est sous le pointeur.
  const sous = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-stats-bloc-place]')?.getAttribute('data-stats-bloc-place'), point);
  await page.mouse.up();
  return sous;
}

let navigateur;
try {
  if (!(await attendrePort())) {
    console.error(`Le démon d'essai n'a pas démarré.\n${journal.join('')}`);
    process.exit(1);
  }
  poserLeDecor();
  navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-CH' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));

  /* -------- 7. La liste en tableau -------- */
  await allerA(page, `statistiques`);
  await page.waitForSelector(`[data-stats-site="${SECOND}"]`, { timeout: 30000 });
  const ligne = (id) =>
    page.locator(`[data-stats-site="${id}"]`).evaluate((tr) => ({
      visites: tr.querySelector('[data-stats-visites]')?.getAttribute('data-stats-visites'),
      visiteurs: tr.querySelector('[data-stats-visiteurs]')?.getAttribute('data-stats-visiteurs'),
      objectifs: tr.querySelector('[data-stats-objectifs-atteints]')?.getAttribute('data-stats-objectifs-atteints'),
      tendance: tr.querySelector('[data-stats-tendance]')?.getAttribute('data-stats-tendance'),
      texte: tr.querySelector('[data-stats-tendance]')?.textContent,
      aligne: getComputedStyle(tr.querySelector('[data-stats-visites]')).textAlign,
    }));
  const a = await ligne(PROJET);
  noter('la ligne donne visites, visiteurs et objectifs atteints sur 28 jours', a.visites === '9' && a.visiteurs === '9' && a.objectifs === '6', JSON.stringify(a));
  noter('la flèche dit la hausse, avec son écart', a.tendance === 'hausse' && a.texte.includes('+200'), a.texte);
  noter('les chiffres sont alignés à droite', a.aligne === 'right', a.aligne);
  const b = await ligne(SECOND);
  const visage = '[data-favicon-projet], [data-initiales-projet]';
  noter('chaque ligne de projet porte son icône devant le nom', (await page.locator(`[data-stats-site="${PROJET}"]`).locator(visage).count()) === 1);
  noter('un site qui perd des visites a la flèche de baisse', b.tendance === 'baisse' && b.texte.includes('-75'), b.texte);
  // Le démon d'essai déclare aussi son propre projet : seuls les deux du décor sont comparés.
  const ordreDesLignes = () =>
    page
      .locator('[data-stats-groupe="actifs"] [data-stats-site]')
      .evaluateAll((els, garder) => els.map((e) => e.getAttribute('data-stats-site')).filter((id) => garder.includes(id)), [PROJET, SECOND]);
  noter('par défaut, la liste suit le nom', (await ordreDesLignes()).join(',') === [PROJET, SECOND].join(','), (await ordreDesLignes()).join(','));
  await page.locator('[data-stats-tri-colonne="tendance"]').click();
  await page.waitForFunction(() => document.querySelector('[data-stats-tri]')?.getAttribute('data-stats-tri') === 'tendance:desc', null, { timeout: 5000 }).catch(() => {});
  noter('un clic sur « Tendance » trie de la plus forte hausse à la plus forte baisse', (await ordreDesLignes()).join(',') === [PROJET, SECOND].join(','));
  await page.locator('[data-stats-tri-colonne="tendance"]').click();
  await page.waitForFunction(() => document.querySelector('[data-stats-tri]')?.getAttribute('data-stats-tri') === 'tendance:asc', null, { timeout: 5000 }).catch(() => {});
  noter('un second clic inverse le tri', (await ordreDesLignes()).join(',') === [SECOND, PROJET].join(','), (await ordreDesLignes()).join(','));
  noter(
    'l’entête triée le dit (aria-sort)',
    (await page.locator('th:has([data-stats-tri-colonne="tendance"])').getAttribute('aria-sort')) === 'ascending',
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`[data-stats-site="${SECOND}"]`, { timeout: 30000 });
  noter('le tri survit au rechargement', (await page.locator('[data-stats-tri]').getAttribute('data-stats-tri')) === 'tendance:asc' && (await ordreDesLignes())[0] === SECOND);
  await page.screenshot({ path: path.join(os.tmpdir(), 'verif-stats-tableau-liste-1440.png') });

  /* -------- 1. Les blocs de l'Audience -------- */
  await allerA(page, `statistiques/${PROJET}`);
  await page.waitForSelector('[data-stats-tableau="audience"]', { timeout: 30000 });
  const attendus = ['chiffres', 'visites', 'actifs', 'visiteurs', 'flux', 'pays', 'sources', 'appareils', 'heures', 'semaine', 'pages', 'entrees', 'sorties', 'reperes'];
  const depart = await ordre(page);
  /* L'icône du site en tête de fiche, et le filtre du menu de changement de site. */
  noter('le titre de la fiche porte l’icône du site', (await page.locator('[data-stats-selecteur]').locator('[data-favicon-projet], [data-initiales-projet]').count()) === 1);
  await page.locator('[data-stats-selecteur]').click();
  await page.waitForSelector('[data-stats-choix-filtre]', { timeout: 5000 });
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-stats-choix-filtre'), null, { timeout: 3000 }).catch(() => {});
  noter('le filtre du menu prend le curseur à l’ouverture', await page.evaluate(() => document.activeElement?.hasAttribute('data-stats-choix-filtre') ?? false));
  noter('chaque site du menu porte son icône', (await page.locator(`[data-stats-choix="${SECOND}"]`).locator('[data-favicon-projet], [data-initiales-projet]').count()) === 1);
  const tous = await page.locator('[data-stats-choix]').evaluateAll((els) => els.map((e) => e.getAttribute('data-stats-choix')));
  noter('le menu ne propose que les projets actifs, ni inactif ni site autonome', tous.includes(PROJET) && tous.includes(SECOND) && !tous.includes(INACTIF) && !tous.includes(AUTONOME), tous.join(','));
  await page.keyboard.type('dormant');
  noter('un projet inactif ne se trouve pas non plus par le filtre', (await page.locator('[data-stats-choix]').count()) === 0);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('beta');
  const choix = await page.locator('[data-stats-choix]').evaluateAll((els) => els.map((e) => e.getAttribute('data-stats-choix')));
  noter('taper « beta » ne garde que Boutique Bêta, sans accent ni casse', choix.length === 1 && choix[0] === SECOND, choix.join(','));
  await page.keyboard.type('zzz');
  noter('un filtre sans réponse le dit', (await page.locator('[data-stats-choix-vide]').count()) === 1);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-stats-choix-filtre]', { state: 'detached', timeout: 5000 }).catch(() => {});
  await page.locator('[data-stats-selecteur]').click();
  await page.waitForSelector('[data-stats-choix-filtre]', { timeout: 5000 });
  noter('le filtre s’oublie à la fermeture', (await page.locator('[data-stats-choix-filtre]').inputValue()) === '' && (await page.locator('[data-stats-choix]').count()) >= 2);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-stats-choix-filtre]', { state: 'detached', timeout: 5000 }).catch(() => {});
  noter('l’Audience rend tous ses blocs, dans l’ordre d’origine', attendus.every((id, i) => depart[i] === id), depart.join(','));
  const pays = await page.locator('[data-marketing-repartition="pays"]').innerText();
  noter('les sessions par pays nomment les pays, DB-IP cité', pays.includes('Suisse') && pays.includes('France') && pays.includes('DB-IP'), pays.replace(/\s+/g, ' ').slice(0, 120));
  noter('les sessions par heure comptent toutes les sessions', Number(await page.locator('[data-stats-graphique="heures"]').getAttribute('data-total')) === 9);
  noter('les utilisateurs actifs ont leur courbe', (await page.locator('[data-stats-graphique="actifs"] path').count()) === 3);
  noter('les chiffres clés donnent sessions et utilisateurs', (await page.locator('[data-marketing-indicateur="sessions"]').innerText()).includes('9'));
  const noeuds = await page.locator('[data-stats-tableau="audience"] [data-stats-flux] [data-stats-noeud]').evaluateAll((els) => els.map((e) => e.getAttribute('data-stats-noeud')));
  noter('l’Audience porte le flux de comportement, des sources vers la page d’arrivée', noeuds.includes('source:google') && noeuds.includes('page:/') && noeuds.includes('repere:voir-tarifs'), noeuds.join(','));
  const boites = await page.locator('[data-stats-tableau="audience"] [data-stats-flux] [data-stats-noeud] text').evaluateAll((els) => els.filter((e) => e.textContent?.trim()).length);
  noter('chaque nœud du flux écrit son nom et son nombre dans sa boîte', boites >= noeuds.length * 2, `${boites} textes pour ${noeuds.length} nœuds`);
  await page.locator('[data-stats-bloc-place="flux"]').scrollIntoViewIfNeeded();
  await page.locator('[data-stats-bloc-place="flux"]').screenshot({ path: path.join(os.tmpdir(), 'verif-stats-tableau-flux-comportement.png') });
  await page.screenshot({ path: path.join(os.tmpdir(), 'verif-stats-tableau-audience-1440.png'), fullPage: false });

  /* -------- 2. Glisser un bloc -------- */
  // Le flux de comportement (grand bloc) éloigne désormais « pays » des chiffres clés : on croise deux voisins visibles ensemble.
  await page.evaluate(() => document.querySelector('[data-stats-bloc-place="chiffres"]')?.scrollIntoView({ block: 'start' }));
  const sous = await glisser(page, 'visites', 'chiffres');
  await page.waitForTimeout(400);
  const apres = await ordre(page);
  noter('glisser « visites » au-dessus des chiffres clés le met en tête', apres[0] === 'visites' && apres[1] === 'chiffres', `sous le pointeur : ${sous} ; ordre : ${apres.join(',')}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-stats-tableau="audience"] [data-stats-blocs]', { timeout: 30000 });
  noter('l’ordre survit au rechargement', (await ordre(page))[0] === 'visites');

  /* -------- 3. Masquer, réafficher, rétablir -------- */
  await page.locator('[data-stats-bloc-masquer="sorties"]').click();
  await page.waitForTimeout(300);
  noter('masquer retire le bloc', !(await ordre(page)).includes('sorties'));
  await page.locator('[data-stats-tableau="audience"] [data-stats-blocs-menu]').click();
  await page.locator('[data-stats-blocs-choix="sorties"]').click();
  await page.waitForTimeout(300);
  noter('le menu « Blocs » le rend', (await ordre(page)).includes('sorties'));
  await page.locator('[data-stats-blocs-retablir]').click();
  await page.waitForTimeout(300);
  const retabli = await ordre(page);
  noter('« Rétablir la disposition » remet l’ordre d’origine', retabli.join(',') === depart.join(','), retabli.join(','));
  await page.keyboard.press('Escape');

  /* -------- 4. Le Parcours -------- */
  /* La vue se choisit par le bouton « Vue » à menu (04/11/2026, plus de barre d'onglets). */
  await page.locator('[data-bouton-vue="statistiques"]').click();
  await page.locator('[data-stats-onglet="parcours"]').click();
  await page.waitForSelector('[data-stats-tableau="parcours"]', { timeout: 10000 });
  const lignes = await page.locator('[data-stats-parcours-ligne]').evaluateAll((els) =>
    els.map((e) => [e.getAttribute('data-stats-parcours-ligne'), e.querySelector('[data-stats-conversion-finale]')?.getAttribute('data-stats-conversion-finale')].join('=')),
  );
  noter('la liste des parcours : les deux parcours de l’agent, conversion finale de chacun', lignes.join('|') === 'reserver-une-table=33.3|decouvrir-les-tarifs=66.7', lignes.join('|'));
  noter('plus de bloc « Lecture » ni « Conversion par objectif », ni flux de comportement dans le Parcours', (await page.locator('[data-stats-tableau="parcours"] :is([data-stats-bloc="lecture"], [data-stats-bloc="objectifs"], [data-stats-flux])').count()) === 0);
  const chemins = await page.locator('[data-stats-chemin]').count();
  noter('les chemins les plus suivis sont des barres illustrées, une frise par chemin', chemins >= 2 && (await page.locator('[data-stats-chemin] ol li').count()) >= chemins, `${chemins} chemins`);
  noter('un repère nommé par un parcours s’affiche sous son libellé', (await page.locator('[data-stats-bloc="chemins"]').innerText()).includes('Voit les tarifs'));
  noter('la barre résume les parcours et date la dernière analyse', (await page.locator('[data-stats-objectifs]').innerText()).includes('2 parcours') && (await page.locator('[data-stats-objectifs]').innerText()).includes('Dernière analyse'));
  /* -------- 8. La barre d'outils -------- */
  const barre = () =>
    page.evaluate(() => {
      const b = document.querySelector('[data-stats-barre="parcours"]');
      const boite = (sel) => b?.querySelector(sel)?.getBoundingClientRect() ?? null;
      const tableau = document.querySelector('[data-stats-tableau="parcours"]')?.getBoundingClientRect();
      const onglets = document.querySelector('[data-bouton-vue="statistiques"]')?.getBoundingClientRect();
      const r = b?.getBoundingClientRect();
      return {
        objectifs: boite('[data-stats-objectifs]')?.left ?? null,
        agent: boite('[data-stats-relancer-objectifs]')?.left ?? null,
        dates: boite('[data-selecteur-periode]')?.left ?? null,
        blocs: boite('[data-stats-blocs-menu]')?.left ?? null,
        blocsDroite: boite('[data-stats-blocs-menu]')?.right ?? null,
        droite: r?.right ?? null,
        largeur: r && tableau ? Math.round(tableau.width - r.width) : null,
        /* Les onglets sont les rubriques de la colonne de gauche (12/10/2026) : sur ordinateur la barre est à leur droite ; sur téléphone, sous la rangée d'onglets. */
        sousLesOnglets: r && onglets ? r.left >= onglets.right || r.top >= onglets.bottom : false,
        premier: document.querySelector('[data-stats-tableau="parcours"]')?.firstElementChild === b,
      };
    });
  const x = await barre();
  /* LES DATES ONT MONTÉ DANS LA BARRE D'EN-TÊTE, avec le fil d'Ariane (12/10/2026) : la barre
     d'outils ne garde que les objectifs, l'agent et « Blocs ». */
  noter(
    'la barre d’outils : objectifs, agent, puis « Blocs » le plus à droite, sans les dates',
    x.objectifs !== null && x.objectifs < x.agent && x.agent < x.blocs && x.dates === null && x.droite - x.blocsDroite < 20,
    JSON.stringify(x),
  );
  noter('la barre est pleine largeur, à droite des rubriques (ou sous les onglets), avant les chiffres', x.largeur === 0 && x.sousLesOnglets && x.premier, JSON.stringify(x));
  noter(
    'le choix des dates vit dans la barre d’en-tête, avec le fil d’Ariane',
    (await page.locator('[data-gestes-de-page="barre"] [data-selecteur-periode]').count()) === 1 && (await page.locator('[data-selecteur-periode]:visible').count()) === 1,
  );

  /* -------- 5. Relancer l'analyse des objectifs -------- */
  await page.locator('[data-stats-relancer-objectifs="relancer"]').click();
  await page.waitForSelector('[data-stats-relancer-objectifs="ouvrir"]', { timeout: 15000 }).catch(() => {});
  const cartes = () => {
    const db = base();
    try {
      return db.prepare("SELECT COUNT(*) AS n FROM cards WHERE project_id = ? AND title = 'Analyser les objectifs du suivi'").get(PROJET).n;
    } finally {
      db.close();
    }
  };
  noter('« Relancer l’analyse » fait naître une carte, et le bouton devient « Voir l’agent au travail »', cartes() === 1 && (await page.locator('[data-stats-relancer-objectifs="ouvrir"]').count()) === 1, `cartes : ${cartes()}`);
  noter('« Voir l’agent au travail » porte une roue qui tourne tant que l’agent travaille', (await page.locator('[data-stats-relancer-objectifs="ouvrir"] .animate-spin').count()) === 1);
  const y = await barre();
  noter('« Voir l’agent au travail » reste dans la barre, avant « Blocs »', y.agent !== null && y.agent < y.blocs, JSON.stringify(y));
  await page.screenshot({ path: path.join(os.tmpdir(), 'verif-stats-tableau-parcours-1440.png') });

  /* -------- 4 bis. Un parcours ouvert -------- */
  await page.locator('[data-stats-parcours-ligne="reserver-une-table"]').click();
  await page.waitForSelector('[data-stats-parcours-ouvert="reserver-une-table"]', { timeout: 10000 });
  const taux = await page.locator('[data-stats-flux-parcours] [data-stats-taux]').evaluateAll((els) => els.map((e) => e.getAttribute('data-stats-taux')));
  noter('le flux du parcours : entrée 6 → 4 (66,7 %) → 2 (50 %)', taux.join('|') === '100|66.7|50', taux.join('|'));
  const abandons = await page.locator('[data-stats-flux-parcours] [data-stats-abandons]').evaluateAll((els) => els.map((e) => e.getAttribute('data-stats-abandons')));
  noter('les abandons de chaque étape sont dessinés, la plus grosse perte soulignée', abandons.join('|') === '2|2' && (await page.locator('[data-stats-plus-grosse-perte]').count()) === 1, abandons.join('|'));
  const nomenclature = await page.locator('[data-stats-nomenclature] [data-stats-etape]').evaluateAll((els) => els.map((e) => e.textContent));
  noter('la nomenclature nomme chaque étape lisiblement, avec sa phrase', nomenclature.length === 2 && nomenclature[0].includes('Voit les tarifs') && nomenclature[1].includes('Il envoie sa réservation'), nomenclature.join(' | '));
  noter('la fiche du parcours dit son objectif', (await page.locator('[data-stats-parcours-ouvert]').innerText()).includes('La réservation est envoyée'));
  await page.screenshot({ path: path.join(os.tmpdir(), 'verif-stats-tableau-parcours-ouvert-1440.png') });
  await page.locator('[data-stats-flux-parcours]').screenshot({ path: path.join(os.tmpdir(), 'verif-stats-tableau-flux-parcours.png') });
  await page.locator('[data-stats-retour-parcours]').click();
  await page.waitForSelector('[data-stats-parcours-ligne]', { timeout: 10000 });
  noter('« Tous les parcours » ramène à la liste', (await page.locator('[data-stats-parcours-ligne]').count()) === 2);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(os.tmpdir(), 'verif-stats-tableau-parcours-sombre.png') });
  noter('aucune erreur de page', erreurs.length === 0, erreurs.join(' | '));
  await contexte.close();

  /* -------- 6. Téléphone -------- */
  const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-CH', hasTouch: true, isMobile: true });
  await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const pageTel = await tel.newPage();
  await allerA(pageTel, `statistiques/${PROJET}`);
  await pageTel.waitForSelector('[data-stats-tableau="audience"]', { timeout: 30000 });
  await pageTel.waitForTimeout(400);
  const deborde = () => pageTel.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  noter('à 390 px, l’Audience ne déborde pas', !(await deborde()));
  /* SUR TÉLÉPHONE, UNE SEULE RANGÉE SOUS LA BARRE D'EN-TÊTE (demande du
     11/10/2026) : les onglets à gauche, la période en un seul bouton à droite.
     L'Audience n'a plus de barre d'outils, et « Blocs » est une ligne du menu
     à trois points de la barre — qui s'ouvre sur toute la largeur de l'écran. */
  const tel390 = await pageTel.evaluate(() => {
    const visible = (el) => !!el && el.getClientRects().length > 0;
    const onglet = document.querySelector('[data-bouton-vue="statistiques"]')?.getBoundingClientRect();
    const periode = document.querySelector('[data-stats-rangee-onglets] [data-periode-compacte]')?.getBoundingClientRect();
    const chiffres = document.querySelector('[data-stats-bloc="chiffres"]')?.getBoundingClientRect();
    const tableau = document.querySelector('[data-stats-tableau="audience"]')?.getBoundingClientRect();
    return {
      barreDOutils: document.querySelectorAll('[data-stats-barre="audience"]').length,
      memeLigne: !!onglet && !!periode && Math.abs(onglet.top + onglet.height / 2 - (periode.top + periode.height / 2)) < 6,
      periodeADroite: periode ? Math.round(window.innerWidth - periode.right) : null,
      rangeesSousLaBarre: [...document.querySelectorAll('[data-gestes-de-page="page"]')].filter(visible).length,
      troisPoints: visible(document.querySelector('main [data-entete-de-zone] [data-options-de-page="menu"]')),
      chiffres: chiffres && tableau ? Math.round(tableau.width - chiffres.width) : null,
    };
  });
  /* LA PÉRIODE N'EST PLUS DANS LA PAGE SUR TÉLÉPHONE (03/11/2026) : c'est une ligne des trois points du haut. */
  noter(
    'à 390 px, une seule rangée sous la barre (les onglets), la période dans les trois points, plus de barre d’outils sur l’Audience',
    tel390.barreDOutils === 0 && tel390.periodeADroite === null && tel390.rangeesSousLaBarre === 0,
    JSON.stringify(tel390),
  );
  noter('à 390 px, le bloc des chiffres prend toute la largeur du tableau', tel390.chiffres === 0, String(tel390.chiffres));
  await pageTel.locator('main [data-entete-de-zone] [data-options-de-page="menu"]').click();
  await pageTel.waitForSelector('[role="menu"][data-state="open"] [data-stats-blocs-menu]', { timeout: 8000 });
  const voletTel = await pageTel.evaluate(() => Math.round(document.querySelector('[role="menu"][data-state="open"]')?.getBoundingClientRect().width ?? 0));
  noter('à 390 px, « Blocs » est une ligne du menu à trois points, ouvert sur toute la largeur', tel390.troisPoints && voletTel === 390, `${voletTel} px`);
  await pageTel.locator('[role="menu"] [data-stats-blocs-menu]').click();
  await pageTel.waitForSelector('[data-stats-blocs-choix]', { timeout: 8000 });
  noter('à 390 px, cette ligne déplie la liste des blocs', (await pageTel.locator('[data-stats-blocs-choix]').count()) > 3);
  /* Refermer tant qu'un menu reste : un Échap de plus refermerait la page. */
  for (let essai = 0; essai < 4 && (await pageTel.locator('[role="menu"][data-state="open"]').count()); essai += 1) {
    await pageTel.keyboard.press('Escape');
    await pageTel.waitForTimeout(350);
  }
  /* Les graphiques prennent TOUTE la largeur de leur bloc : seul le titre garde la place des boutons du coin. */
  const pleine = await pageTel.evaluate(() => {
    const bloc = document.querySelector('[data-stats-bloc-place="visites"]');
    const carte = bloc?.querySelector('[data-marketing-graphique]');
    const zone = carte?.querySelector('.touch-pan-y');
    const titre = carte?.querySelector('[data-stats-titre]');
    const boutons = bloc?.querySelector('[data-stats-bloc-masquer]')?.getBoundingClientRect();
    if (!bloc || !carte || !zone || !titre || !boutons) return null;
    const c = carte.getBoundingClientRect();
    const z = zone.getBoundingClientRect();
    const total = titre.lastElementChild?.getBoundingClientRect();
    return {
      margeDroite: Math.round(c.right - z.right),
      totalSousBoutons: total ? total.right > boutons.left + 1 && total.top < boutons.bottom : null,
    };
  });
  noter('à 390 px, la courbe occupe toute la largeur de son bloc (plus de bande vide à droite)', !!pleine && pleine.margeDroite <= 14, JSON.stringify(pleine));
  noter('à 390 px, le total du graphique ne passe pas sous les boutons du coin', !!pleine && pleine.totalSousBoutons === false, JSON.stringify(pleine));
  await pageTel.screenshot({ path: path.join(os.tmpdir(), 'verif-stats-tableau-audience-390.png') });
  await pageTel.locator('[data-stats-flux]').scrollIntoViewIfNeeded();
  noter('à 390 px, le flux de comportement défile dans son cadre sans faire déborder l’écran', !(await deborde()));
  await pageTel.locator('[data-bouton-vue="statistiques"]').click();
  await pageTel.locator('[data-stats-onglet="parcours"]').click();
  await pageTel.waitForSelector('[data-stats-parcours-ligne]', { timeout: 10000 });
  await pageTel.locator('[data-stats-parcours-ligne="reserver-une-table"]').click();
  await pageTel.waitForSelector('[data-stats-flux-parcours]', { timeout: 10000 });
  noter('à 390 px, le flux d’un parcours défile dans son cadre sans faire déborder l’écran', !(await deborde()));
  await pageTel.screenshot({ path: path.join(os.tmpdir(), 'verif-stats-tableau-parcours-390.png') });
  await allerA(pageTel, `statistiques`);
  await pageTel.waitForSelector(`[data-stats-site="${SECOND}"]`, { timeout: 30000 });
  await pageTel.waitForTimeout(300);
  const colonnes = await pageTel.locator(`[data-stats-site="${PROJET}"] td`).evaluateAll((tds) => tds.filter((td) => getComputedStyle(td).display !== 'none').length);
  noter('à 390 px, la liste garde nom, visites et tendance, sans déborder', colonnes === 3 && !(await deborde()), `colonnes visibles : ${colonnes}`);
  await pageTel.screenshot({ path: path.join(os.tmpdir(), 'verif-stats-tableau-liste-390.png') });
  await tel.close();
} finally {
  await navigateur?.close();
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
process.exit(echecs ? 1 : 0);
