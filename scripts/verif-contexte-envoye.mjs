#!/usr/bin/env node
/**
 * LE PROMPT ENVOYÉ reste-t-il consultable sous la demande ? Le bloc
 * « Contexte envoyé » a disparu : sous chaque demande réellement partie, un
 * REPÈRE simple se pose à GAUCHE, et son clic ouvre un tiroir qui montre CE
 * tour-là — les morceaux nommés du prompt, leur TEXTE réel (jamais un
 * chiffre), les passages retrouvés par la recherche, et une copie fidèle.
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
      const reperes = page.locator('[data-contexte-envoye]:visible');
      noter(`${cas.nom} : seuls les deux tours réellement partis portent un repère`, (await reperes.count()) === 2);
      const texteRepere = await reperes.first().innerText();
      noter(`${cas.nom} : le repère se lit « Prompt envoyé », sans chiffre`, /Prompt envoyé/.test(texteRepere) && !/\d[\s ]*tokens?/i.test(texteRepere));

      /*
       * LE REPÈRE EST À GAUCHE : la bulle de la demande, elle, est à droite.
       * On compare les deux bords gauches dans la même largeur de page.
       */
      const aGauche = await reperes.first().evaluate((el) => {
        const bulle = el.parentElement?.querySelector('.flex.justify-end > div');
        if (!bulle) return false;
        return el.getBoundingClientRect().left < bulle.getBoundingClientRect().left;
      });
      noter(`${cas.nom} : le repère est posé à gauche, sous la demande`, aGauche);

      await reperes.first().click();
      const tiroir = page.getByRole('dialog');
      await tiroir.waitFor({ state: 'visible' });

      /*
       * LE TIROIR MONTRE CE TOUR-LÀ, À PLAT : plus de chronologie de tous les
       * tours, plus de recherche, plus de blocs repliés — les morceaux nommés
       * du prompt, chacun avec son texte réel, tout de suite lisibles.
       */
      const morceaux = tiroir.locator('[data-morceau-prompt]');
      noter(`${cas.nom} : le tiroir montre les morceaux du prompt de ce tour`, (await morceaux.count()) === 5);
      noter(`${cas.nom} : le tiroir ne montre aucun autre tour`, (await tiroir.locator('[data-tour-envoye]').count()) === 0);
      noter(`${cas.nom} : le tiroir n’a plus de recherche`, (await tiroir.locator('[data-recherche-prompt]').count()) === 0);

      const blocMemoire = morceaux.filter({ hasText: 'Nouveaux faits de la mémoire' });
      noter(
        `${cas.nom} : le morceau « Nouveaux faits de la mémoire » rend le texte réel envoyé`,
        (await blocMemoire.locator('pre').innerText()) === MEMOIRE_SUIVI,
      );
      const blocSysteme = morceaux.filter({ hasText: 'Rappel de méthode' });
      noter(
        `${cas.nom} : le morceau relu au cache porte son repère, sans chiffre`,
        /relu au cache/.test(await blocSysteme.first().innerText()),
      );

      // Le SECOND tour a son propre repère : son tiroir montre SON passage retrouvé.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      await reperes.nth(1).click();
      const tiroir2 = page.getByRole('dialog');
      await tiroir2.waitFor({ state: 'visible' });
      const texteTour2 = await tiroir2.innerText();
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
      await tiroir2.getByRole('button', { name: /Copier/ }).first().click();
      const copie = await page.evaluate(() => window.__contexteCopie);
      noter(
        `${cas.nom} : la copie contient le texte réel de ce tour`,
        copie.includes('Et maintenant, montre-moi le tour suivant.') && !copie.includes(MEMOIRE_SUIVI),
      );

      // Le tiroir doit rester PRÊT à défiler dès que le prompt déborde.
      const zonePrete = await tiroir2.locator('[data-contexte-envoye-contenu]').evaluate((zone) => {
        return getComputedStyle(zone).overflowY !== 'hidden' && getComputedStyle(zone).overflowY !== 'visible';
      });
      noter(`${cas.nom} : la zone du tiroir est prête à défiler`, zonePrete);
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
      const bloc = panneau.locator('[data-demande-envoyee]').first();
      await bloc.waitFor({ state: 'visible', timeout: 10_000 });
      const texteBloc = await bloc.innerText();
      noter('carte : la demande envoyée est annoncée sans rien ouvrir', /Demande envoyée à l’agent|Demande envoyée à l'agent/.test(texteBloc));
      noter('carte : la mémoire retrouvée est chiffrée sur ce bloc', /2 passages retrouvés/.test(texteBloc));

      const placeBloc = await bloc.boundingBox();
      const placeEtapes = await panneau.getByText('1 étape terminée').first().boundingBox();
      noter(
        'carte : le bloc est posé AU-DESSUS du déroulé des étapes',
        !!placeBloc && !!placeEtapes && placeBloc.y < placeEtapes.y,
      );

      await bloc.locator('button').first().click();
      await page.waitForTimeout(400);
      noter(
        'carte : déplier le bloc rend le texte réel de la demande',
        /Réalise cette tâche\./.test(await bloc.innerText()),
      );

      await page.screenshot({ path: path.join(SHOTS, 'contexte-envoye-carte-conversation.png') });

      await panneau.locator('[data-contexte-envoye]').first().click();
      const tiroir = page.getByRole('dialog').last();
      const morceaux = tiroir.locator('[data-morceau-prompt]');
      await morceaux.first().waitFor({ state: 'visible', timeout: 10_000 });

      /*
       * LES PASSAGES RETROUVÉS : source, titre — et leur texte réel, pas un
       * coût en tokens. Un contexte choisi par la machine doit rester lisible,
       * sinon personne ne peut dire pourquoi l'agent a lu ceci plutôt que cela.
       */
      const texteTiroir = await tiroir.innerText();
      noter(
        'carte : le tiroir nomme les deux passages retrouvés',
        /docs\/regles\/cartes\.md/.test(texteTiroir) && /ajouter-une-colonne\.md/.test(texteTiroir),
      );
      noter('carte : les passages sont marqués comme tels', (await tiroir.locator('[data-passage="oui"]').count()) === 2);
      const blocPassage = morceaux.filter({ hasText: 'cartes.md' });
      noter(
        'carte : le texte du premier passage est affiché en clair',
        /Une carte NAÎT dans « Planifié »/.test(await blocPassage.locator('pre').innerText()),
      );
      const blocBriefing = morceaux.filter({ hasText: 'Briefing du projet' });
      noter(
        'carte : le morceau « Briefing du projet » rend son texte réel',
        (await blocBriefing.locator('pre').innerText()) === 'BRIEFING DU PROJET — Essai contexte envoyé.',
      );
      noter('carte : aucun compteur de jetons dans le tiroir', !/\d[\s ]*tokens?\b/i.test(texteTiroir));
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
