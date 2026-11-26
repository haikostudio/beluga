#!/usr/bin/env node
/**
 * DEUX PALETTES, NOIR ET BLANC, VÉRIFIÉES À LA SOURCE ET AU NAVIGATEUR.
 *
 * Depuis la refonte minimaliste (11/10/2026) l'application n'a plus qu'UNE
 * apparence, déclinée en clair et en sombre, et elle est MONOCHROME : seules
 * les icônes des projets gardent leur couleur, et le rouge reste réservé à
 * l'erreur et au geste qui détruit. Les six ambiances et leurs douze palettes
 * ont disparu ; ce contrôle a suivi.
 *
 * La première moitié ne LIT que du texte : les deux blocs de jetons de
 * `web/src/styles.css`, le catalogue de `shared/src/themes.ts` et les écrans de
 * `web/src`. Elle refuse :
 *
 *  1. un jeton déclaré dans une palette et pas dans l'autre ;
 *  2. un jeton de COULEUR — toute teinte autre que le gris, hors `--danger`,
 *     les teintes vives du graphe de la mémoire (`--graphe-*`, exception du
 *     2026-10-20, portée par ce seul écran),
 *     `--comprehension` (le jaune du badge d'une carte à la Compréhension),
 *     `--cadre-question` (le jaune du cadre de chaque question, 25/10/2026) et `--teinte`, la seule couleur de l'interface, portée par le texte du
 *     bandeau posé sous le champ d'écriture et par l'élément CHOISI d'une
 *     liste de choix (liste déroulante, menu, onglets, ligne ouverte) ;
 *  3. des fonds mal étagés : sans bordure, ce sont eux qui séparent les zones ;
 *  4. un texte illisible sur son fond ;
 *  5. une couleur écrite EN DUR dans un écran ;
 *  6. un aperçu du catalogue qui ne dit pas la vérité sur les jetons du thème ;
 *  7. un nom de couleur de Tailwind sans jeton derrière lui ;
 *  8. un bloc de jetons pour le mode automatique, qui n'est pas une palette, ou
 *     un second endroit qui pose le thème.
 *
 * La seconde moitié demande au NAVIGATEUR ce qu'il affiche vraiment, en clair
 * puis en sombre : le fond calculé de la page vaut bien le jeton, et AUCUN
 * élément de l'écran ne porte une couleur — texte, fond ou trait — hors des
 * icônes de projet et du rouge d'erreur. Elle fabrique une session d'une heure,
 * la retire en partant, et n'écrit rien d'autre en base : la clarté est forcée
 * sur la page, jamais enregistrée. (Le choix « suivre le système » et la
 * relecture des anciens réglages sont jugés par `server/src/test/themes.test.ts`.)
 *
 *   HAIKO_THEMES_URL=http://localhost:7099 node scripts/verif-themes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';
import { poserSessionDEssai } from './lib/session-d-essai.mjs';

/* La racine se déduit du script : lancé d'une copie de travail, il juge CE
   code-là, jamais le dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = path.join(RACINE, 'web/src/styles.css');
const CATALOGUE = path.join(RACINE, 'shared/src/themes.ts');
const TAILWIND = path.join(RACINE, 'web/tailwind.config.js');
const ECRANS = path.join(RACINE, 'web/src');

const echecs = [];
const constats = [];
const refuser = (message) => echecs.push(message);
const constater = (message) => constats.push(message);

/* ------------------------------------------------------------------ */
/* Lire les blocs de jetons                                           */
/* ------------------------------------------------------------------ */

/** Les deux palettes et le sélecteur qui les porte, dans leur ordre d'écriture. */
const BLOCS = [
  { id: 'sombre', selecteur: ':root', sombre: true },
  { id: 'clair', selecteur: 'html:not(.dark)', sombre: false },
];

const css = fs.readFileSync(CSS, 'utf8');

