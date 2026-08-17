#!/usr/bin/env node
/**
 * LE PERSONNAGE DE CHAQUE COLONNE — vu dans un VRAI navigateur, sur son PROPRE
 * démon (base neuve, dossier de projets vide, port libre : le démon de
 * production n'est pas touché, aucun moteur appelé, aucun quota dépensé).
 *
 * Ce qu'on contrôle, colonne par colonne, à l'ORDINATEUR et au TÉLÉPHONE :
 *  - l'image est là et le navigateur l'a VRAIMENT chargée (une image absente
 *    ne se voit pas : elle laisse un vide de la bonne taille) ;
 *  - elle DÉPASSE en haut et à gauche, d'un cheveu seulement, et ce
 *    dépassement reste VISIBLE — le rail du tableau ne doit pas le couper ;
 *  - elle n'attrape aucun clic : le dépôt d'une carte se résout par
 *    `closest('[data-column]')` sur l'élément sous le doigt ;
 *  - le libellé lui laisse la place sans la chevaucher, et le groupe de droite
 *    (compteur, boutons) reste aligné d'une colonne à l'autre ;
 *  - amener une colonne au bord marche toujours : l'enveloppe ajoutée pour le
 *    personnage pourrait fausser `offsetLeft`, dont dépend ce geste.
 *
 *   node scripts/verif-personnages-colonnes.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKODEV_PERSONNAGES_PORT || 7213);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-personnages-'));

const COLONNES = ['notes', 'planned', 'running', 'done', 'to_deploy', 'in_production', 'archived'];

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
for (const dossier of [DATA, PROJETS, DEPOT]) fs.mkdirSync(dossier, { recursive: true });

execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
  cwd: DEPOT,
});

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    HAIKODEV_PORT: String(PORT),
    HAIKODEV_HOST: '127.0.0.1',
    HAIKODEV_DATA: DATA,
    HAIKODEV_PROJECTS_ROOT: PROJETS,
    HAIKODEV_WEB: path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const journal = [];
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));

const ranger = () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
};
process.on('exit', ranger);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    ranger();
    process.exit(130);
  });
}

async function attendrePort(limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function attendreLaBase(limiteMs = 30000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
      db.close();
      if (table) return true;
    } catch {
      /* base pas encore là */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-personnages';

