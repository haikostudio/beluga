#!/usr/bin/env node
/**
 * LA COLONNE « ACTIONS » DES PUBLICATIONS EN ATTENTE (carte « Progression du déploiement au tableau de bord »,
 * 16/11/2026), dans un vrai navigateur, sur le serveur de développement de la copie (qui parle au démon servi).
 *
 * RIEN NE PART EN LIGNE : le canal est intercepté. `deploy.enAttente` reçoit une réponse fabriquée (deux projets),
 * `deploy.start` n'est JAMAIS relayé — l'essai répond « ok » à sa place puis POUSSE à la page la publication en cours,
 * puis réussie, comme le ferait le démon. On vérifie :
 *  - « À déployer » : le bouton « Déployer » part tout de suite, sans ouvrir le menu « Publier » de la ligne ;
 *  - la barre et le pourcentage prennent sa place, et la ligne RESTE alors même que la relecture ne la rend plus ;
 *  - « Terminé » à la fin ;
 *  - « Mise en production en attente » : le bouton demande une confirmation, « Annuler » n'envoie rien ;
 *  - aucun débordement à 390 px, captures 1440/390 en clair et sombre.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL nohup npm run dev --workspace web -- --port 7099 > /tmp/dev.log 2>&1 &
 *   env -u BELUGA_TOKEN -u BELUGA_URL HAIKO_ACTIONS_URL=http://localhost:7099 HAIKO_ACTIONS_PROJETS=<idDev>,<idProd> \
 *     [HAIKO_ACTIONS_CAPTURES=<dossier>] node scripts/verif-actions-de-publication.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.HAIKO_ACTIONS_URL || 'http://localhost:7099';
const DATA = process.env.HAIKO_ACTIONS_DATA || '/root/beluga/data';
const CAPTURES = process.env.HAIKO_ACTIONS_CAPTURES;
const [PROJET_DEV, PROJET_PROD] = String(process.env.HAIKO_ACTIONS_PROJETS || '').split(',');
if (!PROJET_DEV || !PROJET_PROD) throw new Error('HAIKO_ACTIONS_PROJETS=<idDev>,<idProd> manque');
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
const attendre = async (fn, ms = 10000) => {
  for (const fin = Date.now() + ms; Date.now() < fin; await new Promise((r) => setTimeout(r, 150))) if (await fn()) return true;
  return false;
};

const cookie = crypto.randomBytes(32).toString('hex');
const jeton = crypto.createHash('sha256').update(cookie).digest('hex');
const db = new Database(path.join(DATA, 'beluga.db'));
const MAINTENANT = Date.now();
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(jeton, MAINTENANT, MAINTENANT + 3600_000, 'essai actions', 'admin-premier');

const NON_RELAYES = ['prefs.set', 'card.read', 'card.update', 'card.create', 'deploy.start', 'procedure.tour', 'agent.prompt'];

/** L'état fabriqué de l'essai : la ligne « À déployer » disparaît de la relecture dès le lancement. */
const essai = { lance: false, departs: [] };
const enAttente = () => ({
  aDeployer: essai.lance ? [] : [{ projectId: PROJET_DEV, taches: 3, depuis: MAINTENANT - 3 * 3600_000, dernierDeploiement: MAINTENANT - 86400_000 }],
  aProduire: [{ projectId: PROJET_PROD, taches: 2, dernierDeploiement: MAINTENANT - 7200_000, derniereProduction: MAINTENANT - 5 * 86400_000, echec: false }],
});
const run = (state, avance) => ({
  id: 'essai-actions-run',
  projectId: PROJET_DEV,
  cible: 'dev',
  state,
  startedAt: MAINTENANT,
  ...(state === 'success' ? { endedAt: Date.now() } : {}),
  currentStep: avance >= 2 ? 'push' : 'commit',
  steps: [
    { key: 'merge', state: 'done', log: '' },
    { key: 'commit', state: avance >= 2 ? 'done' : 'running', log: '' },
    { key: 'push', state: state === 'success' ? 'done' : avance >= 2 ? 'running' : 'todo', log: '' },
  ],
  actor: 'essai',
  cardIds: [],
});

async function ouvrirPage(contexte) {
  const page = await contexte.newPage();
  const canal = { envoyer: null };
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const serveur = ws.connectToServer();
    canal.envoyer = (obj) => ws.send(JSON.stringify(obj));
    ws.onMessage((message) => {
      try {
        const lu = JSON.parse(String(message));
        const cmd = lu?.cmd ?? lu;
        if (cmd?.type === 'deploy.enAttente') {
          ws.send(JSON.stringify({ type: 'ack', id: lu.id, ok: true, data: enAttente() }));
          return;
        }
        if (cmd?.type === 'deploy.start') {
          essai.departs.push(cmd);
          ws.send(JSON.stringify({ type: 'ack', id: lu.id, ok: true, data: { ok: true } }));
          return;
        }
        if (NON_RELAYES.includes(cmd?.type)) return;
      } catch {
        /* passe tel quel */
      }
      serveur.send(message);
    });
  });
  /* Le volet de l'assistant, retenu ouvert d'un appareil à l'autre, recouvre le bas droit : on le cache le temps de
     l'essai, sans toucher à sa préférence. */
  await page.addInitScript(() => {
    const poser = () => {
      const style = document.createElement('style');
      style.textContent = '[data-volet-de-jarvis]{display:none!important}';
      document.head.appendChild(style);
    };
    if (document.head) poser();
    else document.addEventListener('DOMContentLoaded', poser);
  });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  return { page, canal, erreurs };
}

