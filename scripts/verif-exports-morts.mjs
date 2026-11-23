#!/usr/bin/env node
/*
 * UN EXPORT SANS APPELANT N'EST PAS UN DÉTAIL : il s'accumule en silence.
 *
 * Contrôle STATIQUE, sans navigateur, sans base, sans moteur : il ne lit que des fichiers.
 *
 * POURQUOI. `shared/src/index.ts` (et les autres points d'entrée du même genre) fait un
 * `export *` : TypeScript n'a donc AUCUN moyen de signaler un export que plus personne
 * n'appelle. Trois colonnes retirées en trois nuits ont chacune laissé un résidu derrière
 * elles — quatorze au total, découverts le 21/09/2026 par l'agent d'auto-amélioration
 * nocturne, puis vérifiés un par un : quatre étaient en réalité appelés dynamiquement
 * (`await import(...)` depuis `scripts/`), et seulement dix étaient vraiment morts.
 *
 * LA DÉTECTION EST TEXTUELLE, DONC PRUDENTE. Un export atteint par accès dynamique
 * (`objet[nom]`), par réexport nommé, ou simplement CITÉ dans une chaîne de caractères
 * (un test qui vérifie qu'un nom apparaît dans un autre fichier) compte comme « utilisé »
 * ici — le contrôle cherche donc sur TOUT le dépôt, `scripts/` et `.md` compris, jamais
 * seulement dans le code source. Ça le rend plus permissif qu'un vrai graphe d'appels,
 * mais ça évite de retirer un symbole qui a un appelant réel.
 *
 * SECOND JUGEMENT, POUR LES FONCTIONS (`export function`) : un nom qui n'apparaît, hors sa
 * déclaration, QUE dans des fichiers de test (server/src/test, *.test.*) est une fonction
 * qui n'existe que pour son propre test. Elle est signalée comme « appelée seulement par des
 * tests ». Les constantes, classes et types lus par des tests restent permis. Un nom cité
 * dans un .md ou dans un autre code compte comme un appelant. Les crochets d'essai voulus
 * se déclarent dans EXCEPTIONS_TEST_SEUL, avec leur motif.
 *
 * LES COMMENTAIRES DU FICHIER DÉCLARANT NE COMPTENT PAS : un commentaire (en ligne ou en bloc) qui cite
 * le nom dans le fichier même qui l'exporte ne le sauve plus — c'est ainsi que des fonctions
 * mortes ou test-seules passaient entre les mailles. Seul ce fichier-là est nettoyé : les autres
 * fichiers et les .md gardent la règle prudente ci-dessus.
 *
 * Le contrôle vise le dépôt d'où il PART (`import.meta.url`), jamais un chemin en dur :
 * lancé depuis une copie de travail, il doit juger cette copie et non le dossier principal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Où chercher les DÉCLARATIONS d'export à juger. */
const DOSSIERS_DECLARATIONS = ['shared/src', 'server/src', 'web/src'];

/** Extensions lues pour un APPEL possible : le code, les scripts, et la documentation. */
const EXTENSIONS_APPEL = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.md']);

/** Extensions parcourues pour trouver des DÉCLARATIONS d'export. */
const EXTENSIONS_DECLARATION = new Set(['.ts', '.tsx']);

const RE_DECLARATION = /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|class|type|interface|enum|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;

/**
 * LES EXCEPTIONS, MOTIVÉES UNE PAR UNE. Un symbole listé ici est réputé vivant même sans
 * appelant textuel trouvé — parce qu'il est trop récent pour juger, ou déjà promis à un
 * autre chantier. Facile à enrichir : une ligne, un motif.
 */
