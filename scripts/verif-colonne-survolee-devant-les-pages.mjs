#!/usr/bin/env node
/**
 * LA COLONNE RÉDUITE, SURVOLÉE, S'OUVRE DEVANT LA PAGE OUVERTE — vérifié dans un
 * VRAI navigateur, sur un démon JETABLE. Colonne réduite par son bouton, page
 * d'une carte ouverte, survol de la bande : le point (150, 300) et la barre
 * d'en-tête (150, 20) appartiennent au panneau ; un voile de fenêtre ou de
 * feuille du bas le renvoie dessous (z-40). La cause du défaut était le
 * `z-index: 1` permanent de la racine (`[data-app-racine]`, `styles.css`).
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-colonne-survolee-devant-les-pages.mjs
 *
 * (Décor repris de verif-voile-et-liste-des-projets.mjs.)
 * ---
 * LE VOILE DES FEUILLES DU BAS, LA LISTE DES PROJETS ET LA COLONNE DE GAUCHE —
 * vérifiés dans un VRAI navigateur, sur un démon JETABLE (base neuve, aucun
 * quota dépensé). Demande du 15/10/2026 :
 *
 *  1. Le VOILE d'une feuille du bas recouvre toute l'application : sur ce qui
 *     est dessous (colonne, barre du haut), `elementFromPoint` rend le voile, un
 *     clic dessus referme la feuille SANS déclencher le bouton touché.
 *  2. La LISTE des projets (le nom, en haut) : « Plan de travail » en tête,
 *     « Récents » après deux ouvertures, projets rangés par dernière ouverture,
 *     épingles qui s'ajoutent sans ouvrir le projet ni fermer la liste, groupes
 *     repliables avec le MÊME réglage que la colonne de gauche.
 *  3. La COLONNE de gauche : un bouton de tri par dernière ouverture, bascule
 *     éteinte par défaut ; allumé, le glisser-déposer est suspendu ; éteint,
 *     l'ordre manuel revient exactement.
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-voile-et-liste-des-projets.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7264);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-colonne-devant-', port: PORT });

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const MAINTENANT = Date.now();
const H = 3600_000;

function projet(db, id, name, rank, extra = {}) {
  const p = { id, name, path: `${DEPOT}-${id}`, defaultEngine: 'claude', isSelf: false, rank, archived: false, createdAt: MAINTENANT, updatedAt: MAINTENANT, ...extra };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, name, p.path, p.archived ? 1 : 0, JSON.stringify(p), MAINTENANT, MAINTENANT,
  );
}

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), MAINTENANT, MAINTENANT + H, 'vérification voile et liste');
  db.prepare('DELETE FROM projects').run();
  db.prepare('DELETE FROM project_groups').run();
  // L'ordre manuel : Bêta (1), Alpha (2), le groupe « Clients » (3) et Gamma, Élodie (4).
  db.prepare('INSERT INTO project_groups (id, name, rank, collapsed, color, created_at) VALUES (?, ?, ?, 0, ?, ?)').run('g-clients', 'Clients', 3, null, MAINTENANT);
  projet(db, 'p-alpha', 'Alpha', 2, { deploiement: { herite: true } });
  projet(db, 'p-beta', 'Bêta', 1);
  projet(db, 'p-gamma', 'Gamma', 1, { groupId: 'g-clients' });
  projet(db, 'p-elodie', 'Élodie', 4);
  const c = {
    id: 'c-champ', projectId: 'p-alpha', title: 'Carte du champ', description: 'Une carte pour ouvrir une feuille.', labels: [], column: 'planned', position: 1,
    origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    excludedFromDeploy: false, horsTache: false, codeDejaEnregistre: false, createdAt: MAINTENANT - H, updatedAt: MAINTENANT - H,
  };
  db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    c.id, c.projectId, c.column, 1, c.title, JSON.stringify(c), null, c.createdAt, c.updatedAt,
  );
  const a = { id: 'ag-champ', projectId: 'p-alpha', cardId: 'c-champ', role: 'cadrage', title: 'Cadrage', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'done', createdAt: MAINTENANT - H, updatedAt: MAINTENANT - H,
    contextUsage: { usedTokens: 28000, capacityTokens: 200000, percentage: 14, measuredAt: MAINTENANT } };
  db.prepare(`INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, 'done', ?, ?, ?)`).run(
    a.id, a.projectId, a.cardId, a.role, JSON.stringify(a), a.createdAt, a.updatedAt,
  );
  db.close();
}

const lignesDuGroupe = (liste) =>
  liste.locator('[data-ligne-tiroir-projets]:not([data-ligne-tiroir-projets="plan-de-travail"])').evaluateAll((els) => els.map((e) => e.getAttribute('data-ligne-tiroir-projets')));
const recents = (liste) => liste.locator('[data-ligne-recent]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ligne-recent')));


async function main() {
  if (!(await attendrePort())) { console.error(journal.join('')); process.exit(1); }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    await page.goto(`${BASE}/#projet/p-alpha`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('[data-titre-bandeau]').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });
    await page.locator('[data-replier-colonne="depliee"]').first().click();
    await page.waitForTimeout(500);
    await page.mouse.move(900, 450);
    await page.locator('[data-carte="c-champ"]').first().click();
    await page.waitForTimeout(1500);
    await page.mouse.move(20, 300); await page.mouse.move(26, 320);
    await page.waitForTimeout(800);
    const info = await page.evaluate(() => {
      const p = document.querySelector('[data-panneau-projets]');
      const el = document.elementFromPoint(150, 300);
      const chaine = [];
      for (let n = p; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.zIndex !== 'auto' || cs.isolation==='isolate' || cs.transform!=='none' || cs.filter!=='none' || cs.backdropFilter!=='none' || cs.opacity!=='1' || cs.contain!=='none' || cs.willChange!=='auto' || cs.position==='fixed') chaine.push(`${n.tagName}.${(n.className||'').toString().slice(0,80)} z=${cs.zIndex} pos=${cs.position} iso=${cs.isolation} tf=${cs.transform} op=${cs.opacity} contain=${cs.contain} wc=${cs.willChange}`); }
      return { etat: p?.getAttribute('data-panneau-projets'), z: p && getComputedStyle(p).zIndex, dedans: !!el?.closest('[data-panneau-projets]'), el: el && (el.tagName + '.' + String(el.className).slice(0,120)), chaine };
    });
    noter('le panneau survolé est déplié, au rang 55', info.etat === 'deplie' && info.z === '55', `${info.etat} z=${info.z}`);
    noter('le panneau survolé passe DEVANT la page de la carte', info.dedans, info.el + ' ' + info.chaine.join(' | '));
    await page.screenshot({ path: '/tmp/sonde-846350/survol.png' });
    const entete = await page.evaluate(() => !!document.elementFromPoint(150, 20)?.closest('[data-panneau-projets]'));
    noter('le panneau survolé passe devant la barre d’en-tête', entete);
    for (const attr of ['data-voile-de-fenetre', 'data-voile-tiroir']) {
      const r = await page.evaluate((a) => { const v = document.createElement('div'); v.setAttribute(a, ''); v.setAttribute('data-state', 'open'); v.className = 'fixed inset-0 z-50'; v.id = 'faux'; document.body.appendChild(v); const el = document.elementFromPoint(150, 300); const z = getComputedStyle(document.querySelector('[data-panneau-projets]')).zIndex; v.remove(); return { voileDevant: el?.id === 'faux', z }; }, attr);
      noter(`un voile ouvert (${attr}) reste devant le panneau, renvoyé en z-40`, r.voileDevant && r.z === '40', JSON.stringify(r));
    }
  } finally { await navigateur.close(); }
}
main().then(() => process.exit(resultats.every((r) => r.ok) ? 0 : 1), (e) => { console.error(e); process.exit(1); });
