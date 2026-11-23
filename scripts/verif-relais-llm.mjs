#!/usr/bin/env node
/**
 * LE RELAIS LLM : LA CLÉ RESTE AU SERVEUR.
 *
 * Ce que ce contrôle prouve, sur un démon à soi (bac à sable, base neuve) :
 *  1. la porte `/api/externe/llm` REFUSE un appel sans clé nommée ;
 *  2. elle refuse une clé inconnue ;
 *  3. elle refuse un envoi mal formé, en le disant ;
 *  4. sans fiche OpenRouter au coffre, elle le DIT (503) au lieu de se taire ;
 *  5. avec une fiche au coffre, elle rend une vraie réponse du modèle ;
 *  6. la clé OpenRouter ne figure JAMAIS dans ce qui est rendu à l'appelant.
 *
 *   node scripts/verif-relais-llm.mjs
 *
 * La clé OpenRouter est lue dans le coffre RÉEL (`/root/beluga/data`, ou
 * `BELUGA_COFFRE_SOURCE`). Sans elle, l'étape 5 est SAUTÉE en le disant — le
 * reste du contrôle tient debout sans réseau.
 *
 * Sortie 0 = tout va bien, 1 = un contrôle a échoué.
 */

import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Le dépôt d'où PART ce script — jamais un chemin écrit en dur.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7193);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-relais-llm-'));
const DATA = path.join(TMP, 'data');
fs.mkdirSync(DATA, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const dist = (fichier) => pathToFileURL(path.join(RACINE, 'server', 'dist', fichier)).href;

/* ------------------------------------------------------------------ */
/* La clé OpenRouter du coffre RÉEL — jamais écrite dans ce fichier    */
/* ------------------------------------------------------------------ */

const SOURCE_COFFRE = process.env.BELUGA_COFFRE_SOURCE || '/root/beluga/data';

/**
 * La lecture se fait dans un PROCESSUS À PART, jamais ici : les réglages du
 * démon (dont le dossier de données) sont figés au premier import, et lire le
 * coffre réel dans ce processus ferait ensuite écrire le bac à sable DANS LA
 * BASE DE PRODUCTION (constaté le 30/08/2026).
 */
function cleReelle() {
  if (!fs.existsSync(path.join(SOURCE_COFFRE, 'beluga.db'))) return undefined;
  const lecteur = `
    const { listerAcces } = await import(${JSON.stringify(dist('coffre-fort.js'))});
    const { cleOpenRouterDuRelais } = await import('@beluga/shared');
    process.stdout.write(cleOpenRouterDuRelais(listerAcces()) || '');
  `;
  try {
    return (
      execFileSync('node', ['--input-type=module', '-e', lecteur], {
        cwd: RACINE,
        encoding: 'utf8',
        env: { ...process.env, BELUGA_DATA: SOURCE_COFFRE },
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

const CLE_OPENROUTER = cleReelle();

/* ------------------------------------------------------------------ */
/* Le décor du bac à sable : une clé nommée, et la fiche du coffre     */
/* ------------------------------------------------------------------ */

process.env.BELUGA_DATA = DATA;
const { creerCleApi } = await import(dist('cles-api.js'));
const { enregistrerAcces } = await import(dist('coffre-fort.js'));

const creation = creerCleApi('Contrôle du relais');
if (!creation.ok) {
  console.error(`Impossible de fabriquer la clé d'essai : ${creation.raison}`);
  process.exit(1);
}
const CLE_NOMMEE = creation.secret;

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: path.join(TMP, 'projets'),
    BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
demon.stdout.on('data', () => {});
demon.stderr.on('data', () => {});

function nettoyer() {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
}
process.on('exit', nettoyer);

async function attendrePort(limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas ouvert son port.');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Les contrôles                                                       */
/* ------------------------------------------------------------------ */

async function appeler(corps, cle) {
  const reponse = await fetch(`${BASE}/api/externe/llm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cle ? { 'X-Beluga-Cle': cle } : {}),
    },
    body: JSON.stringify(corps),
  });
  const texte = await reponse.text();
  return { statut: reponse.status, texte };
}

const CONVERSATION = { messages: [{ role: 'user', content: 'Réponds exactement : PONG' }], maxTokens: 10 };

const sansCle = await appeler(CONVERSATION);
noter('sans clé nommée, la porte refuse', sansCle.statut === 401, `statut ${sansCle.statut}`);

const inconnue = await appeler(CONVERSATION, `hkd_${'0'.repeat(64)}`);
noter('une clé inconnue est refusée', inconnue.statut === 401, `statut ${inconnue.statut}`);

const malForme = await appeler({ messages: [] }, CLE_NOMMEE);
noter(
  'un envoi sans message est refusé, en le disant',
  malForme.statut === 400 && /message/i.test(malForme.texte),
  `statut ${malForme.statut}`,
);

const sansFiche = await appeler(CONVERSATION, CLE_NOMMEE);
noter(
  'sans clé OpenRouter au coffre, la panne se dit (503)',
  sansFiche.statut === 503 && /coffre/i.test(sansFiche.texte),
  `statut ${sansFiche.statut}`,
);

if (!CLE_OPENROUTER) {
  console.log('  SAUTÉ  appel réel au modèle — aucune fiche OpenRouter dans le coffre de ce serveur');
} else {
  const pose = enregistrerAcces({
    nom: 'OpenRouter (essai)',
    type: 'cle-api',
    champs: { service: 'OpenRouter', cle: CLE_OPENROUTER },
  });
  if (!pose.ok) {
    noter('la fiche OpenRouter se range au coffre', false, pose.raison);
  } else {
    const vrai = await appeler(CONVERSATION, CLE_NOMMEE);
    noter('avec la fiche au coffre, le modèle répond', vrai.statut === 200, `statut ${vrai.statut}`);
    noter(
      'la clé OpenRouter ne part JAMAIS vers l’appelant',
      !vrai.texte.includes(CLE_OPENROUTER) && !sansFiche.texte.includes(CLE_OPENROUTER),
    );
  }
}

const rates = resultats.filter((r) => !r.ok);
console.log('');
if (rates.length) {
  console.log(`${rates.length} contrôle(s) en échec : ${rates.map((r) => r.nom).join(', ')}`);
  process.exit(1);
}
console.log(`OK — ${resultats.length} contrôles passés : la clé reste au serveur.`);
process.exit(0);
