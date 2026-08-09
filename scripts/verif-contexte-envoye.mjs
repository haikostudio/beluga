#!/usr/bin/env node
/**
 * Le contexte réellement envoyé reste-t-il consultable sous la demande ?
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
/* Une carte RÉELLEMENT passée par une analyse du chef puis exécutée : c'est le
   seul cas où le tiroir montre les DEUX couches (réflexion, puis exécution) et
   les tokens estimés avant le travail. */
const CARTE_ID = 'c-contexte-envoye';
const AGENT_TACHE = 'a-contexte-tache';
const TITRE_CARTE = 'Essai — tokens par couche';
const PROMPT = [
  'DEMANDE : vérifier le contexte exact.',
  ...Array.from({ length: 90 }, (_, i) => `Bloc de contexte ${i + 1} — contenu assez long pour imposer le défilement du tiroir.`),
].join('\n');

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

  /*
   * TROIS TOURS DÉJÀ MESURÉS pour cet agent : deux sur un modèle dont le tarif
   * est connu, un sur un modèle inconnu (son coût doit se dire « indisponible »).
   * Ils sont écrits dans le DÉSORDRE : la liste doit les remettre dans l'ordre
   * du temps.
   */
  const tour = (quand, model, entree, cache, sortie) =>
    db
      .prepare(
        `INSERT INTO usage (project_id, project_name, card_id, agent_id, account, engine, model, tokens,
                            input_tokens, cached_tokens, output_tokens, quota_share, quota_5h, quota_semaine, seconds, created_at)
         VALUES (?, ?, NULL, ?, 'compte', 'claude', ?, ?, ?, ?, ?, 0, 0, 0, 10, ?)`,
      )
      .run(PROJET_ID, 'Essai contexte envoyé', AGENT_ID, model, entree + cache + sortie, entree, cache, sortie, quand);

  tour(t + 2000, 'claude-sonnet-5', 20_000, 5_000, 2_000);
  tour(t - 20_000, 'claude-sonnet-5', 10_000, 1_000, 900);
  tour(t + 1000, 'gpt-5.4', 7_000, 0, 500);

  /*
   * LA CARTE ANALYSÉE PUIS EXÉCUTÉE : son chiffrage porte la mesure de
   * l'analyse du chef (couche « réflexion ») et une projection ; son agent
   * d'exécution porte ses propres tours (couche « exécution »).
   */
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
    estimate: {
      failed: false,
      machineSeconds: 600,
      seniorHours: 2,
      projection: { tokens: 100_000, quotaShare: 0.04, formula: '4 tours × 25 000', assumptions: [] },
      analysisMeasurement: {
        inputTokens: 30_000,
        cachedInputTokens: 12_000,
        outputTokens: 3_000,
        totalTokens: 45_000,
        breakdown: {
          haikoDevInstructions: { status: 'measured', characters: 4_000, note: '' },
          cardDescription: { status: 'measured', characters: 900, note: '' },
          memoryAndInstructions: { status: 'measured', characters: 6_000, note: '' },
          agentReads: { status: 'unavailable', note: 'part non isolable' },
        },
        measuredAt: t,
      },
    },
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
        blocks: [{ kind: 'request', label: 'Demande utilisateur', characters: 42 }],
        history: 'none',
        usage: { inputTokens: 4_000, cachedInputTokens: 1_000 },
        sentAt: t,
      },
    }),
    t,
  );

  const tourTache = (quand, model, entree, cache, sortie) =>
    db
      .prepare(
        `INSERT INTO usage (project_id, project_name, card_id, agent_id, account, engine, model, tokens,
                            input_tokens, cached_tokens, output_tokens, quota_share, quota_5h, quota_semaine, seconds, created_at)
         VALUES (?, ?, ?, ?, 'compte', 'claude', ?, ?, ?, ?, ?, 0, 0, 0, 10, ?)`,
      )
      .run(
        PROJET_ID,
        'Essai contexte envoyé',
        CARTE_ID,
        AGENT_TACHE,
        model,
        entree + cache + sortie,
        entree,
        cache,
        sortie,
        quand,
      );
  tourTache(t + 100, 'claude-sonnet-5', 40_000, 10_000, 4_000);
  tourTache(t + 200, 'claude-sonnet-5', 25_000, 8_000, 3_000);
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
      // Le mot affiché est « tokens » depuis le renommage : le contrôle le suit.
      noter(`${cas.nom} : la mesure moteur est affichée`, /1\D?234 tokens/.test(await boutons.first().innerText()));
      const suitReperes = await boutons.first().evaluate((el) => (el.previousElementSibling?.textContent ?? '').includes('Copier'));
      noter(`${cas.nom} : le bouton suit les repères du message`, suitReperes);

      await boutons.first().click();
      const tiroir = page.getByRole('dialog');
      await tiroir.waitFor({ state: 'visible' });
      noter(`${cas.nom} : le tiroir distingue la reprise`, (await tiroir.innerText()).includes('Reprise de session'));
      noter(`${cas.nom} : l’historique opaque est nommé`, (await tiroir.innerText()).includes('déjà porté par la session'));

      /*
       * LE DÉTAIL BRUT EST REPLIÉ : composition, consigne système et prompt
       * entier ne s'ouvrent que sur demande. Sans carte analysée, aucune
       * section « estimé » — on n'affiche pas un chiffrage qui n'existe pas.
       */
      noter(
        `${cas.nom} : le détail brut est replié par défaut`,
        (await tiroir.locator('[data-detail-brut]').count()) === 0 &&
          (await tiroir.locator('[data-prompt-envoye]').count()) === 0,
      );
      noter(
        `${cas.nom} : sans chiffrage, aucune section « estimé »`,
        (await tiroir.locator('[data-tokens-estimes]').count()) === 0 &&
          (await tiroir.locator('[data-tokens-reels]').count()) === 1,
      );
      noter(
        `${cas.nom} : la couche réellement mesurée est nommée`,
        (await tiroir.locator('[data-couche-tokens="execution"]').count()) === 1,
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

      /*
       * L'HISTORIQUE DES TOURS : trois tours écrits dans le désordre doivent
       * ressortir un par ligne, du plus ancien au plus récent, avec un coût
       * seulement là où le tarif du modèle est connu.
       */
      const lignes = tiroir.locator('[data-historique-tours] li');
      await lignes.first().waitFor({ state: 'visible', timeout: 10_000 });
      noter(`${cas.nom} : un tour par ligne`, (await lignes.count()) === 3);
      const tours = await lignes.allInnerTexts();
      noter(
        `${cas.nom} : les tours sont dans l’ordre du temps`,
        /11\D?000 envoyés/.test(tours[0]) && /7\D?000 envoyés/.test(tours[1]) && /25\D?000 envoyés/.test(tours[2]),
        tours.join(' | '),
      );
      noter(`${cas.nom} : ce qui est reçu est dit`, /900 reçus/.test(tours[0]));
      noter(`${cas.nom} : un tarif connu donne un coût en francs`, /CHF/.test(tours[0]) && /CHF/.test(tours[2]));
      noter(`${cas.nom} : un modèle sans tarif se dit indisponible`, /indisponible/.test(tours[1]));
      const defileTours = await tiroir.locator('[data-historique-tours]').evaluate((zone) => {
        // La liste peut être longue : elle doit défiler seule, sans étirer le tiroir.
        const style = getComputedStyle(zone);
        return style.overflowY === 'auto' || style.overflowY === 'scroll';
      });
      noter(`${cas.nom} : la liste des tours défile seule`, defileTours);
      noter(`${cas.nom} : aucune erreur de page`, erreurs.length === 0, erreurs[0] ?? '');
      await page.screenshot({ path: path.join(SHOTS, `contexte-envoye-${cas.telephone ? 'telephone' : 'ordinateur'}.png`) });
    } finally {
      await contexte.close();
    }
  }

  /*
   * UNE CARTE ANALYSÉE PUIS EXÉCUTÉE : c'est là que le tiroir montre l'ordre
   * complet — d'abord les tokens ESTIMÉS par le chiffrage, ensuite les tokens
   * RÉELS, séparés en deux couches nommées (réflexion du chef, puis exécution).
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
      await tiroir.locator('[data-tokens-reels]').waitFor({ state: 'visible', timeout: 10_000 });

      const rang = async (repere) =>
        tiroir.locator(repere).first().evaluate((el) => {
          const tous = Array.from(document.querySelectorAll('[data-tokens-estimes],[data-tokens-reels],[data-couche-tokens],[data-voir-detail-brut]'));
          return tous.indexOf(el);
        });
      const estime = await rang('[data-tokens-estimes]');
      const reel = await rang('[data-tokens-reels]');
      const analyse = await rang('[data-couche-tokens="analyse"]');
      const execution = await rang('[data-couche-tokens="execution"]');
      const detail = await rang('[data-voir-detail-brut]');

      noter('carte : l’estimé paraît avant le réel', estime >= 0 && reel > estime, `${estime} → ${reel}`);
      noter(
        'carte : la réflexion du chef paraît avant l’exécution',
        analyse > reel && execution > analyse,
        `${analyse} → ${execution}`,
      );
      noter('carte : le détail brut ferme la marche', detail > execution);
      noter(
        'carte : le détail brut reste replié',
        (await tiroir.locator('[data-detail-brut]').count()) === 0,
      );

      const texteEstime = await tiroir.locator('[data-tokens-estimes]').innerText();
      noter('carte : les tokens projetés sont dits', /100\D?000/.test(texteEstime), texteEstime.replace(/\n/g, ' '));
      const texteAnalyse = await tiroir.locator('[data-couche-tokens="analyse"]').innerText();
      noter(
        'carte : la couche d’analyse rend entrée, cache et sortie',
        /30\D?000/.test(texteAnalyse) && /12\D?000/.test(texteAnalyse) && /3\D?000/.test(texteAnalyse),
        texteAnalyse.replace(/\n/g, ' '),
      );
      noter(
        'carte : sans modèle connu, le coût de l’analyse se dit indisponible',
        /indisponible/.test(texteAnalyse),
      );
      const texteExecution = await tiroir.locator('[data-couche-tokens="execution"]').innerText();
      noter(
        'carte : la couche d’exécution somme les tours mesurés',
        /65\D?000/.test(texteExecution) && /18\D?000/.test(texteExecution) && /2 tours mesurés/.test(texteExecution),
        texteExecution.replace(/\n/g, ' '),
      );
      noter('carte : un tarif connu chiffre la couche', /CHF/.test(texteExecution));
      noter(
        'carte : l’écart au projeté est dit',
        (await tiroir.locator('[data-ecart-projection]').count()) === 1,
      );
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
