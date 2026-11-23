#!/usr/bin/env node
/**
 * LA QUESTION EN IMAGES : APERÇU AU TOUCHER, COCHE À PART, LETTRE ET RÉFÉRENCE
 * (décision du 30/10/2026, captures #9d60, #09b9, #e2a3).
 *
 * Sur un téléphone (390 × 844), une carte dont l'agent a fabriqué trois
 * exemples (« exemple-A.png », « exemple-B.png », « exemple-C.png ») et pose
 * une question à PLUSIEURS réponses dont il a RÉORDONNÉ les options (C, A, B) :
 *
 *  1. chaque vignette porte la lettre de SA pièce (pas son rang) et sa référence ;
 *  2. toucher l'image ouvre l'aperçu en grand, sans rien choisir ;
 *  3. la coche de l'aperçu choisit l'image montrée ;
 *  4. les coches des vignettes numérotent les choix dans l'ordre des touchers ;
 *  5. le fil montre une ligne par exemple (« A — … »), et aucun cadre vide ;
 *  6. un choix SANS image n'est pas une vignette vide : il se lit en ligne à
 *     cocher sous la grille, numérotée avec les vignettes (04/11/2026) ;
 *  7. une image de secours du service externe (« apercu-exemple-1-v1.png »)
 *     porte la lettre que le démon a écrite sur son option.
 *
 * Démon d'essai à base neuve : aucun quota, la production n'est pas touchée.
 * Usage : npm run build && node scripts/verif-question-en-images.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.HAIKO_QUESTION_IMAGES_PORT || 7248);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = `${RACINE}/data/verification`;
const { TMP, DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-question-images-', port: PORT });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}

const PROJET = 'p-question-images';
const CARTE = 'c-question-images';
const AGENT = 'a-question-images';
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const t0 = Date.now() - 600_000;

/* Une image PNG d'une couleur, pour que la vignette se dessine. */
function png(largeur, hauteur, [r, g, b]) {
  const crc = (buf) => {
    let c = ~0;
    for (const o of buf) {
      c ^= o;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const morceau = (type, donnees) => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(donnees.length);
    const t = Buffer.from(type);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([t, donnees])));
    return Buffer.concat([l, t, donnees, c]);
  };
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0);
  entete.writeUInt32BE(hauteur, 4);
  entete[8] = 8;
  entete[9] = 2;
  const ligne = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: largeur }, () => [r, g, b]).flat())]);
  const brut = Buffer.concat(Array.from({ length: hauteur }, () => ligne));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), morceau('IHDR', entete), morceau('IDAT', zlib.deflateSync(brut)), morceau('IEND', Buffer.alloc(0))]);
}

{
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), t0, Date.now() + 3_600_000, 'verif-question-en-images');
  const projet = { id: PROJET, name: 'Essai question en images', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: t0, updatedAt: t0 };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(PROJET, projet.name, DEPOT, JSON.stringify(projet), t0, t0);
  db.close();
}

process.env.BELUGA_DATA = DATA;
const { joindreUnFichier } = await import(pathToFileURL(path.join(RACINE, 'server/dist/joindre-fichier.js')).href);
const fichiers = path.join(TMP, 'fichiers');
fs.mkdirSync(fichiers, { recursive: true });
const poser = async (nom, couleur) => {
  const chemin = path.join(fichiers, nom);
  fs.writeFileSync(chemin, png(64, 64, couleur));
  const r = await joindreUnFichier({ projectId: PROJET, agentId: AGENT, cardId: CARTE, fichier: chemin, nom, deLAgent: true });
  if (!r.ok) throw new Error(`pièce refusée : ${r.refus}`);
  return r.attachment;
};
const pieceA = await poser('exemple-A.png', [200, 40, 40]);
const pieceB = await poser('exemple-B.png', [40, 160, 60]);
const pieceC = await poser('exemple-C.png', [40, 60, 200]);
const pieceSecours = await poser('apercu-exemple-1-v1.png', [200, 160, 40]);

