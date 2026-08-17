#!/usr/bin/env node
/**
 * FAIRE PASSER LES TEXTES DE L'INTERFACE PAR LE DICTIONNAIRE — l'outil de bascule.
 *
 * Il ne tourne PAS tous les jours : il a servi à convertir d'un coup les
 * milliers de textes écrits en dur dans les écrans, et il resservira le jour où
 * un lot d'écrans neufs sera écrit en français avant d'être traduit. Il n'est
 * donc pas dans la liste des contrôles — c'est `scripts/verif-langues.mjs` qui
 * juge le résultat, tous les jours, lui.
 *
 * IL NE DEVINE RIEN : il lit le VRAI arbre du code (le compilateur TypeScript),
 * pas des expressions régulières. Trois endroits, et pas un de plus :
 *
 *  1. le TEXTE écrit entre deux balises (`<span>Réglages</span>`) ;
 *  2. la valeur d'un attribut NOMMÉ dans la liste blanche ci-dessous — `title`,
 *     `label`, `placeholder`… — y compris à l'intérieur d'un `? :` ;
 *  3. le message d'un `pushToast`.
 *
 * IL NE TOUCHE JAMAIS aux repères techniques : `aria-label`, `data-…`, `key`,
 * `className`, `id`, `href`, `type`, `role`. Ce sont eux que les scripts de
 * contrôle emploient pour désigner un bouton — ils doivent rester les mêmes
 * dans les cinq langues.
 *
 *   node scripts/passer-les-textes-en-traduction.mjs --essai   # ne rien écrire
 *   node scripts/passer-les-textes-en-traduction.mjs --ecrire  # écrire
 *   node scripts/passer-les-textes-en-traduction.mjs --cles    # sortir les clés
 */

import ts from 'typescript';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script — jamais un chemin en dur (règle du projet). */
const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(RACINE, 'web', 'src');

/** Les attributs dont la valeur est LUE par un humain. */
const ATTRIBUTS_DE_TEXTE = new Set([
  'title',
  'label',
  'placeholder',
  'description',
  'confirmLabel',
  'cancelLabel',
  'alt',
  'libelle',
  'titre',
  'sousTitre',
  'texte',
  'message',
  'legende',
  'hint',
  'emptyLabel',
  'labelArret',
]);

/** Les fichiers qui n'ont rien à traduire : ce sont eux qui traduisent. */
const HORS_JEU = new Set(['lib/langue.ts', 'lib/langue.tsx']);

function fichiers(dossier) {
  const trouves = [];
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) trouves.push(...fichiers(chemin));
    else if (/\.tsx?$/.test(chemin)) trouves.push(chemin);
  }
  return trouves;
}

/**
 * CE TEXTE EST-IL FAIT POUR ÊTRE LU ? Un nom de classe, une clé, un chemin, un
 * identifiant technique ne le sont pas. On demande donc au moins une LETTRE, et
 * on écarte tout ce qui ressemble à du code.
 */
