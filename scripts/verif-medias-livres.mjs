#!/usr/bin/env node
/**
 * LES MÉDIAS LIVRÉS DANS LE FIL, DANS UN VRAI NAVIGATEUR.
 *
 * Décision du 20/10/2026, revue le 26/10/2026 (captures #3bb3 puis #e9bd :
 * « il faut que les images soient rendues les unes sous les autres… avec un
 * petit texte qui m'explique ce qui a été rendu ») : CHAQUE MÉDIA EST UNE
 * LIGNE DU FIL, À SON HEURE, comme une capture de l'agent — sa phrase, son
 * heure, puis le média dessous. Plus aucune rangée de vignettes, ni bloc
 * « Médias fabriqués ».
 *
 * Un démon d'essai (base neuve, port à lui) sert l'interface construite de
 * CETTE copie de travail. Le décor : la conversation sans carte de
 * l'Assistant, deux tours (demande → réponse) ; trois médias livrés pendant
 * le premier (une image en v1 et v2, une vidéo), un quatrième pendant le
 * second, avec la phrase donnée par l'agent. Le navigateur vérifie :
 *  1. aucune rangée : quatre lignes, une par média, dans l'ordre de livraison ;
 *  2. chacune a sa phrase (celle de l'agent, sinon d'après le sujet et la
 *     version), son heure, puis le média dessous ;
 *  3. les trois premières sont entre la demande et la réponse du premier
 *     tour, la quatrième dans le second tour ;
 *  4. un clic l'ouvre dans la visionneuse ;
 *  5. après rechargement, les lignes sont toujours là ;
 *  6. sur une carte de création, chaque média livré (image, vidéo, son) porte
 *     son menu « … » adapté à son genre, même hors de la production ; le
 *     premier geste l'y inscrit UNE fois (27/10/2026, capture #ee9e) ;
 *  7. plus de tableau d'ambiance au bas du fil ;
 *  8. l'heure vient en DERNIER — sous le média, sous la question — et se lit
 *     « il y a … » (captures #ae52 et #3c8a).
 * Aucune génération payante, aucun quota : les médias sont posés en base.
 *
 *   npm run build && node scripts/verif-medias-livres.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.HAIKO_MEDIAS_LIVRES_PORT || 7241);
const BASE = `http://127.0.0.1:${PORT}`;
const { TMP, DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-medias-livres-', port: PORT });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}

const PROJET = 'p-medias-livres';
const AGENT = 'a-medias-livres';
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

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
  const { deflateSync } = zlib;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), morceau('IHDR', entete), morceau('IDAT', deflateSync(brut)), morceau('IEND', Buffer.alloc(0))]);
}

/* ---- Le décor ---- */
const t0 = Date.now() - 600_000;
{
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), t0, Date.now() + 3_600_000, 'verif-medias-livres');
  const projet = { id: PROJET, name: 'Essai médias livrés', path: DEPOT, defaultEngine: 'codex', isSelf: false, rank: 1, archived: false, createdAt: t0, updatedAt: t0 };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(PROJET, projet.name, DEPOT, JSON.stringify(projet), t0, t0);
  /* La conversation sans carte la plus directe à ouvrir : celle de l'Assistant
     (le rond du coin), retenue sous la clé que le démon relit. */
  const agent = {
    id: AGENT,
    projectId: PROJET,
    role: 'deploy',
    title: 'Assistant',
    run: { engine: 'claude' },
    status: 'idle',
    assistantGlobal: true,
    createdAt: t0,
    updatedAt: t0,
  };
  db.prepare(`INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, NULL, 'deploy', 'idle', ?, ?, ?)`).run(AGENT, PROJET, JSON.stringify(agent), t0, t0);
  db.prepare("INSERT INTO meta (key, value) VALUES ('assistant.agent', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(AGENT);
  const message = (id, role, content, quand) =>
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(id, AGENT, role, JSON.stringify({ id, agentId: AGENT, role, content, createdAt: quand }), quand);
  message('m1', 'user', 'Fabrique une affiche et une vidéo.', t0 + 1_000);
  message('m2', 'assistant', 'Voici l’affiche, refaite une fois, et la vidéo.', t0 + 60_000);
  message('m3', 'user', 'Merci, rien d’autre.', t0 + 120_000);
  message('m4', 'assistant', 'Avec plaisir.', t0 + 130_000);
  db.close();
}
process.env.BELUGA_DATA = DATA;
const { joindreUnFichier } = await import(pathToFileURL(path.join(RACINE, 'server/dist/joindre-fichier.js')).href);
const fichiers = path.join(TMP, 'fichiers');
fs.mkdirSync(fichiers, { recursive: true });
const poser = async (nom, contenu) => {
  const chemin = path.join(fichiers, nom);
  fs.writeFileSync(chemin, contenu);
  const r = await joindreUnFichier({ projectId: PROJET, agentId: AGENT, fichier: chemin, nom, deLAgent: true });
  if (!r.ok) throw new Error(`pièce refusée : ${r.refus}`);
  return r.attachment.id;
};
const v1 = await poser('affiche-v1.png', png(64, 40, [200, 40, 40]));
const v2 = await poser('affiche-v2.png', png(64, 40, [40, 160, 60]));
const video = await poser('ouverture-v1.mp4', crypto.randomBytes(4096));
const logo = await poser('logo-v1.png', png(48, 48, [90, 60, 200]));
{
  const db = new Database(path.join(DATA, 'beluga.db'));
  const livrer = (piece, genre, groupe, version, sujet, quand, legende = '') =>
    db
      .prepare(
        `INSERT INTO medias_livres (id, project_id, card_id, agent_id, attachment_id, genre, groupe, version, sujet, outil, legende, livre_le) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'essai', ?, ?)`,
      )
      .run(crypto.randomUUID(), PROJET, AGENT, piece, genre, groupe, version, sujet, legende, quand);
  livrer(v1, 'image', 'affiche', 1, 'Affiche', t0 + 10_000);
  livrer(video, 'video', 'ouverture', 1, 'Ouverture', t0 + 20_000);
  livrer(v2, 'image', 'affiche', 2, 'Affiche', t0 + 30_000);
  livrer(logo, 'image', 'logo', 1, 'Logo', t0 + 125_000, 'Le logo redessiné en violet, plus lisible en petit.');
  db.close();
}

