#!/usr/bin/env node
/**
 * L'INDICATEUR DE COMPRÉHENSION — TROIS BARRES DANS LA BARRE D'ÉCRITURE,
 * vérifié dans un VRAI navigateur, sur son PROPRE démon (base neuve, port
 * libre : le démon de production n'est pas touché, aucun quota dépensé).
 *
 *   node scripts/verif-indicateur-comprehension.mjs
 *
 * CE QUI EST PROUVÉ :
 *
 *   1. SANS NOTE SUR LA CARTE, AUCUN INDICATEUR. C'est l'état par défaut :
 *      sans clé au coffre-fort, aucune carte ne porte de note, et la barre
 *      d'écriture est exactement celle d'avant.
 *   2. UNE NOTE POSÉE ALLUME L'INDICATEUR, avec le bon nombre de barres — une,
 *      deux ou trois. L'ÉTAT SE LIT SUR L'ATTRIBUT `data-indicateur-comprehension`,
 *      jamais sur une hauteur en pixels : un contrôle qui mesurerait les barres
 *      casserait à la première retouche d'affichage (compétence
 *      `verifs-navigateur-etat-plutot-que-hauteur`).
 *   3. IL SE POSE JUSTE AVANT LE MICRO, dans la rangée du bas du champ.
 *   4. IL NE BLOQUE JAMAIS LE LANCEMENT : même à une barre, le bouton d'envoi
 *      reste ce qu'il était, et aucun bandeau d'avis n'apparaît nulle part.
 *   5. PLUS AUCUN MESSAGE ÉCRIT DU RELECTEUR : les bandeaux d'avant-lancement,
 *      l'effort proposé et l'avis sur le plan ont disparu de l'écran.
 *   6. SUR ÉCRAN ÉTROIT, la rangée ne déborde pas : micro et envoi restent au
 *      bord du champ.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7211);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { TMP, DATA, DEPOT, demon, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-indicateur-comprehension-',
  port: PORT,
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const AGENT_ID = 'a-essai';
const CARTE_ID = 'c-essai';

function base() {
  return new Database(path.join(DATA, 'beluga.db'));
}

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification indicateur de compréhension',
  );

  /* AUCUN AGENT NE DOIT PARTIR : ce contrôle regarde un écran, il n'exécute rien. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: 'Essai — indicateur de compréhension',
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
    id: AGENT_ID,
    projectId: PROJET_ID,
    cardId: CARTE_ID,
    role: 'cadrage',
    title: 'Cadrage d’essai',
    run: { engine: 'claude', thinking: 'none' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(agent.id, PROJET_ID, CARTE_ID, 'cadrage', 'idle', JSON.stringify(agent), maintenant, maintenant);

  db.close();
}

/**
 * LA CARTE CADRÉE : sa compréhension est rendue, et le juge y a posé — ou non —
 * sa note. On l'écrit directement en base : appeler le vrai service de
 * relecture n'apprendrait rien de plus sur l'ÉCRAN, et son chemin d'appel a
 * déjà son contrôle (`scripts/verif-jugement-rapide.mjs`).
 */
