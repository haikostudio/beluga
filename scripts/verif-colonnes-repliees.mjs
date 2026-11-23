#!/usr/bin/env node
/**
 * COLONNE REPLIÉE : TOUTES LES ICÔNES SUR LE MÊME AXE.
 *
 * Repliée, la colonne de gauche (`web/src/components/sidebar.tsx`) ne garde
 * qu'une bande d'icônes. Chaque ligne y centre son icône (`justify-center`) :
 * il suffit qu'un SECOND enfant occupe de la place dans la ligne — une roue de
 * chargement vide, un point d'état — pour que le couple « icône + voisin » soit
 * centré à la place de l'icône seule, qui part alors vers la gauche. C'est ce
 * qui décalait « Commentaires » et « GitHub » dans la colonne d'une tâche
 * (`RoueDOnglet`, `card-panel.tsx`).
 *
 * L'application n'a QU'UNE colonne repliable — celle de gauche : les réglages
 * ont un menu de largeur fixe, l'espace client n'a pas de colonne. Mais elle
 * change de contenu selon le lieu, et chaque contenu est mesuré ici :
 *
 *  1. les tableaux de bord : la liste des projets (ligne de Beluga, groupe et
 *     ses membres, projet seul), « Nouvel agent », « Tableaux de bord » ;
 *  2. un projet : ses options (`data-options-du-projet`) ;
 *  3. une tâche : ses options (`data-options-de-carte`), sur chacun de ses
 *     quatre onglets, et la ligne « Marquer comme non lu » ;
 *  4. un service à menu (la surveillance) : colonne réduite, son menu se cache — il
 *     ne reste que la tête et le pied ;
 *  avec, partout, le bouton qui déplie (la tête) et le pied (moteur, réglages).
 *
 * CE QUI EST MESURÉ EST UN ÉTAT, PAS UNE MISE EN PAGE. Pour chaque icône
 * visible de la colonne : son CENTRE horizontal, comparé à l'axe commun (la
 * médiane des centres) et au milieu de la bande ; et la raison du défaut — un
 * voisin EN FLUX qui occupe de la largeur dans la ligne. Aucune largeur de
 * bande, aucune taille d'icône n'est écrite ici : la colonne peut changer de
 * largeur sans faire tomber ce contrôle.
 *
 * Le contrôle lève SON démon (base neuve, port à lui : celui en service n'est
 * pas touché, aucun moteur appelé) et SON serveur web de développement, pointé
 * sur ce démon (`BELUGA_DEMON_PORT`) : c'est le code du dépôt d'où part le
 * script qui est jugé, pas une construction plus ancienne.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-colonnes-repliees.mjs
 *
 *   BELUGA_COLONNES_PORT      le port du démon d'essai (7143)
 *   BELUGA_COLONNES_WEB_PORT  le port du serveur web de développement (7141)
 *   HAIKO_COLONNES_CAPTURES   où ranger les captures (/tmp/verif-colonnes-repliees)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';
import { creerResultats } from './lib/verif-resultats.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_COLONNES_PORT || 7143);
const PORT_WEB = Number(process.env.BELUGA_COLONNES_WEB_PORT || 7141);
/* Le serveur de développement n'écoute qu'en IPv6 : `localhost`, pas 127.0.0.1. */
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = path.resolve(process.env.HAIKO_COLONNES_CAPTURES || '/tmp/verif-colonnes-repliees');
/** L'écart toléré, en px, entre le centre d'une icône et l'axe commun. */
const TOLERANCE = 1.5;

const ASIDE = 'aside[data-zone="gauche"]';
const PROJET = 'p-colonnes';
const CARTE = 'c-colonnes-ordinaire';
const CARTE_NEUVE = 'c-colonnes-neuve';

const { results, record: noter } = creerResultats();
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-colonnes-repliees-',
  port: PORT,
  signaux: true,
});

