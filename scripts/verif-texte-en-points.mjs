#!/usr/bin/env node
/**
 * LA COMPRÉHENSION ET LE COMPTE RENDU SE LISENT EN POINTS — dans un vrai navigateur.
 *
 *   node scripts/verif-texte-en-points.mjs      (port : BELUGA_POINTS_PORT, 7223 par défaut)
 *
 * Demande de l'utilisateur (carte « Retouches de la charte graphique », 06/11/2026) : avant de lancer, un titre
 * par point compris et sa synthèse dessous ; à la fin, le rapport rangé de même ; le SOMMAIRE au-dessus, qui mène
 * à chaque point ; tout aligné à gauche, titre en gras, texte normal ; RIEN au-dessus des points.
 *
 * Démon d'essai à soi, base neuve, plafond d'agents à zéro : aucun moteur appelé. Ce qui est prouvé, à 1440 px
 * puis 390 px, en clair puis en sombre :
 *   1. la compréhension porte un sommaire de trois lignes, posé EN TÊTE (rien au-dessus) ;
 *   2. ses trois titres sont en gras et alignés sur le bord gauche de leur texte, sans cadre ni icône ;
 *   3. le compte rendu porte de même son sommaire et ses points ;
 *   4. un clic sur une ligne du sommaire amène son point à l'écran ;
 *   5. rien ne déborde en largeur, aucune erreur de page.
 * Captures : /tmp/verif-texte-en-points-<largeur>-<thème>.png
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_POINTS_PORT || 7223);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-texte-en-points-', port: PORT, messageCommit: 'points' });

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const CARTE_ID = 'c-essai-points';
const AGENT_ID = 'a-essai-points';
const TITRE = 'Carte d’essai — texte en points';

const COMPRIS = [
  '### Fond des boutons du haut',
  'Les deux groupes du haut prendront le même fond gris, coupés en deux comme une pilule.',
  '',
  '### Formats en icônes',
  'Les trois formats deviennent des icônes ; leur nom s’affiche au survol.',
  '',
  '### Aperçu toujours foncé',
  'La zone sous l’en-tête reste foncée, même quand l’application est en clair.',
].join('\n');

const RAPPORT = [
  '### Fond des boutons du haut',
  'Les deux groupes ont maintenant un fond gris commun.',
  '',
  '### Formats en icônes',
  'Les formats sont des icônes, leur nom paraît au survol.',
  '',
  '### Aperçu toujours foncé',
  'L’aperçu reste foncé dans tous les thèmes.',
  '',
  '### Vérifications',
  'Travail enregistré et sauvegardé, pas publié. Tous les contrôles passent.',
].join('\n');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), maintenant, maintenant + 3600_000, 'vérification texte en points');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = { id: PROJET_ID, name: 'Essai texte en points', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: maintenant, updatedAt: maintenant };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    agentId: AGENT_ID,
    title: TITRE,
    description: 'Carte du contrôle.',
    labels: [],
    column: 'to_deploy',
    position: 1,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none' },
    scheduling: { asap: false, attempts: 0, restarts: 0 },
    parcours: {
      comprehension: { texte: COMPRIS, hypotheses: [], sujets: [], resumeDemande: 'Vous demandez trois retouches.', resumeComprehension: 'Trois retouches de la charte.', at: maintenant - 20 },
    },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(CARTE_ID, PROJET_ID, 'to_deploy', 1, TITRE, JSON.stringify(carte), maintenant, maintenant);

  const agent = { id: AGENT_ID, projectId: PROJET_ID, cardId: CARTE_ID, role: 'task', title: TITRE, run: { engine: 'claude', thinking: 'none' }, status: 'idle', createdAt: maintenant, updatedAt: maintenant };
  db.prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(AGENT_ID, PROJET_ID, CARTE_ID, 'task', 'idle', JSON.stringify(agent), maintenant, maintenant);

  const message = (id, role, content, at) => {
    const m = { id, agentId: AGENT_ID, role, content, steps: [], todos: [], proposals: [], questions: [], downloads: [], attachments: [], createdAt: at };
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(id, AGENT_ID, role, JSON.stringify(m), at);
  };
  message('m-demande', 'user', 'Fais les trois retouches.', maintenant - 30);

  db.prepare(
    `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, resultat, reussie, donnees)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('j-comprehension-1', CARTE_ID, 0, 'cadrage', 'jalon', maintenant - 20, AGENT_ID, 'cadrage', 'tour-0', 'Compréhension', COMPRIS, 1, JSON.stringify({}));
  /* LE COMPTE RENDU : la réponse rendue d'un tour, telle que le fil la range. */
  db.prepare(
    `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, resultat, reussie, donnees)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('j-reponse-1', CARTE_ID, 1, 'rapport', 'jalon', maintenant, AGENT_ID, 'task', 'tour-1', 'Réponse rendue', RAPPORT, 1, JSON.stringify({ suites: SUITES }));
  db.close();
}

/* LES SUITES DU COMPTE RENDU : à la suite du texte, avant les images, sous un titre et sur leur fond (capture #410a). */
const SUITES = [
  { titre: 'Mettre aussi le plan en points', description: 'Le plan prendrait la même mise en page.' },
  { titre: 'Résumer chaque point en une ligne', description: 'Le résumé court reprendrait les titres des points.' },
];

/** Les suites : titrées, sur un fond à elles, posées juste après le texte du compte rendu. */
async function mesurerLesSuites(page) {
  return page.locator('[data-moment="rapport"] [data-suites-proposees]').first().evaluate((bloc) => {
    const fond = getComputedStyle(bloc).backgroundColor;
    let parent = bloc.parentElement;
    while (parent && ['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(parent).backgroundColor)) parent = parent.parentElement;
    const avant = bloc.previousElementSibling;
    return {
      titre: bloc.querySelector('[data-suites-titre]')?.textContent ?? '',
      fond,
      fondDistinct: !['rgba(0, 0, 0, 0)', 'transparent'].includes(fond) && (!parent || getComputedStyle(parent).backgroundColor !== fond),
      apresLeTexte: !!avant && !!avant.querySelector('[data-titre-du-point]'),
    };
  });
}

/** Les mesures d'un texte en points : sommaire en tête, titres gras alignés sur leur texte. */
async function mesurer(zone) {
  return zone.evaluate((racine) => {
    const prose = racine.querySelector('.prose-hd');
    const nav = racine.querySelector('[data-sommaire-en-points]');
    const titres = [...racine.querySelectorAll('[data-titre-du-point]')];
    const premier = prose?.firstElementChild;
    const texte = titres[0]?.nextElementSibling;
    return {
      lignes: nav ? nav.querySelectorAll('[data-ligne-du-sommaire]').length : 0,
      enTete: !!nav && premier === nav,
      titres: titres.length,
      gras: titres.every((h) => Number(getComputedStyle(h).fontWeight) >= 600),
      aligne: titres.length > 0 && !!texte && Math.abs(titres[0].getBoundingClientRect().left - texte.getBoundingClientRect().left) <= 1,
      sansCadre: !racine.querySelector('.prose-hd section'),
      sansIcone: titres.every((h) => !h.querySelector('svg')),
    };
  });
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  await new Promise((r) => setTimeout(r, 1500));

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (const [largeur, theme] of [[1440, 'clair'], [390, 'clair'], [1440, 'sombre'], [390, 'sombre']]) {
    const nom = `${largeur} px ${theme}`;
    const contexte = await navigateur.newContext({ viewport: { width: largeur, height: largeur < 600 ? 844 : 900 }, locale: 'fr-CH', serviceWorkers: 'block', colorScheme: theme === 'clair' ? 'light' : 'dark' });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));
    await page.goto(`${BASE}/#projet/${PROJET_ID}/tache/${CARTE_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' }).catch(() => undefined);
    await page.waitForSelector('[data-moment="comprehension"]', { timeout: 30000 }).catch(() => undefined);
    /* LE THÈME : le démon d'essai impose le sien ; on pose celui de la passe, comme le contrôle de la charte. */
    await page.evaluate((sombre) => {
      const r = document.documentElement;
      r.dataset.theme = sombre ? 'sombre' : 'clair';
      r.classList.toggle('dark', sombre);
      r.style.colorScheme = sombre ? 'dark' : 'light';
    }, theme === 'sombre');
    await page.waitForTimeout(1500);

    const comprehension = page.locator('[data-moment="comprehension"]').first();
    const m = (await comprehension.count()) ? await mesurer(comprehension) : null;
    noter(`${nom} : la compréhension porte un sommaire de trois lignes, posé en tête`, !!m && m.lignes === 3 && m.enTete, JSON.stringify(m));
    noter(`${nom} : ses trois titres sont en gras, alignés sur leur texte, sans cadre ni icône`, !!m && m.titres === 3 && m.gras && m.aligne && m.sansCadre && m.sansIcone);

    const rapport = page.locator('[data-sommaire-en-points="4"]').first();
    const zoneRapport = rapport.locator('xpath=ancestor::div[contains(@class,"prose-hd")][1]/..');
    const r = (await rapport.count()) ? await mesurer(zoneRapport) : null;
    noter(`${nom} : le compte rendu porte son sommaire en tête et ses quatre points`, !!r && r.lignes === 4 && r.enTete && r.titres === 4 && r.gras && r.aligne && r.sansCadre, JSON.stringify(r));

    if (await rapport.count()) {
      await rapport.locator('[data-ligne-du-sommaire="4"]').click();
      await page.waitForTimeout(900);
      const visible = await zoneRapport.locator('[data-titre-du-point]').nth(3).evaluate((h) => {
        const b = h.getBoundingClientRect();
        return b.top >= 0 && b.bottom <= innerHeight;
      });
      noter(`${nom} : une ligne du sommaire amène son point à l’écran`, visible);
      await rapport.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `/tmp/verif-texte-en-points-${largeur}-${theme}-rapport.png` });
    }

    const suites = await mesurerLesSuites(page).catch(() => null);
    noter(`${nom} : les suites ont leur titre et leur propre fond, juste après le texte`, !!suites && suites.titre === 'Suites possibles' && suites.fondDistinct && suites.apresLeTexte, JSON.stringify(suites));
    if (suites) {
      await page.locator('[data-moment="rapport"] [data-suites-proposees]').first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `/tmp/verif-texte-en-points-${largeur}-${theme}-suites.png` });
    }

    const deborde = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    noter(`${nom} : rien ne déborde en largeur`, !deborde);
    await comprehension.scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `/tmp/verif-texte-en-points-${largeur}-${theme}.png` });
    noter(`${nom} : aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    await contexte.close();
  }
  await navigateur.close();
  const echecs = resultats.filter((x) => !x.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  console.error(journal.join(''));
  process.exit(1);
});