/** Les jetons d'un bloc, `--nom` → valeur, commentaires retirés. */
function jetonsDuBloc(selecteur) {
  const debut = css.indexOf(`${selecteur} {`);
  if (debut < 0) return null;
  const fin = css.indexOf('\n  }', debut);
  if (fin < 0) return null;
  const corps = css.slice(debut, fin).replace(/\/\*[\s\S]*?\*\//g, '');
  const jetons = {};
  for (const ligne of corps.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    jetons[ligne[1]] = ligne[2].trim();
  }
  return jetons;
}

for (const bloc of BLOCS) {
  bloc.jetons = jetonsDuBloc(bloc.selecteur);
  if (!bloc.jetons) refuser(`le bloc de jetons du thème « ${bloc.id} » (${bloc.selecteur}) est introuvable`);
}

/* Plus aucune palette nommée : un bloc `html[data-theme='…']` de jetons serait une troisième apparence. */
const blocsEnTrop = [...css.matchAll(/html\[data-theme=['"]([a-z-]+)['"]\]\s*\{/g)].map((trouve) => trouve[1]);
if (blocsEnTrop.length) {
  refuser(`web/src/styles.css : des palettes nommées subsistent (${[...new Set(blocsEnTrop)].join(', ')}) — il n'y en a plus que deux, clair et sombre`);
}

if (echecs.length) {
  for (const message of echecs) console.error(`  ✗ ${message}`);
  process.exit(1);
}

const reference = BLOCS[0];
/* Les alias ne sont pas des teintes : ils renvoient à un autre jeton. */
const ALIAS = new Set(['--intensite-calme', '--intensite-chargee']);

/* ------------------------------------------------------------------ */
/* 1. Aucun jeton ne manque                                           */
/* ------------------------------------------------------------------ */

const attendus = Object.keys(reference.jetons);
for (const bloc of BLOCS.slice(1)) {
  const manquants = attendus.filter((nom) => !ALIAS.has(nom) && !(nom in bloc.jetons));
  if (manquants.length) refuser(`thème « ${bloc.id} » : jetons manquants — ${manquants.join(', ')}`);
  const inconnus = Object.keys(bloc.jetons).filter((nom) => !attendus.includes(nom));
  if (inconnus.length) refuser(`thème « ${bloc.id} » : jetons que le thème sombre ne déclare pas — ${inconnus.join(', ')}`);
}
constater(`${attendus.length} jetons déclarés par chacune des deux palettes`);

/* ------------------------------------------------------------------ */
/* 2. Noir et blanc : aucun jeton de couleur                          */
/* ------------------------------------------------------------------ */

/** La saturation et la luminosité d'un jeton `H S% L%`, ou `null` si ce n'en est pas un. */
function teinte(valeur) {
  const trouve = /^-?[\d.]+\s+([\d.]+)%\s+([\d.]+)%/.exec(valeur ?? '');
  return trouve ? { saturation: Number(trouve[1]), luminosite: Number(trouve[2]) } : null;
}
const luminosite = (valeur) => teinte(valeur)?.luminosite ?? null;

/* Le rouge reste : il dit l'erreur et le geste qui détruit, rien d'autre.
   Le VIOLET est la SEULE autre teinte (demande du 11/10/2026 : « la seule
   couleur qu'on a dans l'application, avec parcimonie ») : un seul jeton, deux
   usages — ce que l'agent est en train de faire, et l'élément choisi. */
const JETONS_DU_GRAPHE = ['--graphe-1', '--graphe-2', '--graphe-3', '--graphe-4', '--graphe-5', '--graphe-6', '--graphe-competence'];
const JETONS_EN_COULEUR = new Set([
  '--danger',
  /* LE BLEU FRANC DE L'IMPORTANT (14/11/2026) : la seule teinte de l'interface avec le rouge — vérifié plus bas. */
  '--important',
  '--important-fond',
  '--important-trait',
  '--a-surveiller',
  '--teinte',
  '--teinte-fond',
  '--teinte-trait',
  '--teinte-plein',
  /* Le JAUNE du badge « Compréhension » (demande du 18/10/2026) : son seul usage. */
  '--comprehension',
  '--comprehension-fond',
  '--comprehension-trait',
  /* Le JAUNE du cadre de chaque question (demande du 25/10/2026) : la bordure
     de `.cadre-de-question`, et rien d'autre. */
  '--cadre-question',
  /* Les ONDES DE JARVIS (16/11/2026) : jaune quand l'utilisateur parle, bleu quand Jarvis parle — la seule barre
     d'ondes du volet de l'assistant en mode voix. */
  '--voix-vous',
  '--voix-jarvis',
  /* Les BULLES de Jarvis (17/11/2026) : leur bleu et leur texte, blanc en sombre, noir en clair. */
  '--bulle-jarvis',
  '--bulle-jarvis-texte',
  /* Le VERT du rond « terminé » des icônes de projet (16/11/2026). */
  '--etat-termine',
  /* Le TÉMOIN DU SERVEUR en tête de colonne (décision du 18/11/2026) : gris-vert quand le lien tient, orange au
     redémarrage — porté par `[data-temoin-serveur]` seul (`temoin-du-serveur.tsx`). */
  '--temoin-stable',
  '--temoin-redemarrage',
  /* LA BANNIÈRE ORANGE d'une extension Chrome en retard (choix de l'utilisateur du 20/11/2026), portée par
     `[data-banniere-extension]` seule (`banniere-extension.tsx`). */
  '--banniere-a-faire',
  '--banniere-a-faire-texte',
  /* …et le texte BLANC de son bouton noir (décision de l'utilisateur, 20/11/2026). */
  '--banniere-a-faire-bouton-texte',
  /* La bande NOIRE d'information et son texte blanc (carte « Fin de la version gratuite », 21/11/2026) :
     `[data-bande-du-haut="information"]` (`bande-du-haut.tsx`). */
  '--banniere-info',
  '--banniere-info-texte',
  /* Le VERT de ce qui est prêt (demande du 01/11/2026) : le badge d'état d'un agent et
     le rond de statut de la colonne — vérifié plus bas, porteurs en liste fermée. */
  '--pret',
  '--pret-fond',
  '--pret-trait',
  /* LES TÊTES DE COLONNES DE L'ESPACE CLIENT (demande du 08/11/2026, capture #12cb) : gris, bleu, vert, vert — portées
     par la tête de colonne et sa silhouette seules, vérifié plus bas. */
  '--colonne-bleu',
  '--colonne-bleu-fond',
  '--colonne-vert',
  '--colonne-vert-fond',
  '--colonne-gris-fond',
  /* LES TEINTES DU GRAPHE DE LA MÉMOIRE (décision du 2026-10-20) : six familles
     de catégories et le violet des compétences, vives et bien distinctes,
     pour le seul graphe (`memoire-graphe.tsx`) — vérifiées plus bas. */
  ...JETONS_DU_GRAPHE,
]);
for (const bloc of BLOCS) {
  for (const [nom, valeur] of Object.entries(bloc.jetons)) {
    const lue = teinte(valeur);
    if (!lue || JETONS_EN_COULEUR.has(nom)) continue;
    if (lue.saturation !== 0) refuser(`thème « ${bloc.id} » : ${nom} vaut ${valeur} — une couleur, l'interface est noir et blanc`);
  }
  /* L'AVANCEMENT EST GRIS (DEC-534) : « en cours » et « terminé » ne portent plus aucune teinte — ni orange, ni bleu. */
  for (const nom of ['--en-cours', '--termine']) {
    const lue = teinte(bloc.jetons[nom]);
    if (!lue) refuser(`thème « ${bloc.id} » : ${nom} n'est pas déclaré`);
    else if (lue.saturation !== 0) refuser(`thème « ${bloc.id} » : ${nom} vaut ${bloc.jetons[nom]} — l'avancement est gris (DEC-534)`);
  }
  const rouge = teinte(bloc.jetons['--danger']);
  if (!rouge || rouge.saturation < 40) refuser(`thème « ${bloc.id} » : --danger ne se distingue plus d'un gris — une erreur ne se verrait plus`);
}
/* PLUS DE VIOLET NI DE VERT (décision de l'utilisateur du 14/11/2026 : « monochrome noir anthracite / blanc gris, seules
   les choses importantes en orange ») : `--teinte` (l'élément choisi, ce que l'agent fait) et `--pret` (ce qui est prêt)
   sont des GRIS ; le BLEU FRANC de l'important (`--important`) est la seule teinte de l'interface, avec le rouge de l'erreur.
   Le badge « à vous » (`--comprehension`) et le cadre des questions (`--cadre-question`) le reprennent. */
for (const bloc of BLOCS) {
  for (const nom of ['--teinte', '--teinte-fond', '--teinte-trait', '--teinte-plein', '--pret', '--pret-fond', '--pret-trait']) {
    const valeur = bloc.jetons[nom] ?? '';
    const lue = teinte(valeur);
    if (!lue) refuser(`thème « ${bloc.id} » : ${nom} n'est pas déclaré`);
    else if (lue.saturation !== 0) refuser(`thème « ${bloc.id} » : ${nom} vaut ${valeur} — ce doit être un gris (plus de violet ni de vert)`);
    else if (/-(fond|trait)$/.test(nom) && !/\/\s*[\d.]+$/.test(valeur)) refuser(`thème « ${bloc.id} » : ${nom} doit porter son alpha dans le jeton`);
  }
  /* LE BLEU FRANC DE L'IMPORTANT (15/11/2026, capture #ae883) : #4C9AFF en sombre, #1F6FEB en clair. Seul le CADRE
     des questions revient au JAUNE franc (MEM-5819). */
  const LES_TEINTES = [
    ...['--important', '--important-fond', '--important-trait', '--comprehension', '--comprehension-fond', '--comprehension-trait'].map((nom) => [nom, 205, 225, 'le bleu franc de l’important (teinte 205–225°)']),
    ['--cadre-question', 40, 55, 'le jaune franc du cadre des questions (teinte 40–55°)'],
    ['--etat-termine', 120, 160, 'le vert du rond « terminé » (teinte 120–160°)'],
  ];
  for (const [nom, de, a, quoi] of LES_TEINTES) {
    const valeur = bloc.jetons[nom] ?? '';
    const lue = teinte(valeur);
    const ton = Number(/^-?[\d.]+/.exec(valeur)?.[0]);
    if (!lue) refuser(`thème « ${bloc.id} » : ${nom} n'est pas déclaré`);
    else if (!(ton >= de && ton <= a) || lue.saturation < 60) refuser(`thème « ${bloc.id} » : ${nom} vaut ${valeur} — ce doit être ${quoi}, distinct du rouge de l'erreur`);
  }
}
constater('le violet et le vert sont devenus des gris ; le bleu de l’important et le jaune du cadre des questions sont déclarés en clair et en sombre');

/* LES TÊTES DE COLONNES DE L'ESPACE CLIENT (08/11/2026) : déclarées en clair et en sombre, et portées par la tête de
   colonne (et sa silhouette) seules — l'exception ne déborde pas sur le reste de l'interface. */
for (const bloc of BLOCS) {
  for (const nom of ['--colonne-bleu', '--colonne-bleu-fond', '--colonne-vert', '--colonne-vert-fond', '--colonne-gris-fond']) {
    if (!teinte(bloc.jetons[nom] ?? '')) refuser(`thème « ${bloc.id} » : ${nom} n'est pas déclaré`);
  }
}
{
  const ADMIS = new Set(['web/src/styles.css', 'web/src/espace/colonne-demandes.tsx', 'web/src/components/silhouettes.tsx']);
  const porteurs = [];
  const parcourir = (dossier) => {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) parcourir(chemin);
      else if (/\.(tsx?|css)$/.test(entree.name) && /-colonne-(bleu|vert|gris)/.test(fs.readFileSync(chemin, 'utf8'))) porteurs.push(path.relative(RACINE, chemin));
    }
  };
  parcourir(ECRANS);
  const intrus = porteurs.filter((chemin) => !ADMIS.has(chemin));
  if (intrus.length) refuser(`les teintes des têtes de colonnes de l'espace client sont reprises ailleurs — ${intrus.join(', ')}`);
}
constater('les teintes des têtes de colonnes de l’espace client sont déclarées en clair et en sombre, et portées par ces têtes seules');

/* LE GRAPHE DE LA MÉMOIRE, EXCEPTION VOULUE ET BORNÉE : ses teintes sont
   VIVES (saturation d'au moins 60 %, demande du 2026-10-20 : « plus flashies,
   qui se distinguent mieux »), déclarées dans les deux palettes, et un seul
   écran les porte. Le violet des compétences reste un violet. */
for (const bloc of BLOCS) {
  for (const nom of JETONS_DU_GRAPHE) {
    const lue = teinte(bloc.jetons[nom]);
    if (!lue) refuser(`thème « ${bloc.id} » : ${nom} n'est pas déclaré`);
    else if (lue.saturation < 60) refuser(`thème « ${bloc.id} » : ${nom} vaut ${bloc.jetons[nom]} — une teinte du graphe reste vive (saturation d'au moins 60 %)`);
  }
  const ton = Number(/^-?[\d.]+/.exec(bloc.jetons['--graphe-competence'] ?? '')?.[0]);
  if (!(ton >= 245 && ton <= 290)) refuser(`thème « ${bloc.id} » : --graphe-competence doit rester un violet`);
}
{
  const ADMIS_DU_GRAPHE = new Set(['web/src/styles.css', 'web/src/components/memoire-graphe.tsx']);
  const porteurs = [];
  const parcourir = (dossier) => {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) parcourir(chemin);
      else if (/\.(tsx?|css)$/.test(entree.name) && /--graphe-|FAMILLES_DU_GRAPHE/.test(fs.readFileSync(chemin, 'utf8'))) porteurs.push(path.relative(RACINE, chemin));
    }
  };
  parcourir(ECRANS);
  const intrus = porteurs.filter((chemin) => !ADMIS_DU_GRAPHE.has(chemin));
  if (intrus.length) refuser(`les teintes du graphe de la mémoire sont reprises hors du graphe — ${intrus.join(', ')}`);
}
constater('les teintes du graphe de la mémoire restent vives, déclarées en clair et en sombre, et portées par le seul graphe');

/* LE BLEU FRANC DE L'IMPORTANT, AVEC PARCIMONIE (14/11/2026) : les liens, le cadre des questions, ce qui attend
   l'utilisateur (« à vous »), les alertes, ce qui a changé dans une compréhension, et le texte de l'élément ACTIF de la
   colonne de gauche. La liste des porteurs est FERMÉE : un nouvel usage s'ajoute ICI, après décision. */
{
  const porteurs = [];
  const parcourir = (dossier) => {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) parcourir(chemin);
      else if (/\.(tsx?|css)$/.test(entree.name) && /(^|[^\w-])(text|bg|border|fill|stroke|ring|decoration)-important\b|--important\b/.test(fs.readFileSync(chemin, 'utf8'))) {
        porteurs.push(path.relative(RACINE, chemin));
      }
    }
  };
  parcourir(ECRANS);
  const admis = new Set([
    'web/src/styles.css',
    // Les liens du texte.
    'web/src/lib/markdown.tsx',
    // L'actif de la colonne de gauche : le projet, le service, la tâche ouverte, et son repère.
    'web/src/components/sidebar.tsx',
    'web/src/components/services-de-la-colonne.tsx',
    'web/src/components/ui/index.tsx',
    // Ce qui attend l'utilisateur : le point « à vous » et l'icône de la question.
    'web/src/components/liste-des-agents.tsx',
    // Le parcours du référencement : l'étape qui attend l'utilisateur (décision du 21/11/2026, maquette #ff75).
    'web/src/components/marketing-2/volet-referencement.tsx',
    // Les agents personnalisés : ce qui attend un geste (« À valider », le point du matin, le journal), et rien d'autre
    // (décision du cahier des charges, carte « Agents personnalisés dans les projets », 24/11/2026).
    'web/src/components/agents-du-projet.tsx',
    'web/src/components/page-de-l-agent.tsx',
  ]);
  const intrus = porteurs.filter((chemin) => !admis.has(chemin));
  if (intrus.length) refuser(`le bleu franc de l'important est repris hors de ses porteurs décidés — ${intrus.join(', ')}`);
}
constater('le bleu de l’important n’est porté que par ses usages décidés');

