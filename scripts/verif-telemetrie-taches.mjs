#!/usr/bin/env node
/*
 * LA TÉLÉMÉTRIE DES TÂCHES EST COMPLÈTE, EXACTE, ET NE DIVULGUE RIEN.
 *
 * Quatre volets, sur une base NEUVE fabriquée puis retirée — jamais la base du
 * démon, qui tourne pendant ce contrôle :
 *
 *  1. LA MÉMOIRE EST INSTRUMENTÉE SANS ÊTRE MODIFIÉE : `detailProjet` rend
 *     maintenant son COMPTE de blocs, et le texte servi est exactement le même
 *     qu'avant l'ajout du compteur.
 *  2. LA CHAÎNE ÉCRIT ET RELIT : une ouverture de mémoire, deux tours de tâche,
 *     et la lecture rend bien une ligne par CARTE, tours additionnés.
 *  3. AUCUNE FUITE : ce qui entre dans les deux tables de mesure n'est que du
 *     chiffre, un identifiant et un NOM de sujet ramené à un mot. Une demande
 *     entière, un mot de passe collé dans une requête de mémoire, une réponse
 *     d'agent ne peuvent pas s'y trouver.
 *  4. L'ÉCRAN PORTE SES REPÈRES : le tableau de bord affiche la section, la
 *     courbe jetons/durée et le détail par tâche.
 *
 *   node scripts/verif-telemetrie-taches.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* UNE BASE À SOI, dans un dossier temporaire : le démon garde la sienne. */
const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-telemetrie-'));
process.env.HAIKODEV_DATA = BAC;

const partage = await import(path.join(RACINE, 'shared/dist/index.js'));
const memory = await import(path.join(RACINE, 'server/dist/memory.js'));
const store = await import(path.join(RACINE, 'server/dist/store.js'));

const echecs = [];
function verifier(condition, message) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.error(`  ✗ ${message}`);
    echecs.push(message);
  }
}

function ranger() {
  try {
    fs.rmSync(BAC, { recursive: true, force: true });
  } catch {
    /* un bac d'essai qui résiste n'est pas un échec de contrôle */
  }
}

/* ------------------------------------------------------------------ */
/* 1. LA MÉMOIRE EST INSTRUMENTÉE, PAS MODIFIÉE                        */
/* ------------------------------------------------------------------ */

console.log('\n1. La mémoire est instrumentée sans être modifiée\n');

const CARTE_ETROITE =
  'Le bouton « Publier maintenant » reste allumé pendant la mise en ligne\n' +
  'Constat : le bouton de publication ne s’éteint pas au clic.';

const servi = memory.detailProjet(RACINE, 'cartes', [], undefined, CARTE_ETROITE);
verifier(typeof servi.compte === 'object' && servi.compte !== null, 'une ouverture de mémoire rend son COMPTE de blocs');
verifier(
  Number.isInteger(servi.compte.demandes) &&
    Number.isInteger(servi.compte.rendus) &&
    Number.isInteger(servi.compte.rappels),
  'les trois compteurs sont des entiers',
);
verifier(
  servi.compte.rendus + servi.compte.rappels <= servi.compte.demandes,
  'ce qui est rendu plus ce qui est rappelé ne dépasse jamais ce qui a été trouvé',
);
verifier(
  servi.compte.rendus > 0 && servi.texte.length > 0,
  'un sujet réel rend au moins un bloc, et du texte avec',
);

/* Le compteur n'a rien changé à ce qui part : deux appels identiques, même texte. */
const encore = memory.detailProjet(RACINE, 'cartes', [], undefined, CARTE_ETROITE);
verifier(encore.texte === servi.texte, 'le texte servi ne dépend pas du compteur : deux appels identiques rendent le même texte');

/* Un sujet DÉJÀ servi devient un rappel, et le compte le dit. */
const rappel = memory.detailProjet(RACINE, 'cartes', servi.servis, undefined, CARTE_ETROITE);
verifier(
  rappel.compte.rappels > 0,
  'un sujet déjà lu compte comme RAPPEL, jamais comme un bloc perdu',
);

/* ------------------------------------------------------------------ */
/* 2. LA CHAÎNE ÉCRIT ET RELIT                                          */
/* ------------------------------------------------------------------ */

console.log('\n2. La chaîne écrit la mesure et la relit\n');

