#!/usr/bin/env node
/**
 * LA SYNTHÈSE DU BESOIN OUVRE-T-ELLE VRAIMENT LA CONVERSATION DE LA CARTE ?
 *
 * Le contexte discuté avec le chef d'orchestre ne doit plus dormir dans
 * l'onglet « Détails » : il est déposé en PREMIER MESSAGE du fil de l'agent,
 * lisible AVANT le lancement — donc sur une carte qui n'a encore aucun agent.
 *
 * Le relevé se fait dans un vrai navigateur, sur ordinateur puis sur téléphone :
 *   1. la conversation d'une carte jamais lancée montre la synthèse, sous son
 *      titre, et plus « Aucun échange pour le moment » ;
 *   2. l'onglet « Détails » ne la recopie pas : il dit seulement où elle est ;
 *   3. une carte SANS synthèse garde son fil vide — rien n'est inventé.
 *
 * Une carte d'essai est posée en base le temps du relevé, puis retirée ; le
 * projet ouvert au départ est remis en place en partant.
 *
 * À REJOUER APRÈS LA MISE EN LIGNE. Le relevé d'écran passe par le DÉMON EN
 * SERVICE (l'interface de développement lui parle par son proxy) : tant qu'il
 * tourne l'ancien code, il renvoie la carte SANS son champ « briefing » — son
 * schéma ne le connaît pas encore — et le fil s'ouvre donc vide. Le contrôle
 * s'arrête alors en le DISANT, au lieu de faire passer un défaut d'installation
 * pour un défaut d'affichage. Redémarrer le démon est un geste de l'utilisateur.
 *
 * NE LANCE JAMAIS UN DÉMON D'ESSAI DEPUIS LE DÉPÔT pour contourner cette
 * attente, même sur un autre port et une autre base : au démarrage, un démon
 * REFERME les dossiers de carte laissés ouverts du dépôt réel — y compris celui
 * de l'agent qui vient de le lancer, qui perd son dossier de travail en pleine
 * tâche. `HAIKO_SYNTHESE_DB` ne sert qu'à viser une instance lancée AILLEURS.
 *
 *   node scripts/verif-synthese-dans-le-fil.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import { messageDeSynthese, TITRE_SYNTHESE } from '../shared/dist/synthese-du-besoin.js';

/* On vise le serveur de DÉVELOPPEMENT : HAIKODEV_URL, posée pour les agents,
   pointe l'application déjà publiée — on y verrait l'ancienne version. */
const BASE = process.env.HAIKO_SYNTHESE_URL || 'http://localhost:7099';
/* La base visée. Par défaut celle du démon en service ; un démon d'ESSAI à soi
   (HAIKODEV_DATA + HAIKODEV_PORT) se vise en posant HAIKO_SYNTHESE_DB. */
const BASE_DB = process.env.HAIKO_SYNTHESE_DB || '/root/haikodev/data/haikodev.db';
const DEMON_EN_SERVICE = !process.env.HAIKO_SYNTHESE_DB;
const CLE_PROJET_ACTIF = 'project.active';
const TITRE_AVEC = 'Essai — synthèse déposée dans le fil';
const TITRE_SANS = 'Essai — carte sans synthèse';

const SYNTHESE = [
  "L'utilisateur discute longuement du besoin avec le chef d'orchestre avant qu'une carte existe.",
  "Il veut que tout ce contexte parte avec la carte, et se lise dans la conversation de l'agent.",
  'Le titre reste court, la description reformule la demande : la synthèse porte le reste.',
  'Elle doit être visible avant le lancement, pour être relue et corrigée à temps.',
].join('\n\n');

/** Le démon EN SERVICE connaît-il déjà la synthèse ? Sans lui, rien à relever. */
const WS_EN_SERVICE = '/root/haikodev/server/dist/ws.js';
function demonAJour() {
  try {
    return fs.readFileSync(WS_EN_SERVICE, 'utf8').includes('filAvecLaSynthese');
  } catch {
    return false;
  }
}

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

function poserSession(db) {
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification synthèse dans le fil',
  );
  return { cookie, empreinte };
}

