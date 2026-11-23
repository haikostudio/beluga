#!/usr/bin/env node
/**
 * UN TEXTE COPIÉ DANS UNE CARTE D'UN AUTRE PROJET RAMÈNE SES FICHIERS.
 *
 * Le champ de saisie ne retrouvait les tags « [fichier: nom #alias] » que dans
 * la liste du projet affiché : collé dans un autre projet, le texte gardait ses
 * tags, sans un seul fichier au-dessus du champ. Ici, sur un démon à soi (base
 * neuve, port libre, plafond d'agents à zéro, aucun moteur appelé) :
 *
 *   1. une image est déposée dans le projet A ;
 *   2. la barre d'écriture du projet B reçoit un collage de TEXTE SEUL qui la
 *      cite (le cas du presse-papiers du système, où notre type maison ne
 *      survit pas) ;
 *   3. la pièce doit apparaître au-dessus du champ, RECOPIÉE dans le projet B
 *      (nouvel alias), le tag du texte réécrit pour la viser, et un second
 *      collage ne doit rien doubler.
 *
 *   npm run build && node scripts/verif-collage-tag-autre-projet.mjs
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

/* La racine se déduit du script : lancé d'une copie de travail, il juge CE
   code-là, jamais le dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_COLLAGE_PORT || 7213);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = `${RACINE}/data/verification`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-collage-tag-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
for (const dossier of [DATA, PROJETS, path.join(TMP, 'a'), path.join(TMP, 'b')]) fs.mkdirSync(dossier, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
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

/* LE JETON EST HACHÉ EN BASE : la session d'une heure se fabrique puis se retire
   avec le dossier temporaire tout entier. */
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const PROJET_A = 'p-collage-a';
const PROJET_B = 'p-collage-b';
const base = () => new Database(path.join(DATA, 'beluga.db'));

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(JETON),
    maintenant,
    maintenant + 3600_000,
    'vérification collage de tag entre projets',
  );
  // Plafond d'agents à ZÉRO : rien ne peut démarrer tout seul dans le dos.
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  // B d'abord : c'est le projet ouvert au démarrage, celui où l'on colle.
  for (const [id, nom, rang] of [
    [PROJET_B, 'Projet où l’on colle', 1],
    [PROJET_A, 'Projet d’origine', 2],
  ]) {
    const projet = {
      id,
      name: nom,
      path: path.join(TMP, id === PROJET_A ? 'a' : 'b'),
      defaultEngine: 'claude',
      isSelf: false,
      rank: rang,
      archived: false,
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);
  }
  db.close();
}

async function deposerDansA() {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAP0lEQVR42u3OMQEAAAgDoC252H0M' +
      'Ywm4mUryJgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgWQ0YMAAB8W8LqQAAAABJRU5ErkJggg==',
    'base64',
  );
  const reponse = await fetch(`${BASE}/api/upload?project=${PROJET_A}`, {
    method: 'POST',
    headers: {
      cookie: `beluga_session=${JETON}`,
      'content-type': 'image/png',
      'x-file-name': encodeURIComponent('image.png'),
    },
    body: png,
  });
  if (!reponse.ok) return null;
  return (await reponse.json()).attachment ?? null;
}

const piecesDe = (projet) => {
  const db = base();
  const lignes = db.prepare('SELECT data FROM attachments WHERE project_id = ?').all(projet).map((r) => JSON.parse(r.data));
  db.close();
  return lignes;
};

/** Colle du TEXTE SEUL dans le champ, comme le presse-papiers du système. */
async function collerDuTexte(zone, texte) {
  await zone.evaluate((node, contenu) => {
    node.focus();
    const fin = node.value.length;
    node.setSelectionRange(fin, fin);
    const transfert = new DataTransfer();
    transfert.setData('text/plain', contenu);
    const evenement = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfert });
    // Le collage natif n'a pas lieu sur un événement fabriqué : on le rejoue.
    if (node.dispatchEvent(evenement)) document.execCommand('insertText', false, contenu);
  }, texte);
}

async function main() {
  if (!(await attendrePort())) {
    noter('Le démon d’essai démarre', false);
    return;
  }
  await new Promise((r) => setTimeout(r, 1500));
  poserLeDecor();

  const origine = await deposerDansA();
  noter('Une image est déposée dans le projet A', Boolean(origine?.alias), origine?.alias);
  if (!origine?.alias) return;

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await navigateur.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await context.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on(
    'console',
    (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && erreurs.push(m.text()),
  );

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);

    if (!(await page.locator('[data-composer] textarea:visible').count())) {
      const nouvelle = page.getByText('Nouvelle tâche', { exact: true }).first();
      if (await nouvelle.count()) {
        await nouvelle.click({ force: true });
        await page.waitForTimeout(3000);
      }
    }
    const barre = page.locator('[data-composer]').filter({ has: page.locator('textarea:visible') }).last();
    const zone = barre.locator('textarea').last();
    await zone.waitFor({ state: 'visible', timeout: 20000 });

    const tag = `[fichier: image.png #${origine.alias}]`;
    await zone.fill('Voir la capture : ');
    await collerDuTexte(zone, tag);
    await page.waitForTimeout(3500);

    const copies = piecesDe(PROJET_B);
    const copie = copies[0];
    noter('La pièce est recopiée dans le projet où l’on colle', copies.length === 1 && copie.id !== origine.id, copie?.alias);
    noter('La pièce d’origine reste dans son projet', piecesDe(PROJET_A).some((p) => p.id === origine.id));
    if (!copie) {
      await page.screenshot({ path: `${SHOTS}/collage-tag-autre-projet.png` });
      return;
    }

    const pastille = barre.locator(`button[title="#${copie.alias}"]`);
    noter('La pièce apparaît au-dessus du champ', (await pastille.count()) > 0);

    const valeur = (await zone.inputValue()).replace(/ /g, ' ');
    noter(
      'Le tag du texte vise la copie, plus la pièce d’origine',
      valeur.includes(`#${copie.alias}`) && !valeur.includes(`#${origine.alias}`),
    );

    /* Un second collage du même texte : la copie existante est reprise. */
    await collerDuTexte(zone, ` ${tag}`);
    await page.waitForTimeout(3000);
    noter('Coller une seconde fois ne double rien', piecesDe(PROJET_B).length === 1);
    noter('Une seule pastille pour cette pièce', (await barre.locator(`button[title="#${copie.alias}"]`).count()) === 1);

    await page.screenshot({ path: `${SHOTS}/collage-tag-autre-projet.png` });
    await zone.fill('');
    noter('Aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await navigateur.close();
  }
}

await main().catch((erreur) => {
  console.error(erreur);
  noter('L’essai va au bout', false, String(erreur));
});
const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
process.exit(echecs.length ? 1 : 0);
