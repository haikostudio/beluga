#!/usr/bin/env node
/**
 * Le menu de choix du modèle dit-il la VÉRITÉ sur sa liste ?
 *
 * Deux choses se vérifient dans un vrai navigateur :
 *   1. les identifiants du serveur et du menu correspondent exactement — aucun
 *      n'est escamoté par un homonyme ou une famille voisine ;
 *   2. quand le catalogue n'a pas pu être lu, le menu ANNONCE une liste de
 *      secours et en donne la cause, au lieu de laisser croire à une liste
 *      complète.
 *
 *   node scripts/verif-liste-modeles.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve ;
 * il garde le HOME de la machine pour que les comptes réels soient déclarés —
 * c'est ce qui décide si la liste est vraie ou de secours. Aucun moteur n'est
 * lancé, rien n'est publié.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

/* La racine du dépôt d'où part CE script : depuis une copie de travail, on juge
   le code de la copie, jamais celui du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7198);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(RACINE, 'data', 'verification');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { TMP, DATA, PROJETS, DEPOT, demon, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-modeles-',
  port: PORT,
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const AGENT_ID = 'a-chef-essai';
const CARTE_ID = 'c-modeles-essai';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now() - 60_000;
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3600_000,
    'vérification liste des modèles',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  for (const table of ['proposals', 'messages', 'agents', 'cards', 'projects']) db.prepare(`DELETE FROM ${table}`).run();

  const projet = {
    id: PROJET_ID,
    name: 'Essai modèles',
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

  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    title: 'Vérifier le catalogue GPT',
    description: '',
    labels: [],
    column: 'planned',
    position: 0,
    run: { engine: 'codex', thinking: 'medium', mode: 'direct' },
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    'INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(CARTE_ID, PROJET_ID, 'planned', 0, carte.title, JSON.stringify(carte), t, t);

  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    cardId: CARTE_ID,
    role: 'cadrage',
    title: 'Chef d’orchestre — Essai modèles',
    run: { engine: 'codex', thinking: 'medium', mode: 'direct' },
    status: 'done',
    endedAt: Date.now(),
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, 'cadrage', 'done', ?, ?, ?)`,
  ).run(AGENT_ID, PROJET_ID, CARTE_ID, JSON.stringify(agent), t, t);
  db.close();
}

fs.mkdirSync(SHOTS, { recursive: true });
if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}
poserLeDecor();

/* Ce que le serveur annonce : c'est la référence à laquelle comparer l'écran.
   On relit le catalogue avec le code du démon, sur les comptes de la machine. */
process.env.BELUGA_DATA = DATA;
const { listEngines } = await import(path.join(RACINE, 'server', 'dist', 'engines', 'index.js'));
const moteurs = await listEngines(true);
const codex = moteurs.find((e) => e.id === 'codex');
if (codex) {
  console.log(
    `Catalogue Codex du serveur : ${codex.models.length} modèle(s), liste ${codex.live ? 'du moteur' : 'de secours'}` +
      (codex.catalogError ? ` (${codex.catalogError})` : ''),
  );
}

const navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
});
const contexte = await navigateur.newContext({
  viewport: { width: 1400, height: 900 },
  locale: 'fr-CH',
  serviceWorkers: 'block',
});
await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
const page = await contexte.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);

const carte = page.locator('article').filter({ hasText: 'Vérifier le catalogue GPT' }).first();
if (await carte.count()) {
  await carte.click();
  await page.waitForTimeout(2000);
}

/* La carte neuve donne directement accès à chaque réglage : la ligne
   « Modèle » ouvre SOUS ELLE un menu, qui est la liste des modèles du moteur
   affiché. Choisir referme ce menu : on ne presse donc JAMAIS Échap après un
   choix — il refermerait la page de la carte. */
const menuOuvert = page.locator('[role="menu"][data-state="open"]');
const attendreLeMenuReferme = () => menuOuvert.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
const valeurDeLaLigne = (nom) =>
  page.locator(`[data-ligne-configuration="${nom}"] [data-valeur]`).first().getAttribute('data-valeur');
