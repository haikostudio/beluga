#!/usr/bin/env node
/**
 * LE STUDIO CRÉATIF, CARTE 2 SUR 5 : LE RESPONSABLE CRÉATIF, de bout en bout
 * dans un vrai navigateur, au CADRAGE d'une carte caméra.
 *
 *   node scripts/verif-responsable-creatif.mjs
 *
 * Le script monte son PROPRE démon (`BELUGA_RESPONSABLE_PORT`, 7243 par
 * défaut), avec une base neuve, un FAUX moteur et un réseau piégé (tout appel à
 * fal.ai ou Higgsfield est noté) : pas un centime n'est dépensé. Il ne lit
 * JAMAIS `BELUGA_URL` ni `BELUGA_TOKEN`. À lancer depuis une copie de travail,
 * jamais depuis le dépôt principal.
 *
 * Le faux cadrage fait ce qu'un vrai ferait avec l'outil « production » : il
 * relève ce que la phrase dit déjà, pose UN formulaire de questions, écrit le
 * brief, puis trois directions, le scénario, le storyboard et la liste des
 * plans, avec le choix de la direction ; enfin il retouche un plan. Tout cela
 * est le BRIEF, première des quatre étapes (Brief → Esquisses → Montage →
 * Téléchargement, 26/10/2026) : rien ne se fabrique avant « Passer aux esquisses ».
 *
 * Ce qui est vérifié, à la souris :
 *   1. le cadrage reçoit « production », et « realiser » (caméra allumée) —
 *      sans qu'aucun appel payant ne parte au brief ;
 *   0. le type se confirme dans la discussion (plus de bouton caméra : une étiquette), et rien ne
 *      s'ouvre à droite avant ;
 *   2. le formulaire arrive EN UNE FOIS : trois questions, la question déjà
 *      répondue par la phrase écartée, montrées UNE À UNE au dessin habituel ;
 *      on répond à deux, on passe la troisième, et l'agent reçoit les trois
 *      lignes ensemble, d'un seul envoi ;
 *   3. la direction se choisit parmi trois d'un clic, puis scénario,
 *      storyboard et plans s'écrivent sans arrêt ; tout se range sous
 *      « Brief » dans le suivi à droite, les quatre étapes de la barre en haut,
 *      et le bouton du bas dit « Passer aux esquisses », allumé ;
 *   3 bis. la mise en page des pièces : titre en gras sur une bande de fond
 *      plus marquée que la pièce, sans intitulé « Écrit » au-dessus,
 *      intitulés en gras, tableau du scénario en vrai tableau ; les pistes
 *      écartées quittent la liste une fois une direction retenue ;
 *   4. le plan retouché garde sa version : un menu « Versions » en haut à
 *      droite, la v1 s'ouvre dans un tiroir et « Utiliser cette version »
 *      écrit une v3 avec l'ancien contenu ; un second clic n'en écrit pas une
 *      quatrième ;
 *   4 ter. une piste écartée se reprend depuis le menu « Versions » de la
 *      direction retenue, dans le tiroir ;
 *   4 bis. « Modifier » corrige le brief sur place : une v2 « par vous », la
 *      direction à revalider, et les pistes écartées restent hors de la liste ; « Corriger avec l'agent » pose l'étiquette de
 *      la pièce dans la barre d'écriture (ou sous la pièce sans barre) ;
 *   2 bis. sur téléphone, le formulaire en attente : intitulé à gauche et
 *      « Répondre » à droite, cadre jaune (panneau, feuille du bas, et sur
 *      ordinateur), toutes les étapes visibles, bouton de réalisation sans
 *      libellé ; le focus du champ replie le repère sur sa ligne et le blur le
 *      rouvre, sans toucher au pli retenu ; rien de tel sur ordinateur ;
 *   5. aucun appel payant, aucun média en base ; aucune erreur de page.
 */
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exiger = createRequire(path.join(RACINE, 'package.json'));
const Database = exiger('better-sqlite3');
const { WebSocket } = exiger('ws');
const PORT = Number(process.env.BELUGA_RESPONSABLE_PORT || 7243);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-responsable-'));
const PROJET_ID = 'projet-responsable';
let CARTE_ID = '';
let PIECE_FOURNIE = '';
let contrastesEnClair = null;
const CAPTURES = path.join(RACINE, 'data', 'verification', 'responsable-creatif');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
const MAISON = path.join(TMP, 'maison');
const COMPTE = path.join(TMP, 'compte-claude');
for (const dossier of [DATA, PROJETS, DEPOT, MAISON, COMPTE, CAPTURES]) fs.mkdirSync(dossier, { recursive: true });
fs.writeFileSync(path.join(COMPTE, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'jeton-d-essai', expiresAt: Date.now() + 3600_000 } }));
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], { cwd: DEPOT });

/* LE FAUX fal.ai : chargé dans le démon AVANT tout, il remplace fetch pour fal.ai seulement. */
const APPELS_FAL = path.join(TMP, 'appels-fal.log');
const PIEGE = path.join(TMP, 'faux-fal.mjs');
fs.writeFileSync(
  PIEGE,
  `import fs from 'node:fs';
const vrai = globalThis.fetch;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (adresse, init) => {
  const url = String(adresse?.url ?? adresse);
  if (!/fal\\.ai|fal\\.run|fal\\.test|higgsfield/.test(url)) return vrai(adresse, init);
  fs.appendFileSync(${JSON.stringify(APPELS_FAL)}, (init?.method ?? 'GET') + ' ' + url + '\\n');
  if (url.startsWith('https://api.fal.ai/v1/models/pricing')) {
    const id = new URL(url).searchParams.get('endpoint_id');
    return json({ prices: [{ endpoint_id: id, unit_price: 0.4, unit: 'image' }] });
  }
  if (url.startsWith('https://queue.fal.run/etat/')) return json({ status: 'COMPLETED' });
  if (url.startsWith('https://queue.fal.run/resultat/')) return json({ images: [{ url: 'https://cdn.fal.test/plan.png' }] });
  if (url.startsWith('https://queue.fal.run/')) return json({ status_url: 'https://queue.fal.run/etat/1', response_url: 'https://queue.fal.run/resultat/1' });
  if (url.startsWith('https://cdn.fal.test/')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
  return new Response('{}', { status: 404 });
};
`,
);

/*
 * LE FAUX MOTEUR — le cadrage de la carte caméra. Chaque appel qui pose une
 * question (« formulaire », « soumettre ») RESTE OUVERT jusqu'à la réponse,
 * comme avec un vrai pont d'outils : tout s'enchaîne dans un seul tour.
 */
