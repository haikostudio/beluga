#!/usr/bin/env node
/**
 * L'ÉCRAN MÉMOIRE, SUR LA BASE DE CONNAISSANCES, DANS UN VRAI NAVIGATEUR.
 *
 * Un démon d'essai (base neuve, port à lui) sert l'interface construite du dépôt
 * d'où part ce script (`web/dist`). Le décor pose un projet, des unités (dont
 * une dépréciée, une à relire et une compétence commune) et un changelog par la
 * porte d'écriture, puis le navigateur vérifie :
 *  1. LE GRAPHE À L'OUVERTURE : toutes les unités actives dessinées (les
 *     dépréciées chargées mais cachées), la REMONTÉE DANS LE TEMPS (liste des
 *     jours jusqu'au premier, un jour passé qui montre une unité retirée depuis,
 *     les deux calendriers, le retour à aujourd'hui), la légende
 *     des sept familles, le focus d'un projet choisi dans la colonne, la
 *     recherche « comme l'agent » (mêmes huit premières que son outil) qui
 *     allume la compétence d'envoi chez Apple, la fiche de l'élément choisi,
 *     « Ouvrir dans la liste » et le retour au graphe ;
 *  2. LA LISTE REFAITE : portées, fiches numérotées, une catégorie sur ses
 *     thèmes (nombre, dernier ajout), un thème trié du plus récent au plus
 *     ancien en lignes « titre clair (CODE) », un élément lu en page (type,
 *     importance, « Pourquoi c'est important », technique replié) et
 *     l'adresse qui le désigne ;
 *  3. le changelog du projet, son filtre et sa correction à la main ;
 *  4. la recherche, qui rend l'unité et l'ouvre en page ;
 *  5. la bascule vers les dépréciées ;
 *  6. une unité peu sûre ne montre ni « Confirmer » ni « À relire » : le système la relit seul ;
 *  7. le téléphone : le graphe d'abord, puis les pages de la liste, la flèche
 *     de la barre remontant d'un cran à la fois ;
 *  8. LE FIL D'UN AGENT : une lecture de la mémoire se dit « titre clair (MEM-…) » ;
 *  9. la même vue en anglais.
 *
 * La session d'une heure est fabriquée dans la base d'essai (jeton HACHÉ), le
 * démon de production n'est jamais touché, aucun quota n'est dépensé.
 *
 *   npm run build && node scripts/verif-ecran-connaissances.mjs
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_CONNAISSANCES_PORT || 7233);
const BASE = `http://127.0.0.1:${PORT}`;
const { DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-ecran-connaissances-', port: PORT, signaux: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}

/* ---- Le décor, par la porte d'écriture, dans la base d'essai ---- */
process.env.BELUGA_DATA = DATA;
const { getDb } = await import(path.join(RACINE, 'server/dist/db.js'));
const k = await import(path.join(RACINE, 'server/dist/connaissances.js'));
const PROJET = 'projet-connaissances';
const maintenant = Date.now();
getDb()
  .prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)')
  .run(PROJET, 'Essai mémoire', DEPOT, JSON.stringify({ id: PROJET, name: 'Essai mémoire', path: DEPOT, createdAt: maintenant, updatedAt: maintenant }), maintenant, maintenant);

const ecrire = (p) => {
  const r = k.proposerUnite(PROJET, p, { auteur: 'verif-ecran-connaissances' });
  if (!r.ok) throw new Error(`décor refusé : ${r.raisons.join(' ')}`);
  return r.unite;
};
ecrire({ type: 'project', importance: 'P0', titre: 'Essai mémoire pilote des agents', resume: 'Le projet Essai mémoire pilote des agents de programmation depuis un tableau de cartes.' });
const decision = ecrire({
  type: 'decision',
  importance: 'P1',
  titre: 'La base de connaissances fait foi',
  resume: 'Les unités vivent en base ; les fichiers Markdown numérotés sont régénérés depuis elle.',
  raisonnement: 'La recherche pondérée et le dédoublonnage ont besoin de la base.',
  sujets: ['memoire'],
});
const ancienne = ecrire({ type: 'environment', importance: 'P2', titre: 'Le démon écoute sur le port 7000', resume: 'Le démon de Beluga Build écoute sur le port 7000 de la machine.' });
ecrire({ type: 'environment', importance: 'P0', titre: 'Le démon écoute sur le port 7070', resume: 'Le démon écoute désormais sur le port 7070, derrière Caddy.', remplace: ancienne.id, jamaisSupposer: true });
const composant = ecrire({
  type: 'component',
  importance: 'P1',
  titre: 'Le tiroir de publication suit chaque étape',
  resume: 'Le tiroir de publication montre chaque étape d’une mise en ligne, avec son état et son fil historique.',
  detail:
    '### Rôle\n\nMontrer où en est une mise en ligne, étape par étape.\n\n### Comportement\n\nChaque étape s’allume quand elle démarre et se coche quand elle réussit.\n\n### Fichiers\n\n- web/src/components/tiroir-publication.tsx\n\n### Contrôles\n\nLe contrôle de publication rejoue une mise en ligne complète.',
});
const douteuse = ecrire({ type: 'lesson', importance: 'P2', confiance: 0.5, titre: 'Le vectoriseur quitte la mémoire vive', resume: 'Le modèle de vecteurs quitte la mémoire vive après dix minutes sans demande.' });
k.ajouterAuChangelog({
  projectId: PROJET,
  titre: 'Une mémoire rangée par sujets',
  explication: 'Les faits du projet sont rangés en fiches numérotées, chacune avec son importance. Un agent retrouve ce qui compte sans relire tout l’historique.',
  poids: 'grande-nouveaute',
  branche: 'tache/base-99af66',
  source: 'agent',
});
k.ajouterAuChangelog({ projectId: PROJET, texte: 'fix(memoire): italique parasite dans les noms de colonnes', branche: 'tache/lisibilite-des-changelogs-bf8052', source: 'carte', cardId: 'carte-essai-2' });
k.ajouterAuChangelog({ projectId: PROJET, texte: 'docs: redémarrage du serveur de développement', source: 'git' });
const colonne = ecrire({
  type: 'domain',
  importance: 'P2',
  titre: 'La langue d’un rapport vit dans une colonne dédiée',
  resume: 'La langue choisie pour un rapport est rangée dans une colonne à part de la table des utilisateurs.',
  detail: 'La colonne userspsy_language_tmp garde la valeur pendant la migration.',
});

/* ---- Les thèmes : trois « cartes » (dont une écrite « carte »), trois « interface » (dont « ui ») ---- */
const conventions = [
  ['carte', 'Une carte naît dans la colonne Planifié', 'Toute carte créée apparaît d’abord dans la colonne Planifié du tableau.'],
  ['cartes', 'Une carte lancée garde sa propre branche', 'Une carte lancée travaille sur une branche à elle, jamais sur la principale.'],
  ['cartes', 'Une carte rangée ne se rouvre que par un geste humain', 'Une carte archivée ne revient dans le tableau que si une personne la rouvre.'],
  ['ui', 'Un bouton qui part en requête le dit dès le clic', 'Un bouton qui envoie une demande affiche son état en cours au moment du clic.'],
  ['interface', 'Toute zone qui défile passe par le composant commun', 'Une liste qui défile utilise le composant commun de défilement de l’interface.'],
  ['interface', 'Le menu des trois points range les gestes de la page', 'Les gestes secondaires d’une page vivent dans le menu à trois points de son en-tête.'],
].map(([sujet, titre, resume]) => ecrire({ type: 'convention', importance: 'P2', titre, resume, sujets: [sujet] }));
const TITRE_CLAIR = 'Les nouvelles tâches arrivent toujours en premier';
k.poserTitreHumain(conventions[0].id, TITRE_CLAIR);

/* ---- Une compétence COMMUNE, au Global : la recherche du graphe doit l'allumer ---- */
const apple = k.proposerUnite(
  'global',
  {
    type: 'operation',
    importance: 'P2',
    titre: 'Compétence « envoi-d-une-app-iphone-a-la-verification-apple »',
    resume: 'À utiliser dès qu’il faut déployer une application iPhone sur l’App Store et l’envoyer à la vérification d’Apple.',
    sujets: ['competences', 'mobile', 'ios'],
    source: { genre: 'competence', ref: 'envoi-d-une-app-iphone-a-la-verification-apple' },
  },
  { auteur: 'verif-ecran-connaissances' },
);
if (!apple.ok) throw new Error(`décor refusé : ${apple.raisons.join(' ')}`);
const competenceApple = apple.unite;
k.poserTitreHumain(competenceApple.id, 'Envoi d’une application iPhone à Apple');

