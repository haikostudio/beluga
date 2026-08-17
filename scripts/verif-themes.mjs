#!/usr/bin/env node
/**
 * LES QUATRE THÈMES, VÉRIFIÉS SUR LEUR SOURCE.
 *
 * Il n'y a ici NI navigateur NI base : tout ce qui fait un thème est écrit, donc
 * tout se lit. Le contrôle relit les blocs de jetons de `web/src/styles.css`, le
 * catalogue de `shared/src/themes.ts` et les écrans de `web/src`, puis refuse :
 *
 *  1. un jeton MANQUANT dans un thème — les deux thèmes plats passent après le
 *     thème clair et ont la même force de sélecteur : un oubli y retomberait en
 *     silence sur une valeur du thème clair, et personne ne le verrait ;
 *  2. une teinte RECOPIÉE d'un thème à l'autre pour les deux thèmes NEUFS — la
 *     demande le dit en toutes lettres. Les deux thèmes d'ORIGINE sont exemptés :
 *     leurs valeurs ne doivent justement pas changer ;
 *  3. dans un thème PLAT, une bordure encore VISIBLE (elle doit se confondre avec
 *     un des fonds) ou des fonds mal étagés (il faut un contraste léger MAIS net) ;
 *  4. dans un thème d'ORIGINE, une bordure devenue invisible — la vérification
 *     marche donc dans les deux sens ;
 *  5. un texte illisible sur son fond ;
 *  6. une couleur écrite EN DUR dans un écran ;
 *  7. un aperçu du catalogue qui ne dit pas la vérité sur les jetons du thème ;
 *  8. un nom de couleur de Tailwind sans jeton derrière lui dans les quatre thèmes.
 *
 *   node scripts/verif-themes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Les quatre thèmes et le sélecteur qui les porte, dans leur ordre d'écriture. */
