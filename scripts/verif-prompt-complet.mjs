#!/usr/bin/env node
/**
 * LE PROMPT COMPLET SE LIT DANS LA CONVERSATION — vérifié dans un VRAI
 * navigateur, sur son PROPRE démon (base neuve, port libre, aucun moteur
 * appelé : le démon de production n'est pas touché).
 *
 *   node scripts/verif-prompt-complet.mjs
 *
 * Sous une demande, un lien « Voir le prompt envoyé » déplie sur place le texte
 * réellement transmis à l'agent : les consignes générales, puis le message.
 * La partie relue au cache est surlignée d'un fond gris plus marqué, avec la
 * mention « relu au cache ». Il exige :
 *
 *  1. le lien est là sur une CARTE, où le fil des recherches est masqué ;
 *  2. replié par défaut : aucun texte monté, aucun tiroir ni fenêtre ouverte ;
 *  3. premier tour : consignes « mises en cache pour les tours suivants », pas
 *     surlignées ; reprise mesurée : « relu au cache » et fond surligné ;
 *  4. un tour purgé dit « Texte non conservé » au lieu d'inventer ;
 *  5. la copie rend le texte exact ;
 *  6. rien ne déborde, sur téléphone comme sur ordinateur, en clair comme en
 *     sombre ; aucun chiffre de jetons à l'écran.
 *
 * Contrôle de l'interface publiée en dev : `BELUGA_URL` n'est JAMAIS repris ici.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_PROMPT_COMPLET_PORT || 7196);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(RACINE, 'data', 'verification');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-prompt-complet-',
  port: PORT,
  dossiers: [SHOTS],
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

const PROJET_ID = 'p-prompt-complet';
const CARTE_ID = crypto.randomUUID();
const AGENT_ID = 'a-prompt-complet';
const AGENT_TACHE = 'a-prompt-complet-tache';
const TITRE_CARTE = 'Essai — prompt complet';

const CONSIGNE = [
  'CONSIGNE GÉNÉRALE : tu travailles dans une copie de travail à toi seul.',
  ...Array.from({ length: 80 }, (_, i) => `Règle ${i + 1} — une ligne assez longue pour imposer le défilement de la zone bornée.`),
].join('\n');
const CONSIGNE_LANCEMENT = 'CONSIGNE DE LANCEMENT : exécute la carte dans sa copie de travail.';
const PROMPT_LANCEMENT = 'PROMPT DE LANCEMENT : réalise la tâche validée.';
const PROMPT_1 = 'DEMANDE PREMIER TOUR : montre-moi le prompt réel.';
const PROMPT_2 = [
  'DEMANDE DEUXIÈME TOUR : continue.',
  'https://exemple.test/une/adresse/sans/aucun/espace/qui/pourrait/elargir/la/bulle/si/rien/ne/la/coupait/jamais/du/tout',
].join('\n');

const message = (db, id, role, content, quand, extra = {}) =>
  db
    .prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(
      id,
      AGENT_ID,
      role,
      JSON.stringify({ id, agentId: AGENT_ID, role, content, createdAt: quand, ...extra }),
      quand,
    );

const contexte = ({ session, prompt, consigne, usage, blocs }) => ({
  engine: 'claude',
  model: 'claude-sonnet-5',
  session,
  prompt,
  systemInstruction: { kind: 'full', content: consigne, transport: 'separate' },
  blocks: blocs,
  passages: [],
  consultationsMemoire: [],
  history: session === 'new' ? 'none' : 'retained_by_engine',
  ...(usage ? { usage } : {}),
  sentAt: Date.now() - 30_000,
});

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now() - 120_000;
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton), t, t + 3_600_000, 'vérification prompt complet',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID, name: 'Essai prompt complet', path: DEPOT, defaultEngine: 'claude',
    isSelf: false, rank: 1, archived: false, createdAt: t, updatedAt: t,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), t, t);

  const carte = { id: CARTE_ID, projectId: PROJET_ID, title: TITRE_CARTE, origin: 'user' };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, 'planned', 1, ?, ?, ?, ?)`,
  ).run(CARTE_ID, PROJET_ID, TITRE_CARTE, JSON.stringify(carte), t, t);

  const agent = {
    id: AGENT_ID, projectId: PROJET_ID, cardId: CARTE_ID, role: 'cadrage',
    title: TITRE_CARTE, status: 'idle',
    run: { engine: 'claude', model: 'claude-sonnet-5', thinking: 'medium', mode: 'direct' },
    createdAt: t, updatedAt: t,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, 'cadrage', 'idle', ?, ?, ?)`,
  ).run(AGENT_ID, PROJET_ID, CARTE_ID, JSON.stringify(agent), t, t);

  // 1. Premier tour : session neuve, aucune mesure.
  message(db, 'm1', 'user', PROMPT_1, t + 1_000, {
    sentContext: contexte({
      session: 'new',
      prompt: `${PROMPT_1}\n(gabarit Beluga Build)`,
      consigne: CONSIGNE,
      blocs: [
        { kind: 'request', label: 'Demande utilisateur', characters: PROMPT_1.length, text: PROMPT_1, cached: false },
        { kind: 'system', label: 'Consigne système complète', characters: CONSIGNE.length, text: CONSIGNE, cached: false },
      ],
    }),
  });
  message(db, 'm1r', 'assistant', 'Premier tour rendu.', t + 2_000);

  // 2. Reprise : le moteur a relu 30 000 jetons au cache.
  message(db, 'm2', 'user', 'Deuxième demande.', t + 3_000, {
    sentContext: contexte({
      session: 'resumed',
      prompt: PROMPT_2,
      consigne: CONSIGNE,
      usage: { inputTokens: 40, cachedInputTokens: 30_000 },
      blocs: [
        { kind: 'request', label: 'Demande utilisateur', characters: PROMPT_2.length, text: PROMPT_2, cached: false },
        { kind: 'system', label: 'Consigne système complète', characters: CONSIGNE.length, text: CONSIGNE, cached: true },
      ],
    }),
  });
  message(db, 'm2r', 'assistant', 'Deuxième tour rendu.', t + 4_000);

  // 3. Un tour ancien, purgé pour borner le disque.
  message(db, 'm3', 'user', 'Troisième demande, ancienne.', t + 5_000, {
    sentContext: contexte({
      session: 'resumed',
      prompt: '',
      consigne: '',
      blocs: [{ kind: 'system', label: 'Consigne système complète', characters: CONSIGNE.length, cached: true }],
    }),
  });
  message(db, 'm3r', 'assistant', 'Troisième tour rendu.', t + 6_000);

  // 4. Un tour LANCÉ PAR UN BOUTON : aucune bulle de demande, le texte envoyé
  //    est porté par la réponse de l'agent d'exécution.
  const agentTache = {
    id: AGENT_TACHE, projectId: PROJET_ID, cardId: CARTE_ID, role: 'task',
    title: TITRE_CARTE, status: 'idle',
    run: { engine: 'claude', model: 'claude-sonnet-5', thinking: 'medium', mode: 'direct' },
    createdAt: t, updatedAt: t,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, 'task', 'idle', ?, ?, ?)`,
  ).run(AGENT_TACHE, PROJET_ID, CARTE_ID, JSON.stringify(agentTache), t, t);
  const data = JSON.stringify({
    id: 'm4r', agentId: AGENT_TACHE, role: 'assistant', content: 'Travail rendu.', createdAt: t + 8_000,
    sentContext: contexte({
      session: 'new',
      prompt: PROMPT_LANCEMENT,
      consigne: CONSIGNE_LANCEMENT,
      blocs: [
        { kind: 'request', label: 'Demande utilisateur', characters: 20, text: 'DEMANDE DE LANCEMENT', cached: false },
        { kind: 'system', label: 'Consigne système complète', characters: CONSIGNE_LANCEMENT.length, text: CONSIGNE_LANCEMENT, cached: false },
      ],
    }),
  });
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    'm4r', AGENT_TACHE, 'assistant', data, t + 8_000,
  );

  // Le JOURNAL de la carte : un jalon « Demande » par message écrit, puis le
  // travail du tour lancé par bouton (c'est lui qui fait paraître le point).
  let rang = 0;
  const entree = (champs) =>
    db
      .prepare(
        `INSERT INTO card_journal
           (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, outil, params, resultat, reussie, donnees)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(), CARTE_ID, rang++, champs.phase, champs.nature, champs.at,
        champs.agentId, champs.agentRole, champs.tourId ?? null, champs.libelle,
        champs.outil ?? null, champs.params ?? null, champs.resultat ?? null,
        champs.reussie === undefined ? null : champs.reussie ? 1 : 0, champs.donnees ?? null,
      );
  const demande = (messageId, texte, at) =>
    entree({
      phase: 'cadrage', nature: 'jalon', at, agentId: AGENT_ID, agentRole: 'cadrage',
      libelle: 'Demande', resultat: texte, donnees: JSON.stringify({ messageId, ecriteLe: at }),
    });
  demande('m1', PROMPT_1, t + 1_000);
  demande('m2', 'Deuxième demande.', t + 3_000);
  demande('m3', 'Troisième demande, ancienne.', t + 5_000);
  entree({
    phase: 'execution', nature: 'requete', at: t + 8_500, agentId: AGENT_TACHE, agentRole: 'task',
    tourId: 'm4r', libelle: 'Lecture', outil: 'Read', params: '{"file_path":"README.md"}',
    resultat: '# essai', reussie: true,
  });
  db.close();
}

/* La carte est ouverte quand son parcours est à l'écran — ses onglets n'existent
   pas sur téléphone, le flux, si. */
