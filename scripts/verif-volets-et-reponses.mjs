#!/usr/bin/env node
/**
 * LES VOLETS, LEURS ADRESSES, LES CRÉATIONS ET LES RÉPONSES PARTAGÉES — dans un
 * vrai navigateur (carte « Fin des volets intempestifs », 09/10/2026).
 *
 * Démon à soi, base jetable : aucune donnée réelle touchée, aucun dépôt GitHub
 * créé (la création de projet se fait SANS git), aucun quota dépensé.
 *
 *  A. Un volet a son adresse en SEGMENT : « Pièces jointes » écrit
 *     « …/volet/pieces-jointes », Précédent le referme, un lien collé le rouvre,
 *     et l'ancienne forme « ?tiroir= » se lit encore puis se réécrit.
 *  B. « Projets du serveur » est une FENÊTRE centrée (plus un volet : « plus aucun
 *     tiroir », refonte du 11/10/2026), toujours rouverte par son adresse : ses
 *     trois onglets sont fixés dans l'entête, en trois parts égales, et chaque nom
 *     de champ est AU-DESSUS de son champ.
 *  C. Créer un projet (avec cahier des charges) referme la fenêtre et mène DANS le
 *     projet, sur sa carte « Cahier des charges ».
 *  D. La réponse à une question (choix, texte, image) saisie au TÉLÉPHONE
 *     apparaît sur l'ORDINATEUR, survit au rechargement, et s'efface une fois
 *     la réponse partie.
 *  E. La réponse d'une commande survit à une coupure du canal (`acks.reclamer`).
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-volets-et-reponses.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKO_VOLETS_PORT || 7231);
const BASE = `http://127.0.0.1:${PORT}`;
const PROJET = 'p-volets';
const CARTE = crypto.randomUUID();
const AGENT = crypto.randomUUID();
const MESSAGE = crypto.randomUUID();
const QUESTION = crypto.randomUUID();
const INTITULE = 'Vérification — quelle couleur pour le bandeau ?';

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
console.log(`  …  dépôt jugé : ${RACINE}`);

const { DATA, PROJETS, attendrePort, journal, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-volets-',
  port: PORT,
  depot: false,
  signaux: true,
});
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const base = () => new Database(path.join(DATA, 'beluga.db'));

function poserLeDecor() {
  const db = base();
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(JETON), t, t + 3600_000, 'vérification des volets');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  const dossier = path.join(PROJETS, PROJET);
  fs.mkdirSync(dossier, { recursive: true });
  const projet = { id: PROJET, name: 'Atelier Volets', path: dossier, defaultEngine: 'claude', isSelf: false, branchesDePublication: {}, rank: 1000, archived: false, createdAt: t, updatedAt: t };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(PROJET, projet.name, dossier, JSON.stringify(projet), t, t);
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description, agent_id)
     VALUES (?, ?, 'planned', 1, ?, '{}', ?, ?, ?, ?)`,
  ).run(CARTE, PROJET, 'Carte témoin des réponses', t, t, 'Carte posée par un contrôle automatique.', AGENT);
  const agent = { id: AGENT, projectId: PROJET, cardId: CARTE, role: 'task', title: 'Carte témoin', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'done', createdAt: t, updatedAt: t };
  db.prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(AGENT, PROJET, CARTE, 'task', 'done', JSON.stringify(agent), t, t);
  const message = (id, role, partiel, quand) => {
    const m = { id, agentId: AGENT, role, content: '', steps: [], todos: [], proposals: [], questions: [], downloads: [], attachments: [], streaming: false, createdAt: quand, ...partiel };
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(id, AGENT, role, JSON.stringify(m), quand);
  };
  message(crypto.randomUUID(), 'user', { content: 'Carte d’essai : ne rien exécuter.' }, t - 2000);
  message(MESSAGE, 'assistant', {
    content: 'Question posée par le script de vérification.',
    questions: [
      { id: QUESTION, question: INTITULE, kind: 'single', options: [{ id: 'o0', label: 'Bleu' }, { id: 'o1', label: 'Orange' }], allowFreeText: true, answerAttachments: [] },
    ],
  }, t - 1000);
  const pref = db.prepare('INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  pref.run('project.active', JSON.stringify(PROJET), t);
  db.close();
}

const lireQuestion = () => {
  const db = base();
  const ligne = db.prepare('SELECT data FROM messages WHERE id = ?').get(MESSAGE);
  db.close();
  return JSON.parse(ligne.data).questions.find((q) => q.id === QUESTION);
};
const lirePref = (cle) => {
  const db = base();
  const ligne = db.prepare('SELECT value FROM preferences WHERE key = ?').get(cle);
  db.close();
  return ligne ? JSON.parse(ligne.value) : undefined;
};

/** Une image PNG d'un pixel, posée dans un dossier temporaire. */
function imageDEssai() {
  const fichier = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verif-volets-image-')), 'bandeau.png');
  fs.writeFileSync(fichier, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  return fichier;
}

async function ouvrir(navigateur, telephone) {
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  return { contexte, page, erreurs };
}
const hash = (page) => page.evaluate(() => location.hash);
const attendre = async (page, condition, limite = 8000) => {
  const fin = Date.now() + limite;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await page.waitForTimeout(200);
  }
  return false;
};

