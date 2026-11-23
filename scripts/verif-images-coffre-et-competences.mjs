#!/usr/bin/env node
/**
 * LES IMAGES DU COFFRE-FORT ET LES COMPÉTENCES PROPOSÉES AU CADRAGE, dans un
 * VRAI navigateur, sur leur PROPRE démon (base neuve, port libre : le démon de
 * production n'est pas touché, aucun moteur appelé, aucun quota dépensé).
 *
 * Ce qu'il exige :
 *
 *  LE COFFRE
 *  1. une image se joint à une fiche depuis l'écran, sa vignette paraît, et la
 *     ligne de la liste dit combien d'images la fiche porte ;
 *  2. la fiche rouverte montre sa vignette, qui s'ouvre en grand ;
 *  3. l'image sort pour l'administrateur, JAMAIS pour un compte client ni sans
 *     session ; un client ne peut pas non plus en déposer ;
 *  4. le coffre prend un PDF, une vidéo et un texte (liste, aperçu au survol,
 *     visionneuse au clic, lecture partielle de la vidéo), et refuse un programme ;
 *  5. retirer l'image puis enregistrer l'efface du serveur.
 *
 *  LES COMPÉTENCES
 *  6. deux compétences proposées s'affichent ENSEMBLE, chacune dans son
 *     encadré, avec titre, correspondance, bouton « Utiliser », lien « Pas utile » ;
 *  7. la couleur des compétences est un jeton de la palette — un gris sans
 *     teinte depuis la refonte en noir et blanc (avant : un violet à elles,
 *     distinct de celui des publications) ;
 *  8. « Utiliser » et « Pas utile » replient l'encadré sur sa décision ;
 *  9. par la vraie liaison : la décision s'écrit sur la CARTE, et les compteurs
 *     de la fiche suivent.
 *
 *   npm run build && node scripts/verif-images-coffre-et-competences.mjs
 *
 * RECALÉ SUR LA REFONTE (11/10/2026). Le coffre s'ouvre par la grille des
 * services (bouton à quatre carrés de la barre d'en-tête,
 * `scripts/lib/navigation.mjs`), plus par une ligne de la colonne de gauche ;
 * la carte et la fiche d'un accès sont des pages, plus des tiroirs.
 */
import { chromium } from 'playwright';
import WebSocket from 'ws';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { ouvrirNavigation } from './lib/navigation.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_IMAGES_COFFRE_PORT || 7247);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(RACINE, 'data', 'verification');
fs.mkdirSync(SHOTS, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { TMP, DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-images-coffre-',
  port: PORT,
  env: { BELUGA_WEB: process.env.BELUGA_WEB_ESSAI || path.join(RACINE, 'web', 'dist') },
  signaux: true,
});

const base = () => new Database(path.join(DATA, 'beluga.db'));

async function attendreLaBase(limiteMs = 30000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
      const colonne = db.prepare("SELECT 1 FROM pragma_table_info('secrets') WHERE name = 'images'").get();
      db.close();
      if (colonne) return true;
    } catch {
      /* base pas encore là */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const JETON_CLIENT = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-images';

function poserLeDecor() {
  const db = base();
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(JETON),
    t,
    t + 3600_000,
    'vérification des images du coffre',
  );
  // Un compte CLIENT et sa session : il ne doit rien voir du coffre.
  db.prepare(
    'INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
  ).run('client-essai', 'cliente', 'client', 'Cliente d’essai', 'sel', 'empreinte', t);
  db.prepare('INSERT INTO user_projects (user_id, project_id) VALUES (?, ?)').run('client-essai', PROJET_ID);
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(
    sha(JETON_CLIENT),
    t,
    t + 3600_000,
    'vérification — compte client',
    'client-essai',
  );

  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai images et compétences',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), t, t);

  db.close();
}

/** Une question « compétence proposée », telle que le démon la pose. */
function questionDeCompetence(nom, titre, correspondance) {
  return {
    id: crypto.randomUUID(),
    question: `Utiliser la compétence « ${titre} » ?`,
    description: correspondance,
    kind: 'single',
    options: [
      { id: 'o0', label: 'Utiliser' },
      { id: 'o1', label: 'Pas utile' },
    ],
    allowFreeText: false,
    answerAttachments: [],
    cancelled: false,
    competence: { nom, titre },
  };
}