/* ------------------------------------------------------------------ */
/* LE SERVEUR WEB DE DÉVELOPPEMENT, pointé sur le démon d'essai.       */
/* ------------------------------------------------------------------ */
const journalWeb = [];
const web = spawn('npm', ['run', 'dev', '--workspace', 'web', '--', '--port', String(PORT_WEB), '--strictPort'], {
  cwd: RACINE,
  /* L'environnement des agents porte `NODE_ENV=production` : le serveur de
     développement, lui, sert le code tel qu'il est écrit. */
  env: { ...process.env, NODE_ENV: 'development', BELUGA_DEMON_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
  /* Son propre groupe de processus : `npm` lance `vite` en petit-fils, et
     c'est le groupe entier qu'on retire en partant. */
  detached: true,
});
web.stdout.on('data', (d) => journalWeb.push(String(d)));
web.stderr.on('data', (d) => journalWeb.push(String(d)));
const retirerLeWeb = () => {
  try {
    process.kill(-web.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
};
process.on('exit', retirerLeWeb);

async function attendreLeWeb(limiteMs = 90_000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (web.exitCode !== null) return false;
    const pret = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false);
    if (pret) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* LE DÉCOR : une session, des projets (dont un groupe), deux cartes.  */
/* ------------------------------------------------------------------ */
function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton), t, t + 3600_000, 'vérification colonnes repliées',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('INSERT INTO project_groups (id, name, rank, collapsed, created_at) VALUES (?, ?, ?, 0, ?)').run(
    'g-colonnes', 'Groupe d’essai', 50, t,
  );
  const projets = [
    { id: PROJET, name: 'Projet des colonnes' },
    { id: 'p-colonnes-a', name: 'Alpha', groupId: 'g-colonnes' },
    { id: 'p-colonnes-b', name: 'Bravo', groupId: 'g-colonnes' },
  ];
  projets.forEach((p, i) => {
    const projet = {
      ...p, path: DEPOT, defaultEngine: 'claude', isSelf: false, branchesDePublication: {},
      rank: 100 + i, archived: false, createdAt: t, updatedAt: t,
    };
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), t, t);
  });

  const carte = (id, colonne, position, titre, data) =>
    db
      .prepare(
        `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, PROJET, colonne, position, titre, JSON.stringify(data), t, t, 'Carte posée par un contrôle automatique.');
  /* RENDUE PUIS LUE : la colonne de la tâche porte alors « Marquer comme non lu ». */
  carte(CARTE, 'to_deploy', 1, 'Carte ordinaire', { renduA: t - 60_000, lastReadAt: t - 30_000 });
  /* TOUTE NEUVE : son titre est encore le mot par défaut (`TITRE_CARTE_DE_CADRAGE`). */
  carte(CARTE_NEUVE, 'planned', 1, 'Nouvelle tâche', {});

  /* La carte ordinaire a déjà échangé : sans message, elle montrerait sa configuration. */
  const agent = crypto.randomUUID();
  db.prepare('UPDATE cards SET agent_id = ? WHERE id = ?').run(agent, CARTE);
  const fiche = {
    id: agent, projectId: PROJET, cardId: CARTE, role: 'task', title: 'Carte ordinaire',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'done', createdAt: t, updatedAt: t,
  };
  db.prepare(
    'INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(agent, PROJET, CARTE, 'task', 'done', JSON.stringify(fiche), t, t);
  const message = {
    id: crypto.randomUUID(), agentId: agent, role: 'user', content: 'Carte d’essai : ne rien exécuter.',
    steps: [], todos: [], proposals: [], questions: [], downloads: [], attachments: [], streaming: false,
    createdAt: t - 1000,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    message.id, agent, 'user', JSON.stringify(message), message.createdAt,
  );
  db.close();
}

/* ------------------------------------------------------------------ */
/* LE RELEVÉ, dans la page.                                            */
/* ------------------------------------------------------------------ */
/**
 * Toutes les icônes VISIBLES de la colonne : les dessins (`svg`), les images,
 * les pastilles à initiales, la pile de favicons d'un projet réuni (mesurée
 * d'un bloc) et l'initiale d'un groupe. Une INCRUSTATION — un point ou un
 * repère posé en `absolute` sur un coin — n'est pas une icône de ligne : elle
 * est comptée à part, jamais mesurée.
 */
const RELEVER = (selecteurAside) => {
  const aside = document.querySelector(selecteurAside);
  if (!aside) return null;
  const ra = aside.getBoundingClientRect();
  const PORTEURS = 'svg, img, [data-initiales-projet], [data-pile-favicons], [data-groupe-initiale]';
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  const horsFlux = (el) => ['absolute', 'fixed'].includes(getComputedStyle(el).position);
  const nom = (el) => {
    const ligne = el.closest('button, a, [data-drag-id], [data-groupe-initiale]') ?? el.parentElement;
    const repere = [...(ligne?.attributes ?? [])]
      .filter((a) => a.name.startsWith('data-') && !a.name.startsWith('data-state') && !a.name.startsWith('data-radix'))
      .map((a) => (a.value && a.value.length < 30 ? `${a.name}="${a.value}"` : a.name))
      .slice(0, 2)
      .join(' ');
    return repere || ligne?.getAttribute('aria-label') || ligne?.getAttribute('title') || el.tagName.toLowerCase();
  };
  const icones = [];
  let incrustations = 0;
  for (const el of aside.querySelectorAll(PORTEURS)) {
    if (!visible(el)) continue;
    /* Une pile se mesure d'un bloc : ses favicons ne sont pas des icônes à part. */
    if (el.parentElement?.closest('[data-pile-favicons]')) continue;
    /* Un dessin dans un dessin n'est pas une seconde icône. */
    if (el.parentElement?.closest('svg')) continue;
    let incrustee = false;
    for (let p = el; p && p !== aside; p = p.parentElement) {
      if (horsFlux(p)) {
        incrustee = true;
        break;
      }
    }
    if (incrustee) {
      incrustations += 1;
      continue;
    }
    /* LA LIGNE de l'icône, et ce qui y occupe de la place À CÔTÉ d'elle : c'est
       ce voisin qui, dans une ligne centrée, pousse l'icône hors de l'axe. */
    const ligne = el.closest('button, a') ?? el.parentElement;
    const voisins = [];
    for (let p = el; p && p !== ligne; p = p.parentElement) {
      for (const frere of p.parentElement?.children ?? []) {
        if (frere === p || horsFlux(frere)) continue;
        const s = getComputedStyle(frere);
        if (s.display === 'none') continue;
        const largeur = frere.getBoundingClientRect().width;
        if (largeur > 0) voisins.push(`${frere.tagName.toLowerCase()} de ${Math.round(largeur * 10) / 10} px`);
      }
    }
    const r = el.getBoundingClientRect();
    icones.push({ nom: nom(el), centre: r.left + r.width / 2 - ra.left, largeur: r.width, voisins });
  }
  return { largeurDeBande: ra.width, icones, incrustations };
};

const arrondi = (n) => Math.round(n * 100) / 100;
const mediane = (valeurs) => {
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);
  return triees.length % 2 ? triees[milieu] : (triees[milieu - 1] + triees[milieu]) / 2;
};

let totalMesure = 0;

/** Juge un lieu : chaque icône de la colonne repliée est sur l'axe commun. */
async function jugerLeLieu(page, lieu, { minimum, capture }) {
  /* Le curseur loin de la colonne : survolée, elle se déplie en surimpression. */
  await page.mouse.move(1100, 500);
  await page.locator(`${ASIDE} [data-panneau-projets="bande"]`).waitFor({ state: 'attached', timeout: 15000 });
  await page.waitForTimeout(500);
  const releve = await page.evaluate(RELEVER, ASIDE);
  if (capture) {
    await page.screenshot({ path: path.join(CAPTURES, `${capture}.png`) });
    await page.locator(ASIDE).screenshot({ path: path.join(CAPTURES, `${capture}-colonne.png`) });
  }
  const icones = releve?.icones ?? [];
  totalMesure += icones.length;
  noter(`${lieu} : la colonne repliée montre ses icônes`, icones.length >= minimum, `${icones.length} icône(s) mesurée(s), ${releve?.incrustations ?? 0} incrustation(s) écartée(s)`);
  if (!icones.length) return releve;
  const axe = mediane(icones.map((i) => i.centre));
  const ecartees = icones.filter((i) => Math.abs(i.centre - axe) > TOLERANCE);
  noter(
    `${lieu} : chaque icône est sur l'axe commun (à ${TOLERANCE} px près)`,
    ecartees.length === 0,
    ecartees.length
      ? ecartees.map((i) => `${i.nom} à ${arrondi(i.centre - axe)} px de l'axe`).join(' ; ')
      : `axe à ${arrondi(axe)} px du bord, plus grand écart ${arrondi(Math.max(...icones.map((i) => Math.abs(i.centre - axe))))} px`,
  );
  noter(
    `${lieu} : cet axe est le milieu de la bande`,
    Math.abs(axe - releve.largeurDeBande / 2) <= TOLERANCE,
    `axe ${arrondi(axe)} px, milieu ${arrondi(releve.largeurDeBande / 2)} px`,
  );
  const accompagnees = icones.filter((i) => i.voisins.length);
  noter(
    `${lieu} : aucune icône ne partage sa ligne avec un voisin qui prend de la place`,
    accompagnees.length === 0,
    accompagnees.map((i) => `${i.nom} : ${i.voisins.join(', ')}`).join(' ; '),
  );
  return releve;
}

