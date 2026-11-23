#!/usr/bin/env node
/**
 * LA CLOCHE D'UN CLIENT (VUE PAR HAIKO) ET LA FICHE D'UNE DEMANDE.
 *
 *   npm run build && node scripts/verif-cloche-client-et-fiche.mjs
 *
 * Le script monte son PROPRE démon (port `BELUGA_CLOCHE_PORT`, 7233 par
 * défaut), sur une base neuve : deux clients sur deux projets, un Haiko. Il ne
 * reprend jamais `BELUGA_URL` ni `BELUGA_TOKEN`.
 *
 * Ce qui est vérifié :
 *   1. LES REPÈRES — une demande jamais ouverte porte « Nouvelle », et, vue par
 *      Haiko, « À traiter » tant qu'elle est dans « À faire » sans carte ;
 *   2. LA CLOCHE DU CLIENT — posée dans la barre d'en-tête de l'application
 *      (celle du fil d'Ariane « Messagerie › client » : l'espace vu par Haiko
 *      n'a plus de rang à lui depuis la refonte du 11/10/2026), à gauche du
 *      menu de l'espace (trois points verticaux dans l'application, le burger
 *      restant à la porte des clients) ; son chiffre est celui de la ligne du
 *      client, elle ne liste que SES éléments (rien de l'autre client), et une
 *      ligne mène à sa demande ;
 *   3. LE CHARGEMENT — le champ de commentaire reste collé au bas de la fiche
 *      du premier au dernier instant (téléphone) ;
 *   4. LE FIL — il s'ouvre sur ses derniers messages sans replier la
 *      description ; remonté, un message qui arrive ne le fait pas sauter ;
 *   5. LA DESCRIPTION — en édition, elle occupe toute la largeur de l'entête,
 *      sur téléphone et sur ordinateur ;
 *   6. L'EXTINCTION — ouvrir la demande éteint « Nouvelle » et fait baisser la cloche.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Database = require(path.join(RACINE, 'node_modules/better-sqlite3'));
const PORT = Number(process.env.BELUGA_CLOCHE_PORT || 7233);
const HOTE = 'my.test';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-cloche-client-'));
const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
for (const dossier of [DATA, PROJETS]) fs.mkdirSync(dossier, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

let demon = null;
let navigateur = null;
const journal = [];
process.on('exit', () => {
  try {
    demon?.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

const envDemon = { ...process.env };
delete envDemon.BELUGA_URL;
delete envDemon.BELUGA_TOKEN;
demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...envDemon,
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));

async function attendrePort(limiteMs = 90000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
if (!(await attendrePort())) {
  console.error('le démon n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Le décor                                                            */
/* ------------------------------------------------------------------ */

const A = { id: 'u-a', identifiant: 'client-a', motDePasse: 'mot-de-passe-a-2026', nom: 'Client A', projet: 'p-a' };
const B = { id: 'u-b', identifiant: 'client-b', motDePasse: 'mot-de-passe-b-2026', nom: 'Client B', projet: 'p-b' };
const HAIKO = { id: 'u-haiko', identifiant: 'haiko-cloche', motDePasse: 'mot-de-passe-haiko-2026' };
const COMMENTAIRES_DE_A = 14;

process.env.BELUGA_DATA = DATA;
const comptes = await import(path.join(RACINE, 'server/dist/comptes.js'));
const { openDb } = await import(path.join(RACINE, 'server/dist/db.js'));
const espace = await import(path.join(RACINE, 'server/dist/espace-client.js'));
openDb();

