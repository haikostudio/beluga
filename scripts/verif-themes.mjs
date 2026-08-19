#!/usr/bin/env node
/**
 * LES SIX AMBIANCES EN CLAIR ET EN SOMBRE, VÉRIFIÉES À LA SOURCE ET AU NAVIGATEUR.
 *
 * La première moitié ne LIT que du texte : les blocs de jetons de
 * `web/src/styles.css`, le catalogue de `shared/src/themes.ts` et les écrans de
 * `web/src`. Elle refuse :
 *
 *  1. un jeton MANQUANT dans un thème — les thèmes plats passent après le
 *     thème clair et ont la même force de sélecteur : un oubli y retomberait en
 *     silence sur une valeur du thème clair, et personne ne le verrait ;
 *  2. une teinte RECOPIÉE d'une palette à l'autre pour les dix palettes AJOUTÉES.
 *     Les deux palettes d'ORIGINE sont exemptées :
 *     leurs valeurs ne doivent justement pas changer ;
 *  3. dans une palette PLATE, une bordure
 *     encore VISIBLE (elle doit se confondre avec un des fonds) ou des fonds mal
 *     étagés (il faut un contraste léger MAIS net) ;
 *  4. dans le seul thème À BORDURES, le clair, une bordure devenue invisible —
 *     la vérification marche donc dans les deux sens ;
 *  5. un texte illisible sur son fond ;
 *  6. une couleur écrite EN DUR dans un écran ;
 *  7. un aperçu du catalogue qui ne dit pas la vérité sur les jetons du thème ;
 *  8. un nom de couleur de Tailwind sans jeton derrière lui dans les douze palettes ;
 *  9. un bloc de jetons pour le mode automatique, qui n'est pas une palette,
 *     ou un second endroit qui pose le thème.
 *
 * La seconde moitié demande au NAVIGATEUR ce qu'il affiche vraiment — quatre
 * promesses qu'aucune relecture ne peut tenir : les couleurs CALCULÉES de chaque
 * thème, le MENU DU BAS du téléphone qui reprend le fond de la zone du dessus dans
 * les douze palettes, le thème d'un PROJET qui habille l'application entière quand
 * on change de projet, et l'interrupteur automatique qui suit le réglage clair /
 * sombre de l'ordinateur sans changer l'ambiance. Elle fabrique une session d'une
 * heure, la retire en partant, et n'écrit rien d'autre en base.
 *
 *   HAIKO_THEMES_URL=http://localhost:7099 node scripts/verif-themes.mjs
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

/** Les douze palettes et le sélecteur qui les porte, dans leur ordre d'écriture. */
const BLOCS = [
  /* « sombre » est un thème d'ORIGINE — ses teintes ne se comparent donc pas aux
     autres — mais il est PLAT depuis le 17.08.2026 : sa bordure doit se
     confondre avec un de ses fonds, et son bouton « contour » porter un voile.
     Les deux qualités sont bien séparées, c'est ce qui permet ce cas. */
  { id: 'sombre', selecteur: ':root', origine: true, plat: true, sombre: true },
  { id: 'clair', selecteur: 'html:not(.dark)', origine: true, plat: false, sombre: false },
  { id: 'sable', selecteur: "html[data-theme='sable']", origine: false, plat: true, sombre: false },
  { id: 'ardoise', selecteur: "html[data-theme='ardoise']", origine: false, plat: true, sombre: true },
  { id: 'givre', selecteur: "html[data-theme='givre']", origine: false, plat: true, sombre: false },
  { id: 'sapin', selecteur: "html[data-theme='sapin']", origine: false, plat: true, sombre: true },
  { id: 'contraste', selecteur: "html[data-theme='contraste']", origine: false, plat: true, sombre: false },
  { id: 'sable-sombre', selecteur: "html[data-theme='sable-sombre']", origine: false, plat: true, sombre: true },
  { id: 'ardoise-clair', selecteur: "html[data-theme='ardoise-clair']", origine: false, plat: true, sombre: false },
  { id: 'givre-sombre', selecteur: "html[data-theme='givre-sombre']", origine: false, plat: true, sombre: true },
  { id: 'sapin-clair', selecteur: "html[data-theme='sapin-clair']", origine: false, plat: true, sombre: false },
  { id: 'contraste-sombre', selecteur: "html[data-theme='contraste-sombre']", origine: false, plat: true, sombre: true },
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
/* 2. Aucune teinte recopiée pour les dix palettes ajoutées           */
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
constater('aucune teinte des dix palettes ajoutées n’est recopiée d’une autre palette');

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
constater('bordures effacées dans les onze palettes plates, intactes dans le seul « clair »');

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
constater('texte, texte discret et texte pâle lisibles sur les trois fonds des douze palettes');

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
        `elle ne suivra aucune des douze palettes`,
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
constater('les pastilles d’aperçu de chaque thème reprennent ses vrais jetons');

/* ------------------------------------------------------------------ */
/* 8. Chaque nom de Tailwind a son jeton                              */
/* ------------------------------------------------------------------ */

const tailwind = fs.readFileSync(TAILWIND, 'utf8');
const noms = [...tailwind.matchAll(/hsl\(var\((--[a-z0-9-]+)\)\)/g)].map((trouve) => trouve[1]);
const orphelins = [...new Set(noms)].filter((nom) => !(nom in reference.jetons));
if (orphelins.length) refuser(`web/tailwind.config.js : noms de couleur sans jeton — ${orphelins.join(', ')}`);
constater(`${new Set(noms).size} noms de couleur de Tailwind adossés à un jeton`);

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 8 bis. L'automatique choisit une CLARTÉ, jamais une palette         */
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

/* ------------------------------------------------------------------ */
/* 9. LE NAVIGATEUR : les jetons compilés donnent bien ces couleurs    */
/* ------------------------------------------------------------------ */

/**
 * Tout ce qui précède lit du TEXTE. Or entre le jeton et le pixel il y a Tailwind,
 * PostCSS et le navigateur — et une valeur qui se lit très bien peut ne rien
 * produire du tout. Le cas qui a motivé ce passage : `--controle` porte son alpha
 * DANS le jeton (`0 0% 0% / 0`), une écriture que rien ne valide à la lecture et
 * qu'un `hsl()` mal formé rendrait silencieusement invalide — le bouton perdrait
 * son fond sans qu'aucune erreur ne paraisse.
 *
 * On demande donc au navigateur les couleurs CALCULÉES, thème par thème, sur un
 * témoin qui porte les mêmes classes que l'application. Aucune session, aucune
 * base, aucun moteur : la page de l'application suffit, les jetons vivant sur
 * `<html>`. Sans serveur de développement en face, le contrôle le DIT et s'arrête
 * là — il ne se déclare pas réussi.
 *
 *   HAIKO_THEMES_URL=http://localhost:7099 node scripts/verif-themes.mjs
 */
const ADRESSE = process.env.HAIKO_THEMES_URL || 'http://localhost:7099';
/* La base et ses dépendances natives vivent dans le dépôt PRINCIPAL, même quand
   ce script est lancé d'une copie de travail. */
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';

/**
 * Une session d'UNE HEURE, fabriquée puis retirée : la colonne `token` garde le
 * SHA-256 du cookie, jamais le cookie. C'est la seule écriture en base de tout ce
 * contrôle, et elle est défaite en partant.
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
    'vérification des thèmes',
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
  /* Sans session, l'application reste derrière le mur d'accès et ne connaît
     aucun projet : le thème par projet ne pourrait pas être jugé. Une base
     absente n'est pas une raison d'échouer en silence — on le DIT. */
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
    return dansLaPage(page, navigateur);
    });
  } catch (err) {
    return `session d'essai impossible — ${err.message.split('\n')[0]}`;
  }
}

