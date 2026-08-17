/**
 * TRADUIRE — la mécanique, sans un mot de dictionnaire dedans.
 *
 * Les DICTIONNAIRES vivent à côté (`shared/src/traductions.ts`), un bloc par
 * langue. Ce fichier ne fait que trois choses : chercher, remplacer les trous,
 * et dire ce qui manque.
 *
 * LA CLÉ D'UNE TRADUCTION EST SON TEXTE FRANÇAIS. Ce n'est pas un détail de
 * confort, c'est ce qui rend la panne IMPOSSIBLE : une traduction oubliée, une
 * langue ajoutée à moitié, un écran écrit après coup — dans tous ces cas
 * l'application affiche du FRANÇAIS LISIBLE, jamais un vide, jamais un
 * « settings.button.save » nu au milieu d'un bouton. Le prix est connu et
 * assumé : deux textes français identiques dans deux contextes différents
 * partagent leur traduction. Sur cette interface, aucun cas ne s'y oppose.
 *
 * LES TROUS SE NOMMENT `{ainsi}`. Un texte porte des trous quand un chiffre ou
 * un nom doit s'y glisser (« {n} agents travaillent ») : la PHRASE ENTIÈRE part
 * alors au dictionnaire, et chaque langue place le trou où sa grammaire le veut
 * — ce qu'une phrase découpée en morceaux collés bout à bout ne permet pas.
 *
 * LE PLURIEL NE S'INVENTE PAS : il n'y a aucune machinerie ici. Un écran qui
 * distingue « 1 agent » de « 3 agents » écrit ses DEUX phrases et choisit
 * lui-même, exactement comme il le faisait en français. Cinq langues aux règles
 * de pluriel différentes ne se ramènent à aucun automatisme fiable.
 */

import { LANGUE_DORIGINE, langueValide, type LangueId } from './langues.js';

/** Le dictionnaire d'UNE langue : le texte français, puis sa traduction. */
export type Dictionnaire = Readonly<Record<string, string>>;

/** Ce que les écrans glissent dans les trous d'un texte. */
export type ValeursDeTexte = Readonly<Record<string, string | number>>;

/**
 * Remplace les trous `{nom}` par leur valeur. Un trou sans valeur est LAISSÉ TEL
 * QUEL : mieux vaut voir « {n} » à l'écran — le défaut saute aux yeux et se
 * corrige — qu'un blanc qui passerait inaperçu.
 */
export function remplirLesTrous(texte: string, valeurs?: ValeursDeTexte): string {
  if (!valeurs) return texte;
  return texte.replace(/\{(\w+)\}/g, (entier, nom: string) => {
    const valeur = valeurs[nom];
    return valeur === undefined || valeur === null ? entier : String(valeur);
  });
}

/**
 * LE TEXTE À AFFICHER, dans la langue demandée.
 *
 * Trois issues, dans cet ordre : la traduction si elle existe, sinon le texte
 * FRANÇAIS d'origine — qui est la clé elle-même —, et dans les deux cas les
 * trous remplis. La langue d'origine ne consulte aucun dictionnaire : c'est le
 * chemin le plus fréquent, et il ne peut donc rien casser.
 */
export function traduire(
  dictionnaires: Readonly<Record<string, Dictionnaire>>,
  langue: unknown,
  texte: string,
  valeurs?: ValeursDeTexte,
): string {
  const id = langueValide(langue);
  if (id === LANGUE_DORIGINE) return remplirLesTrous(texte, valeurs);
  const traduction = dictionnaires[id]?.[texte];
  return remplirLesTrous(traduction || texte, valeurs);
}

/** Les trous nommés dans un texte, sans doublon et dans l'ordre d'apparition. */
export function trousDuTexte(texte: string): string[] {
  const vus: string[] = [];
  for (const trouve of texte.matchAll(/\{(\w+)\}/g)) {
    if (!vus.includes(trouve[1])) vus.push(trouve[1]);
  }
  return vus;
}

/** Ce qu'un contrôle reproche à une langue. */
export type ManqueDeLangue = {
  langue: LangueId;
  /** Les textes français qu'elle ne traduit pas. */
  absents: string[];
  /** Les textes qu'elle traduit sans en garder tous les trous — un `{n}` perdu. */
  trousPerdus: string[];
  /** Les textes qu'elle recopie mot pour mot du français. */
  nonTraduits: string[];
};

/**
 * CE QUI MANQUE À CHAQUE LANGUE, mesuré et non supposé.
 *
 * Trois reproches, tous vérifiés sur la MÊME liste de textes d'origine : la
 * traduction absente, le TROU PERDU (une phrase traduite qui a laissé tomber son
 * `{n}` afficherait un compte nulle part) et la recopie pure du français.
 *
 * La recopie n'est pas toujours une faute — « Note », « Sprint », un nom propre
 * s'écrivent pareil dans plusieurs langues. Elle est donc RENDUE, jamais jugée
 * ici : c'est au contrôle de décider ce qu'il en fait.
 */
export function manquesDeLaLangue(
  textes: readonly string[],
  langue: LangueId,
  dictionnaire: Dictionnaire,
): ManqueDeLangue {
  const absents: string[] = [];
  const trousPerdus: string[] = [];
  const nonTraduits: string[] = [];
  for (const texte of textes) {
    const traduction = dictionnaire[texte];
    if (!traduction) {
      absents.push(texte);
      continue;
    }
    if (traduction === texte) nonTraduits.push(texte);
    for (const trou of trousDuTexte(texte)) {
      if (!traduction.includes(`{${trou}}`)) {
        trousPerdus.push(texte);
        break;
      }
    }
  }
  return { langue, absents, trousPerdus, nonTraduits };
}
