#!/usr/bin/env node
/**
 * SUR TÉLÉPHONE, DEUX BOUTONS VOISINS ONT LA MÊME HAUTEUR, ET AUCUN LIBELLÉ NE
 * SORT DE SON BOUTON — l'agrandissement de 20 % des boutons sous 640 px avait
 * laissé « Annuler » à 36 px collé à des réglages de 43 px (capture du
 * 25.10.2026). Sur ordinateur, les hauteurs d'avant (36 px) restent.
 *
 *   npm run build && env -u BELUGA_TOKEN node scripts/verif-hauteurs-telephone.mjs
 *
 * Démon d'essai à soi (base neuve, plafond d'agents à zéro, aucun moteur
 * appelé). Jamais `BELUGA_URL`. À 360, 390 et 430 px puis à 1280 px :
 *   1. tableau du projet : le titre d'une vignette mesure 15 px sur téléphone,
 *      14,5 px sur ordinateur ;
 *   2. carte en cadrage, agent au travail arrêté sur sa question (la capture) :
 *      « Annuler », ses réglages collés, « Auto » et l'horloge ont la même
 *      hauteur — 43 px sur téléphone, 36 px sur ordinateur — et la rangée ne
 *      déborde pas de l'écran ;
 *   3. carte à valider, carte prête à lancer, carte « À déployer » : même règle ;
 *   4. sur chaque écran, TOUTE paire de boutons collés (jour ≤ 2 px, même
 *      ligne) a la même hauteur (écart ≤ 1 px), et aucun libellé non replié
 *      (`truncate`) ne dépasse de son bouton.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_HAUTEURS_PORT || 7243);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-hauteurs-telephone-',
  port: PORT,
  messageCommit: 'hauteurs',
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const EN_CADRAGE = 'c-en-cadrage';
const AGENT_CADRAGE = 'a-en-cadrage';

function insererCarte(db, id, colonne, titre, enPlus = {}, agent = { role: 'task', status: 'done' }) {
  const maintenant = Date.now();
  const agentId = `a-${id}`;
  const carte = {
    id, projectId: PROJET_ID, agentId, title: titre, description: 'Carte du contrôle.', labels: [],
    column: colonne, position: 1, origin: 'user',
    run: { engine: 'claude', model: 'claude-sonnet-5-5', thinking: 'high', mode: 'direct' },
    scheduling: { asap: false, attempts: 0, restarts: 0 },
    excludedFromDeploy: false, horsTache: false, createdAt: maintenant, updatedAt: maintenant, ...enPlus,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, PROJET_ID, colonne, 1, titre, JSON.stringify(carte), maintenant, maintenant);
  const fiche = {
    id: agentId, projectId: PROJET_ID, cardId: id, role: agent.role, title: titre,
    run: { engine: 'claude', model: 'claude-opus-5-5', thinking: 'high', mode: 'direct' },
    status: agent.status, createdAt: maintenant, updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(agentId, PROJET_ID, id, agent.role, agent.status, JSON.stringify(fiche), maintenant, maintenant);
  const demande = {
    id: `m-${id}`, agentId, role: 'user', content: 'Fais l’essai.', steps: [], todos: [], proposals: [],
    questions: [], downloads: [], attachments: [], createdAt: maintenant - 100,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    demande.id, agentId, 'user', JSON.stringify(demande), maintenant - 100,
  );
}

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton), maintenant, maintenant + 3600_000, 'vérification des hauteurs sur téléphone',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID, name: 'Essai hauteurs', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1,
    archived: false, createdAt: maintenant, updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

  const comprehension = {
    texte: 'Compris.', hypotheses: [], sujets: [],
    resumeDemande: 'Vous demandez un essai.', resumeComprehension: 'Je comprends qu’il faut un essai.', at: maintenant - 10,
  };
  insererCarte(db, 'c-a-valider', 'planned', 'Essai à valider avant le lancement', { parcours: { comprehension } }, { role: 'cadrage', status: 'idle' });
  insererCarte(db, 'c-prete', 'planned', 'Essai prêt à lancer', {
    parcours: { comprehension, comprehensionValidee: { at: maintenant - 5, version: 0 } },
  });
  insererCarte(db, 'c-a-deployer', 'to_deploy', 'Essai à déployer avec un titre assez long pour tenir sur deux lignes');
  db.close();
}

/* La carte de la capture : un agent de cadrage AU TRAVAIL, arrêté sur sa
   question. Reposée juste avant sa mesure : la veille des tours bloqués la
   refermerait sinon. */