let demandeA;
let demandeNeuve;
let demandeB;
{
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  for (const projet of [A.projet, B.projet]) {
    fs.mkdirSync(path.join(PROJETS, projet), { recursive: true });
    db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
      projet,
      `Projet ${projet}`,
      path.join(PROJETS, projet),
      0,
      JSON.stringify({ id: projet, name: `Projet ${projet}`, path: path.join(PROJETS, projet), archived: false, createdAt: maintenant, updatedAt: maintenant }),
      maintenant,
      maintenant,
    );
  }
  const poser = (compte, role, nom, projets) => {
    const sel = crypto.randomBytes(16);
    db.prepare(
      `INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(compte.id, compte.identifiant, role, nom, sel.toString('hex'), comptes.empreinte(compte.motDePasse, sel), maintenant);
    for (const p of projets) db.prepare('INSERT INTO user_projects (user_id, project_id) VALUES (?, ?)').run(compte.id, p);
  };
  poser(A, 'client', A.nom, [A.projet]);
  poser(B, 'client', B.nom, [B.projet]);
  poser(HAIKO, 'admin', 'Haiko', []);
  db.close();

  const auteurA = { id: A.id, nom: A.nom, role: 'client' };
  const auteurHaiko = { id: HAIKO.id, nom: 'Haiko', role: 'admin' };
  demandeA = espace.creerDemande(auteurA, {
    projectId: A.projet,
    titre: 'Pièces jointes du calendrier',
    description: 'Ce que je voudrais pouvoir faire : joindre un fichier. Pourquoi c’est utile : pour tout garder au même endroit.',
  });
  // Un long fil. Commenter vaut lecture pour son auteur : les réponses de Haiko
  // viennent d'abord, puis celles du client, qui restent non lues pour lui.
  for (let i = 0; i < 6; i++) {
    espace.commenterDemande(auteurHaiko, demandeA.id, `Réponse numéro ${i + 1} de Haiko, assez longue pour prendre de la place.`);
  }
  // Plus tard que la dernière lecture de Haiko, jamais dans la même milliseconde.
  await new Promise((r) => setTimeout(r, 20));
  for (let i = 0; i < COMMENTAIRES_DE_A; i++) {
    espace.commenterDemande(auteurA, demandeA.id, `Message numéro ${i + 1} du client, assez long pour prendre de la place.`);
  }
  // Une demande que Haiko n'a JAMAIS ouverte : ni lue, ni commentée.
  demandeNeuve = espace.creerDemande(auteurA, { projectId: A.projet, titre: 'Une demande jamais ouverte' });
  espace.envoyerAuFil(auteurA, A.id, 'Bonjour, une question sur la facture');
  demandeB = espace.creerDemande({ id: B.id, nom: B.nom, role: 'client' }, { projectId: B.projet, titre: 'Secret du client B' });
}
const ATTENDU_A = 1 + COMMENTAIRES_DE_A + 1;

/* ------------------------------------------------------------------ */
/* Le navigateur                                                        */
/* ------------------------------------------------------------------ */

const RACINE_HAIKO = `http://127.0.0.1:${PORT}`;
navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', `--host-resolver-rules=MAP ${HOTE} 127.0.0.1`],
});
const erreurs = [];

async function connecterHaiko(options) {
  const contexte = await navigateur.newContext({ locale: 'fr-CH', ...options });
  const page = await contexte.newPage();
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(RACINE_HAIKO, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('input[name="username"]', HAIKO.identifiant);
  await page.fill('input[name="password"]', HAIKO.motDePasse);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1500);
  return page;
}