/* ------------------------------------------------------------------ */
/* 3. Des fonds étagés : sans bordure, ce sont eux qui séparent       */
/* ------------------------------------------------------------------ */

/** Un palier de fond : assez pour se lire, assez peu pour ne pas trancher. */
/* DES GRIS PLUS PROCHES (décision de l'utilisateur du 14/11/2026, « encore moins de contraste au niveau des gris
   blancs ») : le plus petit palier passe de 2 à 1,5 point — les fonds restent distincts, à peine. */
const PALIER_MIN = 1.5;
const PALIER_MAX = 8;
for (const bloc of BLOCS) {
  const fonds = ['--bg', '--surface', '--raised'].map((nom) => luminosite(bloc.jetons[nom]));
  for (let rang = 1; rang < fonds.length; rang += 1) {
    const ecart = Math.abs(fonds[rang] - fonds[rang - 1]);
    if (ecart < PALIER_MIN || ecart > PALIER_MAX) {
      refuser(`thème « ${bloc.id} » : ${ecart.toFixed(1)} points entre deux fonds voisins (entre ${PALIER_MIN} et ${PALIER_MAX} attendus)`);
    }
  }
  /* La bordure ne dessine plus rien : elle se confond avec les fonds. */
  const trait = luminosite(bloc.jetons['--border']);
  const plusProche = Math.min(...fonds.map((fond) => Math.abs(fond - trait)));
  if (plusProche > 4) refuser(`thème « ${bloc.id} » : --border tranche encore de ${plusProche.toFixed(1)} points sur les fonds`);
}
constater('trois fonds étagés par palette, et une bordure qui ne dessine plus rien');

