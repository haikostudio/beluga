#!/usr/bin/env node
/**
 * Le contexte réellement envoyé reste-t-il consultable sous la demande ?
 * Le tiroir montre deux parties, en tokens : ce qui vient de la mémoire du
 * projet, et ce qui a été réellement envoyé au moteur. Plus d'historique des
 * tours passés, plus de pavé « estimé / réellement mesuré » par couche.
 * Démon et base d'essai à soi, aucun moteur appelé, téléphone + ordinateur.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKO_CONTEXTE_ENVOYE_PORT || 7198);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-contexte-envoye-'));
const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
const SHOTS = path.join(RACINE, 'data', 'verification');
for (const dossier of [DATA, PROJETS, DEPOT, SHOTS]) fs.mkdirSync(dossier, { recursive: true });

execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
  cwd: DEPOT,
});

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    HAIKODEV_PORT: String(PORT),
    HAIKODEV_HOST: '127.0.0.1',
    HAIKODEV_DATA: DATA,
    HAIKODEV_PROJECTS_ROOT: PROJETS,
    HAIKODEV_WEB: path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const journal = [];
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));

process.on('exit', () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function attendrePort() {
  const fin = Date.now() + 60_000;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-contexte-envoye';
const AGENT_ID = 'a-contexte-envoye';
/* Une carte dont l'agent de tâche a reçu l'index de mémoire ENTIER au premier
   tour : c'est le seul cas où le bloc « mémoire » pèse lourd, et où le tiroir
   nested (dans le panneau de carte) doit rendre les mêmes deux parties. */
const CARTE_ID = 'c-contexte-envoye';
const AGENT_TACHE = 'a-contexte-tache';
const TITRE_CARTE = 'Essai — mémoire et envoi';
const PROMPT = [
  'DEMANDE : vérifier le contexte exact.',
  ...Array.from({ length: 90 }, (_, i) => `Bloc de contexte ${i + 1} — contenu assez long pour imposer le défilement du tiroir.`),
].join('\n');

/* 3 200 signes de mémoire ≈ 800 tokens (estimation maison, 4 signes/jeton). */
const MEMOIRE_SUIVI = 'x'.repeat(3_200);
/* 8 000 signes de briefing + index complet ≈ 2 000 tokens. */
const MEMOIRE_OUVERTURE = 'y'.repeat(8_000);

function poserDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const t = Date.now() - 60_000;
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3_600_000,
    'vérification contexte envoyé',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: 'Essai contexte envoyé',
    path: DEPOT,
    defaultEngine: 'codex',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), t, t);

  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    role: 'orchestrator',
    title: 'Chef d’orchestre — contexte envoyé',
    run: { engine: 'codex', model: 'gpt-5.4', thinking: 'medium', mode: 'direct' },
    status: 'done',
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, 'orchestrator', 'done', ?, ?, ?)`,
  ).run(AGENT_ID, PROJET_ID, JSON.stringify(agent), t, t);

  const message = (id, data, quand) =>
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      AGENT_ID,
      'user',
      JSON.stringify({ id, agentId: AGENT_ID, role: 'user', content: data.content, createdAt: quand, ...data }),
      quand,
    );

  message(
    'm-envoye',
    {
      content: 'Montre-moi le contexte réellement envoyé.',
      tokens: 1_234,
      sentContext: {
        engine: 'codex',
        model: 'gpt-5.4',
        session: 'resumed',
        prompt: PROMPT,
        systemInstruction: {
          kind: 'reminder',
          content: 'RAPPEL DE MÉTHODE : lis, constate et vérifie.',
          transport: 'prefixed',
        },
        blocks: [
          { kind: 'request', label: 'Demande utilisateur', characters: 42 },
          { kind: 'memory', label: 'Nouveaux faits de la mémoire', characters: MEMOIRE_SUIVI.length },
          { kind: 'card', label: 'Carte en cours', characters: 820 },
          { kind: 'format', label: 'Gabarit et séparateurs HaikoDev', characters: 372 },
          { kind: 'system', label: 'Rappel de méthode', characters: 46 },
        ],
        history: 'retained_by_engine',
        usage: { inputTokens: 1_000, cachedInputTokens: 234 },
        sentAt: t,
      },
    },
    t,
  );
  message('m-file', { content: 'Cette demande est encore en file.' }, t + 1000);

  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    title: TITRE_CARTE,
    description: 'Carte d’essai posée par le script de vérification.',
    labels: [],
    column: 'done',
    position: 0,
    origin: 'agent',
    attachments: [],
    run: { engine: 'claude', model: 'claude-sonnet-5', thinking: 'medium', mode: 'direct' },
    agentId: AGENT_TACHE,
    excludedFromDeploy: false,
    horsTache: false,
    codeDejaEnregistre: true,
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    'INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(CARTE_ID, PROJET_ID, 'done', 0, TITRE_CARTE, JSON.stringify(carte), t, t);

  const agentTache = {
    id: AGENT_TACHE,
    projectId: PROJET_ID,
    cardId: CARTE_ID,
    role: 'task',
    title: TITRE_CARTE,
    run: { engine: 'claude', model: 'claude-sonnet-5', thinking: 'medium', mode: 'direct' },
    status: 'done',
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, 'task', 'done', ?, ?, ?)`,
  ).run(AGENT_TACHE, PROJET_ID, CARTE_ID, JSON.stringify(agentTache), t, t);

  const idMessage = 'm-tache';
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    idMessage,
    AGENT_TACHE,
    'user',
    JSON.stringify({
      id: idMessage,
      agentId: AGENT_TACHE,
      role: 'user',
      content: 'Réalise cette tâche.',
      createdAt: t,
      tokens: 5_000,
      sentContext: {
        engine: 'claude',
        model: 'claude-sonnet-5',
        session: 'new',
        prompt: PROMPT,
        systemInstruction: { kind: 'full', content: 'MÉTHODE : lire, constater, vérifier.', transport: 'separate' },
        blocks: [
          { kind: 'request', label: 'Demande utilisateur', characters: 42 },
          { kind: 'briefing', label: 'Briefing du projet', characters: 500 },
          { kind: 'memory', label: 'Passages retrouvés dans la documentation (2)', characters: MEMOIRE_OUVERTURE.length },
        ],
        /* Ce que la RECHERCHE est allée chercher toute seule : source, titre,
           pertinence et coût. C'est ce qui rend le contexte remonté par la
           machine vérifiable à l'œil. */
        passages: [
          { source: 'docs/regles/cartes.md', titre: 'Cartes › Une carte NAÎT dans « Planifié »', score: 0.61, tokens: 320 },
          { source: 'docs/mecaniques/ajouter-une-colonne.md', titre: 'Ajouter une colonne', score: 0.44, tokens: 180 },
        ],
        history: 'none',
        usage: { inputTokens: 4_000, cachedInputTokens: 1_000 },
        sentAt: t,
      },
    }),
    t,
  );
  db.close();
}

