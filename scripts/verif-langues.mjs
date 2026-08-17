#!/usr/bin/env node
/**
 * LES CINQ LANGUES, VÉRIFIÉES SUR LA SOURCE PUIS DANS UN VRAI NAVIGATEUR.
 *
 * La première moitié ne LIT que du texte — le catalogue de `shared/src/langues.ts`,
 * le dictionnaire de `shared/src/traductions.ts` et les écrans de `web/src`. Elle
 * refuse :
 *
 *  1. un catalogue qui s'écarte des cinq langues attendues, un français qui ne
 *     serait plus la langue d'ORIGINE, deux langues au même code `lang` ;
 *  2. un NOM DE LANGUE traduit — « Deutsch » doit rester « Deutsch » dans les
 *     cinq écrans, sinon un germanophone tombé sur une interface en chinois ne
 *     retrouve plus la sienne ;
 *  3. un texte de l'interface qu'une langue ne traduit pas, ou dont elle a perdu
 *     un TROU en route (« {n} agents » traduit sans son `{n}` afficherait un
 *     compte nulle part) ;
 *  4. un texte français resté ÉCRIT EN DUR dans un écran : on rejoue l'outil de
 *     bascule à blanc, et il ne doit plus rien trouver ;
 *  5. un REPÈRE TECHNIQUE passé au dictionnaire — `aria-label`, `data-…`, `key`,
 *     `className` désignent les boutons pour les scripts de contrôle et ne
 *     changent JAMAIS avec la langue ;
 *  6. un second endroit qui pose la langue sur la page.
 *
 * La seconde moitié demande au NAVIGATEUR ce qu'il affiche vraiment — trois
 * promesses qu'aucune relecture ne peut tenir : l'entrée « Langue » posée sous
 * « Thème » et au-dessus de « Réglages », qui se déplie AU SURVOL COMME AU CLIC ;
 * un changement de langue qui réécrit l'interface entière sans toucher aux
 * repères techniques ; et le choix RETENU, encore là après un rechargement.
 * Elle fabrique une session d'une heure, la retire en partant, et n'écrit rien
 * d'autre en base.
 *
 *   HAIKO_LANGUES_URL=http://localhost:7099 node scripts/verif-langues.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* La racine se déduit du script : lancé d'une copie de travail, il juge CE
   code-là, jamais le dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ECRANS = path.join(RACINE, 'web/src');
const ADRESSE = process.env.HAIKO_LANGUES_URL || 'http://localhost:7099';
/* La base et ses dépendances natives vivent dans le dépôt PRINCIPAL, même quand
   ce script est lancé d'une copie de travail. */
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';

const echecs = [];
const constats = [];
const refuser = (message) => echecs.push(message);
const constater = (message) => constats.push(message);

const partage = await import(path.join(RACINE, 'shared/dist/index.js'));
const { LANGUES, LANGUE_DORIGINE, TRADUCTIONS, langueValide, manquesDeLaLangue, traduire, COLUMN_LABELS, THEMES } =
  partage;

/* ------------------------------------------------------------------ */
/* 1. Le catalogue                                                     */
/* ------------------------------------------------------------------ */

const ATTENDUES = ['fr', 'en', 'es', 'de', 'zh'];
const ids = LANGUES.map((langue) => langue.id);
if (ids.join(',') !== ATTENDUES.join(',')) {
  refuser(`le catalogue ne porte pas les cinq langues attendues : ${ids.join(', ')}`);
}
if (LANGUE_DORIGINE !== 'fr') refuser(`la langue d'origine devrait rester le français, elle vaut « ${LANGUE_DORIGINE} »`);

const etiquettes = new Set();
for (const langue of LANGUES) {
  if (!langue.libelle.trim()) refuser(`la langue « ${langue.id} » n'a pas de nom`);
  if (etiquettes.has(langue.etiquette)) refuser(`deux langues partagent le code « ${langue.etiquette} »`);
  etiquettes.add(langue.etiquette);
  if (!langue.formatRegional.includes('-')) {
    refuser(`la langue « ${langue.id} » n'a pas de format régional complet (${langue.formatRegional})`);
  }
}

/* Une valeur inconnue, un code régional, un vide : tout retombe sur le français
   — jamais sur un blanc, jamais sur une langue choisie au hasard. */
