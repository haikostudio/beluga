#!/usr/bin/env node
/**
 * L'EXPORT DU STUDIO QUI ATTEND LA MÉMOIRE SE LIT SUR SA LIGNE (carte « Enquête sur les décrochages du serveur »,
 * 18/11/2026).
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-export-attend-la-memoire.mjs
 *   (BELUGA_VERIF_CAPTURES=<dossier> pour garder les images)
 *
 * Démon jetable, base neuve : une création du Studio et deux exports en file. L'attente de mémoire est un état
 * PASSAGER du démon (`exportAttendLaMemoire`), qu'aucune base ne porte : le canal est donc intercepté et le
 * premier export en file reçoit `attendLaMemoire: true` en route — c'est l'écran qu'on juge, pas la mémoire de la
 * machine. Le second garde la phrase d'avant. Ordinateur 1440 et téléphone 390, clair et sombre.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { chromium } from 'playwright';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7238);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.BELUGA_VERIF_CAPTURES;
const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-export-attend-la-memoire-', port: PORT });
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const MAINTENANT = Date.now();
const PHRASE = 'En attente : la mémoire de la machine est pleine, l’export part dès qu’elle se libère';
const AVANT = 'En attente : la machine fabrique une vidéo à la fois';

function poserLeDecor(theme) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT OR REPLACE INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), MAINTENANT, MAINTENANT + 3600_000, 'essai');
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('theme', JSON.stringify(theme), Date.now());
  if (!db.prepare("SELECT 1 FROM projects WHERE id = 'p-essai'").get()) {
    const p = { id: 'p-essai', name: 'Essai', path: `${DEPOT}-essai`, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: MAINTENANT, updatedAt: MAINTENANT };
    fs.mkdirSync(p.path, { recursive: true });
    db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(p.id, p.name, p.path, JSON.stringify(p), MAINTENANT, MAINTENANT);
    db.prepare('INSERT OR IGNORE INTO studio_espaces (project_id, kit, cree_le, maj_le) VALUES (?, ?, ?, ?)').run('p-essai', '{}', MAINTENANT, MAINTENANT);
    const composition = { format: '9:16', fond: '#101828', dureeVoulue: 6, pistes: [
      { id: 'visuels', genre: 'visuel', nom: 'Visuels', segments: [{ id: 'titre', genre: 'texte', debut: 0, duree: 4, nom: 'Titre', texte: 'Rentrée', taille: 96, couleur: '#ffffff', position: { x: 50, y: 40 }, gras: true }] },
      { id: 'voix', genre: 'son', nom: 'Voix', segments: [] },
      { id: 'musique', genre: 'son', nom: 'Musique', segments: [] },
      { id: 'sous-titres', genre: 'sous-titres', nom: 'Sous-titres', segments: [] },
    ] };
    /* Le bouton « Construction » (qui mène aux fichiers) vit sous la conversation du directeur : la création a le sien. */
    db.prepare('INSERT INTO studio_creations (id, project_id, titre, formats, etat, version, agent_id, card_id, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)').run('cre', 'p-essai', 'Spot de rentrée', JSON.stringify(['9:16', '1:1']), 'brouillon', 'ag-studio', 'c-studio', MAINTENANT, MAINTENANT);
    const carte = {
      id: 'c-studio', projectId: 'p-essai', title: 'Studio — Spot de rentrée', description: '', labels: ['studio'], column: 'planned', position: MAINTENANT,
      origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' }, excludedFromDeploy: false, horsTache: false,
      codeDejaEnregistre: false, agentId: 'ag-studio', parcours: { plans: [], realisationSouhaitee: true },
      realisation: { medias: ['video'], faites: 0, total: 0, phase: 'intention', restants: [], demandeA: MAINTENANT }, createdAt: MAINTENANT, updatedAt: MAINTENANT,
    };
    db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)').run('c-studio', 'p-essai', 'planned', MAINTENANT, carte.title, JSON.stringify(carte), MAINTENANT, MAINTENANT);
    db.prepare('INSERT OR IGNORE INTO card_labels (card_id, position, label) VALUES (?, 0, ?)').run('c-studio', 'studio');
    const agent = { id: 'ag-studio', projectId: 'p-essai', cardId: 'c-studio', role: 'cadrage', title: 'Directeur artistique', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'idle', service: { id: 'studio', nom: 'Studio', adresse: 'studio/cre' }, createdAt: MAINTENANT, updatedAt: MAINTENANT };
    db.prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('ag-studio', 'p-essai', 'c-studio', 'cadrage', 'idle', JSON.stringify(agent), MAINTENANT, MAINTENANT);
    /* Aucun premier tour de cadrage ne doit partir à l'ouverture (MEM-7274). */
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('premier-tour-cadrage:c-studio', String(MAINTENANT));
    db.prepare('INSERT INTO studio_versions (creation_id, numero, parent, composition, raison, auteur, cree_le) VALUES (?, 1, NULL, ?, ?, ?, ?)').run('cre', JSON.stringify(composition), 'création', 'humain', MAINTENANT);
    const exporter = db.prepare("INSERT INTO studio_exports (id, creation_id, project_id, format, genre, etat, progression, version, voix_en_essai, cree_le, maj_le) VALUES (?, 'cre', 'p-essai', ?, 'video', 'en-file', 0, 1, 0, ?, ?)");
    exporter.run('exp-memoire', '9:16', MAINTENANT - 60_000, MAINTENANT - 60_000);
    exporter.run('exp-file', '1:1', MAINTENANT - 30_000, MAINTENANT - 30_000);
  }
  db.close();
}

