#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur, que l'application montre des
 * SILHOUETTES de contenu pendant son chargement — au lieu d'un écran vide qui
 * annonce « Aucun projet inscrit » et « Aucun projet sélectionné » avant même
 * d'avoir reçu quoi que ce soit.
 *
 * Trois moments, dans l'ordre où ils arrivent vraiment :
 *
 *  1. RIEN N'EST ENCORE ARRIVÉ du serveur : la colonne de gauche et la zone
 *     principale portent des silhouettes, et AUCUNE phrase d'écran vide.
 *  2. LA LISTE DES PROJETS EST LÀ, PAS ENCORE LES CARTES : la colonne de gauche
 *     montre ses vrais projets, le tableau garde ses silhouettes.
 *  3. TOUT EST ARRIVÉ : plus une seule silhouette, les vraies colonnes sont là.
 *
 * Rien n'est écrit ni modifié : on RETIENT simplement les messages du canal
 * temps réel dans la page, puis on les relâche. Seule une session d'essai d'une
 * heure est posée en base, retirée en partant.
 *
 *   BELUGA_VERIF_URL=http://localhost:7099 node scripts/verif-silhouettes-chargement.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';
import { ouvrirNavigation } from './lib/navigation.mjs';

/* La racine se déduit du script : lancé depuis une copie de travail, il juge CE
   code-là, jamais celui du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BELUGA_VERIF_URL || 'http://localhost:7099';
/* La base se résout comme le démon la résout (`lib/base-servie.mjs`,
   `BELUGA_DATA` d'abord) : viser une copie de carte faisait échouer ce contrôle
   sur « no such table: sessions ». */
const FICHIER_BASE = cheminDeLaBaseServie();

function base() {
  return new Database(FICHIER_BASE);
}

function poserSession() {
  const db = base();
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification silhouettes de chargement',
  );
  db.close();
  return cookie;
}

function retirerSession(cookie) {
  const db = base();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
  );
  db.close();
}

