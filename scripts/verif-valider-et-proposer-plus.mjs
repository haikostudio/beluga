#!/usr/bin/env node
/**
 * « VALIDER » ET « VALIDER ET PROPOSER PLUS », DANS UN VRAI NAVIGATEUR (carte plus-de-choix-a-cote-de-repondre).
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-valider-et-proposer-plus.mjs
 *
 * Sur son PROPRE démon (port `HAIKO_VALIDER_PLUS_PORT`), une question à plusieurs choix :
 *   1. le bouton principal s'appelle « Valider », le second est JUSTE à sa droite dans la barre
 *      `[data-actions-question]` (même rangée, même hauteur), et s'appelle « Autres choix » sans
 *      rien de coché, « Valider et proposer plus » dès qu'un choix est coché ;
 *   2. à 1440 et 390 px, en clair et en sombre : captures, rien ne déborde en largeur ;
 *   3. un clic sur « Valider et proposer plus » répond à la question par une chaîne qui COMMENCE
 *      par les libellés cochés (format `texteDeReponse`), suivie de « — Je retiens ces choix… ».
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKO_VALIDER_PLUS_PORT || 7251);
const BASE = `http://127.0.0.1:${PORT}`;
const PROJET = 'p-question-compacte';
const AVEC_QUESTION = crypto.randomUUID();
const AGENT = crypto.randomUUID();
const CONSTRUCTION = crypto.randomUUID();
const CAPTURES = path.join(RACINE, 'data/verification/valider-et-proposer-plus');
fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
console.log(`  …  dépôt jugé : ${RACINE}`);

const { DATA, PROJETS, attendrePort, journal, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-valider-plus-',
  port: PORT,
  depot: false,
  signaux: true,
});
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(JETON), t, t + 3600_000, 'vérification de la question compacte');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  const dossier = path.join(PROJETS, PROJET);
  fs.mkdirSync(path.join(dossier, 'docs'), { recursive: true });
  const projet = { id: PROJET, name: 'Atelier Compact', path: dossier, defaultEngine: 'claude', isSelf: false, branchesDePublication: {}, rank: 1000, archived: false, createdAt: t, updatedAt: t };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(PROJET, projet.name, dossier, JSON.stringify(projet), t, t);
  const briefing = 'Le cahier des charges du projet « Atelier Compact » est terminé. Construis maintenant l’application, d’après lui.';
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description)
     VALUES (?, ?, 'planned', 2, ?, ?, ?, ?, ?)`,
  ).run(
    CONSTRUCTION,
    PROJET,
    'Construction de « Atelier Compact »',
    JSON.stringify({ briefing, suiteDuCahier: { cahierId: 'cahier-archive' }, run: { engine: 'claude', thinking: 'none', mode: 'direct' } }),
    t,
    t,
    'Construire l’application à partir de son cahier des charges.',
  );
  db.close();
}

/* Un agent arrêté sur sa question, reposé juste avant chaque mesure : la veille
   des tours bloqués le refermerait sinon. La carte est un cahier en cours, pour
   que son déroulé soit collé dans le pied avec la question. */