/*
 * LA CARTE DE LA CAPTURE #e9bd : un cadrage qui pose deux questions ; une
 * image est rendue avant la première, une autre après la seconde. Avant, elles
 * tombaient en rangée au bas du fil ; maintenant chacune est une ligne, à sa
 * place entre les questions.
 */
const CARTE = 'c-medias-livres';
const AGENT_CARTE = 'a-medias-livres-carte';
const TITRE_CARTE = 'Vidéo avec avatar (essai)';
const essai = await poser('essai-visage.png', png(60, 80, [220, 180, 40]));
const retouche = await poser('essai-visage-v2.png', png(60, 80, [40, 120, 220]));
/* UNE VIDÉO ET UN SON livrés eux aussi hors de la production, et une image d'ambiance (27/10/2026). */
const videoCarte = await poser('sequence-carte.mp4', crypto.randomBytes(4096));
const sonCarte = await poser('voix-carte.mp3', crypto.randomBytes(4096));
const ambiance = await poser('ambiance-bois.png', png(40, 40, [150, 110, 60]));
{
  const db = new Database(path.join(DATA, 'beluga.db'));
  const run = { engine: 'claude', thinking: 'none', mode: 'direct' };
  const agent = { id: AGENT_CARTE, projectId: PROJET, cardId: CARTE, role: 'cadrage', title: TITRE_CARTE, run, status: 'idle', createdAt: t0, updatedAt: t0 };
  db.prepare(`INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, 'cadrage', 'idle', ?, ?, ?)`).run(AGENT_CARTE, PROJET, CARTE, JSON.stringify(agent), t0, t0);
  /* UNE CRÉATION DE MÉDIA (capture #ee9e) : ses images n'ont jamais été inscrites dans la production. */
  const carte = {
    id: CARTE, projectId: PROJET, title: TITRE_CARTE, description: 'Essai du fil des médias.', labels: [], column: 'planned', position: 1, origin: 'user',
    run, excludedFromDeploy: false, horsTache: false, scheduling: { asap: false, attempts: 0, restarts: 0 }, createdAt: t0, updatedAt: t0,
    parcours: { realisationSouhaitee: true },
    realisation: { medias: ['video'], faites: 0, total: 0, phase: 'intention', restants: [], ambiance: [{ piece: ambiance, phase: 'intention', legende: 'Bois et plantes', at: t0 }] },
  };
  db.prepare(`INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, 'planned', 1, ?, ?, ?, ?)`).run(CARTE, PROJET, TITRE_CARTE, JSON.stringify(carte), t0, t0);
  /* Sans agent de conversation ni message, la carte s'ouvre sur la configuration de l'agent. */
  db.prepare('UPDATE cards SET conversation_agent_id = ? WHERE id = ?').run(AGENT_CARTE, CARTE);
  const demande = { id: 'm-carte', agentId: AGENT_CARTE, role: 'user', content: 'Fais-moi une vidéo avec mon visage.', steps: [], todos: [], proposals: [], questions: [], downloads: [], attachments: [], createdAt: t0 + 200_000 };
  db.prepare("INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, 'user', ?, ?)").run(demande.id, AGENT_CARTE, JSON.stringify(demande), demande.createdAt);
  const poserJournal = db.prepare(
    `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, outil, params, resultat, reussie, duree_ms, etat, donnees)
     VALUES (@id, @card_id, @rang, 'cadrage', @nature, @at, @agent_id, 'cadrage', 'tour-medias', @libelle, @outil, @params, @resultat, NULL, NULL, NULL, @donnees)`,
  );
  let rang = 0;
  const entree = (partiel) => poserJournal.run({ id: `j-medias-${++rang}`, card_id: CARTE, rang, agent_id: AGENT_CARTE, nature: 'requete', libelle: '', outil: null, params: null, resultat: null, donnees: null, ...partiel });
  entree({ nature: 'jalon', at: t0 + 200_000, libelle: 'Demande', resultat: 'Fais-moi une vidéo avec mon visage.' });
  entree({ at: t0 + 205_000, outil: 'Read', libelle: 'Read', params: JSON.stringify({ file_path: '/tmp/brief.md' }), resultat: 'ok' });
  const question = (at, texte, reponse) =>
    entree({ at, outil: 'mcp__beluga__ask_user', libelle: 'mcp__beluga__ask_user', params: JSON.stringify({ question: texte, kind: 'single', options: [{ label: 'Oui' }, { label: 'Non' }] }), resultat: `Réponse de l’utilisateur : ${reponse}` });
  question(t0 + 300_000, 'Quelles photos de votre visage poser ?', 'Oui');
  question(t0 + 360_000, 'Combien d’images voulez-vous ?', 'Oui');
  const livrerSurLaCarte = db.prepare(
    `INSERT INTO medias_livres (id, project_id, card_id, agent_id, attachment_id, genre, groupe, version, sujet, outil, legende, livre_le) VALUES (?, ?, ?, ?, ?, 'image', 'essai visage', ?, 'Essai visage', 'essai', '', ?)`,
  );
  livrerSurLaCarte.run(crypto.randomUUID(), PROJET, CARTE, AGENT_CARTE, essai, 1, t0 + 250_000);
  livrerSurLaCarte.run(crypto.randomUUID(), PROJET, CARTE, AGENT_CARTE, retouche, 2, t0 + 420_000);
  const livrerGenre = db.prepare(
    `INSERT INTO medias_livres (id, project_id, card_id, agent_id, attachment_id, genre, groupe, version, sujet, outil, legende, livre_le) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'essai', '', ?)`,
  );
  livrerGenre.run(crypto.randomUUID(), PROJET, CARTE, AGENT_CARTE, videoCarte, 'video', 'sequence', 'Séquence', t0 + 430_000);
  livrerGenre.run(crypto.randomUUID(), PROJET, CARTE, AGENT_CARTE, sonCarte, 'son', 'voix', 'Voix', t0 + 440_000);
  db.close();
}