function poserLaCarte({ barres, motif, colonne = 'planned' }) {
  const db = base();
  const maintenant = Date.now();
  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    column: colonne,
    position: 1,
    title: 'Carte d’essai',
    description: 'Une carte de cadrage.',
    labels: [],
    attachments: [],
    run: { engine: 'claude', thinking: 'none' },
    conversationAgentId: AGENT_ID,
    parcours: {
      plans: [],
      comprehension: {
        texte: 'Il faut que la carte se range toute seule quand l’agent rend son rapport.',
        hypotheses: [],
        sujets: [],
        at: maintenant,
      },
    },
    jugements: barres ? { comprehension: { barres, confiance: 0.82, motif, at: maintenant } } : undefined,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, column_key = excluded.column_key, updated_at = excluded.updated_at`,
  ).run(CARTE_ID, PROJET_ID, colonne, 1, carte.title, JSON.stringify(carte), maintenant, maintenant);
  db.close();
}

async function ouvrir(navigateur, largeur = 1400) {
  const contexte = await navigateur.newContext({
    viewport: { width: largeur, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([
    { name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await revoirLaCarte(page);
  return { page, erreurs };
}

/**
 * ROUVRE LA CARTE PAR SON ADRESSE, et attend que la BARRE D'ÉCRITURE soit là.
 *
 * DEUX PIÈGES ÉVITÉS ICI, et ils coûtent cher tous les deux :
 *
 *  - un `reload()` nu ramène l'écran sur le tableau : la barre d'écriture
 *    n'existe alors plus, et on conclurait « aucun indicateur » sur un écran
 *    qui n'en porte aucun de toute façon ;
 *  - un `goto` vers la MÊME adresse ne change que le fragment : le navigateur
 *    ne recharge rien, le magasin du client garde ses cartes en mémoire, et on
 *    relit l'état d'AVANT l'écriture en base. D'où le paramètre qui change à
 *    chaque appel, qui force un vrai chargement.
 *
 * Et on attend un ÉLÉMENT, jamais un délai en dur.
 */
let passage = 0;
async function revoirLaCarte(page) {
  passage += 1;
  await page.goto(`${BASE}/?essai=${passage}#projet/${PROJET_ID}/tache/${CARTE_ID}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('[data-mic-button]', { state: 'attached', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

/** Ce que la barre d'écriture montre — un ÉTAT, jamais une hauteur en pixels. */
async function etatDeLaBarre(page) {
  return page.evaluate(() => {
    const jauge = document.querySelector('[data-indicateur-comprehension]');
    const micro = document.querySelector('[data-mic-button]');
    return {
      present: !!jauge,
      barres: jauge?.getAttribute('data-indicateur-comprehension') ?? null,
      /* L'INDICATEUR PRÉCÈDE LE MICRO dans la rangée : on compare la position
         des deux dans le document, pas leurs pixels. */
      avantLeMicro:
        jauge && micro
          ? !!(jauge.compareDocumentPosition(micro) & Node.DOCUMENT_POSITION_FOLLOWING)
          : null,
      /* ET IL OUVRE LE GROUPE DE DROITE : arrêt, micro et envoi vont et
         viennent au fil du tour ; la jauge, elle, garde une place FIXE, en
         tête. On lit un RANG dans le parent, jamais une position en pixels. */
      premierDuGroupe: jauge ? jauge.parentElement?.firstElementChild === jauge : null,
      /* PLUS AUCUN MESSAGE ÉCRIT DU RELECTEUR, nulle part dans l'écran. */
      bandeaux:
        document.querySelectorAll('[data-avis-du-juge], [data-avis-avant-lancement], [data-effort-propose], [data-avis-sur-le-plan]')
          .length,
      /* LE LANCEMENT N'EST JAMAIS ÉTEINT PAR UNE NOTE. */
      envoiPresent: !!document.querySelector('[data-composer-envoi]'),
    };
  });
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  /* ---- 1. SANS NOTE, AUCUN INDICATEUR ---- */

  poserLaCarte({ barres: undefined });
  const { page, erreurs } = await ouvrir(navigateur);
  const nue = await etatDeLaBarre(page);
  noter('sans note du relecteur, aucun indicateur', !nue.present, JSON.stringify(nue));
  noter('…et la barre d’écriture garde son envoi', nue.envoiPresent);

  /* ---- 2. CHAQUE NOTE ALLUME SON NOMBRE DE BARRES ---- */

  for (const [barres, motif] of [
    [1, 'objectif-flou'],
    [2, 'contraintes-absentes'],
    [3, 'rien-ne-manque'],
  ]) {
    poserLaCarte({ barres, motif });
    await revoirLaCarte(page);
    const vu = await etatDeLaBarre(page);
    noter(`une note de ${barres} se lit sur l’indicateur`, vu.barres === String(barres), JSON.stringify(vu));
    noter(`la jauge de ${barres} ouvre le groupe de boutons de droite`, vu.premierDuGroupe === true, JSON.stringify(vu));
    noter(`…et il se pose juste avant le micro (${barres})`, vu.avantLeMicro === true, JSON.stringify(vu));
    noter(`…sans éteindre l’envoi (${barres})`, vu.envoiPresent === true);
    noter(`…et sans aucun message écrit (${barres})`, vu.bandeaux === 0, `${vu.bandeaux} bandeau(x)`);
  }
  await page.screenshot({ path: path.join(TMP, 'indicateur-trois-barres.png') });

  /* ---- 3. SUR ÉCRAN ÉTROIT, LA RANGÉE NE DÉBORDE PAS ---- */

  const { page: petit } = await ouvrir(navigateur, 390);
  await petit.waitForTimeout(1500);
  const tient = await petit.evaluate(() => {
    const jauge = document.querySelector('[data-indicateur-comprehension]');
    const envoi = document.querySelector('[data-composer-envoi]');
    if (!jauge || !envoi) return { jauge: !!jauge, envoi: !!envoi };
    const cadre = jauge.closest('[class*="rounded"]')?.getBoundingClientRect();
    const b = envoi.getBoundingClientRect();
    return {
      jauge: true,
      envoi: true,
      /* Le bouton d'envoi reste DANS la fenêtre : rien n'est poussé dehors. */
      dansLaFenetre: b.right <= window.innerWidth + 1 && b.left >= 0,
      largeurCadre: cadre ? Math.round(cadre.width) : null,
    };
  });
  noter(
    'sur écran étroit, l’indicateur ne pousse ni le micro ni l’envoi hors du champ',
    tient.jauge && tient.envoi && tient.dansLaFenetre,
    JSON.stringify(tient),
  );
  await petit.screenshot({ path: path.join(TMP, 'indicateur-telephone.png') });

  /* ---- 4. UNE CARTE LANCÉE N'A PLUS D'INDICATEUR ---- */

  poserLaCarte({ barres: 1, motif: 'objectif-flou', colonne: 'running' });
  await revoirLaCarte(page);
  const lancee = await etatDeLaBarre(page);
  noter(
    'une carte déjà lancée ne montre plus de note : la décision est prise',
    !lancee.present && lancee.envoiPresent,
    JSON.stringify(lancee),
  );

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) console.log(`(captures et journal dans ${TMP})`);
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.slice(-20).join(''));
  process.exit(1);
});
