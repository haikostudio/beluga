#!/usr/bin/env node
/**
 * LA VALIDATION D'UN GESTE IMPORTANT, DANS UN VRAI NAVIGATEUR (26/11/2026, capture #6b90 : l'agent laissait
 * « deux clics sur “Enregistrer” » à l'utilisateur).
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-validation-de-geste.mjs
 *
 * Sur son PROPRE démon (port `HAIKO_VALIDATION_GESTE_PORT`), un agent arrêté sur une question `validation` :
 *   1. la bulle est l'encart de validation (`[data-validation-de-geste]`) : la phrase du geste, la CAPTURE de la
 *      donnée en grand, « Valider » puis « Refuser » — ni champ de saisie, ni « Joindre » ;
 *   2. à 1440 et 390 px, en clair et en sombre : captures, rien ne déborde, la capture tient dans l'encart ;
 *   3. un clic sur la capture l'ouvre en grand ;
 *   4. « Valider » répond « Valider » à l'agent ;
 *   5. sur l'écran réel de la demande — la CONVERSATION D'UN AGENT DE SERVICE (onglet « Agents ») — la même bulle
 *      paraît, « Valider » répond, et la question répondue garde sa capture dans le fil.
 */
import { chromium } from 'playwright';
import WebSocket from 'ws';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKO_VALIDATION_GESTE_PORT || 7263);
const BASE = `http://127.0.0.1:${PORT}`;
const PROJET = 'p-validation-geste';
const CARTE = crypto.randomUUID();
const AGENT = crypto.randomUUID();
const CAPTURE = 'piece-capture-profil';
const CAPTURES = path.join(RACINE, 'data/verification/validation-de-geste');
fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
console.log(`  …  dépôt jugé : ${RACINE}`);

/* UN FAUX MOTEUR : « Valider » relance l'agent (son tour d'essai n'existe pas) — jamais un vrai moteur, qui
   travaillerait et dépenserait du quota dans le dossier jetable. Celui-ci répond « fait » et s'arrête. */
const FAUX = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'faux-moteur-geste-')), 'faux-moteur.mjs');
fs.writeFileSync(
  FAUX,
  `#!/usr/bin/env node
if (process.argv.includes('--version')) { process.stdout.write('faux-moteur 0.0.0 (essai)\\n'); process.exit(0); }
process.stdin.resume();
const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
setTimeout(() => {
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Fait : coordonnées enregistrées.' }] } });
  dire({ type: 'result', subtype: 'success', session_id: 'session-essai', usage: { input_tokens: 1, output_tokens: 1 } });
  process.exit(0);
}, 300);
`,
);
fs.chmodSync(FAUX, 0o755);
const { DATA, PROJETS, attendrePort, journal, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-validation-geste-',
  port: PORT,
  depot: false,
  signaux: true,
  env: { BELUGA_CLAUDE_BIN: FAUX, BELUGA_CODEX_BIN: FAUX, BELUGA_CURSOR_BIN: FAUX },
});
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');

/** La « capture » d'un formulaire de profil, photographiée dans le navigateur : la donnée telle qu'elle partira. */
async function fabriquerLaCapture(navigateur) {
  const page = await navigateur.newPage({ viewport: { width: 900, height: 520 } });
  await page.setContent(`<!doctype html><html><body style="margin:0;font-family:system-ui;background:#f3f2ef">
    <div style="margin:32px auto;width:760px;background:#fff;border-radius:10px;padding:28px 32px;box-shadow:0 1px 3px #0002">
      <h2 style="margin:0 0 18px;font-size:22px;color:#111">Modifier les coordonnées</h2>
      <label style="font-size:13px;color:#555">Adresse</label>
      <div style="margin:6px 0 16px;border:1px solid #888;border-radius:6px;padding:10px 12px;font-size:16px">Rue du Simplon 12, 1006 Lausanne, Suisse</div>
      <label style="font-size:13px;color:#555">Lieu de travail</label>
      <div style="margin:6px 0 24px;border:1px solid #888;border-radius:6px;padding:10px 12px;font-size:16px">Haiko Studio — Lausanne</div>
      <div style="text-align:right"><span style="background:#0a66c2;color:#fff;border-radius:20px;padding:9px 20px;font-weight:600">Enregistrer</span></div>
    </div></body></html>`);
  const tampon = await page.screenshot();
  await page.close();
  return tampon;
}