const FAUX_MOTEUR = path.join(TMP, 'faux-claude.mjs');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/usr/bin/env node
import fs from 'node:fs';
if (process.argv.includes('--version')) { process.stdout.write('faux-moteur 0.0.0 (essai)\\n'); process.exit(0); }
let demande = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (demande += d));
process.stdin.on('end', () => jouer());
const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const TMP = ${JSON.stringify(TMP)};
async function jouer() {
  dire({ type: 'system', subtype: 'init', session_id: 'session-' + Math.random().toString(16).slice(2) });
  const cheminMcp = process.argv[process.argv.indexOf('--mcp-config') + 1];
  const pont = cheminMcp && fs.existsSync(cheminMcp) ? JSON.parse(fs.readFileSync(cheminMcp, 'utf8')).mcpServers?.beluga?.env : null;
  const entetes = pont ? { 'content-type': 'application/json', 'x-beluga-token': pont.BELUGA_TOKEN, 'x-beluga-agent': pont.BELUGA_AGENT, 'x-beluga-tour': pont.BELUGA_TOUR } : {};
  const appeler = async (name, args) => {
    if (!pont) return null;
    const res = await fetch(pont.BELUGA_URL + '/internal/call', { method: 'POST', headers: entetes, body: JSON.stringify({ name, args }) });
    let rendu = await res.json().catch(() => null);
    while (rendu?.attente?.questionId) {
      const r = await fetch(pont.BELUGA_URL + '/internal/attente', { method: 'POST', headers: entetes, body: JSON.stringify({ questionId: rendu.attente.questionId }) });
      const issue = await r.json().catch(() => null);
      if (issue?.etat === 'attente') continue;
      rendu = issue;
    }
    fs.appendFileSync(TMP + '/pont.log', JSON.stringify({ name, args, rendu }) + '\\n');
    return rendu;
  };
  const cardId = /Identifiant de cette carte[^:]*:\\s*([0-9a-f-]{36})/i.exec(demande)?.[1];
  if (cardId) await appeler('board_update_card', { cardId, title: 'Publicité de l’application' });
  if (pont) {
    const res = await fetch(pont.BELUGA_URL + '/internal/tools', { method: 'POST', headers: entetes, body: '{}' });
    const outils = ((await res.json().catch(() => ({}))).tools ?? []).map((t) => t.name);
    fs.appendFileSync(TMP + '/outils.log', JSON.stringify(outils) + '\\n');
  }
  if (pont && demande.includes('MODE RÉALISATION ALLUMÉ') && !fs.existsSync(TMP + '/fait.txt')) {
    fs.writeFileSync(TMP + '/fait.txt', '1');
    const P = (args) => appeler('production', args);
    /* Comme un vrai cadrage : les types de média et l'enveloppe d'abord (ici : une vidéo, pas d'aperçus). */
    await appeler('cahier_de_realisation', {
      document: '# Réalisation\\n\\n## Intention\\nFaire installer l’application.\\n',
      faites: 2,
      total: 8,
      phase: 'intention',
      restants: ['Brief'],
      enveloppe: 0,
    });
    await P({ action: 'brief', champs: [
      { champ: 'objectif', valeur: 'Faire installer l’application', source: 'demande' },
      { champ: 'public', valeur: 'Indépendants', source: 'demande' },
      { champ: 'duree', valeur: '15 s', source: 'demande' },
    ] });
    await P({ action: 'formulaire', questions: [
      { champ: 'public', question: 'À qui parle la vidéo ?', options: [{ label: 'Indépendants' }] },
      { champ: 'ton', question: 'Quel ton ?', options: [{ label: 'Complice (recommandé)' }, { label: 'Sérieux' }, { label: 'Décalé' }] },
      { champ: 'format', question: 'Quels formats ?', kind: 'multiple', options: [{ label: '9:16 (recommandé)' }, { label: '1:1' }, { label: '16:9' }] },
      { champ: 'appel', question: 'Quel appel à l’action ?', options: [{ label: 'Télécharger (recommandé)' }, { label: 'Essai gratuit' }] },
    ] });
    await P({ action: 'brief', champs: [{ champ: 'ton', valeur: 'Complice', source: 'reponse' }, { champ: 'format', valeur: '9:16', source: 'reponse' }] });
    await P({ action: 'concept', directions: [
      { titre: 'Néon nocturne', contenu: 'Une ville la nuit, des enseignes, le téléphone qui s’allume.' },
      { titre: 'Plein soleil', contenu: 'Une terrasse, la lumière chaude, un indépendant soulagé.' },
      { titre: 'Papier découpé', contenu: 'Une animation en papier, ludique.' },
    ] });
    await P({ action: 'soumettre', etape: 'idee' });
    const pieceFournie = fs.existsSync(TMP + '/piece.txt') ? fs.readFileSync(TMP + '/piece.txt', 'utf8').trim() : '';
    if (pieceFournie) await P({ action: 'piece_recue', nom: 'Logo de l’application', piece: pieceFournie });
    await P({ action: 'script', titre: 'Scénario', contenu: 'RÈGLE : le bénéfice dit tout de suite.\\n\\nLe logo de l’application ferme la vidéo.\\n\\n| Temps | Visuel | Voix off |\\n|---|---|---|\\n| 0-2 s | Le téléphone | Le bénéfice |\\n| 2-12 s | Avant / après | La preuve |\\n| 12-15 s | Le logo | Télécharger |' });
    await P({ action: 'storyboard', scenes: [{ titre: 'Scène 1 — la terrasse', contenu: 'Plan large, soleil.' }, { titre: 'Scène 2 — le téléphone', contenu: 'Gros plan, écran vide remplaçable.' }] });
    await P({ action: 'plans', plans: [{ titre: 'Plan 1', contenu: 'Plan large de la terrasse, 3 s.\\nCapacité : montage', scene: 'scene-1' }, { titre: 'Plan 2', contenu: 'Gros plan sur l’écran, 3 s.\\nCapacité : montage', scene: 'scene-2' }] });
    await P({ action: 'modifier', cle: 'plan-1', contenu: 'Plan serré sur le visage, 2 s.' });
  }
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'La chaîne d’écriture est prête.' }] } });
  dire({ type: 'result', subtype: 'success', session_id: 'session-essai', usage: { input_tokens: 10, output_tokens: 5 } });
  process.exit(0);
}
`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

const journal = [];
const envDuDemon = { ...process.env };
delete envDuDemon.BELUGA_TOKEN;
delete envDuDemon.BELUGA_URL;
const demon = spawn('node', ['--import', PIEGE, path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...envDuDemon,
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    // Aucun modèle de traduction ici : les consignes passent telles quelles (traduction-des-consignes.ts).
    BELUGA_TRADUCTION_IDENTITE: "1",
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
    BELUGA_CLAUDE_BIN: FAUX_MOTEUR,
    BELUGA_MEDIAS: path.join(TMP, 'disque-de-stockage', 'beluga-medias'),
    HOME: MAISON,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));
process.on('exit', () => {
  if (process.env.BELUGA_RESPONSABLE_JOURNAL) fs.writeFileSync(process.env.BELUGA_RESPONSABLE_JOURNAL, journal.join(''));
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  if (!process.env.BELUGA_RESPONSABLE_GARDER) fs.rmSync(TMP, { recursive: true, force: true });
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
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const jeton = crypto.randomBytes(24).toString('hex');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const base = (lecture = false) => new Database(path.join(DATA, 'beluga.db'), { readonly: lecture });

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), maintenant, maintenant + 3600_000, 'vérification responsable créatif');
  db.prepare('DELETE FROM projects').run();
  const projet = { id: PROJET_ID, name: 'Essai responsable créatif', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: maintenant, updatedAt: maintenant };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);
  db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    'compte-essai',
    'claude',
    JSON.stringify({ id: 'compte-essai', engine: 'claude', label: 'Compte d’essai', priority: 1, configDir: COMPTE }),
    maintenant,
  );
  db.close();
}


function commande(cmd) {
  return new Promise((resolve, reject) => {
    const prise = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Cookie: `beluga_session=${jeton}` } });
    const id = crypto.randomBytes(6).toString('hex');
    const minuteur = setTimeout(() => (prise.close(), reject(new Error('le démon ne répond pas'))), 40000);
    prise.on('open', () => prise.send(JSON.stringify({ id, cmd })));
    prise.on('message', (brut) => {
      const evenement = JSON.parse(String(brut));
      if (evenement.type !== 'ack' || evenement.id !== id) return;
      clearTimeout(minuteur);
      prise.close();
      if (evenement.error) reject(new Error(evenement.error));
      else resolve(evenement);
    });
    prise.on('error', (e) => (clearTimeout(minuteur), reject(e)));
  });
}

/** Les fichiers d'une archive zip SANS compression (celle de l'archive des images), lus par son répertoire central. */
function lireZip(octets) {
  const fichiers = new Map();
  let fin = octets.length - 22;
  while (fin >= 0 && octets.readUInt32LE(fin) !== 0x06054b50) fin--;
  if (fin < 0) return fichiers;
  const nombre = octets.readUInt16LE(fin + 10);
  let p = octets.readUInt32LE(fin + 16);
  for (let i = 0; i < nombre && octets.readUInt32LE(p) === 0x02014b50; i++) {
    const taille = octets.readUInt32LE(p + 20);
    const n = octets.readUInt16LE(p + 28);
    const x = octets.readUInt16LE(p + 30);
    const c = octets.readUInt16LE(p + 32);
    const local = octets.readUInt32LE(p + 42);
    const nom = octets.subarray(p + 46, p + 46 + n).toString('utf8');
    const debut = local + 30 + octets.readUInt16LE(local + 26) + octets.readUInt16LE(local + 28);
    fichiers.set(nom, octets.subarray(debut, debut + taille));
    p += 46 + n + x + c;
  }
  return fichiers;
}

async function attendre(condition, limiteMs = 20000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** Ouvre la carte d'essai depuis le tableau, comme à la souris. */
async function ouvrirLaCarte(page) {
  /* L'accueil est le tableau de bord : la carte s'ouvre par son adresse, comme un lien interne. */
  await page.goto(`${BASE}/#projet/${PROJET_ID}/tache/${CARTE_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });
  const vignette = page.locator(`[data-carte="${CARTE_ID}"]:visible`).first();
  await vignette.waitFor({ timeout: 30000 }).catch(() => {});
  await vignette.click().catch(() => {});
  await page.locator(`[data-page-carte="${CARTE_ID}"]`).first().waitFor({ timeout: 20000 }).catch(() => {});
}

