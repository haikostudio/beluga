#!/usr/bin/env node
/**
 * LA COLONNE DE GAUCHE REPLIABLE, ET L'ACCUEIL DE LA MESSAGERIE — dans un vrai
 * navigateur.
 *
 * Deux chantiers que rien d'autre ne peut juger : le premier tient à des gestes
 * de souris (survol, sortie), le second à l'écran d'arrivée d'une destination.
 *
 * CE QU'IL VÉRIFIE :
 *  1. le bouton de repli vit dans la TÊTE DE LA COLONNE DE GAUCHE, tout en haut,
 *     et n'existe QU'UNE FOIS dans l'écran ; le voyant d'état ne s'affiche
 *     qu'une fois lui aussi (au pied de la colonne, à côté de « LLM en ligne ») ;
 *  2. rétrécie, la colonne GARDE SA STRUCTURE : tous les projets sont encore
 *     là, réduits à leur icône, et aucune pile de destinations ne les remplace ;
 *     (jugé sur les TABLEAUX DE BORD : depuis la refonte du 11/10/2026 la
 *     colonne suit le lieu, et ne liste les projets que là) ;
 *  3. le survol la rouvre EN SURIMPRESSION — la zone de droite ne bouge ni de
 *     gauche ni de largeur, au pixel près ;
 *  4. la sortie du curseur la referme, et le choix survit à un rechargement ;
 *  5. ouvrir la Messagerie tombe sur la VUE D'ENSEMBLE, pas sur une conversation ;
 *  6. l'accueil montre son GRAPHIQUE JOURNALIER, son sélecteur de période et
 *     ses six chiffres ; changer de période le redessine ;
 *  7. UN ACCUEIL VIDE ALORS QUE DES CLIENTS EXISTENT EST UN REFUS : c'est le
 *     défaut qui affichait tous les chiffres à zéro et aucune fiche ;
 *  8. la fiche entière (sans aucun bouton) ouvre le tableau de son client, à la
 *     souris comme au clavier ; sa bulle ouvre la conversation, sa croix la
 *     referme, et le retour ramène à la vue d'ensemble — ce retour est le cran
 *     « Messagerie » du fil d'Ariane, le client en étant la suite.
 *
 * LE POINT « le voyant d'état est dans le coin du bouton » ÉTAIT DÉJÀ ROUGE AVANT
 * LA REFONTE (29/30) et le reste : il n'a pas été réparé ici.
 *
 * ON VÉRIFIE UN ÉTAT, PAS UNE HAUTEUR : chaque contrôle lit un repère
 * (`data-colonne-projets`, `data-accueil-messagerie`…) plutôt que de mesurer un
 * pixel qu'une retouche d'affichage déplacerait. Les deux seules mesures prises
 * sont des COMPARAISONS avant/après du même élément — c'est tout l'objet du
 * point 2.
 *
 * DÉMON ET BASE D'ESSAI À LUI, ET SON DÉCOR SEMÉ ICI. Ce contrôle visait le
 * serveur de développement, donc le démon EN SERVICE derrière lui : une
 * interface neuve parlant à un démon qui ne connaît pas encore sa commande
 * rendait un accueil vide, et le contrôle refusait un écran pourtant juste.
 * Il monte désormais son propre démon, sur le code de CE dépôt, avec des
 * clients, des demandes et des messages datés jour par jour : ce qu'il juge
 * est le code qu'on vient d'écrire, jamais celui de la dernière mise en ligne.
 * Aucun agent n'est appelé (plafond à zéro), aucun quota dépensé.
 *
 *   npm run build && node scripts/verif-espace-messagerie.mjs
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { creerResultats } from './lib/verif-resultats.mjs';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { allerVers, ouvrirLesTableauxDeBord } from './lib/navigation.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_MESSAGERIE_PORT || 7211);
const ADRESSE = `http://127.0.0.1:${PORT}`;
const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-espace-messagerie-',
  port: PORT,
});

const { results, record } = creerResultats();
const ok = (titre) => record(titre, true);
const refus = (titre, detail) => record(titre, false, detail ?? '');

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const JOUR = 86_400_000;
/** Assez de projets pour que la colonne ait quelque chose à rétrécir. */
const PROJETS = ['Atelier', 'Boutique', 'Cabinet', 'Domaine', 'Enseigne', 'Fabrique'];
/** Deux clients : un bavard, un discret — l'ordre par activité se voit alors. */
const CLIENTS = [
  { id: 'c-bavard', identifiant: 'bavard', nom: 'Client Bavard', projets: ['p-1', 'p-2'], messages: 40 },
  { id: 'c-discret', identifiant: 'discret', nom: 'Client Discret', projets: ['p-3'], messages: 6 },
];

