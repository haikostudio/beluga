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
 * Puis DEUX ajouts qui ne dépendent d'aucun agent :
 *  - le MOUVEMENT : immobilité totale au repos, animation lente et pieds au sol
 *    quand la classe du travail est posée, plus rien du tout sous « réduire les
 *    animations » ;
 *  - le REMPLACEMENT depuis les réglages : image déposée, détourée, servie à la
 *    même adresse dans ses deux découpes, refus dits en clair, retour à
 *    l'original à l'octet près.
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

/**
 * PLUS UN SEUL PIXEL DE FOND, VU SUR FOND SOMBRE — le défaut ne se voit que là.
 *
 * Le détourage part des bords et progresse de proche en proche : il n'atteignait
 * pas les POCHES ENCLAVÉES (l'espace entre les jambes, la boucle d'un bras
 * replié), et laissait sa part la plus sombre de l'ombre entre les chaussures.
 * On repose donc chaque silhouette sur le fond du thème sombre et on cherche la
 * plus grosse tache PÂLE ET SANS COULEUR : c'est la signature du fond, jamais
 * celle de la pâte à modeler, colorée.
 *
 * Ce qui reste et doit rester : le blanc des yeux et les reflets, quelques
 * pixels épars en haut du personnage. Avant correction, la tache la plus grosse
 * pesait 84 à 258 pixels sur les sept ; après, 4 à 23. Le seuil est posé entre
 * les deux, avec de la marge des deux côtés.
 *
 * Le PORTRAIT rond n'est pas jugé ici : il repose sur un disque crème plein, où
 * une poche de fond oubliée se confondrait avec le disque — invisible par
 * construction, donc rien à mesurer.
 */
const TACHE_PALE_MAX = 30;

/**
 * LA MESURE, écrite une seule fois et injectée dans la page : les silhouettes
 * fixes et les images de la BOUCLE ANIMÉE se jugent exactement pareil, sinon
 * l'une des deux dériverait sans qu'on le voie. Elle prend tout ce que
 * `drawImage` accepte — une `Image` ou une image décodée d'une animation.
 */
const SOURCE_DE_LA_MESURE = `(image) => {
      // Le fond du thème sombre : c'est là, et seulement là, qu'un reste de fond
      // clair se voit.
      const FOND = [17, 20, 26];
      {
        const toile = document.createElement('canvas');
        // Une image de page porte \`naturalWidth\`, une image DÉCODÉE d'une
        // animation porte \`displayWidth\` ou \`width\` : on prend ce qui existe.
        toile.width = image.naturalWidth || image.displayWidth || image.width;
        toile.height = image.naturalHeight || image.displayHeight || image.height;
        const ctx = toile.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        const { data, width, height } = ctx.getImageData(0, 0, toile.width, toile.height);
        const pale = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i += 1) {
          const a = data[i * 4 + 3] / 255;
          const c = [0, 1, 2].map((k) => data[i * 4 + k] * a + FOND[k] * (1 - a));
          const clair = Math.max(...c);
          const saturation = clair - Math.min(...c);
          pale[i] = clair >= 150 && saturation <= 25 ? 1 : 0;
        }
        // La plus grosse tache d'un seul tenant : une poche de fond est une
        // FLAQUE, un reflet d'œil quelques pixels épars.
        let pire = 0;
        let pireY = 0;
        for (let depart = 0; depart < pale.length; depart += 1) {
          if (pale[depart] !== 1) continue;
          const pile = [depart];
          pale[depart] = 2;
          let aire = 0;
          let hautY = height;
          while (pile.length) {
            const p = pile.pop();
            aire += 1;
            const x = p % width;
            const y = (p - x) / width;
            hautY = Math.min(hautY, y);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              const q = ny * width + nx;
              if (pale[q] === 1) {
                pale[q] = 2;
                pile.push(q);
              }
            }
          }
          if (aire > pire) {
            pire = aire;
            pireY = hautY;
          }
        }
        return { pire, pireY, hauteur: height };
      }
    }`;

