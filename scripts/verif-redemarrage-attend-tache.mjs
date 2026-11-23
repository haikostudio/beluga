#!/usr/bin/env node
/**
 * JAMAIS DE REDÉMARRAGE TANT QU'UNE TÂCHE TOURNE.
 *
 *   node scripts/verif-redemarrage-attend-tache.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve —
 * le démon de production n'est jamais touché, et pour cause : c'est justement
 * son redémarrage réel qu'on observe ici. Un « moteur » factice (un script qui
 * dort quelques secondes puis sort) tient lieu d'agent réellement AU TRAVAIL —
 * pas une ligne posée en base, mais un vrai processus dans la table `live` du
 * démon, celle que regarde le bouton de redémarrage.
 *
 * Ce qui est vérifié :
 *   1. tant que le faux moteur tourne, une demande de redémarrage — au clic
 *      dans un vrai navigateur comme par commande brute — est REFUSÉE et
 *      RETENUE, jamais exécutée ;
 *   2. la ligne « Serveur » des réglages passe sur « Redémarrage
 *      requis », sa raison écrite en clair dessous, le point du bouton des
 *      réglages dit « retenu », et la fenêtre NOMME ce qu'elle va interrompre
 *      avant d'offrir de FORCER ;
 *   3. dès que le faux moteur se termine, le redémarrage retenu part tout
 *      seul, sans neuf geste.
 */
import { chromium } from 'playwright';
import * as ws from 'ws';
import Database from 'better-sqlite3';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7192);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-redemarrage-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Un faux moteur : un vrai processus qui dort, puis sort              */
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