/**
 * LE DÉCOR : des projets, deux clients, leurs demandes dans les quatre
 * colonnes, et des messages RÉPARTIS SUR QUARANTE JOURS. La profondeur compte :
 * le sélecteur de période n'a de sens que si 7 jours et 30 jours ne donnent pas
 * la même image.
 */
function poserDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(JETON),
    t,
    t + 3_600_000,
    'vérification de la messagerie',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  PROJETS.forEach((nom, i) => {
    const projet = {
      id: `p-${i + 1}`,
      name: nom,
      path: DEPOT,
      defaultEngine: 'claude',
      isSelf: false,
      rank: i + 1,
      archived: false,
      createdAt: t,
      updatedAt: t,
    };
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), t, t);
  });

  db.prepare("DELETE FROM users WHERE role = 'client'").run();
  db.prepare('DELETE FROM user_projects').run();
  db.prepare('DELETE FROM demandes').run();
  db.prepare('DELETE FROM demande_messages').run();

  const colonnes = ['a-faire', 'en-cours', 'termine', 'valide'];
  for (const client of CLIENTS) {
    db.prepare(
      'INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
    ).run(client.id, client.identifiant, 'client', client.nom, 'sel', 'empreinte', t - 90 * JOUR);
    for (const projet of client.projets) {
      db.prepare('INSERT INTO user_projects (user_id, project_id) VALUES (?, ?)').run(client.id, projet);
    }
    /* UNE DEMANDE PAR COLONNE : la répartition affichée a alors quatre chiffres
       différents, et une colonne oubliée se voit. */
    colonnes.forEach((colonne, rang) => {
      const id = `d-${client.id}-${colonne}`;
      const quand = t - (rang + 1) * 3 * JOUR;
      db.prepare(
        `INSERT INTO demandes (id, project_id, auteur_id, colonne, rang, titre, carte_id, data, creee_le, derniere_activite)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      ).run(
        id,
        client.projets[0],
        client.id,
        colonne,
        rang + 1,
        `Demande ${colonne} de ${client.nom}`,
        JSON.stringify({ description: 'décor de vérification', importance: 'normale', auteurNom: client.nom, fichiers: [], etiquettes: [], taches: [] }),
        quand,
        quand,
      );
    });
    /* LES MESSAGES, ÉTALÉS SUR QUARANTE JOURS, jamais tous le même jour. */
    for (let n = 0; n < client.messages; n += 1) {
      const quand = t - Math.floor((n * 40 * JOUR) / client.messages) - 3_600_000;
      db.prepare('INSERT INTO demande_messages (id, demande_id, auteur_id, data, cree_le) VALUES (?, ?, ?, ?, ?)').run(
        `m-${client.id}-${n}`,
        `d-${client.id}-a-faire`,
        client.id,
        JSON.stringify({ auteurNom: client.nom, auteurRole: 'client', texte: `message ${n}`, fichiers: [] }),
        quand,
      );
    }
  }
  db.close();
}

/**
 * COMBIEN DE CLIENTS LA BASE CONTIENT-ELLE ?
 *
 * C'est la seule façon de distinguer « l'accueil est vide à bon droit » de
 * « l'accueil est TOMBÉ ». Le défaut qui a motivé ce contrôle relevait les
 * échanges sur une colonne mal nommée : la commande levait une erreur, l'écran
 * l'avalait, et affichait tous les chiffres à zéro sans une seule fiche.
 */
function clientsEnBase() {
  try {
    const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
    const n = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'client'").get()?.n ?? 0;
    db.close();
    return n;
  } catch {
    return null;
  }
}

/**
 * L'application est-elle prête ? On attend un ÉTAT, jamais une durée — et ici
 * un état du DOM : le point d'essai `window.belugaEssai` est retiré de la
 * construction de production, qui est celle que sert un démon d'essai.
 */
async function attendreLApplication(page) {
  try {
    await page.locator('[data-colonne-projets]').first().waitFor({ state: 'attached', timeout: 60_000 });
    await page.locator('aside[data-zone="gauche"] [data-drag-kind="project"]').first().waitFor({ state: 'attached', timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

/** Un tiroir laissé ouvert avalerait chaque clic : on referme ce qui traîne. */
async function refermerCeQuiTraine(page) {
  for (let essai = 0; essai < 6; essai += 1) {
    const ouvert = await page.evaluate(
      () => document.querySelectorAll('[role="dialog"],[role="alertdialog"]').length,
    );
    if (!ouvert && essai > 0) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
}

/* ------------------------------------------------------------------ */
/* 1 à 4. La colonne de gauche                                         */
/* ------------------------------------------------------------------ */

async function laColonne(page) {
  /*
   * LA COLONNE SUIT LE LIEU (retouche du 11/10/2026) : dans un projet — où
   * l'application s'ouvre — elle porte les options du projet, et ses lignes de
   * projets restent dans le document, CACHÉES. Elle ne liste les projets que
   * sur les tableaux de bord : c'est donc là qu'on la juge, sans quoi « tous
   * les projets sont encore là une fois rétréci » compterait des nœuds que
   * personne ne voit.
   */
  await ouvrirLesTableauxDeBord(page);
  await page.waitForTimeout(400);

  /*
   * LE BOUTON DE REPLI VIT DANS LA TÊTE DE LA COLONNE, et nulle part ailleurs.
   * Il vivait tout à gauche du bandeau qui courait sur toute la largeur ; la
   * refonte du 11/10/2026 a retiré ce bandeau (« LA BARRE D'EN-TÊTE D'UNE
   * PAGE : FIL D'ARIANE À GAUCHE… »), et la tête de la colonne ne garde que
   * « le nom de l'application, puis deux gestes — chercher un projet, replier
   * la colonne » (`web/src/components/sidebar.tsx`). Un contrôle qui
   * accepterait deux emplacements laisserait passer le doublon qu'on a évité.
   */
  const boutons = page.locator('[data-replier-colonne]');
  const combienDeBoutons = await boutons.count();
  if (combienDeBoutons === 1) ok('un SEUL bouton de repli dans tout l’écran');
  else refus('un seul bouton de repli dans tout l’écran', `${combienDeBoutons} trouvé(s)`);
  if (!combienDeBoutons) return;

  const bascule = boutons.first();
  const place = await page.evaluate(() => {
    const bouton = document.querySelector('[data-replier-colonne]');
    if (!bouton) return null;
    const tete = bouton.closest('aside[data-zone="gauche"] [data-titre-projets]');
    const point = bouton.querySelector('[data-point-etat]');
    const bb = bouton.getBoundingClientRect();
    const tb = tete?.getBoundingClientRect();
    const pb = point?.getBoundingClientRect();
    /* Les voyants VISIBLES du cadre de l'application : la colonne et les barres
       d'en-tête. Le bouton « Projets » du téléphone reste dans le document sur
       grand écran, simplement masqué. */
    const voyants = [
      ...document.querySelectorAll('aside[data-zone="gauche"] [data-point-etat], [data-entete-de-zone] [data-point-etat]'),
    ].filter((el) => el.getClientRects().length > 0);
    return {
      dansLaTete: !!tete,
      x: Math.round(bb.x),
      y: Math.round(bb.y),
      /* Tout en haut de l'écran, dans la boîte de la tête, au bout de sa rangée. */
      enHaut: !!tb && tb.top <= 1 && bb.top >= tb.top && bb.bottom <= tb.bottom + 0.5,
      auBout: !!tb && tb.right - bb.right >= 0 && tb.right - bb.right <= 16,
      pointDedans:
        !!pb &&
        pb.x >= bb.x &&
        pb.y >= bb.y &&
        pb.x + pb.width <= bb.x + bb.width + 0.5 &&
        pb.y + pb.height <= bb.y + bb.height + 0.5 &&
        pb.x > bb.x + bb.width / 2 &&
        pb.y < bb.y + bb.height / 2,
      pointsSeuls: voyants.length,
      /* …et ce voyant unique est celui de la liaison, au pied de la colonne. */
      auPied: voyants.length === 1 && !!voyants[0].closest('[data-pied-colonne] [data-essai="badge-quota"]'),
    };
  });
  if (place?.dansLaTete && place.enHaut && place.auBout) ok('le bouton de repli est tout en haut, dans la tête de la colonne de gauche');
  else refus('le bouton de repli est en haut, dans la tête de la colonne de gauche', JSON.stringify(place));
  /* DÉJÀ EN PANNE AVANT LA REFONTE (le point était posé « à cheval » sur le coin,
     donc jamais « dedans ») ; depuis, le bouton de repli ne porte plus de voyant
     du tout — il vit au pied de la colonne. Laissé tel quel : à trancher à part. */
  if (place?.pointDedans) ok('le voyant d’état se pose dans le coin haut droit du bouton');
  else refus('le voyant d’état est dans le coin du bouton', JSON.stringify(place));
  if (place?.pointsSeuls === 1 && place.auPied) ok('le voyant d’état ne s’affiche plus une seconde fois, seul');
  else refus('le voyant d’état n’existe qu’une fois', `${place?.pointsSeuls} voyant(s) visible(s) dans la colonne et les barres d’en-tête — ${JSON.stringify(place)}`);

  /*
   * ON PART D'UN ÉTAT CONNU. Le choix vit en base et SURVIT d'une exécution à
   * l'autre : partir de « je suppose que c'est déplié » faisait lire l'inverse
   * de tout ce qui suit dès qu'un contrôle précédent s'était arrêté en route.
   */
  if ((await page.getAttribute('[data-colonne-projets]', 'data-colonne-projets')) !== 'depliee') {
    await bascule.click();
    await page.waitForTimeout(400);
  }

  /* La largeur de la zone de droite AVANT toute manipulation : c'est elle qui
     ne doit pas bouger quand le panneau se déplie par-dessus. */
  const zone = page.locator('main[data-zone="centre"]').first();
  /* COMBIEN DE PROJETS, MENU LARGE : c'est le nombre qu'on retrouvera rétréci. */
  const projetsDeplies = await page.locator('aside[data-zone="gauche"] [data-drag-kind="project"]:visible').count();

  await bascule.click();
  await page.waitForTimeout(400);

  const etatReduit = await page.getAttribute('[data-colonne-projets]', 'data-colonne-projets');
  if (etatReduit === 'reduite') ok('un clic rétrécit la colonne');
  else refus('un clic rétrécit la colonne', `état lu : ${etatReduit}`);

  /*
   * LA STRUCTURE NE CHANGE PAS. Rétrécir remplaçait tout par une pile d'icônes
   * de services, et les PROJETS disparaissaient — soit exactement ce qu'on
   * vient chercher dans cette colonne.
   */
  const pile = await page.locator('[data-bande-icones], [data-destination-bande]').count();
  if (pile === 0) ok('plus aucune pile de destinations ne remplace les projets');
  else refus('aucune pile de destinations ne remplace les projets', `${pile} reste(s) de l’ancienne bande`);

  const projetsReduits = await page.locator('aside[data-zone="gauche"] [data-drag-kind="project"]:visible').count();
  if (projetsReduits === projetsDeplies && projetsDeplies > 0) {
    ok(`les ${projetsReduits} projets sont TOUS encore là une fois rétréci`);
  } else {
    refus('tous les projets restent dans le menu rétréci', `${projetsDeplies} dépliés → ${projetsReduits} rétrécis`);
  }

  /* LES SERVICES RESTENT DERRIÈRE LE BOUTON DE NAVIGATION, comme en large. */
  const navigation = await page.locator('[data-entete-de-zone] [data-navigation-compacte]').count();
  if (navigation === 1) ok('les services restent derrière le bouton de navigation');
  else refus('les services restent derrière le bouton de navigation', `${navigation} bouton(s)`);

  /* LA COLONNE EST VRAIMENT ÉTROITE : la structure tient, la place est rendue. */
  const largeur = Math.round((await page.locator('aside[data-zone="gauche"]').first().boundingBox())?.width ?? 0);
  if (largeur > 0 && largeur <= 80) ok(`la colonne rétrécie ne prend plus que ${largeur} px`);
  else refus('la colonne rétrécie rend sa place', `${largeur} px`);

  const avant = await zone.boundingBox();

  /* LE SURVOL DÉPLIE, PAR-DESSUS. On survole la bande, puis on compare. */
  await page.locator('[data-colonne-projets]').first().hover();
  await page.waitForTimeout(400);
  const etatSurvol = await page.getAttribute('[data-colonne-projets]', 'data-colonne-projets');
  if (etatSurvol === 'survolee') ok('le survol rouvre le menu entier');
  else refus('le survol rouvre le menu entier', `état lu : ${etatSurvol}`);

  const pendant = await zone.boundingBox();
  if (avant && pendant && Math.round(avant.x) === Math.round(pendant.x) && Math.round(avant.width) === Math.round(pendant.width)) {
    ok('le contenu de droite ne bouge pas d’un pixel : le menu se pose PAR-DESSUS');
  } else {
    refus(
      'le contenu de droite ne bouge pas quand le menu s’ouvre',
      `avant ${avant?.x}/${avant?.width} — pendant ${pendant?.x}/${pendant?.width}`,
    );
  }

  /* LA SORTIE DU CURSEUR REFERME. On s'éloigne franchement, à droite. */
  await page.mouse.move(1200, 500);
  await page.waitForTimeout(600);
  const etatSorti = await page.getAttribute('[data-colonne-projets]', 'data-colonne-projets');
  if (etatSorti === 'reduite') ok('la sortie du curseur referme le menu');
  else refus('la sortie du curseur referme le menu', `état lu : ${etatSorti}`);

  /* LE CHOIX SURVIT AU RECHARGEMENT : il vit en base, pas dans la page. */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await attendreLApplication(page);
  await refermerCeQuiTraine(page);
  const etatApres = await page.getAttribute('[data-colonne-projets]', 'data-colonne-projets');
  if (etatApres === 'reduite') ok('le choix « rétrécie » survit à un rechargement de la page');
  else refus('le choix « rétrécie » survit à un rechargement', `état lu : ${etatApres}`);

  /* On rend l'écran comme on l'a trouvé : dépliée. */
  await page.locator('[data-replier-colonne]').first().click();
  await page.waitForTimeout(400);
  const remise = await page.getAttribute('[data-colonne-projets]', 'data-colonne-projets');
  if (remise === 'depliee') ok('un second clic la déplie pour de bon');
  else refus('un second clic la déplie pour de bon', `état lu : ${remise}`);
}

/* ------------------------------------------------------------------ */
/* 5 à 8. L'accueil de la messagerie                                   */
/* ------------------------------------------------------------------ */

async function laMessagerie(page) {
  /*
   * LA DESTINATION VIT DERRIÈRE LE BOUTON DES SERVICES, tout à gauche du fil
   * d'Ariane, et sa grille s'ouvre AU CLIC, plus au survol (refonte du
   * 11/10/2026). Le contenu d'un menu est démonté tant qu'il est fermé : la
   * tuile « Messagerie » n'existe qu'une fois la grille ouverte. `allerVers`
   * ouvre la grille, attend qu'elle soit réellement OUVERTE (un état, pas une
   * durée), puis clique la tuile.
   */
  try {
    await allerVers(page, 'espace-client');
  } catch (err) {
    refus('la Messagerie est atteignable depuis le bouton des services', String(err.message ?? err).split('\n')[0]);
    return;
  }

  /* L'écran est chargé à la demande : on attend son repère, pas une durée. */
  const accueil = page.locator('[data-accueil-messagerie]').first();
  try {
    await accueil.waitFor({ state: 'attached', timeout: 20_000 });
    ok('ouvrir la Messagerie tombe sur la vue d’ensemble, pas sur une conversation');
  } catch {
    refus('ouvrir la Messagerie tombe sur la vue d’ensemble', 'aucun [data-accueil-messagerie] après 20 s');
    return;
  }

  /* LE GRAPHIQUE JOURNALIER, ET SON NOMBRE DE COLONNES. Une colonne par jour de
     la période, les jours vides compris : c'est ce qui fait lire la régularité. */
  const graphique = page.locator('[data-graphique-journalier]').first();
  const colonnes = Number((await graphique.getAttribute('data-graphique-journalier')) ?? 0);
  const periodeJours = Number((await accueil.getAttribute('data-periode-jours')) ?? 0);
  if (colonnes > 0 && colonnes === periodeJours) {
    ok(`le graphique pose une colonne par jour (${colonnes} sur ${periodeJours})`);
  } else {
    refus('le graphique pose une colonne par jour', `${colonnes} colonne(s) pour ${periodeJours} jour(s)`);
  }

  const chiffres = await page.locator('[data-chiffre-cle]').count();
  if (chiffres === 6) ok('les six chiffres clés sont là : quatre colonnes, les messages, les tâches');
  else refus('les six chiffres clés sont là', `${chiffres} trouvé(s)`);

  /* AUCUN LIBELLÉ COUPÉ : le défaut d'origine tenait à quatre tuiles serrées sur
     un seul rang, qui finissaient en « Clien… ». */
  const coupes = await page.locator('[data-chiffre-cle]').evaluateAll((tuiles) =>
    tuiles
      .flatMap((tuile) => [...tuile.querySelectorAll('span')])
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent?.trim() ?? ''),
  );
  if (!coupes.length) ok('aucun libellé de chiffre clé n’est tronqué');
  else refus('aucun libellé de chiffre clé n’est tronqué', coupes.join(' · '));

  /* CHANGER DE PÉRIODE REDESSINE. On prend une échelle différente de celle
     affichée, et on vérifie que le graphique la suit. */
  const autre = periodeJours === 7 ? 30 : 7;
  const bouton = page.locator(`[data-echelle-periode="${autre}"]`).first();
  if (await bouton.count()) {
    await bouton.click();
    try {
      await page.waitForFunction(
        (attendu) => document.querySelector('[data-accueil-messagerie]')?.getAttribute('data-periode-jours') === String(attendu),
        autre,
        { timeout: 15_000 },
      );
      const apres = Number((await page.locator('[data-graphique-journalier]').first().getAttribute('data-graphique-journalier')) ?? 0);
      if (apres === autre) ok(`changer de période redessine le graphique (${autre} jours)`);
      else refus('changer de période redessine le graphique', `${apres} colonne(s) pour ${autre} jours`);
    } catch {
      refus('changer de période redessine le graphique', `la période n’est pas passée à ${autre} jours`);
    }
  } else {
    refus('le sélecteur de période propose ses échelles', `aucun bouton « ${autre} jours »`);
  }

  /* SUR ORDINATEUR LES CLIENTS VIVENT DANS LA COLONNE DE GAUCHE (12/10/2026) :
     une ligne par client, son projet dessous, ses pastilles au bout. La page ne
     garde plus que l'activité. */
  const fiches = page.locator('[data-colonne-client]');
  const combien = await fiches.count();
  const blocDansLaPage = await page.locator('[data-accueil-messagerie] [data-fiches-clients]').count();
  if (!blocDansLaPage) ok('sur ordinateur, la page ne redit plus les clients de la colonne');
  else refus('sur ordinateur, la page ne redit plus les clients', 'le bloc des fiches est encore dans la page');

  /*
   * L'ÉCRAN NE PEUT PAS ÊTRE VIDE QUAND DES CLIENTS EXISTENT. On compare à la
   * base SERVIE, pas à une valeur écrite ici : c'est exactement le défaut qu'on
   * ne veut plus jamais laisser passer.
   */
  const attendus = await clientsEnBase();
  if (attendus === null) {
    refus('la base servie est lisible', 'impossible de compter les comptes clients');
  } else if (combien === attendus) {
    ok(`la colonne montre autant de clients que la base en a (${attendus})`);
  } else {
    refus(
      'l’accueil montre autant de fiches que la base a de clients',
      `${attendus} client(s) en base, ${combien} fiche(s) à l’écran — l’accueil est tombé`,
    );
  }

  if (!combien) {
    /*
     * AUCUNE FICHE : deux causes, et il faut les distinguer.
     *
     * Soit la machine n'a aucun compte client — l'accueil est alors vide à bon
     * droit. Soit le DÉMON qui répond derrière le serveur de développement ne
     * connaît pas encore `espace.tableauDeBord` : l'interface est neuve, le
     * démon est celui de la dernière mise en ligne, et la commande est refusée.
     * Dans les deux cas le contrôle n'est pas JOUÉ : on le refuse, en disant
     * quoi regarder, plutôt que de le compter comme réussi.
     */
    refus(
      'un clic sur une fiche entre chez le client',
      'aucune fiche rendue — soit aucun compte client, soit le démon en service ne sert pas encore « espace.tableauDeBord » (mise en ligne à faire)',
    );
    return;
  }
  ok(`la vue d’ensemble montre ses ${combien} fiche(s) client`);

  /* CHAQUE FICHE NOMME SON PROJET, sous le nom du client : deux clients aux
     noms proches ne se distinguent que par là. */
  const projetsNommes = await page.locator('[data-colonne-client] [data-rubrique-detail]').count();
  if (projetsNommes === combien) ok('chaque client de la colonne porte le nom de son projet sous le sien');
  else refus('chaque client de la colonne porte le nom de son projet', `${projetsNommes} sur ${combien}`);

  /*
   * LA FICHE ENTIÈRE EST LA PORTE DE CHEZ LE CLIENT : plus aucun bouton en
   * pied de fiche, un clic n'importe où sur elle ouvre le tableau des demandes
   * de CE client — SANS le volet de discussion par-dessus, qui reste à un
   * toucher, sur sa bulle.
   */
  const vise = await fiches.first().getAttribute('data-colonne-client');
  const fiche = page.locator(`[data-colonne-client="${vise}"]`).first();
  if ((await fiche.evaluate((el) => el.tagName)) === 'BUTTON') ok('la ligne du client est un vrai bouton, joignable au clavier');
  else refus('la ligne du client se joint au clavier', 'ce n’est pas un bouton');

  /* Le volet s'ouvre en glissant : on laisse passer son animation avant de juger. */
  const discussionOuverte = async () => {
    await page.waitForTimeout(700);
    return (await page.locator('[data-volet-discussion]:visible').count()) > 0;
  };

  // On clique sur le projet, sous le nom : toute la ligne compte.
  await fiche.locator('[data-rubrique-detail]').click();
  try {
    await page.locator(`[data-choix-client="${vise}"]`).first().waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    refus('un clic sur la fiche entre chez CE client', 'client non ouvert');
    return;
  }
  if (!(await discussionOuverte())) ok('un clic sur la fiche ouvre le tableau de CE client, sans la discussion par-dessus');
  else refus('un clic sur la fiche laisse la discussion fermée', 'le volet de discussion s’est ouvert tout seul');

  /* La discussion reste à un toucher : sa bulle l'ouvre, sa croix la referme. */
  const bulle = page.locator('[data-onglet-discussion]').first();
  if (await bulle.count()) {
    await bulle.click();
    try {
      await page.locator('[data-volet-discussion]').first().waitFor({ state: 'visible', timeout: 10_000 });
      ok('la bulle « Discussion » ouvre la conversation du client');
    } catch {
      refus('la bulle « Discussion » ouvre la conversation', 'le volet ne s’est pas ouvert');
    }
  } else {
    refus('la discussion se rejoint par sa bulle', 'aucun [data-onglet-discussion]');
  }
  const croix = page.locator('[data-fermer-discussion]').first();
  if (await croix.count()) {
    await croix.click();
    await page.locator('[data-volet-discussion]').first().waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
    if (!(await page.locator('[data-volet-discussion]:visible').count())) {
      ok('la croix referme la conversation et laisse le tableau de ses demandes');
    } else refus('la croix referme la conversation', 'le volet reste ouvert');
  } else {
    refus('la conversation porte sa croix de fermeture', 'aucun [data-fermer-discussion]');
  }

  /* Au clavier aussi : retour à l'accueil, Tab jusqu'à la fiche, Entrée. */
  const retourClavier = page.locator('[data-fil-d-ariane] [data-titre-bandeau][data-chemin-de-zone]').first();
  if (await retourClavier.count()) {
    await retourClavier.click();
    await page.locator('[data-accueil-messagerie]').first().waitFor({ state: 'attached', timeout: 15_000 });
    const ficheRevenue = page.locator(`[data-colonne-client="${vise}"]`).first();
    await ficheRevenue.waitFor({ state: 'visible', timeout: 15_000 });
    // Les chiffres de l'accueil se rechargent au retour et la fiche est
    // redessinée : on vise donc celle qui porte réellement le focus.
    await page.waitForTimeout(800);
    await ficheRevenue.focus();
    await page.keyboard.press('Enter');
    try {
      await page.locator(`[data-choix-client="${vise}"]`).first().waitFor({ state: 'visible', timeout: 15_000 });
      if (!(await discussionOuverte())) ok('Entrée sur la fiche entre aussi chez le client, discussion fermée');
      else refus('Entrée sur la fiche laisse la discussion fermée', 'le volet de discussion s’est ouvert tout seul');
    } catch {
      refus('Entrée sur la fiche entre chez le client', 'client non ouvert');
    }
  }

  const retour = page.locator('[data-fil-d-ariane] [data-titre-bandeau][data-chemin-de-zone]').first();
  if (!(await retour.count())) {
    refus('la flèche de retour est posée près du nom du projet', 'aucun [data-fil-d-ariane] [data-titre-bandeau][data-chemin-de-zone]');
    return;
  }
  await retour.click();
  try {
    await page.locator('[data-accueil-messagerie]').first().waitFor({ state: 'attached', timeout: 15_000 });
    ok('la flèche de retour ramène à la vue d’ensemble');
  } catch {
    refus('la flèche de retour ramène à la vue d’ensemble', 'l’accueil n’est pas revenu');
  }
}


/* ------------------------------------------------------------------ */

async function main() {
  if (!(await attendrePort())) {
    refus('le démon d’essai démarre', journal.join('').slice(-400));
    return;
  }
  poserDecor();
  const { chromium } = await import('playwright');
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: JETON, url: ADRESSE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  try {
    await page.goto(ADRESSE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (err) {
    await navigateur.close();
    refus('le démon d’essai sert l’application', `${ADRESSE} — ${err.message.split('\n')[0]}`);
    return;
  }
  if (!(await attendreLApplication(page))) {
    await navigateur.close();
    refus('l’application s’affiche', `aucune colonne de projets — ${erreurs.slice(0, 2).join(' · ')}`);
    return;
  }
  await refermerCeQuiTraine(page);
  try {
    await laColonne(page);
    await laMessagerie(page);
    /* AUCUNE ERREUR DE PAGE : un écran qui « marche » en avalant une exception
       n'a pas marché. */
    if (!erreurs.length) ok('aucune erreur de page pendant tout le parcours');
    else refus('aucune erreur de page pendant le parcours', erreurs.slice(0, 3).join(' · '));
  } finally {
    await navigateur.close();
  }
}

await main();

const refuses = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - refuses}/${results.length} contrôles passés.`);
process.exit(refuses ? 1 : 0);

export { RACINE };