for (const [valeur, attendu] of [
  ['en-US', 'en'],
  ['zh-CN', 'zh'],
  ['klingon', 'fr'],
  ['', 'fr'],
  [null, 'fr'],
]) {
  const rendu = langueValide(valeur);
  if (rendu !== attendu) refuser(`langueValide(${JSON.stringify(valeur)}) rend « ${rendu} », attendu « ${attendu} »`);
}
constater(`le catalogue porte les cinq langues, le français en langue d'origine, et toute valeur inconnue y retombe`);

/* Un NOM DE LANGUE ne se traduit pas : il s'écrit dans sa propre langue. */
for (const langue of LANGUES) {
  for (const cible of ATTENDUES) {
    const rendu = traduire(TRADUCTIONS, cible, langue.libelle);
    if (rendu !== langue.libelle) {
      refuser(`le nom « ${langue.libelle} » est traduit en « ${rendu} » pour la langue « ${cible} » — il doit rester tel quel`);
    }
  }
}
constater(`les noms des langues (${LANGUES.map((l) => l.libelle).join(', ')}) ne passent jamais par le dictionnaire`);

/* ------------------------------------------------------------------ */
/* 2. Le dictionnaire couvre TOUT ce que l'interface écrit             */
/* ------------------------------------------------------------------ */

/** Les textes que l'interface donne à `t(…)`, lus dans le VRAI arbre du code. */
function textesDeLInterface() {
  const sortie = execFileSync(
    process.execPath,
    [path.join(RACINE, 'scripts/passer-les-textes-en-traduction.mjs'), '--appels'],
    { cwd: RACINE, encoding: 'utf8' },
  );
  return JSON.parse(sortie);
}

let textes = [];
try {
  textes = textesDeLInterface();
} catch (err) {
  refuser(`les textes de l'interface n'ont pas pu être relevés — ${err.message.split('\n')[0]}`);
}

/* Les libellés venus des catalogues PARTAGÉS sont affichés tels quels par
   l'interface (les colonnes du tableau, les thèmes) : ils doivent être traduits
   au même titre, alors qu'aucun `t('…')` littéral ne les nomme. */
const catalogues = [
  ...Object.values(COLUMN_LABELS),
  ...THEMES.map((theme) => theme.libelle),
  ...THEMES.map((theme) => theme.description),
];
const aTraduire = [...new Set([...textes, ...catalogues])];

if (aTraduire.length < 300) {
  refuser(`seulement ${aTraduire.length} textes relevés dans l'interface : le relevé a dû échouer`);
}

for (const langue of LANGUES) {
  if (langue.id === LANGUE_DORIGINE) continue;
  const manque = manquesDeLaLangue(aTraduire, langue.id, TRADUCTIONS[langue.id]);
  if (manque.absents.length) {
    const apercu = manque.absents.slice(0, 5).map((texte) => `« ${texte.slice(0, 60)} »`).join(', ');
    refuser(`${langue.libelle} : ${manque.absents.length} texte(s) sans traduction — ${apercu}`);
  }
  if (manque.trousPerdus.length) {
    const apercu = manque.trousPerdus.slice(0, 3).map((texte) => `« ${texte.slice(0, 60)} »`).join(', ');
    refuser(`${langue.libelle} : ${manque.trousPerdus.length} traduction(s) ont perdu un trou — ${apercu}`);
  }
}
constater(`les ${aTraduire.length} textes de l'interface sont traduits dans les quatre langues, trous compris`);

/* ------------------------------------------------------------------ */
/* 3. Plus un texte français écrit en dur dans un écran                */
/* ------------------------------------------------------------------ */

try {
  const sortie = execFileSync(
    process.execPath,
    [path.join(RACINE, 'scripts/passer-les-textes-en-traduction.mjs'), '--essai'],
    { cwd: RACINE, encoding: 'utf8' },
  );
  const compte = Number(/^(\d+) textes/.exec(sortie)?.[1] ?? -1);
  if (compte < 0) refuser(`l'outil de bascule n'a pas rendu de compte lisible`);
  else if (compte > 0) {
    const coupees = sortie.split('à reprendre à la main :')[1] ?? '';
    refuser(`${compte} texte(s) restent écrits en dur dans les écrans :\n${coupees.trim() || sortie.trim()}`);
  } else {
    constater(`aucun texte français ne reste écrit en dur dans les écrans`);
  }
} catch (err) {
  refuser(`l'outil de bascule n'a pas pu être rejoué — ${err.message.split('\n')[0]}`);
}