function poserLeProjet() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification des personnages de colonne',
  );

  // Aucun agent ne doit pouvoir démarrer : rien ici n'appelle un moteur.
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: 'Projet aux personnages',
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

  // Une carte par colonne : le personnage ne doit pas manger l'espace des cartes.
  const poser = db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, description, data, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, 'Carte de contrôle', '{}', ?, ?)`,
  );
  db.transaction(() => {
    for (const colonne of COLONNES) {
      poser.run(`c-${colonne}`, PROJET_ID, colonne, `Carte ${colonne}`, maintenant, maintenant);
    }
  })();
  db.close();
}

async function ouvrir(navigateur, viewport) {
  const contexte = await navigateur.newContext({
    viewport,
    locale: 'fr-CH',
    serviceWorkers: 'block',
    hasTouch: viewport.width < 700,
    isMobile: viewport.width < 700,
  });
  await contexte.addCookies([
    { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-column="planned"]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  return { page, erreurs };
}

/** Ce que le navigateur voit RÉELLEMENT de chaque personnage. */
const releve = (page) =>
  page.evaluate(() => {
    const rail = document.querySelector('[data-column]')?.parentElement;
    const railRect = rail?.getBoundingClientRect();
    return Array.from(document.querySelectorAll('[data-personnage-colonne]')).map((img) => {
      const colonne = img.getAttribute('data-personnage-colonne');
      const boite = document.querySelector(`[data-column="${colonne}"]`);
      const entete = document.querySelector(`[data-tete-colonne="${colonne}"]`);
      const libelle = entete?.querySelector('h2');
      const groupeDroite = entete?.lastElementChild;
      const r = img.getBoundingClientRect();
      const rc = boite?.getBoundingClientRect();
      const rl = libelle?.getBoundingClientRect();
      const rd = groupeDroite?.getBoundingClientRect();
      // Le point sous le coin BAS-DROIT de l'image — celui qui retombe DANS la
      // colonne, le reste de l'image dépassant au-dehors : il doit désigner la
      // colonne, jamais l'image (sinon un dépôt de carte échouerait là).
      // Un point PRIS DANS L'IMAGE, à l'endroit où elle recouvre l'entête de sa
      // colonne : c'est là qu'elle volerait un clic si elle le pouvait.
      const re = entete?.getBoundingClientRect();
      const point = { x: r.right - 3, y: re ? re.top + re.height / 2 : r.bottom - 3 };
      /*
       * Une colonne n'est mesurable que si ce point tombe DANS le rail : le
       * tableau est plus large que la fenêtre, et une colonne poussée hors de
       * lui répondrait la colonne de gauche ou rien du tout — ce qui ne dirait
       * rien du personnage.
       */
      const mesurable =
        !!railRect &&
        point.x >= railRect.left &&
        point.x <= railRect.right &&
        point.y >= railRect.top &&
        point.y <= railRect.bottom;
      // La PILE complète sous ce point : une image en `pointer-events: none`
      // n'y figure pas du tout, et c'est la seule chose qui décide si un clic
      // l'atteint. Lire « quel élément se trouve dessous » dépendrait, lui, de
      // la mise en page du moment (une carte en cours d'animation, par exemple).
      const pile = mesurable ? document.elementsFromPoint(point.x, point.y) : [];
      return {
        colonne,
        chargee: img.complete && img.naturalWidth > 0,
        source: img.getAttribute('src'),
        debordeGauche: rc ? Math.round(rc.left - r.left) : null,
        debordeHaut: rc ? Math.round(rc.top - r.top) : null,
        hauteur: Math.round(r.height),
        largeur: Math.round(r.width * 10) / 10,
        /*
         * Le rail ne défile QUE de gauche à droite : ce qui dépasse par le HAUT
         * est donc coupé net s'il sort de sa boîte (le débordement latéral, lui,
         * dépend de l'endroit où le tableau est glissé — il ne prouve rien).
         */
        hautVisible: railRect ? r.top >= railRect.top - 0.5 : false,
        // Le libellé commence-t-il APRÈS le personnage ?
        libelleApres: rl ? Math.round(rl.left - r.right) : null,
        // Le groupe de droite, mesuré depuis le bord droit de sa colonne.
        margeDroite: rd && rc ? Math.round(rc.right - rd.right) : null,
        mesurable,
        clicPossible: getComputedStyle(img).pointerEvents === 'none',
        danslaPile: pile.includes(img),
        dessous: pile[0] ? `${pile[0].tagName.toLowerCase()}.${String(pile[0].className).slice(0, 50)}` : 'rien',
      };
    });
  });

async function passe(navigateur, viewport, etiquette) {
  const { page, erreurs } = await ouvrir(navigateur, viewport);
  try {
    const vus = await releve(page);
    noter(`${etiquette} · les sept colonnes portent leur personnage`, vus.length === COLONNES.length, `${vus.length}`);

    const manquantes = vus.filter((v) => !v.chargee);
    noter(
      `${etiquette} · chaque image est vraiment chargée par le navigateur`,
      manquantes.length === 0,
      manquantes.map((v) => `${v.colonne} (${v.source})`).join(', '),
    );

    const malPlaces = vus.filter(
      (v) => !(v.debordeGauche > 0 && v.debordeGauche <= 12 && v.debordeHaut > 0 && v.debordeHaut <= 12),
    );
    noter(
      `${etiquette} · le personnage dépasse en haut et à gauche, d'un cheveu`,
      malPlaces.length === 0,
      malPlaces.map((v) => `${v.colonne} : ${v.debordeGauche}px / ${v.debordeHaut}px`).join(' ; ') ||
        `${vus[0]?.debordeGauche}px à gauche, ${vus[0]?.debordeHaut}px en haut, hauteur ${vus[0]?.hauteur}px`,
    );

    const coupes = vus.filter((v) => !v.hautVisible);
    noter(
      `${etiquette} · le dépassement par le haut reste visible, le tableau ne le coupe pas`,
      coupes.length === 0,
      coupes.map((v) => v.colonne).join(', '),
    );

    // Les colonnes hors écran ne se mesurent pas : le tableau est plus large
    // que la fenêtre, et une colonne invisible ne prouverait rien.
    const mesurees = vus.filter((v) => v.mesurable);
    const bloquantes = vus.filter((v) => !v.clicPossible).concat(mesurees.filter((v) => v.danslaPile));
    noter(
      `${etiquette} · le personnage n'attrape aucun clic : le geste traverse jusqu'à la colonne`,
      mesurees.length > 0 && bloquantes.length === 0,
      bloquantes.length
        ? bloquantes.map((v) => `${v.colonne} → ${v.dessous}`).join(' ; ')
        : `${mesurees.length} colonne(s) mesurée(s) à l'écran`,
    );

    const chevauchees = vus.filter((v) => !(v.libelleApres >= 0));
    noter(
      `${etiquette} · le libellé se décale et ne chevauche pas le personnage`,
      chevauchees.length === 0,
      chevauchees.map((v) => `${v.colonne} : ${v.libelleApres}px`).join(' ; '),
    );

    const marges = new Set(vus.map((v) => v.margeDroite));
    noter(
      `${etiquette} · compteurs et boutons restent alignés d'une colonne à l'autre`,
      marges.size === 1,
      [...marges].join(' / '),
    );

    // L'enveloppe ajoutée pour le personnage ne doit pas fausser `offsetLeft` :
    // sans quoi le tableau ne saurait plus amener une colonne au bord.
    const glisse = await page.evaluate(() => {
      const cible = document.querySelector('[data-column="done"]');
      const rail = cible?.parentElement;
      if (!cible || !rail) return null;
      rail.scrollLeft = cible.offsetLeft - 12;
      return Math.round(cible.getBoundingClientRect().left - rail.getBoundingClientRect().left);
    });
    noter(
      `${etiquette} · amener une colonne au bord vise toujours juste`,
      glisse !== null && Math.abs(glisse - 12) <= 4,
      `« Terminé » posée à ${glisse}px du bord`,
    );

    noter(`${etiquette} · aucune erreur de page`, erreurs.length === 0, erreurs[0] ?? '');
  } finally {
    await page.context().close();
  }
}

