#!/usr/bin/env node
/**
 * SANS GESTE DE L'UTILISATEUR, L'APPARENCE NE BOUGE PAS.
 *
 * L'incident d'origine : « à quel moment l'interface change de thème toute
 * seule ? ». Quatre chemins pouvaient la faire basculer sur un onglet immobile
 * — le réglage clair / sombre de l'ordinateur, une reconnexion du canal, une
 * réponse de serveur repartie sans le réglage, un changement de projet actif.
 * Ce contrôle les REJOUE un par un et exige que rien ne change.
 *
 * Il juge sur l'ÉTAT (`data-theme`, la classe `dark`) et sur le JOURNAL des
 * bascules (`window.belugaTheme`), jamais sur des pixels : une apparence qui
 * part et revient au même thème ne se voit pas sur une capture, alors qu'elle
 * se lit dans le journal.
 *
 * L'APPARENCE EST NOIR ET BLANC : DEUX PALETTES, « clair » et « sombre »
 * (refonte du 11/10/2026 — les six ambiances ont disparu, `shared/src/themes.ts`).
 *
 * Trois séries :
 *  1. RÉGLAGE MANUEL « sombre » — les quatre déclencheurs, et le thème ne
 *     bouge JAMAIS ;
 *  2. RÉGLAGE MANUEL « clair », sur un ordinateur sombre — les mêmes : le choix
 *     tient contre le défaut ET contre l'ordinateur ;
 *  3. AUTOMATIQUE ALLUMÉ — les mêmes, et SEUL le réglage de l'ordinateur agit,
 *     en passant d'une des deux palettes à l'autre.
 *
 * Une lecture de texte les précède : la devinette de premier affichage
 * (`web/index.html`) recopie DEUX tables du catalogue, faute de pouvoir les
 * importer — les palettes (`PALETTES` : clarté et fond de page) et les noms
 * d'avant la refonte (`ANCIENS`, copie de `ANCIENS_THEMES` : un navigateur qui
 * garde « sable » en repère doit s'ouvrir en clair d'emblée). Une copie qui
 * dérive produit exactement le symptôme visé — une page immobile qui change de
 * couleur au bout d'une seconde.
 *
 *   HAIKO_THEME_URL=http://localhost:7099 node scripts/verif-theme-sans-geste.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

/* La racine se déduit du script : lancé d'une copie de travail, il juge CE
   code-là, jamais le dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADRESSE = process.env.HAIKO_THEME_URL || process.env.HAIKO_THEMES_URL || 'http://localhost:7099';
/* Les deux palettes de l'application, et rien d'autre. */
const PALETTES_ATTENDUES = ['clair', 'sombre'];

const echecs = [];
const constats = [];
const refuser = (message) => echecs.push(message);
const constater = (message) => constats.push(message);

/* ------------------------------------------------------------------ */
/* 1. LA DEVINETTE DE PREMIER AFFICHAGE DIT LA MÊME CHOSE QUE LE       */
/*    CATALOGUE                                                        */
/* ------------------------------------------------------------------ */

const catalogue = fs.readFileSync(path.join(RACINE, 'shared/src/themes.ts'), 'utf8');
const html = fs.readFileSync(path.join(RACINE, 'web/index.html'), 'utf8');

/**
 * Le catalogue : id → { clarte, fond }.
 *
 * On DÉCOUPE la liste `THEMES` en blocs plutôt que d'écrire une expression qui
 * décrirait un bloc entier : une accolade lue de travers rendrait « une seule
 * palette » au lieu de deux, et le contrôle passerait à côté de la copie qu'il
 * est censé surveiller.
 */