store.recordMemoryConsultation({
  projectId: 'projet-essai',
  cardId: 'carte-essai',
  agentId: 'agent-essai',
  sujet: partage.nomDeSujetMesure('cartes entier, pour le bouton Publier'),
  dureeMs: 12,
  blocsDemandes: servi.compte.demandes,
  blocsRendus: servi.compte.rendus,
  signesEntiers: servi.economie.entiers,
  signesServis: servi.economie.servis,
});
store.recordMemoryConsultation({
  projectId: 'projet-essai',
  cardId: 'carte-essai',
  agentId: 'agent-essai',
  sujet: partage.nomDeSujetMesure('publication'),
  dureeMs: 8,
  blocsDemandes: 3,
  blocsRendus: 2,
  signesEntiers: 4000,
  signesServis: 1000,
});

const vues = store.consultationsDeLAgent('agent-essai');
verifier(vues.ouvertures === 2, 'les deux ouvertures de l’agent sont comptées');
verifier(vues.millisecondes === 20, 'leur temps se cumule (12 + 8 = 20 ms)');
verifier(
  vues.sujets.length === 2 && vues.sujets[0] === 'cartes' && vues.sujets[1] === 'publication',
  'les sujets sont rendus dans l’ordre où ils ont été ouverts, sans doublon',
);

/* Deux tours sur la même carte : le premier échoue, le second va au bout. */
const commun = {
  cardId: 'carte-essai',
  projectId: 'projet-essai',
  agentId: 'agent-essai',
  memoire: vues,
};
store.recordTelemetrieTache({
  ...commun,
  issue: 'echec',
  tours: 2,
  tokensEntree: 30_000,
  tokensCache: 4_000_000,
  tokensSortie: 10_000,
  secondes: 300,
  note: 40,
});
store.recordTelemetrieTache({
  ...commun,
  issue: 'terminee',
  tours: 3,
  tokensEntree: 50_000,
  tokensCache: 6_000_000,
  tokensSortie: 20_000,
  secondes: 600,
  note: 80,
});

const taches = store.telemetrieDesTaches(7);
verifier(taches.length === 1, 'deux tours de la MÊME carte ne font qu’une ligne');
const tache = taches[0];
verifier(tache.tours === 5 && tache.secondes === 900, 'les tours et les secondes s’additionnent (2+3 tours, 300+600 s)');
verifier(
  tache.tokensEntree === 80_000 && tache.tokensSortie === 30_000 && tache.tokensCache === 10_000_000,
  'les trois familles de jetons s’additionnent chacune de son côté',
);
verifier(partage.jetonsFacturables(tache) === 110_000, 'les jetons facturables écartent la relecture au cache');
verifier(tache.issue === 'echec', 'l’issue retenue est la PIRE des tours : une reprise n’efface pas l’échec');
verifier(
  tache.memoire.sujets.join(',') === 'cartes,publication',
  'les sujets de mémoire des deux tours sont réunis, sans doublon',
);

const tendances = partage.tendancesParJour(taches, Date.now(), 7);
verifier(tendances.length === 7, 'la courbe porte sept jours, creux compris');
verifier(
  tendances[6].taches === 1 && tendances[6].jetons === 110_000,
  'la tâche du jour se pose sur le dernier point de la courbe',
);
const resume = partage.resumeDeTendance(taches);
verifier(resume.minutesParTache === 15, 'la durée moyenne d’une tâche est bien 900 s / 60');
verifier(resume.memoireMs === 10, 'le temps moyen d’une ouverture de mémoire est 20 ms / 2 ouvertures');

/* Une fenêtre plus étroite que l'écriture ne rend rien, elle n'invente pas. */
verifier(store.telemetrieDesTaches(1).length === 1, 'une fenêtre d’un jour retient bien une mesure d’aujourd’hui');

/* ------------------------------------------------------------------ */
/* 3. AUCUNE FUITE DE DONNÉES SENSIBLES                                 */
/* ------------------------------------------------------------------ */

console.log('\n3. Rien de sensible n’entre dans les tables de mesure\n');

const SECRET = 'mot-de-passe-ultra-secret-42';
store.recordMemoryConsultation({
  projectId: 'projet-essai',
  cardId: 'carte-secrete',
  agentId: 'agent-secret',
  /* On passe volontairement une demande ENTIÈRE, secret compris. */
  sujet: partage.nomDeSujetMesure(`cartes ${SECRET} et la réponse de l’agent`),
  dureeMs: 1,
  blocsDemandes: 1,
  blocsRendus: 1,
  signesEntiers: 10,
  signesServis: 10,
});