/*
 * LE SURVOL A SA PROPRE MARCHE, AU-DESSUS DES TROIS FONDS (demande du
 * 26/10/2026 : une ligne du bloc « Configuration de l'agent » survolée prenait
 * la couleur exacte du bloc et disparaissait). `--fond-survol` s'écarte de
 * `--raised` d'au moins 4 points, à l'opposé de la page ; et aucun écran ne
 * survole en `--border`, qui se confond avec les fonds par construction (il
 * fonçait en sombre et ne se voyait plus en clair).
 */
for (const bloc of BLOCS) {
  const page = luminosite(bloc.jetons['--bg']);
  const relief = luminosite(bloc.jetons['--raised']);
  const survol = luminosite(bloc.jetons['--fond-survol']);
  if (survol === null) {
    refuser(`thème « ${bloc.id} » : --fond-survol manque`);
    continue;
  }
  const marche = (survol - relief) * Math.sign(relief - page);
  /* 2 points depuis les gris adoucis du 14/11/2026 (4 avant) : le survol reste une marche franche au-dessus du relief. */
  if (marche < 2) refuser(`thème « ${bloc.id} » : --fond-survol ne s'écarte de --raised que de ${marche.toFixed(1)} points, à l'opposé de la page (2 attendus)`);
}
for (const fichier of ecrans(ECRANS)) {
  const texte = fs.readFileSync(fichier, 'utf8');
  if (/hover:bg-border\b/.test(texte)) {
    refuser(`${path.relative(RACINE, fichier)} : un survol en \`hover:bg-border\` — il se confond avec les fonds, prendre \`hover:bg-fond-survol\``);
  }
}
/* Et `hover:bg-raised` posé SUR un bloc `bg-raised` monte d'une marche (styles.css, fin). */
if (!/\[class~='bg-raised'\] > \*\s*\{\s*--survol-sur-support:\s*var\(--fond-survol\)/.test(css) || !/html \[class~='hover:bg-raised'\]:hover/.test(css)) {
  refuser("web/src/styles.css : la règle qui fait monter `hover:bg-raised` d'une marche sur un bloc `bg-raised` a disparu");
}
constater('un survol a sa marche au-dessus des trois fonds, et aucun écran ne survole en couleur de trait');

/* ------------------------------------------------------------------ */
/* 4. Le texte reste lisible sur ses fonds                            */
/* ------------------------------------------------------------------ */

const LISIBILITE = { '--text': 60, '--muted': 45, '--faint': 30 };
for (const bloc of BLOCS) {
  for (const [jeton, minimum] of Object.entries(LISIBILITE)) {
    const encre = luminosite(bloc.jetons[jeton]);
    for (const nomDuFond of ['--bg', '--surface', '--raised']) {
      const fond = luminosite(bloc.jetons[nomDuFond]);
      const ecart = Math.abs(encre - fond);
      if (ecart < minimum) {
        refuser(`thème « ${bloc.id} » : ${jeton} sur ${nomDuFond} ne fait que ${ecart} points d'écart (${minimum} attendus)`);
      }
    }
  }
}
constater('texte, texte discret et texte pâle lisibles sur les trois fonds des deux palettes');

/* ------------------------------------------------------------------ */
/* 5. Aucune couleur écrite en dur dans un écran                      */
/* ------------------------------------------------------------------ */

const FAMILLES =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black';
/* Une valeur entre crochets n'est pas fautive en soi : `border-[hsl(var(--x))]`
   passe bien par un jeton. Ce qu'on refuse, c'est une couleur LITTÉRALE — un
   dièse, ou une fonction de couleur suivie d'un chiffre au lieu d'un `var()`. */
const EN_DUR = new RegExp(
  `(?:bg|text|border|from|to|via|ring|fill|stroke|divide|outline|caret|decoration|shadow)-(?:${FAMILLES})\\b` +
    `|(?:bg|text|border|fill|stroke|ring|from|to)-\\[(?:#|(?:rgb|hsl|oklch|lab|color)a?\\(\\s*[\\d.])`,
  'g',
);

function ecrans(dossier) {
  const trouves = [];
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) trouves.push(...ecrans(chemin));
    else if (/\.tsx?$/.test(entree.name)) trouves.push(chemin);
  }
  return trouves;
}