/*
 * LE FILET, LÀ OÙ LA BASCULE NE VA PAS. Elle ne réécrit que trois endroits sûrs.
 * Mais un libellé peut se poser AILLEURS : rangé dans une variable au bout d'un
 * `? :` puis affiché plus bas, mis dans une table d'options, rendu par une
 * petite fonction. On relève donc TOUT littéral qui ressemble à du français et
 * qui n'est pas déjà passé au dictionnaire — les repères techniques et les
 * textes ENVOYÉS AUX AGENTS étant écartés à la source.
 */
try {
  const sortie = execFileSync(
    process.execPath,
    [path.join(RACINE, 'scripts/passer-les-textes-en-traduction.mjs'), '--reste'],
    { cwd: RACINE, encoding: 'utf8' },
  );
  const compte = Number(/(\d+) texte\(s\) français hors dictionnaire/.exec(sortie)?.[1] ?? -1);
  if (compte < 0) refuser(`la chasse au français resté en dur n'a pas rendu de compte lisible`);
  else if (compte > 0) {
    const lignes = sortie.split('\n').filter((ligne) => /:\d+ {2}/.test(ligne)).slice(0, 12);
    refuser(`${compte} texte(s) français vivent hors du dictionnaire :\n    ${lignes.join('\n    ')}`);
  } else {
    constater(`aucun texte français ne vit hors du dictionnaire, même rangé dans une variable`);
  }
} catch (err) {
  refuser(`la chasse au français resté en dur n'a pas pu tourner — ${err.message.split('\n')[0]}`);
}

/* ------------------------------------------------------------------ */
/* 4. Les repères techniques ne changent JAMAIS de langue              */
/* ------------------------------------------------------------------ */

function fichiers(dossier) {
  const trouves = [];
  for (const entree of fs.readdirSync(dossier)) {
    const chemin = path.join(dossier, entree);
    if (fs.statSync(chemin).isDirectory()) trouves.push(...fichiers(chemin));
    else if (/\.tsx?$/.test(chemin)) trouves.push(chemin);
  }
  return trouves;
}