async function dansLaPage(page, navigateur) {
  await page.waitForTimeout(6000);
  /* Le témoin porte les classes réellement employées par le kit : le fond d'un
     bouton « contour », un trait de bordure, le voile d'une fenêtre. */
  await page.evaluate(() => {
    const temoin = document.createElement('div');
    temoin.id = 'temoin-themes';
    temoin.innerHTML =
      '<span data-t="controle" class="bg-controle"></span>' +
      '<span data-t="border" class="bg-border"></span>' +
      '<span data-t="surface" class="bg-surface"></span>' +
      '<span data-t="bg" class="bg-bg"></span>' +
      '<span data-t="voile" class="bg-voile/70"></span>' +
      '<span data-t="sur-etat" class="text-sur-etat"></span>' +
      '<span data-t="en-cours" class="text-en-cours"></span>';
    document.body.append(temoin);
  });

  const anomalies = [];

  /* CE QUE L'APPLICATION AVAIT POSÉ, pour le REMETTRE après la revue des douze
     palettes. Les boucles qui suivent écrivent `data-theme` À LA MAIN, sans
     passer par React : sans cette remise en place, la page reste marquée du
     DERNIER thème essayé, et le contrôle du thème par PROJET jugeait ensuite un
     affichage qui n'était plus celui de l'application (React ne repose son
     thème que lorsqu'il CHANGE — un projet habillé du thème déjà en vigueur ne
     déclenchait donc aucune écriture, et la marque laissée là passait pour un
     refus). */
  const themeDeLApplication = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    sombre: document.documentElement.classList.contains('dark'),
  }));
  const remettreLeThemeDeLApplication = () =>
    page.evaluate(({ theme, sombre }) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.toggle('dark', sombre);
    }, themeDeLApplication);

  for (const bloc of BLOCS) {
    const mesures = await page.evaluate(
      ({ id, sombre }) => {
        document.documentElement.dataset.theme = id;
        document.documentElement.classList.toggle('dark', sombre);
        const lu = {};
        for (const noeud of document.querySelectorAll('#temoin-themes [data-t]')) {
          const style = getComputedStyle(noeud);
          lu[noeud.dataset.t] = noeud.dataset.t === 'sur-etat' || noeud.dataset.t === 'en-cours'
            ? style.color
            : style.backgroundColor;
        }
        return lu;
      },
      { id: bloc.id, sombre: bloc.sombre },
    );

    /* Une couleur que le navigateur n'a pas comprise ne rend rien du tout, ou le
       mot-clé initial : dans les deux cas la classe ne peint plus. */
    for (const [nom, valeur] of Object.entries(mesures)) {
      if (!valeur || valeur === 'initial' || valeur === 'currentcolor') {
        anomalies.push(`thème « ${bloc.id} » : la classe « ${nom} » ne produit aucune couleur (${valeur || 'vide'})`);
      }
    }
    /* Le fond d'un bouton au repos : transparent dans le seul thème à bordures
       (le clair), un voile TRANSLUCIDE — donc jamais opaque — dans les six
       thèmes plats, où la bordure ne dessine plus le bouton. */
    const alpha = /rgba?\([^)]*?,\s*([\d.]+)\s*\)$/.exec(mesures.controle ?? '');
    const part = alpha ? Number(alpha[1]) : 1;
    if (!bloc.plat && part !== 0) {
      anomalies.push(`thème à bordures « ${bloc.id} » : le fond d'un bouton au repos n'est plus transparent (${mesures.controle})`);
    }
    if (bloc.plat && (part === 0 || part > 0.2)) {
      anomalies.push(`thème plat « ${bloc.id} » : le fond d'un bouton au repos doit être un voile léger, pas ${mesures.controle}`);
    }
    /* Et le voile d'une fenêtre garde bien sa part : `bg-voile/70` s'écrit avec
       son alpha, contrairement à `controle`. */
    if (!/rgba\(/.test(mesures.voile ?? '')) {
      anomalies.push(`thème « ${bloc.id} » : le voile d'une fenêtre a perdu sa transparence (${mesures.voile})`);
    }
  }

  /* ---------------------------------------------------------------- *
   * LE MENU DU BAS DU TÉLÉPHONE, DANS LES DOUZE PALETTES.
   *
   * Il ne prend PAS son fond dans un jeton à lui : il lit `--fond-zone`, la
   * teinte que la zone affichée au-dessus vient de poser (`data-zone`,
   * `styles.css`). Une palette qui oublierait d'y poser sa teinte le ferait
   * retomber sur le repli — une bande d'une autre couleur sous le tableau, et
   * personne ne le verrait en ne regardant que la palette active. On mesure donc
   * les DOUZE, en largeur téléphone, où ce menu existe.
   * ---------------------------------------------------------------- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  const barrePresente = await page.evaluate(() => !!document.querySelector('nav[data-menu-bas] > div'));
  if (!barrePresente) {
    anomalies.push('le menu du bas est introuvable en largeur téléphone (`nav[data-menu-bas]`)');
  } else {
    for (const bloc of BLOCS) {
      const mesure = await page.evaluate(
        ({ id, sombre }) => {
          document.documentElement.dataset.theme = id;
          document.documentElement.classList.toggle('dark', sombre);
          const fond = (noeud) => (noeud ? getComputedStyle(noeud).backgroundColor : null);
          const menu = document.querySelector('nav[data-menu-bas]');
          return {
            barre: fond(menu?.firstElementChild),
            zone: fond(document.querySelector('main[data-zone]')),
            repere: menu?.dataset.zone ?? null,
          };
        },
        { id: bloc.id, sombre: bloc.sombre },
      );
      if (mesure.repere !== 'centre') {
        anomalies.push(
          `le menu du bas ne se dit pas dans la zone du tableau (repère « ${mesure.repere} » au lieu de « centre »)`,
        );
        break;
      }
      if (!mesure.barre || !mesure.zone || mesure.barre !== mesure.zone) {
        anomalies.push(
          `thème « ${bloc.id} » : le menu du bas (${mesure.barre}) ne reprend pas le fond de la zone ` +
            `qu'il prolonge (${mesure.zone})`,
        );
      }
    }
  }
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(400);
  await remettreLeThemeDeLApplication();

  /* ---------------------------------------------------------------- *
   * LE THÈME D'UN PROJET, ET LE THÈME « SYSTÈME », POUR DE VRAI.
   *
   * Deux promesses qu'aucune lecture de texte ne peut tenir : changer de projet
   * doit habiller l'application ENTIÈRE, et l'automatique doit suivre le
   * réglage clair / sombre de l'ordinateur sans changer l'ambiance.
   *
   * Le projet est posé par le POINT D'ESSAI de l'interface
   * (`window.haikodevEssai.projet`), jamais par le serveur : le démon en service
   * est construit avant ce champ et le retire du bloc qu'il envoie. Rien n'est
   * écrit en base, et le thème du projet est retiré en partant.
   * ---------------------------------------------------------------- */
  const point = await page.evaluate(() => typeof window.haikodevEssai?.projet === 'function');
  if (!point) {
    anomalies.push(
      "le point d'essai de l'interface est absent : sans lui, ni l'apparence d'un projet ni " +
        "l'automatique ne peuvent être jugés (attendu sur le serveur de développement)",
    );
    await navigateur.close();
    return anomalies;
  }

  const projets = await page.evaluate(() => window.haikodevEssai.projets());
  if (projets.length < 2) {
    anomalies.push(`il faut deux projets pour juger le changement d'apparence, ${projets.length} trouvé(s)`);
  } else {
    const [premier, second] = projets;
    const habiller = async (projectId, theme) => {
      await page.evaluate(
        ({ id, valeur }) => {
          window.haikodevEssai.projet(id, { theme: valeur });
          window.haikodevEssai.ouvrirProjet(id);
        },
        { id: projectId, valeur: theme },
      );
      /* Ce contrôle vise parfois le démon RÉEL, avec d'autres agents actifs en
         même temps : un délai FIXE de 500 ms suffit sur une machine calme mais
         se révèle trop court sous charge, avant que React n'ait rattrapé le
         changement d'état — d'où des refus qui n'en sont pas. On attend plutôt
         que la valeur affichée se STABILISE (deux lectures identiques d'affilée),
         plafonné à 3 s. */
      let precedente = null;
      for (let tentative = 0; tentative < 20; tentative += 1) {
        await page.waitForTimeout(150);
        const courante = await page.evaluate(() => document.documentElement.dataset.theme);
        if (courante === precedente) return courante;
        precedente = courante;
      }
      return precedente;
    };

    /* Deux projets, deux thèmes — CHOISIS DIFFÉRENTS de celui déjà en vigueur.
       Imposer à un projet le thème que le réglage général applique déjà ne
       prouverait rien : rien ne changerait, et l'on ne saurait pas dire si c'est
       le projet qui habille l'application ou le réglage général qui n'a jamais
       bougé. */
    const [themeUn, themeDeux] = ['sable-sombre', 'ardoise-clair', 'givre-sombre', 'sapin-clair'].filter(
      (candidat) => candidat !== themeDeLApplication.theme,
    );

    const surLePremier = await habiller(premier.id, themeUn);
    if (surLePremier !== themeUn) {
      anomalies.push(
        `le thème du projet « ${premier.name} » n'habille pas l'application (vu « ${surLePremier} » au lieu de « ${themeUn} »)`,
      );
    }
    const surLeSecond = await habiller(second.id, themeDeux);
    if (surLeSecond !== themeDeux) {
      anomalies.push(`changer de projet ne change pas l'apparence (vu « ${surLeSecond} » au lieu de « ${themeDeux} »)`);
    }

    /* Le thème couvre TOUTE l'application, pas la seule colonne du milieu. */
    const partout = await page.evaluate(() => {
      const fond = (selecteur) => {
        const noeud = document.querySelector(selecteur);
        return noeud ? getComputedStyle(noeud).backgroundColor : null;
      };
      return { page: fond('body'), colonne: fond('aside'), bandeau: fond('header') };
    });
    const fondsSuspects = Object.entries(partout).filter(
      ([, couleur]) => couleur && /^rgb\(0, 0, 0\)$/.test(couleur),
    );
    if (fondsSuspects.length) {
      anomalies.push(
        `le thème « ${themeDeux} » n'atteint pas ${fondsSuspects.map(([zone]) => zone).join(', ')} — ` +
          `un noir pur y reste, or ce thème n'en a aucun`,
      );
    }

    /* Un projet qui n'impose RIEN rend la main au réglage général. */
    const rendu = await habiller(second.id, null);
    if (rendu === themeDeux) {
      anomalies.push("un projet sans thème garde l'apparence qu'il imposait : le réglage général ne reprend pas la main");
    }

    /* L'automatique garde l'ambiance du projet et ne change que sa variante. */
    await page.evaluate(
      ({ id }) => {
        window.haikodevEssai.projet(id, { theme: 'auto-sable-clair' });
        window.haikodevEssai.ouvrirProjet(id);
      },
      { id: premier.id },
    );
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(600);
    const sableSombre = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(600);
    const sableClair = await page.evaluate(() => document.documentElement.dataset.theme);
    if (sableSombre !== 'sable-sombre' || sableClair !== 'sable') {
      anomalies.push(
        `l'automatique change l'ambiance au lieu de sa seule variante : sombre → « ${sableSombre} », clair → « ${sableClair} »`,
      );
    }
    await page.emulateMedia({ colorScheme: null });
    await page.evaluate((id) => window.haikodevEssai.projet(id, { theme: null }), premier.id);
  }

  /* LE MENU NE PORTE QU'UNE ENTRÉE « THÈME », et elle s'ouvre AU SURVOL comme
     AU CLIC. Le menu s'ouvre par un VRAI clic : un `.click()` posé depuis la
     page ne réveille pas ce menu, qui écoute l'appui du pointeur. */
  await page.click('button[title="Menu"]');
  await page.waitForTimeout(700);

  const avantSurvol = await page.evaluate(() => ({
    entree: !!document.querySelector('[data-theme-menu]'),
    choix: document.querySelectorAll('[data-theme-choix]').length,
  }));
  if (!avantSurvol.entree) {
    anomalies.push("le menu du bandeau n'a pas d'entrée « Thème » (repère `data-theme-menu`)");
  }
  if (avantSurvol.choix !== 0) {
    anomalies.push(
      `les ${avantSurvol.choix} thèmes s'alignent encore dans le menu : ils doivent tenir derrière l'entrée « Thème »`,
    );
  }

  /* Six AMBIANCES seulement : clair, sombre et automatique sont des réglages
     indépendants, ils ne reviennent plus comme trois faux thèmes dans la liste. */
  const CHOIX_ATTENDUS = BLOCS.length / 2;

  /* 1) LE SURVOL. C'est le geste attendu à la souris. */
  await page.hover('[data-theme-menu]');
  await page.waitForTimeout(600);
  const auSurvol = await page.$$eval('[data-theme-choix]', (noeuds) => noeuds.map((n) => n.dataset.themeChoix));
  if (auSurvol.length !== CHOIX_ATTENDUS) {
    anomalies.push(`le sous-menu ne s'ouvre pas au SURVOL (${auSurvol.length} ambiances vues, ${CHOIX_ATTENDUS} attendues)`);
  }
  const commandesAuSurvol = await page.evaluate(() => ({
    automatique: !!document.querySelector('[data-theme-auto-menu]'),
    manuel: !!document.querySelector('[data-theme-mode-menu]'),
  }));
  if (!commandesAuSurvol.automatique || !commandesAuSurvol.manuel) {
    anomalies.push("le menu ne sépare pas l'interrupteur automatique de l'interrupteur clair / sombre");
  }

  /* 2) LE CLIC, pour qui n'a pas de souris. On referme d'abord tout. */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.click('button[title="Menu"]');
  await page.waitForTimeout(700);
  await page.click('[data-theme-menu]');
  await page.waitForTimeout(600);
  const auClic = await page.$$eval('[data-theme-choix]', (noeuds) => noeuds.map((n) => n.dataset.themeChoix));
  if (auClic.length !== CHOIX_ATTENDUS) {
    anomalies.push(`le sous-menu ne s'ouvre pas au CLIC (${auClic.length} ambiances vues, ${CHOIX_ATTENDUS} attendues)`);
  }

  /* Dans les réglages, chaque ambiance montre bien ses DEUX palettes et son
     interrupteur ; l'automatique désactive les six interrupteurs manuels. */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.click('button[title="Menu"]');
  await page.waitForTimeout(500);
  const entreeReglages = page.getByRole('menuitem').filter({ hasText: 'Réglages' }).first();
  if ((await entreeReglages.count()) === 0) {
    anomalies.push("l'entrée « Réglages » est introuvable pour vérifier l'écran Apparence");
  } else {
    await entreeReglages.click();
    await page.waitForTimeout(700);
    await page.getByRole('tab', { name: 'Apparence' }).click();
    await page.waitForTimeout(500);
    const cartes = await page.$$eval('[data-theme-carte]', (noeuds) =>
      noeuds.map((noeud) => ({
        apercus: noeud.querySelectorAll('[data-theme-apercu]').length,
        interrupteurs: noeud.querySelectorAll('[data-theme-mode]').length,
      })),
    );
    if (cartes.length !== CHOIX_ATTENDUS || cartes.some((carte) => carte.apercus !== 2 || carte.interrupteurs !== 1)) {
      anomalies.push(
        `l'écran Apparence ne montre pas deux variantes et un interrupteur par ambiance (${cartes.length} cartes lues)`,
      );
    }

    const interrupteurAuto = page.locator('[data-theme-auto] button[role="switch"]');
    const etaitAutomatique = (await interrupteurAuto.getAttribute('data-state')) === 'checked';
    if (!etaitAutomatique) {
      await interrupteurAuto.click();
      await page.waitForTimeout(400);
    }
    const manuelsDesactives = await page.$$eval('[data-theme-mode]', (noeuds) =>
      noeuds.length === 6 && noeuds.every((noeud) => noeud.disabled),
    );
    if (!manuelsDesactives) anomalies.push("le mode automatique ne désactive pas les six interrupteurs clair / sombre");
    if (!etaitAutomatique) {
      await interrupteurAuto.click();
      await page.waitForTimeout(300);
    }
    await page.keyboard.press('Escape');
  }

  await navigateur.close();
  return anomalies;
}