/* ---- Le navigateur ---- */
const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block', acceptDownloads: true });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const ouvrirLAgent = async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(2500);
    if (!(await page.locator('[data-media-livre]').count())) await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant')));
    await page.waitForSelector('[data-media-livre]', { timeout: 20_000 }).catch(() => {});
  };
  await ouvrirLAgent();
  if (process.env.HAIKO_MEDIAS_LIVRES_DIAG) {
    await page.screenshot({ path: path.join(RACINE, 'data', 'verification', 'medias-livres-diag.png') });
    console.log('diag', path.join(RACINE, 'data', 'verification', 'medias-livres-diag.png'));
  }

  noter('plus aucune rangée de vignettes', (await page.locator('[data-medias-livres], [data-capture-du-flux^="livre-"]').count()) === 0);
  const ordre = await page.$$eval('[data-media-livre]', (els) => els.map((e) => e.getAttribute('data-media-livre')));
  noter('une ligne par média, dans l’ordre où ils ont été rendus', ordre.join(',') === [v1, video, v2, logo].join(','), ordre.join(','));
  noter('chaque média est sa propre ligne du fil', (await page.locator('[data-sous-point-flux="media"] [data-media-livre]').count()) === 4);
  const phrases = await page.$$eval('[data-media-livre]', (els) =>
    els.map((e) => ({
      texte: e.querySelector('[data-media-livre-phrase]')?.textContent ?? '',
      sorte: e.querySelector('[data-media-livre-phrase]')?.getAttribute('data-media-livre-phrase'),
      heure: !!e.querySelector('[data-media-livre-heure]'),
      /* Le média vient SOUS la phrase. */
      dessous: (() => {
        const p = e.querySelector('[data-media-livre-phrase]')?.getBoundingClientRect();
        const m = e.querySelector('img, video, [data-media-livre-ouvrir], canvas')?.getBoundingClientRect();
        return !!p && !!m && m.top >= p.bottom - 1;
      })(),
    })),
  );
  noter('la phrase construite d’après le sujet', /J’ai rendu l’image « Affiche »/.test(phrases[0]?.texte ?? '') && phrases[0]?.sorte === 'construite', phrases[0]?.texte);
  noter('la version se lit dans la phrase', /version 2/.test(phrases[2]?.texte ?? ''), phrases[2]?.texte);
  noter('la vidéo se dit vidéo', /la vidéo « Ouverture »/.test(phrases[1]?.texte ?? ''), phrases[1]?.texte);
  noter('la phrase donnée par l’agent s’affiche telle quelle', phrases[3]?.texte === 'Le logo redessiné en violet, plus lisible en petit.' && phrases[3]?.sorte === 'agent', phrases[3]?.texte);
  noter('chaque ligne porte son heure, et le média sous sa phrase', phrases.every((p) => p.heure && p.dessous), JSON.stringify(phrases.map((p) => [p.heure, p.dessous])));
  const place = await page.evaluate(([premier, dernier]) => {
    const el = (texte) => [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && (e.textContent ?? '').includes(texte));
    const apres = (a, b) => !!a && !!b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const m1 = document.querySelector(`[data-media-livre="${premier}"]`);
    const m4 = document.querySelector(`[data-media-livre="${dernier}"]`);
    return {
      apresLaDemande: apres(el('Fabrique une affiche'), m1),
      avantLaReponse: apres(m1, el('Voici l’affiche')),
      quatriemeApresMerci: apres(el('Merci, rien d’autre'), m4),
      quatriemeAvantLaFin: apres(m4, el('Avec plaisir')),
    };
  }, [v1, logo]);
  noter('chaque média se pose à son heure, entre les messages qui l’entourent', Object.values(place).every(Boolean), JSON.stringify(place));
  const sansBloc = await page.evaluate(() => ({
    titre: /Médias fabriqués/.test(document.body.textContent ?? ''),
    toutTelecharger: !!document.querySelector('[data-medias-livres-tout-telecharger]'),
  }));
  noter('ni bloc « Médias fabriqués » ni « Tout télécharger »', !sansBloc.titre && !sansBloc.toutTelecharger, JSON.stringify(sansBloc));
  await page.locator(`[data-media-livre="${v2}"] img`).scrollIntoViewIfNeeded();
  const dessinee = await page
    .waitForFunction((id) => (document.querySelector(`[data-media-livre="${id}"] img`)?.naturalWidth ?? 0) > 0, v2, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  noter('l’image se dessine sous sa phrase', dessinee);
  const taille = await page.$eval(`[data-media-livre="${v2}"] img`, (img) => ({ h: img.getBoundingClientRect().height, l: img.getBoundingClientRect().width }));
  noter('à la taille d’une capture (160 px de haut au plus)', taille.h <= 161 && taille.l <= 321, JSON.stringify(taille));
  noter('la vidéo montre son bouton lecture', (await page.locator(`[data-media-livre="${video}"] [data-media-livre-ouvrir] svg`).count()) >= 1);
  await page.locator(`[data-media-livre-ouvrir="${v2}"]`).click();
  noter('un clic l’ouvre dans la visionneuse', await page.locator('[data-visionneuse]').first().waitFor({ timeout: 10_000 }).then(() => true).catch(() => false));
  await page.keyboard.press('Escape');
  await page.locator('[data-visionneuse]').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
  await page.locator(`[data-media-livre="${v1}"]`).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(RACINE, 'data', 'verification', 'medias-livres-dans-le-fil.png') });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  if (!(await page.locator('[data-media-livre]').count())) await ouvrirLAgent();
  noter('après rechargement, les quatre lignes sont toujours là', (await page.locator('[data-media-livre]').count()) === 4);

  /* ---- La carte de la capture #e9bd ---- */
  await page.goto(`${BASE}/#projet/${PROJET}/tache/${CARTE}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector(`[data-media-livre="${retouche}"]`, { timeout: 20_000 }).catch(() => {});
  /* La carte du passage se déplie : les médias se posent alors entre les questions. */
  const bascule = page.locator('[data-point-bascule][aria-expanded="false"]');
  for (let i = 0; i < (await bascule.count()); i++) await bascule.nth(i).click().catch(() => {});
  await page.waitForTimeout(800);
  if (process.env.HAIKO_MEDIAS_LIVRES_DIAG) await page.screenshot({ path: path.join(RACINE, 'data', 'verification', 'medias-livres-carte-diag.png') });
  noter('sur la carte, plus aucune rangée de vignettes', (await page.locator('[data-medias-livres]').count()) === 0);
  noter('sur la carte, chaque média est une ligne du fil', (await page.locator(`[data-sous-point-flux="media"] [data-media-livre="${essai}"], [data-sous-point-flux="media"] [data-media-livre="${retouche}"]`).count()) === 2);
  const ordreCarte = await page.evaluate(([avant, apres]) => {
    const q = (texte) => [...document.querySelectorAll('[data-discussion-bloc]')].find((e) => (e.textContent ?? '').includes(texte));
    const suit = (a, b) => !!a && !!b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const m1 = document.querySelector(`[data-media-livre="${avant}"]`);
    const m2 = document.querySelector(`[data-media-livre="${apres}"]`);
    const q1 = q('Quelles photos');
    const q2 = q('Combien d’images');
    return { premiereAvantLaQuestion: suit(m1, q1), secondeApresLaDerniereQuestion: suit(q2, m2), questionsVues: !!q1 && !!q2 };
  }, [essai, retouche]);
  noter('la première image avant la première question, la seconde après la dernière (capture #e9bd)', Object.values(ordreCarte).every(Boolean), JSON.stringify(ordreCarte));
  noter('la version 2 se dit dans sa phrase', /version 2/.test((await page.locator(`[data-media-livre="${retouche}"] [data-media-livre-phrase]`).textContent().catch(() => '')) ?? ''));
  noter('le bloc de fabrication du bas ne redit aucun média', (await page.locator('[data-media-en-fabrication]').count()) === 0);
  /* ---- TOUT MÉDIA DU FIL SE RETRAVAILLE (27/10/2026, capture #ee9e) ---- */
  const lignesDeProduction = (piece) => {
    const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
    try {
      return db.prepare('SELECT id, service, etat, retenu_le FROM medias_realisation WHERE card_id = ? AND attachment_id = ?').all(CARTE, piece);
    } finally {
      db.close();
    }
  };
  noter('avant tout geste, ces médias ne sont pas dans la production', lignesDeProduction(essai).length === 0 && lignesDeProduction(videoCarte).length === 0);
  /* Les médias de LA CARTE (la conversation de l'Assistant, sans carte, peut rester montée à côté). */
  const DE_LA_CARTE = [essai, retouche, videoCarte, sonCarte];
  const selecteurCarte = DE_LA_CARTE.map((id) => `[data-media-livre="${id}"]`).join(', ');
  const menus = await page.$$eval(selecteurCarte, (els) => els.map((e) => [e.getAttribute('data-media-livre'), !!e.querySelector('[data-menu-du-media-du-fil] button')]));
  noter('chaque média livré porte son menu « … », même hors de la production (#dca9)', menus.length === 4 && menus.every(([, a]) => a), JSON.stringify(menus));
  const optionsDu = async (piece) => {
    await page.locator(`[data-menu-du-media-du-fil="${piece}"] button`).first().click();
    const menu = page.locator(`[data-menu-media-piece="${piece}"]`).first();
    await menu.waitFor({ timeout: 10_000 }).catch(() => {});
    const options = await menu.evaluate((el) =>
      [...el.querySelectorAll('*')].flatMap((n) => [...n.attributes].map((a) => a.name)).filter((n) => /^data-media-/.test(n)),
    ).catch(() => []);
    return [...new Set(options)];
  };
  const fermerLeMenu = async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  };
  const optionsImage = await optionsDu(essai);
  noter('le menu d’une image : valider, visage, lumière, angles, consigne, réglages, télécharger',
    ['data-media-retenir', 'data-media-visage', 'data-media-lumiere', 'data-media-autres-angles', 'data-media-redemander', 'data-media-reglages', 'data-media-telecharger'].every((o) => optionsImage.includes(o)), optionsImage.join(','));
  /* « Valider » inscrit d'abord le média, puis le valide — UNE seule ligne. */
  await page.locator(`[data-menu-media-piece="${essai}"] [data-media-retenir]`).first().click();
  await page.waitForTimeout(1500);
  const inscrites = lignesDeProduction(essai);
  noter('« Valider » inscrit le média dans la production, une seule fois, et le valide', inscrites.length === 1 && inscrites[0].service === 'fil' && inscrites[0].etat === 'fini' && !!inscrites[0].retenu_le, JSON.stringify(inscrites));
  noter('le média validé porte sa marque dans le fil', await page.locator(`[data-menu-du-media-du-fil="${essai}"] [data-media-dans-le-suivi]`).waitFor({ timeout: 10_000 }).then(() => true).catch(() => false));
  const optionsVideo = await optionsDu(videoCarte);
  noter('le menu d’une vidéo : gestes, consigne, réglages, télécharger — sans visage ni lumière',
    ['data-media-mouvement', 'data-media-redemander', 'data-media-reglages', 'data-media-telecharger'].every((o) => optionsVideo.includes(o)) && !optionsVideo.includes('data-media-visage') && !optionsVideo.includes('data-media-lumiere'), optionsVideo.join(','));
  /* « Réglages » inscrit la vidéo, puis ouvre sa feuille. */
  await page.locator(`[data-menu-media-piece="${videoCarte}"] [data-media-reglages]`).first().click();
  noter('« Réglages » d’un média hors production s’ouvre après son inscription', await page.locator('[data-reglages-media]').first().waitFor({ timeout: 10_000 }).then(() => true).catch(() => false));
  noter('la vidéo est inscrite une seule fois', lignesDeProduction(videoCarte).length === 1);
  await fermerLeMenu();
  await page.locator('[data-reglages-media]').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
  const optionsSon = await optionsDu(sonCarte);
  noter('le menu d’un son : valider, consigne, réglages, télécharger — aucune retouche d’image',
    ['data-media-retenir', 'data-media-redemander', 'data-media-reglages', 'data-media-telecharger'].every((o) => optionsSon.includes(o)) && !optionsSon.includes('data-media-visage') && !optionsSon.includes('data-media-mouvement'), optionsSon.join(','));
  await fermerLeMenu();
  noter('aucune ligne inscrite en double après tous ces gestes', [essai, videoCarte, sonCarte].every((p) => lignesDeProduction(p).length <= 1));

  /* ---- LE TABLEAU D'AMBIANCE NE VIT PLUS QUE DANS LE SUIVI ---- */
  noter('aucun tableau d’ambiance au bas du fil', (await page.locator('[data-tableau-ambiance], [data-piece-ambiance]').count()) === 0);

  /* ---- L'HEURE EN DERNIER, « IL Y A … » (captures #ae52 et #3c8a) ---- */
  const heures = await page.$$eval(selecteurCarte, (els) =>
    els.map((e) => {
      const h = e.querySelector('[data-media-livre-heure]');
      const media = e.querySelector('img, video, [data-media-livre-ouvrir], canvas, [data-lecteur-son], audio');
      return {
        derniere: !!h && e.lastElementChild === h,
        sous: !!h && !!media && h.getBoundingClientRect().top >= media.getBoundingClientRect().bottom - 1,
        texte: h?.textContent ?? '',
      };
    }),
  );
  noter('l’heure d’un média vient en dernier, sous le média', heures.length === 4 && heures.every((h) => h.derniere && h.sous), JSON.stringify(heures));
  noter('elle se lit « il y a … »', heures.every((h) => /^(il y a|à l’instant)/.test(h.texte)), heures.map((h) => h.texte).join(' | '));
  const blocs = await page.$$eval('[data-bloc-raconte]', (els) =>
    els
      .filter((e) => e.querySelector('[data-duree-bloc]'))
      .map((e) => {
        const h = e.querySelector('[data-duree-bloc]');
        const q = e.querySelector('[data-bloc-question]');
        return {
          derniere: e.lastElementChild === h,
          question: !!q,
          sousLaQuestion: !q || h.getBoundingClientRect().top >= q.getBoundingClientRect().bottom - 1,
          texte: h.textContent ?? '',
        };
      }),
  );
  noter('l’heure d’un geste ou d’une question vient en dernier dans son bloc', blocs.length > 0 && blocs.every((b) => b.derniere), JSON.stringify(blocs));
  noter('l’heure d’une question posée se lit SOUS la question (capture #ae52)', blocs.filter((b) => b.question).length >= 2 && blocs.every((b) => b.sousLaQuestion), JSON.stringify(blocs));
  noter('et se lit « il y a … · durée »', blocs.every((b) => /^(il y a|à l’instant)/.test(b.texte)), blocs.map((b) => b.texte).join(' | '));

  await page.locator(`[data-media-livre="${retouche}"]`).scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: path.join(RACINE, 'data', 'verification', 'medias-livres-carte.png') });
  /* Sur téléphone : la ligne tient dans la largeur. */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  const debord = await page.$$eval('[data-media-livre]', (els) => els.some((e) => e.getBoundingClientRect().right > window.innerWidth + 1));
  noter('sur téléphone, aucune ligne de média ne déborde', !debord);
  await contexte.close();
} finally {
  await navigateur.close();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérification(s) réussie(s).`);
process.exit(echecs.length ? 1 : 0);
