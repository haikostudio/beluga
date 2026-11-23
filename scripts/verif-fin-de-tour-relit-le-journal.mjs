#!/usr/bin/env node
/**
 * UN TOUR QUI SE TERMINE RELIT LE JOURNAL DE LA CARTE AFFICHÉE (carte 71e1006a, capture #251f).
 *
 *   npm run build && node scripts/verif-fin-de-tour-relit-le-journal.mjs
 *
 * Le constat : un téléphone resté ouvert pendant un cadrage n'a pas reçu les
 * dernières lignes du tour (la compréhension, la réponse rendue). Rien ne le lui
 * signalait : le fil s'arrêtait avant la compréhension jusqu'à ce qu'on rouvre la
 * carte.
 *
 * Le contrôle monte son PROPRE démon (port `BELUGA_FIN_DE_TOUR_PORT`, jamais
 * `BELUGA_URL`), ouvre une carte de cadrage au format téléphone, puis :
 *   1. écrit la compréhension DIRECTEMENT en base — aucun événement ne part vers
 *      l'écran : c'est la ligne perdue ;
 *   2. vérifie qu'elle n'est pas affichée (la perte est bien jouée) ;
 *   3. joue la fin du tour sur le canal de l'écran (`routeWebSocket`) : l'agent
 *      de la carte passe de « en tour » à « fini » ;
 *   4. vérifie que la compréhension paraît, SANS rouvrir la carte ;
 *   5. vérifie qu'une mise à jour de l'agent SANS fin de tour ne relit rien.
 * Sans le correctif (`finDeTourARelire`, web/src/lib/client.ts), le point 4 échoue.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_FIN_DE_TOUR_PORT || 7251);
const BASE = `http://127.0.0.1:${PORT}`;
const PROJET = 'p-fin-de-tour';
const CARTE = 'c-fin-de-tour';
const AGENT = 'ag-fin-de-tour';
const TOUR = 'tour-fin-de-tour';
const MARQUE = 'Le bouton se posera à côté de l’adresse';

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-fin-de-tour-', port: PORT });
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const ouvrir = () => new Database(path.join(DATA, 'beluga.db'));

function poserLeDecor() {
  const db = ouvrir();
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), t, t + 3600_000, 'vérification fin de tour');
  db.prepare('DELETE FROM projects').run();
  const projet = { id: PROJET, name: 'Essai fin de tour', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: t, updatedAt: t };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(PROJET, projet.name, DEPOT, JSON.stringify(projet), t, t);
  const agent = { id: AGENT, projectId: PROJET, cardId: CARTE, role: 'cadrage', title: 'Copier l’adresse', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'idle', createdAt: t, updatedAt: t };
  db.prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(AGENT, PROJET, CARTE, 'cadrage', 'idle', JSON.stringify(agent), t, t);
  const carte = {
    id: CARTE, projectId: PROJET, title: 'Copier l’adresse', description: 'Un bouton pour copier l’adresse.', labels: [],
    column: 'planned', position: 1, origin: 'user', agentId: AGENT, conversationAgentId: AGENT,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' }, excludedFromDeploy: false, horsTache: false,
    scheduling: { asap: false, attempts: 0, restarts: 0 }, createdAt: t, updatedAt: t,
  };
  db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(CARTE, PROJET, 'planned', 1, carte.title, JSON.stringify(carte), t, t);
  // La demande, dans le fil de l'agent ET dans le journal : sans fil, la conversation n'affiche pas le flux.
  const demande = {
    id: 'm-demande', agentId: AGENT, role: 'user', content: 'Ajoute un bouton pour copier cette adresse.',
    steps: [], todos: [], proposals: [], questions: [], downloads: [], attachments: [], streaming: false, createdAt: t - 60_000,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(demande.id, AGENT, 'user', JSON.stringify(demande), demande.createdAt);
  db.prepare(
    `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, resultat)
     VALUES (?, ?, 0, 'cadrage', 'jalon', ?, ?, 'cadrage', ?, 'Demande', ?)`,
  ).run('j-demande', CARTE, t - 60_000, AGENT, TOUR, demande.content);
  db.close();
  return agent;
}

/** La ligne PERDUE : écrite en base, jamais annoncée à l'écran. */
function ecrireLaComprehensionEnSilence() {
  const db = ouvrir();
  db.prepare(
    `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, resultat)
     VALUES (?, ?, 1, 'cadrage', 'jalon', ?, ?, 'cadrage', ?, 'Compréhension', ?)`,
  ).run('j-comprehension', CARTE, Date.now(), AGENT, TOUR, `### Un bouton pour copier\n${MARQUE}, et copie l’adresse d’un toucher.`);
  db.close();
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  const agent = poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE }]);
    const page = await contexte.newPage();
    /* Le canal de l'écran passe par ici : tout est relayé, et l'on peut y jouer un événement du démon. */
    let versLaPage = null;
    let journauxDemandes = 0;
    await page.routeWebSocket(/\/ws/, (ws) => {
      const serveur = ws.connectToServer();
      versLaPage = ws;
      ws.onMessage((m) => {
        if (typeof m === 'string' && m.includes('"card.journal"')) journauxDemandes += 1;
        serveur.send(m);
      });
      serveur.onMessage((m) => ws.send(m));
    });
    await page.goto(`${BASE}/#projet/${PROJET}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.evaluate(([p, c]) => (window.location.hash = `projet/${p}/tache/${c}`), [PROJET, CARTE]);
    await page.waitForSelector('[data-flux-liste]', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const jouer = (evenement) => versLaPage?.send(JSON.stringify(evenement));

    /* L'agent est en tour, l'écran le sait. */
    jouer({ type: 'agent.upsert', agent: { ...agent, status: 'running', startedAt: Date.now() } });
    await page.waitForTimeout(500);
    ecrireLaComprehensionEnSilence();
    await page.waitForTimeout(1500);
    const avant = await page.locator('[data-bloc-comprehension]').count();
    noter('la compréhension écrite en silence n’est pas affichée (ligne perdue jouée)', avant === 0, `${avant} bloc(s)`);

    /* 5. Une mise à jour de l'agent SANS fin de tour ne relit rien. */
    const demandesAvant = journauxDemandes;
    jouer({ type: 'agent.upsert', agent: { ...agent, status: 'running', startedAt: Date.now(), title: 'Copier l’adresse (titre)' } });
    await page.waitForTimeout(2500);
    noter('une mise à jour pendant le tour ne relit pas le journal', journauxDemandes === demandesAvant, `${journauxDemandes - demandesAvant} demande(s)`);

    /* 3-4. La fin du tour : l'écran relit le journal, la compréhension paraît sans rouvrir la carte. */
    jouer({ type: 'agent.upsert', agent: { ...agent, status: 'done', endedAt: Date.now() } });
    const parue = await page
      .locator('[data-bloc-comprehension]')
      .first()
      .waitFor({ timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    noter('à la fin du tour, la compréhension perdue paraît sans rouvrir la carte', parue);
    if (parue) {
      const texte = await page.locator('[data-bloc-comprehension]').first().innerText();
      noter('c’est bien la compréhension écrite en base', texte.includes(MARQUE));
    } else {
      await page.screenshot({ path: '/tmp/verif-fin-de-tour.png' }).catch(() => {});
      console.log('(capture : /tmp/verif-fin-de-tour.png)');
    }
    noter('une seule relecture pour une fin de tour', journauxDemandes - demandesAvant === 1, `${journauxDemandes - demandesAvant}`);
  } finally {
    await navigateur.close();
  }
}

try {
  await main();
} catch (err) {
  noter('le contrôle s’est déroulé jusqu’au bout', false, err.message);
} finally {
  nettoyer();
}
const echecs = resultats.filter((r) => !r.ok).length;
console.log(echecs ? `\n${echecs} échec(s) sur ${resultats.length}` : `\nTout est vert (${resultats.length} contrôles).`);
process.exit(echecs ? 1 : 0);
