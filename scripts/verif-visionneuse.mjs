#!/usr/bin/env node
/**
 * LA VISIONNEUSE D'IMAGES, DANS UN VRAI NAVIGATEUR.
 *
 * Une seule visionneuse pour toute l'application (`AttachmentPreview`, l'espace
 * client n'en ayant plus qu'un adaptateur) : fenêtre CENTRÉE de hauteur FIXE,
 * image sur toute la hauteur, zoom au clic / double toucher, carrousel qui
 * BOUCLE, menu « Cette image / Tout en une archive / Toutes séparément », et
 * l'archive qui refuse une pièce inconnue, et un gros lot de 400 images qui
 * passe par une adresse courte.
 *
 * ET LA BANDE « CE QUE L'AGENT A VU » D'UNE CARTE : le temps écoulé (« il y a
 * 3 h », comme le fil) en bas à droite de chaque vignette (depuis l'étape, pas
 * depuis le rangement de la pièce), celui d'un SON visible dans son cadre, la
 * date et l'heure sous le nom dans la visionneuse, et l'œil des images déjà
 * ouvertes en grand — absent à la première ouverture, présent au retour, gardé
 * au SERVEUR par compte : on le retrouve après rechargement et sur un autre
 * appareil (le téléphone du même compte). SUR TÉLÉPHONE, LA BANDE EST
 * REPLIÉE DANS UN BOUTON PHOTO (27/10/2026) : fermé à l'arrivée, il grandit en
 * volet flottant (découpe qui part du cercle), sans déplacer le pied, se
 * referme par le chevron, et son badge compte les images arrivées depuis.
 *
 * ET LES COMMANDES DE L'ŒIL, pour une carte à centaines d'images : le filtre
 * « pas encore vues » (il n'agit que sur les vignettes, la visionneuse garde
 * la série entière), le bouton « tout marquer comme vu », l'œil de l'onglet
 * des pièces jointes du projet (filtre et bouton ne comptent que les images
 * de l'AGENT) et l'œil des images d'une note.
 *
 * UNE CONSTRUCTION DE DÉVELOPPEMENT SE JUGE AUSSI : avec
 * `BELUGA_VISIONNEUSE_WEB=<dossier construit en mode développement>`, la
 * console du navigateur est relevée, et le moindre avertissement de React fait
 * échouer le contrôle « aucun avertissement dans la console ».
 *
 * Sur un démon à soi (base neuve, port libre, plafond d'agents à zéro, aucun
 * moteur appelé) : trois VRAIES images de formats différents (large, haute,
 * carrée) sont envoyées par `/api/upload`, posées sur une note, puis ouvertes
 * en 1440×900 (souris) et en 390×844 (doigts).
 *
 *   npm run build && node scripts/verif-visionneuse.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

/* La racine se déduit du script : lancé d'une copie de travail, il juge CE code-là. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_VISIONNEUSE_PORT || 7213);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = `${RACINE}/data/verification`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-visionneuse-'));

const resultats = [];
/** Ce que la console du navigateur a dit (avertissements et erreurs), tous parcours confondus. */
const avertissements = [];
const surveillerLaConsole = (page) =>
  page.on('console', (message) => {
    // « Service Worker registration blocked » est l'effet de `serviceWorkers: 'block'` posé plus bas, pas de l'écran.
    if (/Service Worker registration blocked by Playwright/.test(message.text())) return;
    if (['warning', 'error'].includes(message.type())) avertissements.push(`${message.type()} : ${message.text().split('\n')[0].slice(0, 220)}`);
  });
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
const lire = (relatif) => fs.readFileSync(path.join(RACINE, relatif), 'utf8');

/* ---------------- 1. Ce qui se lit dans le code ---------------- */

console.log('\nUNE SEULE VISIONNEUSE\n');
const pieces = lire('web/src/espace/pieces.tsx');
noter('l’espace client passe par la visionneuse commune', pieces.includes('<AttachmentPreview') && !pieces.includes('<Drawer adresse="piece"'));
const apercu = lire('web/src/components/attachment-preview.tsx');
noter('la visionneuse est une fenêtre centrée, plus un volet', apercu.includes('<FenetreDeVisionneuse') && !apercu.includes('DialogContentLibre'));
noter('les flèches ne s’éteignent plus aux extrémités', !apercu.includes('eteinte') && !apercu.includes('on ne boucle pas'));
for (const [quoi, fichier] of [
  ['les commentaires d’une carte', 'web/src/components/card-panel.tsx'],
  ['l’onglet des pièces jointes', 'web/src/components/right-panel.tsx'],
  ['la barre d’écriture', 'web/src/components/composer.tsx'],
  ['la réponse à une question', 'web/src/components/bulle-question.tsx'],
]) {
  noter(`${quoi} donnent leur galerie`, /<AttachmentPreview[\s\S]{0,300}?galerie=/.test(lire(fichier)));
}

/* ---------------- 2. Un démon à soi, de vraies images ---------------- */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DOSSIER = path.join(TMP, 'projet');
for (const dossier of [DATA, PROJETS, DOSSIER]) fs.mkdirSync(dossier, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_WEB: process.env.BELUGA_VISIONNEUSE_WEB || path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
demon.stdout.on('data', () => {});
demon.stderr.on('data', () => {});
process.on('exit', () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

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

/** Un PNG uni, écrit à la main : aucune dépendance. */
function png(largeur, hauteur, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const o of buf) c = crcTable[(c ^ o) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const bloc = (type, donnees) => {
    const longueur = Buffer.alloc(4);
    longueur.writeUInt32BE(donnees.length);
    const corps = Buffer.concat([Buffer.from(type), donnees]);
    const somme = Buffer.alloc(4);
    somme.writeUInt32BE(crc(corps));
    return Buffer.concat([longueur, corps, somme]);
  };
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0);
  entete.writeUInt32BE(hauteur, 4);
  entete[8] = 8;
  entete[9] = 2;
  const ligne = Buffer.alloc(1 + largeur * 3);
  for (let x = 0; x < largeur; x++) ligne.set([r, g, b], 1 + x * 3);
  const brut = Buffer.concat(Array.from({ length: hauteur }, () => ligne));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', entete),
    bloc('IDAT', zlib.deflateSync(brut)),
    bloc('IEND', Buffer.alloc(0)),
  ]);
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-visionneuse';
const CARTE_ID = 'c-visionneuse';
const AGENT_ID = 'ag-visionneuse';
const TITRE_DE_LA_CARTE = 'Carte des captures';
/** Le début de l'étape qui a regardé la première image : trois heures plus tôt, à la minute. */
const DEBUT_DE_L_ETAPE = Math.floor((Date.now() - 3 * 3600_000) / 60_000) * 60_000;
const base = () => new Database(path.join(DATA, 'beluga.db'));

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(JETON),
    maintenant,
    maintenant + 3600_000,
    'vérification de la visionneuse',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    JSON.stringify({ ...reglages, maxAgents: 0 }),
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai de la visionneuse',
    path: DOSSIER,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
    projet.id,
    projet.name,
    projet.path,
    JSON.stringify(projet),
    maintenant,
    maintenant,
  );
  db.close();
}

async function envoyer(nom, contenu) {
  const reponse = await fetch(`${BASE}/api/upload?project=${PROJET_ID}`, {
    method: 'POST',
    headers: { cookie: `beluga_session=${JETON}`, 'content-type': 'image/png', 'x-file-name': encodeURIComponent(nom) },
    body: contenu,
  });
  return reponse.ok ? (await reponse.json()).attachment : null;
}

/**
 * UNE CARTE DONT L'AGENT A VU TROIS IMAGES : la première par une étape (rangée
 * en pièce jointe par le démon, `capturePiece`), les deux autres jointes par
 * son message. La bande du bas de la carte les montre toutes les trois.
 */