/** Les portraits ronds sont servis : c'est eux que porteront les notifications. */
async function portraits() {
  for (const colonne of COLONNES) {
    const reponse = await fetch(`${BASE}/personnages/${colonne}-rond.png`, {
      headers: { cookie: `haikodev_session=${jeton}` },
    });
    const octets = reponse.ok ? Buffer.from(await reponse.arrayBuffer()) : Buffer.alloc(0);
    const carre = octets.length > 24 && octets.readUInt32BE(16) === octets.readUInt32BE(20);
    noter(
      `le portrait rond de « ${colonne} » est servi, et carré`,
      reponse.ok && carre,
      reponse.ok ? `${octets.readUInt32BE(16)}×${octets.readUInt32BE(20)}` : `HTTP ${reponse.status}`,
    );
  }
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  if (!(await attendreLaBase())) {
    console.error(`La base d’essai est restée vide : le port ${PORT} est peut-être déjà pris.`);
    process.exit(1);
  }
  poserLeProjet();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  try {
    await passe(navigateur, { width: 1400, height: 900 }, 'ordinateur');
    await passe(navigateur, { width: 390, height: 844 }, 'téléphone');
  } finally {
    await navigateur.close();
  }
  await portraits();

  const echecs = resultats.filter((r) => !r.ok);
  console.log('');
  console.log(`${resultats.length - echecs.length}/${resultats.length} contrôle(s) au vert.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
