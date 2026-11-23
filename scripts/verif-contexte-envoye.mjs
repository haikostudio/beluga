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
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { ouvrirLesTableauxDeBord } from './lib/navigation.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKO_CONTEXTE_ENVOYE_PORT || 7198);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(RACINE, 'data', 'verification');
const { TMP, DATA, PROJETS, DEPOT, demon, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-contexte-envoye-',
  port: PORT,
  dossiers: [SHOTS],
});

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
  const db = new Database(path.join(DATA, 'beluga.db'));
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
    role: 'cadrage',
    title: 'Chef d’orchestre — contexte envoyé',
    run: { engine: 'codex', model: 'gpt-5.4', thinking: 'medium', mode: 'direct' },
    // « running » : c'est ce qui le fait paraître dans la pile d'agents de la
    // colonne de gauche, seul chemin vers une conversation sans carte.
    status: 'running',
    startedAt: t,
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, 'cadrage', 'running', ?, ?, ?)`,
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
          { kind: 'format', label: 'Gabarit et séparateurs Beluga Build', characters: 372 },
          { kind: 'system', label: 'Rappel de méthode', characters: 46, text: 'RAPPEL DE MÉTHODE : lis, constate et vérifie.', cached: true },
        ],
        passages: [],
        consultationsMemoire: [
          {
            id: 'consultation-memoire',
            source: 'memoire',
            requete: 'memoire',
            resultat: 'SUJET « memoire » : faits, règles et contrôles réellement rendus.',
            reussie: true,
            at: t + 200,
          },
          {
            id: 'consultation-publication',
            source: 'memoire',
            requete: 'publication',
            resultat: [
              'SUJET « publication » — ses faits :',
              '- Publication : une branche poussée reste séparée de la mise en ligne.',
              '',
              'RÈGLES qui mentionnent « publication » :',
              '- Ne jamais publier sans un geste de l’utilisateur.',
            ].join('\n'),
            reussie: true,
            at: t + 300,
          },
          {
            id: 'consultation-competence',
            source: 'competence',
            requete: 'catalogue partagé',
            resultat: '- tracer-appels-outils-dans-le-tour : rattacher chaque résultat au bon tour.',
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
        consultationsMemoire: [
          {
            id: 'consultation-quotas',
            source: 'memoire',
            requete: 'quotas',
            resultat: 'Chaque hausse mesurée n’est attribuée qu’une fois.',
            reussie: true,
            at: t + 2200,
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
    column: 'to_deploy',
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
  ).run(CARTE_ID, PROJET_ID, 'to_deploy', 0, TITRE_CARTE, JSON.stringify(carte), t, t);

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
        consultationsMemoire: [
          {
            id: 'consultation-carte',
            source: 'memoire',
            requete: 'cartes',
            resultat: 'Une carte naît dans Planifié et suit les étapes réelles du travail.',
            reussie: true,
            at: t + 200,
          },
          {
            id: 'consultation-fiche',
            source: 'competence',
            requete: 'catalogue partagé',
            resultat: '- verifs-navigateur-etat-plutot-que-hauteur : vérifier le contenu et l’état annoncé.',
            reussie: true,
            at: t + 300,
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
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare(
    `INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run('theme', JSON.stringify(theme), Date.now());
  db.close();
}