const theme = async (page, c) => {
  await page.evaluate((c) => {
    document.documentElement.dataset.theme = c;
    document.documentElement.classList.toggle('dark', c === 'sombre');
    document.documentElement.style.colorScheme = c === 'sombre' ? 'dark' : 'light';
  }, c);
  /* Les couleurs passent par une transition : capturer après elle. */
  await page.waitForTimeout(600);
};
const capture = async (page, nom) => {
  if (!CAPTURES) return;
  await page.mouse.move(5, 5);
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
};
const etat = (page, projectId) => page.locator(`[data-action-de-publication="${projectId}"]`).first().getAttribute('data-etat-action').catch(() => null);

const navigateur = await chromium.launch({ channel: 'chrome' });
try {
  /* ---------------- ORDINATEUR ---------------- */
  const ordi = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await ordi.addCookies([{ name: 'beluga_session', value: cookie, url: BASE }]);
  const { page, canal, erreurs } = await ouvrirPage(ordi);
  let vu = false;
  for (let i = 0; i < 3 && !vu; i += 1) {
    await page.goto(`${BASE}/#en-route`);
    vu = await attendre(() => page.locator('[data-publications-en-attente]').isVisible().catch(() => false), 15000);
  }
  noter('les deux tableaux sont sur « Tableaux de bord »', vu);

  noter('« À déployer » : la colonne Actions porte « Déployer »', (await etat(page, PROJET_DEV)) === 'repos' && (await page.locator(`[data-projet-a-deployer="${PROJET_DEV}"] [data-bouton-action-de-publication="dev"]`).count()) === 1);
  noter('« Mise en production » : la colonne Actions porte son bouton', (await page.locator(`[data-projet-production-en-attente="${PROJET_PROD}"] [data-bouton-action-de-publication="production"]`).count()) === 1);
  await capture(page, 'ordinateur-clair-repos');
  await theme(page, 'sombre');
  await capture(page, 'ordinateur-sombre-repos');
  await theme(page, 'clair');

  /* Déployer : part tout de suite, n'ouvre pas le menu « Publier » de la ligne. */
  const adresseAvant = page.url();
  await page.locator(`[data-projet-a-deployer="${PROJET_DEV}"] [data-bouton-action-de-publication="dev"]`).click();
  await attendre(() => essai.departs.length > 0, 4000);
  noter('le clic envoie un déploiement, sans confirmation', essai.departs.length === 1 && essai.departs[0].cible === 'dev' && essai.departs[0].projectId === PROJET_DEV, JSON.stringify(essai.departs[0] ?? null));
  noter('le clic ne remonte pas à la ligne (pas de menu « Publier » ouvert)', page.url() === adresseAvant && (await page.locator('[data-suivi-publier]').count()) === 0);

  essai.lance = true;
  canal.envoyer({ type: 'deploy.upsert', run: run('running', 1) });
  const enCours = await attendre(async () => (await etat(page, PROJET_DEV)) === 'en-cours', 5000);
  noter('la barre et le pourcentage remplacent le bouton', enCours && (await page.locator(`[data-action-de-publication="${PROJET_DEV}"] [data-barre-progression]`).count()) === 1);
  const pourcent1 = await page.locator(`[data-action-de-publication="${PROJET_DEV}"] [data-barre-progression]`).getAttribute('data-pourcent').catch(() => null);
  await capture(page, 'ordinateur-clair-en-cours');
  await theme(page, 'sombre');
  await capture(page, 'ordinateur-sombre-en-cours');
  await theme(page, 'clair');

  /* La relecture (déclenchée par l'état de la publication) ne rend plus la ligne : elle doit rester. */
  await page.waitForTimeout(1500);
  canal.envoyer({ type: 'deploy.upsert', run: run('running', 2) });
  await page.waitForTimeout(1200);
  noter('la ligne reste pendant la publication, même absente de la relecture', (await page.locator(`[data-projet-a-deployer="${PROJET_DEV}"]`).count()) === 1);
  const pourcent2 = await page.locator(`[data-action-de-publication="${PROJET_DEV}"] [data-barre-progression]`).getAttribute('data-pourcent').catch(() => null);
  noter('le pourcentage avance', Number(pourcent2) > Number(pourcent1), `${pourcent1} → ${pourcent2}`);

  canal.envoyer({ type: 'deploy.upsert', run: run('success', 3) });
  noter('« Terminé » à la fin', await attendre(async () => (await etat(page, PROJET_DEV)) === 'fini', 5000));
  await capture(page, 'ordinateur-clair-fini');
  noter('la ligne s’efface quelques secondes après', await attendre(async () => (await page.locator(`[data-projet-a-deployer="${PROJET_DEV}"]`).count()) === 0, 12000));

  /* Mise en production : confirmation d'abord. */
  await page.locator(`[data-projet-production-en-attente="${PROJET_PROD}"] [data-bouton-action-de-publication="production"]`).click();
  const fenetre = page.getByRole('dialog');
  noter('la mise en production demande une confirmation', await attendre(() => fenetre.isVisible().catch(() => false), 4000));
  noter('rien n’est parti avant la confirmation', essai.departs.length === 1);
  await capture(page, 'ordinateur-clair-confirmation');
  await theme(page, 'sombre');
  await capture(page, 'ordinateur-sombre-confirmation');
  await theme(page, 'clair');
  await fenetre.getByRole('button', { name: 'Annuler' }).click();
  await page.waitForTimeout(500);
  noter('« Annuler » n’envoie rien', essai.departs.length === 1 && (await fenetre.count()) === 0);
  await page.locator(`[data-projet-production-en-attente="${PROJET_PROD}"] [data-bouton-action-de-publication="production"]`).click();
  await attendre(() => fenetre.isVisible().catch(() => false), 4000);
  await fenetre.getByRole('button', { name: 'Mettre en production' }).click();
  await attendre(() => essai.departs.length > 1, 4000);
  noter('confirmer envoie la mise en production', essai.departs[1]?.cible === 'production' && essai.departs[1]?.projectId === PROJET_PROD, JSON.stringify(essai.departs[1] ?? null));
  noter('aucune erreur de page (ordinateur)', erreurs.length === 0, erreurs.join(' | '));
  await ordi.close();

  /* ---------------- TÉLÉPHONE ---------------- */
  essai.lance = false;
  const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await tel.addCookies([{ name: 'beluga_session', value: cookie, url: BASE }]);
  const t = await ouvrirPage(tel);
  let vuTel = false;
  for (let i = 0; i < 3 && !vuTel; i += 1) {
    await t.page.goto(`${BASE}/#en-route`);
    /* Sur téléphone, les deux tableaux vivent sous les onglets « À déployer » et « Production ». */
    if (await attendre(() => t.page.locator('[data-onglets-tableaux-de-bord] [data-onglet="a-deployer"]').isVisible().catch(() => false), 15000)) {
      await t.page.locator('[data-onglets-tableaux-de-bord] [data-onglet="a-deployer"]').click();
      vuTel = await attendre(() => t.page.locator(`[data-projet-a-deployer="${PROJET_DEV}"]`).isVisible().catch(() => false), 8000);
    }
  }
  noter('téléphone : les tableaux s’affichent', vuTel);
  const boite = await t.page.locator(`[data-projet-a-deployer="${PROJET_DEV}"] [data-bouton-action-de-publication="dev"]`).boundingBox();
  noter('téléphone : le bouton « Déployer » se voit sans défiler', !!boite && boite.x >= 0 && boite.x + boite.width <= 390, JSON.stringify(boite));
  noter('téléphone : rien ne déborde en largeur', (await t.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) === 0);
  await capture(t.page, 'telephone-clair-repos');
  await theme(t.page, 'sombre');
  await capture(t.page, 'telephone-sombre-repos');
  await theme(t.page, 'clair');
  t.canal.envoyer({ type: 'deploy.upsert', run: run('running', 2) });
  await attendre(async () => (await etat(t.page, PROJET_DEV)) === 'en-cours', 5000);
  await capture(t.page, 'telephone-clair-en-cours');
  await theme(t.page, 'sombre');
  await capture(t.page, 'telephone-sombre-en-cours');
  await t.page.locator('[data-onglets-tableaux-de-bord] [data-onglet="production"]').click();
  await attendre(() => t.page.locator(`[data-projet-production-en-attente="${PROJET_PROD}"]`).isVisible().catch(() => false), 5000);
  noter('téléphone : « Production » porte son bouton', (await t.page.locator(`[data-projet-production-en-attente="${PROJET_PROD}"] [data-bouton-action-de-publication="production"]`).count()) === 1);
  noter('téléphone : rien ne déborde sur « Production »', (await t.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) === 0);
  await capture(t.page, 'telephone-sombre-production');
  noter('aucune erreur de page (téléphone)', t.erreurs.length === 0, t.erreurs.join(' | '));
  await tel.close();
} finally {
  await navigateur.close();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(jeton);
  db.close();
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles réussis`);
process.exit(echecs ? 1 : 0);