function poserLeDecor(png) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(JETON), t, t + 3600_000, 'vérification de la validation d’un geste');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  const dossier = path.join(PROJETS, PROJET);
  fs.mkdirSync(path.join(dossier, 'docs'), { recursive: true });
  const projet = { id: PROJET, name: 'Atelier Validation', path: dossier, defaultEngine: 'claude', isSelf: false, branchesDePublication: {}, rank: 1000, archived: false, createdAt: t, updatedAt: t };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(PROJET, projet.name, dossier, JSON.stringify(projet), t, t);
  const fichier = path.join(DATA, 'attachments', `${CAPTURE}-capture-profil.png`);
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, png);
  const piece = { id: CAPTURE, projectId: PROJET, name: 'capture-profil.png', mime: 'image/png', size: png.length, sha: CAPTURE, createdAt: t };
  db.prepare('INSERT INTO attachments (id, project_id, sha, data, created_at) VALUES (?, ?, ?, ?, ?)').run(CAPTURE, PROJET, CAPTURE, JSON.stringify(piece), t);
  db.close();
}

/* Un agent arrêté sur sa validation, reposé avant chaque mesure (la veille des tours bloqués le refermerait sinon). */
function reposerLaQuestion() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description, agent_id)
     VALUES (?, ?, 'running', 1, 'Coordonnées du profil', '{}', ?, ?, 'Carte posée par un contrôle automatique.', ?)
     ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, agent_id = excluded.agent_id`,
  ).run(CARTE, PROJET, t, t, AGENT);
  const fiche = { id: AGENT, projectId: PROJET, cardId: CARTE, role: 'task', title: 'Coordonnées du profil', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'running', startedAt: t, tourVivantDepuis: t, createdAt: t, updatedAt: t };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`,
  ).run(AGENT, PROJET, CARTE, 'task', 'running', JSON.stringify(fiche), t, t);
  db.prepare('DELETE FROM messages WHERE agent_id = ?').run(AGENT);
  const message = (role, content, questions, at) => {
    const m = { id: crypto.randomUUID(), agentId: AGENT, role, content, steps: [], todos: [], proposals: [], questions, downloads: [], attachments: [], streaming: false, createdAt: at };
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(m.id, AGENT, role, JSON.stringify(m), at);
  };
  message('user', 'Mets à jour mon adresse et mon lieu de travail sur mon profil.', [], t - 2000);
  message(
    'assistant',
    'Les deux champs sont remplis. Voici la fiche telle qu’elle partira.',
    [
      {
        id: 'q-validation',
        question: 'J’enregistre ces coordonnées sur votre profil ?',
        kind: 'single',
        options: [
          { id: 'o0', label: 'Valider', description: 'L’agent fait ce geste lui-même, maintenant.' },
          { id: 'o1', label: 'Refuser', description: 'Rien ne part.' },
        ],
        allowFreeText: false,
        answerAttachments: [],
        cancelled: false,
        validation: { geste: 'Cliquer « Enregistrer » dans l’onglet du profil : l’adresse et le lieu de travail deviennent visibles du public.', captures: [CAPTURE] },
      },
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
  await page.goto(`${BASE}/#projet/${PROJET}/tache/${CARTE}`, { waitUntil: 'domcontentloaded' });
  await attendre(page, async () => (await visibles(page, '[data-validation-de-geste]')) > 0, 30000);
  await page.evaluate((s) => document.documentElement.classList.toggle('dark', s), sombre);
  await attendre(page, async () => page.evaluate(() => [...document.querySelectorAll('[data-validation-capture] img')].some((i) => i.complete && i.naturalWidth > 0)), 10000);
  await page.waitForTimeout(400);
  return o;
}

const encart = (page) => page.locator('[data-validation-de-geste]:visible').last();

async function essai(navigateur, { largeur, hauteur, sombre }) {
  const nom = `${largeur} ${sombre ? 'sombre' : 'clair'}`;
  const { contexte, page, erreurs } = await ouvrirLaQuestion(navigateur, largeur, hauteur, sombre);
  try {
    const e = encart(page);
    noter(`${nom} : l’encart de validation est là`, (await e.count()) > 0);
    noter(`${nom} : la phrase du geste se lit`, /Enregistrer/.test(await e.locator('[data-validation-geste]').innerText()));
    const img = e.locator('[data-validation-capture] img').first();
    const [boiteEncart, boiteImage] = [await e.boundingBox(), await img.boundingBox()];
    noter(`${nom} : la capture se voit, en grand, dans l’encart`, !!boiteImage && boiteImage.height > 120 && !!boiteEncart && boiteImage.x >= boiteEncart.x - 1 && boiteImage.x + boiteImage.width <= boiteEncart.x + boiteEncart.width + 1, JSON.stringify({ boiteEncart, boiteImage }));
    const boutons = await e.evaluate((el) => [...el.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0 && !b.hasAttribute('data-validation-capture')).map((b) => b.innerText.trim()));
    noter(`${nom} : « Valider » puis « Refuser », rien d’autre`, JSON.stringify(boutons) === JSON.stringify(['Valider', 'Refuser']), JSON.stringify(boutons));
    noter(`${nom} : ni champ de saisie ni « Joindre »`, (await e.locator('textarea, input').count()) === 0);
    const deborde = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    noter(`${nom} : rien ne déborde en largeur`, !deborde);
    await e.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${CAPTURES}/${largeur}-${sombre ? 'sombre' : 'clair'}.png` });
    if (largeur === 1440 && !sombre) {
      await e.locator('[data-validation-capture]').first().click();
      noter(`${nom} : un clic ouvre la capture en grand`, await attendre(page, async () => (await page.locator('[role="dialog"] img:visible').count()) > 0, 6000));
      await page.screenshot({ path: `${CAPTURES}/${largeur}-capture-en-grand.png` });
      await page.keyboard.press('Escape');
    }
    noter(`${nom} : aucune erreur de page`, erreurs.length === 0, erreurs.join(' | '));
  } finally {
    await contexte.close();
  }
}

async function valider(navigateur) {
  const { contexte, page } = await ouvrirLaQuestion(navigateur, 1440, 900, false);
  try {
    await encart(page).locator('[data-valider-avec-cout]').click();
    let reponse = null;
    await attendre(page, async () => {
      const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
      const lignes = db.prepare('SELECT data FROM messages WHERE agent_id = ?').all(AGENT);
      db.close();
      for (const l of lignes) for (const q of JSON.parse(l.data).questions ?? []) if (q.answer) reponse = q.answer;
      return !!reponse;
    }, 15000);
    noter('« Valider » répond « Valider » à l’agent', reponse === 'Valider', reponse ?? 'aucune réponse');
  } finally {
    await contexte.close();
  }
}

/** Une commande envoyée au démon par la vraie liaison, et sa réponse. */
function appelDemon(commande) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie: `beluga_session=${JETON}` } });
    const id = crypto.randomUUID();
    const minuteur = setTimeout(() => {
      socket.close();
      reject(new Error('le démon ne répond pas'));
    }, 20000);
    socket.on('open', () => socket.send(JSON.stringify({ id, cmd: commande })));
    socket.on('message', (brut) => {
      const trame = JSON.parse(String(brut));
      if (trame.id !== id) return;
      clearTimeout(minuteur);
      socket.close();
      resolve(trame);
    });
    socket.on('error', (souci) => {
      clearTimeout(minuteur);
      reject(souci);
    });
  });
}

/** La conversation d'un agent personnalisé (l'écran de la capture #6b90), arrêtée sur une validation. */
async function conversationDeLAgent(navigateur) {
  const trame = await appelDemon({ type: 'agentsPerso.creer', projectId: PROJET });
  const perso = trame.result?.agent ?? trame.data?.agent ?? trame.agent;
  noter('un agent de service est créé dans le projet d’essai', !!perso?.agentId, JSON.stringify(trame).slice(0, 200));
  if (!perso?.agentId) return;
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  const m = {
    id: crypto.randomUUID(),
    agentId: perso.agentId,
    role: 'assistant',
    content: 'Les deux champs sont remplis dans l’onglet du profil.',
    steps: [],
    todos: [],
    proposals: [],
    downloads: [],
    attachments: [],
    streaming: false,
    createdAt: t,
    questions: [
      {
        id: 'q-validation-agent',
        question: 'J’enregistre ces coordonnées sur votre profil ?',
        kind: 'single',
        options: [
          { id: 'o0', label: 'Valider', description: 'L’agent fait ce geste lui-même, maintenant.' },
          { id: 'o1', label: 'Refuser', description: 'Rien ne part.' },
        ],
        allowFreeText: false,
        answerAttachments: [],
        cancelled: false,
        validation: { geste: 'Cliquer « Enregistrer » dans l’onglet du profil.', captures: [CAPTURE] },
      },
    ],
  };
  /* UN ÉCHANGE PASSÉ, déjà validé : l'étape « Question posée » telle que le moteur l'écrit (outil, paramètres de
     l'appel, réponse). Le fil la raconte par l'encadré commun des questions, captures comprises. */
  const params = { question: 'Je publie le message de bienvenue sur la page ?', validation: { geste: 'Cliquer « Publier » sur la page.', captures: [CAPTURE] } };
  const passe = {
    ...m,
    id: crypto.randomUUID(),
    content: 'Fait : message de bienvenue publié.',
    questions: [],
    createdAt: t - 120_000,
    steps: [
      {
        id: crypto.randomUUID(),
        label: 'Question posée',
        state: 'done',
        outil: 'mcp__beluga__ask_user',
        entree: JSON.stringify(params),
        detail: 'Réponse de l’utilisateur : Valider\nReprends ton travail à partir de cette réponse.',
        startedAt: t - 125_000,
        endedAt: t - 121_000,
      },
    ],
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(passe.id, perso.agentId, 'assistant', JSON.stringify(passe), passe.createdAt);
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(m.id, perso.agentId, 'assistant', JSON.stringify(m), t);
  db.close();
  /* Le téléphone d’abord : la validation y est encore en attente ; l’ordinateur répond ensuite. */
  for (const [largeur, hauteur, sombre] of [[390, 844, true], [1440, 900, false]]) {
    const { contexte, page, erreurs } = await ouvrir(navigateur, largeur, hauteur);
    try {
      await page.goto(`${BASE}/#projet/${PROJET}/agents/${perso.id}`, { waitUntil: 'domcontentloaded' });
      let vue = await attendre(page, async () => (await visibles(page, '[data-validation-de-geste]')) > 0, 20000);
      if (!vue) {
        /* Au premier chargement, l'accueil peut devancer l'adresse : on la redonne. */
        await page.goto('about:blank');
        await page.goto(`${BASE}/#projet/${PROJET}/agents/${perso.id}`, { waitUntil: 'load' });
        vue = await attendre(page, async () => (await visibles(page, '[data-validation-de-geste]')) > 0, 20000);
      }
      await page.evaluate((s) => document.documentElement.classList.toggle('dark', s), sombre);
      await page.waitForTimeout(800);
      noter(`agent de service ${largeur} : la validation paraît dans sa conversation`, vue);
      await page.screenshot({ path: `${CAPTURES}/agent-${largeur}-${sombre ? 'sombre' : 'clair'}.png` });
      noter(`agent de service ${largeur} : rien ne déborde`, !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
      if (largeur === 1440) {
        /* L'échange passé : son encadré garde la capture validée, et « Valider » s'y lit comme le choix retenu. */
        const deplie = page.locator('[data-encadre-question-captures] img').first();
        if (!(await deplie.count())) {
          const ouvrirEtape = page.getByText('Question posée', { exact: false }).first();
          if (await ouvrirEtape.count()) await ouvrirEtape.click().catch(() => {});
          await page.waitForTimeout(500);
        }
        const capturePassee = await attendre(page, async () => (await page.locator('[data-encadre-question-captures] img').count()) > 0, 6000);
        noter('agent de service : une validation passée garde sa capture dans le fil', capturePassee);
        const retenue = (await page.locator('[data-encadre-question-option="retenue"]').allInnerTexts()).join(' | ');
        noter('agent de service : « Valider » s’y lit comme le choix retenu', /Valider/.test(retenue), retenue);
        if (capturePassee) {
          await page.locator('[data-encadre-question-captures]').first().scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${CAPTURES}/agent-1440-validation-passee.png` });
        }
        await encart(page).scrollIntoViewIfNeeded();
        await encart(page).locator('[data-valider-avec-cout]').click();
        let reponse = null;
        await attendre(page, async () => {
          const lecture = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
          const ligne = lecture.prepare('SELECT data FROM messages WHERE id = ?').get(m.id);
          lecture.close();
          reponse = JSON.parse(ligne?.data ?? '{}').questions?.[0]?.answer ?? null;
          return !!reponse;
        }, 15000);
        noter('agent de service : « Valider » répond « Valider »', reponse === 'Valider', reponse ?? 'aucune réponse');
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${CAPTURES}/agent-1440-apres-validation.png` });
      }
      noter(`agent de service ${largeur} : aucune erreur de page`, erreurs.length === 0, erreurs.join(' | '));
    } finally {
      await contexte.close();
    }
  }
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    poserLeDecor(await fabriquerLaCapture(navigateur));
    for (const [largeur, hauteur] of [[1440, 900], [390, 844]]) for (const sombre of [false, true]) await essai(navigateur, { largeur, hauteur, sombre });
    await valider(navigateur);
    await conversationDeLAgent(navigateur);
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
