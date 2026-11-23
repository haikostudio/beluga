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
import ts from 'typescript';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';
import { poserSessionDEssai } from './lib/session-d-essai.mjs';

/* La racine se déduit du script : lancé d'une copie de travail, il juge CE
   code-là, jamais le dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ECRANS = path.join(RACINE, 'web/src');
const ADRESSE = process.env.HAIKO_LANGUES_URL || 'http://localhost:7099';
/* La base et ses dépendances natives vivent dans le dépôt PRINCIPAL, même quand
   ce script est lancé d'une copie de travail. */
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';

const echecs = [];
const constats = [];
const refuser = (message) => echecs.push(message);
const constater = (message) => constats.push(message);

const partage = await import(path.join(RACINE, 'shared/dist/index.js'));
const { TRADUCTIONS, TEXTES_TRADUITS } = await import(
  path.join(RACINE, 'shared/dist/traductions.js')
);
const {
  LANGUES,
  LANGUE_DORIGINE,
  langueValide,
  manquesDeLaLangue,
  traduire,
  COLUMN_LABELS,
  CATALOGUE_CANAUX,
  COLONNES_CONTENU,
  depotContenu,
  LIBELLE_FAMILLE_CANAL,
  PARCOURS_DES_CANAUX,
  LIBELLE_ETAT_D_AGENT,
  THEMES,
  TYPES_ACCES,
  LIBELLE_TYPE_ACCES,
  CHAMPS_PAR_TYPE,
  LIBELLE_ETAT_TACHE,
  BOUTON_LANCER_LA_TACHE,
  MOT_CADRAGE,
  RAISONS_DU_BOUTON_LANCER,
  CATEGORIES_EXPORT,
  LIBELLE_POLITIQUE,
  EXPLICATION_POLITIQUE,
  LIBELLE_DE_CHAMP,
  LIBELLE_ETAT_POINT,
  FICHES_DES_USAGES,
  PHRASES_DES_FAMILLES,
  phraseDuMotif,
  MOTIFS_DE_COMPREHENSION,
  avisSurLUrgence,
  ROLES_CREABLES,
  libelleDuRole,
  aideDuRole,
} = partage;

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

/* Un verdict dont le signal est ALLUMÉ : c'est le seul cas où un avis porte un
   texte, et donc le seul qui ait quelque chose à traduire. */