export function texteLisible(valeur) {
  const texte = valeur.trim();
  if (texte.length < 2) return false;
  if (!/[a-zA-ZÀ-ÿ]/.test(texte)) return false;
  // Un seul mot tout en minuscules sans accent : une clé, pas une phrase.
  if (/^[a-z0-9]+([-_.][a-z0-9]+)*$/.test(texte)) return false;
  // Un code de langue régionale (« fr-CH », « zh-Hans ») : un FORMAT, pas un mot.
  if (/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(texte)) return false;
  // Chemins, adresses, sélecteurs.
  if (/^[./#]|^https?:|^\w+:\/\//.test(texte)) return false;
  if (/^[\w-]+\/[\w-]+/.test(texte)) return false;
  // Suites de classes utilitaires (« flex items-center gap-2 »).
  if (/^[a-z0-9:[\]/.%-]+(\s+[a-z0-9:[\]/.%-]+)+$/.test(texte)) return false;
  return true;
}

/** Le texte d'un morceau de JSX, espaces de mise en forme retirés. */
function texteJsx(brut) {
  return brut.replace(/\s+/g, ' ').trim();
}

function guillemets(texte) {
  /* Les retours à la ligne s'ÉCHAPPENT : un vrai saut de ligne dans une chaîne
     entre apostrophes ne compile pas, et c'est ce qui cassait la bascule. */
  return `'${texte
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}'`;
}

/**
 * UN LITTÉRAL DE GABARIT DEVIENT UN TEXTE À TROUS. `` `${n} agents` `` s'écrit
 * `t('{n} agents', { n })` : la phrase ENTIÈRE part au dictionnaire, et chaque
 * langue place le trou où sa grammaire le veut.
 */
function gabaritEnTexteATrous(noeud, source) {
  const morceaux = [noeud.head.text];
  const valeurs = [];
  let rang = 0;
  for (const bout of noeud.templateSpans) {
    const expression = source.slice(bout.expression.pos, bout.expression.end).trim();
    const nom = /^[A-Za-z_$][\w$]*$/.test(expression) ? expression : `v${rang++}`;
    valeurs.push([nom, expression]);
    morceaux.push(`{${nom}}`, bout.literal.text);
  }
  return { texte: morceaux.join(''), valeurs };
}

function appelDeTraduction(texte, valeurs) {
  if (!valeurs?.length) return `t(${guillemets(texte)})`;
  const corps = valeurs
    .map(([nom, expression]) => (nom === expression ? nom : `${nom}: ${expression}`))
    .join(', ');
  return `t(${guillemets(texte)}, { ${corps} })`;
}

/**
 * OÙ CE TEXTE EST-IL POSÉ ? C'est le PREMIER ancêtre qui compte qui décide, et
 * lui seul — remonter plus haut ferait passer pour un libellé le nom de classe
 * d'une balise imbriquée dans une expression.
 *
 *  - « attribut-texte » : la valeur d'un attribut de la liste blanche, même à
 *    travers un `? :` — c'est un libellé, il se traduit ;
 *  - « attribut-technique » : tout autre attribut (`className`, `aria-label`,
 *    `key`, `data-…`) — on n'y touche JAMAIS ;
 *  - « enfant » : une expression posée ENTRE deux balises
 *    (`{enregistre ? 'Enregistré' : 'Enregistrer'}`) — c'est du texte affiché.
 */
function contexteDuLitteral(noeud) {
  let courant = noeud.parent;
  while (courant) {
    if (ts.isJsxAttribute(courant)) {
      return ATTRIBUTS_DE_TEXTE.has(courant.name.getText()) ? 'attribut-texte' : 'attribut-technique';
    }
    if (
      ts.isJsxExpression(courant) &&
      courant.parent &&
      (ts.isJsxElement(courant.parent) || ts.isJsxFragment(courant.parent))
    ) {
      return 'enfant';
    }
    courant = courant.parent;
  }
  return null;
}

/**
 * Ce littéral est-il DÉJÀ pris en charge ? Deux cas, et le second est vital :
 * un argument de `cn(…)` est une suite de classes, et un argument de `t(…)` est
 * un texte DÉJÀ traduit — le repasser à la moulinette écrirait `t(t('…'))`.
 * C'est ce qui rend l'outil rejouable sans dégât.
 */
function dejaPrisEnCharge(noeud) {
  let courant = noeud.parent;
  while (courant) {
    if (ts.isCallExpression(courant)) {
      const appele = courant.expression.getText();
      return appele === 'cn' || appele === 'clsx' || appele.endsWith('.cn') || appele === 't' || appele.endsWith('.t');
    }
    if (ts.isJsxAttribute(courant)) return false;
    courant = courant.parent;
  }
  return false;
}

/** Les phrases coupées par une balise : reprises à la main, jamais bricolées. */
const fragments = [];

/** Les remplacements à faire dans un fichier, du plus tardif au plus précoce. */
function remplacements(chemin, source) {
  const arbre = ts.createSourceFile(chemin, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const gestes = [];
  const cles = new Set();

  const noter = (debut, fin, code, texte) => {
    gestes.push({ debut, fin, code });
    cles.add(texte);
  };

  const visiter = (noeud) => {
    /*
     * 1. LE TEXTE ÉCRIT ENTRE DEUX BALISES — pris D'UN SEUL TENANT.
     *
     * Une phrase de l'interface est presque toujours coupée par une valeur :
     * `<span>Il reste {n} cartes</span>`. Traduire « Il reste » puis « cartes »
     * séparément donnerait une bouillie dans toute langue qui range ses mots
     * autrement — et l'allemand comme le chinois rangent autrement. On prend
     * donc TOUS les enfants d'un élément ensemble, et la valeur devient un TROU
     * dans la phrase : « Il reste {v0} cartes ».
     *
     * Un élément qui contient une AUTRE balise (un `<b>` au milieu de la
     * phrase) ne se ramène pas à une seule chaîne : il est laissé de côté et
     * SIGNALÉ, pour être repris à la main. On ne bricole pas une phrase coupée.
     */
    if (ts.isJsxElement(noeud)) {
      const enfants = noeud.children;
      const lisibles = enfants.filter((enfant) => ts.isJsxText(enfant) && texteLisible(texteJsx(enfant.text)));
      if (lisibles.length) {
        /*
         * ON NE MET JAMAIS UNE BALISE DANS UN TROU. Un trou reçoit une VALEUR
         * qu'on lit — un compte, un nom —, pas une icône : `{v0}` rempli par un
         * `<Loader2/>` afficherait « [object Object] ». Un enfant qui contient
         * du JSX vaut donc une balise, et fait basculer l'élément entier dans
         * le traitement morceau par morceau.
         */
        const balisePresente = enfants.some(
          (enfant) =>
            ts.isJsxElement(enfant) ||
            ts.isJsxSelfClosingElement(enfant) ||
            ts.isJsxFragment(enfant) ||
            (ts.isJsxExpression(enfant) &&
              enfant.expression &&
              /<[A-Za-z/]/.test(source.slice(enfant.expression.pos, enfant.expression.end))),
        );
        if (balisePresente) {
          /*
           * Une balise au milieu, c'est presque toujours une ICÔNE posée à côté
           * d'un libellé entier (`<Button><Archive/>Archiver</Button>`) : le
           * texte se traduit alors très bien seul. C'est le MORCEAU DE PHRASE
           * qui pose problème — celui qui commence par une minuscule ou une
           * parenthèse fermante, celui qui finit sur « ( », « : » ou un tiret.
           * Lui seul est signalé, pour être repris à la main.
           */
          for (const enfant of lisibles) {
            const texte = texteJsx(enfant.text);
            if (/^[\p{Ll}),.…»·%]/u.test(texte) || /[(«:—–,]$/u.test(texte)) {
              fragments.push({ chemin, texte });
            }
          }
        } else {
          const morceaux = [];
          const valeurs = [];
          let rang = 0;
          for (const enfant of enfants) {
            if (ts.isJsxText(enfant)) {
              const brut = enfant.text.replace(/\s*\n\s*/g, ' ');
              morceaux.push(morceaux.length === 0 ? brut.replace(/^\s+/, '') : brut);
            } else if (ts.isJsxExpression(enfant) && enfant.expression) {
              const expression = source.slice(enfant.expression.pos, enfant.expression.end).trim();
              const nom = /^[A-Za-z_$][\w$]*$/.test(expression) ? expression : `v${rang++}`;
              valeurs.push([nom, expression]);
              morceaux.push(`{${nom}}`);
            }
          }
          const texte = morceaux.join('').replace(/\s+$/, '');
          const debut = enfants[0].getStart(arbre);
          const fin = enfants[enfants.length - 1].end;
          noter(debut, fin, `{${appelDeTraduction(texte, valeurs)}}`, texte);
          /*
           * ON NE DESCEND PAS DANS LES ENFANTS QU'ON VIENT D'ABSORBER : ils sont
           * déjà dans la phrase, et un second geste posé DEDANS chevaucherait le
           * premier — c'est ce qui coupait une expression en deux. Les ATTRIBUTS
           * de la balise, eux, restent à visiter : ils ne sont pas absorbés.
           */
          ts.forEachChild(noeud.openingElement, visiter);
          return;
        }
      }
    }

    if (ts.isJsxText(noeud)) {
      const texte = texteJsx(noeud.text);
      if (texteLisible(texte)) {
        const avant = noeud.text.match(/^\s*/)[0].includes('\n') ? '\n' : noeud.text.match(/^\s*/)[0];
        const apres = noeud.text.match(/\s*$/)[0].includes('\n') ? '\n' : noeud.text.match(/\s*$/)[0];
        noter(noeud.getStart(arbre), noeud.end, `${avant}{${appelDeTraduction(texte)}}${apres}`, texte);
      }
      return;
    }

    /* 2. La valeur d'un attribut de la liste blanche. */
    if (ts.isJsxAttribute(noeud) && ATTRIBUTS_DE_TEXTE.has(noeud.name.getText())) {
      const valeur = noeud.initializer;
      if (valeur && ts.isStringLiteral(valeur) && texteLisible(valeur.text)) {
        noter(valeur.getStart(arbre), valeur.end, `{${appelDeTraduction(valeur.text)}}`, valeur.text);
        return;
      }
    }

    /* 2 bis. Les littéraux nichés dans un tel attribut, ou posés entre balises. */
    const contexte = contexteDuLitteral(noeud);
    const traduisible = contexte === 'attribut-texte' || contexte === 'enfant';

    if (
      (ts.isStringLiteral(noeud) || ts.isNoSubstitutionTemplateLiteral(noeud)) &&
      traduisible &&
      !dejaPrisEnCharge(noeud) &&
      texteLisible(noeud.text)
    ) {
      noter(noeud.getStart(arbre), noeud.end, appelDeTraduction(noeud.text), noeud.text);
      return;
    }

    if (ts.isTemplateExpression(noeud) && traduisible && !dejaPrisEnCharge(noeud)) {
      const { texte, valeurs } = gabaritEnTexteATrous(noeud, source);
      if (texteLisible(texte.replace(/\{\w+\}/g, ' '))) {
        noter(noeud.getStart(arbre), noeud.end, appelDeTraduction(texte, valeurs), texte);
        return;
      }
    }

    /* 3. Le message d'un `pushToast`. */
    if (
      ts.isCallExpression(noeud) &&
      /(^|\.)pushToast$/.test(noeud.expression.getText()) &&
      noeud.arguments.length >= 2
    ) {
      const message = noeud.arguments[1];
      if (ts.isStringLiteral(message) && texteLisible(message.text)) {
        noter(message.getStart(arbre), message.end, appelDeTraduction(message.text), message.text);
      } else if (ts.isTemplateExpression(message)) {
        const { texte, valeurs } = gabaritEnTexteATrous(message, source);
        if (texteLisible(texte.replace(/\{\w+\}/g, ' '))) {
          noter(message.getStart(arbre), message.end, appelDeTraduction(texte, valeurs), texte);
        }
      }
    }

    ts.forEachChild(noeud, visiter);
  };

  ts.forEachChild(arbre, visiter);

  /*
   * DEUX GESTES NE SE CHEVAUCHENT JAMAIS. Le plus ENGLOBANT gagne : c'est lui
   * qui porte la phrase entière, celui de dedans n'en serait qu'un morceau. Un
   * chevauchement laissé passer découpe le code au milieu d'une expression.
   */
  gestes.sort((a, b) => a.debut - b.debut || b.fin - a.fin);
  const retenus = [];
  let finPrecedente = -1;
  for (const geste of gestes) {
    if (geste.debut < finPrecedente) continue;
    retenus.push(geste);
    finPrecedente = geste.fin;
  }
  retenus.sort((a, b) => b.debut - a.debut);
  return { gestes: retenus, cles };
}

/** Pose l'import de `t` en tête d'un fichier qui vient d'en gagner l'usage. */
function poserLImport(chemin, texte) {
  if (/from '@\/lib\/langue'/.test(texte)) return texte;
  const lignes = texte.split('\n');
  let rang = -1;
  for (let i = 0; i < lignes.length; i++) {
    if (/^import\s/.test(lignes[i])) rang = i;
    if (rang >= 0 && /^\s*$/.test(lignes[i]) && i > rang) break;
  }
  /* Après le dernier import, ou en tête si le fichier n'en a aucun. */
  const chemins = relative(dirname(chemin), join(SOURCE, 'lib', 'langue')).replace(/\\/g, '/');
  const cible = chemins.startsWith('.') ? chemins : `./${chemins}`;
  const ligne = `import { t } from '${chemin.includes(join('web', 'src')) ? '@/lib/langue' : cible}';`;
  if (rang < 0) return `${ligne}\n${texte}`;
  lignes.splice(rang + 1, 0, ligne);
  return lignes.join('\n');
}

const options = new Set(process.argv.slice(2));
const ecrire = options.has('--ecrire');
const sortirLesCles = options.has('--cles');

const toutesLesCles = new Set();
let touches = 0;
let changements = 0;

for (const chemin of fichiers(SOURCE)) {
  const court = relative(SOURCE, chemin).replace(/\\/g, '/');
  if (HORS_JEU.has(court)) continue;
  const source = readFileSync(chemin, 'utf8');
  const { gestes, cles } = remplacements(chemin, source);
  for (const cle of cles) toutesLesCles.add(cle);
  if (!gestes.length) continue;
  touches++;
  changements += gestes.length;
  if (!ecrire) continue;
  let resultat = source;
  for (const geste of gestes) {
    resultat = resultat.slice(0, geste.debut) + geste.code + resultat.slice(geste.fin);
  }
  writeFileSync(chemin, poserLImport(chemin, resultat));
}

if (sortirLesCles) {
  console.log(JSON.stringify([...toutesLesCles].sort((a, b) => a.localeCompare(b, 'fr')), null, 1));
} else {
  console.log(`${changements} textes dans ${touches} fichiers · ${toutesLesCles.size} textes distincts`);
  if (fragments.length) {
    console.log(`\n${fragments.length} phrases coupées par une balise, à reprendre à la main :`);
    for (const fragment of fragments) {
      console.log(`  ${relative(SOURCE, fragment.chemin)} — ${fragment.texte}`);
    }
  }
  console.log(ecrire ? '\nÉcrit.' : '\nEssai — rien n’a été écrit (--ecrire pour écrire).');
}