async function fondVisible(page) {
  const vus = await page.evaluate(
    async ({ colonnes, sourceMesure }) => {
      const mesurer = eval(sourceMesure);
      const lues = [];
      for (const colonne of colonnes) {
        const image = new Image();
        image.src = `/personnages/${colonne}.png`;
        // eslint-disable-next-line no-await-in-loop
        await image.decode();
        lues.push({ colonne, ...mesurer(image) });
      }
      return lues;
    },
    { colonnes: COLONNES, sourceMesure: SOURCE_DE_LA_MESURE },
  );

  for (const vu of vus) {
    noter(
      `« ${vu.colonne} » : aucune flaque de fond sur le thème sombre`,
      vu.pire <= TACHE_PALE_MAX,
      `plus grosse tache pâle ${vu.pire} px (seuil ${TACHE_PALE_MAX}), à ${Math.round(
        (vu.pireY / vu.hauteur) * 100,
      )} % de la hauteur`,
    );
  }
}

/**
 * LA BOUCLE ANIMÉE DE « EN COURS » — le mineur qui pioche pendant qu'un agent
 * travaille. Cinq choses se vérifient, et aucune ne dépend d'un agent qui
 * tournerait vraiment (le plafond est à zéro ici) :
 *
 *  - elle est SERVIE, et c'est bien un WebP animé de plusieurs images : un
 *    fichier d'une seule image passerait inaperçu et le mineur resterait figé
 *    pendant tout le travail ;
 *  - elle PÈSE peu : cette image part à chaque affichage du tableau ;
 *  - elle a EXACTEMENT la boîte des silhouettes fixes, donc rien ne saute ni ne
 *    change de taille à la bascule ;
 *  - TOUTES ses images sont détourées — pas seulement la première : le fond
 *    clair d'une seule image clignoterait une fois par tour ;
 *  - posée sur la vraie tête de colonne, elle n'y déplace RIEN et n'attrape
 *    toujours aucun clic (le dépôt d'une carte vise la colonne).
 *
 * QUAND elle est posée (agent au travail, personnage non remplacé, animations
 * non réduites) se vérifie sans navigateur, par `gesteDuPersonnage`.
 */
const POIDS_MAX_BOUCLE = 120 * 1024;