function reposerLeCadrage() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  const carte = {
    id: EN_CADRAGE, projectId: PROJET_ID, agentId: AGENT_CADRAGE, title: 'Essai en cadrage', description: 'Carte du contrôle.',
    labels: [], column: 'planned', position: 2, origin: 'user',
    run: { engine: 'claude', model: 'claude-opus-5-5', thinking: 'high', mode: 'direct' },
    scheduling: { asap: false, attempts: 0, restarts: 0 }, excludedFromDeploy: false, horsTache: false, createdAt: t, updatedAt: t,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, agent_id)
     VALUES (?, ?, 'planned', 2, 'Essai en cadrage', ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, agent_id = excluded.agent_id`,
  ).run(EN_CADRAGE, PROJET_ID, JSON.stringify(carte), t, t, AGENT_CADRAGE);
  const fiche = {
    id: AGENT_CADRAGE, projectId: PROJET_ID, cardId: EN_CADRAGE, role: 'cadrage', title: 'Essai en cadrage',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'running', startedAt: t, tourVivantDepuis: t,
    createdAt: t, updatedAt: t,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`,
  ).run(AGENT_CADRAGE, PROJET_ID, EN_CADRAGE, 'cadrage', 'running', JSON.stringify(fiche), t, t);
  db.prepare('DELETE FROM messages WHERE agent_id = ?').run(AGENT_CADRAGE);
  const message = (role, content, questions, at) => {
    const m = { id: crypto.randomUUID(), agentId: AGENT_CADRAGE, role, content, steps: [], todos: [], proposals: [], questions, downloads: [], attachments: [], streaming: false, createdAt: at };
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(m.id, AGENT_CADRAGE, role, JSON.stringify(m), at);
  };
  message('user', 'Carte d’essai : ne rien exécuter.', [], t - 2000);
  message('assistant', '', [{
    id: 'q-hauteurs', question: 'Quelles nouvelles annonces doivent vous envoyer une notification ?',
    description: 'Le choix décide du nombre de notifications.', kind: 'single',
    options: [{ id: 'a', label: 'Toutes' }, { id: 'b', label: 'Les meilleures' }],
    allowFreeText: true, answerAttachments: [], cancelled: false,
  }], t - 1000);
  db.close();
}