async function replier(page, reduite) {
  if (reduite) {
    await page.locator(`${ASIDE} [data-replier-colonne="depliee"]`).click();
    await page.mouse.move(1100, 500);
    await page.locator(`${ASIDE} [data-panneau-projets="bande"]`).waitFor({ state: 'attached', timeout: 15000 });
  } else {
    await page.locator(`${ASIDE} [data-deplier-colonne]:visible`).first().click();
    await page.locator(`${ASIDE} [data-panneau-projets="deplie"]`).waitFor({ state: 'attached', timeout: 15000 });
    await page.mouse.move(1100, 500);
  }
  await page.waitForTimeout(400);
}

async function main() {
  fs.mkdirSync(CAPTURES, { recursive: true });
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  if (!(await attendreLeWeb())) {
    console.error(`Le serveur web de développement n’a pas démarré sur le port ${PORT_WEB} :\n` + journalWeb.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  /* LE RECHARGEMENT À CHAUD EST COUPÉ. Le serveur de développement pousse
     chaque fichier modifié dans la page ouverte ; qu'un autre travail écrive
     dans ce dépôt pendant la mesure, et l'écran se remonte sous le relevé
     (« removeChild … is not a child of this node »). Son canal est donc ouvert
     dans le vide ; celui de l'application (`/ws`) passe normalement. */
  await contexte.routeWebSocket(
    (adresse) => !adresse.pathname.startsWith('/ws'),
    () => {
      /* jamais relié au serveur */
    },
  );
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));

  /* ------------- LA TÊTE DE COLONNE D'UNE CARTE TOUTE NEUVE ------------- */
  // Colonne dépliée : le titre de la carte vaut encore « Nouvelle tâche », et la
  // tête de colonne le répétait juste au-dessus du bouton du même nom.
  await page.goto(`${BASE}/#projet/${PROJET}/tache/${CARTE_NEUVE}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator(`${ASIDE} [data-options-de-carte="${CARTE_NEUVE}"]`).waitFor({ state: 'attached', timeout: 60000 });
  await page.waitForTimeout(800);
  const teteNeuve = ((await page.locator(`${ASIDE} [data-titre-de-colonne]`).textContent().catch(() => '')) ?? '').trim();
  noter('carte toute neuve : la tête de colonne dit « Tâches », pas le titre par défaut', teteNeuve === 'Tâches', `« ${teteNeuve} »`);
  await page.goto(`${BASE}/#projet/${PROJET}/tache/${CARTE}`, { waitUntil: 'domcontentloaded' });
  await page.locator(`${ASIDE} [data-options-de-carte="${CARTE}"]`).waitFor({ state: 'attached', timeout: 30000 });
  await page.waitForTimeout(600);
  const teteTitree = ((await page.locator(`${ASIDE} [data-titre-de-colonne]`).textContent().catch(() => '')) ?? '').trim();
  noter('carte titrée : la tête de colonne garde son titre', teteTitree === 'Carte ordinaire', `« ${teteTitree} »`);

  /* ----------------------- LA COLONNE D'UNE TÂCHE ----------------------- */
  await replier(page, true);
  const onglets = await page
    .locator(`${ASIDE} [data-options-de-carte="${CARTE}"] [data-onglet-carte]`)
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-onglet-carte')));
  noter('tâche : la colonne porte ses quatre onglets', onglets.join(',') === 'chat,comments,billing,github', onglets.join(','));
  noter(
    'tâche : …et la ligne « Marquer comme non lu »',
    (await page.locator(`${ASIDE} [data-menu-non-lu="${CARTE}"]`).count()) === 1,
  );
  await jugerLeLieu(page, 'tâche (conversation)', { minimum: 7, capture: 'colonne-de-carte-repliee' });
  /* Chaque onglet ouvert : la ligne ouverte change, et la roue de chargement
     de « Commentaires » et de « GitHub » passe le temps de la lecture. */
  for (const cle of onglets.filter((c) => c !== 'chat')) {
    await page.locator(`${ASIDE} [data-onglet-carte="${cle}"]`).click();
    await page.locator(`${ASIDE} [data-onglet-carte="${cle}"][aria-current="page"]`).waitFor({ state: 'attached', timeout: 10000 });
    await jugerLeLieu(page, `tâche (onglet ${cle})`, { minimum: 7 });
  }
  /* LA ROUE DE CHARGEMENT elle-même : visible ou non, elle ne tient jamais de
     place dans la ligne — c'était la cause du décalage. */
  const roues = await page.evaluate((selecteur) => {
    const ligne = (cle) => document.querySelector(`${selecteur} [data-onglet-carte="${cle}"]`);
    return ['comments', 'github'].map((cle) => {
      const bouton = ligne(cle);
      const icone = bouton?.querySelector('svg');
      if (!bouton || !icone) return { cle, absente: true };
      const rb = bouton.getBoundingClientRect();
      const ri = icone.getBoundingClientRect();
      return { cle, ecart: Math.round((ri.left + ri.width / 2 - (rb.left + rb.width / 2)) * 100) / 100 };
    });
  }, ASIDE);
  noter(
    'tâche : l’icône de « Commentaires » et de « GitHub » est au milieu de sa ligne',
    roues.every((r) => !r.absente && Math.abs(r.ecart) <= TOLERANCE),
    JSON.stringify(roues),
  );

  /* ----------------------- LA COLONNE D'UN PROJET ----------------------- */
  await page.goto(`${BASE}/#projet/${PROJET}`, { waitUntil: 'domcontentloaded' });
  await page.locator(`${ASIDE} [data-colonne-de-service] [data-options-du-projet] [data-option-du-projet]`).first().waitFor({ state: 'visible', timeout: 30000 });
  await jugerLeLieu(page, 'projet', { minimum: 5, capture: 'colonne-de-projet-repliee' });

  /* --------------------- LA LISTE DES PROJETS --------------------------- */
  await page.goto(`${BASE}/#en-route`, { waitUntil: 'domcontentloaded' });
  await page.locator(`${ASIDE} [data-projet-cible="${PROJET}"]`).first().waitFor({ state: 'visible', timeout: 30000 });
  noter(
    'tableaux de bord : le groupe et ses deux membres sont dans la liste',
    (await page.locator(`${ASIDE} [data-groupe-initiale]:visible`).count()) >= 1 &&
      (await page.locator(`${ASIDE} [data-projet-cible="p-colonnes-a"]:visible, ${ASIDE} [data-projet-cible="p-colonnes-b"]:visible`).count()) === 2,
  );
  await jugerLeLieu(page, 'tableaux de bord', { minimum: 8, capture: 'colonne-des-projets-repliee' });
  /* LE FONDU DES LISTES DE LA COLONNE PREND SON FOND, PAS CELUI DE LA PAGE (14/10/2026) : une pastille peinte
     avec la couleur du voile (`--fond-zone-defilement`), posée DANS la zone qui défile, a la couleur de la colonne. */
  for (const sombre of [false, true]) {
    const fondu = await page.evaluate((enSombre) => {
      document.documentElement.classList.toggle('dark', enSombre);
      const zone = document.querySelector('aside[data-zone="gauche"] [data-drop-root]');
      const panneau = document.querySelector('aside[data-zone="gauche"] [data-panneau-projets]');
      if (!zone || !panneau) return null;
      const temoin = document.createElement('div');
      temoin.style.background = 'var(--fond-zone-defilement, hsl(var(--bg)))';
      zone.appendChild(temoin);
      const voile = getComputedStyle(temoin).backgroundColor;
      temoin.remove();
      return { voile, colonne: getComputedStyle(panneau).backgroundColor };
    }, sombre);
    noter(`${sombre ? 'sombre' : 'clair'} : le fondu des listes de la colonne a la couleur de la colonne`, !!fondu && fondu.voile === fondu.colonne, JSON.stringify(fondu));
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator(`${ASIDE} [data-projet-cible="${PROJET}"]`).first().waitFor({ state: 'attached', timeout: 30000 });

  /* --------------------- UN SERVICE À MENU (la surveillance) ------------------ */
  await page.goto(`${BASE}/#surveillance`, { waitUntil: 'domcontentloaded' });
  await page.locator(`${ASIDE} [data-colonne-de-service]`).first().waitFor({ state: 'attached', timeout: 30000 });
  await jugerLeLieu(page, 'service à menu (surveillance)', { minimum: 2, capture: 'colonne-de-service-repliee' });

  /* ---------- DEVANT UNE PAGE OUVERTE PAR-DESSUS UNE AUTRE (14/10/2026) ----------
     « Nouvelle surveillance » est une page empilée (`Drawer empile`, posée en
     portail APRÈS la colonne) : au même rang, elle passait devant la colonne
     dépliée au survol, qu'on ne voyait plus que par la première lettre de
     chaque ligne. On juge ce qui est réellement AU PREMIER PLAN, point par
     point (`elementFromPoint`), pas une valeur de style. */
  await page.goto(`${BASE}/#surveillance`, { waitUntil: 'domcontentloaded' });
  /* Colonne réduite, le bouton du menu de service est caché : on le déclenche directement. */
  await page.locator('[data-surveillance-nouvelle]').first().waitFor({ state: 'attached', timeout: 30000 });
  await page.evaluate(() => document.querySelector('[data-surveillance-nouvelle]').click());
  await page.locator('[data-surveillance-tiroir="nouvelle"]').waitFor({ state: 'visible', timeout: 15000 });
  const bande = await page.locator(`${ASIDE}`).boundingBox();
  await page.mouse.move(bande.x + bande.width / 2, bande.y + 300);
  await page.locator(`${ASIDE} [data-panneau-projets="deplie"]`).waitFor({ state: 'attached', timeout: 10000 });
  await page.waitForTimeout(400);
  const devant = await page.evaluate(() => {
    const panneau = document.querySelector('aside[data-zone="gauche"] [data-panneau-projets="deplie"]');
    const r = panneau?.getBoundingClientRect();
    if (!r) return { panneau: false };
    // Des points DANS la partie dépliée, au-delà de la bande : là où la page empilée coupait le panneau.
    const points = [0.6, 0.8, 0.95].flatMap((fx) => [0.25, 0.5, 0.75].map((fy) => [r.left + r.width * fx, r.top + r.height * fy]));
    const caches = points.filter(([x, y]) => !panneau.contains(document.elementFromPoint(x, y)));
    return { panneau: true, largeur: Math.round(r.width), caches: caches.length, points: points.length };
  });
  noter('page empilée ouverte : la colonne dépliée au survol passe DEVANT elle', devant.panneau && devant.caches === 0 && devant.largeur > 150, JSON.stringify(devant));
  await page.screenshot({ path: path.join(CAPTURES, 'colonne-devant-page-empilee.png') });
  /* SES MENUS RESTENT DEVANT ELLE : un menu ouvert depuis le pied de la colonne est au premier plan, et se clique. */
  const declencheur = page.locator(`${ASIDE} [data-pied-colonne] [aria-haspopup="menu"]:visible`).first();
  if (await declencheur.count()) {
    await declencheur.click();
    const menu = page.locator('[role="menu"]').first();
    await menu.waitFor({ state: 'visible', timeout: 10000 });
    const menuDevant = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cible = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(20, r.height / 2));
      return { devant: !!cible && el.contains(cible), panneauOuvert: !!document.querySelector('aside[data-zone="gauche"] [data-panneau-projets="deplie"]') };
    });
    noter('…et un menu ouvert depuis la colonne passe devant le panneau, qui reste ouvert', menuDevant.devant && menuDevant.panneauOuvert, JSON.stringify(menuDevant));
    await page.keyboard.press('Escape');
  } else {
    noter('…et un menu ouvert depuis la colonne passe devant le panneau', false, 'aucun menu dans le pied de la colonne');
  }
  await page.mouse.move(1100, 500);

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await navigateur.close();

  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${totalMesure} mesure(s) d'icône au total`);
  console.log(`${results.length - echecs.length}/${results.length} vérifications passées`);
  console.log(`(captures : ${CAPTURES})`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.slice(-20).join(''));
  console.error(journalWeb.slice(-20).join(''));
  process.exit(1);
});