/* LE BLANC ET LE NOIR DE DESSIN ne sont pas des couleurs d'interface. Dans
   l'atelier du studio, poignées et repères se posent sur une image quelconque
   et doivent s'y lire quelle que soit la palette ; la visionneuse affiche une
   page web sur son fond blanc. Toute AUTRE couleur y reste refusée. */
const BLANC_ET_NOIR_DE_DESSIN = [
  /^web\/src\/components\/studio\//,
  /^web\/src\/components\/visionneuse-de-lien\.tsx$/,
  /* Le cadre et les poignées de recadrage, posés SUR la photo (28/10/2026). */
  /^web\/src\/components\/creation\/studio-photo\.tsx$/,
  /* Le cadre de l'aperçu d'un site : une page web, sur son fond blanc, comme la visionneuse. */
  /^web\/src\/components\/volet-apercu\.tsx$/,
];

let fichiersLus = 0;
for (const fichier of ecrans(ECRANS)) {
  fichiersLus += 1;
  const texte = fs.readFileSync(fichier, 'utf8');
  const dessin = BLANC_ET_NOIR_DE_DESSIN.some((motif) => motif.test(path.relative(RACINE, fichier)));
  for (const trouve of texte.matchAll(EN_DUR)) {
    if (dessin && /-(?:white|black)$/.test(trouve[0])) continue;
    const ligne = texte.slice(0, trouve.index).split('\n').length;
    refuser(
      `${path.relative(RACINE, fichier)}:${ligne} : couleur écrite en dur « ${trouve[0]} » — ` +
        `elle ne suivra ni le clair ni le sombre`,
    );
  }
}
constater(`${fichiersLus} écrans relus, aucune couleur écrite en dur`);