async function boucleAnimee(page) {
  const reponse = await fetch(`${BASE}/personnages/running-anime.webp`, {
    headers: { cookie: `haikodev_session=${jeton}` },
  });
  const octets = reponse.ok ? Buffer.from(await reponse.arrayBuffer()) : Buffer.alloc(0);
  // Un WebP est un conteneur RIFF : chaque image d'une animation y est un
  // morceau « ANMF ». Les compter dit si le fichier est vraiment animé.
  const images = octets.toString('latin1').split('ANMF').length - 1;
  noter(
    'la boucle animée de « En cours » est servie, et vraiment animée',
    reponse.ok && images >= 2,
    reponse.ok ? `${images} image(s) · ${Math.round(octets.length / 1024)} Ko` : `HTTP ${reponse.status}`,
  );
  noter(
    'elle reste légère : le tableau la redemande à chaque affichage',
    octets.length > 0 && octets.length <= POIDS_MAX_BOUCLE,
    `${Math.round(octets.length / 1024)} Ko (seuil ${Math.round(POIDS_MAX_BOUCLE / 1024)} Ko)`,
  );

  const vu = await page.evaluate(
    async ({ sourceMesure }) => {
      const mesurer = eval(sourceMesure);
      const fixe = new Image();
      fixe.src = '/personnages/running.png';
      await fixe.decode();

      // TOUTES les images de la boucle, une à une. `ImageDecoder` est le seul
      // moyen d'atteindre autre chose que la première : un `<img>` posé sur une
      // toile ne rend jamais que celle-là.
      const flux = await fetch('/personnages/running-anime.webp');
      const decodeur = new ImageDecoder({ data: await flux.arrayBuffer(), type: 'image/webp' });
      // DEUX attentes, et pas une : `completed` dit que les octets sont lus,
      // `tracks.ready` que la piste est décrite. Sans la seconde, la piste
      // choisie est encore nulle et le compte d'images est introuvable.
      await decodeur.completed;
      await decodeur.tracks.ready;
      const nombre = decodeur.tracks.selectedTrack.frameCount;
      const flaques = [];
      let taille = null;
      for (let index = 0; index < nombre; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        const { image } = await decodeur.decode({ frameIndex: index });
        flaques.push(mesurer(image).pire);
        taille = { largeur: image.displayWidth, hauteur: image.displayHeight };
        image.close();
      }

      // Posée sur la VRAIE tête de colonne, à la place de l'image fixe.
      const posee = document.querySelector('[data-personnage-colonne="running"]');
      const avant = posee.getBoundingClientRect();
      const teteAvant = document.querySelector('[data-tete-colonne="running"]').getBoundingClientRect();
      posee.src = '/personnages/running-anime.webp';
      await posee.decode();
      const apres = posee.getBoundingClientRect();
      const teteApres = document.querySelector('[data-tete-colonne="running"]').getBoundingClientRect();
      const milieu = document.elementFromPoint(apres.left + apres.width / 2, apres.top + apres.height / 2);

      return {
        nombre,
        taille,
        flaques,
        fixe: { largeur: fixe.naturalWidth, hauteur: fixe.naturalHeight },
        immobile:
          Math.abs(avant.left - apres.left) < 0.5 &&
          Math.abs(avant.top - apres.top) < 0.5 &&
          Math.abs(avant.width - apres.width) < 0.5 &&
          Math.abs(avant.height - apres.height) < 0.5 &&
          Math.abs(teteAvant.left - teteApres.left) < 0.5 &&
          Math.abs(teteAvant.height - teteApres.height) < 0.5,
        transparente: !!milieu?.closest('[data-column="running"]') && milieu !== posee,
      };
    },
    { sourceMesure: SOURCE_DE_LA_MESURE },
  );

  noter(
    'elle a exactement la boîte des personnages fixes',
    vu.taille?.largeur === vu.fixe.largeur && vu.taille?.hauteur === vu.fixe.hauteur,
    `boucle ${vu.taille?.largeur}×${vu.taille?.hauteur} · fixe ${vu.fixe.largeur}×${vu.fixe.hauteur}`,
  );
  const pire = Math.max(0, ...vu.flaques);
  noter(
    `aucune flaque de fond sur les ${vu.nombre} images de la boucle`,
    vu.flaques.length === vu.nombre && vu.nombre >= 2 && pire <= TACHE_PALE_MAX,
    `plus grosse tache pâle ${pire} px (seuil ${TACHE_PALE_MAX})`,
  );
  noter(
    'posée en tête de colonne, elle ne déplace rien et n’attrape aucun clic',
    vu.immobile && vu.transparente,
    `${vu.immobile ? 'rien ne bouge' : 'la mise en page a bougé'} · ${vu.transparente ? 'clic transmis à la colonne' : 'clic intercepté'}`,
  );
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

/**
 * L'IMAGE D'ESSAI : un sujet coloré posé sur un fond clair uni — exactement ce
 * que l'écran des réglages demande à l'utilisateur. Fabriquée une fois, elle
 * sert au geste dans le navigateur comme à l'appel direct.
 */
const IMAGE_D_ESSAI = path.join(TMP, 'depot.png');
function fabriquerLImageDEssai() {
  try {
    execFileSync('python3', [
      '-c',
      [
        'from PIL import Image, ImageDraw',
        'im = Image.new("RGB", (400, 500), (250, 249, 247))',
        'd = ImageDraw.Draw(im)',
        'd.ellipse((150, 60, 250, 170), fill=(210, 120, 90))',
        'd.rounded_rectangle((140, 170, 260, 400), 20, fill=(80, 130, 190))',
        `im.save(${JSON.stringify(IMAGE_D_ESSAI)})`,
      ].join('\n'),
    ]);
    return true;
  } catch (err) {
    noter('une image d’essai a pu être fabriquée (Pillow présent)', false, String(err?.message ?? err));
    return false;
  }
}

/**
 * LE MOUVEMENT DU PERSONNAGE DE « EN COURS ». Aucun agent ne tourne ici (le
 * plafond est à zéro), donc on contrôle deux choses complémentaires :
 *  - AU REPOS, les sept sont parfaitement immobiles — c'est ce contraste qui
 *    porte l'information ;
 *  - la classe du mouvement, POSÉE À LA MAIN sur la vraie image, anime bien ;
 *    et sous « réduire les animations », elle n'anime plus rien.
 * Quand la classe est posée (donc quand un agent travaille) est vérifié à part,
 * sans navigateur, par `personnageEnMouvement`.
 */
async function mouvement(navigateur) {
  for (const reduit of [false, true]) {
    const contexte = await navigateur.newContext({
      viewport: { width: 1400, height: 900 },
      locale: 'fr-CH',
      serviceWorkers: 'block',
      reducedMotion: reduit ? 'reduce' : 'no-preference',
    });
    await contexte.addCookies([
      { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await contexte.newPage();
    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('[data-personnage-colonne="running"]', { timeout: 30000 });
      const vu = await page.evaluate(() => {
        const images = Array.from(document.querySelectorAll('[data-personnage-colonne]'));
        const auRepos = images.map((img) => ({
          colonne: img.getAttribute('data-personnage-colonne'),
          vivant: img.getAttribute('data-personnage-vivant'),
          animation: getComputedStyle(img).animationName,
        }));
        const enCours = document.querySelector('[data-personnage-colonne="running"]');
        enCours.classList.add('origin-bottom', 'animate-personnage-au-travail');
        const style = getComputedStyle(enCours);
        const boite = enCours.getBoundingClientRect();
        // `transform-origin` est rendu en PIXELS par le navigateur : « pieds au
        // sol » se lit donc à la hauteur de l'image, pas au mot « bottom ».
        const [x, y] = style.transformOrigin.split(' ').map(parseFloat);
        return {
          auRepos,
          anime: style.animationName,
          duree: style.animationDuration,
          origine: style.transformOrigin,
          piedsAuSol: Math.abs(y - boite.height) < 1 && Math.abs(x - boite.width / 2) < 1,
        };
      });

      if (!reduit) {
        const remuants = vu.auRepos.filter((v) => v.animation !== 'none' || v.vivant !== 'non');
        noter(
          'au repos, les sept personnages sont parfaitement immobiles',
          remuants.length === 0,
          remuants.map((v) => `${v.colonne} : ${v.animation}`).join(' ; ') || `${vu.auRepos.length} colonnes muettes`,
        );
        noter(
          'la classe du travail anime « En cours », lentement et pieds au sol',
          vu.anime === 'personnage-au-travail' && parseFloat(vu.duree) >= 1.5 && vu.piedsAuSol,
          `${vu.anime} · ${vu.duree} · origine ${vu.origine}`,
        );
      } else {
        noter(
          '« réduire les animations » coupe le mouvement, sans faire disparaître le personnage',
          vu.anime === 'none',
          vu.anime,
        );
      }
    } finally {
      await contexte.close();
    }
  }
}

/**
 * REMPLACER UN PERSONNAGE DEPUIS LES RÉGLAGES, bout en bout et sans navigateur :
 * l'image part par la même porte que celle de l'écran, le démon la détoure, la
 * sert à la place de l'original, puis la rend à l'original quand on l'efface.
 * Les refus doivent être DITS, avec leur raison.
 */
async function remplacement() {
  const colonne = 'notes';
  const adresse = (chemin) => `${BASE}${chemin}`;
  const entetes = { cookie: `haikodev_session=${jeton}` };
  const lire = async (chemin) => {
    const reponse = await fetch(adresse(chemin), { headers: entetes });
    return reponse.ok ? Buffer.from(await reponse.arrayBuffer()) : Buffer.alloc(0);
  };

  const origine = await lire(`/personnages/${colonne}.png`);

  const source = IMAGE_D_ESSAI;
  const depot = await fetch(adresse(`/api/personnage?colonne=${colonne}`), {
    method: 'POST',
    headers: { ...entetes, 'content-type': 'image/png', 'x-file-name': 'depot.png' },
    body: fs.readFileSync(source),
  });
  const issue = await depot.json().catch(() => ({}));
  noter('une image déposée remplace le personnage de sa colonne', depot.ok && issue.ok === true, issue.error ?? '');

  const remplacant = await lire(`/personnages/${colonne}.png`);
  const rond = await lire(`/personnages/${colonne}-rond.png`);
  noter(
    'la silhouette servie est bien la nouvelle, à la même adresse et au même gabarit',
    remplacant.length > 0 && !remplacant.equals(origine) && remplacant.readUInt32BE(16) === 126 && remplacant.readUInt32BE(20) === 168,
    remplacant.length ? `${remplacant.readUInt32BE(16)}×${remplacant.readUInt32BE(20)}` : 'rien servi',
  );
  noter(
    'le portrait rond suit : les notifications ne gardent pas l’ancien visage',
    rond.length > 0 && rond.readUInt32BE(16) === rond.readUInt32BE(20) && rond.readUInt32BE(16) === 192,
    rond.length ? `${rond.readUInt32BE(16)}×${rond.readUInt32BE(20)}` : 'rien servi',
  );

  for (const [nom, requete] of [
    [
      'une colonne inconnue',
      () =>
        fetch(adresse('/api/personnage?colonne=nulle-part'), {
          method: 'POST',
          headers: { ...entetes, 'content-type': 'image/png', 'x-file-name': 'x.png' },
          body: Buffer.from('peu importe'),
        }),
    ],
    [
      'un fichier qui n’est pas une image',
      () =>
        fetch(adresse(`/api/personnage?colonne=${colonne}`), {
          method: 'POST',
          headers: { ...entetes, 'content-type': 'text/plain', 'x-file-name': 'notes.txt' },
          body: Buffer.from('bonjour'),
        }),
    ],
    [
      'une image sans personnage dessus',
      () =>
        fetch(adresse(`/api/personnage?colonne=${colonne}`), {
          method: 'POST',
          headers: { ...entetes, 'content-type': 'image/png', 'x-file-name': 'blanc.png' },
          body: execFileSync('python3', [
            '-c',
            'import sys\nfrom PIL import Image\nImage.new("RGB",(80,80),(255,255,255)).save(sys.stdout.buffer, "PNG")',
          ], { maxBuffer: 1 << 20 }),
        }),
    ],
  ]) {
    const reponse = await requete();
    const dit = await reponse.json().catch(() => ({}));
    noter(
      `refus dit en clair : ${nom}`,
      !reponse.ok && dit.ok === false && typeof dit.error === 'string' && dit.error.length > 10,
      dit.error ?? `HTTP ${reponse.status}`,
    );
  }

  // Le refus n'a rien abîmé : le remplaçant déposé plus haut est toujours là.
  const apresRefus = await lire(`/personnages/${colonne}.png`);
  noter('un dépôt refusé laisse le personnage précédent intact', apresRefus.equals(remplacant));

  const retour = await fetch(adresse(`/api/personnage?colonne=${colonne}`), { method: 'DELETE', headers: entetes });
  const ditRetour = await retour.json().catch(() => ({}));
  const revenu = await lire(`/personnages/${colonne}.png`);
  noter(
    'revenir au personnage d’origine rend exactement l’image livrée',
    retour.ok && ditRetour.ok === true && revenu.equals(origine),
    ditRetour.error ?? `${revenu.length} octets`,
  );

  const deuxiemeRetour = await fetch(adresse(`/api/personnage?colonne=${colonne}`), { method: 'DELETE', headers: entetes });
  const ditDeux = await deuxiemeRetour.json().catch(() => ({}));
  noter(
    'revenir deux fois de suite le dit, au lieu de faire semblant',
    !deuxiemeRetour.ok && typeof ditDeux.error === 'string',
    ditDeux.error ?? '',
  );
}

/**
 * LE GESTE RÉEL, DANS L'ÉCRAN DES RÉGLAGES : on ouvre l'onglet « Personnages »,
 * on dépose une image sur une colonne, le personnage change sous les yeux et le
 * retour à l'original est proposé — puis rendu. Un fichier refusé écrit sa
 * raison sous la colonne concernée, au lieu de ne rien faire.
 */
async function ecranDesReglages(navigateur) {
  const colonne = 'planned';
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-column="planned"]', { timeout: 30000 });
    await page.click('button:has-text("places")');
    // Par son RÔLE et son nom EXACT : « has-text » attrape aussi la ligne du
    // projet d'essai, dont le nom contient le mot.
    await page.getByRole('tab', { name: 'Personnages', exact: true }).click();
    await page.waitForSelector('[data-personnage-reglage]', { timeout: 15000 });

    const lignes = await page.locator('[data-personnage-reglage]').count();
    noter('les réglages proposent les sept colonnes', lignes === COLONNES.length, `${lignes}`);

    const source = path.join(TMP, 'depot.png');
    await page.setInputFiles(`[data-personnage-fichier="${colonne}"]`, source);
    await page.waitForSelector(`[data-personnage-retablir="${colonne}"]`, { timeout: 30000 });
    const apercu = await page.getAttribute(`[data-personnage-apercu="${colonne}"]`, 'src');
    const surLeTableau = await page.getAttribute(`[data-personnage-colonne="${colonne}"]`, 'src');
    noter(
      'le personnage déposé se voit aussitôt, dans les réglages comme sur le tableau',
      /\?v=\d+/.test(apercu ?? '') && /\?v=\d+/.test(surLeTableau ?? ''),
      `${apercu} · ${surLeTableau}`,
    );

    const refuse = path.join(TMP, 'refuse.txt');
    fs.writeFileSync(refuse, 'ceci n’est pas une image');
    await page.setInputFiles(`[data-personnage-fichier="${colonne}"]`, refuse);
    await page.waitForSelector(`[data-personnage-refus="${colonne}"]`, { timeout: 20000 });
    const raison = (await page.textContent(`[data-personnage-refus="${colonne}"]`)) ?? '';
    noter('un dépôt refusé écrit sa raison sous la colonne', raison.length > 10, raison);

    await page.click(`[data-personnage-retablir="${colonne}"]`);
    await page.waitForSelector(`[data-personnage-retablir="${colonne}"]`, { state: 'detached', timeout: 20000 });
    const rendu = await page.getAttribute(`[data-personnage-apercu="${colonne}"]`, 'src');
    noter("« Revenir à l'original » remet l'image livrée", !/\?v=/.test(rendu ?? ''), rendu ?? '');
  } finally {
    await contexte.close();
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
  const imagePrete = fabriquerLImageDEssai();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  try {
    await passe(navigateur, { width: 1400, height: 900 }, 'ordinateur');
    await passe(navigateur, { width: 390, height: 844 }, 'téléphone');
    const { page } = await ouvrir(navigateur, { width: 1400, height: 900 });
    try {
      await fondVisible(page);
      // La boucle se pose sur la vraie tête de colonne : elle passe APRÈS les
      // mesures des images fixes, qui lisent cette même image.
      await boucleAnimee(page);
    } finally {
      await page.context().close();
    }
    await mouvement(navigateur);
    if (imagePrete) await ecranDesReglages(navigateur);
  } finally {
    await navigateur.close();
  }
  await portraits();
  if (imagePrete) await remplacement();

  const echecs = resultats.filter((r) => !r.ok);
  console.log('');
  console.log(`${resultats.length - echecs.length}/${resultats.length} contrôle(s) au vert.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
