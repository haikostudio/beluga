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
/**
 * LES QUELQUES TEXTES QUI RESSEMBLENT À DU FRANÇAIS SANS EN ÊTRE. Aucune règle
 * générale ne les distingue d'un libellé — « Chris » a exactement la forme de
 * « Réglages » —, alors on les NOMME. La liste est courte et le restera : elle
 * ne sert qu'aux cas où la forme ne dit rien.
 */
const PAS_DU_TEXTE = new Set([
  'Chris', // un PRÉNOM d'exemple, dans un champ où l'on tape le sien
]);

export function texteLisible(valeur) {
  const texte = valeur.trim();
  if (texte.length < 2) return false;
  if (!/[a-zA-ZÀ-ÿ]/.test(texte)) return false;
  if (PAS_DU_TEXTE.has(texte)) return false;
  // Un seul mot tout en minuscules sans accent : une clé, pas une phrase.
  if (/^[a-z0-9]+([-_.][a-z0-9]+)*$/.test(texte)) return false;
  // Un identifiant en dos de chameau (« notifyOnDone ») : du code, pas un mot.
  if (/^[a-z][a-z0-9]*([A-Z][a-z0-9]*)+$/.test(texte)) return false;
  // Un préfixe technique fini par « / » ou « : » (« image/ », « voix:{v0} »).
  if (/\/$/.test(texte) || /^[a-z]+\s*:/.test(texte)) return false;
  // Un gabarit qui n'est QUE des trous et de la ponctuation : une clé d'affichage.
  if (!/[a-zA-ZÀ-ÿ]{3}/.test(texte.replace(/\{\w+\}/g, ' '))) return false;
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

/**
 * Pose l'import de `t` APRÈS LE DERNIER IMPORT du fichier — sa FIN, pas sa
 * première ligne. Un import qui s'étale sur vingt lignes (`import {\n  A,\n
 * B,\n} from …`) commence par « import » et finit vingt lignes plus bas : viser
 * la ligne d'ouverture posait le nouvel import DEDANS, et le fichier ne
 * compilait plus.
 */
function poserLImport(chemin, texte) {
  if (/from '@\/lib\/langue'/.test(texte)) return texte;
  const lignes = texte.split('\n');
  let rang = -1;
  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i];
    /* La FIN d'un import : soit tout tient sur une ligne, soit c'est l'accolade
       fermante d'un import multiligne. */
    if (/^import\s.*;\s*$/.test(ligne) || /^\}\s*from\s.*;\s*$/.test(ligne)) rang = i;
  }
  /* Après le dernier import, ou en tête si le fichier n'en a aucun. */
  const chemins = relative(dirname(chemin), join(SOURCE, 'lib', 'langue')).replace(/\\/g, '/');
  const cible = chemins.startsWith('.') ? chemins : `./${chemins}`;
  const ligne = `import { t } from '${chemin.includes(join('web', 'src')) ? '@/lib/langue' : cible}';`;
  if (rang < 0) return `${ligne}\n${texte}`;
  lignes.splice(rang + 1, 0, ligne);
  return lignes.join('\n');
}

/**
 * LES TEXTES DÉJÀ DONNÉS À `t(…)` dans un fichier — ce que l'interface DEMANDE
 * au dictionnaire. C'est la liste que le contrôle des langues compare aux
 * dictionnaires : elle est lue dans le VRAI arbre du code, pas devinée.
 */
function appelsDeTraduction(chemin, source) {
  const arbre = ts.createSourceFile(chemin, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const trouves = [];
  const visiter = (noeud) => {
    if (
      ts.isCallExpression(noeud) &&
      noeud.expression.getText() === 't' &&
      noeud.arguments.length &&
      ts.isStringLiteral(noeud.arguments[0]) &&
      noeud.arguments[0].text.trim()
    ) {
      trouves.push(noeud.arguments[0].text);
    }
    ts.forEachChild(noeud, visiter);
  };
  ts.forEachChild(arbre, visiter);
  return trouves;
}

/**
 * LA CHASSE AU FRANÇAIS RESTÉ EN DUR — le filet, là où la bascule ne va pas.
 *
 * La bascule ne touche que trois endroits sûrs. Mais un libellé peut se poser
 * AILLEURS : rangé dans une variable au bout d'un `? :` puis affiché plus bas,
 * mis dans un tableau d'options, rendu par une petite fonction. Aucun de ces
 * cas ne se réécrit sans risque à la machine — mais tous se REPÈRENT.
 *
 * On relève donc TOUT littéral qui ressemble à du FRANÇAIS et qui n'est pas
 * déjà passé au dictionnaire. « Ressembler à du français », ici, c'est porter un
 * accent ou l'un des mots outils de la langue : un identifiant anglais, un nom
 * de classe ou une clé technique n'en portent jamais.
 */
/**
 * CE QUI RESSEMBLE À DU FRANÇAIS D'INTERFACE SANS EN ÊTRE, et qu'on laisse donc
 * en place. Trois familles, toutes vérifiées une par une :
 *
 *  - le texte ENVOYÉ À UN AGENT (« Vas-y, lance ce plan. ») : c'est un message
 *    de l'utilisateur au moteur, pas un mot de l'écran — le traduire changerait
 *    ce que l'agent reçoit ;
 *  - une CLÉ de React ou un identifiant interne (`préambule-…`, l'usage passé à
 *    `ouvrirMicro`) : du code déguisé en mot ;
 *  - le titre d'un message d'ESSAI, sur lequel des scripts de contrôle
 *    s'appuient pour se reconnaître.
 */
const A_LAISSER_EN_FRANCAIS = [
  'Vas-y, lance ce plan.',
  '{TEXTE_VALIDATION_PLAN}',
  'Abandonne les versions écrites après la version',
  'dictée',
  'mot de réveil',
  'Vérification',
];

/** Un DÉBUT suffit : les messages envoyés aux agents sont longs, on ne les recopie pas. */
function laisseEnFrancais(texte) {
  const nu = texte.trim();
  return A_LAISSER_EN_FRANCAIS.some((debut) => nu === debut || nu.startsWith(debut));
}

const ACCENTS = /[àâäéèêëîïôöùûüÿçœÀÂÄÉÈÊËÎÏÔÖÙÛÜŸÇŒ’]/;
const MOTS_FRANCAIS =
  /(^|[\s'’(«"])(le|la|les|un|une|des|du|de|au|aux|et|ou|en|dans|sur|pour|par|avec|sans|ce|cet|cette|qui|que|est|sont|pas|plus|tout|tous|toute|toutes|aucun|aucune|votre|vos|son|sa|ses|leur|encore|jamais|toujours|puis|donc|mais|quand|avant|entre|chaque|autre|autres|rien|peut|doit|vers|ici|déjà|elle|il|on|ne|se|si)([\s'’),.…:;!?»"]|$)/i;

function ressembleAuFrancais(texte) {
  if (laisseEnFrancais(texte)) return false;
  return ACCENTS.test(texte) || MOTS_FRANCAIS.test(texte);
}

/** Ce littéral est-il du CODE plutôt qu'un mot ? Un import, un nom de propriété. */
function positionDeCode(noeud) {
  const parent = noeud.parent;
  if (!parent) return true;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === noeud) return true;
  if (ts.isTemplateSpan(parent) || ts.isTemplateHead(noeud) || ts.isTemplateMiddle(noeud)) return true;
  /* Une CLÉ de React (`key={…}`) n'est pas lue par un humain. */
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent) && parent.parent.name.getText() === 'key') {
    return true;
  }
  return false;
}