function reposerLaQuestion(deux = false) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  const donnees = { cahierDesCharges: { faites: 3, total: 20, phase: 'interfaces', restants: ['Paiement'], majA: t } };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description, agent_id)
     VALUES (?, ?, 'planned', 1, 'Cahier avec question', ?, ?, ?, 'Carte posée par un contrôle automatique.', ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, agent_id = excluded.agent_id`,
  ).run(AVEC_QUESTION, PROJET, JSON.stringify(donnees), t, t, AGENT);
  const fiche = { id: AGENT, projectId: PROJET, cardId: AVEC_QUESTION, role: 'cadrage', title: 'Cahier avec question', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'running', startedAt: t, tourVivantDepuis: t, createdAt: t, updatedAt: t };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`,
  ).run(AGENT, PROJET, AVEC_QUESTION, 'cadrage', 'running', JSON.stringify(fiche), t, t);
  db.prepare('DELETE FROM messages WHERE agent_id = ?').run(AGENT);
  const message = (role, content, questions, at) => {
    const m = { id: crypto.randomUUID(), agentId: AGENT, role, content, steps: [], todos: [], proposals: [], questions, downloads: [], attachments: [], streaming: false, createdAt: at };
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(m.id, AGENT, role, JSON.stringify(m), at);
  };
  message('user', 'Carte d’essai : ne rien exécuter.', [], t - 2000);
  message(
    'assistant',
    '',
    [
      {
        id: 'q-compacte',
        question: 'Quel moyen de paiement ?',
        description: 'Le choix décide des écrans de paiement à prévoir et des frais par transaction.',
        kind: 'multiple',
        options: [['a', 'Carte bancaire'], ['b', 'Virement'], ['c', 'Prélèvement'], ['d', 'Paiement mobile']].map(([id, label]) => ({ id, label, description: 'Une précision courte sur ce moyen.' })),
        allowFreeText: true,
        answerAttachments: [],
        cancelled: false,
      },
      ...(deux
        ? [
            {
              id: 'q-seconde',
              question: 'Quelle couleur pour les encadrés ?',
              description: 'Une seconde question empilée sous la première.',
              kind: 'single',
              options: ['h', 'i', 'j', 'k'].map((id) => ({ id, label: `Teinte ${id.toUpperCase()}`, description: 'Une précision qui prend de la place, pour que la seconde question déborde aussi.' })),
              allowFreeText: true,
              answerAttachments: [],
              cancelled: false,
            },
          ]
        : []),
    ],
    t - 1000,
  );
  db.close();
}

async function ouvrir(navigateur, largeur, hauteur) {
  const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  return { contexte, page, erreurs };
}
const attendre = async (page, condition, limite = 10000) => {
  const fin = Date.now() + limite;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await page.waitForTimeout(200);
  }
  return false;
};
const visibles = (page, selecteur) => page.locator(`${selecteur}:visible`).count();



async function ouvrirLaQuestion(navigateur, largeur, hauteur, sombre) {
  reposerLaQuestion();
  const o = await ouvrir(navigateur, largeur, hauteur);
  const { page } = o;
  await page.goto(`${BASE}/#projet/${PROJET}/tache/${AVEC_QUESTION}`, { waitUntil: 'domcontentloaded' });
  await attendre(page, async () => (await visibles(page, '[data-repondre-question]')) > 0, 30000);
  if ((await visibles(page, '[data-question-compacte] [data-repondre-question]')) > 0) {
    noter(`${largeur} : le bouton compact du téléphone garde « Répondre »`, (await page.locator('[data-question-compacte] [data-repondre-question]:visible').first().innerText()).trim() === 'Répondre');
    await page.locator('[data-question-compacte] [data-repondre-question]:visible').first().click();
    await attendre(page, async () => (await visibles(page, '[data-feuille-question] [data-actions-question]')) > 0, 12000);
    await page.waitForTimeout(500);
  }
  await page.evaluate((s) => document.documentElement.classList.toggle('dark', s), sombre);
  await page.waitForTimeout(300);
  return o;
}

const barre = (page) => page.locator('[data-actions-question]:visible').last();

async function rangee(page, nom) {
  const b = barre(page);
  const valider = b.locator('[data-repondre-question]').first();
  const plus = b.locator('[data-plus-de-choix]').first();
  const ordre = await b.evaluate((el) => [...el.querySelectorAll('button')].filter((x) => x.getBoundingClientRect().width > 0).map((x) => x.innerText.trim()));
  const [rv, rp] = [await valider.boundingBox(), await plus.boundingBox()];
  noter(`${nom} : « Valider » en premier, le second bouton juste après`, ordre[0] === 'Valider' && ordre.indexOf(await plus.innerText().then((s) => s.trim())) === 1, JSON.stringify(ordre));
  noter(`${nom} : même rangée, même hauteur`, !!rv && !!rp && Math.abs(rv.y - rp.y) <= 1 && Math.abs(rv.height - rp.height) <= 1, JSON.stringify({ rv, rp }));
  noter(`${nom} : aucune zone de choix ne porte plus le bouton`, (await page.locator('[data-zone-choix-question] [data-plus-de-choix]:visible').count()) === 0);
  const deborde = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  noter(`${nom} : rien ne déborde en largeur`, !deborde);
  return plus;
}