function poserLaCarte(ids) {
  const db = base();
  const maintenant = Date.now();
  const agent = {
    id: AGENT_ID, projectId: PROJET_ID, cardId: CARTE_ID, role: 'task', title: TITRE_DE_LA_CARTE,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'idle', createdAt: maintenant, updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(AGENT_ID, PROJET_ID, CARTE_ID, 'task', 'idle', JSON.stringify(agent), maintenant, maintenant);
  const carte = {
    id: CARTE_ID, projectId: PROJET_ID, title: TITRE_DE_LA_CARTE, description: 'Essai de la bande des captures.', labels: [],
    column: 'planned', position: 1, origin: 'agent', agentId: AGENT_ID,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' }, excludedFromDeploy: false, horsTache: false,
    scheduling: { asap: false, attempts: 0, restarts: 0 }, createdAt: maintenant, updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(CARTE_ID, PROJET_ID, 'planned', 1, TITRE_DE_LA_CARTE, JSON.stringify(carte), maintenant, maintenant);
  const message = {
    id: 'm-visionneuse', agentId: AGENT_ID, role: 'assistant', content: 'Voici ce que j’ai regardé.',
    steps: [
      {
        id: 'e-visionneuse', label: 'Capture de la page', state: 'done',
        startedAt: DEBUT_DE_L_ETAPE, endedAt: DEBUT_DE_L_ETAPE + 1000,
        capture: '/tmp/essai-visionneuse/large.png', capturePiece: ids[0],
      },
    ],
    todos: [], proposals: [], questions: [], downloads: [], attachments: ids, streaming: false, createdAt: maintenant,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    message.id, AGENT_ID, 'assistant', JSON.stringify(message), maintenant,
  );
  // Ces pièces viennent de l'agent : c'est ce que la migration (ou l'outil de jointure) y pose.
  for (const id of ids) {
    db.prepare("UPDATE attachments SET data = json_set(data, '$.deLAgent', json('true')) WHERE id = ?").run(id);
  }
  db.close();
}

/** Un second message de l'agent, avec une image jointe APRÈS le repli de la bande. */
function poserUnMessageNeuf(idDeLaPiece, gabarit) {
  const db = base();
  const maintenant = Date.now();
  const id = `m-visionneuse-neuf-${gabarit}`;
  const message = {
    id, agentId: AGENT_ID, role: 'assistant', content: 'Une image de plus.', steps: [],
    todos: [], proposals: [], questions: [], downloads: [], attachments: idDeLaPiece ? [idDeLaPiece] : [], streaming: false, createdAt: maintenant,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(id, AGENT_ID, 'assistant', JSON.stringify(message), maintenant);
  if (idDeLaPiece) db.prepare("UPDATE attachments SET data = json_set(data, '$.deLAgent', json('true')) WHERE id = ?").run(idDeLaPiece);
  db.close();
  return id;
}

/** La bande et l'onglet des pièces jointes retrouvent leurs trois images pour la suite du parcours. */
function retirerLeMessage(id, idDeLaPiece) {
  const db = base();
  db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  if (idDeLaPiece) db.prepare('DELETE FROM attachments WHERE id = ?').run(idDeLaPiece);
  db.close();
}

/** Repart d'un compte qui n'a encore rien ouvert. */
function viderLesVues() {
  const db = base();
  db.prepare('DELETE FROM capture_vues').run();
  db.close();
}

/** Les clés que la base retient comme vues, tous comptes confondus. */
function vuesEnBase() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const lignes = db.prepare('SELECT user_id, cle FROM capture_vues ORDER BY cle').all();
  db.close();
  return lignes;
}

/** L'état de la bande : pour chaque vignette, sa clé, son heure et son œil. */
const lireLaBande = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-captures-bande] [data-capture-du-flux]')].map((vignette) => {
      const heure = vignette.querySelector('[data-capture-heure]');
      const etiquette = vignette.querySelector('[data-capture-etiquette]');
      const boite = vignette.getBoundingClientRect();
      const coin = etiquette?.getBoundingClientRect();
      return {
        cle: vignette.getAttribute('data-capture-du-flux'),
        quand: Number(heure?.getAttribute('data-capture-heure') ?? 0),
        texte: heure?.textContent ?? '',
        vue: !!vignette.querySelector('[data-capture-vue]'),
        // L'étiquette tient dans le coin bas droit de sa vignette.
        enBasADroite: !!coin && boite.right - coin.right <= 6 && boite.bottom - coin.bottom <= 6 && coin.left > boite.left + boite.width / 3,
        repere: vignette.querySelector('[data-etiquette-de-vignette]')?.textContent ?? '',
        // Le repère codé reste entier (aucune ellipse) et ne touche pas l'étiquette.
        repereLisible: (() => {
          const r = vignette.querySelector('[data-etiquette-de-vignette]');
          if (!r) return true;
          const b = r.getBoundingClientRect();
          return r.scrollWidth <= r.clientWidth + 1 && (!coin || b.right <= coin.left + 0.5) && b.left >= boite.left;
        })(),
        capteLeClic: etiquette ? getComputedStyle(etiquette).pointerEvents !== 'none' : false,
      };
    }),
  );

const lireLEntete = (page) =>
  page.evaluate(() => {
    const date = document.querySelector('[data-fenetre-visionneuse] [data-visionneuse-date]');
    const titre = document.querySelector('[data-fenetre-visionneuse] [data-fenetre-titre] h2');
    const t = titre?.getBoundingClientRect();
    const d = date?.getBoundingClientRect();
    return {
      quand: Number(date?.getAttribute('data-visionneuse-date') ?? 0),
      texte: date?.textContent ?? '',
      vue: !!document.querySelector('[data-fenetre-visionneuse] [data-visionneuse-vue]'),
      sousLeNom: !!t && !!d && d.top >= t.bottom - 8 && Math.abs((d.left + d.right) / 2 - (t.left + t.right) / 2) <= 30,
      repere: document.querySelector('[data-feuilletage-repere]')?.textContent?.replace(/\s/g, '') ?? '',
    };
  });