function poserMessage(agentId, questions, contenu = 'Je regarde votre demande.') {
  const db = base();
  const id = crypto.randomUUID();
  const message = {
    id,
    agentId,
    role: 'assistant',
    content: contenu,
    steps: [],
    todos: [],
    proposals: [],
    questions,
    downloads: [],
    attachments: [],
    streaming: false,
    createdAt: Date.now(),
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    agentId,
    'assistant',
    JSON.stringify(message),
    message.createdAt,
  );
  db.close();
  return id;
}

/** Une petite image PNG bien réelle, rendue unique (le serveur dédoublonne). */
function fabriqueImage(nom) {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAP0lEQVR42u3OMQEAAAgDoC252H0M' +
      'Ywm4mUryJgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgWQ0YMAAB8W8LqQAAAABJRU5ErkJggg==',
    'base64',
  );
  const fichier = path.join(TMP, nom);
  fs.writeFileSync(fichier, Buffer.concat([png, crypto.randomBytes(8)]));
  return fichier;
}

/**
 * Referme la visionneuse et attend qu'elle soit partie : tant qu'elle est là,
 * elle capte le pointeur. La fenêtre donne le focus à son bouton
 * « Télécharger », dont l'infobulle s'ouvre au focus et prend le PREMIER Échap
 * pour elle : on en presse un second si la fenêtre est encore là.
 */
async function fermerVisionneuse(page) {
  let partie = false;
  for (let essai = 0; essai < 2 && !partie; essai += 1) {
    await page.keyboard.press('Escape');
    partie = await page.locator('[data-visionneuse-total]').first().waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false);
  }
  await page.waitForTimeout(400);
  return partie;
}

/** Un petit fichier d'un autre genre, rendu unique. */
function fabriqueFichier(nom, contenu) {
  const fichier = path.join(TMP, nom);
  fs.writeFileSync(fichier, Buffer.concat([Buffer.from(contenu), Buffer.from(`\n% ${crypto.randomUUID()}\n`)]));
  return fichier;
}
const PDF_MINIMAL =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';

/** Une commande envoyée au démon par la vraie liaison, et sa réponse. */
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
      const trame = JSON.parse(String(brut));
      if (trame.id !== id) return;
      clearTimeout(minuteur);
      socket.close();
      resolve(trame);
    });
    socket.on('error', (souci) => {
      clearTimeout(minuteur);
      reject(souci);
    });
  });
}

const statut = async (chemin, cookie, init = {}) => {
  const reponse = await fetch(`${BASE}${chemin}`, {
    redirect: 'manual',
    ...init,
    headers: { ...(cookie ? { cookie: `beluga_session=${cookie}` } : {}), ...(init.headers ?? {}) },
  });
  return reponse.status;
};