function palettesDuCatalogue() {
  const debut = catalogue.indexOf('export const THEMES');
  const fin = catalogue.indexOf('\n];', debut);
  if (debut < 0 || fin < 0) return {};
  const palettes = {};
  for (const bloc of catalogue.slice(debut, fin).split(/\n {2}\{\n/).slice(1)) {
    const id = /^\s*id:\s*'([a-z-]+)'/.exec(bloc)?.[1];
    const clarte = /clarte:\s*'(clair|sombre)'/.exec(bloc)?.[1];
    const fond = /apercu:\s*\[\s*'([^']+)'/.exec(bloc)?.[1];
    if (id && clarte && fond) palettes[id] = { clarte, fond };
  }
  return palettes;
}

/** La copie d'`index.html` : id → { clarte, fond }. */
function palettesDeLaDevinette() {
  const debut = html.indexOf('var PALETTES = {');
  if (debut < 0) return null;
  const fin = html.indexOf('};', debut);
  if (fin < 0) return null;
  const palettes = {};
  for (const ligne of html.slice(debut, fin).matchAll(/'?([a-z-]+)'?:\s*\['(clair|sombre)',\s*'([^']+)'\]/g)) {
    palettes[ligne[1]] = { clarte: ligne[2], fond: ligne[3] };
  }
  return palettes;
}

/**
 * Une table « nom d'avant → palette d'aujourd'hui », lue entre l'accolade qui
 * suit `debut` et sa fermeture : `ANCIENS_THEMES` du catalogue, `ANCIENS` de la
 * devinette. Rend `null` si la table est introuvable.
 */
function tableDesAnciensNoms(texte, debut) {
  const depuis = texte.indexOf(debut);
  if (depuis < 0) return null;
  const ouverture = texte.indexOf('{', depuis + debut.length - 1);
  const fermeture = texte.indexOf('}', ouverture);
  if (ouverture < 0 || fermeture < 0) return null;
  const table = {};
  for (const ligne of texte.slice(ouverture, fermeture).matchAll(/'?([a-z-]+)'?:\s*'(clair|sombre)'/g)) {
    table[ligne[1]] = ligne[2];
  }
  return table;
}

const duCatalogue = palettesDuCatalogue();
const deLaDevinette = palettesDeLaDevinette();

if (!deLaDevinette) {
  refuser("web/index.html : la table des palettes du premier affichage est introuvable");
} else if (Object.keys(duCatalogue).sort().join(', ') !== PALETTES_ATTENDUES.join(', ')) {
  refuser(
    `shared/src/themes.ts : palettes lues « ${Object.keys(duCatalogue).sort().join(', ')} » au lieu de ` +
      `« ${PALETTES_ATTENDUES.join(', ')} » — la lecture du catalogue est à revoir, ou une palette est revenue`,
  );
} else {
  for (const [id, attendu] of Object.entries(duCatalogue)) {
    const copie = deLaDevinette[id];
    if (!copie) {
      refuser(`web/index.html : la palette « ${id} » manque à la devinette de premier affichage`);
      continue;
    }
    if (copie.clarte !== attendu.clarte) {
      refuser(`web/index.html : « ${id} » est ${copie.clarte} pour la devinette et ${attendu.clarte} pour le catalogue`);
    }
    if (copie.fond !== attendu.fond) {
      refuser(`web/index.html : le fond de « ${id} » vaut ${copie.fond} pour la devinette et ${attendu.fond} pour le catalogue`);
    }
  }
  const enTrop = Object.keys(deLaDevinette).filter((id) => !(id in duCatalogue));
  if (enTrop.length) refuser(`web/index.html : palettes que le catalogue ne connaît pas — ${enTrop.join(', ')}`);
  if (!echecs.length) constater('les 2 palettes de la devinette de premier affichage collent au catalogue');
}

/* LES NOMS D'AVANT LA REFONTE : la devinette les relit comme le catalogue, nom
   pour nom — les dix palettes colorées retirées et les deux tout premiers noms.
   C'est ce que la table des douze palettes garantissait avant la refonte : la
   clarté de « sable » ou de « sapin » est la même des deux côtés. */
