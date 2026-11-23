#!/usr/bin/env node
/**
 * LA MISE EN PRODUCTION ET « DÉPLOYER », dans un VRAI navigateur.
 *
 * DEPUIS LE 11/10/2026, LES DEUX GESTES VIVENT DANS LA BARRE D'EN-TÊTE DE LA
 * PAGE. SUR ORDINATEUR, en haut à droite : « Déployer » (icône, nom, compte du
 * lot, chevron) puis la mise en production, un bouton à icône seule, en aplat
 * d'encre, qui porte la pastille des versions en attente. SUR TÉLÉPHONE, plus
 * de pied de colonne ni de bande en bas de l'écran : les deux composants
 * restent montés sans rien dessiner (`data-publication-en-menu`) et disent
 * leur état au bouton à trois points du projet (`data-menu-general`), dont les
 * deux premières lignes (`data-menu-deployer`, `data-menu-production`) ouvrent
 * la page du geste. Le reste (page, déroulé, pourcentage, échec, réussite) se
 * lit de la même façon aux deux places. Les puces ci-dessous décrivent ce
 * comportement ; lire « barre d'en-tête » là où elles disent « bas du
 * tableau », « bandeau » ou « pied ».
 *
 * LE BOUTON DE MISE EN PRODUCTION :
 *
 *  - il existe, HORS de toute colonne, dans la barre d'en-tête, entre
 *    « Déployer » et la cloche ;
 *  - « Archivé » n'a plus de bloc de publication en tête ;
 *  - la barre ne porte qu'une PASTILLE (les versions de retard de la production,
 *    orange) et sa FLÈCHE — le nom « Mise en production » reste lu par les
 *    lecteurs d'écran, et le libellé texte revient si le chiffre est inconnu : un clic ouvre
 *    le tiroir de la PROCÉDURE (flèche inversée) sur son onglet
 *    « Configuration », qui range l'état de la production AU-DESSUS du bouton
 *    « Mettre à jour la version prod » ; un second clic le referme ; plus aucun
 *    lien vers la dernière mise en ligne au repos ;
 *  - au repos, l'âge de la version en production s'écrit en jours et heures ;
 *  - la confirmation de « Mettre à jour » bascule le MÊME volet sur le déroulé,
 *    sans empiler de second tiroir ;
 *  - pendant une mise en production simulée, le volet (comme celui du déploiement)
 *    montre le déroulé et « Arrêter », la barre et le chiffre posé à côté du
 *    libellé portent le même pourcentage que le déroulé (une étape SAUTÉE ne
 *    compte pas) : la barre en teinte « en cours », le chiffre dans l'ENCRE du
 *    bouton — une teinte d'état ne se lirait pas sur son aplat — à côté de la
 *    roue ;
 *  - un ÉCHEC passe la barre en couleur d'erreur et pose la CROIX sur le
 *    bouton, le volet garde le déroulé et propose « Relancer » ;
 *  - un déploiement vers dev ne touche pas le bandeau ;
 *  - LE PIED DE LA RANGÉE « À DÉPLOYER » lit le même suivi, et l'affiche DANS
 *    son bouton de lancement : une barre fine au ras du bas et le pourcentage
 *    après le libellé. Au repos (et pendant une mise en production) ni barre
 *    ni chiffre ; pendant un déploiement, le même pourcentage que le déroulé,
 *    en orangé ; rouge et FIGÉ sur un échec, qui ne s'efface jamais tout
 *    seul ; effacé après une réussite ; le chevron reste toujours là ;
 *  - une réussite remplit la barre, puis le volet et le bandeau repassent au
 *    repos ;
 *  - sur téléphone, rien ne se dessine en bas : le bouton à trois points porte
 *    la pastille des versions en attente (rien quand la production est à
 *    jour), sa ligne « Mise en production » ouvre la page, où rien ne déborde
 *    et où le bouton reste entier à l'écran ; page refermée, le bouton à trois
 *    points EST le suivi (la roue et le pourcentage du déroulé, un point rouge
 *    sur un échec).
 *
 * Démon et base d'ESSAI à soi (`BELUGA_BANDEAU_PORT`), plafond d'agents à zéro :
 * aucun moteur appelé, aucune publication réelle. Les déroulés sont injectés
 * dans le canal temps réel, exactement comme le démon les diffuse
 * (`deploy.upsert`) — le point d'essai `window.belugaEssai` n'existe pas dans
 * la construction que sert un démon d'essai.
 *
 *   node scripts/verif-bandeau-production.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_BANDEAU_PORT || 7203);
const BASE = `http://127.0.0.1:${PORT}`;
const { TMP, DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-bandeau-production-',
  port: PORT,
});

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${String(detail).slice(0, 180)}` : ''}`);
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-bandeau';
/* Le conducteur de la dernière mise en production : c'est SA conversation que
   la porte d'entrée permanente du bandeau doit rouvrir. */
const CONDUCTEUR = 'a-conducteur-bandeau';
let ENREGISTREMENT_EN_LIGNE = '';

function poserDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3_600_000,
    'vérification du bandeau de mise en production',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai bandeau',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    /* « Aucune » : une procédure en place qui n'appelle ni agent ni transfert. */
    miseEnProduction: { processus: { etapes: [{ libelle: 'Contrôle', commande: 'true', delaiS: 10 }] } },
    /* Le déploiement « hérité » : une procédure EN PLACE, sans agent à
       initialiser — sans elle, le bouton « Déployer » laisse sa place à
       « Configuration de la procédure » (`procedureEnPlace`). */
    deploiement: { herite: true },
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), t, t);
  /* UNE VERSION EN PRODUCTION VIEILLE DE 10 J 20 H : son âge doit se lire en
     jours, plus en « 260 h ». */
  db.prepare('DELETE FROM deploys').run();
  /* LA PRODUCTION EST À TROIS ENREGISTREMENTS DU DÉPÔT : la pastille doit dire 3.
     L'empreinte de la version en ligne est celle d'un VRAI enregistrement, sinon
     l'écart resterait inconnu et le libellé texte reviendrait. */
  const git = (...a) => execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', ...a], { cwd: DEPOT }).toString().trim();
  ENREGISTREMENT_EN_LIGNE = git('rev-parse', 'HEAD');
  for (const n of [1, 2, 3]) git('commit', '--allow-empty', '-qm', `après la mise en ligne ${n}`);
  const fin = t - (10 * 24 + 20) * 3_600_000 - 5 * 60_000;
  const ancienne = {
    id: 'r-ancienne',
    projectId: PROJET_ID,
    state: 'success',
    cible: 'production',
    steps: [],
    cardIds: [],
    reprises: 0,
    repriseApresCoupure: false,
    queued: false,
    startedAt: fin - 60_000,
    endedAt: fin,
    targetCommit: ENREGISTREMENT_EN_LIGNE,
    agentId: CONDUCTEUR,
  };
  db.prepare(
    'INSERT INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(ancienne.id, PROJET_ID, 'success', JSON.stringify(ancienne), ancienne.startedAt, ancienne.endedAt);

  /*
   * LE CONDUCTEUR DE CETTE MISE EN LIGNE, ET SON FIL.
   *
   * C'est ce qui rend la publication RETROUVABLE : le bandeau, au repos,
   * propose de rouvrir sa conversation — c'était le point qui bloquait, une
   * fois l'alerte disparue. L'agent n'a jamais reçu de tour : c'est un
   * CONTENANT de conversation, il ne coûte aucun quota.
   */
  const agent = {
    id: CONDUCTEUR,
    projectId: PROJET_ID,
    role: 'deploy',
    title: 'Mise en production',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'done',
    createdAt: ancienne.startedAt,
    updatedAt: ancienne.endedAt,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(CONDUCTEUR, PROJET_ID, 'deploy', 'done', JSON.stringify(agent), ancienne.startedAt, ancienne.endedAt);
  const bulle = {
    id: `fil-${ancienne.id}-rapport`,
    agentId: CONDUCTEUR,
    role: 'assistant',
    content: '✅ **Mise en production terminée.** La version est en ligne.',
    createdAt: ancienne.endedAt,
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

const etape = (key, state) => ({ key, state, log: '' });
const deroule = (patch) => ({
  id: 'r-essai',
  projectId: PROJET_ID,
  state: 'running',
  cible: 'production',
  steps: [],
  cardIds: [],
  reprises: 0,
  repriseApresCoupure: false,
  queued: false,
  startedAt: Date.now(),
  ...patch,
});


async function ouvrirLeTableau(navigateur, viewport, telephone = false) {
  const contexte = await navigateur.newContext({
    viewport,
    isMobile: telephone,
    hasTouch: telephone,
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.addInitScript(() => {
    /* « deploy.start » est RETENU avant de partir : le démon d'essai ne lance
       aucune publication, le déroulé est injecté à la main. */
    window.__startsRetenus = 0;
    const envoyer = WebSocket.prototype.send;
    WebSocket.prototype.send = function (donnees) {
      if (String(donnees).includes('"deploy.start"')) {
        window.__startsRetenus += 1;
        return;
      }
      return envoyer.call(this, donnees);
    };
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
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(4_000);
  const onglet = page.getByRole('button', { name: /^Tableau$/ });
  if (await onglet.count()) {
    await onglet.first().click();
    await page.waitForTimeout(1_500);
  }
  /* « attached », pas « visible » : sur téléphone le composant reste monté
     sans rien dessiner (`data-publication-en-menu`). */
  await page.waitForSelector('[data-bandeau-production]', { state: 'attached', timeout: 30_000 });
  return { contexte, page, erreurs };
}

const injecterDeroule = (page, run) =>
  page.evaluate((run) => window.__injecter({ type: 'deploy.upsert', run }), run);

const RELEVE = () => {
  const bandeau = document.querySelector('[data-bandeau-production]');
  if (!bandeau) return null;
  /* LA BARRE N'A QU'UN BOUTON, LA LIGNE ; le reste vit dans le tiroir, posé
     dans le `body` par son portail. */
  const ligne = bandeau.querySelector('[data-ouvrir-tiroir-production]');
  const tiroir = document.querySelector('[data-tiroir-production]');
  const pied = document.querySelector('[data-pied-tiroir-production]');
  const bouton = pied?.querySelector('[data-bouton-publication]');
  const etatProd = pied?.querySelector('[data-etat-production]');
  const barre = bandeau.querySelector('[data-barre-bandeau]');
  const pourcentBandeau = bandeau.querySelector('[data-pourcent-bandeau]');
  const deroule = document.querySelector('[data-deroule-production]');
  const feuille = document.querySelector('[data-entete-tiroir-production]')?.closest('[data-tiroir]');
  const commande = deroule
    ? [...deroule.querySelectorAll('button')].find((el) => /Arrêter|Relancer/.test(el.textContent ?? ''))
    : null;
  const c = commande?.getBoundingClientRect();
  const r = bandeau.getBoundingClientRect();
  const b = bouton?.getBoundingClientRect();
  return {
    ligne: ligne?.textContent?.trim() ?? null,
    pastille: (() => {
      const el = bandeau.querySelector('[data-mises-a-jour-en-attente]');
      if (!el) return null;
      const fond = getComputedStyle(el).backgroundColor;
      return {
        valeur: el.getAttribute('data-mises-a-jour-en-attente'),
        texte: el.textContent?.trim() ?? '',
        enRetard: el.hasAttribute('data-en-retard'),
        titre: el.getAttribute('title'),
        fond,
        coupee: el.scrollWidth > el.clientWidth + 1,
        aUneCoche: !!el.querySelector('svg'),
      };
    })(),
    libelleVisible: !!ligne && [...ligne.querySelectorAll('span')].some((el) => !el.classList.contains('sr-only') && el.textContent?.trim() === 'Mise en production'),
    /* Le bouton, plus la flèche accolée qui ouvre le détail (22/10/2026). */
    boutonsDansLaBarre: bandeau.querySelectorAll('button:not([data-chevron-production])').length,
    fleche: bandeau.querySelectorAll('[data-chevron-production]').length,
    /* L'icône du bouton : la fusée au repos, la roue pendant une mise en
       production, la croix sur un échec. */
    icone: (ligne?.querySelector('svg')?.getAttribute('class') ?? '').match(/lucide-(rocket|loader|x)\b/)?.[1] ?? null,
    ouvert: ligne?.getAttribute('aria-expanded') === 'true',
    etatAuDessusDuBouton: !!etatProd && !!b && etatProd.getBoundingClientRect().bottom <= b.top + 0.5,
    hauteurBouton: b ? Math.round(b.height) : null,
    suivi: bandeau.getAttribute('data-suivi'),
    /* SUR ORDINATEUR, le bouton vit dans la barre d'en-tête de la page. */
    dansLaBarre: !!bandeau.closest('[data-gestes-de-page="barre"]'),
    nom: ligne?.getAttribute('aria-label') ?? null,
    entreDeployerEtLaCloche: (() => {
      const deployer = document.querySelector('[data-gestes-de-page="barre"] [data-bloc-publication="to_deploy"]');
      /* Sur ordinateur, la cloche a quitté la barre pour le pied de la colonne
         (12/10/2026) : le bouton suit « Déployer », et ne la précède que si elle est dans la barre. */
      const cloche = document.querySelector('header [data-cloche-notifications]');
      if (!deployer) return false;
      return deployer.getBoundingClientRect().right <= r.left + 1 && (!cloche || r.right <= cloche.getBoundingClientRect().left + 1);
    })(),
    piedDeColonne: !!document.querySelector('[data-pied-rangee]'),
    dansUneColonne: !!bandeau.closest('[data-column]'),
    hauteur: Math.round(r.height),
    /* Rien ne pousse la page en largeur — jugé sur la page entière : sur
       téléphone le composant ne dessine rien, sa propre boîte ne dirait rien. */
    deborde: document.documentElement.scrollWidth > window.innerWidth + 1,
    boutonEntier: !!b && b.left >= 0 && b.right <= window.innerWidth + 0.5,
    bouton: bouton?.textContent?.trim() ?? null,
    etat: etatProd?.textContent?.trim() ?? null,
    deroule: !!deroule,
    tiroirsEmpiles: document.querySelectorAll('[data-volet-publication]').length - (deroule ? 1 : 0),
    feuille: feuille?.getAttribute('data-tiroir') ?? null,
    /* Le titre du volet est le dernier cran du fil d'Ariane de sa page ; sur
       téléphone ou sans fil, il reste dans l'entête du volet. */
    titreVolet:
      (
        [...document.querySelectorAll('[data-page-de-zone] [data-titre-de-page]')].pop() ??
        [...document.querySelectorAll('[data-feuille-du-bas] h2')].pop() ??
        document.querySelector('[data-entete-tiroir-production] h2')
      )?.textContent?.trim() ?? null,
    etapesDuDeroule: deroule?.querySelectorAll('[data-parcours-etapes] > li').length ?? 0,
    pourcentFlux: deroule?.querySelector('[data-pourcent-flux]')?.textContent?.trim() ?? null,
    commande: commande?.textContent?.trim() ?? null,
    commandeEntiere: !!c && c.left >= 0 && c.right <= window.innerWidth + 0.5,
    chiffre: pourcentBandeau
      ? {
          texte: pourcentBandeau.textContent?.trim(),
          valeur: pourcentBandeau.getAttribute('data-pourcent-bandeau'),
          teinte: ['text-en-cours', 'text-danger', 'text-success'].find((k) => pourcentBandeau.classList.contains(k)) ?? null,
          /* Écrit dans l'encre du bouton, dont l'aplat ne laisserait pas lire une teinte d'état. */
          encre: !!ligne && getComputedStyle(pourcentBandeau).color === getComputedStyle(ligne).color,
        }
      : null,
    barre: barre
      ? {
          pourcent: barre.getAttribute('data-pourcent'),
          erreur: barre.getAttribute('data-erreur'),
          teinte: barre.getAttribute('data-teinte'),
          opacite: getComputedStyle(barre).opacity,
        }
      : null,
    blocEnTeteArchive: !!document.querySelector('[data-column="archived"] [data-bloc-publication]'),
    /* TOUTES LES RANGÉES ONT LA MÊME HAUTEUR, vides ou pleines, « À déployer »
       comprise (elle n'a plus de pied, ni sur ordinateur ni sur téléphone). */
    hauteursRangees: [...document.querySelectorAll('[data-column]')].map((r) => Math.round(r.getBoundingClientRect().height)),
    colonne: (() => {
      /* Le bouton « Déployer » de la barre d'en-tête (ordinateur) ; sur
         téléphone le bloc reste monté sans bouton, et ce relevé rend `null`. */
      const bloc = document.querySelector('[data-bloc-publication="to_deploy"]');
      const boutonCol = bloc?.querySelector('[data-bouton-publication]');
      if (!boutonCol) return null;
      /* L'AVANCÉE SE LIT DANS LE BOUTON DE LANCEMENT : barre fine au ras du
         bas, chiffre après le libellé. Le chevron, lui, reste un chevron. */
      const chevron = bloc.querySelector('[data-chevron-process]');
      const barreCol = boutonCol.querySelector('[data-barre-colonne]');
      const chiffreCol = boutonCol.querySelector('[data-pourcent-colonne]');
      const bb = boutonCol.getBoundingClientRect();
      const bc = chevron?.getBoundingClientRect();
      return {
        hauteurBouton: Math.round(bb.height),
        texte: boutonCol.textContent?.trim() ?? null,
        dansLaBarre: !!bloc.closest('[data-gestes-de-page="barre"]'),
        boiteChevron: bc ? { h: Math.round(bc.height), l: Math.round(bc.width) } : null,
        /* UN SEUL BLOC : coupure d'1 px sur toute la hauteur, et même teinte
           (fond × opacité) pour le libellé et le chevron. */
        coupure: bc ? Math.round((bc.left - bb.right) * 100) / 100 : null,
        memeHauteur: bc ? Math.round(bc.height) === Math.round(bb.height) && Math.round(bc.top) === Math.round(bb.top) : null,
        teintes: chevron
          ? [boutonCol, chevron].map((el) => {
              const cs = getComputedStyle(el);
              const m = cs.backgroundColor.match(/[\d.]+/g) ?? [];
              const alphaFond = m.length > 3 ? Number(m[3]) : 1;
              return `${m.slice(0, 3).join(',')}@${(alphaFond * Number(cs.opacity)).toFixed(2)}`;
            })
          : null,
        /* VISIBLE, PAS SEULEMENT PRÉSENT : la marge `sm:px-3` de la taille
           `sm` comprimait l'icône à 4 px de large, un simple point (#2d5d). */
        chevronVisible: (() => {
          const r = chevron?.querySelector('svg')?.getBoundingClientRect();
          return !!r && r.width >= 10 && r.height >= 10;
        })(),
        anneauRestant: !!bloc.querySelector('[data-anneau-colonne], [data-anneau-progression]'),
        barre: barreCol
          ? {
              pourcent: barreCol.getAttribute('data-pourcent'),
              teinte: barreCol.getAttribute('data-teinte'),
              opacite: getComputedStyle(barreCol).opacity,
              auRasDuBas: Math.abs(barreCol.getBoundingClientRect().bottom - bb.bottom) <= 1.5,
            }
          : null,
        chiffre: chiffreCol?.getAttribute('data-pourcent-colonne') ?? null,
        teinte: chiffreCol
          ? (['text-en-cours', 'text-danger', 'text-success'].find((k) => chiffreCol.classList.contains(k)) ?? null)
          : null,
      };
    })(),
  };
};

/* Ouvre le tiroir de production, s'il est fermé : au repos, le bouton ouvre la
   CONFIRMATION (22/10/2026), et le volet s'ouvre par sa flèche accolée. */
async function ouvrirLeTiroir(page) {
  if (await page.locator('[data-pied-tiroir-production]').count()) return;
  await page.locator('[data-chevron-production]').click();
  await page.waitForSelector('[data-pied-tiroir-production]', { timeout: 10_000 });
  await page.waitForTimeout(400);
}

/**
 * SUR TÉLÉPHONE, CE QUE LE BOUTON À TROIS POINTS DIT SANS QU'ON L'OUVRE, et
 * ce qui ne se dessine plus en bas de l'écran.
 */
const RELEVE_TELEPHONE = () => {
  const visible = (el) => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  const bouton = document.querySelector('[data-entete-de-zone] [data-menu-general]');
  const b = bouton?.getBoundingClientRect();
  const pastille = bouton?.querySelector('[data-mises-a-jour-en-attente]');
  const chiffre = bouton?.querySelector('[data-pourcent-menu]');
  return {
    bouton: !!bouton,
    nombre: document.querySelectorAll('[data-menu-general]').length,
    entier: !!b && b.left >= 0 && b.right <= window.innerWidth + 0.5,
    hauteur: b ? Math.round(b.height) : null,
    publication: bouton?.getAttribute('data-publication') ?? null,
    icone: (bouton?.querySelector('svg')?.getAttribute('class') ?? '').match(/lucide-(ellipsis-vertical|loader)/)?.[1] ?? null,
    pastille: pastille
      ? {
          valeur: pastille.getAttribute('data-mises-a-jour-en-attente'),
          texte: pastille.textContent?.trim() ?? '',
          titre: pastille.getAttribute('title'),
          fond: getComputedStyle(pastille).backgroundColor,
        }
      : null,
    pourcent: chiffre?.getAttribute('data-pourcent-menu') ?? null,
    chiffreRouge: !!chiffre?.classList.contains('text-danger'),
    pointRouge: !!bouton?.querySelector('[data-publication-tombee]'),
    /* Ce qui ne se dessine plus en bas : ni bande, ni pied de colonne. */
    bandeVisible: [...document.querySelectorAll('[data-bandeau-production]')].some(visible),
    piedDeColonne: !!document.querySelector('[data-pied-rangee]'),
    enMenu: document.querySelectorAll('[data-publication-en-menu]').length,
    deborde: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
};

/** Ouvre le menu à trois points du projet et rend ses deux lignes de publication. */
async function ouvrirLeMenuDuProjet(page) {
  await page.locator('[data-entete-de-zone] [data-menu-general]').click();
  await page.waitForSelector('[role="menu"] [data-menu-production]', { timeout: 10_000 });
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const entrees = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')];
    const production = document.querySelector('[role="menu"] [data-menu-production]');
    return {
      /* Les deux lignes de publication ouvrent le menu, dans cet ordre. */
      ordre: entrees.slice(0, 2).map((e) => (e.hasAttribute('data-menu-deployer') ? 'deployer' : e.hasAttribute('data-menu-production') ? 'production' : 'autre')),
      enAttente: production?.getAttribute('data-menu-production') ?? null,
      pastille: production?.querySelector('[data-pastille]')?.textContent?.trim() ?? null,
    };
  });
}

/* Sur téléphone, la page de mise en production s'ouvre par SA LIGNE du menu. */
async function ouvrirLaPageParLeMenu(page) {
  if (await page.locator('[data-pied-tiroir-production], [data-deroule-production]').count()) return;
  if (!(await page.locator('[role="menu"] [data-menu-production]').count())) await ouvrirLeMenuDuProjet(page);
  await page.locator('[role="menu"] [data-menu-production]').click();
  /* Au repos, la ligne ouvre la CONFIRMATION (22/10/2026) : « Voir le détail » mène au volet. */
  await page.waitForSelector('[data-pied-tiroir-production], [data-deroule-production], [data-confirmation-production]', { timeout: 10_000 });
  if (await page.locator('[data-voir-detail-production]').count()) {
    await page.locator('[data-voir-detail-production]').click();
  }
  await page.waitForSelector('[data-pied-tiroir-production], [data-deroule-production]', { timeout: 10_000 });
  await page.waitForTimeout(600);
}

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  /* ---------------- Ordinateur ---------------- */
  const { contexte, page, erreurs } = await ouvrirLeTableau(navigateur, { width: 1400, height: 900 });
  await page.waitForTimeout(1_000);
  const repos = await page.evaluate(RELEVE);
  noter('la mise en production est un bouton de la barre d’en-tête, hors de toute colonne', !!repos && repos.dansLaBarre && !repos.dansUneColonne, JSON.stringify(repos));
  noter('il suit « Déployer » (et précède la cloche quand elle est dans la barre)', repos?.entreDeployerEtLaCloche === true);
  noter('il reste fin', (repos?.hauteur ?? 99) <= 44, `${repos?.hauteur} px`);
  noter(
    'au repos, le bouton « Déployer » de la barre d’en-tête n’a ni barre ni chiffre, et son chevron est là',
    !!repos?.colonne && repos.colonne.dansLaBarre && !repos.colonne.barre && !repos.colonne.chiffre && !repos.colonne.anneauRestant && repos.colonne.chevronVisible,
    JSON.stringify(repos?.colonne),
  );
  noter('« Archivé » n’a plus de bloc de publication en tête', repos?.blocEnTeteArchive === false);
  noter(
    'les quatre rangées ont la même hauteur, « À déployer » vide comprise',
    (repos?.hauteursRangees?.length ?? 0) === 4 && new Set(repos.hauteursRangees).size === 1,
    JSON.stringify(repos?.hauteursRangees),
  );
  noter('sur ordinateur, « À déployer » n’a plus de pied de colonne', repos?.piedDeColonne === false);
  noter(
    'tiroir fermé, le bouton ne porte que son icône et la pastille, son nom lu à part, et une flèche accolée',
    repos?.ligne === '3' && repos.nom === 'Mise en production' && !repos.libelleVisible && repos.boutonsDansLaBarre === 1 && repos.fleche === 1 && !repos.ouvert && !repos.bouton,
    JSON.stringify({ ligne: repos?.ligne, nom: repos?.nom, boutons: repos?.boutonsDansLaBarre, bouton: repos?.bouton }),
  );
  noter(
    'la pastille dit 3 versions de retard, en orange, avec la phrase de l’écart au survol',
    repos?.pastille?.valeur === '3' && repos.pastille.texte === '3' && repos.pastille.enRetard && /3 versions de retard/.test(repos.pastille.titre ?? '') && !repos.pastille.coupee && repos.pastille.fond !== 'rgba(0, 0, 0, 0)',
    JSON.stringify(repos?.pastille),
  );
  await page.locator('[data-bandeau-production]').screenshot({ path: path.join(TMP, 'bandeau-pastille-retard.png') });
  await ouvrirLeTiroir(page);
  const ouvert = await page.evaluate(RELEVE);
  noter('un clic sur le bouton ouvre le tiroir', ouvert?.ouvert === true, JSON.stringify({ ouvert: ouvert?.ouvert }));
  noter('au repos, le tiroir porte « Mettre à jour la version prod » en pied', /Mettre à jour la version prod/.test(ouvert?.bouton ?? '') && ouvert?.suivi === 'repos', ouvert?.bouton);
  noter('la pastille répète le nombre de la ligne d’état du tiroir', new RegExp(`\\b${repos?.pastille?.valeur} versions de retard`).test(ouvert?.etat ?? ''), ouvert?.etat);
  noter('au repos, il dit l’état de la production, au-dessus du bouton', ouvert?.etat?.includes(ENREGISTREMENT_EN_LIGNE.slice(0, 7)) && ouvert?.etatAuDessusDuBouton === true, ouvert?.etat);
  noter('l’âge de la version en production s’écrit en jours et heures (10 j 20 h)', /10 j 20 h/.test(ouvert?.etat ?? '') && !/\d{3} h/.test(ouvert?.etat ?? ''), ouvert?.etat);
  noter('au repos, le bandeau ne porte aucun chiffre', !ouvert?.chiffre && ouvert?.feuille === 'normal', JSON.stringify({ chiffre: ouvert?.chiffre, feuille: ouvert?.feuille }));
  noter('le bouton du pied a la hauteur commune des pieds (36 px)', ouvert?.hauteurBouton === 36, `${ouvert?.hauteurBouton} px`);
  await page.screenshot({ path: path.join(TMP, 'bandeau-tiroir-ouvert.png') });
  /* MÊME HAUTEUR QUE LE DÉPLOIEMENT : la feuille de la mise en production et celle du
     déploiement, ouvertes au repos, mesurent la même hauteur. */
  const hauteurProduction = await page.evaluate(() => Math.round(document.querySelector('[data-tiroir-procedure-production]')?.closest('[data-tiroir]')?.getBoundingClientRect().height ?? 0));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.locator('[data-bloc-publication="to_deploy"] [data-chevron-process]').click();
  await page.waitForSelector('[data-volet-publication="dev"]', { timeout: 20_000 });
  await page.waitForTimeout(600);
  const hauteurDeploiement = await page.evaluate(() => Math.round(document.querySelector('[data-volet-publication="dev"]')?.closest('[data-tiroir]')?.getBoundingClientRect().height ?? 0));
  console.log('HAUTEURS', hauteurProduction, hauteurDeploiement);
  noter('les feuilles de la mise en production et du déploiement ont la même hauteur au repos', hauteurProduction > 0 && hauteurProduction === hauteurDeploiement, `${hauteurProduction} px / ${hauteurDeploiement} px`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await ouvrirLeTiroir(page);

  /* ---------------------------------------------------------------- */
  /* LE TIROIR DE LA PROCÉDURE (refonte du 24/09/2026)                */
  /* ---------------------------------------------------------------- */
  /*
   * Le bandeau n'ouvre plus la DERNIÈRE mise en production : il ouvre la
   * procédure et son bouton. Depuis le 29/09/2026, plus d'onglets : la
   * conversation de l'agent vit dans les réglages du projet.
   */
  noter(
    'le tiroir s’ouvre sur la procédure, sans onglets',
    (await page.locator('[data-tiroir-procedure-production]').count()) === 1 &&
      (await page.locator('[data-onglet-tiroir-production]').count()) === 0,
  );
  noter(
    'au repos, plus de lien vers la conversation de la dernière mise en ligne',
    (await page.locator('[data-ouvrir-fil-publication]').count()) === 0,
  );

  /* L'INTERRUPTEUR DE MISE EN PRODUCTION, dans l'entête du tiroir, à gauche
     du « i » : éteint par défaut, il grise le bouton du pied et dit pourquoi ;
     un clic le rallume, le projet revient du serveur allumé, le bouton aussi. */
  const interrupteur = page.locator('[data-entete-tiroir-production] [data-interrupteur-mise-en-production]');
  const boutonPied = page.locator('[data-pied-tiroir-production] [data-bouton-publication]');
  const ordreEntete = await page.evaluate(() => {
    const entete = document.querySelector('[data-entete-tiroir-production]');
    const inter = entete?.querySelector('[data-interrupteur-mise-en-production]');
    const info = entete?.querySelector('[data-infos-publication], [data-bouton-infos-publication]');
    const reglages = entete?.querySelector('[data-reglages-tiroir-production]');
    if (!inter || !reglages) return null;
    const x = (e) => e.getBoundingClientRect().left;
    return {
      avantInfo: info ? x(inter) < x(info) : true,
      reglagesADroite: x(inter) < x(reglages),
      sansFleche: !entete?.querySelector('[data-fermer-tiroir-production]'),
    };
  });
  noter(
    'l’interrupteur est dans l’entête, avant le « i », avec le bouton de réglages à sa droite et sans flèche',
    !!ordreEntete && ordreEntete.avantInfo && ordreEntete.reglagesADroite && ordreEntete.sansFleche,
    JSON.stringify(ordreEntete),
  );
  noter('il est éteint par défaut', (await interrupteur.getAttribute('data-interrupteur-mise-en-production')) === 'non');
  const raisonEteinte = await page.locator('[data-raison-bouton-production]').textContent().catch(() => null);
  noter(
    'éteint, le bouton du pied est gris et sa raison est écrite au-dessus',
    (await boutonPied.isDisabled()) && /désactivée pour ce projet/.test(raisonEteinte ?? ''),
    raisonEteinte ?? '',
  );
  await interrupteur.click();
  await page.waitForFunction(
    () => document.querySelector('[data-interrupteur-mise-en-production]')?.getAttribute('data-interrupteur-mise-en-production') === 'oui' &&
      !document.querySelector('[data-pied-tiroir-production] [data-bouton-publication]')?.hasAttribute('disabled'),
    null,
    { timeout: 10_000 },
  ).catch(() => {});
  const enBase = (() => {
    const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
    try {
      return JSON.parse(db.prepare('SELECT data FROM projects WHERE id = ?').get(PROJET_ID).data).miseEnProductionActive;
    } finally {
      db.close();
    }
  })();
  noter(
    'allumé, le bouton du pied se rallume et le réglage est enregistré sur le projet',
    !(await boutonPied.isDisabled()) && enBase === true,
    JSON.stringify({ desactive: await boutonPied.isDisabled(), enBase }),
  );

  /* LA CONFIRMATION BASCULE LE MÊME VOLET SUR LE DÉROULÉ. */
  await page.locator('[data-pied-tiroir-production] [data-bouton-publication]').click();
  await page.getByRole('button', { name: 'Mettre à jour', exact: true }).click();
  await page.waitForTimeout(900);
  const confirme = await page.evaluate(RELEVE);
  const retenus = await page.evaluate(() => window.__startsRetenus);
  noter('la confirmation demande bien la mise en production', retenus === 1, `${retenus} demande(s)`);
  noter(
    'la confirmation affiche le déroulé DANS le volet, sans second tiroir',
    confirme?.deroule === true && confirme.tiroirsEmpiles === 0 && confirme.etapesDuDeroule === 6 && !confirme.bouton,
    JSON.stringify({ deroule: confirme?.deroule, empiles: confirme?.tiroirsEmpiles, etapes: confirme?.etapesDuDeroule, bouton: confirme?.bouton }),
  );
  noter('le volet du déroulé s’ouvre comme celui du déploiement (feuille du bas qui suit son contenu, pas la hauteur pleine)', confirme?.feuille === 'normal', confirme?.feuille);

  /* Une mise en production en route : fusion SAUTÉE, trois faites, la
     construction qui travaille — 3,5 sur 6 jouées, soit 58 %. */
  await injecterDeroule(
    page,
    deroule({
      currentStep: 'build',
      startedAt: Date.now() - 80_000,
      steps: [
        etape('merge', 'skipped'),
        etape('commit', 'done'),
        etape('push', 'done'),
        etape('verify', 'done'),
        etape('build', 'running'),
        etape('publish', 'todo'),
        etape('restart', 'todo'),
      ],
    }),
  );
  await page.waitForTimeout(800);
  const enRoute = await page.evaluate(RELEVE);
  noter('pendant la publication, le volet montre le déroulé, sans second tiroir', enRoute?.suivi === 'en-cours' && enRoute.deroule && enRoute.tiroirsEmpiles === 0, JSON.stringify({ suivi: enRoute?.suivi, deroule: enRoute?.deroule, empiles: enRoute?.tiroirsEmpiles }));
  noter('le titre du volet est celui, daté, du déroulé', !!enRoute?.titreVolet && enRoute.titreVolet !== 'Mise en production', enRoute?.titreVolet);
  noter('la barre porte le pourcentage, étape sautée retirée (58 %)', enRoute?.barre?.pourcent === '58' && enRoute.barre.erreur === null, JSON.stringify(enRoute?.barre));
  noter('le chiffre suit la barre, à côté du libellé, et répond au déroulé', enRoute?.chiffre?.texte === '58 %' && enRoute.chiffre.valeur === enRoute.barre?.pourcent && enRoute.pourcentFlux === '58 %' && /^58 %$/.test(enRoute.ligne ?? ''), JSON.stringify({ chiffre: enRoute?.chiffre, flux: enRoute?.pourcentFlux, ligne: enRoute?.ligne }));
  /* LE CHIFFRE S'ÉCRIT DANS L'ENCRE DU BOUTON (11/10/2026) : une teinte d'état
     ne se lirait pas sur son aplat. La teinte « en cours » reste celle de la
     barre, et la roue remplace la fusée. */
  noter(
    'la barre prend la teinte « en cours », le chiffre s’écrit dans l’encre du bouton, à côté de la roue',
    enRoute?.barre?.teinte === 'en-cours' && enRoute.chiffre?.encre === true && enRoute.chiffre.teinte === null && enRoute.icone === 'loader',
    JSON.stringify({ barre: enRoute?.barre?.teinte, chiffre: enRoute?.chiffre, icone: enRoute?.icone }),
  );
  noter('« Arrêter » se lit dans le déroulé du volet', enRoute?.commande === 'Arrêter', enRoute?.commande);
  noter('une mise en production ne touche pas le bouton « Déployer »', !enRoute?.colonne?.chiffre && !enRoute?.colonne?.barre && enRoute?.colonne?.chevronVisible === true, JSON.stringify(enRoute?.colonne));
  await page.screenshot({ path: path.join(TMP, 'bandeau-deroule.png') });

  /* Volet refermé puis rouvert pendant la marche : il s'ouvre sur le déroulé. */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  await page.locator('[data-ouvrir-tiroir-production]').click();
  await page.waitForTimeout(700);
  const rouvert = await page.evaluate(RELEVE);
  noter('rouvert pendant la marche, le volet s’ouvre directement sur le déroulé', rouvert?.ouvert === true && rouvert.deroule && rouvert.tiroirsEmpiles === 0, JSON.stringify({ ouvert: rouvert?.ouvert, deroule: rouvert?.deroule }));

  /* L'échec : la construction tombe. */
  await injecterDeroule(
    page,
    deroule({
      state: 'failed',
      currentStep: 'build',
      startedAt: Date.now() - 95_000,
      endedAt: Date.now() - 5_000,
      error: 'construction impossible',
      steps: [
        etape('merge', 'skipped'),
        etape('commit', 'done'),
        etape('push', 'done'),
        etape('verify', 'done'),
        etape('build', 'failed'),
        etape('publish', 'todo'),
        etape('restart', 'todo'),
      ],
    }),
  );
  await page.waitForTimeout(800);
  const echec = await page.evaluate(RELEVE);
  noter('un échec passe la barre en couleur d’erreur', echec?.suivi === 'en-echec' && echec.barre?.erreur === 'oui' && echec.barre.teinte === 'danger', JSON.stringify(echec?.barre));
  /* Sur l'aplat du bouton, l'échec ne se dit plus par un chiffre rouge : il
     se dit par la CROIX, qui remplace la roue, et par la barre restée rouge. */
  noter(
    'sur un échec, le bouton porte la croix, et son chiffre reste dans l’encre',
    echec?.icone === 'x' && echec.chiffre?.encre === true && echec.chiffre.valeur === echec.barre?.pourcent,
    JSON.stringify({ icone: echec?.icone, chiffre: echec?.chiffre }),
  );
  noter('après un échec, le volet garde le déroulé et propose « Relancer »', echec?.deroule === true && echec.commande === 'Relancer' && echec.tiroirsEmpiles === 0, JSON.stringify({ deroule: echec?.deroule, commande: echec?.commande }));

  /* Un déploiement vers dev ne touche pas le bandeau. */
  await injecterDeroule(page, deroule({ id: 'r-dev', cible: 'dev', currentStep: 'merge', steps: [etape('merge', 'running')] }));
  await page.waitForTimeout(800);
  const dev = await page.evaluate(RELEVE);
  noter('un déploiement vers dev laisse le bandeau et le volet au repos', dev?.suivi === 'repos' && !dev.chiffre && !dev.deroule && !!dev.bouton, JSON.stringify({ suivi: dev?.suivi, bouton: dev?.bouton, deroule: dev?.deroule }));

  /* LE BOUTON DE LA COLONNE suit ce déploiement : mêmes étapes que la mise en
     production simulée plus haut, donc même 58 %. */
  const etapesDev = (construction) => [
    etape('merge', 'skipped'),
    etape('commit', 'done'),
    etape('push', 'done'),
    etape('verify', 'done'),
    etape('build', construction),
    etape('publish', 'todo'),
    etape('restart', 'todo'),
  ];
  await injecterDeroule(page, deroule({ id: 'r-dev', cible: 'dev', currentStep: 'build', steps: etapesDev('running') }));
  await page.waitForTimeout(800);
  const devRoute = await page.evaluate(RELEVE);
  noter(
    'pendant un déploiement, la barre du bouton porte le même pourcentage que la barre du bas (58 %)',
    devRoute?.colonne?.barre?.pourcent === '58' && devRoute.colonne.barre.pourcent === enRoute?.barre?.pourcent && devRoute.colonne.barre.teinte === 'en-cours' && devRoute.colonne.barre.opacite === '1' && devRoute.colonne.barre.auRasDuBas,
    JSON.stringify(devRoute?.colonne),
  );
  noter(
    'le chiffre se lit DANS le bouton, après le libellé, et le chevron reste un chevron',
    devRoute?.colonne?.chiffre === '58' && devRoute.colonne.teinte === 'text-en-cours' && /58 %$/.test(devRoute.colonne.texte ?? '') && devRoute.colonne.chevronVisible === true && !devRoute.colonne.anneauRestant,
    JSON.stringify({ chiffre: devRoute?.colonne?.chiffre, texte: devRoute?.colonne?.texte, chevron: devRoute?.colonne?.chevronVisible }),
  );
  await page.locator('[data-bloc-publication="to_deploy"]').screenshot({ path: path.join(TMP, 'pied-a-deployer.png') });
  noter(
    'même teinte et coupure d’un pixel au repos (bouton éteint, flèche active)',
    repos?.colonne?.coupure === 1 && !!repos.colonne.teintes && repos.colonne.teintes[0] === repos.colonne.teintes[1],
    JSON.stringify({ coupure: repos?.colonne?.coupure, teintes: repos?.colonne?.teintes }),
  );
  noter(
    'le bouton « Déployer » est d’un seul bloc : coupure d’un pixel sur toute la hauteur, même teinte des deux parties',
    devRoute?.colonne?.coupure === 1 &&
      devRoute.colonne.memeHauteur === true &&
      !!devRoute.colonne.teintes &&
      devRoute.colonne.teintes[0] === devRoute.colonne.teintes[1],
    JSON.stringify({ coupure: devRoute?.colonne?.coupure, hauteur: devRoute?.colonne?.memeHauteur, teintes: devRoute?.colonne?.teintes }),
  );
  noter(
    'l’avancée ne grandit rien : bouton et chevron gardent leur hauteur',
    devRoute?.colonne?.hauteurBouton === repos?.colonne?.hauteurBouton &&
      JSON.stringify(devRoute?.colonne?.boiteChevron) === JSON.stringify(repos?.colonne?.boiteChevron),
    `${repos?.colonne?.hauteurBouton} → ${devRoute?.colonne?.hauteurBouton}`,
  );
  await injecterDeroule(
    page,
    deroule({ id: 'r-dev', cible: 'dev', state: 'failed', currentStep: 'build', endedAt: Date.now(), steps: etapesDev('failed') }),
  );
  await page.waitForTimeout(800);
  const devEchec = await page.evaluate(RELEVE);
  noter(
    'un déploiement tombé fige la barre du bouton en rouge, chiffre compris',
    devEchec?.colonne?.barre?.teinte === 'danger' && devEchec.colonne.teinte === 'text-danger' && devEchec.colonne.chiffre === devEchec.colonne.barre.pourcent,
    JSON.stringify(devEchec?.colonne),
  );

  /* LES DEUX FINS DE L'AVANCÉE, JAMAIS LA MÊME. L'ÉCHEC D'ABORD : il reste
     affiché une fois passé le délai qui aurait effacé une réussite. */
  await page.waitForTimeout(4_500);
  const echecPersistant = await page.evaluate(RELEVE);
  noter(
    'une barre rouge ne s’efface pas d’elle-même, même après le délai d’une réussite',
    echecPersistant?.colonne?.barre?.teinte === 'danger' &&
      echecPersistant.colonne.barre.opacite === '1' &&
      echecPersistant.colonne.chiffre === devEchec?.colonne?.chiffre,
    JSON.stringify(echecPersistant?.colonne),
  );

  /* LA RÉUSSITE ENSUITE : la barre se remplit, puis s'efface — plus rien ne
     reste affiché à cent pour cent. */
  await injecterDeroule(
    page,
    deroule({
      id: 'r-dev-reussi',
      cible: 'dev',
      state: 'success',
      startedAt: Date.now() - 40_000,
      endedAt: Date.now(),
      steps: [etape('merge', 'skipped'), etape('commit', 'done'), etape('publish', 'done')],
    }),
  );
  await page.waitForTimeout(600);
  const devReussi = await page.evaluate(RELEVE);
  noter(
    'une réussite remplit la barre du bouton jusqu’à 100 %, en bleu de réussite comme le bandeau',
    devReussi?.colonne?.barre?.pourcent === '100' && devReussi.colonne.barre.teinte === 'success' && devReussi.colonne.chiffre === '100',
    JSON.stringify(devReussi?.colonne),
  );
  await page.waitForTimeout(4_500);
  const devEfface = await page.evaluate(RELEVE);
  noter(
    'puis la barre et le chiffre s’effacent, le chevron toujours là',
    !devEfface?.colonne?.barre && !devEfface?.colonne?.chiffre && devEfface?.colonne?.chevronVisible === true,
    JSON.stringify(devEfface?.colonne),
  );

  /* La réussite : barre pleine, puis retour au repos. */
  await injecterDeroule(
    page,
    deroule({
      id: 'r-reussie',
      state: 'success',
      startedAt: Date.now() - 60_000,
      endedAt: Date.now(),
      steps: [etape('merge', 'skipped'), etape('commit', 'done'), etape('publish', 'done')],
    }),
  );
  await page.waitForTimeout(500);
  const reussie = await page.evaluate(RELEVE);
  noter('une réussite remplit la barre jusqu’au bout', reussie?.suivi === 'reussie' && reussie.barre?.pourcent === '100' && reussie.barre.teinte === 'success', JSON.stringify(reussie?.barre));
  /* La teinte de réussite est celle de la barre (ci-dessus) ; le chiffre, lui, reste dans l'encre du bouton. */
  noter('le chiffre dit 100 %, dans l’encre du bouton, et le déroulé reste visible', reussie?.chiffre?.texte === '100 %' && reussie.chiffre.encre === true && reussie.deroule, JSON.stringify({ chiffre: reussie?.chiffre, deroule: reussie?.deroule }));
  await page.waitForTimeout(4_000);
  const efface = await page.evaluate(RELEVE);
  noter('puis la barre s’efface, le chiffre disparaît et le volet repasse au repos', efface?.suivi === 'repos' && efface.barre?.opacite === '0' && !efface.chiffre && !efface.deroule && /Mettre à jour la version prod/.test(efface.bouton ?? ''), JSON.stringify({ barre: efface?.barre, bouton: efface?.bouton, deroule: efface?.deroule }));

  /* LA FEUILLE RECOUVRE LA BARRE : elle se referme par Échap (ou un clic à côté). */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  const referme = await page.evaluate(RELEVE);
  noter('Échap referme le tiroir', referme?.ouvert === false && !referme.bouton, JSON.stringify({ ouvert: referme?.ouvert, bouton: referme?.bouton }));

  noter('ordinateur — aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await contexte.close();

  /* ---------------- Téléphone, production en retard ---------------- */
  /*
   * PLUS DE BANDE EN BAS DE L'ÉCRAN (demande du 11/10/2026). La bande, sa
   * flèche et sa pastille à coche ont disparu : le composant reste monté sans
   * rien dessiner et dit son état au bouton à trois points du projet, dont la
   * ligne « Mise en production » ouvre la page. Les affirmations qui jugeaient
   * la place et la flèche de la bande sont donc retirées ; celles-ci jugent ce
   * qui la remplace.
   */
  const TELEPHONE = { width: 390, height: 844 };
  const telRetard = await ouvrirLeTableau(navigateur, TELEPHONE, true);
  await telRetard.page.waitForTimeout(1_000);
  const enRetard = await telRetard.page.evaluate(RELEVE_TELEPHONE);
  noter(
    'téléphone — le bouton à trois points porte la pastille des 3 versions en attente, avec la phrase de l’écart',
    enRetard.pastille?.valeur === '3' && enRetard.pastille.texte === '3' && /3 versions de retard/.test(enRetard.pastille.titre ?? '') && enRetard.pastille.fond !== 'rgba(0, 0, 0, 0)' && enRetard.publication === 'en-attente' && enRetard.entier,
    JSON.stringify(enRetard),
  );
  const lignesEnRetard = await ouvrirLeMenuDuProjet(telRetard.page);
  noter(
    'téléphone — la ligne « Mise en production » du menu répète ce nombre',
    lignesEnRetard.enAttente === '3' && lignesEnRetard.pastille === '3',
    JSON.stringify(lignesEnRetard),
  );
  await telRetard.page.screenshot({ path: path.join(TMP, 'telephone-menu-en-retard.png') });
  noter('téléphone, en retard — aucune erreur JavaScript', telRetard.erreurs.length === 0, telRetard.erreurs.slice(0, 2).join(' | '));
  await telRetard.contexte.close();

  /* ---------------- Production à jour : plus rien d'orange ---------------- */
  {
    const db = new Database(path.join(DATA, 'beluga.db'));
    const ligne = db.prepare("SELECT id, data FROM deploys WHERE id = 'r-ancienne'").get();
    const run = JSON.parse(ligne.data);
    run.targetCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: DEPOT }).toString().trim();
    db.prepare('UPDATE deploys SET data = ? WHERE id = ?').run(JSON.stringify(run), ligne.id);
    db.close();
  }

  /* ---------------- Téléphone ---------------- */
  const tel = await ouvrirLeTableau(navigateur, TELEPHONE, true);
  await tel.page.waitForTimeout(1_000);
  const telFerme = await tel.page.evaluate(RELEVE_TELEPHONE);
  noter('téléphone — rien ne déborde, et le bouton à trois points reste entier à l’écran', telFerme.bouton && !telFerme.deborde && telFerme.entier, JSON.stringify(telFerme));
  noter(
    'téléphone — plus de bande en bas ni de pied de colonne : les deux gestes restent montés sans rien dessiner, derrière un seul bouton à trois points',
    !telFerme.bandeVisible && !telFerme.piedDeColonne && telFerme.enMenu === 2 && telFerme.nombre === 1,
    JSON.stringify({ bande: telFerme.bandeVisible, pied: telFerme.piedDeColonne, enMenu: telFerme.enMenu, boutons: telFerme.nombre }),
  );
  noter('téléphone — le bouton à trois points reste fin', (telFerme.hauteur ?? 99) <= 44, `${telFerme.hauteur} px`);
  noter(
    'téléphone — production à jour : ni pastille ni point orange sur le bouton, qui garde ses trois points',
    !telFerme.pastille && telFerme.publication === null && telFerme.icone === 'ellipsis-vertical',
    JSON.stringify({ pastille: telFerme.pastille, publication: telFerme.publication, icone: telFerme.icone }),
  );
  await tel.page.locator('[data-entete-de-zone]').first().screenshot({ path: path.join(TMP, 'telephone-entete-a-jour.png') });
  const lignes = await ouvrirLeMenuDuProjet(tel.page);
  noter(
    'téléphone — le menu s’ouvre sur « Déployer » puis « Mise en production », sans pastille quand la production est à jour',
    lignes.ordre.join(',') === 'deployer,production' && lignes.enAttente === '0' && lignes.pastille === null,
    JSON.stringify(lignes),
  );
  await ouvrirLaPageParLeMenu(tel.page);
  const telRepos = await tel.page.evaluate(RELEVE);
  noter(
    'téléphone — la ligne « Mise en production » ouvre la page, sans rien lancer',
    /Mettre à jour la version prod/.test(telRepos?.bouton ?? '') && (await tel.page.evaluate(() => window.__startsRetenus)) === 0,
    telRepos?.bouton,
  );
  noter('téléphone — le bouton du tiroir reste entier à l’écran', telRepos?.boutonEntier === true, telRepos?.bouton);
  await injecterDeroule(
    tel.page,
    deroule({
      currentStep: 'publish',
      startedAt: Date.now() - 200_000,
      steps: [etape('merge', 'done'), etape('commit', 'done'), etape('build', 'done'), etape('publish', 'running')],
    }),
  );
  await tel.page.waitForTimeout(800);
  const telRoute = await tel.page.evaluate(RELEVE);
  noter('téléphone — en publication, rien ne déborde et le déroulé tient dans le volet (même ouverture que le déploiement)', !!telRoute && !telRoute.deborde && telRoute.suivi === 'en-cours' && telRoute.deroule && telRoute.feuille === 'normal' && telRoute.tiroirsEmpiles === 0, JSON.stringify(telRoute));
  noter('téléphone — « Arrêter » reste entier à l’écran', telRoute?.commande === 'Arrêter' && telRoute.commandeEntiere, telRoute?.commande);
  await tel.page.screenshot({ path: path.join(TMP, 'bandeau-telephone.png') });

  /* PAGE REFERMÉE, LE SUIVI SE LIT SANS RIEN OUVRIR : c'est ce que la bande
     du bas disait, et que le bouton à trois points dit désormais. */
  await tel.page.keyboard.press('Escape');
  await tel.page.waitForTimeout(800);
  const telSuivi = await tel.page.evaluate(RELEVE_TELEPHONE);
  noter(
    'téléphone — page refermée, le bouton à trois points est le suivi : la roue et le pourcentage du déroulé',
    telSuivi.publication === 'en-route' && telSuivi.icone === 'loader' && !!telSuivi.pourcent && `${telSuivi.pourcent} %` === telRoute?.pourcentFlux && !telSuivi.pastille && telSuivi.entier,
    JSON.stringify({ publication: telSuivi.publication, icone: telSuivi.icone, pourcent: telSuivi.pourcent, flux: telRoute?.pourcentFlux }),
  );
  await tel.page.locator('[data-entete-de-zone]').first().screenshot({ path: path.join(TMP, 'telephone-entete-suivi.png') });
  await injecterDeroule(
    tel.page,
    deroule({
      state: 'failed',
      currentStep: 'publish',
      startedAt: Date.now() - 220_000,
      endedAt: Date.now(),
      error: 'transfert impossible',
      steps: [etape('merge', 'done'), etape('commit', 'done'), etape('build', 'done'), etape('publish', 'failed')],
    }),
  );
  await tel.page.waitForTimeout(800);
  const telEchec = await tel.page.evaluate(RELEVE_TELEPHONE);
  noter(
    'téléphone — un échec pose un point rouge sur le bouton à trois points, chiffre en rouge',
    telEchec.publication === 'tombee' && telEchec.pointRouge && telEchec.chiffreRouge && telEchec.icone === 'ellipsis-vertical',
    JSON.stringify({ publication: telEchec.publication, point: telEchec.pointRouge, rouge: telEchec.chiffreRouge, icone: telEchec.icone }),
  );
  noter('téléphone — aucune erreur JavaScript', tel.erreurs.length === 0, tel.erreurs.slice(0, 2).join(' | '));
  await tel.contexte.close();

  await navigateur.close();
  const rates = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés.`);
  if (rates.length) console.log(`(captures dans ${TMP})`);
  process.exit(rates.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  console.error(journal.slice(-20).join(''));
  process.exit(1);
});
