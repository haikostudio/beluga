#!/usr/bin/env node
/**
 * LES PROJETS RÉUNIS ET LA JAUGE TOUJOURS LÀ — vérifiés dans un VRAI
 * navigateur, sur un démon d'essai (base neuve, deux dépôts d'essai, port
 * libre : le démon de production n'est pas touché, aucun moteur n'est appelé,
 * aucun quota dépensé — `maxAgents: 0` fait refuser tout départ d'agent).
 *
 *  1. La rubrique « Projets » des réglages s'ouvre par son ADRESSE, et réunit
 *     deux projets cochés sous un nom commun.
 *  2. La colonne de gauche montre le projet réuni, replié, avec le nombre de
 *     ses membres ; ses membres ne sont plus des lignes de premier niveau.
 *  3. La flèche déplie le sous-groupe : chaque membre a sa ligne et son bouton
 *     de réglages.
 *  4. La jauge de la barre d'écriture est là sur une carte en cadrage, VIDE
 *     (`data-indicateur-comprehension="0"`) tant qu'aucune note n'est rendue.
 *  5. Lancer une carte MÈRE pose une carte FILLE dans chaque projet touché —
 *     et dans aucun autre —, sans ouvrir de branche commune : la mère n'a pas
 *     d'agent, et aucun dépôt ne reçoit de branche d'un autre.
 *  6. La mère SUIT sa fille : son fil montre, sous « Travail », une ligne par
 *     projet touché avec son état et un lien « Ouvrir » vers la fille.
 *  7. La fille rendue (« À déployer » dans SON projet), la mère se range
 *     directement dans « Archivé », avec une phrase qui ne parle jamais de
 *     déploiement, et « Rapport » donne le compte rendu de la fille.
 *  8. Séparer rend chaque membre autonome.
 *
 *   npm run build   # l'interface servie est web/dist de CETTE copie
 *   node scripts/verif-regroupements.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_REGROUPEMENTS_PORT || 7231);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { TMP, DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-regroupements-',
  port: PORT,
  env: { BELUGA_WEB: process.env.BELUGA_WEB_ESSAI || path.join(RACINE, 'web', 'dist') },
  signaux: true,
});

/* Le second dépôt d'essai : un vrai dépôt git, distinct du premier. */
const DEPOT_B = path.join(TMP, 'depot-b');
fs.mkdirSync(DEPOT_B, { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT_B });
fs.writeFileSync(path.join(DEPOT_B, 'README.md'), '# b\n');
execFileSync('git', ['add', '.'], { cwd: DEPOT_B });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], { cwd: DEPOT_B });