async function main() {
  if (!(await attendrePort())) throw new Error(`le démon d'essai n'a jamais ouvert le port ${PORT}`);
  if (!(await attendreLaBase())) throw new Error('la colonne des images n’est jamais apparue : la migration n’a pas tourné');
  noter('La migration ajoute les images aux fiches du coffre', true);
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-CH' });
    await contexte.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));

    /* ------------------------------ LES COMPÉTENCES ------------------------------ */

    /*
     * Une VRAIE carte de cadrage, créée par la liaison : son agent porte un
     * message avec deux compétences RETENUES d'office, et la carte les garde à
     * l'état « utilisee » — exactement ce que le démon écrit à la recherche de
     * mémoire du cadrage (plus aucune attente, décision du 08.10.2026). La
     * première a son mode d'emploi dans le pool du démon d'essai.
     */
    const NOM_CLAVIER = 'clavier-ios-capacitor-impossible-a-quitter';
    fs.mkdirSync(path.join(DATA, 'competences', NOM_CLAVIER), { recursive: true });
    fs.writeFileSync(
      path.join(DATA, 'competences', NOM_CLAVIER, 'SKILL.md'),
      `---\nname: ${NOM_CLAVIER}\ndescription: À utiliser dès qu’une application laisse le clavier ouvert sans moyen d’en sortir.\nthemes: mobile\n---\n\n# ${NOM_CLAVIER}\n\nÉTAPE SECRÈTE : fermer le clavier à l’appui hors du champ.\n`,
      'utf8',
    );
    const creee = await appelDemon({ type: 'card.create', projectId: PROJET_ID, title: 'Le clavier reste ouvert', cadrage: true });
    const carteId = creee?.data?.card?.id ?? creee?.result?.card?.id ?? creee?.card?.id;
    const cadrageId = creee?.data?.agent?.id ?? creee?.result?.agent?.id ?? creee?.agent?.id;
    if (!carteId || !cadrageId) throw new Error(`la carte de cadrage d'essai ne s'est pas créée : ${JSON.stringify(creee).slice(0, 300)}`);

    const retenue = (q) => ({ ...q, answer: 'Utiliser', answeredAt: Date.now() });
    const q1 = retenue(
      questionDeCompetence(NOM_CLAVIER, 'Clavier ios capacitor impossible a quitter', 'À utiliser dès qu’une application laisse le clavier ouvert sans moyen d’en sortir.'),
    );
    const q2 = retenue(
      questionDeCompetence(
        'bandeau-nouvelle-version-fiable',
        'Bandeau nouvelle version fiable',
        'À utiliser dès qu’une application doit prévenir qu’une nouvelle version est en ligne.',
      ),
    );
    const messageId = poserMessage(cadrageId, [q1, q2]);
    {
      const db = base();
      const donnees = JSON.parse(db.prepare('SELECT data FROM cards WHERE id = ?').get(carteId).data);
      donnees.parcours = {
        ...(donnees.parcours ?? { plans: [] }),
        competencesProposees: [q1, q2].map((q) => ({
          nom: q.competence.nom,
          titre: q.competence.titre,
          correspondance: q.description,
          questionId: q.id,
          agentId: cadrageId,
          etat: 'utilisee',
          proposeeLe: Date.now(),
          trancheeLe: Date.now(),
        })),
      };
      db.prepare('UPDATE cards SET data = ? WHERE id = ?').run(JSON.stringify(donnees), carteId);
      db.close();
    }

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector(`[data-carte="${carteId}"]`, { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.locator(`[data-carte="${carteId}"]`).first().click();

    const lignes = page.locator('[data-competence-etat="utilisee"]');
    await lignes.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const nombre = await lignes.count();
    noter('Deux compétences retenues d’office s’affichent ensemble, une ligne chacune, sans rien à trancher', nombre === 2 && (await page.locator('[data-competence-etat="proposee"], [data-competence-utiliser]').count()) === 0, `${nombre} ligne(s)`);
    if (nombre !== 2) await page.screenshot({ path: path.join(SHOTS, 'competences-proposees-introuvables.png') });

    if (nombre === 2) {
      const premiere = lignes.first();
      const lu = await premiere.evaluate((el) => ({
        titre: el.querySelector('[data-competence-titre]')?.textContent?.trim(),
        titreEstUnBouton: el.querySelector('[data-competence-titre]')?.tagName === 'BUTTON',
        croix: el.querySelector('[data-competence-ecarter]')?.getAttribute('title'),
        texte: el.textContent ?? '',
      }));
      noter(
        'La ligne dit son titre (cliquable), « Compétence utilisée », et porte une croix pour l’écarter',
        lu.titre === q1.competence.titre && lu.titreEstUnBouton && lu.croix === 'Écarter' && /Compétence utilisée/.test(lu.texte),
        JSON.stringify(lu),
      );
      /* LA COULEUR DES COMPÉTENCES, LUE DANS LA PALETTE EN VIGUEUR. Avant la
         refonte : un violet à elles, distinct de celui des publications. Depuis
         (« l'apparence est noir et blanc », « un état ne se dit plus par une
         couleur ») les jetons `--competence` et `--publie` existent toujours
         mais ce sont des GRIS : l'assertion se traduit dans la palette — un
         gris sans teinte, déclaré — au lieu d'exiger deux violets différents. */
      const couleurs = await page.evaluate(() => {
        const sonde = document.createElement('div');
        document.body.appendChild(sonde);
        const lire = (jeton) => {
          sonde.style.color = `hsl(var(${jeton}))`;
          return getComputedStyle(sonde).color;
        };
        const declare = (jeton) => getComputedStyle(document.documentElement).getPropertyValue(jeton).trim() !== '';
        const rendu = {
          competence: lire('--competence'),
          publie: lire('--publie'),
          declares: declare('--competence') && declare('--publie'),
        };
        sonde.remove();
        return rendu;
      });
      const grisSansTeinte = (couleur) => {
        const [r, g, b] = (couleur.match(/\d+(\.\d+)?/g) ?? []).map(Number);
        return Number.isFinite(r) && r === g && g === b;
      };
      noter(
        'Les compétences n’ont plus de violet à elles : leur jeton est un gris de la palette, comme celui des publications',
        couleurs.declares && grisSansTeinte(couleurs.competence) && grisSansTeinte(couleurs.publie),
        `--competence ${couleurs.competence}, --publie ${couleurs.publie}`,
      );
      await page.screenshot({ path: path.join(SHOTS, 'competences-proposees.png') });

      /* UN CLIC SUR LE NOM : le mode d'emploi, dans une fenêtre par-dessus la conversation. */
      await premiere.locator('[data-competence-titre]').click();
      const fenetre = page.locator(`[data-fenetre-competence="${NOM_CLAVIER}"]`);
      await fenetre.locator('[data-competence-mode-d-emploi]').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      const corps = await fenetre.innerText().catch(() => '');
      noter(
        'Un clic sur son nom ouvre son mode d’emploi entier dans une fenêtre',
        /ÉTAPE SECRÈTE/.test(corps) && /clavier ouvert sans moyen/.test(corps) && !/^---/.test(corps.trim()),
        corps.slice(0, 160).replace(/\s+/g, ' '),
      );
      await page.screenshot({ path: path.join(SHOTS, 'competences-mode-d-emploi.png') });
      await page.keyboard.press('Escape');
      await fenetre.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      noter('La fenêtre se referme sur la carte, laissée là où elle était', (await fenetre.count()) === 0 && (await lignes.count()) === 2);

      /* LA CROIX écarte la seconde, tant que la carte n'est pas lancée. */
      await page.locator(`[data-competence-proposee="${q2.competence.nom}"] [data-competence-ecarter]`).click();
      const ecartee = page.locator(`[data-competence-proposee="${q2.competence.nom}"][data-competence-etat="ecartee"]`);
      await ecartee.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      noter('La croix passe la compétence à « écartée »', (await ecartee.count()) === 1);
      await page.screenshot({ path: path.join(SHOTS, 'competences-tranchees.png') });

      /* Ce que la croix a écrit : le message, la CARTE, les compteurs. */
      const db = base();
      const range = JSON.parse(db.prepare('SELECT data FROM messages WHERE id = ?').get(messageId).data).questions;
      const carte = JSON.parse(db.prepare('SELECT data FROM cards WHERE id = ?').get(carteId).data);
      const stats = db.prepare('SELECT nom, refusee FROM competence_stats ORDER BY nom').all();
      db.close();
      noter('Le message garde la première retenue et la seconde écartée', range[0].answer === 'Utiliser' && range[1].answer === 'Pas utile', `${range[0].answer} / ${range[1].answer}`);
      const etats = (carte.parcours?.competencesProposees ?? []).map((p) => p.etat).join(' / ');
      noter('La décision s’écrit sur la carte : retenue, puis écartée', etats === 'utilisee / ecartee', etats || 'rien sur la carte');
      noter('Le compteur de la fiche écartée suit', stats.some((x) => x.nom === q2.competence.nom && x.refusee === 1), JSON.stringify(stats));

      /* UNE CARTE LANCÉE : la croix disparaît, et le démon refuse le geste. */
      {
        const db2 = base();
        db2.prepare("UPDATE cards SET column_key = 'running' WHERE id = ?").run(carteId);
        db2.close();
      }
      const refus = await appelDemon({ type: 'competence.ecarter', messageId, questionId: q1.id });
      noter('Une carte lancée garde ses compétences : le démon refuse la croix', /lancée/.test(JSON.stringify(refus)), JSON.stringify(refus).slice(0, 200));
    }

    // On referme la page de la carte avant de passer au coffre, et on attend qu'elle soit partie.
    await page.keyboard.press('Escape');
    await page.locator('[data-page-carte]').first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(400);

    /* ------------------------------ LE COFFRE ------------------------------ */

    // Le coffre s'ouvre par sa tuile de la grille des services (bouton de la barre d'en-tête).
    await ouvrirNavigation(page);
    await page.locator('[data-navigation-panneau="ouvert"] [data-ouvrir-coffre]').click();
    await page.locator('[data-coffre-recherche]').waitFor({ state: 'visible', timeout: 15000 });
    await page.click('[data-coffre-creer]');
    await page.click('[data-coffre-type="mot-de-passe"]');
    const fiche = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-coffre-enregistrer]') });
    await fiche.waitFor({ state: 'visible', timeout: 10000 });
    await fiche.locator('[data-coffre-nom]').fill('Console avec code QR');
    await fiche.locator('[data-coffre-champ="identifiant"]').fill('admin');
    await fiche.locator('[data-coffre-image-champ]').setInputFiles(fabriqueImage('code-qr.png'));
    await fiche.locator('[data-coffre-image]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const vignettes = await fiche.locator('[data-coffre-image]').count();
    noter('Une image choisie paraît en vignette dans la fiche', vignettes === 1, `${vignettes} vignette(s)`);
    const imageId = vignettes ? await fiche.locator('[data-coffre-image]').first().getAttribute('data-coffre-image') : null;
    await page.screenshot({ path: path.join(SHOTS, 'coffre-fort-images.png') });
    await fiche.locator('[data-coffre-enregistrer]').click();
    await fiche.waitFor({ state: 'hidden', timeout: 10000 });
    const compteur = await page.locator('[data-coffre-acces] [data-coffre-nombre-images="1"]').count();
    noter('La ligne de la liste dit que la fiche porte une image', compteur === 1);

    // 2. La fiche rouverte montre sa vignette, qui s'ouvre en grand.
    await page.locator('[data-coffre-acces]').first().click();
    await fiche.waitFor({ state: 'visible', timeout: 10000 });
    const gardees = await fiche.locator('[data-coffre-image]').count();
    noter('La fiche rouverte a gardé son image', gardees === 1, `${gardees} vignette(s)`);
    if (gardees) {
      const dialoguesAvant = await page.locator('[role="dialog"][data-state="open"]').count();
      await fiche.locator('[data-coffre-image] button').first().click();
      await page.waitForTimeout(800);
      const dialoguesApres = await page.locator('[role="dialog"][data-state="open"]').count();
      const enGrand = await page.locator(`[role="dialog"][data-state="open"] img[src*="${imageId}"]`).count();
      noter('Un clic sur la vignette ouvre l’image en grand', dialoguesApres > dialoguesAvant && enGrand >= 1, `${dialoguesAvant} → ${dialoguesApres} fenêtre(s)`);
      noter('Échap referme la visionneuse et rend la fiche', await fermerVisionneuse(page));
    }

    // 3. L'image ne sort que pour l'administrateur.
    if (imageId) {
      const admin = await statut(`/api/attachment?id=${imageId}`, JETON);
      const client = await statut(`/api/attachment?id=${imageId}`, JETON_CLIENT);
      const anonyme = await statut(`/api/attachment?id=${imageId}`, null);
      noter('L’administrateur ouvre l’image du coffre', admin === 200, `statut ${admin}`);
      noter('Un compte client ne peut pas l’ouvrir', client === 403, `statut ${client}`);
      noter('Sans session, l’image ne sort pas', anonyme !== 200, `statut ${anonyme}`);
    }
    const envoi = (cookie, type) =>
      statut('/api/upload?coffre=1', cookie, {
        method: 'POST',
        headers: { 'content-type': type, 'x-file-name': 'essai.bin' },
        body: fs.readFileSync(fabriqueImage(`envoi-${crypto.randomUUID()}.png`)),
      });
    const depotClient = await envoi(JETON_CLIENT, 'image/png');
    noter('Un compte client ne dépose rien dans le coffre', depotClient === 403, `statut ${depotClient}`);
    const depotProgramme = await statut('/api/upload?coffre=1', JETON, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'setup.exe' },
      body: Buffer.from('MZ' + crypto.randomUUID()),
    });
    noter('Le coffre refuse un programme', depotProgramme === 415, `statut ${depotProgramme}`);

    // 4. Un PDF, une vidéo et un texte : en liste, aperçu au survol, visionneuse au clic.
    await fiche.locator('[data-coffre-image-champ]').setInputFiles([
      fabriqueFichier('Recto.pdf', PDF_MINIMAL),
      fabriqueFichier('film.mp4', '\0\0\0\x18ftypmp42'),
      fabriqueFichier('notes.txt', 'Code de secours : 1234'),
    ]);
    await page.waitForFunction(() => document.querySelectorAll('[data-coffre-image]').length >= 4, null, { timeout: 15000 }).catch(() => {});
    const lignesDeFichiers = await fiche.locator("[data-coffre-image]").count();
    noter('Un PDF, une vidéo et un texte rejoignent la liste de la fiche', lignesDeFichiers === 4, `${lignesDeFichiers} ligne(s)`);
    const idDe = async (nom) =>
      fiche.locator('[data-coffre-image]', { hasText: nom }).first().getAttribute('data-coffre-image').catch(() => null);
    const pdfId = await idDe('Recto.pdf');
    const videoId = await idDe('film.mp4');
    if (pdfId) {
      await fiche.locator(`[data-coffre-fichier-ouvrir="${pdfId}"]`).hover();
      const bulle = await page.locator(`[data-coffre-apercu-rapide="${pdfId}"]`).first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
      noter('Le survol d’une ligne montre un aperçu rapide', bulle);
      await page.screenshot({ path: path.join(SHOTS, 'coffre-fort-fichiers-survol.png') });
      await fiche.locator(`[data-coffre-fichier-ouvrir="${pdfId}"]`).click();
      const visionneuse = await page.locator('[role="dialog"][data-state="open"] iframe').first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
      noter('Un clic sur le PDF ouvre la visionneuse', visionneuse);
      await fermerVisionneuse(page);
    }
    await fiche.locator('[data-coffre-enregistrer]').click();
    await fiche.waitFor({ state: 'hidden', timeout: 10000 });
    const compteurQuatre = await page.locator('[data-coffre-acces] [data-coffre-nombre-images="4"]').count();
    noter('La ligne de la liste compte les quatre fichiers', compteurQuatre === 1);
    if (pdfId) {
      const pdfClient = await statut(`/api/attachment?id=${pdfId}`, JETON_CLIENT);
      noter('Un compte client ne peut pas ouvrir le PDF du coffre', pdfClient === 403, `statut ${pdfClient}`);
    }
    if (videoId) {
      const morceau = await statut(`/api/attachment?id=${videoId}`, JETON, { headers: { range: 'bytes=0-3' } });
      noter('La vidéo du coffre se lit par morceaux', morceau === 206, `statut ${morceau}`);
    }
    await page.locator('[data-coffre-acces]').first().click();
    await fiche.waitFor({ state: 'visible', timeout: 10000 });

    // 5. Retirer l'image puis enregistrer l'efface du serveur.
    if (imageId) {
      await fiche.locator(`[data-coffre-image-retirer="${imageId}"]`).click();
      await fiche.locator('[data-coffre-enregistrer]').click();
      await fiche.waitFor({ state: 'hidden', timeout: 10000 });
      const apresRetrait = await statut(`/api/attachment?id=${imageId}`, JETON);
      noter('Une image retirée de sa fiche est effacée du serveur', apresRetrait === 404, `statut ${apresRetrait}`);
      const reste = await page.locator('[data-coffre-acces] [data-coffre-nombre-images="3"]').count();
      noter('La ligne de la liste ne compte plus l’image retirée', reste === 1);
    }

    noter('Aucune erreur JavaScript de page pendant le scénario', erreurs.length === 0, erreurs.join(' | '));
  } finally {
    await navigateur.close();
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis.`);
  if (echecs.length) console.log('Journal du démon :\n' + journal.slice(-60).join(''));
  // On SORT explicitement : le démon d'essai tient la boucle d'événements éveillée.
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error('ÉCHEC :', error);
  console.log('Journal du démon :\n' + journal.slice(-60).join(''));
  process.exit(1);
});