let mesureNavigateur;
try {
  mesureNavigateur = await auNavigateur();
} catch (err) {
  mesureNavigateur = `navigateur d'essai indisponible — ${err.message.split('\n')[0]}`;
}

if (typeof mesureNavigateur === 'string') {
  refuser(`les couleurs calculées n'ont PAS pu être mesurées : ${mesureNavigateur}`);
} else {
  for (const anomalie of mesureNavigateur) refuser(anomalie);
  constater(
    `dans un vrai navigateur : couleurs calculées des ${BLOCS.length} thèmes, menu du bas du téléphone qui ` +
      `reprend le fond de sa zone dans les ${BLOCS.length} palettes, thème d'un PROJET qui habille ` +
      `toute l'application, une SEULE entrée « Thème » au menu qui s'ouvre au survol comme au clic, ` +
      `et l'automatique qui suit l'ordinateur sans changer l'ambiance`,
  );
}

/* ------------------------------------------------------------------ */

console.log('\nLES SIX AMBIANCES, CLAIRES ET SOMBRES\n');
for (const message of constats) console.log(`  ✓ ${message}`);
if (echecs.length) {
  console.error('');
  for (const message of echecs) console.error(`  ✗ ${message}`);
  console.error(`\n${echecs.length} refus.\n`);
  process.exit(1);
}
console.log('\nTout est en place.\n');