async function ouvrirLaCarte(page) {
  await page.goto(`${BASE}/?project=${PROJET_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const carte = page.locator(`[data-agent-en-liste="${CARTE_ID}"]:visible > button`).first();
  const pageDeCarte = page.locator(`[data-page-carte="${CARTE_ID}"]`).first();
  await carte.or(pageDeCarte).first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  // L'écran rouvre de lui-même la carte qu'il montrait avant un rechargement :
  // on lui en laisse le temps, et on ne clique que si elle n'est pas déjà ouverte.
  await page.waitForTimeout(1500);
  if (!(await pageDeCarte.isVisible().catch(() => false))) {
    await page.keyboard.press('Escape');
    await carte.click();
  }
  // La bande, repliée ou non — ou, sur téléphone, son bouton photo : c'est son cadre qu'on attend, pas ses vignettes.
  await page.locator('[data-captures-du-flux], [data-captures-bouton]').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
}

/** « il y a … », comme le fil d'une carte (`ilYA`) — ou la date au-delà de sept jours. */
const FORME_IL_Y_A = /^(à l’instant|il y a \d+ (min|h|jours?)|\d{2}[./]\d{2}([./]\d{2})? \d{2}[:.h]\d{2})$/;

/**
 * Relève, image après image, la découpe du volet flottant pendant `dureeMs` :
 * lancée AVANT le geste, elle voit le morphing partir du cercle (ou y revenir).
 */
const releverLaDecoupe = (page, dureeMs = 900) =>
  page.evaluate(
    (duree) =>
      new Promise((resoudre) => {
        const valeurs = [];
        const debut = performance.now();
        const tour = () => {
          const volet = document.querySelector('[data-captures-volet] > div');
          valeurs.push(volet ? getComputedStyle(volet).clipPath : 'absent');
          if (performance.now() - debut < duree) requestAnimationFrame(tour);
          else resoudre(valeurs);
        };
        tour();
      }),
    dureeMs,
  );

/** Le bouton photo, le volet et le pied, mesurés. */
const mesurerLeBouton = (page) =>
  page.evaluate(() => {
    const boite = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, d: r.right, b: r.bottom, l: r.width, h: r.height };
    };
    const bouton = document.querySelector('[data-captures-bouton]');
    return {
      bouton: boite('[data-captures-bouton]'),
      opacite: bouton ? Number(getComputedStyle(bouton).opacity) : null,
      volet: boite('[data-captures-volet]'),
      pied: boite('[data-pied-de-conversation]'),
      champ: boite('[data-composer] [data-champ-d-ecriture]'),
      badge: boite('[data-captures-bouton] [data-captures-nouvelles]'),
      largeur: document.documentElement.clientWidth,
      etat: document.querySelector('[data-captures-flottantes]')?.getAttribute('data-captures-flottantes') ?? null,
      bandes: document.querySelectorAll('[data-captures-du-flux]').length,
      horsDuFil: !document.querySelector('[data-captures-volet]')?.closest('[data-fil]'),
    };
  });

async function ouvrirLeVolet(page) {
  await page.locator('[data-captures-bouton]').first().tap();
  await page.locator('[data-captures-flottantes="ouvert"]').first().waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
}

/** La bande d'une carte : heures, date sous le nom, œil gardé au serveur. */
async function parcoursDeLaBande(navigateur, gabarit, images) {
  const tactile = gabarit === 'telephone';
  const context = await navigateur.newContext({
    viewport: tactile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    hasTouch: tactile,
    isMobile: tactile,
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await context.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  surveillerLaConsole(page);
  console.log(`\nLA BANDE D’UNE CARTE — ${tactile ? 'TÉLÉPHONE 390×844' : 'ORDINATEUR 1440×900'}\n`);
  // Le parcours précédent vient d'ouvrir ces images : la bande repart d'un compte vierge.
  if (!tactile) viderLesVues();
  const cleDeLEtape = `jointe:${images[0].id}`;
  const heureAttendue = new Date(DEBUT_DE_L_ETAPE).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
  try {
    await ouvrirLaCarte(page);
    if (tactile) {
      /* LE BOUTON PHOTO, FERMÉ À L'ARRIVÉE : un rond collé au bord droit,
         au-dessus du pied, et aucune bande dans la page. */
      const ferme = await mesurerLeBouton(page);
      noter(
        `${gabarit} : à l’arrivée, la bande est repliée dans le bouton photo, collé au bord droit au-dessus du pied`,
        ferme.etat === 'ferme' && ferme.bandes === 0 && !!ferme.bouton && !!ferme.pied &&
          ferme.bouton.l >= 40 && Math.abs(ferme.bouton.l - ferme.bouton.h) < 1 &&
          Math.abs(ferme.largeur - 16 - ferme.bouton.d) <= 1 && ferme.bouton.b <= ferme.pied.y + 1,
        JSON.stringify({ bouton: ferme.bouton, pied: ferme.pied?.y, largeur: ferme.largeur, bandes: ferme.bandes }),
      );
      await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-bouton.png` });
      /* LE MORPHING : la découpe part du cercle du bouton et s'ouvre en grand ;
         le pied ne bouge pas d'un pixel. */
      const releve = releverLaDecoupe(page);
      await page.waitForTimeout(30);
      await page.locator('[data-captures-bouton]').first().tap();
      const decoupes = (await releve).filter((v) => v !== 'absent');
      const intermediaires = decoupes.filter((v) => !/round 21\.5px/.test(v) && !/^inset\(0px round 6px\)$/.test(v));
      noter(
        `${gabarit} : le volet grandit depuis le bouton (découpe du cercle → intermédiaires → grand ouvert)`,
        decoupes.length > 2 && /round 21\.5px/.test(decoupes[0]) && intermediaires.length > 0 && /^inset\(0px round 6px\)$/.test(decoupes.at(-1)),
        `${decoupes[0]} … ${intermediaires.length} intermédiaire(s) … ${decoupes.at(-1)}`,
      );
      await page.waitForTimeout(300);
      const ouvert = await mesurerLeBouton(page);
      noter(
        `${gabarit} : ouvert, le volet flotte au-dessus du pied, sur sa largeur, sans le déplacer ni entrer dans le fil`,
        ouvert.etat === 'ouvert' && ouvert.bandes === 1 && !!ouvert.volet && !!ouvert.pied && !!ferme.pied &&
          Math.abs(ouvert.pied.y - ferme.pied.y) < 1 && ouvert.volet.b <= ouvert.pied.y + 1 && ouvert.volet.y >= 0 &&
          Math.abs(ouvert.volet.x - 16) <= 1 && Math.abs(ouvert.largeur - 16 - ouvert.volet.d) <= 1 && ouvert.horsDuFil && ouvert.opacite === 0,
        JSON.stringify({ volet: ouvert.volet, pied: [ferme.pied?.y, ouvert.pied?.y], opaciteDuBouton: ouvert.opacite }),
      );
      await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-volet.png` });
    }
    let bande = await lireLaBande(page);
    if (bande.length !== 3) {
      noter(`${gabarit} : la bande montre les trois images de l’agent`, false, `${bande.length} vignette(s)`);
      await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-bande.png` });
      return erreurs;
    }
    noter(`${gabarit} : la bande montre les trois images de l’agent`, true);
    noter(`${gabarit} : chaque vignette dit depuis quand (« il y a … », comme le fil)`, bande.every((v) => v.quand > 0 && FORME_IL_Y_A.test(v.texte.trim())), bande.map((v) => v.texte).join(' · '));
    const deLEtape = bande.find((v) => v.cle === cleDeLEtape);
    const ilYAAttendu = `il y a ${Math.floor((Date.now() - DEBUT_DE_L_ETAPE) / 3600_000)} h`;
    noter(
      `${gabarit} : le temps écoulé part de l’étape, pas du rangement de la pièce`,
      deLEtape?.quand === DEBUT_DE_L_ETAPE && deLEtape?.texte.trim() === ilYAAttendu,
      `${deLEtape?.texte} (attendu ${ilYAAttendu})`,
    );
    noter(
      `${gabarit} : le repère « #… » et le temps écoulé tiennent ensemble sans se chevaucher`,
      bande.every((v) => v.repereLisible),
      bande.map((v) => v.repere).join(' · '),
    );
    noter(`${gabarit} : l’étiquette est dans le coin bas droit et ne capte pas le clic`, bande.every((v) => v.enBasADroite && !v.capteLeClic));

    if (!tactile) {
      noter(`${gabarit} : aucune image n’est marquée vue avant d’être ouverte`, bande.every((v) => !v.vue) && vuesEnBase().length === 0);
      await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-bande.png` });

      // Ouvrir l'image de l'étape : date sous le nom, la même heure, et pas encore d'œil.
      await page.locator(`[data-capture-du-flux="${cleDeLEtape}"]`).first().click();
      await page.locator('[data-image-visionneuse]').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(400);
      const ouverte = await lireLEntete(page);
      noter(`${gabarit} : la date et l’heure s’affichent sous le nom`, ouverte.quand > 0 && ouverte.sousLeNom && ouverte.texte.includes(heureAttendue), ouverte.texte);
      noter(`${gabarit} : la visionneuse donne la même heure que la vignette`, ouverte.quand === DEBUT_DE_L_ETAPE, String(ouverte.quand));
      noter(`${gabarit} : pas d’œil à la première ouverture`, ouverte.vue === false);
      await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-date.png` });

      // Feuilleter vers la voisine puis revenir : l'image quittée est désormais « déjà vue ».
      const depart = ouverte.repere;
      await page.locator('[data-feuilletage-suivante]').first().click();
      await page.waitForFunction((d) => document.querySelector('[data-feuilletage-repere]')?.textContent?.replace(/\s/g, '') !== d, depart, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(300);
      noter(`${gabarit} : pas d’œil non plus sur la voisine, feuilletée pour la première fois`, (await lireLEntete(page)).vue === false);
      await page.locator('[data-feuilletage-precedente]').first().click();
      await attendreRepere(page, depart);
      await page.waitForTimeout(300);
      const retour = await lireLEntete(page);
      noter(`${gabarit} : au retour sur l’image, l’œil est là`, retour.vue === true && retour.quand === DEBUT_DE_L_ETAPE);
      await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-oeil.png` });

      await page.locator('[data-fermer-visionneuse]').first().click();
      await page.waitForTimeout(500);
      bande = await lireLaBande(page);
      noter(
        `${gabarit} : les deux images affichées en grand portent l’œil, la troisième non`,
        bande.filter((v) => v.vue).length === 2 && bande.find((v) => v.cle === cleDeLEtape)?.vue === true,
        bande.map((v) => `${v.cle.slice(0, 14)}:${v.vue ? 'vue' : '—'}`).join(' · '),
      );
      await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-bande-vue.png` });

      // LE SERVEUR LE RETIENT, par compte : une ligne par clé, sous le compte de la session.
      await page.waitForTimeout(600);
      const enBase = vuesEnBase();
      noter(
        'le serveur retient les images vues, sous les deux clés de la capture rangée',
        enBase.some((l) => l.cle === cleDeLEtape) && enBase.some((l) => l.cle === 'etape:e-visionneuse') && new Set(enBase.map((l) => l.user_id)).size === 1,
        enBase.map((l) => l.cle.slice(0, 16)).join(' · '),
      );

      // Après rechargement, l'œil est toujours là.
      await ouvrirLaCarte(page);
      bande = await lireLaBande(page);
      noter(`${gabarit} : après rechargement, l’œil est toujours là`, bande.filter((v) => v.vue).length === 2, `${bande.filter((v) => v.vue).length} vue(s)`);
    } else {
      // UN AUTRE APPAREIL DU MÊME COMPTE : ce que l'ordinateur a ouvert se voit ici.
      noter(`${gabarit} : l’œil posé sur l’ordinateur se retrouve sur le téléphone`, bande.filter((v) => v.vue).length === 2 && bande.find((v) => v.cle === cleDeLEtape)?.vue === true, `${bande.filter((v) => v.vue).length} vue(s)`);
      await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-bande.png` });
    }

    // UNE SEULE RANGÉE, À TOUTE LARGEUR : le titre et les commandes de l'œil sont
    // sur la MÊME ligne (même hauteur), le titre à gauche, les commandes à
    // droite, sans se recouvrir, et rien ne dépasse la largeur de l'écran.
    // 1440 px (souris), 390 px puis 320 px (doigts) : plus jamais « une fois en
    // haut à gauche, une fois en dessous à droite ».
    const mesurerLaRangee = () =>
      page.evaluate(() => {
        const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect();
        const titre = rect('[data-captures-du-flux] [data-captures-bascule]');
        const commandes = rect('[data-captures-du-flux] [data-commandes-des-vues]');
        const filtre = rect('[data-captures-du-flux] [data-filtre-pas-vues]');
        const toutMarquer = rect('[data-captures-du-flux] [data-tout-marquer-vu]');
        /* La rangée est l'EN-TÊTE du bloc (20/10/2026) : on mesure son bord de CONTENU, padding retiré. */
        const enTete = document.querySelector('[data-captures-du-flux] [data-captures-bascule]')?.parentElement;
        const boite = enTete?.getBoundingClientRect();
        const rangee = boite ? { right: boite.right - parseFloat(getComputedStyle(enTete).paddingRight || '0') } : null;
        if (!titre || !commandes || !filtre || !toutMarquer || !rangee) return { ok: false, raison: 'titre ou commandes introuvables' };
        const milieu = (r) => (r.top + r.bottom) / 2;
        const memeLigne = Math.abs(milieu(titre) - milieu(filtre)) <= 3 && Math.abs(milieu(titre) - milieu(toutMarquer)) <= 3;
        const seRecouvrent = titre.right > filtre.left + 0.5;
        const alDroite = Math.abs(toutMarquer.right - rangee.right) <= 8;
        const largeur = document.documentElement.clientWidth;
        const dehors = Math.max(titre.right, toutMarquer.right) > largeur + 0.5 || Math.min(titre.left, filtre.left) < -0.5;
        return {
          ok: memeLigne && !seRecouvrent && alDroite && !dehors,
          raison: `titre ${Math.round(titre.left)}→${Math.round(titre.right)} × ${Math.round(titre.top)}→${Math.round(titre.bottom)}, filtre ${Math.round(filtre.left)}→${Math.round(filtre.right)} × ${Math.round(filtre.top)}, tout marquer →${Math.round(toutMarquer.right)} (rangée →${Math.round(rangee.right)}), écran ${largeur}, ligne ${memeLigne}, recouvre ${seRecouvrent}, droite ${alDroite}`,
        };
      });
    const rangee = await mesurerLaRangee();
    noter(`${gabarit} : titre à gauche et commandes à droite, sur la même ligne, sans chevauchement`, rangee.ok, rangee.raison);
    if (tactile) {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.waitForTimeout(250);
      const etroite = await mesurerLaRangee();
      noter(`${gabarit} : à 320 px aussi, titre à gauche et commandes à droite sur la même ligne`, etroite.ok, etroite.raison);
      await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-bande-320.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(250);
    }

    // COLLÉE EN BAS, HORS DU FIL : la bande n'est plus dans la zone qui défile.
    const place = await page.evaluate(() => {
      const bandeDuFlux = document.querySelector('[data-captures-du-flux]');
      const fil = document.querySelector('[data-fil="parcours"]');
      const boite = bandeDuFlux?.getBoundingClientRect();
      const filBoite = fil?.getBoundingClientRect();
      return {
        horsDuFil: !!bandeDuFlux && !bandeDuFlux.closest('[data-fil]'),
        sousLeFil: !!boite && !!filBoite && boite.top >= filBoite.bottom - 1,
        dansLEcran: !!boite && boite.bottom <= window.innerHeight,
      };
    });
    if (tactile) noter(`${gabarit} : le volet est hors de la zone qui défile, dans l’écran`, place.horsDuFil && place.dansLEcran, JSON.stringify(place));
    else noter(`${gabarit} : la bande est hors de la zone qui défile, sous elle`, place.horsDuFil && place.sousLeFil && place.dansLEcran, JSON.stringify(place));
    /* LE BLOC À DEUX ÉTAGES : en-tête et panneau, chacun son fond, distincts du
       fil, sans aucun trait — en clair comme en sombre. */
    const etaitSombre = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    for (const sombre of [false, true]) {
      const cadre = await page.evaluate((s) => {
        document.documentElement.classList.toggle('dark', s);
        const bande = document.querySelector('[data-captures-du-flux]');
        const tete = bande?.querySelector('[data-captures-en-tete]');
        const panneau = bande?.querySelector('[data-captures-panneau]');
        if (!tete || !panneau) return null;
        const fond = (el) => getComputedStyle(el).backgroundColor;
        const trait = (el) => ['Top', 'Right', 'Bottom', 'Left'].some((c) => parseFloat(getComputedStyle(el)[`border${c}Width`]) > 0);
        let parent = bande.parentElement;
        while (parent && /rgba\(0, 0, 0, 0\)|transparent/.test(fond(parent))) parent = parent.parentElement;
        return { tete: fond(tete), panneau: fond(panneau), fil: parent ? fond(parent) : '', traits: trait(tete) || trait(panneau) };
      }, sombre);
      noter(
        `${gabarit} · ${sombre ? 'sombre' : 'clair'} : la bande a son en-tête et son panneau, fonds distincts entre eux et du fil, sans trait`,
        !!cadre && cadre.tete !== cadre.panneau && cadre.tete !== cadre.fil && cadre.panneau !== cadre.fil && !cadre.traits,
        JSON.stringify(cadre),
      );
    }
    await page.evaluate((s) => document.documentElement.classList.toggle('dark', s), etaitSombre);
    if (!tactile) {
      const basculer = page.locator('[data-captures-du-flux] [data-captures-bascule]').first();
      const hauteurDeLaBande = () => page.locator('[data-captures-du-flux]').first().evaluate((el) => el.getBoundingClientRect().height);
      const hauteurDeploye = await hauteurDeLaBande();

      // LE CHEVRON : replie sur la seule ligne de titre, déplie, et le choix se retient.
      noter(`${gabarit} : la bande est dépliée au départ`, (await basculer.getAttribute('aria-expanded')) === 'true');
      await basculer.click();
      await page.waitForTimeout(250);
      noter(
        `${gabarit} : le chevron replie la bande sur sa ligne de titre`,
        (await page.locator('[data-captures-du-flux]').first().getAttribute('data-captures-repli')) === 'ferme' &&
          (await basculer.getAttribute('aria-expanded')) === 'false' &&
          !(await page.locator('[data-captures-bande]').first().isVisible().catch(() => false)) &&
          (await hauteurDeLaBande()) < Math.min(40, hauteurDeploye),
        `${Math.round(await hauteurDeLaBande())} px (déplié : ${Math.round(hauteurDeploye)} px)`,
      );
      noter(
        `${gabarit} : repliée, la ligne garde le nombre d'images à droite`,
        await page.locator('[data-captures-du-flux] [data-commandes-des-vues]').first().isVisible().catch(() => false),
      );
      await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-bande-repliee.png` });
      // LE BADGE DES NOUVELLES : rien au repli, puis une image arrivée APRÈS.
      noter(`${gabarit} : au repli, aucun badge de nouvelles images`, (await page.locator('[data-captures-nouvelles]').count()) === 0);
      await page.waitForTimeout(50);
      const nouvelle = await envoyer(`nouvelle-${gabarit}.png`, png(40, 30, [200, 120, 40]));
      const idDuMessageNeuf = poserUnMessageNeuf(nouvelle?.id, gabarit);
      await ouvrirLaCarte(page);
      noter(
        `${gabarit} : le repli est gardé après rechargement`,
        (await page.locator('[data-captures-du-flux]').first().getAttribute('data-captures-repli')) === 'ferme',
      );
      const badge = page.locator('[data-captures-du-flux] [data-captures-nouvelles]').first();
      noter(
        `${gabarit} : repliée, le badge compte l’image arrivée depuis le repli (et tient au rechargement)`,
        (await badge.getAttribute('data-captures-nouvelles').catch(() => null)) === '1' && (await badge.isVisible().catch(() => false)),
        `${await page.locator('[data-captures-du-flux]').first().getAttribute('data-captures-du-flux')} image(s), badge ${await badge.getAttribute('data-captures-nouvelles').catch(() => 'absent')}`,
      );
      const mesurerLeBadge = () =>
        page.evaluate(() => {
          const titre = document.querySelector('[data-captures-du-flux] [data-captures-bascule]');
          const badge = document.querySelector('[data-captures-du-flux] [data-captures-nouvelles]');
          if (!titre || !badge) return { ok: false, raison: 'titre ou badge introuvable' };
          const t = titre.getBoundingClientRect();
          const b = badge.getBoundingClientRect();
          const enTete = titre.parentElement;
          const bord = enTete.getBoundingClientRect().right - parseFloat(getComputedStyle(enTete).paddingRight || '0');
          const milieu = (r) => (r.top + r.bottom) / 2;
          const memeLigne = Math.abs(milieu(t) - milieu(b)) <= 3;
          const auBout = Math.abs(b.right - bord) <= 2;
          const dedans = b.right <= document.documentElement.clientWidth + 0.5;
          return { ok: memeLigne && auBout && dedans, raison: `titre ${Math.round(t.top)}→${Math.round(t.bottom)}, badge ${Math.round(b.left)}→${Math.round(b.right)} × ${Math.round(b.top)}→${Math.round(b.bottom)}, bord ${Math.round(bord)}` };
        });
      const auBout = await mesurerLeBadge();
      noter(`${gabarit} : le badge est au bout de la ligne repliée, sur la même ligne que le titre`, auBout.ok, auBout.raison);
      await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-badge.png` });
      // Un clic sur le badge déplie la bande, comme le chevron.
      await badge.click();
      await page.waitForTimeout(250);
      noter(
        `${gabarit} : le badge redéplie la bande`,
        (await page.locator('[data-captures-bande] [data-capture-du-flux]').first().isVisible().catch(() => false)) &&
          (await page.locator('[data-captures-du-flux]').first().getAttribute('data-captures-repli')) === 'ouvert',
      );
      noter(`${gabarit} : dépliée, le badge s’efface`, (await page.locator('[data-captures-nouvelles]').count()) === 0);
      retirerLeMessage(idDuMessageNeuf, nouvelle?.id);
    } else {
      /* LE CHEVRON REFERME LE VOLET : la découpe revient au cercle, puis le
         rond reparaît — sans badge, puisqu'on vient de tout voir. */
      const releve = releverLaDecoupe(page, 700);
      await page.waitForTimeout(30);
      await page.locator('[data-captures-du-flux] [data-captures-bascule]').first().tap();
      const decoupes = await releve;
      await page.waitForTimeout(300);
      const referme = await mesurerLeBouton(page);
      const avantDeDisparaitre = decoupes.filter((v) => v !== 'absent');
      noter(
        `${gabarit} : le chevron referme le volet en le ramenant au bouton`,
        referme.etat === 'ferme' && referme.bandes === 0 && referme.opacite === 1 &&
          /round 21\.5px/.test(avantDeDisparaitre.at(-1) ?? '') && decoupes.at(-1) === 'absent',
        `${avantDeDisparaitre.at(-1)} puis ${decoupes.at(-1)}, bouton ${referme.opacite}`,
      );
      noter(`${gabarit} : refermé, aucun badge`, !referme.badge);
      // LE BADGE DES NOUVELLES : une image arrivée APRÈS la fermeture.
      await page.waitForTimeout(50);
      const nouvelle = await envoyer(`nouvelle-${gabarit}.png`, png(40, 30, [40, 120, 200]));
      const idDuMessageNeuf = poserUnMessageNeuf(nouvelle?.id, gabarit);
      await ouvrirLaCarte(page);
      const avecBadge = await mesurerLeBouton(page);
      const badge = page.locator('[data-captures-bouton] [data-captures-nouvelles]').first();
      noter(
        `${gabarit} : fermé à l’arrivée, le badge compte l’image arrivée depuis la fermeture (et tient au rechargement)`,
        avecBadge.etat === 'ferme' && (await badge.getAttribute('data-captures-nouvelles').catch(() => null)) === '1' && (await badge.isVisible().catch(() => false)),
        `badge ${await badge.getAttribute('data-captures-nouvelles').catch(() => 'absent')}`,
      );
      noter(
        `${gabarit} : le badge est en coin haut droit du bouton, dans l’écran`,
        !!avecBadge.badge && !!avecBadge.bouton && avecBadge.badge.d >= avecBadge.bouton.d - 2 && avecBadge.badge.y <= avecBadge.bouton.y + 2 && avecBadge.badge.d <= avecBadge.largeur + 0.5,
        JSON.stringify({ badge: avecBadge.badge, bouton: avecBadge.bouton }),
      );
      await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-badge.png` });
      await ouvrirLeVolet(page);
      noter(
        `${gabarit} : ouvert, le volet montre la nouvelle image et le badge s’efface`,
        (await lireLaBande(page)).length === 4 && (await page.locator('[data-captures-nouvelles]').count()) === 0,
      );
      // UN APPUI HORS DU VOLET LE REFERME.
      await page.mouse.click(30, 120);
      await page.locator('[data-captures-flottantes="ferme"]').first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
      noter(`${gabarit} : un appui hors du volet le referme`, (await mesurerLeBouton(page)).bandes === 0);
      retirerLeMessage(idDuMessageNeuf, nouvelle?.id);
    }

    /* UN SON DIT AUSSI DEPUIS QUAND, DANS SON CADRE (capture #b3aa) : son
       étiquette, jadis rognée hors de la carte, est visible sur la ligne du nom. */
    {
      const son = await envoyer(`voix-${gabarit}.wav`, png(20, 20, [10, 10, 10]));
      if (son?.id) {
        const db = base();
        db.prepare("UPDATE attachments SET data = json_set(data, '$.mime', 'audio/wav') WHERE id = ?").run(son.id);
        db.close();
      }
      const idDuSon = poserUnMessageNeuf(son?.id, `${gabarit}-son`);
      await ouvrirLaCarte(page);
      if (tactile) await ouvrirLeVolet(page);
      const etiquetteDuSon = await page.evaluate(() => {
        const carte = document.querySelector('[data-captures-bande] [data-capture-media="son"]');
        const heure = carte?.querySelector('[data-capture-heure]');
        if (!carte || !heure) return { ok: false, raison: carte ? 'pas d’étiquette' : 'pas de son dans la bande' };
        const c = carte.getBoundingClientRect();
        const h = heure.getBoundingClientRect();
        const dedans = h.width > 0 && h.height > 0 && h.top >= c.top - 0.5 && h.bottom <= c.bottom + 0.5 && h.left >= c.left - 0.5 && h.right <= c.right + 0.5;
        const enHautADroite = h.top < c.top + c.height / 2 && c.right - h.right <= 12;
        return { ok: dedans && enHautADroite, texte: heure.textContent, raison: `étiquette ${Math.round(h.left)}→${Math.round(h.right)} × ${Math.round(h.top)}→${Math.round(h.bottom)}, carte ${Math.round(c.left)}→${Math.round(c.right)} × ${Math.round(c.top)}→${Math.round(c.bottom)}` };
      });
      noter(
        `${gabarit} : un son montre « il y a … » en haut à droite, dans son cadre`,
        etiquetteDuSon.ok && FORME_IL_Y_A.test((etiquetteDuSon.texte ?? '').trim()),
        `${etiquetteDuSon.texte ?? ''} — ${etiquetteDuSon.raison}`,
      );
      await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-son.png` });
      retirerLeMessage(idDuSon, son?.id);
    }

    // LA COLONNE DE GAUCHE : la ligne « Tableaux de bord » n'existe que sur
    // téléphone, juste au-dessus du bouton noir « Nouvel agent » ; sur
    // ordinateur la colonne n'a pas cette ligne (demande du 12/10/2026).
    const avantLaColonne = avertissements.length;
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    if (tactile) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.locator('button[aria-label="Projets"]:visible').first().tap();
      await page.locator('[data-ligne-nouvel-agent]:visible').first().waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(700); // le panneau finit de glisser
      const nombreTel = await page.locator('[data-ligne-tableaux-de-bord]').count();
      noter(`${gabarit} : la colonne du téléphone n'a plus de ligne « Tableaux de bord »`, nombreTel === 0, String(nombreTel));
      await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-colonne.png` });
    } else {
      const nombre = await page.locator('aside[data-zone="gauche"] [data-ligne-tableaux-de-bord]').count();
      noter(`${gabarit} : la colonne de l'ordinateur n'a pas de ligne « Tableaux de bord »`, nombre === 0, String(nombre));
    }
    // L'accueil monte l'enregistreur vocal : le navigateur note, sans geste
    // encore, que son contexte audio ne peut pas démarrer. Ce n'est pas l'écran jugé ici.
    await page.waitForTimeout(500);
    for (let i = avertissements.length - 1; i >= avantLaColonne; i--) {
      if (/AudioContext was not allowed to start/.test(avertissements[i])) avertissements.splice(i, 1);
    }
  } catch (erreur) {
    noter(`${gabarit} : le parcours de la bande va au bout`, false, String(erreur?.message ?? erreur).split('\n')[0]);
    await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-bande-panne.png` }).catch(() => {});
  } finally {
    await context.close();
  }
  return erreurs;
}

