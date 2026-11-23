#!/usr/bin/env node
/**
 * L'IMAGE D'APERÇU D'UNE VIDÉO, DANS UN VRAI NAVIGATEUR.
 *
 *   npm run build && node scripts/verif-apercu-video.mjs
 *
 * Démon d'essai à soi (base neuve, aucun moteur appelé). La vidéo de contrôle
 * est FABRIQUÉE DANS LA PAGE (canvas + MediaRecorder) : ses deux premières
 * secondes sont volontairement NOIRES, le reste est coloré. Aucun outil de
 * découpe vidéo n'est installé sur la machine, et aucun fichier binaire n'est
 * versionné pour l'occasion.
 *
 * Ce qui est vérifié :
 *   1. l'aperçu affiché n'est PAS le début noir — la recherche automatique a
 *      trouvé une image parlante (repère d'ÉTAT `data-video-apercu`, jamais une
 *      comparaison de pixels) ;
 *   2. l'instant trouvé est GARDÉ sur la pièce : le visiteur suivant ne cherche
 *      plus, et toutes les vignettes de cette vidéo montrent la même image ;
 *   3. une image DÉSIGNÉE à la main devient l'aperçu, et elle est reprise après
 *      rechargement — donc partagée, pas locale à l'appareil ;
 *   4. le second bouton rend la main à la recherche automatique ;
 *   5. côté CLIENT, rien de tout cela : ni bouton d'aperçu, ni mention d'échec
 *      de rédaction, et les deux commandes qui les portent restent closes.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_APERCU_VIDEO_PORT || 7247);
const BASE = `http://127.0.0.1:${PORT}`;
/** Le repli d'avant : la toute première image. Un aperçu resté là, c'est l'échec. */
const SECONDE_DE_REPLI = 0.1;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-apercu-video-',
  port: PORT,
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET = 'p-apercu';
const CARTE = 'c-apercu';
const AGENT = 'ag-apercu';
const CHEF = 'ag-chef';
const TITRE = 'Carte d’aperçu vidéo';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton), maintenant, maintenant + 3600_000, 'vérification aperçu vidéo',
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET, name: 'Essai aperçu', path: DEPOT, defaultEngine: 'claude', isSelf: false,
    rank: 1, archived: false, createdAt: maintenant, updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(PROJET, projet.name, DEPOT, JSON.stringify(projet), maintenant, maintenant);
  // Le cadrage porte la carte : c'est SA conversation qu'une carte encore en
  // « Demande » affiche, et c'est donc là que la vidéo doit être posée.
  for (const [id, role, cardId] of [[AGENT, 'task', CARTE], [CHEF, 'cadrage', CARTE]]) {
    const agent = {
      id, projectId: PROJET, cardId: cardId ?? undefined, role, title: TITRE,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'idle',
      createdAt: maintenant, updatedAt: maintenant,
    };
    db.prepare(
      `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, PROJET, cardId, role, 'idle', JSON.stringify(agent), maintenant, maintenant);
  }
  const carte = {
    id: CARTE, projectId: PROJET, title: TITRE, description: 'Essai de l’aperçu.', labels: [],
    column: 'planned', position: 1, origin: 'agent', agentId: AGENT,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' }, excludedFromDeploy: false, horsTache: false,
    scheduling: { asap: false, attempts: 0, restarts: 0 }, createdAt: maintenant, updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(CARTE, PROJET, 'planned', 1, TITRE, JSON.stringify(carte), maintenant, maintenant);
  db.close();
}

function poserMessageVideo(pieceId) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  const message = {
    id: 'm-apercu', agentId: AGENT, role: 'user', content: 'Voici la vidéo', steps: [], todos: [],
    proposals: [], questions: [], downloads: [], attachments: [pieceId], streaming: false, createdAt: maintenant,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    message.id, AGENT, 'user', JSON.stringify(message), maintenant,
  );
  // La MÊME demande, telle que la ligne de temps de la carte la montre : c'est
  // le point « Demande » qu'on déplie pour voir la vidéo dans son lecteur.
  db.prepare(
    `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, resultat, donnees)
     VALUES (?, ?, 1, 'execution', 'jalon', ?, ?, 'execution', 'tour-apercu', 'Demande', ?, ?)`,
  ).run('j-apercu', CARTE, maintenant, AGENT, 'Voici la vidéo', JSON.stringify({ pieces: [pieceId] }));
  db.close();
}

/** Ce que la base garde de l'aperçu de cette pièce. */
function apercuEnBase(pieceId) {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const ligne = db.prepare('SELECT data FROM attachments WHERE id = ?').get(pieceId);
  db.close();
  if (!ligne) return null;
  const piece = JSON.parse(ligne.data);
  return { seconde: piece.apercuSeconde, manuel: piece.apercuManuel };
}

/** La vidéo d'essai : DEUX SECONDES DE NOIR, puis de la couleur. */
const FABRIQUER_LA_VIDEO = async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 120;
  const ctx = canvas.getContext('2d');
  const flux = canvas.captureStream(20);
  const enregistreur = new MediaRecorder(flux, { mimeType: 'video/webm' });
  const morceaux = [];
  enregistreur.ondataavailable = (e) => morceaux.push(e.data);
  enregistreur.start(200);
  const debut = performance.now();
  await new Promise((fin) => {
    const dessiner = () => {
      const t = performance.now() - debut;
      if (t < 2000) {
        // Le fondu d'ouverture : rien à voir, exactement le cas qui a produit
        // cette carte.
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 160, 120);
      } else {
        ctx.fillStyle = `hsl(${(t / 8) % 360} 90% 50%)`;
        ctx.fillRect(0, 0, 160, 120);
        ctx.fillStyle = '#fff';
        ctx.fillRect(20, 20, 60, 40);
        ctx.fillStyle = '#000';
        ctx.fillRect(90, 60, 50, 40);
      }
      if (t < 8000) requestAnimationFrame(dessiner);
      else fin();
    };
    dessiner();
  });
  await new Promise((fin) => {
    enregistreur.onstop = fin;
    enregistreur.stop();
  });
  const blob = new Blob(morceaux, { type: 'video/webm' });
  const params = new URLSearchParams(location.search);
  const r = await fetch(`/api/upload?project=${params.get('project')}`, {
    method: 'POST',
    headers: { 'content-type': 'video/webm', 'x-file-name': 'debut-noir.webm' },
    body: blob,
  });
  return (await r.json()).attachment;
};

/* ------------------------------------------------------------------ */
/* 5. Le CLIENT ne voit rien de tout cela — vérifié sur les sources     */
/* ------------------------------------------------------------------ */

function verifierLeCloisonnement() {
  const lire = (relatif) => fs.readFileSync(path.join(RACINE, relatif), 'utf8');
  const droits = lire('shared/src/droits-commandes.ts');
  noter(
    'la commande qui écrit un aperçu reste close aux comptes clients',
    !droits.includes("'attachment.apercu'"),
  );
  noter(
    'la commande qui relance une rédaction reste close aux comptes clients',
    !droits.includes("'card.redaction.relancer'"),
  );
  const pieces = lire('web/src/espace/pieces.tsx');
  noter(
    'l’espace client affiche l’aperçu mais ne propose jamais de le changer',
    pieces.includes('apercuSeconde') && !pieces.includes('onChoisir'),
  );
  noter(
    'la petite vignette de galerie passe par la règle commune, plus par une balise nue',
    pieces.includes('<VignetteVideo') && !/<video\s+src=\{`\/api\/attachment/.test(pieces),
  );
  const ecransClients = fs
    .readdirSync(path.join(RACINE, 'web/src/espace'))
    .filter((nom) => nom.endsWith('.tsx'))
    .map((nom) => lire(path.join('web/src/espace', nom)))
    .join('\n');
  noter(
    'aucune mention d’échec de rédaction dans l’espace client',
    !ecransClients.includes('mentionDeRedaction') && !ecransClients.includes('redaction.relancer'),
  );
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  verifierLeCloisonnement();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE }]);
    const page = await contexte.newPage();
    await page.goto(`${BASE}/?project=${PROJET}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const video = await page.evaluate(FABRIQUER_LA_VIDEO);
    noter('la vidéo à début noir est déposée', !!video?.id && video.mime === 'video/webm', `${video?.size} o`);
    if (!video?.id) return;
    poserMessageVideo(video.id);

    /** Ouvre la carte et rend le lecteur de la vidéo. */
    const ouvrirLeLecteur = async (p) => {
      await p.goto(`${BASE}/?project=${PROJET}`, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(3000);
      await p.keyboard.press('Escape');
      await p.locator(`article:has-text(${JSON.stringify(TITRE)})`).first().click();
      await p.waitForTimeout(2500);
      // Les points de la ligne de temps se déplient l'un après l'autre : la
      // vidéo est dans celui qui porte la demande. On vise le point par son
      // ÉTAT (`data-point`), jamais par un libellé — « Demande » est aussi le
      // nom d'une colonne et celui d'une étiquette de carte.
      for (const etape of ['demande', 'travail', 'comprehension']) {
        if (await p.locator(`[data-lecteur-video="${video.id}"]`).count()) break;
        const point = p.locator(`[data-point="${etape}"]`).first();
        if (!(await point.count())) continue;
        if ((await point.getAttribute('data-point-ouvert')) !== 'oui') {
          await point.click({ position: { x: 60, y: 12 } }).catch(() => {});
        }
        await p.waitForTimeout(1500);
      }
      const trouve = p.locator(`[data-lecteur-video="${video.id}"]`).first();
      await trouve.waitFor({ timeout: 15_000 }).catch(() => {});
      await trouve.scrollIntoViewIfNeeded().catch(() => {});
      return trouve;
    };

    /** L'instant d'aperçu affiché, une fois la recherche terminée. */
    const instantAffiche = async (lecteur) => {
      for (let essai = 0; essai < 25; essai += 1) {
        const valeur = Number(await lecteur.getAttribute('data-video-apercu'));
        if (valeur > SECONDE_DE_REPLI) return valeur;
        await lecteur.page().waitForTimeout(500);
      }
      return Number(await lecteur.getAttribute('data-video-apercu'));
    };

    /* 1. L'aperçu affiché n'est pas le début noir. */
    const lecteur = await ouvrirLeLecteur(page);
    const affiche = (await lecteur.count()) > 0;
    noter('la vidéo s’affiche dans le lecteur commun', affiche);
    if (!affiche) {
      // Un écran qui ne montre pas ce qu'on cherche se PHOTOGRAPHIE : sans cela,
      // le contrôle échoue sans dire ce qu'il avait sous les yeux.
      await page.screenshot({ path: '/tmp/apercu-video-sans-lecteur.png', fullPage: true }).catch(() => {});
      console.log('--- écran ---\n' + (await page.evaluate(() => document.body.innerText)).slice(0, 2500));
      return;
    }
    const auto = await instantAffiche(lecteur);
    noter(
      'l’aperçu retenu n’est pas le début noir de la vidéo',
      auto > SECONDE_DE_REPLI,
      `instant ${auto} s (repli ${SECONDE_DE_REPLI} s)`,
    );
    await page.screenshot({ path: path.join(DATA, '..', 'apercu-video-auto.png') }).catch(() => {});

    /* 2. L'instant trouvé est gardé sur la pièce. */
    await page.waitForTimeout(1200);
    const garde = apercuEnBase(video.id);
    noter(
      'l’instant trouvé est gardé sur la vidéo — personne ne recherche deux fois',
      typeof garde?.seconde === 'number' && garde.seconde > SECONDE_DE_REPLI,
      JSON.stringify(garde),
    );
    noter('un instant trouvé automatiquement n’est pas marqué comme un choix', !garde?.manuel);

    /* 3. Une image désignée à la main devient l'aperçu, pour tout le monde. */
    const CHOISI = 4.5;
    await lecteur.locator('video').evaluate((v, t) => {
      v.currentTime = t;
    }, CHOISI);
    await page.waitForTimeout(800);
    await lecteur.locator(`[data-video-definir-apercu="${video.id}"]`).click();
    await page.waitForTimeout(1200);
    const choix = apercuEnBase(video.id);
    noter(
      'l’image désignée devient l’aperçu de la vidéo',
      choix?.manuel === true && Math.abs((choix?.seconde ?? 0) - CHOISI) < 1,
      JSON.stringify(choix),
    );

    const page2 = await contexte.newPage();
    const relu = await ouvrirLeLecteur(page2);
    const apresRechargement = Number(await relu.getAttribute('data-video-apercu'));
    noter(
      'le choix est repris après rechargement — il est partagé, pas local',
      Math.abs(apresRechargement - (choix?.seconde ?? -1)) < 0.01,
      `${apresRechargement} s`,
    );
    noter(
      'le lecteur dit que son aperçu a été désigné',
      (await relu.getAttribute('data-video-apercu-manuel')) !== null,
    );
    await page2.close();

    /* 4. Le retour à l'aperçu automatique. */
    await lecteur.locator(`[data-video-apercu-auto="${video.id}"]`).click();
    await page.waitForTimeout(1200);
    const rendu = apercuEnBase(video.id);
    noter(
      'le second bouton rend la main à la recherche automatique',
      rendu?.seconde === undefined && !rendu?.manuel,
      JSON.stringify(rendu),
    );
  } finally {
    await navigateur.close();
  }
}

try {
  await main();
} catch (err) {
  noter('déroulé sans exception', false, err?.stack ?? String(err));
  console.error(journal.slice(-30).join(''));
}
nettoyer();
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passées.`);
process.exit(echecs ? 1 : 0);
