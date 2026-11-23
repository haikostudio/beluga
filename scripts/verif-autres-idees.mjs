#!/usr/bin/env node
/**
 * « D'AUTRES IDÉES » SANS RELANCER L'AGENT, DANS UN VRAI NAVIGATEUR.
 *
 * Un démon jetable (base neuve, port à lui) reçoit une réponse d'agent qui porte
 * deux suites. Le contrôle clique « D'autres idées » et juge :
 *   - le bouton dit « Recherche d'idées… » dès le clic ;
 *   - de nouvelles suites arrivent SOUS les deux premières, cochables ;
 *   - elles sont toujours là après rechargement (enregistrées sur le message) ;
 *   - aucun message ni tour de plus dans la conversation, la session de
 *     l'agent intacte.
 *
 * La recherche part au VRAI moteur Claude, sur un compte de la machine (un seul
 * petit appel, le modèle léger posé sur l'agent d'essai pour le coût).
 *
 *   node scripts/verif-autres-idees.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKO_AUTRES_IDEES_PORT || 7198);
const BASE = `http://127.0.0.1:${PORT}`;
const MODELE = process.env.HAIKO_AUTRES_IDEES_MODELE || 'claude-haiku-5-5';
const SHOTS = path.join(RACINE, 'data', 'verification');
fs.mkdirSync(SHOTS, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-autres-idees-', port: PORT });
if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}

const db = new Database(path.join(DATA, 'beluga.db'));
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-autres-idees';
const t0 = Date.now();
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), t0, t0 + 3_600_000, 'vérification d’autres idées');
const projet = { id: PROJET_ID, name: 'Essai — d’autres idées', path: DEPOT, defaultEngine: 'claude', isSelf: false, archived: false, createdAt: t0, updatedAt: t0 };
db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
  projet.id,
  projet.name,
  projet.path,
  JSON.stringify(projet),
  t0,
  t0,
);

/* Une carte rendue, son agent de tâche, sa demande et sa réponse à deux suites —
   sur le message ET sur le jalon de fin de tour, comme un vrai tour les pose. */