const anciensDuCatalogue = tableDesAnciensNoms(catalogue, 'export const ANCIENS_THEMES');
const anciensDeLaDevinette = tableDesAnciensNoms(html, 'var ANCIENS = {');
if (!anciensDuCatalogue || Object.keys(anciensDuCatalogue).length < 12) {
  refuser(
    `shared/src/themes.ts : ${Object.keys(anciensDuCatalogue ?? {}).length} ancien(s) nom(s) lu(s) dans ANCIENS_THEMES ` +
      'au lieu de 12 au moins — la lecture du catalogue est à revoir',
  );
} else if (!anciensDeLaDevinette) {
  refuser("web/index.html : la table des anciens noms du premier affichage (ANCIENS) est introuvable");
} else {
  const avant = echecs.length;
  for (const [nom, attendu] of Object.entries(anciensDuCatalogue)) {
    const copie = anciensDeLaDevinette[nom];
    if (!copie) refuser(`web/index.html : l'ancien nom « ${nom} » manque à la devinette de premier affichage`);
    else if (copie !== attendu) {
      refuser(`web/index.html : l'ancien nom « ${nom} » se lit ${copie} pour la devinette et ${attendu} pour le catalogue`);
    }
  }
  const enTrop = Object.keys(anciensDeLaDevinette).filter((nom) => !(nom in anciensDuCatalogue));
  if (enTrop.length) refuser(`web/index.html : anciens noms que le catalogue ne connaît pas — ${enTrop.join(', ')}`);
  if (echecs.length === avant) {
    constater(
      `les ${Object.keys(anciensDuCatalogue).length} noms d'avant la refonte se relisent comme dans le catalogue`,
    );
  }
}

/* Le service worker ne doit RIEN savoir du thème : il recopie déjà les icônes
   d'alerte, une table de palettes de plus y dériverait sans que personne ne le
   voie. */
const sw = fs.readFileSync(path.join(RACINE, 'web/public/sw.js'), 'utf8');
if (/data-theme|beluga-theme-flash|'sable-sombre'|PALETTES|ANCIENS/.test(sw)) {
  refuser("web/public/sw.js : le service worker touche au thème — il n'a rien à y faire");
} else {
  constater('le service worker ne recopie aucune palette : une copie de moins à tenir');
}

/* ------------------------------------------------------------------ */
/* 2. LE NAVIGATEUR : les quatre déclencheurs, rejoués                 */
/* ------------------------------------------------------------------ */

/**
 * Une session d'UNE HEURE, fabriquée puis retirée : la colonne `token` garde le
 * SHA-256 du cookie, jamais le cookie. C'est la seule écriture en base de tout
 * ce contrôle, et elle est défaite en partant. Le réglage d'apparence du compte,
 * lui, n'est JAMAIS touché : tout se joue dans le magasin de la page.
 */
async function avecSession(travail) {
  const { default: crypto } = await import('node:crypto');
  const ouvrir = () => new Database(cheminDeLaBaseServie());

  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const db = ouvrir();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3_600_000,
    "vérification de l'apparence sans geste",
  );
  db.close();
  try {
    return await travail(cookie);
  } finally {
    const fin = ouvrir();
    fin.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    fin.close();
  }
}

/**
 * UN CONTRÔLE QUI NE REND PAS LA MAIN EST UNE PANNE, PAS UN TRAVAIL LENT.
 *
 * Tout ce qui suit parle à un navigateur : un Chrome qui ne démarre pas sur une
 * machine chargée, un onglet dont le script s'arrête, et l'attente devient
 * infinie — le contrôle passe alors pour « en cours » pendant des dizaines de
 * minutes, ce qui est bien pire qu'un échec net. On borne donc la partie
 * navigateur, et le dépassement se DIT.
 */
const PLAFOND_MS = Number(process.env.HAIKO_THEME_PLAFOND_MS || 240_000);