/* ---- La session d'une heure, jeton haché ---- */
const cookie = crypto.randomBytes(24).toString('hex');
const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
const base = new Database(path.join(DATA, 'beluga.db'));
base.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(empreinte, maintenant, maintenant + 3600_000, 'verif-ecran-connaissances');
/* REMONTER LE TEMPS : trois unités vieillies de cinq jours, dont l'ANCIENNE (port 7000), retirée il y a deux
   jours — à la fin d'il y a trois jours, la mémoire en montre donc exactement trois. */
const JOUR = 24 * 3600_000;
const vieillies = [decision.id, ancienne.id, colonne.id];
for (const id of vieillies) base.prepare('UPDATE connaissances SET cree_le = ? WHERE id = ?').run(maintenant - 5 * JOUR, id);
base.prepare('UPDATE connaissance_versions SET at = ? WHERE unite_id = ?').run(maintenant - 2 * JOUR, ancienne.id);
const jourLocal = (at) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// La carte d'origine de l'entrée « italique parasite » : le journal doit proposer de l'ouvrir.
base
  .prepare(`INSERT OR IGNORE INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, 'archived', 0, ?, '{}', ?, ?)`)
  .run('carte-essai-2', PROJET, 'Italique parasite dans les colonnes', maintenant, maintenant);

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: cookie, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();

  /* Les destinations de la colonne de gauche sont repliées derrière un bouton
     compact (et, sur téléphone, derrière le bouton ≡ « Projets ») : on les déplie d'abord. */
  const cliquerLaMemoire = async (p) => {
    await p.waitForSelector('[data-navigation-compacte], [data-ouvrir-memoire], button[aria-label="Projets"]', { state: 'attached', timeout: 60_000 });
    // Sur téléphone la colonne existe deux fois (la fixe, cachée, et celle du tiroir) : on ne vise que la visible.
    // Le bouton des services vit dans la barre d'en-tête, sur téléphone aussi : la colonne des projets ne
    // s'ouvre que s'il n'est pas déjà à l'écran — ouverte, son voile le recouvrirait.
    const direct = p.locator('[data-ouvrir-memoire]:visible').or(p.locator('[data-navigation-compacte]:visible')).first();
    if (!(await direct.isVisible().catch(() => false)) && (await p.isVisible('button[aria-label="Projets"]'))) {
      await p.click('button[aria-label="Projets"]', { timeout: 8000 });
      await direct.waitFor({ state: 'visible', timeout: 10_000 });
    }
    const memoire = p.locator('[data-ouvrir-memoire]:visible').first();
    if (!(await memoire.isVisible())) await p.locator('[data-navigation-compacte]:visible').first().click({ timeout: 10_000 });
    await p.locator('[data-ouvrir-memoire]:visible').first().click({ timeout: 10_000 });
  };

  /* L'ÉCRAN S'OUVRE SUR LE GRAPHE (décision du 2026-10-20) ; la liste est derrière le bouton « Liste ». */
  const ouvrirLeGraphe = async (p = page) => {
    await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await cliquerLaMemoire(p);
    await p.waitForSelector('[data-memoire-graphe="pret"]', { timeout: 30_000 });
  };
  const versLaListe = async (p = page) => {
    await p.click('[data-memoire-vers-liste]');
    await p.waitForSelector('[data-memoire-vue="liste"]', { timeout: 15_000 });
  };
  const ouvrirLaMemoire = async () => {
    await ouvrirLeGraphe();
    await versLaListe();
    await page.waitForSelector('[data-memoire-portee="global"]', { timeout: 30_000 });
  };
  /** Ouvrir une catégorie, puis l'un de ses éléments en page de lecture — retrouvé par son code dans la recherche de la catégorie. */
  const lireLUnite = async (ficheId, id, p = page) => {
    await p.click(`[data-memoire-fiche="${ficheId}"]`);
    await p.waitForSelector(`[data-memoire-fiche-ouverte="${ficheId}"]`, { timeout: 10_000 });
    await p.fill('[data-memoire-filtre]', id);
    await p.click(`[data-memoire-ligne="${id}"]`, { timeout: 10_000 });
    await p.waitForSelector(`[data-memoire-lecture="${id}"]`, { timeout: 10_000 });
  };
  const CAPTURES = process.env.VERIF_CAPTURES;

  /* ---- LE GRAPHE ---- */
  await ouvrirLeGraphe();
  const actives = base.prepare(`SELECT COUNT(*) AS n FROM connaissances WHERE statut = 'active'`).get().n;
  const graphe = await page.$eval('[data-memoire-graphe]', (el) => {
    const toile = el.querySelector('canvas');
    const ctx = toile.getContext('2d');
    const { data } = ctx.getImageData(0, 0, toile.width, toile.height);
    let peints = 0;
    for (let i = 3; i < data.length; i += 16) if (data[i] > 0) peints += 1;
    return { elements: Number(el.getAttribute('data-graphe-elements')), noeuds: Number(el.getAttribute('data-graphe-noeuds')), peints, zoom: el.getAttribute('data-graphe-zoom') };
  });
  noter(
    'l’écran s’ouvre sur le graphe : toutes les unités actives y pendent, et la toile est dessinée',
    graphe.elements === actives && graphe.noeuds > actives && graphe.peints > 200 && (await page.$('[data-memoire-vue="graphe"]')) !== null,
    JSON.stringify({ ...graphe, actives }),
  );
  const depreciees = base.prepare(`SELECT COUNT(*) AS n FROM connaissances WHERE statut = 'deprecated'`).get().n;
  const total = Number(await page.getAttribute('[data-memoire-graphe]', 'data-graphe-total'));
  noter('les unités retirées sont chargées pour remonter le temps, mais cachées aujourd’hui', depreciees >= 1 && total === actives + depreciees, `${total} = ${actives} actives + ${depreciees} retirées`);

  /* ---- REMONTER LE TEMPS (demande du 2026-10-20) ---- */
  const visibles = () => page.getAttribute('[data-memoire-graphe]', 'data-graphe-elements').then(Number);
  const finDuPassage = () => page.waitForFunction(() => document.querySelector('[data-memoire-graphe]')?.getAttribute('data-graphe-passage') === 'fini', null, { timeout: 5000 });
  // Le menu des services, ouvert pour atteindre la Mémoire, se referme d'abord.
  if (await page.$('[role="menu"]')) {
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="menu"]', { state: 'detached', timeout: 5000 }).catch(() => {});
  }
  await page.click('[data-graphe-temps-bouton]');
  await page.waitForSelector('[data-graphe-temps-menu] [data-graphe-jour]', { timeout: 5000 });
  const joursListes = await page.$$eval('[data-graphe-jour]', (b) => b.map((x) => ({ jour: x.getAttribute('data-graphe-jour'), ajouts: Number(x.querySelector('[data-graphe-jour-ajouts]')?.getAttribute('data-graphe-jour-ajouts')), retraits: Number(x.querySelector('[data-graphe-jour-retraits]')?.getAttribute('data-graphe-jour-retraits')) })));
  const jourRetrait = joursListes.find((j) => j.jour === jourLocal(maintenant - 2 * JOUR));
  noter(
    'le calendrier liste les jours, du plus récent au premier jour de la mémoire, avec ajouts et retraits',
    joursListes.length === 6 && joursListes[0].jour === jourLocal(maintenant) && joursListes.at(-1).jour === jourLocal(maintenant - 5 * JOUR) && joursListes.at(-1).ajouts === 3 && jourRetrait?.retraits >= 1,
    JSON.stringify(joursListes),
  );
  // Les flèches du clavier descendent la liste.
  await page.keyboard.press('ArrowDown');
  const focusApresFleche = await page.evaluate(() => document.activeElement?.getAttribute('data-graphe-jour'));
  noter('la flèche ↓ passe au jour d’avant', focusApresFleche === jourLocal(maintenant - JOUR), String(focusApresFleche));
  await page.click(`[data-graphe-jour="${jourLocal(maintenant - 3 * JOUR)}"]`);
  const passageVu = await page
    .waitForFunction(() => document.querySelector('[data-memoire-graphe]')?.getAttribute('data-graphe-passage') === 'en-cours', null, { timeout: 1500 })
    .then(() => true)
    .catch(() => false);
  await finDuPassage();
  const aTroisJours = await visibles();
  noter(
    'un jour passé montre la mémoire de ce soir-là : trois unités, dont celle retirée depuis, apparues en fondu',
    aTroisJours === 3 && passageVu && (await page.getAttribute('[data-graphe-temps]', 'data-graphe-temps')) === 'passe' && /^Au /.test(((await page.textContent('[data-graphe-temps-bouton]')) ?? '').trim()),
    `${aTroisJours} visibles (aujourd’hui ${actives}), passage ${passageVu ? 'vu' : 'absent'}, période ${await page.getAttribute('[data-memoire-page="graphe"]', 'data-graphe-periode')}`,
  );
  if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'memoire-graphe-passe.png') });
  await page.click('[data-graphe-temps-bouton]');
  await page.click('[data-graphe-temps-onglet="periode"]');
  noter('l’onglet « Période » ouvre les deux calendriers communs', (await page.$$('[data-graphe-temps-menu] [data-periode-calendrier]')).length === 2);
  // Une période qui commence il y a un jour : les trois vieillies (moins la retirée) estompées, les autres pleines.
  await page.click(`[data-graphe-temps-menu] [data-periode-jour="${jourLocal(maintenant - JOUR)}"]`);
  await page.click(`[data-graphe-temps-menu] [data-periode-jour="${jourLocal(maintenant)}"]`);
  await finDuPassage();
  noter('une période choisie sur les calendriers se lit sur la page', (await page.getAttribute('[data-memoire-page="graphe"]', 'data-graphe-periode')) === `${jourLocal(maintenant - JOUR)},${jourLocal(maintenant)}` && (await visibles()) === actives);
  await page.click('[data-graphe-temps-aujourdhui]');
  await finDuPassage();
  noter('la croix revient à aujourd’hui : toute la mémoire active', (await visibles()) === actives && (await page.getAttribute('[data-graphe-temps]', 'data-graphe-temps')) === 'aujourdhui');

  const legende = await page.$$eval('[data-graphe-legende] [data-couleur-du-graphe]', (b) => b.map((x) => getComputedStyle(x).backgroundColor));
  noter('la légende dit sept familles de couleur, toutes distinctes', legende.length === 7 && new Set(legende).size === 7, legende.join(' '));
  if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'memoire-graphe.png') });

  /* DÉFILER DÉPLACE, CTRL + MOLETTE ZOOME, et la MINI-CARTE (demande du 2026-10-20). */
  const vue = () => page.$eval('[data-memoire-graphe]', (el) => ({ zoom: el.getAttribute('data-graphe-zoom'), centre: el.getAttribute('data-graphe-centre') }));
  const boiteDuGraphe = await page.$eval('[data-memoire-graphe]', (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  await page.mouse.move(boiteDuGraphe.x, boiteDuGraphe.y);
  const avantMolette = await vue();
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(120);
  const apresBas = await vue();
  await page.mouse.wheel(180, 0);
  await page.waitForTimeout(120);
  const apresDroite = await vue();
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 200);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(120);
  const apresMaj = await vue();
  const [x0, y0] = avantMolette.centre.split(',').map(Number);
  const [x1, y1] = apresBas.centre.split(',').map(Number);
  const [x2, y2] = apresDroite.centre.split(',').map(Number);
  const [x3, y3] = apresMaj.centre.split(',').map(Number);
  noter(
    'défiler déplace la carte — vers le bas, vers la droite, à l’horizontale avec Maj — sans changer le zoom',
    apresMaj.zoom === avantMolette.zoom && y1 > y0 && x1 === x0 && x2 > x1 && y2 === y1 && x3 > x2 && y3 === y2,
    `${avantMolette.centre} → ${apresBas.centre} → ${apresDroite.centre} → ${apresMaj.centre} (zoom ${avantMolette.zoom} → ${apresMaj.zoom})`,
  );
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await page.waitForTimeout(120);
  const apresCtrl = await vue();
  noter('Ctrl + molette (le pincement du pavé tactile) zoome', Number(apresCtrl.zoom) > Number(apresMaj.zoom), `${apresMaj.zoom} → ${apresCtrl.zoom}`);
  const miniCarte = await page.$eval('[data-graphe-minicarte]', (toile) => {
    const ctx = toile.getContext('2d');
    const { data } = ctx.getImageData(0, 0, toile.width, toile.height);
    let peints = 0;
    for (let i = 3; i < data.length; i += 16) if (data[i] > 0) peints += 1;
    const b = toile.getBoundingClientRect();
    const robot = document.querySelector('[data-terminal-rond], [data-assistant-global-rond]')?.getBoundingClientRect();
    const chevauche = robot ? !(robot.right <= b.left || robot.left >= b.right || robot.bottom <= b.top || robot.top >= b.bottom) : false;
    return { peints, x: b.left, y: b.top, l: b.width, h: b.height, chevauche };
  });
  noter('une mini-carte en bas à droite montre l’arbre entier, sans chevaucher le bouton de l’assistant', miniCarte.peints > 50 && miniCarte.l > 100 && !miniCarte.chevauche, JSON.stringify(miniCarte));
  await page.mouse.click(miniCarte.x + miniCarte.l * 0.2, miniCarte.y + miniCarte.h * 0.8);
  await page.waitForTimeout(120);
  const apresMini = await vue();
  noter('un clic dans la mini-carte y amène la vue, sans changer le zoom', apresMini.centre !== apresCtrl.centre && apresMini.zoom === apresCtrl.zoom, `${apresCtrl.centre} → ${apresMini.centre}`);
  if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'memoire-graphe-minicarte.png') });
  /* LA PLACE DE LA MINI-CARTE, relevée par rapport à la zone du graphe. */
  const placeMini = () =>
    page.evaluate(() => {
      const zone = document.querySelector('[data-memoire-graphe]')?.getBoundingClientRect();
      const b = document.querySelector('[data-graphe-minicarte-cadre]')?.getBoundingClientRect();
      if (!zone || !b) return null;
      return { droite: Math.round(zone.right - b.right), bas: Math.round(zone.bottom - b.bottom), x: b.left, y: b.top, l: b.width, h: b.height, zone: { l: zone.left, t: zone.top, r: zone.right, b: zone.bottom } };
    });
  const miniAuDepart = await placeMini();
  noter('par défaut, la mini-carte est au coin bas droit (12 px du bord, 84 px du bas)', miniAuDepart?.droite === 12 && miniAuDepart?.bas === 84, JSON.stringify(miniAuDepart));
  await page.click('[data-graphe-recentrer]');
  await page.waitForTimeout(700);
  // EN CLAIR AUSSI, les sept teintes restent vives et distinctes (la toile relit les jetons quand la classe change).
  const sombre = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.waitForTimeout(150);
  const legendeClaire = await page.$$eval('[data-graphe-legende] [data-couleur-du-graphe]', (b) => b.map((x) => getComputedStyle(x).backgroundColor));
  noter('en clair, la légende garde sept couleurs distinctes, autres que celles du sombre', legendeClaire.length === 7 && new Set(legendeClaire).size === 7 && legendeClaire.join() !== legende.join(), legendeClaire.join(' '));
  if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'memoire-graphe-clair.png') });
  if (sombre) await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.waitForTimeout(150);

  const PHRASE = 'déployer une application sur l’App Store';
  await page.click(`[data-memoire-focus-liste] [data-memoire-portee="${PROJET}"]`);
  await page.waitForFunction((id) => document.querySelector('[data-memoire-page="graphe"]')?.getAttribute('data-graphe-focus') === id, PROJET, { timeout: 5000 });
  await page.waitForTimeout(700);
  const zoomFocus = await page.getAttribute('[data-memoire-graphe]', 'data-graphe-zoom');
  noter(
    'choisir un projet dans la colonne glisse jusqu’à sa branche, le reste reste dessiné',
    zoomFocus !== graphe.zoom && (await page.getAttribute('[data-memoire-focus-liste] [aria-current="true"]', 'data-memoire-focus')) === PROJET && (await page.textContent('[data-focus-du-fil]'))?.trim() === 'Essai mémoire',
    `${graphe.zoom} → ${zoomFocus}`,
  );
  await page.fill('input[data-graphe-recherche]', PHRASE);
  await page.waitForSelector('[data-graphe-etat-recherche="faite"]', { timeout: 30_000 });
  const recus = ((await page.getAttribute('[data-memoire-page="graphe"]', 'data-graphe-recus')) ?? '').split(',').filter(Boolean);
  // LE MÊME CHEMIN QUE L'OUTIL DE L'AGENT : ses huit premières, que le tri du juge rapide ne peut que réduire.
  const agent = (await k.chercherUnitesMelees(PHRASE, { projectId: PROJET, limite: 8 })).map((x) => x.unite.id);
  noter(
    'la recherche allume ce que l’agent recevrait — la compétence d’envoi chez Apple en tête — et rien d’autre que ses huit premières',
    recus.includes(competenceApple.id) && recus.every((id) => agent.includes(id)) && Number(await page.getAttribute('[data-memoire-page="graphe"]', 'data-graphe-allumes')) >= recus.length,
    `écran ${recus.join(',')} — agent ${agent.join(',')}`,
  );
  if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'memoire-graphe-recherche.png') });
  await page.click(`[data-graphe-recue="${competenceApple.id}"]`);
  await page.waitForSelector(`[data-graphe-fiche="${competenceApple.id}"] [data-graphe-fiche-resume]`, { timeout: 10_000 });
  const fiche = (await page.textContent(`[data-graphe-fiche="${competenceApple.id}"]`)) ?? '';
  noter(
    'choisir un élément ouvre sa fiche sur le graphe : titre clair, code, chemin, date et résumé',
    fiche.includes(`Envoi d’une application iPhone à Apple (${competenceApple.id})`) && /Compétences/.test(fiche) && /Ajoutée le/.test(fiche) && /App Store/.test(fiche) && (await page.getAttribute('[data-memoire-page="graphe"]', 'data-graphe-selection')) === competenceApple.id,
    fiche.slice(0, 220),
  );
  const miniFicheOuverte = await placeMini();
  noter('ouvrir une fiche ne déplace pas la mini-carte', miniFicheOuverte?.droite === miniAuDepart?.droite && miniFicheOuverte?.bas === miniAuDepart?.bas, JSON.stringify(miniFicheOuverte));
  /* LA POIGNÉE DÉPLACE LA MINI-CARTE, la place est retenue, bornée, et le double-clic la renvoie au coin. */
  await page.hover('[data-graphe-minicarte-cadre]');
  /* La fiche ouverte vient de cadrer la vue : on attend la fin du passage avant de mesurer. */
  await page.waitForFunction(() => document.querySelector('[data-memoire-graphe]')?.getAttribute('data-graphe-passage') !== 'en-cours', null, { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(900);
  const poignee = await page.locator('[data-graphe-minicarte-poignee]').boundingBox();
  const vueAvantPoignee = await vue();
  await page.mouse.move(poignee.x + poignee.width / 2, poignee.y + poignee.height / 2);
  await page.mouse.down();
  await page.mouse.move(poignee.x + poignee.width / 2 - 300, poignee.y + poignee.height / 2 - 200, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const miniDeplacee = await placeMini();
  noter(
    'la poignée déplace la mini-carte (300 px à gauche, 200 px plus haut) sans bouger la vue',
    Math.abs(miniDeplacee.droite - 312) <= 2 && Math.abs(miniDeplacee.bas - 284) <= 2 && (await vue()).centre === vueAvantPoignee.centre,
    JSON.stringify(miniDeplacee),
  );
  noter('la place est retenue sur le compte', (await page.getAttribute('[data-graphe-minicarte-cadre]', 'data-graphe-minicarte-place')) === 'retenue');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-graphe-minicarte-cadre]', { timeout: 30_000 });
  await page.waitForTimeout(400);
  const miniRechargee = await placeMini();
  noter('après rechargement, la mini-carte est à la même place', Math.abs(miniRechargee.droite - miniDeplacee.droite) <= 2 && Math.abs(miniRechargee.bas - miniDeplacee.bas) <= 2, JSON.stringify(miniRechargee));
  await page.hover('[data-graphe-minicarte-cadre]');
  const poignee2 = await page.locator('[data-graphe-minicarte-poignee]').boundingBox();
  await page.mouse.move(poignee2.x + poignee2.width / 2, poignee2.y + poignee2.height / 2);
  await page.mouse.down();
  await page.mouse.move(poignee2.x - 4000, poignee2.y - 4000, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const miniBornee = await placeMini();
  noter('glissée trop loin, la mini-carte reste dans la zone du graphe', miniBornee.x >= miniBornee.zone.l && miniBornee.y >= miniBornee.zone.t, JSON.stringify(miniBornee));
  await page.hover('[data-graphe-minicarte-cadre]');
  await page.dblclick('[data-graphe-minicarte-poignee]');
  await page.waitForTimeout(250);
  const miniRendue = await placeMini();
  noter('un double-clic sur la poignée la renvoie au coin', miniRendue?.droite === 12 && miniRendue?.bas === 84 && (await page.getAttribute('[data-graphe-minicarte-cadre]', 'data-graphe-minicarte-place')) === 'coin', JSON.stringify(miniRendue));
  await page.click(`[data-graphe-recue="${competenceApple.id}"]`).catch(() => {});
  if (!(await page.$(`[data-graphe-fiche="${competenceApple.id}"]`))) {
    await page.fill('input[data-graphe-recherche]', PHRASE);
    await page.waitForSelector('[data-graphe-etat-recherche="faite"]', { timeout: 30_000 });
    await page.click(`[data-graphe-recue="${competenceApple.id}"]`);
  }
  await page.waitForSelector(`[data-graphe-fiche="${competenceApple.id}"] [data-graphe-fiche-resume]`, { timeout: 10_000 });
  await page.click('[data-graphe-ouvrir-liste]');
  await page.waitForSelector(`[data-memoire-lecture="${competenceApple.id}"]`, { timeout: 10_000 });
  noter('« Ouvrir dans la liste » mène à la page de l’élément, dans la liste', (await page.$('[data-memoire-vue="liste"]')) !== null && /Compétences/.test((await page.textContent('[data-sujet-du-fil]')) ?? ''));
  await page.click('[data-memoire-vers-graphe]');
  await page.waitForSelector('[data-memoire-graphe="pret"]', { timeout: 10_000 });
  noter('le bouton « Graphe » ramène au graphe, sur la portée lue', (await page.getAttribute('[data-memoire-page="graphe"]', 'data-graphe-focus')) === 'global');

  /* ---- LA LISTE, rouverte d'un écran neuf ---- */
  await ouvrirLaMemoire();
  const portees = await page.$$eval('[data-memoire-portee]', (b) => b.map((x) => x.getAttribute('data-memoire-portee')));
  noter('la liste : Global en tête, puis le projet', portees[0] === 'global' && portees.includes(PROJET), portees.join(', '));

  await page.click(`[data-memoire-portee="${PROJET}"]`);
  await page.waitForSelector(`[data-memoire-fiches="${PROJET}"]`);
  const fiches = await page.$$eval('[data-memoire-fiche]', (b) => b.map((x) => x.getAttribute('data-memoire-fiche')));
  noter('les quatorze fiches numérotées (Compétences comprises) et le changelog', fiches.length === 15 && fiches.at(-2) === '13_skills' && fiches[0] === '00_project' && fiches.at(-1) === 'CHANGELOG', `${fiches.length} entrées`);

  await page.click('[data-memoire-fiche="00_project"]');
  await page.waitForSelector('[data-memoire-jamais]', { timeout: 10_000 }).catch(() => {});
  const tete = await page.textContent('[data-memoire-zone="fiche"]');
  noter('00_project porte « À ne jamais supposer », en bas des informations', /À ne jamais supposer/.test(tete ?? '') && /port 7070/.test(tete ?? ''));
  const ordreTete = await page.$eval('[data-memoire-unites]', (el) => {
    const jamais = el.querySelector('[data-memoire-jamais]');
    const themes = el.querySelector('[data-memoire-themes]');
    return Boolean(jamais && themes && themes.compareDocumentPosition(jamais) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  noter('« À ne jamais supposer » vient après les thèmes', ordreTete);

  /* ---- Une catégorie → un thème → un élément ---- */
  await page.click('[data-memoire-fiche="05_decisions"]');
  await page.waitForSelector('[data-memoire-fiche-ouverte="05_decisions"]');
  await page.click('[data-memoire-theme="memoire"]');
  await page.waitForSelector('[data-memoire-theme-ouvert="memoire"]', { timeout: 10_000 });
  const ligneDecision = ((await page.textContent(`[data-memoire-ligne="${decision.id}"]`)) ?? '').replace(/\s+/g, ' ');
  noter(
    'un thème liste ses éléments en lignes « titre clair (CODE) », avec leur phrase et leur date',
    ligneDecision.includes(`La base de connaissances fait foi (${decision.id})`) && /régénérés depuis elle/.test(ligneDecision) && /\d{4}/.test(ligneDecision),
    ligneDecision.slice(0, 200),
  );
  const fil = await page.$$eval('[data-cran-du-fil]', (b) => b.map((x) => x.textContent?.trim()));
  noter('le fil d’Ariane dit la portée, la catégorie puis le thème', fil.slice(-3).join(' › ') === 'Essai mémoire › Décisions › Mémoire', fil.join(' › '));
  await page.click(`[data-memoire-ligne="${decision.id}"]`);
  await page.waitForSelector(`[data-memoire-lecture="${decision.id}"]`);
  const lecture = (await page.textContent(`[data-memoire-lecture="${decision.id}"]`)) ?? '';
  noter(
    'un élément s’ouvre en page de lecture : titre et code, « Important », « Pourquoi c’est important », technique replié',
    (await page.isVisible(`[data-memoire-lecture="${decision.id}"] [data-memoire-pourquoi]`)) &&
      /Important/.test((await page.textContent(`[data-memoire-lecture="${decision.id}"] [data-memoire-importance="P1"]`)) ?? '') &&
      lecture.includes(`(${decision.id})`) &&
      /Pourquoi c’est important/.test(lecture) &&
      /source/.test(lecture) &&
      !(await page.isVisible(`[data-memoire-lecture="${decision.id}"] [data-memoire-technique]`)) &&
      (await page.textContent('[data-unite-du-fil]'))?.trim() === 'La base de connaissances fait foi',
    lecture.slice(0, 200),
  );
  noter('l’adresse désigne l’élément lu', (await page.evaluate(() => location.hash)).endsWith(`/fiche/05_decisions/unite/${decision.id}`), await page.evaluate(() => location.hash));
  if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'memoire-decision.png') });

  await lireLUnite('06_components', composant.id);
  const blocs = await page.$$eval(`[data-memoire-lecture="${composant.id}"] [data-memoire-blocs] [data-memoire-bloc]`, (b) => b.map((x) => x.getAttribute('data-memoire-bloc')));
  noter(
    'un composant montre Rôle, Comportement et Contrôles en blocs, et range Fichiers dans les détails techniques',
    blocs.join(',') === 'Rôle,Comportement,Contrôles' && /tiroir-publication\.tsx/.test((await page.textContent(`[data-memoire-lecture="${composant.id}"] [data-memoire-technique]`)) ?? ''),
    blocs.join(', '),
  );
  if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'memoire-composant.png') });

  /* ---- Les thèmes, le tri par date, la recherche de la catégorie, le titre clair ---- */
  await page.click('[data-memoire-fiche="04_conventions"]');
  await page.waitForSelector('[data-memoire-fiche-ouverte="04_conventions"]', { timeout: 10_000 });
  await page.waitForSelector('[data-memoire-theme]', { timeout: 10_000 });
  const themes = await page.$$eval('[data-memoire-theme]', (b) => b.map((x) => [x.getAttribute('data-memoire-theme'), x.querySelector('[data-memoire-theme-compte]')?.getAttribute('data-memoire-theme-compte'), Boolean(x.querySelector('[data-memoire-theme-date]'))]));
  noter(
    'une catégorie s’ouvre sur ses thèmes (sujets en double fusionnés), chacun avec son nombre et la date de son dernier ajout',
    JSON.stringify([...themes].sort()) === JSON.stringify([['cartes', '3', true], ['interface', '3', true]]) && (await page.$$('[data-memoire-ligne]')).length === 0,
    JSON.stringify(themes),
  );
  await page.click('[data-memoire-theme="cartes"]');
  await page.waitForSelector('[data-memoire-theme-ouvert="cartes"]');
  const lignesCartes = await page.$$eval('[data-memoire-ligne]', (b) => b.map((x) => [x.getAttribute('data-memoire-ligne'), Number(x.getAttribute('data-memoire-cree-le'))]));
  noter(
    'un thème montre ses seules unités, les plus récentes d’abord',
    lignesCartes.length === 3 && lignesCartes.every((l, i) => i === 0 || lignesCartes[i - 1][1] >= l[1]) && lignesCartes.every(([id]) => conventions.slice(0, 3).some((c) => c.id === id)),
    JSON.stringify(lignesCartes),
  );
  const titrePremier = ((await page.textContent(`[data-memoire-ligne="${conventions[0].id}"] [data-memoire-titre-clair]`)) ?? '').replace(/\s+/g, ' ').trim();
  await page.click(`[data-memoire-ligne="${conventions[0].id}"]`);
  await page.click(`[data-memoire-lecture="${conventions[0].id}"] [data-memoire-technique-bascule]`);
  const technique = (await page.textContent(`[data-memoire-lecture="${conventions[0].id}"] [data-memoire-technique]`)) ?? '';
  noter(
    'le titre clair s’affiche en premier, suivi de son code ; le titre des agents passe dans les détails techniques',
    titrePremier === `${TITRE_CLAIR} (${conventions[0].id})` && /Titre pour les agents : Une carte naît dans la colonne Planifié/.test(technique) && technique.includes(conventions[0].id),
    `${titrePremier} — ${technique.slice(0, 120)}`,
  );
  await page.click('[data-sujet-du-fil]');
  await page.fill('[data-memoire-filtre]', 'défile');
  await page.waitForSelector('[data-memoire-recherche-active="oui"]');
  const filtrees = await page.$$eval('[data-memoire-ligne]', (b) => b.map((x) => x.getAttribute('data-memoire-ligne')));
  noter(
    'la recherche de la catégorie ne garde que les éléments correspondants, sans les thèmes',
    filtrees.length === 1 && (await page.$$('[data-memoire-theme]')).length === 0 && (await page.getAttribute('[data-memoire-filtre-compte]', 'data-memoire-filtre-compte')) === '1',
    filtrees.join(', '),
  );
  await page.fill('[data-memoire-filtre]', 'nouvelles tâches');
  await page.waitForFunction(() => document.querySelectorAll('[data-memoire-ligne]').length === 1, null, { timeout: 5000 }).catch(() => {});
  noter('la recherche mord aussi sur le titre clair', (await page.$$eval('[data-memoire-ligne]', (b) => b.map((x) => x.getAttribute('data-memoire-ligne')))).join() === conventions[0].id);
  await page.click('[data-memoire-filtre-effacer]');
  noter('effacer la recherche rend les thèmes', (await page.$$('[data-memoire-theme]')).length === 2 && (await page.$$('[data-memoire-ligne]')).length === 0);
  if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'memoire-themes.png') });

  await page.click('[data-memoire-fiche="CHANGELOG"]');
  await page.waitForSelector('[data-memoire-changelog]');
  const journalLisible = await page.$eval('[data-memoire-changelog]', (el) => {
    const poids = [...el.querySelectorAll('[data-memoire-changelog-poids]')].map((x) => x.getAttribute('data-memoire-changelog-poids'));
    const grande = el.querySelector('[data-memoire-changelog-poids="grande-nouveaute"]');
    return { jours: el.querySelectorAll('[data-memoire-changelog-jour]').length, poids, grande: grande?.textContent ?? '', texte: el.textContent ?? '' };
  });
  noter(
    'le changelog : la grande nouveauté d’abord avec son explication, puis la correction, le détail replié, sans branche ni préfixe de commit',
    journalLisible.jours >= 1 &&
      journalLisible.poids[0] === 'grande-nouveaute' &&
      /Un agent retrouve ce qui compte/.test(journalLisible.grande) &&
      journalLisible.poids.includes('detail') &&
      /Italique parasite/.test(journalLisible.texte) &&
      !/fix\(memoire\):/.test(journalLisible.texte) &&
      !/tache\//.test(journalLisible.texte) &&
      !(await page.isVisible('[data-memoire-changelog-poids="detail"]')),
    `${journalLisible.poids.join(', ')} — ${JSON.stringify({ grande: journalLisible.grande.slice(0, 200), branche: /tache\//.test(journalLisible.texte), prefixe: /fix\(memoire\):/.test(journalLisible.texte), detailVisible: await page.isVisible('[data-memoire-changelog-poids="detail"]') })}`,
  );
  if (process.env.VERIF_CAPTURES) await page.screenshot({ path: path.join(process.env.VERIF_CAPTURES, 'memoire-changelog.png') });

  await page.click('[data-memoire-changelog-filtre]');
  const filtreesJournal = await page.$$eval('[data-memoire-changelog] [data-memoire-changelog-poids]', (b) => b.map((x) => x.getAttribute('data-memoire-changelog-poids')));
  noter(
    'le filtre « Grandes nouveautés seulement » ne garde que les grandes nouveautés',
    filtreesJournal.length === 1 && filtreesJournal[0] === 'grande-nouveaute' && (await page.getAttribute('[data-memoire-changelog-filtre]', 'aria-pressed')) === 'true',
    filtreesJournal.join(', '),
  );
  await page.click('[data-memoire-changelog-filtre]');
  await page.waitForSelector('[data-memoire-changelog-poids="correction"]', { state: 'attached' });

  const idCorrection = await page.getAttribute('[data-memoire-changelog-poids="correction"]', 'data-memoire-changelog-entree');
  const ligne = page.locator(`[data-memoire-changelog-entree="${idCorrection}"]`);
  await ligne.locator('button[aria-expanded]').first().click();
  const carteLiee = await ligne.locator('[data-memoire-changelog-carte]').getAttribute('data-memoire-changelog-carte', { timeout: 5000 }).catch(() => null);
  noter('une entrée issue d’une carte propose « Ouvrir la carte » vers sa carte d’origine', carteLiee === 'carte-essai-2', String(carteLiee));
  await ligne.locator('[data-memoire-changelog-carte]').click();
  const tiroir = await page.waitForSelector('[role="dialog"]', { timeout: 10_000 }).then(() => true).catch(() => false);
  noter('« Ouvrir la carte » ouvre le tiroir de la carte', tiroir);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 10_000 }).catch(() => {});
  // Ouvrir une carte ramène au tableau : on revient au changelog du projet avant de le corriger.
  if (!(await page.isVisible('[data-memoire-changelog]'))) {
    await ouvrirLaMemoire();
    await page.click(`[data-memoire-portee="${PROJET}"]`);
    await page.click(`[data-memoire-fiches="${PROJET}"] [data-memoire-fiche="CHANGELOG"]`);
    await page.waitForSelector(`[data-memoire-changelog-entree="${idCorrection}"]`, { timeout: 10_000 });
    await ligne.locator('button[aria-expanded]').first().click();
  }

  await ligne.locator('[data-memoire-changelog-corriger]').click();
  await ligne.locator('[data-memoire-changelog-editeur-titre]').fill('Les noms de colonnes s’affichent sans italique');
  await ligne.locator('[data-memoire-changelog-editeur-explication]').fill('Un souligné dans un nom de colonne ne met plus le texte en italique. Les noms se lisent tels qu’ils sont écrits.');
  await ligne.locator('[data-memoire-changelog-editeur-poids="amelioration"]').click();
  await ligne.locator('[data-memoire-changelog-editeur-enregistrer]').click();
  await page.waitForSelector(`[data-memoire-changelog-entree="${idCorrection}"][data-memoire-changelog-poids="amelioration"] [data-memoire-changelog-corrigee]`, { state: 'attached', timeout: 10_000 }).catch(() => {});
  const enBase = base.prepare('SELECT titre, poids, corrigee FROM changelog_entrees WHERE id = ?').get(Number(idCorrection));
  noter(
    'une entrée se corrige à la main (titre, explication, poids) et reste marquée corrigée',
    enBase?.corrigee === 1 && enBase.poids === 'amelioration' && /sans italique/.test((await ligne.textContent()) ?? ''),
    JSON.stringify(enBase),
  );
  if (process.env.VERIF_CAPTURES) await page.screenshot({ path: path.join(process.env.VERIF_CAPTURES, 'memoire-changelog-corrige.png') });

  await page.click('[data-memoire-fiche="03_domain"]');
  await page.waitForSelector('[data-memoire-fiche-ouverte="03_domain"]');
  const definition = (await page.textContent('[data-memoire-definition]')) ?? '';
  const infobulle = (await page.getAttribute('[data-memoire-fiche="03_domain"]', 'title')) ?? '';
  noter('la fiche ouverte dit ce qui y entre, et la liste le redit en infobulle', /vocabulaire du métier/.test(definition) && /vocabulaire du métier/.test(infobulle));
  await lireLUnite('03_domain', colonne.id);
  const carteColonne = page.locator(`[data-memoire-lecture="${colonne.id}"]`);
  noter(
    'un souligné au milieu d’un mot n’ouvre plus d’italique, et le détail court n’a plus de sections vides',
    /userspsy_language_tmp/.test((await carteColonne.textContent()) ?? '') && (await carteColonne.locator('em').count()) === 0 && !/Non renseigné/.test((await carteColonne.textContent()) ?? ''),
  );

  await page.fill('[data-memoire-recherche]', 'port du démon');
  await page.waitForSelector('[data-memoire-trouvee]', { timeout: 10_000 });
  const trouvees = await page.$$eval('[data-memoire-trouvee]', (b) => b.map((x) => x.getAttribute('data-memoire-trouvee')));
  await page.click('[data-memoire-trouvee]');
  await page.waitForSelector('[data-memoire-lecture]', { timeout: 10_000 });
  noter('la recherche rend l’unité et l’ouvre en page, dans sa catégorie', trouvees.length > 0 && /Environnement/.test((await page.textContent('[data-sujet-du-fil]')) ?? ''), trouvees.join(', '));

  // Les dépréciées de la même catégorie : la page reste sur le thème lu s'il en a, sinon revient aux thèmes.
  await page.check('[data-memoire-depreciees]');
  await page.waitForSelector(`[data-memoire-ligne="${ancienne.id}"], [data-memoire-theme]`, { timeout: 10_000 });
  if (!(await page.$(`[data-memoire-ligne="${ancienne.id}"]`))) await page.click('[data-memoire-theme]');
  await page.click(`[data-memoire-ligne="${ancienne.id}"]`, { timeout: 10_000 });
  await page.waitForSelector(`[data-memoire-lecture="${ancienne.id}"]`, { timeout: 10_000 });
  noter('les dépréciées se lisent à part, avec ce qui les remplace', /Remplacée par/.test((await page.textContent(`[data-memoire-lecture="${ancienne.id}"]`)) ?? ''));
  await page.uncheck('[data-memoire-depreciees]');

  await lireLUnite('12_lessons', douteuse.id);
  const pageDouteuse = (await page.textContent(`[data-memoire-lecture="${douteuse.id}"]`)) ?? '';
  noter(
    'une unité peu sûre ne demande rien à l’utilisateur : ni « Confirmer » ni « À relire » (le système la relit seul)',
    !(await page.$('[data-memoire-confirmer]')) && !/À relire/.test(pageDouteuse) && !/À relire/.test((await page.textContent('body')) ?? ''),
  );
  await page.click(`[data-memoire-lecture="${douteuse.id}"] [data-memoire-unite-menu]`);
  noter('le menu « … » propose toujours « Déprécier »', (await page.waitForSelector('[data-memoire-deprecier]', { timeout: 5_000 }).catch(() => null)) !== null);
  await page.keyboard.press('Escape');

  /* ---- En largeur téléphone : UNE seule barre (celle de l'application), le graphe d'abord, puis les pages de la liste ---- */
  {
    const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-CH', serviceWorkers: 'block', hasTouch: true });
    await tel.addCookies([{ name: 'beluga_session', value: cookie, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const p = await tel.newPage();
    await ouvrirLeGraphe(p);
    /* LA MÉMOIRE N'A PLUS DE BARRE À ELLE (demande du 11/10/2026 : « éviter les
       doubles header avec le titre à double ») : son nom, sa flèche de retour,
       sa loupe et son menu sont dans la barre d'en-tête de l'application. */
    const BARRE = 'main [data-entete-de-zone]';
    /* LE HAUT DU TÉLÉPHONE (03/11/2026) : la recherche du graphe sur toute la largeur, plus de bouton « Liste » ;
       en bas, « Vue d'ensemble » ouvre les projets. */
    await p.waitForSelector(`${BARRE} [data-haut-contenu] [data-graphe-recherche]`, { timeout: 30_000 });
    const hauteurDeLaBarre = () => p.$eval(BARRE, (el) => Math.round(el.getBoundingClientRect().height));
    const entete = await hauteurDeLaBarre();
    const champ = await p.$eval(`${BARRE} [data-graphe-recherche]`, (el) => Math.round(el.getBoundingClientRect().height));
    noter(
      'téléphone : le graphe s’ouvre en plein écran, la recherche dans la barre à la hauteur des boutons, plus de « Liste »',
      (await p.isVisible('[data-memoire-page="graphe"] canvas')) && entete === 56 && champ === 38 && (await p.$('[data-memoire-vers-liste]')) === null,
      `${entete} px, champ ${champ} px`,
    );
    noter('téléphone : pas de mini-carte, l’écran reste au graphe', (await p.$('[data-graphe-minicarte]')) === null);
    await p.click('[data-graphe-temps-bouton]');
    await p.waitForSelector('[data-graphe-temps-menu] [data-graphe-jour]', { timeout: 5000 });
    const tiroir = await p.$eval('[data-graphe-temps-menu]', (el) => {
      const b = el.getBoundingClientRect();
      return { bas: Math.round(b.bottom), largeur: Math.round(b.width) };
    });
    noter('téléphone : le calendrier s’ouvre en tiroir au bas de l’écran', tiroir.bas >= 840 && tiroir.largeur >= 388, JSON.stringify(tiroir));
    if (CAPTURES) await p.screenshot({ path: path.join(CAPTURES, 'memoire-telephone-temps.png') });
    await p.keyboard.press('Escape');
    if (CAPTURES) await p.screenshot({ path: path.join(CAPTURES, 'memoire-telephone-graphe.png') });

    await p.click('[data-bouton-pleine-largeur="vue-d-ensemble"]');
    await p.waitForSelector('[data-memoire-feuille-des-projets] [data-memoire-portee]', { timeout: 8000 });
    noter('téléphone : « Vue d’ensemble » ouvre les projets en feuille du bas', (await p.$$('[data-feuille-du-bas] [data-memoire-portee]')).length >= 2);
    await p.click(`[data-memoire-feuille-des-projets] [data-memoire-portee="${PROJET}"]`);
    await p.waitForSelector('[data-memoire-vue="liste"]', { timeout: 15_000 });
    noter('téléphone : aucune grille à trois colonnes', (await p.$('[data-memoire-disposition="ordinateur"]')) === null);
    await p.click('[data-memoire-menu]');
    await p.waitForSelector('[data-memoire-exporter]', { timeout: 8000 });
    const menu = await p.$$eval('[data-memoire-partout], [data-memoire-depreciees], [data-memoire-exporter]', (b) => b.length);
    noter(
      'téléphone : le menu ⋮ porte « Graphe », Partout, Dépréciées et Exporter, sans Importer ni Régénérer',
      menu === 3 && (await p.$('[data-memoire-vers-graphe]')) !== null && (await p.$('[data-memoire-importer], [data-memoire-regenerer]')) === null,
      `${menu} commandes`,
    );
    await p.keyboard.press('Escape');

    await p.waitForSelector('[data-memoire-page="fiches"] [data-memoire-fiche="05_decisions"]', { state: 'visible', timeout: 10_000 });
    const sujets = await p.$$eval('[data-memoire-fiche]', (b) => b.map((x) => x.getAttribute('data-memoire-fiche')));
    noter('téléphone : la deuxième page liste les sujets de la portée, Changelog compris, sans « Dépréciées »', sujets.length === 15 && sujets.at(-1) === 'CHANGELOG' && !(await p.isVisible('[data-memoire-depreciees]')) && (await p.$('[data-memoire-portee]')) === null);
    noter(
      'téléphone : sur la page des sujets, la barre d’en-tête porte la flèche de retour et titre la portée',
      (await p.isVisible(`${BARRE} [data-memoire-retour="portees"]`)) && /Essai mémoire/.test((await p.textContent(`${BARRE} [data-memoire-titre]`)) ?? ''),
    );
    await p.click('[data-memoire-fiche="05_decisions"]');
    await p.click('[data-memoire-theme="memoire"]', { timeout: 10_000 });
    await p.click(`[data-memoire-ligne="${decision.id}"]`, { timeout: 10_000 });
    await p.waitForSelector(`[data-memoire-page="fiche"] [data-memoire-lecture="${decision.id}"]`, { timeout: 10_000 });
    noter(
      'téléphone : l’élément se lit en page, titré dans la barre, dont la flèche ramène à son thème',
      (await p.$('[data-memoire-fiche]')) === null && (await p.isVisible(`${BARRE} [data-memoire-retour="theme"]`)) && ((await p.textContent(`${BARRE} [data-memoire-titre]`)) ?? '').trim().length > 0,
    );
    const entete3 = await hauteurDeLaBarre();
    noter('téléphone : la barre garde sa hauteur, sans rangée ajoutée dessous', entete3 === 56 && (await p.$$eval('[data-gestes-de-page="page"]', (r) => r.filter((el) => el.getClientRects().length > 0).length)) === 0, `${entete3} px`);
    const zone = await p.$eval('[data-memoire-zone="fiche"]', (el) => el.getBoundingClientRect().height);
    noter('téléphone : la page de l’élément occupe le reste de l’écran', zone > 844 * 0.5, `${Math.round(zone)} px`);
    if (process.env.VERIF_CAPTURES) await p.screenshot({ path: path.join(process.env.VERIF_CAPTURES, 'memoire-telephone.png') });
    await p.click('[data-memoire-retour="theme"]');
    await p.waitForSelector('[data-memoire-theme-ouvert="memoire"]', { timeout: 10_000 });
    await p.waitForTimeout(700);
    await p.click('[data-memoire-retour="categorie"]');
    await p.waitForSelector('[data-memoire-fiche-ouverte="05_decisions"]', { timeout: 10_000 });
    // La flèche de la barre prend son nouveau cran une image après la page.
    const versLesSujets = await p.waitForSelector('[data-memoire-retour="fiches"]', { timeout: 5000 }).then(() => true).catch(() => false);
    noter('téléphone : la flèche remonte d’un cran à la fois — l’élément, le thème, la catégorie', versLesSujets);

    await p.click('[data-memoire-ouvrir-recherche]');
    await p.fill('[data-memoire-recherche]', 'port du démon');
    await p.waitForSelector('[data-memoire-trouvee]', { timeout: 10_000 });
    const entete2 = await hauteurDeLaBarre();
    noter('téléphone : la recherche se déplie dans la barre d’en-tête, à la place du titre', entete2 === 56 && (await p.$(`${BARRE} [data-memoire-recherche]`)) !== null, `${entete2} px`);
    await p.click('[data-memoire-trouvee]');
    await p.waitForSelector('[data-memoire-page="fiche"] [data-memoire-lecture]', { timeout: 10_000 });
    noter('téléphone : un résultat de recherche ouvre directement la page de l’élément', (await p.$('[data-memoire-trouvee]')) === null && (await p.$('[data-memoire-retour]')) !== null);

    for (const cran of ['theme', 'categorie', 'fiches', 'portees']) {
      const present = await p.waitForSelector(`[data-memoire-retour="${cran}"]`, { timeout: 10_000 }).then(() => true).catch(() => false);
      if (!present) {
        const lu = await p.evaluate(() => ({
          retours: [...document.querySelectorAll('[data-memoire-retour]')].map((e) => e.getAttribute('data-memoire-retour')),
          pages: [...document.querySelectorAll('[data-memoire-page]')].map((e) => e.getAttribute('data-memoire-page')),
          fil: [...document.querySelectorAll('[data-cran-du-fil]')].map((e) => e.textContent),
        }));
        console.log(`  (téléphone) flèche « ${cran} » attendue — lu : ${JSON.stringify(lu)}`);
        break;
      }
      await p.click(`[data-memoire-retour="${cran}"]`);
      // Six appuis en trois secondes dans le coin haut gauche ouvrent l'écran caché des mesures : on espace les retours.
      await p.waitForTimeout(700);
    }
    await p.waitForSelector('[data-memoire-page="portees"]', { timeout: 10_000 }).catch(() => {});
    noter('téléphone : les retours ramènent à la page des portées', (await p.$('[data-memoire-retour]')) === null && (await p.$(`[data-memoire-portee="${PROJET}"]`)) !== null);
    await tel.close();
  }

  /* ---- Le fil d'un agent : une lecture de la mémoire se dit « titre clair (MEM-…) » ---- */
  {
    const carteId = `carte-fil-memoire-${crypto.randomBytes(4).toString('hex')}`;
    const agentId = `agent-${carteId}`;
    base
      .prepare(`INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description, agent_id) VALUES (?, ?, 'planned', 1, ?, '{}', ?, ?, ?, ?)`)
      .run(carteId, PROJET, 'Lecture de la mémoire', maintenant, maintenant, 'Carte posée par un contrôle automatique.', agentId);
    base
      .prepare(`INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, 'task', 'done', ?, ?, ?)`)
      .run(
        agentId,
        PROJET,
        carteId,
        JSON.stringify({ id: agentId, projectId: PROJET, cardId: carteId, role: 'task', title: 'Lecture de la mémoire', status: 'done', run: { engine: 'claude', model: 'claude-opus-5', thinking: 'high', mode: 'direct' }, createdAt: maintenant, updatedAt: maintenant }),
        maintenant,
        maintenant,
      );
    base
      .prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(`${agentId}-m1`, agentId, 'user', JSON.stringify({ id: `${agentId}-m1`, agentId, role: 'user', content: 'Carte d’essai : ne rien exécuter.', createdAt: maintenant }), maintenant);
    // Le texte EXACT que l'outil rend à l'agent : il porte les titres techniques, et ne change pas.
    const rendu = k.rendreUnitesTrouvees('cartes', [conventions[0], conventions[1]].map((u) => ({ unite: k.lireUnite(u.id), score: 1 })));
    const poser = base.prepare(
      `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, outil, params, resultat, reussie, duree_ms, etat, donnees)
       VALUES (@id, @card_id, @rang, 'execution', @nature, @at, @agent_id, 'execution', @tour_id, @libelle, @outil, @params, @resultat, @reussie, NULL, @etat, NULL)`,
    );
    const commun = { card_id: carteId, agent_id: agentId, tour_id: `${carteId}-tour` };
    poser.run({ ...commun, id: `${carteId}-j1`, rang: 1, nature: 'point', at: maintenant - 5000, libelle: 'Lire la mémoire', outil: null, params: null, resultat: null, reussie: null, etat: 'done' });
    poser.run({
      ...commun,
      id: `${carteId}-j2`,
      rang: 2,
      nature: 'requete',
      at: maintenant - 4000,
      libelle: 'Base de connaissances',
      outil: 'mcp__beluga__memoire',
      params: JSON.stringify({ geste: 'chercher', demande: 'cartes' }),
      resultat: rendu,
      reussie: 1,
      etat: null,
    });
    /* UNE UNITÉ LUE PAR SON CODE : la phrase du récit dit « titre (CODE) ».
       Une commande entre chaque lecture garde les blocs séparés. */
    const lecture = (rang, id) => ({
      ...commun,
      id: `${carteId}-j${rang}`,
      rang,
      nature: 'requete',
      at: maintenant - 4000 + rang * 100,
      libelle: 'Base de connaissances',
      outil: 'mcp__beluga__memoire',
      params: JSON.stringify({ geste: 'lire', id }),
      resultat: k.rendreUnite ? k.rendreUnite(k.lireUnite(id)) : `## ${id} — ${k.lireUnite(id).titre}`,
      reussie: 1,
      etat: null,
    });
    const commande = (rang) => ({
      ...commun,
      id: `${carteId}-j${rang}`,
      rang,
      nature: 'requete',
      at: maintenant - 4000 + rang * 100,
      libelle: 'Bash',
      outil: 'Bash',
      params: JSON.stringify({ command: 'ls', description: 'Lister le dossier' }),
      resultat: 'a b',
      reussie: 1,
      etat: null,
    });
    poser.run(commande(3));
    poser.run(lecture(4, conventions[0].id));
    poser.run(commande(5));
    poser.run(lecture(6, conventions[1].id));
    const fil = await contexte.newPage();
    await fil.goto(`${BASE}/#projet/${encodeURIComponent(PROJET)}/tache/${encodeURIComponent(carteId)}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const tiroir = fil.locator('[role="dialog"]').last();
    await tiroir.locator('[data-point="travail"]').last().waitFor({ state: 'attached', timeout: 30_000 });
    const point = tiroir.locator('[data-point="travail"]').last();
    for (let essai = 0; essai < 3 && (await point.getAttribute('data-point-ouvert')) !== 'oui'; essai += 1) {
      await point.locator('[data-point-bascule="travail"]').click();
      await fil.waitForTimeout(1200);
    }
    // Le récit du point se lit en blocs racontés : chacun se déplie d'un clic (comme dans `verif-etapes-illustrees.mjs`).
    const contenu = tiroir.locator('[data-point-contenu="travail"]').first();
    const bascules = contenu.locator('[data-bloc-raconte-bascule]');
    for (let i = 0; i < (await bascules.count()); i += 1) await bascules.nth(i).click({ timeout: 5_000 }).catch(() => undefined);
    const volets = contenu.locator('[data-memoire-reference-bascule]');
    await volets.first().waitFor({ timeout: 15_000 }).catch(() => {});
    await fil.waitForFunction(() => document.querySelector('[data-memoire-reference-titre="clair"]'), null, { timeout: 10_000 }).catch(() => {});
    const titres = (await volets.allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
    if (!titres.length) {
      const etat = await tiroir.locator('[data-point]').evaluateAll((n) => n.map((e) => `${e.getAttribute('data-point')}:${e.hasAttribute('hidden') ? 'caché' : 'vu'}:${e.getAttribute('data-point-ouvert')}`));
      console.log('  (fil) points :', etat.join(', '), '— texte :', ((await tiroir.textContent()) ?? '').replace(/\s+/g, ' ').slice(300, 1500));
    }
    noter(
      'le fil d’un agent montre le titre clair puis le code, et retombe sur le titre technique sans titre clair',
      titres.some((x) => x.startsWith(`${TITRE_CLAIR} (${conventions[0].id})`)) && titres.some((x) => x.startsWith(`${conventions[1].titre} (${conventions[1].id})`)),
      titres.join(' | ').slice(0, 200),
    );
    await fil.waitForFunction(() => document.querySelector('[data-bloc-raconte-titre-clair="clair"]'), null, { timeout: 10_000 }).catch(() => {});
    const phrasesDuRecit = (await contenu.locator('[data-bloc-raconte-phrase]').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
    noter(
      'la ligne « J’ouvre la mémoire » d’une unité lue par son code dit le titre clair puis le code, ou le titre technique à défaut',
      phrasesDuRecit.some((x) => x.includes(`« ${TITRE_CLAIR} (${conventions[0].id}) »`)) &&
        phrasesDuRecit.some((x) => x.includes(`« ${conventions[1].titre} (${conventions[1].id}) »`)) &&
        !phrasesDuRecit.some((x) => x.includes(`« ${conventions[0].id} »`)),
      phrasesDuRecit.filter((x) => x.includes('mémoire')).join(' | ').slice(0, 300),
    );
    noter('le texte rendu à l’agent garde le titre technique', rendu.includes(conventions[0].titre) && !rendu.includes(TITRE_CLAIR));
    if (CAPTURES) await fil.screenshot({ path: path.join(CAPTURES, 'memoire-fil.png') });
    await fil.close();
  }

  // La langue se choisit comme le ferait l'utilisateur : le bouton des réglages
  // (au pied de la colonne de gauche), la page « Langue », l'anglais. Elle a
  // quitté le menu des trois points, qui n'existe d'ailleurs pas sur cet écran.
  await page.click('[data-reglages-menu]', { timeout: 8000 });
  await page.waitForSelector('[data-modale-reglages]', { timeout: 8000 });
  await page.click('[data-menu-reglages] [data-page-menu="langue"]', { timeout: 8000 });
  await page.waitForSelector('[data-langue-menu]', { timeout: 8000 });
  await page.click('[data-langue-choix="en"]', { timeout: 8000 });
  await page.waitForFunction(() => document.documentElement.dataset.langue === 'en', null, { timeout: 10_000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-modale-reglages]', { state: 'detached', timeout: 8000 });
  await ouvrirLaMemoire();
  await page.click(`[data-memoire-portee="${PROJET}"]`);
  await lireLUnite('05_decisions', decision.id);
  // LA VUE TIENT EN DEUX ENDROITS sur ordinateur : la liste des sujets (où se lit
  // « Changelog ») vit dans la colonne de gauche (`ColonneDeService`), et la zone
  // principale (`data-memoire-zones`) ne montre plus que le sujet ouvert.
  const sujetsEnColonne = (await page.textContent(`[data-colonne-de-service] [data-memoire-fiches="${PROJET}"]`, { timeout: 8000 }).catch(() => '')) ?? '';
  const anglais = `${sujetsEnColonne} ${(await page.textContent('[data-memoire-zones]')) ?? ''}`;
  // Un refus dit ce qu'il a lu : la langue portée par la page, et les mots attendus qui manquent.
  const langueLue = await page.evaluate(() => document.documentElement.dataset.langue ?? '');
  const manquants = ['Decisions', 'Why it matters', 'Changelog'].filter((mot) => !anglais.includes(mot));
  noter('la vue passe en anglais', manquants.length === 0, `langue « ${langueLue} »${manquants.length ? `, sans « ${manquants.join(' », « ')} » — lu : ${anglais.replace(/\s+/g, ' ').slice(0, 260)}` : ''}`);
} finally {
  await navigateur.close();
  base.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  nettoyer();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées.`);
process.exit(echecs.length ? 1 : 0);