function choisirTheme(theme) {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  db.prepare(
    `INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run('theme', JSON.stringify(theme), Date.now());
  db.close();
}

async function ouvrir(navigateur, telephone) {
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1400, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
    locale: 'fr-CH',
    serviceWorkers: 'block',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await contexte.addCookies([{ name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3500);
  const chef = page.getByRole('button', { name: /^Chef/ });
  if (await chef.count()) {
    await chef.first().click();
    await page.waitForTimeout(1200);
  }
  return { contexte, page, erreurs };
}

if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}
poserDecor();

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const cas of [
    { telephone: true, theme: 'dark', nom: 'téléphone sombre' },
    { telephone: false, theme: 'light', nom: 'ordinateur clair' },
  ]) {
    choisirTheme(cas.theme);
    const { contexte, page, erreurs } = await ouvrir(navigateur, cas.telephone);
    try {
      const boutons = page.locator('[data-contexte-envoye]:visible');
      noter(`${cas.nom} : seule la demande partie porte le bouton`, (await boutons.count()) === 1);
      noter(`${cas.nom} : la mesure moteur est affichée`, /1\D?234 tokens/.test(await boutons.first().innerText()));
      const suitReperes = await boutons.first().evaluate((el) => (el.previousElementSibling?.textContent ?? '').includes('Copier'));
      noter(`${cas.nom} : le bouton suit les repères du message`, suitReperes);

      await boutons.first().click();
      const tiroir = page.getByRole('dialog');
      await tiroir.waitFor({ state: 'visible' });
      noter(`${cas.nom} : le tiroir distingue la reprise`, (await tiroir.innerText()).includes('Reprise de session'));

      /*
       * LE DÉTAIL BRUT EST REPLIÉ : composition, consigne système et prompt
       * entier ne s'ouvrent que sur demande.
       */
      noter(
        `${cas.nom} : le détail brut est replié par défaut`,
        (await tiroir.locator('[data-detail-brut]').count()) === 0 &&
          (await tiroir.locator('[data-prompt-envoye]').count()) === 0,
      );

      /*
       * DEUX PARTIES, EN TOKENS : la mémoire (800 tokens, 3 200 signes / 4)
       * contre l'envoi réel (1 234 tokens, mesurés par le moteur).
       */
      const bloc = tiroir.locator('[data-memoire-vs-envoi]');
      noter(`${cas.nom} : le bloc mémoire / envoi est présent`, (await bloc.count()) === 1);
      const texteBloc = await bloc.innerText();
      noter(`${cas.nom} : la mémoire récupérée est en tokens`, /800 tokens/.test(texteBloc), texteBloc.replace(/\n/g, ' '));
      noter(`${cas.nom} : l’envoi réel est en tokens`, /1\D?234 tokens/.test(texteBloc), texteBloc.replace(/\n/g, ' '));
      noter(`${cas.nom} : la part de la mémoire dans l’envoi est dite`, /65 %/.test(texteBloc), texteBloc.replace(/\n/g, ' '));

      noter(
        `${cas.nom} : plus de pavé « estimé / réellement mesuré » par couche`,
        (await tiroir.locator('[data-tokens-estimes]').count()) === 0 &&
          (await tiroir.locator('[data-tokens-reels]').count()) === 0 &&
          (await tiroir.locator('[data-couche-tokens]').count()) === 0,
      );
      noter(
        `${cas.nom} : plus d’historique des tours passés`,
        (await tiroir.locator('[data-historique-tours]').count()) === 0 &&
          !(await tiroir.innerText()).includes('Tours de cet agent'),
      );

      await tiroir.locator('[data-voir-detail-brut]').click();
      await page.waitForTimeout(300);
      noter(`${cas.nom} : le prompt exact est visible une fois déplié`, (await tiroir.locator('[data-prompt-envoye]').innerText()) === PROMPT);

      await page.evaluate(() => {
        window.__contexteCopie = '';
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async (texte) => { window.__contexteCopie = texte; } },
        });
      });
      await tiroir.getByRole('button', { name: /Tout copier/ }).click();
      const copie = await page.evaluate(() => window.__contexteCopie);
      noter(`${cas.nom} : la copie contient le prompt exact`, copie.includes(PROMPT));

      const defile = await tiroir.locator('[data-contexte-envoye-contenu]').evaluate((zone) => {
        const avant = zone.scrollTop;
        zone.scrollTop = zone.scrollHeight;
        return zone.scrollHeight > zone.clientHeight && zone.scrollTop > avant;
      });
      noter(`${cas.nom} : le contenu du tiroir défile`, defile);
      noter(`${cas.nom} : aucune erreur de page`, erreurs.length === 0, erreurs[0] ?? '');
      await page.screenshot({ path: path.join(SHOTS, `contexte-envoye-${cas.telephone ? 'telephone' : 'ordinateur'}.png`) });
    } finally {
      await contexte.close();
    }
  }

  /*
   * DANS LE TIROIR D'UNE CARTE : la session neuve a reçu l'index de mémoire
   * ENTIER au premier tour (2 000 tokens, 8 000 signes / 4) — le même bloc
   * mémoire / envoi doit s'y afficher, imbriqué dans le panneau de carte.
   */
  choisirTheme('dark');
  {
    const { contexte, page, erreurs } = await ouvrir(navigateur, false);
    try {
      const carte = page.locator('article').filter({ hasText: TITRE_CARTE }).first();
      await carte.waitFor({ state: 'visible', timeout: 20_000 });
      await carte.click();
      await page.waitForTimeout(1500);
      const panneau = page.getByRole('dialog').last();
      await panneau.getByRole('tab', { name: 'Conversation' }).click();
      await page.waitForTimeout(1200);

      await panneau.locator('[data-contexte-envoye]').first().click();
      const tiroir = page.getByRole('dialog').last();
      const bloc = tiroir.locator('[data-memoire-vs-envoi]');
      await bloc.waitFor({ state: 'visible', timeout: 10_000 });

      const texteBloc = await bloc.innerText();
      noter('carte : la session neuve porte l’index entier de mémoire', /2\D?000 tokens/.test(texteBloc), texteBloc.replace(/\n/g, ' '));
      noter('carte : l’envoi réel de ce tour est dit', /5\D?000 tokens/.test(texteBloc), texteBloc.replace(/\n/g, ' '));
      noter('carte : la part de la mémoire dans l’envoi est dite', /40 %/.test(texteBloc), texteBloc.replace(/\n/g, ' '));

      /*
       * LES PASSAGES RETROUVÉS : source, titre, pertinence et coût. Un contexte
       * choisi par la machine doit rester lisible, sinon personne ne peut dire
       * pourquoi l'agent a lu ceci plutôt que cela.
       */
      const listePassages = tiroir.locator('[data-passages-retrouves]');
      noter('carte : le tiroir liste les passages retrouvés', (await listePassages.count()) === 1);
      const textePassages = (await listePassages.count()) ? await listePassages.innerText() : '';
      noter('carte : chaque passage dit son fichier', /docs\/regles\/cartes\.md/.test(textePassages) && /ajouter-une-colonne\.md/.test(textePassages), textePassages.replace(/\n/g, ' '));
      noter('carte : chaque passage dit sa pertinence', /61 %/.test(textePassages) && /44 %/.test(textePassages), textePassages.replace(/\n/g, ' '));
      noter('carte : chaque passage dit son coût en tokens', /320 tokens/.test(textePassages) && /180 tokens/.test(textePassages), textePassages.replace(/\n/g, ' '));
      noter('carte : aucune erreur de page', erreurs.length === 0, erreurs[0] ?? '');
      await page.screenshot({ path: path.join(SHOTS, 'contexte-envoye-carte.png') });
    } finally {
      await contexte.close();
    }
  }
} finally {
  await navigateur.close();
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
