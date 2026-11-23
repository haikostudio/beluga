#!/usr/bin/env node
/**
 * UN FICHIER JOINT SE LIT PAR SON IDENTIFIANT COURT DANS LA BARRE D'ÉCRITURE —
 * dans un vrai navigateur.
 *
 *   node scripts/verif-tag-identifiant-court.mjs
 *
 * Le plan d'un agent cite « #1a0c » ; la barre d'écriture montrait le nom
 * d'origine, et rien ne reliait les deux. Une image déposée par le trombone
 * doit maintenant poser une pastille qui porte l'ALIAS enregistré de la pièce.
 * Le nom d'origine ne paraît plus NULLE PART à l'écran, pas même au survol, et
 * la place réservée dans le champ est celle de l'étiquette courte — sans que le
 * tag ENREGISTRÉ (« [fichier: nom] ») ni la mise en page du champ ne changent.
 *
 * Démon et base d'ESSAI à soi (`BELUGA_TAG_PORT`), plafond d'agents à zéro :
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
const PORT = Number(process.env.BELUGA_TAG_PORT || 7233);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { TMP, DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-tag-alias-', port: PORT });

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-tag';
const CARTE_ID = 'c-tag';
const AGENT_ID = 'a-tag';
const TITRE = 'Carte d’essai — identifiant court';
const NOM = 'capture-du-controle-longue.png';
/* Une image PNG d'un pixel : le dépôt la range comme n'importe quelle capture. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification identifiant court',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('DELETE FROM projects').run();
  const projet = { id: PROJET_ID, name: 'Essai tag', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: maintenant, updatedAt: maintenant };
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

/** L'alias ENREGISTRÉ de la pièce déposée — la seule preuve qui vaille. */
function aliasEnBase() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const lignes = db.prepare('SELECT data FROM attachments').all();
  db.close();
  const piece = lignes.map((l) => JSON.parse(l.data)).find((p) => p.name === NOM);
  return piece?.alias ?? null;
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
  await page.setInputFiles('[data-composer] [data-composer-file]', { name: NOM, mimeType: 'image/png', buffer: PNG });
  await page.waitForSelector('[data-prompt-file-pastille]', { timeout: 20_000 });
  await page.waitForTimeout(800);

  const alias = aliasEnBase();
  const releve = await page.evaluate(() => {
    const pastille = document.querySelector('[data-prompt-file-pastille]');
    const drapeau = pastille?.closest('[data-prompt-file-flag]');
    const croix = pastille?.querySelector('[data-prompt-file-close]');
    const champ = document.querySelector('[data-composer] textarea');
    if (!pastille || !drapeau || !croix) return null;
    const p = pastille.getBoundingClientRect();
    const t = drapeau.getBoundingClientRect();
    const c = croix.getBoundingClientRect();
    return {
      etiquette: pastille.innerText.replace(/\s+/g, ' ').trim(),
      survol: pastille.getAttribute('title'),
      largeurPastille: Math.round(p.width),
      largeurTag: Math.round(t.width),
      dansLeTag: p.left >= t.left - 1 && p.right <= t.right + 1,
      margeCroix: Math.round((t.right - c.right) * 10) / 10,
      trouAGauche: Math.round((p.left - t.left) * 10) / 10,
      texteEnregistre: champ?.value ?? '',
    };
  });
  noter('la pièce déposée a un alias enregistré', !!alias, String(alias));
  noter('la pastille montre « #alias », celui de la pièce en base', !!releve && releve.etiquette === `#${alias}`, JSON.stringify(releve));
  /* LE NOM D'ORIGINE N'EXISTE PLUS À L'ÉCRAN, pas même au survol : l'étiquette
     courte est le SEUL nom visible d'une pièce jointe. */
  noter('la pastille ne porte plus le nom d’origine au survol', !releve?.survol, String(releve?.survol));
  noter('la pastille tient dans la largeur du tag qu’elle recouvre', releve?.dansLeTag === true, JSON.stringify(releve));
  noter('aucun trou ne s’ouvre autour d’une étiquette plus courte que le nom', (releve?.trouAGauche ?? 99) <= 8, `${releve?.trouAGauche} px à gauche`);
  noter('la croix garde de la marge avant le mot suivant', (releve?.margeCroix ?? 0) >= 4, `${releve?.margeCroix} px`);
  /* LE CHAMP PORTE LE MASQUE DU TAG (`tagsMasques`) : il réserve désormais la
     place de l'ÉTIQUETTE COURTE, pas celle du nom d'origine — c'est la
     correction du trou entre l'étiquette et la croix. Le texte ENREGISTRÉ, lui,
     garde le nom : il est reconstruit au démasquage (`sansMasque`), vérifié
     dans `server/src/test/ancres-fichiers.test.ts`. */
  noter(
    'le champ réserve la place de l’étiquette courte, pas celle du nom d’origine',
    (releve?.texteEnregistre ?? '').includes(`#${alias}`) && !(releve?.texteEnregistre ?? '').includes(NOM),
    JSON.stringify(releve?.texteEnregistre ?? ''),
  );
  /* LA PASTILLE N'EST PLUS ÉTIRÉE sur la largeur du nom d'origine : elle tient
     dans la place réservée, sans la remplir de vide. */
  noter(
    'la pastille n’est plus étirée à la largeur du nom d’origine',
    (releve?.largeurPastille ?? 0) <= (releve?.largeurTag ?? 0) + 2,
    `${releve?.largeurPastille} px de pastille pour ${releve?.largeurTag} px de tag`,
  );

  await page.screenshot({ path: path.join(TMP, 'tag-identifiant-court.png') });
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
