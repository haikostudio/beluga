#!/usr/bin/env node
/**
 * LES PROJETS SANS TABLEAU : LA LISTE DES AGENTS À GAUCHE (demande du
 * 30/10/2026, `web/src/components/liste-des-agents.tsx`,
 * `shared/src/etat-d-agent-en-liste.ts`).
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-liste-des-agents.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve : le
 * démon de production n'est pas touché et aucun moteur réel n'est lancé.
 *
 * Ce qui est vérifié :
 *   1. plus aucun tableau à colonnes ;
 *   2. « Tableaux de bord » : une SEULE liste, les actives d'abord puis un trait
 *      « Archivé » (centré) et les rangées, chaque groupe par date (01/11/2026), chaque ligne
 *      avec sa branche, son icône et son badge coloré en quatre familles ;
 *   3. le défilement infini va au bout, dans l'ordre, sans doublon ;
 *   4. la recherche et le filtre, d'un seul bloc ; un agent arrêté sur sa question
 *      reste « À vous » malgré son tour vivant ; un rendu non lu n'a que le gras ;
 *   5. le clic droit ouvre le menu de l'agent, « Renommer » renomme ;
 *   6. la colonne de gauche est la même partout : bouton groupé violet « Tableaux
 *      de bord » + services, « Nouvel agent », projets dépliables sur leurs tâches
 *      en un flux par date, « Voir plus » cinq par cinq ; la barre du haut n'a plus ni
 *      services ni liste de projets ; cliquer un projet rouvre son dernier agent ;
 *      un projet sans agent montre l'accueil « Lancer un agent » ;
 *   7. l'écran d'un agent : les trois points portent « Cet agent » et « Ce projet » ;
 *   8. l'application démarre sous la barre d'état : pas de `viewport-fit=cover`,
 *      `theme-color` et manifeste du fond de la zone ;
 *   9. téléphone : la liste en plein écran, l'appui long ouvre le menu du bas, un
 *      toucher ouvre l'agent, l'icône du projet ramène à la liste ; un seul bouton
 *      ouvre le menu, jusqu'en haut de la vue, avec la même colonne.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7231);
const BASE = `http://127.0.0.1:${PORT}`;
const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-liste-des-agents-', port: PORT });
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const MAINTENANT = Date.now();
const H = 3600_000;

function projet(db, id, name, rank) {
  const p = { id, name, path: `${DEPOT}-${id}`, defaultEngine: 'claude', isSelf: false, rank, archived: false, createdAt: MAINTENANT, updatedAt: MAINTENANT };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
    id, name, p.path, JSON.stringify(p), MAINTENANT, MAINTENANT,
  );
}

function carte(db, id, projectId, column, title, derniereAction, extra = {}) {
  const c = {
    id, projectId, title, description: '', labels: [], column, position: derniereAction,
    origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    excludedFromDeploy: false, horsTache: false, codeDejaEnregistre: false, createdAt: derniereAction - H, updatedAt: derniereAction,
    ...extra,
  };
  db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, projectId, column, derniereAction, title, JSON.stringify(c), c.deployedAt ?? null, c.createdAt, derniereAction,
  );
}

function agent(db, id, projectId, cardId, role, status, extra = {}) {
  const a = { id, projectId, cardId, role, title: 'Agent', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status, startedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(), ...extra };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`,
  ).run(id, projectId, cardId, role, status, JSON.stringify(a), a.createdAt, a.updatedAt);
}

/* Les états attendus, carte par carte — l'ordre de la liste est celui des dates. */
const ATTENDUS = {
  'c-travail': 'travail',
  'c-question': 'a-vous',
  'c-rendue': 'a-deployer',
  'c-lue': 'a-deployer',
  'c-programmee': 'lance',
  'c-brouillon': 'brouillon',
};

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), MAINTENANT, MAINTENANT + H, 'vérification liste des agents');
  db.prepare('DELETE FROM projects').run();
  projet(db, 'p-alpha', 'Alpha', 1);
  projet(db, 'p-beta', 'Beta', 2);
  projet(db, 'p-vide', 'Vide', 3);
  carte(db, 'c-travail', 'p-alpha', 'running', 'Agent au travail', MAINTENANT - 1 * H);
  carte(db, 'c-question', 'p-alpha', 'running', 'Agent qui pose une question', MAINTENANT - 2 * H);
  carte(db, 'c-rendue', 'p-alpha', 'to_deploy', 'Rapport pas encore lu', MAINTENANT - 3 * H, { renduA: MAINTENANT - 3 * H });
  carte(db, 'c-lue', 'p-alpha', 'to_deploy', 'Rapport déjà lu', MAINTENANT - 4 * H, { renduA: MAINTENANT - 5 * H, lastReadAt: MAINTENANT - 4 * H });
  carte(db, 'c-programmee', 'p-alpha', 'planned', 'Départ programmé demain', MAINTENANT - 5 * H, {
    scheduling: { asap: false, attempts: 0, restarts: 0, departPrevu: MAINTENANT + 20 * H },
  });
  carte(db, 'c-brouillon', 'p-alpha', 'planned', 'Une idée à discuter', MAINTENANT - 6 * H, { brancheChoisie: 'tache/branche-speciale-abc123' });
  carte(db, 'c-en-ligne', 'p-alpha', 'archived', 'Publiée hier', MAINTENANT - 7 * H, { deployedAt: MAINTENANT - 7 * H, archivedAt: MAINTENANT - 7 * H });
  carte(db, 'c-archivee', 'p-alpha', 'archived', 'Rangée à la main', MAINTENANT - 8 * H, { archivedAt: MAINTENANT - 8 * H });
  carte(db, 'c-beta', 'p-beta', 'planned', 'Demande du projet Beta', MAINTENANT - 0.5 * H);
  /* Une archive modifiée récemment passe AU-DESSUS d'une tâche ouverte plus ancienne. */
  carte(db, 'c-archive-recente', 'p-alpha', 'archived', 'Archive retouchée', MAINTENANT - 2.5 * H, { archivedAt: MAINTENANT - 2.5 * H });
  /* De quoi faire défiler la liste et déplier les archives dix par dix. */
  projet(db, 'p-long', 'Long', 4);
  for (let i = 0; i < 55; i += 1) {
    carte(db, `c-long-${String(i).padStart(2, '0')}`, 'p-long', 'archived', `Ancienne ${i}`, MAINTENANT - (100 + i) * H, { archivedAt: MAINTENANT - (100 + i) * H });
  }
  agent(db, 'ag-travail', 'p-alpha', 'c-travail', 'task', 'running', { tourVivantDepuis: MAINTENANT - 60_000 });
  /* TOUT AGENT ACTIF SE VOIT (31/10/2026) : le directeur du Studio, une carte d'atelier, une carte rangée, très anciens. */
  projet(db, 'p-gamma', 'Gamma', 5);
  carte(db, 'c-gamma-studio', 'p-gamma', 'planned', 'Studio du gamma', MAINTENANT - 300 * H, { labels: ['studio'], parcours: { realisationSouhaitee: true } });
  carte(db, 'c-gamma-atelier', 'p-gamma', 'planned', 'Atelier au travail', MAINTENANT - 301 * H, { labels: ['marketing'] });
  carte(db, 'c-gamma-atelier-repos', 'p-gamma', 'planned', 'Atelier au repos', MAINTENANT - 302 * H, { labels: ['marketing'] });
  carte(db, 'c-gamma-rangee', 'p-gamma', 'archived', 'Rangée au travail', MAINTENANT - 303 * H, { archivedAt: MAINTENANT - 303 * H });
  for (const [cardId, label] of [['c-gamma-studio', 'studio'], ['c-gamma-atelier', 'marketing'], ['c-gamma-atelier-repos', 'marketing']]) {
    db.prepare('INSERT INTO card_labels (card_id, position, label) VALUES (?, 0, ?)').run(cardId, label);
  }
  agent(db, 'ag-gamma-studio', 'p-gamma', 'c-gamma-studio', 'cadrage', 'running', { tourVivantDepuis: MAINTENANT - 60_000 });
  agent(db, 'ag-gamma-atelier', 'p-gamma', 'c-gamma-atelier', 'task', 'running', { tourVivantDepuis: MAINTENANT - 60_000 });
  agent(db, 'ag-gamma-rangee', 'p-gamma', 'c-gamma-rangee', 'task', 'running', { tourVivantDepuis: MAINTENANT - 60_000 });
  projet(db, 'p-delta', 'Delta', 6);
  carte(db, 'c-delta', 'p-delta', 'running', 'Delta au travail', MAINTENANT - 310 * H);
  agent(db, 'ag-delta', 'p-delta', 'c-delta', 'task', 'running', { tourVivantDepuis: MAINTENANT - 60_000 });
  /* Un paquet : une carte mère et sa fille, pour ses couleurs. */
  carte(db, 'c-paquet-fille', 'p-gamma', 'planned', 'Fille du paquet', MAINTENANT - 0.2 * H, { carteMereId: 'c-paquet-mere' });
  carte(db, 'c-paquet-mere', 'p-gamma', 'planned', 'Mère du paquet', MAINTENANT - 0.1 * H, { cartesFilles: [{ projectId: 'p-gamma', cardId: 'c-paquet-fille' }] });
  /* LE CAS RÉEL (DEC-026) : arrêté sur `ask_user`, l'agent garde son tour vivant. */
  agent(db, 'ag-question', 'p-alpha', 'c-question', 'task', 'running', { attendReponse: true, tourVivantDepuis: MAINTENANT - 60_000 });
  db.close();
}