/* Et l'alpha du jeton `--controle` vit DANS le jeton : y ajouter une part par
   Tailwind (`bg-controle/50`) produirait un `hsl()` invalide, donc un fond perdu. */
for (const fichier of ecrans(ECRANS)) {
  const texte = fs.readFileSync(fichier, 'utf8');
  if (/\b(?:bg|text|border)-controle\//.test(texte)) {
    refuser(`${path.relative(RACINE, fichier)} : « controle » porte déjà son alpha, on ne lui en ajoute pas`);
  }
}

/* ------------------------------------------------------------------ */
/* 6. L'aperçu du catalogue dit la vérité                             */
/* ------------------------------------------------------------------ */

const catalogue = fs.readFileSync(CATALOGUE, 'utf8');
/* L'aperçu montre, dans cet ordre : le fond de page, la teinte de la ligne
   active, l'accent, le texte — les jetons qui portent l'ambiance, jamais
   le gris « en cours » commun aux douze palettes. */
const JETONS_DE_L_APERCU = ['--bg', '--ligne-active', '--accent', '--text'];

for (const bloc of BLOCS) {
  const fiche = new RegExp(`id:\\s*'${bloc.id}'[\\s\\S]*?apercu:\\s*\\[([^\\]]+)\\]`).exec(catalogue);
  if (!fiche) {
    refuser(`shared/src/themes.ts : aucun aperçu pour le thème « ${bloc.id} »`);
    continue;
  }
  const couleurs = [...fiche[1].matchAll(/'([^']+)'/g)].map((trouve) => trouve[1]);
  if (couleurs.length !== 4) {
    refuser(`thème « ${bloc.id} » : ${couleurs.length} couleurs d'aperçu au lieu de 4`);
    continue;
  }
  couleurs.forEach((couleur, rang) => {
    const jeton = JETONS_DE_L_APERCU[rang];
    const attendu = `hsl(${bloc.jetons[jeton]})`;
    if (couleur !== attendu) {
      refuser(
        `thème « ${bloc.id} » : l'aperçu annonce ${couleur} pour ${jeton}, le thème vaut ${attendu} — ` +
          `un aperçu qui ment est pire que pas d'aperçu`,
      );
    }
  });
}
constater('les pastilles d’aperçu de chaque thème reprennent ses vrais jetons');

/* ------------------------------------------------------------------ */
/* 7. Chaque nom de Tailwind a son jeton                              */
/* ------------------------------------------------------------------ */

const tailwind = fs.readFileSync(TAILWIND, 'utf8');
const noms = [...tailwind.matchAll(/hsl\(var\((--[a-z0-9-]+)\)\)/g)].map((trouve) => trouve[1]);
const orphelins = [...new Set(noms)].filter((nom) => !(nom in reference.jetons));
if (orphelins.length) refuser(`web/tailwind.config.js : noms de couleur sans jeton — ${orphelins.join(', ')}`);
constater(`${new Set(noms).size} noms de couleur de Tailwind adossés à un jeton`);

/* ------------------------------------------------------------------ */
/* 8. L'automatique choisit une CLARTÉ, jamais une palette            */
/* ------------------------------------------------------------------ */

/*
 * Le piège à éviter : refaire du mode automatique un thème à côté des autres.
 * Il garde l'ambiance et ne choisit que sa variante claire ou sombre.
 */