const appelsPayants = () => (fs.existsSync(APPELS_FAL) ? fs.readFileSync(APPELS_FAL, 'utf8').trim().split('\n').filter(Boolean) : []);
const pont = () => (fs.existsSync(path.join(TMP, 'pont.log')) ? fs.readFileSync(path.join(TMP, 'pont.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const versionsDuPlan = () => {
  const db = base(true);
  const n = db.prepare("SELECT COUNT(*) AS n FROM production_elements WHERE card_id = ? AND cle = 'plan-1'").get(CARTE_ID).n;
  db.close();
  return n;
};

/** La couleur calculée du bord haut d'un élément, en [r, g, b, a]. */
async function bordureDe(locator) {
  if (!(await locator.count())) return null;
  return locator.evaluate((el) => {
    const st = getComputedStyle(el);
    const m = st.borderTopColor.match(/[\d.]+/g)?.map(Number) ?? [];
    return { rgb: [m[0], m[1], m[2], m[3] ?? 1], largeur: parseFloat(st.borderTopWidth) };
  });
}
/** Un jaune franc : rouge et vert hauts, bleu bas, opaque, sur 1 px au moins. */
const estJaune = (b) => !!b && b.largeur >= 1 && b.rgb[3] > 0.9 && b.rgb[0] > 180 && b.rgb[1] > 140 && b.rgb[2] < 120 && b.rgb[0] - b.rgb[2] > 100;

/**
 * SUR TÉLÉPHONE, LE FORMULAIRE DU BRIEF EN ATTENTE (demande du 25/10/2026,
 * captures #1640, #c92f, #5e66) : l'intitulé à gauche et « Répondre » à droite
 * sur la même rangée, un cadre jaune (panneau et feuille du bas), les étapes du
 * tournage toutes visibles, le bouton de réalisation sans libellé, et le repère
 * replié sur sa ligne tant que le champ a le focus — sans toucher au pli retenu.
 */
async function controlerLeTelephone(navigateur, erreurs) {
  const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-CH', serviceWorkers: 'block', isMobile: true, hasTouch: true });
  await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const p = await tel.newPage();
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await ouvrirLaCarte(p);
  const bulle = p.locator('[data-question-compacte]').first();
  if (!(await attendre(async () => (await bulle.count()) === 1, 20000))) {
    noter('sur téléphone, la question compacte s’affiche', false);
    await tel.close();
    return;
  }
  await p.waitForTimeout(1500);
  const geo = await bulle.evaluate((el) => {
    const r = (q) => el.querySelector(q)?.getBoundingClientRect();
    const t = r('[data-intitule-question]');
    const b = r('[data-repondre-question]');
    return t && b ? { tDroite: t.right, tHaut: t.top, tBas: t.bottom, bGauche: b.left, bMilieu: (b.top + b.bottom) / 2, bDroite: b.right, bulleDroite: el.getBoundingClientRect().right } : null;
  });
  noter(
    'sur téléphone, « Répondre » est à droite de l’intitulé, sur la même rangée',
    !!geo && geo.bGauche >= geo.tDroite && geo.bMilieu >= geo.tHaut - 8 && geo.bMilieu <= geo.tBas + 8 && geo.bulleDroite - geo.bDroite < 24,
    JSON.stringify(geo),
  );
  noter('sur téléphone, la question du panneau porte un cadre jaune', estJaune(await bordureDe(bulle)));
  await p.screenshot({ path: path.join(CAPTURES, 'telephone-question.png') });

  /* La feuille du bas, ouverte par « Répondre », garde le cadre jaune. */
  await bulle.locator('[data-repondre-question]').tap();
  const feuille = p.locator('[data-feuille-question]').first();
  if (await attendre(async () => (await feuille.count()) === 1, 8000)) {
    const cadre = await feuille.evaluate((el) => (el.matches('[data-bulle-question]') ? el : el.querySelector('[data-bulle-question]'))?.getAttribute('data-bulle-question') ?? null);
    const b = await bordureDe(p.locator('[data-feuille-question][data-bulle-question], [data-feuille-question] [data-bulle-question]').first());
    noter('dans la feuille du bas, la question porte un cadre jaune', cadre !== null && estJaune(b), JSON.stringify(b));
    await p.screenshot({ path: path.join(CAPTURES, 'telephone-feuille-question.png') });
  } else {
    noter('« Répondre » ouvre la feuille du bas', false);
  }
  await tel.close();
}

/**
 * SUR TÉLÉPHONE, LE REPÈRE DES ÉTAPES COLLÉ AU CHAMP (demande du 25/10/2026,
 * captures #c92f et #5e66) : toutes les étapes annoncées visibles, le bouton
 * de réalisation sans libellé, et le repère replié sur sa ligne tant que le
 * champ a le focus — sans toucher au pli retenu.
 */
async function controlerLeRepereSurTelephone(p) {
  const champ = p.locator('[data-composer] textarea').first();
  if (!(await attendre(async () => (await champ.count()) === 1 && (await p.locator('[data-statut-du-temoin]').count()) === 1, 15000))) {
    noter('sur téléphone, le champ et la ligne des étapes sont là', false);
    return;
  }
  /* Le téléphone part replié : on déplie d'abord la liste au chevron, comme sur la capture #c92f. */
  if (!(await p.locator('[data-entete-du-repere]').count())) await p.locator('[data-chevron-du-temoin]').first().tap();
  await attendre(async () => (await p.locator('[data-entete-du-repere]').count()) === 1, 5000);

  const etapes = p.locator('[data-chemin-realisation] ol > li');
  const totalEtapes = await p.evaluate(() => {
    const ligne = document.querySelector('[data-statut-du-temoin]')?.textContent ?? '';
    return Number(/\/(\d+)/.exec(ligne)?.[1] ?? 0);
  });
  noter('sur téléphone, toutes les étapes annoncées sont visibles', totalEtapes > 1 && (await etapes.count()) === totalEtapes && (await p.locator('[data-chemin-realisation] [data-deplier-bloc]').count()) === 0, `${await etapes.count()}/${totalEtapes}`);
  await p.screenshot({ path: path.join(CAPTURES, 'telephone-etapes.png') });

  /* Le focus replie le repère sur sa ligne ; le blur le rouvre ; le pli retenu ne bouge pas. */
  const pli = () => p.evaluate(() => localStorage.getItem('beluga.volet-taches.deplie'));
  const avant = await pli();
  await champ.tap();
  noter(
    'sur téléphone, le focus du champ replie les étapes sur leur ligne',
    await attendre(async () => (await p.locator('[data-liste-repliee-par-le-champ]').count()) === 1 && (await p.locator('[data-entete-du-repere]').count()) === 0 && (await p.locator('[data-ligne-du-temoin]').count()) === 1, 5000),
  );
  await p.screenshot({ path: path.join(CAPTURES, 'telephone-champ-focalise.png') });
  await champ.evaluate((el) => el.blur());
  noter(
    'sur téléphone, le blur rouvre les étapes comme avant',
    await attendre(async () => (await p.locator('[data-liste-repliee-par-le-champ]').count()) === 0 && (await etapes.count()) === totalEtapes, 5000),
  );
  noter('le repli passager ne touche pas au pli retenu', (await pli()) === avant, `${avant} → ${await pli()}`);

  /* Replié par le champ, un appui sur le chevron rouvre — une seule bascule. */
  await champ.tap();
  await attendre(async () => (await p.locator('[data-liste-repliee-par-le-champ]').count()) === 1, 5000);
  await p.locator('[data-chevron-du-temoin]').first().tap();
  noter(
    'un appui sur le chevron pendant le repli rouvre les étapes, une seule fois',
    await attendre(async () => (await p.locator('[data-entete-du-repere]').count()) === 1, 5000) && (await pli()) === avant,
  );
  await champ.evaluate((el) => el.blur());
  await p.waitForTimeout(500);

}

/** Répond à la question d'accord en cours : clique le choix voulu, puis « Répondre ». */
async function accorder(page, choix, attendu) {
  const bulle = page.locator('[data-bulle-question]').filter({ has: page.locator(`[data-option-question]:has-text("${choix}")`) }).last();
  const vue = await attendre(async () => (await bulle.count()) >= 1, 30000);
  noter(`la question d’accord « ${attendu} » arrive`, vue);
  if (!vue) return [];
  const options = await bulle.locator('[data-option-question]').allTextContents();
  await bulle.locator('[data-option-question]').filter({ hasText: choix }).first().click();
  await bulle.locator('[data-repondre-question]').first().click();
  return options;
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  /* LA CARTE, caméra éteinte : le type se choisit au menu du bouton, dans le navigateur. */
  await commande({ type: 'card.create', projectId: PROJET_ID, title: 'Publicité vidéo', cadrage: true });
  {
    const db = base();
    CARTE_ID = db.prepare('SELECT id FROM cards ORDER BY created_at DESC LIMIT 1').get().id;
    db.close();
  }
  /* UNE PIÈCE FOURNIE (le logo) : déposée comme par l'utilisateur, notée au suivi par le faux moteur (« piece_recue »). */
  {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const r = await fetch(`${BASE}/api/upload?project=${encodeURIComponent(PROJET_ID)}`, {
      method: 'POST',
      headers: { cookie: `beluga_session=${jeton}`, 'content-type': 'image/png', 'x-file-name': 'logo-application.png' },
      body: png,
    });
    const rendu = await r.json().catch(() => ({}));
    PIECE_FOURNIE = rendu.attachment?.id ?? '';
    fs.writeFileSync(path.join(TMP, 'piece.txt'), PIECE_FOURNIE);
  }

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await ouvrirLaCarte(page);

  /* -------- 0. Le type se confirme dans la discussion (11/11/2026) : plus de bouton caméra, une étiquette -------- */
  await page.locator('[data-composer] textarea').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);
  noter('le champ n’a plus de bouton caméra', (await page.locator('[data-interrupteur-realisation], [data-menu-realisation]').count()) === 0);
  noter('rien ne s’ouvre à droite tant que le type n’est pas confirmé', (await page.locator('[data-volet-de-suivi]').count()) === 0);
  await commande({ type: 'card.realisation.souhaitee', cardId: CARTE_ID, media: 'video' });
  /* Plus d'étiquette de mode dans le champ (24/11/2026) : le mode se confirme dans la discussion, sans rien afficher. */
  await page.waitForTimeout(800);
  noter('confirmer le type n’ouvre encore rien à droite', (await page.locator('[data-volet-de-suivi]').count()) === 0);
  {
    const db = base(true);
    const carte = JSON.parse(db.prepare('SELECT data FROM cards WHERE id = ?').get(CARTE_ID).data);
    db.close();
    noter('le type est écrit sur la carte', carte.parcours?.realisationSouhaitee === true && JSON.stringify(carte.realisation?.medias) === '["video"]');
  }

  /* -------- 1. Une phrase suffit : le cadrage reçoit « production », jamais « realiser » -------- */
  const champ = page.locator('[data-composer] textarea:visible').first();
  await champ.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);
  await champ.click();
  await champ.fill('Une pub vidéo de 15 s pour faire installer notre application aux indépendants');
  await champ.pressSequentially('.');
  const envoi = page.locator('[data-composer-envoi]:not([disabled])').first();
  if (await envoi.waitFor({ timeout: 8000 }).then(() => true, () => false)) await envoi.click();
  else await champ.press('Enter');
  noter('le cadrage reçoit l’outil « production »', await attendre(() => fs.existsSync(path.join(TMP, 'outils.log')) && fs.readFileSync(path.join(TMP, 'outils.log'), 'utf8').includes('"production"'), 40000));
  /* LE DIRECTEUR GARDE LA CARTE DU BRIEF AU TÉLÉCHARGEMENT (26/10/2026) : « realiser » lui est servi dès la
     caméra allumée ; le serveur refuse toute fabrication tant que l'utilisateur n'a pas cliqué « Passer aux esquisses ». */
  noter('le cadrage reçoit aussi « realiser », caméra allumée', fs.readFileSync(path.join(TMP, 'outils.log'), 'utf8').includes('"realiser"'));

  /* -------- 2. Le formulaire groupé : une question à la fois, au dessin habituel -------- */
  const formulaire = page.locator('[data-bulle-formulaire]').first();
  noter('le formulaire arrive en une fois', await attendre(async () => (await formulaire.count()) === 1, 30000));
  noter('trois questions : celle dont la phrase donnait la réponse est écartée', (await page.locator('[data-formulaire-questions="3"]').count()) === 1 && (await page.locator('[data-champ-formulaire="public"]').count()) === 0);
  noter('l’agent n’a pas demandé le type de média dans la discussion', !pont().some((l) => l.name === 'ask_user' && /obtenir/i.test(JSON.stringify(l.args ?? {}))));
  noter('une seule question visible, choix en liste et champ libre habituels', (await page.locator('[data-question-formulaire]').count()) === 1 && (await page.locator('[data-champ-formulaire="ton"] [data-choix-question] [data-option-question]').count()) === 3 && (await page.locator('[data-champ-formulaire="ton"] [data-champ-reponse-question]').count()) === 1);
  noter('les flèches sont dans l’entête du panneau, pas dans son bouton', (await page.locator('[data-panneau-decision] [data-emplacement-pagination] [data-pagination-formulaire]').count()) === 1 && (await page.locator('[data-panneau-bascule] [data-pagination-formulaire]').count()) === 0 && (await page.locator('button button').count()) === 0);
  noter('sur ordinateur, la question porte un cadre jaune', estJaune(await bordureDe(page.locator('[data-bulle-question]').first())));
  await controlerLeTelephone(navigateur, erreurs);
  await page.screenshot({ path: path.join(CAPTURES, 'ordinateur-1-formulaire.png') });
  await page.locator('[data-champ-formulaire="ton"] [data-option-question="Complice (recommandé)"]').click();
  await page.locator('[data-champ-formulaire="ton"] [data-repondre-question]').click();
  noter('répondre passe seul à la question suivante, sans rien envoyer', await attendre(async () => (await page.locator('[data-champ-formulaire="format"]').count()) === 1, 10000) && !pont().some((l) => l.name === 'production' && l.args.action === 'formulaire' && l.rendu));
  await page.locator('[data-champ-formulaire="format"] [data-option-question="9:16 (recommandé)"]').click();
  await page.locator('[data-champ-formulaire="format"] [data-champ-reponse-question]').fill('surtout pour Instagram');
  await page.locator('[data-champ-formulaire="format"] [data-repondre-question]').click();
  await page.locator('[data-pagination-formulaire] [aria-label="question-precedente"], [data-pagination-formulaire] button').first().click();
  noter('la flèche ramène à la question précédente, sa réponse gardée', await attendre(async () => (await page.locator('[data-champ-formulaire="format"] [data-option-question="9:16 (recommandé)"][data-option-retenue]').count()) === 1, 10000));
  await page.locator('[data-pagination-formulaire] button').last().click();
  const dernier = page.locator('[data-champ-formulaire="appel"]');
  noter('la dernière question propose « Envoyer les réponses »', await attendre(async () => (await dernier.locator('[data-repondre-question]:has-text("Envoyer les réponses")').count()) === 1, 10000));
  await dernier.locator('[data-passer-question-formulaire]').click();
  noter(
    'l’agent reçoit les trois réponses ensemble, la question laissée vide comprise',
    await attendre(() => {
      const f = pont().find((l) => l.name === 'production' && l.args.action === 'formulaire');
      const t = f?.rendu?.text ?? '';
      return /Complice \(recommandé\)/.test(t) && /9:16 \(recommandé\) — surtout pour Instagram/.test(t) && /\(sans réponse\)/.test(t);
    }, 20000),
  );

  /* -------- 3. Le choix de la direction, puis la suite sans arrêt -------- */
  /* Le brief et ses directions : la direction se choisit d'un clic ; scénario, storyboard et plans s'écrivent ensuite sans arrêt. */
  const pistes = await accorder(page, 'Plein soleil', 'idée');
  noter(
    'la direction se choisit parmi trois pistes, plus « en proposer d’autres »',
    pistes.length === 4 && ['Néon nocturne', 'Plein soleil', 'Papier découpé'].every((p) => pistes.some((o) => o.includes(p))),
    pistes.join(' | '),
  );
  noter('le faux cadrage a fini sa chaîne (retouche comprise)', await attendre(() => pont().some((l) => l.name === 'production' && l.args.action === 'modifier' && l.rendu?.ok), 30000));
  const refus = pont().filter((l) => l.name === 'production' && l.rendu && l.rendu.ok === false);
  noter('aucune étape refusée : le brief s’écrit sans accord de l’idée', refus.length === 0, refus.map((l) => l.rendu.text).join(' | '));

  const volet = page.locator(`[data-volet-de-suivi="${CARTE_ID}"]`);
  if ((await volet.count()) === 0) await page.locator('[data-ouvrir-le-suivi]').first().click({ timeout: 10000 }).catch(() => {});
  noter('le volet de suivi est ouvert', await attendre(async () => (await volet.count()) === 1, 20000));
  /* LE SUIVI SUIT LES QUATRE ÉTAPES DU MÉDIA (26/10/2026) : tout l'écrit — brief, direction, scénario,
     storyboard et plans — se range sous « Brief » ; « Esquisses » attend le clic du bouton du bas. */
  noter('« Brief » est en cours dans le suivi', await attendre(async () => (await page.locator('[data-etape-suivi="brief"][data-etat-etape="en-cours"]').count()) === 1, 15000));
  noter('« Esquisses » est à venir : rien ne se fabrique encore', (await page.locator('[data-etape-suivi="esquisses"][data-etat-etape="a-definir"]').count()) === 1);
  noter(
    'la barre et le volet montrent les mêmes quatre étapes, la même allumée',
    (await page.locator('[data-barre-etapes] [data-segment]').evaluateAll((els) => els.map((e) => e.getAttribute('data-segment')).join(','))) === 'brief,esquisses,montage,telechargement' &&
      (await page.locator('[data-barre-etapes="brief"]').count()) === 1 &&
      (await volet.locator('li[data-etape-courante]').getAttribute('data-etape-suivi')) === 'brief',
  );
  {
    /* LE BOUTON QUI SUIT L'ÉTAPE, SES RÉGLAGES À LA TAILLE DES AUTRES ICÔNES, LE CAHIER SUR TOUTE LA LARGEUR (#a9f8, #5f84). */
    const mesures = await page.evaluate(() => {
      const icone = document.querySelector('[data-barre-realisation] [data-reglages-du-lancement] svg')?.getBoundingClientRect();
      const bouton = document.querySelector('[data-barre-realisation] [data-geste-du-media]');
      const rangee = document.querySelector('[data-barre-realisation]')?.getBoundingClientRect();
      const volet = document.querySelector('[data-volet-de-suivi]')?.getBoundingClientRect();
      const cahier = document.querySelector('[data-volet-de-suivi] [data-realisation-lire]')?.getBoundingClientRect();
      return {
        icone: icone ? Math.round(icone.width) : 0,
        geste: bouton?.getAttribute('data-geste-du-media') ?? null,
        possible: document.querySelector('[data-barre-realisation]')?.getAttribute('data-geste-possible') ?? null,
        rangee: rangee ? Math.round(rangee.width) : 0,
        volet: volet ? Math.round(volet.width) : 0,
        cahier: cahier ? Math.round(cahier.width) : 0,
      };
    });
    noter('la rangée porte le passage suivant (« Passer aux esquisses », allumé : brief et plans écrits), sur toute sa largeur', mesures.geste === 'passer-esquisses' && mesures.possible === 'oui' && mesures.rangee >= 300, JSON.stringify(mesures));
    noter('l’icône des réglages, collée au bouton, fait 16 px', mesures.icone >= 15, JSON.stringify(mesures));
    noter('« Lire le cahier de réalisation » prend toute la largeur du volet', mesures.cahier > 0 && mesures.cahier >= mesures.volet - 40, JSON.stringify(mesures));
  }
  noter('aucun « Déployer » sur la page d’une création de média', (await page.locator('[data-entete-de-zone]:has([data-titre-carte])').count()) >= 1 &&
      (await page.locator('[data-entete-de-zone]:has([data-titre-carte]) button:visible', { hasText: /Déployer|Mise en production/ }).count()) === 0 &&
      (await page.locator('[data-barre-realisation] button', { hasText: /Déployer/ }).count()) === 0);

  /* -------- 3 bis. Le suivi en accordéon vertical (24/10/2026) -------- */
  {
    const accordeon = volet.locator('[data-accordeon-du-suivi]');
    const nombre = Number(await accordeon.getAttribute('data-etapes-du-suivi'));
    const tetes = volet.locator('[data-entete-etape]');
    noter('le suivi est un accordéon : un bloc par étape, chacun avec sa tête (case puis nom)', nombre === 4 && (await tetes.count()) === nombre && (await volet.locator('[data-entete-etape] [data-case-de-tache]').count()) === nombre, String(nombre));
    const boites = await volet.locator('li[data-etape-suivi]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height) })));
    noter(
      'les étapes s’empilent à la verticale, alignées à gauche',
      boites.length === nombre && boites.every((b, i) => i === 0 || (b.y >= boites[i - 1].y + boites[i - 1].h - 1 && Math.abs(b.x - boites[0].x) <= 1)),
      JSON.stringify(boites.slice(0, 3)),
    );
    noter('seule l’étape en cours est ouverte d’office', (await volet.locator('li[data-etape-ouverte]').count()) === 1 && (await volet.locator('li[data-etape-courante][data-etape-ouverte]').getAttribute('data-etape-suivi')) === 'brief');
    /* PLUS D'ONGLETS (26/10/2026) : une seule liste d'étapes ; le « Brief » montre ce qu'on crée,
       puis TOUT l'écrit (brief, direction, scénario, storyboard, plans), puis l'ambiance. */
    {
      const brief = volet.locator('[data-contenu-etape="brief"]');
      noter('le volet n’a plus de barre d’onglets', (await volet.locator('[data-onglets-du-suivi], [data-onglet-suivi]').count()) === 0);
      noter(
        'le type est entre parenthèses dans le titre « Brief (Vidéo) », plus jamais posé seul, et le Brief n’a plus de compteur',
        /^Brief \(Vidéo\)$/.test((await volet.locator('[data-entete-etape="brief"] [data-types-du-media]').innerText()).trim())
          && (await brief.locator('[data-types-du-media], [data-invite-du-type]').count()) === 0
          && (await volet.locator('[data-entete-etape="brief"] [data-nombre-etape]').count()) === 0
          && (await attendre(async () => (await brief.locator('[data-ecrit-de-l-etape="brief"] [data-element-suivi]').count()) > 0, 8000)),
      );
      /* LE BRIEF EST UN SEUL DOCUMENT (26/10/2026) : sommaire, parties, sections sans cadre, images à leur place. */
      const documentDuBrief = brief.locator('[data-document-du-brief]');
      noter(
        'le Brief s’ouvre sur un sommaire, une ligne par partie (brief, direction, scénario, storyboard, plans)',
        (await documentDuBrief.count()) === 1
          && (await documentDuBrief.locator('[data-sommaire-du-brief] [data-aller-a-la-partie]').evaluateAll((els) => els.map((e) => e.getAttribute('data-aller-a-la-partie')).join(','))) === 'brief,direction,scenario,storyboard,plans',
      );
      noter(
        'plus aucun cadre empilé : ni bande de titre, ni bloc encadré au Brief',
        (await brief.locator('[data-titre-piece], .bande-de-titre-de-piece').count()) === 0
          && (await brief.locator('[data-element-suivi]').evaluateAll((els) => els.every((e) => getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)'))),
      );
      /* LES ÉTAGES SE DÉTACHENT, AUTANT EN SOMBRE QU'EN CLAIR, ET LES BORDS S'ALIGNENT (26/10/2026). */
      await attendre(async () => (await brief.locator('[data-image-du-brief] [data-capture-du-flux]').count()) > 0, 10000);
      for (const clarte of ['clair', 'sombre']) {
        await page.evaluate((c) => {
          const racine = document.documentElement;
          racine.dataset.theme = c;
          racine.classList.toggle('dark', c === 'sombre');
          racine.style.colorScheme = c === 'sombre' ? 'dark' : 'light';
        }, clarte);
        /* Les fonds ont un fondu : on mesure une fois le thème posé. */
        await page.waitForTimeout(600);
        const m = await page.evaluate(() => {
          const lire = (v) => {
            const x = /color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)/.exec(v || '');
            if (x) return { r: +x[1] * 255, g: +x[2] * 255, b: +x[3] * 255, a: x[4] === undefined ? 1 : +x[4] };
            const y = /rgba?\(([^)]+)\)/.exec(v || '');
            if (!y) return null;
            const n = y[1].split(',').map(parseFloat);
            return { r: n[0], g: n[1], b: n[2], a: n[3] ?? 1 };
          };
          /* Le fond RÉELLEMENT vu : les voiles empilés jusqu'au premier fond plein. */
          const fond = (el) => {
            const pile = [];
            for (let e = el; e; e = e.parentElement) {
              const v = lire(getComputedStyle(e).backgroundColor);
              if (v && v.a > 0) pile.push(v);
              if (v && v.a >= 1) break;
            }
            let [r, g, b] = [255, 255, 255];
            for (const v of pile.reverse()) [r, g, b] = [v.r * v.a + r * (1 - v.a), v.g * v.a + g * (1 - v.a), v.b * v.a + b * (1 - v.a)];
            return [r, g, b];
          };
          const lum = (rgb) => {
            const [r, g, b] = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const ecart = (a, b) => {
            const [x, y] = [lum(fond(a)), lum(fond(b))];
            return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100;
          };
          const q = (s) => document.querySelector(s);
          const volet = q('[data-volet-de-suivi]');
          const etape = q('li[data-etape-suivi="brief"]');
          const contenu = q('[data-contenu-etape="brief"]');
          const gauche = (s) => Math.round(q(s)?.getBoundingClientRect().left ?? -1);
          return {
            etape: ecart(etape, volet),
            tete: ecart(q('[data-entete-etape="brief"]'), etape),
            fermee: ecart(q('li[data-etape-suivi="montage"]'), volet),
            sommaire: ecart(q('[data-tete-du-brief]'), contenu),
            image: ecart(q('[data-image-du-brief] [data-capture-du-flux]'), contenu),
            /* L'ARBRE (26/10/2026) : le bord gauche est celui des flèches de premier niveau ; le texte et les images sont en retrait. */
            bords: [gauche('[data-tete-du-brief]'), gauche('[data-partie-du-brief] [data-basculer-noeud] svg'), gauche('[data-partie-du-brief]:not([data-bloc-etape="brief"]) [data-titre-partie] [data-basculer-noeud] svg'), gauche('[data-entete-etape="brief"] [data-case-de-tache]')],
            dansLEncart: [gauche('[data-tete-du-brief] p'), gauche('[data-aller-a-la-partie] span')],
          };
        });
        noter(
          `en ${clarte}, chaque étage se détache de celui qui le porte, légèrement mais perceptiblement (étape, tête, sommaire, cadre d’une image : rapport entre 1,06 et 1,18)`,
          ['etape', 'tete', 'fermee', 'sommaire', 'image'].every((k) => m[k] >= 1.06 && m[k] <= 1.18),
          JSON.stringify(m),
        );
        if (clarte === 'clair') contrastesEnClair = m;
        else noter('le sombre est au moins aussi contrasté que le clair, étage par étage', ['etape', 'tete', 'fermee', 'sommaire', 'image'].every((k) => m[k] >= contrastesEnClair[k] - 0.02), JSON.stringify({ clair: contrastesEnClair, sombre: m }));
        noter(
          `en ${clarte}, le sommaire, les flèches des parties et la case de l’étape partagent le même bord gauche ; dans l’encart, l’intitulé et les numéros aussi`,
          new Set(m.bords).size === 1 && m.bords[0] > 0 && Math.abs(m.dansLEncart[0] - m.dansLEncart[1]) <= 1,
          JSON.stringify({ bords: m.bords, encart: m.dansLEncart }),
        );
      }
      await page.evaluate(() => {
        const racine = document.documentElement;
        racine.dataset.theme = 'clair';
        racine.classList.remove('dark');
        racine.style.colorScheme = 'light';
      });
      noter(
        'la photo fournie s’affiche avec la vignette commune (« Ce que l’agent a vu ») là où le scénario la cite : repère codé « #… » et heure dessus, légende dessous — jamais son identifiant',
        await attendre(async () => (await brief.locator(`[data-section-du-brief="scenario"] [data-image-du-brief="${PIECE_FOURNIE}"] img`).count()) === 1, 10000)
          && /Logo de l’application/.test(await brief.locator(`[data-image-du-brief="${PIECE_FOURNIE}"] [data-legende-image]`).innerText())
          && (await brief.locator(`[data-image-du-brief="${PIECE_FOURNIE}"] [data-capture-du-flux][data-capture-media="image"] [data-capture-heure]`).count()) === 1
          && /^#[0-9a-z]+$/i.test((await brief.locator(`[data-image-du-brief="${PIECE_FOURNIE}"] [data-etiquette-de-vignette]`).getAttribute('data-etiquette-de-vignette').catch(() => '')) ?? '')
          && !/Pièce jointe :/.test(await documentDuBrief.innerText())
          && (await brief.locator('[data-element-suivi^="piece-"]').count()) === 0,
        PIECE_FOURNIE,
      );
      {
        await brief.locator(`[data-image-du-brief="${PIECE_FOURNIE}"] [data-capture-du-flux]`).click();
        noter('un clic sur l’aperçu l’ouvre en grand', await attendre(async () => (await page.locator('[data-visionneuse], [role="dialog"] img').count()) > 0, 8000));
        await page.locator('[data-fermer-visionneuse]').first().click().catch(() => page.keyboard.press('Escape'));
        await attendre(async () => (await page.locator('[data-visionneuse]').count()) === 0, 8000);
        await page.waitForTimeout(300);
      }
      /* LE SOMMAIRE FAIT DÉFILER LA ZONE DU VOLET, PAS LA PAGE. */
      {
        await documentDuBrief.locator('[data-aller-a-la-partie="scenario"]').click();
        await page.waitForTimeout(900);
        const place = await page.evaluate(() => {
          let zone = document.querySelector('[data-accordeon-du-suivi]').parentElement;
          while (zone && !/(auto|scroll)/.test(getComputedStyle(zone).overflowY)) zone = zone.parentElement;
          const cible = document.querySelector('[data-partie-du-brief="scenario"]').getBoundingClientRect();
          const cadre = (zone ?? document.documentElement).getBoundingClientRect();
          return { ecart: Math.round(cible.top - cadre.top), defile: Math.round(zone?.scrollTop ?? 0), page: Math.round(window.scrollY) };
        });
        noter('le sommaire descend à la partie choisie, dans la zone du volet', place.defile > 0 && place.ecart >= -2 && place.ecart < 60 && place.page === 0, JSON.stringify(place));
        await page.evaluate(() => document.querySelector('[data-document-du-brief]')?.scrollIntoView({ block: 'start' }));
      }
      /* LE MENU À TROIS POINTS, EN HAUT À DROITE DU TEXTE (26/10/2026) : Copier, Télécharger, Archives. */
      {
        const tete = await page.evaluate(() => {
          const doc = document.querySelector('[data-document-du-brief]').getBoundingClientRect();
          const menu = document.querySelector('[data-menu-de-l-etape="brief"]');
          const r = menu?.getBoundingClientRect();
          return {
            menu: !!menu,
            horsAccordeon: !!menu && !menu.closest('button[data-ouvrir-etape]'),
            aDroite: !!r && doc.right - r.right < 8,
            enHaut: !!r && r.top - doc.top < 30,
            boutonsSeuls: document.querySelectorAll('[data-document-du-brief] [data-copier-le-brief], [data-document-du-brief] [data-telecharger-le-brief]').length,
          };
        });
        noter('le menu à trois points est en haut à droite du texte, hors de la tête d’étape, sans Copier ni Télécharger posés à côté', tete.menu && tete.horsAccordeon && tete.aDroite && tete.enHaut && tete.boutonsSeuls === 0, JSON.stringify(tete));
        noter(
          'plus aucun « Modifier », « Corriger avec l’agent » ni « Versions » sous les éléments',
          (await volet.locator('[data-actions-piece], [data-ouvrir-versions], [data-modifier-piece], [data-corriger-avec-agent]').count()) === 0,
        );
        await brief.locator('[data-menu-de-l-etape="brief"]').click();
        noter(
          'le menu propose Copier, Télécharger et Archives',
          await attendre(async () => (await page.locator('[data-entrees-du-menu-de-l-etape="brief"] [data-copier-le-brief], [data-entrees-du-menu-de-l-etape="brief"] [data-telecharger-le-brief], [data-entrees-du-menu-de-l-etape="brief"] [data-ouvrir-les-archives]').count()) === 3, 8000),
        );
        await contexte.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
        await page.locator('[data-copier-le-brief]').click();
        const copie = await page.evaluate(() => navigator.clipboard.readText().catch(() => '')).catch(() => '');
        noter('« Copier » met le brief en texte propre : titres, intitulés en gras, images dites par leur légende', /^# Brief \(Vidéo\)/.test(copie) && /## Scénario/.test(copie) && /\*Image : Logo de l’application\*/.test(copie) && !/Pièce jointe/.test(copie), copie.slice(0, 160));
        noter('« Copier » rend le Brief ENTIER, même avec les Plans et les Scènes repliés', /Gros plan sur l’écran/.test(copie) && /Plan large, soleil/.test(copie) && (await brief.locator('[data-bloc-etape="plans"] [data-texte-entier]').count()) === 0);
        await attendre(async () => (await page.locator('[data-entrees-du-menu-de-l-etape="brief"]').count()) === 0, 5000);
        await brief.locator('[data-menu-de-l-etape="brief"]').click();
        await page.locator('[data-telecharger-le-brief]').waitFor({ timeout: 8000 }).catch(() => {});
        const [telechargement] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.locator('[data-telecharger-le-brief]').click()]);
        let contenu = null;
        if (telechargement) {
          const cible = path.join(TMP, 'brief.zip');
          await telechargement.saveAs(cible);
          contenu = lireZip(fs.readFileSync(cible));
        }
        const md = contenu?.get('brief.md')?.toString('utf8') ?? '';
        const images = [...(contenu?.keys() ?? [])].filter((n) => n.startsWith('images/'));
        noter(
          '« Télécharger » donne une archive : brief.md et ses images, que le texte cite exactement',
          !!telechargement && /^brief-/.test(telechargement.suggestedFilename()) && md.startsWith('# Brief (Vidéo)') && images.length === 1 && md.includes(`](${images[0]})`),
          JSON.stringify({ nom: telechargement?.suggestedFilename(), images, debut: md.slice(0, 80) }),
        );
      }
      await page.screenshot({ path: path.join(CAPTURES, 'ordinateur-suivi-brief.png') });
      /* Une étape encore vide s'ouvre et le dit ; l'étape en cours reste ouverte ; un second clic la referme. */
      await volet.locator('[data-ouvrir-etape="montage"]').click();
      noter('une étape encore vide s’ouvre et le dit', await attendre(async () => (await volet.locator('[data-contenu-etape="montage"] [data-etape-vide]').count()) === 1, 10000));
      noter('l’utilisateur ouvre une autre étape, l’étape en cours reste ouverte', (await volet.locator('li[data-etape-suivi="brief"][data-etape-ouverte]').count()) === 1);
      await volet.locator('[data-ouvrir-etape="montage"]').click();
      noter('un second clic la referme', await attendre(async () => (await volet.locator('li[data-etape-suivi="montage"][data-etape-ouverte]').count()) === 0, 10000));
      noter('les quatre étapes restent dans la même liste', Number(await volet.locator('[data-accordeon-du-suivi]').getAttribute('data-etapes-du-suivi')) === 4);
    }
    noter('ses données sont rangées par partie', (await volet.locator('[data-contenu-etape="brief"] [data-bloc-etape="scenario"] [data-element-suivi]').count()) === 1);
    /* PLUS D'INTITULÉ « ÉCRIT · N » (#cd6e). */
    noter('aucun intitulé « Écrit » au-dessus des pièces', (await volet.locator('h4', { hasText: /^Écrit/ }).count()) === 0);
    /* LES TÊTES D'ÉTAPE ONT UN FOND CONTRASTÉ SANS SURVOL (26/10/2026). */
    {
      await page.mouse.move(5, 5);
      const tetes = await volet.locator('[data-entete-etape]').evaluateAll((els) =>
        els.map((el) => {
          const rgb = (c) => {
            const n = (c.match(/[\d.]+/g) ?? []).map(Number);
            return c.startsWith('color(') ? n.slice(0, 4).map((v, i) => (i < 3 ? v * 255 : v)) : n.slice(0, 4);
          };
          const [, , , alpha = 1] = rgb(getComputedStyle(el).backgroundColor);
          return { etape: el.getAttribute('data-entete-etape'), fond: getComputedStyle(el).backgroundColor, alpha };
        }),
      );
      noter('chaque tête d’étape porte son fond, sans qu’on la survole', tetes.length === 4 && tetes.every((x) => x.alpha > 0.03 && x.fond !== 'rgba(0, 0, 0, 0)'), JSON.stringify(tetes));
    }
    /* LA MISE EN PAGE DES PIÈCES (25/10/2026) : titre en gras, écart avant le texte, chaque intitulé en titre
       au-dessus de son contenu, aucun tiret (#2243), tableau. */
    {
      const piece = volet.locator('[data-contenu-etape="brief"] [data-bloc-etape="scenario"] [data-element-suivi]').first();
      const mesure = await piece.evaluate((el) => {
        const titre = el.querySelector('[data-titre-section] h3, [data-titre-section] h4');
        const texte = el.querySelector('[data-texte-entier]');
        const table = texte?.querySelector('table');
        return {
          poids: titre ? Number(getComputedStyle(titre).fontWeight) : 0,
          ecart: titre && texte ? Math.round(texte.getBoundingClientRect().top - titre.getBoundingClientRect().bottom) : -1,
          intitule: texte?.querySelector('[data-titre-intitule]')?.textContent ?? '',
          dessous: (() => {
            const bloc = texte?.querySelector('[data-intitule-piece]');
            const t = bloc?.querySelector('[data-titre-intitule]');
            const c = bloc?.querySelector('.prose-hd');
            return !!t && !!c && c.getBoundingClientRect().top >= t.getBoundingClientRect().bottom - 1;
          })(),
          /* Les nœuds de l'arbre sont des `li` : ce ne sont pas des puces. */
          tirets: texte ? texte.querySelectorAll('li:not([data-image-du-brief]):not([data-noeud-du-brief])').length : -1,
          cellules: table ? table.querySelectorAll('td').length : 0,
          dansLaCarte: table ? table.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1 : false,
        };
      });
      noter('le titre d’une pièce est en gras, avec un écart avant le texte', mesure.poids >= 600 && mesure.ecart >= 6, JSON.stringify(mesure));
      noter('l’intitulé « RÈGLE » est un titre écrit comme les autres (« Règle »), son contenu dessous, sans tiret', mesure.intitule === 'Règle' && mesure.dessous && mesure.tirets === 0, JSON.stringify(mesure));
      noter('le tableau du scénario est rendu en vrai tableau, dans la largeur de la pièce', mesure.cellules === 9 && mesure.dansLaCarte, JSON.stringify(mesure));
    }
    /* LES PISTES ÉCARTÉES QUITTENT LA LISTE : la direction retenue seule, les autres dans son menu. */
    noter(
      'seule la direction retenue s’affiche, les pistes écartées sont dans son menu',
      await attendre(async () => (await volet.locator('[data-contenu-etape="brief"] [data-bloc-etape="direction"] [data-element-suivi]').count()) === 1, 10000) &&
        (await volet.locator('[data-contenu-etape="brief"] [data-bloc-etape="direction"] [data-etat-element="refuse"]').count()) === 0,
    );
    noter('le brief écrit se lit au même endroit', (await volet.locator('[data-contenu-etape="brief"] [data-bloc-etape="brief"] [data-element-suivi]').count()) >= 1);
    noter('les deux plans écrits paraissent sous « Brief »', await attendre(async () => (await page.locator('[data-contenu-etape="brief"] [data-bloc-etape="plans"] [data-element-suivi]').count()) === 2, 10000));
    /* DE L'AIR SOUS LA TÊTE, ET LE BRIEF EN ARBRE (26/10/2026, captures #68ca8, #7671, #9a50). */
    {
      const brief = volet.locator('[data-contenu-etape="brief"]');
      const air = await page.evaluate(() => {
        const tete = document.querySelector('[data-entete-etape="brief"]').getBoundingClientRect();
        const premier = document.querySelector('[data-contenu-etape="brief"]').firstElementChild.getBoundingClientRect();
        return Math.round(premier.top - tete.bottom);
      });
      noter('le contenu d’une étape ouverte ne colle plus à sa tête (plus de 8 px d’air)', air > 8, String(air));
      const plans = brief.locator('[data-partie-du-brief="plans"]');
      noter(
        'à l’ouverture, les parties sont dépliées, les Plans et les Scènes repliés sur leur titre',
        (await brief.locator('[data-partie-du-brief]:not([data-partie-ouverte])').count()) === 0
          && (await plans.locator('[data-element-suivi]').count()) === 2
          && (await plans.locator('[data-texte-entier]').count()) === 0
          && (await brief.locator('[data-partie-du-brief="storyboard"] [data-texte-entier]').count()) === 0
          && (await brief.locator('[data-partie-du-brief="scenario"] [data-texte-entier]').count()) === 1,
      );
      noter(
        'chaque élément pend à sa partie par le fil pointillé de la colonne de gauche, coude arrondi au dernier',
        (await plans.locator('[data-noeud-du-brief="element"] > [data-branche-du-brief]').evaluateAll((els) => els.map((e) => e.getAttribute('data-branche-du-brief')).join(','))) === 'milieu,dernier'
          && (await plans.locator('[data-branche-du-brief] span').first().evaluate((el) => getComputedStyle(el).borderLeftStyle)) === 'dotted',
      );
      await brief.locator('[data-basculer-noeud="brief-plans-plan-2"]').click();
      noter(
        'la flèche d’un Plan le déplie : ses rubriques pendent à leur tour, sur leur propre fil',
        await attendre(async () => (await brief.locator('[data-element-suivi="plan-2"] [data-texte-entier] [data-noeud-du-brief="rubrique"] > [data-branche-du-brief]').count()) >= 2, 8000)
          && (await brief.locator('[data-basculer-noeud="brief-plans-plan-2"]').getAttribute('aria-expanded')) === 'true',
      );
      {
        const retraits = await page.evaluate(() => {
          const g = (s) => Math.round(document.querySelector(s)?.getBoundingClientRect().left ?? -1);
          return [g('[data-titre-partie="plans"] h3'), g('[data-element-suivi="plan-2"] h4'), g('[data-element-suivi="plan-2"] [data-rubrique-du-brief]')];
        });
        /* Comme dans la colonne de gauche : un enfant s'aligne sur le TITRE de son parent, sa branche part de la flèche du parent. */
        noter(
          'trois niveaux en retrait : l’élément sous le titre de sa partie, la rubrique sous le titre de son élément',
          retraits.every((x) => x > 0) && retraits[1] > retraits[0] + 10 && Math.abs(retraits[2] - retraits[1]) <= 4,
          JSON.stringify(retraits),
        );
      }
      noter(
        'l’ouverture est retenue pour la carte, dans les préférences partagées entre appareils',
        await attendre(() => {
          const lecture = base(true);
          const v = lecture.prepare("SELECT value FROM preferences WHERE key = 'suivi.brief.bascules'").get()?.value;
          lecture.close();
          return !!v && JSON.parse(v)[CARTE_ID]?.includes('brief-plans-plan-2');
        }, 8000),
      );
      await brief.locator('[data-basculer-noeud="brief-plans"]').click();
      noter('la flèche d’une partie la replie, et elle dit combien elle cache', await attendre(async () => (await plans.locator('[data-element-suivi]').count()) === 0 && /2/.test(await plans.locator('[data-titre-partie]').innerText()), 8000));
      await brief.locator('[data-aller-a-la-partie="plans"]').click();
      noter('le sommaire déplie la partie repliée qu’il vise', await attendre(async () => (await plans.locator('[data-element-suivi]').count()) === 2 && (await plans.getAttribute('data-partie-ouverte')) === '', 8000));
      await page.reload();
      await attendre(async () => (await volet.count()) === 1, 20000);
      if (!(await volet.locator('li[data-etape-suivi="brief"][data-etape-ouverte]').count())) await volet.locator('[data-ouvrir-etape="brief"]').click();
      noter('après rechargement, le Plan ouvert l’est toujours', await attendre(async () => (await volet.locator('[data-element-suivi="plan-2"] [data-texte-entier]').count()) === 1 && (await volet.locator('[data-element-suivi="plan-1"] [data-texte-entier]').count()) === 0, 15000));
      await page.screenshot({ path: path.join(CAPTURES, 'ordinateur-brief-en-arbre.png') });
    }
  }

  /* -------- 4. Les versions du plan retouché : la feuille « Archives » du menu à trois points, un tiroir de lecture (26/10/2026) -------- */
  const feuille = page.locator('[data-feuille-des-archives="brief"]');
  const ouvrirLesArchives = async () => {
    await volet.locator('[data-menu-de-l-etape="brief"]').click();
    await page.locator('[data-ouvrir-les-archives]').click();
    return attendre(async () => (await feuille.count()) === 1, 10000);
  };
  const fermerLesArchives = async () => {
    await page.keyboard.press('Escape');
    await attendre(async () => (await feuille.count()) === 0, 5000);
  };
  noter('« Archives » ouvre une feuille', await ouvrirLesArchives());
  const archivePlan = page.locator('[data-archive-element="plan-1"]');
  noter('le plan retouché y figure avec ses deux versions', await attendre(async () => (await archivePlan.count()) === 1 && (await archivePlan.getAttribute('data-nombre-versions')) === '2', 10000));
  noter(
    'la version en cours est marquée, l’ancienne se propose',
    (await archivePlan.locator('[data-version-courante][data-version-element="2"]').count()) === 1 && (await archivePlan.locator('[data-version-element="1"]').count()) === 1,
  );
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(CAPTURES, 'ordinateur-2-archives.png') });
  await archivePlan.locator('[data-version-element="1"]').click();
  const tiroirDeVersion = page.locator('[data-tiroir-version="plan-1"]');
  noter(
    'la v1 s’ouvre dans un tiroir, son texte entier et « Utiliser cette version »',
    await attendre(async () => (await tiroirDeVersion.count()) === 1 && (await page.locator('[data-utiliser-version="1"]').count()) === 1, 10000) &&
      /Plan large de la terrasse/.test(await page.locator('[data-texte-de-version]').innerText()),
  );
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(CAPTURES, 'ordinateur-2b-tiroir-version.png') });
  await page.locator('[data-utiliser-version="1"]').click();
  noter('« Utiliser cette version » écrit une v3', await attendre(() => versionsDuPlan() === 3, 15000), String(versionsDuPlan()));
  noter('le tiroir et la feuille se referment', await attendre(async () => (await tiroirDeVersion.count()) === 0 && (await feuille.count()) === 0, 10000));
  await ouvrirLesArchives();
  noter('les archives montrent trois versions, sans recharger', await attendre(async () => (await archivePlan.getAttribute('data-nombre-versions').catch(() => null)) === '3', 15000));
  {
    const db = base(true);
    const v3 = db.prepare("SELECT contenu FROM production_elements WHERE card_id = ? AND cle = 'plan-1' AND version = 3").get(CARTE_ID);
    db.close();
    noter('la v3 reprend le contenu de la v1', v3?.contenu === 'Plan large de la terrasse, 3 s.\nCapacité : montage', v3?.contenu);
  }
  /* La version en cours n'a pas de bouton : « Version en cours ». */
  await archivePlan.locator('[data-version-courante]').click();
  noter(
    'la version en cours se lit sans bouton pour la reprendre',
    await attendre(async () => (await page.locator('[data-version-en-cours]').count()) === 1, 10000) && (await page.locator('[data-utiliser-version]').count()) === 0,
  );
  await page.keyboard.press('Escape');
  await attendre(async () => (await tiroirDeVersion.count()) === 0, 5000);
  await fermerLesArchives();
  await commande({ type: 'production.revenir', cardId: CARTE_ID, cle: 'plan-1', version: 1 });
  await page.waitForTimeout(800);
  noter('un second retour à la v1 n’écrit rien de plus', versionsDuPlan() === 3, String(versionsDuPlan()));

  /* -------- 4 ter. Reprendre une piste écartée depuis les archives (26/10/2026) -------- */
  {
    const retenue = volet.locator('[data-contenu-etape="brief"] [data-bloc-etape="direction"] [data-element-suivi]').first();
    const cleRetenue = await retenue.getAttribute('data-element-suivi');
    await ouvrirLesArchives();
    const pistes = page.locator('[data-archives-pistes] [data-piste-ecartee]');
    noter('les deux pistes écartées sont dans « Autres pistes »', await attendre(async () => (await pistes.count()) === 2, 10000), String(await pistes.count()));
    const piste = pistes.filter({ hasText: 'Néon nocturne' }).first();
    const clePiste = await piste.getAttribute('data-piste-ecartee');
    await piste.click();
    const bouton = page.locator(`[data-utiliser-version="${clePiste}"]`);
    noter('la piste s’ouvre dans le tiroir avec « Utiliser cette direction »', await attendre(async () => (await bouton.count()) === 1, 10000) && /Utiliser cette direction/.test(await bouton.innerText()));
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(CAPTURES, 'ordinateur-4-autre-direction.png') });
    await bouton.click();
    noter(
      'la piste reprise devient la direction affichée, l’ancienne passe aux archives',
      await attendre(async () => (await volet.locator(`[data-contenu-etape="brief"] [data-element-suivi="${clePiste}"][data-etat-element="valide"]`).count()) === 1 && (await volet.locator(`[data-element-suivi="${cleRetenue}"]`).count()) === 0, 15000),
    );
    {
      const db = base(true);
      const ev = db.prepare("SELECT details FROM production_evenements WHERE card_id = ? AND genre = 'direction.changee'").all(CARTE_ID);
      db.close();
      noter('le changement de direction est noté en base', ev.length === 1 && ev[0].details.includes(`"vers":"${clePiste}"`), ev[0]?.details);
    }
  }

  /* -------- 4 bis. Une correction du brief (par l'agent ou la route du démon) : les archives la montrent (26/10/2026) -------- */
  {
    const brief = volet.locator('[data-element-suivi="brief"]');
    const versionsAvant = () => {
      const db = base(true);
      const n = db.prepare("SELECT COUNT(*) AS n FROM production_elements WHERE card_id = ? AND cle = 'brief'").get(CARTE_ID).n;
      db.close();
      return n;
    };
    const avant = versionsAvant();
    const db = base(true);
    const texte = db.prepare("SELECT contenu FROM production_elements WHERE card_id = ? AND cle = 'brief' ORDER BY version DESC LIMIT 1").get(CARTE_ID).contenu;
    db.close();
    await commande({ type: 'production.modifier', cardId: CARTE_ID, cle: 'brief', contenu: `${texte}\nCorrection : le public, ce sont les artisans.` });
    noter('la correction écrit une nouvelle version', await attendre(() => versionsAvant() === avant + 1, 15000), String(versionsAvant()));
    noter('le texte corrigé s’affiche', await attendre(async () => /artisans/.test(await brief.locator('[data-texte-entier]').innerText()), 15000));
    await ouvrirLesArchives();
    const archiveBrief = page.locator('[data-archive-element="brief"]');
    noter(
      'les archives du Brief listent ses versions, la corrigée « par vous »',
      await attendre(async () => (await archiveBrief.count()) === 1 && (await archiveBrief.getAttribute('data-nombre-versions')) === String(avant + 1), 10000) &&
        /par vous/.test(await archiveBrief.locator('[data-version-courante]').innerText()),
    );
    /* LE BRIEF RÉÉCRIT A REMIS LA DIRECTION « À PROPOSER » : plus aucune retenue, et les pistes écartées restent
       pourtant hors de la liste (#787e) — toujours dans les archives. */
    const directions = volet.locator('[data-contenu-etape="brief"] [data-bloc-etape="direction"] [data-element-suivi]');
    noter(
      'sans direction retenue, les pistes écartées ne reviennent pas dans la liste',
      await attendre(async () => (await directions.count()) === 1 && (await volet.locator('[data-contenu-etape="brief"] [data-etat-element="refuse"]').count()) === 0, 10000) &&
        (await directions.first().getAttribute('data-etat-element')) !== 'valide',
      String(await directions.count()),
    );
    const pistes = page.locator('[data-archives-pistes] [data-piste-ecartee]');
    noter('elles restent dans les archives', await attendre(async () => (await pistes.count()) === 2, 10000), String(await pistes.count()));
    await pistes.first().click();
    const clePiste = await pistes.first().getAttribute('data-piste-ecartee');
    const bouton = page.locator(`[data-utiliser-version="${clePiste}"]`);
    noter('sans direction retenue, une piste se « Remettre en lice »', await attendre(async () => (await bouton.count()) === 1, 10000) && /Remettre cette piste en lice/.test(await bouton.innerText()));
    await bouton.click();
    noter(
      'la piste remise en lice revient dans la liste, à côté de l’autre',
      await attendre(async () => (await volet.locator(`[data-contenu-etape="brief"] [data-element-suivi="${clePiste}"]`).count()) === 1 && (await directions.count()) === 2, 15000),
    );
    await attendre(async () => (await feuille.count()) === 0, 5000);
    await page.screenshot({ path: path.join(CAPTURES, 'ordinateur-3-correction.png') });
  }

  /* -------- 5. Rien de payant -------- */
  noter('aucun appel payant', appelsPayants().length === 0, appelsPayants().join(' | '));
  {
    const db = base(true);
    const n = db.prepare('SELECT COUNT(*) AS n FROM medias_realisation WHERE card_id = ?').get(CARTE_ID).n;
    db.close();
    noter('aucun média ni devis en base', n === 0, String(n));
  }

  /* LA BARRE D'ÉCRITURE REVIENT SUR UNE RÉALISATION EN PAUSE : les étapes
     deviennent alors la tête du repère collé au champ (capture #c92f). */
  await commande({ type: 'card.realisationPause', id: CARTE_ID }).catch((err) => console.log('       (pause : ' + err + ')'));
  {
    /* SUR ORDINATEUR, LE FOCUS DU CHAMP NE REPLIE RIEN. */
    const champ = page.locator('[data-composer] textarea').first();
    /* (Sur ordinateur, les étapes vivent dans le suivi à droite : le repère
       collé au champ n'a que sa ligne et sa liste éventuelle.) */
    const etatDuRepere = () =>
      page.evaluate(() => {
        const r = document.querySelector('[data-temoin-reflexion]');
        return r ? `${!!r.querySelector('[data-entete-du-repere]')}|${!!r.querySelector('[data-liste-du-temoin]')}` : 'absent';
      });
    if (await attendre(async () => (await champ.count()) === 1, 15000)) {
      const avant = await etatDuRepere();
      await champ.focus();
      await page.waitForTimeout(600);
      noter('sur ordinateur, le focus du champ ne replie rien', (await page.locator('[data-liste-repliee-par-le-champ]').count()) === 0 && (await etatDuRepere()) === avant, avant);
      await champ.evaluate((el) => el.blur());
    } else {
      noter('sur ordinateur, la barre d’écriture revient en pause', false);
    }
  }

  const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-CH', serviceWorkers: 'block', isMobile: true, hasTouch: true });
  await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const p = await tel.newPage();
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await ouvrirLaCarte(p);
  await p.waitForTimeout(2500);
  await p.screenshot({ path: path.join(CAPTURES, 'telephone-carte.png') });
  await controlerLeRepereSurTelephone(p);
  {
    /* SUR TÉLÉPHONE : le tableau défile chez lui, la page ne déborde pas. */
    const suivi = p.locator(`[data-volet-de-suivi="${CARTE_ID}"]`);
    if ((await suivi.count()) === 0) await p.locator('[data-ouvrir-le-suivi]').first().click({ timeout: 10000 }).catch(() => {});
    if (await attendre(async () => (await suivi.count()) === 1, 10000)) {
      const scenario = suivi.locator('[data-ouvrir-etape="brief"]');
      if (!(await suivi.locator('li[data-etape-suivi="brief"][data-etape-ouverte]').count())) await scenario.click();
      await attendre(async () => (await suivi.locator('[data-contenu-etape="brief"] table').count()) === 1, 10000);
      const debord = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      noter('sur téléphone, le tableau du scénario ne fait pas déborder l’écran', debord <= 1, String(debord));
      noter('sur téléphone, le Plan ouvert sur l’ordinateur est ouvert aussi', await attendre(async () => (await suivi.locator('[data-element-suivi="plan-2"] [data-texte-entier]').count()) === 1, 10000));
      const largeur = await suivi.locator('[data-element-suivi="plan-2"] [data-rubrique-du-brief]').first().evaluate((el) => Math.round(el.getBoundingClientRect().width)).catch(() => 0);
      noter('sur téléphone, le texte d’une rubrique garde une largeur lisible malgré les retraits (au moins 260 px)', largeur >= 260, String(largeur));
      /* LE MENU À TROIS POINTS SUR TÉLÉPHONE : il s'ouvre en entier dans l'écran. */
      await suivi.locator('[data-menu-de-l-etape="brief"]').scrollIntoViewIfNeeded().catch(() => {});
      await suivi.locator('[data-menu-de-l-etape="brief"]').click().catch(() => {});
      const menu = p.locator('[data-entrees-du-menu-de-l-etape="brief"]');
      /* Sur téléphone il s'ouvre en feuille du bas : on mesure une fois l'arrivée finie. */
      const dansLEcran = await attendre(
        async () =>
          (await menu.count()) === 1 &&
          (await menu.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return r.left >= 0 && r.right <= window.innerWidth + 0.5 && r.top >= 0 && r.bottom <= window.innerHeight + 0.5;
          })),
        8000,
      );
      noter('sur téléphone, le menu à trois points s’ouvre entier dans l’écran', dansLEcran);
      await p.waitForTimeout(300);
      await p.screenshot({ path: path.join(CAPTURES, 'telephone-menu-de-l-etape.png') });
      await p.keyboard.press('Escape');
      await suivi.locator('[data-element-suivi="plan-2"]').scrollIntoViewIfNeeded().catch(() => {});
      await p.screenshot({ path: path.join(CAPTURES, 'telephone-brief-en-arbre.png') });
      await p.screenshot({ path: path.join(CAPTURES, 'telephone-scenario.png') });
    } else {
      noter('sur téléphone, le suivi s’ouvre', false);
    }
  }
  await tel.close();

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));
  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles au vert. Captures : ${CAPTURES}`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  console.error(journal.slice(-40).join(''));
  process.exit(1);
});
