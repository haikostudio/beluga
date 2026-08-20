#!/usr/bin/env node
/**
 * LE PROMPT ENVOYÉ se lit-il SANS RIEN OUVRIR ? Il n'y a plus ni pastille ni
 * tiroir : sous chaque demande réellement partie, des BULLES de message se
 * posent dans le fil, alignées à droite dans le même encadré gris — la demande,
 * puis « Mémoire transmise » (mémoire retrouvée et prompt complet réunis, avec
 * ses deux labels colorés). Une bulle trop longue ne montre que ses premières
 * lignes, avec « voir plus » en bas.
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
/* 1 200 signes de mémoire, pour le DEUXIÈME tour ≈ 300 tokens. */
const MEMOIRE_DEUXIEME_TOUR = 'z'.repeat(1_200);

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
          { kind: 'request', label: 'Demande utilisateur', characters: 42, text: 'Montre-moi le contexte réellement envoyé.', cached: false },
          { kind: 'memory', label: 'Nouveaux faits de la mémoire', characters: MEMOIRE_SUIVI.length, text: MEMOIRE_SUIVI, cached: false },
          { kind: 'card', label: 'Carte en cours', characters: 820, text: 'CARTE EN COURS : « Essai — mémoire et envoi »', cached: false },
          { kind: 'format', label: 'Gabarit et séparateurs HaikoDev', characters: 372 },
          { kind: 'system', label: 'Rappel de méthode', characters: 46, text: 'RAPPEL DE MÉTHODE : lis, constate et vérifie.', cached: true },
        ],
        passages: [],
        consultationsMemoire: [
          {
            id: 'consultation-memoire',
            requete: 'memoire',
            resultat: 'SUJET « memoire » : faits, règles et contrôles réellement rendus.',
            reussie: true,
            at: t + 200,
          },
          {
            id: 'consultation-interface',
            requete: 'interface',
            resultat: 'SUJET « interface » : règles de lisibilité réellement rendues.',
            reussie: true,
            at: t + 400,
          },
        ],
        passagesRaison:
          'Reprise de session : la mémoire a déjà été transmise au premier tour de ce fil, seuls les faits ajoutés depuis sont renvoyés.',
        history: 'retained_by_engine',
        usage: { inputTokens: 1_000, cachedInputTokens: 234 },
        sentAt: t,
      },
    },
    t,
  );
  message('m-file', { content: 'Cette demande est encore en file.' }, t + 1000);

  /* UN DEUXIÈME TOUR, plus tard dans la même conversation : c'est lui qui
     fait exister une CHRONOLOGIE — un seul tour ne prouverait rien. */
  message(
    'm-envoye-2',
    {
      content: 'Et maintenant, montre-moi le tour suivant.',
      tokens: 2_000,
      sentContext: {
        engine: 'codex',
        model: 'gpt-5.4',
        session: 'resumed',
        prompt: 'DEMANDE : et le tour suivant ?',
        systemInstruction: {
          kind: 'reminder',
          content: 'RAPPEL DE MÉTHODE : lis, constate et vérifie.',
          transport: 'prefixed',
        },
        blocks: [
          { kind: 'request', label: 'Demande utilisateur', characters: 40, text: 'Et maintenant, montre-moi le tour suivant.', cached: false },
          { kind: 'memory', label: 'Nouveaux faits de la mémoire', characters: MEMOIRE_DEUXIEME_TOUR.length, text: MEMOIRE_DEUXIEME_TOUR, cached: false },
        ],
        passages: [
          {
            source: 'docs/regles/quotas.md',
            titre: 'Quotas › Chaque hausse mesurée n’est attribuée qu’une fois',
            score: 0.52,
            tokens: 210,
            texte: 'Chaque hausse mesurée sur un compte n’est attribuée qu’une fois : les tours simultanés cumulent leur part depuis un repère commun.',
          },
        ],
        history: 'retained_by_engine',
        usage: { inputTokens: 2_000 },
        sentAt: t + 2000,
      },
    },
    t + 2000,
  );

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

  /*
   * UNE CARTE LANCÉE PAR UN BOUTON N'ÉCRIT AUCUNE BULLE DE DEMANDE : son tour
   * part en silence, et c'est le message de RÉPONSE qui porte le prompt envoyé.
   * Le tiroir doit donc montrer la demande et la mémoire retrouvée AU-DESSUS du
   * déroulé des étapes, là où une bulle se serait trouvée.
   */
  const idMessage = 'm-tache';
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    idMessage,
    AGENT_TACHE,
    'assistant',
    JSON.stringify({
      id: idMessage,
      agentId: AGENT_TACHE,
      role: 'assistant',
      content: '## 1. Analyse\n\nLe travail est fait.',
      steps: [
        { id: 's-1', label: 'Lecture des fichiers du projet', state: 'done', startedAt: t, endedAt: t + 1 },
      ],
      createdAt: t,
      tokens: 5_000,
      sentContext: {
        engine: 'claude',
        model: 'claude-sonnet-5',
        session: 'new',
        prompt: PROMPT,
        systemInstruction: { kind: 'full', content: 'MÉTHODE : lire, constater, vérifier.', transport: 'separate' },
        blocks: [
          { kind: 'request', label: 'Demande utilisateur', characters: 42, text: 'Réalise cette tâche.', cached: false },
          { kind: 'briefing', label: 'Briefing du projet', characters: 500, text: 'BRIEFING DU PROJET — Essai contexte envoyé.', cached: false },
          { kind: 'memory', label: 'Passages retrouvés dans la documentation (2)', characters: MEMOIRE_OUVERTURE.length, text: MEMOIRE_OUVERTURE, cached: false },
        ],
        /* Ce que la RECHERCHE est allée chercher toute seule : source, titre,
           pertinence et coût. C'est ce qui rend le contexte remonté par la
           machine vérifiable à l'œil. */
        passages: [
          {
            source: 'docs/regles/cartes.md',
            titre: 'Cartes › Une carte NAÎT dans « Planifié »',
            score: 0.61,
            tokens: 320,
            texte: 'Une carte NAÎT dans « Planifié » : ni « Validé » ni « À faire » n’existent, le tableau compte sept colonnes.',
          },
          {
            source: 'docs/mecaniques/ajouter-une-colonne.md',
            titre: 'Ajouter une colonne',
            score: 0.44,
            tokens: 180,
            texte: 'Mode d’emploi pour ajouter une colonne au tableau : où la déclarer, où la brancher.',
          },
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
      /*
       * PLUS AUCUNE PASTILLE, PLUS AUCUN TIROIR : ce qui est parti au moteur se
       * lit comme des messages, dans le fil, sans un clic.
       */
      noter(
        `${cas.nom} : l’ancienne pastille « Prompt envoyé » a disparu`,
        (await page.locator('[data-contexte-envoye]').count()) === 0,
      );
      const groupes = page.locator('[data-prompt-envoye]:visible');
      noter(`${cas.nom} : seuls les deux tours réellement partis portent des bulles`, (await groupes.count()) === 2);

      /*
       * LA DEMANDE TAPÉE N'EST PAS REDITE : sa bulle est déjà juste au-dessus.
       * Reste une seule bulle : « Mémoire transmise » — mémoire retrouvée et
       * prompt complet réunis.
       */
      const premier = groupes.first();
      const ordre = await premier.locator('[data-bulle-prompt]').evaluateAll((els) =>
        els.map((el) => el.getAttribute('data-bulle-prompt')),
      );
      noter(`${cas.nom} : une seule bulle sort, sans redire la demande tapée`, JSON.stringify(ordre) === JSON.stringify(['memoire']), ordre.join(' → '));

      /*
       * ISOLÉE, DANS SON PROPRE ENCADRÉ — jamais le gris des messages : elle
       * n'est pas un message de l'utilisateur, c'est ce que la machine a
       * transmis à côté de lui.
       */
      const memoire1 = premier.locator('[data-bulle-prompt="memoire"]').first();
      const encadre1 = await memoire1.evaluate((el) => {
        const sonde = document.createElement('div');
        sonde.style.background = 'hsl(var(--raised))';
        document.body.appendChild(sonde);
        const gris = getComputedStyle(sonde).backgroundColor;
        sonde.remove();
        return { memeGris: getComputedStyle(el).backgroundColor === gris };
      });
      noter(`${cas.nom} : la bulle ne reprend pas le gris des messages`, !encadre1.memeGris);
      noter(
        `${cas.nom} : la bulle dit pourquoi rien n’a été retrouvé de neuf`,
        /Reprise de session/.test(await memoire1.innerText()),
      );
      const texteMemoire1 = await memoire1.innerText();
      noter(
        `${cas.nom} : elle nomme ce qui est parti à côté`,
        /Transmis en même temps/.test(texteMemoire1) && /mémoire/i.test(texteMemoire1),
      );
      noter(`${cas.nom} : aucun compteur de jetons dans la bulle`, !/\d[\s ]*tokens?\b/i.test(texteMemoire1));
      noter(
        `${cas.nom} : le titre et le parcours compact sont visibles`,
        /Mémoire transmise/.test(texteMemoire1) &&
          /Parcours de la mémoire \(3\)/.test(texteMemoire1) &&
          (await memoire1.locator('[data-etape-memoire]').count()) === 3,
      );

      /*
       * LE PARCOURS EST COMPACT, PUIS CHAQUE ÉTAPE OUVRE SON PROPRE RÉSULTAT.
       * Le contexte complet reste disponible à part : il ne noie plus le fil.
       */
      const voirPlus = memoire1.locator('[data-voir-plus]').first();
      noter(`${cas.nom} : la bulle est repliée derrière « voir plus »`, (await voirPlus.count()) === 1);
      await voirPlus.click();
      await page.waitForTimeout(300);
      const consultation = memoire1.locator('[data-etape-memoire="consultation"]').first();
      await consultation.locator('[data-entete-etape-memoire]').click();
      noter(
        `${cas.nom} : une étape révèle le texte exact récupéré`,
        /faits, règles et contrôles réellement rendus/.test(await consultation.innerText()),
      );
      await memoire1.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(SHOTS, `contexte-envoye-parcours-${cas.telephone ? 'telephone' : 'ordinateur'}.png`),
      });
      const contexteComplet = memoire1.locator('[data-contexte-complet]');
      await contexteComplet.locator('summary').click();
      noter(
        `${cas.nom} : le contexte complet transmis reste consultable à part`,
        (await memoire1.innerText()).includes(MEMOIRE_SUIVI.slice(0, 40)),
      );
      noter(
        `${cas.nom} : les deux couleurs du contexte complet gardent leur légende`,
        (await memoire1.locator('[data-label-cache]').count()) === 1 &&
          (await memoire1.locator('[data-label-ajoutee]').count()) === 1,
      );
      await memoire1.locator('[data-voir-plus]').first().click();
      await page.waitForTimeout(300);

      // Le SECOND tour porte SES propres passages, jamais ceux du premier.
      const second = groupes.nth(1);

      const memoire2 = second.locator('[data-bulle-prompt="memoire"]').first();
      noter(
        `${cas.nom} : la bulle de mémoire porte son propre encadré`,
        (await second.locator('[data-bulle-prompt="memoire"][data-bulle-isolee]').count()) === 1,
      );

      noter(
        `${cas.nom} : l’ancien tour restitue ses deux étapes historiques`,
        (await memoire2.locator('[data-etape-memoire]').count()) === 2,
      );
      await memoire2.locator('[data-bulle-entete]').first().click();
      await page.waitForTimeout(300);
      const rechercheHistorique = memoire2.locator('[data-etape-memoire="recherche"]').first();
      await rechercheHistorique.locator('[data-entete-etape-memoire]').click();
      noter(
        `${cas.nom} : l’ancienne recherche automatique garde son contenu`,
        /Chaque hausse mesurée/.test(await rechercheHistorique.innerText()),
      );
      await memoire2.locator('[data-bulle-entete]').first().click();
      await page.waitForTimeout(300);
      noter(
        `${cas.nom} : un second clic la referme`,
        (await memoire2.locator('[data-etape-memoire="recherche"]').count()) === 1 &&
          !/Chaque hausse mesurée/.test(await memoire2.innerText()),
      );

      // Déroulé d'abord : replié, un texte long ne rend que ses premières lignes.
      const aDerouler = second.locator('[data-voir-plus]');
      for (let i = 0; i < (await aDerouler.count()); i += 1) {
        await aDerouler.nth(i).click().catch(() => {});
      }
      await page.waitForTimeout(300);
      const contexteCompletTour2 = memoire2.locator('[data-contexte-complet]');
      await contexteCompletTour2.locator('summary').click();
      const texteTour2 = await second.innerText();
      noter(`${cas.nom} : le second tour nomme le passage retrouvé`, /docs\/regles\/quotas\.md/.test(texteTour2));
      noter(
        `${cas.nom} : le second tour rend le texte exact de sa demande`,
        texteTour2.includes('Et maintenant, montre-moi le tour suivant.'),
      );
      noter(
        `${cas.nom} : le second tour ne montre pas le contexte du premier`,
        !texteTour2.includes(MEMOIRE_SUIVI),
      );

      await page.evaluate(() => {
        window.__contexteCopie = '';
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async (texte) => { window.__contexteCopie = texte; } },
        });
      });
      // « Copier » vit maintenant SOUS la bulle, hors de son encadré : on le
      // cherche dans le groupe entier (icône + bulle + bouton), pas dans le
      // seul encadré coloré.
      await second.locator('[data-bulle-groupe="memoire"]').getByRole('button', { name: /Copier/ }).first().click();
      const copie = await page.evaluate(() => window.__contexteCopie);
      noter(
        `${cas.nom} : la copie contient le texte réel de ce tour`,
        copie.includes('Et maintenant, montre-moi le tour suivant.') && !copie.includes(MEMOIRE_SUIVI),
      );

      noter(`${cas.nom} : rien n’a ouvert de tiroir`, (await page.getByRole('dialog').count()) === 0);
      noter(`${cas.nom} : aucune erreur de page`, erreurs.length === 0, erreurs[0] ?? '');
      await page.screenshot({ path: path.join(SHOTS, `contexte-envoye-${cas.telephone ? 'telephone' : 'ordinateur'}.png`) });
    } finally {
      await contexte.close();
    }
  }

  /*
   * DANS LE TIROIR D'UNE CARTE : la session neuve a reçu l'index de mémoire
   * ENTIER au premier tour — le même lecteur de prompts doit s'y afficher,
   * imbriqué dans le panneau de carte, avec le texte réel des passages.
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

      /*
       * CE QUI SE VOIT SANS RIEN OUVRIR : la demande envoyée à l'agent et la
       * mémoire retrouvée, POSÉES AU-DESSUS du déroulé. Sans elles, l'onglet
       * s'ouvrait droit sur « Exécution de la tâche ».
       */
      const bloc = panneau.locator('[data-prompt-envoye]').first();
      await bloc.waitFor({ state: 'visible', timeout: 10_000 });

      /*
       * UNE CARTE LANCÉE PAR UN BOUTON n'a aucune bulle de demande : la
       * PREMIÈRE bulle porte donc la demande elle-même, puis « Mémoire
       * transmise » (mémoire retrouvée et prompt complet réunis).
       */
      const ordre = await bloc.locator('[data-bulle-prompt]').evaluateAll((els) =>
        els.map((el) => el.getAttribute('data-bulle-prompt')),
      );
      noter(
        'carte : les deux bulles sont là, dans l’ordre',
        JSON.stringify(ordre) === JSON.stringify(['demande', 'memoire']),
        ordre.join(' → '),
      );
      noter(
        'carte : la première bulle rend le texte réel de la demande',
        /Réalise cette tâche\./.test(await bloc.locator('[data-bulle-prompt="demande"]').innerText()),
      );

      const placeBloc = await bloc.boundingBox();
      const placeEtapes = await panneau.getByText('1 étape terminée').first().boundingBox();
      noter(
        'carte : les bulles sont posées AU-DESSUS du déroulé des étapes',
        !!placeBloc && !!placeEtapes && placeBloc.y < placeEtapes.y,
      );

      /*
       * LES PASSAGES RETROUVÉS se lisent dans la même bulle : source, titre —
       * et leur texte réel, pas un coût en tokens. Un contexte choisi par la
       * machine doit rester lisible, sinon personne ne peut dire pourquoi
       * l'agent a lu ceci plutôt que cela.
       */
      const memoire = bloc.locator('[data-bulle-prompt="memoire"]').first();
      await memoire.locator('[data-voir-plus]').first().click().catch(() => {});
      await page.waitForTimeout(300);
      const recherche = memoire.locator('[data-etape-memoire="recherche"]').first();
      await recherche.locator('[data-entete-etape-memoire]').click();
      await memoire.locator('[data-contexte-complet] summary').click();
      await page.waitForTimeout(200);
      const texteMemoire = await memoire.innerText();
      noter('carte : la bulle « Mémoire transmise » compte les passages retrouvés', /2 passages retrouvés/.test(texteMemoire));
      noter(
        'carte : elle nomme les deux passages retrouvés',
        /docs\/regles\/cartes\.md/.test(texteMemoire) && /ajouter-une-colonne\.md/.test(texteMemoire),
      );
      noter(
        'carte : le texte du premier passage est affiché en clair',
        /Une carte NAÎT dans « Planifié »/.test(texteMemoire),
      );
      noter(
        'carte : la même bulle rend aussi le texte réel du briefing (prompt complet)',
        texteMemoire.includes('BRIEFING DU PROJET — Essai contexte envoyé.'),
      );
      noter('carte : aucun compteur de jetons dans les bulles', !/\d[\s ]*tokens?\b/i.test(await bloc.innerText()));
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
