#!/usr/bin/env node
/**
 * LE SERVICE STATISTIQUES, DANS UN VRAI NAVIGATEUR, SUR UN DÉMON D'ESSAI.
 *
 *  1. un faux site en MODE VISITEUR : le bandeau paraît, l'accord donné, un
 *     clic sur un repère et une seconde page arrivent avec leur identifiant ;
 *  2. la grille des services (bouton à quatre carrés de la barre d'en-tête)
 *     porte « Résumé » (l'ancien « Statistiques ») et la nouvelle entrée
 *     « Statistiques » ;
 *  3. la liste montre le projet parmi les « Projets actifs » ; son détail lit
 *     l'audience, les parcours (liste, flux d'un parcours, frise d'un visiteur), la
 *     barre de période ouvre un menu à deux calendriers (début à gauche, fin
 *     à droite, jours entre les deux surlignés) ;
 *  4. plus d'onglet « Installation » : le bouton en haut à droite ouvre le
 *     RÉSUMÉ (suivi en place, repères posés) puis « Relancer l'assistant »
 *     (type de suivi → Suivant → méthode → Suivant → code) ; le titre est le
 *     dernier cran du fil d'Ariane de sa page, le pied porte la flèche de retour
 *     et « Suivant » large ;
 *     changer de type s'enregistre ; « Nouveau site » crée un site autonome
 *     et montre son extrait ;
 *  5. à 390 px, aucune barre du bas sur cet écran ; en thème sombre, l'écran
 *     se dessine (capture) ;
 *  6. (28/09/2026) un navigateur SANS ÉCRAN n'est pas compté (robot) ; la
 *     ligne, le bouton et le bandeau disent le même état ; la barre de
 *     recherche filtre les groupes ; l'interrupteur « Suivi actif » de l'entête
 *     range le projet parmi les inactifs ; un site autonome propose « Tester le
 *     suivi » et sa frise.
 *
 *   node scripts/verif-statistiques.mjs
 *
 * RECALÉ SUR LA REFONTE (11/10/2026). Les services vivent derrière le bouton à
 * quatre carrés de la barre d'en-tête : leurs tuiles n'existent qu'une fois la
 * grille ouverte (`scripts/lib/navigation.mjs`). L'assistant d'installation est
 * une PAGE ouverte par-dessus, plus un tiroir : « le titre est centré » (la
 * forme du tiroir) devient « le titre est le dernier cran du fil d'Ariane de sa
 * page » (règle « une seule barre d'en-tête par écran »).
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { ouvrirNavigation } from './lib/navigation.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKO_STATISTIQUES_PORT || 7203);
const PORT_SITE = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = `http://127.0.0.1:${PORT_SITE}`;
const PROJET = 'p-atelier';
const CLE = 'cleatelierstats';

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
console.log(`  …  dépôt jugé : ${RACINE}`);

const { DATA, PROJETS, attendrePort, journal } = demarrerDemonDEssai({
  prefixe: 'verif-statistiques-',
  port: PORT,
  depot: false,
  env: { BELUGA_ADRESSE_PUBLIQUE: BASE, BELUGA_MARKETING_NUIT: '0' },
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), maintenant, maintenant + 3600_000, 'vérification statistiques');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
    PROJET,
    'Atelier Léa',
    path.join(PROJETS, PROJET),
    JSON.stringify({ id: PROJET, name: 'Atelier Léa', path: path.join(PROJETS, PROJET), defaultEngine: 'claude', isSelf: false, branchesDePublication: {}, rank: 1000, archived: false, createdAt: maintenant, updatedAt: maintenant }),
    maintenant,
    maintenant,
  );
  db.prepare(
    `INSERT INTO marketing_espaces (project_id, cle_suivi, adresse, origines, methode_suivi, etat_suivi, langue, mode_suivi, cree_le, maj_le)
     VALUES (?, ?, ?, ?, 'manuel', 'pose', 'fr', 'visiteur', ?, ?)`,
  ).run(PROJET, CLE, `${SITE}/`, JSON.stringify([SITE]), maintenant, maintenant);
  const repere = db.prepare('INSERT INTO stats_reperes (project_id, nom, emplacement, raison, objectif, ordre, pose_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  repere.run(PROJET, 'voir-tarifs', 'Accueil, lien Tarifs', 'Qui s’intéresse aux prix', 1, 0, 'agent-essai', maintenant);
  repere.run(PROJET, 'reserver', 'Page Tarifs, bouton Réserver', 'Le but du site', 1, 1, 'agent-essai', maintenant);
  db.close();
}

const lire = (sql, ...args) => {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  try {
    return db.prepare(sql).get(...args);
  } finally {
    db.close();
  }
};

/* Le faux site, sur une autre adresse : deux pages, des repères, le script de suivi. */
const site = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="fr"><head><script defer src="${BASE}/m/s.js" data-cle="${CLE}"></script></head>
<body><h1>Atelier Léa ${req.url}</h1><a href="/tarifs" data-beluga-repere="voir-tarifs">Tarifs</a><button data-beluga-repere="reserver">Réserver</button></body></html>`);
});
await new Promise((r) => site.listen(PORT_SITE, '127.0.0.1', r));

let navigateur;
try {
  if (!(await attendrePort())) {
    console.error(`Le démon d'essai n'a pas démarré.\n${journal.join('')}`);
    process.exit(1);
  }
  poserLeDecor();
  navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  /* -------- 1. Le visiteur du site -------- */
  // Un navigateur SANS ÉCRAN est un robot pour le suivi : le visiteur de l'essai se présente comme un Chrome ordinaire.
  const visiteur = await navigateur.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  });
  const pageSite = await visiteur.newPage();
  await pageSite.goto(`${SITE}/`, { waitUntil: 'load' });
  await pageSite.waitForSelector('[data-beluga-bandeau]', { timeout: 10000 }).catch(() => {});
  noter('mode visiteur : le bandeau d’accord paraît sur le site', (await pageSite.locator('[data-beluga-bandeau]').count()) === 1);
  await pageSite.locator('[data-beluga-bandeau] button[data-r="1"]').click();
  await pageSite.waitForTimeout(200);
  await pageSite.click('[data-beluga-repere="voir-tarifs"]');
  await pageSite.waitForURL(`${SITE}/tarifs`);
  await pageSite.waitForTimeout(500);
  await pageSite.click('[data-beluga-repere="reserver"]');
  let persistants = 0;
  for (let i = 0; i < 40 && persistants < 3; i++) {
    await new Promise((r) => setTimeout(r, 250));
    persistants = lire("SELECT COUNT(*) AS n FROM marketing_evenements WHERE project_id = ? AND visiteur_persistant IS NOT NULL", PROJET).n;
  }
  noter('après accord, repères et pages arrivent avec l’identifiant du visiteur', persistants >= 3, String(persistants));
  noter('aucun cookie posé par le suivi', (await visiteur.cookies()).length === 0);
  await visiteur.close();
  const vues = () => lire("SELECT COUNT(*) AS n FROM marketing_evenements WHERE project_id = ? AND type = 'vue'", PROJET).n;
  const avantRobot = vues();
  const robot = await navigateur.newContext();
  const pageRobot = await robot.newPage();
  await pageRobot.goto(`${SITE}/robot`, { waitUntil: 'load' });
  await pageRobot.waitForTimeout(1500);
  await robot.close();
  noter('un navigateur sans écran (robot) n’est pas compté', vues() === avantRobot, `${avantRobot} → ${vues()}`);

  /* -------- 2. La colonne de gauche -------- */
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  // Les destinations vivent dans la GRILLE DES SERVICES, derrière le bouton à quatre carrés de la barre
  // d'en-tête : ses tuiles n'existent dans le document qu'une fois la grille ouverte.
  await ouvrirNavigation(page);
  const GRILLE = '[data-navigation-panneau="ouvert"]';
  await page.waitForSelector(`${GRILLE} [data-ouvrir-tableau-de-bord]`, { timeout: 30000 });
  const texteResume = await page.locator(`${GRILLE} [data-ouvrir-tableau-de-bord]`).first().textContent();
  noter('l’ancienne entrée « Statistiques » s’appelle « Résumé »', texteResume.includes('Résumé'), texteResume);
  noter('la grille des services porte la nouvelle entrée « Statistiques »', (await page.locator(`${GRILLE} [data-ouvrir-statistiques]`).count()) === 1);
  // Ouverte, la grille retient les clics : on la referme, et on attend qu'elle soit démontée.
  await page.keyboard.press('Escape');
  await page.locator('[data-navigation-panneau]').first().waitFor({ state: 'detached', timeout: 5000 });

  /* -------- 3. La liste et le détail -------- */
  await page.evaluate(() => {
    window.location.hash = 'statistiques';
  });
  await page.waitForSelector(`[data-stats-site="${PROJET}"]`, { timeout: 20000 });
  noter('l’adresse porte l’écran', page.url().endsWith('#statistiques'), page.url());
  noter('le projet se range dans « Projets actifs »', (await page.locator(`[data-stats-groupe="actifs"] [data-stats-site="${PROJET}"]`).count()) === 1);
  noter('la ligne dit « Mesure en place » (visite reçue)', (await page.locator(`[data-stats-site="${PROJET}"] [data-stats-etat="verifie"]`).count()) === 1);
  /* SUR ORDINATEUR, LA RECHERCHE EST UNE LOUPE EN HAUT À DROITE (carte « Refonte de l'espace Médias ») : on l'ouvre. */
  noter('la recherche est une loupe en haut à droite, fermée au départ', (await page.locator('[data-gestes-de-page] [data-recherche-en-icone], [data-recherche-en-icone]').count()) >= 1 && (await page.locator('[data-stats-recherche]').count()) === 0);
  await page.locator('[data-recherche-en-icone]').first().click();
  await page.locator('[data-stats-recherche]').fill('LEA');
  await page.waitForTimeout(150);
  noter(
    'la recherche garde le projet, sans majuscules ni accents, et masque les groupes vides',
    (await page.locator(`[data-stats-site="${PROJET}"]`).count()) === 1 && (await page.locator('[data-stats-groupe="autonomes"]').count()) === 0,
  );
  await page.locator('[data-stats-recherche]').fill('zzz-introuvable');
  await page.waitForSelector('[data-stats-recherche-vide]', { timeout: 5000 }).catch(() => {});
  noter('rien ne correspond : une phrase le dit', (await page.locator('[data-stats-recherche-vide]').count()) === 1 && (await page.locator('[data-stats-site]').count()) === 0);
  await page.screenshot({ path: path.join(os.tmpdir(), 'verif-statistiques-recherche-1440.png') });
  await page.locator('[data-stats-recherche-effacer]').click();
  await page.waitForSelector(`[data-stats-site="${PROJET}"]`, { timeout: 5000 }).catch(() => {});
  noter('la croix vide le champ et rend la liste', (await page.locator('[data-stats-recherche]').inputValue()) === '' && (await page.locator(`[data-stats-site="${PROJET}"]`).count()) === 1);
  await page.locator(`[data-stats-site="${PROJET}"]`).click();
  await page.waitForSelector('[data-marketing-statistiques]', { timeout: 20000 });
  noter('le détail s’ouvre sur l’audience, avec ses visites', Number(await page.locator('[data-marketing-statistiques]').getAttribute('data-marketing-statistiques')) >= 1);
  noter('l’adresse porte le site ouvert', page.url().includes(`#statistiques/${PROJET}`), page.url());
  noter('plus d’onglet « Installation »', (await page.locator('[data-stats-onglet="installation"]').count()) === 0);
  noter('le bouton dit le même état que la liste : « Suivi installé »', (await page.locator('[data-stats-installer="verifie"]').innerText()).includes('Suivi installé'));
  const entetes = await page.evaluate(() => {
    const i = document.querySelector('[data-marketing-interrupteur-suivi]')?.getBoundingClientRect();
    const b = document.querySelector('[data-stats-installer]')?.getBoundingClientRect();
    return i && b ? { aGauche: i.right <= b.left, memeLigne: Math.abs(i.top + i.height / 2 - (b.top + b.height / 2)) < 6 } : null;
  });
  noter('l’interrupteur « Suivi actif » est en haut à droite, juste avant le bouton', !!entetes && entetes.aGauche && entetes.memeLigne, JSON.stringify(entetes));
  // « Plage » ouvre un MENU à deux calendriers : premier clic = début, second = fin.
  await page.locator('[data-periode-libre]').click();
  await page.waitForSelector('[data-periode-menu]', { timeout: 5000 }).catch(() => {});
  noter(
    'la barre de période ouvre un menu à deux calendriers, début à gauche, fin à droite',
    await page.evaluate(() => {
      const d = document.querySelector('[data-periode-calendrier="debut"]')?.getBoundingClientRect();
      const f = document.querySelector('[data-periode-calendrier="fin"]')?.getBoundingClientRect();
      return !!d && !!f && d.right <= f.left + 1 && document.querySelectorAll('[data-periode-champ], input[type="date"]').length === 0;
    }),
  );
  const jours = await page.evaluate(() => {
    const cle = (n) => {
      const d = new Date(Date.now() - n * 86400000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    return { debut: cle(10), fin: cle(3), futur: cle(-1) };
  });
  await page.locator(`[data-periode-jour="${jours.debut}"]`).first().click();
  await page.locator(`[data-periode-jour="${jours.fin}"]`).first().hover();
  noter('le survol surligne les jours entre les deux bornes', (await page.locator('[data-periode-jour][data-dans-plage]').count()) >= 6);
  const futurDesactive = (await page.locator(`[data-periode-jour="${jours.futur}"]`).count()) === 0 || (await page.locator(`[data-periode-jour="${jours.futur}"]`).first().isDisabled());
  noter('un jour futur ne se choisit pas', futurDesactive);
  await page.locator(`[data-periode-jour="${jours.fin}"]`).first().click();
  await page.waitForSelector('[data-periode-menu]', { state: 'detached', timeout: 5000 }).catch(() => {});
  const plage = await page.locator('[data-periode-libre]').innerText();
  noter(
    'le second clic applique la plage, referme le menu, et le bouton la dit',
    (await page.locator('[data-selecteur-periode="libre"]').count()) === 1 && (await page.locator('[data-periode-menu]').count()) === 0 && plage.includes('→'),
    plage,
  );
  await page.locator('[data-periode-libre]').click();
  await page.waitForSelector('[data-periode-menu]', { timeout: 5000 }).catch(() => {});
  noter('rouvert, le menu montre la plage retenue', (await page.locator('[data-periode-jour][data-borne]').count()) === 2 && (await page.locator('[data-periode-jour][data-dans-plage]').count()) === 6);
  await page.screenshot({ path: path.join(os.tmpdir(), 'verif-statistiques-plage-1440.png') });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-periode-menu]', { state: 'detached', timeout: 5000 }).catch(() => {});
  await page.locator('[data-echelle-periode="30"]').click();
  await page.locator('[data-bouton-vue="statistiques"]').click();
  await page.locator('[data-stats-onglet="parcours"]').click();
  // Sans parcours déclaré (29/09/2026) : le « Parcours principal » se déduit des deux repères « objectif ».
  await page.waitForSelector('[data-stats-parcours-ligne="principal"]', { timeout: 10000 });
  const sessionsDuParcours = Number(await page.locator('[data-stats-parcours]').getAttribute('data-stats-parcours'));
  noter('les anciens objectifs donnent le « Parcours principal »', (await page.locator('[data-stats-parcours-ligne="principal"]').innerText()).includes('Parcours principal'));
  await page.screenshot({ path: path.join(os.tmpdir(), 'verif-statistiques-parcours-1440.png'), fullPage: true });
  await page.locator('[data-stats-parcours-ligne="principal"]').click();
  await page.waitForSelector('[data-stats-bloc="entonnoir"]', { timeout: 10000 });
  // Le flux de conversion : l'entrée, puis les deux objectifs.
  noter('les parcours se lisent : une session, un flux de conversion à deux objectifs', sessionsDuParcours >= 1 && (await page.locator('[data-stats-bloc="entonnoir"] [data-stats-marche]').count()) === 3);
  await page.locator('[data-stats-retour-parcours]').click();
  await page.waitForSelector('[data-stats-visiteur]', { timeout: 10000 });
  await page.locator('[data-stats-visiteur]').first().click();
  await page.waitForSelector('[data-stats-frise]', { timeout: 10000 });
  noter('la frise d’un visiteur montre sa session', Number(await page.locator('[data-stats-frise]').getAttribute('data-stats-frise')) >= 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  /* -------- 4. Le mode et un site autonome -------- */
  // Des visites sont arrivées : le suivi est en place, le tiroir s'ouvre sur son RÉSUMÉ.
  await page.locator('[data-stats-installer]').click();
  await page.waitForSelector('[data-stats-assistant]', { timeout: 10000 });
  noter(
    'suivi en place : le tiroir s’ouvre sur le résumé, avec les repères posés et leur raison',
    (await page.locator('[data-stats-assistant="resume"]').count()) === 1 && (await page.locator('[data-stats-repere]').count()) === 2 && (await page.locator('[data-stats-assistant-relancer]').count()) === 1,
  );
  // L'ASSISTANT EST UNE PAGE, plus un tiroir : son titre n'est plus centré au-dessus du pied, il monte
  // de lui-même dans la barre d'en-tête de SA page, en dernier cran du fil d'Ariane (« Services ›
  // Statistiques › Installer le suivi ») — une seule barre, aucun titre répété dans le contenu.
  const entete = await page.evaluate(() => {
    const titres = [...document.querySelectorAll('[data-stats-assistant-titre]')];
    const titre = titres[0];
    const fil = titre?.closest('[data-page-de-zone] [data-entete-de-page] [data-fil-d-ariane]');
    const crans = fil ? fil.textContent.trim() : null;
    return {
      titres: titres.length,
      texte: titre?.textContent?.trim() ?? null,
      crans,
      dernier: !!crans && crans.endsWith('Installer le suivi') && crans.includes('Statistiques'),
    };
  });
  noter(
    'le titre de l’assistant est le dernier cran du fil d’Ariane de sa page, écrit une seule fois',
    entete.titres === 1 && entete.texte === 'Installer le suivi' && entete.dernier,
    JSON.stringify(entete),
  );
  await page.locator('[data-stats-assistant-relancer]').click();
  await page.waitForSelector('[data-stats-assistant="1"]', { timeout: 10000 });
  noter('« Relancer l’assistant » revient au type de suivi', (await page.locator('[data-stats-mode="visiteur"]').innerText()).includes('Suivi complet'));
  await page.locator('[data-stats-mode="anonyme"]').click();
  await page.waitForTimeout(200);
  noter('choisir un type SÉLECTIONNE sans avancer', (await page.locator('[data-stats-assistant="1"]').count()) === 1 && (await page.locator('[data-stats-mode="anonyme"][data-actif]').count()) === 1);
  const pied = await page.evaluate(() => {
    const r = document.querySelector('[data-stats-assistant-retour]')?.getBoundingClientRect();
    const s = document.querySelector('[data-stats-assistant-suivant]')?.getBoundingClientRect();
    const p = document.querySelector('[data-stats-assistant-pied]')?.getBoundingClientRect();
    return r && s && p ? { retour: Math.round(r.width), suivant: Math.round(s.width), pied: Math.round(p.width), aGauche: r.right <= s.left, texteRetour: document.querySelector('[data-stats-assistant-retour]').textContent.trim() } : null;
  });
  noter(
    'le pied porte une petite flèche de retour à gauche et « Suivant » sur le reste de la largeur',
    !!pied && pied.aGauche && pied.retour <= 40 && pied.texteRetour === '' && pied.suivant > pied.pied * 0.75,
    JSON.stringify(pied),
  );
  await page.locator('[data-stats-assistant-suivant]').click();
  await page.waitForSelector('[data-stats-assistant="2"]', { timeout: 10000 }).catch(() => {});
  noter('« Suivant » mène à la méthode', (await page.locator('[data-stats-methode]').count()) === 2);
  await page.locator('[data-stats-methode="manuel"]').click();
  await page.locator('[data-stats-assistant-suivant]').click();
  await page.waitForSelector('[data-stats-assistant="3"]', { timeout: 10000 }).catch(() => {});
  noter('pendant l’assistant, les repères posés ne paraissent pas', (await page.locator('[data-stats-repere]').count()) === 0 && (await page.locator('[data-stats-copiable="extrait"]').count()) === 1);
  let mode = '';
  for (let i = 0; i < 40 && mode !== 'anonyme'; i++) {
    await new Promise((r) => setTimeout(r, 150));
    mode = lire('SELECT mode_suivi FROM marketing_espaces WHERE project_id = ?', PROJET).mode_suivi;
  }
  noter('changer de mode s’enregistre au « Suivant »', mode === 'anonyme', mode);
  await page.waitForFunction(() => document.querySelector('[data-marketing-confidentialite]')?.textContent?.includes('anonyme'), null, { timeout: 10000 }).catch(() => {});
  noter('la phrase de confidentialité suit le mode', (await page.locator('[data-marketing-confidentialite]').innerText()).includes('anonyme'));
  await page.locator('[data-stats-assistant-termine]').click();
  await page.waitForSelector('[data-stats-assistant="resume"]', { timeout: 5000 }).catch(() => {});
  noter('« Terminé » ramène au résumé et à ses repères', (await page.locator('[data-stats-assistant="resume"]').count()) === 1 && (await page.locator('[data-stats-repere]').count()) === 2);

  await page.locator('[data-stats-assistant-relancer]').click();
  await page.locator('[data-stats-assistant-suivant]').click();
  await page.waitForSelector('[data-stats-assistant="2"]', { timeout: 5000 }).catch(() => {});
  await page.locator('[data-stats-methode="auto"]').click();
  await page.locator('[data-stats-assistant-suivant]').click();
  await page.waitForSelector('[data-stats-etapes-auto]', { timeout: 5000 }).catch(() => {});
  noter('l’installation automatique dit ses étapes avant de lancer', (await page.locator('[data-stats-etapes-auto] li').count()) === 4 && (await page.locator('[data-marketing-installer-suivi="installer"]').count()) === 1);
  await page.screenshot({ path: path.join(os.tmpdir(), 'verif-statistiques-assistant-1440.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // « Suivi actif » éteint : le projet passe dans « Projets inactifs », sans recharger.
  await page.locator('[data-marketing-interrupteur-suivi]').click();
  let actif = 1;
  for (let i = 0; i < 40 && actif !== 0; i++) {
    await new Promise((r) => setTimeout(r, 150));
    actif = lire('SELECT actif FROM marketing_espaces WHERE project_id = ?', PROJET).actif;
  }
  noter('l’interrupteur éteint coupe le suivi du projet', actif === 0, String(actif));
  await page.locator('[data-fil-d-ariane] [data-titre-bandeau][data-chemin-de-zone]').click();
  await page.waitForSelector(`[data-stats-groupe="inactifs"] [data-stats-site="${PROJET}"]`, { timeout: 10000 }).catch(() => {});
  noter('le projet passe dans « Projets inactifs »', (await page.locator(`[data-stats-groupe="inactifs"] [data-stats-site="${PROJET}"]`).count()) === 1);
  await page.locator(`[data-stats-site="${PROJET}"]`).click();
  await page.waitForSelector('[data-marketing-suivi-actif="non"]', { timeout: 10000 }).catch(() => {});
  await page.locator('[data-marketing-interrupteur-suivi]').click();
  await page.waitForSelector('[data-marketing-suivi-actif="oui"]', { timeout: 10000 }).catch(() => {});
  noter('rallumé, le suivi repart', lire('SELECT actif FROM marketing_espaces WHERE project_id = ?', PROJET).actif === 1);
  await page.locator('[data-fil-d-ariane] [data-titre-bandeau][data-chemin-de-zone]').click();
  await page.waitForSelector('[data-stats-nouveau-site]', { timeout: 10000 });
  await page.locator('[data-stats-nouveau-site]').click();
  await page.locator('[data-stats-champ="nom"]').fill('Vitrine amie');
  await page.locator('[data-stats-champ="adresse"]').fill('https://amie.exemple');
  await page.locator('[data-stats-creer]').click();
  await page.waitForSelector('[data-stats-copiable="extrait"]', { timeout: 20000 }).catch(() => {});
  const extrait = await page.locator('[data-stats-copiable="extrait"]').innerText().catch(() => '');
  noter('« Nouveau site » crée un site autonome et montre son extrait', extrait.includes('/m/s.js') && /#statistiques\/site/.test(decodeURIComponent(page.url())), `${page.url()} ${extrait}`);
  const autonome = lire("SELECT nom, origines FROM marketing_espaces WHERE project_id LIKE 'site:%'");
  noter('le site autonome déclare son adresse', autonome?.nom === 'Vitrine amie' && autonome.origines.includes('https://amie.exemple'), JSON.stringify(autonome));
  noter('un site autonome n’a ni interrupteur ni installation automatique', (await page.locator('[data-marketing-interrupteur-suivi]').count()) === 0);
  await page.locator('[data-stats-assistant-termine]').click();
  await page.waitForSelector('[data-stats-assistant="resume"]', { timeout: 5000 }).catch(() => {});
  noter(
    'le résumé d’un site autonome montre sa frise et « Tester le suivi »',
    (await page.locator('[data-stats-frise-temps]').count()) === 2 && (await page.locator('[data-stats-tester-bouton]').count()) === 1,
  );
  await page.screenshot({ path: path.join(os.tmpdir(), 'verif-statistiques-autonome-1440.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  /* -------- 5. Sombre, téléphone -------- */
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${BASE}/#statistiques`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-stats-liste]', { timeout: 20000 });
  await page.screenshot({ path: path.join(os.tmpdir(), 'verif-statistiques-liste-sombre.png') });
  noter('la liste sépare projets et sites autonomes', (await page.locator('[data-stats-site]').count()) >= 2);
  const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-CH', hasTouch: true, isMobile: true });
  await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const pageTel = await tel.newPage();
  await pageTel.goto(`${BASE}/#statistiques/${PROJET}`, { waitUntil: 'domcontentloaded' });
  // LE LIEN DIRECT « #statistiques/<projet> », collé dans un onglet neuf, doit ouvrir l'écran du site. Ce
  // point était implicite (le contrôle s'arrêtait net s'il n'était pas tenu) : il est jugé en clair, et le
  // reste du passage téléphone se joue quand même — on redemande alors l'écran par l'adresse, comme au point 3.
  await pageTel.waitForSelector('[data-entete-de-zone]', { timeout: 30000 });
  const lienTenu = await pageTel
    .waitForSelector('[data-bouton-vue="statistiques"]', { timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  const adresseTel = await pageTel.evaluate(() => window.location.hash);
  noter(
    'à 390 px, le lien direct « #statistiques/<projet> » collé dans un onglet neuf ouvre l’écran du site',
    lienTenu && adresseTel === `#statistiques/${PROJET}`,
    `adresse après chargement : ${adresseTel}`,
  );
  if (!lienTenu) {
    await pageTel.screenshot({ path: path.join(os.tmpdir(), 'verif-statistiques-lien-perdu-390.png') });
    await pageTel.evaluate((p) => {
      window.location.hash = `statistiques/${p}`;
    }, PROJET);
  }
  await pageTel.waitForSelector('[data-bouton-vue="statistiques"]', { timeout: 30000 });
  await pageTel.waitForTimeout(300);
  /* LE BAS DE L'ÉCRAN, ÉCRAN PAR ÉCRAN (03/11/2026, `menuDuBas`) : les statistiques n'en ont pas. */
  noter('à 390 px, les statistiques n’ont aucun menu en bas', (await pageTel.locator('nav[data-menu-bas]:visible').count()) === 0);
  const deborde = await pageTel.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  noter('à 390 px, rien ne déborde sur le côté', !deborde);
  /* L'INSTALLATION N'OUVRE PLUS DE RANGÉE SOUS LA BARRE : c'est le bouton du bas
     de l'écran tant que le suivi n'est pas posé, sinon une ligne du menu à
     trois points de la barre. */
  /* « Installer le suivi », geste principal tant que le suivi n'est pas posé : une icône dans le haut du téléphone. */
  const enBas = await pageTel.locator('main [data-entete-de-zone] [data-stats-installer]:visible').count();
  let dansLeMenu = 0;
  if (!enBas) {
    await pageTel.locator('main [data-entete-de-zone] [data-options-de-page="menu"]').click();
    await pageTel.waitForSelector('[role="menu"][data-state="open"]', { timeout: 8000 });
    dansLeMenu = await pageTel.locator('[role="menu"] [data-stats-installer]').count();
    for (let essai = 0; essai < 3 && (await pageTel.locator('[role="menu"][data-state="open"]').count()); essai += 1) {
      await pageTel.keyboard.press('Escape');
      await pageTel.waitForTimeout(350);
    }
  }
  noter(
    'à 390 px, l’installation est le bouton du bas ou une ligne des trois points, sans rangée sous la barre',
    enBas + dansLeMenu === 1 && (await pageTel.locator('[data-gestes-de-page="page"]:visible').count()) === 0,
    JSON.stringify({ enBas, dansLeMenu }),
  );
  await pageTel.screenshot({ path: path.join(os.tmpdir(), 'verif-statistiques-390.png') });
  /* SUR TÉLÉPHONE, LA PÉRIODE EST UNE LIGNE DES TROIS POINTS DU HAUT (03/11/2026) : elle ouvre la feuille commune —
     les durées, puis un calendrier de plage d'UN mois, à la taille du doigt. */
  await pageTel.locator('[data-trois-points-du-haut]').click();
  await pageTel.locator('[role="menu"] [data-periode-ligne]').click();
  await pageTel.waitForSelector('[data-feuille-du-bas] [data-periode-calendrier="plage"]', { timeout: 5000 }).catch(() => {});
  await pageTel.waitForTimeout(400);
  const menuTel = await pageTel.evaluate(() => {
    const feuille = document.querySelector('[data-periode-calendrier="plage"]')?.closest('[data-feuille-du-bas]');
    const m = feuille?.getBoundingClientRect();
    const jour = document.querySelector('[data-periode-calendrier="plage"] [data-periode-jour]')?.getBoundingClientRect();
    return m
      ? { gauche: Math.round(m.left), droite: Math.round(m.right), bas: Math.round(m.bottom), calendriers: document.querySelectorAll('[data-periode-calendrier]').length, echelles: feuille.querySelectorAll('[data-echelle-periode]').length, jour: jour ? Math.round(jour.height) : 0, deborde: document.documentElement.scrollWidth > window.innerWidth + 1 }
      : null;
  });
  noter('à 390 px, la période ouvre la feuille du bas : les durées, puis un seul mois aux cases de 44 px', !!menuTel && menuTel.gauche >= 0 && menuTel.droite <= 390 && menuTel.bas >= 840 && menuTel.calendriers === 1 && menuTel.echelles >= 3 && menuTel.jour >= 40 && !menuTel.deborde, JSON.stringify(menuTel));
  await pageTel.screenshot({ path: path.join(os.tmpdir(), 'verif-statistiques-plage-390.png') });
  await pageTel.keyboard.press('Escape');
  await pageTel.waitForTimeout(200);
  await pageTel.locator('[data-stats-installer]').click();
  await pageTel.waitForSelector('[data-stats-assistant]', { timeout: 10000 });
  await pageTel.waitForTimeout(400);
  await pageTel.screenshot({ path: path.join(os.tmpdir(), 'verif-statistiques-assistant-390.png') });
  await pageTel.keyboard.press('Escape');
  // L'assistant est une PAGE qui porte son adresse (« …/volet/suivi-statistiques ») : la refermer recule
  // d'un cran dans l'historique. On attend ce retour avant de demander un autre écran, sans quoi les
  // deux déplacements se croisent.
  await pageTel.waitForSelector('[data-stats-assistant]', { state: 'detached', timeout: 10000 });
  await pageTel.waitForFunction(() => !window.location.hash.includes('/volet/'), null, { timeout: 10000 });
  await pageTel.goto(`${BASE}/#statistiques`, { waitUntil: 'domcontentloaded' });
  await pageTel.waitForSelector('[data-stats-liste]', { timeout: 20000 });
  await pageTel.screenshot({ path: path.join(os.tmpdir(), 'verif-statistiques-liste-390.png') });
  await tel.close();
} finally {
  await navigateur?.close();
  site.close();
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
process.exit(echecs ? 1 : 0);
