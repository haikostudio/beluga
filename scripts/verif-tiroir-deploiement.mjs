#!/usr/bin/env node
/**
 * LE TIROIR D'UNE PUBLICATION ET LE GROUPE DE CARTES QU'ELLE A MISES EN LIGNE.
 *
 * Ce qui manquait, et que ce contrôle verrouille : ouvrir le déroulé d'une
 * publication donnait sept lignes et un état chacune — pour savoir quelle
 * branche venait d'être fusionnée ou ce qu'un agent de dépannage avait tenté,
 * il fallait ouvrir le journal du serveur. Et une fois les cartes rendues « En
 * production », plus rien ne disait lesquelles étaient parties du même coup.
 *
 * DEUX VOLETS, tous deux joués pour de vrai.
 *
 * A. LE SERVEUR ÉCRIT LE FIL — lecture du code de la publication : chaque étape
 *    note son début et son issue par le passage OBLIGÉ (`setStep`), la fusion
 *    note branche par branche, les commandes partent par `commandeDuFil`, et le
 *    dépannage écrit ses moments. Sans cette écriture, le tiroir serait un beau
 *    contenant vide.
 *
 * B. L'ÉCRAN (vrai navigateur, démon d'essai à soi : base neuve, dossier de
 *    projets vide, port libre — le démon de production n'est PAS touché, aucun
 *    quota dépensé). Une publication TERMINÉE est posée en base avec son fil,
 *    et deux cartes « En production » derrière elle. On vérifie alors :
 *      - le bandeau du groupe, avec son titre daté et son compte ;
 *      - le clic qui ouvre le TIROIR d'historique ;
 *      - le FIL des étapes, avec ses heures ;
 *      - qu'on ne peut RIEN relancer depuis cet historique : on relit.
 *
 * Rien n'est publié ni déployé : le contrôle n'appelle aucune commande de mise
 * en ligne, il pose une publication DÉJÀ terminée dans une base jetable.
 *
 *   node scripts/verif-tiroir-deploiement.mjs
 */

import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le script juge le dépôt d'où il PART, jamais /root/haikodev en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7211);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-tiroir-deploiement-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* A. LE SERVEUR ÉCRIT LE FIL                                          */
/* ------------------------------------------------------------------ */