const db = store.getDb ? store.getDb() : (await import(path.join(RACINE, 'server/dist/db.js'))).getDb();
const lignesMemoire = db.prepare('SELECT * FROM memoire_consultation').all();
const lignesTaches = db.prepare('SELECT * FROM telemetrie_tache').all();
const toutLeTexte = JSON.stringify([...lignesMemoire, ...lignesTaches]);

verifier(!toutLeTexte.includes(SECRET), 'un secret collé dans une demande de mémoire n’atteint jamais la table');
verifier(!toutLeTexte.includes('réponse de l’agent'), 'la demande entière n’est pas recopiée : seul le premier mot reste');
verifier(
  lignesMemoire.every((ligne) => ligne.sujet.length <= partage.LONGUEUR_MAX_SUJET),
  `aucun sujet mesuré ne dépasse ${partage.LONGUEUR_MAX_SUJET} signes`,
);
verifier(
  lignesTaches.every((ligne) => {
    const sujets = JSON.parse(ligne.memoire_sujets ?? '[]');
    return Array.isArray(sujets) && sujets.every((s) => typeof s === 'string' && s.length <= partage.LONGUEUR_MAX_SUJET);
  }),
  'les sujets rangés sur une tâche sont des NOMS courts, jamais du texte',
);

/* Les colonnes de ces deux tables : rien qui puisse porter du contenu libre. */
const colonnesLibres = db
  .prepare("SELECT name FROM pragma_table_info('telemetrie_tache')")
  .all()
  .map((c) => c.name)
  .filter((nom) => !/^(id|card_id|project_id|agent_id|issue|note|created_at|memoire_sujets)$/.test(nom) && !/^(tours|secondes)$/.test(nom) && !/^(tokens|memoire)_/.test(nom));
verifier(colonnesLibres.length === 0, `aucune colonne inattendue dans la table des tâches${colonnesLibres.length ? ` (${colonnesLibres.join(', ')})` : ''}`);

/* ------------------------------------------------------------------ */
/* 4. L'ÉCRAN PORTE SES REPÈRES                                         */
/* ------------------------------------------------------------------ */

console.log('\n4. Le tableau de bord porte la section et ses repères\n');

const ecran = fs.readFileSync(path.join(RACINE, 'web/src/components/dashboard.tsx'), 'utf8');
for (const repere of [
  'data-telemetrie-taches',
  'data-courbe-jetons-duree',
  'data-barre-jetons',
  'data-tache-mesuree',
  'data-detail-tache-mesuree',
  'data-sujets-memoire',
  'data-note-tache',
]) {
  verifier(ecran.includes(repere), `l’écran porte le repère « ${repere} »`);
}
verifier(ecran.includes("type: 'stats.telemetrie'"), 'l’écran demande bien la télémétrie au serveur');
verifier(
  !/console\.log\(/.test(ecran.slice(ecran.indexOf('data-telemetrie-taches'))),
  'la section de télémétrie n’écrit rien dans le journal du navigateur',
);

/* ------------------------------------------------------------------ */
/* 5. DANS UN VRAI NAVIGATEUR                                           */
/* ------------------------------------------------------------------ */

console.log('\n5. Dans un vrai navigateur\n');

/*
 * L'écran est jugé SUR L'ÉTAT, jamais sur une hauteur : la section existe-t-elle,
 * dit-elle quelque chose quand rien n'est mesuré ? Sans serveur de développement
 * joignable, le volet le DIT et se saute — il ne se fabrique pas un décor.
 *
 * On vise le serveur de DÉVELOPPEMENT, jamais `HAIKODEV_URL` : cette variable
 * désigne l'application déjà publiée, qui ne porte pas ce travail.
 */
const ADRESSE = process.env.HAIKO_TELEMETRIE_URL || 'http://localhost:7099';
/* La base et ses dépendances natives vivent dans le dépôt PRINCIPAL, même quand
   ce script est lancé d'une copie de travail. */
const DONNEES = process.env.HAIKODEV_DATA_REEL || '/root/haikodev/data';

/**
 * Une session d'UNE HEURE, fabriquée puis retirée : la colonne `token` garde le
 * SHA-256 du cookie, jamais le cookie.
 */
async function avecSession(travail) {
  const { default: crypto } = await import('node:crypto');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const ouvrir = () =>
    require(path.join(DONNEES, '../node_modules/better-sqlite3'))(path.join(DONNEES, 'haikodev.db'));

  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const base = ouvrir();
  const maintenant = Date.now();
  base
    .prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)')
    .run(empreinte, maintenant, maintenant + 3_600_000, 'vérification de la télémétrie');
  base.close();
  try {
    return await travail(cookie);
  } finally {
    const fin = ouvrir();
    fin.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    fin.close();
  }
}