const EXCEPTIONS = {
  EtatVide: 'modèle de page de la charte d\'interface (docs/chartes/application.md, `modeles`) : socle voulu pour les écrans à venir, pas encore adopté (08/11/2026)',
  PageListe: 'modèle de page de la charte d\'interface (docs/chartes/application.md, `modeles`) : socle voulu pour les écrans à venir, pas encore adopté (08/11/2026)',
  LigneDeListe: 'modèle de page de la charte d\'interface (docs/chartes/application.md, `modeles`) : socle voulu pour les écrans à venir, pas encore adopté (08/11/2026)',
  PageFiche: 'modèle de page de la charte d\'interface (docs/chartes/application.md, `modeles`) : socle voulu pour les écrans à venir, pas encore adopté (08/11/2026)',
  ChampDeFormulaire: 'modèle de page de la charte d\'interface (docs/chartes/application.md, `modeles`) : socle voulu pour les écrans à venir, pas encore adopté (08/11/2026)',
  RubriqueDeReglages: 'modèle de page de la charte d\'interface (docs/chartes/application.md, `modeles`) : socle voulu pour les écrans à venir, pas encore adopté (08/11/2026)',
  PageTableauDeBord: 'modèle de page de la charte d\'interface (docs/chartes/application.md, `modeles`) : socle voulu pour les écrans à venir, pas encore adopté (08/11/2026)',
  TEXTE_COURANT: 'échelle de texte de référence (web/src/lib/echelle-de-texte.ts) : valeurs documentées de la charte, pas encore adoptées par les écrans (08/11/2026)',
  TEXTE_SECONDAIRE: 'échelle de texte de référence (web/src/lib/echelle-de-texte.ts) : valeurs documentées de la charte, pas encore adoptées par les écrans (08/11/2026)',
  LEGENDE: 'échelle de texte de référence (web/src/lib/echelle-de-texte.ts) : valeurs documentées de la charte, pas encore adoptées par les écrans (08/11/2026)',
  EtatDeLot: 'socle du studio créatif (carte 1, 24/10/2026) : type des lots, chantier en cinq cartes encore ouvert (montage, méthodes, essai final)',
  LIBELLES_ETATS_D_ETAPE: 'socle du studio créatif (carte 1, 24/10/2026) : libellés français des états du suivi, que l’écran traduit à part ; chantier encore ouvert',
  evenementsDeLaCarte: 'socle du studio créatif (carte 1, 24/10/2026) : lecture du journal de production, promise au rapport de l’essai final (carte 5)',
};

/** Les fonctions VOULUES test-seules : crochets d'essai, jamais appelés par le code de production. */
const EXCEPTIONS_TEST_SEUL = {
  sessionDEssai: 'crochet d’essai voulu de voix-directe.ts (18/11/2026) : une session vocale factice, sans Codex, prouve dans jarvis-verifie.test.ts qu’une phrase banale ne fait rien chercher et que le dossier ne part qu’à l’appel du cerveau, jamais appelé en service',
  reglerLeTriPourLesTests: 'crochet d’essai voulu de vectoriseur.ts (18/11/2026) : pose le modèle de tri d’essai « @essai » et une mémoire imposée pour travaux-lourds.test.ts, jamais posé en service',
  etatDuTrieur: 'lecture d’essai voulue de vectoriseur.ts (18/11/2026) : travaux-lourds.test.ts prouve qu’un seul tri est en vol et que le processus a vraiment arrêté le tri abandonné',
  poserLOuvertureVocalePourEssai: 'crochet d’essai voulu de voix-directe.ts (17/11/2026) : pose un tour vocal « en ouverture » pour prouver que la garde du pont l’accepte avant la session, jamais appelé en service',
  oublierLActionPourLesEssais: 'crochet d’essai voulu de gestes-de-jarvis.ts (16/11/2026) : remet à zéro l’action de Jarvis entre deux cas de gestes-de-jarvis.test.ts, jamais appelé en service',
  remplacerLesAppels: 'crochet d’essai voulu de belugapass.ts (15/11/2026) : un Beluga Pass factice remplace le réseau dans belugapass.test.ts, jamais posé en service',
  sceller: 'réplique de bp_core::crypto::seal (belugapass-crypto.ts, 15/11/2026) : Beluga Build ne scelle rien en service, les tests prouvent l’aller-retour et jouent le rôle de Beluga Pass',
  scellerJson: 'réplique de bp_core::crypto::seal_json (belugapass-crypto.ts, 15/11/2026) : même motif que sceller',
  remplacerLeReleve: 'crochet d’essai voulu de service-securite.ts (15/11/2026) : un relevé factice au lieu de npm audit et du disque',
  attendreLaFile: 'crochet d’essai voulu de service-securite.ts (15/11/2026) : les tests attendent la fin de la file d’audits',
  remplacerLeLanceur: 'crochet d’essai voulu de service-securite.ts (16/11/2026) : compter les lancements de « Corriger la sélection » au lieu de partir un moteur',
  remplacerLeTelechargement: 'crochet d’essai : le réseau simulé de la recherche de police (studio-polices.test.ts), jamais appelé en service',
  gesteIrreversible: 'règle de référence de l\'assistant (shared/src/assistant-global.ts, 29/10/2026) : dit quels gestes ne se reprennent pas, que la consigne décrit en mots ; les tests de assistant-global et assistant-outils verrouillent la classification de chaque outil',
  remplacerLeMoteurDesIdees: 'crochet d\'essai voulu de autres-idees.ts (08/11/2026) : le moteur injecté remplace l\'appel réel ; autres-idees.test.ts le pose, jamais posé en service',
  attendreLesCopies: 'crochet d\'essai voulu de fichiers-conserves.ts (02/11/2026) : la copie part derrière, sans retenir le tour ; les tests attendent qu\'elle soit écrite',
  remplacerLesCapacitesBranchees: 'crochet d\'essai voulu de responsable-creatif.ts (25/10/2026) : les tests n\'ont aucun service de fabrication branché, ils fixent les capacités que le refus des plans juge',
  fixerLesServicesCaches: 'crochet voulu de services-de-generation.ts (25/10/2026) : le geste qui rallume fal.ai et Higgsfield cachés ; les tests de leur chaîne le posent, jamais posé en service tant qu’ils restent cachés',
  publicationsActivesPourEssai: 'crochet d\'essai voulu de deploy.ts (08/10/2026) : les tests fabriquent des publications actives',
  remplacerLeDehorsPourEssai: 'crochet d\'essai voulu de surveillance-wordpress.ts (08/10/2026) : les tests remplacent l\'accès extérieur',
  arreterRelaisChat: 'arrêt du relais voulu pour les tests de relais-chat.ts (« Pour les tests », 08/10/2026)',
  adresseDuRelaisChat: 'lecture de l\'adresse du relais, voulue pour les tests de relais-chat.ts (08/10/2026)',
  outilDUnServeurBranche: 'règle qui fonde le contrôle de complétude des outils (cadrage-tools.test.ts, outil-natif.test.ts) ; plus aucun appelant de production depuis le retrait de outilsNatifsDuMoteur (08/10/2026)',
  oublierToutesLesSeries: 'remise à zéro voulue pour les tests de proposition-competences.ts (08/10/2026)',
  piecesDuDepotARetirer: 'règle du nettoyage ponctuel scripts/nettoyer-captures-du-depot.mjs (17/10/2026), qui la charge depuis shared/dist — un script .mjs que le détecteur ne lit pas',
  imposerLesOutilsDeReparation: 'crochet d\'essai voulu de reparation-publication.ts (19/10/2026) : lu par reparation-silencieuse-bout-en-bout.test.ts, jamais posé en service',
  remplacerAdaptateur: 'crochet d\'essai voulu de reseaux/index.ts (19/10/2026) : pour les essais seuls, lu par publication-sociale.test.ts',
  remplacerLaRelance: 'crochet d\'essai voulu de veille-de-carte.ts (20/10/2026) : veille-de-carte.test.ts remplace la relance de l\'agent, jamais posé en service',
};