if (
  css.includes("data-theme='systeme'") ||
  css.includes('data-theme="systeme"') ||
  css.includes("data-theme='automatique'") ||
  css.includes('data-theme="automatique"')
) {
  refuser(
    "web/src/styles.css : un bloc de jetons pour le mode automatique — il doit seulement choisir la variante d'une ambiance",
  );
}
if (!/AMBIANCES/.test(catalogue) || !/reglageApparenceValide/.test(catalogue) || !/themeChoisiDepuisReglage/.test(catalogue)) {
  refuser('shared/src/themes.ts : ambiance, clarté et automatique ne sont plus séparés dans le catalogue');
}
/* Et la règle de priorité ne doit pas se recopier dans un écran : un seul juge. */
for (const fichier of ecrans(ECRANS)) {
  const texte = fs.readFileSync(fichier, 'utf8');
  const nom = path.relative(RACINE, fichier);
  if (nom === 'web/src/lib/theme.ts') continue;
  if (/prefers-color-scheme/.test(texte)) {
    refuser(`${nom} : le réglage clair / sombre de l'ordinateur se lit dans web/src/lib/theme.ts, nulle part ailleurs`);
  }
  if (/dataset\.theme\s*=/.test(texte)) {
    refuser(`${nom} : le thème se POSE dans web/src/lib/theme.ts seulement — deux poseurs finissent par se contredire`);
  }
}
constater('le mode automatique n’est pas une palette, et un seul fichier pose le thème');
/* Aucun projet n'impose son apparence : le réglage général vaut partout. */
if (/duProjet/.test(catalogue)) {
  refuser("shared/src/themes.ts : un thème propre à un projet est revenu dans le calcul — le réglage général seul décide");
}
if (/projetOuvert|projet\??\.theme|duProjet/.test(fs.readFileSync(path.join(RACINE, 'web/src/lib/theme.ts'), 'utf8'))) {
  refuser("web/src/lib/theme.ts : le thème d'un projet est relu — le réglage général seul décide");
}
constater('aucun thème propre à un projet : le réglage général vaut pour tous');

/* ------------------------------------------------------------------ */
/* 9. LE NAVIGATEUR : deux palettes, et pas une couleur à l'écran     */
/* ------------------------------------------------------------------ */

const ADRESSE = process.env.HAIKO_THEMES_URL || 'http://localhost:7099';
/* La base et ses dépendances natives vivent dans le dépôt PRINCIPAL, même quand
   ce script est lancé d'une copie de travail. */
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';

/**
 * Une session d'UNE HEURE, fabriquée puis retirée : la colonne `token` garde le
 * SHA-256 du cookie, jamais le cookie. C'est la seule écriture en base de tout ce
 * contrôle, et elle est défaite en partant.
 */
async function avecSession(travail) {
  const session = poserSessionDEssai('vérification des thèmes', {
    chemin: cheminDeLaBaseServie(DONNEES),
  });
  try {
    return await travail(session.cookie);
  } finally {
    session.retirer();
  }
}

/** `rgb(…)` ou `rgba(…)` → ses trois composantes et son opacité. */
const LIRE_UNE_COULEUR = `(valeur) => {
  const trouve = /rgba?\\(([^)]+)\\)/.exec(valeur || '');
  if (!trouve) return null;
  const [r, g, b, a = '1'] = trouve[1].split(/[,/ ]+/).filter(Boolean);
  return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
}`;

