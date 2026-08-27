#!/usr/bin/env node
/**
 * COPIER UN PROMPT HISTORIQUE EMPORTE SES PIÈCES JOINTES.
 *
 * Le bouton « Copier » sous une demande déjà envoyée ne doit pas rendre que le
 * texte : les fichiers qui étaient joints partent avec lui, images comme
 * documents, et le collage dans la barre d'écriture les repose au-dessus du
 * champ — les fichiers D'ORIGINE, comme s'ils venaient d'être ajoutés à la
 * main.
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve :
 * le démon de production n'est pas touché, et il tourne sur le code qui vient
 * d'être construit. Aucun tour d'agent n'est lancé (plafond d'agents à zéro,
 * aucun message envoyé) : aucun quota dépensé.
 *
 *   npm run build && node scripts/verif-copier-message-jointes.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7193);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = `${RACINE}/data/verification`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-copie-jointes-'));
const TYPE_JOINTES = 'application/x-haikodev-fichiers';

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DOSSIER = path.join(TMP, 'projet');
for (const dossier of [DATA, PROJETS, DOSSIER]) fs.mkdirSync(dossier, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

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

/*
 * LE CHAMP ÉCRIT SES TAGS AVEC DES ESPACES INSÉCABLES (shared/src/ancres.ts) :
 * c'est ce qui empêche « [fichier: nom] » d'être coupé en fin de ligne. Toute
 * lecture du champ est donc ramenée aux espaces ordinaires avant comparaison.
 */
const lisible = (valeur) => (valeur || '').replace(/\u00A0/g, ' ');

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

/* ------------------------------------------------------------------ */
/* Le décor : un projet, une conversation, une demande déjà envoyée     */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const AGENT_ID = 'a-essai';
const base = () => new Database(path.join(DATA, 'haikodev.db'));

const marque = Date.now();
const TEXTE = `Vérification ${marque} — voici mes fichiers, reprends-les.`;
const NOM_IMAGE = `capture-copie-${marque}.png`;
const NOM_DOC = `notes-copie-${marque}.txt`;
/* La demande d'origine ne cite aucun fichier : la COPIE doit les nommer
   d'elle-même, sans quoi rien ne permettrait de les retrouver quand le
   presse-papiers du système n'a porté que du texte (téléphone). */
const TEXTE_COPIE = `${TEXTE} [fichier: ${NOM_IMAGE}] [fichier: ${NOM_DOC}]`;

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(JETON),
    maintenant,
    maintenant + 3600_000,
    'vérification copie des pièces jointes',
  );

  // Plafond d'agents à ZÉRO : rien ne peut démarrer tout seul dans le dos.
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai copie des pièces jointes',
    path: DOSSIER,
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

  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    role: 'cadrage',
    title: 'Chef d’orchestre',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(agent.id, PROJET_ID, 'cadrage', 'idle', JSON.stringify(agent), maintenant, maintenant);
  db.close();
}

/** Une petite image PNG bien réelle, rendue unique (le serveur dédoublonne). */
function fabriqueImage(nom) {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAP0lEQVR42u3OMQEAAAgDoC252H0M' +
      'Ywm4mUryJgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgWQ0YMAAB8W8LqQAAAABJRU5ErkJggg==',
    'base64',
  );
  const fichier = path.join(TMP, nom);
  fs.writeFileSync(fichier, Buffer.concat([png, crypto.randomBytes(8)]));
  return fichier;
}

function fabriqueDocument(nom) {
  const fichier = path.join(TMP, nom);
  fs.writeFileSync(fichier, `Des notes ordinaires — ${crypto.randomUUID()}\n`);
  return fichier;
}

/** Envoyer un fichier au démon comme le ferait la page, et rendre son identifiant. */
async function envoyerFichier(fichier, mime) {
  const reponse = await fetch(`${BASE}/api/upload?project=${PROJET_ID}`, {
    method: 'POST',
    headers: {
      cookie: `haikodev_session=${JETON}`,
      'content-type': mime,
      'x-file-name': encodeURIComponent(path.basename(fichier)),
    },
    body: fs.readFileSync(fichier),
  });
  const data = await reponse.json();
  return data.attachment?.id ?? null;
}