/** Un fichier de test : dossier de tests du serveur, `*.test.*`. */
function estUnTest(relatif) {
  return /(^|\/)test\//.test(relatif) || /\.test\.[cm]?[jt]sx?$/.test(relatif);
}

function listerFichiersSuivis(extensionsAcceptees) {
  return FICHIERS_SUIVIS
    .split('\n')
    .filter((fichier) => fichier && extensionsAcceptees.has(path.extname(fichier)))
    .map((fichier) => path.join(RACINE, fichier));
}

/**
 * Retire les commentaires `//` et `/* *\/` d'un source, en sautant les chaînes ('…', "…") et les
 * gabarits (`…`) : une URL « https://… » ou un « /* » dans une chaîne ne sont pas des commentaires.
 * Les fins de ligne sont gardées. Un littéral de regex contenant un guillemet peut dérégler le
 * saut de chaîne ; le contrôle sur tout le dépôt le montrerait par de faux « morts ».
 */
function sansCommentaires(source) {
  let sortie = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const d = source[i + 1];
    if (c === '/' && d === '/') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') sortie += '\n';
        i++;
      }
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== c) {
        if (source[j] === '\\') j++;
        else if (c !== '`' && source[j] === '\n') break;
        j++;
      }
      sortie += source.slice(i, j + 1);
      i = j + 1;
    } else {
      sortie += c;
      i++;
    }
  }
  return sortie;
}

const FICHIERS_SUIVIS = execFileSync('git', ['ls-files'], { cwd: RACINE, encoding: 'utf8' });

/* ------------------------------------------------------------------ */
/* 1. Relever chaque export déclaré dans shared/src, server/src, web/src */
/* ------------------------------------------------------------------ */

const declarations = [];
for (const dossier of DOSSIERS_DECLARATIONS) {
  const base = path.join(RACINE, dossier);
  if (!fs.existsSync(base)) continue;
  for (const fichier of listerFichiersSuivis(EXTENSIONS_DECLARATION).filter((chemin) => chemin.startsWith(`${base}${path.sep}`))) {
    const lignes = fs.readFileSync(fichier, 'utf8').split('\n');
    lignes.forEach((ligne, index) => {
      const trouve = RE_DECLARATION.exec(ligne);
      if (trouve) declarations.push({ nom: trouve[1], fichier: path.relative(RACINE, fichier), ligne: index + 1 });
    });
  }
}

/* ------------------------------------------------------------------ */
/* 2. Lire tout le dépôt une seule fois, pour chercher chaque nom dedans */
/* ------------------------------------------------------------------ */

const fichiersDuDepot = listerFichiersSuivis(EXTENSIONS_APPEL);
const contenus = fichiersDuDepot.map((chemin) => fs.readFileSync(chemin, 'utf8'));

