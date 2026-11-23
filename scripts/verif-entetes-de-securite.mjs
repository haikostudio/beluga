#!/usr/bin/env node
/**
 * LES ENTÊTES DE SÉCURITÉ DU DÉMON, ET AUCUN ÉCRAN CASSÉ PAR LA POLITIQUE DES SOURCES.
 *
 * Sur un démon d'essai (base neuve, dossier de projets à lui — jamais celui en service) :
 *  1. la page d'entrée, sans session, porte les cinq protections ; HSTS seulement quand le relais dit « https » ;
 *  2. le contrôle de sécurité (`constatsDEntetes`) ne relève plus aucun entête manquant ;
 *  3. chaque écran de l'application s'ouvre dans Chrome SANS UNE SEULE violation de la politique des sources
 *     (événement `securitypolicyviolation` dans chaque cadre, aperçu `srcdoc` du Studio compris, et console).
 *
 *   node scripts/verif-entetes-de-securite.mjs       (après `npm run build`)
 *
 * À lancer depuis la COPIE DE TRAVAIL de la carte, jamais depuis le dépôt principal (MEM-2738).
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const { constatsDEntetes } = await import(path.join(RACINE, 'shared/dist/index.js'));
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7196);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-entetes-', port: PORT });
const jeton = crypto.randomBytes(32).toString('hex');
const T = Date.now();
const run = { engine: 'claude', thinking: 'none', mode: 'direct' };

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai');
  const p = { id: 'p-essai', name: 'Essai', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: T, updatedAt: T };
  db.prepare('INSERT OR REPLACE INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run('p-essai', 'Essai', DEPOT, JSON.stringify(p), T, T);
  const composition = { format: '9:16', fond: '#101828', dureeVoulue: 8, pistes: [{ id: 'visuels', genre: 'visuel', nom: 'Visuels', segments: [{ id: 'titre', genre: 'texte', debut: 0, duree: 4, nom: 'Titre', texte: 'Le Studio', taille: 96, couleur: '#ffffff', position: { x: 50, y: 40 }, gras: true }] }] };
  db.prepare('INSERT OR IGNORE INTO studio_espaces (project_id, kit, cree_le, maj_le) VALUES (?, ?, ?, ?)').run('p-essai', '{}', T, T);
  db.prepare('INSERT INTO studio_creations (id, project_id, titre, formats, etat, version, agent_id, card_id, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, ?, ?)').run('cre-essai', 'p-essai', 'Essai', '["9:16"]', 'brouillon', T, T);
  db.prepare('INSERT INTO studio_versions (creation_id, numero, parent, composition, raison, auteur, cree_le) VALUES (?, 1, NULL, ?, ?, ?, ?)').run('cre-essai', JSON.stringify(composition), 'départ', 'humain', T);
  const c = { id: 'c-essai', projectId: 'p-essai', title: 'Carte d’essai', description: 'Essai', labels: [], column: 'planned', position: T, origin: 'user', attachments: [], run, excludedFromDeploy: false, horsTache: false, codeDejaEnregistre: false, agentId: 'ag-essai', createdAt: T, updatedAt: T };
  db.prepare('INSERT OR REPLACE INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)').run('c-essai', 'p-essai', 'planned', T, c.title, JSON.stringify(c), T, T);
  const a = { id: 'ag-essai', projectId: 'p-essai', cardId: 'c-essai', role: 'cadrage', title: 'Agent', run, status: 'idle', createdAt: T, updatedAt: T };
  db.prepare('INSERT OR REPLACE INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('ag-essai', 'p-essai', 'c-essai', 'cadrage', 'idle', JSON.stringify(a), T, T);
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at, a_questions, streaming) VALUES (?, ?, ?, ?, ?, 0, 0)').run('m-1', 'ag-essai', 'assistant', JSON.stringify({ id: 'm-1', agentId: 'ag-essai', role: 'assistant', content: '### Essai\n\nUne réponse **en Markdown** avec `du code`.', attachments: [], createdAt: T, updatedAt: T }), T);
  db.close();
}

/** Les écrans de l'application, par leur adresse. */
const ECRANS = [
  ['accueil', '/#/'],
  ['tableau du projet', '/#projet/p-essai'],
  ['conversation d’une carte', '/#carte/c-essai'],
  ['en route', '/#en-route'],
  ['studio (liste)', '/#studio/'],
  ['studio (création et aperçu)', '/#studio/cre-essai'],
  ['médias', '/#medias/'],
  ['coffre-fort', '/#coffre'],
  ['mémoire', '/#memoire'],
  ['statistiques', '/#statistiques'],
  ['surveillance', '/#surveillance'],
  ['sauvegardes', '/#backups'],
  ['communication', '/#communication'],
  ['réseaux sociaux', '/#reseaux-sociaux'],
  ['marketing', '/#marketing'],
  ['tâches récurrentes', '/#taches-recurrentes'],
  ['espace client', '/#espace'],
  ['réglages', '/#reglages'],
  ['réglages des projets', '/#reglages/projets'],
  ['tableau de bord', '/#tableau-de-bord'],
];