const BLOCS = [
  { id: 'sombre', selecteur: ':root', origine: true, plat: false },
  { id: 'clair', selecteur: 'html:not(.dark)', origine: true, plat: false },
  { id: 'sable', selecteur: "html[data-theme='sable']", origine: false, plat: true },
  { id: 'ardoise', selecteur: "html[data-theme='ardoise']", origine: false, plat: true },
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

if (echecs.length) {
  for (const message of echecs) console.error(`  ✗ ${message}`);
  process.exit(1);
}

const reference = BLOCS[0];
/* Les alias ne sont pas des teintes : ils renvoient à un autre jeton, donc ils se
   recopient légitimement d'un thème à l'autre. */
const ALIAS = new Set(['--intensite-calme', '--intensite-chargee']);

/* ------------------------------------------------------------------ */
/* 1. Aucun jeton ne manque                                           */
/* ------------------------------------------------------------------ */

const attendus = Object.keys(reference.jetons);
for (const bloc of BLOCS.slice(1)) {
  /* Un ALIAS ne se redéclare pas : `--intensite-calme: var(--success)` est posé
     une seule fois sur la racine et se résout, à l'usage, avec le `--success` du
     thème en cours. Le redire dans chaque thème n'ajouterait rien. */
  const manquants = attendus.filter((nom) => !ALIAS.has(nom) && !(nom in bloc.jetons));
  if (manquants.length) refuser(`thème « ${bloc.id} » : jetons manquants — ${manquants.join(', ')}`);
  const inconnus = Object.keys(bloc.jetons).filter((nom) => !attendus.includes(nom));
  if (inconnus.length) refuser(`thème « ${bloc.id} » : jetons que le thème sombre ne déclare pas — ${inconnus.join(', ')}`);
}
constater(`${attendus.length} jetons déclarés par chacun des ${BLOCS.length} thèmes`);

/* ------------------------------------------------------------------ */
/* 2. Aucune teinte recopiée pour les deux thèmes NEUFS               */
/* ------------------------------------------------------------------ */

for (const bloc of BLOCS.filter((item) => !item.origine)) {
  for (const autre of BLOCS) {
    if (autre.id === bloc.id) continue;
    const recopies = attendus.filter(
      (nom) => !ALIAS.has(nom) && bloc.jetons[nom] && bloc.jetons[nom] === autre.jetons[nom],
    );
    if (recopies.length) {
      refuser(`thème « ${bloc.id} » : teintes recopiées telles quelles de « ${autre.id} » — ${recopies.join(', ')}`);
    }
  }
}
constater('aucune teinte des thèmes « sable » et « ardoise » n’est recopiée d’un autre thème');

/* ------------------------------------------------------------------ */
/* 3 et 4. Les bordures : effacées dans les thèmes plats, visibles ailleurs */
/* ------------------------------------------------------------------ */

/** La luminosité d'un jeton `H S% L%`, ou `null` si ce n'en est pas un. */
function luminosite(valeur) {
  const trouve = /^-?[\d.]+\s+[\d.]+%\s+([\d.]+)%/.exec(valeur ?? '');
  return trouve ? Number(trouve[1]) : null;
}

/** Le trait est-il confondu avec un des fonds ? On garde l'écart le plus petit. */
const ECART_BORDURE_INVISIBLE = 2;
const ECART_BORDURE_VISIBLE = 5;
/** Un palier de fond : assez pour se lire, assez peu pour ne pas trancher. */
const PALIER_MIN = 3;
const PALIER_MAX = 8;

for (const bloc of BLOCS) {
  const fonds = ['--bg', '--surface', '--raised'].map((nom) => luminosite(bloc.jetons[nom]));
  const bordure = luminosite(bloc.jetons['--border']);
  if (bordure === null || fonds.some((valeur) => valeur === null)) {
    refuser(`thème « ${bloc.id} » : fonds ou bordure illisibles (attendu « H S% L% »)`);
    continue;
  }
  const ecart = Math.min(...fonds.map((fond) => Math.abs(bordure - fond)));

  if (bloc.plat) {
    if (ecart > ECART_BORDURE_INVISIBLE) {
      refuser(
        `thème plat « ${bloc.id} » : la bordure se voit encore (${ecart} points du fond le plus proche, ` +
          `${ECART_BORDURE_INVISIBLE} au plus) — un bloc doit se délimiter par son fond`,
      );
    }
    /* Les fonds doivent monter ou descendre par paliers réguliers : sans cela, la
       hiérarchie disparaît avec les traits. */
    const tries = [...fonds].sort((a, b) => a - b);
    for (let rang = 1; rang < tries.length; rang += 1) {
      const palier = tries[rang] - tries[rang - 1];
      if (palier < PALIER_MIN || palier > PALIER_MAX) {
        refuser(
          `thème plat « ${bloc.id} » : palier de fond de ${palier} points (attendu ${PALIER_MIN} à ${PALIER_MAX}) — ` +
            `sans traits, c'est le seul étagement qui reste`,
        );
      }
    }
  } else if (ecart < ECART_BORDURE_VISIBLE) {
    refuser(
      `thème d'origine « ${bloc.id} » : sa bordure a cessé de se voir (${ecart} points du fond le plus proche) — ` +
        `ces deux thèmes ne doivent PAS changer`,
    );
  }
}
constater('bordures effacées dans « sable » et « ardoise », intactes dans « sombre » et « clair »');

/* ------------------------------------------------------------------ */
/* 5. Le texte reste lisible sur ses fonds                            */
/* ------------------------------------------------------------------ */

const LISIBILITE = { '--text': 60, '--muted': 45, '--faint': 32 };
for (const bloc of BLOCS) {
  for (const [jeton, minimum] of Object.entries(LISIBILITE)) {
    const encre = luminosite(bloc.jetons[jeton]);
    for (const nomDuFond of ['--bg', '--surface', '--raised']) {
      const fond = luminosite(bloc.jetons[nomDuFond]);
      const ecart = Math.abs(encre - fond);
      if (ecart < minimum) {
        refuser(
          `thème « ${bloc.id} » : ${jeton} sur ${nomDuFond} ne fait que ${ecart} points d'écart (${minimum} attendus)`,
        );
      }
    }
  }
}
constater('texte, texte discret et texte pâle lisibles sur les trois fonds des quatre thèmes');

/* ------------------------------------------------------------------ */
/* 6. Aucune couleur écrite en dur dans un écran                      */
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

let fichiersLus = 0;
for (const fichier of ecrans(ECRANS)) {
  fichiersLus += 1;
  const texte = fs.readFileSync(fichier, 'utf8');
  for (const trouve of texte.matchAll(EN_DUR)) {
    const ligne = texte.slice(0, trouve.index).split('\n').length;
    refuser(
      `${path.relative(RACINE, fichier)}:${ligne} : couleur écrite en dur « ${trouve[0]} » — ` +
        `elle ne suivra aucun des quatre thèmes`,
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
/* 7. L'aperçu du catalogue dit la vérité                             */
/* ------------------------------------------------------------------ */

const catalogue = fs.readFileSync(CATALOGUE, 'utf8');
/* L'aperçu montre, dans cet ordre : le fond de page, le fond d'un bloc, le texte,
   la couleur d'un travail en cours. */
const JETONS_DE_L_APERCU = ['--bg', '--surface', '--text', '--en-cours'];

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
constater('les quatre pastilles d’aperçu de chaque thème reprennent ses vrais jetons');

/* ------------------------------------------------------------------ */
/* 8. Chaque nom de Tailwind a son jeton                              */
/* ------------------------------------------------------------------ */

const tailwind = fs.readFileSync(TAILWIND, 'utf8');
const noms = [...tailwind.matchAll(/hsl\(var\((--[a-z0-9-]+)\)\)/g)].map((trouve) => trouve[1]);
const orphelins = [...new Set(noms)].filter((nom) => !(nom in reference.jetons));
if (orphelins.length) refuser(`web/tailwind.config.js : noms de couleur sans jeton — ${orphelins.join(', ')}`);
constater(`${new Set(noms).size} noms de couleur de Tailwind adossés à un jeton`);

/* ------------------------------------------------------------------ */

console.log('\nLES QUATRE THÈMES\n');
for (const message of constats) console.log(`  ✓ ${message}`);
if (echecs.length) {
  console.error('');
  for (const message of echecs) console.error(`  ✗ ${message}`);
  console.error(`\n${echecs.length} refus.\n`);
  process.exit(1);
}
console.log('\nTout est en place.\n');