const fichiersDeclarants = new Set(declarations.map((d) => d.fichier));
/** Pour chaque fichier déclarant : ses mots comptés SANS ses commentaires. */
const motsDuCodeDeclarant = new Map();
const occurrencesParNom = new Map();
/** Pour chaque nom : les fichiers où il apparaît, avec son nombre d'occurrences par fichier. */
const fichiersParNom = new Map();
const RE_MOT = /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g;
contenus.forEach((contenu, index) => {
  const relatif = path.relative(RACINE, fichiersDuDepot[index]);
  if (fichiersDeclarants.has(relatif)) {
    const mots = new Map();
    for (const m of sansCommentaires(contenu).matchAll(RE_MOT)) mots.set(m[0], (mots.get(m[0]) ?? 0) + 1);
    motsDuCodeDeclarant.set(relatif, mots);
  }
  for (const trouve of contenu.matchAll(RE_MOT)) {
    occurrencesParNom.set(trouve[0], (occurrencesParNom.get(trouve[0]) ?? 0) + 1);
    const parFichier = fichiersParNom.get(trouve[0]) ?? new Map();
    parFichier.set(relatif, (parFichier.get(relatif) ?? 0) + 1);
    fichiersParNom.set(trouve[0], parFichier);
  }
});

/* ------------------------------------------------------------------ */
/* 3. Juger : un export dont le nom n'apparaît QU'à sa propre ligne est mort */
/* ------------------------------------------------------------------ */

/** Occurrences d'un nom dans le dépôt, le fichier déclarant étant lu sans ses commentaires. */
function occurrencesDe(decl) {
  let total = 0;
  for (const [relatif, n] of fichiersParNom.get(decl.nom) ?? []) {
    total += relatif === decl.fichier ? (motsDuCodeDeclarant.get(relatif)?.get(decl.nom) ?? 0) : n;
  }
  return total;
}

const morts = [];
for (const decl of declarations) {
  if (EXCEPTIONS[decl.nom]) continue;
  if (occurrencesDe(decl) <= 1) morts.push(decl);
}

/* Second jugement : une FONCTION dont tous les autres fichiers sont des tests. */
const RE_FONCTION = /^export\s+(?:async\s+)?function\b/;
const testSeuls = [];
for (const decl of declarations) {
  if (EXCEPTIONS[decl.nom] || EXCEPTIONS_TEST_SEUL[decl.nom]) continue;
  if (occurrencesDe(decl) <= 1) continue; // déjà jugée morte plus haut
  const ligneDecl = fs.readFileSync(path.join(RACINE, decl.fichier), 'utf8').split('\n')[decl.ligne - 1];
  if (!RE_FONCTION.test(ligneDecl)) continue;
  const parFichier = fichiersParNom.get(decl.nom) ?? new Map();
  const ailleurs = [...parFichier.entries()].filter(([relatif, n]) => relatif !== decl.fichier || (motsDuCodeDeclarant.get(relatif)?.get(decl.nom) ?? n) > 1);
  // Dans son propre fichier, une occurrence de plus que la déclaration est un appel interne.
  if (ailleurs.length && ailleurs.every(([relatif]) => relatif !== decl.fichier && estUnTest(relatif))) testSeuls.push(decl);
}

console.log('\nEXPORTS MORTS\n');
console.log(`  ${declarations.length} export(s) déclaré(s) dans shared/src, server/src et web/src.`);
console.log(`  ${Object.keys(EXCEPTIONS).length + Object.keys(EXCEPTIONS_TEST_SEUL).length} exception(s) motivée(s), jamais jugée(s).`);

if (testSeuls.length) {
  console.log(`\n ÉCHEC ${testSeuls.length} fonction(s) exportée(s) appelée(s) seulement par des tests :\n`);
  for (const m of testSeuls) console.log(`   - ${m.nom} — ${m.fichier}:${m.ligne}`);
  console.log(
    "\n  Retire la fonction et ses assertions, ou ajoute-la à EXCEPTIONS_TEST_SEUL avec un motif si " +
      "c'est un crochet d'essai voulu.\n",
  );
}

if (morts.length) {
  console.log(`\n ÉCHEC ${morts.length} export(s) sans aucun appelant ailleurs qu'à leur propre déclaration :\n`);
  for (const m of morts) console.log(`   - ${m.nom} — ${m.fichier}:${m.ligne}`);
  console.log(
    "\n  Retire le symbole et son code associé, ou ajoute-le à EXCEPTIONS ci-dessus avec un motif si " +
      'il doit rester sans appelant (travail interrompu, chantier en cours…).\n',
  );
}

if (morts.length || testSeuls.length) process.exit(1);

console.log('\n  OK   aucun export mort.\n');
process.exit(0);