/** Les littéraux français d'un fichier qui ne passent PAS encore par `t(…)`. */
function francaisResteEnDur(chemin, source) {
  const arbre = ts.createSourceFile(chemin, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const restes = [];
  const visiter = (noeud) => {
    if (ts.isStringLiteral(noeud) || ts.isNoSubstitutionTemplateLiteral(noeud) || ts.isJsxText(noeud)) {
      const texte = ts.isJsxText(noeud) ? texteJsx(noeud.text) : noeud.text;
      /* Un `aria-label`, un `data-…`, une `key` : ce sont les REPÈRES que les
         scripts de contrôle emploient pour désigner un bouton. Ils restent en
         français À DESSEIN et ne sont donc pas des oublis. */
      if (contexteDuLitteral(noeud) === 'attribut-technique') return;
      if (positionDeCode(noeud)) return;
      if (texteLisible(texte) && ressembleAuFrancais(texte) && !dejaPrisEnCharge(noeud)) {
        const { line } = arbre.getLineAndCharacterOfPosition(noeud.getStart(arbre));
        restes.push({
          ligne: line + 1,
          texte,
          debut: noeud.getStart(arbre),
          fin: noeud.end,
          code: ts.isJsxText(noeud) ? `{${appelDeTraduction(texte)}}` : appelDeTraduction(texte),
        });
      }
      return;
    }
    if (
      ts.isTemplateExpression(noeud) &&
      !dejaPrisEnCharge(noeud) &&
      !positionDeCode(noeud) &&
      contexteDuLitteral(noeud) !== 'attribut-technique'
    ) {
      const { texte, valeurs } = gabaritEnTexteATrous(noeud, source);
      if (laisseEnFrancais(texte)) return;
      const nu = texte.replace(/\{\w+\}/g, ' ');
      if (texteLisible(nu) && ressembleAuFrancais(nu)) {
        const { line } = arbre.getLineAndCharacterOfPosition(noeud.getStart(arbre));
        restes.push({
          ligne: line + 1,
          texte,
          debut: noeud.getStart(arbre),
          fin: noeud.end,
          code: appelDeTraduction(texte, valeurs),
        });
      }
      return;
    }
    ts.forEachChild(noeud, visiter);
  };
  ts.forEachChild(arbre, visiter);
  return restes;
}

const options = new Set(process.argv.slice(2));
const ecrire = options.has('--ecrire');
const sortirLesCles = options.has('--cles');
const sortirLesAppels = options.has('--appels');
const chasser = options.has('--reste');

if (chasser) {
  const poser = options.has('--ecrire');
  let total = 0;
  for (const chemin of fichiers(SOURCE)) {
    const court = relative(SOURCE, chemin).replace(/\\/g, '/');
    if (HORS_JEU.has(court)) continue;
    const source = readFileSync(chemin, 'utf8');
    const restes = francaisResteEnDur(chemin, source);
    total += restes.length;
    for (const reste of restes) {
      console.log(`${court}:${reste.ligne}  ${reste.texte.replace(/\s+/g, ' ').slice(0, 110)}`);
    }
    if (!poser || !restes.length) continue;
    let resultat = source;
    for (const reste of [...restes].sort((a, b) => b.debut - a.debut)) {
      resultat = resultat.slice(0, reste.debut) + reste.code + resultat.slice(reste.fin);
    }
    writeFileSync(chemin, poserLImport(chemin, resultat));
  }
  console.log(`\n${total} texte(s) français hors dictionnaire.`);
  process.exit(0);
}

if (sortirLesAppels) {
  const demandes = new Set();
  for (const chemin of fichiers(SOURCE)) {
    for (const texte of appelsDeTraduction(chemin, readFileSync(chemin, 'utf8'))) demandes.add(texte);
  }
  console.log(JSON.stringify([...demandes].sort((a, b) => a.localeCompare(b, 'fr')), null, 1));
  process.exit(0);
}

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
