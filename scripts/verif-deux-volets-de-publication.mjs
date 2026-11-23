#!/usr/bin/env node
/**
 * LES DEUX VOLETS DE MISE EN LIGNE : LA MÊME PRÉSENTATION, DES ÉTAPES PROPRES.
 *
 * Il y avait deux écrans de suivi qui ne se ressemblaient pas, et la mise en
 * production traînait des morceaux du déploiement — un lot de cartes qu'elle
 * n'embarque pas, des compteurs qui comptaient zéro. Ce contrôle verrouille
 * les deux moitiés de la promesse, et elles sont indissociables :
 *
 *  1. LA PRÉSENTATION EST LA MÊME. Les deux volets rendent la MÊME structure à
 *     deux colonnes — le parcours à gauche, le détail de l'étape choisie à
 *     droite —, parce qu'ils sont le MÊME composant monté deux fois.
 *  2. LES ÉTAPES SONT PROPRES À CHACUN. Les phrases du déploiement parlent des
 *     branches des cartes et de l'instance de dev ; celles de la mise en
 *     production parlent de la branche de production, du transfert chez le
 *     client et de la relance de son service. Aucune phrase n'est partagée là
 *     où les deux étapes ne font pas la même chose.
 *  3. LES ÉTAPES PRÉPARÉES D'AVANCE RESTENT VISIBLES. Depuis que le clic
 *     DÉSIGNE une version construite à l'écart, « Construction » est sautée :
 *     elle garde sa ligne, marquée « déjà faite en coulisses », avec son motif
 *     lisible dans le détail. Une étape sautée pour une AUTRE raison ne porte
 *     pas cette marque. « Vérification » n'est plus au parcours (23/09/2026) :
 *     la publication posée ici la porte encore, comme une ANCIENNE en base, et
 *     le volet doit s'ouvrir sans elle.
 *
 * DEUX VOLETS, comme les autres contrôles de ce dossier : la lecture des règles
 * pures et du composant, puis un VRAI navigateur devant un démon d'essai à soi
 * — base neuve, dossier de projets vide, port libre. Le démon de production
 * n'est pas touché et aucun quota n'est dépensé : les deux publications posées
 * sont DÉJÀ terminées, rien n'est mis en ligne.
 *
 *   node scripts/verif-deux-volets-de-publication.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

/* Le script juge le dépôt d'où il PART, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_VOLETS_PORT || 7216);
const BASE = `http://127.0.0.1:${PORT}`;
const { DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-deux-volets-',
  port: PORT,
});

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${String(detail).slice(0, 180)}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* A. LES RÈGLES ET LE COMPOSANT                                       */
/* ------------------------------------------------------------------ */

