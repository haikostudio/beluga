#!/usr/bin/env node
/**
 * AUCUNE MODIFICATION À DÉPLOYER NE DOIT RESTER INVISIBLE.
 *
 * Le fait constaté le 17/08/2026 : la tête de la colonne annonçait
 * « À DÉPLOYER 1 » pendant que la colonne, juste dessous, écrivait « Rien à
 * mettre en ligne pour l'instant ». Le chiffre venait du bloc de publication
 * (cartes du lot + travail enregistré sans carte), la liste des cartes
 * réellement posées : deux lectures pour une seule colonne.
 *
 * Deux volets, tous deux joués pour de vrai.
 *
 * A. LE DÉPÔT (dossiers d'essai à soi, aucun serveur) — `commitsEnAttente` ne
 *    compte comme « sans carte » que ce qui l'est vraiment : ni les FUSIONS,
 *    ni ce qui vit sur la branche d'une carte, ni la plomberie de publication.
 *    C'est ce tri qui faisait annoncer onze modifications anonymes là où il n'y
 *    en avait aucune.
 *
 * B. L'ÉCRAN (vrai navigateur, serveur de DÉVELOPPEMENT) — le compteur de
 *    chaque tête de colonne dit EXACTEMENT le nombre de cartes affichées, dans
 *    les deux sens, et la phrase « Rien à mettre en ligne » ne cohabite jamais
 *    avec un avertissement de travail sans carte.
 *
 * Ce que ce contrôle NE fait PAS : il ne fabrique pas de travail sans carte sur
 * un vrai projet pour voir l'encart s'afficher — cela demanderait d'écrire dans
 * le dépôt du serveur en service. Le texte de l'encart est verrouillé côté
 * règle pure (`server/src/test/colonne-a-deployer.test.ts`), sa présence à
 * l'écran est jugée ici quand le cas se présente de lui-même.
 *
 *   node scripts/verif-colonne-a-deployer.mjs
 *   HAIKO_COLONNE_URL=http://localhost:7099 node scripts/verif-colonne-a-deployer.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* Le script juge le dépôt d'où il PART, jamais /root/haikodev en dur. */
const racineDuDepot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* On vise le serveur de DÉVELOPPEMENT : `HAIKODEV_URL`, posée pour les agents,
   désigne l'application DÉJÀ PUBLIÉE — on y verrait l'ancienne version. */
const BASE = process.env.HAIKO_COLONNE_URL || 'http://localhost:7099';
const BASE_DB = '/root/haikodev/data/haikodev.db';