const mesurer = (page) =>
  page.evaluate(() => {
    const fenetre = document.querySelector('[data-fenetre-visionneuse]');
    const scene = document.querySelector('[data-scene-image]');
    const img = document.querySelector('[data-image-visionneuse]');
    if (!fenetre || !scene || !img) return null;
    const f = fenetre.getBoundingClientRect();
    // La hauteur VISIBLE de l'image, une fois contenue dans la scène.
    const echelle = Math.min(scene.clientWidth / img.naturalWidth, scene.clientHeight / img.naturalHeight);
    return {
      fenetre: { l: Math.round(f.width), h: Math.round(f.height), haut: Math.round(f.top), bas: Math.round(innerHeight - f.bottom) },
      scene: { l: scene.clientWidth, h: scene.clientHeight },
      imageVisible: { l: Math.round(img.naturalWidth * echelle), h: Math.round(img.naturalHeight * echelle) },
      repere: document.querySelector('[data-feuilletage-repere]')?.textContent?.replace(/\s/g, '') ?? '',
      zoom: scene.getAttribute('data-zoom'),
      montree: scene.getAttribute('data-image-montree'),
    };
  });

async function attendreRepere(page, attendu) {
  await page
    .waitForFunction((a) => document.querySelector('[data-feuilletage-repere]')?.textContent?.replace(/\s/g, '') === a, attendu, { timeout: 5000 })
    .catch(() => {});
  return (await mesurer(page))?.repere;
}

