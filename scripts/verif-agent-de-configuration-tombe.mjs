#!/usr/bin/env node
/**
 * L'AGENT DE CONFIGURATION TOMBÉ REPART D'UN AGENT NEUF (25/11/2026, iMiel).
 *
 * Décor : un projet dont le déploiement est prêt et dont l'agent de configuration de la MISE EN PRODUCTION est
 * tombé — statut `failed`, sa question annulée, l'avertissement anodin du moteur (« workspace has not been
 * trusted ») comme seule erreur. Avant la correction, le clic « Initialiser la mise en production » du menu
 * « Publier » rouvrait cette conversation morte et rien ne repartait.
 *
 * On vérifie, dans un vrai navigateur et contre un démon jetable construit depuis cette copie :
 *   - le clic remplace l'agent retenu par un agent NEUF, et l'ancien reste en base ;
 *   - aucun tiroir ne s'ouvre sur l'ancienne conversation (le lancement est silencieux) ;
 *   - l'avertissement de confiance n'est affiché nulle part comme cause.
 *
 * AUCUN QUOTA : le démon jetable tourne avec un dossier personnel VIDE (HOME, CLAUDE_CONFIG_DIR, CODEX_HOME) — le
 * moteur n'y trouve aucun compte, le tour de l'agent neuf ne peut rien dépenser.
 *
 *   npm run build && node scripts/verif-agent-de-configuration-tombe.mjs
 *   VERIF_CAPTURES=/chemin/captures node scripts/verif-agent-de-configuration-tombe.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7213);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const AVERTISSEMENT =
  'Ignoring 1 permissions.allow entry from .claude/settings.local.json: this workspace has not been trusted. Run Claude Code interactively here once and accept the trust dialog.';
const PROJET = 'p-agent-tombe';

/* 1. Un premier démarrage pose la base et son schéma, puis s'arrête : le décor s'écrit sans démon qui tourne.
   Dès CE démarrage, le dossier personnel est vide : sinon l'amorçage des comptes enregistre le vrai compte Claude
   dans la base d'essai, et le tour de l'agent neuf partirait pour de bon au second démarrage. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-agent-tombe-'));
const SANS_COMPTE = path.join(TMP, 'sans-compte');
fs.mkdirSync(SANS_COMPTE, { recursive: true });
const ENV_SANS_COMPTE = {
  HOME: SANS_COMPTE,
  CLAUDE_CONFIG_DIR: SANS_COMPTE,
  CODEX_HOME: SANS_COMPTE,
  /* Les moteurs payés à la clé naissent d'une variable d'environnement : vidées aussi. */
  CURSOR_API_KEY: '',
  MIMO_API_KEY: '',
  OPENROUTER_API_KEY: '',
};
const premier = demarrerDemonDEssai({ tmp: TMP, port: PORT, garder: true, env: ENV_SANS_COMPTE });
if (!(await premier.attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + premier.journal.join(''));
  process.exit(1);
}
premier.nettoyer();
await new Promise((r) => setTimeout(r, 1500));
const { DATA, DEPOT } = premier;

/* 2. Le décor, écrit par les modules du démon dans SA base. */
process.env.BELUGA_DATA = DATA;
const { Message, Project } = await import('@beluga/shared');
const store = await import(path.join(RACINE, 'server', 'dist', 'store.js'));
const { agentDeConfigurationDuProjet } = await import(path.join(RACINE, 'server', 'dist', 'procedure-publication.js'));
const T = Date.now();
store.saveProject(
  Project.parse({
    id: PROJET,
    name: 'Boutique tombée',
    path: DEPOT,
    defaultEngine: 'claude',
    deploiement: { herite: true },
    adresseProduction: 'https://boutique.example',
    createdAt: T,
    updatedAt: T,
  }),
);
const ancien = agentDeConfigurationDuProjet(PROJET, 'production');
store.saveMessage(
  Message.parse({
    id: 'm-coupe',
    agentId: ancien.id,
    role: 'assistant',
    content: '',
    streaming: false,
    createdAt: T,
    error: AVERTISSEMENT,
    questions: [{ id: 'q-coupe', question: 'La production est-elle bien chez ce client ?', options: [], cancelled: true }],
  }),
);
store.saveAgent({ ...store.getAgent(ancien.id), status: 'failed' });

const jeton = crypto.randomBytes(32).toString('hex');
let comptes = -1;
{
  const db = new Database(path.join(DATA, 'beluga.db'));
  comptes = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").get().n
    ? db.prepare('SELECT count(*) AS n FROM accounts').get().n
    : 0;
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(jeton).digest('hex'),
    T,
    T + 3600_000,
    'essai',
  );
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('theme', JSON.stringify('clair'), T);
  db.close();
}