const resultats = [];
function record(nom, ok, detail = '') {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/*
 * LES BOÎTES D'UNE SÉRIE D'ÉLÉMENTS : coin gauche, largeur ET HAUT.
 *
 * Le HAUT compte autant que le reste — une barre en trop au-dessus du rail
 * décale TOUTES les colonnes vers le bas sans changer d'un pixel leur largeur
 * ni leur position horizontale, et passait donc inaperçue. Il se lit DANS LA
 * ZONE CENTRALE (`main[data-zone="centre"]`), le conteneur commun à la
 * silhouette du tableau et au vrai tableau : une barre en trop au-dessus du
 * rail y reste parfaitement visible, puisqu'elle est DEDANS. Mesuré dans la
 * fenêtre, il comptait aussi ce qui pousse la zone entière depuis le DEHORS —
 * le bandeau de reconnexion (28 px), affiché pendant qu'on retient l'état du
 * serveur et retiré dès qu'il arrive. Ce bandeau décale le vrai tableau
 * exactement comme sa silhouette : ce n'est pas un saut de mise en page.
 *
 * Le GAUCHE, lui, se lit DANS LE RAIL, décalage de défilement compris : à
 * l'arrivée des cartes, le vrai tableau se replace de lui-même sur la colonne
 * mémorisée du projet (`cleColonneTableau`, `board.tsx`) — un déplacement
 * VOULU, que la silhouette ne peut pas deviner et qui n'est pas un saut de mise
 * en page. Mesuré dans la fenêtre, il faisait échouer ce contrôle dès qu'une
 * colonne autre que la première était mémorisée.
 */
const boites = (page, selecteur) =>
  page.locator(selecteur).evaluateAll((noeuds) =>
    noeuds.map((n) => {
      const b = n.getBoundingClientRect();
      const rail = n.parentElement;
      const bRail = rail ? rail.getBoundingClientRect() : { left: 0 };
      const defilement = rail ? rail.scrollLeft : 0;
      const centre = n.closest('[data-zone="centre"]');
      const hautDuCentre = centre ? centre.getBoundingClientRect().top : 0;
      return {
        gauche: Math.round(b.left - bRail.left + defilement),
        largeur: Math.round(b.width),
        haut: Math.round(b.top - hautDuCentre),
      };
    }),
  );

/**
 * L'ÉCART D'UNE SÉRIE DE COLONNES, en pixels, sur les TROIS axes : bord gauche,
 * largeur ET haut de CHAQUE colonne. Le tableau ne se lit plus qu'en colonnes
 * (refonte du 11/10/2026), et la silhouette partage son gabarit
 * (`web/src/lib/gabarit-tableau.ts`) : on exige tout.
 */
function ecartDesColonnes(avant, apres) {
  return ecartMaximal(avant, apres);
}

/** L'écart maximal, en pixels, entre deux séries de boîtes de même longueur. */
function ecartMaximal(avant, apres) {
  if (avant.length !== apres.length || avant.length === 0) return Infinity;
  return Math.max(
    ...avant.map((b, i) =>
      Math.max(
        Math.abs(b.gauche - apres[i].gauche),
        Math.abs(b.largeur - apres[i].largeur),
        Math.abs(b.haut - apres[i].haut),
      ),
    ),
  );
}

/*
 * LE ROBINET. On se greffe sur le canal temps réel AVANT le premier script de
 * la page : chaque message reçu est mis de côté tant que son type est
 * « retenu ». `__relacher(filtre)` change le filtre puis rejoue tout ce qui
 * attendait et qui n'est plus retenu — l'ordre d'arrivée est préservé.
 */
function robinet() {
    window.__retenus = ['*'];
    window.__file = [];
    const retenu = (type) => window.__retenus.includes('*') || window.__retenus.includes(type);
    const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get() {
        return propriete.get.call(this);
      },
      set(ecouteur) {
        /* Seul le canal de l'application est retenu. Le serveur de
           développement en ouvre un autre pour son rechargement à chaud : le
           retenir bloquerait la page pour rien, et son écouteur n'est pas
           celui de l'application. */
        if (!String(this.url ?? '').endsWith('/ws')) return propriete.set.call(this, ecouteur);
        return propriete.set.call(this, (evenement) => {
          let type = '';
          try {
            type = JSON.parse(evenement.data).type ?? '';
          } catch {
            type = '';
          }
          if (retenu(type)) window.__file.push({ ecouteur, donnees: evenement.data });
          else ecouteur(evenement);
        });
      },
    });
    window.__relacher = (retenus) => {
      window.__retenus = retenus;
      const attente = window.__file;
      window.__file = [];
      for (const entree of attente) {
        let type = '';
        try {
          type = JSON.parse(entree.donnees).type ?? '';
        } catch {
          type = '';
        }
        if (retenu(type)) window.__file.push(entree);
        else entree.ecouteur({ data: entree.donnees });
      }
      return window.__file.length;
    };
}