async function parcours(navigateur, gabarit, images) {
  const tactile = gabarit === 'telephone';
  const context = await navigateur.newContext({
    viewport: tactile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    hasTouch: tactile,
    isMobile: tactile,
    locale: 'fr-CH',
    serviceWorkers: 'block',
    acceptDownloads: true,
  });
  await context.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  surveillerLaConsole(page);
  console.log(`\n${tactile ? 'TÉLÉPHONE 390×844' : 'ORDINATEUR 1440×900'}\n`);
  try {
    /* LA BANDE DES CAPTURES DE LA CARTE ouvre la visionneuse (le service Notes, qui servait de point de départ, est
       retiré le 11/11/2026). Sur téléphone, la bande vit derrière le bouton photo. */
    await ouvrirLaCarte(page);
    if (tactile) await ouvrirLeVolet(page);
    const vignette = page.locator('[data-captures-bande] [data-capture-du-flux]:visible').first();
    await vignette.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    if (!(await vignette.count())) {
      noter(`${gabarit} : la bande de la carte montre ses images`, false);
      await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-bande.png` });
      return erreurs;
    }
    await vignette.click();
    await page.locator('[data-image-visionneuse]').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelector('[data-image-visionneuse]')?.complete, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    const premiere = await mesurer(page);
    noter(`${gabarit} : la visionneuse s’ouvre sur l’image large`, premiere?.montree === images[0].id, premiere?.repere);
    if (!premiere) return erreurs;
    if (tactile) {
      /* 31/10/2026, capture #7674 : une feuille au niveau du menu principal, sans croix, fermée par son haut ou le voile. */
      noter(`${gabarit} : la fenêtre est une feuille, 20 px sous le haut, collée en bas`, premiere.fenetre.haut === 20 && premiere.fenetre.bas === 0 && premiere.fenetre.l === 390, JSON.stringify(premiere.fenetre));
      noter(`${gabarit} : aucune croix, une poignée`, await page.evaluate(() => {
        const f = document.querySelector('[data-fenetre-visionneuse]');
        return ![...f.querySelectorAll('svg.lucide-x')].some((x) => x.getBoundingClientRect().width > 0) && !!f.querySelector('[data-poignee-tiroir] [data-fermer-visionneuse]');
      }));
      const cdp = await page.context().newCDPSession(page);
      const tirer = async (x, y, dy) => {
        const point = (yy) => [{ x, y: yy, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(y) });
        for (let i = 1; i <= 14; i += 1) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(y + (dy * i) / 14) });
          await page.waitForTimeout(16);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(700);
      };
      const ouverte = () => page.locator('[data-fenetre-visionneuse]').count().then((n) => n > 0);
      await tirer(195, 300, 320);
      noter(`${gabarit} : tirer l’image vers le bas ne ferme rien`, await ouverte());
      const couleurDuRepere = () => page.evaluate(() => document.getElementById('repere-de-l-heure')?.dataset.couleur);
      const sousLeVoile = await couleurDuRepere();
      await tirer(195, 50, 320);
      noter(`${gabarit} : tirer le haut de la feuille la ferme`, !(await ouverte()));
      await page.waitForTimeout(400);
      const apresLeVoile = await couleurDuRepere();
      const couleurDeLaPage = await page.evaluate(() => {
        const canaux = getComputedStyle(document.body).backgroundColor.match(/\d+/g).slice(0, 3).map(Number);
        return `#${canaux.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
      });
      noter(`${gabarit} : à la fermeture du voile, la barre d’état quitte l’assombrissement et retrouve la couleur de la page`, sousLeVoile !== apresLeVoile && apresLeVoile === couleurDeLaPage, `${sousLeVoile} → ${apresLeVoile} / ${couleurDeLaPage}`);
      await vignette.click();
      await page.locator('[data-fenetre-visionneuse]').waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(400);
      await page.touchscreen.tap(195, 8);
      await page.waitForTimeout(700);
      noter(`${gabarit} : toucher le voile la ferme`, !(await ouverte()));
      await vignette.click();
      await page.locator('[data-fenetre-visionneuse]').waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(400);
    } else {
      noter(
        `${gabarit} : la fenêtre est centrée, pas collée en bas`,
        Math.abs(premiere.fenetre.haut - premiere.fenetre.bas) <= 2 && premiere.fenetre.bas > 20,
        JSON.stringify(premiere.fenetre),
      );
    }
    const entete = await lireLEntete(page);
    noter(`${gabarit} : hors d’une carte aussi, la date de la pièce se lit sous son nom`, entete.quand > 0 && entete.sousLeNom, entete.texte);
    // Une note a son œil, comme la bande : absent à la toute première ouverture, retenu au serveur ensuite.
    noter(
      tactile
        ? `${gabarit} : l’œil posé sur l’ordinateur se retrouve dans la visionneuse d’une note`
        : `${gabarit} : pas d’œil à la première ouverture d’une image de note`,
      entete.vue === tactile,
    );
    await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-large.png` });

    // L'image suivante (la haute) : même fenêtre, image sur toute la hauteur.
    await page.locator('[data-feuilletage-suivante]').first().click();
    noter(`${gabarit} : la flèche passe à la suivante`, (await attendreRepere(page, '2/3')) === '2/3');
    await page.waitForFunction(() => document.querySelector('[data-image-visionneuse]')?.complete, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const haute = await mesurer(page);
    noter(
      `${gabarit} : une image haute ouvre la MÊME fenêtre`,
      haute && haute.fenetre.h === premiere.fenetre.h && haute.fenetre.l === premiere.fenetre.l,
      `${premiere.fenetre.h} → ${haute?.fenetre.h}`,
    );
    noter(`${gabarit} : l’image haute occupe toute la hauteur`, haute && Math.abs(haute.imageVisible.h - haute.scene.h) <= 1, `${haute?.imageVisible.h} / ${haute?.scene.h}`);
    await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-haute.png` });

    // LE CARROUSEL BOUCLE : de la troisième à la première, et de la première à la dernière.
    await page.locator('[data-feuilletage-suivante]').first().click();
    await attendreRepere(page, '3/3');
    await page.locator('[data-feuilletage-suivante]').first().click();
    noter(`${gabarit} : après la dernière vient la première`, (await attendreRepere(page, '1/3')) === '1/3');
    await page.locator('[data-feuilletage-precedente]').first().click();
    noter(`${gabarit} : avant la première vient la dernière`, (await attendreRepere(page, '3/3')) === '3/3');

    // LE GLISSEMENT : sur téléphone, un doigt qui glisse vers la gauche montre la suivante (en bouclant).
    const scene = page.locator('[data-scene-image]').first();
    const boite = await scene.boundingBox();
    const cx = boite.x + boite.width / 2;
    const cy = boite.y + boite.height / 2;
    if (tactile) {
      const cdp = await context.newCDPSession(page);
      const toucher = async (type, x) =>
        cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: cy }] });
      await toucher('touchStart', cx + 120);
      for (let i = 1; i <= 6; i++) await toucher('touchMove', cx + 120 - i * 50);
      await toucher('touchEnd', cx - 180);
      noter(`${gabarit} : glisser vers la gauche montre la suivante, en bouclant`, (await attendreRepere(page, '1/3')) === '1/3');
      await page.waitForTimeout(400);
      // LE DOUBLE TOUCHER zoome, un second double toucher revient.
      await page.touchscreen.tap(cx, cy);
      await page.waitForTimeout(80);
      await page.touchscreen.tap(cx, cy);
      await page.waitForTimeout(350);
      noter(`${gabarit} : le double toucher agrandit l’image`, (await mesurer(page))?.zoom === '2.50', (await mesurer(page))?.zoom);
      await page.touchscreen.tap(cx, cy);
      await page.waitForTimeout(80);
      await page.touchscreen.tap(cx, cy);
      await page.waitForTimeout(350);
      noter(`${gabarit} : un second double toucher revient à l’image entière`, (await mesurer(page))?.zoom === '1.00');
    } else {
      await page.mouse.click(cx + 100, cy);
      await page.waitForTimeout(300);
      const zoome = await mesurer(page);
      noter(`${gabarit} : un clic agrandit l’image`, zoome?.zoom === '2.50', zoome?.zoom);
      // Glisser l'image agrandie la déplace, sans la refermer ni changer d'image.
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx - 200, cy, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const deplacee = await mesurer(page);
      noter(`${gabarit} : glisser l’image agrandie la déplace sans changer d’image`, deplacee?.zoom === '2.50' && deplacee?.repere === '3/3');
      await page.mouse.click(cx, cy);
      await page.waitForTimeout(300);
      noter(`${gabarit} : un second clic revient à l’image entière`, (await mesurer(page))?.zoom === '1.00');
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(200);
      noter(`${gabarit} : la molette zoome`, Number((await mesurer(page))?.zoom) > 1.5, (await mesurer(page))?.zoom);
      await page.keyboard.press('ArrowRight');
      noter(`${gabarit} : le clavier boucle aussi`, (await attendreRepere(page, '1/3')) === '1/3');
      noter(`${gabarit} : changer d’image remet le zoom à 1`, (await mesurer(page))?.zoom === '1.00');
    }

    // LE MENU DE TÉLÉCHARGEMENT : trois entrées.
    await page.locator('[data-menu-telechargement]').first().click();
    await page.locator('[data-telecharger="archive"]').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    const entrees = await page.locator('[data-telecharger]:visible').evaluateAll((n) => n.map((e) => e.getAttribute('data-telecharger')));
    noter(`${gabarit} : le menu propose trois choix`, entrees.join(',') === 'cette,archive,separees', entrees.join(','));
    if (!tactile) {
      const arrivee = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
      await page.locator('[data-telecharger="archive"]').first().click();
      const telechargement = await arrivee;
      const chemin = telechargement ? await telechargement.path().catch(() => null) : null;
      const taille = chemin ? fs.statSync(chemin).size : 0;
      noter(
        `${gabarit} : « Tout en une archive » enregistre un .zip non vide`,
        !!telechargement && telechargement.suggestedFilename().endsWith('.zip') && taille > 100,
        `${telechargement?.suggestedFilename()} · ${taille} o`,
      );
    } else {
      await page.keyboard.press('Escape');
    }
    await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-fin.png` });
  } finally {
    await context.close();
  }
  return erreurs;
}

/**
 * LES COMMANDES DE L'ŒIL : le filtre « pas encore vues » et « tout marquer
 * comme vu » (bande d'une carte, puis onglet des pièces jointes du projet), et
 * l'œil des images d'une note. Chaque étape repart d'un compte qui n'a rien
 * ouvert (`viderLesVues`), pour compter à coup sûr.
 */
async function parcoursDesCommandes(navigateur, images) {
  const gabarit = 'ordinateur';
  const context = await navigateur.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await context.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  surveillerLaConsole(page);
  console.log('\nLES COMMANDES DE L’ŒIL — ORDINATEUR 1440×900\n');
  const vignettes = (p) => p.locator('[data-captures-bande] [data-capture-du-flux]').count();
  const filtre = (p) => p.locator('[data-captures-du-flux] [data-filtre-pas-vues]').first();
  const toutMarquer = (p) => p.locator('[data-captures-du-flux] [data-tout-marquer-vu]').first();
  const ouvrirEtFermer = async (p, locator) => {
    await locator.click();
    await p.locator('[data-image-visionneuse]').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(300);
    const repere = await p.locator('[data-feuilletage-repere]').first().textContent().catch(() => '');
    await p.locator('[data-fermer-visionneuse]').first().click();
    await p.waitForTimeout(400);
    return (repere ?? '').replace(/\s/g, '');
  };
  try {
    // 1. LA BANDE D'UNE CARTE.
    viderLesVues();
    await ouvrirLaCarte(page);
    const commandes = page.locator('[data-captures-du-flux] [data-commandes-des-vues]').first();
    noter(`${gabarit} : les commandes de l’œil paraissent sur la bande de trois images`, await commandes.isVisible().catch(() => false));
    noter(`${gabarit} : le filtre dit combien d’images ne sont pas encore vues`, /\(3\)/.test((await filtre(page).textContent()) ?? ''), (await filtre(page).textContent())?.trim());
    await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-commandes.png` });

    await ouvrirEtFermer(page, page.locator('[data-captures-bande] [data-capture-du-flux]').first());
    await filtre(page).click();
    await page.waitForTimeout(200);
    noter(`${gabarit} : le filtre ne laisse que les deux images pas encore vues`, (await vignettes(page)) === 2, String(await vignettes(page)));
    noter(
      `${gabarit} : la bande garde son total, le filtre ne change que l’affichage`,
      (await page.locator('[data-captures-du-flux]').first().getAttribute('data-captures-du-flux')) === '3',
    );
    // Ouvrir une image filtrée : la visionneuse garde la série ENTIÈRE.
    const repere = await ouvrirEtFermer(page, page.locator('[data-captures-bande] [data-capture-du-flux]').first());
    noter(`${gabarit} : la visionneuse feuillette toute la série, filtre allumé`, /\/3$/.test(repere), repere);
    noter(`${gabarit} : l’image ouverte quitte la liste filtrée`, (await vignettes(page)) === 1, String(await vignettes(page)));

    // TOUT MARQUER COMME VU.
    await toutMarquer(page).click();
    await page.waitForTimeout(700);
    noter(`${gabarit} : « tout marquer comme vu » vide la liste filtrée, et le dit`, (await vignettes(page)) === 0 && (await page.locator('[data-aucune-pas-vue]').first().isVisible().catch(() => false)));
    noter(`${gabarit} : le bouton s’éteint quand tout est vu`, await toutMarquer(page).isDisabled());
    await filtre(page).click();
    await page.waitForTimeout(200);
    const toutes = await lireLaBande(page);
    noter(`${gabarit} : filtre éteint, les trois images portent l’œil`, toutes.length === 3 && toutes.every((v) => v.vue));
    await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-tout-vu.png` });
    const enBase = vuesEnBase();
    noter(
      'le serveur retient tout, sous les deux clés de la capture rangée',
      images.every((i) => enBase.some((l) => l.cle === `jointe:${i.id}`)) && enBase.some((l) => l.cle === 'etape:e-visionneuse'),
      `${enBase.length} clé(s)`,
    );
    await ouvrirLaCarte(page);
    noter(`${gabarit} : après rechargement, tout est encore vu`, (await lireLaBande(page)).every((v) => v.vue));

    // 2. L'ONGLET DES PIÈCES JOINTES DU PROJET.
    viderLesVues();
    await ouvrirLaCarte(page);
    await page.keyboard.press('Escape').catch(() => {});
    await page.locator('[data-menu-pieces]:visible').first().click();
    await page.locator('[data-tiroir-fichiers="pieces"] [data-piece-ouvrir]').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    const tiroir = page.locator('[data-tiroir-fichiers="pieces"]');
    const commandesPieces = tiroir.locator('[data-commandes-pieces] [data-commandes-des-vues]').first();
    noter(`${gabarit} : l’onglet des pièces jointes porte les commandes de l’œil`, await commandesPieces.isVisible().catch(() => false));
    noter(
      `${gabarit} : il ne compte que les trois images de l’agent, pas les 400 de l’utilisateur`,
      /\(3\)/.test((await tiroir.locator('[data-filtre-pas-vues]').first().textContent().catch(() => '')) ?? ''),
      (await tiroir.locator('[data-filtre-pas-vues]').first().textContent().catch(() => ''))?.trim(),
    );
    noter(`${gabarit} : aucun œil avant d’avoir ouvert une image`, (await tiroir.locator('[data-capture-vue]').count()) === 0);
    await tiroir.locator('[data-filtre-pas-vues]').first().click();
    await page.waitForTimeout(250);
    noter(`${gabarit} : le filtre ne laisse que les images de l’agent pas encore vues`, (await tiroir.locator('[data-piece-ouvrir]').count()) === 3, String(await tiroir.locator('[data-piece-ouvrir]').count()));
    await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-pieces.png` });
    await ouvrirEtFermer(page, tiroir.locator('[data-piece-ouvrir]').first());
    noter(`${gabarit} : l’image ouverte quitte la liste filtrée de l’onglet`, (await tiroir.locator('[data-piece-ouvrir]').count()) === 2);
    await tiroir.locator('[data-tout-marquer-vu]').first().click();
    await page.waitForTimeout(600);
    noter(
      `${gabarit} : « tout marquer comme vu » vide l’onglet filtré`,
      (await tiroir.locator('[data-piece-ouvrir]').count()) === 0 && (await tiroir.locator('[data-aucune-pas-vue]').first().isVisible().catch(() => false)),
    );
    await tiroir.locator('[data-filtre-pas-vues]').first().click();
    await page.waitForTimeout(250);
    noter(`${gabarit} : filtre éteint, l’œil est posé sur les images vues`, (await tiroir.locator('[data-piece-ouvrir] [data-capture-vue]').count()) >= 3);

  } catch (erreur) {
    noter(`${gabarit} : le parcours des commandes de l’œil va au bout`, false, String(erreur?.message ?? erreur).split('\n')[0]);
    await page.screenshot({ path: `${SHOTS}/visionneuse-${gabarit}-commandes-panne.png` }).catch(() => {});
  } finally {
    await context.close();
  }
  return erreurs;
}