const JUGEMENT_ALLUME = { valeur: 0.1, signal: true, at: 1 };

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
const TEXTES_DES_PASTILLES = [
  '{n} profil(s) de clients', '{n} concurrent(s)', '{n} canal(aux)', '{n} temps fort(s)', '{n} chiffre(s)', '{n} élément(s) classé(s)',
  '{n} critère(s) noté(s)', '{n} choix', '{n} document(s)', 'Place face aux concurrents', 'Ton de marque réglé', '{n} ville(s)', 'Zone de {n} km',
  'Repris de la fiche, à confirmer',
];
const catalogues = [
  ...Object.values(COLUMN_LABELS),
  /* Les badges de la liste des agents (30/10/2026). */
  ...Object.values(LIBELLE_ETAT_D_AGENT),
  ...THEMES.map((theme) => theme.libelle),
  ...THEMES.map((theme) => theme.description),
  /* Le coffre-fort : ses types d'accès et les libellés de leurs champs viennent
     eux aussi d'un catalogue partagé, affiché tel quel. */
  ...TYPES_ACCES.map((type) => LIBELLE_TYPE_ACCES[type]),
  ...TYPES_ACCES.flatMap((type) => CHAMPS_PAR_TYPE[type].map((champ) => champ.libelle)),
  /* Où en est chaque tâche du lot : les huit états d'une carte dans une mise
     en ligne viennent eux aussi d'un catalogue partagé, affiché tel quel. */
  ...Object.values(LIBELLE_ETAT_TACHE),
  /* La carte-fil : le libellé du bouton « Lancer la tâche », les raisons qui
     l'éteignent et le mot d'une conversation de cadrage encore vide viennent
     d'un catalogue partagé (`shared/src/cadrage.ts`), affiché tel quel. */
  BOUTON_LANCER_LA_TACHE,
  MOT_CADRAGE.titre,
  MOT_CADRAGE.indice,
  ...RAISONS_DU_BOUTON_LANCER,
  /* L'export/import des données : les catégories exportables et les politiques
     de conflit viennent d'un catalogue partagé, affiché tel quel. */
  ...CATEGORIES_EXPORT.map((categorie) => categorie.libelle),
  ...CATEGORIES_EXPORT.map((categorie) => categorie.description),
  ...Object.values(LIBELLE_POLITIQUE),
  ...Object.values(EXPLICATION_POLITIQUE),
  /* Le parcours d'une carte : le mot de chaque CHAMP d'une entrée et les
     quatre états d'un point de travail viennent d'un catalogue partagé
     (`shared/src/contenu-journal.ts`), affiché tel quel par le flux. */
  ...Object.values(LIBELLE_DE_CHAMP),
  ...Object.values(LIBELLE_ETAT_POINT),
  /* LE JUGE RAPIDE : le titre et l'explication de ses trois usages, les
     phrases de survol de l'indicateur à trois barres et l'étiquette d'urgence
     viennent de catalogues partagés (`shared/src/jugement-rapide.ts`), affichés tels quels. Une phrase qu'on ne
     pourrait lire qu'en français ne tiendrait pas l'invariant des cinq langues. */
  /* LES FAMILLES D'ERREUR : la phrase simple qui remplace un message de
     machine à l'écran (`shared/src/familles-d-erreur.ts`), affichée telle quelle. */
  ...Object.values(PHRASES_DES_FAMILLES),
  /* L'ÉCRAN CANAUX du marketing : la description de chaque canal, le nom des
     familles et chaque étape du parcours pas à pas viennent du catalogue
     partagé (`shared/src/marketing.ts`), affichés tels quels. */
  ...CATALOGUE_CANAUX.map((canal) => canal.description),
  ...Object.values(LIBELLE_FAMILLE_CANAL),
  /* Les raisons d'un dépôt refusé dans l'onglet Contenus viennent d'une règle
     partagée (`depotContenu`) et passent par `t()` à l'affichage. */
  ...['brouillon', 'a_valider', 'pret', 'programme', 'publie', 'echec', 'abandonne'].flatMap((etape) =>
    COLONNES_CONTENU.map((colonne) => depotContenu({ etape }, colonne)).flatMap((depot) => (depot.ok ? [] : [depot.raison])),
  ),
  ...Object.values(PARCOURS_DES_CANAUX).flatMap((etapes) => etapes.flatMap((etape) => [etape.titre, etape.detail])),
  ...FICHES_DES_USAGES.map((fiche) => fiche.titre),
  ...FICHES_DES_USAGES.map((fiche) => fiche.explication),
  ...Object.keys(MOTIFS_DE_COMPREHENSION).map(phraseDuMotif),
  phraseDuMotif(undefined),
  ...[avisSurLUrgence({ jugements: { urgence: JUGEMENT_ALLUME } })].flatMap((avis) => [avis.titre, avis.phrase]),
  /* LES NIVEAUX DE COMPTE : le nom et l'aide de chaque niveau viennent d'un catalogue partagé
     (`shared/src/comptes-clients.ts`), passés à `t()` à l'affichage. */
  ...ROLES_CREABLES.flatMap((role) => [libelleDuRole(role), aideDuRole(role)]),
  /* LES MODES DE RÉALISATION DU STUDIO : le titre et la description de chaque tuile viennent d'un catalogue partagé
     (`shared/src/modes-du-studio.ts`), passés à `t()` à l'affichage. */
  ...partage.MODES_DU_STUDIO.flatMap((mode) => [mode.titre, mode.description]),
  /* LE MENU « / » : les descriptions des commandes de Beluga et celles, réécrites en français, des commandes intégrées
     aux moteurs (`shared/src/commandes-de-beluga.ts`, `shared/src/commandes-slash.ts`), passées à `t()` par le menu. */
  ...partage.COMMANDES_DE_BELUGA.map((commande) => commande.description),
  /* LE RÉFÉRENCEMENT EN LANGAGE COURANT ET LES PASTILLES DU DOSSIER MARKETING (21/11/2026) : textes de catalogues
     partagés, passés à `t()` par le volet. Absents dans une installation sans le service (fichiers réservés). */
  ...Object.values(partage.CRITERES_EN_CLAIR ?? {}).flatMap((c) => [c.titre, c.enDeuxMots, c.pourquoi].filter(Boolean)),
  ...(partage.phraseDeLaNote ? [null, 90, 70, 50, 10].map((n) => partage.phraseDeLaNote(n)) : []),
  ...(partage.importanceDuPoids ? [3, 2, 1].map((n) => partage.importanceDuPoids(n)) : []),
  ...(partage.pastillesDeLaRubrique ? TEXTES_DES_PASTILLES : []),
  ...Object.values(partage.COMMANDES_INTEGREES).flatMap((liste) => liste.map((commande) => commande.description).filter(Boolean)),
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
    if (process.env.HAIKO_LANGUES_LISTER) console.log(JSON.stringify(manque.absents, null, 1));
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
/* 6. Aucune clé du dictionnaire ne reste sans emploi                  */
/* ------------------------------------------------------------------ */

/**
 * Le sens inverse de la section 2 : le dictionnaire ne doit garder que des
 * textes RÉELLEMENT affichés. On relit chaque littéral de chaîne (et chaque
 * bout de texte JSX) du VRAI arbre du code, jamais une comparaison de texte
 * brut — une clé écrite avec une apostrophe échappée (`\'`) dans un fichier et
 * une apostrophe simple dans un autre semblerait absente alors qu'elle est
 * bien utilisée. `node.text` du compilateur TypeScript décode chacun des deux
 * de la même façon, quelle que soit la façon dont il a été écrit.
 */
function litterauxDeSource(dossiers) {
  const litteraux = new Set();
  for (const dossier of dossiers) {
    for (const chemin of fichiers(dossier)) {
      if (chemin.endsWith(path.join('shared', 'src', 'traductions.ts'))) continue;
      const texte = fs.readFileSync(chemin, 'utf8');
      const source = ts.createSourceFile(
        chemin,
        texte,
        ts.ScriptTarget.Latest,
        true,
        chemin.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const visiter = (noeud) => {
        if (ts.isStringLiteral(noeud) || ts.isNoSubstitutionTemplateLiteral(noeud)) {
          litteraux.add(noeud.text);
        }
        if (ts.isTemplateExpression(noeud)) {
          litteraux.add(noeud.head.text);
          for (const morceau of noeud.templateSpans) litteraux.add(morceau.literal.text);
        }
        if (ts.isJsxText(noeud)) {
          const texteJsx = noeud.getText().trim();
          if (texteJsx) litteraux.add(texteJsx);
        }
        ts.forEachChild(noeud, visiter);
      };
      visiter(source);
    }
  }
  return litteraux;
}

const litteraux = litterauxDeSource([ECRANS, path.join(RACINE, 'shared/src'), path.join(RACINE, 'server/src')]);
const orphelines = TEXTES_TRADUITS.filter((cle) => !litteraux.has(cle));
if (orphelines.length) {
  const apercu = orphelines.slice(0, 10).map((cle) => `« ${cle.slice(0, 70)} »`).join(', ');
  if (process.env.HAIKO_LANGUES_ORPHELINES) fs.writeFileSync(process.env.HAIKO_LANGUES_ORPHELINES, JSON.stringify(orphelines));
  refuser(`${orphelines.length} clé(s) du dictionnaire n'apparaissent plus nulle part dans les sources : ${apercu}`);
} else {
  constater(`aucune des ${TEXTES_TRADUITS.length} clés du dictionnaire n'est orpheline`);
}

/* ------------------------------------------------------------------ */
/* 7. Le navigateur                                                    */
/* ------------------------------------------------------------------ */

/**
 * Une session d'UNE HEURE, fabriquée puis retirée : la colonne `token` garde le
 * SHA-256 du cookie, jamais le cookie. C'est la seule écriture en base de tout
 * ce contrôle, et elle est défaite en partant.
 */
async function avecSession(travail) {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const ouvrir = () =>
    require(path.join(DONNEES, '../node_modules/better-sqlite3'))(cheminDeLaBaseServie(DONNEES));

  const session = poserSessionDEssai('vérification des langues', {
    chemin: cheminDeLaBaseServie(DONNEES),
  });
  /* LA LANGUE EST REMISE EN PARTANT, QUOI QU'IL ARRIVE. Ce contrôle CHANGE la
     langue de l'application pour la juger, et ce réglage vit EN BASE, partagé
     par toute l'application. Le retour au français est bien la dernière étape du
     parcours — mais une étape qui TOMBE avant elle (ou le retour lui-même qui
     n'aboutit pas) laissait l'application en anglais, et tous les autres
     contrôles navigateur, qui cherchent des libellés français, échouaient
     ensuite sans jamais dire pourquoi. On relève donc le réglage AVANT et on le
     repose ICI, dans le même `finally` que la session d'essai. */
  const relire = () => {
    const lecture = ouvrir();
    const ligne = lecture.prepare("SELECT value FROM preferences WHERE key = 'langue'").get();
    lecture.close();
    return ligne ? ligne.value : null;
  };
  const langueDavant = relire();
  try {
    return await travail(session.cookie);
  } finally {
    session.retirer();
    const fin = ouvrir();
    if (langueDavant === null) fin.prepare("DELETE FROM preferences WHERE key = 'langue'").run();
    else
      fin
        .prepare(
          `INSERT INTO preferences (key, value, updated_at) VALUES ('langue', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .run(langueDavant, Date.now());
    fin.close();
  }
}

async function auNavigateur() {
  const { chromium } = await import('playwright');
  try {
    return await avecSession(async (session) => {
      const navigateur = await chromium.launch({ channel: 'chrome' });
      const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
      await contexte.addCookies([{ name: 'beluga_session', value: session, domain: 'localhost', path: '/' }]);
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
        return [`le parcours des réglages s'est arrêté — ${err.message.split('\n')[0]} (à l'étape « ${derniereEtape} », page en « ${etat?.langue ?? '?'} », page « Langue » ${etat?.menu ? 'ouverte' : 'fermée'})`];
      } finally {
        await navigateur.close();
      }
    });
  } catch (err) {
    return `session d'essai impossible — ${err.message.split('\n')[0]}`;
  }
}

/**
 * LA LANGUE SE CHOISIT DANS LES RÉGLAGES (page « Langue »), plus dans le menu à
 * trois points : ce menu ne garde que les options de la page affichée, et un
 * réglage général se range dans la fenêtre qu'on ouvre de partout — par le
 * bouton des réglages, au pied de la colonne de gauche.
 *
 * Ouvre cette page — et ne fait RIEN si elle est déjà ouverte.
 */
const BOUTON_REGLAGES = '[data-reglages-menu]';
async function ouvrirLeMenu(page) {
  if (await page.$('[data-langue-menu]')) return;
  if (!(await page.$('[data-modale-reglages]'))) {
    await page.click(BOUTON_REGLAGES, { timeout: 8000 });
    await page.waitForSelector('[data-modale-reglages]', { timeout: 8000 });
  }
  /* Deux niveaux (refonte du 21/11/2026) : la rubrique « Moi », puis « Apparence et langue ». */
  if (await page.$('[data-rubrique-reglages="moi"]')) await page.click('[data-rubrique-reglages="moi"]', { timeout: 8000 });
  await page.click('[data-menu-reglages] [data-page-menu="theme"]', { timeout: 8000 });
  await page.waitForSelector('[data-langue-menu]', { timeout: 8000 });
}

/** Referme la fenêtre des réglages, et l'attend vraiment. */
async function refermerLeMenu(page) {
  for (let essai = 0; essai < 3 && (await page.$('[data-modale-reglages]')); essai++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
}

/**
 * ON REFERME CE QUI TRAÎNE AVANT DE TOUCHER AU MENU. L'application rouvre
 * l'écran où on l'avait laissée : un tiroir de carte ou la MODALE des réglages
 * restés ouverts posent un VOILE plein écran (`bg-voile/70`) qui avale tous les
 * clics — le bouton du menu est bien visible, il n'est simplement plus
 * atteignable, et le contrôle échouait sans dire pourquoi.
 *
 * CE MÉNAGE VAUT AUSSI APRÈS UN RECHARGEMENT : la page revient sur l'écran
 * quitté, donc sur le même voile. Le faire une seule fois au départ laissait le
 * retour au français taper dans le vide.
 */
/**
 * La langue RENDUE par la page, une fois l'application vraiment revenue.
 * On lui laisse le temps d'afficher celle qu'on attend, et on rend ce qu'on lit
 * au bout du compte : le refus, s'il y en a un, porte alors sur un vrai oubli.
 */
async function langueRendue(page, attendue) {
  await page.waitForSelector(BOUTON_REGLAGES, { state: 'attached', timeout: 30_000 }).catch(() => {});
  let lue = '';
  for (let essai = 0; essai < 30; essai += 1) {
    lue = await page.evaluate(() => document.documentElement.lang);
    if (lue === attendue) return lue;
    await page.waitForTimeout(500);
  }
  return lue;
}

/* CE QUI RECOUVRE L'ÉCRAN : le voile d'une fenêtre, ou une PAGE ouverte par-dessus
   la zone principale (la carte retenue, ce qu'était un tiroir : `data-page-de-zone`).
   La fenêtre des RÉGLAGES, elle, est celle qu'on vient chercher : on la laisse. */
async function refermerLeVoile(page) {
  for (let essai = 0; essai < 4; essai++) {
    if (await page.$('[data-modale-reglages]')) break;
    const voile = await page.$('[aria-hidden="true"].fixed.inset-0, [data-page-de-zone]');
    if (!voile) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}

let derniereEtape = 'départ';
async function dansLaPage(page) {
  const anomalies = [];
  /* On attend que l'application SOIT LÀ, pas un délai au jugé : la liste des
     agents dessinée et le bouton du menu vraiment cliquable. Un délai fixe
     passe une fois sur deux selon la charge de la machine. */
  await page.waitForSelector('[data-liste-des-agents] [data-etat-badge]', { state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.waitForSelector(BOUTON_REGLAGES, { state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(1500);
  /*
   * ON REFERME CE QUI TRAÎNE AVANT D'OUVRIR LES RÉGLAGES. L'application rouvre
   * l'écran où on l'avait laissée : la page d'une carte restée ouverte pose le
   * tableau hors de vue, et ses entêtes de colonnes ne se liraient plus.
   */
  await refermerLeVoile(page);

  derniereEtape='ouverture des réglages'; await ouvrirLeMenu(page);

  /* LA LANGUE VIT AVEC LE THÈME (refonte du 21/11/2026) : la page « Apparence et langue » de la rubrique « Moi »
     porte le choix du thème PUIS celui de la langue ; l'ancienne page « Langue » y mène. */
  const ordre = await page.evaluate(() =>
    [...document.querySelectorAll('[data-menu-reglages] [data-page-menu]')].map((ligne) => ligne.getAttribute('data-page-menu')),
  );
  if (!ordre.includes('theme')) anomalies.push(`la page « Apparence et langue » est absente de la rubrique « Moi » (ordre lu : ${ordre.join(', ')})`);
  if (ordre.includes('langue')) anomalies.push('une page « Langue » à part est revenue dans le menu des réglages');

  /* LE MENU À TROIS POINTS NE PORTE PLUS NI LE THÈME NI LA LANGUE : ce sont des
     réglages généraux, et lui ne garde que les options de la page affichée. */
  const restes = await page.evaluate(() => document.querySelectorAll('[data-theme-menu], [role="menu"] [data-langue-choix]').length);
  if (restes) anomalies.push('le thème ou la langue se choisissent encore hors des réglages');

  /*
   * Elle marque la langue EN COURS. On ne suppose pas laquelle : le réglage vit
   * en base et un contrôle précédent a pu le laisser ailleurs. On lit ce que la
   * page porte, et on exige que la liste le dise.
   */
  const enCours = await page.evaluate(() => document.documentElement.dataset.langue || 'fr');
  const nomAttendu = LANGUES.find((langue) => langue.id === enCours)?.libelle ?? 'Français';
  const retenue = await page.$$eval('[data-langue-choix][aria-checked="true"]', (lignes) =>
    lignes.map((ligne) => ({ id: ligne.getAttribute('data-langue-choix'), texte: (ligne.textContent || '').trim() })),
  );
  if (retenue.length !== 1 || retenue[0].id !== enCours || !retenue[0].texte.includes(nomAttendu)) {
    anomalies.push(`la liste des langues ne marque pas la langue en cours « ${nomAttendu} » (lu : ${JSON.stringify(retenue)})`);
  }

  /* LES CINQ LANGUES, À PORTÉE D'UN CLIC : plus de sous-menu à survoler. */
  derniereEtape='lecture des choix';
  const choix = await page.$$('[data-langue-choix]');
  if (choix.length !== 5) {
    anomalies.push(`la page « Langue » montre ${choix.length} choix au lieu de 5`);
  }

  /* Les noms sont écrits dans leur propre langue. */
  const noms = await page.$$eval('[data-langue-choix]', (lignes) =>
    lignes.map((ligne) => ({ id: ligne.getAttribute('data-langue-choix'), texte: (ligne.textContent || '').trim() })),
  );
  for (const langue of LANGUES) {
    const trouve = noms.find((nom) => nom.id === langue.id);
    if (!trouve) anomalies.push(`le choix « ${langue.id} » manque à la page « Langue »`);
    else if (!trouve.texte.includes(langue.libelle)) {
      anomalies.push(`le choix « ${langue.id} » s'affiche « ${trouve.texte} » au lieu de « ${langue.libelle} »`);
    }
  }

  /* Un repère technique AVANT le changement de langue. */
  const avant = await page.evaluate(() => ({
    menu: !!document.querySelector('button[aria-label="Réglages"]'),
    projets: !!document.querySelector('[aria-label="Projets"]'),
  }));

  /* On passe à l'ANGLAIS et on regarde ce que la page écrit vraiment. */
  derniereEtape='choix anglais'; await page.click('[data-langue-choix="en"]', { timeout: 8000 });
  await page.waitForTimeout(1800);

  const apres = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    langue: document.documentElement.dataset.langue,
    menu: !!document.querySelector('button[aria-label="Réglages"]'),
    projets: !!document.querySelector('[aria-label="Projets"]'),
    texte: document.body.innerText,
  }));

  if (apres.lang !== 'en') anomalies.push(`la page ne porte pas lang="en" après le choix de l'anglais (lu : « ${apres.lang}»)`);
  if (apres.langue !== 'en') anomalies.push(`la page ne porte pas data-langue="en" après le choix de l'anglais`);
  if (avant.menu && !apres.menu) anomalies.push('le repère aria-label="Réglages" a changé avec la langue');
  if (avant.projets && !apres.projets) anomalies.push('le repère aria-label="Projets" a changé avec la langue');

  /*
   * LES BADGES DE LA LISTE DES AGENTS — le tableau à colonnes a disparu
   * (30/10/2026), et ces badges sont désormais le meilleur témoin qu'un libellé
   * venu d'un catalogue PARTAGÉ (`LIBELLE_ETAT_D_AGENT`) passe bien par le
   * dictionnaire.
   *
   * On lit LES BADGES, jamais le texte de la page entière : celle-ci porte
   * aussi les titres des cartes, écrits en français par des agents, et qui
   * doivent JUSTEMENT le rester.
   */
  derniereEtape = 'lecture des badges de la liste des agents';

  const badges = await page.$$eval('[data-liste-des-agents] [data-etat-badge]', (els) =>
    els.map((el) => ({ etat: el.getAttribute('data-etat-badge') || '', texte: (el.textContent || '').trim() })),
  );
  if (!badges.length) {
    anomalies.push('les badges de la liste des agents sont introuvables — le contrôle ne peut rien juger');
  } else {
    /* Les couples se LISENT à leur source — le catalogue des badges et le dictionnaire. */
    for (const { etat, texte } of badges) {
      const francais = LIBELLE_ETAT_D_AGENT[etat];
      if (!francais) continue;
      const anglais = traduire(TRADUCTIONS, 'en', francais);
      // Un mot qui s'écrit PAREIL dans les deux langues ne prouve rien.
      if (anglais.toLowerCase() === francais.toLowerCase()) continue;
      if (texte.toLowerCase() === francais.toLowerCase()) anomalies.push(`le badge « ${francais} » reste en français une fois l'anglais choisi`);
      else if (texte.toLowerCase() !== anglais.toLowerCase()) anomalies.push(`le badge « ${francais} » ne s'écrit pas « ${anglais} » (lu : ${texte})`);
    }
  }

  /* LE CHOIX EST RETENU : il vit en base, pas dans l'écran. Un rechargement
     complet — le seul moyen de le prouver — doit le retrouver. */
  derniereEtape='rechargement'; await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
  /*
   * ON ATTEND UN ÉTAT, JAMAIS UN DÉLAI. Le premier affichage part en français —
   * le choix vit en base, il revient avec la première réponse du serveur. Une
   * attente fixe de cinq secondes lisait ce FLASH DE DÉPART et accusait
   * l'application d'avoir oublié la langue, alors qu'elle ne l'avait pas encore
   * reçue.
   */
  const rechargee = await langueRendue(page, 'en');
  if (rechargee !== 'en') {
    anomalies.push(`la langue n'est pas retenue : après rechargement la page porte lang="${rechargee}"`);
  }

  /* On remet le français : un contrôle ne laisse pas l'application ailleurs. */
  derniereEtape='retour au français';
  await page.waitForSelector(BOUTON_REGLAGES, { state: 'attached', timeout: 30_000 });
  await refermerLeVoile(page);
  await ouvrirLeMenu(page);
  await page.click('[data-langue-choix="fr"]', { timeout: 8000 });
  await page.waitForTimeout(1200);
  const rendue = await page.evaluate(() => document.documentElement.lang);
  if (rendue !== 'fr') anomalies.push(`le retour au français n'a pas pris (lu : « ${rendue} »)`);
  await refermerLeMenu(page);

  return anomalies;
}

let mesure;
try {
  mesure = await auNavigateur();
} catch (err) {
  mesure = `navigateur d'essai indisponible — ${err.message.split('\n')[0]}`;
}

if (typeof mesure === 'string') {
  refuser(`la page des langues n'a PAS pu être mesurée : ${mesure}`);
} else if (mesure.length) {
  for (const anomalie of mesure) refuser(anomalie);
} else {
  constater(
    `dans un vrai navigateur : la page « Langue » des réglages, juste sous « Clair ou sombre », ` +
      `plus rien dans le menu à trois points, la langue en cours marquée, cinq langues nommées dans leur propre langue, ` +
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