function sousPlafond(promesse, quoi) {
  let minuteur;
  const limite = new Promise((_, rejeter) => {
    minuteur = setTimeout(
      () => rejeter(new Error(`${quoi} n'a pas rendu la main en ${Math.round(PLAFOND_MS / 1000)} s`)),
      PLAFOND_MS,
    );
  });
  return Promise.race([promesse, limite]).finally(() => clearTimeout(minuteur));
}

async function auNavigateur() {
  const { chromium } = await import('playwright');
  try {
    return await avecSession(async (session) => {
      const navigateur = await sousPlafond(chromium.launch({ channel: 'chrome' }), 'le démarrage du navigateur');
      const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
      await contexte.addCookies([{ name: 'beluga_session', value: session, domain: 'localhost', path: '/' }]);
      const page = await contexte.newPage();
      try {
        await page.goto(ADRESSE, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      } catch (err) {
        await navigateur.close();
        return [`serveur de développement injoignable sur ${ADRESSE} — ${err.message.split('\n')[0]}`];
      }
      try {
        return await sousPlafond(dansLaPage(page), 'la série des déclencheurs');
      } catch (err) {
        return [err.message];
      } finally {
        await navigateur.close();
      }
    });
  } catch (err) {
    return [`session d'essai impossible — ${err.message.split('\n')[0]}`];
  }
}

/** Ce que la page affiche VRAIMENT, sans interpréter un pixel. */
const lire = (page) =>
  page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    sombre: document.documentElement.classList.contains('dark'),
    bascules: (window.belugaTheme?.journal?.() ?? []).length,
  }));

/**
 * ATTENDRE QUE L'AFFICHAGE SE STABILISE, jamais un délai fixe : ce contrôle
 * vise parfois le démon RÉEL, avec d'autres agents actifs — deux lectures
 * identiques d'affilée valent mieux qu'une horloge.
 */
async function stabiliser(page) {
  let precedent = null;
  for (let essai = 0; essai < 20; essai += 1) {
    await page.waitForTimeout(150);
    const vu = await lire(page);
    const signature = `${vu.theme}/${vu.sombre}`;
    if (signature === precedent) return vu;
    precedent = signature;
  }
  return lire(page);
}