/** Le premier export en file de chaque message du démon reçoit l'attente de mémoire, en route. */
function marquer(valeur) {
  if (Array.isArray(valeur)) return valeur.map(marquer);
  if (!valeur || typeof valeur !== 'object') return valeur;
  const o = {};
  for (const [k, v] of Object.entries(valeur)) o[k] = marquer(v);
  if (o.id === 'exp-memoire' && o.etat === 'en-file') o.attendLaMemoire = true;
  return o;
}

async function ouvrirLesFichiers(page) {
  await page.goto(`${BASE}/#studio/cre`);
  await page.locator('[data-studio-editeur="cre"]').first().waitFor({ state: 'attached', timeout: 30000 });
  for (let i = 0; i < 4; i++) {
    /* Au téléphone, la conversation (et son bouton « Construction ») s'ouvre d'abord. */
    const conversation = page.locator('[data-studio-ouvrir="agent"]:visible').first();
    if (await conversation.count()) await conversation.click().catch(() => undefined);
    const bouton = page.locator('[data-studio-mettre-en-production="fil"][data-geste-possible="oui"]:visible').first();
    if (await bouton.isVisible({ timeout: 6000 }).catch(() => false)) {
      await bouton.click();
      if (await page.locator('[data-studio-panneau="fichiers"]').first().isVisible({ timeout: 8000 }).catch(() => false)) return true;
    }
    await page.waitForTimeout(1500);
  }
  return false;
}

async function principal() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const theme of ['clair', 'sombre']) {
      poserLeDecor(theme);
      for (const appareil of ['ordinateur', 'telephone']) {
        const tel = appareil === 'telephone';
        const contexte = await navigateur.newContext({
          viewport: tel ? { width: 390, height: 844 } : { width: 1440, height: 900 },
          ...(tel ? { isMobile: true, hasTouch: true } : {}),
          locale: 'fr-CH',
        });
        await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
        const page = await contexte.newPage();
        const erreurs = [];
        page.on('pageerror', (e) => {
          const texte = String(e?.message ?? e);
          if (!texte.includes("'serviceWorker'")) erreurs.push(texte);
        });
        await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
          const serveur = ws.connectToServer();
          serveur.onMessage((m) => {
            try {
              ws.send(JSON.stringify(marquer(JSON.parse(String(m)))));
            } catch {
              ws.send(m);
            }
          });
        });
        const ouvert = await ouvrirLesFichiers(page);
        const cas = `${appareil} ${theme}`;
        if (!ouvert) {
          const vus = await page.evaluate(() => [...document.querySelectorAll('[data-studio-ouvrir], [data-studio-mettre-en-production]')].map((e) => `${e.getAttribute('data-studio-ouvrir') ?? 'construction ' + e.getAttribute('data-raison')}:${e.checkVisibility()}`).join(' '));
          console.log(`   repères vus : ${vus || 'aucun'} ; adresse ${page.url()}`);
          if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `diagnostic-${appareil}-${theme}.png`) });
        }
        noter(`${cas} : les fichiers à télécharger s’ouvrent`, ouvert);
        if (ouvert) {
          const ligne = page.locator('[data-studio-export="exp-memoire"]').first();
          await ligne.waitFor({ timeout: 15000 }).catch(() => undefined);
          const texte = await ligne.innerText().catch(() => '');
          noter(`${cas} : l’export qui attend la mémoire le dit`, texte.includes(PHRASE), texte.split('\n')[0]);
          const autre = await page.locator('[data-studio-export="exp-file"]').first().innerText().catch(() => '');
          noter(`${cas} : l’autre garde la phrase de la file`, autre.includes(AVANT));
          const deborde = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          noter(`${cas} : rien ne déborde`, deborde <= 0, `${deborde} px`);
          const boite = await ligne.boundingBox();
          const panneau = await page.locator('[data-studio-panneau="fichiers"]').first().boundingBox();
          noter(`${cas} : la phrase reste dans son panneau`, !!boite && !!panneau && boite.x >= panneau.x - 1 && boite.x + boite.width <= panneau.x + panneau.width + 1);
          await page.mouse.move(2, 2);
          // La fenêtre s'ouvre en fondu : une capture prise trop tôt la montre voilée.
          await page.waitForTimeout(900);
          if (CAPTURES) {
            fs.mkdirSync(CAPTURES, { recursive: true });
            await page.screenshot({ path: path.join(CAPTURES, `export-attend-la-memoire-${appareil}-${theme}.png`) });
          }
        }
        noter(`${cas} : aucune erreur de page`, erreurs.length === 0, erreurs[0] ?? '');
        await contexte.close();
      }
    }
  } finally {
    await navigateur.close();
  }
}

let code = 0;
try {
  await principal();
} catch (err) {
  console.error(err);
  code = 1;
} finally {
  nettoyer();
}
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} au vert`);
process.exit(code || echecs ? 1 : 0);