/* 3. Le démon de l'essai, sans aucun compte moteur. */
const { journal, attendrePort, nettoyer } = demarrerDemonDEssai({
  tmp: TMP,
  depot: false,
  port: PORT,
  signaux: true,
  env: ENV_SANS_COMPTE,
});
if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas redémarré :\n' + journal.join(''));
  process.exit(1);
}

const lireProjet = () => {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const ligne = db.prepare('SELECT data FROM projects WHERE id = ?').get(PROJET);
  const agents = db.prepare("SELECT id, status FROM agents WHERE project_id = ? AND role = 'deploy'").all(PROJET);
  db.close();
  return { projet: JSON.parse(ligne.data), agents };
};

async function capturer(page, nom) {
  if (!CAPTURES) return;
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

async function ouvrirLeMenu(page) {
  for (let essai = 0; essai < 3; essai++) {
    await page.goto(`${BASE}/#projet/${PROJET}`, { waitUntil: 'load' });
    /* Sans aucun compte, l'écran « relier un moteur » couvre tout : voulu ici, il est masqué pour l'essai. */
    await page.addStyleTag({ content: '[data-assistant-moteurs]{display:none!important}' });
    const bouton = page.locator('[data-bouton-publier]:visible').first();
    if (await bouton.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false)) {
      await bouton.click();
      if (await page.locator('[data-suivi-publier], [data-initialiser-etape], [data-section-publier]').first().waitFor({ state: 'attached', timeout: 8_000 }).then(() => true, () => false)) return;
    }
  }
  await capturer(page, 'tombe-echec-menu');
  throw new Error(`le menu « Publier » ne s’ouvre pas (adresse : ${page.url()})`);
}

verifier('aucun compte moteur dans la base d’essai : rien ne peut se dépenser', comptes === 0, `${comptes} compte(s)`);
if (comptes !== 0) {
  nettoyer();
  process.exit(1);
}

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const erreurs = [];
try {
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  page.on('pageerror', (e) => erreurs.push(String(e)));

  await ouvrirLeMenu(page);
  const initialiser = page.locator('[data-initialiser-etape="production"]:not([data-eteint])').first();
  verifier('le menu propose « Initialiser la mise en production »', await initialiser.isVisible());
  await capturer(page, 'tombe-1440-clair-avant');
  await initialiser.click();

  let apres = lireProjet();
  for (let i = 0; i < 20 && apres.projet.miseEnProduction?.agentId === ancien.id; i++) {
    await page.waitForTimeout(500);
    apres = lireProjet();
  }
  const neuf = apres.projet.miseEnProduction?.agentId;
  verifier('un agent NEUF est retenu à la place de l’agent tombé', !!neuf && neuf !== ancien.id, `${ancien.id} → ${neuf}`);
  verifier('l’ancien agent reste en base', apres.agents.some((a) => a.id === ancien.id));
  verifier('un seul agent neuf, pas deux', apres.agents.length === 2, `${apres.agents.length} agents`);

  await page.waitForTimeout(1500);
  verifier(
    'aucun tiroir ne s’ouvre sur l’ancienne conversation',
    (await page.locator(`[data-conversation-procedure="${ancien.id}"]`).count()) === 0,
  );
  const texte = await page.locator('body').innerText();
  verifier('l’avertissement de confiance n’est affiché nulle part', !/has not been trusted/.test(texte));
  await capturer(page, 'tombe-1440-clair-apres');

  /* Le téléphone, en sombre : le même menu, après le relancement. */
  const tel = await navigateur.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'fr-CH',
    serviceWorkers: 'block',
    colorScheme: 'dark',
  });
  {
    const db = new Database(path.join(DATA, 'beluga.db'));
    db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('theme', JSON.stringify('sombre'), Date.now());
    db.close();
  }
  await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const pageTel = await tel.newPage();
  pageTel.on('pageerror', (e) => erreurs.push(String(e)));
  await ouvrirLeMenu(pageTel);
  verifier('rien ne déborde en largeur sur téléphone', (await pageTel.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
  await capturer(pageTel, 'tombe-390-sombre-apres');
  verifier('aucune erreur de page', erreurs.length === 0, erreurs.join(' | '));
} catch (err) {
  verifier('déroulé de l’essai', false, String(err?.message ?? err));
} finally {
  await navigateur.close();
  nettoyer();
}

const echecs = resultats.filter((r) => !r).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles réussis.`);
process.exit(echecs ? 1 : 0);
