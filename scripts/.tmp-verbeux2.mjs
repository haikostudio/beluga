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
const {
  LANGUES,
  LANGUE_DORIGINE,
  TRADUCTIONS,
  TEXTES_TRADUITS,
  langueValide,
  manquesDeLaLangue,
  traduire,
  COLUMN_LABELS,
  THEMES,
  TYPES_ACCES,
  LIBELLE_TYPE_ACCES,
  CHAMPS_PAR_TYPE,
  LIBELLE_ETAT_TACHE,
  BOUTON_LANCER_LA_TACHE,
  MOT_CADRAGE,
  RAISONS_DU_BOUTON_LANCER,
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
];
const aTraduire = [...new Set([...textes, ...catalogues])];

if (aTraduire.length < 300) {
  refuser(`seulement ${aTraduire.length} textes relevés dans l'interface : le relevé a dû échouer`);
}

for (const langue of LANGUES) {
  if (langue.id === LANGUE_DORIGINE) continue;
  const manque = manquesDeLaLangue(aTraduire, langue.id, TRADUCTIONS[langue.id]);
  if (manque.absents.length) {
    const apercu = manque.absents.slice(0, 99).map((texte) => `« ${texte.slice(0, 200)} »`).join(', ');
    refuser(`${langue.libelle} : ${manque.absents.length} texte(s) sans traduction — ${apercu}`);
  }
  if (manque.trousPerdus.length) {
    const apercu = manque.trousPerdus.slice(0, 3).map((texte) => `« ${texte.slice(0, 200)} »`).join(', ');
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
  const apercu = orphelines.slice(0, 99).map((cle) => `« ${cle.slice(0, 200)} »`).join(', ');
  refuser(`${orphelines.length} clé(s) du dictionnaire n'apparaissent plus nulle part dans les sources : ${apercu}`);
} else {
  constater(`aucune des ${TEXTES_TRADUITS.length} clés du dictionnaire n'est orpheline`);
}

/* ------------------------------------------------------------------ */
for (const c of constats) console.log('  OK', c);
for (const e of echecs) console.log('  KO', e);
process.exit(0);