async function dansLaPage(page) {
  const anomalies = [];

  /*
   * ON ATTEND UN ÉTAT, JAMAIS UNE DURÉE. Le serveur de développement compile à
   * la demande : le tout premier affichage, sur une machine chargée, peut
   * demander une bonne dizaine de secondes là où le suivant en prend deux. Un
   * délai fixe rendait alors « les points d'essai sont absents » — un faux
   * échec, exactement le genre de verdict qui ferait chercher un défaut là où
   * il n'y en a pas.
   */
  const pretDepuisLaPage = () =>
    page.evaluate(
      () =>
        typeof window.belugaEssai?.reglages === 'function' &&
        typeof window.belugaEssai?.reconnexion === 'function' &&
        typeof window.belugaTheme?.journal === 'function' &&
        /* Les points existent avant la première réponse du canal : on attend
           aussi que le magasin la tienne, sinon on juge une page vide. */
        window.belugaEssai.pret() === true,
    );
  for (let essai = 0; essai < 60 && !(await pretDepuisLaPage()); essai += 1) {
    await page.waitForTimeout(1000);
  }

  /* Un tiroir laissé ouvert n'est pas un thème cassé, mais son voile avale les
     clics : on referme ce qui traîne avant de juger quoi que ce soit. */
  for (let essai = 0; essai < 6; essai += 1) {
    const ouvert = await page.evaluate(
      () => document.querySelectorAll('[role="dialog"],[role="alertdialog"]').length,
    );
    if (!ouvert && essai > 0) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }

  if (!(await pretDepuisLaPage())) {
    return [
      "au bout d'une minute, la page n'est toujours pas prête : ou bien les points d'essai de " +
        "l'apparence manquent (window.belugaEssai.reglages / .reconnexion / .pret, " +
        'window.belugaTheme.journal) — ce contrôle vise le serveur de DÉVELOPPEMENT —, ou bien le ' +
        "canal temps réel n'a jamais répondu",
    ];
  }

  const projets = await page.evaluate(() => window.belugaEssai.projets());
  if (projets.length < 2) {
    anomalies.push(`il faut deux projets pour rejouer un changement de projet actif, ${projets.length} trouvé(s)`);
  }

  /* Le réglage du compte est REMIS en partant : ce contrôle ne laisse aucune
     trace dans le magasin de la page, et n'écrit jamais en base. */
  const reglageInitial = await page.evaluate(() => window.belugaEssai.reglagesActuels());

  /**
   * UNE SÉRIE : un réglage posé, puis les quatre déclencheurs, et à chaque fois
   * la question « le thème a-t-il bougé ? ». `attendu` dit ce qui DOIT arriver
   * quand l'ordinateur bascule — rien en manuel, la palette claire en
   * automatique.
   */
  async function serie(nom, choix, attenduSysteme) {
    await page.emulateMedia({ colorScheme: 'dark' });
    /* Le bloc arrive EN ENTIER, comme le serveur l'envoie : on repose donc les
       autres réglages avec, sinon c'est le projet ouvert qu'on ferait bouger. */
    await page.evaluate(
      ({ base, valeur }) => window.belugaEssai.reglages({ ...base, theme: valeur }),
      { base: reglageInitial, valeur: choix },
    );
    const depart = await stabiliser(page);

    const juger = async (declencheur, apres, doitChanger) => {
      const bouge = apres.theme !== depart.theme || apres.sombre !== depart.sombre;
      if (doitChanger && !bouge) {
        anomalies.push(`${nom} — ${declencheur} : l'apparence aurait dû suivre, elle est restée sur « ${apres.theme} »`);
      }
      if (!doitChanger && bouge) {
        anomalies.push(
          `${nom} — ${declencheur} : l'apparence a basculé de « ${depart.theme} » vers « ${apres.theme} » sans le moindre geste`,
        );
      }
    };

    /* (a) LE RÉGLAGE CLAIR / SOMBRE DE L'ORDINATEUR bascule. */
    await page.emulateMedia({ colorScheme: 'light' });
    const apresSysteme = await stabiliser(page);
    await juger("le réglage clair / sombre de l'ordinateur bascule", apresSysteme, !!attenduSysteme);
    if (attenduSysteme && apresSysteme.theme !== attenduSysteme) {
      anomalies.push(
        `${nom} — l'ordinateur passe en clair : attendu « ${attenduSysteme} », vu « ${apresSysteme.theme} »`,
      );
    }
    await page.emulateMedia({ colorScheme: 'dark' });
    const revenu = await stabiliser(page);
    if (revenu.theme !== depart.theme) {
      anomalies.push(`${nom} — l'ordinateur revient au sombre : attendu « ${depart.theme} », vu « ${revenu.theme} »`);
    }

    /* (b) UNE RECONNEXION du canal temps réel : tout se réhydrate. */
    await page.evaluate(() => window.belugaEssai.reconnexion());
    await juger('le canal temps réel se reconnecte', await stabiliser(page), false);

    /* (c) UNE RÉPONSE DE SERVEUR REPARTIE SANS LE RÉGLAGE — le cas qui faisait
           retomber l'apparence sur son défaut sombre. */
    await page.evaluate(() => window.belugaEssai.reconnexion({ sansReglages: true }));
    await juger('le serveur répond sans le réglage d’apparence', await stabiliser(page), false);
    await page.evaluate(() => window.belugaEssai.reglages({}));
    await juger('le bloc de réglages revient vide', await stabiliser(page), false);
    await page.evaluate(
      ({ base, valeur }) => window.belugaEssai.reglages({ ...base, theme: valeur }),
      { base: reglageInitial, valeur: choix },
    );

    /* (d) LA LISTE DES PROJETS repasse vide, puis le projet actif change. */
    await page.evaluate(() => window.belugaEssai.reconnexion({ sansProjets: true }));
    await juger('la liste des projets repasse vide', await stabiliser(page), false);
    await page.evaluate(() => window.belugaEssai.reconnexion());
    if (projets.length >= 2) {
      await page.evaluate((id) => window.belugaEssai.ouvrirProjet(id), projets[1].id);
      await juger("le projet actif change alors qu'aucun projet n'impose de thème", await stabiliser(page), false);
      await page.evaluate((id) => window.belugaEssai.ouvrirProjet(id), projets[0].id);
      await stabiliser(page);
    }

    /* LE JOURNAL ne doit signaler AUCUNE bascule sans cause : c'est la trace
       qui rendrait l'incident racontable, et elle doit rester muette. */
    const orphelines = await page.evaluate(() =>
      window.belugaTheme.journal().filter((ligne) => ligne.sansCause),
    );
    if (orphelines.length) {
      anomalies.push(
        `${nom} — ${orphelines.length} bascule(s) sans cause dans le journal : ` +
          orphelines.map((ligne) => `${ligne.avant} → ${ligne.apres}`).join(', '),
      );
    }
    return depart;
  }

  /* 1. RÉGLAGE MANUEL « sombre » : rien ne doit bouger, jamais — et surtout
        pas quand l'ordinateur passe en clair. */
  const manuel = await serie('réglage manuel « sombre »', 'sombre', null);
  if (manuel.theme !== 'sombre' || !manuel.sombre) {
    anomalies.push(`le réglage manuel n'est pas appliqué : attendu « sombre », vu « ${manuel.theme} »`);
  }

  /* 2. RÉGLAGE MANUEL « clair », l'ordinateur étant SOMBRE au départ : le choix
        tient contre le défaut de l'application (sombre) et contre l'ordinateur.
        Avec deux palettes seulement, c'est cette série qui prouve qu'un réglage
        manuel est réellement APPLIQUÉ — « sombre » est aussi la valeur par
        défaut. */
  const manuelClair = await serie('réglage manuel « clair »', 'clair', null);
  if (manuelClair.theme !== 'clair' || manuelClair.sombre) {
    anomalies.push(`le réglage manuel n'est pas appliqué : attendu « clair », vu « ${manuelClair.theme} »`);
  }

  /* 3. AUTOMATIQUE ALLUMÉ : seul l'ordinateur agit, d'une palette à l'autre. */
  const auto = await serie('automatique', 'auto-origine-sombre', 'clair');
  if (auto.theme !== 'sombre') {
    anomalies.push(`en automatique sur un ordinateur sombre : attendu « sombre », vu « ${auto.theme} »`);
  }

  await page.emulateMedia({ colorScheme: null });
  if (reglageInitial) await page.evaluate((valeur) => window.belugaEssai.reglages(valeur), reglageInitial);

  if (!anomalies.length) {
    constater('réglage manuel, sombre puis clair : les quatre déclencheurs rejoués, l’apparence n’a pas bougé d’un cran');
    constater('automatique allumé : seul le réglage de l’ordinateur agit, de « sombre » à « clair » et retour');
  }
  return anomalies;
}

const auNavigateurAnomalies = await auNavigateur();
for (const anomalie of auNavigateurAnomalies) refuser(anomalie);

for (const message of constats) console.log(`  ✓ ${message}`);
if (echecs.length) {
  for (const message of echecs) console.error(`  ✗ ${message}`);
  console.error(`\n${echecs.length} anomalie(s) : l’apparence peut encore bouger sans geste.`);
  process.exit(1);
}
console.log('\nSans geste, l’apparence ne bouge pas.');