const menu = page.locator('[data-ligne-configuration="Modèle"]');
const ouvert = await menu.count();
noter('la ligne « Modèle » de la configuration est à l’écran', ouvert > 0, `${ouvert} ligne(s)`);
if (!ouvert) {
  console.log(`Écran atteint : ${await page.title()} — ${page.url()}`);
  console.log((await page.locator('body').innerText()).slice(0, 1200));
  await page.screenshot({ path: path.join(SHOTS, 'liste-modeles-echec.png'), fullPage: true });
}
if (ouvert) {
  await menu.first().click();
  await page.waitForTimeout(1200);
  const choixModeles = page.locator('[data-modele-id]');
  const lignes = await choixModeles.allTextContents();
  const idsAffiches = await choixModeles.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-modele-id')));
  const repli = await page.locator('[data-repli="liste-de-secours"]').first();
  const aRepli = (await repli.count()) > 0;
  const texteRepli = aRepli ? (await repli.textContent())?.trim() : '';

  console.log(`Modèles affichés dans le menu : ${lignes.length}`);
  for (const ligne of lignes) console.log(`  · ${ligne.replace(/\s+/g, ' ').trim()}`);

  const attendus = codex?.models?.length ?? 0;
  const idsAttendus = (codex?.models ?? []).map((modele) => modele.id);
  noter(
    'les identifiants du menu correspondent exactement à ceux du serveur',
    attendus > 0 && JSON.stringify(idsAffiches) === JSON.stringify(idsAttendus),
    `${idsAffiches.join(', ')} / ${idsAttendus.join(', ')}`,
  );
  noter(
    'aucun modèle n’est escamoté par un homonyme',
    new Set((codex?.models ?? []).map((m) => m.id)).size === attendus,
    `${new Set((codex?.models ?? []).map((m) => m.id)).size} identifiants distincts`,
  );
  if (codex && !codex.live) {
    noter('la liste de secours est annoncée dans le menu', aRepli && /secours/i.test(texteRepli), texteRepli || 'rien');
  } else {
    noter('une liste venue du moteur n’affiche aucun avertissement', !aRepli, texteRepli || 'aucun');
  }

  /* Choisir un AUTRE modèle doit modifier la configuration que le prochain
     prompt transmettra au moteur. On juge l'état enregistré et le libellé de
     l'écran, jamais la position ni la hauteur du menu. */
  const modeleInitial = codex?.defaultModel ?? codex?.models?.[0]?.id;
  const indexAutre = (codex?.models ?? []).findIndex((modele) => modele.id !== modeleInitial);
  if (indexAutre >= 0) {
    const autre = codex.models[indexAutre];
    await choixModeles.nth(indexAutre).click();
    await page.waitForTimeout(800);

    const db = new Database(path.join(DATA, 'beluga.db'));
    const modeleEnregistre = db.prepare('SELECT run_model FROM cards WHERE id = ?').get(CARTE_ID)?.run_model;
    db.close();
    await attendreLeMenuReferme();
    noter('choisir un modèle referme le menu', (await menuOuvert.count()) === 0);
    const modeleAffiche = await valeurDeLaLigne('Modèle');

    noter(
      'choisir un autre modèle met à jour la configuration du prochain prompt',
      modeleEnregistre === autre.id,
      modeleEnregistre ?? 'absent',
    );
    noter('le modèle choisi est aussitôt affiché', modeleAffiche === autre.label, modeleAffiche ?? 'absent');
  } else {
    noter('un autre modèle est disponible pour vérifier le changement', false);
  }

  /* Le moteur visible et sa liste forment un seul état. Un aller-retour GPT →
     Claude → GPT ne doit jamais laisser les modèles de l'écran précédent dans
     le menu, même si le choix enregistré ne leur appartient plus. Chaque ligne
     ouvre SON menu ; un choix le referme, et la ligne dit la valeur retenue. */
  const claude = moteurs.find((e) => e.id === 'claude' && e.installed && e.models.length);
  if (claude) {
    await page.locator('[data-ligne-configuration="Moteur"]').first().click();
    await page.locator('[data-moteur-id="claude"]').click();
    await attendreLeMenuReferme();
    await page.waitForTimeout(400);
    const moteurClaude = await valeurDeLaLigne('Moteur');
    await page.locator('[data-ligne-configuration="Modèle"]').first().click();
    await page.locator('[data-modele-id]').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    const idsClaude = await page.locator('[data-modele-id]').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-modele-id')),
    );
    noter(
      'passer de GPT à Claude accorde le titre et la liste',
      moteurClaude === claude.label && JSON.stringify(idsClaude) === JSON.stringify(claude.models.map((modele) => modele.id)),
      `${moteurClaude ?? 'absent'} — ${idsClaude.join(', ')}`,
    );
    await page.locator('[data-modele-id]').first().click();
    await attendreLeMenuReferme();
    await page.waitForTimeout(400);
    await page.locator('[data-ligne-configuration="Moteur"]').first().click();
    await page.locator('[data-moteur-id="codex"]').click();
    await attendreLeMenuReferme();
    await page.waitForTimeout(400);
    const moteurGpt = await valeurDeLaLigne('Moteur');
    await page.locator('[data-ligne-configuration="Modèle"]').first().click();
    await page.locator('[data-modele-id]').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    const idsRetourGpt = await page.locator('[data-modele-id]').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-modele-id')),
    );
    noter(
      'revenir de Claude à GPT accorde le titre et la liste',
      moteurGpt === codex?.label && JSON.stringify(idsRetourGpt) === JSON.stringify(idsAttendus),
      `${moteurGpt ?? 'absent'} — ${idsRetourGpt.join(', ')}`,
    );
  } else {
    noter('Claude est disponible pour vérifier le changement de moteur', false);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  /* Le menu des modèles est resté ouvert par le dernier clic ; si le passage au
     téléphone l'a refermé, la ligne « Modèle » le rouvre — en panneau du bas. */
  if (!(await page.locator('[data-modele-id]').count())) {
    await page.locator('[data-ligne-configuration="Modèle"]').first().click().catch(() => {});
    await page.waitForTimeout(800);
  }
  noter(
    'sur téléphone, tous les identifiants GPT restent accessibles par défilement',
    (await page.locator('[data-modele-id]').count()) === idsAttendus.length,
    `${await page.locator('[data-modele-id]').count()} affiché(s) pour ${idsAttendus.length}`,
  );
  await page.screenshot({ path: path.join(SHOTS, 'liste-modeles.png') });
}

await navigateur.close();
console.log(`\n${resultats.filter((r) => r.ok).length}/${resultats.length} contrôles passés`);
process.exit(resultats.every((r) => r.ok) ? 0 : 1);
