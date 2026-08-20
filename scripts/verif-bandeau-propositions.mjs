#!/usr/bin/env node
/**
 * Les cartes proposées tiennent-elles dans un BANDEAU FIXE, au-dessus de la
 * barre d'écriture ?
 *
 * Une proposition rendue dans le fil remonte avec les messages : ses boutons
 * « Créer la carte » / « Refuser » sortent de l'écran dès qu'un échange arrive.
 * On vérifie ici qu'une proposition ENCORE EN ATTENTE sort du fil et se pose
 * dans un bandeau fixe : toujours visible quel que soit le défilement, rangée
 * en ligne avec les autres, glissant horizontalement et JAMAIS verticalement.
 * Une proposition décidée, elle, reste dans le fil et ne paraît plus dans le
 * bandeau ; sans aucune en attente, le bandeau ne prend aucune place.
 *
 *   node scripts/verif-bandeau-propositions.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve :
 * le démon de production n'est pas touché, et aucun moteur n'est appelé.
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

/* Le dépôt d'où PART ce script : lancé depuis une copie de travail
   (« .worktrees/… »), il doit juger CE code-là. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_BANDEAU_PORT || 7198);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-bandeau-'));
const SHOTS = path.join(RACINE, 'data', 'verification');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
for (const dossier of [DATA, PROJETS, DEPOT]) fs.mkdirSync(dossier, { recursive: true });

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

async function attendrePort(limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Le décor : un chef, un long échange, DEUX propositions en attente   */
/* et une déjà refusée.                                                */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-bandeau';
const AGENT_ID = 'a-chef-bandeau';
const TITRE_A = 'Première carte proposée — en attente';
const TITRE_B = 'Deuxième carte proposée — en attente';
const TITRE_REFUSEE = 'Carte déjà refusée';