function voletDesRegles() {
  const regle = fs.readFileSync(path.join(RACINE, 'shared', 'src', 'parcours-de-publication.ts'), 'utf8');
  noter(
    'les étapes sont des DONNÉES, une table par étape de mise en ligne',
    /const PARCOURS_DEV: readonly DescriptionDEtape\[\]/.test(regle) &&
      /const PARCOURS_PRODUCTION: readonly DescriptionDEtape\[\]/.test(regle),
  );
  noter(
    'la règle est PURE : ni base, ni disque, ni horloge',
    !/from '\.\/(store|db)/.test(regle) && !/require\(|node:fs|better-sqlite3/.test(regle),
  );

  /* LES SEPT ÉTAPES SONT TOUJOURS RENDUES, sautées comprises : c'est la règle
     qui le garantit, pas le composant. */
  noter(
    'le parcours rend TOUTES les étapes, l’état venant de la publication réelle',
    /export function parcoursDesEtapes\(/.test(regle) &&
      /return etapesDuParcours\(cible\)\.map\(/.test(regle),
  );

  const volet = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'volet-publication.tsx'), 'utf8');
  noter(
    'UN SEUL composant sert les deux étapes : il reçoit sa cible, il ne la devine pas',
    /export function CorpsDuVolet\(/.test(volet) &&
      /cible: CiblePublication;/.test(volet) &&
      /parcoursDesEtapes\(cible, run\)/.test(volet),
  );
  noter(
    'le parcours est UNE SEULE LISTE : le détail est rendu par la ligne de son étape',
    !/data-deux-colonnes/.test(volet) &&
      /data-parcours-etapes=\{etape\.cible\}/.test(volet) &&
      /data-detail-etape=\{etape\.cle\}/.test(volet) &&
      /<DetailDeLEtape etape=\{etape\} run=\{run\} onOuvrirAgent=\{onOuvrirAgent\} \/>/.test(volet),
  );
  noter(
    'une seule étape est dépliée à la fois, et la rouvrir la referme',
    /ouverte=\{retenu\.sorte === 'etape' && retenu\.cle === e\.cle\}/.test(volet) &&
      /\{ sorte: 'aucune' \}/.test(volet),
  );
  noter(
    'une question de l’agent se pose DANS le volet, sur place au pied, sans conversation complète (08/11/2026)',
    !/LigneDeConversation/.test(volet) &&
      /questionsOuvertesDuFil\(/.test(volet) &&
      /data-fenetre-pied[\s\S]{0,2500}?data-point-conversation/.test(volet) &&
      /<AgentEnLigne/.test(volet) &&
      !/<Chat\b/.test(volet),
  );

  const panneau = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'deploy-panel.tsx'), 'utf8');
  noter(
    'le bouton de déploiement ouvre SON volet, celui de production le SIEN',
    /<VoletDePublication[\s\S]{0,300}?cible=\{etape\.cible\}/.test(panneau) &&
      /<CorpsDuVolet[\s\S]{0,200}?cible="production"/.test(panneau),
  );
}

/* ------------------------------------------------------------------ */
/* B. L'ÉCRAN                                                          */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-volets';
const CONDUCTEUR = 'a-conducteur-volets';
const RUN_DEV = 'r-volet-dev';
const RUN_PROD = 'r-volet-prod';

/* Le motif EXACT qu'écrit le serveur quand l'étape a déjà eu lieu à l'écart —
   c'est à ces mots que l'écran reconnaît une étape PRÉPARÉE. */
const RECIT_CONTROLES_A_LECART =
  'Contrôles déjà passés à l’écart, sur la version préparée d’avance : les rejouer donnerait le même résultat sur le même code.';
const RECIT_CONSTRUIT_A_LECART =
  'Construction déjà faite à l’écart : c’est le paquet construit qui a été remis en place, sans recompilation.';

function etapesDUnePublication(t0) {
  return [
    { key: 'merge', state: 'done', log: '', startedAt: t0, endedAt: t0 + 1000 },
    { key: 'commit', state: 'done', log: '', startedAt: t0 + 1000, endedAt: t0 + 1500 },
    { key: 'push', state: 'done', log: '', startedAt: t0 + 1500, endedAt: t0 + 2000 },
    /* ÉTAPE RETIRÉE, portée par une ancienne publication : jamais affichée. */
    { key: 'verify', state: 'skipped', log: RECIT_CONTROLES_A_LECART, startedAt: t0 + 2000, endedAt: t0 + 2001 },
    /* PRÉPARÉE D'AVANCE : elle reste dans le parcours, marquée. */
    { key: 'build', state: 'skipped', log: RECIT_CONSTRUIT_A_LECART, startedAt: t0 + 2001, endedAt: t0 + 2002 },
    { key: 'publish', state: 'done', log: '', startedAt: t0 + 2002, endedAt: t0 + 4000 },
    /* SAUTÉE POUR UNE AUTRE RAISON : pas de marque « en coulisses ». */
    { key: 'restart', state: 'skipped', log: 'Ce projet n’a rien à redémarrer.', startedAt: t0 + 4000, endedAt: t0 + 4001 },
  ];
}

/** La mise en production posée en base : rejouée EN COURS dans le canal, pour ouvrir son volet. */
let runProd = null;

function poserDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3_600_000,
    'vérification des deux volets de publication',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai des deux volets',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    /* Un processus de production EN PLACE, qui ne fait rien : le tiroir
       s'ouvre sur « Configuration », rien ne part. */
    miseEnProduction: { processus: { etapes: [{ libelle: 'Contrôle', commande: 'true', delaiS: 5 }] } },
    /* Un déploiement en place (déroulé commun hérité) : sans lui, « À déployer » n'a que le bouton qui mène à l'agent, sans chevron. */
    deploiement: { commande: 'true', herite: true },
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), t, t);

  db.prepare('DELETE FROM deploys').run();
  const poser = (run) =>
    db
      .prepare('INSERT INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(run.id, PROJET_ID, run.state, JSON.stringify(run), run.startedAt, run.endedAt);

  const debutDev = t - 40 * 60_000;
  poser({
    id: RUN_DEV,
    projectId: PROJET_ID,
    state: 'success',
    cible: 'dev',
    steps: etapesDUnePublication(debutDev),
    cardIds: ['c-1', 'c-2'],
    taches: [
      { cardId: 'c-1', titre: 'Première carte', etat: 'en-ligne' },
      { cardId: 'c-2', titre: 'Seconde carte', etat: 'en-ligne' },
    ],
    reprises: 0,
    repriseApresCoupure: false,
    queued: false,
    startedAt: debutDev,
    endedAt: debutDev + 5000,
  });

  const debutProd = t - 20 * 60_000;
  runProd = {
    id: RUN_PROD,
    projectId: PROJET_ID,
    state: 'success',
    cible: 'production',
    steps: etapesDUnePublication(debutProd),
    cardIds: [],
    reprises: 0,
    repriseApresCoupure: false,
    queued: false,
    startedAt: debutProd,
    endedAt: debutProd + 5000,
    targetCommit: 'abcdef1234567890abcdef1234567890abcdef12',
    agentId: CONDUCTEUR,
  };
  poser(runProd);

  /* LE CONDUCTEUR de la mise en production : c'est SA conversation que le pied
     du volet rouvre. Il n'a jamais reçu de tour — aucun quota dépensé. */
  const agent = {
    id: CONDUCTEUR,
    projectId: PROJET_ID,
    role: 'deploy',
    title: 'Mise en production',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'done',
    createdAt: debutProd,
    updatedAt: debutProd + 5000,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(CONDUCTEUR, PROJET_ID, 'deploy', 'done', JSON.stringify(agent), debutProd, debutProd + 5000);
  const bulle = {
    id: `fil-${RUN_PROD}-rapport`,
    agentId: CONDUCTEUR,
    role: 'assistant',
    content: '✅ **Mise en production terminée.** La version est en ligne.',
    createdAt: debutProd + 5000,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    bulle.id,
    CONDUCTEUR,
    'assistant',
    JSON.stringify(bulle),
    bulle.createdAt,
  );
  db.close();
}

/** Ce qu'un volet ouvert montre, mesuré dans la page. */
async function lireLeVolet(page, cible) {
  return page.evaluate((cible) => {
    const volet = document.querySelector(`[data-volet-publication="${cible}"]`);
    if (!volet) return null;
    const lignes = [...volet.querySelectorAll('[data-etape-parcours]')];
    return {
      /* UNE SEULE LISTE : plus aucun conteneur à deux colonnes. */
      deuxColonnes: !!volet.querySelector('[data-deux-colonnes]'),
      detailsOuverts: volet.querySelectorAll('[data-detail-etape]').length,
      /* LE DÉTAIL EST SOUS SON ÉTAPE : il vit dans le <li> de la ligne dépliée. */
      detailSousSonEtape: (() => {
        const bloc = volet.querySelector('[data-detail-etape]');
        const ligne = bloc?.closest('li[data-ligne-parcours]');
        return !!ligne && ligne.getAttribute('data-ligne-parcours') === bloc.getAttribute('data-detail-etape');
      })(),
      depliees: [...volet.querySelectorAll('[data-etape-depliee="oui"]')].map((l) =>
        l.getAttribute('data-etape-parcours'),
      ),
      /* PARLER À CELUI QUI PUBLIE EST UN GESTE DU PIED, plus un point du parcours. */
      conversationDansLePied: !!volet.querySelector('[data-fenetre-pied] [data-point-conversation]'),
      conversationDansLeParcours: !!volet.querySelector('[data-parcours-etapes] [data-point-conversation]'),
      parcours: !!volet.querySelector(`[data-parcours-etapes="${cible}"]`),
      etapes: lignes.length,
      phrases: lignes.map((l) => l.querySelector('[data-etape-phrase]')?.textContent?.trim() ?? ''),
      preparees: lignes.filter((l) => l.getAttribute('data-etape-preparee') === 'oui').map((l) => l.getAttribute('data-etape-parcours')),
      sautees: lignes.filter((l) => l.getAttribute('data-etat-process') === 'skipped').map((l) => l.getAttribute('data-etape-parcours')),
      enCoulisses: volet.querySelectorAll('[data-etape-en-coulisses]').length,
      lot: volet.querySelectorAll('[data-taches-du-lot]').length,
      detail: volet.querySelector('[data-detail-etape]')?.getAttribute('data-detail-etape') ?? null,
    };
  }, cible);
}

async function voletDeLEcran() {
  if (!(await attendrePort())) {
    noter('le démon d’essai répond', false, journal.join('').slice(-400));
    return;
  }
  noter('le démon d’essai répond', true);
  poserDecor();

  const navigateur = await chromium.launch({ channel: 'chrome' });
  /* La session d'une heure voyage par le COOKIE du démon, comme dans
     l'application : le jeton est HACHÉ en base, jamais lisible. */
  const contexte = await navigateur.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e.message ?? e)));
  /* LE CANAL TEMPS RÉEL SE LAISSE SOUFFLER UN ÉVÉNEMENT, exactement comme le
     démon le diffuse (`verif-bandeau-production.mjs`) : au repos, le bandeau
     ne montre plus la dernière mise en production, seulement pendant l'une. */
  await page.addInitScript(() => {
    window.__ecouteurs = [];
    const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get() {
        return propriete.get.call(this);
      },
      set(ecouteur) {
        window.__ecouteurs.push(ecouteur);
        return propriete.set.call(this, ecouteur);
      },
    });
    window.__injecter = (evenement) => {
      const donnees = JSON.stringify(evenement);
      for (const ecouteur of window.__ecouteurs) ecouteur({ data: donnees });
    };
  });
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(4000);
    const onglet = page.getByRole('button', { name: /^Tableau$/ });
    if (await onglet.count()) {
      await onglet.first().click();
      await page.waitForTimeout(1500);
    }
    await page.waitForSelector('[data-bandeau-production]', { timeout: 30_000 });

    /* ---------------------------------------------------------------- */
    /* LE VOLET DU DÉPLOIEMENT — le chevron de « À déployer »            */
    /* ---------------------------------------------------------------- */
    const chevron = page.locator('[data-chevron-process]').first();
    noter('la colonne « À déployer » porte sa porte d’entrée', (await chevron.count()) === 1);
    let dev = null;
    if (await chevron.count()) {
      await chevron.click();
      await page.waitForTimeout(1500);
      dev = await lireLeVolet(page, 'dev');
    }
    noter('le clic ouvre le volet du DÉPLOIEMENT', !!dev);
    if (dev) {
      noter(
        'il s’ouvre en UNE liste, le détail déplié sous son étape',
        !dev.deuxColonnes && dev.parcours && !!dev.detail && dev.detailSousSonEtape,
        JSON.stringify({ detail: dev.detail, sousSonEtape: dev.detailSousSonEtape }),
      );
      noter(
        'une SEULE étape est dépliée : l’étape en cours, d’office',
        dev.detailsOuverts === 1 && dev.depliees.length === 1 && dev.depliees[0] === dev.detail,
        JSON.stringify({ ouverts: dev.detailsOuverts, depliees: dev.depliees }),
      );
      noter('les SIX étapes sont là, sautées comprises', dev.etapes === 6, `${dev.etapes} étape(s)`);
      noter(
        'l’étape « Vérification » d’une ANCIENNE publication ne s’affiche plus',
        (await page.locator('[data-volet-publication="dev"] [data-etape-parcours="verify"]').count()) === 0,
      );
      noter(
        'ses phrases sont celles du déploiement : les branches des cartes, l’instance de dev',
        /branches des cartes/.test(dev.phrases[0] ?? ''),
        dev.phrases[0],
      );
      noter(
        'l’étape préparée d’avance garde sa ligne, marquée « en coulisses »',
        dev.preparees.join(',') === 'build' && dev.enCoulisses === 1,
        JSON.stringify({ preparees: dev.preparees, mentions: dev.enCoulisses }),
      );
      noter(
        'une étape sautée pour une AUTRE raison n’est pas dite « en coulisses »',
        dev.sautees.includes('restart') && !dev.preparees.includes('restart'),
        JSON.stringify(dev.sautees),
      );
      noter('le lot des cartes embarquées se lit sous le parcours', dev.lot === 1);

      /* LE FLUX À POINTS, COMME LE FIL D'UN AGENT : un grand rond par étape,
         un trait vertical CENTRÉ sur les ronds, qui ne dépasse ni au-dessus
         du premier ni sous le dernier — même quand une étape est dépliée. */
      const flux = await page.evaluate(() => {
        const volet = document.querySelector('[data-volet-publication="dev"]');
        const lignes = [...(volet?.querySelectorAll('li[data-ligne-parcours]') ?? [])];
        const boite = (el) => el?.getBoundingClientRect();
        const ronds = lignes.map((l) => boite(l.querySelector('[data-rond-parcours]')));
        const traits = lignes.map((l) => boite(l.querySelector('[data-trait-parcours]')));
        const centres = lignes.map((_, i) =>
          ronds[i] && traits[i] ? Math.abs(ronds[i].left + ronds[i].width / 2 - (traits[i].left + traits[i].width / 2)) : 99,
        );
        const dernier = ronds.at(-1);
        const traitDernier = traits.at(-1);
        const premier = ronds[0];
        const traitPremier = traits[0];
        return {
          ronds: ronds.filter(Boolean).map((r) => Math.round(r.width)),
          ecartMax: Math.max(...centres),
          continu: traits.every((t, i) => !t || i === 0 || Math.abs(t.top - (traits[i - 1].bottom)) <= 1),
          depasseEnBas: dernier && traitDernier ? traitDernier.bottom - dernier.bottom : 99,
          depasseEnHaut: premier && traitPremier ? premier.top - traitPremier.top : 99,
          phraseSousTitre: lignes.every((l) => {
            const nom = l.querySelector('[data-etape-nom]')?.getBoundingClientRect();
            const phrase = l.querySelector('[data-etape-phrase]')?.getBoundingClientRect();
            return !!nom && !!phrase && phrase.top >= nom.bottom - 1;
          }),
          filets: lignes.some((l) => /border-b/.test(l.className)),
        };
      });
      noter(
        'un GRAND ROND par étape, comme le fil d’un agent',
        flux.ronds.length === 6 && flux.ronds.every((w) => w >= 30),
        JSON.stringify(flux.ronds),
      );
      noter(
        'un trait vertical CONTINU relie les ronds, centré sur eux',
        flux.continu && flux.ecartMax <= 1,
        JSON.stringify({ continu: flux.continu, ecart: flux.ecartMax }),
      );
      noter(
        'le trait ne déborde ni au-dessus du premier rond ni sous le dernier',
        flux.depasseEnBas <= 0 && flux.depasseEnHaut <= 0,
        JSON.stringify({ bas: flux.depasseEnBas, haut: flux.depasseEnHaut }),
      );
      noter('sous chaque titre, la phrase qui dit ce que l’étape fait', flux.phraseSousTitre);
      noter('plus aucun filet horizontal entre les étapes', !flux.filets);

      /* QUAND, ET COMBIEN DE TEMPS. La mention de temps quitte le voisinage du
         titre : elle se pose À DROITE de la ligne, aligne toutes les étapes sur
         la même colonne, et dit l'heure de DÉBUT avant la durée — sans les deux,
         on ne sait pas où le temps est parti. */
      const temps = await page.evaluate(() => {
        const volet = document.querySelector('[data-volet-publication="dev"]');
        const lignes = [...(volet?.querySelectorAll('li[data-ligne-parcours]') ?? [])];
        const lus = lignes.map((l) => {
          const mention = l.querySelector('[data-duree-etape]');
          const nom = l.querySelector('[data-etape-nom]');
          if (!mention || !nom) return null;
          return {
            texte: (mention.textContent ?? '').trim(),
            gauche: mention.getBoundingClientRect().left,
            droite: mention.getBoundingClientRect().right,
            droiteDuNom: nom.getBoundingClientRect().right,
            hautDuNom: nom.getBoundingClientRect().top,
            hautMention: mention.getBoundingClientRect().top,
          };
        });
        return {
          mentions: lus.filter(Boolean),
          manquantes: lus.filter((x) => !x).length,
          /* Les mentions sont posées en fin de ligne : ce sont leurs bords
             DROITS qui doivent tomber les uns sous les autres, pas leurs
             bords gauches — « < 1 s » et « 52 s » n'ont pas la même largeur. */
          colonnes: new Set(lus.filter(Boolean).map((x) => Math.round(x.droite))).size,
        };
      });
      noter(
        'chaque étape datée porte son heure de DÉBUT puis sa durée : « 17:41 (2 s) »',
        temps.manquantes === 0 &&
          temps.mentions.length === 6 &&
          temps.mentions.every((m) => /^\d{2}:\d{2} \(.+\)$/.test(m.texte)),
        JSON.stringify(temps.mentions.map((m) => m.texte)),
      );
      noter(
        'la mention est À DROITE du nom de l’étape, toutes alignées sur la même colonne',
        temps.mentions.every((m) => m.gauche > m.droiteDuNom) && temps.colonnes === 1,
        JSON.stringify({ colonnes: temps.colonnes }),
      );
      noter(
        'et elle reste sur la PREMIÈRE ligne du nom, pas décalée en dessous',
        temps.mentions.every((m) => Math.abs(m.hautMention - m.hautDuNom) <= 6),
        JSON.stringify(temps.mentions.map((m) => Math.round(m.hautMention - m.hautDuNom))),
      );
      if (process.env.VOLETS_CAPTURE) {
        await page.locator('[data-volet-publication="dev"]').screenshot({ path: process.env.VOLETS_CAPTURE });
      }

      /* LE DÉTAIL D'UNE ÉTAPE PRÉPARÉE porte son motif entier. */
      await page.locator('[data-etape-parcours="build"]').first().click();
      await page.waitForTimeout(500);
      const coulisses = page.locator('[data-detail-en-coulisses="build"]');
      const texteCoulisses = (await coulisses.count()) ? ((await coulisses.first().textContent()) ?? '') : '';
      noter(
        'et son détail donne le motif ENTIER, jamais un « ignoré » sec',
        /déjà faite à l’écart/i.test(texteCoulisses),
        texteCoulisses.replace(/\s+/g, ' ').slice(0, 110),
      );

      /* OUVRIR UNE ÉTAPE REFERME LA PRÉCÉDENTE : un accordéon, jamais deux
         détails empilés. */
      const apresClic = await lireLeVolet(page, 'dev');
      noter(
        'ouvrir une autre étape referme celle d’avant : un seul détail à l’écran',
        apresClic.detailsOuverts === 1 && apresClic.detail === 'build' && apresClic.detailSousSonEtape,
        JSON.stringify({ ouverts: apresClic.detailsOuverts, detail: apresClic.detail }),
      );

      /* RECLIQUER L'ÉTAPE OUVERTE LA REFERME : la liste entière redevient
         lisible d'un coup d'œil. */
      await page.locator('[data-etape-parcours="build"]').first().click();
      await page.waitForTimeout(500);
      const apresRepli = await lireLeVolet(page, 'dev');
      noter(
        'recliquer l’étape dépliée la REFERME : plus aucun détail ouvert',
        apresRepli.detailsOuverts === 0 && apresRepli.depliees.length === 0,
        JSON.stringify({ ouverts: apresRepli.detailsOuverts, depliees: apresRepli.depliees }),
      );

      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
    }

    /* ---------------------------------------------------------------- */
    /* LE VOLET DE LA MISE EN PRODUCTION — le bandeau du bas            */
    /* ---------------------------------------------------------------- */
    const barre = page.locator('[data-ouvrir-tiroir-production]').first();
    noter('le bandeau du bas porte sa propre porte d’entrée', (await barre.count()) === 1);
    let prod = null;
    if (await barre.count()) {
      await barre.click();
      await page.waitForTimeout(1000);
      noter(
        'au repos, le bandeau ouvre la procédure, plus la dernière mise en production',
        (await page.locator('[data-ouvrir-fil-publication]').count()) === 0 &&
          (await page.locator('[data-tiroir-procedure-production]').count()) === 1,
      );
      /* PENDANT UNE MISE EN PRODUCTION, le tiroir montre son parcours, sur la
         hauteur pleine. */
      await page.evaluate((run) => window.__injecter({ type: 'deploy.upsert', run }), {
        ...runProd,
        state: 'running',
        endedAt: undefined,
      });
      await page.waitForTimeout(1500);
      noter(
        'pendant une mise en production, le tiroir montre son parcours',
        (await page.locator('[data-parcours-etapes="production"]').count()) === 1 &&
          (await page.locator('[data-volet-publication="production"]').count()) === 1,
      );
      {
        /* On déplie une étape : son détail doit paraître sous elle. */
        const merge = page.locator('[data-etape-parcours="merge"]').first();
        if (await merge.count()) {
          await merge.click();
          await page.waitForTimeout(500);
        }
        prod = await lireLeVolet(page, 'production');
      }
    }
    noter('le volet de la MISE EN PRODUCTION s’ouvre', !!prod);
    if (prod) {
      noter(
        'il rend EXACTEMENT la même structure : une liste, six étapes, un détail déplié',
        !prod.deuxColonnes && prod.parcours && prod.etapes === 6 && prod.detail === 'merge' && prod.detailSousSonEtape,
        JSON.stringify({ colonnes: prod.deuxColonnes, etapes: prod.etapes, detail: prod.detail }),
      );
      noter(
        'mais ses étapes sont les SIENNES : la branche de production, le client',
        /branche de production/.test(prod.phrases[0] ?? '') &&
          prod.phrases.some((p) => /machine du client/.test(p)) &&
          prod.phrases.some((p) => /service chez le client/.test(p)),
        prod.phrases.join(' | ').slice(0, 160),
      );
      noter(
        'aucune phrase n’est partagée là où les deux étapes ne font pas la même chose',
        dev ? prod.phrases.filter((p, i) => p && p === dev.phrases[i]).length < prod.phrases.length : false,
      );
      noter(
        'elle n’embarque AUCUNE carte : pas de lot dans son volet',
        prod.lot === 0,
        `${prod.lot} lot(s)`,
      );
      noter(
        'ses étapes préparées d’avance sont marquées comme celles du déploiement',
        prod.preparees.join(',') === 'build',
        JSON.stringify(prod.preparees),
      );
      noter(
        'parler à celui qui publie est un GESTE DU PIED, jamais une étape du parcours',
        (await page.locator('[data-fenetre-pied] [data-point-conversation]').count()) === 1 &&
          prod.conversationDansLePied &&
          !prod.conversationDansLeParcours,
        JSON.stringify({ pied: prod.conversationDansLePied, parcours: prod.conversationDansLeParcours }),
      );
      /* ET CE BOUTON ROUVRE LE FIL : le geste du pied mène bien quelque part. */
      await page.locator('[data-fenetre-pied] [data-point-conversation]').first().click();
      await page.waitForTimeout(900);
      noter(
        'le bouton du pied ouvre la conversation dans un tiroir EMPILÉ',
        (await page.locator('[data-volet-conversation]').count()) === 1 &&
          (await page.locator('[data-tiroir-empile="oui"]').count()) >= 1,
      );
    }

    noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await contexte.close();
    await navigateur.close();
  }
}

/* ------------------------------------------------------------------ */

try {
  voletDesRegles();
  await voletDeLEcran();
} catch (erreur) {
  noter('le contrôle est allé au bout', false, String(erreur?.message ?? erreur));
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées.`);
/* Le démon d'essai tourne en tuyaux : sa boucle garderait ce script vivant
   indéfiniment. On nettoie et on sort explicitement. */
nettoyer();
process.exit(echecs.length ? 1 : 0);