async function attendreLaBase(limiteMs = 30000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
      db.close();
      if (table) return true;
    } catch {
      /* base pas encore là */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const A = 'p-site-a';
const B = 'p-site-b';
const CARTE_A = 'c-cadrage-a';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(JETON),
    maintenant,
    maintenant + 3600_000,
    'vérification des projets réunis',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  for (const [id, name, dossier, rank] of [
    [A, 'Site A', DEPOT, 1],
    [B, 'Site B', DEPOT_B, 2],
  ]) {
    const projet = { id, name, path: dossier, defaultEngine: 'claude', isSelf: false, rank, archived: false, createdAt: maintenant, updatedAt: maintenant };
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run(id, name, dossier, JSON.stringify(projet), maintenant, maintenant);
  }
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, description, data, created_at, updated_at)
     VALUES (?, ?, 'planned', 0, ?, '', '{}', ?, ?)`,
  ).run(CARTE_A, A, 'Carte en cadrage', maintenant, maintenant);
  db.close();
}

function appelDemon(commande) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie: `beluga_session=${JETON}` } });
    const id = crypto.randomUUID();
    const minuteur = setTimeout(() => {
      socket.close();
      reject(new Error('le démon ne répond pas'));
    }, 20000);
    socket.on('open', () => socket.send(JSON.stringify({ id, cmd: commande })));
    socket.on('message', (brut) => {
      const message = JSON.parse(String(brut));
      if (message.id !== id) return;
      clearTimeout(minuteur);
      socket.close();
      if (message.error) reject(new Error(message.error));
      else resolve(message.result ?? {});
    });
    socket.on('error', (err) => {
      clearTimeout(minuteur);
      reject(err);
    });
  });
}

const lireCartes = () => {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const cartes = db.prepare('SELECT id, project_id, column_key, carte_mere_id, data FROM cards').all();
  db.close();
  // Le lien fille → mère est une vraie colonne (`carte_mere_id`), plus un champ du JSON.
  return cartes.map((c) => ({
    ...JSON.parse(c.data),
    id: c.id,
    projectId: c.project_id,
    column: c.column_key,
    ...(c.carte_mere_id ? { carteMereId: c.carte_mere_id } : {}),
  }));
};
/** Ouvre la carte mère dans un vrai navigateur, et rend ce que son fil montre des filles. */
async function lireLeFilDeLaMere(regroupementId, etape) {
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
    await contexte.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    const lignes = page.locator(`[data-point-filles="${etape}"] [data-fille]`);
    /* UN LIEN DIRECT N'OUVRE PAS TOUJOURS LE TIROIR AU PREMIER CHARGEMENT
       (course entre l'instantané du projet et la lecture de l'adresse, hors du
       sujet contrôlé ici) : on recharge, trois fois au plus. */
    for (let essai = 0; essai < 3; essai += 1) {
      await page.goto(`${BASE}/#projet/${regroupementId}/tache/c-mere`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      if (essai) await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      const ouvert = await lignes.first().waitFor({ timeout: 12000 }).then(() => true, () => false);
      if (ouvert) break;
    }
    const filles = await lignes.evaluateAll((els) =>
      els.map((el) => ({
        id: el.getAttribute('data-fille'),
        etat: el.getAttribute('data-fille-etat'),
        texte: el.textContent ?? '',
        lien: !!el.querySelector('[data-ouvrir-fille]'),
      })),
    );
    const diagnostic = await page.evaluate(() => ({
      adresse: window.location.hash,
      points: [...document.querySelectorAll('[data-point]')].map((el) => `${el.getAttribute('data-point')}:${el.getAttribute('data-point-etat')}`),
    }));
    /* LA TUILE DE LA MÈRE, au tableau du projet réuni : elle dit ce que font
       ses filles, jamais « Aucun agent ne travaille ». */
    const tuile = await page.evaluate(() => {
      const carte = document.querySelector('[data-carte="c-mere"]')?.parentElement;
      const restant = carte?.querySelector('[data-travail-restant]');
      return {
        existe: !!carte,
        texte: carte?.textContent ?? '',
        nature: restant?.getAttribute('data-travail-restant-nature') ?? null,
      };
    });
    let adresseApresClic = '';
    if (filles[0]?.lien) {
      await lignes.first().locator('[data-ouvrir-fille]').click();
      await page.waitForFunction((id) => window.location.hash.includes(`/tache/${id}`), filles[0].id, { timeout: 10000 }).catch(() => {});
      adresseApresClic = await page.evaluate(() => window.location.hash);
    }
    await page.screenshot({ path: path.join(RACINE, 'data', 'verification', `projets-reunis-suivi-${etape}.png`) });
    return { filles, adresseApresClic, diagnostic, tuile };
  } finally {
    await navigateur.close();
  }
}

const branches = (dossier) =>
  execFileSync('git', ['branch', '--format=%(refname:short)'], { cwd: dossier, encoding: 'utf8' }).split('\n').filter(Boolean);