/* Deux tâches d'essai, écrites ici et nulle part ailleurs : elles ne touchent
   aucune base et ne servent qu'à faire dessiner l'écran. */
const TACHES_D_ESSAI = [
  {
    cardId: 'essai-1',
    titre: 'Une tâche sobre et rapide',
    projet: 'HaikoDev',
    issue: 'terminee',
    tours: 3,
    tokensEntree: 30_000,
    tokensCache: 4_000_000,
    tokensSortie: 15_000,
    secondes: 480,
    memoire: {
      ouvertures: 2,
      millisecondes: 24,
      sujets: ['cartes', 'publication'],
      demandes: 6,
      rendus: 4,
      signesEntiers: 120_000,
      signesServis: 9_000,
    },
    at: Date.now(),
  },
  {
    cardId: 'essai-2',
    titre: 'Une tâche longue, interrompue en route',
    projet: 'HaikoDev',
    issue: 'interrompue',
    tours: 9,
    tokensEntree: 260_000,
    tokensCache: 30_000_000,
    tokensSortie: 90_000,
    secondes: 3_000,
    memoire: {
      ouvertures: 1,
      millisecondes: 61,
      sujets: ['memoire'],
      demandes: 3,
      rendus: 3,
      signesEntiers: 40_000,
      signesServis: 38_000,
    },
    at: Date.now() - 2 * 24 * 3600 * 1000,
  },
];