/** A. Les adresses en segment. */
async function adresses(navigateur) {
  const { contexte, page, erreurs } = await ouvrir(navigateur, false);
  await page.goto(`${BASE}/#projet/${PROJET}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-colonne]', { timeout: 30000 }).catch(() => undefined);
  // « Pièces jointes » est une option DU PROJET. Sur ordinateur, le bouton « … » de la
  // barre d'en-tête n'existe plus : dans un projet, la colonne de gauche porte ses
  // options (`data-options-du-projet`), une ligne par entrée.
  const pieces = page.locator('[data-colonne-de-service] [data-options-du-projet] [data-menu-pieces]:visible').first();
  await pieces.waitFor({ timeout: 30000 });
  await pieces.click({ timeout: 10000 }).catch(async (err) => {
    await page.screenshot({ path: path.join(os.tmpdir(), 'verif-volets-menu.png') });
    throw err;
  });
  const ouvert = await attendre(page, async () => (await page.locator('[data-tiroir-fichiers="pieces"]').count()) > 0);
  const adresse = await hash(page);
  noter('« Pièces jointes » s’ouvre et écrit son adresse en segment', ouvert && adresse.endsWith('/volet/pieces-jointes') && !adresse.includes('?'), adresse);
  await page.goBack();
  const referme = await attendre(page, async () => (await page.locator('[data-tiroir-fichiers]').count()) === 0);
  noter('Précédent referme le volet des pièces jointes', referme && !(await hash(page)).includes('/volet/'), await hash(page));
  await page.goto(`${BASE}/#projet/${PROJET}/volet/fichiers`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  noter('un lien collé « …/volet/fichiers » rouvre le volet des fichiers', await attendre(page, async () => (await page.locator('[data-tiroir-fichiers="fichiers"]').count()) > 0, 20000));
  await page.goto(`${BASE}/#projet/${PROJET}?tiroir=pieces-jointes`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const ancien = await attendre(page, async () => (await page.locator('[data-tiroir-fichiers="pieces"]').count()) > 0, 20000);
  const reecrite = await attendre(page, async () => (await hash(page)).endsWith('/volet/pieces-jointes'));
  noter('l’ancienne adresse « ?tiroir= » ouvre encore le volet et se réécrit en segment', ancien && reecrite, await hash(page));
  noter('A — aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await contexte.close();
}

/** B et C. « Projets du serveur » et la création d'un projet. */
async function projetsDuServeur(navigateur) {
  const { contexte, page, erreurs } = await ouvrir(navigateur, false);
  await page.goto(`${BASE}/#projet/${PROJET}/volet/projets-du-serveur`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const volet = page.locator('[data-projets-du-serveur]');
  const ouvert = await attendre(page, async () => (await volet.count()) > 0, 20000);
  // C'EST UNE FENÊTRE CENTRÉE (`DialogContent`, repère `data-fenetre-centree`), plus
  // un volet : `data-tiroir` ne marque plus que les PAGES (`Drawer`). La règle gardée
  // est la même — elle se rouvre par son adresse, et elle n'est pas une page.
  const estUneFenetre =
    ouvert && (await volet.getAttribute('data-fenetre-centree')) !== null && (await volet.getAttribute('data-page-de-zone')) === null;
  noter('« Projets du serveur » est une fenêtre, rouverte par son adresse', estUneFenetre, await hash(page));
  /* L'ÉCRAN DE CHOIX (15/11/2026, à la place du bouton à menu de l'entête) : quatre
     cartes dans le corps, puis le chemin choisi. */
  const choix = await page.evaluate(() => {
    const grille = document.querySelector('[data-projets-du-serveur] [data-choix-du-chemin]');
    const corps = document.querySelector('[data-projets-du-serveur] [data-fenetre-corps]');
    return { cartes: grille?.querySelectorAll('[data-chemin]').length ?? 0, dansLeCorps: !!grille && !!corps && corps.contains(grille) };
  });
  noter('la fenêtre s’ouvre sur quatre cartes de choix, dans son corps', choix.cartes === 4 && choix.dansLeCorps, JSON.stringify(choix));

  await page.locator('[data-chemin="new"]').click();
  await page.waitForTimeout(400);
  const lignes = await page.evaluate(() =>
    [...document.querySelectorAll('[data-projets-du-serveur] [data-ligne-formulaire]')].map((ligne) => {
      const libelle = ligne.querySelector('[data-libelle-formulaire]')?.getBoundingClientRect();
      const valeur = ligne.querySelector('[data-valeur-formulaire]')?.getBoundingClientRect();
      return libelle && valeur ? { dessus: libelle.bottom <= valeur.top + 1, gauche: Math.abs(libelle.left - valeur.left) <= 2 } : null;
    }),
  );
  noter('chaque nom de champ est au-dessus de son champ, aligné à gauche', lignes.length >= 4 && lignes.every((l) => l && l.dessus && l.gauche), `${lignes.length} champs`);

  /* C. La création : SANS git (donc sans dépôt GitHub), avec cahier des charges. */
  await page.locator('[data-projets-du-serveur] input').first().fill('Projet témoin des volets');
  const caseGit = page.locator('[data-projets-du-serveur] label').filter({ hasText: 'Démarrer un dépôt git' }).locator('[role="switch"]');
  if ((await caseGit.getAttribute('aria-checked')) === 'true') await caseGit.click();
  // Le cahier d'un projet vide est obligatoire (18/11/2026) : rien à cocher.
  const debut = Date.now();
  await page.getByRole('button', { name: 'Créer le projet' }).click();
  const ferme = await attendre(page, async () => (await volet.count()) === 0, 30000);
  const surLaCarte = await attendre(
    page,
    async () => /#projet\/[^/]+\/tache\//.test(await hash(page)) && (await page.getByRole('dialog').filter({ hasText: 'Cahier des charges' }).count()) > 0,
    20000,
  );
  const adresse = await hash(page);
  noter(
    'créer un projet referme la fenêtre et mène dans le projet, sur sa carte « Cahier des charges »',
    ferme && surLaCarte && !adresse.includes(PROJET),
    `${Math.round((Date.now() - debut) / 100) / 10} s — ${adresse}`,
  );
  noter('B/C — aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await contexte.close();
}

/** D. La réponse saisie au téléphone se retrouve sur l'ordinateur. */
async function reponsePartagee(navigateur) {
  const telephone = await ouvrir(navigateur, true);
  const ordinateur = await ouvrir(navigateur, false);
  const adresse = `${BASE}/#projet/${PROJET}/tache/${CARTE}`;
  const bulleDe = (page) => page.locator('[data-question-agent]').filter({ hasText: INTITULE }).first();
  for (const { page } of [telephone, ordinateur]) {
    await page.goto(adresse, { waitUntil: 'domcontentloaded' });
    await bulleDe(page).waitFor({ state: 'visible', timeout: 30000 }).catch(() => undefined);
  }
  const bulleTel = bulleDe(telephone.page);
  noter('la question en attente est affichée sur les deux appareils', (await bulleTel.count()) > 0 && (await bulleDe(ordinateur.page).count()) > 0);
  await bulleTel.scrollIntoViewIfNeeded().catch(() => undefined);
  await bulleTel.locator('[data-option-question="o1"]').click();
  await bulleTel.locator('[data-question-texte]').fill('avec une bordure fine');
  await bulleTel.locator('[data-champ-image]').setInputFiles(imageDEssai());
  await attendre(telephone.page, async () => (await bulleTel.locator('[data-image-reponse]').count()) > 0, 15000);

  const bulleOrdi = bulleDe(ordinateur.page);
  const vu = async () => ({
    choix: (await bulleOrdi.locator('[data-option-question="o1"][data-option-retenue]').count()) > 0,
    texte: await bulleOrdi.locator('[data-question-texte]').inputValue().catch(() => ''),
    images: await bulleOrdi.locator('[data-image-reponse]').count(),
  });
  const complet = (v) => v.choix && v.texte === 'avec une bordure fine' && v.images === 1;
  await attendre(ordinateur.page, async () => complet(await vu()), 10000);
  const avant = await vu();
  noter('le choix, le texte et l’image saisis au téléphone apparaissent sur l’ordinateur', complet(avant), JSON.stringify(avant));

  await ordinateur.page.reload({ waitUntil: 'domcontentloaded' });
  await bulleOrdi.waitFor({ state: 'visible', timeout: 30000 }).catch(() => undefined);
  await attendre(ordinateur.page, async () => complet(await vu()), 10000);
  const apres = await vu();
  noter('après rechargement, la réponse en cours est toujours là', complet(apres), JSON.stringify(apres));
  noter('le brouillon vit côté serveur, nommé d’après la question', !!lirePref(`reponse.${QUESTION}`));

  await bulleOrdi.locator('[data-repondre-question]').click();
  const repondue = await attendre(ordinateur.page, async () => !!lireQuestion()?.answer, 10000);
  const q = lireQuestion();
  noter(
    'la réponse part avec le choix, le texte et l’image',
    repondue && /Orange/.test(q?.answer ?? '') && /bordure fine/.test(q?.answer ?? '') && q?.answerAttachments?.length === 1,
    q?.answer,
  );
  noter('une fois la réponse partie, son brouillon est effacé', await attendre(ordinateur.page, async () => lirePref(`reponse.${QUESTION}`) === undefined, 5000));
  noter('D — aucune erreur de page', telephone.erreurs.length + ordinateur.erreurs.length === 0, [...telephone.erreurs, ...ordinateur.erreurs].slice(0, 2).join(' | '));
  await telephone.contexte.close();
  await ordinateur.contexte.close();
}

/** E. La réponse d'une commande survit à une coupure du canal. */
async function reponseApresCoupure() {
  const ouvrirCanal = () =>
    new Promise((resolve, reject) => {
      const w = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie: `beluga_session=${JETON}` } });
      w.on('open', () => resolve(w));
      w.on('error', reject);
    });
  for (const [nom, delai] of [['rediffusée au nouveau canal', 0], ['réclamée après reconnexion', 1500]]) {
    const A = await ouvrirCanal();
    const id = crypto.randomUUID();
    A.send(JSON.stringify({ id, cmd: { type: 'project.new', name: `Coupure ${delai}`, git: true, github: false, cahierDesCharges: false } }));
    await new Promise((r) => setTimeout(r, 40));
    A.terminate();
    await new Promise((r) => setTimeout(r, delai));
    const B = await ouvrirCanal();
    let recu = false;
    B.on('message', (brut) => {
      const ev = JSON.parse(String(brut));
      if (ev.type === 'ack' && ev.id === id) recu = true;
      if (ev.type === 'ack' && ev.data?.accuses?.some((a) => a.id === id)) recu = true;
    });
    await new Promise((r) => setTimeout(r, 800));
    if (!recu) B.send(JSON.stringify({ id: crypto.randomUUID(), cmd: { type: 'acks.reclamer', ids: [id] } }));
    await new Promise((r) => setTimeout(r, 800));
    noter(`la réponse d’une création survit à la coupure du canal (${nom})`, recu);
    B.close();
  }
}

let navigateur;
let code = 1;
try {
  if (!(await attendrePort())) {
    console.error(journal.join(''));
    throw new Error('le démon d’essai ne démarre pas');
  }
  poserLeDecor();
  navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  await adresses(navigateur);
  await projetsDuServeur(navigateur);
  await reponsePartagee(navigateur);
  await reponseApresCoupure();
  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passées`);
  code = echecs ? 1 : 0;
} catch (err) {
  console.error('ÉCHEC du contrôle :', err?.message ?? err);
  code = 1;
} finally {
  await navigateur?.close().catch(() => {});
  nettoyer();
  process.exit(code);
}