const CARTE = 'c-autres-idees';
const agentId = crypto.randomUUID();
db.prepare(
  `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description, agent_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
).run(CARTE, PROJET_ID, 'to_deploy', 1, 'Bouton Enregistrer plus rapide', JSON.stringify({ renduA: t0 - 60_000, lastReadAt: t0 - 30_000 }), t0, t0, 'Le bouton Enregistrer doit répondre sans attendre.', agentId);
const fiche = {
  id: agentId, projectId: PROJET_ID, cardId: CARTE, role: 'task', title: 'Bouton Enregistrer plus rapide',
  run: { engine: 'claude', model: MODELE, thinking: 'none', mode: 'direct' }, status: 'done', createdAt: t0, updatedAt: t0,
};
db.prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
  agentId, PROJET_ID, CARTE, 'task', 'done', JSON.stringify(fiche), t0, t0, JSON.stringify({ claude: 'session-d-essai' }),
);
const base = { steps: [], todos: [], proposals: [], questions: [], downloads: [], attachments: [], streaming: false };
const demande = { ...base, id: crypto.randomUUID(), agentId, role: 'user', content: 'Rends le bouton Enregistrer plus rapide.', createdAt: t0 - 120_000 };
const suites = [
  { titre: 'Ajouter un raccourci clavier', description: 'Enregistrer sans souris, par Ctrl+S.' },
  { titre: 'Montrer l’heure de la sauvegarde', description: 'Savoir d’un coup d’œil quand le texte a été gardé.' },
];
const messageId = crypto.randomUUID();
const reponse = {
  ...base, id: messageId, agentId, role: 'assistant',
  content: 'Le bouton « Enregistrer » répond maintenant tout de suite, et un message confirme la sauvegarde.',
  suites, createdAt: t0 - 60_000,
};
for (const m of [demande, reponse])
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(m.id, agentId, m.role, JSON.stringify(m), m.createdAt);
db.prepare(
  `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, resultat, reussie, donnees)
   VALUES (?, ?, 0, 'rapport', 'jalon', ?, ?, 'task', ?, 'Réponse rendue', ?, 1, ?)`,
).run(crypto.randomUUID(), CARTE, t0 - 60_000, agentId, messageId, reponse.content, JSON.stringify({ compte: 'essai', suites }));
const messagesAvant = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE agent_id = ?').get(agentId).n;
const sessionAvant = db.prepare('SELECT session_id FROM agents WHERE id = ?').get(agentId).session_id;

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(`${BASE}/#projet/${PROJET_ID}/tache/${CARTE}`, { waitUntil: 'domcontentloaded' });

  const groupe = page.locator('[data-suites-proposees]:visible').first();
  await groupe.waitFor({ timeout: 30000 });
  noter('deux suites au départ', (await groupe.getAttribute('data-suites-proposees')) === '2');

  const bouton = groupe.locator('[data-autres-idees]');
  await bouton.click();
  await page.waitForTimeout(150);
  const pendant = await bouton.getAttribute('data-autres-idees');
  const textePendant = (await bouton.textContent())?.trim();
  noter('le bouton dit la recherche dès le clic', pendant === 'recherche' && /Recherche/.test(textePendant ?? ''), textePendant);

  let compte = 2;
  const fin = Date.now() + 120_000;
  while (Date.now() < fin) {
    compte = Number((await page.locator('[data-suites-proposees]:visible').first().getAttribute('data-suites-proposees')) ?? 0);
    const etat = await page.locator('[data-autres-idees]:visible').first().getAttribute('data-autres-idees').catch(() => null);
    if (compte > 2 || etat === 'echec') break;
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: path.join(SHOTS, 'autres-idees.png') });
  const etatFinal = await page.locator('[data-autres-idees]:visible').first().getAttribute('data-autres-idees').catch(() => null);
  noter('de nouvelles suites s’ajoutent sous les premières', compte > 2, `${compte} suites, bouton « ${etatFinal} »`);
  if (compte <= 2) fs.writeFileSync('/tmp/verif-autres-idees.log', journal.join(''));
  const titres = await page.locator('[data-suites-proposees]:visible').first().locator('[role="checkbox"]').allTextContents();
  noter('les deux premières restent en tête', /raccourci clavier/.test(titres[0] ?? '') && /heure de la sauvegarde/.test(titres[1] ?? ''));
  noter('le bouton revient à son repos', etatFinal === 'repos');

  if (compte > 2) {
    await page.locator('[data-suites-proposees]:visible').first().locator('[role="checkbox"]').nth(2).click();
    await page.waitForTimeout(400);
    const champ = await page.locator('textarea:visible').first().inputValue();
    noter('une suite ajoutée se coche et rejoint le champ', champ.includes((titres[2] ?? '').split('\n')[0].slice(0, 15)), champ.slice(0, 80));
  }

  /* Un NOUVEL onglet, comme un autre appareil : les suites viennent de la base. */
  const autre = await contexte.newPage();
  await autre.goto(`${BASE}/#projet/${PROJET_ID}/tache/${CARTE}`, { waitUntil: 'domcontentloaded' });
  await autre.locator('[data-suites-proposees]:visible').first().waitFor({ timeout: 30000 });
  const apres = Number(await autre.locator('[data-suites-proposees]:visible').first().getAttribute('data-suites-proposees'));
  noter('toujours là dans un nouvel onglet', apres === compte && apres > 2, `${apres}`);

  const messagesApres = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE agent_id = ?').get(agentId).n;
  noter('aucun message ni tour de plus', messagesApres === messagesAvant, `${messagesAvant} → ${messagesApres}`);
  const sessionApres = db.prepare('SELECT session_id FROM agents WHERE id = ?').get(agentId).session_id;
  noter('la session de l’agent est intacte', sessionApres === sessionAvant);
  const colonne = db.prepare('SELECT column_key FROM cards WHERE id = ?').get(CARTE).column_key;
  noter('la carte ne bouge pas', colonne === 'to_deploy', colonne);
  const surLeJalon = JSON.parse(db.prepare("SELECT donnees FROM card_journal WHERE tour_id = ? AND libelle = 'Réponse rendue'").get(messageId).donnees).suites.length;
  noter('le jalon du fil porte les mêmes suites', surLeJalon === apres, `${surLeJalon}`);
  noter('aucune erreur de page', !erreurs.length, erreurs.join(' | '));
} catch (err) {
  noter('le contrôle s’est déroulé', false, String(err?.message ?? err));
  await navigateur.contexts()[0]?.pages()[0]?.screenshot({ path: path.join(SHOTS, 'autres-idees-echec.png') }).catch(() => {});
} finally {
  await navigateur.close();
  db.close();
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(echecs ? `\n${echecs} échec(s).` : '\nTout est bon.');
process.exit(echecs ? 1 : 0);