/** Deux étapes complémentaires, chacune avec sa description complète. */
const DESCRIPTION_A = [
  '**Constat** : `web/src/components/propositions.tsx` affiche chaque proposition séparément.',
  '**Attendu** : permettre de sélectionner les propositions complémentaires dans le bandeau.',
  '**Limites** : ne créer aucune carte pendant la sélection.',
  '**Vérification** : contrôler les cases et le compteur sur ordinateur et téléphone.',
].join('\n\n');
const DESCRIPTION_B = [
  '**Constat** : `server/src/ws.ts` décide aujourd’hui chaque proposition séparément.',
  '**Attendu** : réunir les sélections, relire la proposition composée puis la valider une seule fois.',
  '**Limites** : garder les sources traçables et ne rien lancer automatiquement.',
  '**Vérification** : recharger la page, double-cliquer puis compter les cartes créées.',
].join('\n\n');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const t = Date.now() - 60_000;

  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3600_000,
    'vérification bandeau des propositions',
  );

  // Aucun agent ne doit démarrer : une carte créée reste sagement en « Planifié ».
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  for (const table of ['proposals', 'messages', 'agents', 'cards', 'projects']) {
    db.prepare(`DELETE FROM ${table}`).run();
  }

  const projet = {
    id: PROJET_ID,
    name: 'Essai bandeau',
    path: DEPOT,
    defaultEngine: 'claude',
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
    title: 'Chef d’orchestre — Essai bandeau',
    run: { engine: 'claude', model: 'claude-opus-5', thinking: 'medium', mode: 'direct' },
    status: 'done',
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, 'orchestrator', 'done', ?, ?, ?)`,
  ).run(AGENT_ID, PROJET_ID, JSON.stringify(agent), t, t);

  const message = (id, role, data, quand) => {
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      AGENT_ID,
      role,
      JSON.stringify({ id, agentId: AGENT_ID, role, createdAt: quand, ...data }),
      quand,
    );
  };

  const proposition = (id, title, decision, options = {}) => ({
    id,
    title,
    description: options.description ?? DESCRIPTION_A,
    labels: options.labels ?? ['interface'],
    attachments: options.attachments ?? [],
    run: options.run,
    estimate: options.estimate,
    analysisContext: options.analysisContext,
    decision,
    decidedAt: decision === 'pending' ? undefined : t + 2000,
  });

  const propositions = [
    proposition('prop-a', TITRE_A, 'pending', {
      description: DESCRIPTION_A,
      labels: ['interface', 'commun'],
      attachments: ['image-a', 'image-commune'],
      run: { engine: 'claude', model: 'claude-opus-5', thinking: 'medium', mode: 'direct' },
      estimate: { machineSeconds: 120, tokens: 1000, seniorHours: 1, confidence: 'high', failed: false },
      analysisContext: 'La sélection vit dans propositions.tsx.',
    }),
    proposition('prop-b', TITRE_B, 'pending', {
      description: DESCRIPTION_B,
      labels: ['mobile', 'commun'],
      attachments: ['image-b', 'image-commune'],
      run: { engine: 'codex', model: 'gpt-5.6', thinking: 'high', mode: 'direct' },
      estimate: { machineSeconds: 180, tokens: 2000, seniorHours: 2, confidence: 'medium', failed: false },
      analysisContext: 'La décision finale passe par ws.ts.',
    }),
    proposition('prop-refusee', TITRE_REFUSEE, 'refused'),
  ];

  /* Un fil LONG : c'est tout l'enjeu — la proposition ne doit pas remonter
     hors de l'écran quand les messages s'accumulent. */
  for (let i = 0; i < 30; i += 1) {
    message(
      `m-${i}`,
      i % 2 ? 'assistant' : 'user',
      { content: `Échange n° ${i + 1} — de quoi remplir le fil bien au-delà d’un écran.` },
      t + i * 1000,
    );
  }

  message(
    'm-propositions',
    'assistant',
    { content: 'Je propose deux cartes ; une troisième a déjà été refusée.', steps: [], proposals: propositions },
    t + 40_000,
  );

  for (const p of propositions) {
    db.prepare(
      'INSERT INTO proposals (id, message_id, project_id, decision, data, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(p.id, 'm-propositions', PROJET_ID, p.decision, JSON.stringify(p), t + 40_000, p.decidedAt ?? null);
  }
  db.close();
}

/* ------------------------------------------------------------------ */
/* Les mesures                                                         */
/* ------------------------------------------------------------------ */

/** Le bandeau est-il bien posé entre le fil et la barre d'écriture ? */
async function place(page) {
  return page.evaluate(() => {
    const bandeau = document.querySelector('[data-bandeau="propositions"]');
    if (!bandeau) return { present: false };
    const fil = document.querySelector('[data-fil="conversation"]');
    const zone = bandeau.querySelector('[data-bandeau-zone], .overflow-x-auto');
    const style = zone ? getComputedStyle(zone) : null;
    const b = bandeau.getBoundingClientRect();
    const f = fil?.getBoundingClientRect();
    return {
      present: true,
      vignettes: bandeau.querySelectorAll('[data-vignette="proposition"]').length,
      sousLeFil: f ? b.top >= f.bottom - 2 : false,
      dansLEcran: b.top >= 0 && b.bottom <= window.innerHeight + 1,
      axeX: style?.overflowX ?? '',
      axeY: style?.overflowY ?? '',
      titres: [...bandeau.querySelectorAll('[data-vignette="proposition"]')].map((n) =>
        (n.textContent || '').trim().slice(0, 60),
      ),
    };
  });
}

/** Le fil montre-t-il encore une proposition donnée ? */
async function dansLeFil(page, titre) {
  return page.evaluate((cherche) => {
    const fil = document.querySelector('[data-fil="conversation"]');
    return (fil?.textContent || '').includes(cherche);
  }, titre);
}

async function ouvrir(navigateur, telephone) {
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1400, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([
    { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  const chef = page.getByRole('button', { name: /^Chef/ });
  if (await chef.count()) {
    await chef.first().click();
    await page.waitForTimeout(2500);
  }
  return { contexte, page, erreurs };
}

/** Ce que la fusion a réellement écrit — propositions et cartes. */
function lireEtat() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const cards = db.prepare('SELECT data FROM cards WHERE project_id = ? ORDER BY created_at').all(PROJET_ID).map((row) => JSON.parse(row.data));
  const proposals = db
    .prepare('SELECT decision, data FROM proposals WHERE project_id = ? ORDER BY created_at')
    .all(PROJET_ID)
    .map((row) => ({ decision: row.decision, ...JSON.parse(row.data) }));
  db.close();
  return { cards, proposals };
}

/* ------------------------------------------------------------------ */

fs.mkdirSync(SHOTS, { recursive: true });

if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}
poserLeDecor();

const navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
});

try {
  for (const telephone of [true, false]) {
    const ecran = telephone ? 'téléphone 390×844' : 'ordinateur 1400×900';
    poserLeDecor();
    const { contexte, page, erreurs } = await ouvrir(navigateur, telephone);
    try {
      const vue = await place(page);
      noter(`${ecran} : le bandeau est là`, vue.present);
      if (!vue.present) continue;

      noter(`${ecran} : les deux propositions en attente y sont`, vue.vignettes === 2, `${vue.vignettes} vignette(s)`);
      noter(`${ecran} : le bandeau est sous le fil, dans l’écran`, vue.sousLeFil && vue.dansLEcran);
      noter(
        `${ecran} : il glisse en largeur, jamais en hauteur`,
        vue.axeX === 'auto' && vue.axeY === 'hidden',
        `x=${vue.axeX} y=${vue.axeY}`,
      );

      /* LE PLI DU BANDEAU — vérifié par l'ÉTAT, jamais par une hauteur : le
         bouton annonce `aria-expanded`, et les vignettes sont là ou pas. On
         referme puis on rouvre : un accordéon cassé en position ouverte
         passerait un contrôle qui n'ouvre jamais rien. */
      /* Sur grand écran, la conversation est montée DEUX fois (le fil et le
         panneau de droite) : on juge le PREMIER bandeau du document, celui que
         `place()` mesure déjà. */
      const pli = page.locator('[data-bandeau-pli]').first();
      noter(`${ecran} : l’entête porte un bouton de repli`, (await pli.count()) === 1);
      noter(`${ecran} : le bandeau s’ouvre déplié`, (await pli.getAttribute('aria-expanded')) === 'true');
      await pli.click();
      await page.waitForFunction(
        () => document.querySelector('[data-bandeau-pli]')?.getAttribute('aria-expanded') === 'false',
        undefined,
        { timeout: 4000 },
      );
      const replie = await page.evaluate(() => {
        const bandeau = document.querySelector('[data-bandeau="propositions"]');
        return {
          entete: !!bandeau?.querySelector('[data-bandeau-pli]'),
          zone: !!bandeau?.querySelector('[data-bandeau-zone]'),
          vignettes: bandeau?.querySelectorAll('[data-vignette="proposition"]').length ?? 0,
          hauteur: Math.round(bandeau?.getBoundingClientRect().height ?? 0),
        };
      });
      noter(
        `${ecran} : replié, plus aucune vignette n’occupe l’écran`,
        replie.zone === false && replie.vignettes === 0,
        `${replie.vignettes} vignette(s)`,
      );
      noter(`${ecran} : replié, l’entête reste visible`, replie.entete);
      /* La HAUTEUR est ici le sujet même de la carte (« la barre prend de la
         place sans pouvoir se réduire ») : on garde donc cette seule mesure. */
      noter(
        `${ecran} : replié, le bandeau tient sur une ligne`,
        replie.hauteur > 0 && replie.hauteur < 60,
        `${replie.hauteur} px`,
      );
      await page.screenshot({
        path: path.join(SHOTS, `bandeau-replie-${telephone ? 'telephone' : 'ordinateur'}.png`),
      });
      await pli.click();
      await page.waitForFunction(
        () => document.querySelector('[data-bandeau-pli]')?.getAttribute('aria-expanded') === 'true',
        undefined,
        { timeout: 4000 },
      );
      const rouvert = await place(page);
      noter(`${ecran} : un second clic redonne les deux vignettes`, rouvert.vignettes === 2);

      // Le fil garde la refusée, et NON les propositions en attente.
      noter(`${ecran} : la carte refusée reste dans le fil`, await dansLeFil(page, TITRE_REFUSEE));
      noter(
        `${ecran} : une proposition en attente ne paraît plus dans le fil`,
        !(await dansLeFil(page, TITRE_A)),
      );

      // On remonte tout en haut du fil : le bandeau ne bouge pas.
      await page.evaluate(() => {
        const fil = document.querySelector('[data-fil="conversation"]');
        if (fil) fil.scrollTop = 0;
      });
      await page.waitForTimeout(600);
      const apres = await place(page);
      noter(`${ecran} : en remontant la conversation, le bandeau reste à l’écran`, apres.dansLEcran);

      // Le mode de fusion est visible et sélectionne d'abord les deux sources :
      // on peut ensuite retirer précisément ce qu'on ne veut pas réunir.
      const boutonFusion = page.getByRole('button', { name: /^Fusionner$/ });
      noter(`${ecran} : le bouton « Fusionner » est visible`, await boutonFusion.isVisible());
      await boutonFusion.click();
      const actions = page.locator('[data-fusion-propositions="actions"]');
      noter(`${ecran} : le mode de sélection s'ouvre`, await actions.isVisible());
      const confirmerFusion = actions.getByRole('button', { name: /Fusionner \(2\)/ });
      noter(`${ecran} : les deux propositions sont sélectionnées`, await confirmerFusion.isEnabled());

      // Retirer puis remettre une source prouve qu'il s'agit bien d'une
      // sélection, pas d'un bouton qui fusionne aveuglément tout le bandeau.
      const secondeCase = page.getByRole('button', { name: new RegExp(`Retirer « ${TITRE_B}`) });
      await secondeCase.click();
      noter(
        `${ecran} : une seule source ne peut pas être fusionnée`,
        await actions.getByRole('button', { name: /Fusionner \(1\)/ }).isDisabled(),
      );
      await page.getByRole('button', { name: new RegExp(`Ajouter « ${TITRE_B}`) }).click();

      await page.screenshot({
        path: path.join(SHOTS, `bandeau-propositions-${telephone ? 'telephone' : 'ordinateur'}.png`),
      });

      const cartesAvant = lireEtat().cards.length;
      await actions.getByRole('button', { name: /Fusionner \(2\)/ }).click();
      await page.waitForTimeout(2500);
      const apresFusion = await place(page);
      noter(
        `${ecran} : les deux sources deviennent une proposition réunie`,
        apresFusion.present && apresFusion.vignettes === 1,
        `${apresFusion.vignettes ?? 0} vignette(s)`,
      );
      const etatFusion = lireEtat();
      noter(`${ecran} : aucune carte n'existe avant le clic final`, etatFusion.cards.length === cartesAvant);
      noter(
        `${ecran} : les sources restent tracées comme fusionnées, jamais refusées`,
        ['prop-a', 'prop-b'].every((id) => etatFusion.proposals.find((item) => item.id === id)?.decision === 'merged'),
      );
      const composee = etatFusion.proposals.find((item) => item.decision === 'pending');
      noter(
        `${ecran} : étiquettes et pièces jointes sont conservées sans doublon`,
        JSON.stringify(composee?.labels) === JSON.stringify(['interface', 'commun', 'mobile']) &&
          JSON.stringify(composee?.attachments) === JSON.stringify(['image-a', 'image-commune', 'image-b']),
      );
      noter(
        `${ecran} : relais et chiffrage des deux étapes sont réunis`,
        /propositions\.tsx/.test(composee?.analysisContext ?? '') &&
          /ws\.ts/.test(composee?.analysisContext ?? '') &&
          composee?.estimate?.machineSeconds === 300,
      );
      noter(
        `${ecran} : les réglages différents sont signalés et restent modifiables`,
        /réglages différents/i.test(composee?.avertissement ?? '') &&
          (await page.locator('[data-vignette="proposition"]').getByText(/réglages différents/i).count()) > 0,
      );

      // Rechargement réel : la proposition composée et la trace des sources
      // viennent alors uniquement de la base.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
      const chefRecharge = page.getByRole('button', { name: /^Chef/ });
      if (await chefRecharge.count()) {
        await chefRecharge.first().click();
        await page.waitForTimeout(1500);
      }
      const rechargee = await place(page);
      noter(
        `${ecran} : la proposition réunie survit au rechargement`,
        rechargee.present && rechargee.vignettes === 1,
      );
      noter(
        `${ecran} : les deux sources fusionnées restent visibles dans l'historique`,
        (await dansLeFil(page, TITRE_A)) && (await dansLeFil(page, TITRE_B)),
      );

      const vignette = page.locator('[data-vignette="proposition"]').first();
      const titreEdite = `Chantier réuni — ${telephone ? 'téléphone' : 'ordinateur'}`;
      const champTitre = vignette.locator('input').first();
      const champDescription = vignette.locator('textarea').first();
      noter(
        `${ecran} : la proposition réunie s'ouvre directement en modification`,
        (await champTitre.isVisible()) && (await champDescription.isVisible()),
      );
      await champTitre.fill(titreEdite);
      await champDescription.fill(`${await champDescription.inputValue()}\nContrôle final ajouté avant validation.`);
      await vignette.getByRole('button', { name: 'Terminer' }).click();

      // Un double clic final reste idempotent : une seule carte, avec ce qui
      // était affiché et les pièces jointes réunies.
      const creer = vignette.getByRole('button', { name: /Créer la carte/ });
      await creer.dblclick();
      await page.waitForTimeout(2500);
      const final = lireEtat();
      const carte = final.cards.find((item) => item.title === titreEdite);
      noter(`${ecran} : le double clic final ne crée qu'une carte`, final.cards.length === cartesAvant + 1);
      noter(
        `${ecran} : la carte unique reprend l'édition et les contenus réunis`,
        !!carte && /Contrôle final ajouté/.test(carte.description) && carte.labels.length === 3,
      );
      noter(
        `${ecran} : la carte unique reprend toutes les pièces jointes`,
        JSON.stringify(carte?.attachments) === JSON.stringify(['image-a', 'image-commune', 'image-b']),
      );

      const vide = await place(page);
      noter(`${ecran} : sans proposition en attente, le bandeau ne rend rien`, vide.present === false);

      noter(`${ecran} : aucune erreur de page`, erreurs.length === 0, erreurs[0] ?? '');
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