/** Une demande DÉJÀ ENVOYÉE, avec ses deux fichiers : c'est elle qu'on copie. */
function poserLaDemande(ids) {
  const db = base();
  const id = crypto.randomUUID();
  const message = {
    id,
    agentId: AGENT_ID,
    role: 'user',
    content: TEXTE,
    steps: [],
    todos: [],
    proposals: [],
    questions: [],
    downloads: [],
    attachments: ids,
    streaming: false,
    createdAt: Date.now(),
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    AGENT_ID,
    'user',
    JSON.stringify(message),
    message.createdAt,
  );
  db.close();
  return id;
}

/* ------------------------------------------------------------------ */
/* L'écran                                                             */
/* ------------------------------------------------------------------ */

async function ecran(navigateur) {
  const context = await navigateur.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.addCookies([
    { name: 'haikodev_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on(
    'console',
    (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && erreurs.push(m.text()),
  );

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    const demande = page.getByText(TEXTE).first();
    await demande.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    noter('La demande déjà envoyée est affichée', (await demande.count()) > 0);
    if (!(await demande.count())) {
      await page.screenshot({ path: `${SHOTS}/copie-jointes-demande-introuvable.png` });
      return { erreurs };
    }
    await demande.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1500);

    noter(
      'Les deux fichiers de la demande sont visibles sous elle',
      (await page.locator(`img[alt="${NOM_IMAGE}"]`).count()) > 0 &&
        (await page.getByText(NOM_DOC).count()) > 0,
    );

    /* ---- 1. Le bouton « Copier » emporte les pièces jointes ---- */
    await page.evaluate(() => {
      window.__copie = null;
      // Notre pose se fait en phase de CAPTURE : cette écoute-ci, en phase de
      // remontée, lit donc ce qui a réellement été mis dans le presse-papiers.
      document.addEventListener('copy', (event) => {
        window.__copie = {
          texte: event.clipboardData?.getData('text/plain') ?? '',
          jointes: event.clipboardData?.getData('application/x-haikodev-fichiers') ?? '',
          html: event.clipboardData?.getData('text/html') ?? '',
        };
      });
    });

    const bouton = page.locator('button[title="Copier le message"]').first();
    await bouton.waitFor({ state: 'visible', timeout: 10000 });
    await bouton.click({ force: true });
    await page.waitForTimeout(2500);

    const copie = await page.evaluate(() => window.__copie);
    noter('Le clic sur « Copier » écrit bien dans le presse-papiers', Boolean(copie));
    noter(
      'Le texte copié porte la demande ET le nom de ses deux fichiers',
      copie?.texte === TEXTE_COPIE,
      copie?.texte?.slice(0, 90),
    );

    let jointes = [];
    try {
      jointes = JSON.parse(copie?.jointes || '[]');
    } catch {
      jointes = [];
    }
    noter(
      'Les DEUX pièces jointes voyagent avec le texte, document compris',
      jointes.length === 2 &&
        jointes.some((j) => j.name === NOM_IMAGE) &&
        jointes.some((j) => j.name === NOM_DOC),
      JSON.stringify(jointes.map((j) => j.name)),
    );
    noter(
      "L'image reste collable hors de l'application (copie en clair)",
      /^data:image\//.test(
        (copie?.html || '').match(/src="([^"]+)"/)?.[1] ?? '',
      ),
      (copie?.html || '').slice(0, 40),
    );

    /* ---- 2. Le collage dans la barre d'écriture recrée les fichiers ---- */
    const zone = page.locator('textarea:visible').last();
    await zone.waitFor({ state: 'visible', timeout: 10000 });
    await zone.focus();
    await zone.fill('');
    await page.waitForTimeout(500);

    await zone.evaluate(
      (node, [texte, jointesBrut, type]) => {
        node.focus();
        node.setSelectionRange(0, 0);
        const transfert = new DataTransfer();
        transfert.setData('text/plain', texte);
        transfert.setData(type, jointesBrut);
        node.dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfert }),
        );
      },
      [copie?.texte ?? '', copie?.jointes ?? '', TYPE_JOINTES],
    );
    await page.waitForTimeout(3000);

    noter(
      'Le texte collé revient dans le champ',
      lisible(await zone.inputValue()) === TEXTE_COPIE,
      lisible(await zone.inputValue()),
    );

    const retraits = page.locator('button[title="Retirer ce fichier"]');
    const posees = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button[title="Retirer ce fichier"]')).map(
        (bouton) => bouton.parentElement?.textContent?.trim() ?? '',
      ),
    );
    noter(
      'Les deux fichiers d’origine reparaissent au-dessus du champ',
      (await retraits.count()) === 2 &&
        posees.some((nom) => nom.includes(NOM_IMAGE)) &&
        posees.some((nom) => nom.includes(NOM_DOC)),
      JSON.stringify(posees),
    );
    await page.screenshot({ path: `${SHOTS}/copie-jointes-collage.png` });

    /* ---- 3. Coller une seconde fois ne fait pas de doublon ---- */
    await zone.evaluate(
      (node, [texte, jointesBrut, type]) => {
        node.focus();
        const fin = node.value.length;
        node.setSelectionRange(fin, fin);
        const transfert = new DataTransfer();
        transfert.setData('text/plain', texte);
        transfert.setData(type, jointesBrut);
        node.dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfert }),
        );
      },
      [copie?.texte ?? '', copie?.jointes ?? '', TYPE_JOINTES],
    );
    await page.waitForTimeout(2000);
    noter('Coller deux fois ne joint pas les mêmes fichiers en double', (await retraits.count()) === 2);

    /* ---- 4. LE CAS DU TÉLÉPHONE : le presse-papiers n'a porté QUE du texte ---- */
    await zone.focus();
    await zone.fill('');
    await page.waitForTimeout(1200);
    noter('La barre est vide avant le collage en texte seul', (await retraits.count()) === 0);

    await zone.evaluate(
      (node, texte) => {
        node.focus();
        node.setSelectionRange(0, 0);
        const transfert = new DataTransfer();
        // Rien d'autre : c'est tout ce que rend le presse-papiers du système.
        transfert.setData('text/plain', texte);
        node.dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfert }),
        );
      },
      TEXTE_COPIE,
    );
    await page.waitForTimeout(3000);

    const parLeTexte = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button[title="Retirer ce fichier"]')).map(
        (bouton) => bouton.parentElement?.textContent?.trim() ?? '',
      ),
    );
    noter(
      'Un collage en TEXTE SEUL rattache quand même les deux fichiers d’origine',
      parLeTexte.length === 2 &&
        parLeTexte.some((nom) => nom.includes(NOM_IMAGE)) &&
        parLeTexte.some((nom) => nom.includes(NOM_DOC)),
      JSON.stringify(parLeTexte),
    );
    noter(
      'Le texte, lui, arrive entier',
      lisible(await zone.inputValue()) === TEXTE_COPIE,
      lisible(await zone.inputValue()),
    );
    await page.screenshot({ path: `${SHOTS}/copie-jointes-collage-texte-seul.png` });

    // On laisse la barre propre.
    await zone.focus();
    await zone.fill('');
    await page.waitForTimeout(800);
  } finally {
    await context.close();
  }
  return { erreurs };
}

/* ------------------------------------------------------------------ */

async function main() {
  if (!(await attendrePort())) throw new Error("le démon d'essai n'a pas démarré");
  poserLeDecor();
  await new Promise((r) => setTimeout(r, 1500));

  const idImage = await envoyerFichier(fabriqueImage(NOM_IMAGE), 'image/png');
  const idDoc = await envoyerFichier(fabriqueDocument(NOM_DOC), 'text/plain');
  if (!idImage || !idDoc) throw new Error("les fichiers d'essai n'ont pas été acceptés");
  poserLaDemande([idImage, idDoc]);

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  let erreurs = [];
  try {
    ({ erreurs } = await ecran(navigateur));
  } finally {
    await navigateur.close();
  }
  noter('Aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