/** Une fenêtre neuve, déjà identifiée et déjà munie du robinet. */
async function ouvrirContexte(browser, cookie, viewport) {
  const context = await browser.newContext({
    viewport,
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
    ...(viewport.width < 640 ? { isMobile: true, hasTouch: true } : {}),
  });
  await context.addCookies([
    {
      name: 'beluga_session',
      value: cookie,
      url: new URL(BASE).origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await context.addInitScript(robinet);
  return context;
}

/*
 * LA MÊME MESURE, DANS UNE FENÊTRE DONNÉE : où sont les colonnes EN SILHOUETTE,
 * où sont-elles une fois les vraies arrivées. Sert à juger le téléphone, dont la
 * barre d'onglets de colonnes n'existe pas sur ordinateur.
 */
async function mesurerLeSaut(browser, cookie, viewport, etiquette) {
  const context = await ouvrirContexte(browser, cookie, viewport);
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  /* On ATTEND la silhouette au lieu de compter les secondes : sous charge, un
     délai fixe mesurait parfois une page encore vide, et le contrôle échouait
     sur « 0 colonne » sans qu'aucune règle ne soit enfreinte. */
  await page.locator('[data-silhouette-colonne]').first().waitFor({ state: 'attached', timeout: 30000 });
  page.setDefaultTimeout(8000);

  await page.evaluate(() => window.__relacher(['project.etat']));
  await page.waitForTimeout(1200);
  const avant = await boites(page, '[data-silhouette-colonne]');
  record(`${etiquette} : les colonnes en silhouette sont posées`, avant.length >= 4, `${avant.length} colonne(s)`);

  await page.evaluate(() => window.__relacher([]));
  await page.locator('[data-column]').first().waitFor({ state: 'attached', timeout: 30000 });
  await page.waitForTimeout(800);
  const apres = await boites(page, '[data-column]');
  const ecart = ecartDesColonnes(avant, apres);
  record(
    `${etiquette} : les colonnes ne bougent NI de côté NI en largeur, et le tableau démarre au même endroit`,
    ecart <= 2,
    `écart max ${ecart} px — ${avant.length} silhouette(s) contre ${apres.length} vraie(s)`,
  );
  if (process.env.DEBUG_COLONNES) console.log(JSON.stringify({ etiquette, avant, apres }, null, 1));

  await context.close();
}

/*
 * LA BANNIÈRE « CONNEXION LENTE ». Tant que le serveur ne dit rien, les
 * silhouettes restent à l'écran : passé quatre secondes, une pastille le dit en
 * haut de l'écran — une seule, quel que soit le nombre de zones qui attendent —
 * et elle s'efface seule dès que les données arrivent. Elle ne bloque rien : le
 * clic la traverse.
 */
async function mesurerLaConnexionLente(browser, cookie) {
  const context = await ouvrirContexte(browser, cookie, { width: 1440, height: 900 });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('[data-silhouette-colonne]').first().waitFor({ state: 'attached', timeout: 30000 });
  page.setDefaultTimeout(8000);

  const banniere = page.locator('[data-bandeau-connexion-lente]');
  record(
    'la bannière ne paraît pas dès les premières secondes d’attente',
    (await banniere.count()) === 0,
  );
  const paru = await banniere
    .first()
    .waitFor({ state: 'visible', timeout: 9000 })
    .then(() => true)
    .catch(() => false);
  record('une attente de plus de quatre secondes affiche la bannière « Connexion lente »', paru);
  record('une seule bannière, même si plusieurs zones attendent', (await banniere.count()) === 1);
  record(
    'elle dit que le chargement prend plus de temps que d’habitude',
    /Connexion lente/.test((await banniere.first().innerText().catch(() => '')) || ''),
  );
  record(
    'elle ne bloque rien (le clic la traverse)',
    (await banniere
      .first()
      .evaluate((n) => getComputedStyle(n.parentElement).pointerEvents === 'none')
      .catch(() => false)),
  );
  record('elle est annoncée comme un statut', (await page.locator('[data-bandeau-connexion-lente][role="status"]').count()) === 1);

  await page.evaluate(() => window.__relacher([]));
  const partie = await banniere
    .first()
    .waitFor({ state: 'detached', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  record('elle s’efface dès que les données sont arrivées', partie);
  await context.close();
}

/*
 * LA PAGE D'UNE CARTE, TANT QUE LA CARTE N'A RIEN DIT.
 *
 * Une carte arrive avec l'instantané de son projet, mais son JOURNAL et son
 * FIL sont réclamés à l'ouverture de sa page (l'ancien tiroir : depuis la
 * refonte du 11/10/2026 une carte s'ouvre en PAGE sur la zone principale,
 * `[data-page-carte]` dans une feuille `[data-page-de-zone]`). Entre les deux,
 * elle se dessinait sur des valeurs par défaut : sa barre d'étapes, calculée
 * sur un journal absent, montrait « Travail » et « Rapport » comme plantés.
 *
 * On retient donc `card.conversation` : la page s'ouvre sans son fil, et doit
 * rester en silhouette, sans un seul état inventé. Puis on relâche, et la
 * vraie page prend sa place.
 */
/** La page d'une carte, une fois ouverte sur la zone principale. */
const PAGE_OUVERTE = '[data-page-de-zone]:has([data-page-carte], [data-silhouette="tiroir-carte"])';

async function mesurerLeTiroirDeCarte(browser, cookie) {
  const context = await ouvrirContexte(browser, cookie, { width: 1440, height: 900 });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('[data-silhouette-colonne]').first().waitFor({ state: 'attached', timeout: 30000 });
  page.setDefaultTimeout(8000);

  /* Tout passe SAUF le fil de la carte : c'est lui qui manquera au tiroir. */
  await page.evaluate(() => window.__relacher(['card.conversation']));
  const carte = page.locator('[data-carte]').first();
  await carte.waitFor({ state: 'visible', timeout: 30000 }).catch(() => undefined);
  if (!(await carte.count())) {
    record('tiroir de carte : aucune carte à ouvrir', false, 'le projet affiché n’en porte aucune');
    await context.close();
    return;
  }

  /*
   * LA PAGE PEUT S'OUVRIR SANS NOUS. La carte ouverte est MÉMORISÉE par
   * projet (`carteAReprendre`, `web/src/app.tsx`) : à l'arrivée des cartes, la
   * page de la dernière consultée se rouvre toute seule — et c'est exactement
   * l'ouverture qu'on veut mesurer. On lui laisse donc sa chance AVANT de
   * cliquer : cliquer d'emblée la refermait à peine rouverte.
   */
  const tiroirDejaOuvert = await page
    .locator(PAGE_OUVERTE)
    .first()
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!tiroirDejaOuvert) await carte.click();
  const silhouette = page.locator('[data-silhouette="tiroir-carte"]');
  await silhouette.waitFor({ state: 'attached', timeout: 15000 }).catch(() => undefined);
  record('la page de la carte s’ouvre en silhouette tant que la carte n’a rien dit', (await silhouette.count()) > 0);
  record(
    'cette attente est annoncée aux lecteurs d’écran',
    (await page.locator('[data-silhouette="tiroir-carte"][aria-busy="true"]').count()) > 0,
  );
  /* AUCUN ÉTAT INVENTÉ : la vraie barre d'étapes — celle qui porte les
     couleurs — ne doit pas exister pendant l'attente. */
  record(
    'aucune barre d’étapes colorée pendant l’attente',
    (await page.locator('[data-barre-etapes]').count()) === 0,
  );

  /* LA SILHOUETTE DESSINE SES TROIS ZONES FIXES : l'entête, la rangée
     d'onglets et le PIED DE SAISIE. Entre les deux, le seul rond qui tourne —
     ni frise d'étapes grise, ni bulles de conversation. */
  record(
    'la rangée d’onglets est dessinée',
    (await page.locator('[data-silhouette="tiroir-carte"] [data-silhouette-onglets]').count()) === 1,
  );
  record(
    'le pied de saisie est dessiné',
    (await page.locator('[data-silhouette="tiroir-carte"] [data-silhouette-pied]').count()) === 1,
  );
  record(
    'le rond qui tourne dit l’attente',
    await page
      .locator('[data-silhouette="tiroir-carte"] [data-silhouette-rond]')
      .first()
      .isVisible()
      .catch(() => false),
  );
  /* TROIS ZONES, ET RIEN ENTRE ELLES : on compte les briques grises de la
     silhouette. Trois pour le titre et ses pastilles, une pour le bouton
     carré, quatre pour les onglets, six pour le pied (le bandeau du geste
     principal, la ligne du champ, ses quatre icônes) — quatorze, et pas une de
     plus. */
  const briques = await page.locator('[data-silhouette="tiroir-carte"] .animate-silhouette').count();
  record('la silhouette porte ses quatorze briques, pas une de plus', briques === 14, `${briques} briques`);
  /* ENTRE LES ONGLETS ET LE PIED, AUCUN GRIS : les briques du milieu se
     comptent en retirant celles des trois zones fixes. */
  const briquesDesZones = await page
    .locator(
      '[data-silhouette="tiroir-carte"] [data-silhouette-onglets] .animate-silhouette, [data-silhouette="tiroir-carte"] [data-silhouette-pied] .animate-silhouette',
    )
    .count();
  const briquesDuHaut = await page
    .locator('[data-silhouette="tiroir-carte"] > div:first-of-type .animate-silhouette')
    .count();
  record(
    'aucune brique grise entre les onglets et le pied',
    briques - briquesDesZones - briquesDuHaut === 0,
    `${briques} briques : ${briquesDuHaut} en entête, ${briquesDesZones} dans les onglets et le pied`,
  );

  /* LA FEUILLE A DÉJÀ SA TAILLE DÉFINITIVE. Mesurée PENDANT l'attente, puis
     après l'arrivée des données : une feuille dont la hauteur suit son contenu
     grandissait d'un bond sous les yeux. La mesure ne se prend qu'une fois
     l'ÉTAT atteint (silhouette posée, puis silhouette partie), jamais sur un
     délai — c'est la règle de la compétence partagée sur les contrôles
     navigateur.
     Le tiroir tenait 92 % de l'écran ; la PAGE qui le remplace couvre la zone
     principale : toute la hauteur de la fenêtre, de la colonne de gauche
     (`--zone-principale-gauche`) au bord droit. C'est cette place-là qu'elle
     doit déjà occuper pendant l'attente. */
  const feuille = page.locator('[data-page-de-zone]').first();
  const fenetre = await page.evaluate(() => ({
    hauteur: window.innerHeight,
    largeur: window.innerWidth,
    gaucheDeLaZone: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zone-principale-gauche')) || 0,
  }));
  const boiteEnAttente = (await feuille.boundingBox()) ?? { x: -1, y: -1, width: 0, height: 0 };
  const hauteurEnAttente = boiteEnAttente.height;
  record(
    'la page couvre déjà toute la zone principale pendant l’attente',
    Math.abs(hauteurEnAttente - fenetre.hauteur) <= 2 &&
      Math.abs(boiteEnAttente.y) <= 2 &&
      Math.abs(boiteEnAttente.x - fenetre.gaucheDeLaZone) <= 2 &&
      Math.abs(boiteEnAttente.x + boiteEnAttente.width - fenetre.largeur) <= 2,
    `${Math.round(boiteEnAttente.width)} × ${Math.round(hauteurEnAttente)} px à ${Math.round(boiteEnAttente.x)} px du bord, ` +
      `fenêtre de ${fenetre.largeur} × ${fenetre.hauteur} px, zone principale à ${Math.round(fenetre.gaucheDeLaZone)} px`,
  );

  await page.evaluate(() => window.__relacher([]));
  await silhouette.waitFor({ state: 'detached', timeout: 20000 }).catch(() => undefined);
  record('la silhouette de la page disparaît quand les données arrivent', (await silhouette.count()) === 0);
  /* LA VRAIE PAGE A PRIS SA PLACE : son fil de parcours est monté
     (`data-fil="parcours"`, `web/src/components/chat.tsx`). */
  record(
    'la vraie page a pris sa place, son parcours monté',
    (await page.locator(`${PAGE_OUVERTE} [data-fil="parcours"]`).count()) > 0,
  );
  /* ET LA FEUILLE N'A PAS BOUGÉ D'UN CRAN entre la silhouette et le vrai
     contenu : c'est tout l'objet de la hauteur fixe. */
  const hauteurRemplie = (await feuille.boundingBox())?.height ?? 0;
  record(
    'la page ne saute pas de taille quand les données arrivent',
    Math.abs(hauteurRemplie - hauteurEnAttente) <= 2,
    `${Math.round(hauteurEnAttente)} px en attente, ${Math.round(hauteurRemplie)} px une fois rempli`,
  );

  /* ON REFERME CE QU'ON A OUVERT. La carte ouverte est retenue CÔTÉ SERVEUR
     (préférence `cleCarteOuverte`) : laissée ouverte, sa page se rouvrait
     toute seule dans chaque fenêtre suivante, et l'utilisateur retrouvait une
     carte d'essai ouverte. Une page déjà ouverte avant nous est laissée telle
     quelle : c'était son état. */
  if (!tiroirDejaOuvert) {
    await page.keyboard.press('Escape');
    await page.locator(PAGE_OUVERTE).first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  }

  await context.close();
}

/*
 * UNE PAGE DE CARTE QUI SE ROUVRE SEULE : la dernière carte consultée du projet
 * revient à l'arrivée des cartes, et sa page couvre la zone principale. On la
 * referme donc avant d'ouvrir un écran-outil — elle n'est pas ce qu'on juge ici.
 */
async function refermerUnTiroirRouvert(page) {
  await page.locator('[data-column]').first().waitFor({ state: 'attached', timeout: 30000 }).catch(() => undefined);
  const ouvert = await page
    .locator(PAGE_OUVERTE)
    .first()
    .waitFor({ state: 'visible', timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  if (!ouvert) return;
  await page.keyboard.press('Escape');
  await page.locator(PAGE_OUVERTE).first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
}


/* ------------------------------------------------------------------ */
/* LES ÉCRANS-OUTILS : Coffre-fort, Backups, Messagerie, Surveillance */
/* ------------------------------------------------------------------ */

/*
 * Chacun s'ouvre depuis la grille des services (le bouton à quatre carrés, tout
 * à gauche du fil d'Ariane — `ouvrirNavigation`) et lit ses données par un
 * aller-retour à lui. On RETIENT la réponse (`ack`) — ou, pour la surveillance,
 * l'état diffusé au premier envoi —, on ouvre l'écran, et on exige :
 *
 *   - la silhouette de l'écran, avec `aria-busy` ;
 *   - AUCUNE phrase d'attente, AUCUN état vide ;
 *   - la silhouette disparue une fois les données relâchées.
 */
const ECRANS = [
  {
    zone: 'coffre',
    bouton: '[data-ouvrir-coffre]',
    retenus: ['ack'],
    interdits: ['Lecture du coffre', 'Aucun accès enregistré pour l’instant.', 'Aucun accès ne correspond.'],
  },
  {
    zone: 'backups',
    bouton: '[data-ouvrir-backups]',
    retenus: ['ack'],
    interdits: ['Lecture des backups', 'Aucun site à sauvegarder pour l’instant.'],
  },
  {
    /*
     * LA MESSAGERIE (l'ancien « Espace client ») passe par le MÊME canal `/ws`
     * que le reste, avec sa propre demande (`espace.clients`) : son `ack` retenu,
     * l'écran reste en silhouette — la colonne des clients, l'entête et les trois
     * colonnes de demandes, dessinées à leur place finale.
     */
    zone: 'espace-haiko',
    bouton: '[data-ouvrir-espace-client]',
    retenus: ['ack'],
    sansTrait: true,
    interdits: ['Aucun client pour l’instant', 'Rien ici pour le moment.'],
  },
  {
    /* La surveillance ne demande rien : ses sites arrivent dans le premier
       envoi du serveur (`type: 'surveillance'`). C'est donc CET événement-là
       qu'on retient. */
    zone: 'surveillance',
    bouton: '[data-ouvrir-surveillance]',
    retenus: ['surveillance'],
    interdits: ['Aucune adresse surveillée. Ajoutez-en une ci-dessus.'],
  },
];

async function jugerUnEcran(browser, cookie, ecran) {
  const context = await ouvrirContexte(browser, cookie, { width: 1440, height: 900 });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  page.setDefaultTimeout(15000);

  /* Tout arrive SAUF ce que cet écran attend : l'application est posée, mais
     l'écran ouvert n'aura pas ses données. La tuile du service n'existe dans le
     document qu'une fois la grille ouverte (le contenu d'un menu fermé est
     démonté) : on ouvre donc la grille AVANT de la chercher. */
  await page.evaluate((retenus) => window.__relacher(retenus), ecran.retenus);
  await refermerUnTiroirRouvert(page);
  await ouvrirNavigation(page);
  await page.locator(`${ecran.bouton}:visible`).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.locator(`${ecran.bouton}:visible`).first().click();

  const silhouette = page.locator(`[data-silhouette="${ecran.zone}"]`);
  let vue = true;
  await silhouette.waitFor({ state: 'visible', timeout: 15000 }).catch(() => (vue = false));
  record(`${ecran.zone} : la silhouette paraît à l'ouverture`, vue);
  record(
    `${ecran.zone} : l'attente est annoncée aux lecteurs d'écran`,
    (await page.locator(`[data-silhouette="${ecran.zone}"][aria-busy="true"]`).count()) > 0,
  );

  /* LA MESSAGERIE SE LIT PAR LES FONDS : aucune de ses silhouettes ne trace de
     trait, comme la fiche réelle, qui n'a ni cadre ni trait. */
  if (ecran.sansTrait && vue) {
    const traits = await silhouette.first().evaluate((racine) =>
      [racine, ...racine.querySelectorAll('*')].filter((n) => {
        const s = getComputedStyle(n);
        return ['Top', 'Right', 'Bottom', 'Left'].some(
          (c) => s[`border${c}Style`] !== 'none' && parseFloat(s[`border${c}Width`]) > 0,
        );
      }).length,
    );
    record(`${ecran.zone} : aucune silhouette ne trace de bordure`, traits === 0, `${traits} élément(s) bordé(s)`);
  }

  for (const phrase of ecran.interdits) {
    const compte = await page.getByText(phrase, { exact: false }).count();
    record(`${ecran.zone} : « ${phrase.slice(0, 34)}… » ne paraît pas pendant le chargement`, compte === 0);
  }

  /* Les données arrivent : la silhouette s'efface. */
  await page.evaluate(() => window.__relacher([]));
  let partie = true;
  await silhouette.waitFor({ state: 'detached', timeout: 15000 }).catch(() => (partie = false));
  record(`${ecran.zone} : la silhouette s'efface quand les données arrivent`, partie);

  await context.close();
}

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  console.log(`Adresse visée : ${BASE}`);
  const cookie = poserSession();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await ouvrirContexte(browser, cookie, { width: 1440, height: 900 });
  const page = await context.newPage();

  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && erreurs.push(message.text()));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  /*
   * ON ATTEND UN ÉTAT, ON NE COMPTE PAS LES SECONDES. Trois secondes fixes
   * suffisaient sur une machine au repos ; sous la charge de plusieurs agents,
   * le canal n'était pas encore ouvert et le contrôle échouait en série sur
   * « 0 projet », sans qu'aucune règle ne soit enfreinte. La silhouette des
   * projets est le premier signe que la page est montée : c'est elle qu'on
   * attend.
   */
  await page
    .locator('[data-silhouette="projets"]')
    .first()
    .waitFor({ state: 'attached', timeout: 30000 })
    .catch(() => undefined);
  page.setDefaultTimeout(8000);

  const compter = (zone) => page.locator(`[data-silhouette="${zone}"]`).count();
  const texteVisible = (texte) => page.getByText(texte, { exact: false }).count();

  /* --- 1. Rien n'est encore arrivé ------------------------------------ */

  record('silhouettes des projets pendant le chargement', (await compter('projets')) > 0);
  record('silhouette du tableau pendant le chargement', (await compter('tableau')) > 0);
  record(
    'aucun « Aucun projet inscrit » pendant le chargement',
    (await texteVisible('Aucun projet inscrit')) === 0,
  );
  record(
    'aucun « Aucun projet sélectionné » pendant le chargement',
    (await texteVisible('Aucun projet sélectionné')) === 0,
  );
  record(
    'l\'attente est annoncée aux lecteurs d\'écran',
    (await page.locator('[data-silhouette][aria-busy="true"]').count()) > 0,
  );

  /* --- 2. Les projets sont là, pas encore les cartes ------------------- */

  await page.evaluate(() => window.__relacher(['project.etat']));
  /* Là encore un ÉTAT plutôt qu'un délai : on attend que le premier projet
     réel soit posé, pas qu'une seconde et deux dixièmes se soient écoulées. */
  await page
    .locator('[data-drag-kind="project"]')
    .first()
    .waitFor({ state: 'attached', timeout: 30000 })
    .catch(() => undefined);

  const projets = await page.locator('[data-drag-kind="project"]').count();
  record('les projets réels remplacent leurs silhouettes', projets > 0 && (await compter('projets')) === 0, `${projets} projet(s)`);
  record('le tableau garde ses silhouettes tant que ses cartes manquent', (await compter('tableau')) > 0);
  record('aucune colonne réelle n\'est encore posée', (await page.locator('[data-column]').count()) === 0);

  /* LES COLONNES SONT DÉJÀ À LEUR PLACE FINALE. On relève ici la position, la
     largeur ET LE HAUT de chaque colonne EN SILHOUETTE, pour les comparer plus
     bas à celles des vraies : le remplacement ne doit déplacer aucune colonne
     de côté, ni faire démarrer le tableau ailleurs (plus de barre fantôme
     au-dessus). */
  const avant = await boites(page, '[data-silhouette-colonne]');
  record('les colonnes en silhouette sont posées', avant.length >= 4, `${avant.length} colonne(s)`);

  /* LE VRAI TABLEAU NE POSE RIEN AU-DESSUS DES COLONNES : la silhouette non
     plus, sur téléphone comme sur ordinateur. */
  record(
    'aucune barre en silhouette au-dessus des colonnes',
    (await page.locator('[data-silhouette-onglets]').count()) === 0,
  );

  /* --- 3. Tout est arrivé --------------------------------------------- */

  await page.evaluate(() => window.__relacher([]));
  await page
    .locator('[data-column]')
    .first()
    .waitFor({ state: 'attached', timeout: 30000 })
    .catch(() => undefined);
  /* Les vraies colonnes sont posées : on laisse la mise en page se stabiliser
     avant de la MESURER — c'est une mesure de pixels, pas un état. */
  await page.waitForTimeout(800);

  const colonnes = await page.locator('[data-column]').count();
  /* Le tableau compte QUATRE colonnes (`shared/src/columns.ts`), « Archivé »
     comprise depuis qu'elle a quitté son tiroir. */
  record('les vraies colonnes sont posées', colonnes >= 4, `${colonnes} colonne(s)`);

  const apres = await boites(page, '[data-column]');
  const ecart = ecartDesColonnes(avant, apres);
  record(
    'les colonnes ne bougent pas de côté quand les vraies arrivent',
    ecart <= 2,
    `écart max ${ecart} px`,
  );
  if (process.env.DEBUG_COLONNES) console.log(JSON.stringify({ avant, apres }, null, 1));

  /* Le fil d'une carte arrive par un aller-retour de plus (`card.open`
     puis `agent.open`) : on lui laisse le temps avant de juger. */
  await page
    .locator('[data-silhouette]')
    .first()
    .waitFor({ state: 'detached', timeout: 15000 })
    .catch(() => undefined);
  const restantes = await page.locator('[data-silhouette]').evaluateAll((noeuds) =>
    noeuds.map((n) => n.getAttribute('data-silhouette')),
  );
  record('plus aucune silhouette une fois tout arrivé', restantes.length === 0, restantes.join(', '));

  record('aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await context.close();

  /* --- 4. LA MÊME MESURE SUR TÉLÉPHONE -------------------------------- */

  /* Sur téléphone comme sur ordinateur, le tableau se pose en COLONNES côte à
     côte (sa seule disposition) — mais une colonne y tient l'écran : la
     silhouette doit suivre ce gabarit-là aussi, sinon tout part de côté
     (1 068 px mesurés avant le gabarit partagé). */
  await mesurerLeSaut(browser, cookie, { width: 390, height: 844 }, 'téléphone');

  /* --- 5. LA PAGE D'UNE CARTE ----------------------------------------- */

  await mesurerLeTiroirDeCarte(browser, cookie);

  /* --- 6. LES ÉCRANS-OUTILS ------------------------------------------- */

  for (const ecran of ECRANS) await jugerUnEcran(browser, cookie, ecran);

  /* --- 7. LA BANNIÈRE « CONNEXION LENTE » ------------------------------ */

  await mesurerLaConnexionLente(browser, cookie);

  await browser.close();
  retirerSession(cookie);

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  if (echecs.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
