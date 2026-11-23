#!/usr/bin/env node
/**
 * DEUX FICHIERS DÉPOSÉS, UN SEUL NOM VISIBLE — dans un vrai navigateur.
 *
 *   node scripts/verif-tag-place-reservee.mjs
 *
 * Deux promesses, sur la barre d'écriture :
 *
 *  1. LE NOM D'ORIGINE N'APPARAÎT NULLE PART. Ni dans la barre des pièces
 *     jointes au-dessus du champ, ni dans une infobulle, ni dans le texte de
 *     remplacement d'une vignette : partout l'identifiant généré, le même que
 *     celui du tag du prompt. Le fichier, lui, garde son nom sur le disque.
 *  2. LA PASTILLE NE LAISSE PLUS DE VIDE AVANT SA CROIX. La place réservée
 *     dans le champ est celle de l'étiquette COURTE, et la pastille n'est plus
 *     étirée de force : l'étiquette et la croix se suivent.
 *
 * Démon et base d'ESSAI à soi (`BELUGA_PLACE_PORT`), plafond d'agents à zéro :
 * rien ne part au moteur. Il ne reprend jamais `BELUGA_URL`.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { ouvrirLaCarte } from './lib/navigation.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_PLACE_PORT || 7234);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { TMP, DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-tag-place-', port: PORT });

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-place';
const CARTE_ID = 'c-place';
const AGENT_ID = 'a-place';
const TITRE = 'Carte d’essai — place réservée des tags';
const NOMS = ['capture-tres-longue-du-controle.png', 'IMG_20260912_Capture_ecran.png'];
/* DEUX images DIFFÉRENTES : le dépôt reconnaît un même contenu et ne le range
   qu'une fois — deux fichiers identiques ne feraient donc qu'une pièce jointe. */
const PNGS = [
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
];

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification place réservée',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('DELETE FROM projects').run();
  const projet = { id: PROJET_ID, name: 'Essai place', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: maintenant, updatedAt: maintenant };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);
  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    agentId: AGENT_ID,
    title: TITRE,
    description: 'Carte du contrôle.',
    labels: [],
    column: 'planned',
    position: 1,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none', mode: 'plan' },
    scheduling: { asap: false, attempts: 0, restarts: 0 },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(CARTE_ID, PROJET_ID, 'planned', 1, TITRE, JSON.stringify(carte), maintenant, maintenant);
  const agent = { id: AGENT_ID, projectId: PROJET_ID, cardId: CARTE_ID, role: 'cadrage', title: TITRE, run: carte.run, status: 'idle', createdAt: maintenant, updatedAt: maintenant };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(AGENT_ID, PROJET_ID, CARTE_ID, 'cadrage', 'idle', JSON.stringify(agent), maintenant, maintenant);
  const demande = { id: 'm-demande', agentId: AGENT_ID, role: 'user', content: 'Essai du tag.', steps: [], todos: [], proposals: [], questions: [], downloads: [], attachments: [], createdAt: maintenant };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    demande.id,
    AGENT_ID,
    'user',
    JSON.stringify(demande),
    maintenant,
  );
  db.close();
}

/** Les alias ENREGISTRÉS des pièces déposées — la seule preuve qui vaille. */
function aliasEnBase() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const lignes = db.prepare('SELECT data FROM attachments').all();
  db.close();
  const pieces = lignes.map((l) => JSON.parse(l.data));
  return NOMS.map((nom) => pieces.find((p) => p.name === nom)?.alias ?? null);
}

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  await new Promise((r) => setTimeout(r, 1500));

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(5000);
  await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });
  await ouvrirLaCarte(page, { id: CARTE_ID, titre: TITRE, projetId: PROJET_ID });
  await page.waitForSelector('[data-composer] [data-composer-file]', { state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(1000);

  await page.locator('[data-composer] textarea').last().click();
  await page.locator('[data-composer] textarea').last().type('Voir ');
  /* DEUX fichiers, déposés d'un coup : deux tags, deux vignettes. */
  await page.setInputFiles(
    '[data-composer] [data-composer-file]',
    NOMS.map((nom, i) => ({ name: nom, mimeType: 'image/png', buffer: PNGS[i] })),
  );
  await page.waitForTimeout(3000);
  await page.waitForSelector('[data-prompt-file-pastille]', { timeout: 20_000 });
  await page.waitForTimeout(800);

  const alias = aliasEnBase();
  noter('les deux pièces ont leur alias enregistré', alias.every(Boolean), alias.join(', '));

  const releve = await page.evaluate(() => {
    const composer = document.querySelector('[data-composer]');
    const pastilles = [...composer.querySelectorAll('[data-prompt-file-pastille]')];
    const mesures = pastilles.map((pastille) => {
      const etiquette = pastille.querySelector('span:not([data-prompt-file-close])');
      const croix = pastille.querySelector('[data-prompt-file-close]');
      const e = etiquette.getBoundingClientRect();
      const c = croix.getBoundingClientRect();
      return {
        etiquette: pastille.getAttribute('data-prompt-file-etiquette'),
        /* LE VIDE ENTRE L'ÉTIQUETTE ET LA CROIX : c'est lui qu'on chassait. */
        ecart: Math.round((c.left - e.right) * 10) / 10,
      };
    });
    /* TOUT CE QUI S'AFFICHE DANS LA BARRE D'ÉCRITURE : textes visibles,
       infobulles, textes de remplacement des images. */
    const affiche = [];
    for (const noeud of composer.querySelectorAll('*')) {
      const titre = noeud.getAttribute('title');
      if (titre) affiche.push(titre);
      const alt = noeud.getAttribute('alt');
      if (alt) affiche.push(alt);
    }
    affiche.push(composer.innerText);
    affiche.push(composer.querySelector('textarea')?.value ?? '');
    return { mesures, affiche: affiche.join('\n'), vignettes: [...composer.querySelectorAll('[data-piece-etiquette]')].map((n) => n.getAttribute('data-piece-etiquette')) };
  });

  noter('deux pastilles sont dessinées, une par fichier', releve.mesures.length === 2, JSON.stringify(releve.mesures));
  for (const [i, mesure] of releve.mesures.entries()) {
    noter(
      `la pastille ${i + 1} porte l’identifiant généré`,
      mesure.etiquette === `#${alias[i]}`,
      `${mesure.etiquette} attendu #${alias[i]}`,
    );
    /* L'écart normal est celui du `gap` de la pastille (0,35 em de 0,82 em ≈ 4 px).
       Au-delà de 8 px, c'est le trou d'un étirement. */
    noter(`aucun vide entre l’étiquette ${i + 1} et sa croix`, mesure.ecart <= 8, `${mesure.ecart} px`);
  }

  noter(
    'la barre des pièces jointes montre l’identifiant généré, pas le nom',
    releve.vignettes.length === 2 && releve.vignettes.every((v, i) => v === `#${alias[i]}`),
    JSON.stringify(releve.vignettes),
  );
  for (const nom of NOMS) {
    noter(`le nom d’origine « ${nom} » n’apparaît NULLE PART`, !releve.affiche.includes(nom));
  }

  await page.screenshot({ path: path.join(TMP, 'tag-place-reservee.png') });
  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  if (echecs.length) console.log(`(capture dans ${TMP})`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  console.error(journal.slice(-30).join(''));
  process.exit(1);
});