async function main() {
  if (!(await attendrePort())) throw new Error(`le démon d'essai n'a jamais ouvert le port ${PORT}`);
  if (!(await attendreLaBase())) throw new Error('la base du démon d’essai n’est jamais apparue');
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let regroupementId = null;
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 860 }, locale: 'fr-CH' });
    await contexte.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-column="planned"]', { timeout: 90000 });

    /* 4. La jauge, vide, sur une carte en cadrage. */
    await page.click(`[data-carte="${CARTE_A}"]`);
    const jauge = page.locator('[data-indicateur-comprehension]');
    await jauge.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    const barres = await jauge.first().getAttribute('data-indicateur-comprehension').catch(() => null);
    noter('La jauge est affichée sur une carte en cadrage, vide tant que rien n’est noté', barres === '0', `barres = ${barres}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    /* 1. La rubrique « Projets », ouverte par son adresse, sur une page neuve. */
    await page.goto(`${BASE}/#reglages/projets`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-page-projets-reunis]', { timeout: 60000 }).catch(async (err) => {
      fs.mkdirSync(path.join(RACINE, 'data', 'verification'), { recursive: true });
      await page.screenshot({ path: path.join(RACINE, 'data', 'verification', 'projets-reunis-echec.png') });
      throw new Error(`${err.message}\nerreurs de page : ${erreurs.join(' | ')}`);
    });
    noter('La rubrique « Projets » des réglages s’ouvre par son adresse', true);
    await page.check(`[data-cocher-projet="${A}"]`);
    await page.check(`[data-cocher-projet="${B}"]`);
    await page.fill('[data-nom-regroupement]', 'Les deux sites');
    await page.click('[data-reunir-projets]');
    await page.waitForSelector('[data-regroupement]', { timeout: 15000 });
    regroupementId = await page.getAttribute('[data-regroupement]', 'data-regroupement');
    const membresListes = await page.locator(`[data-regroupement="${regroupementId}"] [data-membre]`).count();
    noter('Réunir crée le projet réuni, ses deux membres listés', membresListes === 2, `${membresListes} membre(s)`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    /* 2 et 3. La colonne de gauche : repliée, puis dépliée. */
    const ligne = page.locator(`[data-regroupement-colonne="${regroupementId}"]`);
    await ligne.waitFor({ state: 'visible', timeout: 10000 });
    const lignesAutonomes = await page.locator(`[data-drag-id="${A}"], [data-drag-id="${B}"]`).count();
    noter('Les membres ne sont plus des lignes de premier niveau', lignesAutonomes === 0, `${lignesAutonomes} ligne(s)`);
    const replie = (await page.locator(`[data-membres-regroupement="${regroupementId}"]`).count()) === 0;
    noter('Le sous-groupe naît replié', replie);
    await page.click(`[data-deplier-regroupement="${regroupementId}"]`);
    const membres = page.locator(`[data-membres-regroupement="${regroupementId}"] [data-reglages-projet]`);
    await membres.first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
    noter('La flèche déplie les membres, chacun avec ses réglages', (await membres.count()) === 2, `${await membres.count()} bouton(s)`);
    fs.mkdirSync(path.join(RACINE, 'data', 'verification'), { recursive: true });
    await page.screenshot({ path: path.join(RACINE, 'data', 'verification', 'projets-reunis.png') });
    noter('Aucune erreur JavaScript de page', erreurs.length === 0, erreurs.join(' | '));
  } finally {
    await navigateur.close();
  }
  if (!regroupementId) throw new Error('aucun projet réuni créé');

  /* 5. Une carte mère ne touche que les projets nommés, chacun dans son dépôt. */
  const maintenant = Date.now();
  const db = new Database(path.join(DATA, 'beluga.db'));
  const mere = {
    id: 'c-mere',
    projectId: regroupementId,
    title: 'Menu commun',
    column: 'planned',
    position: 0,
    run: { engine: 'claude', thinking: 'none' },
    parcours: {
      plans: [],
      comprehension: {
        texte: 'Un menu identique en tête du site A seulement.',
        hypotheses: [],
        sujets: [],
        projetsTouches: ['site a'],
        partieTechnique: { taches: [{ titre: 'En-tête', description: '' }], faits: [], risques: 'aucun' },
        at: maintenant,
      },
      comprehensionValidee: { at: maintenant, comprehensionAt: maintenant },
    },
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, description, data, created_at, updated_at)
     VALUES (?, ?, 'planned', 0, ?, '', ?, ?, ?)`,
  ).run(mere.id, regroupementId, mere.title, JSON.stringify(mere), maintenant, maintenant);
  db.close();
  const avantA = branches(DEPOT);
  const avantB = branches(DEPOT_B);
  const reponse = await appelDemon({ type: 'card.start', id: 'c-mere' }).catch((err) => ({ erreur: err.message }));
  await new Promise((r) => setTimeout(r, 2500));
  const cartes = lireCartes();
  const lancee = cartes.find((c) => c.id === 'c-mere');
  const filles = cartes.filter((c) => c.carteMereId === 'c-mere');
  noter('Le lancement de la mère répond sans erreur', !reponse.erreur, reponse.erreur ?? '');
  noter(
    'Une seule fille, posée dans le seul projet touché',
    filles.length === 1 && filles[0].projectId === A,
    filles.map((f) => f.projectId).join(', '),
  );
  noter('La mère suit sa fille, sans agent à elle', lancee?.cartesFilles?.length === 1 && !lancee.agentId, `colonne ${lancee?.column}`);
  noter(
    'La fille porte la consigne de ne travailler que dans son dépôt',
    typeof filles[0]?.briefing === 'string' && filles[0].briefing.includes(DEPOT),
  );
  const nouvellesB = branches(DEPOT_B).filter((b) => !avantB.includes(b));
  noter('Le dépôt du projet non touché ne reçoit aucune branche', nouvellesB.length === 0, nouvellesB.join(', '));
  const nouvellesA = branches(DEPOT).filter((b) => !avantA.includes(b));
  noter('Aucune branche commune : au plus une branche de tâche, dans le seul dépôt touché', nouvellesA.every((b) => b.startsWith('tache/')), nouvellesA.join(', ') || 'aucune (départ refusé faute de place)');

  /* 6. La mère suit sa fille, dans son fil. */
  const releve = lireCartes().find((c) => c.id === 'c-mere')?.suiviDesFilles ?? [];
  noter(
    'La mère porte le relevé de sa fille',
    releve.length === 1 && releve[0].cardId === filles[0]?.id && releve[0].etat !== 'fait',
    JSON.stringify(releve),
  );
  const enRoute = await lireLeFilDeLaMere(regroupementId, 'travail');
  noter(
    'Le fil de la mère montre, sous « Travail », la fille avec son projet et son état',
    enRoute.filles.length === 1 && enRoute.filles[0].id === filles[0]?.id && enRoute.filles[0].texte.includes('Site A'),
    JSON.stringify(enRoute.filles),
  );
  noter(
    'La tuile de la mère dit ce que font ses filles, jamais « aucun agent »',
    enRoute.tuile.existe && !enRoute.tuile.texte.includes('Aucun agent ne travaille') && enRoute.tuile.nature !== 'sans-agent',
    JSON.stringify(enRoute.tuile),
  );
  noter(
    'Le lien « Ouvrir » mène à la carte de la fille, dans son projet',
    enRoute.adresseApresClic.includes(`projet/${A}/tache/${filles[0]?.id}`),
    enRoute.adresseApresClic,
  );

  /* 7. Séparer — refusé tant que la fille attend. La fille rendue, la mère va
     droit dans « Archivé », sans parler de déploiement. */
  const refus = await appelDemon({ type: 'regroupement.separer', id: regroupementId }).then(() => null, (err) => err.message);
  noter('Séparer est refusé tant qu’une fille est en route', !!refus, refus ?? 'accepté à tort');
  await appelDemon({ type: 'card.move', id: filles[0].id, column: 'to_deploy', position: 0 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
  const rangee = lireCartes().find((c) => c.id === 'c-mere');
  noter('La mère va droit dans « Archivé » quand sa fille est rendue', rangee?.column === 'archived', `colonne ${rangee?.column}`);
  noter(
    'La phrase de la mère rangée ne parle jamais de déploiement',
    !!rangee?.sansModification && !/d[ée]ploy/i.test(rangee.sansModification),
    rangee?.sansModification ?? '(aucune)',
  );
  const rendue = await lireLeFilDeLaMere(regroupementId, 'rapport');
  noter(
    'Le point « Rapport » de la mère donne la fille terminée',
    rendue.filles.length === 1 && rendue.filles[0].etat === 'fait',
    JSON.stringify(rendue),
  );

  /* 8. Séparer, une fois la fille rendue. */
  await appelDemon({ type: 'regroupement.separer', id: regroupementId });
  const db2 = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const apres = db2.prepare('SELECT id, data FROM projects').all().map((p) => ({ id: p.id, ...JSON.parse(p.data) }));
  db2.close();
  noter(
    'Séparer rend chaque membre autonome et met le tableau commun de côté',
    apres.filter((p) => p.regroupementId).length === 0 && apres.find((p) => p.id === regroupementId)?.archived === true,
  );

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis.`);
  if (echecs.length) {
    console.log('Journal du démon :\n' + journal.join('').slice(-6000));
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('ÉCHEC :', error);
    console.log('Journal du démon :\n' + journal.join('').slice(-6000));
    process.exitCode = 1;
  })
  /* Le démon d'essai tient la boucle ouverte : on sort, et la sortie le retire. */
  .finally(() => process.exit());
