#!/usr/bin/env node
/**
 * LA ZONE « EN COURS », LES PROJETS RETENUS ET LA BULLE DE LA FRISE, DANS UN VRAI NAVIGATEUR (01/11/2026).
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-zone-en-cours-et-bulle.mjs
 *
 * Démon d'essai sur une base neuve, port à soi, aucun moteur lancé. Ce qui est vérifié :
 *   1. entre « Nouvel agent » et les projets, la zone « En cours » liste, tous projets confondus, ce qui
 *      n'est pas archivé (demande, travail, à déployer), quelle que soit sa date — la demande de huit
 *      jours comprise (13/11/2026 au soir) —, ni la rangée, ni la déployée déjà ouverte ; la déployée pas
 *      encore ouverte y est EN GRAS ;
 *   2. un clic sur la déployée l'ouvre et la retire de la zone, rechargement compris ;
 *   3. la zone se replie, et reste repliée au rechargement ;
 *   4. trois projets ouverts restent ouverts après un rechargement (et en base) ;
 *   1 bis. depuis la tâche ouverte d'un projet, un clic dans la zone sur la tâche d'un AUTRE projet
 *      ouvre cette tâche et l'y laisse (le clic ne referme plus la page qu'il ouvre) ; le nom d'un projet
 *      ouvre sa dernière tâche ACTIVE — jamais une archivée, même plus récente ou retenue —, et un projet
 *      tout archivé montre sa page au bouton centré ;
 *   5. Studio : un double-clic sur la musique ouvre sa bulle (volume, coupure du son) ; couper le son
 *      écrit une version, Ctrl+Z la défait ; glisser le bloc ne l'ouvre pas ; « Tout régler » ouvre la
 *      grande fenêtre, sans bulle.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7247);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.BELUGA_VERIF_CAPTURES;
const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-zone-en-cours-', port: PORT });
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const MAINTENANT = Date.now();
const H = 3600_000;
const base = (options) => new Database(path.join(DATA, 'beluga.db'), options);

function projet(db, id, name, rank) {
  const p = { id, name, path: `${DEPOT}-${id}`, defaultEngine: 'claude', isSelf: false, rank, archived: false, createdAt: MAINTENANT, updatedAt: MAINTENANT };
  fs.mkdirSync(p.path, { recursive: true });
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(id, name, p.path, JSON.stringify(p), MAINTENANT, MAINTENANT);
}

function carte(db, id, projectId, column, title, quand, extra = {}) {
  const c = {
    id, projectId, title, description: '', labels: [], column, position: quand,
    origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    excludedFromDeploy: false, horsTache: false, codeDejaEnregistre: false, createdAt: quand, updatedAt: quand,
    ...extra,
  };
  db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, last_read_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, projectId, column, quand, title, JSON.stringify(c), c.deployedAt ?? null, c.lastReadAt ?? null, quand, quand,
  );
}

function poserLeDecor() {
  const db = base();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), MAINTENANT, MAINTENANT + 3600_000, 'essai');
  projet(db, 'p-un', 'Un', 1);
  projet(db, 'p-deux', 'Deux', 2);
  projet(db, 'p-trois', 'Trois', 3);
  projet(db, 'p-quatre', 'Quatre', 4);
  carte(db, 'c-demande', 'p-un', 'planned', 'Une demande récente', MAINTENANT - 1 * H);
  carte(db, 'c-travail', 'p-deux', 'running', 'Un travail en cours', MAINTENANT - 2 * H);
  carte(db, 'c-a-deployer', 'p-un', 'to_deploy', 'Un travail à déployer', MAINTENANT - 3 * H, { lastReadAt: MAINTENANT - 2 * H });
  carte(db, 'c-vieille', 'p-trois', 'planned', 'Une demande de huit jours', MAINTENANT - 8 * 24 * H);
  carte(db, 'c-rangee', 'p-trois', 'archived', 'Une tâche rangée', MAINTENANT - 4 * H, { lastReadAt: MAINTENANT - 4 * H });
  carte(db, 'c-deployee', 'p-deux', 'archived', 'Une tâche déployée', MAINTENANT - 5 * H, { deployedAt: MAINTENANT - 5 * H, lastReadAt: MAINTENANT - 6 * H });
  carte(db, 'c-deployee-lue', 'p-un', 'archived', 'Une déployée déjà ouverte', MAINTENANT - 6 * H, { deployedAt: MAINTENANT - 7 * H, lastReadAt: MAINTENANT - 6 * H });
  carte(db, 'c-quatre-rangee', 'p-quatre', 'archived', 'Tout est rangé ici', MAINTENANT - 9 * H, { lastReadAt: MAINTENANT - 9 * H });
  /* Le souvenir de « Trois » pointe une carte ARCHIVÉE, plus récente que sa seule active : il ne compte pas. */
  db.prepare('INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('card.open.p-trois', JSON.stringify('c-rangee'), MAINTENANT);

  /* UNE CRÉATION DU STUDIO avec une musique sur sa piste. */
  const sortie = path.join(DATA, 'attachments', 'piece-musique-musique.mp4');
  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=270x480:d=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sortie]);
  const taille = fs.statSync(sortie).size;
  db.prepare('INSERT INTO attachments (id, project_id, sha, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    'piece-musique', 'p-un', 'piece-musique', JSON.stringify({ id: 'piece-musique', projectId: 'p-un', name: 'musique.mp4', mime: 'video/mp4', size: taille, sha: 'piece-musique', createdAt: MAINTENANT }), MAINTENANT,
  );
  db.prepare('INSERT OR IGNORE INTO studio_espaces (project_id, kit, cree_le, maj_le) VALUES (?, ?, ?, ?)').run('p-un', '{}', MAINTENANT, MAINTENANT);
  db.prepare("INSERT INTO studio_medias (id, project_id, creation_id, genre, provenance, nom, attachment_id, mime, duree, cree_le) VALUES ('med-musique', 'p-un', 'cre-son', 'audio', 'import', 'Musique', 'piece-musique', 'video/mp4', 6, ?)").run(MAINTENANT);
  const composition = { format: '9:16', fond: '#101828', dureeVoulue: 12, pistes: [
    { id: 'visuels', genre: 'visuel', nom: 'Visuels', segments: [
      { id: 'titre', genre: 'texte', debut: 0, duree: 6, nom: 'Titre', texte: 'Le son', taille: 96, couleur: '#ffffff', position: { x: 50, y: 40 }, gras: true },
    ] },
    { id: 'musique', genre: 'son', nom: 'Musique', segments: [
      { id: 'm1', genre: 'audio', debut: 0, duree: 6, nom: 'Musique', mediaId: 'med-musique', debutMedia: 0, volume: 0.8 },
    ] },
  ] };
  db.prepare('INSERT INTO studio_creations (id, project_id, titre, formats, etat, version, agent_id, card_id, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, ?, ?)').run('cre-son', 'p-un', 'Création sonore', JSON.stringify(['9:16']), 'brouillon', MAINTENANT, MAINTENANT);
  db.prepare('INSERT INTO studio_versions (creation_id, numero, parent, composition, raison, auteur, cree_le) VALUES (?, 1, NULL, ?, ?, ?, ?)').run('cre-son', JSON.stringify(composition), 'création', 'humain', MAINTENANT);
  db.close();
}