if (!(await attendrePort())) {
  noter('le démon d’essai démarre', false);
  process.exit(1);
}
// Le démon a créé sa base au démarrage : la session et le projet se posent maintenant.
poserLeDecor();
const images = [];
for (const [nom, l, h, c] of [
  ['large.png', 1600, 400, [220, 80, 60]],
  ['haute.png', 400, 1600, [60, 140, 220]],
  ['carree.png', 800, 800, [80, 180, 90]],
]) {
  images.push(await envoyer(nom, png(l, h, c)));
}
noter('les trois images sont envoyées', images.every(Boolean));
if (!images.every(Boolean)) process.exit(1);
poserLaCarte(images.map((i) => i.id));

/* L'ARCHIVE, SANS NAVIGATEUR : elle sort pour l'administrateur, et une pièce inconnue refuse tout. */
const archive = await fetch(`${BASE}/api/attachments/archive?ids=${images.map((i) => i.id).join(',')}&nom=Essai`, {
  headers: { cookie: `beluga_session=${JETON}` },
});
const corps = Buffer.from(await archive.arrayBuffer());
noter('l’archive des trois images sort, en zip', archive.status === 200 && corps.subarray(0, 2).toString() === 'PK', `${archive.status} · ${corps.length} o`);
const refus = await fetch(`${BASE}/api/attachments/archive?ids=${images[0].id},inconnue`, { headers: { cookie: `beluga_session=${JETON}` } });
noter('une pièce inconnue refuse toute l’archive', refus.status === 403, String(refus.status));