const titreEnBase = (id) => {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const ligne = db.prepare('SELECT title FROM cards WHERE id = ?').get(id);
  db.close();
  return ligne?.title ?? null;
};

/* Les cartes du contrôle « 6 quater » ne comptent pas dans l'ordre jugé par les sections 2 et 3. */
const horsDuDecorDesActifs = (id) => !id.startsWith('c-gamma') && !id.startsWith('c-paquet') && id !== 'c-delta';
const LIGNES = '[data-liste-des-agents] [data-agent-en-liste]';
const idsAffiches2 = (page, portee) =>
  page.locator(`${portee}[data-agent-en-liste]:visible`).evaluateAll((els) => els.map((el) => el.getAttribute('data-agent-en-liste')));
const idsAffiches = (page, portee = '') =>
  page.locator(`${portee}${LIGNES}:visible`).evaluateAll((els) => els.map((el) => el.getAttribute('data-agent-en-liste')));

async function principal() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    /* ------------------------------ ORDINATEUR ------------------------------ */
    const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    await page.goto(`${BASE}/#en-route`);
    await page.locator('[data-liste-des-agents="tous"] [data-agent-en-liste]').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(800);

    noter('1. plus aucun tableau à colonnes', (await page.locator('[data-column], [data-tableau]').count()) === 0);
    const colonne = '[data-page-en-route] ';
    /* LES ACTIVES AU-DESSUS DU TRAIT (01/11/2026) : chaque groupe par date, l'archive retouchée ouvre les rangées. */
    const ORDRE = ['c-beta', 'c-travail', 'c-question', 'c-rendue', 'c-lue', 'c-programmee', 'c-brouillon', 'c-archive-recente', 'c-en-ligne', 'c-archivee'];
    const ids = (await idsAffiches(page, colonne)).filter((id) => !id.startsWith('c-long') && horsDuDecorDesActifs(id));
    noter(
      '2. les actives d’abord, puis les rangées, chaque groupe par date',
      JSON.stringify(ids) === JSON.stringify(ORDRE),
      ids.join(', '),
    );
    const trait = await page.evaluate(() => {
      const zone = document.querySelector('[data-page-en-route]');
      const separations = zone ? [...zone.querySelectorAll('[data-separation-actives]')] : [];
      const haut = separations[0]?.getBoundingClientRect().top ?? 0;
      const position = (id) => zone?.querySelector(`[data-agent-en-liste="${id}"]`)?.getBoundingClientRect().top ?? -1;
      return {
        nombre: separations.length,
        genre: separations[0]?.getAttribute('data-separation-actives'),
        texte: separations[0]?.textContent?.trim() ?? '',
        centre: (() => {
          const bloc = separations[0]?.getBoundingClientRect();
          const mot = separations[0]?.querySelector('[data-etiquette-archive]')?.getBoundingClientRect();
          return !!bloc && !!mot && Math.abs(mot.left + mot.width / 2 - (bloc.left + bloc.width / 2)) <= 3;
        })(),
        dessus: position('c-brouillon') < haut,
        dessous: position('c-archive-recente') > haut,
      };
    });
    noter(
      '2. un seul trait, « Archivé » au centre, sépare les actives des rangées',
      trait.nombre === 1 && trait.genre === 'libelle' && /archivé/i.test(trait.texte) && trait.centre && trait.dessus && trait.dessous,
      JSON.stringify(trait),
    );
    const familles = await page.locator(`${colonne}${LIGNES}`).evaluateAll((els) =>
      Object.fromEntries(els.map((el) => [el.getAttribute('data-agent-en-liste'), el.querySelector('[data-etat-badge]')?.getAttribute('data-badge-etape')])),
    );
    /* Les deux clartés, pour l'œil : le trait, les quatre couleurs de badge et les ronds de la colonne. */
    for (const sombre of [true, false]) {
      await page.evaluate((sombre) => document.documentElement.classList.toggle('dark', sombre), sombre);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${RACINE}/data/verification/liste-des-agents-actives-${sombre ? 'sombre' : 'clair'}.png` });
    }
    noter(
      '2. les badges en quatre familles : violet, jaune, vert, gris',
      familles['c-programmee'] === 'travail' &&
        familles['c-brouillon'] === 'comprehension' &&
        familles['c-question'] === 'comprehension' &&
        familles['c-rendue'] === 'pret' &&
        familles['c-archivee'] === 'neutre',
      JSON.stringify(familles),
    );
    noter('2. aucun titre ni bloc d’archives', (await page.locator('[data-titre-archives], [data-liste-archives]').count()) === 0);
    const etats = await page.locator(`${colonne}${LIGNES}`).evaluateAll((els) =>
      Object.fromEntries(els.map((el) => [el.getAttribute('data-agent-en-liste'), el.getAttribute('data-etat-agent')])),
    );
    const faux = Object.entries(ATTENDUS).filter(([id, etat]) => etats[id] !== etat);
    noter('2. chaque ligne porte le bon état', !faux.length, JSON.stringify(etats));
    const ligneBrouillon = page.locator(`${colonne}[data-agent-en-liste="c-brouillon"]`);
    noter(
      '2. une ligne montre sa branche, son icône et son badge',
      (await ligneBrouillon.locator('[data-branche-agent]').textContent())?.includes('branche-speciale-abc123') &&
        (await ligneBrouillon.locator('svg').count()) >= 1 &&
        (await ligneBrouillon.locator('[data-etat-badge="brouillon"][data-badge-etape="comprehension"]').count()) === 1,
    );
    /* Le signe qui tourne d'un agent au travail est violet (31/10/2026) ; toutes les autres restent monochromes. */
    const couleurDesIcones = (selecteur) =>
      page.locator(selecteur).evaluateAll((els) =>
        els.map((el) => {
          const [r, g, b] = (getComputedStyle(el).color.match(/\d+/g) ?? []).map(Number);
          return { ecart: Math.max(r, g, b) - Math.min(r, g, b), violet: b > g + 24 && r > g };
        }),
      );
    const iconesEnCouleur = (await couleurDesIcones(`${colonne}${LIGNES}:not([data-etat-agent="travail"]) button > svg`)).filter((c) => c.ecart > 24).length;
    noter('2. les icônes d’état sont monochromes, hors travail', iconesEnCouleur === 0, `${iconesEnCouleur} en couleur`);
    const iconesAuTravail = await page.locator(`${colonne}[data-agent-en-liste][data-etat-agent="travail"] :is(a, button) svg.animate-spin`).evaluateAll((els) =>
      els.map((el) => {
        const [r, g, b] = (getComputedStyle(el).color.match(/\d+/g) ?? []).map(Number);
        return b > g + 24 && r > g;
      }),
    );
    noter('2. le signe qui tourne d’un agent au travail est violet', iconesAuTravail.length >= 1 && iconesAuTravail.every(Boolean), JSON.stringify(iconesAuTravail));

    /* 3. Le défilement infini : jusqu'au bout, dans l'ordre, sans doublon. */
    const zone = page.locator(`${colonne}[data-zone-liste-agents]`);
    for (let i = 0; i < 40 && (await page.locator(`${colonne}[data-suite-de-la-liste]`).count()); i += 1) {
      await zone.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
      await page.waitForTimeout(200);
    }
    const toutes = (await idsAffiches(page, colonne)).filter(horsDuDecorDesActifs);
    noter('3. le défilement infini va au bout, sans doublon', toutes.length === ORDRE.length + 55 && new Set(toutes).size === toutes.length, `${toutes.length} lignes`);
    noter('3. l’ordre tient jusqu’à la dernière ligne', toutes[toutes.length - 1] === 'c-long-54' && toutes[ORDRE.length] === 'c-long-00');
    /* Le voile du haut existe, éteint au repos, allumé après défilement (capture #af45). */
    const etatDuVoileDuHaut = () => zone.evaluate((el) => el.parentElement?.querySelector('[data-voile-defilement$="debut"]')?.getAttribute('data-voile-allume') ?? 'absent');
    await zone.evaluate((el) => el.scrollTo({ top: 0 }));
    await page.waitForTimeout(300);
    const auRepos = await etatDuVoileDuHaut();
    await zone.evaluate((el) => el.scrollTo({ top: 200 }));
    await page.waitForTimeout(300);
    const apresDefilement = await etatDuVoileDuHaut();
    noter('3. voile flou du haut éteint au repos, allumé au défilement', auRepos === 'non' && apresDefilement === 'oui', `repos=${auRepos} défilé=${apresDefilement}`);
    /* Sa couleur : le fond opaque du premier ancêtre, un cran plus foncé (× 0,94), en clair ET en sombre. */
    for (const clarte of ['clair', 'sombre']) {
      const ecart = await zone.evaluate((el, sombre) => {
        document.documentElement.classList.toggle('dark', sombre);
        const lire = (t) => {
          const s = /color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)/.exec(t);
          if (s) return { c: [+s[1], +s[2], +s[3]], a: s[4] === undefined ? 1 : +s[4] };
          const r = /rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)(?:,? \/? ?([\d.]+))?\)/.exec(t);
          return r ? { c: [r[1] / 255, r[2] / 255, r[3] / 255], a: r[4] === undefined ? 1 : +r[4] } : null;
        };
        const v = el.parentElement.querySelector('[data-voile-defilement$="debut"]');
        const ombre = lire(getComputedStyle(v.children[v.children.length - 1]).backgroundColor);
        let fond = null;
        for (let n = v.parentElement; n && n !== document.documentElement; n = n.parentElement) {
          const lu = lire(getComputedStyle(n).backgroundColor);
          if (lu && lu.a > 0.98) { fond = lu.c; break; }
        }
        document.documentElement.classList.remove('dark');
        if (!ombre || !fond) return 9;
        return Math.max(...fond.map((c, i) => Math.abs(c * 0.94 - ombre.c[i])));
      }, clarte === 'sombre');
      noter(`3. voile du haut de la couleur de la liste, un cran plus foncé (${clarte})`, ecart <= 0.02, `écart ${ecart.toFixed(3)}`);
    }
    await zone.evaluate((el) => el.scrollTo({ top: 0 }));

    /* 4. La recherche et son filtre, d'un seul bloc (capture #a4f2). */
    const bloc = await page.locator(`${colonne}[data-recherche-agents]`).evaluate((el) => {
      const champ = el.querySelector('[data-recherche-agents-champ]').getBoundingClientRect();
      const filtre = el.querySelector('[data-filtre-agents]').getBoundingClientRect();
      return { ecart: filtre.left - champ.right, champ: champ.height, filtre: filtre.height, memeHaut: champ.height === filtre.height, rayonDroit: parseFloat(getComputedStyle(el).borderTopRightRadius), fond: getComputedStyle(el).backgroundColor };
    });
    noter('4. le champ et le filtre forment un seul bloc (écart ≤ 2 px, même hauteur)', bloc.ecart <= 2 && bloc.memeHaut && bloc.rayonDroit > 0 && bloc.fond !== 'rgba(0, 0, 0, 0)', JSON.stringify(bloc));

    /* 4. Recherche et filtre. */
    const champ = page.locator(`${colonne}[data-champ-recherche-agents]`);
    await champ.fill('branche speciale');
    await page.waitForTimeout(300);
    noter('4. la recherche trouve un agent par sa branche', (await idsAffiches(page, colonne)).join(',') === 'c-brouillon');
    await champ.fill('QUESTION');
    await page.waitForTimeout(300);
    noter('4. la recherche trouve un agent par son nom, sans tenir compte des majuscules', (await idsAffiches(page, colonne)).join(',') === 'c-question');
    await champ.fill('');
    await page.waitForTimeout(300);
    await page.locator(`${colonne}[data-filtre-agents]`).click();
    await page.locator('[data-filtre-etat="a-vous"]').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    noter('4. le filtre réduit la liste aux agents qui attendent l’utilisateur', (await idsAffiches(page, colonne)).join(',') === 'c-question');
    await page.locator(`${colonne}[data-filtre-agents]`).click();
    await page.locator('[data-filtre-effacer]').click();
    await page.waitForTimeout(300);

    /* 4 bis. L'agent qui attend sa réponse, et le non-lu qui n'est que du gras. */
    const lireLaLigne = (id) =>
      page.locator(`${colonne}[data-agent-en-liste="${id}"]`).evaluate((el) => {
        const sonde = document.createElement('div');
        sonde.className = 'cadre-de-question';
        document.body.appendChild(sonde);
        const jaune = getComputedStyle(sonde).borderTopColor;
        sonde.remove();
        const style = getComputedStyle(el);
        return {
          etat: el.getAttribute('data-etat-agent'),
          repere: el.hasAttribute('data-agent-attend-reponse'),
          cadre: style.outlineStyle === 'solid' && style.outlineWidth === '1px' && style.outlineColor === jaune,
          contour: style.outlineStyle,
          icone: !!el.querySelector('svg.lucide-message-circle-question, svg.lucide-message-circle-question-mark'),
          gras: Number(getComputedStyle(el.querySelector('[data-titre-agent]')).fontWeight) >= 600,
          hauteur: el.getBoundingClientRect().height,
        };
      });
    const question = await lireLaLigne('c-question');
    noter(
      '4 bis. un agent arrêté sur sa question : « À vous », repère, icône de question et cadre jaune',
      question.etat === 'a-vous' && question.repere && question.icone && question.cadre,
      JSON.stringify(question),
    );
    noter(
      '4 bis. le cadre ne décale pas la ligne',
      question.hauteur === (await lireLaLigne('c-brouillon')).hauteur,
      `${question.hauteur} px`,
    );
    const rendue = await lireLaLigne('c-rendue');
    noter(
      '4 bis. un rendu non lu : le gras seul, sans « À vous » ni cadre',
      rendue.etat === 'a-deployer' && rendue.gras && !rendue.repere && rendue.contour === 'none',
      JSON.stringify(rendue),
    );
    await page.locator(`${colonne}[data-agent-en-liste="c-question"] :is(a, button)`).first().click();
    await page.locator('[data-page-carte="c-question"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(800);
    const arbre = 'aside[data-zone="gauche"] [data-taches-du-projet="p-alpha"] ';
    const lireDansLArbre = (id) =>
      page.locator(`${arbre}[data-agent-en-liste="${id}"]`).evaluate((el) => {
        const sonde = document.createElement('div');
        sonde.className = 'cadre-de-question';
        document.body.appendChild(sonde);
        const jaune = getComputedStyle(sonde).borderTopColor;
        sonde.remove();
        const style = getComputedStyle(el);
        return {
          etat: el.getAttribute('data-etat-agent'),
          repere: el.hasAttribute('data-agent-attend-reponse'),
          cadre: style.outlineStyle === 'solid' && style.outlineColor === jaune,
          gras: Number(getComputedStyle(el.querySelector('[data-titre-agent]')).fontWeight) >= 600,
        };
      });
    const questionOuverte = await lireDansLArbre('c-question');
    noter(
      '4 bis. ouvrir la carte garde « À vous » et le cadre jaune',
      questionOuverte.etat === 'a-vous' && questionOuverte.repere && questionOuverte.cadre,
      JSON.stringify(questionOuverte),
    );
    await page.screenshot({ path: `${RACINE}/data/verification/liste-des-agents-question.png` });
    /* Par l'adresse : ce contrôle juge le gras, pas le passage d'une carte à l'autre. */
    await page.evaluate(() => {
      window.location.hash = '#projet/p-alpha/tache/c-rendue';
    });
    await page.locator('[data-page-carte="c-rendue"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(800);
    const rendueLue = await lireDansLArbre('c-rendue');
    noter('4 bis. ouvrir un rendu retire le gras, et rien d’autre', !rendueLue.gras && rendueLue.etat === 'a-deployer', JSON.stringify(rendueLue));
    await page.evaluate(() => {
      window.location.hash = '#en-route';
    });
    await page.locator('[data-page-carte]').waitFor({ state: 'detached', timeout: 10000 });
    await page.locator(`${colonne}[data-agent-en-liste="c-lue"]`).waitFor({ state: 'visible', timeout: 10000 });

    /* 5. Clic droit : le menu reste ouvert, « Renommer » renomme. */
    const ligneLue = page.locator(`${colonne}[data-agent-en-liste="c-lue"] :is(a, button)`).first();
    const boite = await ligneLue.boundingBox();
    await page.mouse.move(boite.x + 40, boite.y + boite.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(400);
    noter('5. le clic droit ouvre le menu de l’agent, qui reste ouvert', (await page.locator('[data-menu-renommer="c-lue"]').count()) === 1);
    noter('5. le menu propose « Statut »', (await page.locator('[data-menu-statut]').count()) > 0);
    await page.locator('[data-menu-renommer="c-lue"]').click();
    const saisie = page.locator('[role="dialog"] input').first();
    await saisie.waitFor({ state: 'visible', timeout: 5000 });
    await saisie.fill('Rapport relu et renommé');
    await saisie.press('Enter');
    await page.waitForTimeout(1200);
    noter('5. « Renommer » renomme l’agent', titreEnBase('c-lue') === 'Rapport relu et renommé', titreEnBase('c-lue') ?? 'absent');

    /* 6. La colonne de gauche, la même partout. */
    const aside = 'aside[data-zone="gauche"] ';
    const tete = await page.locator(`${aside}[data-tete-de-colonne]`).evaluate((el) => {
      const violet = el.querySelector('[data-ligne-tableau-de-bord]').getBoundingClientRect();
      const services = el.querySelector('[data-navigation-compacte]').getBoundingClientRect();
      const [fond1, fond2] = [el.querySelector('[data-ligne-tableau-de-bord]'), el.querySelector('[data-navigation-compacte]')].map((n) => getComputedStyle(n).backgroundColor);
      return { ecart: services.left - violet.right, memeHaut: violet.height === services.height, fond1, fond2, rayon: getComputedStyle(el.querySelector('[data-ligne-tableau-de-bord]')).borderTopRightRadius };
    });
    const [r, g, b] = (tete.fond1.match(/\d+/g) ?? []).map(Number);
    noter('6. « Tableaux de bord » et les services : un bouton groupé violet, sans écart', tete.ecart <= 2 && tete.memeHaut && tete.fond1 === tete.fond2 && b > g && r > g && tete.rayon === '0px', JSON.stringify(tete));
    noter('6. « Nouvel agent » reste dessous', (await page.locator(`${aside}[data-bouton-tableaux-de-bord]`).count()) === 1);
    const barre = '[data-entete-de-zone] ';
    noter('6. la barre du haut n’a plus de bouton des services', (await page.locator(`${barre}[data-navigation-compacte]`).count()) === 0);
    await page.locator(`${aside}[data-navigation-compacte]`).click();
    noter('6. l’icône ouvre les services', await page.locator('[data-navigation-panneau="ouvert"] [data-ouvrir-memoire]').waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false));
    await page.keyboard.press('Escape');
    await page.locator(`${aside}[data-deplier-taches="p-long"]`).click();
    const archivesLong = `${aside}[data-taches-du-projet="p-long"] `;
    await page.locator(`${archivesLong}[data-agent-en-liste]`).nth(4).waitFor({ state: 'visible', timeout: 8000 });
    noter('6. un projet montre cinq tâches', (await page.locator(`${archivesLong}[data-agent-en-liste]`).count()) === 5);
    await page.locator(`${archivesLong}[data-voir-plus]`).click();
    await page.locator(`${archivesLong}[data-agent-en-liste]`).nth(9).waitFor({ state: 'visible', timeout: 8000 });
    noter('6. « Voir plus » en ajoute cinq', (await page.locator(`${archivesLong}[data-agent-en-liste]`).count()) === 10);
    await page.locator(`${aside}[data-deplier-taches="p-long"]`).click();
    /* Cliquer un projet déplie ses tâches actives et rouvre sa dernière tâche. */
    await page.locator(`${aside}[data-drag-id="p-alpha"] :is(a, button)`).first().click();
    const dejaOuverte = await page.locator('[data-page-carte]').first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
    noter('6. cliquer un projet rouvre sa dernière tâche', dejaOuverte);
    const taches = await idsAffiches2(page, `${aside}[data-taches-du-projet="p-alpha"] `);
    noter(
      '6. ses tâches se déplient : toutes les actives, puis les rangées dans le compte des cinq',
      taches.join(',') === 'c-lue,c-travail,c-question,c-rendue,c-programmee,c-brouillon,c-archive-recente',
      taches.join(', '),
    );
    const colonneAlpha = `${aside}[data-taches-du-projet="p-alpha"] `;
    /* PLUS DE TRAIT « ARCHIVÉ » DANS LA COLONNE (carte du 04/11/2026, capture #2271) : les rangées s'y effacent à 30 %
       et redeviennent nettes au survol ; les actives restent nettes. */
    const opacite = (id) => page.locator(`${colonneAlpha}[data-agent-en-liste="${id}"]`).evaluate((el) => Number(getComputedStyle(el).opacity));
    const rangee = `${colonneAlpha}[data-agent-en-liste="c-archive-recente"]`;
    const avant = { trait: await page.locator(`${colonneAlpha}[data-separation-actives]`).count(), marquee: await page.locator(`${rangee}[data-ligne-rangee]`).count(), rangee: await opacite('c-archive-recente'), active: await opacite('c-brouillon') };
    await page.locator(rangee).hover();
    await page.waitForTimeout(400);
    const survol = await opacite('c-archive-recente');
    await page.mouse.move(12, 400);
    noter(
      '6. dans la colonne, aucun trait « Archivé » : la rangée est à 30 %, nette au survol, l’active reste nette',
      avant.trait === 0 && avant.marquee === 1 && Math.abs(avant.rangee - 0.3) < 0.02 && avant.active === 1 && survol === 1,
      JSON.stringify({ ...avant, survol }),
    );
    /* DEPUIS LE 14/11/2026, LA COLONNE PORTE LE REPÈRE DES TABLEAUX DE BORD : l'icône du projet, l'état de l'agent
       dans un rond à son coin haut droit (`IconeDeLAgent petite`). */
    const ronds = await page.locator(`${colonneAlpha}[data-agent-en-liste]`).evaluateAll((els) =>
      els.map((el) => {
        const enveloppe = el.querySelector('[data-icone-agent-projet]')?.getBoundingClientRect();
        const rond = el.querySelector('[data-icone-agent-projet] [data-rond-d-etat]');
        const boite = rond?.getBoundingClientRect();
        return {
          id: el.getAttribute('data-agent-en-liste'),
          etat: rond?.getAttribute('data-rond-d-etat') ?? null,
          memeBoite: !!enveloppe && Math.abs(enveloppe.width - 18) < 0.5 && Math.abs(enveloppe.height - 18) < 0.5,
          auCoin: !!enveloppe && !!boite && boite.right >= enveloppe.right - 1 && boite.top <= enveloppe.top + 1,
        };
      }),
    );
    noter(
      '6. chaque tâche porte l’icône de son projet avec son état au coin, sans rien décaler',
      ronds.length > 0 && ronds.every((r) => r.etat && r.memeBoite && r.auCoin),
      JSON.stringify(ronds),
    );
    await page.locator(`${aside}[data-taches-du-projet="p-alpha"] [data-voir-plus]`).click();
    await page.locator(`${aside}[data-taches-du-projet="p-alpha"] [data-agent-en-liste="c-brouillon"]`).waitFor({ state: 'visible', timeout: 8000 });
    await page.locator(`${aside}[data-taches-du-projet="p-alpha"] [data-agent-en-liste="c-brouillon"] :is(a, button)`).first().click();
    await page.locator('[data-page-carte="c-brouillon"]').waitFor({ state: 'visible', timeout: 15000 });
    noter('6. un clic ouvre l’agent, sa ligne s’allume', (await page.locator(`${aside}[data-agent-en-liste="c-brouillon"][data-ouvert]`).count()) === 1);
    noter('6. la colonne reste la même, agent ouvert', (await page.locator(`${aside}[data-tete-de-colonne]`).isVisible()) && (await page.locator(`${aside}[data-menu-de-colonne]`).count()) === 0);
    const nomDuProjet = page.locator('[data-page-carte="c-brouillon"] [data-chemin-a-menu]');
    noter('6. le nom du projet n’ouvre plus de liste', (await nomDuProjet.count()) === 0 && (await page.locator('[data-page-carte="c-brouillon"] [data-navigation-compacte]').count()) === 0);
    await page.waitForTimeout(800);
    await page.goto(`${BASE}/#projet/p-alpha`);
    await page.reload();
    const repris = await page.locator('[data-page-carte="c-brouillon"]').waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false);
    noter('6. recharger le projet rouvre le dernier agent ouvert', repris);
    /* Le rangement tient avec des tâches dépliées : un projet glissé au-dessus d'un
       projet déplié se range avant lui, et ses tâches ne faussent pas la visée. */
    const rangDe = (id) => {
      const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
      const ligne = db.prepare('SELECT data FROM projects WHERE id = ?').get(id);
      db.close();
      return JSON.parse(ligne.data).rank;
    };
    const ligneLong = page.locator(`${aside}[data-drag-id="p-long"]`);
    await ligneLong.hover();
    await page.waitForTimeout(250); // Les outils s'ouvrent en glissant : la poignée se mesure une fois posée.
    const poignee = await page.locator(`${aside}[data-poignee-projet="p-long"]`).boundingBox();
    const cibleAlpha = await page.locator(`${aside}[data-drag-id="p-alpha"]`).boundingBox();
    await page.mouse.move(poignee.x + poignee.width / 2, poignee.y + poignee.height / 2);
    await page.mouse.down();
    await page.mouse.move(poignee.x + poignee.width / 2, poignee.y - 12, { steps: 4 });
    await page.mouse.move(cibleAlpha.x + 40, cibleAlpha.y + 4, { steps: 8 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(800);
    noter('6. un projet glissé au-dessus d’un projet déplié se range avant lui', rangDe('p-long') < rangDe('p-alpha'), `${rangDe('p-long')} / ${rangDe('p-alpha')}`);

    await page.goto(`${BASE}/#projet/p-vide`);
    const accueil = await page.locator('[data-accueil-du-projet="vide"]').waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
    noter('6. un projet sans agent montre son accueil (Résumé, sans « Lancer un agent » depuis le 13/11/2026)', accueil && (await page.locator('[data-accueil-du-projet]').count()) >= 1);
    noter('6. aucune carte n’est créée d’office', (await page.locator('[data-taches-du-projet="p-vide"] [data-agent-en-liste]').count()) === 0);
    await page.goto(`${BASE}/#projet/p-alpha`);
    const reprisEncore = await page.locator('[data-page-carte="c-brouillon"]').waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
    noter('6. revenir dans le projet rouvre le dernier agent', reprisEncore);

    /* 6 bis. LE NOM D'UN PROJET EST UNE ENTRÉE (31/10/2026) : il rouvre le dernier
       agent même juste après l'avoir refermé, sinon le plus récent. */
    await page.waitForTimeout(600);
    await page.locator('[data-page-carte="c-brouillon"] :is(a, button)[data-chemin-de-zone]').first().click();
    const refermee = await page.locator('[data-page-carte]').first().waitFor({ state: 'detached', timeout: 8000 }).then(() => true, () => false);
    await page.locator(`${aside}[data-drag-id="p-alpha"] :is(a, button)`).first().click();
    const rouverte = await page.locator('[data-page-carte="c-brouillon"]').waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
    noter('6. recliquer le nom du projet rouvre l’agent qu’on vient de refermer', refermee && rouverte, `refermée : ${refermee}`);
    await page.locator(`${aside}[data-drag-id="p-beta"] :is(a, button)`).first().click();
    const plusRecent = await page.locator('[data-page-carte="c-beta"]').waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
    noter('6. sans souvenir, le nom du projet ouvre son agent le plus récent', plusRecent && (await page.locator('[data-page-carte="c-brouillon"]').count()) === 0);
    {
      const db = new Database(path.join(DATA, 'beluga.db'));
      db.prepare('INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('card.open.p-long', JSON.stringify('c-long-40'), Date.now());
      db.close();
    }
    await page.reload();
    await page.locator(`${aside}[data-drag-id="p-long"] :is(a, button)`).first().waitFor({ state: 'visible', timeout: 15000 });
    const dejaLa = await page.evaluate(() => !!document.querySelector('[data-agent-en-liste="c-long-40"]'));
    await page.locator(`${aside}[data-drag-id="p-long"] :is(a, button)`).first().click();
    /* SEULES LES TÂCHES ACTIVES S'OUVRENT (01/11/2026) : le souvenir pas encore chargé est demandé, se
       révèle ARCHIVÉ, et « Long » — cinquante-cinq archives, aucune active — montre sa page au bouton. */
    const accueilLong = await page.locator('[data-accueil-du-projet]').waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
    await page.waitForTimeout(800);
    noter(
      '6. un dernier agent pas encore chargé est demandé ; archivé, il ne s’ouvre pas, et un projet tout archivé montre sa page au bouton',
      accueilLong && (await page.locator('[data-page-carte]').count()) === 0 && (await page.locator('[data-accueil-du-projet]').count()) >= 1,
      `déjà affiché avant le clic : ${dejaLa}`,
    );
    await page.locator(`${aside}[data-drag-id="p-vide"] :is(a, button)`).first().click();
    const accueilVide = await page.locator('[data-accueil-du-projet="vide"]').waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
    noter('6. un projet sans agent garde son accueil au clic', accueilVide && (await page.locator('[data-page-carte]').count()) === 0);

    /* 6 ter. LES DATES (31/10/2026) : dans la colonne, la date courte et aucun
       badge, une bulle au survol ; sur les pages, le badge réduit et la date dessous. */
    await page.locator(`${aside}[data-drag-id="p-alpha"] :is(a, button)`).first().click();
    await page.locator('[data-page-carte="c-brouillon"]').waitFor({ state: 'visible', timeout: 10000 });
    const lignesAlpha = `${aside}[data-taches-du-projet="p-alpha"] `;
    await page.locator(`${lignesAlpha}[data-agent-en-liste]`).first().waitFor({ state: 'visible', timeout: 8000 });
    noter('6. la colonne n’a aucun badge', (await page.locator(`${lignesAlpha}[data-etat-badge]`).count()) === 0);
    /* Un titre très long ne pousse jamais la date hors de la ligne. */
    await page.locator(`${lignesAlpha}[data-agent-en-liste="c-travail"] [data-titre-agent]`).evaluate((el) => {
      el.textContent = 'Un titre extrêmement long qui ne tiendra jamais sur la largeur de la colonne de gauche, même large';
    });
    const datesColonne = await page.locator(`${lignesAlpha}[data-agent-en-liste]`).evaluateAll((lignes) =>
      lignes.map((ligne) => {
        const date = ligne.querySelector('[data-date-agent]');
        const r = ligne.getBoundingClientRect();
        const d = date?.getBoundingClientRect();
        return { id: ligne.getAttribute('data-agent-en-liste'), texte: date?.textContent ?? '', dedans: !!d && d.width > 0 && d.right <= r.right + 0.5 && d.left >= r.left };
      }),
    );
    noter(
      '6. chaque ligne de la colonne porte sa date courte, dans la ligne',
      datesColonne.length > 0 && datesColonne.every((l) => l.dedans && /^(\d+ (min|h|j)|\d{2}[./]\d{2}([./]\d{2})?)$/.test(l.texte)),
      JSON.stringify(datesColonne),
    );
    await page.locator(`${lignesAlpha}[data-agent-en-liste="c-question"] :is(a, button)`).first().hover();
    const bulle = page.locator('[data-bulle-agent="c-question"]');
    const bulleVue = await bulle.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false);
    const texteBulle = bulleVue ? await bulle.innerText() : '';
    const partsBulle = bulleVue ? await bulle.evaluate((el) => [...el.children].map((n) => n.textContent ?? '')) : [];
    /* Le statut est celui de la ligne, à cet instant (l'agent d'essai peut avoir changé d'état). */
    const LIBELLES = { brouillon: 'Brouillon', lance: 'Lancé', travail: 'Au travail', 'en-pause': 'En pause', 'a-vous': 'À vous', 'a-deployer': 'À déployer', 'en-ligne': 'En ligne', archive: 'Archivé' };
    const etatLigne = await page.locator(`${lignesAlpha}[data-agent-en-liste="c-question"]`).getAttribute('data-etat-agent');
    noter(
      '6. au survol, la bulle dit le statut, le titre entier, la date exacte et la branche',
      bulleVue &&
        partsBulle.length === 4 &&
        partsBulle[0] === LIBELLES[etatLigne] &&
        partsBulle[1] === 'Agent qui pose une question' &&
        /\d{2}:\d{2}/.test(partsBulle[2]) &&
        partsBulle[3].length > 0,
      texteBulle.replace(/\n/g, ' / '),
    );
    await page.mouse.move(900, 500);
    await page.goto(`${BASE}/#en-route`);
    await page.locator('[data-page-en-route] [data-agent-en-liste]').first().waitFor({ state: 'visible', timeout: 15000 });
    const lignesPage = await page.locator('[data-page-en-route] [data-agent-en-liste]').evaluateAll((lignes) =>
      lignes.slice(0, 12).map((ligne) => {
        const r = ligne.getBoundingClientRect();
        const badge = ligne.querySelector('[data-etat-badge]')?.getBoundingClientRect();
        const date = ligne.querySelector('[data-date-agent]')?.getBoundingClientRect();
        const texte = ligne.querySelector('[data-date-agent]')?.textContent ?? '';
        return {
          texte,
          ok: !!badge && !!date && date.top >= badge.bottom - 0.5 && badge.right <= r.right + 0.5 && date.right <= r.right + 0.5 && Math.abs(badge.right - date.right) <= 1,
        };
      }),
    );
    noter(
      '6. sur la page, chaque ligne porte son badge et, dessous, « il y a … »',
      lignesPage.length > 0 && lignesPage.every((l) => l.ok && /il y a|à l’instant|\d{2}[./]\d{2}/.test(l.texte)),
      JSON.stringify(lignesPage.slice(0, 4)),
    );
    await page.goto(`${BASE}/#projet/p-alpha`);
    await page.locator('[data-page-carte="c-brouillon"]').waitFor({ state: 'visible', timeout: 15000 });

    /* 6 quater. TOUT AGENT ACTIF SE VOIT (31/10/2026), même ancien, même d'un atelier, même rangé. */
    /* Un décor d'agents factices se repose juste avant la mesure : le démon range ceux qui ne tournent pas vraiment. */
    {
      const db = new Database(path.join(DATA, 'beluga.db'));
      const vivant = { tourVivantDepuis: Date.now() - 60_000 };
      agent(db, 'ag-gamma-studio', 'p-gamma', 'c-gamma-studio', 'cadrage', 'running', vivant);
      agent(db, 'ag-gamma-atelier', 'p-gamma', 'c-gamma-atelier', 'task', 'running', vivant);
      agent(db, 'ag-gamma-rangee', 'p-gamma', 'c-gamma-rangee', 'task', 'running', vivant);
      agent(db, 'ag-delta', 'p-delta', 'c-delta', 'task', 'running', vivant);
      db.close();
    }
    await page.goto(`${BASE}/#en-route`);
    await page.reload();
    await page.locator(`${colonne}[data-agent-en-liste="c-gamma-studio"]`).waitFor({ state: 'visible', timeout: 15000 });
    const actifsVus = await idsAffiches(page, colonne);
    noter(
      '6 quater. « Tableaux de bord » montre le directeur du Studio, l’atelier actif et la carte rangée active, sans défiler',
      ['c-gamma-studio', 'c-gamma-atelier', 'c-gamma-rangee'].every((id) => actifsVus.includes(id)),
      actifsVus.filter((id) => id.startsWith('c-gamma')).join(', '),
    );
    noter('6 quater. un atelier au repos reste caché', (await page.locator(`${colonne}[data-agent-en-liste="c-gamma-atelier-repos"]`).count()) === 0);

    /* 6 quinquies. L'AGENT SANS CARTE AU TRAVAIL SE VOIT DANS LA COLONNE (04/11/2026, captures #ecda et #c14d) : la
       configuration d'un déploiement n'a pas de carte, elle paraît dans « En cours » et sous son projet. */
    {
      const db = new Database(path.join(DATA, 'beluga.db'));
      /* Sans carte : `cardId` absent des données (un `null` n'y est pas admis), colonne vide en base. */
      const config = { id: 'ag-config', projectId: 'p-alpha', role: 'deploy', title: 'Configuration du déploiement', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'running', tourVivantDepuis: Date.now() - 30_000, startedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now() };
      db.prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)').run(config.id, config.projectId, config.role, config.status, JSON.stringify(config), config.createdAt, config.updatedAt);
      /* Le projet désigne cet agent comme celui qui ÉCRIT sa procédure de déploiement (`etapeDeLAgentDeConfiguration`). */
      const ligne = db.prepare("SELECT data FROM projects WHERE id = 'p-alpha'").get();
      const donnees = JSON.parse(ligne.data);
      donnees.deploiement = { ...(donnees.deploiement ?? {}), agentId: 'ag-config' };
      db.prepare("UPDATE projects SET data = ? WHERE id = 'p-alpha'").run(JSON.stringify(donnees));
      db.close();
    }
    await page.reload();
    const zoneSansCarte = page.locator('[data-taches-en-cours-colonne] [data-agent-sans-carte="ag-config"]');
    const vueDansLaZone = await zoneSansCarte.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
    noter('6 quinquies. l’agent de configuration d’un déploiement paraît dans « En cours »', vueDansLaZone && /Configuration du déploiement/.test(await zoneSansCarte.innerText()));
    if (!(await page.locator('[data-taches-du-projet="p-alpha"]').count())) await page.locator('[data-deplier-taches="p-alpha"]').first().click().catch(() => {});
    noter('6 quinquies. …et sous son projet', await page.locator('[data-taches-du-projet="p-alpha"] [data-agent-sans-carte="ag-config"]').waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false));
    /* 6 quinquies. LE CLIC OUVRE LE MENU « PUBLIER » DU HAUT, JAMAIS LE TIROIR (carte « Colonne repliée et témoin du
       serveur », 18/11/2026 : le tiroir est réservé au débogage manuel). */
    if (vueDansLaZone) {
      await zoneSansCarte.click();
      const menuOuvert = await page.locator('[data-menu-publier]').first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
      await page.waitForTimeout(400);
      const tiroir = await page.locator('[data-tiroir-agent-configuration]').count();
      noter('6 quinquies. …et son clic ouvre le menu « Publier » du haut, sans tiroir', menuOuvert && tiroir === 0, `menu ${menuOuvert}, tiroirs ${tiroir}`);
      await page.keyboard.press('Escape');
    }
    {
      const db = new Database(path.join(DATA, 'beluga.db'));
      db.prepare("DELETE FROM agents WHERE id = 'ag-config'").run();
      db.close();
    }
    /* 6 sexies. UNE MISE EN LIGNE QUI TOURNE SE VOIT DANS « EN COURS » (04/11/2026, capture #8a35 : « Déploiement ·
       HaikoBill · 50 % » au tableau de bord, rien dans la colonne). Elle n'est ni une carte ni un agent. */
    {
      const db = new Database(path.join(DATA, 'beluga.db'));
      const debut = Date.now() - 20_000;
      const run = { id: 'run-essai-colonne', projectId: 'p-alpha', state: 'running', currentStep: 'build', steps: [{ key: 'merge', state: 'done', log: '' }, { key: 'build', state: 'running', log: '' }], startedAt: debut };
      db.prepare('INSERT OR REPLACE INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, NULL)').run(run.id, run.projectId, run.state, JSON.stringify(run), debut);
      db.close();
    }
    await page.reload();
    const zoneMiseEnLigne = page.locator('[data-taches-en-cours-colonne] [data-mise-en-ligne-en-cours="run-essai-colonne"] [data-mise-en-ligne="run-essai-colonne"]');
    const vueMiseEnLigne = await zoneMiseEnLigne.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
    noter('6 sexies. un déploiement qui tourne paraît dans « En cours », avec son avancement', vueMiseEnLigne && /Déploiement/.test(await zoneMiseEnLigne.innerText()) && /%/.test(await zoneMiseEnLigne.innerText()));
    const compte = await page.getAttribute('[data-nombre-taches-en-cours]', 'data-nombre-taches-en-cours').catch(() => null);
    noter('6 sexies. …et il compte dans « En cours »', Number(compte) >= 1, String(compte));
    if (!(await page.locator('[data-taches-du-projet="p-alpha"]').count())) await page.locator('[data-deplier-taches="p-alpha"]').first().click().catch(() => {});
    noter('6 sexies. …et sous son projet', await page.locator('[data-taches-du-projet="p-alpha"] [data-mise-en-ligne="run-essai-colonne"]').waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false));
    {
      const db = new Database(path.join(DATA, 'beluga.db'));
      db.prepare("DELETE FROM deploys WHERE id = 'run-essai-colonne'").run();
      db.close();
    }
    /* LE PAQUET : la mère très légère, ce qui est dessous plus près du fond, l'ombre sur la mère seule (capture #edff). */
    const sombreAuDepart = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    const lirePaquet = async (sombre) => {
      await page.evaluate((sombre) => document.documentElement.classList.toggle('dark', sombre), sombre);
      await page.waitForTimeout(450); // Les bords du paquet ont leur transition.
      return page.evaluate(() => {
        const vers = (couleur) => {
          const toile = document.createElement('canvas').getContext('2d');
          toile.fillStyle = couleur;
          toile.fillRect(0, 0, 1, 1);
          return toile.getImageData(0, 0, 1, 1).data[1];
        };
        const lire = (s) => document.querySelector(s);
        const zone = lire('[data-cadre-du-paquet]').closest('[data-zone-liste-agents]');
        let n = zone;
        while (n && getComputedStyle(n).backgroundColor === 'rgba(0, 0, 0, 0)') n = n.parentElement;
        const r = {
          fond: vers(getComputedStyle(n ?? document.body).backgroundColor),
          mere: vers(getComputedStyle(lire('[data-cadre-du-paquet]')).backgroundColor),
          dessous: vers(getComputedStyle(lire('[data-tranche-du-paquet]')).backgroundColor),
          ombre: getComputedStyle(lire('[data-cadre-du-paquet]')).boxShadow,
          ombreDessous: getComputedStyle(lire('[data-tranche-du-paquet]')).boxShadow,
        };
        return r;
      });
    };
    for (const [nom, sombre] of [['clair', false], ['sombre', true]]) {
      const c = await lirePaquet(sombre);
      const ecart = Math.abs(c.mere - c.fond);
      noter(
        `6 quater. le paquet en ${nom} : mère légère, dessous plus près du fond, ombre sur la mère seule`,
        ecart >= 2 && ecart <= 24 && Math.abs(c.dessous - c.fond) < ecart && c.ombre !== 'none' && c.ombreDessous === 'none',
        JSON.stringify(c),
      );
    }
    await page.evaluate((sombre) => document.documentElement.classList.toggle('dark', sombre), sombreAuDepart);
    await page.screenshot({ path: `${RACINE}/data/verification/liste-des-agents-paquet.png` });
    await page.locator(`${aside}[data-deplier-taches="p-gamma"]`).click();
    const sousGamma = `${aside}[data-taches-du-projet="p-gamma"] `;
    await page.locator(`${sousGamma}[data-agent-en-liste="c-gamma-studio"]`).waitFor({ state: 'visible', timeout: 8000 });
    const actifsSousGamma = await idsAffiches2(page, sousGamma);
    noter(
      '6 quater. sous son projet aussi, sans « Voir plus »',
      ['c-gamma-studio', 'c-gamma-atelier', 'c-gamma-rangee'].every((id) => actifsSousGamma.includes(id)) && !actifsSousGamma.includes('c-gamma-atelier-repos'),
      actifsSousGamma.join(', '),
    );
    /* LE DOSSIER DÉPLIÉ NE REDIT PAS SES LIGNES ; REPLIÉ, IL RETROUVE SON SIGNE, VIOLET. */
    const ligneDelta = `${aside}[data-drag-id="p-delta"] `;
    /* Le démon peut y avoir posé une panne sur l'agent factice, qui prime : seul le signe de travail se juge violet. */
    const lirePastille = () =>
      page.locator(`${ligneDelta}[data-repere-robot]`).evaluateAll((els) =>
        els.map((el) => {
          const toile = document.createElement('canvas').getContext('2d');
          toile.fillStyle = getComputedStyle(el).backgroundColor;
          toile.fillRect(0, 0, 1, 1);
          const [r, g, b] = toile.getImageData(0, 0, 1, 1).data;
          return el.hasAttribute('data-signal-nature') || (b > g + 24 && r > g);
        }),
      );
    const replie = await lirePastille();
    noter('6 quater. replié, un dossier au travail porte son signe, en violet', replie.length === 1 && replie[0] === true, JSON.stringify(replie));
    await page.locator(`${aside}[data-deplier-taches="p-delta"]`).click();
    await page.locator(`${aside}[data-taches-du-projet="p-delta"] [data-agent-en-liste="c-delta"]`).waitFor({ state: 'visible', timeout: 8000 });
    noter('6 quater. déplié, il ne le répète plus : sa tâche est dessous', (await lirePastille()).length === 0);
    noter('6 quater. déplié non plus, Gamma ne redit pas ses lignes', (await page.locator(`${aside}[data-drag-id="p-gamma"] [data-repere-robot], ${aside}[data-drag-id="p-gamma"] [data-signal-attention]`).count()) === 0);
    await page.evaluate(() => {
      window.location.hash = '#projet/p-alpha/tache/c-brouillon';
    });
    await page.locator('[data-page-carte="c-brouillon"]').waitFor({ state: 'visible', timeout: 15000 });

    /* 7. L'écran d'un agent. */
    noter('7. plus de colonne d’options de la tâche ni de « i »', (await page.locator('[data-options-de-carte], [data-colonne-de-page]').count()) === 0);
    await page.locator('[data-page-carte="c-brouillon"] [data-menu-de-carte]').first().click();
    await page.waitForTimeout(300);
    noter(
      '7. les trois points portent « Cet agent » et « Ce projet »',
      (await page.locator('[data-menu-groupe="agent"]').count()) === 1 && (await page.locator('[data-menu-groupe="projet"]').count()) === 1 &&
        (await page.locator('[data-menu-fichiers]').count()) === 1 && (await page.locator('[data-onglet-carte="comments"]').count()) === 0,
    );
    await page.keyboard.press('Escape');

    /* 7 bis. GitHub s'ouvre dans un tiroir, sans rangée « Conversation / GitHub » (30/10/2026). */
    try {
      await page.locator('[data-bouton-de-branche]').first().click();
      await page.locator('[data-voir-la-branche]').first().click({ timeout: 5000 });
      const tiroir = page.locator('[data-tiroir-github]').first();
      await tiroir.waitFor({ state: 'visible', timeout: 8000 });
      noter(
        '7. « Voir la branche » ouvre GitHub dans un tiroir, la conversation reste dessous',
        (await page.locator('[data-barre-onglets]').count()) === 0 && (await page.locator('[data-composer]').count()) >= 1,
      );
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } catch (erreur) {
      noter('7. « Voir la branche » ouvre GitHub dans un tiroir, la conversation reste dessous', false, String(erreur?.message ?? erreur).split('\n')[0]);
    }

    /* 8. L'application démarre sous la barre d'état. */
    await page.goto(`${BASE}/#en-route`);
    await page.locator('[data-liste-des-agents="tous"] [data-agent-en-liste]').first().waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(600);
    const barreDEtat = await page.evaluate(async () => {
      const meta = (nom) => document.querySelector(`meta[name="${nom}"]`)?.getAttribute('content') ?? '';
      const hex = (rgb) => '#' + (rgb.match(/\d+/g) ?? []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
      return {
        vue: meta('viewport'),
        style: meta('apple-mobile-web-app-status-bar-style'),
        couleur: meta('theme-color'),
        repereSurOrdinateur: document.getElementById('repere-de-l-heure') !== null,
        zone: hex(getComputedStyle(document.querySelector('main[data-zone="centre"]')).backgroundColor),
        page: hex(getComputedStyle(document.body).backgroundColor),
        manifeste: (await fetch('/manifest.json').then((r) => r.json())).theme_color,
      };
    });
    noter('8. l’application démarre sous la barre d’état, sans déborder dessous', !barreDEtat.vue.includes('viewport-fit') && barreDEtat.style === 'default', JSON.stringify(barreDEtat));
    noter('8. la barre d’état, la page et le manifeste ont le fond de la zone', barreDEtat.couleur === barreDEtat.zone && barreDEtat.page === barreDEtat.zone && barreDEtat.manifeste === '#212121');
    noter('8. sur ordinateur, aucun repère de la barre de l’heure', !barreDEtat.repereSurOrdinateur);
    /* LE LOGO DU PROJET EN TÊTE, L'ÉTAT DANS UN ROND AU COIN (30/10/2026, capture #aef09). */
    const lignesTous = page.locator('[data-page-en-route] [data-agent-en-liste]');
    const avecLogo = await page.locator('[data-page-en-route] [data-agent-en-liste] [data-icone-agent-projet] [data-rond-d-etat]').count();
    noter('8. chaque agent montre le logo de son projet, l’état dans un rond au coin', avecLogo === (await lignesTous.count()) && avecLogo > 0, `${avecLogo}/${await lignesTous.count()}`);
    await page.screenshot({ path: `${RACINE}/data/verification/liste-des-agents-tableaux.png` });
    await contexte.close();

    /* ------------------------------ TÉLÉPHONE ------------------------------ */
    const tel = await navigateur.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-CH', serviceWorkers: 'block',
    });
    await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const mobile = await tel.newPage();
    await mobile.goto(`${BASE}/#projet/p-alpha`);
    await mobile.locator('[data-page-du-projet="p-alpha"] [data-agent-en-liste]').first().waitFor({ state: 'visible', timeout: 30000 });
    await mobile.waitForTimeout(800);
    noter('9. téléphone : le projet montre la liste en plein écran, sans agent ouvert', (await mobile.locator('[data-page-carte]:visible').count()) === 0);
    /* L'appui long : un vrai toucher maintenu, par le protocole du navigateur. */
    const cdp = await tel.newCDPSession(mobile);
    const cible = await mobile.locator('[data-page-du-projet] [data-agent-en-liste="c-rendue"] :is(a, button)').first().boundingBox();
    const point = { x: cible.x + 60, y: cible.y + cible.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await mobile.waitForTimeout(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mobile.waitForTimeout(500);
    noter('9. l’appui long ouvre le menu de l’agent', (await mobile.locator('[data-menu-renommer="c-rendue"]').count()) === 1);
    noter('9. …sans ouvrir l’agent', (await mobile.locator('[data-page-carte="c-rendue"]').count()) === 0);
    noter('9. aucune bulle au doigt', (await mobile.locator('[data-bulle-agent]').count()) === 0);
    await mobile.keyboard.press('Escape');
    await mobile.waitForTimeout(500);
    await mobile.locator('[data-page-du-projet] [data-agent-en-liste="c-rendue"] :is(a, button)').first().tap();
    const ouvert = await mobile.locator('[data-page-carte="c-rendue"]').waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
    noter('9. un toucher ouvre l’agent', ouvert);
    /* LE RETOUR À LA LISTE, SUR TÉLÉPHONE : l'icône du projet, dans le fil
       d'Ariane de la tâche (la barre à deux rangs n'a pas de flèche dans le
       rang du titre, décision du 24/10/2026). */
    /* 06/11/2026 : l'icône du projet a quitté le rang (elle est dans l'angle du ☰) ; Échap referme la tâche. */
    await mobile.keyboard.press('Escape');
    const retour = await mobile.locator('[data-page-carte]').waitFor({ state: 'detached', timeout: 10000 }).then(() => true, () => false);
    noter('9. refermer la tâche ramène à la liste', retour && (await mobile.locator('[data-page-du-projet] [data-agent-en-liste]').first().isVisible()));
    noter('9. le + du centre, en bas, crée un agent', (await mobile.locator('nav[data-menu-bas] [data-bouton-nouvel-agent]').count()) === 1);
    /* LE MENU, LA SEULE PORTE : il monte jusqu'à 20 px du haut de la vue. */
    noter('9. la barre du haut n’a ni services ni liste des projets', (await mobile.locator('[data-entete-de-zone] [data-navigation-compacte], [data-entete-de-zone] [data-chevron-de-cran]').count()) === 0);
    await mobile.locator('[data-entete-de-zone] button[aria-label="Projets"]:visible').first().tap();
    const menu = mobile.locator('[data-menu-du-telephone]');
    await menu.waitFor({ state: 'visible', timeout: 8000 });
    await mobile.waitForTimeout(500);
    const hautDuMenu = await mobile.locator('[data-feuille-du-bas]').last().evaluate((el) => el.getBoundingClientRect().top);
    noter('9. le menu s’arrête 20 px sous le haut de la vue, comme toute feuille', Math.abs(hautDuMenu - 20) <= 1, `${hautDuMenu} px`);
    noter('9. il porte le bouton groupé et « Nouvel agent »', (await menu.locator('[data-tete-de-colonne] [data-ligne-tableau-de-bord]').count()) === 1 && (await menu.locator('[data-tete-de-colonne] [data-navigation-compacte]').count()) === 1 && (await menu.locator('[data-bouton-tableaux-de-bord]').count()) === 1);
    await mobile.screenshot({ path: `${RACINE}/data/verification/liste-des-agents-menu-seul.png` });
    /* CE QUI EST OUVERT RESTE OUVERT (01/11/2026) : « Beta », ouvert sur l'ordinateur au point 6, l'est déjà ici. */
    const betaDejaOuvert = (await menu.locator('[data-deplier-taches="p-beta"]').getAttribute('aria-expanded')) === 'true';
    noter('9. le projet ouvert sur l’ordinateur l’est encore sur le téléphone', betaDejaOuvert);
    if (!betaDejaOuvert) await menu.locator('[data-deplier-taches="p-beta"]').tap();
    const tacheBeta = menu.locator('[data-taches-du-projet="p-beta"] [data-agent-en-liste="c-beta"] :is(a, button)').first();
    noter('9. on y déplie les tâches d’un projet', await tacheBeta.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false));
    await menu.locator('[data-tete-de-colonne] [data-navigation-compacte]').tap();
    await mobile.locator('[data-navigation-panneau="ouvert"] [data-ouvrir-memoire]').waitFor({ state: 'visible', timeout: 5000 });
    await mobile.waitForTimeout(500);
    noter('9. la grille des services passe au-dessus du menu', await mobile.locator('[data-navigation-panneau="ouvert"] [data-ouvrir-memoire]').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!dessus && (el === dessus || el.contains(dessus));
    }));
    await mobile.screenshot({ path: `${RACINE}/data/verification/liste-des-agents-menu-telephone.png` });
    await mobile.keyboard.press('Escape');
    await mobile.waitForTimeout(400);
    await tacheBeta.tap();
    await mobile.locator('[data-page-carte="c-beta"]').waitFor({ state: 'visible', timeout: 15000 });
    noter('9. toucher une tâche ouvre sa conversation et referme le menu', await menu.waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false));
    await mobile.screenshot({ path: `${RACINE}/data/verification/liste-des-agents-tache-telephone.png` });
    await tel.close();
  } finally {
    await navigateur.close();
  }
  const passes = resultats.filter((r) => r.ok).length;
  console.log(`\n${passes}/${resultats.length} vérifications passent.`);
  process.exitCode = passes === resultats.length ? 0 : 1;
}

principal()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