async function ouvrir(navigateur, telephone, ouvrirLAgent = true) {
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1400, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
    locale: 'fr-CH',
    serviceWorkers: 'block',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3500);
  /*
   * UNE CONVERSATION SANS CARTE S'OUVRE PAR LA PILE D'AGENTS de la colonne de
   * gauche : c'est le SEUL chemin depuis que le chef d'orchestre a disparu (il
   * n'y a plus de bouton « Chef » à cliquer). Sur téléphone, cette colonne vit
   * dans un panneau qu'il faut d'abord ouvrir — et les DEUX colonnes restent
   * dans la page, l'une masquée : on ne vise donc que ce qui est VISIBLE.
   */
  if (!ouvrirLAgent) return { contexte, page, erreurs };
  if (telephone) {
    const menu = page.getByRole('button', { name: 'Projets' }).first();
    if (await menu.count()) {
      await menu.click();
      await page.waitForTimeout(800);
    }
  }
  {
    // La pile flottante a laissé place à la page « En route » : l'agent sans
    // carte s'y lit dans la bande de tête. On y va par la grille des services
    // (la colonne de gauche n'a plus de ligne « Tableaux de bord »).
    await page.mouse.move(5, 700);
    await page.waitForTimeout(400);
    await ouvrirLesTableauxDeBord(page);
    await page.waitForTimeout(1500);
    const vignette = page.locator('[data-ouvrir-agent-en-route]:visible').first();
    if (await vignette.count()) {
      await vignette.click();
      await page.waitForTimeout(1500);
    }
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
      /* Le suivi se lit côté agent : chaque résultat ajoute ses propres étapes. */
      noter(
        `${cas.nom} : l’ancienne pastille « Prompt envoyé » a disparu`,
        (await page.locator('[data-contexte-envoye]').count()) === 0,
      );
      const groupes = page.locator('[data-prompt-envoye]:visible');
      noter(`${cas.nom} : seuls les deux tours avec recherche portent un fil`, (await groupes.count()) === 2);
      const premier = groupes.first();
      const ordre = await premier.locator('[data-bulle-agent]').evaluateAll((els) =>
        els.map((el) => el.getAttribute('data-bulle-agent')),
      );
      noter(
        `${cas.nom} : chaque arrivée suit le bon ordre`,
        JSON.stringify(ordre) === JSON.stringify([
          'requete',
          'recherche',
          'resume',
          'recherche',
          'resume',
          'directives',
          'recherche',
          'directives',
        ]),
        ordre.join(' → '),
      );
      const recherches = premier.locator('[data-bulle-agent="recherche"]');
      noter(`${cas.nom} : les trois recherches ont trois blocs distincts`, (await recherches.count()) === 3);
      const textesRecherches = await recherches.allInnerTexts();
      noter(
        `${cas.nom} : aucun bloc de recherche ne cumule les arrivées`,
        /memoire/.test(textesRecherches[0] ?? '') &&
          !/publication|compétences partagées/i.test(textesRecherches[0] ?? '') &&
          /publication/.test(textesRecherches[1] ?? '') &&
          !/memoire|compétences partagées/i.test(textesRecherches[1] ?? '') &&
          /compétences partagées/i.test(textesRecherches[2] ?? ''),
        textesRecherches.join(' | '),
      );
      const textePremier = await premier.innerText();
      noter(
        `${cas.nom} : mémoire et compétence sont toutes deux nommées`,
        /mémoire du projet/i.test(textePremier) && /compétences partagées/i.test(textePremier),
      );
      noter(
        `${cas.nom} : le résumé et les directives restent distincts`,
        /Résumé compris/.test(textePremier) &&
          /Directives retrouvées/.test(textePremier) &&
          /faits, règles et contrôles réellement rendus/.test(textePremier) &&
          /une branche poussée reste séparée/.test(textePremier) &&
          /Ne jamais publier sans un geste/.test(textePremier) &&
          /rattacher chaque résultat au bon tour/.test(textePremier) &&
          (textePremier.match(/faits, règles et contrôles réellement rendus/g) ?? []).length === 1,
      );
      noter(
        `${cas.nom} : aucun pavé technique n’est rendu dans la conversation`,
        !/Mémoire transmise|Contexte complet transmis|Mémoire cache|~[\d ]+ jetons|BRIEFING DU PROJET|RAPPEL DE MÉTHODE/.test(textePremier),
      );
      const tientMobile = await premier.locator('[data-bulle-agent]').evaluateAll((els) =>
        els.every((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      noter(`${cas.nom} : aucune bulle ne déborde horizontalement`, tientMobile);

      const placeFil = await premier.boundingBox();
      const placeDemande = await page.getByText('Montre-moi le contexte réellement envoyé.', { exact: true }).first().boundingBox();
      noter(
        `${cas.nom} : le fil est placé côté agent`,
        !!placeFil && !!placeDemande && placeFil.x < placeDemande.x,
      );

      await premier.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(SHOTS, `fil-agent-${cas.telephone ? 'telephone' : 'ordinateur'}.png`),
      });

      const second = groupes.nth(1);
      const texteSecond = await second.innerText();
      noter(
        `${cas.nom} : chaque tour garde sa propre recherche`,
        /quotas/.test(texteSecond) && /Chaque hausse mesurée/.test(texteSecond) && !/rattacher chaque résultat/.test(texteSecond),
      );
      /* LE FIL LUI-MÊME N'OUVRE RIEN : le seul tiroir de la page est celui de
         la conversation, ouvert à la main juste avant. Aucun second tiroir ne
         s'empile pour lire le prompt — c'est ce que l'ancienne pastille
         faisait, et qui a disparu. */
      noter(`${cas.nom} : le fil n’ouvre aucun tiroir de plus`, (await page.getByRole('dialog').count()) <= 1);
      noter(`${cas.nom} : aucune erreur de page`, erreurs.length === 0, erreurs[0] ?? '');
      await page.screenshot({ path: path.join(SHOTS, `contexte-envoye-${cas.telephone ? 'telephone' : 'ordinateur'}.png`) });
    } finally {
      await contexte.close();
    }
  }

  /*
   * DANS LE TIROIR D'UNE CARTE : AUCUN FIL DE RECHERCHE.
   *
   * Ces bulles disent ce que l'agent est allé LIRE. Sur une carte, c'est le
   * cadrage qui lit, et sa timeline les porte déjà. Une fois la carte lancée,
   * elles revenaient dans le fil ordinaire, en tête du premier message de
   * l'agent d'exécution — donc juste sous le repère « Exécution de la tâche »,
   * où leur bulle « Requête reçue » recopiait toute la conversation de
   * cadrage. Le tiroir doit maintenant s'ouvrir droit sur le travail
   * (`filDesRecherchesAffiche`, `shared/src/cadrage.ts`).
   */
  choisirTheme('dark');
  {
    // Sans ouvrir la conversation de l'agent : son tiroir couvrirait le tableau.
    const { contexte, page, erreurs } = await ouvrir(navigateur, false, false);
    try {
      const carte = page.locator('article').filter({ hasText: TITRE_CARTE }).first();
      await carte.waitFor({ state: 'visible', timeout: 20_000 });
      await carte.click();
      await page.waitForTimeout(1500);
      const panneau = page.getByRole('dialog').last();
      await panneau.getByRole('tab', { name: 'Conversation' }).click();
      await page.waitForTimeout(1200);

      // Le déroulé, lui, est bien là : c'est la preuve que la conversation est
      // chargée, et non simplement vide.
      await panneau.getByText('1 étape terminée').first().waitFor({ state: 'visible', timeout: 10_000 });

      noter(
        'carte : aucun fil de recherche dans la conversation',
        (await panneau.locator('[data-fil-agent]').count()) === 0,
      );
      noter(
        'carte : aucune bulle « Requête reçue » ne recopie le cadrage',
        (await panneau.locator('[data-bulle-agent]').count()) === 0,
      );
      const texte = await panneau.innerText();
      noter(
        'carte : aucun ancien pavé technique ne reste visible',
        !/Mémoire transmise|Contexte complet transmis|BRIEFING DU PROJET|docs\/regles/.test(texte),
      );
      noter('carte : aucune erreur de page', erreurs.length === 0, erreurs[0] ?? '');
      await page.screenshot({ path: path.join(SHOTS, 'fil-agent-carte.png') });
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