async function principal() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  /* 1. Les entêtes, sans session (la page d'entrée), en HTTP local puis « derrière le relais ». */
  const local = await fetch(`${BASE}/`, { redirect: 'manual' });
  const relais = await fetch(`${BASE}/`, { redirect: 'manual', headers: { 'x-forwarded-proto': 'https' } });
  const api = await fetch(`${BASE}/api/projects`, { redirect: 'manual' });
  verifier('HSTS absent en HTTP local', !local.headers.get('strict-transport-security'));
  verifier('HSTS présent derrière le relais https', /max-age=31536000/.test(relais.headers.get('strict-transport-security') ?? ''));
  for (const nom of ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy']) {
    verifier(`${nom} sur la page d’entrée`, !!relais.headers.get(nom), relais.headers.get(nom)?.slice(0, 60) ?? '');
    verifier(`${nom} sur une réponse de l’API`, !!api.headers.get(nom));
  }
  const entetes = Object.fromEntries(relais.headers.entries());
  const constats = constatsDEntetes({ adresse: 'https://essai.exemple.com/', statut: relais.status, entetes, redirigeVersHttps: true });
  verifier('le contrôle de sécurité ne relève plus aucun entête', constats.length === 0, constats.map((c) => c.id).join(', '));

  /* 2. Chaque écran, dans Chrome, sans violation. */
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-CH', serviceWorkers: 'allow' });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    await contexte.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        const ligne = `${e.violatedDirective} ← ${e.blockedURI || 'en ligne'} (${e.sourceFile || location.href}:${e.lineNumber})`;
        try {
          (window.top.__violations ??= []).push(ligne);
        } catch {
          console.error('CSP-VIOLATION ' + ligne);
        }
      });
    });
    const page = await contexte.newPage();
    const console_ = [];
    const erreurs = [];
    page.on('console', (m) => {
      const texte = m.text();
      if (/Content Security Policy|CSP-VIOLATION|Refused to/i.test(texte)) console_.push(texte.slice(0, 200));
    });
    page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));
    let premier = true;
    for (const [nom, adresse] of ECRANS) {
      console_.length = 0;
      erreurs.length = 0;
      await page.goto(`${BASE}${adresse}`, { waitUntil: 'load' });
      if (premier) {
        await page.reload({ waitUntil: 'load' });
        premier = false;
      }
      await page.waitForTimeout(2500);
      const violations = await page.evaluate(() => {
        const v = window.__violations ?? [];
        window.__violations = [];
        return v;
      });
      const toutes = [...violations, ...console_];
      verifier(`écran « ${nom} » sans violation`, toutes.length === 0, toutes.slice(0, 3).join(' | '));
      if (erreurs.length) console.log(`     (erreurs de page : ${erreurs.slice(0, 2).join(' | ')})`);
      if (CAPTURES) {
        fs.mkdirSync(CAPTURES, { recursive: true });
        await page.screenshot({ path: path.join(CAPTURES, `${nom.replace(/[^a-z0-9]+/gi, '-')}.png`) });
      }
    }
    // Le Studio : l'aperçu `srcdoc` hérite de la politique, il doit quand même dessiner son titre.
    await page.goto(`${BASE}/#studio/cre-essai`, { waitUntil: 'load' });
    const cadre = page.frameLocator('[data-studio-cadre]').first();
    const titre = await cadre.getByText('Le Studio').first().waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false);
    verifier('l’aperçu du Studio dessine sa page malgré la politique', titre);
    // CONTRE-ÉPREUVE : un script venu d'un autre site est bel et bien refusé — le détecteur voit donc les violations.
    await page.evaluate(() => {
      const s = document.createElement('script');
      s.src = 'https://exemple.invalid/piege.js';
      document.head.appendChild(s);
    });
    await page.waitForTimeout(800);
    const piege = await page.evaluate(() => (window.__violations ?? []).join(' | '));
    verifier('un script d’un autre site est refusé (contre-épreuve)', /script-src/.test(piege), piege.slice(0, 120));
    const sw = await page.evaluate(async () => !!(await navigator.serviceWorker?.getRegistration()));
    verifier('le service de l’application installable s’enregistre', sw);
  } finally {
    await navigateur.close();
  }
}

try {
  await principal();
} finally {
  nettoyer?.();
}
const echecs = resultats.filter((r) => !r).length;
console.log(echecs ? `\n${echecs} échec(s).` : `\nTout est vert (${resultats.length} contrôles).`);
process.exit(echecs ? 1 : 0);