const ouverte = async (page) => (await page.locator('[data-flux-points]:visible').count()) > 0;

/* Le thème est une préférence enregistrée : « clair » et « sombre » se posent
   en base, comme le fait le menu « Thème ». */
function choisirTheme(theme) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare(
    `INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run('theme', JSON.stringify(theme), Date.now());
  db.close();
}

const fondsRelus = {};

async function ouvrirLaCarte(page) {
  await page.goto(`${BASE}/#en-route/projet/${PROJET_ID}/tache/${CARTE_ID}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  const fin = Date.now() + 30_000;
  while (Date.now() < fin && !(await ouverte(page))) await page.waitForTimeout(200);
  await page.locator('[data-prompt-complet]').first().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => undefined);
}

const debordement = (page) =>
  page.evaluate(() => {
    const racine = document.scrollingElement ?? document.documentElement;
    return racine.scrollWidth - racine.clientWidth;
  });

async function essayer(navigateur, { nom, viewport, colorScheme, telephone }) {
  choisirTheme(colorScheme === 'dark' ? 'dark' : 'light');
  const ctx = await navigateur.newContext({
    viewport,
    locale: 'fr-CH',
    colorScheme,
    serviceWorkers: 'block',
    ...(telephone ? { isMobile: true, hasTouch: true } : {}),
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await ctx.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  try {
    await ouvrirLaCarte(page);
    noter(`${nom} : la carte est ouverte`, await ouverte(page));

    const liens = page.locator('[data-prompt-complet-lien]:visible');
    await liens.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(async () => {
      await page.screenshot({ path: path.join(SHOTS, 'prompt-complet-echec.png') });
      console.log('--- Page au moment de l’échec ---\n' + (await page.locator('body').innerText()).slice(0, 1200));
    });
    noter(
      `${nom} : un lien par demande écrite, plus un pour le tour lancé par un bouton`,
      (await liens.count()) === 4,
      String(await liens.count()),
    );
    noter(
      `${nom} : le lien du tour lancé par un bouton est dans le point du travail`,
      (await page.locator('[data-point="travail"] [data-prompts-du-point] [data-prompt-complet-lien]').count()) === 1,
    );
    noter(
      `${nom} : le fil des recherches reste masqué sur la carte`,
      (await page.locator('[data-prompt-envoye]').count()) === 0,
    );
    noter(`${nom} : replié par défaut, aucun texte monté`, (await page.locator('[data-prompt-complet-corps]').count()) === 0);
    const dialoguesAvant = await page.getByRole('dialog').count();

    // Premier tour.
    await liens.nth(0).click();
    const corps1 = page.locator('[data-prompt-complet-corps]').first();
    await corps1.waitFor({ state: 'visible', timeout: 10_000 });
    const consigne1 = corps1.locator('[data-partie-prompt="consigne"]');
    const message1 = corps1.locator('[data-partie-prompt="message"]');
    noter(`${nom} : premier tour — consignes puis message, dans l'ordre`,
      (await corps1.locator('[data-partie-prompt]').evaluateAll((e) => e.map((n) => n.getAttribute('data-partie-prompt')).join(','))) === 'consigne,message');
    noter(`${nom} : premier tour — consignes « mises en cache pour les tours suivants »`,
      (await consigne1.getAttribute('data-cache')) === 'ecrit' &&
        /mise en cache pour les tours suivants/.test(await consigne1.innerText()));
    noter(`${nom} : premier tour — rien n'est surligné`,
      (await consigne1.locator('[data-surligne]').getAttribute('data-surligne')) === 'non');
    noter(`${nom} : le message exact est là, gabarit compris`,
      (await message1.innerText()).includes(PROMPT_1) && (await message1.innerText()).includes('(gabarit Beluga Build)'));
    noter(`${nom} : ouvrir le lien n'ouvre ni tiroir ni fenêtre`, (await page.getByRole('dialog').count()) === dialoguesAvant);

    // La zone est bornée : la consigne de 80 lignes défile.
    const zone = consigne1.locator('[data-texte-du-prompt]').first();
    const bornee = await zone.evaluate((pre) => {
      const defilant = pre.parentElement;
      return defilant.scrollHeight > defilant.clientHeight + 20 && defilant.clientHeight <= 340;
    });
    noter(`${nom} : la consigne longue défile dans une zone bornée`, bornee);

    // La copie rend le texte exact.
    await consigne1.getByRole('button', { name: /Copier/ }).click();
    const presse = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    noter(`${nom} : « Copier » rend la consigne exacte`, presse === CONSIGNE, `${presse.length} signes`);

    // Reprise mesurée.
    await liens.nth(1).click();
    const corps2 = page.locator('[data-prompt-complet-corps]').nth(1);
    await corps2.waitFor({ state: 'visible', timeout: 10_000 });
    const consigne2 = corps2.locator('[data-partie-prompt="consigne"]');
    noter(`${nom} : reprise — consignes « relu au cache »`,
      (await consigne2.getAttribute('data-cache')) === 'relu' && /relu au cache/.test(await consigne2.innerText()));
    const fondRelu = await consigne2.locator('[data-surligne]').evaluate((n) => getComputedStyle(n).backgroundColor);
    const fondNeuf = await corps2
      .locator('[data-partie-prompt="message"] [data-surligne]')
      .evaluate((n) => getComputedStyle(n).backgroundColor);
    fondsRelus[nom] = fondRelu;
    noter(`${nom} : la partie relue est surlignée, le message neuf ne l'est pas`,
      (await consigne2.locator('[data-surligne]').getAttribute('data-surligne')) === 'oui' &&
        fondRelu !== fondNeuf && fondRelu !== 'rgba(0, 0, 0, 0)' && fondNeuf === 'rgba(0, 0, 0, 0)',
      `${fondRelu} / ${fondNeuf}`);
    noter(`${nom} : l'historique gardé par le moteur est dit`,
      /gardé par le moteur/.test(await corps2.locator('[data-partie-prompt="message"]').innerText()));
    noter(`${nom} : une adresse sans espace ne déborde pas de la page`, (await debordement(page)) <= 1, `${await debordement(page)} px`);

    // Tour purgé.
    await liens.nth(2).click();
    const corps3 = page.locator('[data-prompt-complet-corps]').nth(2);
    await corps3.waitFor({ state: 'visible', timeout: 10_000 });
    noter(`${nom} : un tour purgé dit « Texte non conservé »`,
      (await corps3.innerText()).split('Texte non conservé').length - 1 === 2);

    // Aucun chiffre de jetons.
    const toutLeTexte = await page.locator('[data-prompt-complet]').allInnerTexts();
    noter(`${nom} : aucun chiffre de jetons à l'écran`,
      !toutLeTexte.some((x) => /30\s?000|\b\d+\s*(jetons|tokens)\b/i.test(x)));

    await page.screenshot({ path: path.join(SHOTS, `prompt-complet-${nom.replace(/\s+/g, '-')}.png`), fullPage: false });

    // Tour lancé par un bouton : le texte est porté par la réponse de l'agent.
    await liens.nth(3).click();
    const corps4 = page.locator('[data-prompt-complet-corps]').nth(3);
    await corps4.waitFor({ state: 'visible', timeout: 10_000 });
    noter(
      `${nom} : le tour lancé par un bouton montre son texte exact`,
      (await corps4.innerText()).includes(CONSIGNE_LANCEMENT) && (await corps4.innerText()).includes(PROMPT_LANCEMENT),
    );

    // Se referme.
    await liens.nth(0).click();
    await page.waitForTimeout(200);
    noter(`${nom} : le même lien referme`, (await page.locator('[data-prompt-complet-corps]').count()) === 3);
    noter(`${nom} : aucune erreur de page`, erreurs.length === 0, erreurs[0] ?? '');
  } finally {
    await ctx.close();
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
    await essayer(navigateur, { nom: 'ordinateur clair', viewport: { width: 1400, height: 900 }, colorScheme: 'light' });
    await essayer(navigateur, { nom: 'ordinateur sombre', viewport: { width: 1400, height: 900 }, colorScheme: 'dark' });
    await essayer(navigateur, {
      nom: 'téléphone sombre', viewport: { width: 390, height: 844 }, colorScheme: 'dark', telephone: true,
    });
  } finally {
    await navigateur.close();
  }
  noter(
    'le surlignage suit la palette : clair et sombre ne donnent pas le même gris',
    fondsRelus['ordinateur clair'] !== undefined &&
      fondsRelus['ordinateur clair'] !== fondsRelus['ordinateur sombre'],
    `${fondsRelus['ordinateur clair']} / ${fondsRelus['ordinateur sombre']}`,
  );
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) console.log('Journal du démon (fin) :\n' + journal.slice(-20).join(''));
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.slice(-40).join(''));
  process.exit(1);
});