/** Une carte du chef d'orchestre, jamais lancée : aucun agent, donc aucun message en base. */
function poserCarteEssai(db, projectId, titre, briefing) {
  const id = crypto.randomUUID();
  const maintenant = Date.now();
  const carte = {
    id,
    projectId,
    title: titre,
    description: 'Carte posée par un script de vérification. Elle disparaît toute seule à la fin du relevé.',
    labels: [],
    column: 'planned',
    position: -1,
    origin: 'agent',
    attachments: [],
    ...(briefing ? { briefing } : {}),
    run: { engine: 'claude', model: 'claude-opus-5', thinking: 'medium', mode: 'direct' },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, projectId, 'planned', -1, titre, JSON.stringify(carte), maintenant, maintenant);
  return id;
}

function viserProjet(db, projectId) {
  const avant = db.prepare('SELECT value FROM preferences WHERE key = ?').get(CLE_PROJET_ACTIF);
  db.prepare(
    'INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(CLE_PROJET_ACTIF, JSON.stringify(projectId), Date.now());
  return avant ? avant.value : null;
}

function nettoyer(db, { cartes = [], empreinte, projetAvant }) {
  for (const carteId of cartes) if (carteId) db.prepare('DELETE FROM cards WHERE id = ?').run(carteId);
  if (empreinte) db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  if (projetAvant === null) db.prepare('DELETE FROM preferences WHERE key = ?').run(CLE_PROJET_ACTIF);
  else if (projetAvant !== undefined)
    db.prepare(
      'INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    ).run(CLE_PROJET_ACTIF, projetAvant, Date.now());
}

/** Ouvre le tiroir d'une carte et rend son dialogue. */
async function ouvrirLaCarte(context, titre, projetNom, mobile) {
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  /* L'application rouvre le dernier panneau consulté : tant qu'un dialogue est
     là, son voile intercepte les clics sur le tableau. On le referme à la
     touche d'échappement, qui marche sur les deux écrans. */
  for (let essai = 0; essai < 4; essai += 1) {
    if (!(await page.locator('[role="dialog"]').count())) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  }

  const extrait = titre.slice(0, 30);
  if (!(await page.locator(`article:has-text(${JSON.stringify(extrait)})`).count())) {
    if (mobile) {
      await page.locator('header button[aria-label="Projets"]').click();
      await page.waitForTimeout(1200);
    }
    const ligne = page.getByText(projetNom, { exact: true }).first();
    await ligne.waitFor({ state: 'visible', timeout: 15000 });
    await ligne.click();
    await page.waitForTimeout(3000);
  }

  const carteVue = page.locator('article').filter({ hasText: extrait }).first();
  await carteVue.scrollIntoViewIfNeeded().catch(() => {});
  await carteVue.waitFor({ state: 'visible', timeout: 15000 });
  await carteVue.click();
  await page.waitForTimeout(2000);
  return { page, tiroir: page.locator('[role="dialog"]').last() };
}

/** Un projet vivant, sur lequel poser les cartes d'essai. */
function projetDAccueil(db) {
  return db
    .prepare(`SELECT id, name FROM projects WHERE archived = 0 ORDER BY updated_at DESC LIMIT 1`)
    .get();
}

async function main() {
  const db = new Database(BASE_DB);
  let projet = projetDAccueil(db);
  let projetPose;
  if (!projet) {
    // Base d'essai toute neuve : on lui pose un projet, retiré en partant.
    projetPose = crypto.randomUUID();
    const maintenant = Date.now();
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      projetPose,
      'Projet d’essai',
      '/tmp',
      0,
      JSON.stringify({
        id: projetPose,
        name: 'Projet d’essai',
        path: '/tmp',
        defaultEngine: 'claude',
        isSelf: false,
        archived: false,
        createdAt: maintenant,
        updatedAt: maintenant,
      }),
      maintenant,
      maintenant,
    );
    projet = { id: projetPose, name: 'Projet d’essai' };
  }

  /* ---------------- 1. La règle, jouée seule ---------------- */

  noter('la synthèse se relit telle quelle, sans habillage', messageDeSynthese(SYNTHESE) === SYNTHESE);
  noter('une carte sans synthèse n’ouvre aucun message', messageDeSynthese(undefined) === undefined);

  /* ---------------- 2. L'écran, dans un vrai navigateur ---------------- */

  if (DEMON_EN_SERVICE && !demonAJour()) {
    console.log(
      "\nRelevé d'écran IMPOSSIBLE : le démon en service tourne encore l'ancien code (" +
        `${WS_EN_SERVICE} ne connaît pas « filAvecLaSynthese »).\n` +
        "Il renverrait la carte sans sa synthèse, et le fil s'ouvrirait vide. " +
        'À rejouer une fois la mise en ligne faite.',
    );
    db.close();
    process.exit(2);
  }

  const cartes = [];
  let empreinte;
  let projetAvant;
  let navigateur;
  try {
    projetAvant = viserProjet(db, projet.id);
    cartes.push(poserCarteEssai(db, projet.id, TITRE_AVEC, SYNTHESE));
    cartes.push(poserCarteEssai(db, projet.id, TITRE_SANS, null));
    const session = poserSession(db);
    empreinte = session.empreinte;

    navigateur = await chromium.launch({
      channel: 'chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
    });

    for (const ecran of [
      { nom: 'ordinateur', viewport: { width: 1440, height: 900 }, mobile: false },
      { nom: 'téléphone', viewport: { width: 390, height: 844 }, mobile: true },
    ]) {
      const context = await navigateur.newContext({
        viewport: ecran.viewport,
        locale: 'fr-CH',
        ignoreHTTPSErrors: true,
        serviceWorkers: 'block',
        isMobile: ecran.mobile,
        hasTouch: ecran.mobile,
      });
      await context.addCookies([
        { name: 'haikodev_session', value: session.cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
      ]);

      /* -------- La carte AVEC synthèse : son fil s'ouvre dessus -------- */
      const avec = await ouvrirLaCarte(context, TITRE_AVEC, projet.name, ecran.mobile);
      await avec.tiroir.getByRole('tab', { name: 'Conversation' }).click();
      await avec.page.waitForTimeout(1500);

      const bloc = avec.tiroir.locator('div').filter({ hasText: TITRE_SYNTHESE }).last();
      const vu = await bloc.count();
      noter(`${ecran.nom} — la conversation s’ouvre sur la synthèse, sous son titre`, vu > 0);

      const texte = (await avec.tiroir.innerText()).replace(/\s+/g, ' ');
      noter(
        `${ecran.nom} — le texte du besoin est bien là, entier`,
        texte.includes('Le titre reste court, la description reformule la demande'),
      );
      noter(
        `${ecran.nom} — plus aucun « Aucun échange pour le moment » sur cette carte`,
        !texte.includes('Aucun échange pour le moment'),
      );

      await avec.tiroir.getByRole('tab', { name: 'Détails' }).click();
      await avec.page.waitForTimeout(900);
      const details = (await avec.tiroir.innerText()).replace(/\s+/g, ' ');
      noter(
        `${ecran.nom} — les détails DISENT où est la synthèse, sans la recopier`,
        details.includes('déposée en premier message de la conversation') &&
          !details.includes('Le titre reste court, la description reformule la demande'),
      );
      await avec.page.close();

      /* -------- La carte SANS synthèse : rien n'est inventé -------- */
      const sans = await ouvrirLaCarte(context, TITRE_SANS, projet.name, ecran.mobile);
      await sans.tiroir.getByRole('tab', { name: 'Conversation' }).click();
      await sans.page.waitForTimeout(1500);
      const filVide = (await sans.tiroir.innerText()).replace(/\s+/g, ' ');
      noter(
        `${ecran.nom} — une carte sans synthèse garde son fil vide`,
        filVide.includes('Aucun échange pour le moment') && !filVide.includes(TITRE_SYNTHESE),
      );
      await sans.page.close();
      await context.close();
    }
  } finally {
    if (navigateur) await navigateur.close().catch(() => {});
    nettoyer(db, { cartes, empreinte, projetAvant });
    if (projetPose) db.prepare('DELETE FROM projects WHERE id = ?').run(projetPose);
    db.close();
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  if (echecs.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