let echecs = 0;
const dire = (ok, texte) => {
  if (!ok) echecs += 1;
  console.log(`${ok ? '  ok  ' : '  RATÉ'} ${texte}`);
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

/* ------------------------------------------------------------------ */
/* A. LE DÉPÔT : ce qui compte comme « sans carte », et ce qui n'y compte pas */
/* ------------------------------------------------------------------ */

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-colonne-a-deployer-'));
process.env.HAIKODEV_DATA = path.join(racine, 'data');
fs.mkdirSync(process.env.HAIKODEV_DATA, { recursive: true });

const store = await import(path.join(racineDuDepot, 'server/dist/store.js'));
const { commitsEnAttente } = await import(path.join(racineDuDepot, 'server/dist/deploy.js'));
const { compteurEtListeDAccord, alerteTravailSansCarte } = await import(
  path.join(racineDuDepot, 'shared/dist/index.js')
);

console.log('\nA. Ce qui attend sans carte, et ce qui n’attend pas');

const cwd = path.join(racine, 'depot');
fs.mkdirSync(cwd, { recursive: true });
git(cwd, 'init', '-q', '-b', 'main');
git(cwd, 'config', 'user.email', 'essai@haikodev');
git(cwd, 'config', 'user.name', 'Essai');
fs.writeFileSync(path.join(cwd, 'README.md'), '# essai\n');
git(cwd, 'add', 'README.md');
git(cwd, 'commit', '-q', '-m', 'départ');
const depart = git(cwd, 'rev-parse', 'HEAD').trim();

/* 1. Du travail d'une CARTE : sur sa branche, puis fusionné dans la principale.
      Il a sa fiche — il ne doit jamais compter comme anonyme, MÊME si personne
      n'a jamais ouvert l'onglet « GitHub » de la carte (c'est exactement ce qui
      manquait : `shasCouverts` reste alors vide). */
git(cwd, 'checkout', '-q', '-b', 'tache/le-travail-dune-carte');
fs.writeFileSync(path.join(cwd, 'carte.txt'), 'le travail de la carte\n');
git(cwd, 'add', 'carte.txt');
git(cwd, 'commit', '-q', '-m', 'Le travail porté par une carte');
git(cwd, 'checkout', '-q', 'main');
git(cwd, 'merge', '-q', '--no-ff', 'tache/le-travail-dune-carte', '-m', 'Fusion de main : le travail de la carte');

/* 2. Du travail VRAIMENT sans carte : commité droit sur la principale. */
fs.writeFileSync(path.join(cwd, 'anonyme.txt'), 'une correction menée sans carte\n');
git(cwd, 'add', 'anonyme.txt');
git(cwd, 'commit', '-q', '-m', 'Corriger le calcul de TVA');

/* 3. De la PLOMBERIE de publication : ce n'est pas du travail. */
fs.writeFileSync(path.join(cwd, 'plomberie.txt'), 'x\n');
git(cwd, 'add', 'plomberie.txt');
git(cwd, 'commit', '-q', '-m', 'Travaux en cours enregistrés avant publication');

const maintenant = Date.now();
const projet = store.saveProject({
  id: store.newId(),
  name: 'essai-colonne',
  path: cwd,
  defaultEngine: 'claude',
  isSelf: false,
  rank: 1000,
  archived: false,
  deploiement: { constate: true },
  createdAt: maintenant,
  updatedAt: maintenant,
});
/* La carte porte SA BRANCHE, et rien d'autre : aucun relevé GitHub, aucun sha.
   C'est le cas ordinaire — le relevé n'existe que si l'onglet a été ouvert. */
store.saveCard({
  id: store.newId(),
  projectId: projet.id,
  title: 'Le travail porté par une carte',
  description: '',
  labels: [],
  column: 'done',
  position: 1,
  origin: 'user',
  run: { engine: 'claude' },
  excludedFromDeploy: false,
  horsTache: false,
  github: { branch: 'tache/le-travail-dune-carte' },
  createdAt: maintenant,
  updatedAt: maintenant,
});
/* Un déploiement réussi au point de DÉPART : c'est lui qui borne la plage. */
store.saveDeploy({
  id: store.newId(),
  projectId: projet.id,
  state: 'success',
  cible: 'dev',
  targetCommit: depart,
  cardIds: [],
  steps: [],
  startedAt: maintenant - 60_000,
  endedAt: maintenant - 50_000,
});

const attente = await commitsEnAttente(projet.id);
dire(attente.nombre === 1, `un seul travail anonyme est compté (${attente.nombre})`);
dire(
  attente.titres.includes('Corriger le calcul de TVA'),
  `il est NOMMÉ : ${JSON.stringify(attente.titres)}`,
);
dire(
  !attente.titres.some((t) => /Fusion de main/.test(t)),
  'une FUSION n’est pas comptée comme du travail sans carte',
);
dire(
  !attente.titres.some((t) => /porté par une carte/.test(t)),
  'le travail d’une carte n’est pas anonyme, même sans relevé GitHub',
);
dire(
  !attente.titres.some((t) => /Travaux en cours enregistrés/.test(t)),
  'la plomberie de publication n’est pas du travail',
);

const alerte = alerteTravailSansCarte(attente);
dire(!!alerte && /1 modification sans carte/.test(alerte.titre), `l’encart le dit : « ${alerte?.titre} »`);

fs.rmSync(racine, { recursive: true, force: true });

/* ------------------------------------------------------------------ */
/* B. L'ÉCRAN : le compteur dit ce que la liste montre                  */
/* ------------------------------------------------------------------ */

console.log('\nB. À l’écran : le compteur et la liste, dans les deux sens');

let session = null;
let navigateur = null;
try {
  const { chromium } = await import('playwright');
  const Database = (await import('better-sqlite3')).default;

  /* Une session d'une heure, fabriquée puis retirée. Le jeton est HACHÉ en base
     et n'est jamais réutilisé ; on ne reprend JAMAIS `HAIKODEV_TOKEN`. */
  const db = new Database(BASE_DB);
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    t,
    t + 3600_000,
    'vérification colonne à déployer',
  );
  db.close();
  session = { token, empreinte };

  navigateur = await chromium.launch({ channel: 'chrome' });
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
  /* La session voyage par COOKIE, comme dans tous les autres contrôles. */
  await contexte.addCookies([{ name: 'haikodev_session', value: token, domain: 'localhost', path: '/' }]);
  const page = await contexte.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  /* Un projet doit être OUVERT pour que le tableau existe : on prend le
     premier de la liste, par le point d'essai déjà utilisé ailleurs. */
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    const projets = window.haikodevEssai?.projets?.() ?? [];
    if (projets.length) window.haikodevEssai.ouvrirProjet(projets[0].id);
  });
  await page.waitForSelector('[data-column]', { timeout: 30000 });
  /* Les cartes arrivent avec le premier envoi : on laisse le tableau se poser. */
  await page.waitForTimeout(3000);

  const releve = await page.evaluate(() => {
    const out = [];
    for (const colonne of document.querySelectorAll('[data-column]')) {
      const cle = colonne.getAttribute('data-column');
      const compteur = colonne.querySelector(`[data-compteur-colonne="${cle}"]`);
      out.push({
        cle,
        compteur: compteur ? Number(compteur.textContent.trim()) : null,
        cartes: colonne.querySelectorAll('[data-carte]').length,
        palier: !!colonne.querySelector(`[data-palier-cartes="${cle}"]`),
        restantes: Number(
          colonne.querySelector(`[data-palier-cartes="${cle}"]`)?.getAttribute('data-cartes-restantes') ?? 0,
        ),
        sansCarte: colonne.querySelector(`[data-travail-sans-carte="${cle}"]`)
          ? Number(colonne.querySelector(`[data-travail-sans-carte="${cle}"]`).getAttribute('data-sans-carte-nombre'))
          : null,
        rienAMettreEnLigne: /Rien à mettre en ligne/.test(colonne.textContent ?? ''),
      });
    }
    return out;
  });

  dire(releve.length > 0, `${releve.length} colonnes relevées à l’écran`);
  for (const col of releve) {
    dire(col.compteur !== null, `« ${col.cle} » porte bien un compteur`);
    if (col.compteur === null) continue;
    /* Le tableau pose les cartes par paquets de vingt : au-delà, la liste
       affichée est plus courte que le total — et le palier DIT combien il en
       reste. Le compte reste donc exact des deux côtés. */
    const affichees = col.cartes + (col.palier ? col.restantes : 0);
    dire(
      compteurEtListeDAccord(col.compteur, affichees),
      `« ${col.cle} » : ${col.compteur} annoncés = ${col.cartes} posés${
        col.palier ? ` + ${col.restantes} en attente de paquet` : ''
      }`,
    );
    if (col.sansCarte !== null) {
      dire(col.sansCarte > 0, `« ${col.cle} » : l’avertissement nomme ${col.sansCarte} modification(s)`);
      dire(
        !col.rienAMettreEnLigne,
        `« ${col.cle} » : la colonne ne dit plus « rien » alors qu’un travail attend`,
      );
    }
  }
} catch (err) {
  console.log(`  (volet écran non joué : ${err?.message ?? err})`);
  echecs += 1;
} finally {
  if (navigateur) await navigateur.close().catch(() => {});
  if (session) {
    try {
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(BASE_DB);
      db.prepare('DELETE FROM sessions WHERE token = ?').run(session.empreinte);
      db.close();
    } catch {
      /* la session expire d'elle-même dans l'heure */
    }
  }
}

console.log(echecs ? `\n${echecs} vérification(s) en échec.` : '\nTout est vérifié.');
process.exit(echecs ? 1 : 0);