const FAUX_MOTEUR = path.join(TMP, 'faux-claude.sh');
const DUREE_S = 6;
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/bin/sh\ncat >/dev/null &\nsleep ${DUREE_S}\nexit 0\n`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
    BELUGA_CLAUDE_BIN: FAUX_MOTEUR,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const journal = [];
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));
let sorti = false;
demon.on('exit', () => (sorti = true));

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

async function attendre(condition, limiteMs = 15000, pasMs = 300) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, pasMs));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Le décor : un projet, un agent AU REPOS (le vrai travail part par WS) */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const AGENT_ID = 'ag-essai';

function base(readonly = false) {
  return new Database(path.join(DATA, 'beluga.db'), readonly ? { readonly: true } : undefined);
}

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification redémarrage',
  );

  const projet = {
    id: PROJET_ID,
    name: 'Essai redémarrage',
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

  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    role: 'cadrage',
    title: 'Conversation d’essai',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(agent.id, PROJET_ID, null, 'cadrage', 'idle', JSON.stringify(agent), maintenant, maintenant);

  const compte = {
    id: 'compte-essai',
    engine: 'claude',
    label: 'Compte d’essai',
    priority: 1,
    configDir: path.join(TMP, 'claude-config'),
  };
  db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    compte.id,
    compte.engine,
    JSON.stringify(compte),
    maintenant,
  );

  db.close();
}

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const prise = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Cookie: `beluga_session=${jeton}` } });
    const id = crypto.randomBytes(6).toString('hex');
    const minuteur = setTimeout(() => (prise.close(), reject(new Error('le démon ne répond pas'))), 20000);
    prise.on('open', () => prise.send(JSON.stringify({ id, cmd })));
    prise.on('message', (brut) => {
      const evenement = JSON.parse(String(brut));
      if (evenement.type !== 'ack' || evenement.id !== id) return;
      clearTimeout(minuteur);
      prise.close();
      resolve(evenement);
    });
    prise.on('error', (e) => (clearTimeout(minuteur), reject(e)));
  });
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  /*
   * LE REDÉMARRAGE VIT DANS LES RÉGLAGES (page « Serveur »), plus dans
   * le menu des trois points. Fenêtre fermée, son état se lit sur le POINT du
   * bouton des réglages, au pied de la colonne de gauche.
   */
  const POINT = '[data-reglages-menu] [data-point-redemarrage]';
  const BOUTON = '[data-reglages-serveur] [data-bouton-redemarrage="reglages"]';
  const pointAuRepos = (await page.locator(POINT).first().getAttribute('data-etat-redemarrage').catch(() => '')) ?? '';
  noter('le point de redémarrage est visible sur le bouton des réglages, au repos', pointAuRepos === 'repos', pointAuRepos);
  noter(
    'la barre d’en-tête et son bouton « … » ne portent plus ce point',
    (await page.locator('header [data-point-redemarrage], [data-menu-general] [data-point-redemarrage]').count()) === 0 &&
      (await page.locator('header button[aria-label="Menu"]').count()) === 0,
  );

  /** Ouvre la fenêtre des réglages sur « Serveur » — et ne fait rien si elle y est déjà. */
  const ouvrirLaPageServeur = async () => {
    if ((await page.locator('[data-modale-reglages]').count()) === 0) {
      await page.click('[data-reglages-menu]', { timeout: 10000 });
      await page.waitForSelector('[data-modale-reglages]', { timeout: 10000 });
    }
    if ((await page.locator(BOUTON).count()) === 0) {
      await page.click('[data-menu-reglages] [data-page-menu="serveur"]', { timeout: 10000 });
    }
    await page.waitForSelector(BOUTON, { state: 'visible', timeout: 10000 });
  };

  /**
   * La LIGNE du redémarrage, telle qu'elle se lit : son libellé, la raison
   * écrite dessous, et la place qu'elles prennent dans la page.
   */
  const lireLaLigne = () =>
    page.evaluate((selecteur) => {
      const bouton = document.querySelector(selecteur);
      const terminal = document.querySelector('[data-reglages-serveur] [data-terminal-bouton]');
      if (!bouton || !terminal) return null;
      // La ligne : le plus haut ancêtre du bouton qui ne contient pas le terminal.
      let ligne = bouton;
      while (ligne.parentElement && !ligne.parentElement.contains(terminal)) ligne = ligne.parentElement;
      // Ses textes, dans l'ordre, hors du bouton lui-même.
      const textes = [];
      const marcheur = document.createTreeWalker(ligne, NodeFilter.SHOW_TEXT);
      for (let noeud = marcheur.nextNode(); noeud; noeud = marcheur.nextNode()) {
        const texte = noeud.textContent.trim();
        if (!texte || bouton.contains(noeud)) continue;
        const cadre = noeud.parentElement.getBoundingClientRect();
        textes.push({ texte, haut: cadre.top, bas: cadre.bottom, droite: cadre.right });
      }
      const page = document.querySelector('[data-page-reglages="serveur"]');
      const fenetre = document.querySelector('[data-modale-reglages]')?.getBoundingClientRect();
      return {
        libelle: textes[0]?.texte ?? '',
        raison: textes.slice(1).map((t) => t.texte).join(' '),
        raisonSousLeLibelle: textes.length > 1 && textes[1].haut >= textes[0].bas - 1,
        // Rien ne déborde : ni la ligne hors de la page, ni la page hors de la fenêtre.
        tientDansLaPage:
          !!page && !!fenetre && ligne.scrollWidth <= ligne.clientWidth + 1 && ligne.getBoundingClientRect().right <= fenetre.right + 1 && bouton.getBoundingClientRect().right <= fenetre.right + 1,
        largeurFenetre: Math.round(fenetre?.width ?? 0),
        bulles: ligne.querySelectorAll('[data-bulle-info-bouton]').length,
        etat: bouton.getAttribute('data-etat-redemarrage'),
      };
    }, BOUTON);

  // La page est ouverte AVANT de lancer la tâche : le faux moteur ne dort que
  // quelques secondes, et tout ce qui suit doit se lire pendant qu'il travaille.
  await ouvrirLaPageServeur();
  const ligneAuRepos = await lireLaLigne();
  noter(
    'au repos, la ligne des réglages propose « Redémarrer le serveur », sans raison ni « i »',
    ligneAuRepos?.libelle === 'Redémarrer le serveur' && ligneAuRepos.raison === '' && ligneAuRepos.bulles === 0 && ligneAuRepos.etat === 'repos',
    JSON.stringify(ligneAuRepos),
  );

  /* -------- 1. Lance une vraie tâche (le faux moteur, un vrai processus) -------- */

  const envoi = await commande({ type: 'agent.prompt', agentId: AGENT_ID, text: 'dis bonjour' });
  noter('la demande part sans erreur', envoi.ok !== false, JSON.stringify(envoi));

  const enTravail = await attendre(async () => {
    const etat = await commande({ type: 'daemon.status' });
    return (etat.data?.etat?.agentsEnCours ?? 0) > 0;
  });
  noter('le démon voit un agent réellement au travail', enTravail);

  /* -------- 2. Demande un redémarrage pendant que ça tourne -------- */

  const refus = await commande({ type: 'daemon.restart' });
  noter('le redémarrage est REFUSÉ tant que l’agent travaille', refus.data?.ok === false, JSON.stringify(refus));
  noter(
    'la raison nomme l’agent au travail',
    /agent/i.test(refus.data?.raison ?? ''),
    refus.data?.raison ?? '(aucune)',
  );
  noter('le processus du démon n’a PAS quitté', !sorti);

  /*
   * ON VISE LE BOUTON PAR SON REPÈRE, JAMAIS PAR SON TEXTE. `:has-text()` ignore
   * la casse : « Essai redémarrage », le nom du projet de ce décor, matchait
   * « Redémarrage » et recevait le clic à sa place. La fenêtre ne s'ouvrait donc
   * jamais, et le bloc qui la vérifiait — muet — n'en disait rien.
   */
  // « Redémarrer » est un bouton de la page « Serveur », déjà ouverte.
  await ouvrirLaPageServeur();
  await page.click(BOUTON);
  await page.waitForTimeout(600);
  const dialogue = page.getByRole('dialog').filter({ hasText: 'Redémarrer le serveur ?' });

  /*
   * LA FENÊTRE DIT CE QU'ELLE VA INTERROMPRE, ET OFFRE DE FORCER.
   *
   * Forcer est un geste de dernier recours, pris les yeux ouverts : le second
   * bouton n'a de sens que si la fenêtre a d'abord nommé ce qui sera coupé. Les
   * deux se vérifient ici, sur un agent RÉELLEMENT au travail — c'est la seule
   * situation où ils s'affichent.
   */
  const ouverte = (await dialogue.count()) > 0;
  noter('le clic ouvre bien la fenêtre du redémarrage', ouverte);

  if (ouverte) {
    const annonce = await dialogue.locator('[data-redemarrage-interrompu]').innerText().catch(() => '');
    noter(
      'la fenêtre NOMME ce qui va être interrompu avant de confirmer',
      /interrompus/i.test(annonce) && /agent/i.test(annonce),
      annonce.slice(0, 120),
    );
    noter(
      'elle offre un bouton « Forcer le redémarrage », distinct de « Redémarrer »',
      (await dialogue.locator('[data-redemarrage-force]').count()) === 1,
    );
    noter(
      'et ce bouton ne part JAMAIS tout seul : le serveur est toujours là',
      !sorti,
    );

    // « Redémarrer dès que possible » quand un travail retient : le geste pose
    // la demande retenue, il ne force rien.
    await dialogue.getByRole('button', { name: /^Redémarrer/ }).click();
    await page.waitForTimeout(1200);
  }

  // La fenêtre de confirmation s'est refermée sur la page des réglages, restée
  // ouverte dessous : on y lit la ligne telle qu'elle se présente maintenant.
  await ouvrirLaPageServeur().catch(() => undefined);
  const ligne = await lireLaLigne();
  await page.screenshot({ path: path.join(TMP, 'redemarrage-requis.png') });

  /*
   * LA RAISON S'ÉCRIT EN CLAIR SOUS LE LIBELLÉ, PLUS DERRIÈRE UN « i ». Dans le
   * menu des trois points, sa phrase écrite sur une ligne étirait le menu sur
   * la moitié de l'écran : elle vivait donc derrière une bulle. Une page de
   * réglages a la place de la dire — à condition qu'elle passe à la ligne au
   * lieu de pousser le bouton hors de la fenêtre.
   */
  noter(
    'la raison tient dans la page des réglages, sans l’étirer ni pousser le bouton hors de la fenêtre',
    !!ligne?.tientDansLaPage && ligne.largeurFenetre > 0,
    `fenêtre de ${ligne?.largeurFenetre ?? 0} px`,
  );
  noter(
    'la raison est écrite en clair sous le libellé de la ligne, plus derrière un « i »',
    !!ligne && /travail|agent|retient/i.test(ligne.raison) && ligne.raisonSousLeLibelle && ligne.bulles === 0 && !/travail|agent|retient/i.test(ligne.libelle),
    JSON.stringify(ligne),
  );
  // « Le clic sur le « i » ouvre la bulle » et « …n'ouvre pas la confirmation » sont retirés : il n'y a plus de « i », la raison se lit sans geste.
  noter(
    'après le clic, la ligne des réglages affiche « Redémarrage requis »',
    /Redémarrage requis/i.test(ligne?.libelle ?? ''),
    ligne?.libelle ?? '',
  );
  noter('le bouton « Redémarrer » des réglages dit « retenu », et reste actif', ligne?.etat === 'retenu' && (await page.locator(BOUTON).isEnabled().catch(() => false)), ligne?.etat ?? '');
  noter(
    'la fenêtre de confirmation s’est refermée après le geste',
    (await page.getByRole('dialog').filter({ hasText: 'Redémarrer le serveur ?' }).count()) === 0,
  );

  // Le point du bouton des réglages, lui, se lit fenêtre FERMÉE.
  for (let essai = 0; essai < 3 && (await page.locator('[data-modale-reglages]').count()) > 0; essai++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  const pointApresClic = (await page.locator(POINT).first().getAttribute('data-etat-redemarrage').catch(() => '')) ?? '';
  noter(
    'après le clic, réglages refermés, le point du bouton des réglages dit « retenu »',
    pointApresClic === 'retenu' && (await page.locator('[data-modale-reglages]').count()) === 0,
    pointApresClic,
  );
  await page.screenshot({ path: path.join(TMP, 'redemarrage-point.png') });

  /* -------- 3. Le faux moteur finit : le redémarrage part tout seul -------- */

  const redemarreToutSeul = await attendre(() => sorti, DUREE_S * 1000 + 15000, 400);
  noter('dès la fin de la tâche, le démon redémarre TOUT SEUL', redemarreToutSeul);

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) console.log(`(captures et journal dans ${TMP})`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.join(''));
  process.exit(1);
});