async function ouvrir(page, ancre) {
  await page.goto(`${BASE}/#${ancre}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
}

/** Toutes les paires de boutons collés, et tous les libellés qui débordent. */
const balayer = (page) =>
  page.evaluate(() => {
    const visibles = [...document.querySelectorAll('button, a[role="button"], [role="switch"]')].filter((b) => {
      const r = b.getBoundingClientRect();
      const s = getComputedStyle(b);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && r.bottom > 0 && r.top < window.innerHeight;
    });
    const nom = (b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30);
    const ecarts = [];
    for (const a of visibles) {
      const ra = a.getBoundingClientRect();
      for (const b of visibles) {
        if (a === b || a.contains(b) || b.contains(a)) continue;
        const rb = b.getBoundingClientRect();
        const jour = rb.left - ra.right;
        const chevauchement = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (jour < -0.5 || jour > 2 || chevauchement < Math.min(ra.height, rb.height) * 0.5) continue;
        /* COLLÉS, c'est un coin droit du côté du voisin (`rounded-r-none` /
           `rounded-l-none`) : deux liens d'un fil d'Ariane ne se jugent pas. */
        const droitA = parseFloat(getComputedStyle(a).borderTopRightRadius) === 0;
        const gaucheB = parseFloat(getComputedStyle(b).borderTopLeftRadius) === 0;
        if (!droitA && !gaucheB) continue;
        if (Math.abs(ra.height - rb.height) > 1) {
          ecarts.push(`${nom(a)} ${Math.round(ra.height)} px | ${nom(b)} ${Math.round(rb.height)} px`);
        }
      }
    }
    const debords = [];
    for (const b of visibles) {
      const rb = b.getBoundingClientRect();
      for (const el of b.querySelectorAll('span, svg')) {
        if (el.closest('.truncate, .line-clamp-1, .line-clamp-2, .sr-only, [aria-hidden="true"] span')) continue;
        const s = getComputedStyle(el);
        if (s.position === 'absolute' || s.position === 'fixed' || s.display === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.right > rb.right + 1 || r.left < rb.left - 1) debords.push(`${nom(b)} : « ${(el.textContent || el.tagName).trim().slice(0, 20)} »`);
      }
    }
    return {
      ecarts: [...new Set(ecarts)],
      debords: [...new Set(debords)],
      debordePage: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });

/** La rangée d'action : les hauteurs de chacun de ses boutons. */
const lireRangee = (page) =>
  page.evaluate(() => {
    const barre = document.querySelector('[data-barre-action]');
    if (!barre) return null;
    const boutons = [...barre.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0);
    const r = barre.getBoundingClientRect();
    return {
      hauteurs: boutons.map((b) => Math.round(b.getBoundingClientRect().height * 10) / 10),
      libelles: boutons.map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 20)),
      droite: r.right,
      largeurEcran: window.innerWidth,
    };
  });

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  await new Promise((r) => setTimeout(r, 1500));
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));

  for (const largeur of [360, 390, 430, 1280]) {
    const telephone = largeur < 640;
    const ecran = `${largeur} px`;
    const attendue = telephone ? 43 : 36;
    await page.setViewportSize({ width: largeur, height: telephone ? 844 : 900 });

    /* 1. Le tableau et ses titres de vignettes. */
    await ouvrir(page, `projet/${PROJET_ID}`);
    const titre = await page.evaluate(() => {
      const h = document.querySelector('h3[data-carte-texte]');
      return h ? getComputedStyle(h).fontSize : null;
    });
    noter(`${ecran} — tableau : le titre d’une vignette mesure ${telephone ? '15' : '14.5'} px`, titre === (telephone ? '15px' : '14.5px'), String(titre));
    const tableau = await balayer(page);
    noter(`${ecran} — tableau : boutons collés à la même hauteur`, tableau.ecarts.length === 0, tableau.ecarts.join(' ; '));
    noter(`${ecran} — tableau : aucun libellé hors de son bouton`, tableau.debords.length === 0, tableau.debords.join(' ; '));

    /* 2 et 3. Les rangées d'action. */
    for (const [carte, nom] of [
      [EN_CADRAGE, 'en cadrage, question en attente (« Annuler » + Auto)'],
      ['c-a-valider', 'à valider (« Valider et lancer » + Auto)'],
      ['c-prete', 'prête à lancer'],
      ['c-a-deployer', '« À déployer »'],
    ]) {
      if (carte === EN_CADRAGE) reposerLeCadrage();
      await ouvrir(page, `projet/${PROJET_ID}/tache/${carte}`);
      if (carte === EN_CADRAGE) {
        await page.waitForSelector('[data-barre-action="arreter"]', { timeout: 10000 }).catch(() => {});
      }
      const r = await lireRangee(page);
      const memes = !!r && r.hauteurs.length > 0 && r.hauteurs.every((h) => Math.abs(h - attendue) <= 1);
      noter(
        `${ecran} — carte ${nom} : tous les boutons de la rangée à ${attendue} px`,
        /* « Annuler » ne vit que le temps où la veille laisse le tour ouvert :
           la carte retombe ensuite sur « Lancer et valider », même bouton, même
           hauteur. Les deux libellés comptent. */
        memes && (carte === 'c-prete' || carte === 'c-a-deployer'),
        JSON.stringify(r && { hauteurs: r.hauteurs, libelles: r.libelles }),
      );
      noter(`${ecran} — carte ${nom} : la rangée tient dans l’écran`, !!r && r.droite <= r.largeurEcran + 1, r ? `${Math.round(r.droite)} / ${r.largeurEcran}` : 'absente');
      const b = await balayer(page);
      noter(`${ecran} — carte ${nom} : boutons collés à la même hauteur`, b.ecarts.length === 0, b.ecarts.join(' ; '));
      noter(`${ecran} — carte ${nom} : aucun libellé hors de son bouton`, b.debords.length === 0, b.debords.join(' ; '));
      noter(`${ecran} — carte ${nom} : la page ne déborde pas en largeur`, !b.debordePage);
      if (process.env.CAPTURES_HAUTEURS && carte === EN_CADRAGE) {
        await page.screenshot({ path: path.join(process.env.CAPTURES_HAUTEURS, `cadrage-${largeur}.png`) });
      }
    }
  }

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await navigateur.close();
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  console.error(journal.join(''));
  process.exit(1);
});