async function auNavigateur() {
  const { chromium } = await import('playwright');
  try {
    return await avecSession(async (session) => {
      const navigateur = await chromium.launch({ channel: 'chrome' });
      try {
        const refus = [];
        for (const bloc of BLOCS) {
          const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
          await contexte.addCookies([{ name: 'beluga_session', value: session, domain: new URL(ADRESSE).hostname, path: '/' }]);
          /* LA CLARTÉ EST FORCÉE SUR LA PAGE, jamais enregistrée : le repère du
             premier affichage d'abord, puis les marques que pose l'application. */
          await contexte.addInitScript((clarte) => {
            try {
              window.localStorage.setItem('beluga-theme-flash', clarte);
            } catch {
              /* sans stockage local, la pose d'après suffit */
            }
          }, bloc.id);
          const page = await contexte.newPage();
          /* AUCUNE TRACE : le projet affiché, la carte retenue et « lu » ne partent pas au serveur. */
          await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
            const serveur = ws.connectToServer();
            ws.onMessage((message) => {
              try {
                const lu = JSON.parse(String(message));
                if (['prefs.set', 'card.read', 'project.read'].includes(lu?.cmd?.type ?? lu?.type)) return;
              } catch {
                /* un message qui n'est pas du JSON passe tel quel */
              }
              serveur.send(message);
            });
          });
          try {
            await page.goto(ADRESSE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          } catch (err) {
            return `serveur de développement injoignable sur ${ADRESSE} — ${err.message.split('\n')[0]}`;
          }
          /* ON ATTEND UN ÉTAT, PAS UNE DURÉE : la colonne des projets posée, puis les silhouettes parties. */
          await page.waitForSelector('[data-colonne-projets], [data-zone="centre"]', { timeout: 60_000 }).catch(() => {});
          for (let essai = 0; essai < 40; essai += 1) {
            if (await page.evaluate(() => !document.querySelector('.animate-silhouette'))) break;
            await page.waitForTimeout(500);
          }
          await page.evaluate((clarte) => {
            const racine = document.documentElement;
            racine.dataset.theme = clarte;
            racine.classList.toggle('dark', clarte === 'sombre');
            racine.style.colorScheme = clarte === 'sombre' ? 'dark' : 'light';
          }, bloc.id);
          await page.waitForTimeout(300);

          const lu = await page.evaluate(
            ({ lire }) => {
              const couleur = new Function(`return ${lire}`)();
              const racine = getComputedStyle(document.documentElement);
              /* Ce qui dit « ceci est choisi » à une machine : les états ARIA et les repères des écrans. */
              const CHOISI =
                '[aria-current], [aria-selected="true"], [aria-checked="true"], [aria-pressed="true"], [data-actif], [data-state="active"], [data-choisi="oui"]';
              const fautes = [];
              let juges = 0;
              for (const element of document.querySelectorAll('body *')) {
                /* Les icônes de projet gardent leur couleur : c'est la seule exception voulue. */
                if (element.closest('img, picture, canvas, video, [data-pastille-projet], [data-favicon]')) continue;
                /* Les pastilles de la légende du graphe de la mémoire : l'exception voulue du 2026-10-20. */
                if (element.closest('[data-couleur-du-graphe]')) continue;
                /* Le badge de statut d'une carte : JAUNE à la Compréhension, VIOLET au Travail
                   (demande du 18/10/2026, `badge-etape.tsx`) — ses deux tons sont décidés. */
                if (element.closest('[data-badge-etape]')) continue;
                /* Les ronds d'état des icônes de projet : vert, bleu, jaune (décision du 16/11/2026, capture #7619). */
                if (element.closest('[data-rond-d-etat]')) continue;
                /* Le témoin du serveur en tête de colonne : gris-vert, orange, rouge (décision du 18/11/2026). */
                if (element.closest('[data-temoin-serveur]')) continue;
                /* La bannière orange d'une extension Chrome en retard (décision du 20/11/2026). */
                if (element.closest('[data-bande-du-haut]')) continue;
                /* Le passage automatique d'un agent personnalisé, écrit en jaune (décision du 26/11/2026). */
                if (element.closest('[data-passage-automatique]')) continue;
                const boite = element.getBoundingClientRect();
                if (!boite.width || !boite.height) continue;
                const style = getComputedStyle(element);
                juges += 1;
                for (const propriete of ['color', 'backgroundColor', 'borderTopColor', 'outlineColor', 'fill', 'stroke']) {
                  const c = couleur(style[propriete]);
                  if (!c || c.a === 0) continue;
                  const ecart = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
                  if (ecart <= 10) continue;
                  /* Le rouge de l'erreur : dominante rouge nette. */
                  if (c.r > c.g + 40 && c.r > c.b + 40) continue;
                  /* Le violet : le texte et la roue du bandeau sous le champ d'écriture, ou un
                     élément CHOISI (l'option retenue, l'onglet ouvert, la ligne ouverte) — et eux seuls. */
                  const violet = c.b > c.g + 25 && c.r > c.g;
                  if (violet && element.closest('[data-temoin-reflexion]')) continue;
                  /* L'état « au travail » d'un agent, au coin de l'icône de son projet (Tableaux de bord, colonne et
                     onglets depuis le 14/11/2026) : ce que l'agent fait en ce moment — le premier usage du violet. */
                  if (violet && element.closest('[data-rond-d-etat="travail"]')) continue;
                  if (violet && element.closest(CHOISI)) continue;
                  /* Le point d'alerte de « Voir plus », en bas de la colonne : le point violet de la Messagerie s'y reporte
                     (maquette validée du 14/11/2026, carte « Onglets, services et listes repensés »). */
                  if (violet && element.closest('[data-menu-dossier] [data-alerte-navigation]')) continue;
                  // Le bouton groupé « Tableaux de bord » + services, en tête de la colonne (30/10/2026).
                  if (violet && element.closest('[data-bouton-violet]')) continue;
                  /* Le jaune du cadre d'une question : sa bordure seule (25/10/2026). */
                  if (propriete === 'borderTopColor' && element.classList.contains('cadre-de-question')) continue;
                  fautes.push(`<${element.tagName.toLowerCase()}> ${propriete} ${style[propriete]} — ${String(element.className).slice(0, 70)}`);
                }
              }
              return {
                fond: racine.getPropertyValue('--bg').trim(),
                sombre: document.documentElement.classList.contains('dark'),
                fondDuCorps: getComputedStyle(document.body).backgroundColor,
                juges,
                fautes: [...new Set(fautes)].slice(0, 12),
              };
            },
            { lire: LIRE_UNE_COULEUR },
          );
          if (lu.sombre !== bloc.sombre) refus.push(`« ${bloc.id} » : la page ne porte pas la bonne clarté`);
          if (lu.fond !== bloc.jetons['--bg']) refus.push(`« ${bloc.id} » : --bg vaut « ${lu.fond} » au navigateur, « ${bloc.jetons['--bg']} » dans la feuille`);
          if (lu.juges < 50) refus.push(`« ${bloc.id} » : l'écran n'était pas affiché (${lu.juges} éléments jugés) — rien n'a été mesuré`);
          for (const faute of lu.fautes) refus.push(`« ${bloc.id} » : une couleur à l'écran — ${faute}`);
          constater(`« ${bloc.id} » au navigateur : ${lu.juges} éléments affichés, aucun en couleur hors icônes de projet, rouge d'erreur, bandeau sous le champ d'écriture et élément choisi`);
          await contexte.close();
        }
        return refus;
      } finally {
        await navigateur.close();
      }
    });
  } catch (err) {
    return `session d'essai impossible — ${err.message.split('\n')[0]}`;
  }
}

/* ------------------------------------------------------------------ */
/* Le verdict                                                         */
/* ------------------------------------------------------------------ */

const rendu = await auNavigateur();
if (typeof rendu === 'string') refuser(`le navigateur n'a rien pu juger : ${rendu}`);
else for (const refus of rendu) refuser(refus);

console.log('\nDEUX PALETTES, NOIR ET BLANC\n');
for (const message of constats) console.log(`  ✓ ${message}`);
if (echecs.length) {
  console.log('');
  for (const message of echecs) console.error(`  ✗ ${message}`);
  console.error(`\n${echecs.length} refus.`);
  process.exit(1);
}
console.log('\nTout est en place.');
