#!/usr/bin/env node
/**
 * LES BOUTONS SOUS LE FIL, SUR TÉLÉPHONE — ET LE FIL D'UNE CARTE SANS JOURNAL.
 *
 *   node scripts/verif-boutons-sous-le-fil.mjs
 *
 * Démon d'essai à soi (base neuve, aucun moteur appelé), navigateur à la
 * taille d'un téléphone (390 × 844). Ce qui est vérifié, sur des cartes qui
 * posent plusieurs boutons sous le fil :
 *   1. tous les boutons de la barre d'action ont la MÊME hauteur, et pas
 *      l'écrasée des petits boutons (≥ 34 px) ;
 *   2. jamais deux boutons à libellé sur la même ligne ;
 *   3. aucun texte ne déborde de son bouton ni de l'écran ;
 *   4. une carte sans journal ne coche aucune étape vide : sa description se
 *      lit sous « Demande », le reste se dit « sautée ».
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_BOUTONS_FIL_PORT || 7236);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { TMP, DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-boutons-fil-', port: PORT });

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const ARRETEE = { id: 'c-arretee', titre: 'Tâche arrêtée — reprendre ou clore', agent: 'ag-arretee' };
const SANS_JOURNAL = { id: 'c-sans-journal', titre: 'Carte posée sans journal — à déployer' };
const DESCRIPTION = 'Retirer l’ancienne mémoire en fichiers, archivée en ZIP.';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification boutons sous le fil',
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai boutons',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

  const agent = {
    id: ARRETEE.agent,
    projectId: PROJET_ID,
    cardId: ARRETEE.id,
    role: 'task',
    title: ARRETEE.titre,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'idle',
    startedAt: maintenant,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(agent.id, PROJET_ID, ARRETEE.id, 'task', 'idle', JSON.stringify(agent), maintenant, maintenant);

  const poserCarte = (cible, colonne, position, extra) => {
    const carte = {
      id: cible.id,
      projectId: PROJET_ID,
      title: cible.titre,
      description: DESCRIPTION,
      labels: [],
      column: colonne,
      position,
      origin: 'agent',
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      excludedFromDeploy: false,
      horsTache: false,
      createdAt: maintenant,
      updatedAt: maintenant,
      ...extra,
    };
    db.prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(carte.id, PROJET_ID, colonne, position, carte.title, JSON.stringify(carte), maintenant, maintenant);
  };
  poserCarte(ARRETEE, 'planned', 1, {
    agentId: ARRETEE.agent,
    codeDejaEnregistre: true,
    estimate: { machineSeconds: 60, seniorHours: 0.5, confidence: 'medium', failed: false },
    scheduling: { asap: false, attempts: 1, restarts: 1, suspendu: true, waitingReason: 'Arrêtée à la main.' },
  });
  poserCarte(SANS_JOURNAL, 'to_deploy', 1, { scheduling: { asap: false, attempts: 0, restarts: 0 } });
  db.close();
}

const ouvrirLaCarte = async (page, titre) => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await page.locator(`article:has-text(${JSON.stringify(titre)})`).first().click();
  await page.waitForTimeout(2500);
};

/** La géométrie de chaque bouton À LIBELLÉ de la barre d'action. */
const boutonsDeLaBarre = (page) =>
  page.evaluate(() => {
    const barre = [...document.querySelectorAll('[data-barre-action]')].pop();
    if (!barre) return null;
    return [...barre.querySelectorAll('button')]
      .filter((b) => (b.textContent ?? '').trim().length > 0 && b.getBoundingClientRect().width > 0)
      .map((b) => {
        const r = b.getBoundingClientRect();
        const libelle = b.querySelector('span') ?? b;
        return {
          texte: (b.textContent ?? '').trim(),
          haut: Math.round(r.top),
          hauteur: Math.round(r.height),
          droite: Math.round(r.right),
          deborde: b.scrollWidth > b.clientWidth + 1 || libelle.scrollWidth > libelle.clientWidth + 1 && getComputedStyle(libelle).textOverflow !== 'ellipsis',
        };
      });
  });

async function juger(page, nom) {
  const boutons = (await boutonsDeLaBarre(page)) ?? [];
  noter(`${nom} : la barre porte plusieurs boutons`, boutons.length >= 2, boutons.map((b) => b.texte).join(' | '));
  const hauteurs = boutons.map((b) => b.hauteur);
  noter(
    `${nom} : tous de la même hauteur, pas écrasés`,
    hauteurs.length > 0 && Math.max(...hauteurs) - Math.min(...hauteurs) <= 1 && Math.min(...hauteurs) >= 34,
    hauteurs.join(', '),
  );
  const lignes = new Set(boutons.map((b) => b.haut));
  noter(`${nom} : un bouton par ligne`, lignes.size === boutons.length, [...lignes].join(', '));
  noter(
    `${nom} : aucun texte hors du bouton ni de l’écran`,
    boutons.every((b) => !b.deborde && b.droite <= 390),
    boutons.filter((b) => b.deborde || b.droite > 390).map((b) => b.texte).join(' | ') || 'rien',
  );
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  await ouvrirLaCarte(page, ARRETEE.titre);
  await juger(page, 'tâche arrêtée');
  await page.screenshot({ path: path.join(TMP, 'arretee.png') });

  await ouvrirLaCarte(page, SANS_JOURNAL.titre);
  await juger(page, 'carte à déployer');
  const sautees = await page.locator('[data-point-avenir="sautee"]').count();
  noter('la carte sans journal dit ses étapes « sautées », sans les cocher', sautees >= 3, `${sautees} étape(s) sautée(s)`);
  noter(
    'sa description se lit sous « Demande »',
    (await page.getByText(DESCRIPTION).count()) > 0 || (await page.locator('[data-point="demande"] [data-point-bascule]').count()) > 0,
  );
  await page.screenshot({ path: path.join(TMP, 'a-deployer.png') });

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await navigateur.close();
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.slice(-20).join(''));
  process.exit(1);
});