function voletDuServeur() {
  const deploy = fs.readFileSync(path.join(RACINE, 'server', 'src', 'deploy.ts'), 'utf8');
  const regle = fs.readFileSync(path.join(RACINE, 'shared', 'src', 'journal-publication.ts'), 'utf8');

  noter(
    'chaque étape note son début et son issue par le passage obligé (setStep)',
    /function setStep[\s\S]{0,3000}?ajouterAuJournal\(/.test(deploy),
  );
  noter(
    'la progression laisse sa trace au lieu de s’effacer (progresserEtape)',
    /function progresserEtape[\s\S]{0,1600}?ajouterAuJournal\(/.test(deploy),
  );
  noter('la fusion note branche par branche', /noterAuJournal\(current, 'merge'/.test(deploy));
  noter('les commandes réellement lancées entrent dans le fil', /commandeDuFil\(/.test(deploy));
  noter("le passage d'un agent de dépannage est écrit", /'depannage'\)/.test(deploy));
  noter(
    'le fil vit à côté de la publication, pas dans la copie promenée par le tour',
    /const journaux = new Map/.test(deploy) && /function journalDuRun/.test(deploy),
  );
  noter(
    'une publication rangée rend sa mémoire',
    /function oublierLeJournal/.test(deploy) && /oublierLeJournal\(current\.id\)/.test(deploy),
  );
  noter('le fil est BORNÉ, et la règle le dit', /EVENEMENTS_PAR_ETAPE_MAX = \d+/.test(regle));
  noter(
    'un fil vide n’est pas une panne : le champ reste optionnel',
    /journal: z[\s\S]{0,400}?\.optional\(\)/.test(fs.readFileSync(path.join(RACINE, 'shared', 'src', 'models.ts'), 'utf8')),
  );

  const ws = fs.readFileSync(path.join(RACINE, 'server', 'src', 'ws.ts'), 'utf8');
  const casHistorique = ws.slice(ws.indexOf("case 'deploy.historique'"), ws.indexOf("case 'deploy.historique'") + 900);
  noter(
    'lire l’historique ne peut RIEN déclencher (lecture en base seule)',
    /store\.recentDeploys\(/.test(casHistorique) && !/startDeploy|runCommand|exec/.test(casHistorique),
  );

  const panneau = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'deploy-panel.tsx'), 'utf8');
  noter(
    'le déroulé n’est plus dessiné deux fois : le panneau passe par le tiroir',
    /TiroirDeploiement/.test(panneau) && !/function ProcessusEtapes/.test(panneau),
  );

  const tiroir = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'tiroir-deploiement.tsx'), 'utf8');
  noter("c'est un vrai tiroir, pas un panneau posé sur les cartes", /<Drawer/.test(tiroir));
  noter('chaque étape porte son fil, horodaté', /filDeLEtape\(/.test(tiroir) && /heureDeLEvenement\(/.test(tiroir));
}

/* ------------------------------------------------------------------ */
/* B. L'ÉCRAN                                                          */
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

function nettoyer() {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
}
process.on('exit', nettoyer);

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

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai-tiroir';
const RUN_ID = 'run-essai-1';
const AUTRE_RUN = 'run-essai-2';
/* Une heure FIXE : le titre du groupe se lit sur elle, jamais sur « maintenant ». */
const DEPLOYE_LE = new Date(2026, 7, 17, 14, 32, 5).getTime();

/** Les sept étapes d'une publication terminée, la fusion portant son fil. */
function etapesAvecFil() {
  const t0 = DEPLOYE_LE;
  return [
    {
      key: 'merge',
      state: 'done',
      log: '',
      startedAt: t0,
      endedAt: t0 + 9000,
      journal: [
        { at: t0, genre: 'debut', texte: 'L’étape « Fusion des branches » commence.' },
        { at: t0 + 1000, genre: 'progression', texte: 'Branche 1 sur 2 : tache/premiere' },
        { at: t0 + 2000, genre: 'commande', texte: '$ git merge --no-edit tache/premiere' },
        { at: t0 + 3000, genre: 'issue', texte: 'tache/premiere : fusionnée (« Première carte »).' },
        { at: t0 + 4000, genre: 'depannage', texte: 'Conflit reconnu : un agent de dépannage est parti.' },
        { at: t0 + 8000, genre: 'issue', texte: 'tache/seconde : fusionnée après réparation.' },
      ],
    },
    ...['commit', 'push', 'verify', 'build', 'publish'].map((key, i) => ({
      key,
      state: 'done',
      log: '',
      startedAt: t0 + 10000 + i * 1000,
      endedAt: t0 + 10500 + i * 1000,
    })),
    { key: 'restart', state: 'skipped', log: '', startedAt: t0 + 20000, endedAt: t0 + 20001 },
  ];
}

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification tiroir de déploiement',
  );

  /* Aucun agent ne doit pouvoir démarrer : ce contrôle ne dépense rien. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: 'Essai — tiroir de déploiement',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

  const carte = (id, titre, position) => {
    const donnees = {
      id,
      projectId: PROJET_ID,
      title: titre,
      description: 'Carte d’essai posée en base.',
      column: 'in_production',
      position,
      origin: 'user',
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      scheduling: { asap: false, attempts: 1, restarts: 0, suspendu: false },
      excludedFromDeploy: false,
      horsTache: false,
      deployedAt: DEPLOYE_LE,
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, PROJET_ID, 'in_production', position, titre, JSON.stringify(donnees), DEPLOYE_LE, maintenant, maintenant);
  };
  carte('c-1', 'Première carte', 1);
  carte('c-2', 'Seconde carte', 2);
  /* Une carte que rien ne revendique : elle doit former son propre groupe, dit
     en clair, jamais rangée d'office sous la publication voisine. */
  carte('c-3', 'Carte posée à la main', 3);

  const run = {
    id: RUN_ID,
    projectId: PROJET_ID,
    state: 'success',
    cible: 'dev',
    cardIds: ['c-1', 'c-2'],
    steps: etapesAvecFil(),
    queued: false,
    startedAt: DEPLOYE_LE,
    endedAt: DEPLOYE_LE + 21000,
  };
  db.prepare(
    'INSERT INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(run.id, PROJET_ID, run.state, JSON.stringify(run), run.startedAt, run.endedAt);

  /* Une publication TOMBÉE, plus récente, sur la même carte : elle n'a rien mis
     en ligne et ne doit revendiquer personne. */
  const rate = {
    id: AUTRE_RUN,
    projectId: PROJET_ID,
    state: 'failed',
    cible: 'dev',
    cardIds: ['c-1'],
    steps: [{ key: 'merge', state: 'failed', log: 'conflit', startedAt: DEPLOYE_LE + 60000 }],
    queued: false,
    error: 'conflit de fusion',
    startedAt: DEPLOYE_LE + 60000,
    endedAt: DEPLOYE_LE + 61000,
  };
  db.prepare(
    'INSERT INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(rate.id, PROJET_ID, rate.state, JSON.stringify(rate), rate.startedAt, rate.endedAt);

  db.close();
}

async function ouvrirLeTableau(navigateur) {
  const contexte = await navigateur.newContext({
    viewport: { width: 1500, height: 950 },
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
  await page.waitForTimeout(3000);
  return { page, erreurs };
}

async function voletDeLEcran() {
  if (!(await attendrePort())) {
    noter('le démon d’essai répond', false, journal.join('').slice(-600));
    return;
  }
  noter('le démon d’essai répond', true);
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  try {
    const { page, erreurs } = await ouvrirLeTableau(navigateur);

    /* Le projet d'essai est le seul : un clic sur sa ligne ouvre son tableau. */
    const ligne = page.locator(`[data-drag-id="${PROJET_ID}"]`).first();
    if (await ligne.count()) await ligne.click();
    await page.waitForTimeout(2500);

    const bandeaux = page.locator('[data-groupe-production]');
    const nombre = await bandeaux.count();
    noter('la colonne « En production » range ses cartes par groupe', nombre >= 2, `${nombre} bandeau(x)`);

    /* REPLIÉS PAR DÉFAUT : aucune des trois cartes d'essai ne se montre, chaque
       groupe dessine sa pile à la place. */
    const cartesRepliees = await page.locator('[data-carte]').count();
    noter('les groupes démarrent REPLIÉS : aucune carte à l’écran', cartesRepliees === 0, `${cartesRepliees} carte(s)`);
    const piles = await page.locator('[data-pile-groupe]').count();
    noter('chaque groupe replié montre sa pile', piles === nombre, `${piles} pile(s)`);

    const titre = nombre ? ((await bandeaux.first().textContent()) ?? '').trim() : '';
    noter(
      'le groupe porte le titre daté de sa publication et son compte',
      /Déploiement du 17 août, 14:32/.test(titre) && /2 tâches/.test(titre),
      titre.slice(0, 90),
    );

    const sans = page.locator('[data-groupe-production="aucun"]');
    noter(
      'ce qui n’est rattaché à aucune publication le DIT, sans bouton',
      (await sans.count()) === 1 && (await sans.first().evaluate((n) => n.tagName)) !== 'BUTTON',
    );

    /* Une publication TOMBÉE ne revendique rien : la carte « c-1 » reste dans le
       groupe de la publication réussie, donc il n'y a bien que DEUX groupes. */
    noter('une publication tombée ne revendique aucune carte', nombre === 2, `${nombre} groupes`);

    /* CLIQUER LE TITRE DÉPLIE LE GROUPE, RECLIQUER LE REPLIE. */
    const titreDuGroupe = page.locator(`[data-basculer-groupe="${RUN_ID}"]`).first();
    await titreDuGroupe.click();
    await page.waitForTimeout(300);
    const carteApresDepliage = await page.locator('[data-carte]').count();
    noter(
      'cliquer le titre DÉPLIE le groupe : ses deux cartes apparaissent',
      carteApresDepliage === 2,
      `${carteApresDepliage} carte(s)`,
    );
    const pileApresDepliage = await page.locator('[data-pile-groupe]').count();
    noter('la pile du groupe déplié s’efface', pileApresDepliage === nombre - 1, `${pileApresDepliage} pile(s)`);

    await titreDuGroupe.click();
    await page.waitForTimeout(300);
    const carteApresRepli = await page.locator('[data-carte]').count();
    noter('recliquer REPLIE le groupe : ses cartes s’effacent à nouveau', carteApresRepli === 0, `${carteApresRepli} carte(s)`);

    const bouton = page.locator(`[data-historique-groupe="${RUN_ID}"]`).first();
    noter('le groupe porte un bouton vers son historique', (await bouton.count()) === 1);
    if (await bouton.count()) {
      await bouton.click();
      await page.waitForTimeout(1200);

      const ouvert = page.locator('[data-tiroir-deploiement]');
      noter('le clic ouvre un vrai TIROIR', (await ouvert.count()) === 1);

      /* L'étape de fusion s'ouvre à la main : son fil doit s'y lire. */
      const ligneFusion = page.locator('[data-ouvrir-etape="merge"]').first();
      noter('le tiroir montre les étapes de cette publication', (await ligneFusion.count()) === 1);
      if (await ligneFusion.count()) {
        const resume = ((await ligneFusion.textContent()) ?? '').trim();
        noter('une étape annonce ce qu’elle a à raconter', /6 moments/.test(resume), resume.slice(0, 80));
        await ligneFusion.click();
        await page.waitForTimeout(500);
      }

      const moments = page.locator('[data-fil-etape="merge"] [data-moment-fil]');
      const combien = await moments.count();
      noter('le FIL de l’étape se lit, moment par moment', combien === 6, `${combien} moments`);

      const heures = page.locator('[data-fil-etape="merge"] [data-heure-moment]');
      const premiere = (await heures.count()) ? ((await heures.first().textContent()) ?? '').trim() : '';
      noter('chaque moment porte son heure, secondes comprises', /^14:32:0\d$/.test(premiere), premiere);

      const commande = page.locator('[data-fil-etape="merge"] [data-moment-fil="commande"]');
      noter('les commandes réellement lancées se lisent', (await commande.count()) >= 1);
      const depannage = page.locator('[data-fil-etape="merge"] [data-moment-fil="depannage"]');
      noter('le passage d’un agent de dépannage se lit', (await depannage.count()) === 1);

      /* UN HISTORIQUE NE SE REJOUE PAS : aucun bouton de décision dedans. */
      const texteTiroir = (await ouvert.first().textContent()) ?? '';
      noter(
        'l’historique ne propose ni « Relancer » ni « Arrêter » : on relit',
        !/Relancer|Arrêter/.test(texteTiroir),
      );

      /* Une étape SAUTÉE ne s'affiche pas. */
      noter(
        'une étape sautée n’est pas affichée',
        (await page.locator('[data-etape-process="restart"]').count()) === 0,
      );
    }

    noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await navigateur.close();
  }
}

/* ------------------------------------------------------------------ */

try {
  voletDuServeur();
  await voletDeLEcran();
} catch (erreur) {
  noter('le contrôle est allé au bout', false, String(erreur?.message ?? erreur));
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées.`);
/* Le démon d'essai tourne en tuyaux : sa boucle garderait ce script vivant
   indéfiniment. On nettoie et on sort explicitement. */
nettoyer();
process.exit(echecs.length ? 1 : 0);