let raison = null;
try {
  raison = await avecSession(async (session) => {
    const { chromium } = await import('playwright');
    const navigateur = await chromium.launch({ channel: 'chrome' });
    const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
    await contexte.addCookies([{ name: 'haikodev_session', value: session, domain: 'localhost', path: '/' }]);
    const page = await contexte.newPage();
    try {
      await page.goto(`${ADRESSE}/#tableau-de-bord`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForSelector('[data-telemetrie-taches]', { timeout: 20_000 });
      const section = page.locator('[data-telemetrie-taches]');
      verifier(await section.isVisible(), 'la section « Télémétrie des tâches » s’affiche dans le tableau de bord');
      const titre = await section.locator('h2').first().innerText();
      verifier(/[Tt]élémétrie/.test(titre), `son titre le dit : « ${titre.trim()} »`);
      /* Vide OU rempli, elle DIT toujours quelque chose : jamais un blanc. */
      const texte = (await section.innerText()).trim();
      verifier(texte.length > 40, 'elle ne laisse jamais un blanc : sans mesure, elle explique pourquoi');
      const courbe = await page.locator('[data-courbe-jetons-duree]').count();
      const vide = /Aucune tâche mesurée/.test(texte);
      verifier(
        vide ? courbe === 0 : courbe === 1,
        vide
          ? 'sans aucune mesure, aucune courbe n’est dessinée — un état vide, pas un graphique à zéro'
          : 'la courbe jetons contre durée est dessinée',
      );
      /*
       * ...ET LE MÊME ÉCRAN, REMPLI. Le démon qui répond au serveur de
       * développement tourne sur la construction PRÉCÉDENTE : il ignore encore
       * la commande, d'où l'état vide ci-dessus. Pour juger la courbe et les
       * lignes, on répond nous-mêmes à cette seule commande, dans la page —
       * aucune ligne d'essai n'est ajoutée au code de l'application pour cela.
       * Les données injectées sortent des VRAIES règles partagées, pas d'un
       * dessin à la main.
       */
      const reponse = {
        jours: 7,
        taches: TACHES_D_ESSAI.map((t) => ({ ...t, qualite: partage.noteDeQualite(t) })),
        tendances: partage.tendancesParJour(TACHES_D_ESSAI, Date.now(), 7),
        resume: partage.resumeDeTendance(TACHES_D_ESSAI),
        references: { jetons: partage.JETONS_DE_REFERENCE, secondes: partage.SECONDES_DE_REFERENCE },
      };
      await page.addInitScript((donnees) => {
        const Vrai = window.WebSocket;
        window.WebSocket = new Proxy(Vrai, {
          construct(cible, args) {
            const socket = new cible(...args);
            const envoyer = socket.send.bind(socket);
            socket.send = (trameBrute) => {
              try {
                const trame = JSON.parse(trameBrute);
                if (trame?.cmd?.type === 'stats.telemetrie') {
                  setTimeout(
                    () =>
                      socket.dispatchEvent(
                        new MessageEvent('message', {
                          data: JSON.stringify({ type: 'ack', id: trame.id, ok: true, data: donnees }),
                        }),
                      ),
                    0,
                  );
                  return;
                }
              } catch {
                /* une trame illisible suit son chemin normal */
              }
              envoyer(trameBrute);
            };
            return socket;
          },
        });
      }, reponse);
      /* RECHARGER, pas re-viser la même adresse : un simple changement d'ancre
         ne relance pas la page, et le script d'amorce ne serait jamais posé. */
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForSelector('[data-courbe-jetons-duree]', { timeout: 20_000 });

      const barres = await page.locator('[data-barre-jetons]').count();
      verifier(barres === 7, `la courbe pose une barre par jour de la fenêtre (${barres} sur 7)`);
      const trait = page.locator('[data-courbe-jetons-duree] svg path');
      verifier((await trait.count()) === 1, 'et la ligne de la durée moyenne est tracée par-dessus');
      /*
       * UN TRAIT QUI EXISTE N'EST PAS UN TRAIT QUI SE VOIT. `--accent` ne porte
       * que les composantes d'une couleur : écrit sans `hsl(…)`, l'attribut est
       * invalide et le navigateur ne dessine RIEN, sans le dire. On juge donc la
       * couleur CALCULÉE, pas l'attribut écrit.
       */
      verifier(
        (await trait.evaluate((noeud) => getComputedStyle(noeud).stroke)) !== 'none',
        'et elle est réellement peinte : sa couleur calculée n’est pas « none »',
      );
      /* Une ligne plate serait un calcul raté : les hauteurs doivent varier. */
      const hauteurs = [...((await trait.getAttribute('d')) ?? '').matchAll(/[\d.]+ ([\d.]+)/g)].map((m) => m[1]);
      verifier(new Set(hauteurs).size > 1, 'et elle monte et descend avec la durée, au lieu de rester plate');
      const lignes = await page.locator('[data-tache-mesuree]').count();
      verifier(lignes === TACHES_D_ESSAI.length, `chaque tâche mesurée a sa ligne (${lignes} sur ${TACHES_D_ESSAI.length})`);

      /* Une ligne repliée ne montre pas son détail ; un clic l'ouvre. */
      verifier(
        (await page.locator('[data-detail-tache-mesuree]').count()) === 0,
        'le détail d’une tâche reste replié tant qu’on ne l’ouvre pas',
      );
      await page.locator('[data-tache-mesuree] button').first().click();
      await page.waitForSelector('[data-detail-tache-mesuree]', { timeout: 5_000 });
      const detail = await page.locator('[data-detail-tache-mesuree]').first().innerText();
      verifier(/\/25/.test(detail), 'ouverte, elle montre les quatre critères de sa note');
      verifier(
        (await page.locator('[data-sujets-memoire]').first().isVisible()) &&
          /cartes/.test(await page.locator('[data-sujets-memoire]').first().innerText()),
        'et les SUJETS de mémoire qu’elle a ouverts, nommés',
      );
      const jour = await page.locator('[data-detail-jour-telemetrie]').innerText();
      verifier(jour.trim().length > 10, 'la courbe porte sa ligne de détail, lisible sans survol');

      await navigateur.close();
      return null;
    } catch (err) {
      await navigateur.close();
      return `serveur de développement injoignable sur ${ADRESSE} — ${err.message.split('\n')[0]}`;
    }
  });
} catch (err) {
  raison = `session d’essai impossible — ${err.message.split('\n')[0]}`;
}
if (raison) console.log(`  (volet sauté : ${raison})`);

/* ------------------------------------------------------------------ */

ranger();
console.log('');
if (echecs.length) {
  console.error(`${echecs.length} contrôle(s) en échec.`);
  process.exit(1);
}
console.log('Tous les contrôles sont au vert.');