const pref = (cle) => {
  const db = base({ readonly: true });
  const ligne = db.prepare('SELECT value FROM preferences WHERE key = ?').get(cle);
  db.close();
  return ligne ? JSON.parse(ligne.value) : undefined;
};
const volumeDeLaMusique = () => {
  const db = base({ readonly: true });
  /* La version COURANTE (annuler déplace le pointeur, il n'écrit pas de version). */
  const v = db.prepare("SELECT v.composition FROM studio_versions v JOIN studio_creations c ON c.id = v.creation_id AND c.version = v.numero WHERE c.id = 'cre-son'").get();
  db.close();
  return JSON.parse(v.composition).pistes.find((p) => p.id === 'musique').segments[0]?.volume;
};

let navigateur;
try {
  if (!(await attendrePort())) throw new Error(`Le démon d’essai n’a pas démarré :\n${journal.join('')}`);
  poserLeDecor();
  navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  const contexte = await navigateur.newContext({ viewport: { width: 1500, height: 950 }, locale: 'fr-CH' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const aside = 'aside[data-zone="gauche"] ';
  const zone = `${aside}[data-taches-en-cours-colonne] `;

  /* 1. La zone et ce qu'elle porte */
  await page.goto(`${BASE}/#en-route`);
  await page.locator(`${zone}[data-agent-en-cours]`).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(600);
  const ids = await page.locator(`${zone}[data-agent-en-cours]`).evaluateAll((els) => els.map((el) => el.getAttribute('data-agent-en-cours')));
  noter('1. la zone liste tout ce qui n’est pas archivé, plus la déployée pas encore ouverte, de la plus récente à la plus ancienne', ids.join(',') === 'c-demande,c-travail,c-a-deployer,c-deployee,c-vieille', ids.join(','));
  const nombre = await page.locator(`${zone}[data-nombre-taches-en-cours]`).getAttribute('data-nombre-taches-en-cours');
  noter('1. son titre dit le nombre de tâches', nombre === '5', nombre ?? '');
  const place = await page.evaluate(() => {
    const r = (s) => document.querySelector(`aside[data-zone="gauche"] ${s}`)?.getBoundingClientRect();
    const premier = Math.min(...[...document.querySelectorAll('aside[data-zone="gauche"] [data-projet-cible], aside[data-zone="gauche"] [data-groupe-projets]')].map((el) => el.getBoundingClientRect().top));
    /* « NOUVEL ARTEFACT » A QUITTÉ LA COLONNE (carte « Beluga piloté par des agents », 26/11/2026) : la zone « Au travail »
       se pose sous la tête (« Tableaux de bord »). */
    return { tete: r('[data-tete-de-colonne]')?.bottom, haut: r('[data-taches-en-cours-colonne]')?.top, bas: r('[data-taches-en-cours-colonne]')?.bottom, premier };
  });
  noter('1. elle se pose entre la tête de la colonne et les projets', place.haut >= place.tete && place.bas <= place.premier, JSON.stringify(place));
  const gras = await page.locator(`${zone}[data-agent-en-cours="c-deployee"] [data-titre-agent]`).evaluate((el) => ({ poids: getComputedStyle(el).fontWeight, opacite: getComputedStyle(el.closest('[data-agent-en-cours]')).opacity }));
  noter('1. la déployée pas encore ouverte est en gras, sans pâlir', Number(gras.poids) >= 600 && gras.opacite === '1', JSON.stringify(gras));
  /* Depuis le 14/11/2026, la pastille du projet EST l'icône de la ligne, l'état à son coin. */
  /* « AU TRAVAIL » (26/11/2026) : le visage de l'agent qui porte la tâche, ou — son équipe pas encore lue — l'icône du projet. */
  const pastilles = await page.locator(`${zone}[data-agent-en-cours] :is([data-icone-agent-projet] [data-rond-d-etat], [data-portrait-d-agent])`).count();
  noter('1. chaque ligne porte le visage de son agent (ou l’icône de son projet)', pastilles === ids.length && ids.length > 0, `${pastilles} / ${ids.length}`);
  if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'zone-en-cours.png') });

  /* 1 bis. Le clic dans la zone ouvre l'agent, même d'un autre projet ; le nom d'un projet ouvre sa dernière active */
  {
    const carteAffichee = (id) => page.locator(`[data-page-carte="${id}"]`).waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
    await page.goto(`${BASE}/#projet/p-un/tache/c-demande`);
    const depart = await carteAffichee('c-demande');
    await page.waitForTimeout(800);
    await page.locator(`${zone}[data-agent-en-cours="c-travail"] button`).first().click();
    await page.waitForTimeout(1500);
    const apres = await page.evaluate(() => ({ hash: location.hash, cartes: [...document.querySelectorAll('[data-page-carte]')].map((el) => el.getAttribute('data-page-carte')) }));
    noter('1 bis. depuis une tâche d’un autre projet, un clic dans « En cours » ouvre la tâche et l’y laisse', depart && apres.hash.includes('/tache/c-travail') && apres.cartes.includes('c-travail'), JSON.stringify(apres));
    await page.locator(`${zone}[data-agent-en-cours="c-a-deployer"] button`).first().click();
    await page.waitForTimeout(1500);
    const retour = await page.evaluate(() => ({ hash: location.hash, cartes: [...document.querySelectorAll('[data-page-carte]')].map((el) => el.getAttribute('data-page-carte')) }));
    noter('1 bis. …et de nouveau vers un troisième projet', retour.hash.includes('/tache/c-a-deployer') && retour.cartes.includes('c-a-deployer'), JSON.stringify(retour));
    /* LE NOM D'UN PROJET OUVRE LA PAGE DE SON ÉQUIPE (26/11/2026) : la discussion et le volet « Équipe | Tâches ». */
    await page.locator(`${aside}[data-drag-id="p-trois"] :is(a, button)`).first().click();
    const equipe = await page.locator('[data-gabarit-equipe="projet"]').waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
    noter('1 bis. le nom d’un projet ouvre la page de son équipe, jamais l’archivée retenue', equipe && (await page.locator('[data-page-carte="c-rangee"]').count()) === 0);
    await page.locator(`${aside}[data-drag-id="p-quatre"] :is(a, button)`).first().click();
    const accueil = await page.locator('[data-accueil-du-projet]').waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
    await page.waitForTimeout(800);
    noter('1 bis. un projet tout archivé montre sa page au bouton centré', accueil && (await page.locator('[data-page-carte]').count()) === 0 && (await page.locator('[data-accueil-du-projet]').count()) >= 1);
  }

  /* 2. Un clic sur la déployée la retire */
  await page.locator(`${zone}[data-agent-en-cours="c-deployee"] button`).first().click();
  const partie = await page.locator(`${zone}[data-agent-en-cours="c-deployee"]`).waitFor({ state: 'detached', timeout: 10000 }).then(() => true, () => false);
  noter('2. un clic sur la déployée l’ouvre et la retire de la zone', partie);
  await page.goto(`${BASE}/#en-route`);
  await page.locator(`${zone}[data-agent-en-cours]`).first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(600);
  noter('2. …et elle ne revient pas au rechargement', (await page.locator(`${zone}[data-agent-en-cours="c-deployee"]`).count()) === 0);

  /* 3. Le repli de la zone est retenu */
  await page.locator(`${zone}[data-tete-taches-en-cours]`).click();
  await page.waitForTimeout(500);
  noter('3. la zone se replie d’un clic', (await page.locator(`${zone}[data-agent-en-cours]`).count()) === 0);
  await page.reload();
  await page.locator(`${zone}[data-tete-taches-en-cours]`).waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(600);
  noter('3. …et reste repliée au rechargement', (await page.locator(`${zone}[data-agent-en-cours]`).count()) === 0 && pref('sidebar.tachesEnCoursRepliees') === true);
  await page.locator(`${zone}[data-tete-taches-en-cours]`).click();
  await page.waitForTimeout(400);

  /* 4. Trois projets ouverts restent ouverts */
  for (const id of ['p-un', 'p-deux', 'p-trois']) {
    const fleche = page.locator(`${aside}[data-deplier-taches="${id}"]`);
    if ((await fleche.getAttribute('aria-expanded')) !== 'true') await fleche.click();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(800);
  await page.reload();
  await page.locator(`${aside}[data-deplier-taches="p-trois"]`).waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1200);
  const ouverts = [];
  for (const id of ['p-un', 'p-deux', 'p-trois']) if ((await page.locator(`${aside}[data-deplier-taches="${id}"]`).getAttribute('aria-expanded')) === 'true') ouverts.push(id);
  const enBase = pref('sidebar.projetsDeplies') ?? [];
  noter('4. trois projets ouverts restent ouverts après un rechargement', ouverts.length === 3, ouverts.join(','));
  noter('4. …et la base les retient tous les trois', ['p-un', 'p-deux', 'p-trois'].every((id) => enBase.includes(id)), JSON.stringify(enBase));

  /* 5. La bulle de la frise */
  await page.goto(`${BASE}/#studio/cre-son`);
  const bloc = page.locator('[data-studio-rangee-ligne-de-temps] [data-studio-segment="m1"]');
  await bloc.waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1500);
  const boite = await bloc.boundingBox();
  await page.mouse.click(boite.x + boite.width / 2, boite.y + boite.height / 2);
  const bulle = page.locator('[data-bulle-reglages="m1"]');
  await page.waitForTimeout(500);
  noter('5. un simple clic n’ouvre pas la bulle', (await bulle.count()) === 0);
  await page.mouse.dblclick(boite.x + boite.width / 2, boite.y + boite.height / 2);
  const ouverte = await bulle.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
  noter('5. un double-clic sur la musique ouvre sa bulle de réglages', ouverte);
  if (ouverte) {
    const rb = await bulle.boundingBox();
    noter('5. la bulle est collée au bloc', Math.abs(rb.y - (boite.y + boite.height)) <= 16 || Math.abs(rb.y + rb.height - boite.y) <= 16, JSON.stringify({ bulle: rb.y, bloc: boite.y + boite.height }));
    noter('5. elle porte le volume et la coupure du son', (await bulle.locator('[data-ligne-libelle]').filter({ hasText: 'Volume' }).count()) === 1 && (await bulle.locator('[data-bulle-couper-le-son="son"]').count()) === 1);
    await page.waitForTimeout(500);
    const opacite = await bulle.evaluate((el) => getComputedStyle(el).opacity);
    noter('5. posée, la bulle est opaque et couvre ce qui est dessous', opacite === '1', opacite);
    if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'bulle-de-reglages.png') });
    await bulle.locator('[data-bulle-couper-le-son]').click();
    await page.waitForTimeout(1000);
    noter('5. couper le son écrit une version à volume nul', volumeDeLaMusique() === 0, String(volumeDeLaMusique()));
    noter('5. le bouton dit que le son est coupé', (await bulle.locator('[data-bulle-couper-le-son="muet"]').count()) === 1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    noter('5. Échap referme la bulle', (await bulle.count()) === 0);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(1000);
    noter('5. Ctrl+Z rend le volume d’avant', volumeDeLaMusique() === 0.8, String(volumeDeLaMusique()));
  }
  /* Glisser le bloc ne l'ouvre pas. */
  const avant = await bloc.boundingBox();
  await page.mouse.move(avant.x + avant.width / 2, avant.y + avant.height / 2);
  await page.mouse.down();
  await page.mouse.move(avant.x + avant.width / 2 + 30, avant.y + avant.height / 2, { steps: 6 });
  await page.mouse.move(avant.x + avant.width / 2 + 60, avant.y + avant.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  noter('5. glisser le bloc ne l’ouvre pas', (await page.locator('[data-bulle-reglages]').count()) === 0);
  /* « Tout régler » ouvre la grande fenêtre, et la bulle se referme. */
  await bloc.dblclick();
  await page.locator('[data-bulle-tout-regler]').click();
  const fenetre = await page.locator('[data-studio-editeur-element="m1"]').waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
  noter('5. « Tout régler » ouvre la grande fenêtre, sans bulle', fenetre && (await page.locator('[data-bulle-reglages]').count()) === 0);
  await contexte.close();
} catch (erreur) {
  noter('déroulé du contrôle', false, String(erreur?.stack ?? erreur).split('\n').slice(0, 4).join(' | '));
} finally {
  await navigateur?.close();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passent.`);
process.exit(echecs.length ? 1 : 0);