{
  const db = new Database(path.join(DATA, 'beluga.db'));
  const run = { engine: 'claude', thinking: 'none', mode: 'direct' };
  const agent = { id: AGENT, projectId: PROJET, cardId: CARTE, role: 'cadrage', title: 'Essai', run, status: 'idle', createdAt: t0, updatedAt: t0 };
  db.prepare(`INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, 'cadrage', 'idle', ?, ?, ?)`).run(AGENT, PROJET, CARTE, JSON.stringify(agent), t0, t0);
  const carte = {
    id: CARTE, projectId: PROJET, title: 'Carte d’essai — question en images', description: 'Carte posée par un contrôle automatique.', labels: [], column: 'planned', position: 1, origin: 'user',
    run, excludedFromDeploy: false, horsTache: false, scheduling: { asap: false, attempts: 0, restarts: 0 }, createdAt: t0, updatedAt: t0,
  };
  db.prepare(`INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, agent_id) VALUES (?, ?, 'planned', 1, ?, ?, ?, ?, ?)`).run(CARTE, PROJET, carte.title, JSON.stringify(carte), t0, t0, AGENT);
  db.prepare('UPDATE cards SET conversation_agent_id = ? WHERE id = ?').run(AGENT, CARTE);
  const demande = { id: 'm-demande', agentId: AGENT, role: 'user', content: 'Montre-moi des exemples.', steps: [], todos: [], proposals: [], questions: [], downloads: [], attachments: [], createdAt: t0 + 1000 };
  db.prepare("INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, 'user', ?, ?)").run(demande.id, AGENT, JSON.stringify(demande), demande.createdAt);
  /* Les trois exemples livrés, une ligne du fil chacun (phrase « A — titre »). */
  const livrer = db.prepare(
    `INSERT INTO medias_livres (id, project_id, card_id, agent_id, attachment_id, genre, groupe, version, sujet, outil, legende, livre_le) VALUES (?, ?, ?, ?, ?, 'image', ?, 1, ?, 'essai', ?, ?)`,
  );
  for (const [i, [piece, titre]] of [[pieceA, 'Sobre'], [pieceB, 'Vivant'], [pieceC, 'Contrasté']].entries()) {
    const phrase = `${'ABC'[i]} — ${titre}`;
    livrer.run(crypto.randomUUID(), PROJET, CARTE, AGENT, piece.id, phrase.toLowerCase(), phrase, phrase, t0 + 2000 + i);
  }
  /* L'agent a RÉORDONNÉ ses options : C, A, B. */
  const message = {
    id: 'm-question', agentId: AGENT, role: 'assistant', content: 'Voici trois exemples.', steps: [], todos: [], proposals: [], downloads: [], attachments: [], streaming: false, createdAt: t0 + 5000,
    questions: [{
      id: 'q-images', question: 'Quel style préférez-vous ? (C, A, B)', kind: 'multiple',
      options: [
        { id: 'o-c', label: 'Contrasté', image: pieceC.id },
        { id: 'o-a', label: 'Sobre', image: pieceA.id },
        { id: 'o-b', label: 'Vivant', image: pieceB.id },
        { id: 'o-e', label: 'Doré', image: pieceSecours.id, lettre: 'E' },
        { id: 'o-mots', label: 'Fusionner les deux idées', description: 'Sans exemple : décrit en mots.' },
      ],
      allowFreeText: true, answerAttachments: [],
    }],
  };
  db.prepare("INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, 'assistant', ?, ?)").run(message.id, AGENT, JSON.stringify(message), message.createdAt);
  /* Le journal de la carte : c'est lui qui donne au fil ses passages, où les médias se posent à leur heure. */
  const journal = db.prepare(
    `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, outil, params, resultat, reussie, duree_ms, etat, donnees)
     VALUES (@id, @card_id, @rang, 'cadrage', @nature, @at, @agent_id, 'cadrage', 'tour-images', @libelle, @outil, @params, @resultat, NULL, NULL, NULL, NULL)`,
  );
  journal.run({ id: 'j-1', card_id: CARTE, rang: 1, nature: 'jalon', at: t0 + 1000, agent_id: AGENT, libelle: 'Demande', outil: null, params: null, resultat: 'Montre-moi des exemples.' });
  journal.run({ id: 'j-2', card_id: CARTE, rang: 2, nature: 'requete', at: t0 + 1500, agent_id: AGENT, libelle: 'Read', outil: 'Read', params: JSON.stringify({ file_path: '/tmp/brief.md' }), resultat: 'ok' });
  journal.run({
    id: 'j-3', card_id: CARTE, rang: 3, nature: 'requete', at: t0 + 5000, agent_id: AGENT, libelle: 'mcp__beluga__ask_user', outil: 'mcp__beluga__ask_user',
    params: JSON.stringify({ question: 'Quel style préférez-vous ?', kind: 'multiple', options: [{ label: 'Contrasté' }, { label: 'Sobre' }, { label: 'Vivant' }] }), resultat: null,
  });
  db.close();
}
await new Promise((r) => setTimeout(r, 1500));

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  fs.mkdirSync(SHOTS, { recursive: true });
  const contexte = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  await page.goto(`${BASE}/#projet/${PROJET}/tache/${CARTE}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const grille = page.locator('[data-choix-en-images]').first();
  /* Une question attend : elle s'ouvre depuis sa forme compacte du pied. */
  const compacte = page.locator('[data-question-compacte] [data-repondre-question]').first();
  await Promise.race([
    grille.waitFor({ state: 'visible', timeout: 30_000 }),
    compacte.waitFor({ state: 'visible', timeout: 30_000 }),
  ]).catch(() => {});
  if (!(await grille.isVisible().catch(() => false)) && (await compacte.count())) await compacte.tap();
  await grille.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  if (!(await grille.count())) await page.screenshot({ path: `${SHOTS}/question-en-images-introuvable.png` });
  noter('la question en images est affichée', (await grille.count()) === 1);
  await page.waitForTimeout(800);

  const lettres = await grille.locator('[data-option-image]').evaluateAll((noeuds) => noeuds.map((n) => n.getAttribute('data-option-lettre')));
  noter('chaque vignette porte la lettre de SA pièce, pas son rang', JSON.stringify(lettres) === JSON.stringify(['C', 'A', 'B', 'E']), JSON.stringify(lettres));
  noter('l’image de secours porte la lettre écrite sur son option', lettres[3] === 'E');
  const references = await grille.locator('[data-option-reference]').allTextContents();
  noter('chaque vignette porte sa référence « #xxxx »', references.length === 4 && references.every((r) => /^#[0-9a-f]{4,}$/.test(r.trim())), JSON.stringify(references));

  await grille.locator('[data-option-apercu="o-a"]').tap();
  const fenetre = page.locator('[role="dialog"]').last();
  await fenetre.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  noter('toucher l’image ouvre l’aperçu en grand', await fenetre.isVisible());
  noter('…sans rien choisir', (await grille.locator('[data-option-retenue]').count()) === 0);
  const sousTitre = (await page.locator('[data-visionneuse-repere]').last().textContent().catch(() => '')) ?? '';
  noter('l’aperçu porte la lettre et la référence', /^A · #[0-9a-f]{4,}$/.test(sousTitre.trim()), sousTitre);
  /* L'IMAGE SE VOIT VRAIMENT (06/11/2026, captures #95c30 et #ca9f : un exemple ouvert en grand restait vide sur
     iPhone) : chargée, et posée SANS couche graphique à part au repos — c'est cette couche que Safari ne peignait pas. */
  const montree = await page
    .waitForFunction(() => document.querySelector('[data-scene-image]')?.getAttribute('data-image-etat') === 'pret', null, { timeout: 8000 })
    .then(() => true, () => false);
  const couche = await page.evaluate(() => {
    const img = document.querySelector('[data-image-visionneuse]');
    return img ? { willChange: getComputedStyle(img).willChange, transform: getComputedStyle(img).transform, voisines: document.querySelectorAll('[data-piste-carrousel] img').length } : null;
  });
  noter('l’image de l’aperçu est chargée et affichée', montree && !!couche, JSON.stringify(couche));
  noter('au repos, ni couche graphique à part ni image voisine hors de l’écran', couche?.willChange === 'auto' && couche?.transform === 'none' && couche?.voisines === 1, JSON.stringify(couche));
  await page.screenshot({ path: `${SHOTS}/question-en-images-apercu.png` });
  await page.locator('[data-apercu-coche]').last().tap();
  await page.waitForTimeout(200);
  noter('la coche de l’aperçu choisit l’image montrée', (await page.locator('[data-apercu-coche][aria-checked="true"]').count()) === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  noter('l’image cochée dans l’aperçu est retenue', (await grille.locator('[data-option-retenue][data-option-lettre="A"]').count()) === 1);

  /* Plusieurs réponses : les numéros suivent l'ordre des touchers. */
  await grille.locator('[data-option-coche][data-option-question="o-c"]').tap();
  await page.waitForTimeout(200);
  const rangs = await grille.locator('[data-option-retenue]').evaluateAll((noeuds) =>
    Object.fromEntries(noeuds.map((n) => [n.getAttribute('data-option-lettre'), n.getAttribute('data-option-rang')])),
  );
  noter('les coches numérotent les choix dans l’ordre des touchers', rangs.A === '1' && rangs.C === '2', JSON.stringify(rangs));

  /* Le choix sans image : une ligne sous la grille, jamais une vignette vide. */
  noter('aucune vignette sans image dans la grille', (await grille.locator('[data-option-apercu]').count()) === 4 && (await grille.locator('[data-option-question="o-mots"]').count()) === 0);
  const ligne = page.locator('[data-choix-en-mots] [data-option-question="o-mots"]');
  noter('le choix sans image se lit en ligne sous la grille', (await ligne.count()) === 1 && /Fusionner les deux idées/.test((await ligne.textContent()) ?? ''));
  const boiteGrille = await grille.boundingBox();
  const boiteLigne = await ligne.boundingBox();
  noter('…placée sous la grille', !!boiteGrille && !!boiteLigne && boiteLigne.y >= boiteGrille.y + boiteGrille.height - 1);
  await ligne.tap();
  await page.waitForTimeout(200);
  noter('la ligne se coche et prend son rang après les vignettes', (await page.locator('[data-choix-en-mots] [data-option-rang-ligne="3"]').count()) === 1);
  await page.screenshot({ path: `${SHOTS}/question-en-images-ligne-en-mots.png` });
  await page.screenshot({ path: `${SHOTS}/question-en-images-coches.png` });

  await contexte.close();

  /* Le fil, sur ordinateur (la feuille de la question ne le couvre pas) : une
     ligne par exemple, et la bande « Ce que l'agent a vu » les montre. */
  const bureau = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await bureau.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const fil = await bureau.newPage();
  await fil.goto(`${BASE}/#projet/${PROJET}/tache/${CARTE}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await fil.locator('[data-media-livre-phrase]').first().waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  const phrases = await fil.locator('[data-media-livre-phrase]').allTextContents();
  noter('le fil montre une ligne par exemple, avec sa lettre', ['A — Sobre', 'B — Vivant', 'C — Contrasté'].every((p) => phrases.some((t) => t.trim() === p)), JSON.stringify(phrases));
  const bande = await fil.locator('[data-captures-bande] [data-capture-etiquette], [data-captures-bande] [data-etiquette-de-vignette]').allTextContents().catch(() => []);
  const vignettes = await fil.locator('[data-captures-bande] img').count().catch(() => 0);
  noter('« Ce que l’agent a vu » montre les exemples', vignettes >= 3, `${vignettes} image(s) ${JSON.stringify(bande)}`);
  await fil.screenshot({ path: `${SHOTS}/question-en-images-fil.png` });
  await bureau.close();
} finally {
  await navigateur.close().catch(() => {});
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
process.exit(echecs.length ? 1 : 0);