async function essai(navigateur, { largeur, hauteur, sombre }) {
  const nom = `${largeur} ${sombre ? 'sombre' : 'clair'}`;
  const { contexte, page, erreurs } = await ouvrirLaQuestion(navigateur, largeur, hauteur, sombre);
  try {
    /* Le BROUILLON de la question survit d'un essai à l'autre (même question) : on repart sans choix coché. */
    if ((await barre(page).locator('[data-plus-de-choix]').first().getAttribute('data-plus-de-choix')) === 'valider') {
      await page.locator('[data-option-question="b"]:visible').first().click();
      await page.waitForTimeout(300);
    }
    let plus = await rangee(page, `${nom}, rien de coché`);
    noter(`${nom} : sans choix coché, « Autres choix »`, (await plus.innerText()).trim() === 'Autres choix');
    await page.screenshot({ path: `${CAPTURES}/${largeur}-${sombre ? 'sombre' : 'clair'}-rien.png` });
    await page.locator('[data-option-question="b"]:visible').first().click();
    await page.waitForTimeout(300);
    plus = await rangee(page, `${nom}, un coché`);
    noter(`${nom} : un choix coché, « Valider et proposer plus »`, (await plus.innerText()).trim() === 'Valider et proposer plus');
    await page.screenshot({ path: `${CAPTURES}/${largeur}-${sombre ? 'sombre' : 'clair'}-coche.png` });
    noter(`${nom} : aucune erreur de page`, erreurs.length === 0, erreurs.join(' | '));
  } finally {
    await contexte.close();
  }
}

async function reponseEnvoyee(navigateur) {
  const { contexte, page } = await ouvrirLaQuestion(navigateur, 1440, 900, false);
  try {
    if ((await barre(page).locator('[data-plus-de-choix]').first().getAttribute('data-plus-de-choix')) === 'valider') {
      await page.locator('[data-option-question="b"]:visible').first().click();
      await page.waitForTimeout(300);
    }
    await page.locator('[data-option-question="a"]:visible').first().click();
    await page.locator('[data-option-question="c"]:visible').first().click();
    await page.waitForTimeout(200);
    await barre(page).locator('[data-plus-de-choix]').first().click();
    let reponse = null;
    await attendre(page, async () => {
      const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
      const lignes = db.prepare('SELECT data FROM messages WHERE agent_id = ?').all(AGENT);
      db.close();
      for (const l of lignes) for (const q of JSON.parse(l.data).questions ?? []) if (q.answer) reponse = q.answer;
      return !!reponse;
    }, 15000);
    noter('la réponse part et commence par les choix cochés, au format habituel', /^Carte bancaire, Prélèvement — Je retiens ces choix\./.test(reponse ?? ''), reponse ?? 'aucune réponse');
  } finally {
    await contexte.close();
  }
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const [largeur, hauteur] of [[1440, 900], [390, 844]]) for (const sombre of [false, true]) await essai(navigateur, { largeur, hauteur, sombre });
    await reponseEnvoyee(navigateur);
  } finally {
    await navigateur.close();
  }
}

main()
  .catch((err) => {
    console.error(err);
    resultats.push({ nom: 'exécution', ok: false });
  })
  .finally(() => {
    nettoyer();
    const echecs = resultats.filter((r) => !r.ok).length;
    console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles réussis. Captures : ${CAPTURES}`);
    process.exit(echecs ? 1 : 0);
  });
