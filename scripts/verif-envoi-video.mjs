#!/usr/bin/env node
/**
 * LES VIDÉOS ET GROS FICHIERS DANS LA CONVERSATION D'UNE TÂCHE.
 *
 *   node scripts/verif-envoi-video.mjs
 *
 * Démon d'essai à soi (base neuve, aucun moteur appelé), avec un FAUX disque de
 * stockage (dossier temporaire portant son témoin). Ce qui est vérifié :
 *   1. le démon écrit la pièce sur le disque de stockage, pas dans `data/` ;
 *   2. une taille annoncée au-delà de 2 Go est refusée (413) sans rien écrire ;
 *   3. la lecture partielle répond 206 avec la bonne plage, et 416 hors fichier ;
 *   4. dans la barre d'écriture, un gros envoi montre SA barre et SON
 *      pourcentage, qui avance ; la croix l'annule : la ligne disparaît, aucune
 *      pièce n'est ajoutée, aucun fichier provisoire ne reste sur le disque ;
 *   5. un envoi mené au bout ajoute la pièce au brouillon ;
 *   6. une vidéo jointe à un message du fil s'affiche dans un LECTEUR, qui
 *      charge ses métadonnées par lecture partielle.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_ENVOI_VIDEO_PORT || 7241);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const TMP_DISQUE = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'verif-envoi-disque-'));
fs.writeFileSync(path.join(TMP_DISQUE, '.beluga-pieces-jointes'), '');
// Le faux disque de stockage, déclaré au démon d'essai (`server/src/pieces-jointes.ts`).
const envDuDisque = { BELUGA_PIECES_JOINTES: TMP_DISQUE, BELUGA_PIECES_JOINTES_EN_ESSAI: '1' };
const { TMP, DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-envoi-video-',
  port: PORT,
  env: envDuDisque,
});
process.on('exit', () => fs.rmSync(TMP_DISQUE, { recursive: true, force: true }));

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET = 'p-essai';
const CARTE = 'c-video';
const AGENT = 'ag-video';
const TITRE = 'Carte vidéo — essai';
const CHEF = 'ag-chef';
const TEXTE_VIDEO = 'Voici la vidéo à regarder';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton), maintenant, maintenant + 3600_000, 'vérification envoi vidéo',
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET, name: 'Essai vidéo', path: DEPOT, defaultEngine: 'claude', isSelf: false,
    rank: 1, archived: false, createdAt: maintenant, updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(PROJET, projet.name, DEPOT, JSON.stringify(projet), maintenant, maintenant);
  const agent = {
    id: AGENT, projectId: PROJET, cardId: CARTE, role: 'task', title: TITRE,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'idle',
    startedAt: maintenant, createdAt: maintenant, updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(AGENT, PROJET, CARTE, 'task', 'idle', JSON.stringify(agent), maintenant, maintenant);
  const chef = {
    id: CHEF, projectId: PROJET, role: 'cadrage', title: 'Chef d’orchestre',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'idle',
    createdAt: maintenant, updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(CHEF, PROJET, 'cadrage', 'idle', JSON.stringify(chef), maintenant, maintenant);
  const carte = {
    id: CARTE, projectId: PROJET, title: TITRE, description: 'Essai des vidéos.', labels: [],
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
    id: 'm-video', agentId: CHEF, role: 'user', content: TEXTE_VIDEO, steps: [], todos: [],
    proposals: [], questions: [], downloads: [], attachments: [pieceId], streaming: false, createdAt: maintenant,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    message.id, CHEF, 'user', JSON.stringify(message), maintenant,
  );
  // La même demande, telle que la ligne de temps de la carte la montre.
  db.prepare(
    `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, resultat, donnees)
     VALUES (?, ?, 1, 'execution', 'jalon', ?, ?, 'execution', 'tour-video', 'Demande', ?, ?)`,
  ).run('j-video', CARTE, maintenant, AGENT, TEXTE_VIDEO, JSON.stringify({ pieces: [pieceId] }));
  db.close();
}

const entetes = { cookie: `beluga_session=${jeton}` };

async function televerser(nom, type, corps, extra = {}) {
  const r = await fetch(`${BASE}/api/upload?project=${PROJET}&agent=${AGENT}&card=${CARTE}`, {
    method: 'POST',
    headers: { ...entetes, 'content-type': type, 'x-file-name': encodeURIComponent(nom), ...extra },
    body: corps,
    duplex: 'half',
  });
  return { statut: r.status, corps: await r.json().catch(() => ({})) };
}

const provisoires = () => fs.readdirSync(TMP_DISQUE).filter((n) => n.startsWith('.envoi-'));

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  /* 1. Le disque de stockage reçoit la pièce. */
  const petit = crypto.randomBytes(300_000);
  const envoi = await televerser('petit.bin', 'application/octet-stream', petit);
  const piece = envoi.corps.attachment;
  const surDisque = piece && fs.readdirSync(TMP_DISQUE).find((n) => n.endsWith('-petit.bin'));
  noter('la pièce est écrite sur le disque de stockage', !!surDisque && fs.statSync(path.join(TMP_DISQUE, surDisque)).size === petit.length, `statut ${envoi.statut}`);
  noter('rien dans l’ancien dossier', !fs.existsSync(path.join(DATA, 'attachments')) || !fs.readdirSync(path.join(DATA, 'attachments')).some((n) => n.endsWith('petit.bin')));
  noter('l’empreinte est celle du fichier', piece?.sha === sha(petit) && piece?.size === petit.length);

  /* 2. Plafond de 2 Go annoncé. */
  const trop = await new Promise((resolve) => {
    import('node:http').then(({ default: http }) => {
      const req = http.request(`${BASE}/api/upload?project=${PROJET}`, {
        method: 'POST',
        headers: { ...entetes, 'content-type': 'video/mp4', 'x-file-name': 'enorme.mp4', 'content-length': String(2 * 1024 ** 3 + 1) },
      }, (res) => {
        let texte = '';
        res.on('data', (d) => (texte += d));
        res.on('end', () => resolve({ statut: res.statusCode, texte }));
      });
      req.on('error', (e) => resolve({ statut: 0, texte: e.message }));
      req.write(Buffer.alloc(1000));
    });
  });
  noter('au-delà de 2 Go : refus 413 avec sa raison', trop.statut === 413 && /2 Go/.test(trop.texte), `${trop.statut} ${trop.texte.slice(0, 80)}`);
  await new Promise((r) => setTimeout(r, 300));
  noter('le refus ne laisse aucun provisoire', provisoires().length === 0, provisoires().join(', '));

  /* 3. Lecture partielle. */
  const partiel = await fetch(`${BASE}/api/attachment?id=${piece.id}`, { headers: { ...entetes, range: 'bytes=100-199' } });
  const morceau = Buffer.from(await partiel.arrayBuffer());
  noter('Range → 206 et la bonne plage',
    partiel.status === 206 && partiel.headers.get('content-range') === `bytes 100-199/${petit.length}` && morceau.equals(petit.subarray(100, 200)),
    `${partiel.status} ${partiel.headers.get('content-range')}`);
  const hors = await fetch(`${BASE}/api/attachment?id=${piece.id}`, { headers: { ...entetes, range: `bytes=${petit.length}-` } });
  noter('plage hors fichier → 416', hors.status === 416, String(hors.status));
  const entier = await fetch(`${BASE}/api/attachment?id=${piece.id}`, { headers: entetes });
  noter('sans Range → 200, accept-ranges et taille', entier.status === 200 && entier.headers.get('accept-ranges') === 'bytes' && Number(entier.headers.get('content-length')) === petit.length);
  await entier.arrayBuffer();

  /* 4-6. L'écran. */
  const gros = path.join(TMP, 'gros-fichier.bin');
  fs.writeFileSync(gros, crypto.randomBytes(1024 * 1024));
  const bloc = fs.readFileSync(gros);
  const fd = fs.openSync(gros, 'a');
  for (let i = 0; i < 119; i += 1) fs.writeSync(fd, bloc); // 120 Mo
  fs.closeSync(fd);

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE }]);
    const page = await contexte.newPage();
    const cdp = await contexte.newCDPSession(page);
    await cdp.send('Network.enable');
    // 8 Mo/s : 120 Mo prennent 15 s, de quoi voir la barre avancer.
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: 8 * 1024 * 1024 });
    const plages = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/attachment') && r.status() === 206) plages.push(r.url());
    });

    await page.goto(`${BASE}/?project=${PROJET}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.locator(`article:has-text(${JSON.stringify(TITRE)})`).first().click();
    await page.waitForTimeout(2500);
    const champ = page.locator('[data-composer] input[data-composer-file]').last();
    const piecesDuBrouillon = async () => {
      const bloc = page.locator('[data-composer]').last().locator('[data-pieces-jointes]');
      return (await bloc.count()) ? Number(await bloc.first().getAttribute('data-pieces-jointes')) : 0;
    };
    noter('la barre d’écriture de la carte est là', (await champ.count()) > 0);

    await champ.setInputFiles(gros);
    const ligne = page.locator('[data-envoi="gros-fichier.bin"]').last();
    await ligne.waitFor({ timeout: 10_000 });
    await page.waitForTimeout(2500);
    const p1 = Number(await ligne.getAttribute('data-envoi-part'));
    await page.waitForTimeout(2500);
    const p2 = Number(await ligne.getAttribute('data-envoi-part'));
    const barre = await ligne.locator('[data-barre-progression]').getAttribute('data-pourcent');
    noter('la ligne d’envoi montre sa progression, qui avance', p2 > p1 && p1 >= 0 && p2 < 100 && Number(barre) >= p1, `${p1} % → ${p2} % (barre ${barre})`);
    const texteLigne = await ligne.innerText();
    noter('le pourcentage et les tailles sont écrits', /\d+ %/.test(texteLigne) && /Mo/.test(texteLigne), texteLigne.replace(/\s+/g, ' '));
    await page.screenshot({ path: path.join(TMP, 'envoi-en-cours.png') });
    fs.mkdirSync('/root/beluga/data/verification', { recursive: true });
    fs.copyFileSync(path.join(TMP, 'envoi-en-cours.png'), '/root/beluga/data/verification/envoi-video-progression.png');

    await ligne.locator('[data-envoi-annuler]').click();
    await page.waitForTimeout(1500);
    noter('la croix retire la ligne', (await page.locator('[data-envoi]').count()) === 0);
    noter('aucune pièce ajoutée après annulation', (await piecesDuBrouillon()) === 0, `${await piecesDuBrouillon()}`);
    await page.waitForTimeout(1500);
    noter('aucun provisoire ne reste sur le disque', provisoires().length === 0, provisoires().join(', '));
    const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
    const nb = db.prepare("SELECT COUNT(*) AS n FROM attachments WHERE json_extract(data, '$.name') LIKE 'gros-fichier%'").get().n;
    db.close();
    noter('aucune pièce enregistrée en base', nb === 0, `${nb}`);

    /* 5. Un envoi mené au bout. */
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const moyen = path.join(TMP, 'moyen.bin');
    fs.writeFileSync(moyen, crypto.randomBytes(5 * 1024 * 1024));
    await champ.setInputFiles(moyen);
    await page.waitForFunction(() => !document.querySelector('[data-envoi]'), null, { timeout: 30_000 });
    await page.waitForTimeout(800);
    noter('un envoi terminé rejoint le brouillon', (await piecesDuBrouillon()) === 1, `${await piecesDuBrouillon()} pièce(s)`);

    /* 6. Le lecteur vidéo du fil. */
    const video = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 120;
      const ctx = canvas.getContext('2d');
      const flux = canvas.captureStream(15);
      const enregistreur = new MediaRecorder(flux, { mimeType: 'video/webm' });
      const morceaux = [];
      enregistreur.ondataavailable = (e) => morceaux.push(e.data);
      enregistreur.start(200);
      const debut = performance.now();
      await new Promise((fin) => {
        const dessiner = () => {
          const t = performance.now() - debut;
          ctx.fillStyle = `hsl(${(t / 10) % 360} 80% 50%)`;
          ctx.fillRect(0, 0, 160, 120);
          if (t < 2000) requestAnimationFrame(dessiner);
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
        headers: { 'content-type': 'video/webm', 'x-file-name': 'essai.webm' },
        body: blob,
      });
      return (await r.json()).attachment;
    });
    noter('la vidéo d’essai est déposée', !!video?.id && video.mime === 'video/webm', `${video?.size} o`);
    poserMessageVideo(video.id);
    // Le fil du chef d'orchestre, affiché d'office sur un écran large.
    const contexte2 = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await contexte2.addCookies([{ name: 'beluga_session', value: jeton, url: BASE }]);
    const page2 = await contexte2.newPage();
    page2.on('response', (r) => {
      if (r.url().includes('/api/attachment') && r.status() === 206) plages.push(r.url());
    });
    await page2.goto(`${BASE}/?project=${PROJET}`, { waitUntil: 'domcontentloaded' });
    await page2.waitForTimeout(3000);
    await page2.keyboard.press('Escape');
    await page2.locator(`article:has-text(${JSON.stringify(TITRE)})`).first().click();
    await page2.waitForTimeout(2500);
    // Le point « Demande » se déplie pour montrer la demande et ses pièces.
    const lecteurFil = page2.locator(`[data-video-fil="${video.id}"] video`).first();
    for (const point of ['Demande', 'Votre demande est notée.']) {
      if (await lecteurFil.count()) break;
      await page2.getByText(point, { exact: true }).first().click().catch(() => {});
      await lecteurFil.waitFor({ timeout: 4_000 }).catch(() => {});
    }
    const lecteur = page2.locator(`[data-video-fil="${video.id}"] video`).first();
    await lecteur.waitFor({ timeout: 10_000 }).catch(() => {});
    noter('le fil montre un lecteur vidéo', (await lecteur.count()) > 0);
    if (!(await lecteur.count())) await page2.screenshot({ path: '/root/beluga/data/verification/envoi-video-sans-lecteur.png' });
    if (await lecteur.count()) {
      await lecteur.scrollIntoViewIfNeeded();
      const pret = await lecteur.evaluate((v) => new Promise((ok) => {
        if (v.readyState >= 1) return ok(v.readyState);
        v.addEventListener('loadedmetadata', () => ok(v.readyState), { once: true });
        v.addEventListener('error', () => ok(-1), { once: true });
        setTimeout(() => ok(v.readyState), 8000);
      }));
      noter('le lecteur charge ses métadonnées', pret >= 1, `readyState ${pret}`);
      const joue = await lecteur.evaluate(async (v) => {
        v.muted = true;
        try {
          await v.play();
        } catch {
          return false;
        }
        await new Promise((r) => setTimeout(r, 800));
        return v.currentTime > 0;
      });
      noter('la vidéo se lit', joue);
      noter('le lecteur passe par la lecture partielle (206)', plages.length > 0, `${plages.length} réponse(s) 206`);
      await lecteur.evaluate((v) => v.pause());
      await page2.screenshot({ path: '/root/beluga/data/verification/envoi-video-lecteur.png' });
    }
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