/*
 * UN GROS LOT (400 images) : la liste part dans le CORPS, le serveur rend une
 * adresse COURTE, et le zip sort entier. L'ancienne adresse longue mourait en
 * 431 (plus de 16 Ko d'entêtes) — le navigateur n'affichait que « Site non
 * disponible ».
 */
const lot = [];
for (let i = 0; i < 400; i++) lot.push(await envoyer(`lot-${i}.png`, png(4, 4, [i % 256, Math.floor(i / 256), 7])));
noter('les 400 images du gros lot sont envoyées', lot.every(Boolean), `${lot.filter(Boolean).length}/400`);
const preparation = await fetch(`${BASE}/api/attachments/archive`, {
  method: 'POST',
  headers: { cookie: `beluga_session=${JETON}`, 'content-type': 'application/json' },
  body: JSON.stringify({ ids: lot.filter(Boolean).map((i) => i.id), chemins: [], nom: 'Gros lot' }),
});
const { adresse: adresseDuGrosLot } = await preparation.json().catch(() => ({}));
noter(
  'le gros lot se prépare et rend une adresse courte',
  preparation.status === 200 && typeof adresseDuGrosLot === 'string' && adresseDuGrosLot.length < 120,
  `${preparation.status} · ${adresseDuGrosLot}`,
);
const grosZip = adresseDuGrosLot ? await fetch(`${BASE}${adresseDuGrosLot}`, { headers: { cookie: `beluga_session=${JETON}` } }) : null;
const grosCorps = grosZip ? Buffer.from(await grosZip.arrayBuffer()) : Buffer.alloc(0);
const fin = grosCorps.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
const entreesDuZip = fin >= 0 ? grosCorps.readUInt16LE(fin + 10) : -1;
noter(
  'le gros lot se télécharge : un zip de 400 images',
  grosZip?.status === 200 && grosZip.headers.get('content-type') === 'application/zip' && entreesDuZip === 400,
  `${grosZip?.status} · ${entreesDuZip} entrées · ${grosCorps.length} o`,
);
const sansSession = adresseDuGrosLot ? await fetch(`${BASE}${adresseDuGrosLot}`) : null;
noter('l’adresse courte ne sert rien sans session', sansSession?.status === 401, String(sansSession?.status));
const lotInconnu = await fetch(`${BASE}/api/attachments/archive?lot=inconnu`, { headers: { cookie: `beluga_session=${JETON}` } });
noter('un lot inconnu est refusé, avec sa raison', lotInconnu.status === 404 && /relancez/.test((await lotInconnu.json()).error ?? ''), String(lotInconnu.status));
const tropDImages = await fetch(`${BASE}/api/attachments/archive`, {
  method: 'POST',
  headers: { cookie: `beluga_session=${JETON}`, 'content-type': 'application/json' },
  body: JSON.stringify({ ids: Array.from({ length: 1001 }, (_, i) => `id-${i}`), chemins: [], nom: 'Trop' }),
});
noter('plus de 1 000 images : refus clair', tropDImages.status === 400 && /séparément/.test((await tropDImages.json()).error ?? ''), String(tropDImages.status));

const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
const erreurs = [];
try {
  erreurs.push(...(await parcours(navigateur, 'ordinateur', images)));
  erreurs.push(...(await parcours(navigateur, 'telephone', images)));
  // La bande d'une carte : l'ordinateur d'abord (il ouvre des images), le téléphone ensuite (il les retrouve vues).
  erreurs.push(...(await parcoursDeLaBande(navigateur, 'ordinateur', images)));
  erreurs.push(...(await parcoursDeLaBande(navigateur, 'telephone', images)));
  // Les commandes de l'œil, puis la console : un avertissement de développement fait échouer.
  erreurs.push(...(await parcoursDesCommandes(navigateur, images)));
} finally {
  await navigateur.close();
}
noter('aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));
noter('aucun avertissement dans la console', avertissements.length === 0, [...new Set(avertissements)].slice(0, 3).join(' | '));

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis.`);
process.exit(echecs.length ? 1 : 0);