async function ouvrirClient(page, client) {
  await page.goto(`${RACINE_HAIKO}/#espace/${client.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`[data-choix-client="${client.id}"]`, { timeout: 30000 });
  await page.waitForSelector('[data-demande]', { timeout: 30000 });
  await page.waitForTimeout(600);
}

/* --- Ordinateur : repères, cloche, cloisonnement, largeur ------------ */

const bureau = await connecterHaiko({ viewport: { width: 1280, height: 820 } });
await ouvrirClient(bureau, A);

const vignette = `[data-demande="${demandeNeuve.id}"]`;
noter(
  'une demande jamais ouverte porte « Nouvelle » sur sa vignette',
  (await bureau.locator(`${vignette} [data-vignette-nouvelle]`).count()) === 1,
);
noter(
  'vue par Haiko, une demande dans « À faire » sans carte porte « À traiter »',
  (await bureau.locator(`${vignette} [data-vignette-a-traiter]`).count()) === 1,
);

/*
 * L'ENTÊTE DE L'ESPACE VU PAR HAIKO EST LA BARRE D'EN-TÊTE DE L'APPLICATION
 * (refonte du 11/10/2026 : « une seule barre d'en-tête par écran »). Le client
 * choisi y est la suite du fil d'Ariane (`[data-entete-espace="fil"]`), et la
 * cloche comme le menu de l'espace montent à sa droite, parmi les gestes de la
 * page (`[data-gestes-de-page="barre"]`). Le menu y porte trois points
 * verticaux — même repère `espace-menu` que le burger de la porte des clients.
 */
const ordre = await bureau.evaluate(() => {
  const entete = document.querySelector('[data-entete-espace]')?.closest('[data-entete-de-zone]');
  const gestes = entete?.querySelector('[data-gestes-de-page="barre"]');
  const cloche = gestes?.querySelector('[data-cloche-espace="client"]');
  const menu = gestes?.querySelector('[data-menu-actions="espace-menu"]');
  if (!cloche || !menu) return null;
  return cloche.getBoundingClientRect().right <= menu.getBoundingClientRect().left + 1;
});
noter('la cloche du client est posée dans la barre d’en-tête, à gauche du menu de l’espace', ordre === true, `ordre : ${ordre}`);

const chiffre = Number(await bureau.locator('[data-cloche-espace-pastille]').first().getAttribute('data-cloche-espace-pastille'));
noter('le chiffre de la cloche est celui du non-lu du client', chiffre === ATTENDU_A, `cloche ${chiffre}, attendu ${ATTENDU_A}`);

await bureau.click('[data-cloche-espace="client"]');
await bureau.waitForSelector('[data-notification-espace]', { timeout: 15000 });
const lignes = await bureau.$$eval('[data-notification-espace]', (els) =>
  els.map((el) => ({ genre: el.getAttribute('data-notification-espace'), texte: el.textContent ?? '' })),
);
const genres = new Set(lignes.map((l) => l.genre));
noter(
  'la cloche liste la nouvelle demande, ses commentaires et la discussion',
  genres.has('nouvelle-demande') && genres.has('commentaire') && genres.has('message'),
  [...genres].join(', '),
);
noter('rien du client B n’apparaît dans la cloche du client A', !lignes.some((l) => l.texte.includes('Secret du client B')));

await bureau.click('[data-notification-espace="nouvelle-demande"] [role="button"]');
await bureau.waitForSelector(`[data-tiroir-demande="${demandeNeuve.id}"][data-fiche-chargee]`, { timeout: 15000 });
noter('une ligne de la cloche ouvre la demande concernée', true);

await bureau.waitForTimeout(900);
const largeurBureau = await mesurerLaDescription(bureau);
noter(
  'sur ordinateur, la description en édition occupe toute la largeur de l’entête',
  largeurBureau.ok,
  JSON.stringify(largeurBureau),
);

await bureau.keyboard.press('Escape');
await bureau.waitForTimeout(300);
await bureau.keyboard.press('Escape');
await bureau.waitForTimeout(1200);
const apres = await bureau.evaluate(
  (id) => ({
    nouvelle: document.querySelectorAll(`[data-demande="${id}"] [data-vignette-nouvelle]`).length,
    cloche: Number(document.querySelector('[data-cloche-espace-pastille]')?.getAttribute('data-cloche-espace-pastille') ?? 0),
  }),
  demandeNeuve.id,
);
noter(
  'ouvrir la demande éteint « Nouvelle » et fait baisser la cloche',
  apres.nouvelle === 0 && apres.cloche === ATTENDU_A - 1,
  JSON.stringify(apres),
);

await ouvrirClient(bureau, B);
await bureau.click('[data-cloche-espace="client"]');
await bureau.waitForSelector('[data-notification-espace]', { timeout: 15000 });
const lignesB = await bureau.$$eval('[data-notification-espace]', (els) => els.map((el) => el.textContent ?? ''));
noter(
  'la cloche du client B ne montre que ses éléments',
  lignesB.length === 1 && lignesB[0].includes('Secret du client B'),
  `${lignesB.length} ligne(s)`,
);

/** Ouvre l'édition de la description et compare sa largeur à celle de l'entête. */
async function mesurerLaDescription(page) {
  await page.click('[data-ouvrir-edition="description"]');
  await page.waitForSelector('[data-champ-edition="description"]');
  const mesure = await page.evaluate(() => {
    const entete = document.querySelector('[data-entete-fiche]');
    const champ = document.querySelector('[data-champ-edition="description"]');
    const style = getComputedStyle(entete);
    const utile = entete.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return { entete: Math.round(utile), champ: Math.round(champ.getBoundingClientRect().width) };
  });
  return { ...mesure, ok: mesure.champ >= mesure.entete - 2 };
}

/* --- Téléphone : chargement, fil, largeur ---------------------------- */

const telephone = await connecterHaiko({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await ouvrirClient(telephone, A);

// LE CHAMP DE COMMENTAIRE, MESURÉ À CHAQUE IMAGE DEPUIS LE CLIC : sa distance
// au bas de la fiche ne doit jamais bouger, silhouette comprise.
await telephone.evaluate(() => {
  window.__ecarts = [];
  const fin = performance.now() + 2500;
  const mesurer = () => {
    const fiche = document.querySelector('[data-tiroir-demande]');
    const champ = fiche?.querySelector('textarea');
    if (fiche && champ) {
      window.__ecarts.push({
        ecart: Math.round(fiche.getBoundingClientRect().bottom - champ.getBoundingClientRect().bottom),
        chargee: fiche.hasAttribute('data-fiche-chargee'),
      });
    }
    if (performance.now() < fin) requestAnimationFrame(mesurer);
  };
  requestAnimationFrame(mesurer);
});
await telephone.click(`[data-ouvrir-demande="${demandeA.id}"]`);
await telephone.waitForSelector(`[data-tiroir-demande="${demandeA.id}"][data-fiche-chargee]`, { timeout: 15000 });
await telephone.waitForTimeout(2700);
const ecarts = await telephone.evaluate(() => window.__ecarts);
const valeurs = ecarts.map((e) => e.ecart);
noter(
  'sur téléphone, le champ de commentaire reste au bas de la fiche, silhouette comprise',
  ecarts.some((e) => !e.chargee) && Math.max(...valeurs) - Math.min(...valeurs) <= 2,
  `${ecarts.filter((e) => !e.chargee).length} image(s) de silhouette, écarts ${Math.min(...valeurs)}…${Math.max(...valeurs)} px`,
);

const bas = await telephone.evaluate(() => {
  const zone = document.querySelector('[data-fil-fiche]');
  return {
    reste: Math.round(zone.scrollHeight - zone.scrollTop - zone.clientHeight),
    defile: zone.scrollHeight > zone.clientHeight + 50,
    description: document.querySelector('[data-description-entete]')?.getAttribute('data-description-entete'),
  };
});
noter(
  'le fil s’ouvre sur ses derniers messages, sans replier la description',
  bas.defile && bas.reste <= 4 && bas.description === 'depliee',
  JSON.stringify(bas),
);

// Remonté dans le fil, un commentaire du client arrive : l'écran ne saute pas.
await telephone.evaluate(() => {
  const zone = document.querySelector('[data-fil-fiche]');
  zone.scrollTop = 120;
  zone.dispatchEvent(new Event('scroll'));
});
await telephone.waitForTimeout(500);
const avantArrivee = await telephone.evaluate(() => document.querySelector('[data-fil-fiche]').scrollTop);
const client = await navigateur.newContext({ locale: 'fr-CH', viewport: { width: 1280, height: 820 } });
const pageA = await client.newPage();
await pageA.goto(`http://${HOTE}:${PORT}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await pageA.fill('input[name="username"]', A.identifiant);
await pageA.fill('input[name="password"]', A.motDePasse);
await Promise.all([pageA.waitForNavigation({ waitUntil: 'domcontentloaded' }), pageA.click('button[type="submit"]')]);
await pageA.waitForSelector(`[data-ouvrir-demande="${demandeA.id}"]`, { timeout: 30000 });
await pageA.click(`[data-ouvrir-demande="${demandeA.id}"]`);
await pageA.waitForSelector(`[data-tiroir-demande="${demandeA.id}"][data-fiche-chargee]`, { timeout: 15000 });
await pageA.fill(`[data-tiroir-demande="${demandeA.id}"] textarea`, 'Un message qui arrive pendant la lecture');
await pageA.click('[data-envoyer="commentaire"]');
await telephone.waitForFunction(
  () => document.querySelector('[data-commentaires]')?.textContent?.includes('Un message qui arrive pendant la lecture'),
  null,
  { timeout: 15000 },
);
await telephone.waitForTimeout(500);
const apresArrivee = await telephone.evaluate(() => document.querySelector('[data-fil-fiche]').scrollTop);
noter(
  'remonté dans le fil, un message qui arrive ne fait pas sauter l’écran',
  Math.abs(apresArrivee - avantArrivee) <= 2,
  `${avantArrivee} → ${apresArrivee}`,
);

const largeurTelephone = await mesurerLaDescription(telephone);
noter(
  'sur téléphone, la description en édition occupe toute la largeur de l’entête',
  largeurTelephone.ok,
  JSON.stringify(largeurTelephone),
);

noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

await navigateur.close();
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
process.exit(echecs ? 1 : 0);