const REPERES = /(aria-label|data-[a-z-]+|key|className|id|role|href|type|name)=\{\s*t\(/g;
for (const chemin of fichiers(ECRANS)) {
  const source = fs.readFileSync(chemin, 'utf8');
  for (const trouve of source.matchAll(REPERES)) {
    refuser(`${path.relative(RACINE, chemin)} : le repère « ${trouve[1]} » passe par le dictionnaire — il doit rester le même dans les cinq langues`);
  }
}
constater(`aucun repère technique (aria-label, data-…, key, className) ne change avec la langue`);

/* ------------------------------------------------------------------ */
/* 5. Un SEUL endroit pose la langue                                   */
/* ------------------------------------------------------------------ */

const poseurs = fichiers(ECRANS).filter((chemin) => {
  if (chemin.endsWith(path.join('lib', 'langue.ts'))) return false;
  return /documentElement\.lang\s*=/.test(fs.readFileSync(chemin, 'utf8'));
});
if (poseurs.length) {
  refuser(`la langue est posée hors de web/src/lib/langue.ts : ${poseurs.map((c) => path.relative(RACINE, c)).join(', ')}`);
}

const racines = fichiers(ECRANS).filter((chemin) => /useLangueAppliquee\s*\(\s*\)/.test(fs.readFileSync(chemin, 'utf8')));
const appels = racines.filter((chemin) => !chemin.endsWith(path.join('lib', 'langue.ts')));
if (appels.length !== 1) {
  refuser(`useLangueAppliquee doit être appelé UNE seule fois, depuis la racine — trouvé ${appels.length} fois`);
}
constater(`la langue est posée en un seul endroit, appelé une seule fois depuis la racine`);

/* ------------------------------------------------------------------ */
/* 6. Le navigateur                                                    */
/* ------------------------------------------------------------------ */

/**
 * Une session d'UNE HEURE, fabriquée puis retirée : la colonne `token` garde le
 * SHA-256 du cookie, jamais le cookie. C'est la seule écriture en base de tout
 * ce contrôle, et elle est défaite en partant.
 */
async function avecSession(travail) {
  const { default: crypto } = await import('node:crypto');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const ouvrir = () =>
    require(path.join(DONNEES, '../node_modules/better-sqlite3'))(path.join(DONNEES, 'haikodev.db'));

  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const db = ouvrir();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3_600_000,
    'vérification des langues',
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

async function auNavigateur() {
  const { chromium } = await import('playwright');
  try {
    return await avecSession(async (session) => {
      const navigateur = await chromium.launch({ channel: 'chrome' });
      const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
      await contexte.addCookies([{ name: 'haikodev_session', value: session, domain: 'localhost', path: '/' }]);
      const page = await contexte.newPage();
      try {
        await page.goto(ADRESSE, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      } catch (err) {
        await navigateur.close();
        return `serveur de développement injoignable sur ${ADRESSE} — ${err.message.split('\n')[0]}`;
      }
      try {
        return await dansLaPage(page);
      } catch (err) {
        /* Un geste qui ne mord pas doit DIRE lequel : « clic sans effet » n'aide
           personne à trouver l'écran fautif. On garde l'état visible de la page. */
        const etat = await page
          .evaluate(() => ({ langue: document.documentElement.lang, menu: !!document.querySelector('[data-langue-menu]') }))
          .catch(() => null);
        return [`le parcours du menu s'est arrêté — ${err.message.split('\n')[0]} (à l'étape « ${derniereEtape} », page en « ${etat?.langue ?? '?'} », menu ${etat?.menu ? 'ouvert' : 'fermé'})`];
      } finally {
        await navigateur.close();
      }
    });
  } catch (err) {
    return `session d'essai impossible — ${err.message.split('\n')[0]}`;
  }
}

/**
 * Ouvre le menu à trois points — et ne fait RIEN s'il est déjà ouvert. Cliquer
 * un menu ouvert le REFERME : sans ce garde-fou, un contrôle qui rouvre par
 * précaution ferme ce qu'il vient d'ouvrir et attend ensuite pour toujours.
 */
async function ouvrirLeMenu(page) {
  if (await page.$('[data-langue-menu]')) return;
  await page.click('button[aria-label="Menu"]', { timeout: 8000 });
  await page.waitForSelector('[data-langue-menu]', { timeout: 8000 });
}

/** Referme tout ce qui est ouvert, et l'attend vraiment. */
async function refermerLeMenu(page) {
  for (let essai = 0; essai < 3 && (await page.$('[data-langue-menu]')); essai++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
}

let derniereEtape = 'départ';
async function dansLaPage(page) {
  const anomalies = [];
  /* On attend que l'application SOIT LÀ, pas un délai au jugé : le tableau
     dessiné et le bouton du menu vraiment cliquable. Un délai fixe passe une
     fois sur deux selon la charge de la machine. */
  await page.waitForSelector('[data-column]', { state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.waitForSelector('button[aria-label="Menu"]', { state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(1500);
  /*
   * ON REFERME CE QUI TRAÎNE AVANT DE TOUCHER AU MENU. L'application rouvre
   * l'écran où on l'avait laissée : un tiroir de carte ou un panneau de réglages
   * restés ouverts posent un VOILE plein écran (`bg-voile/70`) qui avale tous les
   * clics — le bouton du menu est bien visible, il n'est simplement plus
   * atteignable, et le contrôle échouait sans dire pourquoi.
   */
  for (let essai = 0; essai < 4; essai++) {
    const voile = await page.$('[aria-hidden="true"].fixed.inset-0');
    if (!voile) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  derniereEtape='ouverture du menu'; await ouvrirLeMenu(page);

  /* L'ORDRE du menu : « Langue » sous « Thème », au-dessus de « Réglages ». */
  const ordre = await page.evaluate(() => {
    const contenu = document.querySelector('[data-langue-menu]')?.closest('[role="menu"]');
    if (!contenu) return null;
    const lignes = [...contenu.querySelectorAll('[role="menuitem"], [data-theme-menu], [data-langue-menu]')];
    return lignes.map((ligne) => ({
      theme: ligne.hasAttribute('data-theme-menu'),
      langue: ligne.hasAttribute('data-langue-menu'),
      texte: (ligne.textContent || '').trim(),
    }));
  });
  if (!ordre) {
    anomalies.push('le menu à trois points ne porte aucune entrée « Langue »');
  } else {
    const rangTheme = ordre.findIndex((ligne) => ligne.theme);
    const rangLangue = ordre.findIndex((ligne) => ligne.langue);
    const rangReglages = ordre.findIndex((ligne) => /Réglages/.test(ligne.texte));
    if (rangLangue < 0) anomalies.push('l’entrée « Langue » est absente du menu');
    if (rangTheme >= 0 && rangLangue >= 0 && rangLangue < rangTheme) {
      anomalies.push('l’entrée « Langue » est posée AU-DESSUS de « Thème », elle doit venir juste en dessous');
    }
    if (rangReglages >= 0 && rangLangue >= 0 && rangLangue > rangReglages) {
      anomalies.push('l’entrée « Langue » est posée SOUS « Réglages », elle doit venir au-dessus');
    }
  }

  /*
   * Elle rappelle la langue EN COURS, comme celle du thème. On ne suppose pas
   * laquelle : le réglage vit en base et un contrôle précédent a pu le laisser
   * ailleurs. On lit ce que la page porte, et on exige que le menu le dise.
   */
  const enCours = await page.evaluate(() => document.documentElement.dataset.langue || 'fr');
  const nomAttendu = LANGUES.find((langue) => langue.id === enCours)?.libelle ?? 'Français';
  const rappel = await page.textContent('[data-langue-menu]');
  if (!rappel?.includes(nomAttendu)) {
    anomalies.push(`l’entrée « Langue » ne rappelle pas la langue en cours « ${nomAttendu} » (lu : « ${rappel?.trim()} »)`);
  }

  /* AU SURVOL. Le téléphone et le clavier n'ont pas de survol, mais la souris si :
     les deux gestes doivent ouvrir, comme pour le thème. */
  derniereEtape='survol'; await page.hover('[data-langue-menu]');
  await page.waitForTimeout(600);
  let choix = await page.$$('[data-langue-choix]');
  if (choix.length !== 5) {
    anomalies.push(`au SURVOL, le sous-menu des langues montre ${choix.length} choix au lieu de 5`);
  }

  /* AU CLIC. On referme tout d'abord, sinon on jugerait le survol d'avant. */
  derniereEtape='clic'; await refermerLeMenu(page);
  await ouvrirLeMenu(page);
  await page.click('[data-langue-menu]', { timeout: 8000 });
  await page.waitForTimeout(600);
  choix = await page.$$('[data-langue-choix]');
  if (choix.length !== 5) {
    anomalies.push(`au CLIC, le sous-menu des langues montre ${choix.length} choix au lieu de 5`);
  }

  /* Les noms sont écrits dans leur propre langue. */
  const noms = await page.$$eval('[data-langue-choix]', (lignes) =>
    lignes.map((ligne) => ({ id: ligne.getAttribute('data-langue-choix'), texte: (ligne.textContent || '').trim() })),
  );
  for (const langue of LANGUES) {
    const trouve = noms.find((nom) => nom.id === langue.id);
    if (!trouve) anomalies.push(`le choix « ${langue.id} » manque au sous-menu`);
    else if (!trouve.texte.includes(langue.libelle)) {
      anomalies.push(`le choix « ${langue.id} » s'affiche « ${trouve.texte} » au lieu de « ${langue.libelle} »`);
    }
  }

  /* Un repère technique AVANT le changement de langue. */
  const avant = await page.evaluate(() => ({
    menu: !!document.querySelector('button[aria-label="Menu"]'),
    projets: !!document.querySelector('[aria-label="Projets"]'),
  }));

  /* On passe à l'ANGLAIS et on regarde ce que la page écrit vraiment. */
  derniereEtape='choix anglais'; await page.click('[data-langue-choix="en"]', { timeout: 8000 });
  await page.waitForTimeout(1800);

  const apres = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    langue: document.documentElement.dataset.langue,
    menu: !!document.querySelector('button[aria-label="Menu"]'),
    projets: !!document.querySelector('[aria-label="Projets"]'),
    texte: document.body.innerText,
  }));

  if (apres.lang !== 'en') anomalies.push(`la page ne porte pas lang="en" après le choix de l'anglais (lu : « ${apres.lang}»)`);
  if (apres.langue !== 'en') anomalies.push(`la page ne porte pas data-langue="en" après le choix de l'anglais`);
  if (avant.menu && !apres.menu) anomalies.push('le repère aria-label="Menu" a changé avec la langue');
  if (avant.projets && !apres.projets) anomalies.push('le repère aria-label="Projets" a changé avec la langue');

  /*
   * LES COLONNES DU TABLEAU — nommées dans la demande, et le meilleur témoin
   * qu'un libellé venu d'un catalogue PARTAGÉ passe bien par le dictionnaire.
   *
   * On lit LEURS ENTÊTES, jamais le texte de la page entière : celle-ci porte
   * aussi les titres des cartes et les réponses des agents, écrits en français
   * par des agents, et qui doivent JUSTEMENT le rester. Un contrôle qui
   * chercherait « En cours » dans tout le corps de page trouverait le titre
   * d'une carte et refuserait un travail correct.
   */
  const entetes = await page.$$eval('[data-column] h2', (titres) => titres.map((titre) => (titre.textContent || '').trim()));
  if (!entetes.length) {
    anomalies.push('les entêtes de colonnes du tableau sont introuvables — le contrôle ne peut rien juger');
  } else {
    const attendus = { Planned: 'Planifié', 'In progress': 'En cours', 'To deploy': 'À déployer' };
    for (const [anglais, francais] of Object.entries(attendus)) {
      const enFrancais = entetes.some((titre) => titre.toLowerCase() === francais.toLowerCase());
      const enAnglais = entetes.some((titre) => titre.toLowerCase() === anglais.toLowerCase());
      if (enFrancais) anomalies.push(`la colonne « ${francais} » reste en français une fois l'anglais choisi`);
      else if (!enAnglais) {
        anomalies.push(`la colonne « ${francais} » ne s'écrit pas « ${anglais} » (entêtes lus : ${entetes.join(', ')})`);
      }
    }
  }

  /* LE CHOIX EST RETENU : il vit en base, pas dans l'écran. Un rechargement
     complet — le seul moyen de le prouver — doit le retrouver. */
  derniereEtape='rechargement'; await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(5000);
  const rechargee = await page.evaluate(() => document.documentElement.lang);
  if (rechargee !== 'en') {
    anomalies.push(`la langue n'est pas retenue : après rechargement la page porte lang="${rechargee}"`);
  }

  /* On remet le français : un contrôle ne laisse pas l'application ailleurs. */
  derniereEtape='retour au français'; await refermerLeMenu(page);
  await ouvrirLeMenu(page);
  await page.click('[data-langue-menu]', { timeout: 8000 });
  await page.waitForTimeout(600);
  await page.click('[data-langue-choix="fr"]', { timeout: 8000 });
  await page.waitForTimeout(1200);
  const rendue = await page.evaluate(() => document.documentElement.lang);
  if (rendue !== 'fr') anomalies.push(`le retour au français n'a pas pris (lu : « ${rendue} »)`);

  return anomalies;
}

let mesure;
try {
  mesure = await auNavigateur();
} catch (err) {
  mesure = `navigateur d'essai indisponible — ${err.message.split('\n')[0]}`;
}

if (typeof mesure === 'string') {
  refuser(`le menu des langues n'a PAS pu être mesuré : ${mesure}`);
} else if (mesure.length) {
  for (const anomalie of mesure) refuser(anomalie);
} else {
  constater(
    `dans un vrai navigateur : l'entrée « Langue » sous « Thème » et au-dessus de « Réglages », ` +
      `ouverte au survol comme au clic, cinq langues nommées dans leur propre langue, ` +
      `l'anglais qui réécrit le tableau sans toucher aux repères, et le choix retenu après rechargement`,
  );
}

/* ------------------------------------------------------------------ */

console.log('\nLES CINQ LANGUES\n');
for (const message of constats) console.log(`  ✓ ${message}`);
if (echecs.length) {
  console.error('');
  for (const message of echecs) console.error(`  ✗ ${message}`);
  console.error(`\n${echecs.length} refus.\n`);
  process.exit(1);
}
console.log('\nTout est en place.\n');
